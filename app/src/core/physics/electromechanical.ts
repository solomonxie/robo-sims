// Electromechanical parts: DC motor, relays and SSRs, switch contacts, potentiometers.
import { halton } from '../halton'
import { rcStep } from './circuits'
import { IRON_CORE, MU_0 } from './electromagnetism'
import { Diode, diodeNode, fitDiode } from './semiconductors'

// --- DC motor ---

export interface DcMotor {
  /** Winding resistance (Ω), current drawn spinning free (A), and back-EMF per rpm of the output shaft (V/rpm). */
  ohms: number
  noLoadA: number
  voltsPerRpm: number
}

/** TT gear motor (1:48): ~1 A stall and ~160 rpm free at 5 V. */
export const TT_MOTOR: DcMotor = { ohms: 5, noLoadA: 0.15, voltsPerRpm: 0.02625 }

/** Unloaded motor current at `volts`: stalled (V / R) until friction is overcome at noLoadA, then back-EMF holds it there. */
export const motorAmps = (volts: number, m: DcMotor = TT_MOTOR) => Math.min(volts / m.ohms, m.noLoadA)

/** Free-running speed: back-EMF = V − I·R. */
export const motorRpm = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, volts - m.noLoadA * m.ohms) / m.voltsPerRpm

export const RPM_PER_RADS = 60 / (2 * Math.PI)

/** Spur gearbox: tooth ratio per stage and efficiency per mesh. TT: 1:48 in three stages. */
export interface Gearbox {
  stages: number[]
  meshEff: number
}
export const GEARBOXES = {
  direct: { stages: [], meshEff: 1 },
  tt48: { stages: [3, 4, 4], meshEff: 0.9 },
  tt120: { stages: [4, 5, 6], meshEff: 0.9 },
} satisfies Record<string, Gearbox>
export type GearKind = keyof typeof GEARBOXES

export const gearRatio = (g: Gearbox) => g.stages.reduce((a, b) => a * b, 1)
export const gearEfficiency = (g: Gearbox) => g.meshEff ** g.stages.length

/** Back-EMF constant at the armature (V per rad/s) = torque constant (N·m/A); TT_MOTOR's volts are per output rpm. */
export const motorK = (m: DcMotor = TT_MOTOR) => (m.voltsPerRpm * RPM_PER_RADS) / gearRatio(GEARBOXES.tt48)
export const backEmf = (radS: number, m: DcMotor = TT_MOTOR) => motorK(m) * radS
/** V = I·R + kω. */
export const armatureAmps = (volts: number, radS: number, m: DcMotor = TT_MOTOR) => (volts - backEmf(radS, m)) / m.ohms
export const stallAmps = (volts: number, m: DcMotor = TT_MOTOR) => volts / m.ohms
/** Brush and bearing drag, what the no-load current pays for. */
export const frictionNm = (m: DcMotor = TT_MOTOR) => motorK(m) * m.noLoadA
/** Torque left at the shaft on the straight T–ω line. */
export const shaftTorque = (volts: number, radS: number, m: DcMotor = TT_MOTOR) => motorK(m) * armatureAmps(volts, radS, m) - frictionNm(m)
export const stallTorque = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, shaftTorque(volts, 0, m))
export const freeSpeed = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, volts - m.noLoadA * m.ohms) / motorK(m)

/** Steady armature speed against a load of `loadNm` + `dampNm`·ω; 0 when it can't break away. */
export function loadedSpeed(volts: number, loadNm: number, m: DcMotor = TT_MOTOR, dampNm = 0) {
  const k = motorK(m)
  return Math.max(0, (shaftTorque(volts, 0, m) - loadNm) / ((k * k) / m.ohms + dampNm))
}

export interface MotorPoint {
  radS: number
  rpm: number
  amps: number
  emf: number
  torque: number
  powerIn: number
  powerOut: number
  eff: number
}

