import * as THREE from 'three/webgpu'
import { GRID_MAP, GRID_ROOMS, GridRoom, RrtRun, SAMPLING, XY, alongPath, cutCorners, pathClearance, pathLength, pathStats, rrtPath, rrtRun, shortcutRun, treeAt } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, chordPath, cursorBar, diffBot, floorView, glowMat, liveLabel, memoBy, pointCloud, rayFan, roomModel, scope, simClock } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const RV = { at: [-18.6, -5.6, 0] as V3, k: 5.6, tilt: -0.5 }
const TOP = RV.at[1] + 2.5 * RV.k * Math.cos(RV.tilt)
const VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const WF = { x: 10.4, y: -0.6, w: 10.5, h: 6.4 }
const N = SAMPLING.n
const DRIVE = { stepM: 0.02 }
const START = GRID_MAP.start
const GOAL = GRID_MAP.goal
const MAPS = { flat: 'Two rooms (narrow gap)', trap: 'Cup-shaped trap' }
const MAP = (initial: GridRoom) => ({ kind: 'choice' as const, key: 'map', options: opts(MAPS), initial })
const SEED = { kind: 'slider' as const, key: 'seed', label: 'Random seed', min: 1, max: 9, step: 1, initial: 2, format: (v: number) => `#${v}` }
const C = { tree: '#3f6fb0', dimTree: '#2a3550', blocked: '#7a2e2e', sample: '#9aa3b2' }
const m2 = (v: number) => `${v.toFixed(2)} m`
const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`
const P = (p: XY) => ({ x: p[0], y: p[1] })

/** Room on a tilted floor, start/goal marks, tree, samples, route and a robot. */
function planStage(scene: THREE.Scene, treeColor: string) {
  const g = floorView(scene, RV.at, RV.k, RV.tilt)
  const room = roomModel(g, 0.4)
  const marks = pointCloud(g, 2, 0.05)
  marks.set(0, [START[0], START[1], 0.02], POWER)
  marks.set(1, [GOAL[0], GOAL[1], 0.02], HEAT)
  marks.show(2)
  addLabel(g, 'start', [START[0], START[1] - 0.14, 0.01], POWER, 0.08)
  addLabel(g, 'goal', [GOAL[0], GOAL[1] - 0.14, 0.01], HEAT, 0.08)
  const tree = rayFan(g, N, glowMat(treeColor, 0.9), 0.006)
  const dots = pointCloud(g, 1000, 0.014)
  const route = chordPath(g, 1000, RING, 0.012, 0.016)
  const bot = diffBot(g)
  const status = liveLabel(scene, [RV.at[0], TOP + 1.7, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [RV.at[0], TOP + 0.9, 0.3], { size: 0.3, color: GREY, align: 'left' })
  const st = { pts: null as XY[] | null, len: 0 }
  return {
    g,
    room,
    tree,
    dots,
    route,
    status,
    sub,
    edges(run: RrtRun, par: ArrayLike<number>, z = 0.01) {
      const segs: [V3, V3][] = []
      for (let i = 1; i < par.length; i++) if (par[i] >= 0) segs.push([[run.pts[i][0], run.pts[i][1], z], [run.pts[par[i]][0], run.pts[par[i]][1], z]])
      tree(segs)
    },
    /** Robot `s` metres along `pts` (at the start if empty). */
    drive(pts: XY[], s: number) {
      if (pts !== st.pts) Object.assign(st, { pts, len: pathLength(pts) })
      if (pts.length < 2) return bot.set({ x: START[0], y: START[1], th: 0 }, 0, 0)
      const a = alongPath(pts, Math.min(s, st.len))
      bot.set({ x: a.at[0], y: a.at[1], th: a.dir }, s / 0.033, s / 0.033)
    },
  }
}

/** Scope on the right with a title, range note and two text lines under it. */
function costScope(scene: THREE.Scene, title: string, xLeft: string, xRight: string) {
  const plot = scope(scene, WF.w, WF.h, { divs: [6, 4], zeroAt: 0 })
  plot.group.position.set(WF.x, WF.y, 0)
  addLabel(scene, title, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.7, 0.3], LABEL, 0.34, 'left')
  const range = liveLabel(scene, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 0.9, 0.3], { size: 0.28, color: GREY, align: 'left' })
  addLabel(scene, xLeft, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'left')
  addLabel(scene, xRight, [WF.x + WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'right')
  const lines = [0, 1, 2].map((k) => liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 2.0 - k * 0.8, 0.3], { size: 0.32, align: 'left' }))
  return { plot, range, lines, cursor: cursorBar(plot, LABEL, 0.05) }
}

// --- RRT growth: random samples pull a tree across the room; RRT* rewires it so the route keeps getting shorter. ---

const PLANNERS = { rrt: 'RRT', star: 'RRT*' }
const rgParams = (p: Params) => ({ planner: pick(PLANNERS, p.planner, 'star') as keyof typeof PLANNERS, step: n(p, 'step'), bias: n(p, 'bias'), map: pick(MAPS, p.map, 'flat') as GridRoom, seed: n(p, 'seed') })
type RgQ = ReturnType<typeof rgParams>
const rgKey = (q: RgQ) => `${q.step}|${q.bias}|${q.map}|${q.seed}`
const rgRun = memoBy(rgKey, (q: RgQ) => {
  const room = GRID_ROOMS[q.map]
  const o = { step: q.step, bias: q.bias / 100, seed: q.seed }
  const rrt = rrtRun(room, START, GOAL, { ...o, star: false })
  const star = rrtRun(room, START, GOAL, { ...o, star: true })
  const fin = (r: RrtRun) => r.iters[N - 1]
  const finite = [rrt, star].flatMap((r) => r.iters.map((it) => it.best).filter(Number.isFinite))
  const straight = Math.hypot(GOAL[0] - START[0], GOAL[1] - START[1])
  const lo = Math.floor(straight * 2) / 2
  const hi = Math.max(lo + 1, Math.ceil(Math.max(...finite, lo + 1) * 2) / 2)
  return {
    room,
    rrt,
    star,
    lo,
    hi,
    straight,
    paths: { rrt: rrtPath(rrt, rrt.parent, fin(rrt).bestNode), star: rrtPath(star, star.parent, fin(star).bestNode) },
    nodes: { rrt: rrt.pts.length, star: star.pts.length },
  }
})
const GROW = { slow: 0.012, hold: 2.5 }

export const samplingPlannersRrtGrowth: Lesson = {
  id: 'sampling-planners-rrt-growth',
  title: 'RRT growth',
  tagline: 'Throw random points at the room and grow a tree towards each one: it reaches into every gap without ever building a grid',
  formula: (p) => {
    const q = rgParams(p)
    return q.planner === 'rrt'
      ? `sample x (goal ${q.bias} % of the time) → nearest node → step ≤ ${Math.round(q.step * 100)} cm towards x → keep the edge if it is free`
      : 'RRT* · new node takes the cheapest parent within radius r · then neighbours re-parent through it if that is cheaper · r ∝ √(log n / n)'
  },
  legend: [
    { color: C.tree, label: 'Tree edges (each checked against the room)', shape: 'dot' },
    { color: C.sample, label: 'Sample that grew the tree', shape: 'dot' },
    { color: HIGH_V, label: 'Sample whose edge would hit something', shape: 'dot' },
    { color: RING, label: 'Best route so far', shape: 'dot' },
  ],
  points: [
    'Graph search needs the map cut into cells first, and the cell count explodes with size and with dimensions (an arm with 6 joints is a 6-D space). A sampling planner never builds that grid. It only needs one question answered: is this short straight move free? Here: does a 12 cm robot body swept along the edge stay clear of every box?',
    'RRT (rapidly exploring random tree, LaValle 1998) picks a random point, finds the nearest node of the tree and steps a fixed distance towards it. If the step is free it becomes a new node. Big empty regions get the most samples, so the tree is pulled into unexplored space. Goal bias: some samples are the goal itself, which drags the tree towards it.',
    'A larger step crosses the room in fewer samples but cannot squeeze through narrow gaps; a narrow passage is hit by few random samples, so it is the classic hard case. Plain RRT stops improving once it finds a route: the cost line goes flat, and the route is jagged and long.',
    'RRT* (Karaman and Frazzoli, 2011) picks the cheapest parent among nearby nodes and rewires neighbours through each new node. With more samples its cost keeps falling towards the shortest route. PRM is the multi-query cousin: sample the whole room once into a roadmap, then answer many start/goal queries with A* (see Graph search).',
  ],
  controls: [
    { kind: 'choice', key: 'planner', options: opts(PLANNERS), initial: 'star' },
    { kind: 'slider', key: 'step', label: 'Step size', min: 0.1, max: 0.5, step: 0.05, initial: 0.25, format: (v: number) => `${Math.round(v * 100)} cm` },
    { kind: 'slider', key: 'bias', label: 'Goal bias', min: 0, max: 50, step: 5, initial: 10, format: (v: number) => `${v} %` },
    MAP('flat'),
    SEED,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = planStage(scene, C.tree)
    const sc = costScope(scene, 'route cost vs samples', 'sample 0', `${N}`)
    const tRrt = sc.plot.trace(GREY, { samples: 151, radius: 0.07 })
    const tStar = sc.plot.trace(RING, { samples: 151, radius: 0.09 })
    const floor = sc.plot.level(POWER)
    const clock = simClock(GROW.slow, GROW.hold)
    const st = { key: '', k: -1, driving: false }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = rgParams(p)
        const key = `${q.planner}|${rgKey(q)}`
        const R = rgRun(q)
        s.room.draw(R.room)
        const run = R[q.planner]
        const path = R.paths[q.planner]
        const len = pathLength(path)
        const t = clock(dt, key, N + Math.ceil(len / DRIVE.stepM))
        const k = Math.min(N - 1, Math.floor(t))
        const driving = t >= N
        s.drive(driving ? path : [], (t - N) * DRIVE.stepM)
        if (key === st.key && k === st.k && driving === st.driving) return
        Object.assign(st, { key, k, driving })
        const par = treeAt(run, k)
        s.edges(run, par)
        for (let i = 0; i <= k; i++) {
          const it = run.iters[i]
          const last = i === k && !driving
          s.dots.set(i, [it.sample[0], it.sample[1], 0.02], last ? HEAT : it.node >= 0 ? C.sample : HIGH_V, last ? 2.6 : 1)
        }
        s.dots.show(driving ? 0 : k + 1)
        const it = run.iters[k]
        s.route(rrtPath(run, par, it.bestNode).map(P))
        const yOf = (c: number) => ((Math.min(R.hi, c) - R.lo) / (R.hi - R.lo) - 0.5) * WF.h
        for (const [tr, r] of [[tRrt, R.rrt], [tStar, R.star]] as const) {
          const us: number[] = []
          const ys: number[] = []
          if (r.firstAt >= 0 && r.firstAt <= k)
            for (let i = r.firstAt; i <= k; i += 4) {
              us.push(i / (N - 1))
              ys.push(yOf(r.iters[i].best))
            }
          tr.points(us, ys)
        }
        floor.set(yOf(R.straight))
        sc.cursor(k / (N - 1))
        sc.range.set(`${R.lo.toFixed(1)} … ${R.hi.toFixed(1)} m · grey RRT · yellow RRT*`)
        const nodes = par.filter((x) => x !== -2).length
        sc.lines[0].set(it.node < 0 ? `sample ${k + 1}: edge blocked, nothing added` : `sample ${k + 1}: new node ${it.node}${it.rewires.length ? ` · rewired ${it.rewires.length}` : ''}`, it.node < 0 ? HIGH_V : LABEL)
        sc.lines[1].set(`${nodes} nodes · ${run.firstAt < 0 ? 'no route yet' : `first route at sample ${run.firstAt + 1}`}`, GREY)
        sc.lines[2].set('green: straight line start → goal, the floor', POWER)
        const found = Number.isFinite(it.best)
        const failed = !path.length && k === N - 1
        s.status.set(
          failed ? `${PLANNERS[q.planner]} · no route in ${N} samples` : driving ? `${PLANNERS[q.planner]} · driving the ${m2(len)} route` : `${PLANNERS[q.planner]} · sample ${k + 1} of ${N} · ${found ? `route ${m2(it.best)}` : 'searching'}`,
          failed ? HIGH_V : driving ? POWER : found ? LABEL : HEAT,
        )
        s.sub.set(failed ? `no route in ${N} samples: try a bigger step, more goal bias or another seed` : `${MAPS[q.map]} · step ${Math.round(q.step * 100)} cm · goal bias ${q.bias} % · seed #${q.seed}`)
      },
      readouts: (p) => {
        const q = rgParams(p)
        const R = rgRun(q)
        const run = R[q.planner]
        const best = run.iters[N - 1].best
        return [
          { label: 'First route at', value: run.firstAt < 0 ? 'none' : `sample ${run.firstAt + 1}`, tone: run.firstAt < 0 ? 'bad' : 'ok' },
          { label: `Cost after ${N}`, value: Number.isFinite(best) ? m2(best) : '—' },
          { label: 'RRT vs RRT*', value: `${Number.isFinite(R.rrt.iters[N - 1].best) ? m2(R.rrt.iters[N - 1].best) : '—'} vs ${Number.isFinite(R.star.iters[N - 1].best) ? m2(R.star.iters[N - 1].best) : '—'}` },
          { label: `Nodes after ${N}`, value: `${R.nodes[q.planner]}` },
        ]
      },
    }
  },
}

