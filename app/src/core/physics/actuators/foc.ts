// Field-oriented control: Clarke/Park transforms, PI current loops, SVPWM duties and a surface-magnet PMSM in d/q.
// Angles are electrical (rad); phase axes A 0, B 120°, C 240° as in bldc.ts. Clarke is amplitude-invariant.
import { commutationStep, phaseState } from './bldc'
import { clamp, clamp01, wrap2pi } from '../common'

const R3 = Math.sqrt(3)
const THIRD = (2 * Math.PI) / 3

export type Abc = [number, number, number]
export interface AlphaBeta { alpha: number; beta: number }
export interface Dq { d: number; q: number }

export const clarke = (a: number, b: number, c: number): AlphaBeta => ({ alpha: (2 / 3) * (a - b / 2 - c / 2), beta: (b - c) / R3 })
export const invClarke = (alpha: number, beta: number): Abc => [alpha, -alpha / 2 + (R3 / 2) * beta, -alpha / 2 - (R3 / 2) * beta]
/** Into the rotor frame: d along the magnet (angle `theta`), q 90° ahead. */
export const park = (alpha: number, beta: number, theta: number): Dq => ({
  d: alpha * Math.cos(theta) + beta * Math.sin(theta),
  q: -alpha * Math.sin(theta) + beta * Math.cos(theta),
})
export const invPark = (d: number, q: number, theta: number): AlphaBeta => ({
  alpha: d * Math.cos(theta) - q * Math.sin(theta),
  beta: d * Math.sin(theta) + q * Math.cos(theta),
})
/** Three sinusoidal phase currents of a vector `amps` long at angle `angle`. */
export const sineCurrents = (amps: number, angle: number): Abc => [0, 1, 2].map((k) => amps * Math.cos(angle - k * THIRD)) as Abc
/** Phase currents that put (d, q) in the rotor frame at `theta`. */
export const dqToAbc = (d: number, q: number, theta: number): Abc => {
  const v = invPark(d, q, theta)
  return invClarke(v.alpha, v.beta)
}
export const abcToDq = ([a, b, c]: Abc, theta: number): Dq => {
  const v = clarke(a, b, c)
  return park(v.alpha, v.beta, theta)
}
/** Six-step drive at rotor angle `theta`: `amps` in one phase, out of another, third floating. */
export const sixStepCurrents = (amps: number, theta: number): Abc => [0, 1, 2].map((k) => amps * phaseState(commutationStep(theta), k)) as Abc

/** SVPWM by min-max injection: phase duties 0…1 for a voltage vector (V); linear up to |v| = vbus/√3. */
export function svpwm(alpha: number, beta: number, vbus: number): Abc {
  const v = invClarke(alpha, beta)
  const mid = (Math.max(...v) + Math.min(...v)) / 2
  return v.map((x) => clamp01(0.5 + (x - mid) / vbus)) as Abc
}
/** Largest voltage vector SVPWM makes without clipping. */
export const svMaxVolts = (vbus: number) => vbus / R3
/** Hexagon sector 1…6 the vector sits in. */
export const svSector = (alpha: number, beta: number) => Math.min(6, Math.floor(wrap2pi(Math.atan2(beta, alpha)) / (Math.PI / 3)) + 1)

export interface Pi { integ: number; out: number; sat: boolean }
/** PI with clamped output; the integral stops growing while saturated (anti-windup). */
export function piStep(s: Pi, err: number, kp: number, ki: number, dt: number, limit: number): Pi {
  const integ = s.integ + ki * err * dt
  const raw = kp * err + integ
  const out = clamp(raw, -limit, limit)
  return { integ: out === raw ? integ : s.integ, out, sat: out !== raw }
}
/** Gains that cancel the R/L pole: closed-loop first order at `bwHz`. */
export const piGains = (bwHz: number, ohms: number, henry: number) => ({ kp: henry * 2 * Math.PI * bwHz, ki: ohms * 2 * Math.PI * bwHz })

