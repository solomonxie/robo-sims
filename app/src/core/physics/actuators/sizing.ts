// Motor selection: a torque budget against each drive's T–ω curve, RMS torque over a move, winding heat under a duty cycle.
import { clamp01 } from '../common'
import { pullOutNm, rpmToRadS } from './stepper'

const G = 9.81

/** A drive as seen at its output shaft: stall torque, free speed, stall/no-load current at `volts`; winding as one thermal lump. */
export interface Drive {
  name: string
  kind: 'dc' | 'stepper' | 'servo'
  volts: number
  stallNm: number
  freeRpm: number
  ohms: number
  noLoadA: number
  /** Winding-to-air rise per watt (K/W), thermal time constant (s), insulation/plastics limit (°C). */
  kPerW: number
  tauS: number
  maxC: number
  massG: number
}

export const DRIVES = {
  tt: { name: 'TT 1:48', kind: 'dc', volts: 6, stallNm: 0.08, freeRpm: 200, ohms: 5, noLoadA: 0.15, kPerW: 25, tauS: 38, maxC: 100, massG: 30 },
  n20: { name: 'N20 1:150', kind: 'dc', volts: 6, stallNm: 0.18, freeRpm: 200, ohms: 10, noLoadA: 0.05, kPerW: 60, tauS: 20, maxC: 100, massG: 10 },
  g37: { name: '37 mm 1:30', kind: 'dc', volts: 12, stallNm: 1.4, freeRpm: 330, ohms: 2.2, noLoadA: 0.3, kPerW: 8, tauS: 120, maxC: 120, massG: 190 },
  nema17: { name: 'NEMA17', kind: 'stepper', volts: 24, stallNm: 0.4, freeRpm: 600, ohms: 1.5, noLoadA: 1.5, kPerW: 11, tauS: 900, maxC: 130, massG: 280 },
  servo: { name: 'MG996R servo', kind: 'servo', volts: 6, stallNm: 1.0, freeRpm: 62, ohms: 2.4, noLoadA: 0.2, kPerW: 30, tauS: 60, maxC: 85, massG: 55 },
} satisfies Record<string, Drive>
export type DriveKind = keyof typeof DRIVES

export const stallA = (d: Drive) => d.volts / d.ohms
/** Output torque per amp above no-load: the straight T–I line from (I₀, 0) to (I_stall, T_stall). */
export const outputKt = (d: Drive) => d.stallNm / (stallA(d) - d.noLoadA)
export const ampsAt = (d: Drive, torqueNm: number) => (d.kind === 'stepper' ? d.noLoadA : d.noLoadA + Math.max(0, torqueNm) / outputKt(d))

/** Most torque the drive gives at `rpm`: the straight DC line, or the stepper's pull-out curve. */
export function availableNm(d: Drive, rpm: number) {
  if (d.kind === 'stepper') return pullOutNm(rpmToRadS(rpm))
  return Math.max(0, d.stallNm * (1 - rpm / d.freeRpm))
}

/** Steady speed against `loadNm`, capped at `targetRpm`: a DC motor slows down its line; a stepper holds speed or slips (0). */
export function operatingRpm(d: Drive, loadNm: number, targetRpm: number) {
  if (d.kind === 'stepper') return loadNm <= availableNm(d, targetRpm) ? targetRpm : 0
  return Math.min(targetRpm, Math.max(0, d.freeRpm * (1 - loadNm / d.stallNm)))
}

// --- Torque budget ---

export type Task =
  | { kind: 'car'; massKg: number; slopeDeg: number; crr: number; wheelM: number; driven: number; accel: number; speed: number; bearingNm: number }
  | { kind: 'arm'; payloadKg: number; linkM: number; linkKg: number; alpha: number; speedRadS: number; bearingNm: number }

export const CAR_TASK = { massKg: 1.2, crr: 0.03, wheelM: 0.0325, driven: 2, accel: 0.5, speed: 0.3, bearingNm: 0.004 }
export const ARM_TASK = { linkM: 0.15, linkKg: 0.08, alpha: 6, speedRadS: 1.5, bearingNm: 0.01 }

export interface TorqueBudget {
  gravity: number
  rolling: number
  accel: number
  friction: number
  /** Steady (no acceleration) and peak torque at the output shaft per motor, and the speed it must reach. */
  steady: number
  peak: number
  targetRpm: number
}

