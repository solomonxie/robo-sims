// Matrices: 2×2 row-major [a b; c d] (as rot2). Columns = where x and y land; products compose; det = area scale; inverse undoes.
import { V2, rot2 } from '../kinematics/transforms'

export type Mat2 = [number, number, number, number]
export const I2: Mat2 = [1, 0, 0, 1]
export const rotMat2 = (th: number) => rot2(th) as Mat2
export const scaleMat2 = (sx: number, sy = sx): Mat2 => [sx, 0, 0, sy]
export const shearMat2 = (k: number): Mat2 => [1, k, 0, 1]
export const mul2 = (A: Mat2, B: Mat2): Mat2 => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]]
export const apply2 = (M: Mat2, p: readonly number[]): V2 => [M[0] * p[0] + M[1] * p[1], M[2] * p[0] + M[3] * p[1]]
export const det2 = (M: Mat2) => M[0] * M[3] - M[1] * M[2]
export const transpose2 = (M: Mat2): Mat2 => [M[0], M[2], M[1], M[3]]
export const colOf2 = (M: Mat2, j: 0 | 1): V2 => [M[j], M[2 + j]]
export const rowOf2 = (M: Mat2, i: 0 | 1): V2 => [M[2 * i], M[2 * i + 1]]
export const close2 = (A: Mat2, B: Mat2, tol = 1e-9) => A.every((v, i) => Math.abs(v - B[i]) <= tol)
/** null when det ≈ 0 (singular). */
export function inv2(M: Mat2, tol = 1e-9): Mat2 | null {
  const d = det2(M)
  return Math.abs(d) < tol ? null : [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d]
}

/** What makes M a rotation: unit columns, at right angles (orthonormal), det = +1 (no mirror). */
export function rotationCheck(M: Mat2, tol = 1e-6) {
  const [x, y] = [colOf2(M, 0), colOf2(M, 1)]
  const [lenX, lenY] = [Math.hypot(...x), Math.hypot(...y)]
  const dot = x[0] * y[0] + x[1] * y[1]
  const det = det2(M)
  const orthonormal = Math.abs(lenX - 1) < tol && Math.abs(lenY - 1) < tol && Math.abs(dot) < tol
  return { x, y, lenX, lenY, dot, det, orthonormal, rotation: orthonormal && det > 0, mirror: orthonormal && det < 0, angle: Math.atan2(x[1], x[0]), RtR: mul2(transpose2(M), M) }
}

/** A·B and B·A; entry (i, j) of A·B = row i of A · column j of B. */
export function composeView(A: Mat2, B: Mat2) {
  const AB = mul2(A, B)
  const BA = mul2(B, A)
  const term = (i: 0 | 1, j: 0 | 1) => ({ row: rowOf2(A, i), col: colOf2(B, j), value: AB[2 * i + j] })
  return { AB, BA, term, commute: close2(AB, BA, 1e-9), gap: Math.max(...AB.map((v, i) => Math.abs(v - BA[i]))) }
}

/**
 * Inverse of M, M·M⁻¹, the area scale |det| and, when singular, the line the plane squashes onto (`onto`)
 * and the direction squashed to zero (`lost`): every q + t·lost lands on the same point.
 */
export function inverseView(M: Mat2) {
  const det = det2(M)
  const inv = inv2(M, 1e-6)
  const c = [colOf2(M, 0), colOf2(M, 1)]
  const big = Math.hypot(...c[0]) >= Math.hypot(...c[1]) ? c[0] : c[1]
  const ob = Math.hypot(...big)
  const onto: V2 = ob < 1e-12 ? [1, 0] : [big[0] / ob, big[1] / ob]
  const r = Math.hypot(M[0], M[1]) >= Math.hypot(M[2], M[3]) ? rowOf2(M, 0) : rowOf2(M, 1)
  const or = Math.hypot(...r)
  const lost: V2 = or < 1e-12 ? [1, 0] : [-r[1] / or, r[0] / or]
  return { det, area: Math.abs(det), flips: det < 0, inv, singular: inv === null, check: inv ? mul2(M, inv) : null, onto, lost, isRotation: rotationCheck(M).rotation }
}
