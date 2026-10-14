// Silicon: carriers, PN junction, diode, MOSFET.
import { E_CHARGE } from './dc'

export const BOLTZMANN_EV = 8.617333e-5 // eV/K
export const SI_BANDGAP_EV = 1.12
export const SI_NI_300K = 1e10 // intrinsic carriers per cm³ at 300 K
export const thermalVoltage = (kelvin = 300) => BOLTZMANN_EV * kelvin

export const SI_ATOMS = 5e22 // per cm³

export interface Semiconductor {
  gapEv: number
  /** Intrinsic carriers per cm³ at 300 K. */
  ni300: number
  /** Electron and hole mobility, cm²/V·s. */
  mobilityN: number
  mobilityP: number
}

export const SEMICONDUCTORS = {
  germanium: { gapEv: 0.66, ni300: 2e13, mobilityN: 3900, mobilityP: 1900 },
  silicon: { gapEv: SI_BANDGAP_EV, ni300: SI_NI_300K, mobilityN: 1350, mobilityP: 480 },
  diamond: { gapEv: 5.47, ni300: 1.6e-27, mobilityN: 2200, mobilityP: 1800 },
} satisfies Record<string, Semiconductor>

/** Intrinsic carrier density n_i(T) ∝ T^1.5 · e^(−Eg / 2kT), per cm³. */
export function intrinsicDensity(kelvin: number, m: Semiconductor): number {
  return m.ni300 * (kelvin / 300) ** 1.5 * Math.exp((-m.gapEv / (2 * BOLTZMANN_EV)) * (1 / kelvin - 1 / 300))
}

export const intrinsicCarriers = (kelvin: number) => intrinsicDensity(kelvin, SEMICONDUCTORS.silicon)

/** Free electrons n and holes p per cm³ with fully ionized dopants: n − p = Nd − Na and n · p = n_i². */
export function carrierDensities(kelvin: number, { donors = 0, acceptors = 0 } = {}, m: Semiconductor = SEMICONDUCTORS.silicon) {
  const ni = intrinsicDensity(kelvin, m)
  const half = (donors - acceptors) / 2
  const root = Math.hypot(half, ni)
  if (half >= 0) {
    const n = half + root
    return { n, p: (ni * ni) / n, ni }
  }
  const p = root - half
  return { n: (ni * ni) / p, p, ni }
}

/** σ = q(nμn + pμp) in S/cm, densities per cm³. */
export const conductivity = (n: number, p: number, m: Semiconductor = SEMICONDUCTORS.silicon) =>
  E_CHARGE * (n * m.mobilityN + p * m.mobilityP)

/** Drift speeds in m/s across `metres` of material at `volts`: v = μE. */
export const driftSpeeds = (volts: number, metres: number, m: Semiconductor = SEMICONDUCTORS.silicon) => ({
  electron: (m.mobilityN * 1e-4 * volts) / metres,
  hole: (m.mobilityP * 1e-4 * volts) / metres,
})

/** Fraction of the current carried by electrons. */
export const electronShare = (n: number, p: number, m: Semiconductor = SEMICONDUCTORS.silicon) =>
  (n * m.mobilityN) / (n * m.mobilityN + p * m.mobilityP)

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

/** Depletion width W, its reach into each side (Na·xp = Nd·xn), the barrier left and the peak field in V/m. */
export function depletion(na: number, nd: number, volts: number) {
  const w = depletionWidth(na, nd, volts)
  const xp = (w * nd) / (na + nd)
  const xn = (w * na) / (na + nd)
  return { w, xp, xn, barrier: Math.max(builtInVoltage(na, nd) - volts, 0), peakField: (E_CHARGE * na * 1e6 * xp) / EPS_SI }
}

/** Potential at `x` across a junction at 0 (p side at x < 0, depleted from −xp to xn): parabolic on each side, with the
 *  barrier split in proportion to xp and xn. Any length unit. */
