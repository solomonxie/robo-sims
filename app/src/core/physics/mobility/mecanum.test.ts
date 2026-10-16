import { MECANUM, mecForceSum, mecForward, mecInverse, mecPlan, mecPushLimit, mecPushTwist, mecRun, mecScale, twistStep } from './mecanum'

const signs = (s: number[]) => s.map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v)))

describe('mecanum kinematics', () => {
  it('± patterns: forward, strafe, spin, diagonal', () => {
    expect(signs(mecInverse(0.2, 0, 0))).toEqual([1, 1, 1, 1])
    expect(signs(mecInverse(0, 0.2, 0))).toEqual([-1, 1, 1, -1])
    expect(signs(mecInverse(0, 0, 1))).toEqual([-1, 1, -1, 1])
    expect(signs(mecInverse(0.2, 0.2, 0))).toEqual([0, 1, 1, 0])
  })
  it('forward undoes inverse with no scrub', () => {
    const f = mecForward(mecInverse(0.1, -0.2, 0.7))
    expect(f.vx).toBeCloseTo(0.1)
    expect(f.vy).toBeCloseTo(-0.2)
    expect(f.w).toBeCloseTo(0.7)
    f.scrub.forEach((s) => expect(Math.abs(s)).toBeLessThan(1e-6))
  })
  it('swapped (O) layout strafes the wrong way and barely turns', () => {
    const strafe = mecPushTwist(mecInverse(0, 0.2, 0), 'o')
    expect(strafe.vy).toBeCloseTo(-0.2)
    const spin = mecPushTwist(mecInverse(0, 0, 1), 'o')
    expect(spin.w).toBeCloseTo((MECANUM.halfW - MECANUM.halfL) / (MECANUM.halfW + MECANUM.halfL))
    expect(Math.max(...spin.scrub.map(Math.abs))).toBeGreaterThan(0.1)
    const ok = mecPushTwist(mecInverse(0.1, 0.2, -0.5))
    expect([ok.vx, ok.vy, ok.w].map((v) => +v.toFixed(6))).toEqual([0.1, 0.2, -0.5])
    expect(mecForceSum(mecInverse(0, 0, 1), 'o').tz / mecForceSum(mecInverse(0, 0, 1)).tz).toBeCloseTo((MECANUM.halfW - MECANUM.halfL) / (MECANUM.halfW + MECANUM.halfL))
  })
  it('scaling keeps the ratios', () => {
    const { speeds, k } = mecScale([1.2, -0.6, 0.3, 0], 0.6)
    expect(k).toBeCloseTo(0.5)
    expect(speeds).toEqual([0.6, -0.3, 0.15, 0])
  })
})

describe('mecanum forces', () => {
  it('strafe pushes sideways, spin twists', () => {
    const s = mecForceSum([-1, 1, 1, -1])
    expect(s.fx).toBeCloseTo(0)
    expect(s.fy).toBeCloseTo(4)
    expect(s.tz).toBeCloseTo(0)
    const r = mecForceSum([-1, 1, -1, 1])
    expect(r.fx).toBeCloseTo(0)
    expect(r.fy).toBeCloseTo(0)
    expect(r.tz).toBeCloseTo(4 * (MECANUM.halfL + MECANUM.halfW))
  })
  it('push limit is cos 45° of a tyre', () => {
    const p = mecPushLimit(0.6, 1.6)
    expect(p.tyre).toBeCloseTo(0.6 * 1.6 * 9.81)
    expect(p.mecanum / p.tyre).toBeCloseTo(Math.SQRT1_2)
  })
  it('twistStep: straight, and a full circle comes home', () => {
    expect(twistStep({ x: 0, y: 0, th: 0 }, 0, 0.2, 0, 1).y).toBeCloseTo(0.2)
    let p = { x: 0, y: 0, th: 0 }
    for (let i = 0; i < 100; i++) p = twistStep(p, 0.1, 0.1, (2 * Math.PI) / 10, 0.1)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
  })
})

describe('mecanum strafe run', () => {
  it('plan reaches the distance and stops', () => {
    expect(mecPlan(10).s).toBeCloseTo(0.8)
    expect(mecPlan(10).v).toBe(0)
  })
  it('flat and balanced: straight, a little short', () => {
    const r = mecRun('strafe', 0, 0, false)
    expect(Math.abs(r.headDeg)).toBeLessThan(0.1)
    expect(r.shortM).toBeGreaterThan(0.01)
    expect(r.shortM).toBeLessThan(0.08)
  })
  it('front-heavy strafe yaws open-loop; the IMU holds heading', () => {
    expect(Math.abs(mecRun('strafe', 0, 30, false).headDeg)).toBeGreaterThan(2)
    expect(Math.abs(mecRun('strafe', 0, 30, true).headDeg)).toBeLessThan(0.2)
  })
  it('uneven tiles unload wheels and cost distance; driving forward barely cares', () => {
    const s = mecRun('strafe', 2, 0, false)
    expect(s.shortM).toBeGreaterThan(0.08)
    expect(mecRun('forward', 2, 0, false).shortM).toBeLessThan(0.01)
  })
})
