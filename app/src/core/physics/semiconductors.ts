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

export interface Diode {
  saturationA: number
  ideality: number
  /** Reverse breakdown (zener) voltage, reached at `kneeA`. */
  breakdownV?: number
  kneeA?: number
  breakdownIdeality?: number
}

/** SPICE-fit parts; the zener's breakdown is the same exponential, mirrored. */
export const DIODES = {
  '1N4148': { saturationA: 2.52e-9, ideality: 1.752 },
  '1N4007': { saturationA: 7.03e-9, ideality: 1.808 },
  '1N5819': { saturationA: 31.7e-6, ideality: 1.373 },
  zener5V1: { saturationA: 1e-12, ideality: 1.2, breakdownV: 5.1, kneeA: 5e-3, breakdownIdeality: 2 },
} satisfies Record<string, Diode>

/** Shockley fit through `vf` at `amps`; LEDs sit near n ≈ 2. */
export const fitDiode = (vf: number, ideality = 2, amps = 0.02): Diode => ({
  saturationA: amps / Math.expm1(vf / (ideality * thermalVoltage())),
  ideality,
})

/** Photon energy in eV at a wavelength in nm: E = hc/λ. */
export const photonEv = (nm: number) => 1239.84 / nm

export interface Led extends Diode {
  /** Forward voltage at 20 mA. */
  vf: number
  nm: number
  color: string
}

const led = (vf: number, nm: number, color: string): Led => ({ ...fitDiode(vf), vf, nm, color })

/** 5 mm LEDs; white is a blue die under a yellow phosphor. */
export const LEDS = {
  red: led(2.0, 625, '#ff2a1a'),
  yellow: led(2.2, 590, '#ffb81a'),
  green: led(3.0, 525, '#2bff5a'),
  blue: led(3.1, 470, '#2a6bff'),
  white: led(3.2, 450, '#eef2ff'),
} satisfies Record<string, Led>

export const LED_RATED_A = 0.02
export const LED_MAX_A = 0.03

/** A row-scanned matrix: one row lit at a time, `rowHz` rows per second. */
export const matrixScan = (rows: number, cols: number, rowHz: number) => ({
  frameHz: rowHz / rows,
  duty: 1 / rows,
  pins: rows + cols,
  leds: rows * cols,
})

/** Fraction of [t, t + dt] each row of a scanned matrix spends lit. */
export function rowOnFractions(t: number, dt: number, rowHz: number, rows: number): number[] {
  const out = new Array<number>(rows).fill(0)
  const a = t * rowHz
  const b = (t + dt) * rowHz
  for (let k = Math.floor(a); k < b; k++) out[((k % rows) + rows) % rows] += Math.min(b, k + 1) - Math.max(a, k)
  return out.map((x) => x / (b - a || 1))
}

/** Current from anode to cathode at `volts` across the diode. */
export function diodeAmps(volts: number, d: Diode): number {
  const forward = diodeCurrent(volts, d.saturationA, d.ideality)
  if (d.breakdownV === undefined) return forward
  const nvt = (d.breakdownIdeality ?? 1) * thermalVoltage()
  return forward - (d.kneeA ?? 1e-3) * Math.exp((-volts - d.breakdownV) / nvt)
}

/** Forward voltage at `amps` (inverse Shockley). */
export const diodeVolts = (amps: number, d: Diode) => d.ideality * thermalVoltage() * Math.log(amps / d.saturationA + 1)

/** Source `vs` through `ohms` into a node; the diode (anode at the node, or cathode when `reversed`) and an optional
 *  `load` go from the node to ground. Bisection on the node voltage: every branch current is monotonic in it. */
export function diodeNode(vs: number, ohms: number, d: Diode, { load = Infinity, reversed = false } = {}) {
  const diodeA = (v: number) => (reversed ? -diodeAmps(-v, d) : diodeAmps(v, d))
  let lo = Math.min(0, vs)
  let hi = Math.max(0, vs)
  for (let k = 0; k < 80; k++) {
    const v = (lo + hi) / 2
    if ((vs - v) / ohms - diodeA(v) - v / load > 0) lo = v
    else hi = v
  }
  const v = (lo + hi) / 2
  return { v, diodeA: diodeA(v), loadA: v / load, sourceA: (vs - v) / ohms }
}

/** Peak switch-node voltage when a coil carrying `amps` dumps into `farads` alone: Vs + I·√(L/C). */
export const flybackSpike = (vs: number, amps: number, henries: number, farads: number) => vs + amps * Math.sqrt(henries / farads)

export interface Flyback {
  /** Coil current (A) and switch-node voltage (V). */
  amps: number
  volts: number
}

/** One step of a coil (L, R) from `vs` to a switch to ground, with stray capacitance `farads` at the switch node and
 *  optionally a flyback `diode` from that node back to `vs`. Closed: the node is held at 0 V. */
export function flybackStep(
  s: Flyback,
  { vs, ohms, henries, farads, diode, closed }: { vs: number; ohms: number; henries: number; farads: number; diode?: Diode; closed: boolean },
  dt: number,
): Flyback {
  if (closed) {
    const target = vs / ohms
    return { amps: target + (s.amps - target) * Math.exp((-dt * ohms) / henries), volts: 0 }
  }
  if (diode) {
    if (s.amps <= 0) return { amps: 0, volts: vs }
    const volts = vs + diodeVolts(s.amps, diode)
    return { amps: Math.max(0, s.amps + ((vs - volts - ohms * s.amps) / henries) * dt), volts }
  }
  const amps = s.amps + ((vs - s.volts - ohms * s.amps) / henries) * dt
  return { amps, volts: s.volts + (amps / farads) * dt }
}

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
