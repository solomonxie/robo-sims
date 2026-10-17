// Differential equations: a rule rate = f(state) stepped forward (Euler, semi-implicit Euler, RK4); step size, error order and stability.
import { freeAt } from '../mechanics/oscillation'
import { Mat2 } from './matrices'
import { eig2 } from './linearalgebra'

type OdeState = readonly number[]
type OdeRate = (t: number, y: OdeState) => number[]
export const ODE_METHODS = { euler: 'Euler', semi: 'Semi-implicit', rk4: 'RK4' } as const
export type OdeMethod = keyof typeof ODE_METHODS

const axpy = (y: OdeState, k: OdeState, h: number) => y.map((v, i) => v + h * k[i])

/** One step of size h. 'semi' needs y = [x, v] with x' = v: v updates first, x moves with the new v. */
export function odeStep(method: OdeMethod, f: OdeRate, t: number, y: OdeState, h: number): number[] {
  if (method === 'euler') return axpy(y, f(t, y), h)
  if (method === 'semi') {
    const v = y[1] + h * f(t, y)[1]
    return [y[0] + h * v, v]
  }
  const k1 = f(t, y)
  const k2 = f(t + h / 2, axpy(y, k1, h / 2))
  const k3 = f(t + h / 2, axpy(y, k2, h / 2))
  const k4 = f(t + h, axpy(y, k3, h))
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

/** Fixed steps of h from t = 0 while t ≤ T. */
export function odeRun(method: OdeMethod, f: OdeRate, y0: OdeState, h: number, T: number) {
  const n = Math.floor(T / h + 1e-9)
  const ts = [0]
  const ys: number[][] = [[...y0]]
  for (let i = 0; i < n; i++) {
    ys.push(odeStep(method, f, ts[i], ys[i], h))
    ts.push((i + 1) * h)
  }
  return { ts, ys }
}

/** Arrow grid of a 2D field: at nx × ny points of [x0, x1] × [y0, y1], `dir(x, y)` = [dx, dy]. */
export function fieldGrid(x: [number, number], y: [number, number], nx: number, ny: number, dir: (x: number, y: number) => [number, number]) {
  const out: { at: [number, number]; d: [number, number] }[] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const at: [number, number] = [x[0] + ((i + 0.5) / nx) * (x[1] - x[0]), y[0] + ((j + 0.5) / ny) * (y[1] - y[0])]
      out.push({ at, d: dir(...at) })
    }
  return out
}

// --- Euler integration: a motor spinning up (1 state) and an undamped spring-mass (2 states). ---

/** Motor + wheel: J·dω/dt = τ − b·ω → free speed τ/b = 30 rad/s, time constant J/b = 0.3 s. */
export const SPIN = { torque: 0.03, b: 0.001, J: 3e-4, T: 1.2 }
const spinRate: OdeRate = (_t, [w]) => [(SPIN.torque - SPIN.b * w) / SPIN.J]
/** Exact ω after t, starting from ω0. */
export const spinFrom = (w0: number, t: number) => SPIN.torque / SPIN.b + (w0 - SPIN.torque / SPIN.b) * Math.exp((-SPIN.b * t) / SPIN.J)

/** Undamped spring-mass, 1 Hz: m·x″ = −k·x. */
export const SWING = { m: 0.4, k: 16, x0: 0.02, T: 2 }
export const swingW = Math.sqrt(SWING.k / SWING.m)
/** x′ = v, v′ = −(k·x + c·v)/m. */
export const springRate =
  (m: number, k: number, c = 0): OdeRate =>
  (_t, [x, v]) => [v, -(k * x + c * v) / m]
export const springEnergy = (m: number, k: number, [x, v]: OdeState) => 0.5 * k * x * x + 0.5 * m * v * v
/** Exact undamped state after t from [x, v]: a turn of (x, v/ω) by ωt. */
export function swingFrom([x, v]: OdeState, t: number): number[] {
  const [c, s] = [Math.cos(swingW * t), Math.sin(swingW * t)]
  return [x * c + (v / swingW) * s, -x * swingW * s + v * c]
}

export const SYSTEMS = { motor: 'Motor spin-up', spring: 'Spring-mass' } as const
export type OdeSystem = keyof typeof SYSTEMS

/** Exact state after t from y for a system (what one step should have reached). */
export const exactFrom = (sys: OdeSystem, y: OdeState, t: number) => (sys === 'motor' ? [spinFrom(y[0], t)] : swingFrom(y, t))

