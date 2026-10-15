// UART: framing with parity/stop bits, a 16× oversampling receiver, line standards (TTL, RS-232, RS-485) and NMEA sentences.
import { uartFrame } from '../signals/scope'
import { hash01 } from './timers'

export type Parity = 'none' | 'even' | 'odd'
export type BitRole = 'start' | 'data' | 'parity' | 'stop'
export interface UartFormat {
  parity: Parity
  stop: 1 | 2
}
export interface UartBit {
  bit: number
  role: BitRole
}
export const FORMAT_8N1: UartFormat = { parity: 'none', stop: 1 }

const ones = (byte: number) => uartFrame(byte).slice(1, 9).reduce((s, b) => s + b, 0)
/** Even parity makes the count of 1s (data + parity) even; odd makes it odd. */
export const parityBit = (byte: number, parity: Exclude<Parity, 'none'>) => (ones(byte) + (parity === 'odd' ? 1 : 0)) % 2
export const frameLength = (f: UartFormat) => 9 + (f.parity === 'none' ? 0 : 1) + f.stop

/** Start 0, eight data bits LSB first, optional parity, one or two stop 1s. */
export function uartBits(byte: number, f: UartFormat = FORMAT_8N1): UartBit[] {
  const data = uartFrame(byte).slice(1, 9).map((bit): UartBit => ({ bit, role: 'data' }))
  const parity: UartBit[] = f.parity === 'none' ? [] : [{ bit: parityBit(byte, f.parity), role: 'parity' }]
  const stop = Array.from({ length: f.stop }, (): UartBit => ({ bit: 1, role: 'stop' }))
  return [{ bit: 0, role: 'start' }, ...data, ...parity, ...stop]
}

/** Bytes sent back to back at `baud`, `gap` idle bits after each frame; the line idles high. */
export function uartStream(bytes: number[], baud: number, f: UartFormat = FORMAT_8N1, gap = 0) {
  const frames = bytes.map((b) => uartBits(b, f))
  const slot = frameLength(f) + gap
  const starts = bytes.map((_, i) => (i * slot) / baud)
  const level = (t: number) => {
    const u = t * baud + 1e-9
    const i = Math.floor(u / slot)
    if (i < 0 || i >= frames.length) return 1
    return frames[i][Math.floor(u - i * slot)]?.bit ?? 1
  }
  return { frames, starts, level, duration: (bytes.length * slot) / baud }
}

/** Which TX frame and bit cell is on the line at `t` (frame −1 before the first start). */
export function txBitAt(starts: number[], baud: number, t: number) {
  let frame = -1
  while (frame + 1 < starts.length && starts[frame + 1] <= t + 1e-12) frame++
  return { frame, bit: frame < 0 ? -1 : Math.floor((t - starts[frame]) * baud + 1e-9) }
}

export interface RxFrame {
  start: number
  at: number[]
  bits: number[]
  byte: number
  parityOk: boolean
  framingOk: boolean
}

/** Receiver at `baud`: waits for idle, finds the falling start edge at 16× oversampling, samples each bit centre,
 *  then hunts again from the last stop sample. Partial frames past `duration` are dropped. */
export function uartReceive(level: (t: number) => number, baud: number, f: UartFormat, duration: number, threshold = 0.5): RxFrame[] {
  const n = frameLength(f)
  const step = 1 / (16 * baud)
  const out: RxFrame[] = []
  let armed = level(-step) > threshold
  for (let i = 0; i * step < duration; i++) {
    const t = i * step
    if (level(t) > threshold) {
      armed = true
      continue
    }
    if (!armed) continue
    const at = Array.from({ length: n }, (_, k) => t + (k + 0.5) / baud)
    if (at[n - 1] > duration) break
    const bits = at.map((s) => (level(s) > threshold ? 1 : 0))
    const byte = bits.slice(1, 9).reduce<number>((s, b, k) => s + b * 2 ** k, 0)
    const parityOk = f.parity === 'none' || bits[9] === parityBit(byte, f.parity)
    const framingOk = bits[0] === 0 && bits.slice(n - f.stop).every((b) => b === 1)
    out.push({ start: t, at, bits, byte, parityOk, framingOk })
    i = Math.ceil(at[n - 1] / step)
    armed = false
  }
  return out
}

