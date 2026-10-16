// Localisation on a known map: Monte Carlo localisation (particle filter, likelihood field, low-variance resampling) and ICP scan matching.
import { wrapPi } from '../common'
import { Pose, Room, castRoom, rayDir } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'
import { XY } from '../software/costmap'
import { AVOID, CLUTTER, clearance } from './avoid'
import { stepNoise } from './odometry'
import { Cov3 } from './pose'
import { filleted, routeOf } from './tracking'

/** Loop speed, step, update every `every` steps, lidar range, hit σ, random-hit floor, odometry noise (m/√m) for truth and particles. */
export const MCL = { v: 0.25, dt: 0.1, every: 2, maxM: 3.5, rangeSd: 0.02, hitSd: 0.08, zRand: 0.1, kOdo: 0.02, kPart: 0.03, cell: 0.02 }
export const MCL_LOOP = routeOf(filleted([[0.45, 1.2], [0.45, 1.9], [1.3, 1.9], [1.45, 1.55], [3.0, 1.6], [3.0, 0.35], [2.4, 0.4], [1.6, 0.7], [0.7, 0.75], [0.45, 1.0], [0.45, 1.2]], 0.25))

/** Fast seeded uniform (0, 1), Park–Miller: the filter draws ~10⁵ numbers per run, too many for the sine hash. */
export function parkMiller(seed: number) {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1
  return () => (x = (x * 48271) % 2147483647) / 2147483647
}

/** Standard normal from a uniform rng. */
export function gaussRng(rng: () => number) {
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng())
}

/** Distance to the nearest solid on a grid (< 0 inside), for O(1) likelihood lookups. */
export interface LikelihoodField {
  cell: number
  nx: number
  ny: number
  d: Float32Array
  at(x: number, y: number): number
}
const fields = new WeakMap<Room, LikelihoodField>()
export function likelihoodField(room: Room, cell = MCL.cell): LikelihoodField {
  const hit = fields.get(room)
  if (hit && hit.cell === cell) return hit
  const nx = Math.ceil(room.w / cell)
  const ny = Math.ceil(room.d / cell)
  const d = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = clearance(room, (i + 0.5) * cell, (j + 0.5) * cell)
  const at = (x: number, y: number) => {
    const i = Math.floor(x / cell)
    const j = Math.floor(y / cell)
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : d[j * nx + i]
  }
  const f = { cell, nx, ny, d, at }
  fields.set(room, f)
  return f
}

export const beamAngles = (beams: number) => Array.from({ length: beams }, (_, i) => (2 * Math.PI * i) / beams)

/** Lidar ranges at `angles` from the robot centre; `maxM` where nothing is hit; optional Gaussian noise. */
export function lidarScan(room: Room, p: Pose, angles: readonly number[], maxM = MCL.maxM, noise?: () => number, sd = MCL.rangeSd) {
  return angles.map((a) => {
    const h = castRoom(room, [p.x, p.y, AVOID.z], rayDir(p.th + a), maxM)
    return h ? Math.min(maxM - 1e-6, h.m + (noise ? sd * noise() : 0)) : maxM
  })
}

/** Log-likelihood of a scan from pose `p`: each beam end's distance to the nearest wall, Gaussian plus a random-hit floor; max-range beams skipped. */
export function scanLogLik(f: LikelihoodField, p: Pose, angles: readonly number[], ranges: readonly number[], maxM = MCL.maxM, sd = MCL.hitSd) {
  if (f.at(p.x, p.y) < AVOID.r * 0.5) return -50
  const lut = logLut(sd)
  let cs = trig.get(angles)
  if (!cs) trig.set(angles, (cs = [Float64Array.from(angles, Math.cos), Float64Array.from(angles, Math.sin)]))
  const [ca, sa] = cs
  const [c, s0] = [Math.cos(p.th), Math.sin(p.th)]
  let s = 0
  for (let k = 0; k < angles.length; k++) {
    const r = ranges[k]
    if (r >= maxM) continue
    const d = f.at(p.x + r * (c * ca[k] - s0 * sa[k]), p.y + r * (s0 * ca[k] + c * sa[k]))
    s += lut[d < 0 ? LUT_N - 1 : Math.min(LUT_N - 1, Math.floor(d / LUT_STEP + 0.5))]
  }
  return s
}
const trig = new WeakMap<readonly number[], [Float64Array, Float64Array]>()
const [LUT_STEP, LUT_MAX] = [0.002, 0.5]
const LUT_N = Math.round(LUT_MAX / LUT_STEP) + 1
const luts = new Map<number, Float64Array>()
/** log p(beam end `e` m from a wall) on a table. */
function logLut(sd: number) {
  let t = luts.get(sd)
  if (!t) {
    t = Float64Array.from({ length: LUT_N }, (_, i) => Math.log((1 - MCL.zRand) * Math.exp(-((i * LUT_STEP) ** 2) / (2 * sd * sd)) + MCL.zRand))
    luts.set(sd, t)
  }
  return t
}

