import {
  DEG,
  MAZE,
  MAZE_BOT,
  MOUSE_DRIVE,
  Maze,
  SideMount,
  VL53L0X,
  cellTicks,
  centreGoal,
  floodUs,
  genMaze,
  mapBytes,
  mouseAt,
  mouseTimeline,
  rayDir,
  senseRun,
  sensorRay,
  skewPose,
  wallAt,
  wallFollow,
} from '../../core/physics'
import { fixedText, mmText, secsText } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  BOARD_VIEW,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  chordPath,
  codeListing,
  commentTint,
  countBars,
  cursorBar,
  diffBot,
  flatBox,
  floorView,
  glowMat,
  liveLabel,
  mazeModel,
  memoBy,
  plotY,
  pointCloud,
  simClock,
  stretchRod,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const N = MAZE.n
const MV = { at: [-15.5, -6.4, 0] as V3, k: 7.6, tilt: -0.5 }
const TOP = MV.at[1] + N * MAZE.cellM * MV.k * Math.cos(MV.tilt)
const C = { wall: '#d9dce3', ghost: '#5d626e', goal: '#6b4322', seen: '#1f3d47', bad: '#5a2430', path: '#1f5a3c' }
const SLOT_NAMES = ['left', 'front', 'right']

/** Span-40 stage: maze, trail, robot and two header lines over the maze. */
function mazeStage() {
  const scene = createStage({ span: 40 })
  const g = floorView(scene, MV.at, MV.k, MV.tilt)
  return {
    scene,
    g,
    mz: mazeModel(g, N, N),
    trail: chordPath(g, 4 * N * N, RING, 0.007, 0.012),
    bot: diffBot(g),
    status: liveLabel(scene, [MV.at[0], TOP + 1.7, 0.3], { size: 0.44, align: 'left' }),
    sub: liveLabel(scene, [MV.at[0], TOP + 0.9, 0.3], { size: 0.3, color: GREY, align: 'left' }),
  }
}
const cellPts = (m: Maze, cells: number[]) => cells.map((c) => ({ x: ((c % m.w) + 0.5) * MAZE.cellM, y: (Math.floor(c / m.w) + 0.5) * MAZE.cellM }))

// --- Wall sensing: three VL53L0X, a threshold per cell, and where along the cell to read them. ---

const MOUNTS = { out: 'Side sensors straight out (90°)', angled: 'Side sensors angled forward (45°)' }
const MOUNT_DEG: Record<keyof typeof MOUNTS, SideMount> = { out: 90, angled: 45 }
const ROUTE = { seed: 5, cells: 41 }
const wsParams = (p: Params) => ({ mount: MOUNT_DEG[pick(MOUNTS, p.mount, 'out')], thr: n(p, 'threshold'), off: n(p, 'offset') / 1000, err: n(p, 'skew') })
type WsQ = ReturnType<typeof wsParams>
const wsKey = (q: WsQ) => `${q.mount}|${q.thr}|${q.off}|${q.err}`
const wsMaze = genMaze(N, N, ROUTE.seed)
const wsCells = wallFollow(wsMaze, 0, 0, centreGoal(wsMaze), 'left').cells.slice(0, ROUTE.cells)
const wsRun = memoBy(wsKey, (q: WsQ) => senseRun(wsMaze, wsCells, q.mount, q.thr, q.off, q.err))
const WS = { sx: 7.2, sy: 3.4, sw: 11, sh: 4.4, top: 300, slow: 0.06, hold: 2.5 }
const SENSE_COLORS = [B_FIELD, RING, '#b48cff']

