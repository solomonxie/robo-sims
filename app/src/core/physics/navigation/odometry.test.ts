import { diffStep } from '../mobility/diffdrive'
import { TT_TRACK_M } from '../sensors/encoder'
import { CAL, cloudStats, deadReckonRun, growthRun, odoIntegrate, spinCal, stepNoise, straightCal, wheelsFor } from './odometry'
import { covEllipse, curvatureAt, ellipsePoints, propagateCov, zeroCov } from './pose'

const O = { x: 0, y: 0, th: 0 }

describe('tick integration', () => {
  it('straight: all methods agree', () => {
    for (const m of ['euler', 'midpoint', 'exact'] as const) expect(odoIntegrate(O, 0.1, 0.1, 0.2, m)).toEqual({ x: 0.1, y: 0, th: 0 })
  })
  it('quarter circle R = 1 m in one update', () => {
    // b = 0.2: dL = (π/2)(0.9), dR = (π/2)(1.1) → Δs = π/2, Δθ = π/2
    const [dL, dR] = [(Math.PI / 2) * 0.9, (Math.PI / 2) * 1.1]
    const ex = odoIntegrate(O, dL, dR, 0.2, 'exact')
    expect(ex.x).toBeCloseTo(1, 9)
    expect(ex.y).toBeCloseTo(1, 9)
    const mid = odoIntegrate(O, dL, dR, 0.2, 'midpoint')
    expect(mid.x).toBeCloseTo((Math.PI / 2) * Math.SQRT1_2, 9) // 1.1107: chord direction right, length = arc
    const eu = odoIntegrate(O, dL, dR, 0.2, 'euler')
    expect(eu.x).toBeCloseTo(Math.PI / 2, 9)
    expect(eu.y).toBe(0)
    expect(eu.th).toBeCloseTo(Math.PI / 2, 9)
  })
  it('exact arc = diffStep', () => {
    const p = { x: 0.3, y: -0.2, th: 1 }
    const a = odoIntegrate(p, 0.05, 0.08, TT_TRACK_M, 'exact')
    const b = diffStep(p, 0.05, 0.08, TT_TRACK_M, 1)
    expect(a.x).toBeCloseTo(b.x, 12)
    expect(a.y).toBeCloseTo(b.y, 12)
  })
  it('wheel speeds for a curvature', () => {
    expect(wheelsFor(1, 2, 0.2)).toEqual([0.8, 1.2])
  })
})

describe('dead reckoning run', () => {
  it('fine ticks + exact arcs ≈ truth; Euler at 1 Hz is worst', () => {
    const exact = deadReckonRun(100, 2112, 'exact')
    expect(exact.maxErr).toBeLessThan(0.003)
    const eu = deadReckonRun(1, 2112, 'euler').maxErr
    const mid = deadReckonRun(1, 2112, 'midpoint').maxErr
    expect(eu).toBeGreaterThan(0.1) // circle offset ≈ R·Δθ/2 = 0.4 · 0.75/2 = 0.15 m
    expect(mid).toBeLessThan(eu / 3)
    expect(deadReckonRun(1, 2112, 'exact').maxErr).toBeLessThan(mid)
  })
  it('coarse 20-tick wheels cost accuracy', () => {
    expect(deadReckonRun(50, 20, 'exact').maxErr).toBeGreaterThan(deadReckonRun(50, 2112, 'exact').maxErr)
  })
})

