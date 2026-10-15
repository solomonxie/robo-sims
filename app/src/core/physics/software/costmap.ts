// Nav2-style 2D costmap (static, obstacle and inflation layers) and an A* planner over it, in metres on the room floor.
import { Pose, Room, RoomSolid, castRoom, rayDir, walledRoom } from '../room'

export const LETHAL = 254
export const INSCRIBED = 253
/** NavFn-style step cost: neutral + factor · cell cost, per cell length. */
export const NEUTRAL_COST = 50
export const COST_FACTOR = 0.8

export interface CostGrid {
  ox: number
  oy: number
  res: number
  nx: number
  ny: number
  cost: Uint8Array
}
export type XY = [number, number]

export const costGrid = (ox: number, oy: number, res: number, nx: number, ny: number): CostGrid => ({ ox, oy, res, nx, ny, cost: new Uint8Array(nx * ny) })
export const blankLike = (g: CostGrid) => costGrid(g.ox, g.oy, g.res, g.nx, g.ny)
/** Grid over the room plus one ring of cells for the walls. */
export const roomGrid = (room: Room, res: number) => costGrid(-res, -res, res, Math.ceil(room.w / res) + 2, Math.ceil(room.d / res) + 2)
export const cellCentre = (g: CostGrid, i: number, j: number): XY => [g.ox + (i + 0.5) * g.res, g.oy + (j + 0.5) * g.res]
export function cellOf(g: CostGrid, x: number, y: number): XY | null {
  const i = Math.floor((x - g.ox) / g.res)
  const j = Math.floor((y - g.oy) / g.res)
  return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? null : [i, j]
}
export const costAt = (g: CostGrid, x: number, y: number) => {
  const c = cellOf(g, x, y)
  return c ? g.cost[c[1] * g.nx + c[0]] : LETHAL
}

/** Static layer: lethal wherever a solid of the saved map overlaps the cell. */
export function staticLayer(room: Room, res: number): CostGrid {
  const g = roomGrid(room, res)
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const x0 = g.ox + i * res
      const y0 = g.oy + j * res
      const hit = room.solids.some((s) => {
        if (s.kind === 'box') return s.x[0] < x0 + res && s.x[1] > x0 && s.y[0] < y0 + res && s.y[1] > y0
        const dx = s.at[0] - Math.max(x0, Math.min(s.at[0], x0 + res))
        const dy = s.at[1] - Math.max(y0, Math.min(s.at[1], y0 + res))
        return dx * dx + dy * dy < s.r * s.r
      })
      if (hit) g.cost[j * g.nx + i] = LETHAL
    }
  return g
}

/** `beams` lidar rays at height `z` from `pose`: end points, `hit` false at max range. */
export function scanHits(room: Room, pose: Pose, beams: number, maxM: number, z = 0.2) {
  return Array.from({ length: beams }, (_, k) => {
    const a = pose.th + (2 * Math.PI * k) / beams
    const h = castRoom(room, [pose.x, pose.y, z], rayDir(a), maxM)
    const m = h && h.solid ? h.m : maxM
    return { x: pose.x + m * Math.cos(a), y: pose.y + m * Math.sin(a), hit: !!(h && h.solid) }
  })
}

/** Obstacle layer update: clear cells the beams pass through, mark the cells they end on. Mutates `g`. */
export function markAndClear(g: CostGrid, pose: Pose, hits: { x: number; y: number; hit: boolean }[]) {
  for (const h of hits) {
    const end = cellOf(g, h.x, h.y)
    const L = Math.hypot(h.x - pose.x, h.y - pose.y)
    const steps = Math.ceil(L / (g.res / 2))
    for (let k = 0; k < steps; k++) {
      const c = cellOf(g, pose.x + ((h.x - pose.x) * k) / steps, pose.y + ((h.y - pose.y) * k) / steps)
      if (c && !(end && c[0] === end[0] && c[1] === end[1])) g.cost[c[1] * g.nx + c[0]] = 0
    }
    if (h.hit && end) g.cost[end[1] * g.nx + end[0]] = LETHAL
  }
  return g
}

