import { DEG, wrapPi } from '../common'
import { twoLinkTip } from '../kinematics/chain'
import { accelPitch } from '../mcu/i2c'
import { atanNaive, bearingView, elbowView, quadrantOf, triangleAngles, unitCircleView } from './trig'

describe('unit circle', () => {
  it('cos and sin are the x and y of the point, wrapped to ±180°', () => {
    for (const d of [0, 30, 90, 135, 200, 270, 400, -100]) {
      const u = unitCircleView(d * DEG)
      expect(u.check).toBeCloseTo(1, 12)
      expect(Math.cos(u.wrapped)).toBeCloseTo(u.x, 12)
      expect(Math.sin(u.wrapped)).toBeCloseTo(u.y, 12)
      expect(u.wrapped).toBeGreaterThanOrEqual(-Math.PI)
      expect(u.wrapped).toBeLessThan(Math.PI)
    }
    expect(unitCircleView(270 * DEG).wrapped).toBeCloseTo(-90 * DEG, 12)
    expect(unitCircleView(360 * DEG).turns).toBeCloseTo(1, 12)
    expect([unitCircleView(45 * DEG), unitCircleView(135 * DEG), unitCircleView(225 * DEG), unitCircleView(-45 * DEG)].map((u) => u.quadrant)).toEqual([1, 2, 3, 4])
    expect(quadrantOf(0, 1)).toBe(0)
  })
})

describe('atan2', () => {
  it('atan(y/x) is right in quadrants I and IV, off by 180° in II and III, undefined at x = 0', () => {
    const at = (deg: number) => bearingView(Math.cos(deg * DEG), Math.sin(deg * DEG), 0)
    expect(at(40).naiveOff).toBeCloseTo(0, 12)
    expect(at(-60).naiveOff).toBeCloseTo(0, 12)
    expect(Math.abs(at(130).naiveOff!)).toBeCloseTo(Math.PI, 12)
    expect(Math.abs(at(-120).naiveOff!)).toBeCloseTo(Math.PI, 12)
    expect(at(130).bearing).toBeCloseTo(130 * DEG, 12)
    expect(atanNaive(1, 0)).toBeNull()
    expect(bearingView(0, 1, 0).bearing).toBeCloseTo(Math.PI / 2, 12)
  })

  it('the heading error wraps to the short way round', () => {
    const v = bearingView(-1, -0.1, 170 * DEG)
    expect(v.raw).toBeLessThan(-Math.PI)
    expect(v.error).toBeCloseTo(wrapPi(v.bearing - 170 * DEG), 12)
    expect(v.wrapped).toBe(true)
    expect(v.side).toBe('left')
    expect(bearingView(1, -1, 0).side).toBe('right')
  })

  it('IMU tilt is atan2 of gravity components', () => {
    const p = 25 * DEG
    expect(accelPitch([Math.sin(p), 0, Math.cos(p)])).toBeCloseTo(p, 12)
  })
})

describe('law of cosines', () => {
  it('angles of a 3-4-5 triangle', () => {
    const t = triangleAngles(3, 4, 5)
    expect(t.C).toBeCloseTo(Math.PI / 2, 12)
    expect(t.A + t.B + t.C).toBeCloseTo(Math.PI, 12)
    expect(t.valid).toBe(true)
    expect(triangleAngles(1, 1, 3).valid).toBe(false)
  })

  it('elbow angle matches two-link IK: tip on target, q2 = ±(π − C)', () => {
    for (const elbow of ['up', 'down'] as const) {
      const v = elbowView(0.12, 0.09, 0.15, 0.7, elbow)
      expect(v.reachable).toBe(true)
      expect(Math.abs(v.q[1])).toBeCloseTo(Math.PI - v.C, 9)
      v.tip.forEach((x, i) => expect(x).toBeCloseTo(v.target[i], 9))
      twoLinkTip(0.12, 0.09, v.q[0], v.q[1]).forEach((x, i) => expect(x).toBeCloseTo(v.tip[i], 12))
      expect(0.15 ** 2).toBeCloseTo(0.12 ** 2 + 0.09 ** 2 - 2 * 0.12 * 0.09 * Math.cos(v.C), 12)
    }
    const up = elbowView(0.12, 0.09, 0.15, 0, 'up')
    expect(up.elbowAt[1]).toBeGreaterThan(0)
    expect(elbowView(0.12, 0.09, 0.15, 0, 'down').elbowAt[1]).toBeLessThan(0)
  })

  it('out of reach: |cos C| > 1, the arm stretches toward the target', () => {
    const far = elbowView(0.12, 0.09, 0.25, 0.3, 'up')
    expect(far.reachable).toBe(false)
    expect(far.cosC).toBeLessThan(-1)
    expect(far.C).toBeCloseTo(Math.PI, 6)
    expect(far.miss).toBeCloseTo(0.04, 9)
    expect(elbowView(0.12, 0.09, 0.02, 0.3, 'up').cosC).toBeGreaterThan(1)
  })
})
