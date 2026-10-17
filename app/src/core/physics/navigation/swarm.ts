// Multi-robot: boids flocking over a lossy radio, and task allocation (greedy, auction, brute-force optimum).
import { clamp, parkMiller, wrapPi } from '../common'
import { V2 } from '../kinematics/transforms'
import { diffInverse, diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'
import { segmentsCross } from '../signals/pcb'
import { XY } from '../software/costmap'

export const SWARM = { track: TT_TRACK_M, vMax: 0.25, vMin: 0.05, wMax: 3, kTurn: 4, body: 0.09 }

/** Turn toward `heading` (P on the error, clamped) at speed v; wheel speeds from the diff-drive inverse. */
function steerStep(p: Pose, heading: number, v: number, dt: number) {
  const w = clamp(SWARM.kTurn * wrapPi(heading - p.th), -SWARM.wMax, SWARM.wMax)
  const [vL, vR] = diffInverse(v, w, SWARM.track)
  return { pose: diffStep(p, vL, vR, SWARM.track, dt), vL, vR }
}

// --- Boids ---

interface Mate {
  x: number
  y: number
  vx: number
  vy: number
}

/** Reynolds rules, unweighted: separation Σ (p − pⱼ)/dⱼ² for dⱼ < sepR, alignment mean vⱼ − v, cohesion mean pⱼ − p. */
export function boidRules(self: Mate, mates: readonly Mate[], sepR: number) {
  const sep: V2 = [0, 0]
  const ali: V2 = [0, 0]
  const coh: V2 = [0, 0]
  if (!mates.length) return { sep, ali, coh }
  for (const m of mates) {
    const dx = self.x - m.x
    const dy = self.y - m.y
    const d2 = Math.max(1e-4, dx * dx + dy * dy)
    if (d2 < sepR * sepR) [sep[0], sep[1]] = [sep[0] + dx / d2, sep[1] + dy / d2]
    ali[0] += m.vx / mates.length
    ali[1] += m.vy / mates.length
    coh[0] += m.x / mates.length
    coh[1] += m.y / mates.length
  }
  return { sep, ali: [ali[0] - self.vx, ali[1] - self.vy] as V2, coh: [coh[0] - self.x, coh[1] - self.y] as V2 }
}

/** Polarisation |Σ unit headings| / N: 1 = all parallel, ≈ 0 = random. */
export const polarisation = (ths: readonly number[]) => Math.hypot(ths.reduce((s, t) => s + Math.cos(t), 0), ths.reduce((s, t) => s + Math.sin(t), 0)) / Math.max(1, ths.length)

/** Number of connected groups when robots closer than r are linked. */
export function groupsOf(pts: readonly { x: number; y: number }[], r: number) {
  const parent = pts.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < r) parent[root(i)] = root(j)
  return new Set(pts.map((_, i) => root(i))).size
}

export const FLOCK = { n: 12, w: 3.2, h: 2.0, dt: 0.05, seconds: 40, sepR: 0.35, stale: 0.5, margin: 0.35, wall: 1.2, seed: 11 }
export const FLOCK_RULES = { all: 'All three rules', nosep: 'No separation', noali: 'No alignment', nocoh: 'No cohesion' }
export type FlockRules = keyof typeof FLOCK_RULES
const WEIGHTS: Record<FlockRules, [number, number, number]> = { all: [0.2, 0.8, 0.1], nosep: [0, 0.8, 0.1], noali: [0.2, 0, 0.1], nocoh: [0.2, 0.8, 0] }

interface FlockFrame {
  t: number
  poses: Pose[]
  wheels: V2[]
  /** Pairs (i, j) flattened that got a packet through this step. */
  links: number[]
  /** Robot 0: weighted rule pushes and whom it currently counts as a neighbour. */
  push: { sep: V2; ali: V2; coh: V2; wall: V2 }
  mates0: number[]
  order: number
  groups: number
  minGap: number
  bumps: number
}

/** Push back from the arena walls (centred on 0, size w × h) inside `margin`. */
function wallPush(x: number, y: number): V2 {
  const { w, h, margin, wall } = FLOCK
  const f = (d: number) => (d < margin ? (wall * (margin - Math.max(0, d))) / margin : 0)
  return [f(x + w / 2) - f(w / 2 - x), f(y + h / 2) - f(h / 2 - y)]
}

/**
 * Boids on diff-drive robots. Each step every robot broadcasts (x, y, v); a packet reaches robots within `range`
 * with probability 1 − loss. Robots steer on the last state heard (≤ `stale` s old). Overlaps are pushed apart and counted.
 */
