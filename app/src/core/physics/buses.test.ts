import { Bit } from '../logic'
import {
  catchOdds,
  findPattern,
  highRuns,
  i2cDecode,
  i2cLines,
  i2cSteps,
  packWords,
  patternMatch,
  sampleLine,
  spiDecode,
  spiLines,
  SpiMode,
  streamRate,
} from './buses'

const sampleAll = (lines: ((t: number) => Bit)[], fs: number, duration: number) =>
  lines.map((l) => sampleLine(l, fs, Math.ceil(duration * fs) + 4, -1 / fs))

describe('sampling', () => {
  it('samples a line every 1/fs', () => {
    expect(sampleLine((t) => (t >= 2e-6 ? 1 : 0), 1e6, 4)).toEqual([0, 0, 1, 1])
    expect(sampleLine(() => 1, 1e6, 2, 5)).toEqual([1, 1])
  })

  it('catches a glitch only if a sample lands in it', () => {
    expect(catchOdds(0.4e-6, 1e6)).toBeCloseTo(0.4)
    expect(catchOdds(0.4e-6, 24e6)).toBe(1)
    const glitch = (t: number): Bit => (t >= 2.1e-6 && t < 2.5e-6 ? 1 : 0)
    expect(highRuns(sampleLine(glitch, 1e6, 10))).toEqual([])
    expect(highRuns(sampleLine(glitch, 24e6, 240))).toHaveLength(1)
  })

  it('finds runs of ones', () => {
    expect(highRuns([0, 1, 1, 0, 1])).toEqual([[1, 3], [4, 5]])
    expect(highRuns([1, 0])).toEqual([[0, 1]])
  })

  it('needs 24 MB/s to stream 8 channels at 24 MHz', () => {
    expect(streamRate(24e6, 8)).toBe(24e6)
  })
})

describe('pattern trigger', () => {
  it('packs channels into words, channel k = bit k', () => {
    expect(packWords([[1, 0], [1, 1], [0, 1]])).toEqual([3, 6])
  })

  it('matches with don’t-care bits', () => {
    expect(patternMatch(0b1011, 0b1011, 0b1111)).toBe(true)
    expect(patternMatch(0b0011, 0b1011, 0b1111)).toBe(false)
    expect(patternMatch(0b0011, 0b1011, 0b0111)).toBe(true)
  })

  it('fires where the pattern starts, not while it holds', () => {
    const words = [0, 11, 11, 3, 11]
    expect(findPattern(words, 11, 15)).toBe(1)
    expect(findPattern(words, 11, 15, 2)).toBe(4)
    expect(findPattern(words, 11, 7, 2)).toBeNull()
    expect(findPattern(words, 5, 15)).toBeNull()
  })
})

describe('I²C', () => {
  const frame = { addr: 0x3c, data: [0x81, 0x7f], ack: true }

  it('frames START, 9-bit slots and STOP at quarter-clock steps', () => {
    const steps = i2cSteps(frame)
    expect(steps).toHaveLength(4 + 3 * 9 * 4 + 5)
    expect(steps.slice(0, 4).map((s) => s.sda)).toEqual([1, 1, 0, 0])
    expect(steps.at(-1)).toEqual({ scl: 1, sda: 1 })
    expect(i2cSteps({ ...frame, ack: false })).toHaveLength(4 + 9 * 4 + 5)
  })

  it('decodes its own frame when oversampled', () => {
    const l = i2cLines(frame, 100e3)
    const [scl, sda] = sampleAll([l.scl, l.sda], 2e6, l.duration)
    expect(i2cDecode(scl, sda).map((e) => [e.kind, e.value])).toEqual([
      ['start', 0],
      ['addr', 0x3c],
      ['ack', 0],
      ['data', 0x81],
      ['ack', 0],
      ['data', 0x7f],
      ['ack', 0],
      ['stop', 0],
    ])
  })

  it('reads R/W and a missing device as NACK then STOP', () => {
    const l = i2cLines({ addr: 0x68, data: [1], read: true, ack: false }, 400e3)
    const [scl, sda] = sampleAll([l.scl, l.sda], 8e6, l.duration)
    const ev = i2cDecode(scl, sda)
    expect(ev.map((e) => e.kind)).toEqual(['start', 'addr', 'nack', 'stop'])
    expect(ev[1]).toMatchObject({ value: 0x68, read: true })
    expect(ev[1].to).toBeGreaterThan(ev[1].from)
  })
})

describe('SPI', () => {
  const decode = (dev: SpiMode, dec: SpiMode) => {
    const l = spiLines([0xd0, 0x00], [0xff, 0x60], dev, 1e6)
    const [cs, sck, mosi, miso] = sampleAll([l.cs, l.sck, l.mosi, l.miso], 24e6, l.duration)
    return spiDecode(cs, sck, mosi, miso, dec)
  }

  it('round-trips in every mode', () => {
    for (const m of [0, 1, 2, 3] as SpiMode[]) {
      expect(decode(m, m)).toMatchObject({ mosi: [0xd0, 0x00], miso: [0xff, 0x60] })
      expect(decode(m, m).at).toHaveLength(16)
    }
  })

  it('idles the clock at CPOL with CS high outside the transfer', () => {
    const l = spiLines([0xaa], [0x55], 2, 1e6)
    expect([l.cs(-1e-6), l.sck(-1e-6), l.sck(l.duration + 1e-6)]).toEqual([1, 1, 1])
    expect(l.cs(1e-6)).toBe(0)
  })

  it('reads on the wrong edge when the decoder mode is wrong', () => {
    expect(decode(0, 3).mosi).toEqual([0xd0, 0x00])
    expect(decode(0, 1).mosi).toEqual([0xa0, 0x00])
    expect(decode(0, 1).miso).toEqual([0xfe, 0xc1])
  })
})
