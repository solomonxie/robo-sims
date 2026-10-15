// Logic-analyser maths: sampling digital lines, pattern triggers, I²C and SPI frames and their decoders.
import { Bit, bit } from '../../logic'

/** A digital line: level 0/1 at time t (s). */
export type Line = (t: number) => Bit

/** `count` samples of `line`, one every 1/fs s from `t0`. */
export const sampleLine = (line: Line, fs: number, count: number, t0 = 0): Bit[] =>
  Array.from({ length: count }, (_, i) => line(t0 + i / fs))

/** Chance that a pulse `width` s wide, landing at a random phase, holds at least one sample at fs. */
export const catchOdds = (width: number, fs: number) => Math.min(1, width * fs)

/** Bytes per second to stream `channels` lines at fs (one bit per channel per sample). */
export const streamRate = (fs: number, channels: number) => (fs * channels) / 8

/** Runs of 1s in `samples` as [start, end) index pairs. */
export function highRuns(samples: Bit[]): [number, number][] {
  const runs: [number, number][] = []
  samples.forEach((s, i) => {
    if (s && !samples[i - 1]) runs.push([i, i + 1])
    else if (s) runs[runs.length - 1][1] = i + 1
  })
  return runs
}

/** One word per sample from per-channel samples: channel k is bit k. */
export const packWords = (channels: Bit[][]) => channels[0].map((_, i) => channels.reduce((w, c, k) => w + c[i] * 2 ** k, 0))

/** True if `word` equals `pattern` on every bit set in `mask`; mask 0 bits are don't-care (X). */
export function patternMatch(word: number, pattern: number, mask: number) {
  const at = (v: number, k: number) => Math.floor(v / k) % 2
  for (let k = 1; k <= mask; k *= 2) if (at(mask, k) && at(word, k) !== at(pattern, k)) return false
  return true
}

/** First index ≥ `from` where the words start matching (the word before didn't), or null. */
export function findPattern(words: number[], pattern: number, mask: number, from = 1): number | null {
  for (let i = Math.max(1, from); i < words.length; i++) {
    if (patternMatch(words[i], pattern, mask) && !patternMatch(words[i - 1], pattern, mask)) return i
  }
  return null
}

export interface I2cWrite {
  addr: number
  data: number[]
  read?: boolean
  /** Whether a device answers the address. */
  ack: boolean
}

type I2cStep = { scl: Bit; sda: Bit }

function stepWriter() {
  const out: I2cStep[] = []
  const push = (scl: Bit, sda: Bit, n = 1) => {
    for (let i = 0; i < n; i++) out.push({ scl, sda })
  }
  const sendBit = (b: Bit) => {
    push(0, b)
    push(1, b, 2)
    push(0, b)
  }
  const sendByte = (byte: number) => {
    for (let k = 7; k >= 0; k--) sendBit(bit(Math.floor(byte / 2 ** k) % 2))
  }
  const start = () => {
    push(0, 1)
    push(1, 1, 2)
    push(1, 0, 2)
  }
  const stop = () => {
    push(0, 0)
    push(1, 0, 2)
    push(1, 1, 2)
  }
  return { out, push, sendBit, sendByte, start, stop }
}

/** SCL/SDA at quarter-clock steps: idle, START (SDA falls, SCL high), address + R/W, ACK slot, each data byte + ACK,
 *  STOP (SDA rises, SCL high). With no ACK the master stops after the address. Bits MSB first, SDA changes only while SCL is low. */
export function i2cSteps({ addr, data, read = false, ack }: I2cWrite) {
  const w = stepWriter()
  w.push(1, 1, 2)
  w.push(1, 0, 2)
  w.sendByte(addr * 2 + (read ? 1 : 0))
  w.sendBit(ack ? 0 : 1)
  if (ack) {
    for (const d of data) {
      w.sendByte(d)
      w.sendBit(0)
    }
  }
  w.stop()
  return w.out
}

/** Register read: START, address + W, register pointer, repeated START, address + R, then the device sends `data` while the
 *  master ACKs every byte but the last (NACK), STOP. */
export function i2cRegisterSteps(addr: number, reg: number, data: number[]) {
  const w = stepWriter()
  w.push(1, 1, 2)
  w.push(1, 0, 2)
  w.sendByte(addr * 2)
  w.sendBit(0)
  w.sendByte(reg)
  w.sendBit(0)
  w.start()
  w.sendByte(addr * 2 + 1)
  w.sendBit(0)
  data.forEach((d, i) => {
    w.sendByte(d)
    w.sendBit(i === data.length - 1 ? 1 : 0)
  })
  w.stop()
  return w.out
}