export function motorPoint(volts: number, radS: number, m: DcMotor = TT_MOTOR): MotorPoint {
  const amps = armatureAmps(volts, radS, m)
  const torque = shaftTorque(volts, radS, m)
  const powerIn = volts * amps
  const powerOut = Math.max(0, torque * radS)
  return { radS, rpm: radS * RPM_PER_RADS, amps, emf: backEmf(radS, m), torque, powerIn, powerOut, eff: powerIn > 0 ? powerOut / powerIn : 0 }
}

/** Mechanical power peaks at half the free speed. */
export const peakPower = (volts: number, m: DcMotor = TT_MOTOR) => motorPoint(volts, freeSpeed(volts, m) / 2, m)

/** Efficiency peaks where I = √(I₀·I_stall). */
export function peakEfficiency(volts: number, m: DcMotor = TT_MOTOR) {
  const amps = Math.sqrt(m.noLoadA * stallAmps(volts, m))
  return motorPoint(volts, (volts - amps * m.ohms) / motorK(m), m)
}

/** TT rotor plus the car reflected through 1:48 (kg·m²). */
export const TT_INERTIA = 2.5e-7

/** Mechanical time constant τ = J·R / k². */
export const motorTau = (inertia = TT_INERTIA, m: DcMotor = TT_MOTOR) => (inertia * m.ohms) / motorK(m) ** 2

/** Speed `t` s after switching on from rest (inductance ignored): ω∞·(1 − e^(−t/τ)). */
export const spinUp = (volts: number, t: number, loadNm = 0, inertia = TT_INERTIA, m: DcMotor = TT_MOTOR) =>
  loadedSpeed(volts, loadNm, m) * (1 - Math.exp(-t / motorTau(inertia, m)))

/** Share of armature current in each coil of a delta-wound 3-slot rotor at angle `theta` (coil k's arm at θ + 2πk/3,
 *  brushes on the ±y axis): 2/3 through the coil most across the brushes, 1/3 back through the other two in series. */
export function coilShares(theta: number) {
  const s = [0, 1, 2].map((k) => Math.sin(theta + (2 * Math.PI * k) / 3))
  const across = s.reduce((best, v, k) => (Math.abs(v) > Math.abs(s[best]) + 1e-9 ? k : best), 0)
  const sign = Math.sign(s[across])
  return s.map((_, k) => (k === across ? (2 * sign) / 3 : -sign / 3))
}

// --- Stalled motor heating ---

/** Winding as one thermal lump: heat capacity, rise per watt, copper tempco; the end cap softens at maxC. */
export const TT_THERMAL = { jPerK: 1.5, kPerW: 25, ambientC: 25, maxC: 100, tempco: 0.0039 }
export const windingOhms = (tempC: number, m: DcMotor = TT_MOTOR) => m.ohms * (1 + TT_THERMAL.tempco * (tempC - TT_THERMAL.ambientC))

/** Resettable PTC fuse (0.5 A hold) as a fuse lump; once tripped it passes a trickle until power is removed. */
export const PTC_050 = { ratedA: 0.5, minMeltA: 0.75, tauS: 3, trickleA: 0.03 }
/** Driver current limit (DRV8871-style ILIM). */
export const DRIVER_LIMIT_A = 0.5

export type StallGuard = 'none' | 'ptc' | 'limit'
export interface StallFrame {
  t: number
  amps: number
  tempC: number
  watts: number
  tripped: boolean
}

/** Locked rotor on `volts` for `seconds`: I = V / R(T) heats the winding, R rises; the guard limits or cuts I. */
export function stallRun(volts: number, guard: StallGuard, seconds = 90, dt = 0.1, m: DcMotor = TT_MOTOR) {
  const T = TT_THERMAL
  const frames: StallFrame[] = []
  let tempC = T.ambientC
  let ptc = 0
  let tripped = false
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const r = windingOhms(tempC, m)
    let amps = volts / r
    if (guard === 'limit') amps = Math.min(amps, DRIVER_LIMIT_A)
    if (guard === 'ptc') {
      if (!tripped) {
        const target = (amps / PTC_050.minMeltA) ** 2
        ptc = target + (ptc - target) * Math.exp(-dt / PTC_050.tauS)
        tripped = ptc >= 1
      }
      if (tripped) amps = PTC_050.trickleA
    }
    const watts = amps * amps * r
    frames.push({ t: i * dt, amps, tempC, watts, tripped })
    const target = T.ambientC + watts * T.kPerW
    tempC = target + (tempC - target) * Math.exp(-dt / (T.jPerK * T.kPerW))
  }
  return frames
}

