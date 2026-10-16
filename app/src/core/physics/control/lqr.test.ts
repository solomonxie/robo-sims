import { DEG } from '../common'
import { BALANCER, fallTau } from '../mobility/balance'
import { balancerLqr, balancerModel, c2d, charPoly, closedPoles, dlqr, eigenvalues, expm, matInv, matMul, stateRun } from './lqr'

const TOL = { pos: 0.1, speed: 0.5, tilt: 5 * DEG, rate: 50 * DEG, effort: 3 }
const lqr = (t = {}) => balancerLqr({ ...TOL, ...t })

test('matrix helpers: inverse, e^M, characteristic polynomial', () => {
  const a = [[4, 7], [2, 6]]
  expect(matMul(a, matInv(a)).flat().map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0, 1])
  const r = expm([[0, 1], [-1, 0]])
  expect(r[0][0]).toBeCloseTo(Math.cos(1), 12)
  expect(r[0][1]).toBeCloseTo(Math.sin(1), 12)
  expect(charPoly([[2, 0], [0, 3]])).toEqual([6, -5, 1])
  expect(eigenvalues(balancerModel().A).map((z) => z.re).sort((x, y) => x - y)[3]).toBeCloseTo(1 / fallTau(BALANCER.h), 6)
})

test('scalar discrete Riccati matches the closed form', () => {
  const [a, b, q, r] = [1.2, 0.5, 2, 0.3]
  const res = dlqr([[a]], [[b]], [[q]], [[r]])
  const c1 = r - q * b * b - a * a * r
  const P = (-c1 + Math.sqrt(c1 * c1 + 4 * b * b * q * r)) / (2 * b * b)
  expect(res.converged).toBe(true)
  expect(res.P[0][0]).toBeCloseTo(P, 9)
  expect(res.K[0][0]).toBeCloseTo((a * b * P) / (r + b * b * P), 9)
})

test('double integrator tends to the continuous LQR gains as dt → 0', () => {
  const { Ad, Bd } = c2d([[0, 1], [0, 0]], [[0], [1]], 0.001)
  const [q1, q2, r] = [4, 1, 1]
  const { K } = dlqr(Ad, Bd, [[q1, 0], [0, q2]], [[r]])
  expect(K[0][0]).toBeCloseTo(Math.sqrt(q1 / r), 2)
  expect(K[0][1]).toBeCloseTo(Math.sqrt(q2 / r + 2 * Math.sqrt(q1 / r)), 2)
})

test('LQR stabilises the balancer; tilt-only gains leave position adrift', () => {
  const r = lqr()
  expect(r.converged).toBe(true)
  expect(r.poles.every((p) => p.re < -0.5)).toBe(true)
  const tiltOnly = closedPoles([0, 0, r.k[2], r.k[3]])
  expect(tiltOnly.filter((p) => Math.abs(p.re) < 1e-6 && Math.abs(p.im) < 1e-6)).toHaveLength(2)
  const push = [{ at: 0.2, kick: 1 }]
  const full = stateRun({ k: r.k, seconds: 6, pushes: push })
  const tilt = stateRun({ k: [0, 0, r.k[2], r.k[3]], seconds: 6, pushes: push })
  expect(Math.abs(full.at(-1)!.x)).toBeLessThan(0.01)
  expect(Math.abs(tilt.at(-1)!.v)).toBeGreaterThan(0.05)
  expect(tilt.some((f) => f.fallen)).toBe(false)
})

test('a forward move starts by rolling back (non-minimum phase), then arrives', () => {
  const run = stateRun({ k: lqr().k, seconds: 6, target: (t) => (t >= 0.5 ? 0.3 : 0) })
  expect(Math.min(...run.map((f) => f.x))).toBeLessThan(-0.005)
  expect(run.at(-1)!.x).toBeCloseTo(0.3, 2)
})

test('costlier effort → gentler, slower; tighter tilt → less lean', () => {
  const [cheap, dear] = [lqr({ effort: 10 }), lqr({ effort: 1 })]
  expect(Math.abs(dear.k[0])).toBeLessThan(Math.abs(cheap.k[0]))
  const peak = (k: number[]) => Math.max(...stateRun({ k, seconds: 4, target: () => 0.3 }).map((f) => Math.abs(f.cmd)))
  expect(peak(dear.k)).toBeLessThan(peak(cheap.k))
  const lean = (k: number[]) => Math.max(...stateRun({ k, seconds: 6, target: () => 0.3 }).map((f) => Math.abs(f.tilt)))
  expect(lean(lqr({ tilt: 1 * DEG }).k)).toBeLessThan(lean(lqr({ tilt: 20 * DEG }).k))
})

test('demanding 1 cm accuracy on a 0.3 m move saturates the motors and it falls', () => {
  const run = stateRun({ k: lqr({ pos: 0.01 }).k, seconds: 3, target: () => 0.3 })
  expect(run.some((f) => f.sat)).toBe(true)
  expect(run.some((f) => f.fallen)).toBe(true)
})
