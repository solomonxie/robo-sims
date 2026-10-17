// Odometry: tick integration (Euler / mid-heading / exact arc), error growth (systematic vs random, Monte Carlo vs Jacobian covariance), wheel-size and track calibration.
import { DEG, gaussAt } from '../common'
import { Mat } from '../control/linalg'
import { diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { TT_TRACK_M, TT_WHEEL_MM, odoStep } from '../sensors/encoder'
import { Cov3, Leg, curvatureAt, legsLength, propagateCov, zeroCov } from './pose'

export type OdoMethod = 'euler' | 'midpoint' | 'exact'

/** One odometry update from wheel travels (m). */
export function odoIntegrate(p: Pose, dL: number, dR: number, track: number, method: OdoMethod): Pose {
  if (method === 'midpoint') return odoStep(p, dL, dR, track)
  const ds = (dL + dR) / 2
  const dth = (dR - dL) / track
  if (method === 'euler' || Math.abs(dth) < 1e-12) return { x: p.x + ds * Math.cos(p.th), y: p.y + ds * Math.sin(p.th), th: p.th + dth }
  const R = ds / dth
  const th = p.th + dth
  return { x: p.x + R * (Math.sin(th) - Math.sin(p.th)), y: p.y - R * (Math.cos(th) - Math.cos(p.th)), th }
}

/** Wheel speeds [vL, vR] to follow curvature κ at body speed v. */
export const wheelsFor = (v: number, kappa: number, track: number): [number, number] => [v * (1 - (kappa * track) / 2), v * (1 + (kappa * track) / 2)]

// --- Dead reckoning: a figure-eight then a straight, true robot on exact arcs, estimate from whole ticks at a loop rate. ---

const FIGURE_EIGHT: Leg[] = [
  { m: 2 * Math.PI * 0.4, turnDeg: 360 },
  { m: 2 * Math.PI * 0.4, turnDeg: -360 },
  { m: 0.6, turnDeg: 0 },
]
export const DR = { v: 0.3, dt: 0.002, frameS: 0.05 }
interface DrFrame {
  t: number
  truth: Pose
  est: Pose
  err: number
}
/** `hz` odometry loop rate, `cpr` ticks per wheel turn. Knots = estimate at each update; max/end error measured there (frames also show the lag between updates). */
export function deadReckonRun(hz: number, cpr: number, method: OdoMethod, legs: readonly Leg[] = FIGURE_EIGHT) {
  const tickM = (Math.PI * TT_WHEEL_MM) / 1000 / cpr
  const L = legsLength(legs)
  const tEnd = L / DR.v
  const perUpdate = Math.max(1, Math.round(1 / hz / DR.dt))
  const perFrame = Math.round(DR.frameS / DR.dt)
  let truth: Pose = { x: 0, y: 0, th: 0 }
  let est: Pose = { ...truth }
  let [aL, aR, nL, nR] = [0, 0, 0, 0]
  const frames: DrFrame[] = [{ t: 0, truth, est, err: 0 }]
  const knots: Pose[] = [est]
  const knotErr = [0]
  const steps = Math.ceil(tEnd / DR.dt)
  for (let i = 1; i <= steps; i++) {
    const [vL, vR] = wheelsFor(DR.v, curvatureAt(legs, (i - 1) * DR.dt * DR.v), TT_TRACK_M)
    truth = diffStep(truth, vL, vR, TT_TRACK_M, DR.dt)
    aL += vL * DR.dt
    aR += vR * DR.dt
    if (i % perUpdate === 0 || i === steps) {
      const [cL, cR] = [Math.trunc(aL / tickM + 1e-9), Math.trunc(aR / tickM + 1e-9)]
      est = odoIntegrate(est, (cL - nL) * tickM, (cR - nR) * tickM, TT_TRACK_M, method)
      ;[nL, nR] = [cL, cR]
      knots.push(est)
      knotErr.push(Math.hypot(truth.x - est.x, truth.y - est.y))
    }
    if (i % perFrame === 0 || i === steps) frames.push({ t: i * DR.dt, truth, est, err: Math.hypot(truth.x - est.x, truth.y - est.y) })
  }
  return { frames, knots, tickM, tEnd, maxErr: Math.max(...knotErr), endErr: knotErr.at(-1)!, headErrDeg: (truth.th - est.th) / DEG }
}

// --- Error growth: wheel noise σ² = k²|d| per wheel (random), tyre mismatch (systematic), or a gyro for heading. ---

export type HeadingSource = 'wheels' | 'gyro'
export const GYRO_ODO = { arwDps: 0.1, biasDps: 0.05, scale: 0.01 }
const GROWTH_PATH: Leg[] = [
  { m: 1.6, turnDeg: 0 },
  { m: (Math.PI / 2) * 0.3, turnDeg: 90 },
  { m: 1.0, turnDeg: 0 },
  { m: (Math.PI / 2) * 0.3, turnDeg: 90 },
  { m: 1.2, turnDeg: 0 },
]
export const GROWTH = { v: 0.3, dt: 0.02, runs: 40, every: 5 }

/** Covariance of (Δs, Δθ) for one step: wheels → k²|ΔL|, k²|ΔR| mapped through Δs, Δθ; gyro → Δθ variance from angle random walk. */
export function stepNoise(dL: number, dR: number, k: number, track: number, source: HeadingSource, dt: number): Mat {
  const [qL, qR] = [k * k * Math.abs(dL), k * k * Math.abs(dR)]
  const vs = (qL + qR) / 4
  if (source === 'gyro') return [[vs, 0], [0, (GYRO_ODO.arwDps * DEG) ** 2 * dt]]
  return [[vs, (qR - qL) / (2 * track)], [(qR - qL) / (2 * track), (qL + qR) / track ** 2]]
}

interface GrowthFrame {
  t: number
  truth: Pose
  bias: Pose
  runs: Pose[]
  P: Cov3
}
/** `kMm` wheel noise (mm/√m), `tyrePct` right tyre vs left; truth follows the path exactly, every run's estimate gets fresh noise, `bias` has none. */
export function growthRun(kMm: number, tyrePct: number, source: HeadingSource, runs = GROWTH.runs, legs: readonly Leg[] = GROWTH_PATH) {
  const kk = kMm / 1000
  const ed = 1 + tyrePct / 100
  const b = TT_TRACK_M
  const steps = Math.ceil(legsLength(legs) / GROWTH.v / GROWTH.dt)
  let truth: Pose = { x: 0, y: 0, th: 0 }
  let bias: Pose = { ...truth }
  let ests: Pose[] = Array.from({ length: runs }, () => ({ ...truth }))
  let P = zeroCov()
  const frames: GrowthFrame[] = [{ t: 0, truth, bias, runs: ests, P }]
  const sysTh = (dL: number, dR: number, dth: number) => (source === 'gyro' ? dth * (1 + GYRO_ODO.scale) + GYRO_ODO.biasDps * DEG * GROWTH.dt : (dR * ed - dL) / b)
  for (let i = 1; i <= steps; i++) {
    const [vL, vR] = wheelsFor(GROWTH.v, curvatureAt(legs, (i - 1) * GROWTH.dt * GROWTH.v), b)
    const [dL, dR] = [vL * GROWTH.dt, vR * GROWTH.dt]
    const dth = (dR - dL) / b
    truth = diffStep(truth, vL, vR, b, GROWTH.dt)
    const ds = (dL + dR * ed) / 2
    const th0 = sysTh(dL, dR, dth)
    P = propagateCov(P, bias, ds, th0, stepNoise(dL, dR, kk, b, source, GROWTH.dt))
    bias = moveBy(bias, ds, th0)
    ests = ests.map((e, r) => {
      const seed = (r * 7919 + i) * 3
      const nL = dL + kk * Math.sqrt(Math.abs(dL)) * gaussAt(seed)
      const nR = dR * ed + kk * Math.sqrt(Math.abs(dR)) * gaussAt(seed + 1)
      const h = source === 'gyro' ? th0 + GYRO_ODO.arwDps * DEG * Math.sqrt(GROWTH.dt) * gaussAt(seed + 2) : (nR - nL) / b
      return moveBy(e, (nL + nR) / 2, h)
    })
    if (i % GROWTH.every === 0 || i === steps) frames.push({ t: i * GROWTH.dt, truth, bias, runs: ests, P })
  }
  return { frames, tEnd: steps * GROWTH.dt, distM: legsLength(legs) }
}
const moveBy = (p: Pose, ds: number, dth: number): Pose => {
  const m = p.th + dth / 2
  return { x: p.x + ds * Math.cos(m), y: p.y + ds * Math.sin(m), th: p.th + dth }
}

/** Mean and RMS distance from the mean of a cloud of poses. */
export function cloudStats(ps: readonly Pose[]) {
  const mx = ps.reduce((a, p) => a + p.x, 0) / ps.length
  const my = ps.reduce((a, p) => a + p.y, 0) / ps.length
  return { mx, my, rms: Math.sqrt(ps.reduce((a, p) => a + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / ps.length) }
}

// --- Calibration: drive a measured distance or spin whole turns by odometry, measure what really happened, rescale. ---

export const CAL = { ticksPerRev: 2112, readMm: 2, readDeg: 1 }

/** Straight test: odometry assumes `nomMm`, the tyre is really `truePct` bigger. You read the tape `readMm` long (worst case). */
export function straightCal(truePct: number, distM: number, nomMm = TT_WHEEL_MM, readMm = CAL.readMm) {
  const trueMm = nomMm * (1 + truePct / 100)
  const tickNom = (Math.PI * nomMm) / 1000 / CAL.ticksPerRev
  const ticks = Math.ceil(distM / tickNom - 1e-9)
  const odoM = ticks * tickNom
  const realM = (ticks * Math.PI * trueMm) / 1000 / CAL.ticksPerRev
  const measM = realM + readMm / 1000
  const calMm = (nomMm * measM) / odoM
  return { trueMm, ticks, odoM, realM, measM, calMm, residual: calMm / trueMm - 1, after: distM * (trueMm / calMm - 1) }
}

/** Spin test: `turns` full turns in place by odometry with the coded track; the real track is `truePct` wider. You read the angle `readDeg` over (worst case). */
export function spinCal(truePct: number, turns: number, codeM = TT_TRACK_M, readDeg = CAL.readDeg) {
  const trueM = codeM * (1 + truePct / 100)
  const odoDeg = turns * 360
  const realDeg = (odoDeg * codeM) / trueM
  const measDeg = realDeg + readDeg
  const calM = (codeM * odoDeg) / measDeg
  return { trueM, odoDeg, realDeg, measDeg, calM, residual: calM / trueM - 1, after: odoDeg * (calM / trueM - 1) }
}
