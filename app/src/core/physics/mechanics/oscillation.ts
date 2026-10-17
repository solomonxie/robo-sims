// Oscillations: spring-mass period, damped free release, forced response and resonance.
import { G } from '../common'

/** ωn = √(k/m) rad/s. */
export const naturalW = (m: number, k: number) => Math.sqrt(k / m)
/** Period T = 2π√(m/k). */
export const springPeriod = (m: number, k: number) => 2 * Math.PI * Math.sqrt(m / k)
/** Static sag of a hanging mass, m g / k; f = √(g / sag) / 2π gives the same frequency. */
export const staticSag = (m: number, k: number) => (m * G) / k
/** Damping ratio from c: ζ = c / (2√(k m)). */
export const dampingRatio = (m: number, k: number, c: number) => c / (2 * Math.sqrt(k * m))

type DampRegime = 'none' | 'under' | 'critical' | 'over'
export const dampRegime = (zeta: number): DampRegime => (zeta <= 0 ? 'none' : Math.abs(zeta - 1) < 1e-6 ? 'critical' : zeta < 1 ? 'under' : 'over')

/** Displacement x(t) after releasing from x0 at rest. */
export function freeAt(zeta: number, wn: number, x0: number, t: number) {
  if (Math.abs(zeta - 1) < 1e-6) return x0 * (1 + wn * t) * Math.exp(-wn * t)
  if (zeta < 1) {
    const s = Math.sqrt(1 - zeta * zeta)
    const wd = wn * s
    return x0 * Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + (zeta / s) * Math.sin(wd * t))
  }
  const s = Math.sqrt(zeta * zeta - 1)
  const [p1, p2] = [wn * (zeta - s), wn * (zeta + s)]
  return (x0 * (p2 * Math.exp(-p1 * t) - p1 * Math.exp(-p2 * t))) / (p2 - p1)
}

/** Decay envelope x0·e^(−ζωn t) of an underdamped release. */
export const decayEnvelope = (zeta: number, wn: number, x0: number, t: number) => x0 * Math.exp(-zeta * wn * t)

/** Free-release summary: damped period, ratio of one peak to the next, 2 % settle time, swings above 2 %. */
export function releaseStats(zeta: number, wn: number) {
  const under = zeta < 1 && zeta > 0
  const s = Math.sqrt(Math.max(0, 1 - zeta * zeta))
  const td = under || zeta === 0 ? (2 * Math.PI) / (wn * s) : Infinity
  const ratio = under ? Math.exp((-2 * Math.PI * zeta) / s) : zeta === 0 ? 1 : 0
  let settle = Infinity
  if (zeta > 0) {
    const dt = 0.002 / wn
    const rate = under ? zeta * wn : wn * (zeta - Math.sqrt(Math.max(0, zeta * zeta - 1)))
    for (let t = (Math.log(50 / (s || 1)) + 4) / rate; t > 0; t -= dt)
      if (Math.abs(freeAt(zeta, wn, 1, t)) > 0.02) {
        settle = t + dt
        break
      }
  }
  const swings = zeta === 0 ? Infinity : under ? Math.max(0, Math.floor(Math.log(0.02) / Math.log(ratio))) : 0
  return { td, ratio, settle, swings, poles: { re: -zeta * wn, im: under || zeta === 0 ? wn * s : 0 } }
}

/** Steady amplitude of a ±F0 sine drive at ω, divided by the static stretch F0/k. */
export function ampRatio(zeta: number, r: number) {
  return 1 / Math.hypot(1 - r * r, 2 * zeta * r)
}
/** How far the mass lags the push (rad, 0…π). */
export const phaseLag = (zeta: number, r: number) => Math.atan2(2 * zeta * r, 1 - r * r)
/** Drive ratio of the amplitude peak, √(1 − 2ζ²) (0 when no peak), and the peak ratio. */
export function resonancePeak(zeta: number) {
  const r = zeta < Math.SQRT1_2 ? Math.sqrt(1 - 2 * zeta * zeta) : 0
  return { r, ratio: ampRatio(zeta, r) }
}

interface DrivenFrame {
  t: number
  x: number
  v: number
  f: number
}

/** m ẍ + c ẋ + k x = F0 sin ωt from x0 at rest, RK4 every `dt`. */
export function drivenRun({ m, k, zeta, f0 = 0, w = 0, x0 = 0, seconds, dt = 0.001 }: { m: number; k: number; zeta: number; f0?: number; w?: number; x0?: number; seconds: number; dt?: number }) {
  const c = 2 * zeta * Math.sqrt(k * m)
  const acc = (t: number, x: number, v: number) => (f0 * Math.sin(w * t) - c * v - k * x) / m
  const out: DrivenFrame[] = []
  let [x, v] = [x0, 0]
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    out.push({ t, x, v, f: f0 * Math.sin(w * t) })
    const a1 = acc(t, x, v)
    const [x2, v2] = [x + (v * dt) / 2, v + (a1 * dt) / 2]
    const a2 = acc(t + dt / 2, x2, v2)
    const [x3, v3] = [x + (v2 * dt) / 2, v + (a2 * dt) / 2]
    const a3 = acc(t + dt / 2, x3, v3)
    const [x4, v4] = [x + v3 * dt, v + a3 * dt]
    const a4 = acc(t + dt, x4, v4)
    x += ((v + 2 * v2 + 2 * v3 + v4) * dt) / 6
    v += ((a1 + 2 * a2 + 2 * a3 + a4) * dt) / 6
  }
  return out
}
