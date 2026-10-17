// Graph search on grid maps: BFS / Dijkstra / greedy / A* (heuristics, weight), and D* Lite re-planning.
import { MinHeap } from '../common'
import { Room, walledRoom } from '../room'
import { solidGap } from './avoid'
import { INSCRIBED, LETHAL, cellCentre, inflate, roomGrid } from '../software/costmap'

/** Cells c = y·w + x; `pen` = extra cost to enter a cell (clearance), steps cost 10 straight, 14 diagonal. */
export interface GridMap {
  w: number
  h: number
  res: number
  blocked: Uint8Array
  pen: Uint8Array
}
export type Conn = 4 | 8
export type Heur = 'zero' | 'manhattan' | 'euclid' | 'octile'
export type SearchAlgo = 'bfs' | 'dijkstra' | 'greedy' | 'astar'
const GRID_STEP = 10
const GRID_DIAG = 14
const PEN_MAX = 20

const DX = [0, 1, 0, -1, 1, 1, -1, -1]
const DY = [1, 0, -1, 0, 1, -1, -1, 1]

/** Open neighbours of c with step cost (no corner cutting past blocked cells). */
export function gridNeighbours(m: GridMap, c: number, conn: Conn, blocked = m.blocked): [number, number][] {
  const x = c % m.w
  const y = (c - x) / m.w
  const out: [number, number][] = []
  for (let d = 0; d < conn; d++) {
    const nx = x + DX[d]
    const ny = y + DY[d]
    if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue
    const n = ny * m.w + nx
    if (blocked[n]) continue
    if (d >= 4 && (blocked[y * m.w + nx] || blocked[ny * m.w + x])) continue
    out.push([n, (d < 4 ? GRID_STEP : GRID_DIAG) + m.pen[n]])
  }
  return out
}

export function heuristic(kind: Heur, m: GridMap, a: number, b: number) {
  const dx = Math.abs((a % m.w) - (b % m.w))
  const dy = Math.abs(Math.floor(a / m.w) - Math.floor(b / m.w))
  if (kind === 'manhattan') return GRID_STEP * (dx + dy)
  if (kind === 'euclid') return GRID_STEP * Math.hypot(dx, dy)
  if (kind === 'octile') return GRID_STEP * Math.max(dx, dy) + (GRID_DIAG - GRID_STEP) * Math.min(dx, dy)
  return 0
}

interface SearchOpts {
  algo: SearchAlgo
  conn: Conn
  heur?: Heur
  weight?: number
}
/** One open-set change: at expansion `step`, cell `c` got cost-so-far `g` and priority `f`. */
interface SearchEvent {
  step: number
  c: number
  g: number
  f: number
}
interface SearchRun {
  path: number[]
  cost: number
  order: number[]
  events: SearchEvent[]
  g: Float64Array
}

const pathCost = (m: GridMap, path: number[]) =>
  path.slice(1).reduce((s, c, i) => {
    const a = path[i]
    const diag = a % m.w !== c % m.w && Math.floor(a / m.w) !== Math.floor(c / m.w)
    return s + (diag ? GRID_DIAG : GRID_STEP) + m.pen[c]
  }, 0)

/** BFS (FIFO, step count), Dijkstra (g), greedy (h) or A* (g + w·h); `order` = cells in expansion order. */
export function gridSearch(m: GridMap, start: number, goal: number, o: SearchOpts): SearchRun {
  const N = m.w * m.h
  const g = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)
  const order: number[] = []
  const events: SearchEvent[] = []
  const w = o.weight ?? 1
  const h = (c: number) => (o.algo === 'dijkstra' || o.algo === 'bfs' ? 0 : heuristic(o.heur ?? 'octile', m, c, goal))
  const pri = (c: number) => (o.algo === 'greedy' ? h(c) : o.algo === 'bfs' ? 0 : g[c] + w * h(c))
  let seq = 0
  const heap = new MinHeap<[number, number, number, number]>((a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0)
  const bfsQ: number[] = []
  const add = (c: number) => {
    const f = pri(c)
    events.push({ step: order.length, c, g: g[c], f })
    if (o.algo === 'bfs') bfsQ.push(c)
    else heap.push([f, h(c), seq++, c])
  }
  g[start] = 0
  add(start)
  for (let qi = 0; ; ) {
    let c: number
    if (o.algo === 'bfs') {
      if (qi >= bfsQ.length) break
      c = bfsQ[qi++]
    } else {
      const top = heap.pop()
      if (!top) break
      c = top[3]
    }
    if (closed[c]) continue
    closed[c] = 1
    order.push(c)
    if (c === goal) break
    for (const [n, step] of gridNeighbours(m, c, o.conn)) {
      if (closed[n]) continue
      if (o.algo === 'bfs') {
        if (g[n] < Infinity) continue
        g[n] = g[c] + 1
      } else {
        if (g[c] + step >= g[n]) continue
        g[n] = g[c] + step
      }
      prev[n] = c
      add(n)
    }
  }
  const path: number[] = []
  if (closed[goal]) for (let c = goal; c >= 0; c = prev[c]) path.unshift(c)
  return { path, cost: path.length ? pathCost(m, path) : Infinity, order, events, g }
}

