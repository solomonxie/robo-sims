// Current, voltage, resistance, power and energy. SI units unless the name says otherwise.

export const E_CHARGE = 1.602176634e-19 // C
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
