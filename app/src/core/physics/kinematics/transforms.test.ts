import { P3 } from '../room'
import { apply4, invert4, mul4, rotAxis4, tf3 } from '../software/urdf'
import { deskTree, frameLookup, framePath, frameWorld, rootPath } from './frametree'
import {
  applyTf2,
  axisOf,
  chain4,
  invertTf2,
  mulTf2,
  originOf,
  quatAngle,
  quatAxis,
  quatMul,
  quatOf,
  quatTf,
  rotAbout4,
  rotate2,
  rpyOf,
  slerp,
  tf2,
  trans4,
} from './transforms'

const close = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))

test('2D rotation keeps length and turns counter-clockwise', () => {
  close(rotate2(Math.PI / 2, [1, 0]), [0, 1])
  const p = rotate2(0.7, [0.3, -0.4])
  expect(Math.hypot(...p)).toBeCloseTo(0.5, 12)
  close(rotate2(-0.7, p), [0.3, -0.4])
})

test('planar homogeneous transforms compose and invert', () => {
  const a = tf2(1, 2, Math.PI / 2)
  close(applyTf2(a, [1, 0]), [1, 3])
  close(mulTf2(a, invertTf2(a)), [1, 0, 0, 0, 1, 0, 0, 0, 1])
  const b = tf2(0.5, 0, 0.3)
  close(applyTf2(mulTf2(a, b), [0.2, 0.1]), applyTf2(a, applyTf2(b, [0.2, 0.1])))
  expect(mulTf2(a, b)).not.toEqual(mulTf2(b, a))
})

test('4×4 rotations, translations, columns and order', () => {
  close(rotAbout4(2, 0.4), rotAxis4([0, 0, 1], 0.4))
  close(rotAbout4(0, -1.1), rotAxis4([1, 0, 0], -1.1))
  close(rotAbout4(1, 0.9), rotAxis4([0, 1, 0], 0.9))
  const tr = chain4(trans4([1, 0, 0]), rotAbout4(2, Math.PI / 2))
  const rt = chain4(rotAbout4(2, Math.PI / 2), trans4([1, 0, 0]))
  close(originOf(tr), [1, 0, 0])
  close(originOf(rt), [0, 1, 0])
  close(axisOf(tr, 0), [0, 1, 0])
  close(apply4(tr, [1, 0, 0]), [1, 1, 0])
  close(mul4(tr, invert4(tr)), chain4())
})

test('rpyOf inverts tf3, including gimbal lock', () => {
  for (const rpy of [[0.3, -0.5, 2.1], [-1.2, 0.2, -0.4], [0, 0, 0]] as P3[]) close(rpyOf(tf3([0, 0, 0], rpy)), rpy)
  const lock = tf3([0, 0, 0], [0.4, Math.PI / 2, 0.9])
  close(tf3([0, 0, 0], rpyOf(lock)), lock)
})

test('quaternions match matrices, compose and slerp at constant speed', () => {
  const qa = quatAxis([0, 0, 1], 0.8)
  const qb = quatAxis([1, 1, 0], -1.3)
  close(quatTf(qa), rotAxis4([0, 0, 1], 0.8))
  close(quatTf(quatMul(qa, qb)), mul4(quatTf(qa), quatTf(qb)))
  for (const m of [tf3([0, 0, 0], [0.3, -0.5, 2.1]), rotAxis4([1, 0, 0], 3), rotAxis4([0, 1, 0], 3), rotAxis4([0, 0, 1], 3)]) close(quatTf(quatOf(m)), m)
  const id = quatAxis([0, 0, 1], 0)
  expect(quatAngle(id, slerp(id, qb, 0.25))).toBeCloseTo(1.3 / 4, 9)
  close(slerp(id, qb, 1), qb)
  expect(quatAngle(id, slerp(id, quatAxis([0, 0, 1], 3.5), 0.5))).toBeCloseTo((2 * Math.PI - 3.5) / 2, 9)
})

test('frame tree: paths through the common ancestor, lookups match world poses', () => {
  const t = deskTree(0.3, 0.2)
  expect(rootPath(t, 'camera')).toEqual(['camera', 'boom', 'turret', 'base', 'world'])
  expect(framePath(t, 'cup', 'camera')).toEqual({ up: ['cup', 'table', 'world'], down: ['base', 'turret', 'boom', 'camera'], common: 'world' })
  expect(framePath(t, 'camera', 'turret')).toEqual({ up: ['camera', 'boom', 'turret'], down: [], common: 'turret' })
  const T = frameLookup(t, 'camera', 'cup')
  close(T, mul4(invert4(frameWorld(t, 'camera')), frameWorld(t, 'cup')))
  close(frameLookup(t, 'cup', 'camera'), invert4(T))
  const cupInCam = originOf(T)
  const d = originOf(frameWorld(t, 'cup')).map((v, i) => v - originOf(frameWorld(t, 'camera'))[i])
  expect(Math.hypot(...cupInCam)).toBeCloseTo(Math.hypot(...d), 12)
  expect(cupInCam[0]).toBeGreaterThan(0)
})
