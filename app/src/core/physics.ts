// Textbook formulas behind the Learn lessons. SI units unless the name says otherwise.

export const E_CHARGE = 1.602176634e-19 // C
export const BOLTZMANN_EV = 8.617333e-5 // eV/K
export const COPPER_FREE_ELECTRONS = 8.5e28 // per m³

export const RESISTIVITY = { copper: 1.68e-8, nichrome: 1.1e-6 } // Ω·m
export type Metal = keyof typeof RESISTIVITY

export const electronsPerSecond = (amps: number) => amps / E_CHARGE

/** Drift speed v = I / (n·A·q). */
export const driftVelocity = (amps: number, areaM2: number, n = COPPER_FREE_ELECTRONS) =>
  amps / (n * areaM2 * E_CHARGE)

/** R = ρL/A for a round wire. */
export const wireResistance = (rho: number, lengthM: number, diameterM: number) =>
  (rho * lengthM) / (Math.PI * (diameterM / 2) ** 2)

export interface PairResult {
  totalOhms: number
  amps: number
  amps1: number
  amps2: number
  volts1: number
  volts2: number
}

export function resistorPair(r1: number, r2: number, volts: number, mode: 'series' | 'parallel'): PairResult {
  if (mode === 'series') {
    const totalOhms = r1 + r2
    const amps = volts / totalOhms
    return { totalOhms, amps, amps1: amps, amps2: amps, volts1: amps * r1, volts2: amps * r2 }
  }
  const totalOhms = 1 / (1 / r1 + 1 / r2)
  return { totalOhms, amps: volts / totalOhms, amps1: volts / r1, amps2: volts / r2, volts1: volts, volts2: volts }
}

/** Exact RC step: capacitor voltage after `dt` heading toward `target`. */
export const rcStep = (vc: number, target: number, tauS: number, dt: number) =>
  target + (vc - target) * Math.exp(-dt / tauS)

// --- Semiconductors (silicon) ---

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
