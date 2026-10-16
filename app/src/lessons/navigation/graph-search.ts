import * as THREE from 'three/webgpu'
import {
  Conn,
  FLAT,
  GRID_MAP,
  GRID_ROOMS,
  GridMap,
  GridRoom,
  Heur,
  SURPRISES,
  SearchAlgo,
  Surprise,
  XY,
  alongPath,
  cellAtM,
  dstarLiteRun,
  gridSearch,
  pathLength,
  roomGridMap,
  searchAt,
  withSolids,
} from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, chordPath, countBars, diffBot, floorView, liveLabel, mazeModel, memoBy, simClock } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const RES = GRID_MAP.res
const GV = { at: [-16.6, -6.6, 0] as V3, k: 4.6, tilt: -0.5, slow: 0.07, hold: 3, stepM: 0.02 }
const W = 16
const H = 12
const TOP = GV.at[1] + H * RES * GV.k * Math.cos(GV.tilt)
const VIEW = { center: [-2.2, 2, 0] as V3, radius: 54, polar: Math.PI / 2, azimuth: 0 }
const RP = { x: 6.6, y: 3.4, row: 0.95, left: 2.6 }
const C = { block: '#aeb3bd', ghost: '#8a5a66', open: '#6b5a1c', closed: '#1f3d47', path: '#1f5a3c', start: '#27477a', goal: '#6b4322', pen: '#3b2a24', floor: '#23262d' }
const MAPS = { flat: 'Two rooms', trap: 'Cup-shaped trap' }
const MOVES = { '4': '4-connected', '8': '8-connected' }
const MAP = (initial: GridRoom) => ({ kind: 'choice' as const, key: 'map', options: opts(MAPS), initial })
const MOVE = { kind: 'choice' as const, key: 'moves', options: opts(MOVES), initial: '8' }
const GRID_LEGEND = [
  { color: C.block, label: 'Blocked cell (25 cm grid)', shape: 'dot' as const },
  { color: C.open, label: 'Open set: found, waiting', shape: 'dot' as const },
  { color: C.closed, label: 'Closed set: expanded', shape: 'dot' as const },
  { color: RING, label: 'Route', shape: 'dot' as const },
]
const penShade = (() => {
  const a = new THREE.Color(C.floor)
  const b = new THREE.Color(C.pen)
  const cache = new Map<number, string>()
  return (p: number) => cache.get(p) ?? (cache.set(p, `#${a.clone().lerp(b, p / 20).getHexString()}`), cache.get(p)!)
})()

