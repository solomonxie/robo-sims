// Inverse kinematics: closed-form two-link and 4-DOF servo arm (every elbow/base branch), and Jacobian iteration (transpose, damped least squares).
import { clamp, wrapPi } from '../common'
import { Mat, eye, matAdd, matInv, matMul, matScale, transpose } from '../control/linalg'
import { P3 } from '../room'
import { SERVO_ARM, SERVO_ARM_DIMS, SerialArm, armFk } from './chain'
import { originOf } from './transforms'
import { V2 } from './transforms'

export interface TwoLinkIk {
  reachable: boolean
  /** Distance to the target and the reach ring |L1 − L2| … L1 + L2. */
  r: number
  reach: [number, number]
  /** The point actually solved for: the target, or the nearest ring point when out of reach. */
  aim: V2
  /** Elbow above / below the base→target line (q2 < 0 / q2 > 0). */
  up: [number, number]
  down: [number, number]
  /** cos θ2 by the law of cosines (before clamping). */
  cos2: number
}

/** cos θ2 = (r² − L1² − L2²)/(2·L1·L2), θ1 = atan2(y, x) − atan2(L2 sin θ2, L1 + L2 cos θ2). */
export function twoLinkIk(l1: number, l2: number, x: number, y: number): TwoLinkIk {
  const r = Math.hypot(x, y)
  const reach: [number, number] = [Math.abs(l1 - l2), l1 + l2]
  const reachable = r >= reach[0] - 1e-9 && r <= reach[1] + 1e-9
  const rc = clamp(r, reach[0], reach[1])
  const [ux, uy] = r > 1e-12 ? [x / r, y / r] : [1, 0]
  const aim: V2 = [ux * rc, uy * rc]
  const cos2 = (r * r - l1 * l1 - l2 * l2) / (2 * l1 * l2)
  const solve = (sign: number): [number, number] => {
    const q2 = sign * Math.acos(clamp((rc * rc - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1))
    return [wrapPi(Math.atan2(aim[1], aim[0]) - Math.atan2(l2 * Math.sin(q2), l1 + l2 * Math.cos(q2))), q2]
  }
  return { reachable, r, reach, aim, up: solve(-1), down: solve(1), cos2 }
}

export interface ServoIkSolution {
  q: number[]
  elbow: 'up' | 'down'
  /** Base turned 180° and the arm reaching back over the top. */
  flip: boolean
  inLimits: boolean
}

export const inLimits = (arm: SerialArm, q: readonly number[], eps = 1e-6) => q.every((v, i) => v >= arm.limits[i][0] - eps && v <= arm.limits[i][1] + eps)

/** Servo arm: base yaw from atan2, then a two-link solve for the wrist point (target minus the hand, held at `pitch` above horizontal), wrist = pitch − shoulder − elbow. Four branches: base front/flipped × elbow up/down (elbow above or below the shoulder–wrist line in the world). */
export function servoArmIk(target: P3, pitch: number, dims = SERVO_ARM_DIMS, arm: SerialArm = SERVO_ARM) {
  const [x, y, z] = target
  const rho = Math.hypot(x, y)
  const yaw = rho > 1e-9 ? Math.atan2(y, x) : 0
  const h = z - dims.base
  const branch = (flip: boolean) => {
    const u = flip ? -rho : rho
    const psi = flip ? Math.PI - pitch : pitch
    const wrist: V2 = [u - dims.hand * Math.cos(psi), h - dims.hand * Math.sin(psi)]
    const s = twoLinkIk(dims.upper, dims.fore, wrist[0], wrist[1])
    const out = (['up', 'down'] as const).map((elbow): ServoIkSolution => {
      const [q2, q3] = s[flip === (elbow === 'up') ? 'down' : 'up']
      const q = [wrapPi(flip ? yaw + Math.PI : yaw), wrapPi(q2), q3, wrapPi(psi - q2 - q3)]
      return { q, elbow, flip, inLimits: inLimits(arm, q) }
    })
    return { wrist, ik: s, out }
  }
  const front = branch(false)
  const back = branch(true)
  return { yaw, rho, wrist: front.wrist, reachable: front.ik.reachable, ik: front.ik, solutions: [...front.out, ...back.out] }
}

/** Indices of joint vectors grouped by physical shape (every joint origin within `tol` m): different joint numbers can draw the same arm. */
export function poseGroups(arm: SerialArm, qs: readonly (readonly number[])[], tol = 1e-3): number[][] {
  const pts = qs.map((q) => armFk(arm, q).map(originOf))
  const groups: number[][] = []
  pts.forEach((p, i) => {
    const g = groups.find((x) => pts[x[0]].every((o, k) => Math.hypot(o[0] - p[k][0], o[1] - p[k][1], o[2] - p[k][2]) < tol))
    if (g) g.push(i)
    else groups.push([i])
  })
  return groups
}

export type IkMethod = 'transpose' | 'dls'

export interface IkStep {
  q: number[]
  tip: number[]
  err: number
}

export interface IkOpts {
  method?: IkMethod
  /** Damping λ for least squares (0 = plain pseudo-inverse). */
  lambda?: number
  iters?: number
  tol?: number
  /** Largest joint change per step, rad. */
  maxStep?: number
}

/** Jacobian transpose step: Δq = α·Jᵀe with the line-search α = (e·JJᵀe)/|JJᵀe|². */
export function transposeStep(J: Mat, e: readonly number[]): number[] {
  const Jt = transpose(J)
  const dq = Jt.map((r) => r.reduce((s, v, k) => s + v * e[k], 0))
  const jje = J.map((r) => r.reduce((s, v, k) => s + v * dq[k], 0))
  const den = jje.reduce((s, v) => s + v * v, 0)
  const a = den > 1e-18 ? jje.reduce((s, v, k) => s + v * e[k], 0) / den : 0
  return dq.map((v) => v * a)
}

/** Damped least squares: Δq = Jᵀ(JJᵀ + λ²I)⁻¹e. */
export function dlsStep(J: Mat, e: readonly number[], lambda: number): number[] {
  const A = matAdd(matMul(J, transpose(J)), matScale(eye(J.length), lambda * lambda))
  const w = matInv(A).map((r) => r.reduce((s, v, k) => s + v * e[k], 0))
  return transpose(J).map((r) => r.reduce((s, v, k) => s + v * w[k], 0))
}

/** Iterate from `q0` towards `target`; returns every pose including the start. */
export function ikIterate(fk: (q: readonly number[]) => number[], jac: (q: readonly number[]) => Mat, target: readonly number[], q0: readonly number[], o: IkOpts = {}): IkStep[] {
  const { method = 'dls', lambda = 0.05, iters = 60, tol = 1e-4, maxStep = 0.5 } = o
  const at = (q: number[]): IkStep => {
    const tip = fk(q)
    return { q, tip, err: Math.hypot(...target.map((v, i) => v - tip[i])) }
  }
  const out = [at([...q0])]
  for (let k = 0; k < iters && out[k].err > tol; k++) {
    const { q, tip } = out[k]
    const e = target.map((v, i) => v - tip[i])
    const J = jac(q)
    let dq = method === 'transpose' ? transposeStep(J, e) : dlsStep(J, e, lambda)
    if (!dq.every(Number.isFinite)) dq = dq.map(() => 0)
    const big = Math.max(...dq.map(Math.abs))
    if (big > maxStep) dq = dq.map((v) => (v * maxStep) / big)
    out.push(at(q.map((v, i) => wrapPi(v + dq[i]))))
  }
  return out
}
