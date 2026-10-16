// Model predictive control: box-constrained QP by primal active set, condensed prediction on the balancer with motor lag, receding-horizon run.
import { clamp } from '../common'
import { BALANCER, Balancer, CART0, Cart, cartStep, torqueLimit } from '../mobility/balance'
import { Mat, Tolerances, balancerModel, brysonQ, c2d, dlqr, matMul } from './lqr'

/** Solves H·x = b for symmetric positive definite H (Cholesky). */
export function cholSolve(H: Mat, b: readonly number[]): number[] {
  const n = b.length
  const L: Mat = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = H[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j][j]
    }
  const y = Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * y[k]
    y[i] = s / L[i][i]
  }
  return y
}

export interface QpResult { u: number[]; iterations: number; active: number; converged: boolean }
/** min ½uᵀHu + fᵀu with lo ≤ u ≤ hi (H positive definite): primal active set from the clipped `start`;
 *  a bound is released when its multiplier has the wrong sign, a free entry is pinned when a step hits its bound. */
export function boxQp(H: Mat, f: readonly number[], lo: readonly number[], hi: readonly number[], start?: readonly number[]): QpResult {
  const n = f.length
  const u = (start ?? f.map(() => 0)).map((x, i) => clamp(x, lo[i], hi[i]))
  const side = u.map((x, i) => (x <= lo[i] ? -1 : x >= hi[i] ? 1 : 0))
  const maxIt = 10 * n + 20
  for (let it = 1; it <= maxIt; it++) {
    const free = side.flatMap((s, i) => (s === 0 ? [i] : []))
    const p = Array(n).fill(0)
    if (free.length) {
      const rhs = free.map((i) => -f[i] - H[i].reduce((s, h, j) => s + (side[j] ? h * u[j] : 0), 0))
      const sol = cholSolve(
        free.map((i) => free.map((j) => H[i][j])),
        rhs,
      )
      free.forEach((i, k) => (p[i] = sol[k] - u[i]))
    }
    const scale = 1 + Math.max(...u.map(Math.abs))
    if (Math.max(0, ...p.map(Math.abs)) <= 1e-10 * scale) {
      let worst = -1
      let most = 1e-9 * (1 + Math.max(...f.map(Math.abs)))
      for (let i = 0; i < n; i++) {
        if (!side[i]) continue
        const g = H[i].reduce((s, h, j) => s + h * u[j], f[i])
        const wrong = side[i] < 0 ? -g : g
        if (wrong > most) [worst, most] = [i, wrong]
      }
      if (worst < 0) return { u, iterations: it, active: side.filter((s) => s).length, converged: true }
      side[worst] = 0
      continue
    }
    let alpha = 1
    let block = -1
    for (const i of free) {
      const room = p[i] < 0 ? (lo[i] - u[i]) / p[i] : p[i] > 0 ? (hi[i] - u[i]) / p[i] : Infinity
      if (room < alpha) [alpha, block] = [room, i]
    }
    for (const i of free) u[i] += alpha * p[i]
    if (block >= 0) {
      side[block] = p[block] < 0 ? -1 : 1
      u[block] = side[block] < 0 ? lo[block] : hi[block]
    }
  }
  return { u, iterations: maxIt, active: side.filter((s) => s).length, converged: false }
}

/** The balancer with its motor lag as a fifth state, [x, ẋ, θ, θ̇, a]; input u = commanded wheel acceleration, ȧ = (u − a)/lag. */
export function laggedBalancer(bot: Balancer = BALANCER) {
  const { A: A4, B: B4 } = balancerModel(bot.h)
  const A = [...A4.map((r, i) => [...r, B4[i][0]]), [0, 0, 0, 0, -1 / bot.lag]]
  const B = [[0], [0], [0], [0], [1 / bot.lag]]
  return { A, B }
}

export interface MpcSpec {
  /** Steps in the plan. */
  horizon: number
  /** Controller period (s), a multiple of the sim step. */
  ts: number
  tol: Tolerances
  /** Weigh the plan's last state by the LQR cost-to-go P (else by Q like every other step). */
  tail: boolean
  bot?: Balancer
}
/** Condensed prediction: stacked states X = Φ·x₀ + Γ·U, cost ½UᵀHU + (F·x₀ − Gr·refs)ᵀU + const; plus the LQR gain for the same model and weights. */
export function mpcDesign(spec: MpcSpec) {
  const bot = spec.bot ?? BALANCER
  const { A, B } = laggedBalancer(bot)
  const { Ad, Bd } = c2d(A, B, spec.ts)
  const w = brysonQ(spec.tol)
  const Q = [...w.Q.map((r) => [...r, 0]), [0, 0, 0, 0, 0]]
  const r = w.R[0][0]
  const lqr = dlqr(Ad, Bd, Q, w.R)
  const N = spec.horizon
  const n = 5
  const pow: Mat[] = [Ad]
  for (let k = 1; k < N; k++) pow.push(matMul(Ad, pow[k - 1]))
  const b = Bd.map((row) => row[0])
  const AkB = [b, ...pow.slice(0, N - 1).map((M) => M.map((row) => row.reduce((s, x, j) => s + x * b[j], 0)))]
  /** Γ[k][j] = effect of u_j on x_{k+1}. */
  const gamma = (k: number, j: number) => (j <= k ? AkB[k - j] : null)
  const weight = (k: number) => (k === N - 1 && spec.tail ? lqr.P : Q)
  const H: Mat = Array.from({ length: N }, () => Array(N).fill(0))
  const F: Mat = Array.from({ length: N }, () => Array(n).fill(0))
  const Gr: Mat = Array.from({ length: N }, () => Array(N).fill(0))
  for (let k = 0; k < N; k++) {
    const W = weight(k)
    for (let i = 0; i <= k; i++) {
      const WGi = W.map((row) => row.reduce((s, x, j) => s + x * gamma(k, i)![j], 0))
      for (let j = 0; j <= k; j++) H[i][j] += gamma(k, j)!.reduce((s, x, m) => s + x * WGi[m], 0)
      for (let c = 0; c < n; c++) F[i][c] += pow[k].reduce((s, row, m) => s + row[c] * WGi[m], 0)
      Gr[i][k] = WGi[0]
    }
  }
  for (let i = 0; i < N; i++) H[i][i] += r
  return { ...spec, bot, Ad, Bd, H, F, Gr, K: lqr.K[0], P: lqr.P }
}
export type MpcDesign = ReturnType<typeof mpcDesign>

