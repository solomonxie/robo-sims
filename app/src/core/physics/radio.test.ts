import {
  antennaPattern,
  chirpCycles,
  dbmToWatts,
  keyedAt,
  keyedFreq,
  loraAirtime,
  loraBitRate,
  loraSnrLimit,
  loraSymbolTime,
  noiseFloorDbm,
  pathLossDb,
  quarterWave,
  rangeFor,
  rssiDbm,
  sensitivityDbm,
  wattsToDbm,
  wavelength,
} from '.'

describe('radio', () => {
  it('wavelength and whip length', () => {
    expect(wavelength(2.44e9)).toBeCloseTo(0.1229, 4)
    expect(wavelength(433e6)).toBeCloseTo(0.692, 3)
    expect(quarterWave(2.44e9, 1)).toBeCloseTo(0.0307, 4)
    expect(quarterWave(433e6)).toBeCloseTo(0.164, 3)
  })

  it('dBm round-trips and 1 mW is 0 dBm', () => {
    expect(wattsToDbm(1e-3)).toBeCloseTo(0, 9)
    expect(wattsToDbm(0.1)).toBeCloseTo(20, 9)
    expect(dbmToWatts(wattsToDbm(0.025))).toBeCloseTo(0.025, 9)
  })

  it('path loss follows the inverse-square law', () => {
    expect(pathLossDb(1, 2.44e9)).toBeCloseTo(40.2, 1)
    expect(pathLossDb(20, 2.44e9) - pathLossDb(10, 2.44e9)).toBeCloseTo(6.02, 2)
    expect(pathLossDb(100, 868e6, 3) - pathLossDb(10, 868e6, 3)).toBeCloseTo(30, 9)
    expect(rssiDbm(20, 2, 10, 2.44e9, 10)).toBeCloseTo(20 + 2 - 60.2 - 10, 1)
    expect(rangeFor(pathLossDb(250, 868e6, 3), 868e6, 3)).toBeCloseTo(250, 6)
  })

  it('receiver sensitivity from noise floor', () => {
    expect(noiseFloorDbm(125e3)).toBeCloseTo(-123, 0)
    expect(sensitivityDbm(125e3, 6, loraSnrLimit(7))).toBeCloseTo(-124.5, 0)
    expect(loraSnrLimit(12)).toBe(-20)
  })

  it('LoRa timing matches the Semtech calculator', () => {
    expect(loraSymbolTime(7, 125e3)).toBeCloseTo(1.024e-3, 9)
    expect(loraBitRate(7, 125e3)).toBeCloseTo(5469, 0)
    expect(loraBitRate(12, 125e3)).toBeCloseTo(293, 0)
    expect(loraAirtime(20, 7, 125e3)).toBeCloseTo(0.05658, 4)
    expect(loraAirtime(20, 12, 125e3)).toBeCloseTo(1.3189, 3)
  })

  it('antenna patterns', () => {
    expect(antennaPattern('dipole', Math.PI / 2)).toBeCloseTo(1, 9)
    expect(antennaPattern('dipole', 0)).toBe(0)
    expect(antennaPattern('whip', Math.PI * 0.75)).toBe(0)
    expect(antennaPattern('chip', 0)).toBeGreaterThan(0.5)
  })

  it('keying is phase-continuous', () => {
    const bits = [1, 0, 1, 1]
    expect(keyedAt('ook', 0.3, bits, 4)).toBe(0)
    expect(keyedFreq('fsk', 0.1, bits, 4)).toBe(5)
    expect(keyedFreq('fsk', 0.3, bits, 4)).toBe(3)
    for (const kind of ['fsk', 'chirp'] as const) {
      const sy = kind === 'chirp' ? [0.2, 0.7, 0.4, 0.9] : bits
      for (const edge of [0.25, 0.5, 0.75]) expect(keyedAt(kind, edge - 1e-7, sy, 6)).toBeCloseTo(keyedAt(kind, edge + 1e-7, sy, 6), 3)
    }
    expect(chirpCycles(1, 0.3, 2, 8)).toBeCloseTo(2 + 4, 9)
    expect(keyedFreq('chirp', 0.01, [0.75], 8)).toBeCloseTo(8 * (0.5 + 0.76), 6)
  })
})
