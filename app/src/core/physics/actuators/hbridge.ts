// H-bridge: four switches around a DC motor, bipolar vs MOSFET drivers, PWM decay modes, shoot-through and dead time.
import { clamp01 } from '../common'
import { DcMotor, TT_INERTIA, TT_MOTOR, frictionNm, freeSpeed, motorK } from './dcmotor'
import { tb6612Drop } from '../mcu/firmware'
import { l298nDrop } from '../power/budget'
import { AMBIENT_C } from '../regulators'

// --- Four switches: Q1/Q2 left leg (high/low), Q3/Q4 right leg. ---

export type HSwitch = 'q1' | 'q2' | 'q3' | 'q4'
export type Closed = Record<HSwitch, boolean>
export type BridgeMode = 'forward' | 'reverse' | 'brake' | 'coast' | 'shoot'
/** Small MOSFET bridge on a 6 V pack; `loopOhm` = cell + wiring, all that limits a short. */
export const HBRIDGE = { vs: 6, rdsOhm: 0.1, loopOhm: 0.15 }

export const closed = (...on: HSwitch[]): Closed => ({ q1: on.includes('q1'), q2: on.includes('q2'), q3: on.includes('q3'), q4: on.includes('q4') })
/** Legs with both switches closed: each is a dead short across the supply. */
export const shortedLegs = (c: Closed) => Number(c.q1 && c.q2) + Number(c.q3 && c.q4)

export function bridgeMode(c: Closed): BridgeMode {
  if (shortedLegs(c)) return 'shoot'
  if (c.q1 && c.q4) return 'forward'
  if (c.q3 && c.q2) return 'reverse'
  if ((c.q2 && c.q4) || (c.q1 && c.q3)) return 'brake'
  return 'coast'
}

/** Motor current (+ = left to right) at armature speed `radS`, and the supply short through shorted legs. */
export function bridgeAmps(c: Closed, radS: number, vs = HBRIDGE.vs, m: DcMotor = TT_MOTOR) {
  const mode = bridgeMode(c)
  const legs = shortedLegs(c)
  const shootA = legs ? vs / ((2 * HBRIDGE.rdsOhm) / legs + HBRIDGE.loopOhm) : 0
  const drive = mode === 'forward' ? vs : mode === 'reverse' ? -vs : 0
  const motorA = mode === 'coast' || mode === 'shoot' ? 0 : (drive - motorK(m) * radS) / (m.ohms + 2 * HBRIDGE.rdsOhm)
  return { mode, motorA, shootA, fetW: shootA ? ((shootA / legs) ** 2) * HBRIDGE.rdsOhm : motorA ** 2 * HBRIDGE.rdsOhm }
}

/** One step of the rotor: J dω/dt = k·I − friction (friction only opposes motion, never drives it). */
export function bridgeStep(radS: number, c: Closed, dt: number, vs = HBRIDGE.vs, m: DcMotor = TT_MOTOR, inertia = TT_INERTIA) {
  const sub = Math.max(1, Math.ceil(dt / 2e-4))
  let w = radS
  for (let k = 0; k < sub; k++) {
    const t = motorK(m) * bridgeAmps(c, w, vs, m).motorA
    const f = frictionNm(m)
    const h = dt / sub
    if (w === 0 && Math.abs(t) <= f) continue
    const next = w + ((t - Math.sign(w || t) * f) * h) / inertia
    w = w !== 0 && Math.sign(next) !== Math.sign(w) && Math.abs(t) <= f ? 0 : next
  }
  return w
}

export interface BridgeFrame {
  t: number
  radS: number
  motorA: number
}
/** Switches set at t = 0: drive modes start from rest, brake / coast / short from free-running forward. */
export function bridgeRun(c: Closed, seconds = 0.6, dt = 0.002, vs = HBRIDGE.vs): BridgeFrame[] {
  const mode = bridgeMode(c)
  let w = mode === 'forward' || mode === 'reverse' ? 0 : freeSpeed(vs)
  const out: BridgeFrame[] = []
  for (let k = 0; k <= Math.round(seconds / dt); k++) {
    out.push({ t: k * dt, radS: w, motorA: bridgeAmps(c, w, vs).motorA })
    w = bridgeStep(w, c, dt, vs)
  }
  return out
}

/** Time until |ω| first drops under 1 % of free speed, or Infinity. */
export function stopTime(frames: BridgeFrame[], vs = HBRIDGE.vs) {
  const f = frames.find((x) => Math.abs(x.radS) < 0.01 * freeSpeed(vs))
  return f ? f.t : Infinity
}

// --- L298N vs modern drivers ---

export type DriverChip = 'l298n' | 'tb6612' | 'drv8833'
export interface Driver {
  name: string
  switches: string
  /** Continuous amps per channel. */
  maxA: number
  /** Junction rise per watt on its module (heatsink or copper pad). */
  kPerW: number
  drop: (amps: number) => number
}
export const DRIVERS: Record<DriverChip, Driver> = {
  l298n: { name: 'L298N', switches: 'bipolar (2 × Vce(sat))', maxA: 2, kPerW: 20, drop: l298nDrop },
  tb6612: { name: 'TB6612FNG', switches: 'MOSFET, 0.5 Ω high + low', maxA: 1.2, kPerW: 50, drop: tb6612Drop },
  drv8833: { name: 'DRV8833', switches: 'MOSFET, 0.36 Ω high + low', maxA: 1.5, kPerW: 40, drop: (a) => 0.36 * a },
}

