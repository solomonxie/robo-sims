// Quaternions: Euler angles and gimbal lock, rotating a vector with q·v·q*, composing, and slerp against Euler-angle interpolation.
import { Vec3, cross, norm } from '../../fields'
import { Quat, quatAngle, quatAxis, quatMul, quatTf, rpyOf, slerp } from '../kinematics/transforms'
import { dot3, scale3, unit3 } from './vectors'

const X: Vec3 = [1, 0, 0]
const Y: Vec3 = [0, 1, 0]
const Z: Vec3 = [0, 0, 1]

/** Yaw ψ about z (+ left), pitch θ nose up, roll φ about the nose: R = Rz(ψ)·Ry(−θ)·Rx(φ), body x forward, y left, z up. */
export const eulerQuat = (yaw: number, pitch: number, roll: number): Quat => quatMul(quatMul(quatAxis(Z, yaw), quatAxis(Y, -pitch)), quatAxis(X, roll))

/** Euler angles back from q, pitch in [−90°, 90°]; at the lock roll is set to 0 and yaw takes the whole turn. */
export function eulerOf(q: Quat) {
  const [roll, p, yaw] = rpyOf(quatTf(q))
  return { yaw, pitch: -p, roll }
}

export const quatConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]]

/** v' = q·(0, v)·q*. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const r = quatMul(quatMul(q, [0, v[0], v[1], v[2]]), quatConj(q))
  return [r[1], r[2], r[3]]
}

/** Turn angle in [0, 2π] and unit axis; q and −q give angles θ and 2π − θ about opposite axes, the same rotation. */
export function axisAngleOf(q: Quat) {
  const s = Math.hypot(q[1], q[2], q[3])
  const angle = 2 * Math.atan2(s, q[0])
  return { angle, axis: (s < 1e-12 ? [...Z] : [q[1] / s, q[2] / s, q[3] / s]) as Vec3 }
}

/**
 * A 3-ring gimbal set to yaw, pitch, roll: each ring's axis in the world, how much of 3D turning they still span
 * (|det| of the three axes = |cos θ|), the angle between the yaw and roll axes, and the direction that gets hard to turn about.
 */
export function gimbalView(yaw: number, pitch: number, roll: number) {
  const q = eulerQuat(yaw, pitch, roll)
  const yawAxis = Z
  const pitchAxis = quatRotate(quatAxis(Z, yaw), Y)
  const rollAxis = quatRotate(q, X)
  const freedom = Math.abs(dot3(yawAxis, cross(pitchAxis, rollAxis)))
  const b = pitch >= 0 ? rollAxis.map((v, i) => v + Z[i]) : rollAxis.map((v, i) => Z[i] - v)
  return {
    q,
    yawAxis,
    pitchAxis,
    rollAxis,
    up: quatRotate(q, Z),
    freedom,
    yawRollDeg: (Math.acos(Math.min(1, Math.abs(dot3(yawAxis, rollAxis)))) * 180) / Math.PI,
    hardAxis: unit3(cross(pitchAxis, b as Vec3)),
    euler: eulerOf(q),
  }
}

/** Axis from azimuth (from x toward y) and elevation (up from the floor). */
export const sphereDir = (az: number, el: number): Vec3 => [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]

/** Turn v by `angle` about `axis`: q = (cos θ/2, sin θ/2·axis), v' = q·v·q*, the same from −q; the circle v sweeps round the axis. */
export function quatRotateView(axis: Vec3, angle: number, v: Vec3) {
  const u = unit3(axis)
  const q = quatAxis(u, angle)
  const neg = q.map((c) => -c) as Quat
  const centre = scale3(u, dot3(v, u))
  return { axis: u, q, neg, v2: quatRotate(q, v), v2neg: quatRotate(neg, v), centre, radius: norm(cross(u, v)), norm: Math.hypot(...q) }
}

/** q1 then q2 (about world axes) is q2·q1; the other order differs unless they share an axis. */
export function quatComposeView(q1: Quat, q2: Quat, v: Vec3) {
  const q21 = quatMul(q2, q1)
  const q12 = quatMul(q1, q2)
  return { q21, q12, v21: quatRotate(q21, v), v12: quatRotate(q12, v), r21: axisAngleOf(q21), gap: quatAngle(q21, q12) }
}

export interface Euler {
  yaw: number
  pitch: number
  roll: number
}

/** Linear interpolation of the three angles, as a quaternion. */
const mix = (a: number, b: number, u: number) => a + (b - a) * u
export const eulerMix = (a: Euler, b: Euler, u: number): Euler => ({ yaw: mix(a.yaw, b.yaw, u), pitch: mix(a.pitch, b.pitch, u), roll: mix(a.roll, b.roll, u) })
export const eulerLerp = (a: Euler, b: Euler, u: number) => {
  const e = eulerMix(a, b, u)
  return eulerQuat(e.yaw, e.pitch, e.roll)
}

/**
 * Euler-angle interpolation against slerp from a to b over u ∈ [0, 1], sampled `k` + 1 times: orientation and nose at u,
 * nose paths, turn rate (rad per unit u) along each, and total angle turned (slerp's equals the direct angle).
 */
export function slerpView(a: Euler, b: Euler, u: number, k = 60) {
  const qa = eulerQuat(a.yaw, a.pitch, a.roll)
  const qb = eulerQuat(b.yaw, b.pitch, b.roll)
  const at = (t: number) => ({ e: eulerLerp(a, b, t), s: slerp(qa, qb, t) })
  const runs = Array.from({ length: k + 1 }, (_, i) => at(i / k))
  const rate = (pick: 'e' | 's') => runs.slice(1).map((r, i) => quatAngle(runs[i][pick], r[pick]) * k)
  const [rateE, rateS] = [rate('e'), rate('s')]
  const total = (r: number[]) => r.reduce((s, v) => s + v, 0) / k
  const now = at(u)
  return {
    qa,
    qb,
    euler: eulerMix(a, b, u),
    qe: now.e,
    qs: now.s,
    noseE: quatRotate(now.e, X),
    noseS: quatRotate(now.s, X),
    pathE: runs.map((r) => quatRotate(r.e, X)),
    pathS: runs.map((r) => quatRotate(r.s, X)),
    rateE,
    rateS,
    totalE: total(rateE),
    totalS: total(rateS),
    direct: quatAngle(qa, qb),
  }
}
