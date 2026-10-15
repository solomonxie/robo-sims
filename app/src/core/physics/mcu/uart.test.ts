import {
  FORMAT_8N1,
  baudTolerance,
  frameLength,
  lineGain,
  nmeaChecksum,
  nmeaCoord,
  nmeaDegrees,
  nmeaGga,
  nmeaRmc,
  parityBit,
  parseGga,
  sampleDrift,
  serialLink,
  txBitAt,
  uartBits,
  uartReceive,
  uartStream,
} from './uart'

const fix = { sec: 12 * 3600 + 35 * 60 + 19, lat: 37.8199, lon: -122.4783, sats: 8, hdop: 0.9, alt: 67.3, fix: true }
const text = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('uart framing', () => {
  it('builds start, LSB-first data, parity and stop bits', () => {
    expect(uartBits(0x41).map((b) => b.bit)).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1])
    const e = uartBits(0x41, { parity: 'even', stop: 2 })
    expect(e.map((b) => b.role)).toEqual(['start', ...Array(8).fill('data'), 'parity', 'stop', 'stop'])
    expect(e[9].bit).toBe(0)
    expect(parityBit(0x41, 'odd')).toBe(1)
    expect(parityBit(0x07, 'even')).toBe(1)
    expect(frameLength(FORMAT_8N1)).toBe(10)
    expect(frameLength({ parity: 'odd', stop: 2 })).toBe(12)
  })

  it('round-trips a message at matched baud', () => {
    const f = { parity: 'even', stop: 1 } as const
    const s = uartStream(text('Hi!'), 9600, f, 2)
    const rx = uartReceive(s.level, 9600, f, s.duration)
    expect(rx.map((r) => r.byte)).toEqual(text('Hi!'))
    expect(rx.every((r) => r.parityOk && r.framingOk)).toBe(true)
    expect(rx[1].start).toBeCloseTo(s.starts[1], 4)
  })

  it('survives small clock error, garbles past the tolerance', () => {
    const s = uartStream(text('Hi!'), 9600, FORMAT_8N1, 2)
    expect(uartReceive(s.level, 9600 * 1.03, FORMAT_8N1, s.duration).map((r) => r.byte)).toEqual(text('Hi!'))
    const bad = uartReceive(s.level, 9600 * 1.1, FORMAT_8N1, s.duration)
    expect(bad.some((r, i) => r.byte !== text('Hi!')[i] || !r.framingOk)).toBe(true)
    const half = uartReceive(s.level, 19200, FORMAT_8N1, s.duration)
    expect(half.some((r) => !r.framingOk)).toBe(true)
    expect(baudTolerance(FORMAT_8N1)).toBeCloseTo(0.0526, 3)
    expect(sampleDrift(9600, 9600, 9)).toBe(0)
    expect(sampleDrift(9600, 9600 / 1.05, 9)).toBeCloseTo(0.475)
  })

  it('locates the TX bit on the line', () => {
    const s = uartStream(text('AB'), 1000, FORMAT_8N1, 2)
    expect(txBitAt(s.starts, 1000, -0.001).frame).toBe(-1)
    expect(txBitAt(s.starts, 1000, 0.0035)).toEqual({ frame: 0, bit: 3 })
    expect(txBitAt(s.starts, 1000, 0.0125)).toEqual({ frame: 1, bit: 0 })
  })
})

describe('serial line standards', () => {
  const bits = text('UART!?').flatMap((c) => uartBits(c).map((b) => b.bit))
  it('passes clean short links', () => {
    for (const std of ['ttl', 'rs232', 'rs485'] as const) expect(serialLink(std, 1, 0, bits, 115200).errors).toBe(0)
  })

  it('lets differential RS-485 shrug off noise that breaks TTL', () => {
    expect(serialLink('ttl', 30, 4, bits, 115200).errors).toBeGreaterThan(0)
    expect(serialLink('rs485', 30, 4, bits, 115200).errors).toBe(0)
    expect(serialLink('rs485', 1200, 8, bits, 115200).errors).toBe(0)
  })

  it('slows RS-232 edges on a long cable and loses copper on RS-485', () => {
    expect(serialLink('rs232', 1200, 0, bits, 115200).errors).toBeGreaterThan(0)
    expect(serialLink('rs232', 1200, 0, bits, 115200).margin).toBeLessThan(0)
    expect(serialLink('rs232', 1, 0, bits, 115200).margin).toBeGreaterThan(5)
    expect(lineGain('rs485', 0)).toBe(1)
    expect(lineGain('rs485', 1200)).toBeLessThan(0.3)
    expect(lineGain('ttl', 1200)).toBe(1)
  })
})

describe('NMEA', () => {
  it('checksums the classic GGA example', () => {
    expect(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')).toBe('47')
  })

  it('formats and parses coordinates', () => {
    expect(nmeaCoord(37.8199, false)).toEqual(['3749.19400', 'N'])
    expect(nmeaCoord(-122.4783, true)).toEqual(['12228.69800', 'W'])
    expect(nmeaDegrees('12228.69800', 'W')).toBeCloseTo(-122.4783, 6)
  })

  it('round-trips a GGA with and without fix', () => {
    const line = nmeaGga(fix)
    expect(line.startsWith('$GPGGA,123519.00,3749.19400,N,12228.69800,W,1,08,0.90,67.3,M')).toBe(true)
    const p = parseGga(line)!
    expect(p.time).toBe('12:35:19')
    expect(p.lat).toBeCloseTo(37.8199, 5)
    expect(p.lon).toBeCloseTo(-122.4783, 5)
    expect([p.quality, p.sats, p.alt]).toEqual([1, 8, 67.3])
    const none = parseGga(nmeaGga({ ...fix, fix: false, sats: 2 }))!
    expect([none.lat, none.quality, none.sats]).toEqual([null, 0, 2])
  })

  it('rejects corrupted or non-GGA lines', () => {
    const line = nmeaGga(fix)
    expect(parseGga(line.replace('3749', '3748'))).toBeNull()
    expect(parseGga(nmeaRmc(fix))).toBeNull()
    expect(nmeaRmc({ ...fix, fix: false })).toMatch(/^\$GPRMC,123519\.00,V,/)
  })
})