/** Grid map on a tilted floor, route, robot, header lines and a side panel. */
function gridStage(scene: THREE.Scene, title: string, bars: string[], rows: number) {
  const g = floorView(scene, GV.at, GV.k, GV.tilt)
  const mz = mazeModel(g, W, H, { cellM: RES, wallM: 0.01, numberSize: 0.062, posts: false })
  mz.walls(() => null)
  const route = chordPath(g, W * H, RING, 0.012, 0.012)
  const bot = diffBot(g)
  const status = liveLabel(scene, [GV.at[0], TOP + 1.7, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [GV.at[0], TOP + 0.9, 0.3], { size: 0.3, color: GREY, align: 'left' })
  addLabel(scene, title, [RP.left, RP.y + 1.1, 0.3], LABEL, 0.4, 'left')
  const meter = countBars(scene, [RP.x, RP.y, 0.3], bars, 3.4, { row: 0.7 })
  const y0 = RP.y - bars.length * 0.7 - 0.5
  const lines = Array.from({ length: rows }, (_, k) => liveLabel(scene, [RP.left, y0 - k * RP.row, 0.3], { size: 0.32, align: 'left' }))
  const xy = (c: number) => {
    const [x, y] = mz.centre(c)
    return { x, y }
  }
  const st = { cells: null as number[] | null, pts: [] as XY[] }
  return {
    mz,
    status,
    sub,
    lines,
    meter,
    xy,
    /** Route through `cells`; the robot `s` metres along it. */
    drive(cells: number[], s: number, show = cells.length) {
      if (cells !== st.cells) {
        st.cells = cells
        st.pts = cells.map((c) => {
          const p = xy(c)
          return [p.x, p.y] as XY
        })
      }
      route(st.pts.map(([x, y]) => ({ x, y })), show)
      if (!st.pts.length) return
      const a = alongPath(st.pts, s)
      bot.set({ x: a.at[0], y: a.at[1], th: a.dir }, s / 0.033, s / 0.033)
    },
    hideRoute: () => route([], 0),
  }
}
const ends = (m: GridMap) => [cellAtM(m, ...GRID_MAP.start), cellAtM(m, ...GRID_MAP.goal)] as const
const baseTile = (m: GridMap, start: number, goal: number) => (c: number) => (c === start ? C.start : c === goal ? C.goal : m.blocked[c] ? C.block : m.pen[c] ? penShade(m.pen[c]) : null)
const mapOf = memoBy((k: string) => k, (k: string) => {
  const [room, clear] = k.split('|')
  return roomGridMap(GRID_ROOMS[room as GridRoom], RES, clear === '1')
})
const cost10 = (v: number) => (Number.isFinite(v) ? `${(v / 10).toFixed(1)}` : '∞')

/** Shared animation: expand step by step, then drive the route. */
function searchAnim(
  s: ReturnType<typeof gridStage>,
  clock: ReturnType<typeof simClock>,
  dt: number,
  key: string,
  run: { m: GridMap; r: ReturnType<typeof gridSearch>; start: number; goal: number; home: number[]; len: number },
  textOf: (k: number, v: { g: Float64Array; f: Float64Array }, c: number) => string,
  st: { key: string; k: number },
) {
  const { m, r } = run
  const nExp = r.order.length
  const driveTicks = Math.ceil(run.len / GV.stepM)
  const t = clock(dt, key, nExp + driveTicks)
  const k = Math.min(nExp, Math.floor(t))
  const driving = t >= nExp
  s.drive(driving ? r.path : run.home, driving ? (t - nExp) * GV.stepM : 0)
  const show = driving ? nExp + 1 : k
  if (key === st.key && show === st.k) return { k, driving, changed: false }
  Object.assign(st, { key, k: show })
  const v = searchAt(r, m.w * m.h, k)
  const onPath = new Set(driving ? r.path : [])
  const base = baseTile(m, run.start, run.goal)
  const current = r.order[k] ?? -1
  s.mz.tiles((c) => (c === run.start || c === run.goal ? base(c) : onPath.has(c) ? C.path : v.closed[c] ? C.closed : !Number.isNaN(v.g[c]) ? C.open : base(c)))
  s.mz.numbers(
    (c) => (Number.isNaN(v.g[c]) ? '' : textOf(k, v, c)),
    (c) => (c === current && !driving ? HEAT : onPath.has(c) ? POWER : v.closed[c] ? LABEL : RING),
  )
  return { k, driving, changed: true }
}

// --- Grid maps: a room becomes cells; BFS counts steps, Dijkstra counts cost. ---

const ALGOS = { bfs: 'Breadth-first (BFS)', dijkstra: 'Dijkstra' }
const CLEAR = { off: 'No clearance cost', on: 'Clearance cost near walls' }
const gmParams = (p: Params) => ({
  algo: pick(ALGOS, p.algo, 'dijkstra') as 'bfs' | 'dijkstra',
  conn: Number(pick(MOVES, p.moves, '8')) as Conn,
  clear: pick(CLEAR, p.clear, 'on') as keyof typeof CLEAR,
  map: pick(MAPS, p.map, 'flat') as GridRoom,
})
type GmQ = ReturnType<typeof gmParams>
const gmKey = (q: GmQ) => `${q.algo}|${q.conn}|${q.clear}|${q.map}`
const gmRun = memoBy(gmKey, (q: GmQ) => {
  const m = mapOf(`${q.map}|${q.clear === 'on' ? 1 : 0}`)
  const [start, goal] = ends(m)
  const both = (['bfs', 'dijkstra'] as const).map((algo) => gridSearch(m, start, goal, { algo, conn: q.conn }))
  const r = both[q.algo === 'bfs' ? 0 : 1]
  return { m, r, both, start, goal, home: [start], len: pathLength(r.path.map((c) => [((c % m.w) + 0.5) * RES, (Math.floor(c / m.w) + 0.5) * RES] as XY)) }
})

export const graphSearchGridMaps: Lesson = {
  id: 'graph-search-grid-maps',
  title: 'Grid maps',
  tagline: 'Chop the floor into cells and every cell becomes a node: search spreads out from the start until it touches the goal',
  formula: (p) => {
    const q = gmParams(p)
    return q.algo === 'bfs'
      ? 'BFS: first in, first out · every move counts as 1 step · fewest moves, blind to cost'
      : `Dijkstra: always expand the open cell with the lowest g · g(next) = g + step (1.0 straight, 1.4 diagonal)${q.clear === 'on' ? ' + clearance cost' : ''}`
  },
  legend: [...GRID_LEGEND, { color: C.pen, label: 'Clearance cost: darker = closer to an obstacle', shape: 'dot' }],
  points: [
    'A planner cannot search a room, only a graph. The usual trick is a grid: cut the floor into cells (25 cm here), mark a cell blocked if anything sits in it, and connect each free cell to its 4 or 8 neighbours. The occupancy grid from Perception › Occupancy grids is exactly this map.',
    'Breadth-first search keeps a queue. It expands the start, then every cell 1 move away, then 2, a ring at a time, the same wave as Maze solving › Flood fill. It finds the route with the fewest moves, but with 8 neighbours a diagonal move (1.41 cells) counts the same as a straight one.',
    'Dijkstra keeps a priority queue (a binary heap) ordered by g, the cheapest cost found so far from the start. The cell it pops is final, so its number never changes again. Steps cost 1.0 straight and 1.4 diagonal (stored as integers 10 and 14), and any extra cost per cell is respected.',
    'Clearance: inflate the obstacles like a Nav2 costmap, adding cost near walls. BFS ignores it and shaves corners; Dijkstra pays a few cells extra to stay in the middle of gaps. Both expand nearly every reachable cell before they reach the goal: the A* heuristic (next) fixes that.',
  ],
  controls: [
    { kind: 'choice', key: 'algo', options: opts(ALGOS), initial: 'dijkstra' },
    MOVE,
    { kind: 'choice', key: 'clear', options: opts(CLEAR), initial: 'on' },
    MAP('flat'),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = gridStage(scene, 'Same map, both searches', ['BFS expanded', 'Dijkstra expanded', 'BFS cost', 'Dijkstra cost'], 3)
    const clock = simClock(GV.slow, GV.hold)
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = gmParams(p)
        const key = gmKey(q)
        const R = gmRun(q)
        const a = searchAnim(s, clock, dt, key, R, (_k, v, c) => (q.algo === 'bfs' ? `${v.g[c]}` : cost10(v.g[c])), st)
        if (!a.changed) return
        const [b, d] = R.both
        s.meter.set(
          [b.order.length, d.order.length, b.cost / 2, d.cost / 2],
          [`${b.order.length}`, `${d.order.length}`, cost10(b.cost), cost10(d.cost)],
          [q.algo === 'bfs' ? RING : GREY, q.algo === 'dijkstra' ? RING : GREY, b.cost > d.cost ? HIGH_V : POWER, POWER],
        )
        const nOpen = R.r.events.filter((e) => e.step <= a.k).length - a.k
        s.lines[0].set(q.algo === 'bfs' ? '1. pop the oldest cell in the queue' : '1. pop the open cell with the lowest g', a.driving ? GREY : HEAT)
        s.lines[1].set(q.algo === 'bfs' ? '2. unseen neighbours: steps + 1, queue' : '2. cheaper way to a neighbour? update g', a.driving ? GREY : LABEL)
        s.lines[2].set(a.driving ? `route ${R.r.path.length - 1} moves, ${R.len.toFixed(2)} m` : `${a.k} expanded · ${Math.max(0, nOpen)} open`, GREY)
        s.status.set(a.driving ? `${ALGOS[q.algo]} · route found, driving` : `${ALGOS[q.algo]} · expanding ${a.k} of ${R.r.order.length}`, a.driving ? POWER : LABEL)
        s.sub.set(`${MAPS[q.map]} · ${MOVES[String(q.conn) as '4' | '8']} · numbers: ${q.algo === 'bfs' ? 'moves from the start' : 'g, cost from the start in cells'}`)
      },
      readouts: (p) => {
        const R = gmRun(gmParams(p))
        const [b, d] = R.both
        return [
          { label: 'Cells expanded', value: `${R.r.order.length} of ${R.m.blocked.filter((x) => !x).length}` },
          { label: 'Route', value: `${R.r.path.length - 1} moves · ${R.len.toFixed(2)} m` },
          { label: 'Route cost', value: cost10(R.r.cost), tone: R.r.cost > d.cost ? 'warn' : 'ok' },
          { label: 'BFS vs Dijkstra cost', value: `${cost10(b.cost)} vs ${cost10(d.cost)}` },
        ]
      },
    }
  },
}

