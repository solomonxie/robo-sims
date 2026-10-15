// GPS: pseudoranges, least-squares position + clock bias, DOP, urban canyon, RTK carrier phase and integer fixing.
import { DEG, LIGHT_C } from '../common'
import { Vec3 } from '../../fields'
import { gaussSolve } from '../../nodal'
import { gaussAt } from '../mcu/adc'
import { wavelength } from '../signals/radio'

export const EARTH_R = 6_371e3
/** GPS orbit radius (m): ~20 200 km up, two orbits a day. */
const GPS_ORBIT_R = 26_560e3
export const L1_HZ = 1575.42e6
export const L1_LAMBDA = wavelength(L1_HZ)

/** Satellite at azimuth/elevation (°) seen from a receiver on the surface, in local (east, north, up) metres. */
export function skyPos(azDeg: number, elDeg: number): Vec3 {
  const el = elDeg * DEG
  const az = azDeg * DEG
  const r = Math.sqrt(GPS_ORBIT_R ** 2 - (EARTH_R * Math.cos(el)) ** 2) - EARTH_R * Math.sin(el)
  return [r * Math.cos(el) * Math.sin(az), r * Math.cos(el) * Math.cos(az), r * Math.sin(el)]
}

/** Signal flight time (s) from a satellite at `sat` to `rx`. */
export const flightTime = (sat: Vec3, rx: Vec3 = [0, 0, 0]) => dist(sat, rx) / LIGHT_C

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Pseudoranges: true range + c × receiver clock bias + per-satellite error (m). */
export const pseudoranges = (sats: Vec3[], rx: Vec3, biasS: number, err: number[] = []) => sats.map((s, i) => dist(s, rx) + LIGHT_C * biasS + (err[i] ?? 0))

export interface FixOpts {
  guess?: Vec3
  /** Hold the clock bias (m) instead of solving it: what a 3-satellite 3D solve has to assume. */
  bias?: number
  /** Hold the up coordinate (m): a 2D fix. */
  up?: number
  iters?: number
}
export interface FixResult {
  pos: Vec3
  /** Clock bias as a range (m); divide by `LIGHT_C` for seconds. */
  bias: number
  rms: number
  ok: boolean
}

/** Gauss–Newton least squares on ρᵢ = |sᵢ − p| + b: unknowns x, y, z, b (some may be held). */
export function solveFix(sats: Vec3[], rho: number[], o: FixOpts = {}): FixResult {
  const x = [...(o.guess ?? [0, 0, 0]), o.bias ?? 0]
  if (o.up !== undefined) x[2] = o.up
  const free = [0, 1, 2, 3].filter((k) => !(k === 2 && o.up !== undefined) && !(k === 3 && o.bias !== undefined))
  let ok = sats.length >= free.length
  for (let it = 0; ok && it < (o.iters ?? 12); it++) {
    const p: Vec3 = [x[0], x[1], x[2]]
    const H = sats.map((s) => {
      const r = dist(s, p)
      return [(p[0] - s[0]) / r, (p[1] - s[1]) / r, (p[2] - s[2]) / r, 1]
    })
    const res = sats.map((s, i) => rho[i] - dist(s, p) - x[3])
    const A = free.map((a) => free.map((b) => H.reduce((t, h) => t + h[a] * h[b], 0)))
    const dx = gaussSolve(A, free.map((a) => H.reduce((t, h, i) => t + h[a] * res[i], 0)))
    if (!dx) ok = false
    else free.forEach((k, j) => (x[k] += dx[j]))
  }
  const pos: Vec3 = [x[0], x[1], x[2]]
  const rms = Math.sqrt(sats.reduce((t, s, i) => t + (rho[i] - dist(s, pos) - x[3]) ** 2, 0) / Math.max(1, sats.length))
  return { pos, bias: x[3], rms, ok }
}

export interface Dop {
  g: number
  p: number
  h: number
  v: number
  t: number
}
const NO_DOP: Dop = { g: Infinity, p: Infinity, h: Infinity, v: Infinity, t: Infinity }

