// Differential drive: wheel speeds ↔ body twist, turn radius and ICC, exact arc steps, UMBmark square odometry, wheel slip.
import { TT_CAR, TT_GEAR } from '../actuators/dcmotor'
import { DEG, G, wrapPi } from '../common'
import { Pose } from '../room'
import { ENCODERS, TT_TRACK_M, TT_WHEEL_MM, mmPerTick, odoStep, ticksPerWheelRev } from '../sensors/encoder'

/** Body speed v (m/s) and turn rate ω (rad/s, CCW +) from wheel speeds. */
export const diffForward = (vL: number, vR: number, track: number) => ({ v: (vL + vR) / 2, w: (vR - vL) / track })
/** Wheel speeds [vL, vR] for a body v and ω. */
export const diffInverse = (v: number, w: number, track: number): [number, number] => [v - (w * track) / 2, v + (w * track) / 2]
/** Signed radius from the robot centre to the ICC (+ = centre on the left); Infinity when straight, 0 when spinning in place. */
export const turnRadius = (vL: number, vR: number, track: number) => (vR === vL ? Infinity : ((track / 2) * (vR + vL)) / (vR - vL))
/** Instantaneous centre of curvature in the world, null when driving straight. */
export function iccOf(p: Pose, vL: number, vR: number, track: number): [number, number] | null {
  const R = turnRadius(vL, vR, track)
  if (!Number.isFinite(R)) return null
  return [p.x - R * Math.sin(p.th), p.y + R * Math.cos(p.th)]
}
/** Exact pose after `dt` at constant wheel speeds: an arc about the ICC. */
export function diffStep(p: Pose, vL: number, vR: number, track: number, dt: number): Pose {
  const { v, w } = diffForward(vL, vR, track)
  if (Math.abs(w) < 1e-12) return { x: p.x + v * dt * Math.cos(p.th), y: p.y + v * dt * Math.sin(p.th), th: p.th }
  const th = p.th + w * dt
  return { x: p.x + (v / w) * (Math.sin(th) - Math.sin(p.th)), y: p.y - (v / w) * (Math.cos(th) - Math.cos(p.th)), th }
}

// --- UMBmark: drive a square by the robot's own odometry; the true robot has slightly wrong wheels/track. ---

export const UMB = {
  sideM: 1,
  v: 0.2,
  spinV: 0.08,
  dt: 0.01,
  every: 5,
  tickMm: mmPerTick(TT_WHEEL_MM, ticksPerWheelRev(ENCODERS.hall.ppr, 4, TT_GEAR)),
}
export interface SquareFrame {
  t: number
  truth: Pose
  est: Pose
  ticks: [number, number]
  leg: number
}
/** `edPct`: right wheel diameter vs left (%); `ebPct`: true track vs the value in code (%). Laps end with error = truth − estimate. */
export function squareRun(edPct: number, ebPct: number, cw: boolean, laps: number) {
  const ed = 1 + edPct / 100
  const D = TT_WHEEL_MM / 1000
  const dL = (D * 2) / (ed + 1)
  const dR = (D * 2 * ed) / (ed + 1)
  const bTrue = TT_TRACK_M * (1 + ebPct / 100)
  const perRev = (Math.PI * TT_WHEEL_MM) / UMB.tickMm
  const turn = cw ? -1 : 1
  let truth: Pose = { x: 0, y: 0, th: 0 }
  let est: Pose = { ...truth }
  let aL = 0
  let aR = 0
  let ticks: [number, number] = [0, 0]
  let leg = 0
  let legStart: Pose = est
  let t = 0
  const frames: SquareFrame[] = [{ t, truth, est, ticks, leg }]
  const ends: { distM: number; headDeg: number }[] = []
  for (let i = 0; leg < laps * 8 && i < 1e6; i++) {
    const straight = leg % 2 === 0
    const wv = straight ? [UMB.v, UMB.v] : [-turn * UMB.spinV, turn * UMB.spinV]
    const wl = wv[0] / (D / 2)
    const wr = wv[1] / (D / 2)
    aL += wl * UMB.dt
    aR += wr * UMB.dt
    truth = diffStep(truth, (wl * dL) / 2, (wr * dR) / 2, bTrue, UMB.dt)
    const nt: [number, number] = [Math.trunc((aL / (2 * Math.PI)) * perRev), Math.trunc((aR / (2 * Math.PI)) * perRev)]
    est = odoStep(est, ((nt[0] - ticks[0]) * UMB.tickMm) / 1000, ((nt[1] - ticks[1]) * UMB.tickMm) / 1000, TT_TRACK_M)
    ticks = nt
    t += UMB.dt
    const done = straight ? Math.hypot(est.x - legStart.x, est.y - legStart.y) >= UMB.sideM : Math.abs(est.th - legStart.th) >= 90 * DEG
    if (done) {
      leg++
      legStart = est
      if (leg % 8 === 0) ends.push(squareError(truth, est))
    }
    if (done || i % UMB.every === 0) frames.push({ t, truth, est, ticks, leg })
  }
  return { frames, ends, distM: laps * 4 * UMB.sideM }
}
export const squareError = (truth: Pose, est: Pose) => ({ distM: Math.hypot(truth.x - est.x, truth.y - est.y), headDeg: wrapPi(truth.th - est.th) / DEG })