// --- A* heuristic: f = g + w·h; admissible h keeps it optimal, a good h expands far less. ---

const HEURS = { dijkstra: 'h = 0 (Dijkstra)', manhattan: 'Manhattan', euclid: 'Euclidean', octile: 'Octile', greedy: 'Greedy (h only)' }
type HeurKey = keyof typeof HEURS
const HEUR_KEYS = Object.keys(HEURS) as HeurKey[]
const H_TEXT: Record<HeurKey, string> = {
  dijkstra: 'h = 0',
  manhattan: 'h = |dx| + |dy|',
  euclid: 'h = √(dx² + dy²)',
  octile: 'h = max + 0.4·min',
  greedy: 'f = h (octile)',
}
const ahParams = (p: Params) => ({ heur: pick(HEURS, p.heur, 'octile') as HeurKey, w: n(p, 'w'), conn: Number(pick(MOVES, p.moves, '8')) as Conn, map: pick(MAPS, p.map, 'trap') as GridRoom })
type AhQ = ReturnType<typeof ahParams>
const ahKey = (q: AhQ) => `${q.heur}|${q.w}|${q.conn}|${q.map}`
const searchFor = (m: GridMap, start: number, goal: number, h: HeurKey, w: number, conn: Conn) => {
  const algo: SearchAlgo = h === 'dijkstra' ? 'dijkstra' : h === 'greedy' ? 'greedy' : 'astar'
  return gridSearch(m, start, goal, { algo, conn, heur: (h === 'greedy' || h === 'dijkstra' ? 'octile' : h) as Heur, weight: w })
}
const ahRun = memoBy(ahKey, (q: AhQ) => {
  const m = mapOf(`${q.map}|1`)
  const [start, goal] = ends(m)
  const all = HEUR_KEYS.map((h) => searchFor(m, start, goal, h, q.w, q.conn))
  const best = gridSearch(m, start, goal, { algo: 'dijkstra', conn: q.conn }).cost
  const r = all[HEUR_KEYS.indexOf(q.heur)]
  return { m, r, all, best, start, goal, home: [start], len: pathLength(r.path.map((c) => [(c % m.w) * RES, Math.floor(c / m.w) * RES] as XY)) }
})
const over = (cost: number, best: number) => Math.round((cost / best - 1) * 100)

