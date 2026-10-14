import {
  HC49_16M,
  WATCH_HZ,
  crystalBandwidth,
  crystalQ,
  dividerStages,
  driftPerDay,
  loadCapacitance,
  loadCapsFor,
  loadedFrequency,
  motionalL,
  motionalResponse,
  parallelResonance,
  pullPpm,
  responseDb,
  seriesResonance,
} from '.'

const x = HC49_16M

describe('oscillators', () => {
  it('the BVD values give a datasheet-like 16 MHz part', () => {
    const fs = seriesResonance(x)
    expect(fs).toBeGreaterThan(15.99e6)
    expect(fs).toBeLessThan(16e6)
    expect(1 / (2 * Math.PI * Math.sqrt(motionalL(x) * x.c1))).toBeCloseTo(fs, 0)
    expect(crystalQ(x)).toBeGreaterThan(30000)
    expect(crystalQ(x)).toBeLessThan(100000)
    expect(crystalBandwidth(x)).toBeCloseTo(fs / crystalQ(x), 6)
    expect(parallelResonance(x) - fs).toBeGreaterThan(20e3)
    expect(parallelResonance(x) - fs).toBeLessThan(40e3)
  })
  it('the response peaks at fs, is −3 dB half a bandwidth away and dips at fp', () => {
    const fs = seriesResonance(x)
    const bw = crystalBandwidth(x)
    expect(motionalResponse(x, fs)).toBeCloseTo(1, 9)
    expect(motionalResponse(x, fs + bw / 2)).toBeCloseTo(Math.SQRT1_2, 3)
    expect(responseDb(x, fs)).toBeCloseTo(0, 9)
    expect(responseDb(x, fs + 5e3)).toBeLessThan(-20)
    const fp = parallelResonance(x)
    expect(responseDb(x, fp)).toBeLessThan(responseDb(x, fp - 2e3))
    expect(responseDb(x, fp)).toBeLessThan(responseDb(x, fp + 2e3))
  })
  it('load caps pull the frequency: marked value at the rated load, fast with less, slow with more', () => {
    expect(loadedFrequency(x, x.loadC)).toBeCloseTo(x.nominal, 3)
    expect(pullPpm(x, x.loadC)).toBeCloseTo(0, 9)
    expect(pullPpm(x, 14e-12)).toBeGreaterThan(50)
    expect(pullPpm(x, 22e-12)).toBeLessThan(-30)
    const slope = (pullPpm(x, 18.5e-12) - pullPpm(x, 17.5e-12)) / 1
    expect(slope).toBeLessThan(-10)
    expect(slope).toBeGreaterThan(-25)
  })
  it('two caps in series plus stray make the load; the right pair is 2 (CL − Cstray)', () => {
    expect(loadCapacitance(22e-12, 22e-12, 5e-12)).toBeCloseTo(16e-12, 20)
    const c = loadCapsFor(18e-12, 5e-12)
    expect(c).toBeCloseTo(26e-12, 20)
    expect(loadCapacitance(c, c, 5e-12)).toBeCloseTo(18e-12, 20)
  })
  it('ppm turns into seconds a day; a watch crystal halves down to 1 Hz in 15 steps', () => {
    expect(driftPerDay(1)).toBeCloseTo(0.0864, 6)
    expect(driftPerDay(20)).toBeCloseTo(1.728, 6)
    expect(driftPerDay(-50)).toBeCloseTo(-4.32, 6)
    expect(dividerStages(WATCH_HZ)).toBe(15)
  })
})
