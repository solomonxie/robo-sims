// SLAM: keyframes from lidar odometry (scan-to-scan ICP), loop-closure detection by matching against old keyframes, 2-D pose graph by Gauss–Newton.
import { wrapPi } from '../common'
import { cholSolve } from '../control/linalg'
import { Beam, OccGrid, integrateScan, occModel, roomOccGrid } from '../perception/occupancy'
import { Pose, Room } from '../room'
import { XY } from '../software/costmap'
import { CLUTTER } from './avoid'
import { MCL_LOOP, beamAngles, gaussRng, icpRun, lidarScan, parkMiller } from './localization'

/** Drive step, keyframe gap, beams, lidar range and noise, ICP iterations and pair gate, extra drive past one lap, map cell. */
export const SLAM = { step: 0.025, kf: 0.3, beams: 120, maxM: 3.5, noise: 0.01, iters: 12, maxD: 0.2, extra: 1.0, res: 0.05, kOdo: 0.02 }

/** b expressed in a's frame (a⁻¹ ∘ b). */
export const poseBetween = (a: Pose, b: Pose): Pose => {
  const [c, s, dx, dy] = [Math.cos(a.th), Math.sin(a.th), b.x - a.x, b.y - a.y]
  return { x: c * dx + s * dy, y: -s * dx + c * dy, th: wrapPi(b.th - a.th) }
}
/** Apply relative motion d (in a's frame) to a. */
export const poseCompose = (a: Pose, d: Pose): Pose => {
  const [c, s] = [Math.cos(a.th), Math.sin(a.th)]
  return { x: a.x + c * d.x - s * d.y, y: a.y + s * d.x + c * d.y, th: wrapPi(a.th + d.th) }
}
export const poseDist = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.y - b.y)

/** Fill gaps up to `maxJump` between neighbouring scan points every `gap` m: a point-to-point target that behaves like point-to-line. */
export function densify(scan: readonly XY[], gap = 0.04, maxJump = 0.2): XY[] {
  const out: XY[] = []
  scan.forEach((a, i) => {
    out.push(a)
    const b = scan[(i + 1) % scan.length]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d > maxJump || i === scan.length - 1) return
    const k = Math.floor(d / gap)
    for (let m = 1; m < k; m++) out.push([a[0] + ((b[0] - a[0]) * m) / k, a[1] + ((b[1] - a[1]) * m) / k])
  })
  return out
}

/** ICP of `scan` onto `ref` (both robot frames): a wide pass from the guess on a coarse target, then a tight one on a fine target; rms of the tight pass. */
export function matchScans(scan: readonly XY[], ref: readonly XY[], guess: Pose, wide = SLAM.maxD, iters = SLAM.iters) {
  const a = icpRun(scan, densify(ref, 0.05), guess, iters, wide)
  const b = icpRun(scan, densify(ref, 0.015), a[a.length - 1].pose, 4, 0.06)
  const last = b[b.length - 1]
  return { pose: last.pose, rms: last.rms, frac: last.inliers / Math.max(1, scan.length), start: a[0].pose }
}

export interface Keyframe {
  truth: Pose
  wheel: Pose
  /** Chained scan-to-scan ICP estimate. */
  icp: Pose
  /** Robot-frame lidar points. */
  scan: XY[]
  /** Distance driven, m. */
  s: number
}

/** Drive one lap of `loop` plus `extra` m; wheel odometry with heading bias `drift` rad/m; a keyframe every `SLAM.kf` m with an ICP step against the last one. */
export function slamDrive(drift: number, seed: number, room: Room = CLUTTER, loop = MCL_LOOP, extra = SLAM.extra): Keyframe[] {
  const g = gaussRng(parkMiller(seed * 104729 + 3))
  const angles = beamAngles(SLAM.beams)
  const at = (s: number): Pose => {
    const [x, y] = loop.at(s)
    return { x, y, th: loop.dirAt(s) }
  }
  const scanAt = (p: Pose): XY[] => {
    const r = lidarScan(room, p, angles, SLAM.maxM, g, SLAM.noise)
    return angles.flatMap((a, k) => (r[k] < SLAM.maxM - 1e-3 ? [[r[k] * Math.cos(a), r[k] * Math.sin(a)] as XY] : []))
  }
  const t0 = at(0)
  const kfs: Keyframe[] = [{ truth: t0, wheel: t0, icp: t0, scan: scanAt(t0), s: 0 }]
  const end = loop.length + extra
  let wheel = t0
  let prev = t0
  for (let s = SLAM.step; s <= end + 1e-9; s += SLAM.step) {
    const p = at(s)
    const ds = SLAM.step
    const dth = wrapPi(p.th - prev.th) + drift * ds + SLAM.kOdo * Math.sqrt(ds) * g()
    const m = ds * (1 + 0.01 * g())
    wheel = poseCompose(wheel, { x: m * Math.cos(dth / 2), y: m * Math.sin(dth / 2), th: dth })
    prev = p
    const last = kfs[kfs.length - 1]
    if (s - last.s < SLAM.kf - 1e-9) continue
    const scan = scanAt(p)
    const guess = poseBetween(last.wheel, wheel)
    const r = matchScans(scan, last.scan, guess)
    const rel = r.frac > 0.3 ? r.pose : guess
    kfs.push({ truth: p, wheel, icp: poseCompose(last.icp, rel), scan, s })
  }
  return kfs
}

/** Lidar beams back from robot-frame points, for folding a keyframe into an occupancy grid. */
export const scanBeams = (scan: readonly XY[]): Beam[] => scan.map((q) => ({ a: Math.atan2(q[1], q[0]), m: Math.hypot(q[0], q[1]), hit: true, half: 0 }))