export function junctionPotential(x: number, xp: number, xn: number, barrier: number): number {
  const w = xp + xn
  if (w <= 0) return x < 0 ? 0 : barrier
  if (x <= -xp) return 0
  if (x >= xn) return barrier
  if (x <= 0) return (barrier * xp * ((x + xp) / xp) ** 2) / w
  return barrier - (barrier * xn * ((xn - x) / xn) ** 2) / w
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
  /** Channel-length modulation, 1/V. */
  lambda?: number
}

/** Chip transistors at ~1 V; holes are ~2.8× less mobile, so the matched PMOS is drawn that much wider. */
export const MODERN_NMOS: Mosfet = { vthV: 0.35, k: 1e-3, n: 1.3, lambda: 0.1 }
export const MODERN_PMOS: Mosfet = MODERN_NMOS
export const HOLE_MOBILITY_RATIO = SEMICONDUCTORS.silicon.mobilityN / SEMICONDUCTORS.silicon.mobilityP

/** Discrete parts, k fitted to the datasheet Rds(on). */
export const MOSFETS = {
  '2N7000': { vthV: 2.1, k: 0.07, n: 1.5, lambda: 0.02 },
  IRLZ44N: { vthV: 1.5, k: 13, n: 1.5, lambda: 0.01 },
} satisfies Record<string, Mosfet>

export type MosfetRegion = 'cutoff' | 'triode' | 'saturation'

/** Drain current (A) with the source at 0 V: square law above threshold — triode k(Vov·Vds − Vds²/2) until Vds reaches
 *  Vov, then saturation ½k·Vov² — plus an exponential subthreshold leak. Source and drain swap for Vds < 0. */
export function mosfetDrain(vgs: number, vds: number, m: Mosfet = MODERN_NMOS): { amps: number; region: MosfetRegion } {
  if (vds < 0) {
    const r = mosfetDrain(vgs - vds, -vds, m)
    return { amps: -r.amps, region: r.region }
  }
  const vt = thermalVoltage()
  const nvt = m.n * vt
  const vov = vgs - m.vthV
  const leak = (m.k / 2) * nvt ** 2 * Math.exp(Math.min(vov, 0) / nvt) * -Math.expm1(-vds / vt)
  const clm = 1 + (m.lambda ?? 0) * vds
  if (vov <= 0) return { amps: leak, region: 'cutoff' }
  if (vds < vov) return { amps: leak + m.k * (vov * vds - vds ** 2 / 2) * clm, region: 'triode' }
  return { amps: leak + (m.k / 2) * vov ** 2 * clm, region: 'saturation' }
}

/** Saturation drain current: square law above threshold, exponential leak below. */
export const drainCurrent = (vgs: number, m: Mosfet = MODERN_NMOS) => mosfetDrain(vgs, Math.max(1, vgs), { ...m, lambda: 0 }).amps

/** On-resistance at small Vds: 1 / (k·(Vgs − Vth)). */
export const rdsOn = (vgs: number, m: Mosfet) => (vgs > m.vthV ? 1 / (m.k * (vgs - m.vthV)) : Infinity)

/** Local overdrive Vgs − Vth − V(u) at fraction `u` of the way from source to drain, in volts; channel charge per area is
 *  Cox times this. Falls to 0 at the drain end once Vds ≥ Vov (pinch-off). */
export function channelOverdrive(u: number, vgs: number, vds: number, m: Mosfet = MODERN_NMOS): number {
  const vov = vgs - m.vthV
  if (vov <= 0) return 0
  const vd = Math.min(Math.max(vds, 0), vov)
  return Math.sqrt(Math.max(0, vov * vov - u * (2 * vov * vd - vd * vd)))
}

const EPS_OX = 3.9 * 8.854e-12 // F/m

/** Gate-oxide capacitance per area, F/m². */
export const oxideCapacitance = (metres: number) => EPS_OX / metres