/** Euler with step h on a system: steps, exact states at the same times, error of the first state, energy ratio E/E0 (spring). */
export function eulerView(sys: OdeSystem, h: number) {
  const motor = sys === 'motor'
  const T = motor ? SPIN.T : SWING.T
  const f = motor ? spinRate : springRate(SWING.m, SWING.k)
  const y0 = motor ? [0] : [SWING.x0, 0]
  const { ts, ys } = odeRun('euler', f, y0, h, T)
  const exact = ts.map((t) => exactFrom(sys, y0, t))
  const errs = ys.map((y, i) => y[0] - exact[i][0])
  const E0 = springEnergy(SWING.m, SWING.k, y0)
  const energy = motor ? [] : ys.map((y) => springEnergy(SWING.m, SWING.k, y) / E0)
  const steps = ys.map((y, i) => ({ y, rate: f(ts[i], y), local: exactFrom(sys, y, h) }))
  return { T, h, f, ts, ys, exact, errs, energy, steps, maxErr: Math.max(...errs.map(Math.abs)), growth: motor ? 1 : Math.sqrt(1 + (swingW * h) ** 2) }
}

// --- Step size: a damped spring (camera mast) at several dt and methods. ---

export const MAST = { m: 0.4, zeta: 0.1, x0: 0.02, T: 1.5 }
const mastRate = (w: number, zeta: number) => springRate(1, w * w, 2 * zeta * w)

/** One-step matrix of a method on the linear oscillator x″ + 2ζω·x′ + ω²·x = 0: [x, v] ← M·[x, v]. */
function stepMatrix(method: OdeMethod, w: number, zeta: number, h: number): Mat2 {
  const f = mastRate(w, zeta)
  const [a, c] = odeStep(method, f, 0, [1, 0], h)
  const [b, d] = odeStep(method, f, 0, [0, 1], h)
  return [a, b, c, d]
}

/** Growth per step |λ|max: above 1 the numbers grow every step whatever the physics does. */
export const stepGain = (method: OdeMethod, w: number, zeta: number, h: number) => eig2(stepMatrix(method, w, zeta, h)).radius

/** Largest stable step (s): scan up, then bisect where the gain crosses 1. */
export function criticalStep(method: OdeMethod, w: number, zeta: number) {
  let [lo, hi] = [0, 0.05 / w]
  while (stepGain(method, w, zeta, hi) <= 1) [lo, hi] = [hi, hi * 1.5]
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (stepGain(method, w, zeta, mid) <= 1) lo = mid
    else hi = mid
  }
  return lo
}

/** Max |x − exact| (m) over [0, T] of a run at step h. */
export function stepError(method: OdeMethod, w: number, zeta: number, h: number, T = MAST.T) {
  const { ts, ys } = odeRun(method, mastRate(w, zeta), [MAST.x0, 0], h, T)
  return Math.max(...ys.map((y, i) => Math.abs(y[0] - freeAt(zeta, w, MAST.x0, ts[i]))))
}

/** Mast of stiffness k at step h with a method: run vs exact, gain per step, critical steps and error curves over `hs` for every method. */
export function stepSizeView(method: OdeMethod, k: number, h: number, hs: readonly number[]) {
  const w = Math.sqrt(k / MAST.m)
  const { ts, ys } = odeRun(method, mastRate(w, MAST.zeta), [MAST.x0, 0], h, MAST.T)
  const xs = ys.map((y) => y[0])
  const exact = ts.map((t) => freeAt(MAST.zeta, w, MAST.x0, t))
  const all = Object.keys(ODE_METHODS) as OdeMethod[]
  const crit = Object.fromEntries(all.map((m) => [m, criticalStep(m, w, MAST.zeta)])) as Record<OdeMethod, number>
  const curves = Object.fromEntries(all.map((m) => [m, { err: hs.map((s) => stepError(m, w, MAST.zeta, s)), gain: hs.map((s) => stepGain(m, w, MAST.zeta, s)) }])) as Record<OdeMethod, { err: number[]; gain: number[] }>
  return { w, ts, xs, exact, error: Math.max(...xs.map((x, i) => Math.abs(x - exact[i]))), gain: stepGain(method, w, MAST.zeta, h), crit, curves, stable: h <= crit[method] }
}
