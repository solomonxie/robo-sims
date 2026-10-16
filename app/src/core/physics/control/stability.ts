// Stability of the PID arm loop: linearised plant, closed-loop poles (delay as a Padé), 2nd-order step formulas, Bode margins.
import { DEG } from '../common'
import { ARM } from './arm'
import { Cx, cdiv, cx, polyAdd, polyMul, polyRoots } from './linalg'
import { Gains } from './pid'

/** Arm linearised about `deg`: θ'' = K·u − a·θ' − K·kL·θ (rad, duty). */
export function armLinear(deg: number, grams = 0) {
  const K = ARM.wMax / ARM.tau
  return { K, a: 1 / ARM.tau, kL: ARM.spring + (ARM.hold + ARM.perGram * grams) * Math.cos(deg * DEG) }
}
const perRad = (g: Gains) => ({ kp: g.kp / DEG, ki: g.ki / DEG, kd: g.kd / DEG })
/** Pot lag plus half a loop tick (zero-order hold). */
export const loopDelay = (lag: number) => lag + ARM.dt / 2

/** Padé (2,2) of e^(−sT): numerator and denominator. */
const pade = (T: number) => [[1, -T / 2, (T * T) / 12], [1, T / 2, (T * T) / 12]]

/** Closed-loop poles of PID (gains per degree) on the arm at `deg` with `lag` s of measurement delay. */
export function armPoles(g: Gains, lag: number, deg: number, grams = 0): Cx[] {
  const { K, a, kL } = armLinear(deg, grams)
  const { kp, ki, kd } = perRad(g)
  const T = loopDelay(lag)
  const [nd, dd] = T > 0 ? pade(T) : [[1], [1]]
  const plant = [K * kL, a, 1]
  const ctrl = ki ? [K * ki, K * kp, K * kd] : [K * kp, K * kd]
  return polyRoots(polyAdd(polyMul(ki ? [0, ...plant] : plant, dd), polyMul(ctrl, nd)))
}
/** Slowest pole pair (largest real part, upper half); real poles give ζ ≥ 1. */
export function dominant(poles: readonly Cx[]) {
  const p = poles.filter((q) => q.im >= 0).reduce((a, b) => (b.re > a.re ? b : a))
  const wn = Math.hypot(p.re, p.im)
  return { pole: p, wn, zeta: wn ? -p.re / wn : 1 }
}

/** Ideal 2nd-order step: overshoot, peak time, time to stay within ±2 % (from the curve itself). */
export function secondOrder(zeta: number, wn: number) {
  const under = zeta < 1
  const wd = under ? wn * Math.sqrt(1 - zeta * zeta) : 0
  const dt = 0.002 / wn
  let settle = Infinity
  for (let t = 60 / (Math.max(zeta, 0.05) * wn); t > 0 && zeta > 0; t -= dt)
    if (Math.abs(secondOrderAt(zeta, wn, t) - 1) > 0.02) {
      settle = t + dt
      break
    }
  return { wd, overshoot: under ? Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) : 0, peak: under ? Math.PI / wd : Infinity, settle }
}
/** Unit-step response y(t) of ωn²/(s² + 2ζωn s + ωn²). */
export function secondOrderAt(zeta: number, wn: number, t: number) {
  if (t <= 0) return 0
  if (Math.abs(zeta - 1) < 1e-6) return 1 - (1 + wn * t) * Math.exp(-wn * t)
  if (zeta < 1) {
    const s = Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * wn * t) * (Math.cos(wn * s * t) + (zeta / s) * Math.sin(wn * s * t))
  }
  const s = Math.sqrt(zeta * zeta - 1)
  const [p1, p2] = [wn * (zeta - s), wn * (zeta + s)]
  return 1 - (p2 * Math.exp(-p1 * t) - p1 * Math.exp(-p2 * t)) / (p2 - p1)
}
/** PD gains (per degree) that put the delay-free arm's poles at ζ, ωn; negative Kd = the controller cancels motor damping. */
export function placePd(zeta: number, wn: number, deg: number, grams = 0): Gains {
  const { K, a, kL } = armLinear(deg, grams)
  return { kp: (wn * wn / K - kL) * DEG, ki: 0, kd: ((2 * zeta * wn - a) / K) * DEG }
}

/** Loop gain L(jω) = C·P·e^(−jωT): magnitude and unwrapped phase (rad). */
export function loopAt(g: Gains, lag: number, deg: number, w: number, grams = 0) {
  const { K, a, kL } = armLinear(deg, grams)
  const { kp, ki, kd } = perRad(g)
  const c = cx(kp, kd * w - ki / w)
  const p = cdiv(cx(K), cx(K * kL - w * w, a * w))
  return { mag: Math.hypot(c.re, c.im) * Math.hypot(p.re, p.im), phase: Math.atan2(c.im, c.re) - Math.atan2(a * w, K * kL - w * w) - w * loopDelay(lag) }
}

export interface Margins { wc: number | null; pm: number | null; w180: number | null; gm: number | null; delayMargin: number | null }
/** Gain margin (×), phase margin (°) at the first gain crossover, phase crossover, delay margin (s) of the arm loop. */
export const margins = (g: Gains, lag: number, deg: number, grams = 0, w0 = 0.1, w1 = 2000): Margins => marginsOf((w) => loopAt(g, lag, deg, w, grams), w0, w1)

/** Margins of any loop gain `at(ω)` → magnitude and unwrapped phase. */
export function marginsOf(at: (w: number) => { mag: number; phase: number }, w0 = 0.1, w1 = 2000): Margins {
  const cross = (f: (w: number) => number) => {
    const n = 4000
    let prev = w0
    for (let k = 1; k <= n; k++) {
      const w = w0 * (w1 / w0) ** (k / n)
      if (Math.sign(f(w)) !== Math.sign(f(prev))) {
        let [lo, hi] = [prev, w]
        for (let i = 0; i < 50; i++) {
          const mid = Math.sqrt(lo * hi)
          if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid
          else hi = mid
        }
        return Math.sqrt(lo * hi)
      }
      prev = w
    }
    return null
  }
  const wc = cross((w) => at(w).mag - 1)
  const w180 = cross((w) => at(w).phase + Math.PI)
  const pm = wc === null ? null : (at(wc).phase + Math.PI) / DEG
  return { wc, pm, w180, gm: w180 === null ? null : 1 / at(w180).mag, delayMargin: wc === null || pm === null ? null : (pm * DEG) / wc }
}
