// Serial chains: standard Denavit–Hartenberg rows, forward kinematics returning every joint frame, planar 2/3-link arms and a 4-DOF servo arm.
import { DEG } from '../common'
import { P3 } from '../room'
import { IDENTITY4, Mat4, mul4 } from '../software/urdf'
import { V2, originOf } from './transforms'

export type JointKind = 'revolute' | 'prismatic'

/** Standard DH row: joint i turns θ about z(i−1), slides d along it, then a along the new x, twisted α about it. The joint variable adds to θ (revolute) or d (prismatic). */
export interface DhRow {
  a: number
  alpha: number
  d: number
  theta: number
  kind: JointKind
}

export interface SerialArm {
  name: string
  rows: DhRow[]
  /** Joint limits, rad or m. */
  limits: [number, number][]
  base: Mat4
}

/** A(i) = Rot z(θ) · Trans z(d) · Trans x(a) · Rot x(α). */
export function dhTf(a: number, alpha: number, d: number, theta: number): Mat4 {
  const [ct, st, ca, sa] = [Math.cos(theta), Math.sin(theta), Math.cos(alpha), Math.sin(alpha)]
  return [ct, -st * ca, st * sa, a * ct, st, ct * ca, -ct * sa, a * st, 0, sa, ca, d, 0, 0, 0, 1]
}

/** Row `i` with joint value `q` folded into θ or d. */
export const dhRowAt = (r: DhRow, q: number): DhRow => (r.kind === 'revolute' ? { ...r, theta: r.theta + q } : { ...r, d: r.d + q })

/** A(i) for joint value `q`. */
export function dhJointTf(r: DhRow, q: number): Mat4 {
  const x = dhRowAt(r, q)
  return dhTf(x.a, x.alpha, x.d, x.theta)
}

/** Frames 0…n in the world: [base, base·A1, base·A1·A2, …]; the last is the tool frame. */
export function armFk(arm: SerialArm, q: readonly number[]): Mat4[] {
  const out = [arm.base]
  arm.rows.forEach((r, i) => out.push(mul4(out[i], dhJointTf(r, q[i] ?? 0))))
  return out
}

export const toolOf = (frames: Mat4[]): P3 => originOf(frames[frames.length - 1])

/** Planar arm in the base x–y plane: every row a = L, α = d = θ = 0. */
export const planarArm = (lengths: readonly number[], name = `${lengths.length}-link planar`): SerialArm => ({
  name,
  rows: lengths.map((a) => ({ a, alpha: 0, d: 0, theta: 0, kind: 'revolute' })),
  limits: lengths.map(() => [-Math.PI, Math.PI]),
  base: IDENTITY4,
})

/** Planar joint points (base, elbows…, tip) and the tool heading φ = Σq. */
export function planarFk(lengths: readonly number[], q: readonly number[]): { points: V2[]; phi: number } {
  const points: V2[] = [[0, 0]]
  let phi = 0
  lengths.forEach((l, i) => {
    phi += q[i] ?? 0
    const [x, y] = points[i]
    points.push([x + l * Math.cos(phi), y + l * Math.sin(phi)])
  })
  return { points, phi }
}

/** Two-link closed form: x = L1 cos θ1 + L2 cos(θ1+θ2), y = L1 sin θ1 + L2 sin(θ1+θ2). */
export const twoLinkTip = (l1: number, l2: number, q1: number, q2: number): V2 => [l1 * Math.cos(q1) + l2 * Math.cos(q1 + q2), l1 * Math.sin(q1) + l2 * Math.sin(q1 + q2)]

/** Desk 4-DOF servo arm (base yaw, shoulder, elbow, wrist pitch), metres. Zero pose: arm straight out along x at shoulder height. */
export const SERVO_ARM_DIMS = { base: 0.08, upper: 0.12, fore: 0.12, hand: 0.07 }
export const SERVO_ARM: SerialArm = {
  name: '4-DOF servo arm',
  rows: [
    { a: 0, alpha: Math.PI / 2, d: SERVO_ARM_DIMS.base, theta: 0, kind: 'revolute' },
    { a: SERVO_ARM_DIMS.upper, alpha: 0, d: 0, theta: 0, kind: 'revolute' },
    { a: SERVO_ARM_DIMS.fore, alpha: 0, d: 0, theta: 0, kind: 'revolute' },
    { a: SERVO_ARM_DIMS.hand, alpha: 0, d: 0, theta: 0, kind: 'revolute' },
  ],
  limits: [
    [-90 * DEG, 90 * DEG],
    [0, 180 * DEG],
    [-135 * DEG, 135 * DEG],
    [-90 * DEG, 90 * DEG],
  ],
  base: IDENTITY4,
}
