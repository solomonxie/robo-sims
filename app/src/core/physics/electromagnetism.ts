// Electric fields and magnetism.
import { Vec3, cross, inverseSquare } from '../fields'

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
