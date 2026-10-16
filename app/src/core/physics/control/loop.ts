// Open vs closed loop: a TT car told to "drive 2 s at 60 %" vs one steered to a distance by its encoders.
import { GEARBOXES, TT_CAR, TT_MOTOR, TT_GEAR, gearEfficiency, gearRatio, loadedSpeed } from '../actuators/dcmotor'
import { G, clamp, gaussAt } from '../common'
import { diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { ENCODERS, TT_TRACK_M, TT_WHEEL_MM, mmPerTick, ticksPerWheelRev } from '../sensors/encoder'

/** Rolling resistance by floor. */
export const ROLL_FLOORS = { tile: { name: 'Tile', crr: 0.015 }, wood: { name: 'Wood', crr: 0.03 }, carpet: { name: 'Carpet', crr: 0.15 } }
/** 2S Li-ion pack on the TT car; the timed move was tuned on a full pack, tile, no payload. */
export const DRIVE_TASK = { duty: 0.6, seconds: 2, dt: 0.005, fullV: 8.4, emptyV: 6.4, tau: 0.12, crr: ROLL_FLOORS.tile.crr }
export const ENC_MM_TICK = mmPerTick(TT_WHEEL_MM, ticksPerWheelRev(ENCODERS.hall.ppr, 4, TT_GEAR))

export interface DriveConditions {
  volts: number
  payloadKg: number
  crr: number
  /** Right wheel speed vs left − 1 (motor-to-motor spread). */
  mismatch: number
}
export const CALIBRATED: DriveConditions = { volts: DRIVE_TASK.fullV, payloadKg: 0, crr: DRIVE_TASK.crr, mismatch: 0 }

/** Steady wheel speed (m/s, signed) for `volts` at the motor with the car's weight rolling on `crr`. */
export function wheelSpeedSs(volts: number, payloadKg: number, crr: number) {
  const g = GEARBOXES.tt48
  const needN = ((TT_CAR.massKg + payloadKg) * G * crr) / TT_CAR.driven
  const loadNm = (needN * TT_CAR.wheelM) / (gearRatio(g) * gearEfficiency(g))
  return (Math.sign(volts) * loadedSpeed(Math.abs(volts), loadNm, TT_MOTOR) * TT_CAR.wheelM) / gearRatio(g)
}

/** First-order wheel response: speed relaxes toward `target` with time constant τ (heavier car → slower). */
export const wheelLag = (v: number, target: number, payloadKg: number, dt: number) => v + (target - v) * Math.min(1, dt / (DRIVE_TASK.tau * (1 + payloadKg / TT_CAR.massKg)))

/** One run's conditions: `base` plus repeatable spread for run `k` (pack ±0.1 V, floor ±15 %, motors ±2 %). */
export function trialConditions(base: DriveConditions, k: number, spread = 1): DriveConditions {
  return {
    volts: base.volts + 0.1 * spread * gaussAt(31 * k + 1),
    payloadKg: base.payloadKg,
    crr: base.crr * (1 + 0.15 * spread * gaussAt(31 * k + 2)),
    mismatch: base.mismatch + 0.02 * spread * gaussAt(31 * k + 3),
  }
}

export interface DriveFrame {
  t: number
  pose: Pose
  vL: number
  vR: number
  /** True wheel travel (m). */
  dL: number
  dR: number
  /** Encoder reading of mean travel (m, noisy). */
  meas: number
  /** Target − measured (m); open loop: target − true. */
  err: number
  /** Duty command left/right (−1…1). */
  uL: number
  uR: number
}

function step(c: DriveConditions, f: DriveFrame, uL: number, uR: number, kick: number, dt: number) {
  const vL = wheelLag(f.vL, wheelSpeedSs(uL * c.volts, c.payloadKg, c.crr), c.payloadKg, dt) + kick
  const vR = wheelLag(f.vR, wheelSpeedSs(uR * c.volts, c.payloadKg, c.crr) * (1 + c.mismatch), c.payloadKg, dt) + kick
  return { vL, vR, pose: diffStep(f.pose, vL, vR, TT_TRACK_M, dt), dL: f.dL + vL * dt, dR: f.dR + vR * dt }
}
const START: DriveFrame = { t: 0, pose: { x: 0, y: 0, th: 0 }, vL: 0, vR: 0, dL: 0, dR: 0, meas: 0, err: 0, uL: 0, uR: 0 }

/** Timed open-loop move: `duty` for `seconds`, then motors off (shorted, they brake) until `total`; `err` is against `target`. */
export function openLoopRun(c: DriveConditions, target: number, total = DRIVE_TASK.seconds + 0.8, duty = DRIVE_TASK.duty, seconds = DRIVE_TASK.seconds, dt = DRIVE_TASK.dt) {
  const run: DriveFrame[] = [{ ...START, err: target }]
  for (let i = 1; i * dt <= total + 1e-9; i++) {
    const prev = run[i - 1]
    const u = prev.t < seconds - 1e-9 ? duty : 0
    const s = step(c, prev, u, u, 0, dt)
    const meas = (s.dL + s.dR) / 2
    run.push({ t: i * dt, ...s, meas, err: target - meas, uL: u, uR: u })
  }
  return run
}

/** Where the calibrated timed move lands: the distance it was tuned for. */
export const calibratedDistance = () => openLoopRun(CALIBRATED, 0).at(-1)!.pose.x

/** Encoder reading of a wheel's travel: quantised ticks of the true travel plus `noiseM` (σ) of jitter, repeatable per sample `k`. */
export const encoderRead = (d: number, noiseM: number, k: number) => Math.round((d + noiseM * gaussAt(k)) / (ENC_MM_TICK / 1000)) * (ENC_MM_TICK / 1000)

interface ClosedSetup {
  target: number
  /** Duty per metre of distance error. */
  kp: number
  /** Duty per metre of left/right encoder difference (keeps it straight). */
  kh?: number
  noiseM?: number
  maxDuty?: number
  seconds?: number
  /** Backward shove: speed kick (m/s) at time `at`. */
  shove?: { at: number; kick: number }
  /** Control loop period (s). */
  loopS?: number
}

/** P control on encoder distance: u = Kp·(target − measured), clamped; a heading term evens the wheels. */
export function closedLoopRun(c: DriveConditions, s: ClosedSetup, dt = DRIVE_TASK.dt) {
  const { target, kp, kh = 20, noiseM = 0, maxDuty = 1, seconds = 4, shove, loopS = 0.02 } = s
  const every = Math.max(1, Math.round(loopS / dt))
  const run: DriveFrame[] = [{ ...START, err: target }]
  let u = { L: 0, R: 0, meas: 0, err: target }
  for (let i = 1; i * dt <= seconds + 1e-9; i++) {
    const prev = run[i - 1]
    if ((i - 1) % every === 0) {
      const mL = encoderRead(prev.dL, noiseM, 2 * i)
      const mR = encoderRead(prev.dR, noiseM, 2 * i + 1)
      const meas = (mL + mR) / 2
      const err = target - meas
      const fwd = clamp(kp * err, -maxDuty, maxDuty)
      const turn = kh * (mR - mL)
      u = { L: clamp(fwd + turn, -1, 1), R: clamp(fwd - turn, -1, 1), meas, err }
    }
    const kick = shove && prev.t < shove.at && prev.t + dt >= shove.at ? -shove.kick : 0
    const st = step(c, prev, u.L, u.R, kick, dt)
    run.push({ t: i * dt, ...st, meas: u.meas, err: u.err, uL: u.L, uR: u.R })
  }
  return run
}

/** Error the P loop leaves when friction stalls the motors: the duty Kp·e must exceed the stall duty. */
export function stallDuty(c: DriveConditions) {
  let lo = 0
  let hi = 1
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (wheelSpeedSs(mid * c.volts, c.payloadKg, c.crr) > 0) hi = mid
    else lo = mid
  }
  return hi
}
export const pDeadband = (c: DriveConditions, kp: number) => stallDuty(c) / kp