export function flockRun({ range, loss, rules }: { range: number; loss: number; rules: FlockRules }) {
  const { n, w, h, dt, seconds, sepR, stale, seed } = FLOCK
  const [ws, wa, wc] = WEIGHTS[rules]
  const place = parkMiller(seed)
  const drop = parkMiller(seed + 1000)
  const poses: Pose[] = []
  while (poses.length < n) {
    const p = { x: (place() - 0.5) * (w - 0.5), y: (place() - 0.5) * (h - 0.5), th: (place() - 0.5) * 2 * Math.PI }
    if (poses.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 0.3)) poses.push(p)
  }
  const speed = poses.map(() => 0.15)
  const wheels: V2[] = poses.map(() => [0, 0])
  const heard: (Mate & { t: number })[][] = poses.map(() => poses.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, t: -1e9 })))
  const contact = new Set<number>()
  const frames: FlockFrame[] = []
  let bumps = 0
  const steps = Math.round(seconds / dt)
  for (let k = 0; k <= steps; k++) {
    const t = k * dt
    const linked = new Set<number>()
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j || Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y) > range || drop() < loss) continue
        heard[i][j] = { x: poses[j].x, y: poses[j].y, vx: speed[j] * Math.cos(poses[j].th), vy: speed[j] * Math.sin(poses[j].th), t }
        linked.add(Math.min(i, j) * n + Math.max(i, j))
      }
    const links = [...linked].flatMap((q) => [Math.floor(q / n), q % n])
    let push0: FlockFrame['push'] = { sep: [0, 0], ali: [0, 0], coh: [0, 0], wall: [0, 0] }
    let mates0: number[] = []
    const ths = poses.map((p) => p.th)
    let minGap = Infinity
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minGap = Math.min(minGap, Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y))
    const wheelSnap = wheels.map((v) => [v[0], v[1]] as V2)
    const next = poses.map((p, i) => {
      const self = { x: p.x, y: p.y, vx: speed[i] * Math.cos(p.th), vy: speed[i] * Math.sin(p.th) }
      const ids = heard[i].map((m, j) => j).filter((j) => j !== i && t - heard[i][j].t <= stale && Math.hypot(heard[i][j].x - p.x, heard[i][j].y - p.y) < range)
      const r = boidRules(self, ids.map((j) => heard[i][j]), sepR)
      const push = { sep: [ws * r.sep[0], ws * r.sep[1]] as V2, ali: [wa * r.ali[0], wa * r.ali[1]] as V2, coh: [wc * r.coh[0], wc * r.coh[1]] as V2, wall: wallPush(p.x, p.y) }
      if (i === 0) [push0, mates0] = [push, ids]
      const ux = self.vx + push.sep[0] + push.ali[0] + push.coh[0] + push.wall[0]
      const uy = self.vy + push.sep[1] + push.ali[1] + push.coh[1] + push.wall[1]
      const v = clamp(Math.hypot(ux, uy), SWARM.vMin, SWARM.vMax)
      speed[i] = v
      const s = steerStep(p, Math.atan2(uy, ux), v, dt)
      wheels[i] = [wheels[i][0] + s.vL * dt, wheels[i][1] + s.vR * dt]
      return s.pose
    })
    frames.push({ t, poses: poses.map((p) => ({ ...p })), wheels: wheelSnap, links, push: push0, mates0, order: polarisation(ths), groups: groupsOf(poses, range), minGap, bumps })
    if (k === steps) break
    for (let i = 0; i < n; i++) {
      next[i].x = clamp(next[i].x, -w / 2 + SWARM.body, w / 2 - SWARM.body)
      next[i].y = clamp(next[i].y, -h / 2 + SWARM.body, h / 2 - SWARM.body)
      poses[i] = next[i]
    }
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = poses[j].x - poses[i].x
        const dy = poses[j].y - poses[i].y
        const d = Math.hypot(dx, dy)
        const key = i * n + j
        if (d >= 2 * SWARM.body) {
          contact.delete(key)
          continue
        }
        if (!contact.has(key)) (contact.add(key), bumps++)
        const s = (2 * SWARM.body - d) / 2 / Math.max(1e-6, d)
        poses[i].x -= dx * s
        poses[i].y -= dy * s
        poses[j].x += dx * s
        poses[j].y += dy * s
      }
  }
  return frames
}

// --- Task allocation: one task per robot, cost = straight-line distance. ---

export const costMatrix = (from: readonly { x: number; y: number }[], to: readonly XY[]) => from.map((r) => to.map(([x, y]) => Math.hypot(x - r.x, y - r.y)))
export const assignTotal = (C: readonly number[][], a: readonly number[]) => a.reduce((s, j, i) => s + C[i][j], 0)

/** Repeatedly take the cheapest remaining (robot, task) pair. */
export function greedyAssign(C: readonly number[][]) {
  const n = C.length
  const assign = Array(n).fill(-1)
  const taken = new Set<number>()
  const picks: [number, number][] = []
  for (let k = 0; k < n; k++) {
    let best: [number, number] = [-1, -1]
    for (let i = 0; i < n; i++) if (assign[i] < 0) for (let j = 0; j < n; j++) if (!taken.has(j) && (best[0] < 0 || C[i][j] < C[best[0]][best[1]])) best = [i, j]
    assign[best[0]] = best[1]
    taken.add(best[1])
    picks.push(best)
  }
  return { assign, picks }
}

interface AuctionRound {
  bids: { robot: number; task: number; price: number }[]
  prices: number[]
  owner: number[]
}

