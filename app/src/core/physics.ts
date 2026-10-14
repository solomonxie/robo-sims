// Textbook formulas behind the Learn lessons. SI units unless the name says otherwise.
import { Element, branchCurrents, loopSteps, solveNodal, theveninAt } from './nodal'
import { Vec3, inverseSquare } from './fields'

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

// --- Kirchhoff ---

/** Node numbers of the two-source circuit: V₁ and V₂ each feed node N through R₁ and R₂; R₃ runs from N to ground. */
export const TWO_SOURCE = { v1: 1, v2: 2, n: 3 }
/** Clockwise loops from the ground rail, as node lists: left V₁·R₁·R₃, right R₃·R₂·V₂, outer V₁·R₁·R₂·V₂. */
export const TWO_SOURCE_LOOPS = { left: [0, 1, 3], right: [0, 3, 2], outer: [0, 1, 3, 2] }

/** i₁ and i₂ flow into N (negative = out, charging that source), i₃ flows out of N down R₃. */
export function twoSourceNode(v1: number, r1: number, v2: number, r2: number, r3: number) {
  const { v1: a, v2: b, n } = TWO_SOURCE
  const elements: Element[] = [
    { kind: 'V', a, b: 0, volts: v1 },
    { kind: 'V', a: b, b: 0, volts: v2 },
    { kind: 'R', a, b: n, ohms: r1 },
    { kind: 'R', a: b, b: n, ohms: r2 },
    { kind: 'R', a: n, b: 0, ohms: r3 },
  ]
  const { volts, amps } = solveNodal(3, elements)!
  return { volts, node: volts[n], i1: amps[2], i2: amps[3], i3: amps[4] }
}

/** Potential changes walking one of `TWO_SOURCE_LOOPS`, one per part, summing to 0. */
export const twoSourceLoop = (volts: number[], loop: keyof typeof TWO_SOURCE_LOOPS) => loopSteps(volts, TWO_SOURCE_LOOPS[loop])

/** Bridge nodes: the supply's + (1), the two taps A (2) and B (3). */
export const BRIDGE = { top: 1, a: 2, b: 3 }

/** Two dividers on one supply (R₁ over R₂ to tap A, R₃ over R₄ to tap B) joined by R₅ from A to B. */
export function bridgeCircuit(volts: number, r: [number, number, number, number, number]): Element[] {
  const { top, a, b } = BRIDGE
  return [
    { kind: 'V', a: top, b: 0, volts },
    { kind: 'R', a: top, b: a, ohms: r[0] },
    { kind: 'R', a, b: 0, ohms: r[1] },
    { kind: 'R', a: top, b, ohms: r[2] },
    { kind: 'R', a: b, b: 0, ohms: r[3] },
    { kind: 'R', a, b, ohms: r[4] },
  ]
}

/** Currents through R₁..R₅ (a → b as wired) and the supply current, for given node potentials. */
export function bridgeCurrents(elements: Element[], volts: number[]) {
  const i = branchCurrents(elements, volts).slice(1)
  return { amps: i, supply: i[0] + i[2] }
}

/** The taps' two KCL equations with the supply substituted in: G·[VA, VB] = I (siemens, amps). */
export function bridgeMatrix(volts: number, [r1, r2, r3, r4, r5]: [number, number, number, number, number]) {
  return {
    g: [
      [1 / r1 + 1 / r2 + 1 / r5, -1 / r5],
      [-1 / r5, 1 / r3 + 1 / r4 + 1 / r5],
    ],
    i: [volts / r1, volts / r3],
  }
}

/** Exact bridge solution: tap potentials and currents. */
export function bridgeNodes(volts: number, r: [number, number, number, number, number]) {
  const elements = bridgeCircuit(volts, r)
  const s = solveNodal(3, elements)!
  return { elements, volts: s.volts, va: s.volts[BRIDGE.a], vb: s.volts[BRIDGE.b], ...bridgeCurrents(elements, s.volts) }
}

// --- Thevenin & Norton ---

/** Nodes of the Thevenin demo: the cell's + (1), the R₁/R₂ tap A (2), the output terminal (3). */
export const T_NET = { top: 1, a: 2, out: 3 }

