// Trajectories: joint vs Cartesian interpolation, cubic/quintic polynomials, via-point paths (corners, stops, C2 spline), time scaling and synchronised joint moves.
import { moveAt, sCurveMove, trapezoidMove } from '../control/position'
import { twoLinkTip } from './chain'
import { twoLinkIk } from './ik'
import { twoLinkDet } from './jacobian'
import { V2 } from './transforms'

/** p(t) = Σ c_k t^k with p, ṗ at both ends over T. */
export function cubicCoeffs(p0: number, p1: number, v0: number, v1: number, T: number): number[] {
  const d = p1 - p0
  return [p0, v0, (3 * d) / T ** 2 - (2 * v0 + v1) / T, (-2 * d) / T ** 3 + (v0 + v1) / T ** 2]
}

/** p, ṗ, p̈ at both ends over T. */
export function quinticCoeffs(p0: number, p1: number, v0: number, v1: number, a0: number, a1: number, T: number): number[] {
  const d = p1 - p0 - v0 * T - (a0 * T * T) / 2
  const dv = v1 - v0 - a0 * T
  const da = a1 - a0
  return [p0, v0, a0 / 2, (10 * d) / T ** 3 - (4 * dv) / T ** 2 + da / (2 * T), (-15 * d) / T ** 4 + (7 * dv) / T ** 3 - da / T ** 2, (6 * d) / T ** 5 - (3 * dv) / T ** 4 + da / (2 * T ** 3)]
}

export function polyAt(c: readonly number[], t: number) {
  const out = { p: 0, v: 0, a: 0, j: 0 }
  c.forEach((ck, k) => {
    out.p += ck * t ** k
    if (k >= 1) out.v += k * ck * t ** (k - 1)
    if (k >= 2) out.a += k * (k - 1) * ck * t ** (k - 2)
    if (k >= 3) out.j += k * (k - 1) * (k - 2) * ck * t ** (k - 3)
  })
  return out
}

export const lerpJoints = (a: readonly number[], b: readonly number[], u: number) => a.map((v, i) => v + (b[i] - v) * u)

export interface LineSample { u: number; q: number[]; tip: V2; onLine: boolean; det: number }
const lineSample = (l: [number, number], u: number, q: number[], onLine: boolean): LineSample => ({ u, q, tip: twoLinkTip(l[0], l[1], q[0], q[1]), onLine, det: twoLinkDet(l[0], l[1], q[1]) })

/** Two-link joint-space line A → B: q = qa + u·(qb − qa); the hand bows off the straight line. */
export const jointLine = (l: [number, number], qa: readonly number[], qb: readonly number[], n: number): LineSample[] =>
  Array.from({ length: n + 1 }, (_, i) => lineSample(l, i / n, lerpJoints(qa, qb, i / n), true))

/** Two-link Cartesian line: IK at each point x = a + u·(b − a), one elbow branch; points in the hole/outside are clamped to the ring (`onLine` false). */
export const cartesianLine = (l: [number, number], a: V2, b: V2, n: number, elbow: 'up' | 'down' = 'up'): LineSample[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n
    const s = twoLinkIk(l[0], l[1], a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
    return lineSample(l, u, [...s[elbow]], s.reachable)
  })

/** Unwraps joint angles along a path so steps never jump by 2π. */
export function unwrapPath(qs: readonly (readonly number[])[]): number[][] {
  const out = qs.map((q) => [...q])
  for (let k = 1; k < out.length; k++) out[k] = out[k].map((v, i) => v - 2 * Math.PI * Math.round((v - out[k - 1][i]) / (2 * Math.PI)))
  return out
}

/** Largest distance of the hand path from the straight segment a → b. */
export function lineDeviation(tips: readonly V2[], a: V2, b: V2) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const L = Math.hypot(dx, dy) || 1
  return tips.reduce((m, p) => Math.max(m, Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L), 0)
}

/** Peak |dq/du| per joint along a sampled path (rad per unit path). */
export const peakRates = (qs: readonly (readonly number[])[]) =>
  qs[0].map((_, i) => qs.slice(1).reduce((m, q, k) => Math.max(m, Math.abs(q[i] - qs[k][i]) * (qs.length - 1)), 0))

// --- Via points ---

export type ViaKind = 'linear' | 'stop' | 'spline'
export interface ViaPath { kind: ViaKind; times: number[]; segs: number[][][] }

/** Knot times 0 … T split by chord length. */
export function chordTimes(pts: readonly (readonly number[])[], T: number) {
  const d = pts.slice(1).map((p, k) => Math.hypot(...p.map((v, i) => v - pts[k][i])))
  const total = d.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  return [0, ...d.map((x) => (acc += (x / total) * T))]
}

/** Clamped C2 cubic spline knot velocities (rest at both ends): tridiagonal solve per dimension. */
export function splineVelocities(times: readonly number[], p: readonly number[], v0 = 0, vN = 0): number[] {
  const n = p.length - 1
  const v = Array(n + 1).fill(0)
  v[0] = v0
  v[n] = vN
  if (n < 2) return v
  const h = times.slice(1).map((t, k) => t - times[k])
  const [sub, dia, sup, rhs] = [[] as number[], [] as number[], [] as number[], [] as number[]]
  for (let k = 1; k < n; k++) {
    sub.push(h[k])
    dia.push(2 * (h[k - 1] + h[k]))
    sup.push(h[k - 1])
    rhs.push(3 * ((h[k - 1] / h[k]) * (p[k + 1] - p[k]) + (h[k] / h[k - 1]) * (p[k] - p[k - 1])))
  }
  rhs[0] -= sub[0] * v0
  rhs[n - 2] -= sup[n - 2] * vN
  for (let i = 1; i < n - 1; i++) {
    const m = sub[i] / dia[i - 1]
    dia[i] -= m * sup[i - 1]
    rhs[i] -= m * rhs[i - 1]
  }
  for (let i = n - 2; i >= 0; i--) v[i + 1] = (rhs[i] - (i < n - 2 ? sup[i] * v[i + 2] : 0)) / dia[i]
  return v
}

