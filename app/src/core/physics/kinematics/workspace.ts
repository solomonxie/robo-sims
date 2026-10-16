// Workspace: reachable points by sampling joint space through FK, reach rings of a two-link arm, and dexterity (how many tool headings reach a point).
import { wrapPi } from '../common'
import { P3 } from '../room'
import { Mat4 } from '../software/urdf'
import { SerialArm, armFk, toolOf } from './chain'
import { twoLinkIk } from './ik'

/** Every joint vector on a grid: `steps[i]` evenly spaced values across `ranges[i]` (1 step = the low end). `snake`: boustrophedon order, neighbours differ in one joint by one step. */
export function jointGrid(ranges: readonly (readonly [number, number])[], steps: readonly number[], snake = false): number[][] {
  let out: number[][] = [[]]
  ranges.forEach(([lo, hi], i) => {
    const m = Math.max(1, steps[i] ?? 1)
    const vals = Array.from({ length: m }, (_, k) => (m === 1 ? lo : lo + ((hi - lo) * k) / (m - 1)))
    out = out.flatMap((q, p) => (snake && p % 2 ? [...vals].reverse() : vals).map((v) => [...q, v]))
  })
  return out
}

export interface ReachSample {
  p: P3
  q: number[]
}

export interface CloudOpts {
  /** Drops poses that hit obstacles or the table. */
  keep?: (frames: Mat4[], q: number[]) => boolean
  ranges?: readonly (readonly [number, number])[]
  snake?: boolean
}

/** Tool points over a joint grid (joint limits unless `ranges`). */
export function reachCloud(arm: SerialArm, steps: readonly number[], { keep, ranges = arm.limits, snake = false }: CloudOpts = {}): ReachSample[] {
  const out: ReachSample[] = []
  for (const q of jointGrid(ranges, steps, snake)) {
    const f = armFk(arm, q)
    if (!keep || keep(f, q)) out.push({ p: toolOf(f), q })
  }
  return out
}

/** Two-link reach ring with |θ2| ≤ q2Max: outer L1 + L2, inner √(L1² + L2² + 2·L1·L2·cos q2Max) (= |L1 − L2| when the elbow folds fully). */
export function twoLinkRadii(l1: number, l2: number, q2Max: number) {
  const c = Math.cos(Math.min(Math.PI, Math.abs(q2Max)))
  return { inner: Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 + 2 * l1 * l2 * c)), outer: l1 + l2 }
}

/** Area (2D) or volume (3D) covered: distinct `cell`-sized boxes hit × cell^dim. */
export function cellMeasure(points: readonly (readonly number[])[], cell: number): number {
  const seen = new Set<string>()
  for (const p of points) seen.add(p.map((v) => Math.floor(v / cell)).join(','))
  return seen.size * cell ** (points[0]?.length ?? 2)
}

/** Planar 3-link (shoulder, elbow, wrist) joints that put the tool at (x, y) pointing along φ, elbow-up first; null if no branch is inside `limits`. */
export function planarPoseAt(l: readonly [number, number, number], limits: readonly (readonly [number, number])[], x: number, y: number, phi: number): number[] | null {
  const s = twoLinkIk(l[0], l[1], x - l[2] * Math.cos(phi), y - l[2] * Math.sin(phi))
  if (!s.reachable) return null
  for (const [q1, q2] of [s.up, s.down]) {
    const q = [q1, q2, wrapPi(phi - q1 - q2)]
    if (q.every((v, i) => v >= limits[i][0] - 1e-9 && v <= limits[i][1] + 1e-9)) return q
  }
  return null
}

/** Joint solution per heading (null = that heading cannot reach the point). */
export const headingReach = (l: readonly [number, number, number], limits: readonly (readonly [number, number])[], x: number, y: number, headings: readonly number[]) => headings.map((phi) => planarPoseAt(l, limits, x, y, phi))

/** `k` headings spread over [from, from + sweep) (a full turn by default). */
export const headingSet = (k: number, from = -Math.PI, sweep = 2 * Math.PI) => Array.from({ length: k }, (_, i) => from + (sweep * (sweep >= 2 * Math.PI - 1e-9 ? i / k : i / Math.max(1, k - 1))))

/** Fraction of the headings that reach the point: 1 = dexterous, 0 = out of reach. */
export const dexterity = (reach: readonly (number[] | null)[]) => reach.filter(Boolean).length / Math.max(1, reach.length)

export interface DexCell {
  x: number
  y: number
  d: number
}

/** Dexterity on a square grid of pitch `cell` over |x|, |y| ≤ half; cells with d = 0 are dropped. */
export function dexterityGrid(l: readonly [number, number, number], limits: readonly (readonly [number, number])[], half: number, cell: number, headings: readonly number[], keep?: (x: number, y: number) => boolean): DexCell[] {
  const out: DexCell[] = []
  const m = Math.floor(half / cell)
  for (let i = -m; i <= m; i++)
    for (let j = -m; j <= m; j++) {
      const [x, y] = [i * cell, j * cell]
      if (Math.hypot(x, y) > l[0] + l[1] + l[2] + 1e-9 || (keep && !keep(x, y))) continue
      const d = dexterity(headingReach(l, limits, x, y, headings))
      if (d > 0) out.push({ x, y, d })
    }
  return out
}

/** Unlimited planar 3-link: radii where every heading reaches, [|L1 − L2| + L3, L1 + L2 − L3] (plus the disc r ≤ L3 − |L1 − L2| when the hand is long). */
export function dexterousBand(l1: number, l2: number, l3: number) {
  const a = Math.abs(l1 - l2)
  const b = l1 + l2
  return { inner: a + l3, outer: b - l3, empty: a + l3 > b - l3, disc: Math.max(0, Math.min(l3 - a, b - l3)) }
}