/**
 * Bertsekas auction (Jacobi rounds, minimising cost). Each round every unassigned robot bids on its best task
 * (lowest cost + price), raising the price by (second best − best) + ε; each task goes to its highest bid.
 * Ends within n·ε of the optimum.
 */
export function auctionAssign(C: readonly number[][], eps: number, maxRounds = 5000) {
  const n = C.length
  const prices = Array(n).fill(0)
  const owner = Array(n).fill(-1)
  const assign = Array(n).fill(-1)
  const rounds: AuctionRound[] = []
  let bids = 0
  while (assign.includes(-1) && rounds.length < maxRounds) {
    const round: AuctionRound['bids'] = []
    for (let i = 0; i < n; i++) {
      if (assign[i] >= 0) continue
      let [j1, c1, c2] = [-1, Infinity, Infinity]
      for (let j = 0; j < n; j++) {
        const c = C[i][j] + prices[j]
        if (c < c1) [j1, c1, c2] = [j, c, c1]
        else if (c < c2) c2 = c
      }
      round.push({ robot: i, task: j1, price: prices[j1] + (Number.isFinite(c2) ? c2 - c1 : 0) + eps })
    }
    bids += round.length
    for (let j = 0; j < n; j++) {
      const top = round.filter((b) => b.task === j).sort((a, b) => b.price - a.price)[0]
      if (!top) continue
      if (owner[j] >= 0) assign[owner[j]] = -1
      owner[j] = top.robot
      assign[top.robot] = j
      prices[j] = top.price
    }
    rounds.push({ bids: round, prices: [...prices], owner: [...owner] })
  }
  return { assign, rounds, bids }
}

/** Exact minimum-total assignment by trying every permutation (n ≤ 8). */
export function optimalAssign(C: readonly number[][]) {
  const n = C.length
  const best = { total: Infinity, assign: [] as number[] }
  const cur: number[] = []
  const used = Array(n).fill(false)
  const go = (i: number, s: number) => {
    if (s >= best.total) return
    if (i === n) return Object.assign(best, { total: s, assign: [...cur] })
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      used[j] = true
      cur[i] = j
      go(i + 1, s + C[i][j])
      used[j] = false
    }
  }
  go(0, 0)
  return best
}

/** Where straight robot → task trips cross each other. */
export function tripCrossings(robots: readonly { x: number; y: number }[], tasks: readonly XY[], assign: readonly number[]) {
  const segs = robots.map((r, i) => [[r.x, r.y], tasks[assign[i]]] as [XY, XY])
  const out: XY[] = []
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (!segmentsCross(segs[i], segs[j])) continue
      const [[ax, ay], [bx, by]] = segs[i]
      const [[cx, cy], [dx, dy]] = segs[j]
      const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / ((bx - ax) * (dy - cy) - (by - ay) * (dx - cx))
      out.push([ax + u * (bx - ax), ay + u * (by - ay)])
    }
  return out
}

export const TASK_FIELD = { w: 3.2, h: 2.0, gap: 0.35, v: 0.25, dt: 0.05 }

/** Seeded robots (facing +x) and tasks, all at least `gap` apart inside the arena. */
export function taskLayout(n: number, seed: number) {
  const rng = parkMiller(seed * 7919 + 17)
  const pts: XY[] = []
  while (pts.length < 2 * n) {
    const p: XY = [(rng() - 0.5) * (TASK_FIELD.w - 0.4), (rng() - 0.5) * (TASK_FIELD.h - 0.4)]
    if (pts.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > TASK_FIELD.gap)) pts.push(p)
  }
  return { robots: pts.slice(0, n).map(([x, y]) => ({ x, y, th: 0 })), tasks: pts.slice(n) }
}

/** Every robot drives to its goal (turn toward it, slow inside 15 cm, stop at 2 cm). */
export function driveToGoals(starts: readonly Pose[], goals: readonly XY[]) {
  const { v, dt } = TASK_FIELD
  let poses = starts.map((p) => ({ ...p }))
  let wheels: V2[] = starts.map(() => [0, 0])
  const frames = [{ poses, wheels, done: poses.map(() => false) }]
  for (let k = 0; k < 2000; k++) {
    const done = poses.map((p, i) => Math.hypot(goals[i][0] - p.x, goals[i][1] - p.y) < 0.02)
    if (done.every(Boolean)) break
    const out = poses.map((p, i) => {
      if (done[i]) return { pose: p, vL: 0, vR: 0 }
      const [dx, dy] = [goals[i][0] - p.x, goals[i][1] - p.y]
      const head = Math.atan2(dy, dx)
      const aim = Math.abs(wrapPi(head - p.th)) > 0.6 ? 0 : 1
      return steerStep(p, head, aim * Math.min(v, Math.hypot(dx, dy) / 0.15 * v + 0.02), dt)
    })
    poses = out.map((o) => o.pose)
    wheels = wheels.map((w, i) => [w[0] + out[i].vL * dt, w[1] + out[i].vR * dt])
    frames.push({ poses, wheels, done })
  }
  return frames
}
