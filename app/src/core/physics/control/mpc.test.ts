import { DEG } from '../common'
import { fellAt } from '../mobility/balance'
import { matInv, matMul } from './lqr'
import { boxQp, cholSolve, mpcDesign, mpcRun, mpcSolve, predict } from './mpc'

const TOL = { pos: 0.1, speed: 0.5, tilt: 5 * DEG, rate: 50 * DEG, effort: 3 }
const step = (t: number) => (t >= 0.5 ? 0.3 : 0)
const BIG = 1e9

test('Cholesky solve matches the inverse', () => {
  const H = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]]
  const b = [1, -2, 0.5]
  const want = matMul(matInv(H), b.map((x) => [x])).map((r) => r[0])
  cholSolve(H, b).forEach((x, i) => expect(x).toBeCloseTo(want[i], 12))
})

test('box QP: unconstrained, one bound active by hand, and KKT on random problems', () => {
  const H = [[2, 0.5], [0.5, 1]]
  const free = boxQp(H, [-1, -1], [-BIG, -BIG], [BIG, BIG])
  const want = matMul(matInv(H), [[1], [1]])
  expect(free.u[0]).toBeCloseTo(want[0][0], 10)
  expect(free.active).toBe(0)
  // u₀ ≤ 0.1 binds: then u₁ = (1 − 0.5·0.1)/1 = 0.95; gradient on u₀ = 2·0.1 + 0.5·0.95 − 1 < 0 (pushes up), so the bound holds.
  const cut = boxQp(H, [-1, -1], [-BIG, -BIG], [0.1, BIG])
  expect(cut.u[0]).toBeCloseTo(0.1, 12)
  expect(cut.u[1]).toBeCloseTo(0.95, 12)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let trial = 0; trial < 30; trial++) {
    const n = 6
    const M = Array.from({ length: n }, () => Array.from({ length: n }, rnd))
    const Hr = matMul(M, M[0].map((_, j) => M.map((r) => r[j]))).map((r, i) => r.map((x, j) => x + (i === j ? 0.1 : 0)))
    const f = Array.from({ length: n }, () => 3 * rnd())
    const lo = Array(n).fill(-0.5)
    const hi = Array(n).fill(0.5)
    const r = boxQp(Hr, f, lo, hi)
    expect(r.converged).toBe(true)
    r.u.forEach((u, i) => {
      const g = Hr[i].reduce((s, h, j) => s + h * r.u[j], f[i])
      expect(u).toBeGreaterThanOrEqual(-0.5 - 1e-12)
      expect(u).toBeLessThanOrEqual(0.5 + 1e-12)
      if (u > -0.5 + 1e-9 && u < 0.5 - 1e-9) expect(Math.abs(g)).toBeLessThan(1e-7)
      else expect(g * Math.sign(u)).toBeLessThanOrEqual(1e-7)
    })
  }
})

test('with the LQR cost-to-go as the tail and no active limits, the first move is exactly −K·x, for any horizon', () => {
  const x0 = [0.05, -0.2, 3 * DEG, -0.4, 1.5]
  for (const N of [1, 4, 25]) {
    const d = mpcDesign({ horizon: N, ts: 0.02, tol: TOL, tail: true })
    const r = mpcSolve(d, x0, Array(N).fill(0), Array(N).fill(-BIG), Array(N).fill(BIG))
    expect(r.u[0]).toBeCloseTo(-d.K.reduce((s, k, i) => s + k * x0[i], 0), 8)
  }
})

test('predict rolls the discrete model forward', () => {
  const d = mpcDesign({ horizon: 3, ts: 0.02, tol: TOL, tail: true })
  const x = predict(d, [0, 0, 0, 0, 0], [5, 5, 5])
  expect(x[2][1]).toBeGreaterThan(0)
  expect(x[2][2]).toBeLessThan(0)
})

test('receding horizon: short plans without a tail fall, the LQR tail rescues even 3 steps, a long plan alone also works', () => {
  const run = (horizon: number, tail: boolean) => mpcRun({ design: mpcDesign({ horizon, ts: 0.02, tol: TOL, tail }), seconds: 7, target: step }).frames
  expect(fellAt(run(5, false))).not.toBeNull()
  const short = run(3, true)
  expect(fellAt(short)).toBeNull()
  expect(short.at(-1)!.x).toBeCloseTo(0.3, 2)
  const long = run(30, false)
  expect(fellAt(long)).toBeNull()
  expect(Math.abs(long.at(-1)!.x - 0.3)).toBeLessThan(0.02)
})

test('preview: MPC starts the move before the target jumps', () => {
  const d = mpcDesign({ horizon: 30, ts: 0.02, tol: TOL, tail: true })
  const seen = mpcRun({ design: d, seconds: 1, target: step }).frames
  const blind = mpcRun({ design: d, seconds: 1, target: step, preview: false }).frames
  expect(Math.abs(seen[95].x)).toBeGreaterThan(0.005)
  expect(Math.abs(blind[95].x)).toBeLessThan(1e-9)
})

test('constraints: at a 1 cm tolerance clipped LQR falls, MPC plans inside the limits and arrives', () => {
  const d = mpcDesign({ horizon: 30, ts: 0.02, tol: { ...TOL, pos: 0.01 }, tail: true })
  const lqr = mpcRun({ design: d, seconds: 4, target: step, mode: 'lqr', limit: 0.5, preview: false })
  const mpc = mpcRun({ design: d, seconds: 4, target: step, limit: 0.5, preview: false })
  expect(fellAt(lqr.frames)).not.toBeNull()
  expect(fellAt(mpc.frames)).toBeNull()
  expect(mpc.frames.at(-1)!.x).toBeCloseTo(0.3, 2)
  expect(mpc.plans.some((p) => p.active > 0)).toBe(true)
  // With all the torque the plan leaves no reserve for the linear model's error at ~30° and falls too.
  expect(fellAt(mpcRun({ design: d, seconds: 4, target: step, limit: 1, preview: false }).frames)).not.toBeNull()
  for (const p of mpc.plans)
    p.u.forEach((u, i) => {
      expect(u).toBeLessThanOrEqual(p.hi[i] + 1e-9)
      expect(u).toBeGreaterThanOrEqual(p.lo[i] - 1e-9)
    })
})