/** Quarter-clock steps as lines at `hz` SCL, from t = 0; idle high outside. */
export function stepLines(steps: I2cStep[], hz: number) {
  const q = 1 / (4 * hz)
  const at = (t: number) => steps[Math.floor(t / q)] ?? { scl: 1 as Bit, sda: 1 as Bit }
  return { scl: (t: number) => at(t).scl, sda: (t: number) => at(t).sda, duration: steps.length * q }
}

/** The frame as lines at `hz` SCL, from t = 0; idle high outside. */
export const i2cLines = (frame: I2cWrite, hz: number) => stepLines(i2cSteps(frame), hz)

export type I2cEvent = {
  kind: 'start' | 'stop' | 'addr' | 'data' | 'ack' | 'nack'
  value: number
  read?: boolean
  /** Sample indices of the first and last SCL rise in it (START/STOP: where SDA moved). */
  from: number
  to: number
}

/** Decodes sampled SCL/SDA: SDA moving while SCL stays high is START (falls) or STOP (rises); otherwise SDA is read on each SCL rise,
 *  8 bits make a byte (the first after START is address + R/W) and the 9th is ACK (0) or NACK (1). */
export function i2cDecode(scl: Bit[], sda: Bit[]): I2cEvent[] {
  const ev: I2cEvent[] = []
  let bits: number[] = []
  let rises: number[] = []
  let first = true
  for (let i = 1; i < scl.length; i++) {
    if (scl[i - 1] && scl[i] && sda[i] !== sda[i - 1]) {
      ev.push({ kind: sda[i] ? 'stop' : 'start', value: 0, from: i, to: i })
      bits = []
      rises = []
      first = true
      continue
    }
    if (scl[i - 1] || !scl[i]) continue
    bits.push(sda[i])
    rises.push(i)
    if (bits.length === 8) {
      const byte = bits.reduce((s, b) => s * 2 + b, 0)
      ev.push(
        first
          ? { kind: 'addr', value: Math.floor(byte / 2), read: byte % 2 === 1, from: rises[0], to: i }
          : { kind: 'data', value: byte, from: rises[0], to: i },
      )
    } else if (bits.length === 9) {
      ev.push({ kind: sda[i] ? 'nack' : 'ack', value: sda[i], from: i, to: i })
      bits = []
      rises = []
      first = false
    }
  }
  return ev
}

export type SpiMode = 0 | 1 | 2 | 3
/** CPOL: the clock's idle level. */
export const spiPol = (mode: SpiMode): Bit => bit(mode >= 2)
/** CPHA: 0 reads on the leading clock edge, 1 on the trailing one. */
export const spiPha = (mode: SpiMode): Bit => bit(mode % 2)

/** CS low around `mosi.length` bytes clocked at `hz`, MSB first, half a clock of setup and hold; MISO idles high, MOSI low. */
export function spiLines(mosi: number[], miso: number[], mode: SpiMode, hz: number) {
  const T = 1 / hz
  const lead = T / 2
  const nbits = mosi.length * 8
  const duration = 2 * lead + nbits * T
  const pol = spiPol(mode)
  const cellOf = (t: number) => (t - lead) / T
  const active = (t: number) => t >= 0 && t < duration
  const inBits = (t: number) => active(t) && cellOf(t) >= 0 && cellOf(t) < nbits
  const data =
    (bytes: number[], idle: Bit): Line =>
    (t) => {
      if (!inBits(t)) return idle
      const k = Math.floor(cellOf(t))
      return bit(Math.floor(bytes[Math.floor(k / 8)] / 2 ** (7 - (k % 8))) % 2)
    }
  return {
    cs: ((t) => bit(!active(t))) as Line,
    sck: ((t) => {
      if (!inBits(t)) return pol
      const firstHalf = cellOf(t) % 1 < 0.5
      return (spiPha(mode) ? firstHalf : !firstHalf) ? bit(!pol) : pol
    }) as Line,
    mosi: data(mosi, 0),
    miso: data(miso, 1),
    duration,
  }
}

/** Decoder set to `mode`: while CS is low, reads MOSI and MISO on each sampling edge (rising when CPOL = CPHA, else falling), MSB first.
 *  `at` holds the sample index of every read. */
export function spiDecode(cs: Bit[], sck: Bit[], mosi: Bit[], miso: Bit[], mode: SpiMode) {
  const rising = spiPol(mode) === spiPha(mode)
  const out = { mosi: [] as number[], miso: [] as number[], at: [] as number[] }
  let a = 0
  let b = 0
  let k = 0
  for (let i = 1; i < cs.length; i++) {
    if (cs[i]) {
      a = b = k = 0
      continue
    }
    if (sck[i] === sck[i - 1] || sck[i] !== bit(rising)) continue
    out.at.push(i)
    a = a * 2 + mosi[i]
    b = b * 2 + miso[i]
    if (++k === 8) {
      out.mosi.push(a)
      out.miso.push(b)
      a = b = k = 0
    }
  }
  return out
}
