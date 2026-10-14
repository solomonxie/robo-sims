// Vector-field geometry shared by electric and magnetic lessons: superposition and field-line tracing.

export type Vec3 = [number, number, number]
export type VectorField = (p: Vec3) => Vec3

export const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

/** Inverse-square field of point sources: Σ k·q·(p − at) / |p − at|³. */
export function inverseSquare(sources: { q: number; at: Vec3 }[], p: Vec3, k = 1): Vec3 {
  const e: Vec3 = [0, 0, 0]
  for (const { q, at } of sources) {
    const d: Vec3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]
    const r = norm(d)
    if (r === 0) continue
    const s = (k * q) / (r * r * r)
    for (let i = 0; i < 3; i++) e[i] += s * d[i]
  }
  return e
}

const unit = (v: Vec3): Vec3 | null => {
  const l = norm(v)
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null
}

/** Field line from `start` along the field (`dir = -1`: against it), midpoint steps of length `step`.
 *  Ends after `maxSteps`, where the field vanishes, when `stop(p)` is true, or (with `closeWithin`) when it comes back
 *  round to its start, as magnetic lines do. */
export function traceLine(
  field: VectorField,
  start: Vec3,
  { step = 0.2, maxSteps = 400, dir = 1, stop, closeWithin }: { step?: number; maxSteps?: number; dir?: 1 | -1; stop?: (p: Vec3) => boolean; closeWithin?: number } = {},
): Vec3[] {
  const pts: Vec3[] = [start]
  let p = start
  let travelled = 0
  for (let i = 0; i < maxSteps; i++) {
    const a = unit(field(p))
    if (!a) break
    const mid: Vec3 = [p[0] + (a[0] * step * dir) / 2, p[1] + (a[1] * step * dir) / 2, p[2] + (a[2] * step * dir) / 2]
    const b = unit(field(mid))
    if (!b) break
    p = [p[0] + b[0] * step * dir, p[1] + b[1] * step * dir, p[2] + b[2] * step * dir]
    pts.push(p)
    travelled += step
    if (stop?.(p)) break
    if (closeWithin && travelled > 4 * closeWithin && norm([p[0] - start[0], p[1] - start[1], p[2] - start[2]]) < closeWithin) {
      pts.push(start)
      break
    }
  }
  return pts
}

/** `n` evenly spaced points on a circle of radius `r` round `c` in the xy plane, the first at angle `a0`. */
export const ringSeeds = (c: Vec3, r: number, n: number, a0 = 0): Vec3[] =>
  Array.from({ length: n }, (_, k) => {
    const a = a0 + (k / n) * 2 * Math.PI
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]]
  })

/** Field lines of point sources in the xy plane, `perUnit` lines per unit of |q| (so line count shows charge).
 *  Each charge seeds its lines (+ traced along the field, − against it) until they reach an opposite charge or the `box`
 *  edge (half-sizes in x and y round the origin). The side with less total charge keeps only the lines that escape, the
 *  rest being already drawn from the other side. Every line runs along the field, + to −. */
export function chargeLines(
  sources: { q: number; at: Vec3 }[],
  { perUnit = 4, seedR = 0.5, step = 0.15, box = [16, 10] as [number, number], maxSteps = 600 } = {},
): Vec3[][] {
  const field = (p: Vec3) => inverseSquare(sources, p)
  const plus = sources.filter((s) => s.q > 0).reduce((a, s) => a + s.q, 0)
  const minus = sources.filter((s) => s.q < 0).reduce((a, s) => a - s.q, 0)
  const major = plus >= minus ? 1 : -1
  const lines: Vec3[][] = []
  for (const s of sources) {
    const sign = Math.sign(s.q)
    if (!sign) continue
    const sinkAt = (p: Vec3) => sources.find((o) => Math.sign(o.q) === -sign && norm([p[0] - o.at[0], p[1] - o.at[1], 0]) < seedR * 0.6)
    const stop = (p: Vec3) => Math.abs(p[0]) > box[0] || Math.abs(p[1]) > box[1] || !!sinkAt(p)
    const n = Math.round(Math.abs(s.q) * perUnit)
    for (const seed of ringSeeds(s.at, seedR, n, Math.PI / n)) {
      const line = [s.at, ...traceLine(field, seed, { step, maxSteps, dir: sign as 1 | -1, stop })]
      const sink = sinkAt(line[line.length - 1])
      if (sink && sign !== major) continue
      const full = sink ? [...line, sink.at] : line
      lines.push(sign > 0 ? full : full.reverse())
    }
  }
  return lines
}