/** Occupancy grid from keyframes 0…`upTo` folded in at `poses`. */
export function keyframeMap(kfs: readonly Keyframe[], poses: readonly Pose[], upTo = kfs.length - 1, room: Room = CLUTTER): OccGrid {
  const g = roomOccGrid(room, SLAM.res)
  const model = occModel(0.7, 0.4, 0.97)
  for (let i = 0; i <= upTo; i++) integrateScan(g, model, poses[i], scanBeams(kfs[i].scan))
  return g
}

export interface PgEdge {
  i: number
  j: number
  /** Measured pose of j in i's frame. */
  z: Pose
  /** Information (1/σ²) on x, y and on θ. */
  wXY: number
  wTh: number
  loop: boolean
}

export interface Closure {
  i: number
  j: number
  /** Estimated distance between the two keyframes before matching. */
  gap: number
  rms: number
  frac: number
  accepted: boolean
  z: Pose
}

/** For each keyframe, test the nearest older one (≥ `minGap` keyframes back, within `radius` of the estimate) by ICP; accept below `maxRms` with ≥ `minFrac` of points paired. */
export function findClosures(kfs: readonly Keyframe[], est: readonly Pose[], radius: number, maxRms: number, minGap = 8, minFrac = 0.6): Closure[] {
  const out: Closure[] = []
  for (let i = minGap; i < kfs.length; i++) {
    let [best, bj] = [Infinity, -1]
    for (let j = 0; j <= i - minGap; j++) {
      const d = poseDist(est[i], est[j])
      if (d < best) [best, bj] = [d, j]
    }
    if (bj < 0 || best > radius) continue
    const r = matchScans(kfs[i].scan, kfs[bj].scan, poseBetween(est[bj], est[i]), Math.max(SLAM.maxD, radius * 0.8), 16)
    out.push({ i, j: bj, gap: best, rms: r.rms, frac: r.frac, accepted: r.rms < maxRms && r.frac >= minFrac, z: r.pose })
  }
  return out
}

/** Edge residual: [Rᵢᵀ(tⱼ − tᵢ) − z_t, θⱼ − θᵢ − z_θ]. */
export function edgeError(x: readonly Pose[], e: PgEdge): [number, number, number] {
  const r = poseBetween(x[e.i], x[e.j])
  return [r.x - e.z.x, r.y - e.z.y, wrapPi(r.th - e.z.th)]
}
export const chi2 = (x: readonly Pose[], edges: readonly PgEdge[]) =>
  edges.reduce((s, e) => {
    const [a, b, c] = edgeError(x, e)
    return s + e.wXY * (a * a + b * b) + e.wTh * c * c
  }, 0)

/** Gauss–Newton on a 2-D pose graph, node `fixed` held: build H = ΣJᵀΩJ, b = ΣJᵀΩe, solve H·Δ = −b, step. Poses and χ² per iteration (index 0 = start). */
export function poseGraphSolve(x0: readonly Pose[], edges: readonly PgEdge[], iters: number, fixed = 0) {
  const n = x0.length
  const poses: Pose[][] = [x0.map((p) => ({ ...p }))]
  const costs = [chi2(x0, edges)]
  for (let it = 0; it < iters; it++) {
    const x = poses[poses.length - 1]
    const H = Array.from({ length: 3 * n }, () => new Array<number>(3 * n).fill(0))
    const b = new Array<number>(3 * n).fill(0)
    for (const e of edges) {
      const [c, s] = [Math.cos(x[e.i].th), Math.sin(x[e.i].th)]
      const [dx, dy] = [x[e.j].x - x[e.i].x, x[e.j].y - x[e.i].y]
      const A = [[-c, -s, -s * dx + c * dy], [s, -c, -c * dx - s * dy], [0, 0, -1]]
      const B = [[c, s, 0], [-s, c, 0], [0, 0, 1]]
      const err = edgeError(x, e)
      const w = [e.wXY, e.wXY, e.wTh]
      const blocks: [number, number[][]][] = [[e.i, A], [e.j, B]]
      for (const [p, P] of blocks) {
        for (let a = 0; a < 3; a++) for (let r = 0; r < 3; r++) b[3 * p + a] += P[r][a] * w[r] * err[r]
        for (const [q, Q] of blocks)
          for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) for (let r = 0; r < 3; r++) H[3 * p + a][3 * q + d] += P[r][a] * w[r] * Q[r][d]
      }
    }
    for (let a = 0; a < 3; a++) H[3 * fixed + a][3 * fixed + a] += 1e9
    const d = cholSolve(H, b.map((v) => -v))
    const next = x.map((p, k) => ({ x: p.x + d[3 * k], y: p.y + d[3 * k + 1], th: wrapPi(p.th + d[3 * k + 2]) }))
    poses.push(next)
    costs.push(chi2(next, edges))
  }
  return { poses, costs }
}

/** Odometry edges between consecutive estimates plus accepted closures weighted `loopTrust` × the odometry information. */
export function slamGraph(est: readonly Pose[], closures: readonly Closure[], loopTrust: number, odoSdM = 0.02, odoSdTh = 0.02): PgEdge[] {
  const [wXY, wTh] = [1 / odoSdM ** 2, 1 / odoSdTh ** 2]
  const edges: PgEdge[] = est.slice(1).map((p, k) => ({ i: k, j: k + 1, z: poseBetween(est[k], p), wXY, wTh, loop: false }))
  for (const c of closures) if (c.accepted) edges.push({ i: c.j, j: c.i, z: c.z, wXY: wXY * loopTrust, wTh: wTh * loopTrust, loop: true })
  return edges
}
