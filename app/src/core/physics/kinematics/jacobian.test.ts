import { symEig } from '../control/linalg'
import { SERVO_ARM, twoLinkTip } from './chain'
import { armJacobian, handVelocity, isSingular, jointTorques, manipulability, planarJacobian, resolvedRateRun, twoLinkDet } from './jacobian'

test('symEig: hand-worked 2×2 and a diagonal 3×3', () => {
  const e = symEig([[2, 1], [1, 2]])
  expect(e.values[0]).toBeCloseTo(3, 12)
  expect(e.values[1]).toBeCloseTo(1, 12)
  expect(Math.abs(e.vectors[0][0])).toBeCloseTo(Math.SQRT1_2, 12)
  expect(e.vectors[0][0] * e.vectors[0][1]).toBeGreaterThan(0)
  const d = symEig([[1, 0, 0], [0, 5, 0], [0, 0, 3]])
  expect(d.values).toEqual([5, 3, 1])
  const a = [[4, 1, 2], [1, 3, 0], [2, 0, 5]]
  const s = symEig(a)
  s.vectors.forEach((v, i) => a.forEach((r, k) => expect(r.reduce((t, x, j) => t + x * v[j], 0)).toBeCloseTo(s.values[i] * v[k], 9)))
})

test('two-link: velocity, torques, det and the ellipse by hand', () => {
  const [l1, l2] = [1, 1]
  const J = planarJacobian([l1, l2], [0, Math.PI / 2])
  // hand at (1, 1): J = [[-1, -1], [1, 0]]
  expect(J[0][0]).toBeCloseTo(-1, 12)
  expect(J[0][1]).toBeCloseTo(-1, 12)
  expect(J[1][0]).toBeCloseTo(1, 12)
  expect(J[1][1]).toBeCloseTo(0, 12)
  expect(handVelocity(J, [1, 0])).toEqual([-1, 1])
  expect(jointTorques(J, [0, -10]).map((x) => +x.toFixed(9))).toEqual([-10, 0])
  expect(twoLinkDet(l1, l2, Math.PI / 2)).toBe(1)
  const m = manipulability(J)
  // J·Jᵀ = [[2, -1], [-1, 1]]: λ = (3 ± √5)/2
  expect(m.sigma[0]).toBeCloseTo(Math.sqrt((3 + Math.sqrt(5)) / 2), 9)
  expect(m.sigma[1]).toBeCloseTo(Math.sqrt((3 - Math.sqrt(5)) / 2), 9)
  expect(m.w).toBeCloseTo(1, 9)
  expect(isSingular(J)).toBe(false)
})

test('straight arm: rank drops, the ellipse flattens, a push along the arm needs no torque', () => {
  const J = planarJacobian([0.3, 0.2], [0.4, 0])
  const m = manipulability(J)
  expect(m.sigma[1]).toBeLessThan(1e-7)
  expect(m.w).toBeLessThan(1e-7)
  expect(m.cond).toBeGreaterThan(1e6)
  expect(isSingular(J)).toBe(true)
  const along = [Math.cos(0.4), Math.sin(0.4)]
  jointTorques(J, along).forEach((t) => expect(t).toBeCloseTo(0, 12))
  const ax = m.axes[0]
  expect(Math.abs(ax[0] * along[0] + ax[1] * along[1])).toBeLessThan(1e-9)
  const S = manipulability(armJacobian(SERVO_ARM, [0.3, 0.5, 0, 0]))
  expect(S.sigma).toHaveLength(3)
  expect(S.sigma[2]).toBeLessThan(1e-7)
  expect(manipulability(armJacobian(SERVO_ARM, [0.3, 0.5, 0.8, -0.4])).sigma[2]).toBeGreaterThan(0.01)
})

test('resolved rate: on time inside, joint-speed limited and stuck at full stretch', () => {
  const l: [number, number] = [0.3, 0.22]
  const easy = resolvedRateRun(l, [0.3, 1.2], [0.02, 0], 1, 10)
  const a = easy[0].tip
  const b = easy[easy.length - 1].tip
  expect(b[0] - a[0]).toBeCloseTo(0.02, 3)
  expect(b[1] - a[1]).toBeCloseTo(0, 3)
  expect(easy.every((f) => f.scale === 1)).toBe(true)
  const q0 = [0.2, 1.0]
  const tip = twoLinkTip(l[0], l[1], q0[0], q0[1])
  const out = [tip[0] / Math.hypot(...tip), tip[1] / Math.hypot(...tip)].map((x) => x * 0.1)
  const run = resolvedRateRun(l, q0, out, 6, 1)
  const last = run[run.length - 1]
  expect(run.some((f) => f.scale < 1)).toBe(true)
  expect(last.stuck).toBe(true)
  expect(Math.hypot(...last.tip)).toBeCloseTo(0.52, 3)
  run.forEach((f) => f.qd.forEach((x) => expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9)))
})
