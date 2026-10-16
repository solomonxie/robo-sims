// Mecanum drive: free rollers at 45°, wheel speeds ↔ body twist (vx, vy, ω), floor forces, and a strafe run with load transfer and roller drag.
import { clamp, hash01, toDeg, wrapPi } from '../common'
import { Pose } from '../room'

const G = 9.81
export type MecLayout = 'x' | 'o'
export type Wheel4 = [number, number, number, number]
export const MEC_WHEELS = ['FL', 'FR', 'RL', 'RR'] as const
/** 60 mm wheels, 170 × 200 mm between wheel centres, 1.6 kg kit. */
export const MECANUM = { wheelR: 0.03, halfL: 0.085, halfW: 0.1, maxRim: 0.6, massKg: 1.6, inertia: 0.015, cgH: 0.05, rollers: 9 }
type MecGeo = { halfL: number; halfW: number }

/** Wheel centres (x forward, y left) and the slope tan β = ±1 of the floor roller's axle.
 *  'x' = rollers seen from above point at the centre (floor rollers form an O): the working layout. */
export function mecWheels(layout: MecLayout = 'x', g: MecGeo = MECANUM) {
  const s = layout === 'x' ? 1 : -1
  return [
    { x: g.halfL, y: g.halfW, tanB: -s },
    { x: g.halfL, y: -g.halfW, tanB: s },
    { x: -g.halfL, y: g.halfW, tanB: s },
    { x: -g.halfL, y: -g.halfW, tanB: -s },
  ]
}

/** Rim speed each wheel needs (m/s, + rolls forward) for body twist vx, vy (m/s) and ω (rad/s, CCW +). */
export const mecInverse = (vx: number, vy: number, w: number, layout: MecLayout = 'x', g: MecGeo = MECANUM) =>
  mecWheels(layout, g).map((k) => vx - w * k.y + k.tanB * (vy + w * k.x)) as Wheel4

function solve3(A: number[][], b: number[]) {
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 3; c++) {
    const p = [c, c + 1, c + 2].filter((r) => r < 3).reduce((a, r) => (Math.abs(M[r][c]) > Math.abs(M[a][c]) ? r : a), c)
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[3] / r[i])
}

/** Body twist that best fits four rim speeds (least squares), and each wheel's leftover speed it must scrub. */
export function mecForward(s: Wheel4, layout: MecLayout = 'x', g: MecGeo = MECANUM) {
  const J = mecWheels(layout, g).map((k) => [1, k.tanB, -k.y + k.tanB * k.x])
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => J.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? 1e-9 : 0)))
  const [vx, vy, w] = solve3(A, [0, 1, 2].map((i) => J.reduce((a, r, k) => a + r[i] * s[k], 0)))
  return { vx, vy, w, scrub: J.map((r, k) => s[k] - (r[0] * vx + r[1] * vy + r[2] * w)) as Wheel4 }
}

/** Twist the summed floor push drives (net force, torque), normalised so the right layout matches `mecInverse`; leftover rim speed is scrubbed. */
export function mecPushTwist(s: Wheel4, layout: MecLayout = 'x', g: MecGeo = MECANUM) {
  const ws = mecWheels(layout, g)
  const vx = s.reduce((a, v) => a + v, 0) / 4
  const vy = ws.reduce((a, k, i) => a + k.tanB * s[i], 0) / 4
  const w = ws.reduce((a, k, i) => a + (k.tanB * k.x - k.y) * s[i], 0) / (4 * (g.halfL + g.halfW) ** 2)
  return { vx, vy, w, scrub: ws.map((k, i) => s[i] - (vx + k.tanB * vy + (k.tanB * k.x - k.y) * w)) as Wheel4 }
}

/** Scale all four down together so none exceeds `max`; k is the factor applied. */
export function mecScale(s: Wheel4, max: number) {
  const k = Math.min(1, max / Math.max(...s.map(Math.abs), 1e-12))
  return { speeds: s.map((v) => v * k) as Wheel4, k }
}

