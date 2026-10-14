// Logic levels between supply rails: input thresholds, divider down-shifting, the BSS138 bidirectional shifter.
import { dividerOut } from './circuits'
import { Diode, Mosfet, diodeAmps, fitDiode, mosfetDrain } from './semiconductors'

/** Input thresholds: CMOS inputs scale with VCC (fractions), TTL-compatible ones are fixed volts. */
export interface LogicInput {
  vil: number
  vih: number
  ratio: boolean
}

export const LOGIC_INPUTS = {
  esp32: { vil: 0.25, vih: 0.75, ratio: true },
  atmega328: { vil: 0.3, vih: 0.6, ratio: true },
  ws2812: { vil: 0.3, vih: 0.7, ratio: true },
  hct: { vil: 0.8, vih: 2, ratio: false },
} satisfies Record<string, LogicInput>

/** ESP32 pins are not 5 V tolerant: absolute maximum is VDD + 0.3 V. */
export const ESP32_ABS_MAX = 3.6

export const thresholds = (f: LogicInput, vcc: number) => (f.ratio ? { vil: f.vil * vcc, vih: f.vih * vcc } : { vil: f.vil, vih: f.vih })

/** 0 or 1, or null in the forbidden band between VIL and VIH. */
export function readInput(volts: number, f: LogicInput, vcc: number): 0 | 1 | null {
  const { vil, vih } = thresholds(f, vcc)
  return volts <= vil ? 0 : volts >= vih ? 1 : null
}

/** Noise margins: how far the driver's HIGH sits above VIH and its LOW below VIL. Negative = will misread. */
export function noiseMargins(voh: number, vol: number, f: LogicInput, vcc: number) {
  const { vil, vih } = thresholds(f, vcc)
  return { high: voh - vih, low: vil - vol }
}

/** Resistor divider into a pin with capacitance `farads`: steady level, current drawn, and τ = (R1 ∥ R2)·C. */
export function dividerShift(vin: number, r1: number, r2: number, farads: number) {
  return { vout: dividerOut(vin, r1, r2), amps: vin / (r1 + r2), tau: ((r1 * r2) / (r1 + r2)) * farads }
}

/** Time for an RC edge heading to `final` to cross `target`: τ·ln(final / (final − target)). */
export const riseTime = (target: number, final: number, tau: number) => (target >= final ? Infinity : tau * Math.log(final / (final - target)))

export const BSS138: Mosfet = { vthV: 1.3, k: 0.5, n: 1.5, lambda: 0.02 }
export const BODY_DIODE: Diode = fitDiode(0.85, 1.5, 0.115)

export interface Shifter {
  lowRail: number
  highRail: number
  lowPull: number
  highPull: number
  fet: Mosfet
  /** Open-drain drivers holding each side low, and their on-resistance. */
  pullLow: boolean
  pullHigh: boolean
  driveOhms?: number
}

/** BSS138-style shifter: gate on the low rail, source on the low side, drain on the high side, body diode source → drain.
 *  Gauss–Seidel over the two nodes, bisecting each (every branch current is monotonic in its own node). */
export function shifterSolve(s: Shifter) {
  const rd = s.driveOhms ?? 25
  const top = Math.max(s.lowRail, s.highRail)
  const channel = (vl: number, vh: number) => mosfetDrain(s.lowRail - vl, vh - vl, s.fet).amps
  const diode = (vl: number, vh: number) => diodeAmps(vl - vh, BODY_DIODE)
  const lowKcl = (vl: number, vh: number) => (s.lowRail - vl) / s.lowPull + channel(vl, vh) - diode(vl, vh) - (s.pullLow ? vl / rd : 0)
  const highKcl = (vh: number, vl: number) => (s.highRail - vh) / s.highPull - channel(vl, vh) + diode(vl, vh) - (s.pullHigh ? vh / rd : 0)
  const bisect = (f: (v: number) => number) => {
    let lo = 0
    let hi = top
    for (let k = 0; k < 60; k++) {
      const v = (lo + hi) / 2
      if (f(v) > 0) lo = v
      else hi = v
    }
    return (lo + hi) / 2
  }
  let vl = s.lowRail
  let vh = s.highRail
  for (let k = 0; k < 400; k++) {
    vl = bisect((v) => lowKcl(v, vh))
    vh = bisect((v) => highKcl(v, vl))
  }
  const channelA = channel(vl, vh)
  const diodeA = diode(vl, vh)
  return { vl, vh, vgs: s.lowRail - vl, channelA, diodeA, on: Math.abs(channelA) > 10 * Math.abs(diodeA) && Math.abs(channelA) > 1e-5 }
}
