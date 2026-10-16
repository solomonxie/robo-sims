// Planar pose uncertainty: 3×3 covariance over (x, y, θ), Jacobian propagation through an odometry step, 2σ ellipses; paths as arc legs.
import { DEG } from '../common'
import { Mat, matAdd, matMul, transpose } from '../control/linalg'
import { Pose } from '../room'

export type Cov3 = Mat
export const zeroCov = (): Cov3 => [[0, 0, 0], [0, 0, 0], [0, 0, 0]]

/** ∂pose'/∂pose (F) and ∂pose'/∂(Δs, Δθ) (G) for a mid-heading step. */
export function stepJacobians(p: Pose, ds: number, dth: number): { F: Mat; G: Mat } {
  const m = p.th + dth / 2
  const [c, s] = [Math.cos(m), Math.sin(m)]
  return {
    F: [[1, 0, -ds * s], [0, 1, ds * c], [0, 0, 1]],
    G: [[c, (-ds * s) / 2], [s, (ds * c) / 2], [0, 1]],
  }
}

/** P' = F P Fᵀ + G Q Gᵀ, Q = 2×2 covariance of (Δs, Δθ). */
export function propagateCov(P: Cov3, p: Pose, ds: number, dth: number, Q: Mat): Cov3 {
  const { F, G } = stepJacobians(p, ds, dth)
  return matAdd(matMul(matMul(F, P), transpose(F)), matMul(matMul(G, Q), transpose(G)))
}

/** k-σ ellipse of the x–y block: semi-axes a ≥ b (m) and the major-axis angle (rad, CCW from +x). */
export function covEllipse(P: Cov3, k = 2) {
  const [sxx, sxy, syy] = [P[0][0], P[0][1], P[1][1]]
  const mid = (sxx + syy) / 2
  const r = Math.hypot((sxx - syy) / 2, sxy)
  return { a: k * Math.sqrt(Math.max(0, mid + r)), b: k * Math.sqrt(Math.max(0, mid - r)), angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) }
}

/** `n` outline points of an ellipse about (cx, cy). */
export function ellipsePoints(cx: number, cy: number, e: { a: number; b: number; angle: number }, n = 24): [number, number][] {
  const [c, s] = [Math.cos(e.angle), Math.sin(e.angle)]
  return Array.from({ length: n }, (_, i) => {
    const u = (2 * Math.PI * i) / n
    const [x, y] = [e.a * Math.cos(u), e.b * Math.sin(u)]
    return [cx + x * c - y * s, cy + x * s + y * c]
  })
}

/** 1σ heading (deg) from a covariance. */
export const headingSigmaDeg = (P: Cov3) => Math.sqrt(Math.max(0, P[2][2])) / DEG

/** Path leg: an arc `m` metres long that turns `turnDeg` (0 = straight, + = left). */
export interface Leg {
  m: number
  turnDeg: number
}
export const legsLength = (legs: readonly Leg[]) => legs.reduce((a, l) => a + l.m, 0)
/** Curvature (1/m) at distance `s` along the legs; 0 past the end. */
export function curvatureAt(legs: readonly Leg[], s: number) {
  for (const l of legs) {
    if (s < l.m) return (l.turnDeg * DEG) / l.m
    s -= l.m
  }
  return 0
}