/** Electrons (or holes) per µm² drawn into the channel by `overdrive` volts across an oxide `metres` thick. */
export const channelCarriers = (overdrive: number, metres: number) => (oxideCapacitance(metres) * Math.max(0, overdrive)) / E_CHARGE / 1e12

const pull = (vin: number, vout: number, vdd: number, pmos: Mosfet) => mosfetDrain(vdd - vin, vdd - vout, pmos).amps

/** CMOS inverter output: the PMOS (source at Vdd) and NMOS (source at 0) pass the same current; bisection on Vout. */
export function cmosInverter(vin: number, vdd: number, nmos: Mosfet = MODERN_NMOS, pmos: Mosfet = MODERN_PMOS) {
  let lo = 0
  let hi = vdd
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2
    if (pull(vin, v, vdd, pmos) > mosfetDrain(vin, v, nmos).amps) lo = v
    else hi = v
  }
  const vout = (lo + hi) / 2
  return { vout, amps: mosfetDrain(vin, vout, nmos).amps }
}

/** Input where Vout = Vin, both transistors in saturation: (Vtn + r·(Vdd − Vtp)) / (1 + r), r = √(kp/kn). */
export function switchingPoint(vdd: number, nmos: Mosfet = MODERN_NMOS, pmos: Mosfet = MODERN_PMOS) {
  const r = Math.sqrt(pmos.k / nmos.k)
  return (nmos.vthV + r * (vdd - pmos.vthV)) / (1 + r)
}

export interface InverterLoad {
  vout: number
  /** Energy (J) drawn from the supply and burnt in each transistor so far. */
  supplyJ: number
  pmosJ: number
  nmosJ: number
}

/** Advances an inverter driving `farads` by `dt` s: C·dVout/dt = Ip − In, in sub-steps short enough to stay stable. */
export function inverterStep(
  s: InverterLoad,
  { vin, vdd, farads, nmos = MODERN_NMOS, pmos = MODERN_PMOS }: { vin: number; vdd: number; farads: number; nmos?: Mosfet; pmos?: Mosfet },
  dt: number,
): InverterLoad {
  const steps = Math.min(4000, Math.ceil(dt / ((0.05 * farads) / (Math.max(nmos.k, pmos.k) * vdd))))
  const h = dt / steps
  let { vout, supplyJ, pmosJ, nmosJ } = s
  for (let i = 0; i < steps; i++) {
    const ip = pull(vin, vout, vdd, pmos)
    const iN = mosfetDrain(vin, vout, nmos).amps
    supplyJ += ip * vdd * h
    pmosJ += ip * (vdd - vout) * h
    nmosJ += iN * vout * h
    vout = Math.min(vdd, Math.max(0, vout + ((ip - iN) / farads) * h))
  }
  return { vout, supplyJ, pmosJ, nmosJ }
}

/** Time for the output to cross Vdd/2 after the input steps from 0 to Vdd (or back: matched devices are symmetric). */
export function inverterDelay(vdd: number, farads: number, nmos: Mosfet = MODERN_NMOS, pmos: Mosfet = MODERN_PMOS) {
  const h = (0.02 * farads) / (nmos.k * Math.max(vdd - nmos.vthV, 0.05))
  let s: InverterLoad = { vout: vdd, supplyJ: 0, pmosJ: 0, nmosJ: 0 }
  let t = 0
  for (let i = 0; s.vout > vdd / 2 && i < 1e5; i++) {
    s = inverterStep(s, { vin: vdd, vdd, farads, nmos, pmos }, h)
    t += h
  }
  return t
}

/** Energy drawn from the supply per full 0 → 1 → 0 cycle of a load: C·V² (half burnt charging, half discharging). */
export const switchingEnergy = (farads: number, vdd: number) => farads * vdd * vdd

/** Dynamic power α·C·V²·f. */
export const dynamicPower = (farads: number, vdd: number, hz: number, activity = 1) => activity * switchingEnergy(farads, vdd) * hz

