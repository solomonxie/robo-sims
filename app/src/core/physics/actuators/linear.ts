// Linear actuators: lead and ball screws (lead, efficiency, thrust, self-locking), a 12 V screw actuator, and homing an
// axis to a limit switch (NO/NC wiring, bounce and debounce, soft limits, the crash without one).
import { DEG, clamp } from '../common'
import { Debounce, SwitchPart, bounceEdges, bouncedState, debounceStep } from '../electromechanical'
import { pullOutNm, rpmToRadS, stepsPerRev } from './stepper'

// --- Lead screw ---

export interface Screw {
  name: string
  pitchMm: number
  starts: number
  diaMm: number
  /** Thread friction: brass nut on steel ~0.2 dry; recirculating balls roll at ~0.01. */
  mu: number
  ball?: boolean
}

export const SCREWS = {
  t8l2: { name: 'T8 lead 2', pitchMm: 2, starts: 1, diaMm: 8, mu: 0.2 },
  t8l8: { name: 'T8 lead 8', pitchMm: 2, starts: 4, diaMm: 8, mu: 0.2 },
  sfu1204: { name: 'SFU1204 ball screw', pitchMm: 4, starts: 1, diaMm: 12, mu: 0.01, ball: true },
} satisfies Record<string, Screw>

/** Travel per turn: pitch × starts. */
export const screwLeadMm = (s: Screw) => s.pitchMm * s.starts
export const mmPerMicrostep = (leadMm: number, micro: number) => leadMm / stepsPerRev(micro)
export const stepsPerMm = (leadMm: number, micro: number) => stepsPerRev(micro) / leadMm
export const screwRpm = (mmS: number, leadMm: number) => (mmS / leadMm) * 60

/** Lead angle λ = atan(lead / (π·d_m)), mean diameter d_m = d − pitch/2. */
export const leadAngle = (s: Screw) => Math.atan(screwLeadMm(s) / (Math.PI * (s.diaMm - s.pitchMm / 2)))
/** Friction angle φ: the 30° trapezoidal flank wedges the nut, μ' = μ / cos 15°; balls just roll. */
export const frictionAngle = (s: Screw) => Math.atan(s.ball ? s.mu : s.mu / Math.cos(15 * DEG))
/** Torque → thrust efficiency: tan λ / tan(λ + φ). */
export const screwEfficiency = (s: Screw) => Math.tan(leadAngle(s)) / Math.tan(leadAngle(s) + frictionAngle(s))
/** Thrust → torque (back-driving) efficiency: tan(λ − φ) / tan λ, 0 when the nut can't turn the screw. */
export const backDriveEfficiency = (s: Screw) => Math.max(0, Math.tan(leadAngle(s) - frictionAngle(s)) / Math.tan(leadAngle(s)))
export const selfLocking = (s: Screw) => leadAngle(s) <= frictionAngle(s)

/** F = 2π·η·T / lead. */
export const thrustN = (torqueNm: number, leadMm: number, eff: number) => (2 * Math.PI * eff * torqueNm) / (leadMm / 1000)
/** Torque a load `forceN` puts back on the screw: F·lead·η' / 2π. */
export const backDriveNm = (forceN: number, leadMm: number, backEff: number) => (forceN * (leadMm / 1000) * backEff) / (2 * Math.PI)

/** An unpowered NEMA17 still resists with its detent (cogging) torque. */
export const NEMA_DETENT_NM = 0.015

/** NEMA17 pull-out torque with the screw turning fast enough for `mmS`. */
export const screwTorqueNm = (s: Screw, mmS: number) => pullOutNm(rpmToRadS(screwRpm(mmS, screwLeadMm(s))))
/** Most a NEMA17 on `s` can push at `mmS`. */
export const stepperThrustN = (s: Screw, mmS: number) => thrustN(screwTorqueNm(s, mmS), screwLeadMm(s), screwEfficiency(s))

/** With the driver off, does `forceN` spin the screw backwards past the detent torque? */
export const backDrives = (s: Screw, forceN: number, holdNm = NEMA_DETENT_NM) => backDriveNm(forceN, screwLeadMm(s), backDriveEfficiency(s)) > holdNm

// --- 12 V linear actuator: DC motor, spur gearbox and a self-locking screw in one tube ---

export const ACTUATOR_12V = {
  volts: 12,
  motorStallNm: 0.06,
  motorFreeRpm: 6000,
  gear: 10,
  screw: { name: 'Tr10×2', pitchMm: 2, starts: 1, diaMm: 10, mu: 0.2 } as Screw,
  strokeMm: 100,
}
export type Actuator = typeof ACTUATOR_12V

export const actuatorStallN = (a: Actuator = ACTUATOR_12V) => thrustN(a.motorStallNm * a.gear, screwLeadMm(a.screw), screwEfficiency(a.screw))
export const actuatorFreeMmS = (a: Actuator = ACTUATOR_12V) => (a.motorFreeRpm / a.gear / 60) * screwLeadMm(a.screw)
/** DC motor line: speed falls linearly with thrust, 0 at stall. */
export const actuatorMmS = (forceN: number, a: Actuator = ACTUATOR_12V) => actuatorFreeMmS(a) * Math.max(0, 1 - forceN / actuatorStallN(a))
export const actuatorThrustN = (mmS: number, a: Actuator = ACTUATOR_12V) => actuatorStallN(a) * Math.max(0, 1 - mmS / actuatorFreeMmS(a))

// --- Limit switch and homing ---

/** KW12-class lever microswitch (SPDT: COM, NO, NC). */
export const MICROSWITCH: SwitchPart = { name: 'Lever microswitch', makeS: 1.2e-3, breakS: 0.5e-3, bounces: 4 }

export type LimitWiring = 'no' | 'nc'

