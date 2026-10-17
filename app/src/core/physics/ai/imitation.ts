// Imitation learning: a lane-keeping demonstrator, a cloned net policy, covariate shift, noisy demos and DAgger.
import { clamp, gaussRng, parkMiller, wrapPi } from '../common'
import { Pose } from '../room'
import { Mlp, Sample, mlpInit, mlpLoss, mlpOut, mlpTrain } from './net'

export interface TrackPt { x: number; y: number; th: number; s: number; k: number }
export interface Track { pts: TrackPt[]; length: number; half: number }

/** Peanut loop: r = R (1 + e cos 2φ), driven anticlockwise; its waist bends right. */
export function peanutTrack(R = 1.2, e = 0.3, half = 0.15, n = 240): Track {
  const xy = Array.from({ length: n }, (_, i) => {
    const f = (2 * Math.PI * i) / n
    const r = R * (1 + e * Math.cos(2 * f))
    return [r * Math.cos(f), r * Math.sin(f)]
  })
  let s = 0
  const pts = xy.map(([x, y], i) => {
    const [px, py] = xy[(i + n - 1) % n]
    const [nx, ny] = xy[(i + 1) % n]
    const th = Math.atan2(ny - py, nx - px)
    const thB = Math.atan2(y - py, x - px)
    const thF = Math.atan2(ny - y, nx - x)
    const k = wrapPi(thF - thB) / (0.5 * (Math.hypot(x - px, y - py) + Math.hypot(nx - x, ny - y)))
    if (i) s += Math.hypot(x - px, y - py)
    return { x, y, th, s, k }
  })
  return { pts, length: s + Math.hypot(xy[0][0] - xy[n - 1][0], xy[0][1] - xy[n - 1][1]), half }
}

export const IL = { v: 0.4, dt: 0.05, lag: 0.15, uMax: 4, ahead: 0.25, k1: 10, k2: 4, every: 3, hidden: 8, rows: [0.1, 0.3], cells: 7, pitch: 0.03, blur: 0.02 }

/** Signed offset d (+ = left of the centreline), heading error ψ, curvature `ahead` metres on, nearest index. */
export function laneState(tr: Track, p: Pose) {
  let best = 0
  let bd = Infinity
  tr.pts.forEach((q, i) => {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    if (d < bd) [bd, best] = [d, i]
  })
  const q = tr.pts[best]
  const d = -Math.sin(q.th) * (p.x - q.x) + Math.cos(q.th) * (p.y - q.y)
  const step = tr.length / tr.pts.length
  const k = tr.pts[(best + Math.round(IL.ahead / step)) % tr.pts.length].k
  return { d, psi: wrapPi(p.th - q.th), k, i: best }
}

export type LaneState = ReturnType<typeof laneState>
/** Where the line crosses a camera row `a` metres ahead (m, + = left). */
export const lineAt = (s: LaneState, a: number) => -s.d * Math.cos(s.psi) - a * Math.tan(s.psi) + 0.5 * s.k * a * a
/** Camera strip: per row, `cells` brightness readings 0…1 of the line across ±3 pitches. */
export const laneFeatures = (s: LaneState) =>
  IL.rows.flatMap((a) => {
    const y = lineAt(s, a)
    return Array.from({ length: IL.cells }, (_, j) => Math.exp(-(((y - (j - (IL.cells - 1) / 2) * IL.pitch) / IL.blur) ** 2)))
  })
export const FEATURES = IL.rows.length * IL.cells
/** Demonstrator: curvature ahead plus PD back to the centreline (1/m). */
export const expertCurv = (s: LaneState) => clamp(s.k - IL.k1 * s.d - IL.k2 * s.psi, -IL.uMax, IL.uMax)
export const netCurv = (net: Mlp, s: LaneState) => clamp(mlpOut(net, laneFeatures(s))[0] * IL.uMax, -IL.uMax, IL.uMax)

export interface DriveCfg {
  /** Floor slip: turn-rate noise σ (rad/s). */
  slip: number
  seed: number
  /** Start index on the track. */
  start?: number
  /** Laps before stopping. */
  laps?: number
  /** Executed command = label + N(0, σ) (noise-injected demos). */
  inject?: number
}
export interface DriveStep { pose: Pose; st: LaneState; u: number; label: number }

