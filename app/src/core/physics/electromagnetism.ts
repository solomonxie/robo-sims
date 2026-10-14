// Electric fields and magnetism.
import { Vec3, cross, inverseSquare } from '../fields'
import { Diode, diodeNode, fitDiode } from './semiconductors'

export const COULOMB_K = 8.9875517923e9 // N·m²/C²
export const EPSILON_0 = 8.8541878128e-12 // F/m

/** Coulomb's law F = k·q₁q₂ / r², newtons; positive repels, negative attracts. */
export const coulombForce = (q1: number, q2: number, r: number) => (COULOMB_K * q1 * q2) / (r * r)

/** Field of a point charge at distance r: E = k·q / r², N/C (= V/m). */
export const pointField = (q: number, r: number) => (COULOMB_K * q) / (r * r)

/** Field of point charges (C, positions in m) at p, superposed: N/C as a vector. */
export const chargesField = (charges: { q: number; at: Vec3 }[], p: Vec3) => inverseSquare(charges, p, COULOMB_K)

/** Force on a test charge in a field: F = q·E. */
export const forceInField = (q: number, field: number) => q * field

/** Relative permittivity εr of common capacitor dielectrics. */
export const DIELECTRIC = { air: 1, ptfe: 2.1, mica: 6 }
export type Dielectric = keyof typeof DIELECTRIC

/** Parallel plates: C = ε₀·εr·A / d. */
export const plateCapacitance = (areaM2: number, gapM: number, er = 1) => (EPSILON_0 * er * areaM2) / gapM

/** Uniform field between plates: E = V / d. */
export const plateField = (volts: number, gapM: number) => volts / gapM

/** Q = C·V. */
export const capacitorCharge = (farads: number, volts: number) => farads * volts

/** Energy stored in the field: U = ½·C·V². */
export const capacitorEnergy = (farads: number, volts: number) => 0.5 * farads * volts * volts

// --- Magnetism ---

export const MU_0 = 1.25663706212e-6 // T·m/A
export const EARTH_B_H = 20e-6 // horizontal part of Earth's field in Europe, T

/** Straight wire: B = μ₀I / 2πr, tesla (signed with I). */
export const wireB = (amps: number, r: number) => (MU_0 * amps) / (2 * Math.PI * r)

/** Compass needle's turn from north when a field `b` pushes across Earth's: tan θ = B / B_earth, radians. */
export const compassDeflection = (b: number, earth = EARTH_B_H) => Math.atan2(b, earth)

/** Soft-iron rod core: effective μr of an open rod (far below the metal's thousands) and where it saturates, T. */
export const IRON_CORE = { mur: 200, saturation: 1.6 }

/** Long solenoid: B = μ₀·μr·n·I with n = N / L, capped at the core's saturation. */
export function solenoidB(turns: number, lengthM: number, amps: number, core?: { mur: number; saturation: number }) {
  const b = MU_0 * (core?.mur ?? 1) * (turns / lengthM) * amps
  return core ? Math.sign(b) * Math.min(Math.abs(b), core.saturation) : b
}

// --- Inductors ---

/** Long solenoid: L = μ₀·μr·N²·A / l, henries. */
export const solenoidInductance = (turns: number, lengthM: number, radiusM: number, mur = 1) =>
  (MU_0 * mur * turns * turns * Math.PI * radiusM * radiusM) / lengthM

/** Energy in a coil's field: U = ½·L·I². */
export const inductorEnergy = (henries: number, amps: number) => 0.5 * henries * amps * amps

/** A coil's voltage while its current changes by `dAmps` over `seconds`: V = L·ΔI/Δt. */
export const inductorVolts = (henries: number, dAmps: number, seconds: number) => (henries * dAmps) / seconds

/** Switch voltage while it cuts a coil's current linearly to 0 over `tOff`: the supply plus L·I/tOff. */
export const switchOffSpike = (vs: number, amps: number, henries: number, tOff: number) => vs + inductorVolts(henries, amps, tOff)

export const AIR_ARC_V = 330 // Paschen minimum: below it no gap in air sparks over

/** Force on a straight wire in a uniform field: F = I·L × B, newtons (|F| = B·I·L·sin θ). */
export const wireForce = (amps: number, length: Vec3, b: Vec3): Vec3 => cross(length, b).map((c) => amps * c) as Vec3

/** Magnetic moment of a bar magnet from its remanence: m = Br·V / μ₀, A·m². */
export const magnetMoment = (remanenceT: number, volumeM3: number) => (remanenceT * volumeM3) / MU_0

/** Remanence Br of common magnets, T. */
export const MAGNET_BR = { ferrite: 0.4, neodymium: 1.3 }
export type MagnetKind = keyof typeof MAGNET_BR

/** Flux through a loop of radius `r` from a dipole `m` on its axis, `z` from its plane: Φ = μ₀mr² / 2(r² + z²)^1.5, Wb. */
export const dipoleFlux = (m: number, r: number, z: number) => (MU_0 * m * r * r) / (2 * (r * r + z * z) ** 1.5)

/** Faraday's law: ε = −N·ΔΦ / Δt. */
export const faradayEmf = (turns: number, dFlux: number, dt: number) => (-turns * dFlux) / dt

/** A dipole sliding along a coil's axis at `v` (m/s) through `z`: ε = −N·(dΦ/dz)·v. */
export const dipoleEmf = (turns: number, m: number, r: number, z: number, v: number) =>
  turns * ((3 * MU_0 * m * r * r * z) / (2 * (r * r + z * z) ** 2.5)) * v

/** Magnet swinging through a coil, z = A·sin(2πft): where it is, the flux per turn and the EMF at time t. */
export function magnetStroke(turns: number, m: number, r: number, amplitude: number, hz: number, t: number) {
  const w = 2 * Math.PI * hz
  const z = amplitude * Math.sin(w * t)
  const v = amplitude * w * Math.cos(w * t)
  return { z, v, flux: dipoleFlux(m, r, z), emf: dipoleEmf(turns, m, r, z, v) }
}

/** Largest |ε| over one stroke cycle (sampled). */
export function strokePeakEmf(turns: number, m: number, r: number, amplitude: number, hz: number, samples = 2000) {
  if (hz <= 0) return 0
  let peak = 0
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(magnetStroke(turns, m, r, amplitude, hz, i / (samples * hz)).emf))
  return peak
}

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