/** Bridge drop, volts left for the motor, heat in the chip, efficiency and steady junction temperature. */
export function driverLoss(chip: DriverChip, amps: number, vs: number) {
  const d = DRIVERS[chip]
  const drop = Math.min(vs, d.drop(amps))
  const lossW = drop * amps
  return { drop, motorV: vs - drop, lossW, efficiency: vs > 0 ? (vs - drop) / vs : 0, tempC: AMBIENT_C + lossW * d.kPerW, overA: amps > d.maxA }
}


// --- Decay modes: what the bridge does with the motor current during PWM off-time. ---

export type Decay = 'slow' | 'fast'
/** TT motor winding inductance and the body/flyback diode drop. */
export const DECAY = { henries: 1.5e-3, diodeV: 0.8 }

const ohmsOf = (m: DcMotor) => m.ohms + 2 * HBRIDGE.rdsOhm

/** Current after `t` s from `i0` with `volts` across the motor (back-EMF `emf` opposing); fast-decay off-time clamps at 0. */
function segment(i0: number, volts: number, emf: number, t: number, m: DcMotor, floor: boolean) {
  const r = ohmsOf(m)
  const target = (volts - emf) / r
  const i = target + (i0 - target) * Math.exp((-t * r) / DECAY.henries)
  return floor ? Math.max(0, i) : i
}

/** Off-time: slow decay shorts the motor through both low sides (0 V); fast decay drives it back into the supply via two diodes. */
const offVolts = (mode: Decay, vs: number) => (mode === 'slow' ? 0 : -(vs + 2 * DECAY.diodeV))

function currentAt(mode: Decay, duty: number, hz: number, emf: number, vs: number, i0: number, t: number, m: DcMotor) {
  const on = duty / hz
  const fast = mode === 'fast'
  if (t <= on) return segment(i0, vs, emf, t, m, fast)
  return segment(segment(i0, vs, emf, on, m, fast), offVolts(mode, vs), emf, t - on, m, fast)
}

/** Steady PWM current: one period sampled from the on-edge, its mean and peak-to-peak ripple. */
export function decayCurrent(mode: Decay, duty: number, hz: number, emf: number, vs = HBRIDGE.vs, samples = 120, m: DcMotor = TT_MOTOR) {
  const d = clamp01(duty)
  let i0 = 0
  for (let k = 0; k < 400; k++) {
    const next = currentAt(mode, d, hz, emf, vs, i0, 1 / hz, m)
    if (Math.abs(next - i0) < 1e-7) break
    i0 = next
  }
  const amps = Array.from({ length: samples }, (_, k) => currentAt(mode, d, hz, emf, vs, i0, k / (samples - 1) / hz, m))
  const mean = amps.reduce((a, b) => a + b, 0) / samples
  return { amps, mean, ripple: Math.max(...amps) - Math.min(...amps) }
}

/** Free-running speed at `duty`: where the mean current just pays for friction (bisection on ω). */
export function decaySpeed(mode: Decay, duty: number, hz: number, vs = HBRIDGE.vs, m: DcMotor = TT_MOTOR) {
  const need = m.noLoadA
  const meanAt = (w: number) => decayCurrent(mode, duty, hz, motorK(m) * w, vs, 60, m).mean
  if (meanAt(0) <= need) return 0
  let lo = 0
  let hi = vs / motorK(m)
  for (let k = 0; k < 32; k++) {
    const mid = (lo + hi) / 2
    if (meanAt(mid) > need) lo = mid
    else hi = mid
  }
  return lo
}

// --- Shoot-through: one leg's low side turning off while its high side turns on. ---

/** Logic-level MOSFET leg (22 mΩ) on a 7.4 V pack; switching delays in ns, PWM at 20 kHz. */
export const LEG = { vs: 7.4, rdsOhm: 0.022, loopOhm: 0.1, tdOnNs: 30, trNs: 40, tdOffNs: 120, tfNs: 60, hz: 20000 }

/** Channel conduction 0..1, `tNs` after its gate was commanded on or off. */
export function fetConduction(tNs: number, on: boolean) {
  return on ? clamp01((tNs - LEG.tdOnNs) / LEG.trNs) : 1 - clamp01((tNs - LEG.tdOffNs) / LEG.tfNs)
}

/** Dead time that just avoids overlap: the slow turn-off minus the quick turn-on. */
export const safeDeadNs = () => LEG.tdOffNs + LEG.tfNs - LEG.tdOnNs

/** At `tNs` after the low-side gate goes off (high side commanded on `deadNs` later): both channels and the short current. */
export function legAt(tNs: number, deadNs: number) {
  const lo = fetConduction(tNs, false)
  const hi = tNs < deadNs ? 0 : fetConduction(tNs - deadNs, true)
  const amps = lo > 0 && hi > 0 ? LEG.vs / (LEG.rdsOhm / lo + LEG.rdsOhm / hi + LEG.loopOhm) : 0
  return { lo, hi, amps }
}

/** One edge integrated at 1 ns: peak short current, overlap, energy, and heat at two edges per PWM period. */
export function shootThrough(deadNs: number, hz = LEG.hz, spanNs = 600) {
  let peakA = 0
  let joules = 0
  let overlapNs = 0
  for (let t = 0; t < spanNs; t++) {
    const { amps } = legAt(t + 0.5, deadNs)
    peakA = Math.max(peakA, amps)
    joules += LEG.vs * amps * 1e-9
    if (amps > 0) overlapNs++
  }
  return { peakA, joules, overlapNs, watts: 2 * hz * joules }
}