/** INPUT_PULLUP, COM to GND: NO reads LOW when pressed, NC reads HIGH; a broken wire floats up to HIGH. */
export const limitPinHigh = (wiring: LimitWiring, pressed: boolean, broken = false) => broken || (wiring === 'no' ? !pressed : pressed)
export const limitHit = (wiring: LimitWiring, high: boolean) => (wiring === 'no' ? !high : high)

/** Raw and debounced pin level through one press (the contact bounces as it makes or breaks), and the edges each sees. */
export function limitBounceTrace(wiring: LimitWiring, holdS: number, windowS: number, broken = false, dt = 2e-5, part: SwitchPart = MICROSWITCH) {
  const lead = windowS * 0.15
  const makes = wiring === 'no'
  const edges = bounceEdges(makes ? part.makeS : part.breakS, part.bounces, makes ? 3 : 5)
  const highBefore = limitPinHigh(wiring, false)
  let db: Debounce = { stable: highBefore, last: highBefore, sinceS: 0 }
  const out: { t: number; raw: boolean; stable: boolean }[] = []
  let rawEdges = 0
  let stableEdges = 0
  for (let i = 0; i * dt <= windowS + 1e-12; i++) {
    const t = i * dt
    const raw = broken || bouncedState(t - lead, edges, highBefore)
    const prev = out[out.length - 1]
    db = holdS > 0 ? debounceStep(db, raw, dt, holdS) : { stable: raw, last: raw, sinceS: 0 }
    if (prev && raw !== prev.raw) rawEdges++
    if (prev && db.stable !== prev.stable) stableEdges++
    out.push({ t, raw, stable: db.stable })
  }
  return { out, rawEdges, stableEdges, settleS: broken ? 0 : lead + edges[edges.length - 1] + holdS }
}

export const AXIS = { travelMm: 100, startMm: 60, endStopMm: 3, fastMmS: 25, slowMmS: 2.5, backoffMm: 4, jogMm: 130, pollS: 1e-3, seconds: 10 }
export type HomingRoutine = 'two' | 'one' | 'none'
export type HomePhase = 'fast' | 'backoff' | 'slow' | 'jog' | 'done' | 'alarm'

export interface HomeFrame {
  t: number
  /** Real carriage position (0 = switch trips) and where the firmware thinks it is (null until zeroed). */
  x: number
  believed: number | null
  phase: HomePhase
  pressed: boolean
  hit: boolean
  /** Against the frame with steps still coming: the motor grinds and skips. */
  crashed: boolean
}

/** Worst-case zero error from approaching at `mmS`: the switch is read once per loop and must hold for the debounce time. */
export const homeErrorMm = (mmS: number, holdS: number, pollS = AXIS.pollS) => mmS * (pollS + holdS)

/** A homing routine run in a 1 ms loop: seek the switch fast, back off, creep back slowly, zero; then a jog to `jogMm`,
 *  cut at the soft limit. 'none' trusts the power-on position as 0. Homing gives up after 1.5 × travel without a hit. */
export function homingRun(routine: HomingRoutine, wiring: LimitWiring, broken: boolean, holdS: number, ax = AXIS) {
  const dt = ax.pollS
  const lo = -ax.endStopMm
  const hi = ax.travelMm + ax.endStopMm
  const target = Math.min(ax.jogMm, ax.travelMm)
  let x = ax.startMm
  let offset: number | null = routine === 'none' ? ax.startMm : null
  let phase: HomePhase = routine === 'none' ? 'jog' : 'fast'
  let sought = 0
  let mark = 0
  const high0 = limitPinHigh(wiring, x <= 0, broken)
  let db: Debounce = { stable: high0, last: high0, sinceS: holdS }
  const out: HomeFrame[] = []
  for (let i = 0; i * dt <= ax.seconds + 1e-9; i++) {
    const pressed = x <= 0
    db = debounceStep(db, limitPinHigh(wiring, pressed, broken), dt, holdS)
    const hit = limitHit(wiring, db.stable)
    let v = 0
    if (phase === 'fast') {
      if (hit) {
        if (sought === 0) phase = 'alarm'
        else if (routine === 'one') [offset, phase] = [x, 'jog']
        else [mark, phase] = [x, 'backoff']
      } else if (sought >= 1.5 * ax.travelMm) phase = 'alarm'
      else v = -ax.fastMmS
    } else if (phase === 'backoff') {
      if (x - mark >= ax.backoffMm) phase = 'slow'
      else v = ax.fastMmS
    } else if (phase === 'slow') {
      if (hit) [offset, phase] = [x, 'jog']
      else v = -ax.slowMmS
    } else if (phase === 'jog' && offset !== null) {
      const left = target - (x - offset)
      if (left <= 1e-9) phase = 'done'
      else v = Math.min(ax.fastMmS, left / dt)
    }
    const want = x + v * dt
    const crashed = want < lo - 1e-9 || want > hi + 1e-9
    if (phase === 'fast') sought += Math.abs(v) * dt
    if (crashed && offset !== null) offset -= want - clamp(want, lo, hi)
    x = clamp(want, lo, hi)
    out.push({ t: i * dt, x, believed: offset === null ? null : x - offset, phase, pressed, hit, crashed })
  }
  return out
}

/** Where the routine set zero (real mm), when, and whether it ever crashed or alarmed. */
export function homingSummary(run: HomeFrame[]) {
  const z = run.findIndex((f) => f.believed !== null)
  const zero = z < 0 ? null : run[z].x - (run[z].believed ?? 0)
  return {
    zeroMm: zero,
    zeroAt: z < 0 ? null : run[z].t,
    crashAt: run.find((f) => f.crashed)?.t ?? null,
    alarmAt: run.find((f) => f.phase === 'alarm')?.t ?? null,
    end: run[run.length - 1],
  }
}
