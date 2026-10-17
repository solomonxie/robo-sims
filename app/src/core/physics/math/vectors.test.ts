import { Vec3 } from '../../fields'
import { torqueOf } from '../mechanics/torque'
import { routeOf } from '../navigation/tracking'
import { cross2, crossView, dot3, dotView, faceNormal, polar3, projectionView, splitAlong, vecAngle } from './vectors'

const close3 = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

describe('dot product', () => {
  it('a·b = |a||b|cos θ, and its sign says ahead or behind', () => {
    const a = polar3(2, 0)
    for (const deg of [0, 30, 89, 91, 150, -120]) {
      const b = polar3(1.5, deg)
      const D = dotView(a, b)
      expect(D.dot).toBeCloseTo(3 * Math.cos((deg * Math.PI) / 180), 9)
      expect(D.theta).toBeCloseTo((Math.abs(deg) * Math.PI) / 180, 9)
      expect(D.ahead).toBe(Math.abs(deg) < 90)
    }
    expect(dot3([1, 2, 3], [4, -5, 6])).toBe(12)
  })

  it('along = the shadow of b on a; field of view by comparing cosines', () => {
    const D = dotView(polar3(1, 0), polar3(2, 60), (45 * Math.PI) / 180)
    expect(D.along).toBeCloseTo(1, 9)
    close3(D.shadow, [1, 0, 0])
    expect(D.inView).toBe(false)
    expect(dotView(polar3(1, 0), polar3(2, 40), (45 * Math.PI) / 180).inView).toBe(true)
  })
})

describe('cross product', () => {
  it('right-hand rule: x × y = z, and it flips with order', () => {
    close3(crossView([1, 0, 0], [0, 1, 0]).c, [0, 0, 1])
    close3(crossView([0, 1, 0], [1, 0, 0]).c, [0, 0, -1])
  })

  it('|a×b| = parallelogram area |a||b|sin θ; z sign = turn left or right', () => {
    const C = crossView(polar3(2, 10), polar3(3, 40))
    expect(C.area).toBeCloseTo(6 * 0.5, 9)
    expect(C.turn).toBe('left')
    expect(crossView(polar3(1, 0), polar3(1, -30)).turn).toBe('right')
    expect(crossView(polar3(1, 0), polar3(2, 0)).turn).toBe('straight')
    expect(cross2([1, 0], [0, 1])).toBe(1)
  })

  it('torque r × F matches τ = F r sin θ', () => {
    const C = crossView(polar3(0.2, 0), polar3(10, 70))
    expect(C.z).toBeCloseTo(torqueOf(10, 0.2, (70 * Math.PI) / 180).tau, 9)
  })

  it('normal of a tilted plate from two edges', () => {
    close3(faceNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]), [0, 0, 1])
    const n = faceNormal([0, 0, 0], [1, 0, 0], [0, 1, 1])
    close3(n, [0, -Math.SQRT1_2, Math.SQRT1_2])
  })

  it('angle stays exact near parallel', () => {
    expect(vecAngle([1, 0, 0], [1, 1e-9, 0])).toBeCloseTo(1e-9, 15)
  })
})

describe('projection', () => {
  it('v = along + perp, at right angles', () => {
    const S = splitAlong([3, 4, 0], [2, 0, 0])
    expect(S.k).toBe(3)
    close3(S.perp, [0, 4, 0])
    expect(dot3(S.along, S.perp)).toBeCloseTo(0, 12)
  })

  it('cross-track error and closest point agree with the path tracker', () => {
    const r = routeOf([[0, 0], [1, 0]], false)
    for (const [x, y] of [[0.4, 0.2], [0.7, -0.3], [-0.3, 0.1], [1.4, -0.2]]) {
      const P = projectionView([x, y, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1])
      const F = r.frame(x, y)
      expect(Math.abs(P.side)).toBeCloseTo(x >= 0 && x <= 1 ? Math.abs(F.e) : Math.abs(y), 9)
      expect(P.segDist).toBeCloseTo(Math.abs(F.e), 9)
      expect(P.closest[0]).toBeCloseTo(F.at[0], 9)
      expect(P.clamped).toBe(x < 0 || x > 1)
    }
  })

  it('shadow on a tilted plane: drop along the normal', () => {
    const tilt = Math.PI / 6
    const n: Vec3 = [0, -Math.sin(tilt), Math.cos(tilt)]
    const P = projectionView([0.5, 0.1, 0.4], [0, 0, 0], [1, 0, 0], n)
    expect(dot3(P.shadow, n)).toBeCloseTo(0, 12)
    expect(P.up).toBeCloseTo(dot3([0.5, 0.1, 0.4], n), 12)
    expect(P.lineDist).toBeCloseTo(Math.hypot(0.1, 0.4), 12)
  })
})
