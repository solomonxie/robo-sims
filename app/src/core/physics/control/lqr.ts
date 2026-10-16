// State-space and LQR: small dense matrices, zero-order-hold discretisation, discrete Riccati by iteration, LQR on the balancer.
import { G } from '../common'
import { BALANCER, Balancer, CART0, Cart, cartStep, torqueLimit } from '../mobility/balance'
import { Cx, polyRoots } from './stability'

export type Mat = number[][]
export const eye = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)))
export const diag = (d: readonly number[]): Mat => d.map((x, i) => d.map((_, j) => (i === j ? x : 0)))
export const transpose = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]))
export const matMul = (a: Mat, b: Mat): Mat => a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)))
export const matAdd = (a: Mat, b: Mat, k = 1): Mat => a.map((r, i) => r.map((x, j) => x + k * b[i][j]))
export const matScale = (a: Mat, k: number): Mat => a.map((r) => r.map((x) => x * k))
const normInf = (a: Mat) => Math.max(...a.map((r) => r.reduce((s, x) => s + Math.abs(x), 0)))

/** Inverse by Gauss–Jordan with partial pivoting. */
export function matInv(a: Mat): Mat {
  const n = a.length
  const m = a.map((r, i) => [...r, ...eye(n)[i]])
  for (let c = 0; c < n; c++) {
    const p = m.slice(c).reduce((best, r, k) => (Math.abs(r[c]) > Math.abs(m[best][c]) ? c + k : best), c)
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c]
    m[c] = m[c].map((x) => x / d)
    for (let r = 0; r < n; r++) if (r !== c) m[r] = m[r].map((x, j) => x - m[r][c] * m[c][j])
  }
  return m.map((r) => r.slice(n))
}

/** e^M by scaling and squaring of a Taylor series. */
export function expm(m: Mat): Mat {
  const s = Math.max(0, Math.ceil(Math.log2(normInf(m) || 1)) + 1)
  const a = matScale(m, 2 ** -s)
  let term = eye(m.length)
  let sum = eye(m.length)
  for (let k = 1; k <= 16; k++) {
    term = matScale(matMul(term, a), 1 / k)
    sum = matAdd(sum, term)
  }
  for (let i = 0; i < s; i++) sum = matMul(sum, sum)
  return sum
}

/** Exact discretisation for an input held over each tick: Ad = e^(A·dt), Bd = ∫e^(A·t)dt·B. */
export function c2d(A: Mat, B: Mat, dt: number) {
  const n = A.length
  const m = B[0].length
  const big = [...A.map((r, i) => [...r, ...B[i]]), ...Array.from({ length: m }, () => Array(n + m).fill(0))]
  const e = expm(matScale(big, dt))
  return { Ad: e.slice(0, n).map((r) => r.slice(0, n)), Bd: e.slice(0, n).map((r) => r.slice(n)) }
}

/** Discrete LQR: iterates P ← Q + AᵀPA − AᵀPB(R + BᵀPB)⁻¹BᵀPA from P = Q until it stops moving; u = −K·x. */
export function dlqr(A: Mat, B: Mat, Q: Mat, R: Mat, tol = 1e-11, maxIt = 200000) {
  const At = transpose(A)
  const Bt = transpose(B)
  let P = Q
  let K: Mat = []
  for (let it = 1; it <= maxIt; it++) {
    const PA = matMul(P, A)
    const PB = matMul(P, B)
    K = matMul(matInv(matAdd(R, matMul(Bt, PB))), matMul(Bt, PA))
    const next = matAdd(matAdd(Q, matMul(At, PA)), matMul(matMul(At, PB), K), -1)
    const moved = normInf(matAdd(next, P, -1)) / (normInf(next) || 1)
    P = next
    if (moved < tol) return { K, P, iterations: it, converged: true }
  }
  return { K, P, iterations: maxIt, converged: false }
}

/** Characteristic polynomial det(sI − M), constant first (Faddeev–LeVerrier). */
export function charPoly(m: Mat): number[] {
  const n = m.length
  const c = Array(n + 1).fill(0)
  c[n] = 1
  let Mk = eye(n).map((r) => r.map(() => 0))
  for (let k = 1; k <= n; k++) {
    Mk = matAdd(matMul(m, Mk), eye(n), c[n - k + 1])
    const AM = matMul(m, Mk)
    c[n - k] = -AM.reduce((s, r, i) => s + r[i], 0) / k
  }
  return c
}
export const eigenvalues = (m: Mat): Cx[] => polyRoots(charPoly(m))

