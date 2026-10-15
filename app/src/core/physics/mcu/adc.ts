// SAR ADC on an ESP32: quantisation vs bits and range, the binary search, noise vs averaging, the real chip's attenuation curves.
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export const ADC_BITS = 12

/** One step (least significant bit) of a `bits`-bit ADC spanning 0 … `full` volts. */
export const lsb = (full: number, bits: number) => full / 2 ** bits
/** What a SAR returns: floor(v / LSB), clamped to 0 … 2ᴺ − 1. */
export const quantize = (v: number, full: number, bits: number) => clamp(Math.floor(v / lsb(full, bits)), 0, 2 ** bits - 1)
/** The middle of a code's step, so the error stays within ±½ LSB. */
export const codeVolts = (code: number, full: number, bits: number) => (code + 0.5) * lsb(full, bits)
export const clipped = (v: number, full: number) => v >= full

export interface SarStep {
  bit: number
  trial: number
  dac: number
  keep: boolean
  code: number
}

/** Binary search, MSB first: set the bit, let the DAC make that trial voltage, keep the bit if the held input is still ≥ it. */
export function sarSteps(held: number, full: number, bits: number): SarStep[] {
  const steps: SarStep[] = []
  let code = 0
  for (let bit = bits - 1; bit >= 0; bit--) {
    const trial = code + 2 ** bit
    const dac = trial * lsb(full, bits)
    const keep = held >= dac
    if (keep) code = trial
    steps.push({ bit, trial, dac, keep, code })
  }
  return steps
}

/** Deterministic standard normal for index `k` (sine hash + Box–Muller), so noise looks random but tests are stable. */
export function gaussAt(k: number) {
  const u = (i: number) => {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    return Math.min(1 - 1e-12, Math.max(1e-12, x - Math.floor(x)))
  }
  return Math.sqrt(-2 * Math.log(u(2 * k + 1))) * Math.cos(2 * Math.PI * u(2 * k + 2))
}

/** Reading number `k` of a steady `v` with `sigma` V rms of noise on the pin. */
export const noisyReading = (v: number, sigma: number, full: number, bits: number, k: number) => quantize(v + sigma * gaussAt(k), full, bits)

/** Mean code of readings k … k + n − 1. */
export function averagedReading(v: number, sigma: number, n: number, full: number, bits: number, k: number) {
  let sum = 0
  for (let i = 0; i < n; i++) sum += noisyReading(v, sigma, full, bits, k + i)
  return sum / n
}

/** Rms error after averaging `n` readings: noise falls as 1/√n; quantisation only averages away once noise dithers it (σ ≳ ½ LSB). */
export function averagedRms(sigma: number, step: number, n: number) {
  const q2 = (step * step) / 12
  return Math.sqrt((sigma * sigma) / n + (sigma >= step / 2 ? q2 / n : q2))
}

/** Effective bits: an ideal ADC whose quantisation error alone has this rms. 4× the samples buys one bit. */
export const effectiveBits = (full: number, rms: number) => Math.log2(full / (rms * Math.sqrt(12)))

// --- ESP32 (original) ADC: attenuation sets the range; the ends bend; per-chip Vref; ADC2 is shared with Wi-Fi. ---

export type AttenKey = '0' | '2.5' | '6' | '11'

/** `full`: where the linear part would reach 4095; `lo`…`hi`: Espressif's recommended (linear) range. */
export const ESP32_ATTEN: Record<AttenKey, { db: number; full: number; lo: number; hi: number; arduino: string; idf: string }> = {
  '0': { db: 0, full: 1.1, lo: 0.1, hi: 0.95, arduino: 'ADC_0db', idf: 'ADC_ATTEN_DB_0' },
  '2.5': { db: 2.5, full: 1.5, lo: 0.1, hi: 1.25, arduino: 'ADC_2_5db', idf: 'ADC_ATTEN_DB_2_5' },
  '6': { db: 6, full: 2.2, lo: 0.15, hi: 1.75, arduino: 'ADC_6db', idf: 'ADC_ATTEN_DB_6' },
  '11': { db: 11, full: 3.1, lo: 0.15, hi: 2.45, arduino: 'ADC_11db', idf: 'ADC_ATTEN_DB_12' },
}

export const ESP32_VREF = 1.1
export const ADC_MAX = 2 ** ADC_BITS - 1

/** Raw 12-bit reading of the original ESP32: dead below ~lo/2, a toe up to lo, linear to hi, then bowing flat to 4095.
 *  `vref` is this chip's reference (1.0 … 1.2 V; nominal 1.1 V), which scales the gain. */
export function esp32Raw(v: number, atten: AttenKey, vref = ESP32_VREF) {
  const a = ESP32_ATTEN[atten]
  const s = (ADC_MAX / a.full) * (ESP32_VREF / vref)
  const off = 0.75 * a.lo
  const dead = 2 * off - a.lo
  const cHi = s * (a.hi - off)
  const top = a.hi + (2 * (ADC_MAX - cHi)) / s
  let c: number
  if (v <= dead) c = 0
  else if (v < a.lo) c = (s * (v - dead) ** 2) / (2 * (a.lo - dead))
  else if (v <= a.hi) c = s * (v - off)
  else if (v < top) c = cHi + s * (v - a.hi) - (s * (v - a.hi) ** 2) / (2 * (top - a.hi))
  else c = ADC_MAX
  return clamp(Math.round(c), 0, ADC_MAX)
}

/** The common shortcut: raw / 4095 × 3.3 V, ignoring attenuation and chip. */
export const naiveVolts = (raw: number) => (raw / ADC_MAX) * 3.3
/** What adc_cali_raw_to_voltage does: invert the linear fit using the Vref burned into this chip's eFuse. Exact only between lo and hi. */
export function calibratedVolts(raw: number, atten: AttenKey, vref = ESP32_VREF) {
  const a = ESP32_ATTEN[atten]
  const s = (ADC_MAX / a.full) * (ESP32_VREF / vref)
  return raw / s + 0.75 * a.lo
}

/** ADC2 shares its hardware with the Wi-Fi radio: while Wi-Fi is on, ADC2 reads fail (ESP_ERR_TIMEOUT). */
export const adcReadable = (unit: 1 | 2, wifi: boolean) => unit === 1 || !wifi

/** Sample-and-hold: the value seen at time `t` is the input frozen at the last sample instant (rate `fs`). */
export const heldAt = (signal: (t: number) => number, t: number, fs: number) => signal(Math.floor(t * fs) / fs)