/** Clock mismatch the last stop sample survives: it must land within half a bit of its cell centre. */
export const baudTolerance = (f: UartFormat) => 0.5 / (frameLength(f) - 0.5)
/** How far (in TX bits) sample `k` has slid from its cell centre when the receiver counts at `rxBaud`. */
export const sampleDrift = (txBaud: number, rxBaud: number, k: number) => (k + 0.5) * (txBaud / rxBaud - 1)

// --- Line standards: what a 1 and a 0 look like on the cable, and how far each survives. ---

export type SerialStd = 'ttl' | 'rs232' | 'rs485'
export interface LineStd {
  /** Receiver-side volts for logic 1 (mark, idle) and 0 (space): single-ended to GND, or A − B. */
  mark: number
  space: number
  threshold: number
  /** Inputs inside ±band of the threshold are undefined. */
  band: number
  rOut: number
  diff: boolean
  ratedM: number
}
export const LINE_STDS: Record<SerialStd, LineStd> = {
  ttl: { mark: 3.3, space: 0, threshold: 1.65, band: 0.8, rOut: 50, diff: false, ratedM: 1 },
  rs232: { mark: -9, space: 9, threshold: 1.4, band: 1.6, rOut: 300, diff: false, ratedM: 15 },
  rs485: { mark: 2.5, space: -2.5, threshold: 0, band: 0.2, rOut: 30, diff: true, ratedM: 1200 },
}
export const CABLE_PF_PER_M = 100e-12
export const CABLE_OHM_PER_M = 0.084
export const RS485_TERM = 120
/** RS-485 drivers keep the pair near 2.5 V common mode. */
export const RS485_CM = 2.5
/** Fraction of common-mode noise a twisted pair leaves as differential error. */
export const TWIST_RESIDUAL = 0.03

/** Copper loss: RS-485 drives two parallel 120 Ω terminators through both wires; high-Z inputs lose nothing. */
export const lineGain = (std: SerialStd, meters: number) =>
  std === 'rs485' ? RS485_TERM / 2 / (RS485_TERM / 2 + 2 * CABLE_OHM_PER_M * meters) : 1
/** Edge time constant: driver resistance charging the cable capacitance. */
export const lineTau = (std: SerialStd, meters: number) => LINE_STDS[std].rOut * CABLE_PF_PER_M * meters
/** Interference coupled into a cable near a motor: grows with length, saturating once the run passes it. */
export const pickupVolts = (sourceV: number, meters: number) => (sourceV * meters) / (meters + 20)
/** Normalised noise ±1: 23 kHz PWM ripple plus motor-brush spikes. */
export const motorNoise = (t: number) => 0.5 * Math.sin(2 * Math.PI * 23e3 * t) + 0.5 * (2 * hash01(Math.floor(t * 300e3)) - 1)

/** Sends `bits` at `baud` down `meters` of cable near a noise source; the receiver reads each bit centre. */
export function serialLink(std: SerialStd, meters: number, noiseV: number, bits: number[], baud: number, perBit = 32) {
  const s = LINE_STDS[std]
  const dt = 1 / (baud * perBit)
  const gain = lineGain(std, meters)
  const k = 1 - Math.exp(-dt / Math.max(lineTau(std, meters), 1e-12))
  const pick = pickupVolts(noiseV, meters)
  const drive: number[] = []
  const rx: number[] = []
  const cm: number[] = []
  const clean: number[] = []
  let v = s.mark * gain
  for (let i = 0; i < bits.length * perBit; i++) {
    const target = (bits[Math.floor(i / perBit)] ? s.mark : s.space) * gain
    v += (target - v) * k
    clean.push(v)
    const n = pick * motorNoise(i * dt)
    drive.push(target)
    rx.push(v + (s.diff ? TWIST_RESIDUAL * n : n))
    cm.push(s.diff ? RS485_CM + n : 0)
  }
  const centre = (b: number) => b * perBit + Math.floor(perBit / 2)
  const up = s.mark > s.space ? 1 : -1
  const read = bits.map((_, b) => ((rx[centre(b)] > s.threshold) === (up > 0) ? 1 : 0))
  const errors = read.filter((r, b) => r !== bits[b]).length
  const swing = Math.max(...clean) - Math.min(...clean)
  const noise = s.diff ? TWIST_RESIDUAL * pick : pick
  /** Worst clean bit centre's distance past the threshold on its own side, less the noise. */
  const margin = Math.min(...bits.map((x, b) => (x ? up : -up) * (clean[centre(b)] - s.threshold))) - noise
  return { dt, drive, rx, cm, read, errors, swing, noise, margin }
}

