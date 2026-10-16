// Position Jacobians: how fast the tool point moves per unit joint speed.
import { Mat, matInv, matMul, matVec, symEig, transpose } from '../control/linalg'
import { SerialArm, armFk, twoLinkTip } from './chain'
import { axisOf, originOf } from './transforms'

const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** 3×n: revolute column = z(i−1) × (p_tool − p(i−1)), prismatic column = z(i−1). */
export function armJacobian(arm: SerialArm, q: readonly number[]): Mat {
  const f = armFk(arm, q)
  const tip = originOf(f[f.length - 1])
  const cols = arm.rows.map((r, i) => {
    const z = axisOf(f[i], 2)
    if (r.kind === 'prismatic') return z
    const o = originOf(f[i])
    return cross(z, [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]])
  })
  return [0, 1, 2].map((k) => cols.map((c) => c[k]))
}

/** 2×n for a planar arm: column i = ∂(x, y)/∂q_i = (−(y_tip − y_i), x_tip − x_i). */
export function planarJacobian(lengths: readonly number[], q: readonly number[]): Mat {
  const pts: [number, number][] = [[0, 0]]
  let phi = 0
  lengths.forEach((l, i) => {
    phi += q[i] ?? 0
    pts.push([pts[i][0] + l * Math.cos(phi), pts[i][1] + l * Math.sin(phi)])
  })
  const [tx, ty] = pts[lengths.length]
  return [lengths.map((_, i) => -(ty - pts[i][1])), lengths.map((_, i) => tx - pts[i][0])]
}

/** Hand velocity ẋ = J·q̇. */
export const handVelocity = (J: Mat, qd: readonly number[]) => matVec(J, qd)

/** Joint torques that hold a hand force F: τ = Jᵀ·F (virtual work). */
export const jointTorques = (J: Mat, F: readonly number[]) => matVec(transpose(J), F)

/** det J of the two-link arm: L1·L2·sin θ2, zero when straight or folded. */
export const twoLinkDet = (l1: number, l2: number, q2: number) => l1 * l2 * Math.sin(q2)

export interface Manipulability {
  /** Singular values σ1 ≥ σ2 … = semi-axes of the hand-velocity ellipse for |q̇| = 1. */
  sigma: number[]
  /** Unit axis directions, one per σ. */
  axes: number[][]
  /** Yoshikawa w = √det(J·Jᵀ) = σ1·σ2…. */
  w: number
  /** σmax/σmin (∞ at a singularity). */
  cond: number
}

/** Velocity ellipse(oid) of J from the eigen-decomposition of J·Jᵀ; the force ellipse has the same axes, semi-axes 1/σ. */
export function manipulability(J: Mat): Manipulability {
  const { values, vectors } = symEig(matMul(J, transpose(J)))
  const sigma = values.map((l) => Math.sqrt(Math.max(0, l)))
  const lo = sigma[sigma.length - 1]
  return { sigma, axes: vectors, w: sigma.reduce((a, b) => a * b, 1), cond: lo > 1e-12 ? sigma[0] / lo : Infinity }
}

export const isSingular = (J: Mat, tol = 1e-3) => manipulability(J).sigma.slice(-1)[0] < tol

export interface RateFrame {
  t: number
  q: number[]
  qd: number[]
  tip: number[]
  det: number
  /** Share of the commanded hand speed achieved (1 = on time, < 1 = joint-speed limited). */
  scale: number
  stuck: boolean
}

/** Resolved-rate control of a two-link arm: q̇ = J⁻¹·ẋ for a constant hand velocity, joint speeds scaled down together to `qdMax` (keeps the direction), stops at det J = 0. */
export function resolvedRateRun(l: [number, number], q0: readonly number[], v: readonly number[], seconds: number, qdMax: number, dt = 0.002): RateFrame[] {
  const out: RateFrame[] = []
  let q = [...q0]
  const steps = Math.round(seconds / dt)
  for (let k = 0; k <= steps; k++) {
    const det = twoLinkDet(l[0], l[1], q[1])
    const J = planarJacobian(l, q)
    const tip = twoLinkTip(l[0], l[1], q[0], q[1])
    const stuck = Math.abs(det) < 1e-9
    let qd = stuck ? [0, 0] : matVec(matInv(J), v)
    const big = Math.max(...qd.map(Math.abs))
    const scale = stuck ? 0 : big > qdMax ? qdMax / big : 1
    qd = qd.map((x) => x * scale)
    out.push({ t: k * dt, q, qd, tip, det, scale, stuck })
    const next = q.map((x, i) => x + qd[i] * dt)
    if (Math.sign(twoLinkDet(l[0], l[1], next[1])) !== Math.sign(det) && !stuck) next[1] = Math.round(q[1] / Math.PI) * Math.PI
    q = next
  }
  return out
}
