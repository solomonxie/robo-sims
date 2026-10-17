import { G } from '../common'
import { ROLL_FLOORS } from '../control/loop'
import { FRICTION_PAIRS } from './newton'
import { SLIP_PEAK, axleLoads, rollingCost, rollingDrag, slipAngle, slipRatio, stickSlipRun, tractionLimit, tractionMu, tractionRun } from './friction'

describe('stick-slip', () => {
  test('slow drag: sawtooth between μs·N and below μk·N', () => {
    const r = stickSlipRun({ ...FRICTION_PAIRS.tile, k: 150, speed: 0.06, seconds: 8 })
    expect(r.slips).toBeGreaterThan(5)
    expect(r.sticking).toBe(true)
    const peak = Math.max(...r.run.map((f) => f.spring))
    expect(peak).toBeLessThan(r.staticN * 1.05)
    expect(peak).toBeGreaterThan(r.staticN * 0.98)
    expect(Math.min(...r.run.slice(2000).map((f) => f.spring))).toBeLessThan(r.kineticN)
  })

  test('fast drag or slick pair slides smoothly at μk·N', () => {
    const fast = stickSlipRun({ ...FRICTION_PAIRS.tile, k: 150, speed: 0.3, seconds: 8 })
    expect(fast.sticking).toBe(false)
    expect(fast.slips).toBe(1)
    const end = fast.run[fast.run.length - 1]
    expect(end.vb).toBeCloseTo(0.3, 2)
    expect(end.spring).toBeCloseTo(fast.kineticN + 1.5 * 0.3, 1)
    expect(stickSlipRun({ ...FRICTION_PAIRS.ptfe, k: 150, speed: 0.06, seconds: 8 }).sticking).toBe(false)
  })

  test('tilt test angle gives μs', () => {
    expect(Math.tan(slipAngle(0.7))).toBeCloseTo(0.7)
  })
})

describe('rolling resistance', () => {
  test('TT wheel matches the floor Crr table to within 35 %', () => {
    for (const f of ['tile', 'wood', 'carpet'] as const) {
      const c = rollingCost('tt', f, 0.8, 0.5).crr
      expect(c / ROLL_FLOORS[f].crr).toBeGreaterThan(0.65)
      expect(c / ROLL_FLOORS[f].crr).toBeLessThan(1.35)
    }
  })

  test('bigger wheels roll easier; hard wheels win on hard floors, lose on soft', () => {
    expect(rollingDrag('big', 'carpet', 2).crr).toBeLessThan(rollingDrag('tt', 'carpet', 2).crr)
    expect(rollingDrag('hard', 'tile', 2).crr).toBeLessThan(rollingDrag('foam', 'tile', 2).crr)
    expect(rollingDrag('hard', 'carpet', 2).crr).toBeGreaterThan(rollingDrag('tt', 'carpet', 2).crr)
  })

  test('power = Crr·m·g·v; force = N·e/r', () => {
    const c = rollingCost('tt', 'wood', 1, 0.4)
    expect(c.power).toBeCloseTo(c.crr * G * 0.4)
    const d = rollingDrag('tt', 'wood', 3)
    expect(d.force).toBeCloseTo((3 * d.e) / 0.0325)
  })
})

describe('traction and wheel slip', () => {
  test('grip curve peaks at κ = 0.15 and falls when spinning', () => {
    expect(tractionMu(0.6, SLIP_PEAK)).toBeCloseTo(0.6)
    expect(tractionMu(0.6, 1)).toBeLessThan(0.45)
    expect(tractionMu(0.6, -0.15)).toBeCloseTo(-0.6)
    expect(slipRatio(1, 0)).toBe(1)
    expect(slipRatio(0, 1)).toBe(-1)
    expect(slipRatio(0.5, 0.5)).toBe(0)
  })

  test('weight shifts to the rear axle uphill and when accelerating', () => {
    const flat = axleLoads(1, 0.05, 0, 0)
    expect(flat.rear).toBeCloseTo(G / 2)
    const hill = axleLoads(1, 0.05, 0.3, 0)
    expect(hill.rear).toBeGreaterThan(hill.front)
    expect(hill.rear + hill.front).toBeCloseTo(G * Math.cos(0.3))
    expect(axleLoads(1, 0.05, 0, 2).rear).toBeGreaterThan(flat.rear)
  })

  test('climb limit: all-wheel > rear > front drive; grip ∝ μ', () => {
    const [all, rear, front] = (['all', 'rear', 'front'] as const).map((d) => tractionLimit(0.6, 0, d, 0.5).maxSlope)
    expect(all).toBeGreaterThan(rear)
    expect(rear).toBeGreaterThan(front)
    expect(Math.tan(all)).toBeCloseTo(0.6 - 0.015, 1)
  })

  test('launch spins then grips on the flat; front drive slides back on a steep slick ramp', () => {
    const flat = tractionRun({ mu: 0.6, volts: 6, theta: 0, drive: 'rear', loadKg: 0.5, seconds: 2 })
    expect(Math.max(...flat.map((f) => f.kappa[0]))).toBeGreaterThan(SLIP_PEAK)
    const end = flat[flat.length - 1]
    expect(end.v).toBeGreaterThan(0.5)
    expect(Math.abs(end.kappa[0])).toBeLessThan(0.05)
    expect(end.kappa[1]).toBeCloseTo(0, 6)
    const hill = tractionRun({ mu: 0.35, volts: 6, theta: 0.3, drive: 'front', loadKg: 0.5, seconds: 2 })
    expect(hill[hill.length - 1].x).toBeLessThan(0)
  })
})
