import { medianMs } from '../../stopwatch'
import { DEG } from '../common'
import { quatAngle, quatAxis, quatMul } from '../kinematics/transforms'
import { axisAngleOf, eulerOf, eulerQuat, gimbalView, quatComposeView, quatRotate, quatRotateView, slerpView, sphereDir } from './quaternions'

const close3 = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))

describe('Euler angles', () => {
  it('follow the robot frame: yaw left, pitch nose up, roll about the nose', () => {
    close3(quatRotate(eulerQuat(90 * DEG, 0, 0), [1, 0, 0]), [0, 1, 0])
    close3(quatRotate(eulerQuat(0, 30 * DEG, 0), [1, 0, 0]), [Math.cos(30 * DEG), 0, Math.sin(30 * DEG)])
    close3(quatRotate(eulerQuat(0, 0, 90 * DEG), [0, 1, 0]), [0, 0, 1])
  })
  it('round-trip away from the lock and jump past 90° pitch', () => {
    const e = eulerOf(eulerQuat(40 * DEG, 25 * DEG, -60 * DEG))
    close3([e.yaw, e.pitch, e.roll], [40 * DEG, 25 * DEG, -60 * DEG])
    const over = eulerOf(eulerQuat(0, 120 * DEG, 0))
    expect(over.pitch).toBeCloseTo(60 * DEG, 9)
    expect(Math.abs(over.yaw)).toBeCloseTo(Math.PI, 9)
    expect(Math.abs(over.roll)).toBeCloseTo(Math.PI, 9)
  })
})

describe('gimbal lock', () => {
  it('the rings span |cos θ| of 3D turning; at 90° yaw and roll axes line up', () => {
    for (const p of [0, 30, 60, 89]) expect(gimbalView(20 * DEG, p * DEG, 10 * DEG).freedom).toBeCloseTo(Math.abs(Math.cos(p * DEG)), 9)
    const g = gimbalView(30 * DEG, 90 * DEG, 0)
    expect(g.freedom).toBeCloseTo(0, 9)
    expect(g.yawRollDeg).toBeCloseTo(0, 6)
    close3(g.hardAxis, [Math.cos(30 * DEG), Math.sin(30 * DEG), 0])
  })
  it('at the lock only yaw + roll (or yaw − roll at −90°) matters', () => {
    const a = eulerQuat(10 * DEG, 90 * DEG, 30 * DEG)
    const b = eulerQuat(40 * DEG, 90 * DEG, 0)
    expect(quatAngle(a, b)).toBeCloseTo(0, 7)
    expect(quatAngle(eulerQuat(10 * DEG, -90 * DEG, 30 * DEG), eulerQuat(-20 * DEG, -90 * DEG, 0))).toBeCloseTo(0, 7)
  })
})

describe('quaternion rotate', () => {
  it('q·v·q* turns v about the axis; −q does the same; |q| = 1', () => {
    const r = quatRotateView([0, 0, 2], 90 * DEG, [1, 0, 0.5])
    close3(r.v2, [0, 1, 0.5])
    close3(r.v2neg, r.v2)
    expect(r.norm).toBeCloseTo(1, 12)
    expect(r.radius).toBeCloseTo(1, 12)
    close3(r.centre, [0, 0, 0.5])
    close3(r.q, [Math.cos(45 * DEG), 0, 0, Math.sin(45 * DEG)])
  })
  it('360° gives −1, the same rotation; 720° gives back +1', () => {
    const ax = sphereDir(30 * DEG, 20 * DEG)
    expect(quatAxis(ax, 360 * DEG)[0]).toBeCloseTo(-1, 12)
    close3(quatRotate(quatAxis(ax, 360 * DEG), [1, 2, 3]), [1, 2, 3])
    expect(quatAxis(ax, 720 * DEG)[0]).toBeCloseTo(1, 12)
    const aa = axisAngleOf(quatAxis(ax, 100 * DEG))
    expect(aa.angle).toBeCloseTo(100 * DEG, 12)
    close3(aa.axis, ax)
  })
  it('composition order matters', () => {
    const q1 = quatAxis([1, 0, 0], 90 * DEG)
    const q2 = quatAxis([0, 0, 1], 90 * DEG)
    const c = quatComposeView(q1, q2, [0, 1, 0])
    close3(c.v21, [0, 0, 1])
    close3(c.v12, [-1, 0, 0])
    expect(c.gap).toBeGreaterThan(1)
    expect(c.r21.angle).toBeCloseTo(120 * DEG, 9)
    expect(quatComposeView(q2, quatMul(q2, q2), [1, 0, 0]).gap).toBeCloseTo(0, 7)
  })
})

describe('slerp vs Euler interpolation', () => {
  const A = { yaw: 170 * DEG, pitch: 0, roll: 0 }
  const B = { yaw: -170 * DEG, pitch: 0, roll: 0 }
  it('slerp turns at a constant rate the short way; Euler lerp goes the long way round', () => {
    const v = slerpView(A, B, 0.5)
    expect(v.direct).toBeCloseTo(20 * DEG, 9)
    expect(v.totalS).toBeCloseTo(20 * DEG, 6)
    expect(v.totalE).toBeCloseTo(340 * DEG, 6)
    for (const r of v.rateS) expect(r).toBeCloseTo(20 * DEG, 6)
    close3(v.noseS, [-1, 0, 0])
    close3(v.noseE, [1, 0, 0])
  })
  it('mixed turns: the Euler rate swings and the path is longer, slerp stays flat', () => {
    const v = slerpView({ yaw: 0, pitch: 0, roll: 0 }, { yaw: 150 * DEG, pitch: 60 * DEG, roll: 90 * DEG }, 0.5)
    expect(Math.max(...v.rateE) / Math.min(...v.rateE)).toBeGreaterThan(1.2)
    expect(v.totalE).toBeGreaterThan(v.totalS * 1.05)
  })
  it('over the top: pitch 60° to 120° is written (180°, 60°, 180°); slerp turns 60°, Euler lerp much more', () => {
    const v = slerpView({ yaw: 0, pitch: 60 * DEG, roll: 0 }, { yaw: 180 * DEG, pitch: 60 * DEG, roll: 180 * DEG }, 0.5)
    expect(v.totalS).toBeCloseTo(60 * DEG, 6)
    expect(v.totalE).toBeGreaterThan(3 * v.totalS)
    close3(v.noseS, [0, 0, 1])
    expect(Math.max(...v.rateS) - Math.min(...v.rateS)).toBeLessThan(1e-6)
    expect(v.totalE).toBeGreaterThan(v.totalS)
    close3(v.pathS[0], v.pathE[0])
    close3(v.pathS[60], v.pathE[60])
  })
  it('runs fast', () => {
    const ms = medianMs(() => {
      for (let i = 0; i < 20; i++) slerpView(A, B, i / 20)
    })
    expect(ms).toBeLessThan(200)
  })
})