/** Cells drawn at expansion `k`: g/f of every cell seen so far and which are closed. */
export function searchAt(r: SearchRun, N: number, k: number) {
  const g = new Float64Array(N).fill(NaN)
  const f = new Float64Array(N).fill(NaN)
  for (const e of r.events) {
    if (e.step > k) break
    g[e.c] = e.g
    f[e.c] = e.f
  }
  const closed = new Uint8Array(N)
  for (let i = 0; i < Math.min(k, r.order.length); i++) closed[r.order[i]] = 1
  return { g, f, closed }
}

// --- Maps: a room → occupancy cells (+ inflation cost so routes keep clear of walls) ---

const box = (name: string, x: [number, number], y: [number, number]) => ({ kind: 'box' as const, name, x, y, h: 0.3, refl: 0.6 })
/** Two rooms: a narrow gap low down, a wider door up top, a table and two cabinets. */
export const FLAT: Room = walledRoom(3.5, 2.5, 0.35, [
  box('divider', [1.75, 2], [0, 0.25]),
  box('divider', [1.75, 2], [0.75, 1.5]),
  box('divider', [1.75, 2], [2.25, 2.5]),
  box('table', [0.5, 1], [1.5, 2]),
  box('cabinet', [2.5, 3], [0, 0.25]),
  box('cabinet', [3, 3.5], [1.25, 1.5]),
])
/** A cup opening towards the start: straight-for-the-goal searches walk in. */
export const TRAP: Room = walledRoom(3.5, 2.5, 0.35, [box('back', [2, 2.25], [0.5, 2]), box('arm', [1, 2], [1.75, 2]), box('arm', [1, 2], [0.5, 0.75])])
export const GRID_ROOMS = { flat: FLAT, trap: TRAP }
/** What the saved map missed (D* Lite): the robot only finds out when its sensor sees it. */
export const SURPRISES = {
  gap: [box('shut', [1.75, 2], [0.25, 0.75])],
  clutter: [box('chair', [1, 1.25], [0.75, 1]), box('boxes', [2.25, 2.5], [0.5, 1.25]), box('bin', [2.75, 3], [0.75, 1])],
  both: [box('shut', [1.75, 2], [0.25, 0.75]), box('crate', [2, 2.25], [1.75, 2])],
}
export type Surprise = keyof typeof SURPRISES
export const withSolids = (room: Room, extra: Room['solids']): Room => ({ ...room, solids: [...room.solids, ...extra] })
export type GridRoom = keyof typeof GRID_ROOMS
export const GRID_MAP = { res: 0.25, radius: 0.75, k: 2.5, start: [0.375, 1.125] as [number, number], goal: [3.125, 0.875] as [number, number] }

/** Room at `res` m per cell (plus a ring for the walls); `clearance` adds inflation cost up to `radius` from solids. */
export function roomGridMap(room: Room, res = GRID_MAP.res, clearance = false, radius = GRID_MAP.radius): GridMap {
  const st = roomGrid(room, res)
  for (let c = 0; c < st.cost.length; c++) {
    const [i, j] = [c % st.nx, Math.floor(c / st.nx)]
    const [x, y] = cellCentre(st, i, j)
    const ring = !i || !j || i === st.nx - 1 || j === st.ny - 1
    if (ring || room.solids.some((s) => solidGap(s, x, y) < (s.kind === 'post' ? res / 2 : 1e-6))) st.cost[c] = LETHAL
  }
  const infl = clearance ? inflate(st, res / 2, radius, GRID_MAP.k) : null
  const N = st.nx * st.ny
  const blocked = new Uint8Array(N)
  const pen = new Uint8Array(N)
  for (let c = 0; c < N; c++) {
    blocked[c] = st.cost[c] >= LETHAL ? 1 : 0
    if (infl && !blocked[c]) pen[c] = Math.round((PEN_MAX * Math.min(infl.cost[c], INSCRIBED - 1)) / (INSCRIBED - 1))
  }
  return { w: st.nx, h: st.ny, res, blocked, pen }
}
export const cellAtM = (m: GridMap, x: number, y: number) => Math.floor(y / m.res + 1) * m.w + Math.floor(x / m.res + 1)

// --- D* Lite (Koenig & Likhachev 2002): search goal → robot, repair only what a newly seen cell changes ---

