// Sampling planners in a room: seeded samples, segment collision checks, RRT / RRT* (rewiring), shortcut and corner-cutting smoothing.
import { seededRng, wrapPi } from '../common'
import { Room } from '../room'
import { XY, pathLength } from '../software/costmap'
import { clearance } from './avoid'

/** Body radius `r` (m), sample cap `n`, RRT* ball constant `gamma` (m). */
export const SAMPLING = { r: 0.12, n: 600, gamma: 4 }

const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Body of radius `r` swept along a → b keeps clear of every solid (checked every `r` / 2). */
export function segmentFree(room: Room, a: XY, b: XY, r = SAMPLING.r) {
  const k = Math.max(1, Math.ceil(dist(a, b) / (r / 2)))
  for (let i = 0; i <= k; i++) if (clearance(room, a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k) < r) return false
  return true
}

interface RrtOpts {
  step: number
  /** Chance a sample is the goal itself. */
  bias: number
  star: boolean
  seed: number
  n?: number
  r?: number
}
/** One sample: where it fell, the node it added (-1 = blocked), RRT* re-parentings [node, parent], best cost so far. */
interface RrtIter {
  sample: XY
  node: number
  rewires: [number, number][]
  best: number
  bestNode: number
}
export interface RrtRun {
  pts: XY[]
  /** Parent each node got when added (-1 for the root). */
  parent0: number[]
  parent: number[]
  cost: number[]
  iters: RrtIter[]
  /** Sample index of the first path, -1 if none. */
  firstAt: number
  goal: XY
}

/** RRT: steer `step` from the nearest node towards each sample. RRT*: pick the cheapest parent in a shrinking ball, then rewire neighbours through the new node. */
export function rrtRun(room: Room, start: XY, goal: XY, o: RrtOpts): RrtRun {
  const r = o.r ?? SAMPLING.r
  const N = o.n ?? SAMPLING.n
  const rnd = seededRng(o.seed)
  const pts: XY[] = [start]
  const parent0 = [-1]
  const parent = [-1]
  const cost = [0]
  const kids: number[][] = [[]]
  const ends: number[] = []
  const iters: RrtIter[] = []
  let best = Infinity
  let bestNode = -1
  let firstAt = -1
  const free = (a: XY, b: XY) => segmentFree(room, a, b, r)
  for (let it = 0; it < N; it++) {
    const s: XY = rnd() < o.bias ? goal : [r + rnd() * (room.w - 2 * r), r + rnd() * (room.d - 2 * r)]
    let near = 0
    for (let i = 1; i < pts.length; i++) if (dist(pts[i], s) < dist(pts[near], s)) near = i
    const L = dist(pts[near], s)
    const to: XY = L <= o.step ? s : [pts[near][0] + ((s[0] - pts[near][0]) * o.step) / L, pts[near][1] + ((s[1] - pts[near][1]) * o.step) / L]
    const rewires: [number, number][] = []
    let node = -1
    if (L > 1e-9 && free(pts[near], to)) {
      let p = near
      let c = cost[near] + dist(pts[near], to)
      const ball: number[] = []
      if (o.star) {
        const R = Math.min(o.step * 2.5, SAMPLING.gamma * Math.sqrt(Math.log(pts.length + 1) / (pts.length + 1)))
        for (let j = 0; j < pts.length; j++) if (dist(pts[j], to) <= Math.max(R, o.step)) ball.push(j)
        for (const j of ball) {
          const cj = cost[j] + dist(pts[j], to)
          if (j !== near && cj < c - 1e-9 && free(pts[j], to)) [p, c] = [j, cj]
        }
      }
      node = pts.length
      pts.push(to)
      parent0.push(p)
      parent.push(p)
      cost.push(c)
      kids.push([])
      kids[p].push(node)
      for (const j of ball) {
        if (j === p || j === 0) continue
        const cn = c + dist(to, pts[j])
        if (cn >= cost[j] - 1e-9 || !free(to, pts[j])) continue
        kids[parent[j]] = kids[parent[j]].filter((x) => x !== j)
        kids[node].push(j)
        parent[j] = node
        const d = cn - cost[j]
        const stack = [j]
        while (stack.length) {
          const x = stack.pop()!
          cost[x] += d
          stack.push(...kids[x])
        }
        rewires.push([j, node])
      }
      if (dist(to, goal) <= o.step && free(to, goal)) ends.push(node)
    }
    if (o.star || bestNode < 0)
      for (const e of ends) {
        const c = cost[e] + dist(pts[e], goal)
        if (c < best - 1e-9) [best, bestNode] = [c, e]
      }
    else best = cost[bestNode] + dist(pts[bestNode], goal)
    if (bestNode >= 0 && firstAt < 0) firstAt = it
    iters.push({ sample: s, node, rewires, best, bestNode })
  }
  return { pts, parent0, parent, cost, iters, firstAt, goal }
}