/** Dilution of precision: Q = (HᵀH)⁻¹ from the unit vectors to each satellite; σ_pos = DOP × σ_range. */
export function dop(sats: Vec3[], rx: Vec3 = [0, 0, 0]): Dop {
  if (sats.length < 4) return NO_DOP
  const H = sats.map((s) => {
    const r = dist(s, rx)
    return [(rx[0] - s[0]) / r, (rx[1] - s[1]) / r, (rx[2] - s[2]) / r, 1]
  })
  const A = [0, 1, 2, 3].map((a) => [0, 1, 2, 3].map((b) => H.reduce((t, h) => t + h[a] * h[b], 0)))
  const q: number[] = []
  for (let k = 0; k < 4; k++) {
    const col = gaussSolve(A.map((r) => [...r]), [0, 1, 2, 3].map((i) => (i === k ? 1 : 0)))
    if (!col || !col.every(Number.isFinite)) return NO_DOP
    q.push(col[k])
  }
  if (q.some((v) => v <= 0 || v > 1e6)) return NO_DOP
  return { g: Math.sqrt(q[0] + q[1] + q[2] + q[3]), p: Math.sqrt(q[0] + q[1] + q[2]), h: Math.sqrt(q[0] + q[1]), v: Math.sqrt(q[2]), t: Math.sqrt(q[3]) }
}

export type FixKind = 'none' | '2D' | '3D'
export const fixKind = (sats: number): FixKind => (sats >= 4 ? '3D' : sats === 3 ? '2D' : 'none')

/** A clear-sky constellation (PRN, azimuth °, elevation °); taking the first n keeps the geometry as spread as it can. */
export const GPS_SKY = [
  { prn: 12, az: 40, el: 72 },
  { prn: 5, az: 200, el: 38 },
  { prn: 25, az: 300, el: 30 },
  { prn: 29, az: 110, el: 24 },
  { prn: 2, az: 165, el: 55 },
  { prn: 18, az: 255, el: 62 },
  { prn: 21, az: 345, el: 48 },
  { prn: 31, az: 80, el: 15 },
  { prn: 15, az: 230, el: 12 },
  { prn: 26, az: 20, el: 22 },
]

export type SkyPath = 'direct' | 'reflected' | 'blocked'

/** A street running north–south, `streetM` wide between walls `wallM` high. A satellite below the near wall top is
 *  blocked, unless it still reaches the far wall over the near one and bounces down: then it arrives late (NLOS). */
export function canyonPath(azDeg: number, elDeg: number, streetM: number, wallM: number): { path: SkyPath; extraM: number } {
  const across = Math.abs(Math.sin(azDeg * DEG))
  const half = streetM / 2
  const t = Math.tan(elDeg * DEG)
  if (across < 1e-6 || (t * half) / across >= wallM) return { path: 'direct', extraM: 0 }
  if ((3 * t * half) / across >= wallM) return { path: 'reflected', extraM: 2 * half * Math.cos(elDeg * DEG) * across }
  return { path: 'blocked', extraM: 0 }
}

/** 1σ range errors (m). Common: shared by receivers a few km apart. Local: each receiver's own (code vs carrier). */
const GPS_ERR = {
  common: { satClock: 1.5, orbit: 1.0, iono: 4.0, tropo: 0.5 },
  code: { multipath: 0.6, noise: 0.3 },
  carrier: { multipath: 0.005, noise: 0.002 },
}
/** Common error left after differencing, per km of baseline (m/km): single-frequency ionosphere gradient. */
export const RTK_PPM = 1.5e-3
const rss = (o: Record<string, number>) => Math.sqrt(Object.values(o).reduce((t, v) => t + v * v, 0))

export type GpsMode = 'single' | 'dgps' | 'carrier'
/** User range error (1σ, m): alone, with base-station code corrections, or with carrier phase (ambiguities known). */
export function uere(mode: GpsMode, baselineKm = 0) {
  const res = RTK_PPM * baselineKm
  if (mode === 'single') return Math.hypot(rss(GPS_ERR.common), rss(GPS_ERR.code))
  return Math.hypot(res, Math.SQRT2 * rss(mode === 'dgps' ? GPS_ERR.code : GPS_ERR.carrier))
}

/** Smooth noise for satellite `i` at time `t` (s) wandering on a `tau` timescale; unit variance. */
export function wander(i: number, t: number, tau: number) {
  const u = t / tau
  const k = Math.floor(u)
  const f = (1 - Math.cos(Math.PI * (u - k))) / 2
  const a = gaussAt(7919 * i + k)
  const b = gaussAt(7919 * i + k + 1)
  return (a * (1 - f) + b * f) / Math.sqrt(f * f + (1 - f) * (1 - f))
}

