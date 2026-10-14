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

export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Straight wire along +z through the origin, per unit μ₀I: B = ẑ × r̂ / 2πr, circling it counter-clockwise. */
export function wireField(p: Vec3): Vec3 {
  const r2 = p[0] * p[0] + p[1] * p[1]
  if (r2 === 0) return [0, 0, 0]
  return [-p[1] / (2 * Math.PI * r2), p[0] / (2 * Math.PI * r2), 0]
}

/** Complete elliptic integrals [K(m), E(m)], parameter m = k², by the arithmetic-geometric mean. */
export function ellipticKE(m: number): [number, number] {
  let a = 1
  let g = Math.sqrt(1 - m)
  let sum = m / 2
  let pow = 0.5
  for (let i = 0; i < 40 && Math.abs(a - g) > 1e-15 * a; i++) {
    const c = (a - g) / 2
    const next = (a + g) / 2
    g = Math.sqrt(a * g)
    a = next
    pow *= 2
    sum += pow * c * c
  }
  const k = Math.PI / (2 * a)
  return [k, k * (1 - sum)]
}

/** Circular current loop of radius `a` in the plane x = `x0`, centred on the x axis, current turning right-handed about +x;
 *  field per unit μ₀I (exact, from elliptic integrals). */
export function loopField(a: number, x0: number, p: Vec3): Vec3 {
  const z = p[0] - x0
  const rho = Math.hypot(p[1], p[2])
  const s = a * a + rho * rho + z * z
  const alpha2 = s - 2 * a * rho
  if (alpha2 < 1e-12) return [0, 0, 0]
  const beta2 = s + 2 * a * rho
  const [K, E] = ellipticKE(1 - alpha2 / beta2)
  const c = 1 / (2 * Math.PI * alpha2 * Math.sqrt(beta2))
  const bx = c * ((a * a - rho * rho - z * z) * E + alpha2 * K)
  if (rho < 1e-12) return [bx, 0, 0]
  const br = (c * z * (s * E - alpha2 * K)) / rho
  return [bx, (br * p[1]) / rho, (br * p[2]) / rho]
}

/** Solenoid along x centred on the origin: `loops` evenly spaced loops of radius `a` over `length`, per unit μ₀I. */
export function coilField(a: number, length: number, loops: number, p: Vec3): Vec3 {
  const b: Vec3 = [0, 0, 0]
  for (let i = 0; i < loops; i++) {
    const f = loopField(a, -length / 2 + ((i + 0.5) / loops) * length, p)
    for (let k = 0; k < 3; k++) b[k] += f[k]
  }
  return b
}

/** Lines of a field whose lines close on themselves (magnetic), one per seed in the xy plane. Each runs along the field
 *  until it comes back round to its seed or leaves the `box` (half-sizes in x and y); open ones are traced back from the
 *  seed too, so they run edge to edge. */
export function loopLines(
  field: VectorField,
  seeds: Vec3[],
  { step = 0.15, maxSteps = 1200, box = [16, 10] as [number, number] } = {},
): Vec3[][] {
  const out = (p: Vec3) => Math.abs(p[0]) > box[0] || Math.abs(p[1]) > box[1]
  return seeds.map((s) => {
    const ahead = traceLine(field, s, { step, maxSteps, stop: out, closeWithin: step })
    if (ahead.length > 1 && ahead[ahead.length - 1] === s) return ahead
    const behind = traceLine(field, s, { step, maxSteps, dir: -1, stop: out })
    return [...behind.reverse(), ...ahead.slice(1)]
  })
}