describe('covariance', () => {
  it('ellipse of a diagonal and a 45° covariance', () => {
    const e = covEllipse([[4, 0, 0], [0, 1, 0], [0, 0, 0]])
    expect([e.a, e.b, e.angle]).toEqual([4, 2, 0])
    const r = covEllipse([[2.5, 1.5, 0], [1.5, 2.5, 0], [0, 0, 0]], 1) // eigen 4, 1
    expect(r.a).toBeCloseTo(2, 9)
    expect(r.b).toBeCloseTo(1, 9)
    expect(r.angle).toBeCloseTo(Math.PI / 4, 9)
    expect(ellipsePoints(1, 0, e, 4)[0]).toEqual([5, 0])
  })
  it('two straight 1 m steps: lateral variance 2.5 q', () => {
    const q = 0.01
    const Q = [[0.001, 0], [0, q]]
    const P1 = propagateCov(zeroCov(), O, 1, 0, Q)
    expect(P1[1][1]).toBeCloseTo(0.25 * q, 12)
    expect(P1[1][2]).toBeCloseTo(0.5 * q, 12)
    const P2 = propagateCov(P1, { x: 1, y: 0, th: 0 }, 1, 0, Q)
    expect(P2[0][0]).toBeCloseTo(0.002, 12)
    expect(P2[1][1]).toBeCloseTo(2.5 * q, 12) // .25q + 2(.5q) + q + .25q
    expect(P2[2][2]).toBeCloseTo(2 * q, 12)
  })
  it('wheel noise on a straight step', () => {
    const N = stepNoise(0.1, 0.1, 0.01, 0.2, 'wheels', 0.02)
    expect(N[0][0]).toBeCloseTo(0.5e-5, 15) // k²d/2
    expect(N[0][1]).toBe(0)
    expect(N[1][1]).toBeCloseTo(5e-4, 12) // 2k²d/b²
  })
})

describe('error growth', () => {
  it('no noise, no bias: every estimate is the truth', () => {
    const f = growthRun(0, 0, 'wheels', 3).frames.at(-1)!
    expect(Math.hypot(f.bias.x - f.truth.x, f.bias.y - f.truth.y)).toBeLessThan(1e-3)
    expect(f.P[0][0]).toBe(0)
  })
  it('a 1 % tyre turns 0.123 rad over the first 1.6 m', () => {
    const r = growthRun(0, 1, 'wheels', 1)
    const f = r.frames.find((g) => g.t >= 1.6 / 0.3 - 1e-9)!
    expect(f.bias.th - f.truth.th).toBeCloseTo((1.6 * 0.01) / TT_TRACK_M, 2)
  })
  it('Monte Carlo spread matches the Jacobian prediction; a gyro shrinks it', () => {
    const w = growthRun(3, 0, 'wheels', 200).frames.at(-1)!
    const pred = Math.sqrt(w.P[0][0] + w.P[1][1])
    const mc = cloudStats(w.runs).rms
    expect(mc / pred).toBeGreaterThan(0.75)
    expect(mc / pred).toBeLessThan(1.3)
    const g = growthRun(3, 0, 'gyro', 10).frames.at(-1)!
    expect(covEllipse(g.P).a).toBeLessThan(covEllipse(w.P).a / 3)
  })
})

describe('calibration', () => {
  it('straight test recovers the tyre; residual ≈ reading error / distance', () => {
    const exact = straightCal(2, 5, 65, 0)
    expect(exact.realM).toBeCloseTo(5 * 1.02, 3)
    expect(exact.calMm).toBeCloseTo(66.3, 6)
    const r = straightCal(2, 5)
    expect(r.residual).toBeCloseTo(CAL.readMm / 5100, 6) // read error / real distance
    expect(Math.abs(straightCal(2, 1).residual)).toBeGreaterThan(Math.abs(r.residual))
  })
  it('spin test recovers the track', () => {
    const s = spinCal(3, 5, 0.13, 0)
    expect(s.realDeg).toBeCloseTo(1800 / 1.03, 9)
    expect(s.calM).toBeCloseTo(0.1339, 9)
    expect(spinCal(3, 5).residual).toBeCloseTo(-1 / (1800 / 1.03 + 1), 9)
  })
  it('curvature along legs', () => {
    expect(curvatureAt([{ m: 1, turnDeg: 0 }, { m: Math.PI / 2, turnDeg: 90 }], 1.5)).toBeCloseTo(1, 9)
    expect(curvatureAt([{ m: 1, turnDeg: 0 }], 2)).toBe(0)
  })
})
