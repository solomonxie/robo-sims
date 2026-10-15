import { i2cByteRate } from './i2c'
import { spiDecode, spiLines, spiSamplesRising, sampleLine } from './signals/buses'
import { MISO_DRIVE_OHMS, SD_SPI_MAX, frameRate, misoByte, misoLine, misoRead, sdBlockWrite, spiByteRate, spiShift, tftFrameBytes } from './spi'

describe('spiShift', () => {
  it('swaps the two bytes after 8 clocks', () => {
    expect(spiShift(0xa5, 0x3c, 0)).toEqual([0xa5, 0x3c])
    expect(spiShift(0xa5, 0x3c, 8)).toEqual([0x3c, 0xa5])
  })
  it('moves one bit each way per clock', () => {
    expect(spiShift(0x80, 0x00, 1)).toEqual([0x00, 0x01])
    expect(spiShift(0xa5, 0x3c, 4)).toEqual([0x53, 0xca])
  })
})

describe('sampling edge', () => {
  it('reads on rising for modes 0 and 3', () => {
    expect([0, 1, 2, 3].map((m) => spiSamplesRising(m as 0))).toEqual([true, false, false, true])
  })
  it('decodes in every mode when both ends agree', () => {
    for (const m of [0, 1, 2, 3] as const) {
      const l = spiLines([0xa5], [0x3c], m, 1e6)
      const fs = 20e6
      const count = Math.ceil(l.duration * fs) + 20
      const [cs, sck, mosi, miso] = [l.cs, l.sck, l.mosi, l.miso].map((f) => sampleLine(f, fs, count, -0.5e-6))
      expect(spiDecode(cs, sck, mosi, miso, m)).toMatchObject({ mosi: [0xa5], miso: [0x3c] })
    }
  })
})

describe('misoLine', () => {
  it('floats with nobody selected', () => {
    expect(misoLine([null, null])).toMatchObject({ state: 'z', amps: 0 })
  })
  it('follows the one driver', () => {
    expect(misoLine([null, 1, null])).toMatchObject({ state: 1, volts: 3.3, amps: 0 })
  })
  it('two agreeing drivers do not fight', () => {
    expect(misoLine([0, 0])).toMatchObject({ state: 0, amps: 0 })
  })
  it('a high and a low driver short through both outputs', () => {
    const l = misoLine([1, 0])
    expect(l.state).toBe('clash')
    expect(l.volts).toBeCloseTo(1.65)
    expect(l.amps).toBeCloseTo(3.3 / (2 * MISO_DRIVE_OHMS))
    expect(MISO_DRIVE_OHMS).toBeCloseTo(33)
  })
})

describe('misoRead', () => {
  it('reads the selected reply', () => {
    expect(misoByte(misoRead([0x01, 0x60], [false, true]).map((b) => b.state))).toBe(0x60)
  })
  it('clashes only where the replies differ', () => {
    const bits = misoRead([0x01, 0x60], [true, true]).map((b) => b.state)
    expect(bits).toEqual([0, 'clash', 'clash', 0, 0, 0, 0, 'clash'])
    expect(misoByte(bits)).toBeNull()
  })
})

describe('throughput', () => {
  it('SPI moves a byte per 8 clocks, I²C per 9', () => {
    expect(spiByteRate(40e6)).toBe(5e6)
    expect(i2cByteRate(400e3)).toBeCloseTo(44444.4, 0)
  })
  it('a 128×160 RGB565 frame', () => {
    expect(tftFrameBytes()).toBe(40971)
    expect(frameRate(spiByteRate(40e6), tftFrameBytes())).toBeCloseTo(122, 0)
    expect(frameRate(i2cByteRate(400e3), tftFrameBytes())).toBeCloseTo(1.08, 2)
  })
  it('an SD block write is mostly the card being busy', () => {
    const w = sdBlockWrite(20e6)
    expect(w.bytes).toBe(524)
    expect(w.bus).toBeCloseTo(209.6e-6)
    expect(w.rate).toBeCloseTo(512 / 1.2096e-3)
    expect(sdBlockWrite(80e6).clk).toBe(SD_SPI_MAX)
  })
})