/** Torque one motor must give: car per driven wheel on its slope, arm at the shoulder held horizontal (worst case). */
export function torqueBudget(t: Task): TorqueBudget {
  let gravity: number
  let rolling = 0
  let accel: number
  let targetRad: number
  if (t.kind === 'car') {
    const a = (t.slopeDeg * Math.PI) / 180
    const perWheel = (f: number) => (f * t.wheelM) / t.driven
    gravity = perWheel(t.massKg * G * Math.sin(a))
    rolling = perWheel(t.massKg * G * t.crr * Math.cos(a))
    accel = perWheel(t.massKg * t.accel)
    targetRad = t.speed / t.wheelM
  } else {
    gravity = armGravityNm(t, 0)
    accel = armInertia(t) * t.alpha
    targetRad = t.speedRadS
  }
  const steady = gravity + rolling + t.bearingNm
  return { gravity, rolling, accel, friction: t.bearingNm, steady, peak: steady + accel, targetRpm: (targetRad * 60) / (2 * Math.PI) }
}

type ArmTask = Extract<Task, { kind: 'arm' }>
/** Payload at the tip plus a uniform link, about the shoulder. */
export const armInertia = (t: ArmTask) => t.payloadKg * t.linkM ** 2 + (t.linkKg * t.linkM ** 2) / 3
/** Gravity torque at angle `rad` above horizontal. */
export const armGravityNm = (t: ArmTask, rad: number) => (t.payloadKg * t.linkM + (t.linkKg * t.linkM) / 2) * G * Math.cos(rad)

export type Verdict = 'ok' | 'thin' | 'slow' | 'weak' | 'stall'
export interface DriveCheck {
  /** Torque the drive gives at the target speed; achieved steady speed; what margin × peak needs. */
  available: number
  rpm: number
  need: number
  ratio: number
  verdict: Verdict
}

/**
 * Does `d` cover the budget with `margin`? stall: can't even hold the steady load; weak: moves but below target speed;
 * slow: target beyond its free speed; thin: covers the peak but not the margin; ok: margin × peak under the curve.
 */
export function checkDrive(d: Drive, b: TorqueBudget, margin: number): DriveCheck {
  const available = availableNm(d, b.targetRpm)
  const rpm = operatingRpm(d, b.steady, b.targetRpm)
  const need = b.peak * margin
  const stallLimit = d.kind === 'stepper' ? availableNm(d, 0) : d.stallNm
  const verdict: Verdict =
    b.steady >= stallLimit || rpm === 0 ? 'stall' : d.kind !== 'stepper' && b.targetRpm >= d.freeRpm ? 'slow' : available < b.peak ? 'weak' : available < need ? 'thin' : 'ok'
  return { available, rpm, need, ratio: available / Math.max(b.peak, 1e-9), verdict }
}

/** Highest arm angle (rad) the drive reaches lifting from below; null if it clears horizontal. */
export function armStallRad(d: Drive, t: ArmTask) {
  const hold = (d.kind === 'stepper' ? availableNm(d, 0) : d.stallNm) - t.bearingNm
  const g0 = armGravityNm(t, 0)
  return hold >= g0 ? null : -Math.acos(Math.max(0, hold) / g0)
}

// --- Duty cycle: an indexing move, RMS vs continuous rating ---

/** Index table: load inertia (kg·m²), friction (N·m), move angle (rad); trapezoid with equal accel / cruise / decel thirds. */
export const INDEXER = { inertia: 0.01, frictionNm: 0.02, moveRad: Math.PI / 2 }

export interface MoveSeg {
  name: string
  dur: number
  torque: number
}

/** Torque segments of one index: accel, cruise, decel in `moveS`, then `dwellS` at rest. */
export function indexMove(moveS: number, dwellS: number, ix = INDEXER) {
  const third = moveS / 3
  const vmax = (1.5 * ix.moveRad) / moveS
  const alpha = vmax / third
  const segs: MoveSeg[] = [
    { name: 'accelerate', dur: third, torque: ix.inertia * alpha + ix.frictionNm },
    { name: 'cruise', dur: third, torque: ix.frictionNm },
    { name: 'brake', dur: third, torque: -ix.inertia * alpha + ix.frictionNm },
    { name: 'dwell', dur: dwellS, torque: 0 },
  ]
  return { segs, vmax, alpha, cycle: moveS + dwellS }
}