export const graphSearchAHeuristic: Lesson = {
  id: 'graph-search-a-heuristic',
  title: 'A* heuristic',
  tagline: 'Add a guess of the distance still to go: A* heads for the goal, and as long as the guess never overestimates it still finds the cheapest route',
  formula: (p) => {
    const q = ahParams(p)
    return q.heur === 'greedy' ? 'greedy best-first: f = h · ignores the cost already paid' : `f = g + ${q.w === 1 ? '' : `${q.w}·`}h · ${H_TEXT[q.heur]} · admissible if h ≤ true cost to go`
  },
  legend: [...GRID_LEGEND, { color: C.pen, label: 'Clearance cost near obstacles', shape: 'dot' }],
  points: [
    'Dijkstra spreads in every direction because it only knows g, the cost so far. A* (Hart, Nilsson, Raphael, 1968) adds h, an estimate of the cost from a cell to the goal, and pops the cell with the lowest f = g + h. Numbers on the cells here are f.',
    'If h never overestimates (admissible), A* still returns the cheapest route. On a 4-connected grid Manhattan distance is the exact free-space cost; on an 8-connected grid octile distance is (max + 0.4·min), Euclidean is a little low, and Manhattan overestimates diagonals, so it can return a worse route.',
    'The closer h is to the truth, the fewer cells A* expands; h = 0 is Dijkstra. Greedy best-first uses only h: it rushes at the goal, runs into the cup in the trap map and can settle for a costly route hugging the walls.',
    'Weighted A* multiplies h by w > 1: fewer expansions, route at most w times the best. Nav2 and ROS move_base plan on costmaps like this (A* or Dijkstra over cells); a microcontroller can run it on a few hundred cells in milliseconds.',
  ],
  controls: [
    { kind: 'choice', key: 'heur', options: opts(HEURS), initial: 'octile' },
    { kind: 'slider', key: 'w', label: 'Weight w on h', min: 1, max: 4, step: 0.5, initial: 1, format: (v: number) => `× ${v}` },
    MOVE,
    MAP('trap'),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = gridStage(scene, 'Cells expanded (route cost vs best)', HEUR_KEYS.map((h) => (h === 'dijkstra' ? 'Dijkstra' : h === 'greedy' ? 'Greedy' : `A* ${HEURS[h]}`)), 2)
    const clock = simClock(GV.slow, GV.hold)
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ahParams(p)
        const key = ahKey(q)
        const R = ahRun(q)
        const a = searchAnim(s, clock, dt, key, R, (_k, v, c) => cost10(v.f[c]), st)
        if (!a.changed) return
        s.meter.set(
          R.all.map((r) => r.order.length),
          R.all.map((r) => `${r.order.length} · ${over(r.cost, R.best) ? `+${over(r.cost, R.best)} %` : 'best'}`),
          R.all.map((r, j) => (HEUR_KEYS[j] === q.heur ? RING : r.cost > R.best ? HIGH_V : GREY)),
        )
        s.lines[0].set(`pop lowest f = g + ${q.w === 1 ? '' : `${q.w}·`}h · ${H_TEXT[q.heur]}`, a.driving ? GREY : HEAT)
        s.lines[1].set(a.driving ? `route cost ${cost10(R.r.cost)} · best ${cost10(R.best)}` : `${a.k} expanded`, GREY)
        const ok = R.r.cost <= R.best
        s.status.set(a.driving ? `${HEURS[q.heur]} · ${ok ? 'cheapest route' : `route ${over(R.r.cost, R.best)} % dearer than the best`}` : `${HEURS[q.heur]} · expanding ${a.k} of ${R.r.order.length}`, a.driving ? (ok ? POWER : HIGH_V) : LABEL)
        s.sub.set(`${MAPS[q.map]} · ${MOVES[String(q.conn) as '4' | '8']} · numbers: f in cells (1.0 straight, 1.4 diagonal)`)
      },
      readouts: (p) => {
        const R = ahRun(ahParams(p))
        const d = R.all[0].order.length
        return [
          { label: 'Cells expanded', value: `${R.r.order.length}`, tone: R.r.order.length < d ? 'ok' : undefined },
          { label: 'vs Dijkstra', value: `${Math.round((100 * R.r.order.length) / d)} %` },
          { label: 'Route cost / best', value: `${cost10(R.r.cost)} / ${cost10(R.best)}`, tone: R.r.cost > R.best ? 'warn' : 'ok' },
          { label: 'Route', value: `${R.r.path.length - 1} moves` },
        ]
      },
    }
  },
}

