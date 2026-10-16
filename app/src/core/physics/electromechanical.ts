// Electromechanical parts: relays and SSRs, switch contacts, potentiometers.
import { halton } from '../halton'
import { rcStep } from './circuits'
import { IRON_CORE, MU_0 } from './electromagnetism'
import { Diode, diodeNode, fitDiode } from './semiconductors'

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
