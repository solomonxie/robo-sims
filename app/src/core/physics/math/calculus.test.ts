import { medianMs } from '../../stopwatch'
import { stdDev } from '../common'
import { integrateRate } from '../sensors/imu'
import { RULES, Rule, TURN, areaView, diffTradeoff, gyroIntegrate, integrateRule, lineDriveAt, ruleErrors, ruleStrips, runningIntegral, secantView, turnAngle, turnRate } from './calculus'

describe('derivative as slope', () => {
  it('speed is the slope of position and acceleration the slope of speed', () => {
    const e = 1e-5
    for (const t of [0.3, 1.7, 3.1, 5.2]) {
      const [a, b] = [lineDriveAt('reverse', t - e), lineDriveAt('reverse', t + e)]
      expect((b.x - a.x) / (2 * e)).toBeCloseTo(lineDriveAt('reverse', t).v, 6)
      expect((b.v - a.v) / (2 * e)).toBeCloseTo(lineDriveAt('reverse', t).acc, 6)
    }
  })
  it('the secant slope shrinks to the tangent as h → 0, error ≈ x″·h/2', () => {
    const errs = [1, 0.5, 0.1, 0.02].map((h) => Math.abs(secantView('reverse', 1, h, 0).error))
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1])
    const s = secantView('reverse', 1, 0.1, 0)
    expect(s.error).toBeCloseTo(s.truncation, 2)
    expect(s.h).toBeCloseTo(0.1, 12)
  })
  it('noise blows up small-h differences by √2·σ/h', () => {
    const spread = (h: number) => {
      const a = secantView('cruise', 0, h, 0.002)
      const b = secantView('cruise', 0, h, 0)
      return stdDev(a.est.map((v, i) => v - b.est[i]))
    }
    expect(spread(0.02)).toBeGreaterThan(5 * spread(0.5))
    expect(spread(0.04) / secantView('cruise', 0, 0.04, 0.002).noiseGain).toBeCloseTo(1, 0)
  })
})

describe('integral as area', () => {
  it('rectangles converge to the exact signed area, x(T)', () => {
    const errs = [4, 16, 64].map((n) => Math.abs(areaView('cruise', 5, n).error))
    expect(errs[1]).toBeLessThan(errs[0] / 2)
    expect(errs[2]).toBeLessThan(errs[1] / 2)
    expect(areaView('cruise', 5, 64).exact).toBeCloseTo(lineDriveAt('cruise', 5).x, 12)
  })
  it('reversing gives negative area: distance > displacement', () => {
    const r = areaView('reverse', 6, 60)
    expect(r.back).toBeGreaterThan(0.2)
    expect(r.distance - r.exact).toBeCloseTo(2 * r.back, 3)
    const c = areaView('cruise', 6, 60)
    expect(c.back).toBe(0)
    expect(c.distance).toBeCloseTo(c.exact, 4)
  })
  it('left rectangles are the robot loop x += v·dt', () => {
    const r = areaView('reverse', 4, 20)
    const loop = integrateRate(r.strips.map((s) => s.y0), 0.2)
    expect(loop[19]).toBeCloseTo(r.sum, 12)
    expect(r.running[20]).toBeCloseTo(r.sum, 12)
  })
})

describe('numerical integration', () => {
  it('true angle is the integral of the rate', () => {
    expect(integrateRule(turnRate, 0, TURN.T, 400, 'simpson')).toBeCloseTo(turnAngle(TURN.T), 6)
  })
  it('error orders: left/right ~1/N, midpoint/trapezoid ~1/N², Simpson ~1/N⁴', () => {
    const ratio = (rule: Rule, n = 8) => {
      const [a, b] = ruleErrors(rule, [n, 2 * n])
      return a / b
    }
    expect(ratio('left', 64)).toBeCloseTo(2, 0)
    const [lo, hi] = [integrateRule(turnRate, 0, 4, 8, 'left'), integrateRule(turnRate, 0, 4, 8, 'right')]
    expect(hi - lo).toBeCloseTo(0.5 * (turnRate(4) - turnRate(0)), 9)
    expect((lo + hi) / 2).toBeCloseTo(integrateRule(turnRate, 0, 4, 8, 'trap'), 9)
    for (const r of ['mid', 'trap'] as Rule[]) expect(ratio(r)).toBeGreaterThan(3.5)
    expect(ratio('simpson')).toBeGreaterThan(12)
    const at16 = Object.keys(RULES).map((r) => ruleErrors(r as Rule, [16])[0])
    expect(at16[4]).toBeLessThan(Math.min(...at16.slice(0, 4)))
  })
  it('strips add up to the rule and running sums end at the total', () => {
    const f = (t: number) => turnRate(t)
    for (const r of Object.keys(RULES) as Rule[]) {
      const area = ruleStrips(f, 0, 4, 8, r, 200).reduce((s, x) => s + ((x.t1 - x.t0) * (x.y0 + x.y1)) / 2, 0)
      expect(area).toBeCloseTo(integrateRule(f, 0, 4, 8, r), r === 'simpson' ? 3 : 10)
      expect(runningIntegral(f, 0, 4, 8, r)).toHaveLength(9)
    }
  })
  it('gyro bias drifts linearly: bias·T on top of the rule error', () => {
    const g = gyroIntegrate('trap', 16, 2)
    expect(g.drift).toBeCloseTo(8, 12)
    expect(g.error).toBeCloseTo(g.ruleError + g.drift, 9)
    expect(g.angles[8] - gyroIntegrate('trap', 16, 0).angles[8]).toBeCloseTo(4, 9)
  })
  it('recomputes fast', () => {
    const ms = medianMs(() => {
      for (let i = 0; i < 20; i++) {
        secantView('reverse', 1, 0.3, 0.002)
        areaView('reverse', 6, 48)
        gyroIntegrate('simpson', 32, 3)
        ruleErrors('trap', Array.from({ length: 16 }, (_, k) => 2 + 2 * k))
      }
    })
    expect(ms / 20).toBeLessThan(50)
  })
})

describe('step size trade-off', () => {
  it('best h minimises truncation + noise', () => {
    const hs = Array.from({ length: 100 }, (_, i) => 0.005 + i * 0.005)
    const d = diffTradeoff('reverse', 0.3, 0.002, hs)
    const acc = Math.abs(lineDriveAt('reverse', 0.3).acc)
    expect(d.rows[0].trunc).toBeCloseTo((acc * hs[0]) / 2, 3)
    expect(d.best!).toBeCloseTo(Math.sqrt((2 * Math.SQRT2 * 0.002) / acc), 1)
    expect(diffTradeoff('reverse', 1, 0, hs).best).toBeNull()
  })
})
