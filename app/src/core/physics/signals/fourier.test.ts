import { aliasFrequency, dftAmplitudes, fourierTerms, harmonicAmp, nyquist, periodicAt, seriesAt, seriesPeak, seriesRmsError } from '..'

describe('fourier', () => {
  it('a square wave is odd harmonics at 4/πk; a triangle falls as 1/k²', () => {
    expect(harmonicAmp('square', 1)).toBeCloseTo(4 / Math.PI, 9)
    expect(harmonicAmp('square', 2)).toBe(0)
    expect(harmonicAmp('square', 3)).toBeCloseTo(4 / (3 * Math.PI), 9)
    expect(harmonicAmp('triangle', 3)).toBeCloseTo(-8 / (9 * Math.PI ** 2), 9)
    expect(harmonicAmp('saw', 2)).toBeCloseTo(-1 / Math.PI, 9)
    expect(fourierTerms('square', 9).map((h) => h.k)).toEqual([1, 3, 5, 7, 9])
    expect(fourierTerms('saw', 4)).toHaveLength(4)
  })

  it('partial sums converge on the ideal wave', () => {
    for (const shape of ['square', 'saw', 'triangle'] as const) {
      const few = seriesRmsError(shape, fourierTerms(shape, 3))
      const many = seriesRmsError(shape, fourierTerms(shape, 60))
      expect(many).toBeLessThan(few / 2)
    }
    expect(seriesAt(fourierTerms('triangle', 41), 0.25)).toBeCloseTo(periodicAt('triangle', 0.25), 1)
    expect(seriesAt(fourierTerms('square', 201), 0.25)).toBeCloseTo(1, 2)
  })

  it('Gibbs: a square keeps overshooting by ~9 % of the jump however many terms', () => {
    for (const k of [25, 101]) expect((seriesPeak(fourierTerms('square', k)) - 1) / 2).toBeCloseTo(0.0895, 2)
    expect(seriesPeak(fourierTerms('triangle', 25))).toBeLessThan(1.001)
  })

  it('the DFT reads a sine on bin m at its amplitude', () => {
    const N = 64
    const x = Array.from({ length: N }, (_, i) => 0.5 + 2 * Math.sin((2 * Math.PI * 5 * i) / N) + 0.3 * Math.cos((2 * Math.PI * 12 * i) / N))
    const a = dftAmplitudes(x)
    expect(a).toHaveLength(33)
    expect(a[0]).toBeCloseTo(0.5, 9)
    expect(a[5]).toBeCloseTo(2, 9)
    expect(a[12]).toBeCloseTo(0.3, 9)
    expect(a[7]).toBeCloseTo(0, 9)
    expect(dftAmplitudes(x, true)[5]).toBeCloseTo(2, 9)
  })

  it('tones above fs/2 fold back; just under fs runs backwards', () => {
    expect(nyquist(1000)).toBe(500)
    expect(aliasFrequency(100, 1000)).toBe(100)
    expect(aliasFrequency(600, 1000)).toBe(-400)
    expect(aliasFrequency(600, 620)).toBe(-20)
    expect(aliasFrequency(1050, 1000)).toBe(50)
    expect(aliasFrequency(2000, 1000)).toBe(0)
  })
})