// --- Smoothing paths: shortcut the jagged RRT route, then cut its corners, never leaving free space. ---

const smParams = (p: Params) => ({ tries: n(p, 'tries'), passes: n(p, 'passes'), map: pick(MAPS, p.map, 'flat') as GridRoom, seed: n(p, 'seed') })
type SmQ = ReturnType<typeof smParams>
const smKey = (q: SmQ) => `${q.tries}|${q.passes}|${q.map}|${q.seed}`
const SM = { holdRaw: 25, tryTicks: 8, passTicks: 25, slow: 0.04, hold: 2.5 }
const smRun = memoBy(smKey, (q: SmQ) => {
  const room = GRID_ROOMS[q.map]
  const run = rrtRun(room, START, GOAL, { step: 0.25, bias: 0.1, seed: q.seed, star: false })
  const raw = rrtPath(run, run.parent, run.iters[N - 1].bestNode)
  const tries = shortcutRun(room, raw, q.tries, q.seed)
  const short = tries.length ? tries[tries.length - 1].path : raw
  const rounds = [short]
  for (let i = 0; i < q.passes; i++) rounds.push(cutCorners(room, rounds[i]))
  const stages = [raw, ...tries.map((t) => t.path), ...rounds.slice(1)]
  const base = pathStats(raw)
  return { room, run, raw, tries, short, rounds, stages, base, fin: pathStats(stages[stages.length - 1]), gap: pathClearance(room, stages[stages.length - 1]) }
})