interface DStarFrame {
  at: number
  path: number[]
  known: Uint8Array
  touched: number[]
  g: Float64Array
  dstar: number
  astar: number
  seen: number[]
}
type Key = [number, number]
const keyLess = (a: Key, b: Key) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

/** Robot drives start → goal on `truth` knowing only `known` (8-connected, octile h), seeing cells within `range` (Chebyshev) after
 *  every step. Each frame: D* Lite expansions to repair vs a fresh A* from the robot on the same map. */
export function dstarLiteRun(truth: GridMap, known0: GridMap, start: number, goal: number, range: number): DStarFrame[] {
  const m = known0
  const N = m.w * m.h
  const known = known0.blocked.slice()
  const free = new Uint8Array(N)
  const g = new Float64Array(N).fill(Infinity)
  const rhs = new Float64Array(N).fill(Infinity)
  const ver = new Int32Array(N)
  const inOpen = new Uint8Array(N)
  const keys: Key[] = Array.from({ length: N }, () => [0, 0])
  const heap = new MinHeap<{ k: Key; c: number; v: number }>((a, b) => keyLess(a.k, b.k))
  const h = (a: number, b: number) => heuristic('octile', m, a, b)
  let s = start
  let km = 0
  const keyOf = (c: number): Key => {
    const v = Math.min(g[c], rhs[c])
    return [v + h(s, c) + km, v]
  }
  const insert = (c: number) => {
    keys[c] = keyOf(c)
    inOpen[c] = 1
    heap.push({ k: keys[c], c, v: ++ver[c] })
  }
  const top = () => {
    for (let e = heap.peek(); e; e = heap.peek()) {
      if (inOpen[e.c] && e.v === ver[e.c]) return e
      heap.pop()
    }
    return undefined
  }
  const nbrs = (c: number) => gridNeighbours(m, c, 8, known)
  const update = (u: number) => {
    if (u !== goal) rhs[u] = known[u] ? Infinity : nbrs(u).reduce((b, [n, step]) => Math.min(b, step + g[n]), Infinity)
    inOpen[u] = 0
    if (g[u] !== rhs[u]) insert(u)
  }
  const solve = () => {
    const touched: number[] = []
    for (let e = top(); e && (keyLess(e.k, keyOf(s)) || rhs[s] !== g[s]); e = top()) {
      const u = e.c
      const kNew = keyOf(u)
      if (keyLess(e.k, kNew)) {
        insert(u)
        continue
      }
      heap.pop()
      inOpen[u] = 0
      touched.push(u)
      const around = gridNeighbours(m, u, 8, free).map(([n]) => n)
      if (g[u] > rhs[u]) g[u] = rhs[u]
      else {
        g[u] = Infinity
        update(u)
      }
      for (const p of around) update(p)
    }
    return touched
  }
  const route = () => {
    const p = [s]
    for (let c = s; c !== goal && p.length < N; ) {
      let best = -1
      let bv = Infinity
      for (const [n, step] of nbrs(c))
        if (step + g[n] < bv) {
          bv = step + g[n]
          best = n
        }
      if (best < 0 || bv === Infinity) break
      p.push((c = best))
    }
    return p
  }
  const sense = () => {
    const changed: number[] = []
    const sx = s % m.w
    const sy = Math.floor(s / m.w)
    for (let y = Math.max(0, sy - range); y <= Math.min(m.h - 1, sy + range); y++)
      for (let x = Math.max(0, sx - range); x <= Math.min(m.w - 1, sx + range); x++) {
        const c = y * m.w + x
        if (known[c] !== truth.blocked[c]) {
          known[c] = truth.blocked[c]
          changed.push(c)
        }
      }
    return changed
  }
  const fresh = () => gridSearch({ ...m, blocked: known.slice() }, s, goal, { algo: 'astar', conn: 8, heur: 'octile' }).order.length
  rhs[goal] = 0
  insert(goal)
  const frames: DStarFrame[] = []
  const seen0 = sense()
  const t0 = solve()
  frames.push({ at: s, path: route(), known: known.slice(), touched: t0, g: g.slice(), dstar: t0.length, astar: fresh(), seen: seen0 })
  let last = s
  while (s !== goal && g[s] < Infinity && frames.length < 4 * N) {
    const next = route()[1]
    if (next === undefined) break
    s = next
    const seen = sense()
    let touched: number[] = []
    if (seen.length) {
      km += h(last, s)
      last = s
      for (const c of seen) {
        update(c)
        for (const [n] of gridNeighbours(m, c, 8, free)) update(n)
      }
      touched = solve()
    }
    frames.push({ at: s, path: route(), known: known.slice(), touched, g: g.slice(), dstar: touched.length, astar: seen.length ? fresh() : 0, seen })
  }
  return frames
}