export interface ParkedEpoch {
  t: number
  err: Vec3
  kind: FixKind
}
/** A parked receiver logging fixes at 1 Hz: slowly wandering range errors (+ NLOS delays) through `solveFix`. */
export function parkedFixes(sats: Vec3[], extraM: number[], seconds: number, sigma = uere('single'), tau = 40): ParkedEpoch[] {
  const kind = fixKind(sats.length)
  if (kind === 'none') return []
  const out: ParkedEpoch[] = []
  for (let t = 0; t < seconds; t++) {
    const e = sats.map((_, i) => extraM[i] + sigma * (0.9 * wander(i, t, tau) + 0.45 * gaussAt(100_003 * (i + 1) + t)))
    const r = solveFix(sats, pseudoranges(sats, [0, 0, 0], 0, e), kind === '2D' ? { up: 0 } : {})
    if (r.ok) out.push({ t, err: r.pos, kind })
  }
  return out
}

/** Distance from the origin containing `q` of the points (e.g. CEP50 at q = 0.5), horizontal only. */
export function radiusQuantile(pts: Vec3[], q: number) {
  if (!pts.length) return 0
  const r = pts.map((p) => Math.hypot(p[0], p[1])).sort((a, b) => a - b)
  return r[Math.min(r.length - 1, Math.floor(q * r.length))]
}

/** Carrier phase to a satellite: whole cycles N (unknown to the receiver) + the measured fraction. */
export function carrierCycles(rangeM: number, lambda = L1_LAMBDA) {
  const c = rangeM / lambda
  return { n: Math.floor(c), frac: c - Math.floor(c) }
}

/** Integer fixing ratio test: nearest integers vs the next-best set (worst ambiguity moved to its other neighbour). */
export function ratioTest(float: number[]) {
  const ints = float.map(Math.round)
  const r = float.map((f, i) => Math.abs(f - ints[i]))
  const best = r.reduce((t, v) => t + v * v, 0)
  const worst = Math.max(...r)
  const second = best - worst * worst + (1 - worst) ** 2
  return { ints, ratio: second / Math.max(best, 1e-12) }
}
export const RATIO_MIN = 3

export type RtkState = 'single' | 'dgps' | 'float' | 'fixed'
export interface RtkEpoch {
  t: number
  state: RtkState
  /** Horizontal 1σ (m). */
  sigma: number
  ratio: number
  /** Float ambiguity 1σ (cycles); 0 once fixed or without carrier. */
  amb: number
  err: [number, number]
}
/** Rover epochs (1 Hz). RTK starts float (ambiguities as reals, shrinking like 1/√(1 + t/τ) with τ = 1 / (5 Hz × double
 *  differences)), then fixes once the ratio test passes; baseline residual biases the floats so long baselines never fix. */
export function rtkEpochs(mode: 'single' | 'dgps' | 'rtk', baselineKm: number, seconds: number, hdop: number, sats = 8): RtkEpoch[] {
  const tau = 1 / (5 * (sats - 1))
  const res = RTK_PPM * baselineKm
  const carrier = uere('carrier', baselineKm)
  const out: RtkEpoch[] = []
  let fixed = false
  for (let t = 0; t < seconds; t++) {
    const g = (j: number) => gaussAt(31 * t + j + 5000 * (mode === 'rtk' ? 1 : mode === 'dgps' ? 2 : 3))
    let state: RtkState = mode === 'rtk' ? 'float' : mode
    let ratio = 0
    let amb = 0
    let sigma = uere(mode === 'single' ? 'single' : 'dgps', baselineKm)
    if (mode === 'rtk') {
      const ambSigma = uere('dgps', 0) / Math.sqrt(1 + t / tau) / L1_LAMBDA
      const float = Array.from({ length: sats - 1 }, (_, i) => 1000 + i + (res / L1_LAMBDA) * gaussAt(9001 + i) + ambSigma * g(i))
      ratio = ratioTest(float).ratio
      fixed ||= ratio >= RATIO_MIN && ambSigma < 0.25 && res < L1_LAMBDA / 8
      state = fixed ? 'fixed' : 'float'
      amb = fixed ? 0 : ambSigma
      sigma = fixed ? carrier : Math.hypot(carrier, ambSigma * L1_LAMBDA, res)
    }
    const s = (sigma * hdop) / Math.SQRT2
    out.push({ t, state, sigma: sigma * hdop, ratio, amb, err: [s * g(20), s * g(21)] })
  }
  return out
}
