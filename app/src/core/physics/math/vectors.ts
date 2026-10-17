// Vectors: dot product (ahead / field of view), cross product (turn side, torque, normals), projection onto a line and a plane.
import { Vec3, cross, norm } from '../../fields'
import { clamp } from '../common'

export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const unit3 = (a: Vec3): Vec3 => {
  const l = norm(a)
  return l < 1e-12 ? [0, 0, 0] : scale3(a, 1 / l)
}
/** Angle between two vectors, 0…π (atan2 of |a×b| and a·b stays accurate near 0 and π). */
export const vecAngle = (a: Vec3, b: Vec3) => Math.atan2(norm(cross(a, b)), dot3(a, b))

/** Floor vector `len` long at `deg` from +x (counter-clockwise), lifted `upDeg` out of the floor. */
export const polar3 = (len: number, deg: number, upDeg = 0): Vec3 => {
  const [t, e] = [(deg * Math.PI) / 180, (upDeg * Math.PI) / 180]
  return [len * Math.cos(e) * Math.cos(t), len * Math.cos(e) * Math.sin(t), len * Math.sin(e)]
}

/** a·b = |a||b|cos θ; `along` = b's shadow length on a; ahead when a·b > 0; in view when cos θ ≥ cos(halfFov). */
export function dotView(a: Vec3, b: Vec3, halfFov = Math.PI) {
  const [la, lb] = [norm(a), norm(b)]
  const d = dot3(a, b)
  const cos = la * lb < 1e-12 ? 0 : d / (la * lb)
  const along = la < 1e-12 ? 0 : d / la
  return { dot: d, la, lb, cos, theta: vecAngle(a, b), along, shadow: scale3(unit3(a), along), ahead: d > 1e-12, inView: cos >= Math.cos(halfFov) - 1e-12 }
}

/** Planar cross product z: + when b is counter-clockwise (left) of a. */
export const cross2 = (a: readonly number[], b: readonly number[]) => a[0] * b[1] - a[1] * b[0]

/** a×b, its length = parallelogram area |a||b|sin θ, and which way b turns from a seen from +z. */
export function crossView(a: Vec3, b: Vec3) {
  const c = cross(a, b)
  const area = norm(c)
  const z = c[2]
  const turn: 'left' | 'right' | 'straight' = Math.abs(z) < 1e-9 * Math.max(1, norm(a) * norm(b)) ? 'straight' : z > 0 ? 'left' : 'right'
  return { c, area, z, sin: norm(a) * norm(b) < 1e-12 ? 0 : area / (norm(a) * norm(b)), theta: vecAngle(a, b), turn }
}

/** Unit normal of the triangle p0 p1 p2: (p1 − p0) × (p2 − p0), counter-clockwise faces point at you. */
export const faceNormal = (p0: Vec3, p1: Vec3, p2: Vec3) => unit3(cross(sub3(p1, p0), sub3(p2, p0)))

/** v = along + perp: the part of v along `d` and the rest, at right angles to d. */
export function splitAlong(v: Vec3, d: Vec3) {
  const u = unit3(d)
  const k = dot3(v, u)
  const along = scale3(u, k)
  return { k, along, perp: sub3(v, along) }
}

/**
 * Point p against the segment a→b lying in a plane through a with unit normal n.
 * v = p − a splits into along the path, across it in the plane (+ = left, a line follower's cross-track error) and up off the plane.
 */
export function projectionView(p: Vec3, a: Vec3, b: Vec3, n: Vec3) {
  const d = sub3(b, a)
  const L = norm(d)
  const u = unit3(d)
  const m = unit3(cross(n, u))
  const nn = unit3(cross(u, m))
  const v = sub3(p, a)
  const [k, side, up] = [dot3(v, u), dot3(v, m), dot3(v, nn)]
  const t = k / L
  const tc = clamp(t, 0, 1)
  const foot: Vec3 = [a[0] + u[0] * k, a[1] + u[1] * k, a[2] + u[2] * k]
  const closest: Vec3 = [a[0] + d[0] * tc, a[1] + d[1] * tc, a[2] + d[2] * tc]
  return {
    t,
    tc,
    along: k,
    side,
    up,
    u,
    m,
    n: nn,
    foot,
    closest,
    shadow: sub3(p, scale3(nn, up)),
    lineDist: Math.hypot(side, up),
    segDist: norm(sub3(p, closest)),
    clamped: t !== tc,
  }
}