/** Parents after sample `k` (replays additions and rewires); nodes not yet added are -2. */
export function treeAt(run: RrtRun, k: number) {
  const par = new Int32Array(run.pts.length).fill(-2)
  par[0] = -1
  for (let i = 0; i <= Math.min(k, run.iters.length - 1); i++) {
    const it = run.iters[i]
    if (it.node >= 0) par[it.node] = run.parent0[it.node]
    for (const [j, p] of it.rewires) par[j] = p
  }
  return par
}

/** Start → … → `node` → goal through `par`; empty if `node` < 0. */
export function rrtPath(run: RrtRun, par: ArrayLike<number>, node: number): XY[] {
  if (node < 0) return []
  const out: XY[] = [run.goal]
  for (let i = node; i >= 0; i = par[i]) out.push(run.pts[i])
  return out.reverse()
}

interface ShortcutTry {
  i: number
  j: number
  ok: boolean
  path: XY[]
}
/** Random shortcutting: pick waypoints i < j - 1; if the straight chord is free, drop everything between. Stops once every chord has failed. */
export function shortcutRun(room: Room, path: XY[], tries: number, seed: number, r = SAMPLING.r): ShortcutTry[] {
  const rnd = seededRng(seed * 101 + 7)
  const out: ShortcutTry[] = []
  let p = path
  let failed = new Set<number>()
  for (let t = 0; t < tries && p.length > 2 && failed.size < ((p.length - 1) * (p.length - 2)) / 2; t++) {
    const i = Math.floor(rnd() * (p.length - 2))
    const j = i + 2 + Math.floor(rnd() * (p.length - i - 2))
    const ok = segmentFree(room, p[i], p[j], r)
    if (ok) [p, failed] = [[...p.slice(0, i + 1), ...p.slice(j)], new Set()]
    else failed.add(i * p.length + j)
    out.push({ i, j, ok, path: p })
  }
  return out
}

/** One Chaikin pass: each corner becomes two points 1/4 along its legs, unless the cut would hit something. */
export function cutCorners(room: Room, path: XY[], r = SAMPLING.r): XY[] {
  if (path.length < 3) return path
  const out: XY[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    const [a, v, b] = [path[i - 1], path[i], path[i + 1]]
    const q1: XY = [v[0] + (a[0] - v[0]) / 4, v[1] + (a[1] - v[1]) / 4]
    const q2: XY = [v[0] + (b[0] - v[0]) / 4, v[1] + (b[1] - v[1]) / 4]
    if (segmentFree(room, q1, q2, r)) out.push(q1, q2)
    else out.push(v)
  }
  out.push(path[path.length - 1])
  return out
}

/** Heading change at each interior waypoint, rad (absolute). */
function cornerTurns(path: XY[]) {
  const out: number[] = []
  for (let i = 2; i < path.length; i++) {
    const h0 = Math.atan2(path[i - 1][1] - path[i - 2][1], path[i - 1][0] - path[i - 2][0])
    const h1 = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0])
    out.push(Math.abs(wrapPi(h1 - h0)))
  }
  return out
}
export const turnSum = (path: XY[]) => cornerTurns(path).reduce((s, t) => s + t, 0)
export const sharpestTurn = (path: XY[]) => cornerTurns(path).reduce((m, t) => Math.max(m, t), 0)

/** Smallest gap from the path to any solid, checked every `step` m. */
export function pathClearance(room: Room, path: XY[], step = 0.02) {
  let m = Infinity
  for (let i = 1; i < path.length; i++) {
    const k = Math.max(1, Math.ceil(dist(path[i - 1], path[i]) / step))
    for (let s = 0; s <= k; s++) m = Math.min(m, clearance(room, path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * s) / k, path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * s) / k))
  }
  return m
}

/** Length, turning and waypoints of a path, for before/after comparisons. */
export const pathStats = (path: XY[]) => ({ len: pathLength(path), turn: turnSum(path), sharp: sharpestTurn(path), n: path.length })