/** Drive with `policy`, label every state with the demonstrator; stops when the robot leaves the lane. */
export function laneDrive(tr: Track, policy: (s: LaneState) => number, c: DriveCfg) {
  const g = gaussRng(parkMiller(c.seed))
  const q = tr.pts[(c.start ?? 0) % tr.pts.length]
  let pose: Pose = { x: q.x, y: q.y, th: q.th }
  let w = IL.v * q.k
  const steps: DriveStep[] = []
  const goal = (c.laps ?? 1) * tr.length
  let dist = 0
  let off = false
  while (dist < goal) {
    const st = laneState(tr, pose)
    if (Math.abs(st.d) > tr.half) {
      off = true
      break
    }
    const label = expertCurv(st)
    const u = clamp(policy(st) + (c.inject ? c.inject * g() : 0), -IL.uMax, IL.uMax)
    steps.push({ pose, st, u, label })
    w += ((IL.v * u - w) * IL.dt) / IL.lag
    const th = pose.th + (w + c.slip * g()) * IL.dt
    pose = { x: pose.x + IL.v * Math.cos(th) * IL.dt, y: pose.y + IL.v * Math.sin(th) * IL.dt, th }
    dist += IL.v * IL.dt
  }
  return { steps, dist, off, pose }
}

export const toSamples = (steps: readonly DriveStep[], every = IL.every): Sample[] =>
  steps.filter((_, i) => i % every === 0).map((f) => ({ x: laneFeatures(f.st), t: [f.label / IL.uMax] }))

/** Fit a strip → h → 1 tanh net to (camera strip → demonstrator curvature): `steps` mini-batches of 64, optionally warm-started. */
export function clonePolicy(data: readonly Sample[], seed = 3, steps = 500, from?: Mlp) {
  const batch = Math.min(64, data.length)
  const epochs = Math.max(1, Math.round((steps * batch) / Math.max(1, data.length)))
  return mlpTrain(from ?? mlpInit([FEATURES, IL.hidden, 1], ['tanh', 'linear'], seed), data, { lr: 0.3, epochs, batch, loss: 'mse', seed, snaps: 2 }).net
}

/** Demonstration laps from evenly spaced starts, demonstrator steering; `inject` widens the states it visits. */
export function demoLaps(tr: Track, laps: number, slip: number, inject = 0, seed = 100) {
  return Array.from({ length: laps }, (_, i) => laneDrive(tr, expertCurv, { slip, seed: seed + i, start: Math.round((i * tr.pts.length) / Math.max(1, laps)), inject }))
}

/** Mean |net − demonstrator| curvature (1/m) over some states. */
export const imitationGap = (net: Mlp, steps: readonly DriveStep[]) => steps.reduce((a, f) => a + Math.abs(netCurv(net, f.st) - f.label), 0) / Math.max(1, steps.length)

/** Test drives from `n` starts: share that finish the lap, mean distance (m). */
export function laneScore(tr: Track, policy: (s: LaneState) => number, slip: number, n = 4, seed = 500) {
  const runs = Array.from({ length: n }, (_, i) => laneDrive(tr, policy, { slip, seed: seed + i, start: Math.round((i * tr.pts.length) / n) }))
  return { done: runs.filter((r) => !r.off).length / n, dist: runs.reduce((a, r) => a + r.dist, 0) / n, runs }
}

export type Collect = 'more' | 'noisy' | 'dagger'
export const DEMO_SLIP = 0.15
export interface CollectRound { net: Mlp; data: Sample[]; added: DriveStep[]; loss: number }

/** Round 0: `laps` clean demos on the demo floor. */
export function firstRound(tr: Track, laps = 2): CollectRound {
  const added = demoLaps(tr, laps, DEMO_SLIP).flatMap((r) => r.steps)
  const data = toSamples(added)
  const net = clonePolicy(data)
  return { net, data, added, loss: mlpLoss(net, data, 'mse') }
}

/** Round k adds one drive: another clean demo, a noise-injected demo (label = clean action), or (DAgger) the clone driving on the test floor, relabelled by the demonstrator. */
export function nextRound(tr: Track, how: Collect, prev: CollectRound, k: number, slip: number, inject = 1.5): CollectRound {
  const start = Math.round(((k * 0.37) % 1) * tr.pts.length)
  const run =
    how === 'dagger'
      ? laneDrive(tr, (s) => netCurv(prev.net, s), { slip, seed: 300 + k, start })
      : laneDrive(tr, expertCurv, { slip: DEMO_SLIP, seed: 200 + k, start, inject: how === 'noisy' ? inject : 0 })
  const data = prev.data.concat(toSamples(run.steps))
  const net = clonePolicy(data, 3, 250, prev.net)
  return { net, data, added: run.steps, loss: mlpLoss(net, data, 'mse') }
}

export function collectRounds(tr: Track, how: Collect, rounds: number, slip: number) {
  const out = [firstRound(tr)]
  for (let k = 1; k <= rounds; k++) out.push(nextRound(tr, how, out[k - 1], k, slip))
  return out
}
