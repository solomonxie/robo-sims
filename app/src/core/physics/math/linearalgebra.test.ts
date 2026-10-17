import { DEG } from '../common'
import { eigenvalues } from '../control/linalg'
import { Mat2, apply2, rotMat2 } from './matrices'
import { MOTOR_CAL, eig2, eigenView, leastSquaresView, lineNormalEq, motorCalPoints, repeatMap, sumSquares, turnOf, wallPca } from './linearalgebra'

describe('least squares', () => {
  it('normal equations recover an exact line', () => {
    const xs = [0, 1, 2, 3]
    const N = lineNormalEq(xs, xs.map((x) => 2 * x - 1))
    expect(N.AtA).toEqual([14, 6, 6, 4])
    expect(N.Atb).toEqual([22, 8])
    expect(N.m).toBeCloseTo(2, 9)
    expect(N.c).toBeCloseTo(-1, 9)
  })
  it('singular when all x are equal', () => {
    expect(lineNormalEq([1, 1, 1], [0, 1, 2]).inv).toBeNull()
  })
  it('noise-free calibration gives the true motor line', () => {
    const V = leastSquaresView(0, 0, 0)
    expect(V.fit.m).toBeCloseTo(MOTOR_CAL.m, 9)
    expect(V.fit.c).toBeCloseTo(MOTOR_CAL.c, 9)
    expect(V.best).toBeCloseTo(0, 12)
    expect(V.deadband).toBeCloseTo(-MOTOR_CAL.c / MOTOR_CAL.m, 9)
  })
  it('the best line minimises the sum of squares and the parabola matches', () => {
    const V = leastSquaresView(0.03, 1, 0)
    expect(V.sse).toBeCloseTo(V.best, 12)
    for (const dm of [-0.2, -0.01, 0.01, 0.2]) expect(sumSquares(V.xs, V.ys, V.fit.m + dm, V.fit.c)).toBeGreaterThan(V.best)
    const T = leastSquaresView(0.03, 1, 0.15)
    expect(T.sse).toBeCloseTo(T.sseAt(T.trial.m), 9)
    expect(T.residuals.reduce((s, r) => s + r, 0)).toBeCloseTo(0, 9)
  })
  it('slipped readings drag the slope down; the clean fit stays near the truth', () => {
    const V = leastSquaresView(0.02, 2, 0)
    expect(V.bad).toEqual([2, 7])
    expect(V.pull).toBeLessThan(-0.03)
    expect(Math.abs(V.clean.m - MOTOR_CAL.m)).toBeLessThan(0.06)
  })
  it('readings are repeatable (seeded)', () => {
    expect(motorCalPoints(0.03, 0).ys).toEqual(motorCalPoints(0.03, 0).ys)
  })
})

describe('eigenvectors', () => {
  const check = (M: Mat2) => {
    const E = eig2(M)
    E.vectors.forEach((v, i) => {
      const w = apply2(M, v)
      expect(w[0]).toBeCloseTo(E.values[i] * v[0], 9)
      expect(w[1]).toBeCloseTo(E.values[i] * v[1], 9)
      expect(Math.hypot(...v)).toBeCloseTo(1, 9)
    })
    return E
  }
  it('symmetric matrix: real λ, perpendicular vectors, same λ as control/linalg', () => {
    const E = check([1.4, 0.4, 0.4, 0.8])
    expect(E.real).toBe(true)
    const ref = eigenvalues([[1.4, 0.4], [0.4, 0.8]]).map((c) => c.re).sort((a, b) => b - a)
    expect(E.values[0]).toBeCloseTo(ref[0], 6)
    expect(E.values[1]).toBeCloseTo(ref[1], 6)
    expect(E.vectors[0][0] * E.vectors[1][0] + E.vectors[0][1] * E.vectors[1][1]).toBeCloseTo(0, 9)
  })
  it('shear: x axis is an eigenvector, the other is not perpendicular', () => {
    const E = check([1.2, 0.5, 0, 0.6])
    expect(E.values).toEqual([1.2, 0.6].map((v) => expect.closeTo(v, 9)))
    expect(Math.abs(E.vectors[0][1])).toBeLessThan(1e-9)
    expect(Math.abs(E.vectors[1][0])).toBeGreaterThan(0.1)
  })
  it('scalar matrix: every direction, two independent vectors', () => {
    const E = check([2, 0, 0, 2])
    expect(E.vectors).toEqual([[1, 0], [0, 1]])
  })
  it('rotation has no real eigenvectors; |λ| = scale', () => {
    const R = rotMat2(35 * DEG).map((v) => v * 0.9) as Mat2
    const E = eig2(R)
    expect(E.real).toBe(false)
    expect(E.radius).toBeCloseTo(0.9, 9)
    expect(Math.atan2(E.im, E.re)).toBeCloseTo(35 * DEG, 9)
  })
  it('probe along an eigenvector does not turn; elsewhere it does', () => {
    const M: Mat2 = [1.4, 0.4, 0.4, 0.8]
    const V = eigenView(M, 0.3)
    const a = V.eigenAngles[0]
    expect(turnOf(M, a).turn).toBeCloseTo(0, 9)
    expect(turnOf(M, a).stretch).toBeCloseTo(V.E.values[0], 9)
    expect(Math.abs(turnOf(M, a + 0.5).turn)).toBeGreaterThan(0.01)
    expect(V.nearest).toBeCloseTo(Math.abs(0.3 - a), 9)
  })
  it('repeated maps shrink when every |λ| < 1 and line up with the top eigenvector', () => {
    const M: Mat2 = [0.9, 0.2, 0.05, 0.6]
    const V = eigenView(M, 2, 40)
    expect(V.stable).toBe(true)
    const last = V.iterates[40]
    expect(Math.hypot(...last)).toBeLessThan(0.1)
    const u = Math.hypot(...last)
    expect(Math.abs(last[0] * V.E.vectors[0][1] - last[1] * V.E.vectors[0][0]) / u).toBeLessThan(1e-3)
    expect(eigenView(M.map((v) => v * 1.3) as Mat2, 2).stable).toBe(false)
    expect(repeatMap(M, [1, 0], 2)).toHaveLength(3)
  })
})

describe('PCA of a lidar wall', () => {
  it('top eigenvector follows the wall and spreads match its length and noise', () => {
    for (const deg of [0, 30, 100, 170]) {
      const W = wallPca(deg * DEG)
      expect(Math.abs(W.fitted - deg * DEG)).toBeLessThan(2 * DEG)
      expect(W.along).toBeGreaterThan(0.3)
      expect(W.across).toBeLessThan(0.04)
    }
  })
  it('recomputes fast enough for a slider', () => {
    const times = Array.from({ length: 5 }, () => {
      const t0 = performance.now()
      for (let i = 0; i < 20; i++) {
        leastSquaresView(0.03, 2, i * 0.01)
        eigenView([1.4, 0.4, 0.4, 0.8], i * 0.1)
        wallPca(i * 0.1)
      }
      return (performance.now() - t0) / 20
    }).sort((a, b) => a - b)
    expect(times[2]).toBeLessThan(20)
  })
})
