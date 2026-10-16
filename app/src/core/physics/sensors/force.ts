// Force & touch: bar load cell strain, foil gauge ΔR, Wheatstone bridge, HX711 counts with tare and calibration; ESP32 touch pad charge timing, finger and water capacitance, threshold + hysteresis.
import { G, gaussAt } from '../common'
import { solveNodal } from '../../nodal'
import { EPSILON_0 } from '../electromagnetism'

/** 1 kg aluminium bar load cell, reduced to the thin web (1.6 mm) under the gauges, 20 mm from the load; 1 kΩ foil gauges, GF 2. */
export const LOAD_CELL = { E: 69e9, width: 12.7e-3, thick: 1.6e-3, arm: 0.02, ratedKg: 1, ohms: 1000, gf: 2, zeroOhms: 0.12 }

/** Surface strain of a bent beam: ε = 6·F·L / (E·b·h²). */
export const beamStrain = (newtons: number, arm: number, E: number, width: number, thick: number) => (6 * newtons * arm) / (E * width * thick * thick)

/** Gauge resistance change: ΔR = R·GF·ε. */
export const gaugeDelta = (ohms: number, gf: number, strain: number) => ohms * gf * strain

export type Bridge = 'quarter' | 'half' | 'full'

/** Strain sign per arm [E+→A−, A−→E−, E+→A+, A+→E−]; 0 = fixed resistor. */
const BRIDGE_ARMS: Record<Bridge, number[]> = { quarter: [0, 0, 0, 1], half: [0, 0, -1, 1], full: [1, -1, -1, 1] }

/** Wheatstone bridge excited by `vex`, solved with nodal analysis; `zeroOhms` = gauge mismatch on the A−→E− arm. */
export function bridgeOut(vex: number, ohms: number, gf: number, strain: number, bridge: Bridge, zeroOhms = 0) {
  const d = gaugeDelta(ohms, gf, strain)
  const arms = BRIDGE_ARMS[bridge].map((s, i) => ohms + s * d + (i === 1 ? zeroOhms : 0))
  const sol = solveNodal(3, [
    { kind: 'V', a: 1, b: 0, volts: vex },
    { kind: 'R', a: 1, b: 3, ohms: arms[0] },
    { kind: 'R', a: 3, b: 0, ohms: arms[1] },
    { kind: 'R', a: 1, b: 2, ohms: arms[2] },
    { kind: 'R', a: 2, b: 0, ohms: arms[3] },
  ])!
  const [, , ap, am] = sol.volts
  return { arms, delta: d, aPlus: ap, aMinus: am, out: ap - am }
}

/** Avia HX711: channel A at gain 128, 24-bit two's complement, full scale ±0.5·AVDD/gain, ~50 nV rms input noise at 10 SPS. */
export const HX711 = { bits: 24, gain: 128, sps: 10, noiseV: 50e-9 }

export const hx711Lsb = (avdd: number, gain = HX711.gain) => (0.5 * avdd) / gain / 2 ** (HX711.bits - 1)

export function hx711Code(vdiff: number, avdd: number, gain = HX711.gain) {
  const top = 2 ** (HX711.bits - 1)
  return Math.min(top - 1, Math.max(-top, Math.round(vdiff / hx711Lsb(avdd, gain))))
}

/** One scale reading of `kg` on the cell: strain, gauge ΔR, bridge volts and the HX711 count (sample `k` adds its noise; omit for noiseless). */
export function loadCellRead(kg: number, bridge: Bridge, vex: number, k?: number) {
  const c = LOAD_CELL
  const strain = beamStrain(kg * G, c.arm, c.E, c.width, c.thick)
  const b = bridgeOut(vex, c.ohms, c.gf, strain, bridge, c.zeroOhms)
  const noise = k === undefined ? 0 : HX711.noiseV * gaussAt(k)
  return { strain, ...b, code: hx711Code(b.out + noise, vex) }
}

/** Scale from two points: tare (empty) and a known mass. */
export const calFactor = (rawKnown: number, rawTare: number, knownG: number) => (rawKnown - rawTare) / knownG
export const toGrams = (raw: number, rawTare: number, factor: number) => (raw - rawTare) / factor

/** ESP32 touch sensor: a constant current charges the pad to 2.7 V and discharges it to 0.5 V; cycles are counted in a fixed window. */
export const TOUCH = { window: 0.5e-3, vHigh: 2.7, vLow: 0.5, amps: 12e-6, padF: 20e-12, bodyF: 150e-12, fingerM2: 1.44e-4, noise: 0.8 }

/** Cover over the pad: thickness (m) and relative permittivity. */
const OVERLAYS = { bare: { m: 0.03e-3, er: 3.5 }, thin: { m: 1e-3, er: 3 }, thick: { m: 3e-3, er: 3 } }
export type Overlay = keyof typeof OVERLAYS

/** Water on the cover: wetted area over the pad and its own coupling to ground (a puddle reaches the ground hatch around the pad). */
const WATER = { none: { m2: 0, toGround: 0 }, drop: { m2: 0.2e-4, toGround: 0.5e-12 }, puddle: { m2: 1.2e-4, toGround: 20e-12 } }
export type Water = keyof typeof WATER

const seriesC = (a: number, b: number) => (a > 0 && b > 0 ? (a * b) / (a + b) : 0)

/** Plates through the cover plus an air gap: C = ε₀·A / (t/εr + gap). */
const coverCapacitance = (m2: number, overlay: Overlay, gapM = 0) => {
  const o = OVERLAYS[overlay]
  return (EPSILON_0 * m2) / (o.m / o.er + gapM)
}

/** Finger `gapM` above the cover: pad → finger through the cover, finger → ground through the body. */
export const fingerC = (overlay: Overlay, gapM: number) => seriesC(coverCapacitance(TOUCH.fingerM2, overlay, gapM), TOUCH.bodyF)

export const waterC = (overlay: Overlay, water: Water) => seriesC(coverCapacitance(WATER[water].m2, overlay), WATER[water].toGround)

/** One charge + discharge cycle: T = 2·C·ΔV / I. */
export const padPeriod = (farads: number) => (2 * farads * (TOUCH.vHigh - TOUCH.vLow)) / TOUCH.amps

/** Pad voltage `t` s into the sweep: a triangle between the two thresholds. */
export function padVolts(t: number, farads: number) {
  const T = padPeriod(farads)
  const u = (((t % T) + T) % T) / T
  const span = TOUCH.vHigh - TOUCH.vLow
  return TOUCH.vLow + span * (u < 0.5 ? 2 * u : 2 - 2 * u)
}

/** touchRead(): whole cycles in the window, sample `k` adds noise. */
export function touchCount(farads: number, k?: number) {
  const exact = TOUCH.window / padPeriod(farads)
  return Math.max(0, Math.round(exact + (k === undefined ? 0 : TOUCH.noise * gaussAt(k))))
}

export function padFarads(overlay: Overlay, gapM: number | null, water: Water) {
  return TOUCH.padF + (gapM === null ? 0 : fingerC(overlay, gapM)) + waterC(overlay, water)
}

/** Touched below `on`, released only above `off` (= `on` without hysteresis). */
export const touchState = (was: boolean, count: number, on: number, off: number) => (was ? count <= off : count < on)