/** Nav2 inflation: inscribed (robot radius) → 253, then 252·e^(−k(d − r)) out to `radius`, 0 beyond. */
export function inflationCost(d: number, inscribed: number, radius: number, k: number) {
  if (d <= 1e-9) return LETHAL
  if (d <= inscribed) return INSCRIBED
  if (d > radius) return 0
  return Math.floor((INSCRIBED - 1) * Math.exp(-k * (d - inscribed)))
}

/** Inflation layer around every lethal cell of `src`. */
export function inflate(src: CostGrid, inscribed: number, radius: number, k: number): CostGrid {
  const out = blankLike(src)
  const w = Math.ceil(radius / src.res)
  const table: number[] = []
  for (let dj = -w; dj <= w; dj++) for (let di = -w; di <= w; di++) table.push(inflationCost(Math.hypot(di, dj) * src.res, inscribed, radius, k))
  for (let j = 0; j < src.ny; j++)
    for (let i = 0; i < src.nx; i++) {
      if (src.cost[j * src.nx + i] < LETHAL) continue
      for (let dj = -w; dj <= w; dj++) {
        const jj = j + dj
        if (jj < 0 || jj >= src.ny) continue
        for (let di = -w; di <= w; di++) {
          const ii = i + di
          if (ii < 0 || ii >= src.nx) continue
          const c = table[(dj + w) * (2 * w + 1) + di + w]
          const at = jj * src.nx + ii
          if (c > out.cost[at]) out.cost[at] = c
        }
      }
    }
  return out
}

/** Master costmap: the highest cost of any layer, cell by cell. */
export function maxLayers(...layers: CostGrid[]): CostGrid {
  const out = blankLike(layers[0])
  for (const l of layers) for (let k = 0; k < out.cost.length; k++) if (l.cost[k] > out.cost[k]) out.cost[k] = l.cost[k]
  return out
}

export interface GridPlan {
  path: XY[]
  cells: number
  expanded: number
  cost: number
}

/** A* over 8-connected cells (NavFn-style cost), cells ≥ inscribed blocked; null if the goal is unreachable. */
export function planGrid(g: CostGrid, from: XY, to: XY): GridPlan | null {
  const a = cellOf(g, ...from)
  const b = cellOf(g, ...to)
  if (!a || !b || g.cost[b[1] * g.nx + b[0]] >= INSCRIBED) return null
  const N = g.nx * g.ny
  const start = a[1] * g.nx + a[0]
  const goal = b[1] * g.nx + b[0]
  const best = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const done = new Uint8Array(N)
  const h = (k: number) => Math.hypot((k % g.nx) - b[0], Math.floor(k / g.nx) - b[1]) * NEUTRAL_COST
  const heap: [number, number][] = []
  const push = (f: number, k: number) => {
    heap.push([f, k])
    for (let i = heap.length - 1; i > 0; ) {
      const p = Math.floor((i - 1) / 2)
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  best[start] = 0
  push(h(start), start)
  let expanded = 0
  while (heap.length) {
    const [, k] = pop()
    if (done[k]) continue
    done[k] = 1
    expanded++
    if (k === goal) break
    const i = k % g.nx
    const j = Math.floor(k / g.nx)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = i + di
        const jj = j + dj
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue
        const n = jj * g.nx + ii
        if (done[n] || g.cost[n] >= INSCRIBED) continue
        const step = Math.hypot(di, dj) * (NEUTRAL_COST + COST_FACTOR * g.cost[n])
        if (best[k] + step < best[n]) {
          best[n] = best[k] + step
          prev[n] = k
          push(best[n] + h(n), n)
        }
      }
  }
  if (!done[goal]) return null
  const cells: number[] = []
  for (let k = goal; k >= 0; k = prev[k]) cells.unshift(k)
  const path = cells.map((k) => cellCentre(g, k % g.nx, Math.floor(k / g.nx)))
  path[0] = [...from]
  path[path.length - 1] = [...to]
  return { path, cells: cells.length, expanded, cost: best[goal] }
}

export const pathLength = (p: XY[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)

/** Point `s` metres along a polyline (clamped) and the direction there. */
export function alongPath(p: XY[], s: number): { at: XY; dir: number } {
  let left = Math.max(0, s)
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    const dir = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0])
    if (left <= L || i === p.length - 1) {
      const u = L > 0 ? Math.min(1, left / L) : 1
      return { at: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u], dir }
    }
    left -= L
  }
  return { at: p[0], dir: 0 }
}

