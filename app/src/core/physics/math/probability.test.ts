import { medianMs } from '../../stopwatch'
import { mean, stdDev } from '../common'
import { averageView, bayesRun, bayesStep, binCounts, detectorReadings, fuseTwo, gaussianView, noisyReadings, varianceView, withinSigma } from './probability'

describe('gaussian noise', () => {
  it('68 / 95 / 99.7 rule', () => {
    expect(withinSigma(1)).toBeCloseTo(0.6827, 3)
    expect(withinSigma(2)).toBeCloseTo(0.9545, 3)
    expect(withinSigma(3)).toBeCloseTo(0.9973, 3)
  })
  it('bins count values in range only', () => {
    expect(binCounts([0, 0.4, 0.5, 0.99, 1, -0.1], 0, 1, 2)).toEqual([2, 2])
  })
  it('readings have the asked mean and σ whatever the number of sources', () => {
    for (const k of [1, 2, 12]) {
      const xs = noisyReadings(50, 2, k, 4000)
      expect(mean(xs)).toBeCloseTo(50, 0)
      expect(stdDev(xs) / 2).toBeCloseTo(1, 1)
    }
  })
  it('one uniform source is flat and bounded; many sources fill the 68/95 bands like a normal', () => {
    const one = noisyReadings(0, 1, 1, 4000)
    expect(Math.max(...one.map(Math.abs))).toBeLessThanOrEqual(Math.sqrt(3) + 1e-9)
    const flat = gaussianView(0, 1, 1, 4000, 4000)
    expect(flat.within[0]).toBeCloseTo(1 / Math.sqrt(3), 1)
    const bell = gaussianView(0, 1, 12, 4000, 4000)
    expect(bell.within[0]).toBeCloseTo(0.683, 1)
    expect(bell.within[1]).toBeCloseTo(0.954, 1)
    const err = (v: ReturnType<typeof gaussianView>) => v.counts.reduce((s, c, i) => s + Math.abs(c - v.expected[i]), 0)
    expect(err(bell)).toBeLessThan(err(flat) / 2)
  })
  it('more readings → the sample σ settles on the true σ', () => {
    const few = gaussianView(30, 1.5, 12, 2000, 10)
    const many = gaussianView(30, 1.5, 12, 2000, 2000)
    expect(few.xs).toHaveLength(10)
    expect(Math.abs(many.sd - 1.5)).toBeLessThan(0.1)
    expect(many.counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(1990)
  })
})

describe('bayes rule', () => {
  it('posterior = prior × likelihood / evidence', () => {
    const s = bayesStep(0.1, 0.9, 0.2, true)
    expect(s.evidence).toBeCloseTo(0.09 + 0.18, 12)
    expect(s.posterior).toBeCloseTo(1 / 3, 12)
    expect(bayesStep(0.5, 0.9, 0.2, false).posterior).toBeCloseTo(0.05 / 0.45, 12)
  })
  it('a rare door stays unlikely after one beep when false alarms are common (base rate)', () => {
    expect(bayesStep(0.01, 0.9, 0.1, true).posterior).toBeLessThan(0.1)
    expect(bayesStep(0.01, 0.9, 0.001, true).posterior).toBeGreaterThan(0.8)
  })
  it('each beep adds log(hit/falseAlarm) to the log-odds', () => {
    const r = bayesRun(0.2, 0.8, 0.2, true, 8)
    r.reads.forEach((beep, i) => expect(r.logOdds[i + 1] - r.logOdds[i]).toBeCloseTo(beep ? Math.log(4) : Math.log(0.2 / 0.8), 9))
  })
  it('repeated readings converge on the truth', () => {
    expect(bayesRun(0.2, 0.8, 0.2, true, 20).beliefs[20]).toBeGreaterThan(0.95)
    expect(bayesRun(0.8, 0.8, 0.2, false, 20).beliefs[20]).toBeLessThan(0.05)
    expect(detectorReadings(true, 0.8, 0.2, 5)).toEqual(detectorReadings(true, 0.8, 0.2, 5))
  })
})

describe('variance', () => {
  it('averaging n readings shrinks σ by √n', () => {
    for (const n of [1, 4, 16, 64]) {
      const v = averageView(100, 3, n)
      expect(v.sd / v.predicted).toBeCloseTo(1, 0)
      expect(Math.abs(v.sd / v.predicted - 1)).toBeLessThan(0.12)
    }
  })
  it('inverse-variance fusion: weights ∝ 1/σ², fused σ below both', () => {
    const f = fuseTwo(10, 1, 20, 2)
    expect(f.wA).toBeCloseTo(0.8, 12)
    expect(f.x).toBeCloseTo(12, 12)
    expect(f.sigma).toBeCloseTo(Math.sqrt(0.8), 12)
    expect(fuseTwo(0, 3, 6, 3).x).toBeCloseTo(3, 12)
    const one = varianceView(50, 2, 0.5, 1)
    expect(one.fused.sigma).toBeLessThan(0.5)
    expect(one.fused.wB).toBeGreaterThan(0.9)
    const many = varianceView(50, 2, 0.5, 64)
    expect(many.sigmaAvg).toBeCloseTo(0.25, 12)
    expect(many.avgA).toBeCloseTo(mean(many.readsA), 12)
    expect(many.fused.wA).toBeCloseTo(0.8, 12)
  })
  it('recomputes fast for every slider move', () => {
    const ms = medianMs((i) => {
      gaussianView(40, 1 + i / 10, 12, 2000, 2000)
      averageView(40, 2, 64)
      bayesRun(0.2, 0.8, 0.1 + i / 100, true, 20)
    }, 7)
    expect(ms).toBeLessThan(200)
  })
})