export const samplingPlannersSmoothingPaths: Lesson = {
  id: 'sampling-planners-smoothing-paths',
  title: 'Smoothing paths',
  tagline: 'An RRT route zigzags because the samples were random: try straight shortcuts between its waypoints, then round the corners that are left',
  formula: 'shortcut: pick waypoints i < j · chord i → j free? drop i+1 … j−1 · round: corner v → two points ¼ along each leg, if that cut is free',
  legend: [
    { color: GREY, label: 'Raw RRT route', shape: 'dot' },
    { color: POWER, label: 'Shortcut tried: free, taken', shape: 'dot' },
    { color: HIGH_V, label: 'Shortcut tried: blocked', shape: 'dot' },
    { color: RING, label: 'Smoothed route', shape: 'dot' },
  ],
  points: [
    'A plain RRT route visits every random node the tree happened to grow through, so it wanders and makes sharp turns. Driving it wastes time and battery, and every sharp corner means stopping to turn on the spot. Planners almost always post-process the route before handing it to the path follower.',
    'Shortcutting: pick two waypoints at random and test the straight chord between them with the same collision check the planner used. If it is free, everything in between is thrown away. Each success makes the route shorter, never longer; a few dozen tries usually remove most of the zigzag. Graph search routes on a grid benefit the same way.',
    'What is left are straight legs meeting at corners that hug the obstacles. Corner cutting (Chaikin) replaces each corner with two points a quarter of the way along its legs. Every pass halves the sharpest turns and makes the route slightly shorter; a corner whose cut would hit something is left alone, so the route stays at least the robot radius from every obstacle. Heavy shortcutting pulls the route tight round obstacle corners, and those corners cannot be cut: that is why real planners plan with extra clearance.',
    'The result is still a polyline, but with gentle bends a diff-drive or car-like robot can follow without stopping. Real stacks then fit splines and add speed limits for curvature; the next topic, Path tracking, follows a route like this one.',
  ],
  controls: [
    { kind: 'slider', key: 'tries', label: 'Shortcut tries', min: 0, max: 60, step: 5, initial: 25, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'passes', label: 'Corner-cutting passes', min: 0, max: 4, step: 1, initial: 3, format: (v: number) => `${v}` },
    MAP('flat'),
    SEED,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = planStage(scene, C.dimTree)
    const rawLine = chordPath(s.g, 200, GREY, 0.007, 0.012)
    const okChord = rayFan(s.g, 1, glowMat(POWER, 1.2), 0.012)
    const badChord = rayFan(s.g, 1, glowMat(HIGH_V, 1.2), 0.012)
    const sc = costScope(scene, '% of the raw route', 'raw', 'shortcuts → corner passes')
    const tLen = sc.plot.trace(B_FIELD, { samples: 70, radius: 0.08 })
    const tTurn = sc.plot.trace(HEAT, { samples: 70, radius: 0.08 })
    const clock = simClock(SM.slow, SM.hold)
    const st = { key: '', i: -1, drawn: '', driving: false }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = smParams(p)
        const key = smKey(q)
        const R = smRun(q)
        s.room.draw(R.room)
        const nT = R.tries.length
        const fin = R.stages[R.stages.length - 1]
        const finLen = pathLength(fin)
        const tShort = SM.holdRaw + nT * SM.tryTicks
        const tRound = tShort + q.passes * SM.passTicks
        const t = clock(dt, key, tRound + Math.ceil(finLen / (DRIVE.stepM * 2)))
        const driving = t >= tRound
        s.drive(driving ? fin : [], (t - tRound) * DRIVE.stepM * 2)
        const i = t < SM.holdRaw ? 0 : t < tShort ? 1 + Math.floor((t - SM.holdRaw) / SM.tryTicks) : t < tRound ? 1 + nT + Math.floor((t - tShort) / SM.passTicks) : R.stages.length - 1
        const at = Math.min(R.stages.length - 1, i)
        if (key === st.key && at === st.i && driving === st.driving) return
        Object.assign(st, { key, i: at, driving })
        if (st.drawn !== `${q.map}|${q.seed}`) {
          st.drawn = `${q.map}|${q.seed}`
          s.edges(R.run, R.run.parent, 0.006)
          rawLine(R.raw.map(P))
        }
        const cur = R.stages[at]
        s.route(cur.map(P))
        cur.forEach((c, j) => s.dots.set(j, [c[0], c[1], 0.02], RING, 1.4))
        s.dots.show(cur.length)
        const tr = at >= 1 && at <= nT ? R.tries[at - 1] : null
        const prev = tr ? R.stages[at - 1] : null
        const chord: [V3, V3][] = tr && prev ? [[[prev[tr.i][0], prev[tr.i][1], 0.02], [prev[tr.j][0], prev[tr.j][1], 0.02]]] : []
        okChord(tr?.ok ? chord : [])
        badChord(tr && !tr.ok ? chord : [])
        const xs = R.stages.map((_, j) => j / Math.max(1, R.stages.length - 1))
        const len = R.stages.map((pp) => pathStats(pp))
        const yOf = (v: number) => (Math.min(1, v) - 0.5) * WF.h
        tLen.points(xs.slice(0, at + 1), len.slice(0, at + 1).map((v) => yOf(v.len / R.base.len)))
        tTurn.points(xs.slice(0, at + 1), len.slice(0, at + 1).map((v) => yOf(R.base.sharp ? v.sharp / R.base.sharp : 0)))
        sc.cursor(xs[at])
        sc.range.set('0 … 100 % · blue length · orange sharpest turn')
        const st2 = len[at]
        const phase = at === 0 ? 'raw RRT route' : tr ? `shortcut ${at} of ${nT}` : at < R.stages.length ? `corner pass ${at - nT} of ${q.passes}` : ''
        sc.lines[0].set(tr ? (tr.ok ? `waypoints ${tr.i} → ${tr.j}: free, ${tr.j - tr.i - 1} dropped` : `waypoints ${tr.i} → ${tr.j}: blocked, keep`) : at === 0 ? `${R.raw.length} waypoints from the tree` : st2.n > R.stages[at - 1].length ? `cut ${st2.n - R.stages[at - 1].length} corners into pairs` : 'every corner touches an obstacle: none cut', tr ? (tr.ok ? POWER : HIGH_V) : LABEL)
        sc.lines[1].set(`${m2(st2.len)} · ${st2.n} waypoints · sharpest turn ${deg(st2.sharp)}`, GREY)
        sc.lines[2].set(`kept ≥ ${Math.round(SAMPLING.r * 100)} cm (robot radius) from every obstacle`, GREY)
        s.status.set(driving ? `Smoothed · driving ${m2(finLen)} (raw ${m2(R.base.len)})` : `Smoothing · ${phase}`, driving ? POWER : LABEL)
        s.sub.set(`${MAPS[q.map]} · RRT step 25 cm, seed #${q.seed} · ${R.tries.length} of ${q.tries} shortcut tries used · ${q.passes} corner passes`)
      },
      readouts: (p) => {
        const R = smRun(smParams(p))
        return [
          { label: 'Length', value: `${m2(R.base.len)} → ${m2(R.fin.len)}`, tone: R.fin.len < R.base.len ? 'ok' : undefined },
          { label: 'Sharpest turn', value: `${deg(R.base.sharp)} → ${deg(R.fin.sharp)}` },
          { label: 'Waypoints', value: `${R.base.n} → ${R.fin.n}` },
          { label: 'Closest obstacle', value: `${Math.round(R.gap * 100)} cm`, tone: R.gap >= SAMPLING.r - 0.005 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
