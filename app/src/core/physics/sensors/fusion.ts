// Sensor fusion: three error characters on one robot, odometry + magnetometer complementary heading, 1D Kalman filter.
import { DEG, gaussAt, wrap2pi, wrapPi } from '../common'
import { compAlpha } from './imu'
import { headingDrift, TT_TRACK_M } from './encoder'


// --- 1D Kalman filter: a mean and a variance per estimate. ---

export interface Belief {
  x: number
  P: number
}
/** Predict: move by `u`, uncertainty grows by the process variance `q`. */
export const kfPredict = (b: Belief, u: number, q: number): Belief => ({ x: b.x + u, P: b.P + q })
/** Kalman gain: how far to trust a measurement of variance `r` against a prediction of variance `P`. */
export const kfGain = (P: number, r: number) => P / (P + r)
/** Update with measurement `z` of variance `r`: move K of the way to z, shrink P by (1 − K). */
export function kfUpdate(b: Belief, z: number, r: number): Belief & { K: number } {
  const K = kfGain(b.P, r)
  return { x: b.x + K * (z - b.x), P: (1 - K) * b.P, K }
}
/** Steady-state prior variance and gain for constant `q` and `r` (P² − qP − qr = 0). */
export function kfSteady(q: number, r: number) {
  const P = (q + Math.sqrt(q * q + 4 * q * r)) / 2
  return { P, K: kfGain(P, r) }
}
export const gaussPdf = (x: number, mu: number, sigma: number) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))

export interface KfStep {
  truth: number
  prior: Belief
  z: number
  post: Belief
  K: number
}
/** A robot told to move `u` per step really moves u ± σq; a sensor reads its position ± σr. Starts known to `sigma0`. */
export function kalmanRun(sigmaQ: number, sigmaR: number, steps: number, u = 1, sigma0 = 0.2, seed = 0): KfStep[] {
  const q = sigmaQ ** 2
  const r = sigmaR ** 2
  let truth = 0
  let b: Belief = { x: 0, P: sigma0 ** 2 }
  const out: KfStep[] = []
  for (let k = 0; k < steps; k++) {
    truth += u + sigmaQ * gaussAt(seed + 2 * k)
    const prior = kfPredict(b, u, q)
    const z = truth + sigmaR * gaussAt(seed + 2 * k + 1)
    const { K, ...post } = kfUpdate(prior, z, r)
    out.push({ truth, prior, z, post, K })
    b = post
  }
  return out
}

// --- Why fuse: odometry drifts, GPS is noisy, landmark posts are exact but rare; a Kalman filter blends all three. ---

export const FUSE = { seconds: 36, dt: 0.05, posts: 5, postSigma: 0.05, odoVar: 0.02, gpsHz: 1 }
/** Robot speed (m/s) along the track at time `t`: 0.5 m/s with a gentle surge. */
const fuseSpeed = (t: number) => 0.5 + 0.18 * Math.sin(0.4 * t)
const rms = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length)

export interface FuseRun {
  t: number[]
  truth: number[]
  odo: number[]
  gps: number[]
  post: number[]
  fused: number[]
  sigma: number[]
  gpsFix: boolean[]
  postFix: boolean[]
  err: { odo: number; gps: number; post: number; fused: number }
}
/** Odometry over-reads by `slip` (fraction); GPS fixes at 1 Hz ± `gpsSigma` m; a post every 5 m pins the position. `use` picks what the filter hears besides odometry. */
export function fuseRun(slip: number, gpsSigma: number, use = { gps: true, posts: true }): FuseRun {
  const { seconds, dt, posts, postSigma, odoVar } = FUSE
  const r: FuseRun = { t: [], truth: [], odo: [], gps: [], post: [], fused: [], sigma: [], gpsFix: [], postFix: [], err: { odo: 0, gps: 0, post: 0, fused: 0 } }
  let [x, odo, gps, post] = [0, 0, 0, 0]
  let b: Belief = { x: 0, P: 0.01 }
  const every = Math.round(1 / FUSE.gpsHz / dt)
  for (let k = 1; k * dt <= seconds + 1e-9; k++) {
    const t = k * dt
    const ds = fuseSpeed(t) * dt
    const passed = Math.floor((x + ds) / posts) > Math.floor(x / posts)
    x += ds
    const dOdo = ds * (1 + slip + 0.02 * gaussAt(4 * k))
    odo += dOdo
    b = kfPredict(b, dOdo, odoVar * ds)
    const gpsFix = k % every === 0
    if (gpsFix) {
      gps = x + gpsSigma * gaussAt(4 * k + 1)
      if (use.gps) b = kfUpdate(b, gps, gpsSigma ** 2)
    }
    if (passed) {
      post = Math.floor(x / posts) * posts + postSigma * gaussAt(4 * k + 2)
      if (use.posts) b = kfUpdate(b, post, postSigma ** 2)
    }
    r.t.push(t)
    r.truth.push(x)
    r.odo.push(odo)
    r.gps.push(gps)
    r.post.push(post)
    r.fused.push(b.x)
    r.sigma.push(Math.sqrt(b.P))
    r.gpsFix.push(gpsFix)
    r.postFix.push(passed)
  }
  r.err = { odo: rms(r.odo, r.truth), gps: rms(r.gps, r.truth), post: rms(r.post, r.truth), fused: rms(r.fused, r.truth) }
  return r
}