/** Gimbal-size outrunner (≈ 5010) on 6S: Ω, H, Wb (flux linkage), pole pairs, V. */
export const FOC_MOTOR = { ohms: 0.2, ld: 4e-4, lq: 4e-4, psi: 0.008, pairs: 7, vbus: 24 }
export type Pmsm = typeof FOC_MOTOR
export const pmsmTorque = (id: number, iq: number, m: Pmsm = FOC_MOTOR) => 1.5 * m.pairs * (m.psi * iq + (m.ld - m.lq) * id * iq)
export const pmsmEmf = (we: number, m: Pmsm = FOC_MOTOR) => we * m.psi
/** One Euler step of the d/q current equations at electrical speed `we` (rad/s). */
export function pmsmStep(i: Dq, v: Dq, we: number, dt: number, m: Pmsm = FOC_MOTOR): Dq {
  const dd = (v.d - m.ohms * i.d + we * m.lq * i.q) / m.ld
  const dq = (v.q - m.ohms * i.q - we * (m.ld * i.d + m.psi)) / m.lq
  return { d: i.d + dd * dt, q: i.q + dq * dt }
}
export const rpmToWe = (rpm: number, pairs = FOC_MOTOR.pairs) => (rpm / 60) * 2 * Math.PI * pairs

export interface FocFrame {
  t: number
  theta: number
  iqRef: number
  id: number
  iq: number
  idSeen: number
  iqSeen: number
  vd: number
  vq: number
  duty: Abc
  sat: boolean
  torque: number
}
export const FOC_LOOP_S = 5e-5

/** Current loop at `rpm` (held by the load): Iq steps from 0 to `iqCmd` at `stepAt`. The controller sees the rotor at
 *  θ + `errRad` (encoder offset, observer lag), measures through Clarke/Park, runs two PIs (Id → 0, Iq → cmd), limits
 *  the vector to the SVPWM circle and drives the plant through inverse Park, SVPWM and the bridge. Starts settled. */
export function focRun(iqCmd: number, bwHz: number, errRad: number, { rpm = 1000, stepAt = 1e-3, seconds = 8e-3, sub = 10 } = {}, m: Pmsm = FOC_MOTOR) {
  const we = rpmToWe(rpm, m.pairs)
  const { kp, ki } = piGains(bwHz, m.ohms, m.ld)
  const vmax = svMaxVolts(m.vbus)
  let i: Dq = { d: 0, q: 0 }
  let pd: Pi = { integ: 0, out: 0, sat: false }
  let pq: Pi = { integ: pmsmEmf(we, m), out: 0, sat: false }
  const out: FocFrame[] = []
  for (let k = 0; k * FOC_LOOP_S <= seconds + 1e-12; k++) {
    const t = k * FOC_LOOP_S
    const theta = we * t
    const seen = abcToDq(dqToAbc(i.d, i.q, theta), theta + errRad)
    const iqRef = t >= stepAt ? iqCmd : 0
    pd = piStep(pd, 0 - seen.d, kp, ki, FOC_LOOP_S, vmax)
    pq = piStep(pq, iqRef - seen.q, kp, ki, FOC_LOOP_S, vmax)
    const mag = Math.hypot(pd.out, pq.out)
    const k1 = mag > vmax ? vmax / mag : 1
    const vab = invPark(pd.out * k1, pq.out * k1, theta + errRad)
    const duty = svpwm(vab.alpha, vab.beta, m.vbus)
    const v = abcToDq(duty.map((x) => x * m.vbus) as Abc, theta)
    out.push({ t, theta, iqRef, id: i.d, iq: i.q, idSeen: seen.d, iqSeen: seen.q, vd: pd.out * k1, vq: pq.out * k1, duty, sat: k1 < 1 || pd.sat || pq.sat, torque: pmsmTorque(i.d, i.q, m) })
    for (let s = 0; s < sub; s++) i = pmsmStep(i, v, we, FOC_LOOP_S / sub, m)
  }
  return out
}
/** First time after `stepAt` the true Iq reaches 90 % of its final value. */
export function iqRiseTime(run: FocFrame[], stepAt = 1e-3) {
  const end = run[run.length - 1].iq
  const hit = run.find((f) => f.t >= stepAt && Math.abs(f.iq) >= 0.9 * Math.abs(end))
  return end === 0 || !hit ? null : hit.t - stepAt
}