/** Floor force (N, body x/y) under a wheel whose motor pushes the rim with f: only the roller's axle direction holds, its x-part balances the motor. */
export const rollerForce = (f: number, tanB: number): [number, number] => [f, f * tanB]

/** Net floor force and yaw torque on the chassis from four rim pushes. */
export function mecForceSum(f: Wheel4, layout: MecLayout = 'x', g: MecGeo = MECANUM) {
  const forces = mecWheels(layout, g).map((k, i) => rollerForce(f[i], k.tanB))
  const ws = mecWheels(layout, g)
  return {
    forces,
    fx: forces.reduce((a, v) => a + v[0], 0),
    fy: forces.reduce((a, v) => a + v[1], 0),
    tz: forces.reduce((a, v, i) => a + ws[i].x * v[1] - ws[i].y * v[0], 0),
  }
}

/** Largest push (N) before the floor gives: rubber tyres vs mecanum (each roller holds μN along its axle, cos 45° of it pushes). */
export const mecPushLimit = (mu: number, massKg: number) => ({ tyre: mu * massKg * G, mecanum: mu * massKg * G * Math.SQRT1_2 })

/** Exact pose after dt at a constant body twist. */
export function twistStep(p: Pose, vx: number, vy: number, w: number, dt: number): Pose {
  const th = p.th + w * dt
  if (Math.abs(w) < 1e-9) return { x: p.x + (vx * Math.cos(p.th) - vy * Math.sin(p.th)) * dt, y: p.y + (vx * Math.sin(p.th) + vy * Math.cos(p.th)) * dt, th }
  const [s0, c0, s1, c1] = [Math.sin(p.th), Math.cos(p.th), Math.sin(th), Math.cos(th)]
  return { x: p.x + (vx * (s1 - s0) + vy * (c1 - c0)) / w, y: p.y + (-vx * (c1 - c0) + vy * (s1 - s0)) / w, th }
}

// --- Strafe run: wheels hold their rim speed; rollers grip along the axle (≤ μN), drag along the roll; loads shift with tiles, CoG and acceleration. ---

export type MecMove = 'strafe' | 'forward' | 'diagonal'
export const MEC_RUN = { mu: 0.6, dt: 0.0005, every: 20, seconds: 3.6, dist: 0.8, vMax: 0.3, accel: 0.8, sigma0: 0.04, crr: 0.12, kp: 6, tileM: 0.2, twistM: 0.004, ripple: 0.12 }
const DIRS: Record<MecMove, [number, number]> = { strafe: [0, 1], forward: [1, 0], diagonal: [Math.SQRT1_2, Math.SQRT1_2] }

/** Floor height (m) under a point: square tiles each set ±bump. */
export const tileHeight = (x: number, y: number, bump: number) =>
  bump * (2 * hash01(Math.floor(x / MEC_RUN.tileM) * 37 + Math.floor(y / MEC_RUN.tileM) * 101 + 7) - 1)

/** Distance along the planned line at t (trapezoid speed profile). */
export function mecPlan(t: number) {
  const { dist, vMax, accel } = MEC_RUN
  const ta = vMax / accel
  const tc = (dist - vMax * ta) / vMax
  if (t <= 0) return { s: 0, v: 0 }
  if (t < ta) return { s: 0.5 * accel * t * t, v: accel * t }
  if (t < ta + tc) return { s: 0.5 * vMax * ta + vMax * (t - ta), v: vMax }
  const r = Math.min(ta, t - ta - tc)
  return { s: Math.min(dist, 0.5 * vMax * ta + vMax * tc + vMax * r - 0.5 * accel * r * r), v: Math.max(0, vMax - accel * r) }
}

/** Static wheel loads (N) for a CoG shifted forward by cogPct % of the half wheelbase. */
export const mecLoads = (cogPct: number, massKg = MECANUM.massKg): Wheel4 =>
  mecWheels().map((k) => ((massKg * G) / 4) * (1 + (cogPct / 100) * Math.sign(k.x))) as Wheel4

export interface MecFrame {
  t: number
  pose: Pose
  plan: Pose
  loads: Wheel4
  slip: Wheel4
  travel: Wheel4
}

