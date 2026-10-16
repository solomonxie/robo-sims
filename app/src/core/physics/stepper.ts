// Stepper motors: sine-table phase currents per microstep, rotor dynamics, step drivers (Vref, chopper, StallGuard),
// the pull-out torque curve and steps lost to too steep a ramp or too much load (open loop).
import { clamp, clamp01 } from './common'

/** 17HS4401-class NEMA17: 1.8° (50 rotor teeth), 1.5 A, 0.4 N·m holding; J = rotor + a 3D-printed arm; 24 V supply. */
export const NEMA17 = { steps: 200, teeth: 50, ratedA: 1.5, holdNm: 0.4, ohms: 1.5, henries: 2.8e-3, inertia: 3e-4, zeta: 0.1, supplyV: 24 }
export type Nema = typeof NEMA17

/** Microsteps per full step: 1 = full, 2 = half, 16 = A4988 max. */
export const stepDeg = (micro: number, m: Nema = NEMA17) => 360 / m.steps / micro
export const stepsPerRev = (micro: number, m: Nema = NEMA17) => m.steps * micro

/** Electrical angle at microstep `k`: the driver's sine table starts at 45° (both phases at 70.7 %), 90°/micro a step. */
export const tableAngle = (k: number, micro: number) => Math.PI / 4 + (k * Math.PI) / 2 / micro
/** Phase currents (fraction of the set peak) at microstep `k`: A = cos, B = sin of the table angle. */
export function phaseCurrents(k: number, micro: number) {
  const a = tableAngle(k, micro)
  return { a: Math.cos(a), b: Math.sin(a) }
}
/** Restoring torque when the rotor sits one microstep off its detent: T_hold · sin(90° / micro). */
export const torquePerMicrostep = (micro: number, m: Nema = NEMA17) => m.holdNm * Math.sin(Math.PI / 2 / micro)

/** Phase current the supply can still push at `radS`: (I·R + E)² + (I·X)² = V², E = k·ω, X = 50·ω·L; capped at `setA`. */
export function availableAmps(radS: number, setA: number, volts = NEMA17.supplyV, m: Nema = NEMA17) {
  const e = (m.holdNm / m.ratedA) * Math.abs(radS)
  if (e >= volts) return 0
  const x = m.teeth * Math.abs(radS) * m.henries
  const a = m.ohms ** 2 + x ** 2
  return Math.min(setA, (-m.ohms * e + Math.sqrt((m.ohms * e) ** 2 - a * (e ** 2 - volts ** 2))) / a)
}
/** Pull-out torque: the most the rotor can deliver at this speed before it slips out of step. */
export const pullOutNm = (radS: number, setA = NEMA17.ratedA, volts = NEMA17.supplyV, m: Nema = NEMA17) => (m.holdNm * availableAmps(radS, setA, volts, m)) / m.ratedA
export const rpmToRadS = (rpm: number) => (rpm * 2 * Math.PI) / 60
export const radSToRpm = (w: number) => (w * 60) / (2 * Math.PI)
export const fullStepsToRad = (s: number, m: Nema = NEMA17) => (s * 2 * Math.PI) / m.steps

export interface RotorState {
  th: number
  w: number
}
/** One step of the rotor (rad): pulled toward the field angle `cmd` by T_po(ω)·sin(50·(cmd − θ)), damped relative to the
 *  field speed `cmdW` while in step (no pull once it slips), against Coulomb friction `loadNm` (sticks if the pull can't beat it). Returns the motor torque. */
export function rotorStep(s: RotorState, cmd: number, cmdW: number, dt: number, loadNm = 0, setA = NEMA17.ratedA, m: Nema = NEMA17) {
  const lag = m.teeth * (cmd - s.th)
  const motor = pullOutNm(s.w, setA, m.supplyV, m) * Math.sin(lag)
  const damp = 2 * m.zeta * Math.sqrt(m.teeth * m.holdNm * m.inertia) * (s.w - cmdW) * Math.cos(lag)
  if (Math.abs(s.w) < 1e-6 && Math.abs(motor - damp) <= loadNm) {
    s.w = 0
    return motor
  }
  s.w += ((motor - damp - loadNm * Math.sign(s.w || motor)) / m.inertia) * dt
  s.th += s.w * dt
  return motor
}

export interface StepFrame {
  t: number
  /** Commanded and rotor position, full steps. */
  cmd: number
  pos: number
  ia: number
  ib: number
}

/** Recording interval of `stepperRun` and `missedStepRun` frames, s. */
export const STEP_FRAME_S = 5e-4
export const MOVE_FRAME_S = 2e-3

/** Stepping at `rate` full steps/s in `micro` microsteps: the field jumps every microstep, the rotor snaps after it. */
export function stepperRun(micro: number, rate: number, seconds: number, dt = 2e-5, m: Nema = NEMA17) {
  const s: RotorState = { th: tableAngle(0, micro) / m.teeth, w: 0 }
  const out: StepFrame[] = []
  const every = Math.max(1, Math.round(STEP_FRAME_S / dt))
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const k = Math.floor(t * rate * micro + 1e-9)
    const cmd = tableAngle(k, micro) / m.teeth
    if (i % every === 0) {
      const c = phaseCurrents(k, micro)
      out.push({ t, cmd: (cmd * m.steps) / (2 * Math.PI), pos: (s.th * m.steps) / (2 * Math.PI), ia: c.a, ib: c.b })
    }
    rotorStep(s, cmd, fullStepsToRad(rate, m), dt, 0, m.ratedA, m)
  }
  return out
}
/** Largest swing of the rotor past its commanded position, full steps (ringing after each jump). */
export const peakOvershoot = (run: StepFrame[]) => Math.max(...run.map((f) => f.pos - f.cmd))