// --- Gearbox on a robot ---

/** Small 2WD car: mass, wheel radius, rolling resistance, driven wheels. */
export const TT_CAR = { massKg: 0.8, wheelM: 0.0325, crr: 0.04, driven: 2 }
const G = 9.81

/** One driven wheel on a slope of `slopeRad`: motor speed and current, wheel rpm, car speed and the pull it needs/can give. */
export function wheelDrive(volts: number, g: Gearbox, slopeRad: number, m: DcMotor = TT_MOTOR) {
  const n = gearRatio(g)
  const eff = gearEfficiency(g)
  const needN = (TT_CAR.massKg * G * (Math.sin(slopeRad) + TT_CAR.crr * Math.cos(slopeRad))) / TT_CAR.driven
  const loadNm = (needN * TT_CAR.wheelM) / (n * eff)
  const radS = loadedSpeed(volts, loadNm, m)
  const wheelRadS = radS / n
  return {
    ratio: n,
    eff,
    motorRpm: radS * RPM_PER_RADS,
    amps: radS > 0 ? (loadNm + frictionNm(m)) / motorK(m) : stallAmps(volts, m),
    wheelRpm: wheelRadS * RPM_PER_RADS,
    speed: wheelRadS * TT_CAR.wheelM,
    needN,
    maxN: (stallTorque(volts, m) * n * eff) / TT_CAR.wheelM,
    wheelNm: needN * TT_CAR.wheelM,
    loadNm,
  }
}

// --- Relays ---

export interface Relay {
  /** Rated coil volts, coil resistance (Ω) and inductance (H). */
  coilV: number
  ohms: number
  henries: number
  /** Coil turns, pole-face area (m²), and the air gap to the armature open and (effective) closed, m. */
  turns: number
  poleM2: number
  openGapM: number
  closedGapM: number
  /** Return-spring force on the armature (N) and the armature's flight time between the contacts (s). */
  springN: number
  travelS: number
  /** Contact rating (A) and closed contact resistance (Ω). */
  contactA: number
  contactOhms: number
}

/** Songle SRD-05VDC-SL-C, the blue relay on hobby modules: 5 V, 70 Ω coil, 10 A contacts. */
export const SRD_05: Relay = {
  coilV: 5,
  ohms: 70,
  henries: 0.1,
  turns: 1000,
  poleM2: 2e-5,
  openGapM: 0.45e-3,
  closedGapM: 0.07e-3,
  springN: 0.15,
  travelS: 2e-3,
  contactA: 10,
  contactOhms: 0.03,
}

export const coilAmps = (volts: number, r: Relay) => volts / r.ohms

/** Pull of the coil on the armature across `gapM`: B = μ₀NI / g (up to the iron's saturation), F = B²A / 2μ₀, newtons. */
export function relayPull(amps: number, gapM: number, r: Relay) {
  const b = Math.min(IRON_CORE.saturation, (MU_0 * r.turns * Math.abs(amps)) / gapM)
  return (b * b * r.poleM2) / (2 * MU_0)
}

/** Coil current whose pull across `gapM` just matches the spring. */
const balanceAmps = (gapM: number, r: Relay) => (gapM * Math.sqrt((2 * MU_0 * r.springN) / r.poleM2)) / (MU_0 * r.turns)

/** Current that pulls the armature in across the open gap. */
export const pullInAmps = (r: Relay) => balanceAmps(r.openGapM, r)

/** Current below which the spring wins even with the gap closed: the armature drops out. */
export const dropOutAmps = (r: Relay) => balanceAmps(r.closedGapM, r)

