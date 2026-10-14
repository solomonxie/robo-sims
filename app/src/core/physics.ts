// Textbook formulas behind the Learn lessons. SI units unless the name says otherwise.

export const E_CHARGE = 1.602176634e-19 // C
export const BOLTZMANN_EV = 8.617333e-5 // eV/K
export const COPPER_FREE_ELECTRONS = 8.5e28 // per m³

export const RESISTIVITY = { copper: 1.68e-8, aluminium: 2.65e-8, nichrome: 1.1e-6 } // Ω·m
export type Metal = keyof typeof RESISTIVITY

export const electronsPerSecond = (amps: number) => amps / E_CHARGE

/** Q = I·t. */
export const chargeFlowed = (amps: number, seconds: number) => amps * seconds

/** Electrons that make up a charge (sign ignored). */
export const electronsIn = (coulombs: number) => Math.abs(coulombs) / E_CHARGE

/** Current carried by one kind of carrier: I = n·q·v·A. Flipping both q and v leaves I unchanged. */
export const carrierCurrent = (chargeC: number, velocity: number, areaM2: number, n = COPPER_FREE_ELECTRONS) =>
  n * chargeC * velocity * areaM2

/** Drift speed v = I / (n·A·q). */
export const driftVelocity = (amps: number, areaM2: number, n = COPPER_FREE_ELECTRONS) =>
  amps / (n * areaM2 * E_CHARGE)

/** E = V·Q: energy a charge gains or gives up crossing a potential difference. */
export const energyAcross = (volts: number, coulombs: number) => volts * coulombs

/** Node potentials down a series chain, from `volts` at the top to 0 V at the bottom. */
export function seriesPotentials(volts: number, ohms: number[]): number[] {
  const total = ohms.reduce((s, r) => s + r, 0)
  const out = [volts]
  for (const r of ohms) out.push(out[out.length - 1] - (volts * r) / total)
  out[out.length - 1] = 0
  return out
}

/** The same potentials measured from a different 0 V reference. */
export const relativeTo = (potentials: number[], reference: number) => potentials.map((v) => v - reference)

export const METER_INPUT_OHMS = 10e6 // typical DMM on a volts range

/** A voltmeter shows red probe minus black (COM). */
export const meterReading = (redV: number, blackV: number) => redV - blackV

/** Cross-section of a round wire, m². */
export const wireArea = (diameterM: number) => Math.PI * (diameterM / 2) ** 2

/** R = ρL/A for a round wire. */
export const wireResistance = (rho: number, lengthM: number, diameterM: number) => (rho * lengthM) / wireArea(diameterM)

/** American Wire Gauge to diameter in metres: AWG 36 is 0.127 mm, 39 gauges span 92×. */
export const awgDiameter = (gauge: number) => 0.127e-3 * 92 ** ((36 - gauge) / 39)

/** Temperature coefficient α near room temperature, per K. */
export const TEMP_COEFF = { copper: 0.0039, aluminium: 0.0040, nichrome: 0.0004 }

export const ROOM_C = 25

/** Linear metal law R = R₀(1 + α(T − T₀)), R₀ at `refC`. */
export const metalResistance = (ohmsAtRef: number, alpha: number, tempC: number, refC = ROOM_C) =>
  ohmsAtRef * (1 + alpha * (tempC - refC))

/** Fractional change from the reference value, e.g. 0.39 for +39 %. */
export const relativeChange = (value: number, reference: number) => value / reference - 1

/** Tungsten filament resistance vs applied voltage: `coldRatio` of its hot value at 0 V, rising to `hotOhms` at `ratedV`
 *  as it heats (a √V fit to real lamps). */
export const filamentOhms = (volts: number, hotOhms: number, ratedV: number, coldRatio = 0.1) =>
  hotOhms * (coldRatio + (1 - coldRatio) * Math.sqrt(Math.abs(volts) / ratedV))

// --- Power and energy ---

/** P = V·I, watts. */
export const powerVI = (volts: number, amps: number) => volts * amps