/** T_rms = √(Σ Tᵢ²·tᵢ / Σ tᵢ): the steady torque that heats the winding as much as the whole profile. */
export function rmsTorque(segs: MoveSeg[]) {
  const total = segs.reduce((s, x) => s + x.dur, 0)
  return Math.sqrt(segs.reduce((s, x) => s + x.torque ** 2 * x.dur, 0) / Math.max(total, 1e-9))
}
export const peakTorque = (segs: MoveSeg[]) => Math.max(...segs.map((s) => Math.abs(s.torque)))

/** Shortest move ≥ `moveS` whose peak torque fits under the drive's curve at the move's top speed. */
export function feasibleMoveS(d: Drive, moveS: number, ix = INDEXER) {
  const fits = (m: number) => {
    const x = indexMove(m, 0, ix)
    return peakTorque(x.segs) <= availableNm(d, (x.vmax * 60) / (2 * Math.PI))
  }
  if (fits(moveS)) return moveS
  let lo = moveS
  let hi = moveS * 2
  for (let i = 0; i < 20 && !fits(hi); i++) hi *= 2
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) hi = mid
    else lo = mid
  }
  return hi
}

/** Index position (0…1 of the move) and segment at time `t` into the cycle. */
export function indexAt(t: number, moveS: number, dwellS: number) {
  const c = moveS + dwellS
  const tc = ((t % c) + c) % c
  const u = tc / moveS
  const pos = u >= 1 ? 1 : u < 1 / 3 ? 2.25 * u * u : u < 2 / 3 ? 0.25 + 1.5 * (u - 1 / 3) : 1 - 2.25 * (1 - u) ** 2
  const seg = u >= 1 ? 3 : Math.min(2, Math.floor(u * 3))
  return { pos, seg, tc }
}

// --- Thermal limits ---

/** Continuous current: I²R·Rth brings the winding to maxC from `ambientC`. */
export const continuousAmps = (d: Drive, ambientC = 25) => Math.sqrt(Math.max(0, d.maxC - ambientC) / (d.ohms * d.kPerW))
/** Continuous (S1) torque rating at `ambientC`: derates as √(Tmax − Ta). */
export const ratedNm = (d: Drive, ambientC = 25) => Math.max(0, outputKt(d) * (continuousAmps(d, ambientC) - d.noLoadA))
/** Copper tempco: R rises 0.39 %/K. */
export const hotOhms = (d: Drive, tempC: number) => d.ohms * (1 + 0.0039 * (tempC - 25))

export interface HeatFrame {
  t: number
  tempC: number
  amps: number
  watts: number
  on: boolean
  dead: boolean
}

/** Enamel gone this far past the limit: turns short, the winding burns open and the motor stops for good. */
export const BURN_MARGIN_C = 60

/** Winding lump under `loadNm` for `duty` of every `periodS`: C·dT/dt = I²R(T) − (T − Ta)/Rth, τ = Rth·C; burns open at maxC + BURN_MARGIN_C. */
export function heatRun(d: Drive, loadNm: number, duty: number, periodS: number, ambientC: number, seconds: number, dt = 1) {
  const frames: HeatFrame[] = []
  let tempC = ambientC
  const ampsOn = ampsAt(d, loadNm)
  let dead = false
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    dead ||= tempC >= d.maxC + BURN_MARGIN_C
    const on = !dead && (t % periodS) / periodS < clamp01(duty)
    const amps = on ? ampsOn : 0
    const watts = amps * amps * hotOhms(d, tempC)
    frames.push({ t, tempC, amps, watts, on, dead })
    const target = ambientC + watts * d.kPerW
    tempC = target + (tempC - target) * Math.exp(-dt / d.tauS)
  }
  return frames
}

/** Steady average temperature: ΔT = D·I²·R(Ta + ΔT)·Rth solved for ΔT; Infinity = thermal runaway. */
export function steadyTempC(d: Drive, loadNm: number, duty: number, ambientC: number) {
  const k = clamp01(duty) * ampsAt(d, loadNm) ** 2 * d.ohms * d.kPerW
  const den = 1 - 0.0039 * k
  return den <= 0 ? Infinity : ambientC + (k * (1 + 0.0039 * (ambientC - 25))) / den
}
export const firstAbove = (frames: HeatFrame[], c: number) => frames.find((f) => f.tempC >= c)?.t ?? null
