import { DEG } from '../common'
import { apply4, invert4, mul4 } from '../software/urdf'
import { SERVO_ARM, armFk, dhTf, dhJointTf, planarArm, planarFk, toolOf, twoLinkTip } from './chain'
import { axisOf, chain4, originOf, rotAbout4, trans4 } from './transforms'

const close = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))

test('DH matrix is Rot z · Trans z · Trans x · Rot x', () => {
  const [a, al, d, th] = [0.3, 0.7, -0.2, 1.1]
  close(dhTf(a, al, d, th), chain4(rotAbout4(2, th), trans4([0, 0, d]), trans4([a, 0, 0]), rotAbout4(0, al)))
  close(dhTf(0, 0, 0, 0), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
})

test('two-link arm by hand', () => {
  close(twoLinkTip(1, 1, 0, 0), [2, 0])
  close(twoLinkTip(1, 1, Math.PI / 2, 0), [0, 2])
  close(twoLinkTip(1, 1, 0, Math.PI / 2), [1, 1])
  close(twoLinkTip(0.3, 0.2, 30 * DEG, 60 * DEG), [0.3 * Math.cos(Math.PI / 6), 0.3 * 0.5 + 0.2])
  close(twoLinkTip(1, 1, 0, Math.PI), [0, 0])
})

test('planar chain, closed form and point list agree', () => {
  const L = [0.3, 0.2, 0.1]
  const q = [0.4, -0.9, 0.6]
  const f = armFk(planarArm(L), q)
  expect(f).toHaveLength(4)
  const { points, phi } = planarFk(L, q)
  f.forEach((m, i) => close(originOf(m), [...points[i], 0]))
  close(planarFk(L.slice(0, 2), q).points[2], twoLinkTip(0.3, 0.2, q[0], q[1]))
  expect(phi).toBeCloseTo(0.1, 12)
  close(axisOf(f[3], 0), [Math.cos(phi), Math.sin(phi), 0])
})

test('servo arm by hand', () => {
  close(toolOf(armFk(SERVO_ARM, [0, 0, 0, 0])), [0.31, 0, 0.08])
  close(toolOf(armFk(SERVO_ARM, [0, Math.PI / 2, 0, 0])), [0, 0, 0.39])
  close(toolOf(armFk(SERVO_ARM, [Math.PI / 2, 0, 0, 0])), [0, 0.31, 0.08])
  // Shoulder up, elbow −90°: forearm and hand point straight out along y.
  close(toolOf(armFk(SERVO_ARM, [Math.PI / 2, Math.PI / 2, -Math.PI / 2, 0])), [0, 0.19, 0.2])
  const f = armFk(SERVO_ARM, [0, 0, 0, 0])
  close(axisOf(f[1], 2), [0, -1, 0])
  close(originOf(f[2]), [0.12, 0, 0.08])
})

test('frames chain: each is the previous times A(i)', () => {
  const q = [0.3, 1.0, -0.8, 0.4]
  const f = armFk(SERVO_ARM, q)
  for (let i = 1; i < f.length; i++) close(mul4(invert4(f[i - 1]), f[i]), dhJointTf(SERVO_ARM.rows[i - 1], q[i - 1]))
  const p = apply4(f[4], [0, 0, 0])
  expect(Math.hypot(p[0], p[1])).toBeGreaterThan(0)
})

test('prismatic joint adds to d', () => {
  const arm = { ...planarArm([0.2]), rows: [{ a: 0, alpha: 0, d: 0.1, theta: 0, kind: 'prismatic' as const }] }
  close(toolOf(armFk(arm, [0.05])), [0, 0, 0.15])
})
