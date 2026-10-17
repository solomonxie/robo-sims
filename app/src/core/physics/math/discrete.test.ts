import { filterAt } from '../control/loopfilter'
import { emaAlpha } from '../signals/filters'
import { foldedHz, onePoleAt, onePoleGain, onePoleRun, poleOfTau, reconstructAt, sOfPole, sampleRateView, sinc, spectralImages, zInput, zView } from './discrete'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

describe('sample rate', () => {
  it('folds a tone into 0 … fs/2: |f − k·fs|', () => {
    expect(foldedHz(30, 100)).toBeCloseTo(30, 12)
    expect(foldedHz(70, 100)).toBeCloseTo(30, 12)
    expect(foldedHz(130, 100)).toBeCloseTo(30, 12)
    expect(foldedHz(100, 100)).toBeCloseTo(0, 12)
  })
  it('spectral copies sit at k·fs ± f; exactly one is seen', () => {
    const im = spectralImages(70, 100, 300)
    expect(im.map((i) => i.hz)).toEqual([30, 70, 130, 170, 230, 270])
    expect(im.filter((i) => i.seen).map((i) => i.hz)).toEqual([30])
    expect(im.filter((i) => i.original).map((i) => i.hz)).toEqual([70])
  })
  it('samples above Nyquist are the same numbers as the alias', () => {
    const fs = 100
    for (let k = 0; k < 20; k++) expect(Math.sin((2 * Math.PI * 70 * k) / fs)).toBeCloseTo(-Math.sin((2 * Math.PI * 30 * k) / fs), 9)
  })
  it('reconstruction passes through the samples; hold steps, line joins', () => {
    const xs = [0, 1, 0.5, -1]
    for (const kind of ['hold', 'line', 'ideal'] as const) expect(reconstructAt(kind, xs, 10, 0, 0.2)).toBeCloseTo(0.5, 9)
    expect(reconstructAt('hold', xs, 10, 0, 0.15)).toBe(1)
    expect(reconstructAt('line', xs, 10, 0, 0.15)).toBeCloseTo(0.75, 12)
    expect(sinc(0)).toBe(1)
    expect(sinc(2)).toBeCloseTo(0, 12)
  })
  it('ideal rebuild below Nyquist is near exact; hold error shrinks as fs grows; above Nyquist it rebuilds the alias', () => {
    expect(sampleRateView(20, 100, 'ideal', 0.2).rms).toBeLessThan(0.05)
    expect(sampleRateView(20, 400, 'hold', 0.2).rms).toBeLessThan(0.6 * sampleRateView(20, 100, 'hold', 0.2).rms)
    const v = sampleRateView(70, 100, 'ideal', 0.2)
    expect(v.aliased).toBe(true)
    expect(v.seen).toBeCloseTo(30, 9)
    const err = v.ts.map((t, i) => Math.abs(v.rebuilt[i] + Math.sin(2 * Math.PI * 30 * t)))
    expect(Math.max(...err)).toBeLessThan(0.1)
    expect(v.dots.length).toBe(21)
  })
  it('recomputes fast', () => {
    const runs = Array.from({ length: 5 }, () => {
      const t = performance.now()
      sampleRateView(200, 500, 'ideal', 0.2)
      return performance.now() - t
    })
    expect(median(runs)).toBeLessThan(100)
  })
})

describe('z-transform intuition', () => {
  it('impulse response b·aⁿ, step response 1 − aⁿ⁺¹', () => {
    const a = 0.8
    const b = onePoleGain(a)
    const imp = onePoleRun(a, b, Array.from({ length: 10 }, (_, i) => zInput('impulse', i)))
    imp.forEach((y, n) => expect(y).toBeCloseTo(b * a ** n, 12))
    const step = onePoleRun(a, b, Array.from({ length: 10 }, (_, i) => zInput('step', i)))
    step.forEach((y, n) => expect(y).toBeCloseTo(1 - a ** (n + 1), 12))
  })
  it('the frequency response is the EMA response of Control › loop filter', () => {
    for (const th of [0.1, 0.7, 2]) {
      const f = filterAt({ kind: 'ema', alpha: 0.3 }, th, 1)
      const h = onePoleAt(0.7, 0.3, th)
      expect(h.mag).toBeCloseTo(f.mag, 12)
      expect(h.phase).toBeCloseTo(f.phase, 12)
    }
    const a = 0.6
    expect(onePoleAt(a, 1, 1.1).mag).toBeCloseTo(1 / Math.hypot(Math.cos(1.1) - a, Math.sin(1.1)), 12)
  })
  it('z = e^{sT}: left half-plane maps inside the unit circle', () => {
    const T = 0.01
    expect(poleOfTau(0.05, T)).toBeCloseTo(Math.exp(-0.2), 12)
    expect(poleOfTau(0.05, T)).toBeCloseTo(1 - emaAlpha(T, 0.05), 12)
    expect(sOfPole(Math.exp(-0.2), T).re).toBeCloseTo(-20, 9)
    expect(sOfPole(1.1, T).re).toBeGreaterThan(0)
    expect(sOfPole(-0.5, T).im).toBeCloseTo(Math.PI / T, 9)
  })
  it('inside decays, negative rings, outside grows', () => {
    const v = zView(0.8, 'step', 40, 0.01, 0.5)
    expect(v.stable).toBe(true)
    expect(v.ys[39]).toBeCloseTo(1, 2)
    expect(v.tau).toBeCloseTo(-0.01 / Math.log(0.8), 9)
    expect(v.freq[0]).toBeCloseTo(1, 12)
    const r = zView(-0.6, 'impulse', 6, 0.01, 0.5)
    expect(r.rings).toBe(true)
    expect(Math.sign(r.ys[1])).toBe(-Math.sign(r.ys[0]))
    const u = zView(1.05, 'impulse', 60, 0.01, 0.5)
    expect(u.stable).toBe(false)
    expect(Math.abs(u.ys[59])).toBeGreaterThan(Math.abs(u.ys[0]) * 10)
    expect(onePoleGain(1)).toBe(0.05)
  })
  it('noisy step is repeatable', () => {
    expect(zInput('noisy', 5)).toBe(zInput('noisy', 5))
    expect(zInput('noisy', 5)).not.toBe(1)
  })
})
