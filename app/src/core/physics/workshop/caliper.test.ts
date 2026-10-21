import { DEG } from '../common'
import { CALIPERS, CALIPER_LAPSE, CALIPER_LAPSE_S, CaliperCfg, MEASURE_PARTS, MEASURE_TOL, VERNIER_LC, ZERO_SLIP_MM, caliperAt, caliperRun, dialRead, parallaxError, roundToStep, squeezeLimitN, tiltError, tiltLimitDeg, vernierRead } from './caliper'

const GOOD: CaliperCfg = { part: 'tyre', kind: 'digital', tiltDeg: 0, forceN: 1, eyeDeg: 0, zeroed: true, hot: false }

describe('scales', () => {
  it('vernier: 50 lines over 49 mm read 0.02 mm', () => {
    expect(VERNIER_LC).toBeCloseTo(0.02, 12)
    expect(vernierRead(18.36)).toMatchObject({ main: 18, line: 18 })
    expect(vernierRead(18.36).value).toBeCloseTo(18.36, 9)
    expect(vernierRead(2.9)).toMatchObject({ main: 2, line: 45 })
    expect(vernierRead(65)).toMatchObject({ main: 65, line: 0 })
  })
  it('dial: 2 mm per turn, needle fraction', () => {
    const d = dialRead(18.37)
    expect(d.barMm).toBe(18)
    expect(d.value).toBeCloseTo(18.38, 9)
    expect(d.needle).toBeCloseTo(0.19, 9)
  })
  it('rounds to the step', () => {
    expect(roundToStep(2.904, 0.01)).toBeCloseTo(2.9, 12)
    expect(roundToStep(2.911, 0.02)).toBeCloseTo(2.92, 12)
  })
})

describe('technique errors', () => {
  it('cosine error: outside reads high, inside a short chord', () => {
    expect(tiltError('outside', 65, 3)).toBeCloseTo(65 / Math.cos(3 * DEG) - 65, 12)
    expect(tiltError('inside', 8, 3)).toBeLessThan(0)
    expect(tiltError('outside', 65, 3)).toBeGreaterThan(MEASURE_TOL)
    expect(tiltError('outside', 2.9, 3)).toBeLessThan(0.01)
  })
  it('the tilt limit grows as the part shrinks; the soft tyre allows 2 N', () => {
    expect(tiltError('outside', 65, tiltLimitDeg('outside', 65))).toBeCloseTo(MEASURE_TOL, 9)
    expect(tiltError('inside', 8, tiltLimitDeg('inside', 8))).toBeCloseTo(-MEASURE_TOL, 9)
    expect(tiltLimitDeg('outside', 2.9)).toBeGreaterThan(tiltLimitDeg('outside', 65) * 3)
    expect(squeezeLimitN(MEASURE_PARTS.tyre)).toBeCloseTo(2, 9)
  })
  it('parallax: big on a vernier, tiny on a dial, none on digital', () => {
    expect(parallaxError('vernier', 20)).toBeCloseTo(0.3 * Math.tan(20 * DEG), 12)
    expect(parallaxError('dial', 20)).toBeLessThan(0.02)
    expect(parallaxError('digital', 45)).toBe(0)
  })
})

describe('caliperRun', () => {
  it('good technique reads within ±0.05 on every part and caliper', () => {
    for (const part of Object.keys(MEASURE_PARTS) as (keyof typeof MEASURE_PARTS)[])
      for (const kind of Object.keys(CALIPERS) as (keyof typeof CALIPERS)[]) {
        const r = caliperRun({ ...GOOD, part, kind })
        expect(r.verdict.pass).toBe(true)
        expect(Math.abs(r.error)).toBeLessThanOrEqual(MEASURE_TOL)
      }
  })
  it('names the first error', () => {
    expect(caliperRun({ ...GOOD, zeroed: false }).verdict.fail).toBe('zero')
    expect(caliperRun({ ...GOOD, zeroed: false }).error).toBeCloseTo(roundToStep(ZERO_SLIP_MM - 0.025, 0.01), 9)
    expect(caliperRun({ ...GOOD, part: 'bracket', hot: true }).verdict.fail).toBe('hot')
    expect(caliperRun({ ...GOOD, part: 'screw', hot: true }).verdict.pass).toBe(true)
    expect(caliperRun({ ...GOOD, tiltDeg: 4 }).verdict.fail).toBe('tilt')
    expect(caliperRun({ ...GOOD, forceN: 6 }).verdict.fail).toBe('squeeze')
    expect(caliperRun({ ...GOOD, forceN: 6, part: 'cell' }).verdict.pass).toBe(true)
    expect(caliperRun({ ...GOOD, kind: 'vernier', eyeDeg: 20 }).verdict.fail).toBe('parallax')
    expect(caliperRun({ ...GOOD, kind: 'dial', eyeDeg: 20 }).verdict.pass).toBe(true)
  })
  it('small errors add up past the target', () => {
    const r = caliperRun({ ...GOOD, tiltDeg: 2, kind: 'vernier', eyeDeg: 9 })
    expect(r.verdict.fail).toBe('total')
    expect(r.verdict.near).toBe(true)
  })
})

describe('caliperAt', () => {
  it('closes from open to touching, then squeezes to the final gap', () => {
    const r = caliperRun({ ...GOOD, forceN: 6 })
    expect(caliperAt(r, 0).gapMm).toBeCloseTo(65 + 6, 9)
    expect(caliperAt(r, CALIPER_LAPSE.closeS).gapMm).toBeCloseTo(65, 9)
    const end = caliperAt(r, CALIPER_LAPSE_S)
    expect(end.gapMm).toBeCloseTo(r.gapMm, 9)
    expect(end.shown).toBeCloseTo(r.reading, 9)
    expect(end.settled).toBe(true)
    const bore = caliperRun({ ...GOOD, part: 'bore' })
    expect(caliperAt(bore, 0).gapMm).toBeLessThan(8)
  })
})
