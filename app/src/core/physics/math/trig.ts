// Trigonometry: the unit circle, atan2 against atan(y/x), and the law of cosines on a two-link arm.
import { TAU, clamp, wrapPi } from '../common'
import { twoLinkIk } from '../kinematics/ik'
import { V2 } from '../kinematics/transforms'

/** 1…4 counter-clockwise from +x, 0 on an axis. */
export const quadrantOf = (x: number, y: number, eps = 1e-9) => (Math.abs(x) < eps || Math.abs(y) < eps ? 0 : x > 0 ? (y > 0 ? 1 : 4) : y > 0 ? 2 : 3)

/** Point at angle θ on the unit circle: (cos θ, sin θ); `wrapped` is the same direction in [−π, π). */
export function unitCircleView(th: number) {
  const [x, y] = [Math.cos(th), Math.sin(th)]
  return { th, x, y, wrapped: wrapPi(th), turns: th / TAU, quadrant: quadrantOf(x, y), check: x * x + y * y }
}

/** atan(y/x): right only for x > 0; null at x = 0 (divide by zero). */
export const atanNaive = (y: number, x: number, eps = 1e-9) => (Math.abs(x) < eps ? null : Math.atan(y / x))

/** Bearing from the robot (heading `heading`, CCW from +x) to a target at (x, y): atan2 vs atan(y/x), and the turn with and without wrapping. */
export function bearingView(x: number, y: number, heading: number) {
  const bearing = Math.atan2(y, x)
  const naive = atanNaive(y, x)
  const raw = bearing - heading
  const error = wrapPi(raw)
  return {
    dist: Math.hypot(x, y),
    bearing,
    naive,
    naiveOff: naive === null ? null : wrapPi(naive - bearing),
    quadrant: quadrantOf(x, y),
    raw,
    error,
    wrapped: Math.abs(raw - error) > 1e-9,
    side: Math.abs(error) < 1e-9 ? ('ahead' as const) : error > 0 ? ('left' as const) : ('right' as const),
  }
}

/** Angles of a triangle with sides a, b, c, each opposite its side; `valid` when the sides close (|a − b| ≤ c ≤ a + b). */
export function triangleAngles(a: number, b: number, c: number) {
  const ang = (p: number, q: number, opp: number) => Math.acos(clamp((p * p + q * q - opp * opp) / (2 * p * q), -1, 1))
  const cosC = (a * a + b * b - c * c) / (2 * a * b)
  return { A: ang(b, c, a), B: ang(a, c, b), C: ang(a, b, c), cosC, valid: c >= Math.abs(a - b) - 1e-9 && c <= a + b + 1e-9 }
}

/**
 * Two-link arm (upper l1, fore l2) reaching distance d at angle `dir`: the elbow angle C from c² = a² + b² − 2ab·cos C,
 * the joint angles (q2 = ±(π − C)) and the elbow point for the up or down solution. Out of reach it stretches toward the target.
 */
export function elbowView(l1: number, l2: number, d: number, dir: number, elbow: 'up' | 'down') {
  const [ux, uy] = [Math.cos(dir), Math.sin(dir)]
  const ik = twoLinkIk(l1, l2, d * ux, d * uy)
  const dc = Math.hypot(...ik.aim)
  const T = triangleAngles(l1, l2, dc)
  const q = ik[elbow]
  const at: V2 = [l1 * Math.cos(q[0]), l1 * Math.sin(q[0])]
  const tip: V2 = [at[0] + l2 * Math.cos(q[0] + q[1]), at[1] + l2 * Math.sin(q[0] + q[1])]
  return { ik, reach: ik.reach, reachable: ik.reachable, cosC: -ik.cos2, C: T.C, B: T.B, q, elbowAt: at, tip, target: [d * ux, d * uy] as V2, miss: d - dc }
}