/** The balancer near upright, state [x, ẋ, θ, θ̇] (m, m/s, rad, rad/s), input wheel acceleration a (m/s²):
 *  ẍ = a, θ̈ = (g·θ − a)/h. */
export function balancerModel(h = BALANCER.h) {
  const A = [
    [0, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1],
    [0, 0, G / h, 0],
  ]
  const B = [[0], [1], [0], [-1 / h]]
  return { A, B }
}
export const STATE_NAMES = ['x', 'ẋ', 'θ', 'θ̇'] as const

/** Bryson's rule: weight = 1 / (largest error you accept)²; `pos` m, `speed` m/s, `tilt` rad, `rate` rad/s, `effort` m/s². */
export interface Tolerances { pos: number; speed: number; tilt: number; rate: number; effort: number }
export const brysonQ = (t: Tolerances) => ({ Q: diag([t.pos, t.speed, t.tilt, t.rate].map((x) => 1 / (x * x))), R: [[1 / (t.effort * t.effort)]] })

/** LQR gains (a per unit of each state) for the balancer at its loop period, plus closed-loop poles of the continuous model (1/s). */
export function balancerLqr(t: Tolerances, h = BALANCER.h, dt = BALANCER.dt) {
  const { A, B } = balancerModel(h)
  const { Ad, Bd } = c2d(A, B, dt)
  const { Q, R } = brysonQ(t)
  const r = dlqr(Ad, Bd, Q, R)
  const k = r.K[0]
  return { k, P: r.P, iterations: r.iterations, converged: r.converged, poles: closedPoles(k, h) }
}
/** Poles of A − B·K for gains `k` on [x, ẋ, θ, θ̇]. */
export const closedPoles = (k: readonly number[], h = BALANCER.h) => {
  const { A, B } = balancerModel(h)
  return eigenvalues(matAdd(A, matMul(B, [[...k]]), -1))
}

export interface StateFrame { t: number; x: number; v: number; tilt: number; rate: number; ref: number; terms: number[]; cmd: number; got: number; sat: boolean; fallen: boolean; cost: number }
export interface StateSetup {
  /** Gains on [x, ẋ, θ, θ̇], wheel acceleration per unit. */
  k: readonly number[]
  seconds: number
  start?: number
  x0?: number
  /** Position target (m) at time t; the error feeds x. */
  target?: (t: number) => number
  pushes?: { at: number; kick: number }[]
  /** Weights for the running cost Σ(xᵀQx + a²R)·dt. */
  cost?: Tolerances
  bot?: Balancer
}
/** u = −K·(state − target) at the loop rate on the full balancer (motor lag, back-EMF torque limit, falls). */
export function stateRun(c: StateSetup): StateFrame[] {
  const bot = c.bot ?? BALANCER
  const dt = bot.dt
  const w = c.cost ? brysonQ(c.cost) : null
  let s: Cart = { ...CART0, x: c.x0 ?? 0, tilt: c.start ?? 0 }
  let cost = 0
  const out: StateFrame[] = []
  const pushes = (c.pushes ?? []).map((p) => ({ n: Math.round(p.at / dt), kick: p.kick }))
  for (let n = 0; n * dt <= c.seconds + 1e-9; n++) {
    const t = n * dt
    const ref = c.target?.(t) ?? 0
    const e = [s.x - ref, s.v, s.tilt, s.rate]
    const terms = e.map((x, i) => (s.fallen ? 0 : (-c.k[i] * x) / bot.aMax))
    const cmd = terms.reduce((a, b) => a + b, 0)
    const got = torqueLimit(cmd, s.v, bot)
    if (w && !s.fallen) cost += (e.reduce((a, x, i) => a + w.Q[i][i] * x * x, 0) + w.R[0][0] * (got * bot.aMax) ** 2) * dt
    out.push({ t, x: s.x, v: s.v, tilt: s.tilt, rate: s.rate, ref, terms, cmd, got, sat: !s.fallen && got !== cmd, fallen: s.fallen, cost })
    s = cartStep(s, cmd, dt, bot, 0, pushes.find((p) => p.n === n)?.kick ?? 0)
  }
  return out
}
