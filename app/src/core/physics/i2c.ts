// I²C bus: addresses and select pins, open-drain pull-ups vs bus capacitance, MPU-6050 register reads, bus scans.
import { Vec3 } from '../fields'
import { GPIO_VDD } from './gpio'
import { LOGIC_INPUTS, thresholds } from './levels'

export interface I2cChip {
  name: string
  /** 7-bit address with every select pin low. */
  base: number
  /** Address-select pin, and how many address options it gives. */
  pin: string
  options: number
}

export const I2C_CHIPS = {
  mpu6050: { name: 'MPU-6050', base: 0x68, pin: 'AD0', options: 2 },
  bmp280: { name: 'BMP280', base: 0x76, pin: 'SDO', options: 2 },
  ssd1306: { name: 'SSD1306', base: 0x3c, pin: 'SA0', options: 2 },
  pcf8574: { name: 'PCF8574', base: 0x20, pin: 'A0–A2', options: 8 },
} satisfies Record<string, I2cChip>

/** Select pins add straight onto the base address. */
export const chipAddress = (c: I2cChip, select: number) => c.base + (Math.max(0, Math.round(select)) % c.options)

export const SCAN_FIRST = 0x08
export const SCAN_LAST = 0x77
/** 0x00–0x07 and 0x78–0x7F are reserved (general call, CBUS, 10-bit, HS mode). */
export const isReserved = (addr: number) => addr < SCAN_FIRST || addr > SCAN_LAST

/** Who answers a call: the indices of chips at `addr`; more than one is a conflict. */
export function busAnswer(addrs: number[], addr: number) {
  const ackers = addrs.flatMap((a, i) => (a === addr ? [i] : []))
  return { ackers, ack: ackers.length > 0, conflict: ackers.length > 1 }
}

/** Addresses shared by two or more chips. */
export const addressConflicts = (addrs: number[]) => [...new Set(addrs.filter((a, i) => addrs.indexOf(a) !== i))]

/** Probes every address from `from` to `to` with an empty write; ACK = something is there. */
export function i2cScan(present: number[], from = SCAN_FIRST, to = SCAN_LAST) {
  const probes = Array.from({ length: to - from + 1 }, (_, k) => ({ addr: from + k, ack: present.includes(from + k) }))
  return { probes, found: probes.filter((p) => p.ack).map((p) => p.addr) }
}

/** Bus time per probe: START + 8 bits + ACK + STOP ≈ 11.25 clocks. */
export const probeTime = (hz: number) => 45 / (4 * hz)

// --- Pull-ups: open-drain lines rise through R into the bus capacitance; falls are fast. ---

export interface I2cMode {
  hz: number
  /** Max rise time, 30 % → 70 % VDD. */
  trMax: number
}
export const I2C_MODES = {
  standard: { hz: 100e3, trMax: 1000e-9 },
  fast: { hz: 400e3, trMax: 300e-9 },
} satisfies Record<string, I2cMode>
export const I2C_CB_MAX = 400e-12
/** Spec sink current at VOL = 0.4 V. */
export const I2C_SINK_A = 3e-3
export const I2C_VOL = 0.4
/** Pull-down on-resistance implied by the spec (0.4 V at 3 mA). */
export const SINK_OHMS = I2C_VOL / I2C_SINK_A
const RISE_K = Math.log(7 / 3)

/** Spec rise time, 30 % → 70 % VDD: ln(7/3)·RC ≈ 0.85 RC. */
export const i2cRiseTime = (ohms: number, farads: number) => RISE_K * ohms * farads
/** Smallest pull-up that still lets a driver pull the line to VOL at 3 mA. */
export const pullupMin = (vdd = GPIO_VDD) => (vdd - I2C_VOL) / I2C_SINK_A
/** Largest pull-up that meets the mode's rise-time limit on `farads`. */
export const pullupMax = (farads: number, mode: I2cMode) => mode.trMax / (RISE_K * farads)
/** LOW level when a driver pulls against the pull-up. */
export const lowVolts = (ohms: number, vdd = GPIO_VDD) => (vdd * SINK_OHMS) / (ohms + SINK_OHMS)