/** Armature state with `amps` in the coil: pulls in at pull-in, holds until it falls below drop-out. */
export const relayLatch = (closed: boolean, amps: number, r: Relay) => (closed ? amps > dropOutAmps(r) : amps >= pullInAmps(r))

/** Time for a coil's current to climb from 0 to `amps` towards `finalAmps`: τ·ln(I∞ / (I∞ − I)); never if out of reach. */
export const coilRiseTime = (amps: number, finalAmps: number, ohms: number, henries: number) =>
  amps >= finalAmps ? Infinity : (henries / ohms) * Math.log(finalAmps / (finalAmps - amps))

/** Time for a coil's current to fall from `i0` to `amps` with `clampV` across it pushing back: dI/dt = −(R·I + Vc) / L. */
export const coilDecayTime = (i0: number, amps: number, ohms: number, henries: number, clampV: number) =>
  (henries / ohms) * Math.log((i0 + clampV / ohms) / (amps + clampV / ohms))

/** Switch-on to contacts made at coil `volts`: the current climbs to pull-in, then the armature flies. */
export const operateTime = (volts: number, r: Relay) => coilRiseTime(pullInAmps(r), coilAmps(volts, r), r.ohms, r.henries) + r.travelS

/** Switch-off to contacts released, `clampV` across the coil (a flyback diode's drop, or a breakdown above the supply). */
export const releaseTime = (clampV: number, r: Relay, volts = r.coilV) =>
  coilDecayTime(coilAmps(volts, r), dropOutAmps(r), r.ohms, r.henries, clampV) + r.travelS

/** Heat in closed contacts carrying `amps` (rms): I²R. */
export const contactHeat = (amps: number, r: Relay) => amps * amps * r.contactOhms

export interface Ssr {
  /** Input: series resistor (Ω), the IR LED, and the LED current that turns the output on. */
  inOhms: number
  led: Diode
  triggerA: number
  /** Output triac's on-state drop, V. */
  dropV: number
}

/** Fotek SSR-25DA-style zero-cross AC solid-state relay: 3–32 V DC in, triac out. */
export const SSR_25DA: Ssr = { inOhms: 300, led: fitDiode(1.2, 2, 0.01), triggerA: 4e-3, dropV: 1.6 }

export const ssrInputAmps = (vin: number, s: Ssr) => Math.max(0, diodeNode(vin, s.inOhms, s.led).sourceA)
export const ssrTriggered = (vin: number, s: Ssr) => ssrInputAmps(vin, s) >= s.triggerA

/** Average heat in the triac carrying a sine of `amps` rms: Vdrop × I_avg, I_avg = (2√2 / π)·I_rms. */
export const ssrHeat = (amps: number, s: Ssr) => (s.dropV * amps * 2 * Math.SQRT2) / Math.PI

/** First zero crossing at or after `t` of an `hz` sine rising through 0 at t = 0. */
export const nextZeroCross = (t: number, hz: number) => Math.ceil(t * 2 * hz - 1e-9) / (2 * hz)

/** Zero-cross SSR on a resistive load, input on over [tOn, tOff): the triac fires at the next zero crossing and, once the
 *  input drops, conducts until the current next passes zero. */
export const zeroCrossConducts = (t: number, tOn: number, tOff: number, hz: number) => t >= nextZeroCross(tOn, hz) && t < nextZeroCross(tOff, hz)

// --- Switches: contact bounce and debouncing ---

export interface SwitchPart {
  name: string
  /** Make (press) and break (release) bounce, s, and how many times the contact reopens on make. */
  makeS: number
  breakS: number
  bounces: number
}

/** Typical bounce, after Ganssle's switch survey (mean ~1.6 ms, worst seen 6.2 ms on make). */
export const SWITCHES: Record<'tact' | 'toggle' | 'worn', SwitchPart> = {
  tact: { name: '6 mm tactile', makeS: 1.5e-3, breakS: 0.4e-3, bounces: 5 },
  toggle: { name: 'Toggle switch', makeS: 3e-3, breakS: 1.2e-3, bounces: 8 },
  worn: { name: 'Worn tactile', makeS: 6e-3, breakS: 2e-3, bounces: 12 },
}