// --- Scenario: a robot crosses a room with two doorways; a box is dropped in the near one. ---

export const NAV_MAP = walledRoom(6, 4, 1, [
  { kind: 'box', name: 'divider', x: [2.8, 3.1], y: [0.9, 3.1], h: 1, refl: 0.7 },
  { kind: 'box', name: 'shelf', x: [4.6, 5.95], y: [3.4, 3.95], h: 1.2, refl: 0.6 },
  { kind: 'box', name: 'crate', x: [4.1, 4.7], y: [1.5, 2.1], h: 0.5, refl: 0.6 },
  { kind: 'post', name: 'pillar', at: [1.2, 3.1], r: 0.15, h: 1, refl: 0.7 },
])
export const NAV_CART: RoomSolid = { kind: 'post', name: 'cart', at: [1.7, 1.75], r: 0.2, h: 0.8, refl: 0.5 }
export const NAV_DROP: RoomSolid = { kind: 'box', name: 'box', x: [2.75, 3.15], y: [0.05, 0.85], h: 0.5, refl: 0.6 }
export const NAV = { res: 0.125, start: { x: 0.5, y: 0.55, th: 0 } as Pose, goal: [5.3, 0.7] as XY, inscribed: 0.2, k: 3, v: 0.4, turn: 1.5, dt: 0.1, planHz: 1, dropS: 3.5, beams: 120, maxM: 6, endS: 30 }

export interface NavFrame {
  t: number
  pose: Pose
  path: XY[]
  obs: CostGrid
  infl: CostGrid
  master: CostGrid
  hits: { x: number; y: number; hit: boolean }[]
  dropped: boolean
  replans: number
  reached: boolean
}

/** Robot drives start → goal at 10 Hz, scanning every tick and re-planning at 1 Hz on the master costmap. */
export function costmapRun(radius: number, drop: boolean): NavFrame[] {
  const still = staticLayer(NAV_MAP, NAV.res)
  const inflStatic = inflate(still, NAV.inscribed, radius, NAV.k)
  const obs = blankLike(still)
  const world = (t: number): Room => ({ ...NAV_MAP, solids: [...NAV_MAP.solids, NAV_CART, ...(drop && t >= NAV.dropS ? [NAV_DROP] : [])] })
  const pose = { ...NAV.start }
  const out: NavFrame[] = []
  let path: XY[] = []
  let sp = 0
  let infl = inflStatic
  let master = maxLayers(still, inflStatic)
  let replans = 0
  let reached = false
  const every = Math.round(1 / (NAV.planHz * NAV.dt))
  for (let n = 0; n * NAV.dt <= NAV.endS; n++) {
    const t = n * NAV.dt
    const room = world(t)
    const hits = scanHits(room, pose, NAV.beams, NAV.maxM)
    markAndClear(obs, pose, hits)
    if (!reached && n % every === 0) {
      infl = maxLayers(inflStatic, inflate(obs, NAV.inscribed, radius, NAV.k))
      master = maxLayers(still, obs, infl)
      const plan = planGrid(master, [pose.x, pose.y], NAV.goal)
      path = plan ? plan.path : []
      sp = 0
      if (n > 0) replans++
    }
    if (!reached && path.length > 1) {
      const ahead = alongPath(path, sp + 0.35)
      const want = Math.atan2(ahead.at[1] - pose.y, ahead.at[0] - pose.x)
      const err = Math.atan2(Math.sin(want - pose.th), Math.cos(want - pose.th))
      pose.th += Math.sign(err) * Math.min(Math.abs(err), NAV.turn * NAV.dt)
      if (Math.abs(err) < 0.8) {
        sp = Math.min(pathLength(path), sp + NAV.v * NAV.dt)
        const p = alongPath(path, sp).at
        pose.x = p[0]
        pose.y = p[1]
      }
    }
    reached ||= Math.hypot(pose.x - NAV.goal[0], pose.y - NAV.goal[1]) < 0.05
    out.push({ t, pose: { ...pose }, path, obs: { ...obs, cost: obs.cost.slice() }, infl, master, hits, dropped: drop && t >= NAV.dropS, replans, reached })
    if (reached && out.length > 1 && out[out.length - 2].reached) break
  }
  return out
}
