import {
  TL072,
  comparatorRun,
  comparatorThresholds,
  inverting,
  loadedVolts,
  nonInverting,
  nonInvertingGain,
  openLoopOut,
  saturate,
  swingHigh,
} from '.'

const op = TL072
const r = { vcc: 12, vee: -12 }

describe('opamps', () => {
  it('closed-loop gain closes on 1/β as A grows', () => {
    const errs = [10, 1e3, 1e5].map((a) => Math.abs(nonInvertingGain(a, 0.1) - 10) / 10)
    expect(errs[0]).toBeGreaterThan(0.4)
    expect(errs[1]).toBeCloseTo(0.0099, 3)
    expect(errs[2]).toBeLessThan(1e-4)
  })

  it('open loop slams to the rail on microvolts', () => {
    expect(openLoopOut(op, 1e-3, 0, r)).toBe(swingHigh(op, r))
    expect(openLoopOut(op, 0, 1e-3, r)).toBe(-10.5)
    expect(openLoopOut(op, 20e-6, 0, r)).toBeCloseTo(4, 6)
  })

  it('inverting: −Rf/Rin, a virtual ground, and clipping that breaks it', () => {
    const s = inverting(op, 0.5, 10e3, 100e3, r)
    expect(s.vout).toBeCloseTo(-5, 3)
    expect(Math.abs(s.vn)).toBeLessThan(1e-4)
    expect(s.amps).toBeCloseTo(50e-6, 8)
    expect(s.clipped).toBe(false)
    const c = inverting(op, 2, 10e3, 100e3, r)
    expect(c.vout).toBe(-10.5)
    expect(c.clipped).toBe(true)
    expect(c.vn).toBeCloseTo((2 * 100 - 10.5 * 10) / 110, 6)
  })

  it('follower holds the source up under load, until current or swing runs out', () => {
    expect(loadedVolts(2, 10e3, 1e3)).toBeCloseTo(0.1818, 4)
    expect(nonInverting(op, 2, 1, r, 1e3).vout).toBeCloseTo(2, 4)
    expect(nonInverting(op, 2, 1, r, 10).vout).toBeCloseTo(0.4, 6)
    expect(nonInverting(op, 4, 1, { vcc: 5, vee: -5 }).vout).toBe(3.5)
    expect(saturate(op, -9, r, 100)).toBe(-4)
  })

  it('comparator hysteresis splits the threshold and stops chatter', () => {
    const t = comparatorThresholds(op, 2, 10e3, 1e6, r)
    expect(t.up).toBeGreaterThan(2)
    expect(t.down).toBeLessThan(2)
    expect(t.up - t.down).toBeCloseTo((21 * 10e3) / 1e6, 3)
    const ramp = Array.from({ length: 400 }, (_, i) => 1.5 + i / 400 + 0.05 * Math.sin(i * 1.7))
    expect(comparatorRun(op, ramp, 2, 10e3, Infinity, r).flips).toBeGreaterThan(2)
    expect(comparatorRun(op, ramp, 2, 10e3, 1e6, r).flips).toBe(1)
  })
})