/** Times (s) the contact changes state: the first touch at 0, then `bounces` open/close pairs, gaps shrinking, the last
 *  at `durationS`. Deterministic for a `seed`. */
export function bounceEdges(durationS: number, bounces: number, seed = 1): number[] {
  const w = Array.from({ length: 2 * bounces }, (_, k) => 0.8 ** Math.floor(k / 2) * (k % 2 ? 1 : 0.6) * (0.5 + halton(seed * 13 + k + 1, 3)))
  const total = w.reduce((a, b) => a + b, 0)
  let t = 0
  return [0, ...w.map((x) => (t += (x / total) * durationS))]
}

/** State at `t` of a contact that was `before` and toggles at every edge (t < 0: still `before`). */
export const bouncedState = (t: number, edges: number[], before: boolean) => (edges.filter((e) => e <= t).length % 2 === 1 ? !before : before)

/** RC debounce node: pull-up `pullOhms` to `vdd` charges `farads`; the closed switch discharges it through `dischargeOhms`. */
export function rcDebounceStep(vc: number, closed: boolean, vdd: number, pullOhms: number, dischargeOhms: number, farads: number, dt: number) {
  if (!closed) return rcStep(vc, vdd, pullOhms * farads, dt)
  const r = (pullOhms * dischargeOhms) / (pullOhms + dischargeOhms)
  return rcStep(vc, (vdd * dischargeOhms) / (pullOhms + dischargeOhms), r * farads, dt)
}

/** 74HC14 Schmitt input at 3.3 V as fractions of VDD: rises past ~1.8 V, falls past ~1.0 V. */
export const SCHMITT_HI = 0.55
export const SCHMITT_LO = 0.3

/** Does a Schmitt input read high? Between the thresholds it keeps what it read before. */
export const schmittHigh = (wasHigh: boolean, volts: number, vdd: number) => (volts >= SCHMITT_HI * vdd ? true : volts <= SCHMITT_LO * vdd ? false : wasHigh)

export interface Debounce {
  stable: boolean
  last: boolean
  sinceS: number
}

/** Software debounce: accept a new input level only once it has held for `holdS`. */
export function debounceStep(s: Debounce, raw: boolean, dt: number, holdS: number): Debounce {
  const sinceS = raw === s.last ? s.sinceS + dt : 0
  return { last: raw, sinceS, stable: sinceS >= holdS ? raw : s.stable }
}

/** Code toggle on a (debounced) button: flip `on` at each press edge. */
export const latchToggle = (on: boolean, wasPressed: boolean, pressed: boolean) => (pressed && !wasPressed ? !on : on)

// --- Potentiometer ---

/** Mechanical sweep of a typical rotary pot (RV16, RV09). */
export const POT_SWEEP_DEG = 270

export type Taper = 'linear' | 'log'

/** Fraction of the track between pin 1 and the wiper at `turn` (0..1 of the sweep). Log (A) taper: 10 % at half turn. */
export function taperFraction(turn: number, taper: Taper) {
  const u = Math.min(1, Math.max(0, turn))
  return taper === 'linear' ? u : (81 ** u - 1) / 80
}

/** Pot as a divider: pin 3 at `vin`, pin 1 at 0 V, nothing drawn from the wiper. */
export function potDivider(vin: number, totalOhms: number, turn: number, taper: Taper = 'linear') {
  const f = taperFraction(turn, taper)
  const lower = f * totalOhms
  return { fraction: f, lower, upper: totalOhms - lower, vout: vin * f, amps: vin / totalOhms }
}

/** Attenuation in dB of an output fraction (−∞ at 0). */
export const attenuationDb = (fraction: number) => 20 * Math.log10(fraction)

/** How loud (or bright) a fraction feels, 0..1: decibels mapped linearly over the usable `rangeDb`. */
export const perceivedLevel = (fraction: number, rangeDb = 40) => Math.min(1, Math.max(0, 1 + attenuationDb(fraction) / rangeDb))
