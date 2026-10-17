import { medianMs } from '../../stopwatch'
import { matInv, matMul } from '../control/linalg'
import { applyTf2, invertTf2, tf2 } from '../kinematics/transforms'
import { I2, Mat2, apply2, close2, composeView, det2, inv2, inverseView, mul2, rotMat2, rotationCheck, scaleMat2, shearMat2, transpose2 } from './matrices'

const toMat = (M: Mat2) => [
  [M[0], M[1]],
  [M[2], M[3]],
]
const fromMat = (m: number[][]): Mat2 => [m[0][0], m[0][1], m[1][0], m[1][1]]

describe('rotation matrix', () => {
  it('columns are where x and y land, unit length, square, det 1', () => {
    for (const th of [0, 0.4, 2, -2.9]) {
      const R = rotMat2(th)
      const c = rotationCheck(R)
      apply2(R, [1, 0]).forEach((v, i) => expect(v).toBeCloseTo(c.x[i], 12))
      apply2(R, [0, 1]).forEach((v, i) => expect(v).toBeCloseTo(c.y[i], 12))
      expect(c.rotation).toBe(true)
      expect(c.det).toBeCloseTo(1, 12)
      expect(c.angle).toBeCloseTo(th, 12)
      expect(close2(c.RtR, I2)).toBe(true)
    }
  })

  it('a stretch breaks unit length, a mirror flips det', () => {
    const s = rotationCheck(mul2(rotMat2(0.5), scaleMat2(1.5, 1)))
    expect(s.orthonormal).toBe(false)
    expect(s.lenX).toBeCloseTo(1.5, 12)
    const m = rotationCheck(mul2(rotMat2(0.5), scaleMat2(1, -1)))
    expect(m.orthonormal).toBe(true)
    expect(m.mirror).toBe(true)
    expect(m.det).toBeCloseTo(-1, 12)
  })
})

describe('matrix multiply', () => {
  it('agrees with linalg and composes: (AB)p = A(Bp)', () => {
    const A = rotMat2(0.7)
    const B = shearMat2(0.8)
    const { AB, BA, term } = composeView(A, B)
    expect(close2(AB, fromMat(matMul(toMat(A), toMat(B))))).toBe(true)
    const p = [0.3, -0.6]
    const q = apply2(A, apply2(B, p))
    apply2(AB, p).forEach((v, i) => expect(v).toBeCloseTo(q[i], 12))
    const t = term(1, 0)
    expect(t.row[0] * t.col[0] + t.row[1] * t.col[1]).toBeCloseTo(AB[2], 12)
    expect(close2(AB, BA)).toBe(false)
  })

  it('rotations commute with each other and with a uniform scale, not with a stretch', () => {
    expect(composeView(rotMat2(0.3), rotMat2(1.1)).commute).toBe(true)
    expect(close2(mul2(rotMat2(0.3), rotMat2(1.1)), rotMat2(1.4))).toBe(true)
    expect(composeView(rotMat2(0.3), scaleMat2(2)).commute).toBe(true)
    expect(composeView(rotMat2(0.3), scaleMat2(2, 1)).gap).toBeGreaterThan(0.1)
  })

  it('matches chaining planar poses robot → world → camera', () => {
    const W = tf2(1, 0.5, 0.6)
    const p = applyTf2(W, [0.4, 0.2])
    const back = applyTf2(invertTf2(W), p)
    expect(back[0]).toBeCloseTo(0.4, 12)
    expect(back[1]).toBeCloseTo(0.2, 12)
  })
})

describe('inverse', () => {
  it('undoes M, agrees with linalg, rotation inverse = transpose', () => {
    const M = mul2(rotMat2(0.9), [1, 0.5, 0, 0.6])
    const V = inverseView(M)
    expect(close2(V.check!, I2)).toBe(true)
    expect(close2(V.inv!, fromMat(matInv(toMat(M))))).toBe(true)
    expect(V.area).toBeCloseTo(0.6, 12)
    expect(close2(inv2(rotMat2(1.2))!, transpose2(rotMat2(1.2)))).toBe(true)
    expect(inverseView(rotMat2(1.2)).isRotation).toBe(true)
  })

  it('det = area scale; det 0 squashes the plane onto a line with no way back', () => {
    const M: Mat2 = [1, 2, 0.5, 1]
    expect(det2(M)).toBe(0)
    const V = inverseView(M)
    expect(V.singular).toBe(true)
    expect(V.check).toBeNull()
    const q = [0.3, 0.2]
    const a = apply2(M, q)
    const b = apply2(M, [q[0] + V.lost[0], q[1] + V.lost[1]])
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12))
    expect(Math.abs(a[0] * V.onto[1] - a[1] * V.onto[0])).toBeLessThan(1e-12)
    expect(inverseView([1, 0, 0, -2]).flips).toBe(true)
  })

  it('computes fast', () => {
    const ms = medianMs(() => {
      for (let i = 0; i < 1e4; i++) inverseView(mul2(rotMat2(i), [1, 0.3, 0, (i % 7) / 3]))
    })
    expect(ms).toBeLessThan(200)
  })
})