/** 1 / Σw² for normalised weights: N when equal, 1 when one particle has it all. */
export const neff = (w: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < w.length; i++) s += w[i] * w[i]
  return s > 0 ? 1 / s : 0
}

/** Low-variance (systematic) resampling: one random offset `u0` ∈ [0, 1), N evenly spaced pointers through the cumulative weights. */
export function lowVarianceResample(w: ArrayLike<number>, u0: number, count = w.length): number[] {
  const out: number[] = []
  let c = w[0]
  let i = 0
  for (let m = 0; m < count; m++) {
    const u = (u0 + m) / count
    while (u > c && i < w.length - 1) c += w[++i]
    out.push(i)
  }
  return out
}

/** Weighted mean pose (circular heading) and covariance of a particle set. */
export function particleStats(x: ArrayLike<number>, y: ArrayLike<number>, th: ArrayLike<number>, w: ArrayLike<number>): { mean: Pose; P: Cov3 } {
  let [mx, my, c, s] = [0, 0, 0, 0]
  for (let i = 0; i < w.length; i++) {
    mx += w[i] * x[i]
    my += w[i] * y[i]
    c += w[i] * Math.cos(th[i])
    s += w[i] * Math.sin(th[i])
  }
  const mt = Math.atan2(s, c)
  const P: Cov3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < w.length; i++) {
    const e = [x[i] - mx, y[i] - my, wrapPi(th[i] - mt)]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) P[a][b] += w[i] * e[a] * e[b]
  }
  return { mean: { x: mx, y: my, th: mt }, P }
}

export type MclStart = 'lost' | 'known' | 'kidnap'
export interface MclFrame {
  t: number
  truth: Pose
  odo: Pose
  est: Pose
  P: Cov3
  /** x, y, θ per particle, then normalised weights. */
  px: Float32Array
  py: Float32Array
  pth: Float32Array
  w: Float32Array
  ranges: number[]
  neff: number
  resampled: boolean
  err: number
  odoErr: number
}

const step = (p: Pose, ds: number, dth: number): Pose => {
  const m = p.th + dth / 2
  return { x: p.x + ds * Math.cos(m), y: p.y + ds * Math.sin(m), th: wrapPi(p.th + dth) }
}
/** Sample (Δs, Δθ) from a 2×2 covariance (Cholesky). */
const sample2 = (Q: number[][], g: () => number): [number, number] => {
  const l11 = Math.sqrt(Math.max(0, Q[0][0]))
  const l21 = l11 > 0 ? Q[1][0] / l11 : 0
  const l22 = Math.sqrt(Math.max(0, Q[1][1] - l21 * l21))
  const [a, b] = [g(), g()]
  return [l11 * a, l21 * a + l22 * b]
}

