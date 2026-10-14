import {
  TimingPath,
  captureImbalance,
  clockLevel,
  divideBy,
  expectedCapture,
  maxClock,
  metastableLevel,
  pathAt,
  pathDelay,
  pathSlack,
  resolveTime,
  syncMtbf,
} from '.'

const path = (period: number, stages: number): TimingPath => ({ period, tcq: 14e-9, tpd: 8e-9, stages, tsu: 10e-9 })
const captured = (p: TimingPath, m: number) => pathAt(p, m * p.period + p.tcq + 1e-12).capture

describe('timing', () => {
  it('path delay, slack and the fastest clock agree', () => {
    const p = path(100e-9, 4)
    expect(pathDelay(p)).toBeCloseTo(46e-9, 15)
    expect(pathSlack(p)).toBeCloseTo(44e-9, 15)
    expect(maxClock(14e-9, 32e-9, 10e-9)).toBeCloseTo(1 / 56e-9, 0)
    expect(maxClock(14e-9, 32e-9, 10e-9, 4e-9)).toBeLessThan(maxClock(14e-9, 32e-9, 10e-9))
  })
  it('a path with slack captures every launched value, a late one misses', () => {
    for (const stages of [1, 2, 5]) {
      const ok = path(80e-9, stages)
      for (let m = 0; m < 8; m++) expect(captured(ok, m)).toBe(expectedCapture(ok, m))
    }
    const late = path(40e-9, 4)
    expect(pathSlack(late)).toBeLessThan(0)
    expect([1, 2, 3, 4].some((m) => captured(late, m) !== expectedCapture(late, m))).toBe(true)
  })
  it('each inverter delays and flips the launch output', () => {
    const p = path(100e-9, 3)
    const t = 30e-9
    const a = pathAt(p, t).nodes
    expect(a[1]).not.toBe(pathAt(p, t - p.tpd).nodes[0])
    expect(a[2]).toBe(pathAt(p, t - 2 * p.tpd).nodes[0])
    expect(clockLevel(0, 1)).toBe(1)
    expect(clockLevel(0.6, 1)).toBe(0)
  })
  it('metastability: a D edge near the clock leaves a small imbalance that grows as e^(t/τ)', () => {
    const tau = 30e-12
    expect(captureImbalance(-1e-9, 30e-12)).toBe(0.5)
    expect(captureImbalance(1e-9, 30e-12)).toBe(-0.5)
    const dv = captureImbalance(-1e-12, 30e-12)
    expect(dv).toBeCloseTo(1 / 60, 9)
    expect(metastableLevel(0, dv, tau)).toBeCloseTo(0.5 + dv, 9)
    expect(metastableLevel(resolveTime(dv, tau), dv, tau)).toBeCloseTo(1, 9)
    expect(resolveTime(dv / 10, tau) - resolveTime(dv, tau)).toBeCloseTo(tau * Math.log(10), 15)
    expect(resolveTime(0.5, tau)).toBe(0)
  })
  it('a second synchroniser stage multiplies the MTBF by e^(T/τ)', () => {
    const one = syncMtbf(300e-12, 30e-12, 30e-12, 1e9, 1e7)
    const two = syncMtbf(1300e-12, 30e-12, 30e-12, 1e9, 1e7)
    expect(one).toBeCloseTo(Math.exp(10) / 3e5, 6)
    expect(two / one).toBeCloseTo(Math.exp(1000 / 30), -10)
  })
  it('a ÷N divider gives N input periods per output cycle at 50 % duty', () => {
    for (const n of [2, 4, 6, 10]) {
      const outs = Array.from({ length: 4 * n }, (_, e) => divideBy(e, n).out)
      expect(outs.filter(Boolean).length).toBe(2 * n)
      const toggles = outs.filter((o, e) => e && o !== outs[e - 1]).length
      expect(toggles).toBe(7)
    }
    expect(Array.from({ length: 6 }, (_, e) => divideBy(e, 6).count)).toEqual([0, 1, 2, 0, 1, 2])
    expect(Array.from({ length: 6 }, (_, e) => divideBy(e, 6).tc)).toEqual([0, 0, 1, 0, 0, 1])
    expect(divideBy(5, 2).tc).toBe(1)
  })
})
