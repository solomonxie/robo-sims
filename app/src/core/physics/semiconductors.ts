// Silicon: carriers, PN junction, diode, MOSFET.
import { E_CHARGE } from './dc'

export const BOLTZMANN_EV = 8.617333e-5 // eV/K
export const SI_BANDGAP_EV = 1.12
export const SI_NI_300K = 1e10 // intrinsic carriers per cm³ at 300 K
export const thermalVoltage = (kelvin = 300) => BOLTZMANN_EV * kelvin

/** Intrinsic carrier density n_i(T) ∝ T^1.5 · e^(−Eg / 2kT), per cm³. */
export function intrinsicCarriers(kelvin: number): number {
  const k = BOLTZMANN_EV
  return SI_NI_300K * (kelvin / 300) ** 1.5 * Math.exp((-SI_BANDGAP_EV / (2 * k)) * (1 / kelvin - 1 / 300))
}

/** Built-in potential of a PN junction, doping per cm³. */
export const builtInVoltage = (na: number, nd: number, kelvin = 300) =>
  thermalVoltage(kelvin) * Math.log((na * nd) / intrinsicCarriers(kelvin) ** 2)

const EPS_SI = 11.7 * 8.854e-12 // F/m

/** Depletion width in metres; forward bias (V > 0) shrinks it. Doping per cm³. */
export function depletionWidth(na: number, nd: number, volts: number): number {
  const vbi = builtInVoltage(na, nd)
  const naM = na * 1e6
  const ndM = nd * 1e6
  const across = Math.max(vbi - volts, 0)
  return Math.sqrt(((2 * EPS_SI * across) / E_CHARGE) * ((naM + ndM) / (naM * ndM)))
}

/** Shockley diode equation. */
export const diodeCurrent = (volts: number, saturationA = 1e-12, ideality = 1) =>
  saturationA * (Math.exp(volts / (ideality * thermalVoltage())) - 1)

export interface Mosfet {
  vthV: number
  /** μ·Cox·W/L, A/V². */
  k: number
  /** Subthreshold slope factor. */
  n: number
}

export const MODERN_NMOS: Mosfet = { vthV: 0.35, k: 1e-3, n: 1.3 }

/** Saturation drain current: square law above threshold, exponential leak below. */
export function drainCurrent(vgs: number, m: Mosfet = MODERN_NMOS): number {
  const nvt = m.n * thermalVoltage()
  const atThreshold = (m.k / 2) * nvt ** 2
  if (vgs <= m.vthV) return atThreshold * Math.exp((vgs - m.vthV) / nvt)
  return atThreshold + (m.k / 2) * (vgs - m.vthV) ** 2
}