export interface Bjt {
  /** Forward and reverse current gain (βF = hFE, βR). */
  beta: number
  betaR: number
  /** Base–emitter junction: Ib against Vbe (saturation current Is / βF). */
  be: Diode
  /** Early voltage (V) and ohmic collector resistance (Ω), which sets Vce(sat) at high current. */
  earlyV: number
  rc: number
  /** Datasheet limits: collector current (A) and TO-92 dissipation (W). */
  maxA: number
  maxW: number
}

/** NPN with Vbe = 0.65 V at Ic = 10 mA. */
const npn = (beta: number, betaR: number, earlyV: number, rc: number, maxA: number, maxW: number): Bjt => ({
  beta,
  betaR,
  be: { saturationA: 0.01 / Math.expm1(0.65 / thermalVoltage()) / beta, ideality: 1 },
  earlyV,
  rc,
  maxA,
  maxW,
})

/** Small TO-92 NPNs, typical hFE. */
export const BJTS = {
  '2N2222': npn(150, 6, 75, 1, 0.6, 0.625),
  BC547: npn(300, 4, 60, 1.5, 0.1, 0.5),
} satisfies Record<string, Bjt>

export type BjtRegion = 'cutoff' | 'active' | 'saturation'

/** Simplified Ebers–Moll at base current `ib` and intrinsic `vce`: βF·Ib(1 + Vce/Va) in the active region, falling to ~0 at
 *  Vce ≈ Vt·ln(1 + 1/βR) as the collector junction turns on too (saturation). */
function emCollector(ib: number, vce: number, m: Bjt) {
  if (ib <= 0) return 0
  const e = Math.exp(-vce / thermalVoltage())
  return ((ib * (1 - e * (1 + 1 / m.betaR))) / (1 / m.beta + e / m.betaR)) * (1 + Math.max(0, vce) / m.earlyV)
}

const regionOf = (ib: number, ic: number, vce: number, m: Bjt): BjtRegion =>
  ic < 1e-6 ? 'cutoff' : ic < 0.9 * m.beta * ib * (1 + vce / m.earlyV) ? 'saturation' : 'active'

/** Collector current at terminal `vce` for a fixed base current: one output-characteristic curve. */
export function bjtCollector(ib: number, vce: number, m: Bjt): { amps: number; region: BjtRegion } {
  let lo = 0
  let hi = Math.max(0, vce)
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2
    if (v + emCollector(ib, v, m) * m.rc < vce) lo = v
    else hi = v
  }
  const amps = emCollector(ib, (lo + hi) / 2, m)
  return { amps, region: regionOf(ib, amps, vce, m) }
}

/** NPN low-side switch: `vin` through `rb` into the base, emitter to ground, a `load` (amps at the volts across it,
 *  increasing) from `vcc` to the collector. Base first (Vbe from the BE junction), then bisection on the intrinsic Vce. */
export function bjtSwitch({ vin, rb, vcc, load }: { vin: number; rb: number; vcc: number; load: (volts: number) => number }, m: Bjt) {
  const base = diodeNode(vin, rb, m.be)
  const ib = Math.max(0, base.sourceA)
  let lo = 0
  let hi = vcc
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2
    const ic = emCollector(ib, v, m)
    if (ic < load(vcc - v - ic * m.rc)) lo = v
    else hi = v
  }
  const ic = Math.max(0, emCollector(ib, lo, m))
  const vce = lo + ic * m.rc
  return { ib, vbe: base.v, ic, vce, region: regionOf(ib, ic, vce, m), watts: ic * vce + ib * base.v, gain: ib > 0 ? ic / ib : 0 }
}

/** Largest base resistor that still saturates `ic`: Rb = (Vin − Vbe) / (k·Ic/β), `k`× the bare minimum base current. */
export const baseResistorFor = (vin: number, ic: number, m: Bjt, k = 3, vbe = 0.7) => ((vin - vbe) * m.beta) / (k * ic)
