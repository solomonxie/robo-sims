// PID: the plain clamped step (balancer, quadcopter) and a configurable one (anti-windup, D on measurement, D filter); step-response metrics; Ziegler–Nichols.
import { clamp } from '../common'

export interface Gains { kp: number; ki: number; kd: number }
export interface Pid { integ: number; prev: number; out: number; sat: boolean; p: number; i: number; d: number }
export const PID0: Pid = { integ: 0, prev: NaN, out: 0, sat: false, p: 0, i: 0, d: 0 }
/** Discrete PID clamped to ±`limit`. D uses `rate` if given (a gyro), else the error change (0 on the first step);
 *  the integral stops growing while the output is saturated (anti-windup). */
export function pidStep(s: Pid, err: number, g: Gains, dt: number, limit = Infinity, rate?: number): Pid {
  const p = g.kp * err
  const d = g.kd * (rate ?? (Number.isNaN(s.prev) ? 0 : (err - s.prev) / dt))
  const integ = s.integ + g.ki * err * dt
  const raw = p + integ + d
  const out = clamp(raw, -limit, limit)
  const sat = out !== raw
  return { integ: sat ? s.integ : integ, prev: err, out, sat, p, i: sat ? s.integ : integ, d }
}

export type AntiWindup = 'none' | 'clamp' | 'back'
export interface PidCfg extends Gains {
  limit: number
  /** clamp: stop integrating while saturated the same way; back: bleed the integral by `backGain`·(out − raw). */
  antiWindup?: AntiWindup
  backGain?: number
  /** D on −measurement instead of error: a setpoint step does not kick it. */
  dOnMeas?: boolean
  /** First-order low-pass on the D term (s); 0 = none. */
  dTau?: number
}
export interface PidMem { integ: number; prevErr: number; prevMeas: number; dF: number }
export const PID_MEM0: PidMem = { integ: 0, prevErr: NaN, prevMeas: NaN, dF: 0 }
export interface PidTerms { p: number; i: number; d: number; raw: number; out: number; sat: boolean }

export function pidTick(m: PidMem, sp: number, meas: number, c: PidCfg, dt: number): { mem: PidMem; terms: PidTerms } {
  const e = sp - meas
  const p = c.kp * e
  const slope = c.dOnMeas ? (Number.isNaN(m.prevMeas) ? 0 : -(meas - m.prevMeas) / dt) : Number.isNaN(m.prevErr) ? 0 : (e - m.prevErr) / dt
  const dTau = c.dTau ?? 0
  const d = dTau > 0 ? m.dF + (c.kd * slope - m.dF) * (dt / (dTau + dt)) : c.kd * slope
  const tryI = m.integ + c.ki * e * dt
  const raw = p + tryI + d
  const out = clamp(raw, -c.limit, c.limit)
  const sat = out !== raw
  const mode = c.antiWindup ?? 'none'
  const integ =
    mode === 'clamp' ? clamp(sat && Math.sign(e) === Math.sign(raw) ? m.integ : tryI, -c.limit, c.limit) : mode === 'back' ? tryI + (c.backGain ?? 10) * (out - raw) * dt : tryI
  return { mem: { integ, prevErr: e, prevMeas: meas, dF: d }, terms: { p, i: integ, d, raw, out, sat } }
}

export interface StepMetrics { rise: number | null; overshoot: number; peak: number; settle: number | null; final: number }
/** Step from `y0` to `y1` at sample `from`: 10→90 % rise time, overshoot (share of the step), time to stay within ±`band` of the step. */
export function stepMetrics(ys: readonly number[], dt: number, from: number, y0: number, y1: number, band = 0.02): StepMetrics {
  const span = y1 - y0
  const u = (y: number) => (y - y0) / span
  const tail = ys.slice(from)
  const at = (share: number) => tail.findIndex((y) => u(y) >= share)
  const [i10, i90] = [at(0.1), at(0.9)]
  const peak = Math.max(...tail.map(u))
  let last = -1
  tail.forEach((y, k) => {
    if (Math.abs(u(y) - 1) > band) last = k
  })
  return {
    rise: i10 < 0 || i90 < 0 ? null : (i90 - i10) * dt,
    overshoot: Math.max(0, peak - 1),
    peak: y0 + peak * span,
    settle: last === tail.length - 1 ? null : (last + 1) * dt,
    final: tail[tail.length - 1],
  }
}

/** Peaks after sample `from`: mean period and the last cycle's swing ratio (> 1 grows, < 1 dies out); null with under three peaks. */
export function swing(ys: readonly number[], dt: number, from = 0): { period: number; ratio: number } | null {
  const peaks: number[] = []
  const troughs: number[] = []
  for (let k = Math.max(1, from); k < ys.length - 1; k++) {
    if (ys[k] > ys[k - 1] && ys[k] >= ys[k + 1]) peaks.push(k)
    if (ys[k] < ys[k - 1] && ys[k] <= ys[k + 1]) troughs.push(k)
  }
  if (peaks.length < 3 || troughs.length < 2) return null
  const amp = (j: number) => {
    const k = troughs.find((t) => t > peaks[j])
    return k === undefined ? 0 : ys[peaks[j]] - ys[k]
  }
  const n = peaks.length - 1
  const [a0, a1] = [amp(n - 2), amp(n - 1)]
  return { period: ((peaks[n] - peaks[0]) * dt) / n, ratio: a0 > 0 ? a1 / a0 : 0 }
}

/** Ultimate gain: smallest P-only gain whose oscillation no longer dies out (`trial(kp)` → output samples), with its period. */
export function ultimateGain(trial: (kp: number) => readonly number[], dt: number, lo: number, hi: number, from = 0, iters = 18) {
  const sustained = (kp: number) => (swing(trial(kp), dt, from)?.ratio ?? 0) >= 0.98
  for (let k = 0; k < iters; k++) {
    const mid = (lo + hi) / 2
    if (sustained(mid)) hi = mid
    else lo = mid
  }
  return { ku: hi, tu: swing(trial(hi), dt, from)?.period ?? NaN }
}

export const ZN_RULES = {
  p: { name: 'P only', kp: 0.5, ti: Infinity, td: 0 },
  pi: { name: 'PI', kp: 0.45, ti: 1 / 1.2, td: 0 },
  classic: { name: 'Classic PID', kp: 0.6, ti: 0.5, td: 0.125 },
  some: { name: 'Some overshoot', kp: 0.33, ti: 0.5, td: 1 / 3 },
  none: { name: 'No overshoot', kp: 0.2, ti: 0.5, td: 1 / 3 },
}
export type ZnRule = keyof typeof ZN_RULES
/** Ziegler–Nichols table: Kp = a·Ku, Ti = b·Tu, Td = c·Tu → Ki = Kp/Ti, Kd = Kp·Td. */
export function zieglerNichols(ku: number, tu: number, rule: ZnRule): Gains {
  const r = ZN_RULES[rule]
  const kp = r.kp * ku
  return { kp, ki: kp / (r.ti * tu), kd: kp * r.td * tu }
}