/** Path through `pts` at `times`: straight constant-speed segments, cubic rest-to-rest per segment, or one C2 spline. */
export function viaPath(kind: ViaKind, times: readonly number[], pts: readonly (readonly number[])[]): ViaPath {
  const dims = pts[0].length
  const vel = Array.from({ length: dims }, (_, i) => (kind === 'spline' ? splineVelocities(times, pts.map((p) => p[i])) : null))
  const segs = pts.slice(1).map((p1, k) => {
    const p0 = pts[k]
    const h = times[k + 1] - times[k]
    return p0.map((a, i) => {
      if (kind === 'linear') return [a, (p1[i] - a) / h]
      if (kind === 'stop') return cubicCoeffs(a, p1[i], 0, 0, h)
      return cubicCoeffs(a, p1[i], vel[i]![k], vel[i]![k + 1], h)
    })
  })
  return { kind, times: [...times], segs }
}

export function viaAt(path: ViaPath, t: number) {
  const { times, segs } = path
  const tc = Math.max(0, Math.min(times[times.length - 1], t))
  let k = 0
  while (k < segs.length - 1 && tc > times[k + 1]) k++
  const s = segs[k].map((c) => polyAt(c, tc - times[k]))
  return { p: s.map((x) => x.p), v: s.map((x) => x.v), a: s.map((x) => x.a), seg: k }
}

// --- Time scaling: s(t) from 0 to 1 along any path ---

export type ScaleKind = 'linear' | 'cubic' | 'quintic' | 'trapezoid' | 'scurve'
export interface ScaleState { s: number; sd: number; sdd: number }
export interface TimeScale { kind: ScaleKind; T: number; at: (t: number) => ScaleState }

/** Peak ṡ·T and s̈·T² of each rest-to-rest polynomial. */
const POLY_PEAKS = { cubic: { v: 1.5, a: 6 }, quintic: { v: 1.875, a: 10 / Math.sqrt(3) } }

/** Shortest s(t) whose ṡ, s̈ (and jerk, S-curve) stay within the limits; linear jumps straight to ṡ = vMax. */
export function timeScale(kind: ScaleKind, vMax: number, aMax: number, jMax = Infinity): TimeScale {
  if (!(vMax < Infinity && aMax < Infinity) && kind !== 'linear') return { kind, T: 0, at: () => ({ s: 1, sd: 0, sdd: 0 }) }
  if (kind === 'linear') {
    const T = vMax < Infinity ? 1 / vMax : 0
    return { kind, T, at: (t) => (t <= 0 ? { s: 0, sd: 0, sdd: 0 } : t >= T ? { s: 1, sd: 0, sdd: 0 } : { s: t / T, sd: 1 / T, sdd: 0 }) }
  }
  if (kind === 'cubic' || kind === 'quintic') {
    const pk = POLY_PEAKS[kind]
    const T = Math.max(pk.v / vMax, Math.sqrt(pk.a / aMax))
    const c = kind === 'cubic' ? cubicCoeffs(0, 1, 0, 0, T) : quinticCoeffs(0, 1, 0, 0, 0, 0, T)
    return {
      kind,
      T,
      at: (t) => {
        if (t <= 0) return { s: 0, sd: 0, sdd: 0 }
        if (t >= T) return { s: 1, sd: 0, sdd: 0 }
        const r = polyAt(c, t)
        return { s: r.p, sd: r.v, sdd: r.a }
      },
    }
  }
  const m = kind === 'trapezoid' ? trapezoidMove(1, vMax, aMax) : sCurveMove(1, vMax, aMax, jMax)
  return { kind, T: m.T, at: (t) => {
    const r = moveAt(m, t)
    return { s: r.p, sd: r.v, sdd: r.a }
  } }
}

/** One joint's own fastest profile for a move of `dq` under its limits. */
export const jointScale = (kind: ScaleKind, dq: number, vMax: number, aMax: number, jMax = Infinity) => {
  const d = Math.abs(dq)
  return d < 1e-12 ? timeScale(kind, Infinity, Infinity) : timeScale(kind, vMax / d, aMax / d, jMax / d)
}

/** One shared s(t) for every joint: each limit divided by that joint's travel, the tightest wins, so all joints start and finish together. */
export function syncScale(kind: ScaleKind, dq: readonly number[], vMax: readonly number[], aMax: readonly number[], jMax: readonly number[] = dq.map(() => Infinity)) {
  const per = (lim: readonly number[]) => dq.map((d, i) => (Math.abs(d) < 1e-12 ? Infinity : lim[i] / Math.abs(d)))
  const [vs, as, js] = [per(vMax), per(aMax), per(jMax)]
  const v = Math.min(...vs)
  const a = Math.min(...as)
  const scale = timeScale(kind, v, a, Math.min(...js))
  return { scale, slowest: { v: vs.indexOf(v), a: as.indexOf(a) } }
}
