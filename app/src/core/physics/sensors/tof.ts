// Laser time of flight: VL53L0X single-zone ranging (photon counts, sigma, limits) and VL53L5CX-style multi-zone depth grids.
import { speedOfSound } from './ultrasonic'

export const LIGHT_C = 299_792_458

/** Out and back at the speed of light. */
export const lightRoundTrip = (m: number) => (2 * m) / LIGHT_C
/** How many times faster than sound (≈ 10⁶ × at room temperature). */
export const lightVsSound = (tempC = 20) => LIGHT_C / speedOfSound(tempC)

/** VL53L0X: 940 nm VCSEL, 25° cone, I²C 0x29. `k` = return rate in Mcps from a 100 % target at 1 m;
 *  `ambPerKlux` ambient Mcps per klux; `countsPer` SPAD counts per Mcps·ms; `pulseMm` = c·τ/2 for a ~3 ns pulse. */
export const VL53L0X = { nm: 940, fovDeg: 25, addr: 0x29, k: 0.41, ambPerKlux: 0.25, countsPer: 100, pulseMm: 450, maxM: 2, outOfRange: 8190 }

/** ST's ranging profiles: timing budget, minimum return rate, sigma limit. */
export const TOF_MODES = {
  default: { name: 'Default', budgetMs: 33, minMcps: 0.25, sigmaMm: 18 },
  fast: { name: 'High speed', budgetMs: 20, minMcps: 0.25, sigmaMm: 32 },
  accurate: { name: 'High accuracy', budgetMs: 200, minMcps: 0.25, sigmaMm: 18 },
  long: { name: 'Long range', budgetMs: 33, minMcps: 0.1, sigmaMm: 60 },
}
export type TofMode = keyof typeof TOF_MODES

/** ST's test targets: 88 % white, 17 % grey; 5 % for black cloth. */
export const TOF_TARGETS = { white: 0.88, grey: 0.17, black: 0.05 }
export type TofTarget = keyof typeof TOF_TARGETS

/** Return photon rate (Mcps): ∝ reflectance / d². */
export const signalMcps = (m: number, refl: number) => (VL53L0X.k * refl) / Math.max(m, 0.01) ** 2
export const ambientMcps = (klux: number) => VL53L0X.ambPerKlux * klux
export const spadCounts = (mcps: number, budgetMs: number) => mcps * budgetMs * VL53L0X.countsPer

/** Range noise: pulse width / √N, widened by ambient shot noise. */
export const sigmaMm = (sigCounts: number, ambCounts: number) => (VL53L0X.pulseMm * Math.sqrt(sigCounts + 2 * ambCounts)) / Math.max(sigCounts, 1e-9)

/** One ranging: RangeStatus 0 valid, 1 sigma fail, 2 signal fail, 4 out of range (phase). */
export function tofRanging(m: number, refl: number, klux: number, mode: TofMode) {
  const M = TOF_MODES[mode]
  const sig = signalMcps(m, refl)
  const amb = ambientMcps(klux)
  const ns = spadCounts(sig, M.budgetMs)
  const na = spadCounts(amb, M.budgetMs)
  const sigma = sigmaMm(ns, na)
  const status = m > VL53L0X.maxM ? 4 : sig < M.minMcps ? 2 : sigma > M.sigmaMm ? 1 : 0
  return { sig, amb, ns, na, sigma, status, ok: status === 0, tripS: lightRoundTrip(m), hz: 1000 / M.budgetMs }
}

/** Furthest valid range (m) for this target, light and mode. */
export function tofMaxRange(refl: number, klux: number, mode: TofMode) {
  let lo = 0.01
  let hi = VL53L0X.maxM
  if (tofRanging(hi, refl, klux, mode).ok) return hi
  if (!tofRanging(lo, refl, klux, mode).ok) return 0
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (tofRanging(mid, refl, klux, mode).ok) lo = mid
    else hi = mid
  }
  return lo
}

/** Reported mm: true range plus `z` standard deviations of noise, or the out-of-range code. */
export const reportedMm = (m: number, sigma: number, ok: boolean, z: number) => (ok ? Math.round(m * 1000 + z * sigma) : VL53L0X.outOfRange)

/** SPAD arrival-time histogram over `windowNs` in `bins`: flat ambient plus a Gaussian peak at the round trip (expected counts). */
export function arrivalHistogram(m: number, refl: number, klux: number, mode: TofMode, bins = 64, windowNs = 16) {
  const R = tofRanging(m, refl, klux, mode)
  const w = windowNs / bins
  const tau = (2 * VL53L0X.pulseMm) / 1000 / LIGHT_C * 1e9 / 2.355
  const peak = R.tripS * 1e9
  return Array.from({ length: bins }, (_, i) => {
    const t = (i + 0.5) * w
    return R.na / bins + R.ns * (w / (tau * Math.sqrt(2 * Math.PI))) * Math.exp(-(((t - peak) / tau) ** 2) / 2)
  })
}

// --- Multi-zone: 4×4 or 8×8 zones over a 45° square field of view. ---

/** VL53L5CX: 45° × 45°, up to 4 m; 4×4 at 60 Hz, 8×8 at 15 Hz. */
export const VL53L5CX = { fovDeg: 45, maxM: 4, hz: { 4: 60, 8: 15 } as Record<number, number>, addr: 0x29, firmwareKb: 84 }