/** Cell `volts` → R₁ → A, R₂ from A to ground, R₃ from A to the output terminal. */
export function theveninNetwork(volts: number, [r1, r2, r3]: [number, number, number]): Element[] {
  const { top, a, out } = T_NET
  return [
    { kind: 'V', a: top, b: 0, volts },
    { kind: 'R', a: top, b: a, ohms: r1 },
    { kind: 'R', a, b: 0, ohms: r2 },
    { kind: 'R', a, b: out, ohms: r3 },
  ]
}

/** Vth, Rth and IN of the demo network, plus the full solve with `load` across its terminals. */
export function theveninDemo(volts: number, r: [number, number, number], load: number) {
  const elements = theveninNetwork(volts, r)
  const eq = theveninAt(3, elements, T_NET.out)!
  const s = solveNodal(3, [...elements, { kind: 'R', a: T_NET.out, b: 0, ohms: load }])!
  return { ...eq, va: s.volts[T_NET.a], vl: s.volts[T_NET.out], i1: s.amps[1], i2: s.amps[2], il: s.amps[4] }
}

/** Load on a Thevenin source: IL = Vth / (Rth + RL), VL = IL·RL. */
export function theveninLoad(vth: number, rth: number, load: number) {
  const amps = vth / (rth + load)
  return { amps, volts: amps * load }
}

/** Load on a Norton source IN ∥ Rth: the current divides, IL = IN·Rth / (Rth + RL). */
export function nortonLoad(norton: number, rth: number, load: number) {
  const amps = (norton * rth) / (rth + load)
  return { amps, volts: amps * load, inRth: norton - amps }
}

/** Power split between RL and the source's own Rth; the load peaks at Vth² / 4Rth when RL = Rth. */
export function powerTransfer(vth: number, rth: number, load: number) {
  const { amps, volts } = theveninLoad(vth, rth, load)
  return { amps, volts, loadW: volts * amps, lostW: amps * amps * rth, efficiency: load / (rth + load), maxW: (vth * vth) / (4 * rth) }
}

// --- AC ---

export type Wave = 'sine' | 'square' | 'triangle'

/** Unit-peak wave at `cycles` (any real; 1 = one full period), rising through 0 at whole cycles. */
export function waveAt(shape: Wave, cycles: number): number {
  const c = cycles - Math.floor(cycles)
  if (shape === 'square') return c < 0.5 ? 1 : -1
  if (shape === 'triangle') return c < 0.25 ? 4 * c : c < 0.75 ? 2 - 4 * c : 4 * c - 4
  return Math.sin(2 * Math.PI * c)
}

/** Vrms / Vpeak for each wave. */
export const RMS_FACTOR: Record<Wave, number> = { sine: Math.SQRT1_2, square: 1, triangle: 1 / Math.sqrt(3) }

export const rmsFromPeak = (peak: number, shape: Wave = 'sine') => peak * RMS_FACTOR[shape]
export const peakFromRms = (rms: number, shape: Wave = 'sine') => rms / RMS_FACTOR[shape]
export const peakToPeak = (peak: number) => 2 * peak

/** Root of the mean square of samples. */
export const rmsOf = (samples: number[]) => Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length)

/** v(t) = Vp · wave(f·t). */
export const acVolts = (peak: number, hz: number, seconds: number, shape: Wave = 'sine') => peak * waveAt(shape, hz * seconds)

export const periodOf = (hz: number) => 1 / hz
export const angularFrequency = (hz: number) => 2 * Math.PI * hz

/** Mains supplies: RMS volts and frequency. */
export const MAINS = { eu: { rms: 230, hz: 50 }, us: { rms: 120, hz: 60 } }

/** Resistance of a lamp rated `watts` at `volts` (RMS for AC): R = V² / P. */
export const lampOhms = (volts: number, watts: number) => (volts * volts) / watts

/** How far free electrons slosh each way in AC: peak drift speed / ω. */
export const sloshAmplitude = (peakAmps: number, areaM2: number, hz: number) => driftVelocity(peakAmps, areaM2) / angularFrequency(hz)

// --- Electric fields ---

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
