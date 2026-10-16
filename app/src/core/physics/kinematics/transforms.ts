// Rigid transforms: 2D rotation and planar 3×3 poses, 4×4 helpers on top of urdf's Mat4, ZYX Euler angles, unit quaternions.
import { P3 } from '../room'
import { IDENTITY4, Mat4, mul4 } from '../software/urdf'

export type V2 = [number, number]

/** Row-major 2×2 rotation [c −s; s c]. */
export const rot2 = (th: number) => [Math.cos(th), -Math.sin(th), Math.sin(th), Math.cos(th)]

/** Point `p` turned by `th` rad counter-clockwise about the origin. */
export function rotate2(th: number, p: V2): V2 {
  const [a, b, c, d] = rot2(th)
  return [a * p[0] + b * p[1], c * p[0] + d * p[1]]
}

/** Row-major planar homogeneous 3×3: [R t; 0 0 1]. */
export type Tf2 = number[]

export const tf2 = (x: number, y: number, th: number): Tf2 => {
  const [a, b, c, d] = rot2(th)
  return [a, b, x, c, d, y, 0, 0, 1]
}

export function mulTf2(a: Tf2, b: Tf2): Tf2 {
  const m = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return m
}

export const applyTf2 = (m: Tf2, p: V2): V2 => [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]]

/** Rᵀ, −Rᵀt. */
export const invertTf2 = (m: Tf2): Tf2 => [m[0], m[3], -(m[0] * m[2] + m[3] * m[5]), m[1], m[4], -(m[1] * m[2] + m[4] * m[5]), 0, 0, 1]

export const trans4 = (p: P3): Mat4 => [1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2], 0, 0, 0, 1]

/** Rotation about x (0), y (1) or z (2). */
export function rotAbout4(axis: 0 | 1 | 2, a: number): Mat4 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const [i, j] = [(axis + 1) % 3, (axis + 2) % 3]
  const m = [...IDENTITY4]
  m[i * 4 + i] = c
  m[i * 4 + j] = -s
  m[j * 4 + i] = s
  m[j * 4 + j] = c
  return m
}

/** Left-to-right product a·b·c… */
export const chain4 = (...ms: Mat4[]) => ms.reduce(mul4, IDENTITY4)

export const originOf = (m: Mat4): P3 => [m[3], m[7], m[11]]
/** Column `i` of R: the frame's x/y/z axis in the parent. */
export const axisOf = (m: Mat4, i: 0 | 1 | 2): P3 => [m[i], m[4 + i], m[8 + i]]

/** URDF rpy (roll x, pitch y, yaw z; R = Rz·Ry·Rx) back from a 4×4; inverse of `tf3`, pitch in [−π/2, π/2]. */
export function rpyOf(m: Mat4): P3 {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[8])))
  if (Math.abs(m[8]) > 1 - 1e-9) return [0, pitch, Math.atan2(-m[1], m[5])]
  return [Math.atan2(m[9], m[10]), pitch, Math.atan2(m[4], m[0])]
}

/** Unit quaternion [w, x, y, z]. */
export type Quat = [number, number, number, number]

export function quatAxis(axis: P3, a: number): Quat {
  const l = Math.hypot(...axis) || 1
  const s = Math.sin(a / 2) / l
  return [Math.cos(a / 2), axis[0] * s, axis[1] * s, axis[2] * s]
}

export const quatMul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
]

/** 4×4 with rotation `q` and translation `t`. */
export function quatTf(q: Quat, t: P3 = [0, 0, 0]): Mat4 {
  const [w, x, y, z] = q
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), t[0],
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), t[1],
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), t[2],
    0, 0, 0, 1,
  ]
}

/** Rotation part of a 4×4 as a quaternion (w ≥ 0). */
export function quatOf(m: Mat4): Quat {
  const [a, b, c, , d, e, f, , g, h, i] = m
  const tr = a + e + i
  let q: Quat
  if (tr > 0) {
    const s = 2 * Math.sqrt(tr + 1)
    q = [s / 4, (h - f) / s, (c - g) / s, (d - b) / s]
  } else if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i)
    q = [(h - f) / s, s / 4, (b + d) / s, (c + g) / s]
  } else if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i)
    q = [(c - g) / s, (b + d) / s, s / 4, (f + h) / s]
  } else {
    const s = 2 * Math.sqrt(1 + i - a - e)
    q = [(d - b) / s, (c + g) / s, (f + h) / s, s / 4]
  }
  return q[0] < 0 ? (q.map((v) => -v) as Quat) : q
}

/** Constant-speed rotation from `a` (u = 0) to `b` (u = 1) the short way round. */
export function slerp(a: Quat, b: Quat, u: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const bb = dot < 0 ? (b.map((v) => -v) as Quat) : b
  dot = Math.abs(dot)
  if (dot > 1 - 1e-9) return a.map((v, k) => v + (bb[k] - v) * u) as Quat
  const th = Math.acos(dot)
  const ka = Math.sin((1 - u) * th) / Math.sin(th)
  const kb = Math.sin(u * th) / Math.sin(th)
  return a.map((v, k) => ka * v + kb * bb[k]) as Quat
}

/** Rotation angle between two orientations, rad. */
export function quatAngle(a: Quat, b: Quat) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return 2 * Math.acos(Math.min(1, dot))
}