// --- Drivers: Vref sets the current limit, the chopper holds it; StallGuard reads the load from back-EMF. ---

export type StepChip = 'a4988' | 'stealth' | 'spread'
/** Microsteps the coil sees per full step (TMC2209 interpolates 1/16 STEP pulses to 1/256), chopper ripple (fraction of peak). */
export const STEP_CHIPS: Record<StepChip, { table: number; ripple: number; senseOhm: number }> = {
  a4988: { table: 16, ripple: 0.08, senseOhm: 0.068 },
  stealth: { table: 256, ripple: 0.01, senseOhm: 0.11 },
  spread: { table: 256, ripple: 0.04, senseOhm: 0.11 },
}
/** Peak phase current from the trimmer: A4988 I = Vref / (8·Rs); TMC2209 I_rms = Vref/2.5 · 0.325 V / (Rs + 0.02 Ω) / √2. */
export function vrefAmps(chip: StepChip, vref: number) {
  const rs = STEP_CHIPS[chip].senseOhm
  return chip === 'a4988' ? vref / (8 * rs) : (vref / 2.5) * (0.325 / (rs + 0.02))
}
/** Phase A current at `u` (0…1) of an electrical cycle: the chip's sine table plus a triangle of chopper ripple. */
export function chopCurrent(chip: StepChip, u: number, peakA: number, chopsPerCycle = 48) {
  const c = STEP_CHIPS[chip]
  const steps = 4 * c.table
  const k = Math.floor(clamp01(u) * steps)
  const tri = Math.abs(((u * chopsPerCycle) % 1) * 2 - 1) * 2 - 1
  return peakA * (phaseCurrents(k - c.table / 2, c.table).a + c.ripple * tri)
}
/** RMS error of the coil current from a pure sine, % of peak: steps and ripple shake the rotor, and that is the noise. */
export function sineErrorPct(chip: StepChip, samples = 4096) {
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const u = (i + 0.5) / samples
    sum += (chopCurrent(chip, u, 1) - Math.cos(2 * Math.PI * u)) ** 2
  }
  return 100 * Math.sqrt(sum / samples)
}
/** TMC2209 StallGuard4 (StealthChop only): SG_RESULT 0…510 falls as load eats the torque margin; DIAG when ≤ 2·SGTHRS. */
export const SGTHRS = 50
export const stallGuardResult = (loadNm: number, pullNm: number) => Math.round(510 * clamp01(1 - loadNm / Math.max(pullNm, 1e-9)))
export const stallDiag = (sg: number, thrs = SGTHRS) => sg <= 2 * thrs

// --- Missed steps: a trapezoid move (AccelStepper-style) and the rotor trying to follow it. ---

/** Commanded position (full steps) and speed of a move of `dist` steps, cruise `vmax` steps/s, ramp `acc` (Infinity = none). */
export function moveProfile(t: number, dist: number, vmax: number, acc: number) {
  const ta = Number.isFinite(acc) ? Math.min(vmax / acc, Math.sqrt(dist / acc)) : 0
  const vp = Number.isFinite(acc) ? acc * ta : vmax
  const da = (vp * ta) / 2
  const tc = (dist - 2 * da) / vp
  const T = 2 * ta + tc
  if (t <= 0) return { pos: 0, v: 0, T }
  if (t < ta) return { pos: (acc * t * t) / 2, v: acc * t, T }
  if (t < ta + tc) return { pos: da + vp * (t - ta), v: vp, T }
  if (t < T) {
    const r = T - t
    return { pos: dist - (Number.isFinite(acc) ? (acc * r * r) / 2 : vp * r), v: Number.isFinite(acc) ? acc * r : vp, T }
  }
  return { pos: dist, v: 0, T }
}

export interface MoveFrame {
  t: number
  cmd: number
  pos: number
  /** Commanded and rotor speed, rpm; motor torque and what the move asks for (load + J·a), N·m. */
  cmdRpm: number
  rpm: number
  needNm: number
  pullNm: number
}

/** The rotor following a move; once it lags more than 2 full steps it falls into a later detent and those steps are lost. */
export function missedStepRun(dist: number, vmax: number, acc: number, loadNm: number, seconds: number, dt = 5e-5, m: Nema = NEMA17) {
  const s: RotorState = { th: 0, w: 0 }
  const out: MoveFrame[] = []
  const every = Math.max(1, Math.round(MOVE_FRAME_S / dt))
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const c = moveProfile(t, dist, vmax, acc)
    const cmd = fullStepsToRad(c.pos, m)
    const cmdW = fullStepsToRad(c.v, m)
    if (i % every === 0) {
      const a = (moveProfile(t + dt, dist, vmax, acc).v - c.v) / dt
      out.push({
        t,
        cmd: c.pos,
        pos: (s.th * m.steps) / (2 * Math.PI),
        cmdRpm: radSToRpm(cmdW),
        rpm: radSToRpm(s.w),
        needNm: (c.v > 0 ? loadNm : 0) + m.inertia * Math.abs(fullStepsToRad(Number.isFinite(a) ? clamp(a, -1e6, 1e6) : 0, m)),
        pullNm: pullOutNm(s.w, m.ratedA, m.supplyV, m),
      })
    }
    rotorStep(s, cmd, cmdW, dt, loadNm, m.ratedA, m)
  }
  return out
}
/** Steps lost by the end: the rotor rests a whole tooth (4 full steps) or more behind for every slip. */
export const lostSteps = (run: MoveFrame[]) => 4 * Math.round((run[run.length - 1].cmd - run[run.length - 1].pos) / 4) || 0
/** First time the rotor lagged more than 2 full steps (out of step), or null. */
export const slipAt = (run: MoveFrame[]) => run.find((f) => f.cmd - f.pos > 2)?.t ?? null