// --- NMEA 0183: what a GPS module streams at 9600 baud. ---

/** XOR of every character between `$` and `*`, as two hex digits. */
export const nmeaChecksum = (body: string) =>
  [...body]
    .reduce((x, c) => xor8(x, c.charCodeAt(0)), 0)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')
const xor8 = (a: number, b: number) =>
  Array.from({ length: 8 }, (_, k) => ((Math.floor(a / 2 ** k) + Math.floor(b / 2 ** k)) % 2) * 2 ** k).reduce((x, y) => x + y, 0)
const wrap = (body: string) => `$${body}*${nmeaChecksum(body)}`

const hhmmss = (sec: number) => {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400
  return [s / 3600, (s / 60) % 60, s % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join('') + '.00'
}
/** Degrees → NMEA ddmm.mmmmm (dddmm.mmmmm for longitude) and hemisphere. */
export function nmeaCoord(deg: number, lon: boolean): [string, string] {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const m = (a - d) * 60
  const dd = String(d).padStart(lon ? 3 : 2, '0')
  return [`${dd}${m.toFixed(5).padStart(8, '0')}`, lon ? (deg < 0 ? 'W' : 'E') : deg < 0 ? 'S' : 'N']
}
/** NMEA ddmm.mmmmm + hemisphere → signed degrees. */
export function nmeaDegrees(v: string, hemi: string) {
  const x = parseFloat(v)
  const d = Math.floor(x / 100)
  const deg = d + (x - d * 100) / 60
  return hemi === 'S' || hemi === 'W' ? -deg : deg
}

export interface GpsFix {
  sec: number
  lat: number
  lon: number
  sats: number
  hdop: number
  alt: number
  fix: boolean
}

/** $GPGGA: time, position, fix quality, satellites, HDOP, altitude. No fix → empty position fields, quality 0. */
export function nmeaGga(g: GpsFix) {
  if (!g.fix) return wrap(`GPGGA,${hhmmss(g.sec)},,,,,0,${String(g.sats).padStart(2, '0')},99.99,,,,,,`)
  const [la, ns] = nmeaCoord(g.lat, false)
  const [lo, ew] = nmeaCoord(g.lon, true)
  return wrap(`GPGGA,${hhmmss(g.sec)},${la},${ns},${lo},${ew},1,${String(g.sats).padStart(2, '0')},${g.hdop.toFixed(2)},${g.alt.toFixed(1)},M,-25.4,M,,`)
}

/** $GPRMC: time, status A (valid) / V (void), position, speed (knots), date. */
export function nmeaRmc(g: GpsFix, date = '151026') {
  if (!g.fix) return wrap(`GPRMC,${hhmmss(g.sec)},V,,,,,,,${date},,,N`)
  const [la, ns] = nmeaCoord(g.lat, false)
  const [lo, ew] = nmeaCoord(g.lon, true)
  return wrap(`GPRMC,${hhmmss(g.sec)},A,${la},${ns},${lo},${ew},0.021,,${date},,,A`)
}

export interface GgaParsed {
  time: string
  lat: number | null
  lon: number | null
  quality: number
  sats: number
  alt: number | null
}

/** Parses one $GPGGA line; null if it isn't GGA or its checksum is wrong. */
export function parseGga(line: string): GgaParsed | null {
  const m = /^\$(GPGGA,[^*]*)\*([0-9A-F]{2})$/.exec(line.trim())
  if (!m || nmeaChecksum(m[1]) !== m[2]) return null
  const f = m[1].split(',')
  const has = f[2] !== '' && f[4] !== ''
  return {
    time: f[1] ? `${f[1].slice(0, 2)}:${f[1].slice(2, 4)}:${f[1].slice(4, 6)}` : '',
    lat: has ? nmeaDegrees(f[2], f[3]) : null,
    lon: has ? nmeaDegrees(f[4], f[5]) : null,
    quality: Number(f[6]) || 0,
    sats: Number(f[7]) || 0,
    alt: f[9] ? parseFloat(f[9]) : null,
  }
}
