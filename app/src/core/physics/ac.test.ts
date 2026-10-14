import {
  acVolts,
  angularFrequency,
  lampOhms,
  MAINS,
  peakFromRms,
  peakToPeak,
  periodOf,
  RMS_FACTOR,
  rmsFromPeak,
  rmsOf,
  sloshAmplitude,
  waveAt,
} from '.'

describe('ac', () => {
  const sample = (f: (c: number) => number, n = 4000) => Array.from({ length: n }, (_, k) => f((k + 0.5) / n))

  it('waves peak at ±1 a quarter cycle in and cross 0 at whole cycles', () => {
    for (const w of ['sine', 'square', 'triangle'] as const) {
      expect(waveAt(w, 0.25)).toBeCloseTo(1, 12)
      expect(waveAt(w, 2.75)).toBeCloseTo(-1, 12)
      expect(waveAt(w, -0.75)).toBeCloseTo(1, 12)
    }
    expect(waveAt('sine', 3)).toBeCloseTo(0, 12)
    expect(waveAt('triangle', 1)).toBeCloseTo(0, 12)
  })

  it('RMS factors match the sampled waves, and the average is 0', () => {
    for (const w of ['sine', 'square', 'triangle'] as const) {
      const s = sample((c) => waveAt(w, c))
      expect(rmsOf(s)).toBeCloseTo(RMS_FACTOR[w], 6)
      expect(s.reduce((a, b) => a + b, 0) / s.length).toBeCloseTo(0, 9)
    }
    expect(rmsFromPeak(12)).toBeCloseTo(8.485, 3)
    expect(peakFromRms(230)).toBeCloseTo(325.3, 1)
    expect(peakFromRms(12, 'square')).toBe(12)
    expect(peakToPeak(325)).toBe(650)
  })

  it('average AC power equals DC power at the RMS voltage', () => {
    const r = 12
    for (const w of ['sine', 'square', 'triangle'] as const) {
      const p = sample((c) => acVolts(10, 1, c, w) ** 2 / r)
      expect(p.reduce((a, b) => a + b, 0) / p.length).toBeCloseTo(rmsFromPeak(10, w) ** 2 / r, 4)
    }
  })

  it('period and angular frequency', () => {
    expect(periodOf(MAINS.eu.hz)).toBeCloseTo(0.02, 12)
    expect(periodOf(MAINS.us.hz) * 1000).toBeCloseTo(16.67, 2)
    expect(angularFrequency(50)).toBeCloseTo(314.16, 2)
    expect(acVolts(325, 50, 0.005)).toBeCloseTo(325, 9)
  })

  it('a 60 W mains lamp: R = V² / P, electrons slosh only tens of nanometres', () => {
    expect(lampOhms(230, 60)).toBeCloseTo(881.7, 1)
    const peak = Math.SQRT2 * (230 / lampOhms(230, 60))
    const x = sloshAmplitude(peak, 1.5e-6, 50)
    expect(x).toBeGreaterThan(30e-9)
    expect(x).toBeLessThan(100e-9)
  })
})