/** P = I²R. */
export const powerI2R = (amps: number, ohms: number) => amps * amps * ohms

/** P = V²/R. */
export const powerV2R = (volts: number, ohms: number) => (volts * volts) / ohms

/** E = P·t, joules. */
export const energyOver = (watts: number, seconds: number) => watts * seconds

export const RESISTOR_MAX_C = 155 // film resistor hot-spot limit
export const RESISTOR_BURN_C = 350 // coating chars and the film opens

/** Thermal resistance θ (K/W) that puts a resistor at `maxC` when it dissipates its rating at `ambientC`. */
export const resistorThermalK = (ratingW: number, ambientC = ROOM_C, maxC = RESISTOR_MAX_C) => (maxC - ambientC) / ratingW

/** Temperature after `seconds` of steady power, starting at ambient: rises toward ambient + P·θ with time constant τ. */
export const heatingTemp = (ambientC: number, watts: number, kPerW: number, tauS: number, seconds: number) =>
  ambientC + watts * kPerW * (1 - Math.exp(-seconds / tauS))

export const JOULES_PER_WH = 3600

/** Battery energy Wh = V·Ah. */
export const wattHours = (volts: number, mAh: number) => (volts * mAh) / 1000

/** Hours a capacity lasts at a steady draw. */
export const runtimeHours = (mAh: number, mA: number) => mAh / mA

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

/** Series chain across `volts`: one current through all, each resistor drops I·R. */
export function seriesChain(volts: number, ohms: number[]) {
  const totalOhms = ohms.reduce((s, r) => s + r, 0)
  const amps = volts / totalOhms
  return { totalOhms, amps, drops: ohms.map((r) => amps * r) }
}

/** Parallel branches across `volts`: each gets the full voltage, the currents add. */
export function parallelBranches(volts: number, ohms: number[]) {
  const totalOhms = 1 / ohms.reduce((s, r) => s + 1 / r, 0)
  const branchAmps = ohms.map((r) => volts / r)
  return { totalOhms, amps: volts / totalOhms, branchAmps }
}

/** `series` cells per string, `parallel` strings: volts add along a string, capacity adds across strings. */
export function cellPack(cellV: number, cellMAh: number, series: number, parallel: number) {
  const volts = cellV * series
  const mAh = cellMAh * parallel
  return { volts, mAh, wh: wattHours(volts, mAh), cells: series * parallel }
}

/** R₁ in series with (R₂ ∥ R₃) across `volts`: reduce the pair, then the chain. */
export function seriesWithPair(r1: number, r2: number, r3: number, volts: number) {
  const pairOhms = 1 / (1 / r2 + 1 / r3)
  const totalOhms = r1 + pairOhms
  const amps = volts / totalOhms
  const pairV = amps * pairOhms
  return { pairOhms, totalOhms, amps, v1: amps * r1, pairV, amps2: pairV / r2, amps3: pairV / r3 }
}

// --- Voltage divider ---

/** Unloaded divider: Vout = Vin·R₂ / (R₁ + R₂), R₂ the bottom resistor. */
export const dividerOut = (vin: number, r1: number, r2: number) => (vin * r2) / (r1 + r2)

/** Divider with `load` across R₂: the load sits in parallel with R₂ and pulls Vout down. */
export function loadedDivider(vin: number, r1: number, r2: number, load: number) {
  const bottomOhms = 1 / (1 / r2 + 1 / load)
  const vout = dividerOut(vin, r1, bottomOhms)
  const unloaded = dividerOut(vin, r1, r2)
  return {
    vout,
    unloaded,
    sag: 1 - vout / unloaded,
    amps: (vin - vout) / r1,
    amps2: vout / r2,
    loadAmps: vout / load,
    sourceOhms: 1 / (1 / r1 + 1 / r2),
  }
}

/** Ideal ADC reading: 0 V → 0, `vref` → 2ᴺ − 1, clamped. */
export const adcCounts = (volts: number, vref: number, bits: number) => {
  const top = 2 ** bits - 1
  return Math.min(top, Math.max(0, Math.round((volts / vref) * top)))
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