export function mecRun(move: MecMove, bumpMm: number, cogPct: number, imu: boolean) {
  const { dt, every, seconds, sigma0, crr, kp, twistM, ripple } = MEC_RUN
  const { massKg: m, inertia, cgH, halfL: L, halfW: W, wheelR } = MECANUM
  const ws = mecWheels()
  const [dx, dy] = DIRS[move]
  const base = mecLoads(cogPct)
  const n0 = (m * G) / 4
  const cx = (cogPct / 100) * L
  const bump = bumpMm / 1000
  let p: Pose = { x: 0, y: 0, th: 0 }
  let [vx, vy, w, ax, ay] = [0, 0, 0, 0, 0]
  const travel: Wheel4 = [0, 0, 0, 0]
  const frames: MecFrame[] = []
  let lifted = 0
  let peakSlip = 0
  const steps = Math.round(seconds / dt)
  for (let k = 0; k <= steps; k++) {
    const t = k * dt
    const plan = mecPlan(t)
    const wCmd = imu ? kp * wrapPi(-p.th) : 0
    const s = mecInverse(plan.v * dx, plan.v * dy, wCmd)
    const h = ws.map((q) => {
      const c = Math.cos(p.th)
      const sn = Math.sin(p.th)
      return tileHeight(p.x + q.x * c - q.y * sn, p.y + q.x * sn + q.y * c, bump)
    })
    const twist = clamp(((h[0] + h[3] - h[1] - h[2]) / twistM) * n0, -n0 * 1.2, n0 * 1.2)
    const loads = ws.map((q, i) => {
      const shift = (-m * ax * cgH) / (4 * L) * Math.sign(q.x) - ((m * ay * cgH) / (4 * W)) * Math.sign(q.y)
      const ripple9 = 1 + ripple * Math.cos(MECANUM.rollers * (travel[i] / wheelR))
      return Math.max(0, (base[i] + shift + (i === 0 || i === 3 ? twist : -twist)) * ripple9)
    }) as Wheel4
    let [fx, fy, tz] = [0, 0, 0]
    const slip = ws.map((q, i) => {
      const r = [vx - w * q.y - s[i], vy + w * q.x]
      const sig = (r[0] + q.tanB * r[1]) * Math.SQRT1_2
      const roll = (r[0] - q.tanB * r[1]) * Math.SQRT1_2
      const fu = -MEC_RUN.mu * loads[i] * Math.tanh(sig / sigma0)
      const fn = -crr * loads[i] * Math.tanh(roll / 0.01)
      const f = [(fu + fn) * Math.SQRT1_2, (fu - fn) * q.tanB * Math.SQRT1_2]
      fx += f[0]
      fy += f[1]
      tz += (q.x - cx) * f[1] - q.y * f[0]
      travel[i] += s[i] * dt
      return Math.abs(sig)
    }) as Wheel4
    if (k % every === 0) frames.push({ t, pose: p, plan: { x: plan.s * dx, y: plan.s * dy, th: 0 }, loads, slip, travel: [...travel] as Wheel4 })
    if (Math.min(...loads) < 0.15 * n0) lifted++
    peakSlip = Math.max(peakSlip, ...slip)
    ;[ax, ay] = [fx / m, fy / m]
    vx += (ax + w * vy) * dt
    vy += (ay - w * vx) * dt
    w += (tz / inertia) * dt
    p = { x: p.x + (vx * Math.cos(p.th) - vy * Math.sin(p.th)) * dt, y: p.y + (vx * Math.sin(p.th) + vy * Math.cos(p.th)) * dt, th: p.th + w * dt }
  }
  const last = frames.at(-1)!
  const along = last.pose.x * dx + last.pose.y * dy
  const off = -last.pose.x * dy + last.pose.y * dx
  return { frames, headDeg: toDeg(wrapPi(last.pose.th)), offM: off, shortM: MEC_RUN.dist - along, liftedPct: (lifted / (steps + 1)) * 100, peakSlip }
}
