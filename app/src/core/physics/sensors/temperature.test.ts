import {
  NTC,
  OW,
  betaBetween,
  betaC,
  crc8,
  degPerCount,
  ds18C,
  ds18ConvMs,
  ds18Raw,
  ntcOhms,
  ntcRaw,
  ntcReading,
  ntcTrueC,
  owBytes,
  owPulling,
  owReadAllUs,
  owReset,
  rawOhms,
  rawTable,
  romId,
  selfHeatedC,
  shC,
  shFit,
  tableC,
  thermalTau,
} from './temperature'

describe('NTC thermistor', () => {
  it('10 kΩ at 25 °C, falling steeply as it warms; inversion round-trips', () => {
    expect(ntcOhms(25)).toBeCloseTo(NTC.r25, 6)
    expect(ntcOhms(-20) / ntcOhms(120)).toBeGreaterThan(200)
    for (const t of [-20, 25, 77, 120]) expect(ntcTrueC(ntcOhms(t))).toBeCloseTo(t, 6)
  })

  it('B25/85 is the datasheet 3950; Beta is exact at 25 and 85 °C but drifts > 1 °C at the ends', () => {
    const b = betaBetween(25, 85)
    expect(b).toBeCloseTo(3950, 6)
    expect(betaC(ntcOhms(85), b)).toBeCloseTo(85, 6)
    expect(Math.abs(betaC(ntcOhms(-20), b) + 20)).toBeGreaterThan(1)
    expect(Math.abs(betaC(ntcOhms(120), b) - 120)).toBeGreaterThan(1)
  })

  it('Steinhart–Hart passes through its three points and stays within 0.5 °C over −20…120', () => {
    const k = shFit(0, 25, 85)
    for (const t of [0, 25, 85]) expect(shC(ntcOhms(t), k)).toBeCloseTo(t, 6)
    for (let t = -20; t <= 120; t += 5) expect(Math.abs(shC(ntcOhms(t), k) - t)).toBeLessThan(0.55)
  })

  it('divider counts invert back to ohms; a 10 °C table is exact at its rows', () => {
    expect(ntcRaw(10e3, 10e3)).toBe(2048)
    expect(rawOhms(2048, 10e3) / 10e3).toBeCloseTo(1, 3)
    const rows = rawTable(10e3, -40, 150, 10)
    expect(rows).toHaveLength(20)
    expect(rows[0][1]).toBeGreaterThan(rows[19][1])
    expect(tableC(rows[7][1], rows)).toBe(rows[7][0])
    expect(tableC(4095, rows)).toBe(-40)
    expect(tableC(0, rows)).toBe(150)
    const mid = tableC(ntcRaw(ntcOhms(45), 10e3), rows)
    expect(mid).toBeGreaterThan(45)
    expect(mid).toBeLessThan(45.5)
  })

  it('the fixed resistor trades resolution and self-heating', () => {
    expect(degPerCount(25, 10e3)).toBeLessThan(0.03)
    expect(degPerCount(120, 100e3)).toBeGreaterThan(0.5)
    const hot1k = selfHeatedC(25, 1e3, 0.0015) - 25
    const hot10k = selfHeatedC(25, 10e3, 0.0015) - 25
    expect(hot1k).toBeGreaterThan(0.5)
    expect(hot10k).toBeCloseTo((3.3 / 20e3) ** 2 * 10e3 / 0.0015, 1)
    expect(selfHeatedC(25, 1e3, 0.015) - 25).toBeLessThan(hot1k / 5)
    const r = ntcReading(25, 1e3, 'sh', 0.0015)
    expect(r.selfHeat).toBeCloseTo(hot1k, 9)
    expect(r.error).toBeGreaterThan(0.4)
  })

  it('a bead settles in seconds, a steel probe in minutes in still air', () => {
    expect(thermalTau('bead', 'still')).toBeCloseTo(10, 6)
    expect(thermalTau('bead', 'water')).toBeCloseTo(1, 6)
    expect(thermalTau('probe', 'still')).toBeCloseTo(100, 6)
    expect(thermalTau('probe', 'water')).toBeLessThan(10)
  })
})

describe('DS18B20 on 1-Wire', () => {
  it('reset: host low 480 µs, then the sensor answers with a presence pulse', () => {
    const f = owReset()
    expect(owPulling(f, 100, 'host')).toBe(true)
    expect(owPulling(f, OW.reset + 10)).toBe(false)
    expect(owPulling(f, OW.reset + OW.wait + 50, 'sensor')).toBe(true)
    expect(owPulling(f, OW.reset + OW.wait + 50, 'host')).toBe(false)
  })

  it('writes LSB first: short low = 1, long low = 0; reads: a 0 holds the line past the sample point', () => {
    const w = owBytes([0x44])
    expect(w.bits.map((b) => b.bit)).toEqual([0, 0, 1, 0, 0, 0, 1, 0])
    expect(owPulling(w, 2 * 65 + 20)).toBe(false)
    expect(owPulling(w, 0 + 20)).toBe(true)
    const r = owBytes([0x01], true)
    expect(owPulling(r, OW.sample)).toBe(false)
    expect(owPulling(r, 65 + OW.sample, 'sensor')).toBe(true)
    expect(r.len).toBe(8 * 65)
  })

  it('CRC-8: the Maxim check value, and a ROM whose CRC zeroes the whole 64 bits', () => {
    expect(crc8([...'123456789'].map((c) => c.charCodeAt(0)))).toBe(0xa1)
    const rom = romId([0xa2, 0x17, 0x5c, 0x0b, 0x00, 0x00])
    expect(rom[0]).toBe(0x28)
    expect(rom).toHaveLength(8)
    expect(crc8(rom)).toBe(0)
  })

  it('temperature register matches the datasheet table', () => {
    const table: [number, number][] = [
      [125, 0x07d0],
      [85, 0x0550],
      [25.0625, 0x0191],
      [0.5, 0x0008],
      [0, 0],
      [-0.5, 0xfff8],
      [-10.125, 0xff5e],
      [-55, 0xfc90],
    ]
    for (const [t, raw] of table) {
      expect(ds18Raw(t)).toBe(raw)
      expect(ds18C(raw)).toBe(t)
    }
    expect(ds18C(ds18Raw(25.0625, 9))).toBe(25)
  })

  it('750 ms at 12 bits halves per bit; reading 3 sensors takes ~22 ms of bus time', () => {
    expect([9, 10, 11, 12].map(ds18ConvMs)).toEqual([93.75, 187.5, 375, 750])
    expect(owReadAllUs(3) / 1000).toBeCloseTo(22.04, 2)
    expect(owReadAllUs(2) - owReadAllUs(1)).toBe(OW.frame + 88 * 65)
  })
})
