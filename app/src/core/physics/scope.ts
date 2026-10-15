// Oscilloscope maths: 1-2-5 dials, screen scaling, edge triggering, probes, coupling, auto-measurements, UART decode.
const TAU = 2 * Math.PI

export type Edge = 'rise' | 'fall'

const STEPS = [1, 2, 5]
/** The `i`-th setting of a 1-2-5 dial starting at `start` (itself a 1-2-5 value): 1, 2, 5, 10, 20 … */
export function oneTwoFive(i: number, start = 1) {
  const e = Math.floor(Math.log10(start) + 1e-9)
  const j = STEPS.indexOf(Math.round(start / 10 ** e)) + Math.round(i)
  return Number((STEPS[((j % 3) + 3) % 3] * 10 ** (e + Math.floor(j / 3))).toPrecision(3))
}

/** Volts → divisions above the screen centre, with ground drawn `groundDiv` divisions from the centre. */
export const toDivs = (volts: number, voltsPerDiv: number, groundDiv = 0) => groundDiv + volts / voltsPerDiv

/** Fractional sample index where `samples` first cross `level` on `edge`, at or after `from`; null if never.
 *  The trigger arms only once the signal is `hyst` past the level on the far side, so noise can't retrigger. */
export function findTrigger(samples: number[], level: number, edge: Edge, from = 0, hyst = 0): number | null {
  const sign = edge === 'rise' ? 1 : -1
  let armed = false
  let prev = 0
  for (let i = Math.max(0, Math.floor(from)); i < samples.length; i++) {
    const d = sign * (samples[i] - level)
    if (armed && d >= 0) return i - 1 + -prev / (d - prev)
    if (d < -hyst) armed = true
    prev = d
  }
  return null
}

export interface Probe {
  ratio: number
  ohms: number
  farads: number
  bwHz: number
}
export const PROBE_X1: Probe = { ratio: 1, ohms: 1e6, farads: 110e-12, bwHz: 6e6 }
export const PROBE_X10: Probe = { ratio: 10, ohms: 10e6, farads: 12e-12, bwHz: 200e6 }

/** What the scope draws: the pin through the probe's divider, multiplied back by the scope's probe setting. */
export const displayedVolts = (pin: number, probeRatio: number, menuRatio: number) => (pin / probeRatio) * menuRatio

/** 10–90 % rise time of a first-order system of bandwidth `bwHz`. */
export const bandwidthRise = (bwHz: number) => 0.35 / bwHz

/** A ground lead's loop inductance, roughly 1 nH per mm. */
export const leadInductance = (mm: number) => mm * 1e-9

/** Where the ground lead's inductance rings with the probe tip's capacitance. */
export const ringHz = (henries: number, farads: number) => 1 / (TAU * Math.sqrt(henries * farads))

/** How sharply that LC rings when damped by the source and tip resistance `ohms`. */
export const ringQ = (henries: number, farads: number, ohms: number) => Math.sqrt(henries / farads) / ohms

/** First rising edge from `lo` to `hi`: 10–90 % rise time and overshoot past `hi` as a fraction of the step. */
export function edgeStats(samples: number[], dt: number, lo: number, hi: number) {
  const step = hi - lo
  const a = findTrigger(samples, lo + 0.1 * step, 'rise')
  const b = a === null ? null : findTrigger(samples, lo + 0.9 * step, 'rise', Math.floor(a))
  const peak = Math.max(...samples)
  return { rise: a === null || b === null ? NaN : (b - a) * dt, overshoot: Math.max(0, (peak - hi) / step) }
}

/** Probe front end on `input` samples spaced `dt`: the lead/tip LC ring (quality `q`), then the probe's bandwidth pole. */
export function probeResponse(input: number[], dt: number, { ringHz: f, q, bwHz }: { ringHz: number; q: number; bwHz: number }) {
  const w = TAU * f
  const sub = Math.max(1, Math.ceil((w * dt) / 0.05), Math.ceil((TAU * bwHz * dt) / 0.2))
  const h = dt / sub
  const pole = 1 - Math.exp(-TAU * bwHz * h)
  let y = input[0] ?? 0
  let v = 0
  let z = y
  return input.map((x) => {
    for (let k = 0; k < sub; k++) {
      v += (w * w * (x - y) - (w / q) * v) * h
      y += v * h
      z += (y - z) * pole
    }
    return z
  })
}

export const meanOf = (samples: number[]) => samples.reduce((s, x) => s + x, 0) / samples.length

/** AC coupling on whole periods: the series capacitor blocks the average. */
export const acCouple = (samples: number[]) => {
  const m = meanOf(samples)
  return samples.map((x) => x - m)
}

/** The scope's measure menu: peak-to-peak, mean, frequency and duty from rising crossings of the mid level. */
export function measureWave(samples: number[], dt: number) {
  const hi = Math.max(...samples)
  const lo = Math.min(...samples)
  const mid = (hi + lo) / 2
  const hyst = (hi - lo) * 0.1
  const rises: number[] = []
  for (let at = findTrigger(samples, mid, 'rise', 0, hyst); at !== null; at = findTrigger(samples, mid, 'rise', Math.ceil(at), hyst)) rises.push(at)
  if (rises.length < 2) return { vpp: hi - lo, mean: meanOf(samples), hz: 0, duty: NaN }
  const first = Math.ceil(rises[0])
  const last = Math.floor(rises[rises.length - 1])
  const span = samples.slice(first, last)
  const period = ((rises[rises.length - 1] - rises[0]) / (rises.length - 1)) * dt
  return { vpp: hi - lo, mean: meanOf(span), hz: 1 / period, duty: span.filter((x) => x > mid).length / span.length }
}

/** ESP32 LEDC: the 80 MHz APB clock split into 2^bits steps caps resolution at a given PWM frequency. */
export const ledcBits = (hz: number) => Math.floor(Math.log2(80e6 / hz))

/** UART 8N1 frame, LSB first: start 0, eight data bits, stop 1. */
export const uartFrame = (byte: number) => [0, ...Array.from({ length: 8 }, (_, k) => Math.floor(byte / 2 ** k) % 2), 1]

/** TX line (0/1) `t` s after the start edge; idle high before and after. */
export function uartLevel(byte: number, baud: number, t: number) {
  const k = Math.floor(t * baud)
  return k < 0 || k > 9 ? 1 : uartFrame(byte)[k]
}

/** Receiver at `baud`, start edge at t = 0: samples `level` at each bit centre. Framing fails if start ≠ 0 or stop ≠ 1. */
export function uartDecode(level: (t: number) => number, baud: number, threshold = 0.5) {
  const at = Array.from({ length: 10 }, (_, k) => (k + 0.5) / baud)
  const bits = at.map((t) => (level(t) > threshold ? 1 : 0))
  const byte = bits.slice(1, 9).reduce<number>((s, b, k) => s + b * 2 ** k, 0)
  return { at, bits, byte, framingOk: bits[0] === 0 && bits[9] === 1 }
}
