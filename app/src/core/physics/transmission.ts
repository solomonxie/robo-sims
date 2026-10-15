// Transmission lines: characteristic impedance, velocity factor, reflections and the bounce (lattice) diagram.
const C = 299_792_458

/** Fraction of light speed a wave keeps in a dielectric of relative permittivity `er`. */
export const velocityFactor = (er: number) => 1 / Math.sqrt(er)

/** One-way delay of `meters` of line with velocity factor `vf`. */
export const lineDelay = (meters: number, vf: number) => meters / (C * vf)

/** Coax: shield inner diameter `outer`, core diameter `inner` (same units). */
export const coaxZ0 = (outer: number, inner: number, er: number) => (60 / Math.sqrt(er)) * Math.log(outer / inner)

/** Two parallel round wires of diameter `wire`, centres `spacing` apart (twisted pair, jumper pair). */
export const twinZ0 = (spacing: number, wire: number, er: number) => (120 / Math.sqrt(er)) * Math.acosh(spacing / wire)

/** Reflection coefficient Γ of load `zl` (Infinity = open) on a line of `z0`. */
export const reflection = (zl: number, z0: number) => (zl === Infinity ? 1 : (zl - z0) / (zl + z0))

/** Step launched into the line: a divider of the source resistance and Z0. */
export const launchVolts = (vs: number, rs: number, z0: number) => (vs * z0) / (rs + z0)

/** DC level the line settles to once the bounces die out. */
export const settledVolts = (vs: number, rs: number, zl: number) => (zl === Infinity ? vs : (vs * zl) / (rs + zl))

/** Longest line that still acts as a plain wire for an edge of `rise` s: about a sixth of the edge's length on the wire. */
export const criticalLength = (rise: number, vf: number) => (rise * C * vf) / 6

export interface Bounce {
  /** Leg k travels from t = k to k + 1 (in one-way delays): forward (source → load) when k is even. */
  k: number
  amp: number
  forward: boolean
}

/** The first `count` legs of the lattice diagram for source `vs` behind `rs` driving `z0` into `zl`. */
export function bounces(vs: number, rs: number, z0: number, zl: number, count: number): Bounce[] {
  const gl = reflection(zl, z0)
  const gs = reflection(rs, z0)
  let amp = launchVolts(vs, rs, z0)
  return Array.from({ length: count }, (_, k) => {
    const b = { k, amp, forward: k % 2 === 0 }
    amp *= b.forward ? gl : gs
    return b
  })
}

/** Line voltage at `x` (0 = source, 1 = load) and time `t` (one-way delays): every leg carries the source shape `s(τ)`. */
export function lineVolts(x: number, t: number, legs: Bounce[], s: (tau: number) => number) {
  let v = 0
  for (const b of legs) {
    const tau = b.forward ? t - b.k - x : t - b.k - 1 + x
    if (tau > 0) v += b.amp * s(tau)
  }
  return v
}

/** Edge with a linear rise over `rise` (same units as τ). */
export const rampShape = (rise: number) => (tau: number) => (rise <= 0 ? (tau >= 0 ? 1 : 0) : Math.min(1, Math.max(0, tau / rise)))

/** Pulse `width` long with linear edges of `edge`. */
export const pulseShape = (width: number, edge: number) => {
  const r = rampShape(edge)
  return (tau: number) => r(tau) - r(tau - width)
}

/** Time after which samples stay within `band` × `final` of `final`. */
export function settleTime(samples: number[], dt: number, final: number, band = 0.05) {
  for (let i = samples.length - 1; i >= 0; i--) if (Math.abs(samples[i] - final) > band * Math.abs(final)) return (i + 1) * dt
  return 0
}