/** Monte Carlo localisation round `MCL_LOOP` (a particle never drives into a solid): `n` particles, `beams` lidar beams, `inject` share swapped for random poses before each scan. Kidnap: the truth jumps half a loop a third of the way in. */
export function mclRun(n: number, beams: number, inject: number, start: MclStart, seed: number, room: Room = CLUTTER, loop = MCL_LOOP) {
  const rng = parkMiller(seed * 7919 + 1)
  const g = gaussRng(rng)
  const f = likelihoodField(room)
  const angles = beamAngles(beams)
  const steps = Math.ceil(loop.length / MCL.v / MCL.dt)
  const kidnapAt = start === 'kidnap' ? Math.round(steps / 3) : -1
  const truthAt = (s: number): Pose => {
    const [x, y] = loop.at(s)
    return { x, y, th: loop.dirAt(s) }
  }
  const freePose = (): Pose => {
    for (;;) {
      const p = { x: rng() * room.w, y: rng() * room.d, th: wrapPi(rng() * 2 * Math.PI) }
      if (f.at(p.x, p.y) >= AVOID.r) return p
    }
  }
  let truth = truthAt(0)
  let odo = { ...truth }
  let ps: Pose[] = Array.from({ length: n }, () => (start === 'lost' ? freePose() : { x: truth.x + 0.05 * g(), y: truth.y + 0.05 * g(), th: wrapPi(truth.th + 0.08 * g()) }))
  let w = new Float64Array(n).fill(1 / n)
  const fresh = Math.round(inject * n)
  let cursor = 0
  const frames: MclFrame[] = []
  const snap = (t: number, ranges: number[], resampled: boolean) => {
    const [px, py, pth] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    for (let k = 0; k < n; k++) [px[k], py[k], pth[k]] = [ps[k].x, ps[k].y, ps[k].th]
    const { mean, P } = particleStats(px, py, pth, w)
    frames.push({ t, truth, odo, est: mean, P, px, py, pth, w: Float32Array.from(w), ranges, neff: neff(w), resampled, err: Math.hypot(mean.x - truth.x, mean.y - truth.y), odoErr: Math.hypot(odo.x - truth.x, odo.y - truth.y) })
  }
  snap(0, lidarScan(room, truth, angles, MCL.maxM, g), false)
  let s = 0
  for (let i = 1; i <= steps; i++) {
    const s1 = i === kidnapAt ? s + loop.length / 2 : s
    const next = truthAt(s1 + MCL.v * MCL.dt)
    const ds = MCL.v * MCL.dt
    const dth = wrapPi(next.th - truthAt(s1).th)
    s = s1 + ds
    truth = next
    const half = (dth * TT_TRACK_M) / 2
    const [nS, nT] = sample2(stepNoise(ds - half, ds + half, MCL.kOdo, TT_TRACK_M, 'wheels', MCL.dt), g)
    const [mS, mT] = [ds + nS, dth + nT]
    odo = step(odo, mS, mT)
    const Q = stepNoise(mS - half, mS + half, MCL.kPart, TT_TRACK_M, 'wheels', MCL.dt)
    Q[0][0] += 0.004 ** 2
    Q[1][1] += 0.02 ** 2
    ps = ps.map((p) => {
      const [a, b] = sample2(Q, g)
      const q = step(p, mS + a, mT + b)
      return f.at(q.x, q.y) < AVOID.r * 0.5 ? { ...p, th: q.th } : q
    })
    if (i % MCL.every && i !== steps) continue
    for (let m = 0; m < fresh; m++) {
      const k = cursor++ % n
      ps[k] = freePose()
      w[k] = 1 / n
    }
    const ranges = lidarScan(room, truth, angles, MCL.maxM, g)
    const ll = ps.map((p) => scanLogLik(f, p, angles, ranges))
    const top = Math.max(...ll.map((l, k) => l + Math.log(w[k] || 1e-300)))
    let sum = 0
    for (let k = 0; k < n; k++) sum += w[k] = Math.exp(ll[k] + Math.log(w[k] || 1e-300) - top)
    for (let k = 0; k < n; k++) w[k] /= sum
    const resampled = neff(w) < n / 2
    snap(i * MCL.dt, ranges, resampled)
    if (!resampled) continue
    ps = lowVarianceResample(w, rng()).map((k) => ({ ...ps[k] }))
    w = new Float64Array(n).fill(1 / n)
  }
  return { frames, angles, kidnapT: kidnapAt < 0 ? -1 : kidnapAt * MCL.dt, tEnd: steps * MCL.dt }
}

// --- Scan matching ---

