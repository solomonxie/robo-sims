// Filters inside a feedback loop: moving average and one-pole low-pass on the measurement (or on D only), their lag and
// noise cut, the loop margins they leave; a 3-state Kalman speed estimator for the TT wheel (counts + motor model).
import { DEG } from '../common'
import { ARM } from './arm'
import { Mat, c2d, diag, matAdd, matMul, transpose } from './lqr'
import { Gains } from './pid'
import { armLinear, loopDelay, marginsOf } from './stability'
import { WHEEL, wheelFf } from './speed'

export type MeasFilter = { kind: 'none' } | { kind: 'ma'; n: number } | { kind: 'ema'; alpha: number }
export const NO_FILTER: MeasFilter = { kind: 'none' }

/** Stateful filter: the first sample fills its memory (no start-up dip). */
export function filterRun(f: MeasFilter): (x: number) => number {
  if (f.kind === 'none') return (x) => x
  if (f.kind === 'ema') {
    let y = NaN
    return (x) => (y = Number.isNaN(y) ? x : y + f.alpha * (x - y))
  }
  const buf: number[] = []
  let sum = 0
  return (x) => {
    if (!buf.length) for (let k = 0; k < f.n; k++) [buf[k], sum] = [x, sum + x]
    sum += x - buf.shift()!
    buf.push(x)
    return sum / f.n
  }
}

/** Discrete response at ω (rad/s), sample period `dt`: magnitude and unwrapped phase (rad). */
export function filterAt(f: MeasFilter, w: number, dt = ARM.dt) {
  const th = w * dt
  if (f.kind === 'none') return { mag: 1, phase: 0 }
  if (f.kind === 'ema') {
    const re = 1 - (1 - f.alpha) * Math.cos(th)
    const im = (1 - f.alpha) * Math.sin(th)
    return { mag: f.alpha / Math.hypot(re, im), phase: -Math.atan2(im, re) }
  }
  const a = Math.abs(Math.sin(th / 2)) < 1e-12 ? 1 : Math.sin((f.n * th) / 2) / (f.n * Math.sin(th / 2))
  return { mag: Math.abs(a), phase: (-th * (f.n - 1)) / 2 - (a < 0 ? Math.PI : 0) }
}

/** Low-frequency lag (s): MA (n − 1)/2 samples, EMA (1 − α)/α samples. */
export const filterDelay = (f: MeasFilter, dt = ARM.dt) => (f.kind === 'ma' ? ((f.n - 1) * dt) / 2 : f.kind === 'ema' ? ((1 - f.alpha) * dt) / f.alpha : 0)
/** RMS out / RMS in for white noise. */
export const noiseGain = (f: MeasFilter) => (f.kind === 'ma' ? 1 / Math.sqrt(f.n) : f.kind === 'ema' ? Math.sqrt(f.alpha / (2 - f.alpha)) : 1)
/** `pidTick` D filter time constant that matches an EMA of `alpha`. */
export const dTauFor = (alpha: number, dt = ARM.dt) => (dt * (1 - alpha)) / alpha

export type FilterPlace = 'meas' | 'd'

/** Arm loop gain with the filter on the whole reading (`meas`) or only inside the D term (`d`). */
export function filteredLoopAt(g: Gains, lag: number, deg: number, w: number, f: MeasFilter, place: FilterPlace = 'meas') {
  const { K, a, kL } = armLinear(deg)
  const [kp, ki, kd] = [g.kp / DEG, g.ki / DEG, g.kd / DEG]
  const F = filterAt(f, w)
  const dF = place === 'd' ? F : { mag: 1, phase: 0 }
  const re = kp - kd * w * dF.mag * Math.sin(dF.phase)
  const im = kd * w * dF.mag * Math.cos(dF.phase) - ki / w
  const pMag = K / Math.hypot(K * kL - w * w, a * w)
  const meas = place === 'meas' ? F : { mag: 1, phase: 0 }
  return { mag: Math.hypot(re, im) * pMag * meas.mag, phase: Math.atan2(im, re) - Math.atan2(a * w, K * kL - w * w) - w * loopDelay(lag) + meas.phase }
}
export const filteredMargins = (g: Gains, lag: number, deg: number, f: MeasFilter, place: FilterPlace = 'meas') => marginsOf((w) => filteredLoopAt(g, lag, deg, w, f, place), 0.3, 1200)

// --- Kalman speed estimate: x = [wheel turns, wheel rpm, drag (rpm/s)], u = motor volts, z = encoder count. ---

export interface SpeedMeter {
  read(count: number): number
  drive(volts: number): void
}
export interface KalmanSpeed extends SpeedMeter {
  /** Speed-gain row of the last update (rpm per turn of innovation) and the speed std (rpm). */
  gain(): number
  sigma(): number
}

/** Wheel model from the feed-forward constants: rpm' = (V − kV·rpm)/kA − drag, drag a slow random walk. `accel` (rpm/s/√s)
 *  is how hard the speed may wander off the model; quantisation noise of one count is the measurement (var 1/12 count²). */
export function kalmanSpeed(cpr: number, accel: number, dt = WHEEL.loopS): KalmanSpeed {
  const f = wheelFf()
  const A: Mat = [[0, 1 / 60, 0], [0, -f.kV / f.kA, -1], [0, 0, 0]]
  const { Ad, Bd } = c2d(A, [[0], [1 / f.kA], [0]], dt)
  const At = transpose(Ad)
  const Q = diag([0, accel * accel * dt, (accel * 4) ** 2 * dt])
  const r = 1 / (12 * cpr * cpr)
  let x = [0, 0, 0]
  let P: Mat = diag([1e-6, 1, 1e4])
  let k1 = 0
  return {
    read(count) {
      const z = (count + 0.5) / cpr
      const s = P[0][0] + r
      const K = [P[0][0] / s, P[1][0] / s, P[2][0] / s]
      const inn = z - x[0]
      x = x.map((v, i) => v + K[i] * inn)
      P = P.map((row, i) => row.map((v, j) => v - K[i] * P[0][j]))
      k1 = K[1]
      return x[1]
    },
    drive(volts) {
      x = Ad.map((row, i) => row.reduce((s2, v, j) => s2 + v * x[j], 0) + Bd[i][0] * volts)
      P = matAdd(matMul(matMul(Ad, P), At), Q)
    },
    gain: () => k1,
    sigma: () => Math.sqrt(Math.max(0, P[1][1])),
  }
}