/** SCL as the bus really sees it, in periodic steady state: the clock lets go for half a period (RC rise to VDD) and pulls
 *  low for the other half (fast fall to the LOW level). `level(t)` in volts, `top` = highest voltage reached. */
export function openDrainClock(hz: number, ohms: number, farads: number, vdd = GPIO_VDD) {
  const half = 1 / (2 * hz)
  const vLow = lowVolts(ohms, vdd)
  const tauUp = ohms * farads
  const tauDown = ((ohms * SINK_OHMS) / (ohms + SINK_OHMS)) * farads
  const a = Math.exp(-half / tauUp)
  const b = Math.exp(-half / tauDown)
  // top = vdd + (bottom − vdd)·a, bottom = vLow + (top − vLow)·b
  const top = (vdd * (1 - a) + a * vLow * (1 - b)) / (1 - a * b)
  const bottom = vLow + (top - vLow) * b
  const level = (t: number) => {
    const ph = ((t % (2 * half)) + 2 * half) % (2 * half)
    return ph < half ? vdd + (bottom - vdd) * Math.exp(-ph / tauUp) : vLow + (top - vLow) * Math.exp(-(ph - half) / tauDown)
  }
  const vih = thresholds(LOGIC_INPUTS.esp32, vdd).vih
  /** Time into the high half before the line crosses VIH (Infinity if it never does). */
  const toHigh = top < vih ? Infinity : bottom >= vih ? 0 : tauUp * Math.log((vdd - bottom) / (vdd - vih))
  return { level, top, bottom, vih, toHigh, half, ok: toHigh < half * 0.5 }
}

// --- MPU-6050: 14 bytes from 0x3B, big-endian signed: accel X Y Z, temperature, gyro X Y Z. ---

export const MPU6050 = { addr: 0x68, accelOut: 0x3b, burst: 14, lsbPerG: 16384, lsbPerDps: 131 }

export const toInt16 = (hi: number, lo: number) => {
  const v = hi * 256 + lo
  return v >= 32768 ? v - 65536 : v
}
export function int16Bytes(v: number): [number, number] {
  const c = Math.max(-32768, Math.min(32767, Math.round(v)))
  const u = (c + 65536) % 65536
  return [Math.floor(u / 256), u % 256]
}

/** Gravity as the sensor sees it (g) when pitched about Y and rolled about X; flat reads (0, 0, 1). */
export const tiltAccel = (pitch: number, roll: number): Vec3 => [-Math.sin(pitch), Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch)]
/** Pitch back from an accel reading. */
export const accelPitch = ([x, y, z]: Vec3) => Math.atan2(-x, Math.hypot(y, z))

/** The 14-byte burst for accel (g), gyro (°/s) and die temperature (°C), at ±2 g and ±250 °/s. */
export function mpu6050Burst(accel: Vec3, gyro: Vec3, tempC: number) {
  const words = [...accel.map((g) => g * MPU6050.lsbPerG), (tempC - 36.53) * 340, ...gyro.map((d) => d * MPU6050.lsbPerDps)]
  return words.flatMap(int16Bytes)
}

/** Raw counts and scaled values back from the burst. */
export function mpu6050Parse(bytes: number[]) {
  const raw = Array.from({ length: 7 }, (_, k) => toInt16(bytes[2 * k], bytes[2 * k + 1]))
  return {
    raw,
    accel: raw.slice(0, 3).map((r) => r / MPU6050.lsbPerG) as Vec3,
    tempC: raw[3] / 340 + 36.53,
    gyro: raw.slice(4).map((r) => r / MPU6050.lsbPerDps) as Vec3,
  }
}