// --- Complementary heading: wheel odometry (smooth, drifts) + magnetometer (absolute, noisy, pulled by steel). ---

export const COMP = { seconds: 44, dt: 0.02, v: 0.3, straight: 8, turn: 3, scrub: 0.04, rebar: 25 * DEG, rebarR: 0.6 }
/** Crossover frequency of a complementary filter with time constant `tau`. */
export const crossoverHz = (tau: number) => 1 / (2 * Math.PI * tau)
/** Gain of the low-pass (absolute sensor) branch at `f`. */
export const lowGain = (f: number, tau: number) => 1 / Math.hypot(1, 2 * Math.PI * f * tau)
/** Gain of the high-pass (relative sensor) branch at `f`. */
export const highGain = (f: number, tau: number) => (2 * Math.PI * f * tau) / Math.hypot(1, 2 * Math.PI * f * tau)
/** One complementary step on a wrapped angle: add the relative change, pull (1 − α) toward the absolute reading. */
export function headingBlend(h: number, dh: number, abs: number, alpha: number) {
  const p = h + dh
  return wrap2pi(p + (1 - alpha) * wrapPi(abs - p))
}
/** Turn rate (rad/s, clockwise) on the square loop: `straight` s ahead, then a 90° turn over `turn` s. */
export function loopRate(t: number) {
  const { straight, turn } = COMP
  return t % (straight + turn) >= straight ? Math.PI / 2 / turn : 0
}
/** Centre of the steel patch that bends the field, in loop metres (x east, y north). */
export const REBAR_AT = [0.57 + 1.2, 2.4 + 0.57] as const

export interface CompRun {
  t: number[]
  pos: [number, number][]
  truth: number[]
  odo: number[]
  mag: number[]
  fused: number[]
  alpha: number
  err: { odo: number; mag: number; fused: number }
}
/** Drives the loop with wheels `mismatch` apart (fraction), a compass ± `magSigma` rad, blended with time constant `tau`. */
export function compRun(tau: number, mismatch: number, magSigma: number): CompRun {
  const { seconds, dt, v, scrub, rebar, rebarR } = COMP
  const alpha = compAlpha(tau, dt)
  const r: CompRun = { t: [], pos: [], truth: [], odo: [], mag: [], fused: [], alpha, err: { odo: 0, mag: 0, fused: 0 } }
  let [x, y, h, odo, fused] = [0, 0, 0, 0, 0]
  const e = { odo: 0, mag: 0, fused: 0 }
  for (let k = 1; k * dt <= seconds + 1e-9; k++) {
    const dh = loopRate(k * dt) * dt
    h = wrap2pi(h + dh)
    x += v * dt * Math.sin(h)
    y += v * dt * Math.cos(h)
    const dOdo = dh * (1 - scrub) + headingDrift(v * dt, 1 + mismatch, TT_TRACK_M)
    odo = wrap2pi(odo + dOdo)
    const near = Math.hypot(x - REBAR_AT[0], y - REBAR_AT[1]) / rebarR
    const mag = wrap2pi(h + magSigma * gaussAt(3 * k) + rebar * Math.exp(-near * near))
    fused = headingBlend(fused, dOdo, mag, alpha)
    r.t.push(k * dt)
    r.pos.push([x, y])
    r.truth.push(h)
    r.odo.push(odo)
    r.mag.push(mag)
    r.fused.push(fused)
    e.odo += wrapPi(odo - h) ** 2
    e.mag += wrapPi(mag - h) ** 2
    e.fused += wrapPi(fused - h) ** 2
  }
  const N = r.t.length
  r.err = { odo: Math.sqrt(e.odo / N), mag: Math.sqrt(e.mag / N), fused: Math.sqrt(e.fused / N) }
  return r
}