/** States x₁…x_N from x₀ under the moves `u`. */
export function predict(d: MpcDesign, x0: readonly number[], u: readonly number[]): number[][] {
  const out: number[][] = []
  let x = [...x0]
  for (const uk of u) {
    x = d.Ad.map((row, i) => row.reduce((s, a, j) => s + a * x[j], d.Bd[i][0] * uk))
    out.push(x)
  }
  return out
}

/** One plan from state `x0` = [x, ẋ, θ, θ̇, a] toward position refs r₁…r_N within lo…hi (m/s²). */
export function mpcSolve(d: MpcDesign, x0: readonly number[], refs: readonly number[], lo: readonly number[], hi: readonly number[], warm?: readonly number[]) {
  const f = d.F.map((row, i) => row.reduce((s, x, j) => s + x * x0[j], 0) - d.Gr[i].reduce((s, g, k) => s + g * refs[k], 0))
  return boxQp(d.H, f, lo, hi, warm)
}

export interface MpcPlan { t: number; u: number[]; /** LQR's move before the clip. */ want?: number; x: number[][]; lo: number[]; hi: number[]; iterations: number; active: number }
export interface MpcFrame { t: number; x: number; v: number; tilt: number; rate: number; ref: number; u: number; cmd: number; got: number; sat: boolean; fallen: boolean; plan: number }
export interface MpcSetup {
  design: MpcDesign
  seconds: number
  /** 'lqr' applies u = −K·(x − ref) for the same model and weights, clipped to the same limits. */
  mode?: 'mpc' | 'lqr'
  /** Share of the motor's torque the plan may use. */
  limit?: number
  /** Position target (m) at time t. */
  target?: (t: number) => number
  /** MPC sees the coming target values over its horizon (else only the present one, like LQR). */
  preview?: boolean
  pushes?: { at: number; kick: number }[]
}
/** Plan, apply the first move for one period, re-plan. The bounds follow the back-EMF limit at the speeds the previous plan predicted.
 *  Runs on the full balancer (`cartStep`: lag, back-EMF, falls). */
export function mpcRun(c: MpcSetup): { frames: MpcFrame[]; plans: MpcPlan[] } {
  const d = c.design
  const bot = d.bot
  const dt = bot.dt
  const every = Math.max(1, Math.round(d.ts / dt))
  const N = d.horizon
  const limit = (c.limit ?? 1) * bot.aMax
  const target = c.target ?? (() => 0)
  const pushes = (c.pushes ?? []).map((p) => ({ n: Math.round(p.at / dt), kick: p.kick }))
  const frames: MpcFrame[] = []
  const plans: MpcPlan[] = []
  let s: Cart = { ...CART0 }
  let u = 0
  let warm: number[] = Array(N).fill(0)
  let speeds: number[] = Array(N).fill(0)
  for (let k = 0; k * dt <= c.seconds + 1e-9; k++) {
    const t = k * dt
    const ref = target(t)
    if (k % every === 0 && !s.fallen) {
      const x0 = [s.x, s.v, s.tilt, s.rate, s.a]
      const vs = [s.v, ...speeds.slice(1)]
      const lo = vs.map((v) => -limit * (1 + v / bot.vMax))
      const hi = vs.map((v) => limit * (1 - v / bot.vMax))
      if (c.mode === 'lqr') {
        const want = -d.K.reduce((sum, g, i) => sum + g * (x0[i] - (i === 0 ? ref : 0)), 0)
        u = clamp(want, lo[0], hi[0])
        plans.push({ t, u: [u], want, x: [], lo, hi, iterations: 0, active: 0 })
      } else {
        const refs = Array.from({ length: N }, (_, i) => (c.preview === false ? ref : target(t + (i + 1) * d.ts)))
        const r = mpcSolve(d, x0, refs, lo, hi, warm)
        const x = predict(d, x0, r.u)
        plans.push({ t, u: r.u, x, lo, hi, iterations: r.iterations, active: r.active })
        u = r.u[0]
        warm = [...r.u.slice(1), r.u[N - 1]]
        speeds = [...x.map((p) => p[1]).slice(0, N - 1), x[N - 1][1]]
      }
    }
    const cmd = s.fallen ? 0 : u / bot.aMax
    const got = torqueLimit(cmd, s.v, bot)
    frames.push({ t, x: s.x, v: s.v, tilt: s.tilt, rate: s.rate, ref, u, cmd, got, sat: !s.fallen && Math.abs(got - cmd) > 1e-6, fallen: s.fallen, plan: plans.length - 1 })
    s = cartStep(s, cmd, dt, bot, 0, pushes.find((p) => p.n === k)?.kick ?? 0)
  }
  return { frames, plans }
}
