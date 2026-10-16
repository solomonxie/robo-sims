import { DEG } from '../common'
import { SERVO_ARM, armFk, planarArm, planarFk, toolOf, twoLinkTip } from './chain'
import { ikIterate, poseGroups, servoArmIk, twoLinkIk } from './ik'
import { armJacobian, planarJacobian } from './jacobian'

const close = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))

test('two-link IK round-trips through FK, both elbows', () => {
  const [l1, l2] = [0.3, 0.22]
  for (const [x, y] of [[0.35, 0.2], [-0.1, 0.4], [0.2, -0.15], [0.09, 0]]) {
    const s = twoLinkIk(l1, l2, x, y)
    expect(s.reachable).toBe(true)
    close(twoLinkTip(l1, l2, ...s.up), [x, y])
    close(twoLinkTip(l1, l2, ...s.down), [x, y])
    expect(s.up[1]).toBeLessThanOrEqual(0)
    expect(s.down[1]).toBeGreaterThanOrEqual(0)
    expect(s.up[1]).toBeCloseTo(-s.down[1], 12)
  }
  close(twoLinkIk(1, 1, 1, 1).down, [0, Math.PI / 2])
})

test('two-link IK: out of reach aims at the nearest ring point, edges collapse to one solution', () => {
  const far = twoLinkIk(0.3, 0.2, 0.6, 0.8)
  expect(far.reachable).toBe(false)
  expect(far.cos2).toBeGreaterThan(1)
  close(far.aim, [0.3, 0.4])
  close(far.up, far.down)
  close(twoLinkTip(0.3, 0.2, ...far.up), [0.3, 0.4])
  const near = twoLinkIk(0.3, 0.2, 0.02, 0)
  expect(near.reachable).toBe(false)
  close(twoLinkTip(0.3, 0.2, ...near.down), [0.1, 0])
  close(twoLinkIk(0.3, 0.2, 0.5, 0).up, [0, 0])
  const origin = twoLinkIk(0.2, 0.2, 0, 0)
  expect(origin.reachable).toBe(true)
  close(twoLinkTip(0.2, 0.2, ...origin.up), [0, 0])
})

test('servo arm IK: every branch round-trips, only the front ones fit the servos', () => {
  const target: [number, number, number] = [0.15, 0.1, 0.12]
  const pitch = -30 * DEG
  const s = servoArmIk(target, pitch)
  expect(s.reachable).toBe(true)
  expect(s.solutions).toHaveLength(4)
  for (const sol of s.solutions) {
    const f = armFk(SERVO_ARM, sol.q)
    close(toolOf(f), target)
    const x = f[4]
    const dir = [x[0], x[4], x[8]]
    expect(Math.asin(dir[2])).toBeCloseTo(pitch, 9)
  }
  expect(s.solutions.filter((x) => x.inLimits).every((x) => !x.flip)).toBe(true)
  expect(s.solutions.find((x) => !x.flip && x.elbow === 'up')!.inLimits).toBe(true)
  for (const flip of [false, true]) {
    const [up, down] = (['up', 'down'] as const).map((e) => s.solutions.find((x) => x.flip === flip && x.elbow === e)!)
    expect(armFk(SERVO_ARM, up.q)[2][11]).toBeGreaterThan(armFk(SERVO_ARM, down.q)[2][11])
  }
  // No shoulder offset: the flipped base redraws the same two shapes.
  expect(poseGroups(SERVO_ARM, s.solutions.map((x) => x.q))).toEqual([[0, 2], [1, 3]])
  expect(poseGroups(SERVO_ARM, servoArmIk([0.5, 0, 0.1], 0).solutions.map((x) => x.q))).toEqual([[0, 1, 2, 3]])
  close(servoArmIk([0.31, 0, 0.08], 0).solutions[0].q, [0, 0, 0, 0])
  const out = servoArmIk([0.5, 0, 0.1], 0)
  expect(out.reachable).toBe(false)
})

test('Jacobians match finite differences', () => {
  const L = [0.25, 0.2, 0.15]
  const q = [0.4, -0.7, 1.1]
  const h = 1e-6
  const J = planarJacobian(L, q)
  q.forEach((_, i) => {
    const qp = q.map((v, k) => v + (k === i ? h : 0))
    const a = planarFk(L, q).points[3]
    const b = planarFk(L, qp).points[3]
    expect(J[0][i]).toBeCloseTo((b[0] - a[0]) / h, 5)
    expect(J[1][i]).toBeCloseTo((b[1] - a[1]) / h, 5)
  })
  const qs = [0.3, 0.9, -0.6, 0.4]
  const J3 = armJacobian(SERVO_ARM, qs)
  qs.forEach((_, i) => {
    const a = toolOf(armFk(SERVO_ARM, qs))
    const b = toolOf(armFk(SERVO_ARM, qs.map((v, k) => v + (k === i ? h : 0))))
    for (let r = 0; r < 3; r++) expect(J3[r][i]).toBeCloseTo((b[r] - a[r]) / h, 5)
  })
  close(armJacobian(planarArm(L), q).slice(0, 2).flat(), J.flat())
})

test('Jacobian iteration converges, stalls at the edge, survives singular starts', () => {
  const L = [0.25, 0.2, 0.15]
  const fk = (q: readonly number[]) => planarFk(L, q).points[3]
  const jac = (q: readonly number[]) => planarJacobian(L, q)
  const q0 = [0.5, 0.6, 0.4]
  for (const method of ['dls', 'transpose'] as const) {
    const run = ikIterate(fk, jac, [0.3, 0.25], q0, { method, lambda: 0.02, iters: 300 })
    const last = run[run.length - 1]
    expect(last.err).toBeLessThan(1e-4)
    close(fk(last.q), [0.3, 0.25], 3)
  }
  const dls = ikIterate(fk, jac, [0.3, 0.25], q0, { lambda: 0.02 }).length
  const tr = ikIterate(fk, jac, [0.3, 0.25], q0, { method: 'transpose', iters: 300 }).length
  expect(dls).toBeLessThan(tr)
  for (const o of [{ method: 'transpose' as const }, { lambda: 0.1 }]) {
    const far = ikIterate(fk, jac, [0.7, 0.1], q0, { ...o, iters: 200 })
    expect(far[far.length - 1].err).toBeCloseTo(Math.hypot(0.7, 0.1) - 0.6, 3)
  }
  const stuck = ikIterate(fk, jac, [0.4, 0.2], [0, 0, 0], { lambda: 0, iters: 20 })
  expect(stuck.every((s) => s.q.every((v) => v === 0))).toBe(true)
  const damped = ikIterate(fk, jac, [0.4, 0.2], [0, 0, 0], { lambda: 0.05, iters: 100 })
  expect(damped[damped.length - 1].err).toBeLessThan(1e-4)
})