// --- D* Lite: plan from the goal back, then repair only what newly seen cells change. ---

const SURP = { gap: 'Narrow gap shut', clutter: 'Boxes on the floor', both: 'Gap shut + crate in the door' }
const dsParams = (p: Params) => ({ surprise: pick(SURP, p.surprise, 'clutter') as Surprise, range: n(p, 'range') })
type DsQ = ReturnType<typeof dsParams>
const dsKey = (q: DsQ) => `${q.surprise}|${q.range}`
const MOVE_TICKS = 12
const dsRun = memoBy(dsKey, (q: DsQ) => {
  const known = mapOf('flat|0')
  const truth = roomGridMap(withSolids(FLAT, SURPRISES[q.surprise]), RES)
  const [start, goal] = ends(known)
  const fr = dstarLiteRun(truth, known, start, goal, q.range)
  const sumD = fr.map((_, i) => fr.slice(0, i + 1).reduce((t, f) => t + f.dstar, 0))
  const sumA = fr.map((_, i) => fr.slice(0, i + 1).reduce((t, f) => t + f.astar, 0))
  return { known, truth, fr, start, goal, sumD, sumA, replans: fr.slice(1).filter((f) => f.seen.length).length }
})

export const graphSearchDLite: Lesson = {
  id: 'graph-search-d-lite',
  title: 'D* Lite',
  tagline: 'The map was wrong: instead of planning again from scratch, D* Lite fixes only the costs that the new obstacle changed',
  formula: 'search goal → robot · g = cost to goal · rhs = min(step + g of a neighbour) · g ≠ rhs → queue · repair until the robot is consistent',
  legend: [
    { color: C.block, label: 'Blocked on the saved map', shape: 'dot' },
    { color: C.ghost, label: 'Not on the map: found by the sensor', shape: 'dot' },
    { color: C.open, label: 'Cells D* Lite touched in its last repair', shape: 'dot' },
    { color: RING, label: 'Current route', shape: 'dot' },
  ],
  points: [
    'A robot plans on the map it has, then its sensor sees a box that was not there. Plain A* would throw everything away and search again from the robot. On a big map, every few centimetres, that adds up. D* Lite (Koenig and Likhachev, 2002) keeps its numbers and repairs them.',
    'It searches backwards, from the goal to the robot, so g in each cell is the cost to the goal and the cells near the goal stay valid as the robot moves. Each cell also keeps rhs, the best one-step look-ahead: min over neighbours of step + g. A cell whose g and rhs disagree goes on a priority queue.',
    'When the sensor flips a cell to blocked, only that cell and its neighbours get a new rhs. The repair spreads only as far as costs really change, then stops as soon as the robot\'s own cell is consistent. Numbers here are g, cost to the goal in cells; blank cells were never needed.',
    'Small surprises are cheap to repair. Shutting the only short gap changes the cost of every cell on the robot\'s side, so the repair can cost more than a fresh A*. On a map this small A* is quick anyway; the saving grows with map size, which is why Mars rovers and many outdoor robots used the D* family.',
  ],
  controls: [
    { kind: 'choice', key: 'surprise', options: opts(SURP), initial: 'clutter' },
    { kind: 'slider', key: 'range', label: 'Sensor range', min: 1, max: 4, step: 1, initial: 2, format: (v: number) => `${v} cell${v > 1 ? 's' : ''} (${(v * RES * 100).toFixed(0)} cm)` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = gridStage(scene, 'Cells expanded so far', ['D* Lite repairs', 'A* from scratch'], 3)
    const clock = simClock(GV.slow, GV.hold)
    const st = { key: '', i: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = dsParams(p)
        const key = dsKey(q)
        const R = dsRun(q)
        const t = clock(dt, key, (R.fr.length - 1) * MOVE_TICKS)
        const i = Math.min(R.fr.length - 1, Math.floor(t / MOVE_TICKS))
        const f = R.fr[i]
        const nx = R.fr[Math.min(R.fr.length - 1, i + 1)]
        const u = i === R.fr.length - 1 ? 0 : t / MOVE_TICKS - i
        const route = nx.at === f.at ? f.path : [f.at, ...nx.path]
        const legM = Math.hypot(s.xy(nx.at).x - s.xy(f.at).x, s.xy(nx.at).y - s.xy(f.at).y)
        s.drive(route, u * legM)
        if (key === st.key && i === st.i) return
        Object.assign(st, { key, i })
        const touched = new Set(f.touched)
        const base = baseTile(R.known, R.start, R.goal)
        s.mz.tiles((c) => (c === R.start || c === R.goal ? base(c) : f.known[c] ? (R.known.blocked[c] ? C.block : C.ghost) : touched.has(c) ? C.open : R.truth.blocked[c] ? '#30333b' : base(c)))
        s.mz.numbers(
          (c) => (f.known[c] || !Number.isFinite(f.g[c]) ? '' : cost10(f.g[c])),
          (c) => (c === f.at ? HEAT : touched.has(c) ? RING : LABEL),
        )
        s.meter.set([R.sumD[i], R.sumA[i]], undefined, [RING, GREY])
        s.lines[0].set(i === 0 ? 'first plan: goal → robot' : f.seen.length ? `saw ${f.seen.length} new blocked cell${f.seen.length > 1 ? 's' : ''}` : 'nothing new: no work, keep driving', f.seen.length || !i ? HEAT : GREY)
        s.lines[1].set(i === 0 || f.seen.length ? `D* Lite repaired ${f.dstar} · A* would expand ${f.astar}` : 'g of the next cell is still valid', i === 0 || f.seen.length ? LABEL : GREY)
        s.lines[2].set(`re-plans so far ${R.fr.slice(1, i + 1).filter((x) => x.seen.length).length} of ${R.replans}`, GREY)
        const done = i === R.fr.length - 1
        s.status.set(done ? `D* Lite · goal reached · ${R.sumD[i]} vs ${R.sumA[i]} expansions` : `D* Lite · step ${i} · ${cost10(f.g[f.at])} cells to go`, done ? POWER : LABEL)
        s.sub.set(`${SURP[q.surprise]} · sensor sees ${q.range} cell${q.range > 1 ? 's' : ''} around the robot · numbers: g, cost to the goal`)
      },
      readouts: (p) => {
        const R = dsRun(dsParams(p))
        const last = R.fr.length - 1
        return [
          { label: 'Re-plans', value: `${R.replans}` },
          { label: 'D* Lite expansions', value: `${R.sumD[last]}`, tone: R.sumD[last] <= R.sumA[last] ? 'ok' : 'warn' },
          { label: 'A* from scratch', value: `${R.sumA[last]}` },
          { label: 'Moves driven', value: `${last}` },
        ]
      },
    }
  },
}
