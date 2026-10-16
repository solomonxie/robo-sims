// Quadcopter: X-frame mixer, thrust ∝ ω², rigid-body attitude, cascaded angle → rate loops.
import { DEG, G, clamp, weightN } from '../common'
import { Gains, PID0, Pid, pidStep } from '../control/pid'

/** 5" FPV quad on 4S: all-up mass (kg), motor-to-centre arm (m), static thrust per motor at full speed (N), full speed (rad/s),
 *  yaw torque per newton of thrust (m), inertias (kg·m²), motor spin-up lag (s), gyro filter lag (s), loop period (s), linear and rotational drag. */
export const QUAD = { mass: 0.6, arm: 0.125, tMax: 7, wMax: 2600, kM: 0.016, ixx: 0.0035, iyy: 0.0035, izz: 0.006, lag: 0.03, gyroLag: 0.008, dt: 0.002, drag: 0.4, rotDrag: 2 }
export type Quad = typeof QUAD

/** Betaflight Quad X order: x +1 front, y +1 left, spin +1 clockwise seen from above. */
export const QUAD_MOTORS = [
  { name: 'M1 rear right', x: -1, y: -1, spin: 1 },
  { name: 'M2 front right', x: 1, y: -1, spin: -1 },
  { name: 'M3 rear left', x: -1, y: 1, spin: -1 },
  { name: 'M4 front left', x: 1, y: 1, spin: 1 },
] as const

/** Stick / PID demands into the mixer, as shares of full thrust: throttle 0…1; roll > 0 banks right, pitch > 0 noses up, yaw > 0 turns clockwise from above. */
export interface Demand { throttle: number; roll: number; pitch: number; yaw: number }
/** Mixer matrix rows [throttle, roll, pitch, yaw] per motor: yaw speeds up the pair spinning against the turn. */
export const MIX = QUAD_MOTORS.map((m) => [1, m.y, m.x, -m.spin] as const)

/** Motor thrust shares 0…1 (the ESC's speed command is their square root) and which ones hit a limit.
 *  Airmode keeps the differential and shifts the collective (`shift`) so no motor clips, unless the spread itself exceeds 0…1. */
export function mix(d: Demand, airmode = false) {
  const base = MIX.map(([t, r, p, y]) => t * d.throttle + r * d.roll + p * d.pitch + y * d.yaw)
  const lo = Math.min(...base)
  const hi = Math.max(...base)
  const shift = !airmode ? 0 : hi - lo > 1 ? 0.5 - (hi + lo) / 2 : lo < 0 ? -lo : hi > 1 ? 1 - hi : 0
  const raw = base.map((v) => v + shift)
  const out = raw.map((v) => clamp(v, 0, 1))
  return { raw, out, shift, clipped: raw.map((v, i) => v !== out[i]) }
}

/** Thrust grows with the square of prop speed, T = tMax·(ω/ωmax)², so a thrust share needs speed √share. */
export const thrustOf = (share: number, q: Quad = QUAD) => q.tMax * share
export const speedShare = (share: number) => Math.sqrt(Math.max(0, share))
export const propRpm = (share: number, q: Quad = QUAD) => (speedShare(share) * q.wMax * 60) / (2 * Math.PI)
/** Throttle (thrust share) where four motors carry the weight. */
export const hoverThrottle = (mass: number, q: Quad = QUAD) => weightN(mass) / (4 * q.tMax)
export const thrustToWeight = (mass: number, q: Quad = QUAD) => (4 * q.tMax) / weightN(mass)

/** Net thrust (N) and torques (N·m; roll > 0 banks right, pitch > 0 noses up, yaw > 0 clockwise from above) from four thrusts:
 *  lever arm arm/√2 per axis, and each prop's drag torque pushes the frame the opposite way to its spin. */
export function quadWrench(thrusts: readonly number[], q: Quad = QUAD) {
  const d = q.arm / Math.SQRT2
  let roll = 0
  let pitch = 0
  let yaw = 0
  QUAD_MOTORS.forEach((m, i) => {
    roll += thrusts[i] * m.y * d
    pitch += thrusts[i] * m.x * d
    yaw -= m.spin * q.kM * thrusts[i]
  })
  return { thrust: thrusts.reduce((a, b) => a + b, 0), roll, pitch, yaw }
}

export interface QuadState { roll: number; pitch: number; yaw: number; p: number; q: number; r: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; w: number[] }
export const QUAD0: QuadState = { roll: 0, pitch: 0, yaw: 0, p: 0, q: 0, r: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, w: [0, 0, 0, 0] }
export interface Torque3 { roll: number; pitch: number; yaw: number }

/** One step of a rigid quad (small-angle attitude): motor thrust shares lag toward `cmds`, thrusts give torques plus `ext` (a gust);
 *  tilted thrust pushes it forward (x) / right (y), its vertical part against gravity (z up). */