/** Points every `gap` m along every solid outline inside the room: the map a scan is matched against. */
export function mapPoints(room: Room, gap = 0.03): XY[] {
  const out: XY[] = []
  const inRoom = (x: number, y: number) => x >= -1e-6 && y >= -1e-6 && x <= room.w + 1e-6 && y <= room.d + 1e-6
  const line = (a: XY, b: XY) => {
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / gap))
    for (let i = 0; i < k; i++) {
      const p: XY = [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k]
      if (inRoom(p[0], p[1])) out.push(p)
    }
  }
  for (const s of room.solids) {
    if (s.kind === 'post') {
      const k = Math.max(6, Math.round((2 * Math.PI * s.r) / gap))
      for (let i = 0; i < k; i++) out.push([s.at[0] + s.r * Math.cos((2 * Math.PI * i) / k), s.at[1] + s.r * Math.sin((2 * Math.PI * i) / k)])
      continue
    }
    const c: XY[] = [[s.x[0], s.y[0]], [s.x[1], s.y[0]], [s.x[1], s.y[1]], [s.x[0], s.y[1]]]
    for (let i = 0; i < 4; i++) line(c[i], c[(i + 1) % 4])
  }
  return out
}

/** Lidar hits as robot-frame points (x forward, y left). */
export function scanPoints(room: Room, p: Pose, beams: number, noiseSd: number, seed: number, maxM = MCL.maxM): XY[] {
  const g = gaussRng(parkMiller(seed * 7919 + 1))
  const angles = beamAngles(beams)
  const r = lidarScan(room, p, angles, maxM, g, noiseSd)
  return angles.flatMap((a, k) => (r[k] < maxM - 1e-3 ? [[r[k] * Math.cos(a), r[k] * Math.sin(a)] as XY] : []))
}

/** Robot-frame point → world at pose `p`. */
export const scanWorld = (p: Pose, q: XY): XY => [p.x + q[0] * Math.cos(p.th) - q[1] * Math.sin(p.th), p.y + q[0] * Math.sin(p.th) + q[1] * Math.cos(p.th)]

/** Rigid 2-D fit: rotation dθ about the origin then shift (tx, ty) that best maps `a[i]` onto `b[i]` (least squares, closed form). */
export function rigidFit(a: readonly XY[], b: readonly XY[]) {
  const n = a.length
  let [ax, ay, bx, by] = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) [ax, ay, bx, by] = [ax + a[i][0] / n, ay + a[i][1] / n, bx + b[i][0] / n, by + b[i][1] / n]
  let [sxx, sxy, syx, syy] = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const [px, py, qx, qy] = [a[i][0] - ax, a[i][1] - ay, b[i][0] - bx, b[i][1] - by]
    sxx += px * qx
    sxy += px * qy
    syx += py * qx
    syy += py * qy
  }
  const dth = Math.atan2(sxy - syx, sxx + syy)
  const [c, s] = [Math.cos(dth), Math.sin(dth)]
  return { dth, tx: bx - (c * ax - s * ay), ty: by - (s * ax + c * ay) }
}

export interface IcpIter {
  pose: Pose
  /** Scan point index → matched map point index, −1 = rejected (farther than `maxD`). */
  match: Int32Array
  rms: number
  inliers: number
}
/** ICP: place the scan at the guess, pair each point with its nearest map point (≤ `maxD`), fit the rigid motion, repeat. */
export function icpRun(scan: readonly XY[], map: readonly XY[], guess: Pose, iters: number, maxD: number): IcpIter[] {
  const out: IcpIter[] = []
  let pose = { ...guess }
  for (let it = 0; it <= iters; it++) {
    const match = new Int32Array(scan.length).fill(-1)
    const [a, b]: [XY[], XY[]] = [[], []]
    let se = 0
    scan.forEach((q, i) => {
      const w = scanWorld(pose, q)
      let [best, bi] = [Infinity, -1]
      for (let j = 0; j < map.length; j++) {
        const d = (map[j][0] - w[0]) ** 2 + (map[j][1] - w[1]) ** 2
        if (d < best) [best, bi] = [d, j]
      }
      if (best > maxD * maxD) return
      match[i] = bi
      se += best
      a.push(w)
      b.push(map[bi])
    })
    out.push({ pose, match, rms: a.length ? Math.sqrt(se / a.length) : Infinity, inliers: a.length })
    if (it === iters || a.length < 3) break
    const { dth, tx, ty } = rigidFit(a, b)
    const [c, s] = [Math.cos(dth), Math.sin(dth)]
    pose = { x: c * pose.x - s * pose.y + tx, y: s * pose.x + c * pose.y + ty, th: wrapPi(pose.th + dth) }
  }
  return out
}
