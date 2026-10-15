// Temperature: NTC curve fits (Beta, Steinhart–Hart, raw-count table), divider readout + self-heating, thermal lag;
// DS18B20 1-Wire reset/write/read slots, ROM CRC, 1/16 °C format, conversion time.
import { codeVolts, quantize } from '../mcu/adc'

const K0 = 273.15
const VDD = 3.3
const BITS = 12

/** 10 kΩ NTC bead sold as "B = 3950": its real Beta creeps up with temperature (3950 at 85 °C). */
export const NTC = { r25: 10e3, b85: 3950, bSlope: 1.2 }

const bAt = (tC: number) => NTC.b85 + NTC.bSlope * (tC - 85)

/** The part's true resistance (Ω) at `tC`. */
export const ntcOhms = (tC: number) => NTC.r25 * Math.exp(bAt(tC) * (1 / (tC + K0) - 1 / (25 + K0)))

/** True temperature (°C) for a resistance: the curve above, inverted by bisection. */
export function ntcTrueC(ohms: number) {
  let lo = -80
  let hi = 250
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (ntcOhms(mid) > ohms) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Datasheet Beta between two temperatures: B = ln(R1/R2) / (1/T1 − 1/T2). */
export const betaBetween = (t1: number, t2: number) => Math.log(ntcOhms(t1) / ntcOhms(t2)) / (1 / (t1 + K0) - 1 / (t2 + K0))

/** Beta equation inverted: 1/T = 1/T25 + ln(R/R25)/B. */
export const betaC = (ohms: number, b: number, r25 = NTC.r25) => 1 / (1 / (25 + K0) + Math.log(ohms / r25) / b) - K0

export type ShCoef = { a: number; b: number; c: number }

/** Steinhart–Hart a, b, c through three calibration temperatures (1/T = a + b·L + c·L³, L = ln R). */
export function shFit(t1: number, t2: number, t3: number): ShCoef {
  const [L1, L2, L3] = [t1, t2, t3].map((t) => Math.log(ntcOhms(t)))
  const [Y1, Y2, Y3] = [t1, t2, t3].map((t) => 1 / (t + K0))
  const g2 = (Y2 - Y1) / (L2 - L1)
  const g3 = (Y3 - Y1) / (L3 - L1)
  const c = (g3 - g2) / (L3 - L2) / (L1 + L2 + L3)
  const b = g2 - c * (L1 * L1 + L1 * L2 + L2 * L2)
  const a = Y1 - (b + c * L1 * L1) * L1
  return { a, b, c }
}

export const shC = (ohms: number, { a, b, c }: ShCoef) => {
  const L = Math.log(ohms)
  return 1 / (a + b * L + c * L ** 3) - K0
}

/** ESP32 12-bit count with the NTC at the bottom of a divider under `rFix` across 3.3 V. */
export const ntcRaw = (ohms: number, rFix: number) => quantize((VDD * ohms) / (ohms + rFix), VDD, BITS)

/** NTC resistance back from a count (mid-code voltage). */
export const rawOhms = (raw: number, rFix: number) => {
  const v = codeVolts(raw, VDD, BITS)
  return (rFix * v) / (VDD - v)
}

/** Lookup table: raw counts at `fromC`, `fromC + stepC`, … (rising temperature = falling count). */
export const rawTable = (rFix: number, fromC: number, toC: number, stepC: number) =>
  Array.from({ length: Math.round((toC - fromC) / stepC) + 1 }, (_, i) => {
    const t = fromC + i * stepC
    return [t, ntcRaw(ntcOhms(t), rFix)] as [number, number]
  })

/** Straight-line interpolation of a count between table rows; clamps past the ends. */
export function tableC(raw: number, rows: [number, number][]) {
  if (raw >= rows[0][1]) return rows[0][0]
  for (let i = 1; i < rows.length; i++) {
    const [t1, r1] = rows[i]
    if (raw >= r1) {
      const [t0, r0] = rows[i - 1]
      return t0 + ((t1 - t0) * (r0 - raw)) / (r0 - r1)
    }
  }
  return rows[rows.length - 1][0]
}

/** Power (W) the divider current dissipates in the NTC. */
export const ntcWatts = (ohms: number, rFix: number) => (VDD / (ohms + rFix)) ** 2 * ohms

/** Bead temperature (°C) in a medium at `tC`: warmed by its own divider current, δ = dissipation constant (W/K). */
export function selfHeatedC(tC: number, rFix: number, deltaWPerK: number) {
  let t = tC
  for (let i = 0; i < 20; i++) t = tC + ntcWatts(ntcOhms(t), rFix) / deltaWPerK
  return t
}

/** °C per ADC count at `tC`: how coarse the reading is there. */
export const degPerCount = (tC: number, rFix: number) => {
  const r0 = ntcRaw(ntcOhms(tC - 0.5), rFix)
  const r1 = ntcRaw(ntcOhms(tC + 0.5), rFix)
  return 1 / Math.max(1e-9, r0 - r1)
}

/** Heat capacity (J/K) and dissipation constant per medium (W/K): 2.4 mm epoxy bead vs DS18B20 in a 6 mm steel probe. */
export const THERMAL = {
  bead: { heatJPerK: 0.015, delta: { still: 0.0015, air: 0.0035, water: 0.015 } },
  probe: { heatJPerK: 2, delta: { still: 0.02, air: 0.05, water: 0.3 } },
}
export type Medium = keyof typeof THERMAL.bead.delta

/** Thermal time constant τ = C / δ (s): 63 % of a step after τ, 99 % after 5τ. */
export const thermalTau = (part: keyof typeof THERMAL, medium: Medium) => THERMAL[part].heatJPerK / THERMAL[part].delta[medium]

/** Reading in °C → ADC → Ω → °C via one conversion method. */
export type NtcMethod = 'beta' | 'sh' | 'table'
export function ntcReading(tC: number, rFix: number, method: NtcMethod, deltaWPerK = Infinity) {
  const sensed = Number.isFinite(deltaWPerK) ? selfHeatedC(tC, rFix, deltaWPerK) : tC
  const raw = ntcRaw(ntcOhms(sensed), rFix)
  const ohms = rawOhms(raw, rFix)
  const read = method === 'beta' ? betaC(ohms, betaBetween(25, 85)) : method === 'sh' ? shC(ohms, shFit(0, 25, 85)) : tableC(raw, rawTable(rFix, -40, 150, 10))
  return { raw, ohms, read, selfHeat: sensed - tC, error: read - tC }
}

// --- DS18B20 on 1-Wire ---

/** Slot timings (µs): reset low ≥ 480, presence 60–240 µs after a 15–60 µs wait, 60 µs slots + recovery, sample at 15 µs. */
export const OW = { reset: 480, wait: 30, presence: 120, frame: 960, slot: 60, gap: 5, low1: 6, low0: 60, readLow: 3, hold0: 30, sample: 13 }

export type OwPull = { t0: number; t1: number; by: 'host' | 'sensor' }
export type OwBit = { t0: number; t1: number; bit: 0 | 1; read: boolean }
export interface OwFrame {
  len: number
  pulls: OwPull[]
  bits: OwBit[]
}

/** Reset + presence: the host holds the line low 480 µs; every sensor answers by pulling it low after a short wait. */
export const owReset = (): OwFrame => ({
  len: OW.frame,
  pulls: [
    { t0: 0, t1: OW.reset, by: 'host' },
    { t0: OW.reset + OW.wait, t1: OW.reset + OW.wait + OW.presence, by: 'sensor' },
  ],
  bits: [],
})

const SLOT = OW.slot + OW.gap

/** Bytes as LSB-first slots. Write: host low 6 µs = 1, 60 µs = 0. Read: host taps 3 µs, a sensor sending 0 holds the line to 30 µs. */
export function owBytes(bytes: number[], read = false): OwFrame {
  const pulls: OwPull[] = []
  const bits: OwBit[] = []
  bytes.forEach((byte, k) => {
    for (let i = 0; i < 8; i++) {
      const t0 = (k * 8 + i) * SLOT
      const bit = (Math.floor(byte / 2 ** i) % 2) as 0 | 1
      bits.push({ t0, t1: t0 + SLOT, bit, read })
      pulls.push({ t0, t1: t0 + (read ? OW.readLow : bit ? OW.low1 : OW.low0), by: 'host' })
      if (read && !bit) pulls.push({ t0, t1: t0 + OW.hold0, by: 'sensor' })
    }
  })
  return { len: bytes.length * 8 * SLOT, pulls, bits }
}

/** Who holds the open-drain line low at `t` (µs); the bus is low if anyone is. */
export const owPulling = (f: OwFrame, t: number, by?: OwPull['by']) => f.pulls.some((p) => t >= p.t0 && t < p.t1 && (!by || p.by === by))

/** Dallas/Maxim CRC-8 (x⁸ + x⁵ + x⁴ + 1, LSB first): the last ROM byte; CRC over all 8 bytes = 0. */
export function crc8(bytes: number[]) {
  const xor = (a: number, b: number) => Array.from({ length: 8 }, (_, k) => (Math.floor(a / 2 ** k) % 2 !== Math.floor(b / 2 ** k) % 2 ? 2 ** k : 0)).reduce((x, y) => x + y)
  let crc = 0
  for (const b of bytes) {
    let x = b
    for (let i = 0; i < 8; i++) {
      const mix = crc % 2 !== x % 2
      crc = Math.floor(crc / 2)
      if (mix) crc = xor(crc, 0x8c)
      x = Math.floor(x / 2)
    }
  }
  return crc
}

export const DS18B20_FAMILY = 0x28

/** 64-bit ROM as sent (LSB first): family 0x28, 48-bit serial, CRC. */
export function romId(serial: number[]) {
  const head = [DS18B20_FAMILY, ...serial]
  return [...head, crc8(head)]
}

export const OW_CMD = { skipRom: 0xcc, matchRom: 0x55, convert: 0x44, readScratch: 0xbe }

/** Temperature register: two's complement, 1/16 °C, low bits undefined (cleared here) below 12-bit resolution. */
export const ds18Raw = (tC: number, bits = 12) => {
  const step = 2 ** (12 - bits)
  return (Math.floor(Math.round(tC * 16) / step) * step + 0x10000) % 0x10000
}

export const ds18C = (raw: number) => (raw >= 0x8000 ? raw - 0x10000 : raw) / 16

/** Conversion time: 750 ms at 12 bits, halving per bit dropped. */
export const ds18ConvMs = (bits: number) => 750 / 2 ** (12 - bits)

/** Bus time (µs) to read `n` sensors: one Skip ROM + Convert T for all, then per sensor Match ROM + 8 ROM bytes, Read Scratchpad, 2 bytes. */
export const owReadAllUs = (n: number) => OW.frame + 2 * 8 * SLOT + n * (OW.frame + 11 * 8 * SLOT)