export function quadBodyStep(s: QuadState, cmds: readonly number[], dt: number, mass = QUAD.mass, ext: Torque3 = { roll: 0, pitch: 0, yaw: 0 }, q: Quad = QUAD): QuadState {
  const w = s.w.map((v, i) => v + (clamp(cmds[i], 0, 1) - v) * Math.min(1, dt / q.lag))
  const f = quadWrench(w.map((c) => thrustOf(c, q)), q)
  const p = s.p + ((f.roll + ext.roll) / q.ixx - q.rotDrag * s.p) * dt
  const qq = s.q + ((f.pitch + ext.pitch) / q.iyy - q.rotDrag * s.q) * dt
  const r = s.r + ((f.yaw + ext.yaw) / q.izz - q.rotDrag * s.r) * dt
  const roll = s.roll + p * dt
  const pitch = s.pitch + qq * dt
  const a = f.thrust / mass
  const vx = s.vx + (-a * Math.sin(pitch) * Math.cos(roll) - q.drag * s.vx) * dt
  const vy = s.vy + (a * Math.sin(roll) - q.drag * s.vy) * dt
  const vz = s.vz + (a * Math.cos(roll) * Math.cos(pitch) - G - q.drag * s.vz) * dt
  return { roll, pitch, yaw: s.yaw + r * dt, p, q: qq, r, x: s.x + vx * dt, y: s.y + vy * dt, z: s.z + vz * dt, vx, vy, vz, w }
}

export type FlightMode = 'angle' | 'acro'
export interface AttitudeFrame { t: number; roll: number; rate: number; angleSet: number; rateSet: number; cmd: number; motors: number[]; cmds: number[]; clipped: boolean; shift: number; y: number; z: number; gust: boolean }
export interface AttitudeSetup {
  mode: FlightMode
  /** Angle loop: rate set point (°/s) per degree of angle error. */
  angleP: number
  /** Rate loop gains: mixer roll/pitch demand per °/s of rate error. */
  rate: Gains
  seconds: number
  mass?: number
  /** Roll gust torque (N·m) from `at` for `dur` s. */
  gust?: { at: number; dur: number; torque: number }
  /** Rate the pilot may ask for (°/s) and the max lean in angle mode (°). */
  rateMax?: number
  maxAngle?: number
  /** Shift the collective instead of clipping: full torque, but extra thrust. */
  airmode?: boolean
}
/** Runs angle P → rate PID (gyro) → mixer on roll and pitch (yaw: rate loop to 0), with tilt-compensated hover throttle.
 *  Acro skips the angle loop: sticks centred hold the rate at zero, not the angle. */
export function attitudeLoop(c: AttitudeSetup): AttitudeFrame[] {
  const mass = c.mass ?? QUAD.mass
  const dt = QUAD.dt
  const rateMax = c.rateMax ?? 600
  const lim = 0.5
  let s = { ...QUAD0, w: Array(4).fill(hoverThrottle(mass)) }
  let pid: Pid[] = [PID0, PID0, PID0]
  let gyro = [0, 0, 0]
  const out: AttitudeFrame[] = []
  for (let n = 0; n * dt <= c.seconds + 1e-9; n++) {
    const t = n * dt
    const sets = [s.roll, s.pitch].map((a) => (c.mode === 'angle' ? clamp(-c.angleP * (a / DEG), -rateMax, rateMax) : 0))
    gyro = gyro.map((g, i) => g + ([s.p, s.q, s.r][i] / DEG - g) * Math.min(1, dt / QUAD.gyroLag))
    pid = [sets[0], sets[1], 0].map((set, i) => pidStep(pid[i], set - gyro[i], c.rate, dt, lim))
    const throttle = hoverThrottle(mass) / Math.sqrt(Math.max(0.3, Math.cos(s.roll) * Math.cos(s.pitch)))
    const m = mix({ throttle, roll: pid[0].out, pitch: pid[1].out, yaw: pid[2].out }, !!c.airmode)
    const gust = !!c.gust && t >= c.gust.at && t < c.gust.at + c.gust.dur
    out.push({ t, roll: s.roll, rate: gyro[0] * DEG, angleSet: 0, rateSet: sets[0] * DEG, cmd: pid[0].out, motors: s.w, cmds: m.out, clipped: m.clipped.some(Boolean), shift: m.shift, y: s.y, z: s.z, gust })
    s = quadBodyStep(s, m.out, dt, mass, { roll: gust ? c.gust!.torque : 0, pitch: 0, yaw: 0 })
  }
  return out
}
/** Peak-to-peak roll over the last `window` s (a residual wobble). */
export function rollWobble(run: AttitudeFrame[], window = 1) {
  const tail = run.filter((f) => f.t > run[run.length - 1].t - window).map((f) => f.roll)
  return Math.max(...tail) - Math.min(...tail)
}
/** First time after `from` the roll stays within `band` rad. */
export function levelTime(run: AttitudeFrame[], from: number, band = 2 * DEG) {
  let last = from
  for (const f of run) if (f.t >= from && Math.abs(f.roll) > band) last = f.t
  return last >= run[run.length - 1].t - 0.05 ? null : last - from
}