/** Zone width (m) at distance `m`. */
export const zoneWidth = (m: number, res: number, fovDeg = VL53L5CX.fovDeg) => 2 * m * Math.tan((fovDeg * Math.PI) / 360 / res)

/** Robot-frame scene: x forward, y left, z up; boxes are axis-aligned, posts vertical cylinders, floor at z = 0. */
export type Solid = { kind: 'box'; name: string; x: [number, number]; y: [number, number]; h: number } | { kind: 'post'; name: string; at: [number, number]; r: number; h: number }
export interface ZoneScene {
  solids: Solid[]
  /** Sensor height above the floor and upward tilt (rad). */
  height: number
  tilt: number
}
export interface Zone {
  m: number | null
  what: string | null
}

/** Ray (from the sensor) distance to one solid, or Infinity. */
function hitSolid(o: [number, number, number], d: [number, number, number], s: Solid) {
  if (s.kind === 'box') {
    let t0 = 0
    let t1 = Infinity
    const lo = [s.x[0], s.y[0], 0]
    const hi = [s.x[1], s.y[1], s.h]
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < lo[a] || o[a] > hi[a]) return Infinity
        continue
      }
      const u = (lo[a] - o[a]) / d[a]
      const v = (hi[a] - o[a]) / d[a]
      t0 = Math.max(t0, Math.min(u, v))
      t1 = Math.min(t1, Math.max(u, v))
    }
    return t0 <= t1 ? t0 : Infinity
  }
  const px = o[0] - s.at[0]
  const py = o[1] - s.at[1]
  const a = d[0] ** 2 + d[1] ** 2
  const b = 2 * (px * d[0] + py * d[1])
  const c = px ** 2 + py ** 2 - s.r ** 2
  const disc = b * b - 4 * a * c
  if (a < 1e-12 || disc < 0) return Infinity
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  const z = o[2] + t * d[2]
  return t > 0 && z >= 0 && z <= s.h ? t : Infinity
}

/** Ray direction for angles (rad) right of and above the sensor axis, after tilt. */
export function zoneRay(right: number, up: number, tilt: number): [number, number, number] {
  const e = up + tilt
  const v: [number, number, number] = [Math.cos(e) * Math.cos(right), -Math.sin(right) * Math.cos(e), Math.sin(e)]
  const n = Math.hypot(...v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** Nearest hit along a ray: distance and what (floor included). */
export function castRay(sc: ZoneScene, d: [number, number, number]) {
  const o: [number, number, number] = [0, 0, sc.height]
  let best = { m: Infinity, what: null as string | null }
  for (const s of sc.solids) {
    const t = hitSolid(o, d, s)
    if (t < best.m) best = { m: t, what: s.name }
  }
  if (d[2] < 0) {
    const t = -sc.height / d[2]
    if (t < best.m) best = { m: t, what: 'floor' }
  }
  return best
}

/** `res`×`res` zones, row 0 = top, column 0 = left. Each zone casts `sub`² rays and reports the nearest target
 *  covering ≥ 25 % of it (mean of its rays), like the sensor's "closest" target order; beyond range → null. */
export function zoneGrid(sc: ZoneScene, res: number, sub = 4, fovDeg = VL53L5CX.fovDeg, maxM = VL53L5CX.maxM): Zone[][] {
  const half = (fovDeg * Math.PI) / 360
  const step = (2 * half) / res
  return Array.from({ length: res }, (_r, r) =>
    Array.from({ length: res }, (_, c) => {
      const hits = new Map<string, number[]>()
      for (let i = 0; i < sub; i++)
        for (let j = 0; j < sub; j++) {
          const right = -half + (c + (j + 0.5) / sub) * step
          const up = half - (r + (i + 0.5) / sub) * step
          const h = castRay(sc, zoneRay(right, up, sc.tilt))
          if (h.what && h.m <= maxM) hits.set(h.what, [...(hits.get(h.what) ?? []), h.m])
        }
      const found = [...hits.entries()]
        .filter(([, ms]) => ms.length >= (sub * sub) / 4)
        .map(([what, ms]) => ({ what, m: ms.reduce((a, b) => a + b, 0) / ms.length }))
        .sort((a, b) => a.m - b.m)[0]
      return found ?? { m: null, what: null }
    }),
  )
}

/** Steer from a depth grid, ignoring floor zones: stop if anything is within `stopM`, else turn toward the
 *  half (left/right columns) whose nearest obstacle is further, or go ahead if the middle columns are clear past `clearM`. */
export function steerFrom(grid: Zone[][], stopM = 0.25, clearM = 0.8) {
  const res = grid.length
  const near = (c0: number, c1: number) => {
    let m = Infinity
    for (const row of grid) for (let c = c0; c < c1; c++) if (row[c].m !== null && row[c].what !== 'floor') m = Math.min(m, row[c].m!)
    return m
  }
  const all = near(0, res)
  const mid = near(Math.floor(res / 4), Math.ceil((3 * res) / 4))
  const left = near(0, res / 2)
  const right = near(res / 2, res)
  const action = all < stopM ? 'stop' : mid >= clearM ? 'ahead' : left > right ? 'left' : 'right'
  return { action, nearest: all, left, right }
}
