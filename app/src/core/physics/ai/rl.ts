// Tabular RL on a gridworld: slip dynamics, value iteration, ε-greedy Q-learning, rollouts and policy evaluation.
import { hash01, parkMiller } from '../common'

const rngOf = (seed: number) => parkMiller(1 + Math.floor(hash01(seed) * 2147483645))

/** '.' floor, '#' wall, 'S' start, 'G' goal, 'P' pit (a drop), 'N' near, small prize; G/P/N end the episode. Rows top first; cell index y·w + x, y up. */
type GwCell = '.' | '#' | 'S' | 'G' | 'P' | 'N'
export interface GridWorld {
  w: number
  h: number
  cells: GwCell[]
  start: number
  reward: { step: number; goal: number; pit: number; near?: number }
}
/** Actions 0 N (+y), 1 E (+x), 2 S, 3 W, as navigation/maze `Dir`. */
const GDX = [0, 1, 0, -1]
const GDY = [1, 0, -1, 0]

export function parseGrid(rows: string[], reward: GridWorld['reward']): GridWorld {
  const h = rows.length
  const w = rows[0].length
  const cells: GwCell[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(rows[h - 1 - y][x] as GwCell)
  return { w, h, cells, start: Math.max(0, cells.indexOf('S')), reward }
}
export const isTerminal = (g: GridWorld, s: number) => g.cells[s] === 'G' || g.cells[s] === 'P' || g.cells[s] === 'N'
/** Cell reached by moving `a` from `s`: walls and edges keep the robot where it is. */
export function gwMove(g: GridWorld, s: number, a: number) {
  const x = (s % g.w) + GDX[a]
  const y = Math.floor(s / g.w) + GDY[a]
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return s
  const s2 = y * g.w + x
  return g.cells[s2] === '#' ? s : s2
}
const PRIZE = { G: 'goal', P: 'pit', N: 'near' } as const
const arrival = (g: GridWorld, s2: number) => {
  const k = PRIZE[g.cells[s2] as keyof typeof PRIZE]
  return g.reward.step + (k ? (g.reward[k] ?? 0) : 0)
}
type GwEnd = 'goal' | 'pit' | 'near' | 'timeout'
const endOf = (g: GridWorld, s: number): GwEnd => PRIZE[g.cells[s] as keyof typeof PRIZE] ?? 'timeout'
/** With probability `slip` the wheels skid sideways: half to each perpendicular of the chosen action. */
export function gwOutcomes(g: GridWorld, s: number, a: number, slip: number) {
  return [
    { p: 1 - slip, a },
    { p: slip / 2, a: (a + 1) % 4 },
    { p: slip / 2, a: (a + 3) % 4 },
  ]
    .filter((o) => o.p > 0)
    .map((o) => {
      const s2 = gwMove(g, s, o.a)
      return { p: o.p, moved: o.a, s2, r: arrival(g, s2), done: isTerminal(g, s2) }
    })
}
function gwStep(g: GridWorld, s: number, a: number, slip: number, rnd: () => number) {
  const u = rnd()
  const moved = u < 1 - slip ? a : u < 1 - slip / 2 ? (a + 1) % 4 : (a + 3) % 4
  const s2 = gwMove(g, s, moved)
  return { s2, moved, r: arrival(g, s2), done: isTerminal(g, s2) }
}

export type QTable = Float64Array[]
const qZeros = (g: GridWorld): QTable => g.cells.map(() => new Float64Array(4))
/** Best action; ties go to the lowest index unless `rnd` picks among them. */
export function argmaxQ(q: ArrayLike<number>, rnd?: () => number) {
  let best = -Infinity
  let ks: number[] = []
  for (let a = 0; a < 4; a++) {
    if (q[a] > best + 1e-12) [best, ks] = [q[a], [a]]
    else if (Math.abs(q[a] - best) <= 1e-12) ks.push(a)
  }
  return rnd ? ks[Math.floor(rnd() * ks.length)] : ks[0]
}
export const greedyPolicy = (Q: QTable) => Q.map((q) => argmaxQ(q))
export const valuesOf = (Q: QTable) => Q.map((q) => Math.max(q[0], q[1], q[2], q[3]))

/** Bellman optimality sweeps: Q(s,a) = Σ p [r + γ max Q(s′)] until the largest change < tol. */
export function valueIteration(g: GridWorld, gamma: number, slip: number, tol = 1e-6, maxSweeps = 2000) {
  const Q = qZeros(g)
  const V = new Float64Array(g.cells.length)
  let sweeps = 0
  for (; sweeps < maxSweeps; sweeps++) {
    let delta = 0
    for (let s = 0; s < V.length; s++) {
      if (isTerminal(g, s) || g.cells[s] === '#') continue
      for (let a = 0; a < 4; a++) Q[s][a] = gwOutcomes(g, s, a, slip).reduce((t, o) => t + o.p * (o.r + (o.done ? 0 : gamma * V[o.s2])), 0)
      const v = Math.max(...Q[s])
      delta = Math.max(delta, Math.abs(v - V[s]))
      V[s] = v
    }
    if (delta < tol) break
  }
  return { Q, V: Array.from(V), policy: greedyPolicy(Q), sweeps: sweeps + 1 }
}

interface QLearnOpts {
  episodes: number
  alpha: number
  eps: number
  gamma: number
  /** Fixed slip, or [lo, hi]: drawn fresh each episode (domain randomisation). */
  slip: number | [number, number]
  seed: number
  maxSteps?: number
  /** Initial Q; > 0 is optimistic (untried actions look good, so they get tried). */
  q0?: number
  /** Copy Q every `snapEvery` episodes (snaps[0] = all zeros). */
  snapEvery?: number
}
/** ε-greedy tabular Q-learning: Q ← Q + α (r + γ max Q(s′) − Q). Ties broken at random. */
export function qLearn(g: GridWorld, o: QLearnOpts) {
  const rnd = rngOf(o.seed)
  const Q = qZeros(g)
  if (o.q0) Q.forEach((q, s) => !isTerminal(g, s) && g.cells[s] !== '#' && q.fill(o.q0!))
  const maxSteps = o.maxSteps ?? 4 * g.cells.length
  const returns: number[] = []
  const steps: number[] = []
  const outcomes: GwEnd[] = []
  const visits = new Uint32Array(g.cells.length)
  const snaps: QTable[] = [Q.map((q) => q.slice())]
  for (let ep = 0; ep < o.episodes; ep++) {
    const slip = typeof o.slip === 'number' ? o.slip : o.slip[0] + rnd() * (o.slip[1] - o.slip[0])
    let s = g.start
    let G = 0
    let k = 0
    let end: GwEnd = 'timeout'
    for (; k < maxSteps; k++) {
      visits[s]++
      const a = rnd() < o.eps ? Math.floor(rnd() * 4) : argmaxQ(Q[s], rnd)
      const t = gwStep(g, s, a, slip, rnd)
      const target = t.r + (t.done ? 0 : o.gamma * Math.max(...Q[t.s2]))
      Q[s][a] += o.alpha * (target - Q[s][a])
      G += t.r
      s = t.s2
      if (t.done) {
        end = endOf(g, s)
        k++
        break
      }
    }
    returns.push(G)
    steps.push(k)
    outcomes.push(end)
    if (o.snapEvery && (ep + 1) % o.snapEvery === 0) snaps.push(Q.map((q) => q.slice()))
  }
  return { Q, returns, steps, outcomes, visits, snaps }
}

export interface GwStepLog {
  s: number
  a: number
  moved: number
  s2: number
  r: number
}
/** One episode following `policy` under `slip`. */
export function gwRollout(g: GridWorld, policy: readonly number[], slip: number, seed: number, maxSteps = 4 * g.cells.length) {
  const rnd = rngOf(seed)
  const log: GwStepLog[] = []
  let s = g.start
  let G = 0
  for (let k = 0; k < maxSteps && !isTerminal(g, s); k++) {
    const a = policy[s]
    const t = gwStep(g, s, a, slip, rnd)
    log.push({ s, a, moved: t.moved, s2: t.s2, r: t.r })
    G += t.r
    s = t.s2
  }
  return { log, G, end: endOf(g, s) }
}
/** Success / fall / timeout rates and mean return over `n` seeded episodes. */
export function evalPolicy(g: GridWorld, policy: readonly number[], slip: number, n: number, seed: number) {
  const tally = { goal: 0, pit: 0, near: 0, timeout: 0 }
  let G = 0
  let steps = 0
  for (let i = 0; i < n; i++) {
    const r = gwRollout(g, policy, slip, seed + i * 7919)
    tally[r.end]++
    G += r.G
    steps += r.log.length
  }
  return { goal: tally.goal / n, pit: tally.pit / n, near: tally.near / n, timeout: tally.timeout / n, meanReturn: G / n, meanSteps: steps / n }
}
/** Discounted return Σ γᵗ rₜ. */
export const discounted = (rs: readonly number[], gamma: number) => rs.reduceRight((acc, r) => r + gamma * acc, 0)
/** Trailing mean over `k` episodes. */
export const runningMean = (xs: readonly number[], k: number) => xs.map((_, i) => {
  const lo = Math.max(0, i - k + 1)
  let t = 0
  for (let j = lo; j <= i; j++) t += xs[j]
  return t / (i - lo + 1)
})