export const mazeSolverWallSensing: Lesson = {
  id: 'maze-solver-wall-sensing',
  title: 'Wall sensing',
  tagline: 'Three laser rangers tell the car which sides of its cell have walls, if the threshold and the moment of reading are right',
  formula: (p) => {
    const q = wsParams(p)
    const r = wsRun(q)
    return `wall if reading < ${q.thr} mm · centred: side wall ${q.mount === 90 ? '≈ 65' : '≈ 82'} mm, open side = floor through the 25° cone ≈ 185 mm, front wall ≈ 40 mm · offset ≈ (R − L)/2${q.mount === 45 ? ' × sin 45°' : ''} = ${r.centre === null ? '—' : mmText(r.centre)}`
  },
  legend: [
    { color: C.wall, label: 'Wall read right (grey: not read yet)', shape: 'dot' },
    { color: HIGH_V, label: 'Wall missed, or a wall read where there is none', shape: 'dot' },
    { color: HEAT, label: 'Beam reading under the threshold: wall', shape: 'dot' },
    { color: B_FIELD, label: 'Beam reading over it: open (left · front · right)', shape: 'dot' },
  ],
  points: [
    'Three VL53L0X time-of-flight sensors on the deck look left, ahead and right, 4 cm up so the beams stay under the 5 cm wall tops (Sensors › Time of flight). All three answer at I²C address 0x29: hold two in reset with their XSHUT pins at boot, give the first a new address, release the next, and so on.',
    'Each cell boils down to three bits: wall if the reading is under a threshold. Centred, a side wall reads about 65 mm. An open side does not read "nothing": the 25° cone dips to the floor about 18 cm out, so it reads about 185 mm. The threshold has to sit between the two, around 120 mm. Set it over 185 and every opening turns into a wall.',
    'When to read matters. Sensors straight out see the walls beside the axle, so read them as the car reaches the middle of the cell. Angled 45° forward, they hit the wall 13 cm ahead: the car reads half a cell early and has time to plan the turn. But a skewed car changes a slanted beam’s length much faster, so the angled pair is the first to misread.',
    'With walls on both sides the same readings centre the car: the offset is (R − L)/2 (times sin 45° for the angled pair), fed to a P loop on steering as in Navigation › Obstacle avoidance › Wall following. A skewed heading changes that difference too, so correct it with the gyro or the encoders (Mobility › Differential drive).',
  ],
  controls: [
    { kind: 'choice', key: 'mount', options: opts(MOUNTS), initial: 'out' },
    { kind: 'slider', key: 'threshold', label: 'Wall threshold', min: 60, max: 260, step: 10, initial: 120, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'offset', label: 'Off centre (left +)', min: -40, max: 40, step: 5, initial: 0, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'skew', label: 'Heading error', min: -25, max: 25, step: 5, initial: 0, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const { scene, ...s } = mazeStage()
    const pts = cellPts(wsMaze, wsCells)
    const sensorM = glowMat('#2a2c32', 0.2)
    const chips = [0, 1, 2].map(() => flatBox(s.bot.group, [0.014, 0.024, 0.01], sensorM, [0, 0, MAZE_BOT.z]))
    const beamM = [0, 1, 2].map(() => glowMat(B_FIELD, 1))
    const beams = beamM.map((m) => addRod(s.g, m))
    const hits = pointCloud(s.g, 3, 0.008)
    const sc = titledScope(scene, WS.sy, WS.sh, 'left · front · right readings along the route', LABEL, 0, WS.sx, WS.sw)
    const tr = SENSE_COLORS.map((c) => sc.s.trace(c, { samples: 400, radius: 0.05 }))
    const thrLvl = sc.s.level(HEAT)
    const cursor = cursorBar(sc.s, LABEL, 0.06)
    const yR = plotY(0, WS.top, WS.sh)
    sc.lo.set('start', GREY)
    sc.hi.set(`${wsCells.length - 1} cells · 0 … ${WS.top} mm`, GREY)
    addLabel(scene, 'At the read point of the last cell', [WS.sx - WS.sw / 2, -0.4, 0.2], LABEL, 0.3, 'left')
    const rows = textRows(scene, 4, WS.sx - WS.sw / 2, -1.2, 0.3, 0.7)
    const clock = simClock(WS.slow, WS.hold)
    const st = { key: '', leg: -2, mount: 0 }
    return {
      scene,
      view: BOARD_VIEW,
      frame(dt, p) {
        const q = wsParams(p)
        const key = wsKey(q)
        const r = wsRun(q)
        const total = r.drive.poses.length
        const i = Math.floor(clock(dt, key, total - 1))
        if (q.mount !== st.mount) {
          st.mount = q.mount
          ;[0, 1, 2].forEach((k) => {
            const sp = k === 1 ? MAZE_BOT.front : MAZE_BOT.sides[q.mount]
            chips[k].position.set(sp.x, k === 0 ? sp.y : k === 2 ? -sp.y : 0, MAZE_BOT.z)
            chips[k].rotation.z = k === 1 ? 0 : (k === 0 ? 1 : -1) * q.mount * DEG
          })
        }
        if (key !== st.key) {
          st.key = key
          st.leg = -2
          const u = r.samples.map((_, k) => k / (total - 1))
          tr.forEach((t, k) => t.points(u, r.samples.map((x) => yR(Math.min(x[k], WS.top))), null))
          thrLvl.set(yR(q.thr))
        }
        const pose = skewPose(r.drive.poses[i], q.off, q.err * DEG)
        s.bot.set(pose, r.drive.dL[i], r.drive.dR[i])
        const leg = r.drive.leg[i]
        s.trail(pts, leg)
        const reads = r.samples[i]
        reads.forEach((mm, k) => {
          const ray = sensorRay(pose, k, q.mount)
          const d = rayDir(ray.th)
          const len = Math.min(mm, 400) / 1000
          const end: V3 = [ray.at[0] + d[0] * len, ray.at[1] + d[1] * len, MAZE_BOT.z]
          stretchRod(beams[k], [ray.at[0], ray.at[1], MAZE_BOT.z], end, 0.004)
          const c = mm < q.thr ? HEAT : B_FIELD
          beamM[k].color.set(c)
          beamM[k].emissive.set(c)
          hits.set(k, end, c, 1)
        })
        hits.show(3)
        cursor(i / (total - 1))

        const nDone = i === total - 1 ? r.legs.length : Math.max(0, leg - 1)
        if (nDone !== st.leg) {
          st.leg = nDone
          const done = r.legs.slice(0, nDone)
          const verdict = new Map<string, boolean>()
          for (const l of done) [3, 0, 1].forEach((t, k) => verdict.set(`${l.cell}|${(l.dir + t) % 4}`, l.seen[k] === l.truth[k]))
          const read = (c: number, d: number) => verdict.get(`${c}|${d}`) ?? verdictFromNeighbour(verdict, c, d)
          s.mz.walls((c, d) => {
            const v = read(c, d)
            if (wallAt(wsMaze, c, d)) return v === undefined ? C.ghost : v ? C.wall : HIGH_V
            return v === false ? HIGH_V : null
          })
          const badCells = new Set(done.filter((l) => l.seen.some((v, k) => v !== l.truth[k])).map((l) => l.cell))
          const seenCells = new Set(done.map((l) => l.cell))
          s.mz.tiles((c) => (badCells.has(c) ? C.bad : seenCells.has(c) ? C.seen : null))
          const last = done[done.length - 1]
          if (last)
            last.reads.forEach((mm, k) => {
              const ok = last.seen[k] === last.truth[k]
              rows[k].set(`${SLOT_NAMES[k].padEnd(5)} ${mm >= VL53L0X.outOfRange ? 'no return' : `${mm} mm`} → ${last.seen[k] ? 'wall' : 'open'}${ok ? '' : `, but it is ${last.truth[k] ? 'a wall' : 'open'}`}`, ok ? SENSE_COLORS[k] : HIGH_V)
            })
          else [0, 1, 2].forEach((k) => rows[k].set(`${SLOT_NAMES[k]}: start cell, walls known by the rules`, GREY))
          const wrong = done.reduce((a, l) => a + l.seen.filter((v, k) => v !== l.truth[k]).length, 0)
          rows[3].set(`${done.length - badCells.size} of ${done.length} cells read right · ${wrong} wrong wall${wrong === 1 ? '' : 's'}`, wrong ? HIGH_V : POWER)
          s.status.set(`${q.mount === 90 ? MOUNTS.out : MOUNTS.angled} · ${nDone} of ${r.legs.length} cells read`, LABEL)
          s.sub.set(`left-hand wall follower drives · ${mmText(q.off)} off centre, ${q.err}° skew · about 2 × real speed`, GREY)
        }
      },
      readouts: (p) => {
        const r = wsRun(wsParams(p))
        return [
          { label: 'Cells read right', value: `${r.right} of ${r.legs.length}`, tone: toneOf(r.wrong === 0, r.wrong <= 2) },
          { label: 'Wrong walls', value: `${r.wrong}`, tone: r.wrong ? 'bad' : 'ok' },
          { label: 'Closest reading to the threshold', value: `${Math.round(r.margin)} mm`, tone: toneOf(r.margin > 30, r.margin > 10) },
          { label: 'Offset from (R − L)/2', value: r.centre === null ? '—' : mmText(r.centre) },
        ]
      },
    }
  },
}
/** A wall is read from both of its cells; take whichever side has been read. */
function verdictFromNeighbour(v: Map<string, boolean>, c: number, d: number) {
  const b = c + [N, 1, -N, -1][d]
  return v.get(`${b}|${(d + 2) % 4}`)
}

// --- Flood fill on the car: per-cell loop, its time budget, and the fast run on merged straights. ---

const KINDS = { perfect: 'Perfect maze', loops: 'With loops', island: 'Goal on an island' }
type Kind = keyof typeof KINDS
const mazeOf = (kind: Kind, seed: number) => genMaze(N, N, seed, kind === 'perfect' ? {} : kind === 'loops' ? { loops: 6 } : { island: true, loops: 4 })
const TRIPS = { off: 'Search only', on: 'Search + explore back' }
const ffParams = (p: Params) => ({ kind: pick(KINDS, p.maze, 'island') as Kind, seed: n(p, 'seed'), trip: pick(TRIPS, p.trip, 'on') as keyof typeof TRIPS, v: n(p, 'speed') })
type FfQ = ReturnType<typeof ffParams>
const ffKey = (q: FfQ) => `${q.kind}|${q.seed}|${q.trip}|${q.v}`
const ffRun = memoBy(ffKey, (q: FfQ) => {
  const m = mazeOf(q.kind, q.seed)
  const goal = centreGoal(m)
  const r = mouseTimeline(m, goal, q.trip === 'on', q.v)
  const explore = r.run.steps.slice(0, r.nExplore).map((x) => x.cell)
  const fast = r.run.steps.slice(r.nExplore).map((x) => x.cell)
  return { m, goal, r, explore, fast }
})
/** Screen seconds per real second: exploring sped up, the fast run closer to real time. */
const PLAY = { explore: 8, fast: 2, hold: 3 }
const DRIVE_S = (cells: number) => fixedText(cells * MAZE.cellM, 2)
const LOOP = (v: number) => [
  '// search: one pass per cell',
  'readWalls();   // 3 × VL53L0X, 33 ms',
  `floodFill();   // ${N * N} cells, ${Math.round(floodUs(N * N))} µs`,
  'turnTo(lowest());  // spin on the spot',
  `driveTicks(${cellTicks()});  // 25 cm, stop`,
  '// fast run: seen walls only',
  `driveStraight(n);  // up to ${fixedText(v, 1)} m/s`,
]
const LINE_OF = { sense: 1, turn: 3, drive: 4 }
const FF = { lx: 1.6, ly: 5.6, lw: 12, bx: 4.8, by: -1.6, bw: 6.4 }

export const mazeSolverFloodFill: Lesson = {
  id: 'maze-solver-flood-fill',
  title: 'Flood fill',
  tagline: 'The micromouse loop on the car: sense, re-flood, spin and drive one cell at a time, then race the route it trusts',
  formula: (p) => {
    const q = ffParams(p)
    const { r } = ffRun(q)
    return `search cell = ${MOUSE_DRIVE.senseS * 1000} ms sense + ${Math.round(floodUs(N * N))} µs flood + spin + ${secsText(r.segs.find((s) => s.kind === 'drive')!.T)} stop-to-stop · fast run: ${r.straights} straights, a = ${MOUSE_DRIVE.accel} m/s², v ≤ min(${fixedText(q.v, 1)}, √(d·a)) → ${secsText(r.fastS)}`
  },
  legend: [
    { color: C.wall, label: 'Wall the car has seen (grey: not yet)', shape: 'dot' },
    { color: HEAT, label: 'Goal: the 2 × 2 centre', shape: 'dot' },
    { color: C.seen, label: 'Visited while exploring', shape: 'dot' },
    { color: C.path, label: 'Fast run', shape: 'dot' },
  ],
  points: [
    'On the car the micromouse loop runs once per cell: read the three wall sensors (Wall sensing), set those walls in the map on both sides, flood fill the map with unseen walls taken as open, pick the lowest neighbour, spin to face it and drive one cell on the encoders, then stop. The reasoning is in Navigation › Maze solving › Micromouse.',
    `The map is tiny: one byte per cell (4 wall bits + 4 "seen" bits) plus a 16-bit distance, ${mapBytes(N, N)} bytes here, ${mapBytes(16, 16)} for a full 16 × 16 maze. Re-flooding all ${N * N} cells takes about ${Math.round(floodUs(N * N))} µs on an ESP32, nothing next to the 33 ms ToF reading and the ${secsText(1.25)} drive. Stopping in every cell is what costs the time, not the thinking.`,
    'Search drives slowly, from a stop to a stop, so the sensors read each cell cleanly and the wheels never slip off the encoder count. A 25 cm hop at 0.25 m/s and 1 m/s² takes 1.25 s. Exploring back to the start costs more time, but it often turns up a shorter route.',
    'The fast run trusts only walls it has seen and merges each straight into one move: accelerate at 1 m/s², cruise, brake, and spin only at corners. More top speed only pays on long straights: a one-cell hop peaks at √(0.25 × 1) = 0.5 m/s whatever the limit. Real mice go further with curved turns and diagonals (Navigation › Path tracking).',
  ],
  controls: [
    { kind: 'choice', key: 'maze', options: opts(KINDS), initial: 'island' },
    { kind: 'slider', key: 'seed', label: 'Maze seed', min: 1, max: 30, step: 1, initial: 5, format: (v) => `#${v}` },
    { kind: 'choice', key: 'trip', options: opts(TRIPS), initial: 'on' },
    { kind: 'slider', key: 'speed', label: 'Fast-run top speed', min: 0.3, max: 1, step: 0.1, initial: 0.6, format: (v) => `${v.toFixed(1)} m/s` },
  ],
  build(): Stage {
    const { scene, ...s } = mazeStage()
    addLabel(scene, 'Firmware loop', [FF.lx, FF.ly + 1.1, 0.3], LABEL, 0.36, 'left')
    const code = codeListing(scene, [FF.lx, FF.ly, 0.3], 7, FF.lw, 0.3)
    addLabel(scene, 'Time per phase', [FF.lx, FF.by + 1.1, 0.3], LABEL, 0.36, 'left')
    const bars = countBars(scene, [FF.bx, FF.by, 0.2], ['search', 'explore back', 'fast run'], FF.bw)
    const rows = textRows(scene, 2, FF.lx, FF.by - 2.3, 0.3, 0.7)
    const st = { key: '', t: 0, step: -1, line: -1 }
    return {
      scene,
      view: BOARD_VIEW,
      frame(dt, p) {
        const q = ffParams(p)
        const key = ffKey(q)
        const R = ffRun(q)
        const { r, m } = R
        const screenT = r.exploreS / PLAY.explore + r.fastS / PLAY.fast
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, step: -1, line: -1 })
          bars.set([r.searchS, r.backS, r.fastS], [secsText(r.searchS), r.backS ? secsText(r.backS) : 'skipped', secsText(r.fastS)], [LABEL, RING, POWER])
          rows[0].set(`fast run ${secsText(r.fastS)} · cell by cell ${secsText(r.crawlS)}`, POWER)
          rows[1].set(`${r.straights} straights · ${r.turns} spins in all · shortest ${r.run.best} cells`, GREY)
        }
        st.t += dt
        if (st.t > screenT + PLAY.hold) st.t = 0
        const ts = Math.min(st.t, screenT)
        const t = ts < r.exploreS / PLAY.explore ? ts * PLAY.explore : r.exploreS + (ts - r.exploreS / PLAY.explore) * PLAY.fast
        const at = mouseAt(m, r.segs, t)
        const seg = r.segs[at.seg]
        s.bot.set(at.pose, at.dL, at.dR)
        const inFast = seg.phase === 'fast'
        if (inFast) s.trail(cellPts(m, R.fast), R.fast.indexOf(seg.from) + 1)
        else s.trail(cellPts(m, R.explore), seg.step + 1)
        const line = inFast ? (seg.kind === 'turn' ? 3 : 6) : LINE_OF[seg.kind]
        if (line !== st.line) {
          st.line = line
          code.set(LOOP(q.v), line, commentTint)
        }
        if (seg.step === st.step) return
        st.step = seg.step
        const x = r.run.steps[seg.step]
        s.mz.walls((c, d) => (!wallAt(m, c, d) ? null : x.seen[4 * c + d] ? C.wall : C.ghost))
        const visited = new Set(r.run.steps.slice(0, Math.min(seg.step, R.explore.length - 1) + 1).map((y) => y.cell))
        const fastCells = new Set(inFast ? R.fast.slice(0, R.fast.indexOf(seg.from) + 1) : [])
        s.mz.tiles((c) => (R.goal.includes(c) ? C.goal : fastCells.has(c) ? C.path : visited.has(c) ? C.seen : null))
        s.mz.numbers(
          (c) => (x.dist[c] >= 0 ? `${x.dist[c]}` : ''),
          (c) => (c === x.cell ? RING : visited.has(c) ? LABEL : GREY),
        )
        const phase = x.phase === 'search' ? `Search · cell ${seg.step}` : x.phase === 'return' ? `Exploring back · cell ${seg.step - r.run.search}` : `Fast run · ${R.fast.indexOf(seg.from)} of ${r.run.fast} cells`
        s.status.set(`${phase} · ${secsText(t)}`, x.phase === 'fast' ? POWER : x.phase === 'return' ? RING : LABEL)
        s.sub.set(`${KINDS[q.kind]} · exploring shown ${PLAY.explore} × real speed, fast run ${PLAY.fast} × · ${DRIVE_S(r.run.fast)} m route`, GREY)
      },
      readouts: (p) => {
        const { r } = ffRun(ffParams(p))
        const gain = r.crawlS / r.fastS
        return [
          { label: 'Search', value: `${secsText(r.searchS)} (${r.run.search} cells)` },
          { label: 'Explore back', value: r.backS ? `${secsText(r.backS)} (${r.run.back} cells)` : 'skipped' },
          { label: 'Fast run', value: `${secsText(r.fastS)} (${r.run.fast} / ${r.run.best} cells)`, tone: r.run.fast === r.run.best ? 'ok' : 'warn' },
          { label: 'vs the same route cell by cell', value: `${fixedText(gain, 1)} × faster`, tone: toneOf(gain > 2, gain > 1.4) },
        ]
      },
    }
  },
}
