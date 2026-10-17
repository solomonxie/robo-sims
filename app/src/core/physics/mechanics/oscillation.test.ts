import { G } from '../common'
import { secondOrderAt } from '../control/stability'
import { ampRatio, dampRegime, dampingRatio, decayEnvelope, drivenRun, freeAt, naturalW, phaseLag, releaseStats, resonancePeak, springPeriod, staticSag } from './oscillation'

describe('spring-mass', () => {
  test('T = 2π√(m/k): 4× mass doubles the period; sag predicts the frequency', () => {
    expect(springPeriod(0.5, 200)).toBeCloseTo(0.3142, 4)
    expect(springPeriod(2, 200) / springPeriod(0.5, 200)).toBeCloseTo(2, 9)
    const sag = staticSag(0.5, 200)
    expect(Math.sqrt(G / sag)).toBeCloseTo(naturalW(0.5, 200), 9)
  })

  test('undamped release repeats every T', () => {
    const wn = naturalW(0.3, 120)
    const T = springPeriod(0.3, 120)
    expect(freeAt(0, wn, 0.02, T)).toBeCloseTo(0.02, 9)
    expect(freeAt(0, wn, 0.02, T / 2)).toBeCloseTo(-0.02, 9)
  })

  test('RK4 run matches the closed form in every regime', () => {
    for (const zeta of [0, 0.1, 1, 2]) {
      const run = drivenRun({ m: 0.5, k: 200, zeta, x0: 0.03, seconds: 1 })
      for (const i of [137, 512, 1000]) expect(run[i].x).toBeCloseTo(freeAt(zeta, naturalW(0.5, 200), 0.03, run[i].t), 6)
    }
  })
})

describe('damping', () => {
  test('release = 1 − unit step response of the same second-order system', () => {
    for (const zeta of [0.2, 1, 1.6]) expect(freeAt(zeta, 10, 1, 0.3)).toBeCloseTo(1 - secondOrderAt(zeta, 10, 0.3), 9)
  })

  test('regimes, envelope and peak ratio', () => {
    expect([0, 0.3, 1, 1.5].map(dampRegime)).toEqual(['none', 'under', 'critical', 'over'])
    expect(dampingRatio(0.5, 200, 20)).toBeCloseTo(1, 9)
    const wn = 20
    const s = releaseStats(0.1, wn)
    expect(freeAt(0.1, wn, 1, s.td)).toBeCloseTo(s.ratio, 9)
    expect(Math.abs(freeAt(0.1, wn, 1, 0.37))).toBeLessThanOrEqual(decayEnvelope(0.1, wn, 1, 0.37) / Math.sqrt(1 - 0.01) + 1e-12)
    expect(s.swings).toBeGreaterThan(5)
  })

  test('critical damping settles fastest without overshoot', () => {
    const wn = 20
    const settle = (z: number) => releaseStats(z, wn).settle
    expect(settle(1)).toBeLessThan(settle(2))
    expect(settle(1)).toBeLessThan(settle(0.2))
    expect(Math.min(...Array.from({ length: 200 }, (_, i) => freeAt(1, wn, 1, i * 0.005)))).toBeGreaterThan(0)
    expect(releaseStats(0, wn).settle).toBe(Infinity)
  })
})

describe('resonance', () => {
  test('peak near ωn, height ≈ 1/(2ζ), phase 90° at ωn', () => {
    expect(ampRatio(0.05, 1)).toBeCloseTo(10, 9)
    expect(resonancePeak(0.05).ratio).toBeCloseTo(1 / (2 * 0.05 * Math.sqrt(1 - 0.05 ** 2)), 9)
    expect(resonancePeak(0.8).r).toBe(0)
    expect(phaseLag(0.1, 1)).toBeCloseTo(Math.PI / 2, 9)
    expect(phaseLag(0.1, 0.2)).toBeLessThan(0.1)
    expect(phaseLag(0.1, 5)).toBeGreaterThan(3)
  })

  test('driven run settles to the predicted amplitude', () => {
    const [m, k, zeta, f0] = [0.5, 200, 0.1, 1]
    for (const r of [0.5, 1, 2]) {
      const w = r * naturalW(m, k)
      const run = drivenRun({ m, k, zeta, f0, w, seconds: 6 })
      const late = run.slice(4000).map((f) => Math.abs(f.x))
      expect(Math.max(...late)).toBeCloseTo((f0 / k) * ampRatio(zeta, r), 4)
    }
  })
})