// --- Slip: wheels as stiff speed sources, rubber–floor friction saturating at μ·N, a caster that only drags. ---

export const FLOORS = {
  carpet: { name: 'Carpet', mu: 0.9 },
  wood: { name: 'Wood floor', mu: 0.6 },
  tile: { name: 'Polished tile', mu: 0.35 },
  dusty: { name: 'Dusty tile', mu: 0.2 },
}
export type FloorKind = keyof typeof FLOORS
export type SlipMove = 'launch' | 'turn' | 'spin'
export const SLIP = { massKg: TT_CAR.massKg, inertia: 0.0031, casterX: -0.08, casterCrr: 0.06, v0: 0.01, dt: 0.0005, every: 20, seconds: 3.6, uTurnR: 0.1, uTurnS: (Math.PI * 0.1) / 0.45 }
/** Largest acceleration the drive wheels can give before they spin. */
export const gripAccel = (mu: number, casterShare: number) => mu * G * (1 - casterShare)

/** Wheel surface speeds the motors aim for at time t. */
function slipTarget(move: SlipMove, t: number): [number, number] {
  if (move === 'launch') return t < 1.6 ? [0.5, 0.5] : [0, 0]
  if (move === 'spin') return t > 0.2 && t < 2.4 ? [-0.3, 0.3] : [0, 0]
  if (t < 0.9) return [0.45, 0.45]
  if (t < 0.9 + SLIP.uTurnS) return diffInverse(0.45, 0.45 / SLIP.uTurnR, TT_TRACK_M)
  return t < 2.6 ? [0.45, 0.45] : [0, 0]
}
export interface SlipFrame {
  t: number
  truth: Pose
  est: Pose
  speeds: [number, number]
  travel: [number, number]
  slip: [number, number]
}
const friction = (sx: number, sy: number, cap: number): [number, number] => {
  const m = Math.hypot(sx, sy)
  if (m < 1e-12) return [0, 0]
  const f = (cap * Math.tanh(m / SLIP.v0)) / m
  return [f * sx, f * sy]
}
/** Ramped wheel commands (accel limit, m/s²) on a floor of friction `mu`; truth from body dynamics, estimate from wheel travel. */
export function slipRun(move: SlipMove, mu: number, accel: number, casterShare: number) {
  const W = SLIP.massKg * G
  const nWheel = (W * (1 - casterShare)) / 2
  const nCaster = W * casterShare
  const half = TT_TRACK_M / 2
  let truth: Pose = { x: 0, y: 0, th: 0 }
  let est: Pose = { ...truth }
  let vx = 0
  let vy = 0
  let w = 0
  const s: [number, number] = [0, 0]
  const travel: [number, number] = [0, 0]
  const frames: SlipFrame[] = []
  let peak = 0
  const steps = Math.round(SLIP.seconds / SLIP.dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * SLIP.dt
    const goal = slipTarget(move, t)
    for (const k of [0, 1]) s[k] += Math.max(-accel * SLIP.dt, Math.min(accel * SLIP.dt, goal[k] - s[k]))
    const slip: [number, number] = [0, 0]
    let fx = 0
    let fy = 0
    let tz = 0
    ;[half, -half].forEach((y, k) => {
      const sx = s[k] - (vx - w * y)
      const sy = -vy
      slip[k] = Math.hypot(sx, sy)
      const [ax, ay] = friction(sx, sy, mu * nWheel)
      fx += ax
      fy += ay
      tz += -y * ax
    })
    const [cx, cy] = friction(-vx, -(vy + w * SLIP.casterX), SLIP.casterCrr * nCaster)
    fx += cx
    fy += cy
    tz += SLIP.casterX * cy
    peak = Math.max(peak, ...slip)
    if (i % SLIP.every === 0) frames.push({ t, truth, est, speeds: [s[0], s[1]], travel: [travel[0], travel[1]], slip })
    vx += (fx / SLIP.massKg + w * vy) * SLIP.dt
    vy += (fy / SLIP.massKg - w * vx) * SLIP.dt
    w += (tz / SLIP.inertia) * SLIP.dt
    const c = Math.cos(truth.th)
    const sn = Math.sin(truth.th)
    truth = { x: truth.x + (vx * c - vy * sn) * SLIP.dt, y: truth.y + (vx * sn + vy * c) * SLIP.dt, th: truth.th + w * SLIP.dt }
    est = odoStep(est, s[0] * SLIP.dt, s[1] * SLIP.dt, TT_TRACK_M)
    travel[0] += s[0] * SLIP.dt
    travel[1] += s[1] * SLIP.dt
  }
  return { frames, peakSlip: peak, end: squareError(truth, est), truthEnd: truth, estEnd: est }
}
