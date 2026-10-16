// Two-link arm dynamics in a vertical plane (x forward, y up): M(q)q̈ + C(q,q̇)q̇ + g(q) = τ from Lagrange, forward simulation, inverse dynamics, tracking, payload limits.
import { TT_INERTIA } from '../actuators/dcmotor'
import { Drive } from '../actuators/sizing'
import { G } from '../common'
import { PID_MEM0, PidMem, pidTick } from '../control/pid'
import { ARM_BUILD, ARM_SERVOS, ArmBuild, armMasses } from './armbuild'
import { SERVO_ARM_DIMS } from './chain'
import { polyAt, quinticCoeffs } from './trajectory'
import { V2 } from './transforms'

/** Lumped link: mass, joint-to-COM distance, inertia about the COM. */
export interface Link { m: number; lc: number; I: number }
export interface TwoLink {
  l1: number
  l2: number
  links: [Link, Link]
  /** Motor rotor inertia seen at each joint (J·N²). */
  rotor: [number, number]
  /** Viscous friction per joint, N·m per rad/s. */
  damping: [number, number]
}
export interface PointMass { kg: number; r: number }

/** Point masses at distance r along a link → mass, COM, inertia about the COM. */
export function lumpLink(pts: readonly PointMass[]): Link {
  const m = pts.reduce((s, p) => s + p.kg, 0)
  if (m <= 0) return { m: 0, lc: 0, I: 0 }
  const lc = pts.reduce((s, p) => s + p.kg * p.r, 0) / m
  return { m, lc, I: pts.reduce((s, p) => s + p.kg * (p.r - lc) ** 2, 0) }
}

/** Reflected inertia: a rotor J behind an N:1 gearbox feels like J·N² at the output. */
export const reflectedInertia = (rotorKgM2: number, ratio: number) => rotorKgM2 * ratio * ratio

/** MG996R: assumed ≈ 1:250 spur train, rotor about a TT motor's. */
export const SERVO_GEAR = { ratio: 250, rotorKgM2: TT_INERTIA }

/** Shoulder + elbow of the servo arm build in its vertical plane, wrist locked straight (hand counted in the forearm). */
export function servoTwoLink(payloadKg: number, opts: { ratio?: number; damping?: number; b?: ArmBuild } = {}): { arm: TwoLink; points: [PointMass[], PointMass[]] } {
  const { ratio = SERVO_GEAR.ratio, damping = 0.02, b = ARM_BUILD } = opts
  const { upper, fore, hand } = SERVO_ARM_DIMS
  const pts: [PointMass[], PointMass[]] = [[], []]
  armMasses([0, 0, 0, 0], payloadKg, b)
    .filter((p) => p.link >= 2)
    .forEach((p) => (p.link === 2 ? pts[0].push({ kg: p.kg, r: p.at[0] }) : pts[1].push({ kg: p.kg, r: p.at[0] - upper })))
  const jr = reflectedInertia(SERVO_GEAR.rotorKgM2, ratio)
  return { arm: { l1: upper, l2: fore + hand, links: [lumpLink(pts[0]), lumpLink(pts[1])], rotor: [jr, jr], damping: [damping, damping] }, points: pts }
}

export const SERVO_DRIVES: [Drive, Drive] = [ARM_SERVOS.mg996r, ARM_SERVOS.mg996r]

/** Joint-space inertia: M11 = m1·lc1² + I1 + m2(l1² + lc2² + 2·l1·lc2·cos q2) + I2, M12 = m2(lc2² + l1·lc2·cos q2) + I2, M22 = m2·lc2² + I2; rotors on the diagonal. */
export function massMatrix(a: TwoLink, q: readonly number[]): [V2, V2] {
  const [L1, L2] = a.links
  const c2 = Math.cos(q[1])
  const m22 = L2.m * L2.lc ** 2 + L2.I
  const m12 = m22 + L2.m * a.l1 * L2.lc * c2
  const m11 = L1.m * L1.lc ** 2 + L1.I + L2.m * (a.l1 ** 2 + 2 * a.l1 * L2.lc * c2) + m22
  return [
    [m11 + a.rotor[0], m12],
    [m12, m22 + a.rotor[1]],
  ]
}

/** C(q,q̇)q̇ with h = m2·l1·lc2·sin q2: (−h·q̇2(2q̇1 + q̇2), h·q̇1²). */
export function coriolis(a: TwoLink, q: readonly number[], qd: readonly number[]): V2 {
  const h = a.links[1].m * a.l1 * a.links[1].lc * Math.sin(q[1])
  return [-h * qd[1] * (2 * qd[0] + qd[1]), h * qd[0] * qd[0]]
}

/** Torque that holds the arm against gravity (positive lifts q). */
export function gravity(a: TwoLink, q: readonly number[], g = G): V2 {
  const [L1, L2] = a.links
  const c12 = Math.cos(q[0] + q[1])
  const g2 = L2.m * L2.lc * g * c12
  return [(L1.m * L1.lc + L2.m * a.l1) * g * Math.cos(q[0]) + g2, g2]
}

export interface TorqueSplit { inertial: V2; coriolis: V2; gravity: V2; friction: V2; tau: V2 }

/** τ = M·q̈ + C·q̇ + g + b·q̇, term by term. */
export function inverseDynamics(a: TwoLink, q: readonly number[], qd: readonly number[], qdd: readonly number[]): TorqueSplit {
  const M = massMatrix(a, q)
  const inertial: V2 = [M[0][0] * qdd[0] + M[0][1] * qdd[1], M[1][0] * qdd[0] + M[1][1] * qdd[1]]
  const c = coriolis(a, q, qd)
  const gq = gravity(a, q)
  const friction: V2 = [a.damping[0] * qd[0], a.damping[1] * qd[1]]
  return { inertial, coriolis: c, gravity: gq, friction, tau: [0, 1].map((i) => inertial[i] + c[i] + gq[i] + friction[i]) as V2 }
}

/** q̈ = M⁻¹(τ − C·q̇ − g − b·q̇). */
export function forwardDynamics(a: TwoLink, q: readonly number[], qd: readonly number[], tau: readonly number[]): V2 {
  const M = massMatrix(a, q)
  const c = coriolis(a, q, qd)
  const gq = gravity(a, q)
  const r = [0, 1].map((i) => tau[i] - c[i] - gq[i] - a.damping[i] * qd[i])
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0]
  return [(M[1][1] * r[0] - M[0][1] * r[1]) / det, (M[0][0] * r[1] - M[1][0] * r[0]) / det]
}

/** Torque joint 1's motion puts on joint 2: M21·q̈1 + h·q̇1² (inertial coupling + centrifugal). */
export const couplingTorque = (a: TwoLink, q: readonly number[], qd: readonly number[], qdd: readonly number[]) => massMatrix(a, q)[1][0] * qdd[0] + coriolis(a, q, qd)[1]

/** Kinetic ½q̇ᵀMq̇ and potential Σ m·g·y (shoulder height = 0). */
export function armEnergy(a: TwoLink, q: readonly number[], qd: readonly number[]) {
  const M = massMatrix(a, q)
  const kinetic = 0.5 * (M[0][0] * qd[0] ** 2 + 2 * M[0][1] * qd[0] * qd[1] + M[1][1] * qd[1] ** 2)
  const [L1, L2] = a.links
  const potential = G * (L1.m * L1.lc * Math.sin(q[0]) + L2.m * (a.l1 * Math.sin(q[0]) + L2.lc * Math.sin(q[0] + q[1])))
  return { kinetic, potential, total: kinetic + potential }
}

export interface DynState { q: V2; qd: V2 }

/** One RK4 step with τ held over the step. */
function dynStep(a: TwoLink, s: DynState, tau: readonly number[], dt: number): DynState {
  const f = (q: readonly number[], qd: readonly number[]) => forwardDynamics(a, q, qd, tau)
  const ax = (x: readonly number[], d: readonly number[], k: number): V2 => [x[0] + d[0] * k, x[1] + d[1] * k]
  const a1 = f(s.q, s.qd)
  const v1 = s.qd
  const a2 = f(ax(s.q, v1, dt / 2), ax(s.qd, a1, dt / 2))
  const v2 = ax(s.qd, a1, dt / 2)
  const a3 = f(ax(s.q, v2, dt / 2), ax(s.qd, a2, dt / 2))
  const v3 = ax(s.qd, a2, dt / 2)
  const a4 = f(ax(s.q, v3, dt), ax(s.qd, a3, dt))
  const v4 = ax(s.qd, a3, dt)
  const mix = (x: readonly number[], k1: readonly number[], k2: readonly number[], k3: readonly number[], k4: readonly number[]): V2 =>
    [0, 1].map((i) => x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) as V2
  return { q: mix(s.q, v1, v2, v3, v4), qd: mix(s.qd, a1, a2, a3, a4) }
}

/** Free swing with τ = 0 from `q0` at rest. */
export function freeSwing(a: TwoLink, q0: V2, seconds: number, dt = 0.001) {
  const out: (DynState & { t: number; energy: number })[] = []
  let s: DynState = { q: [...q0], qd: [0, 0] }
  for (let k = 0; k <= Math.round(seconds / dt); k++) {
    out.push({ t: k * dt, ...s, energy: armEnergy(a, s.q, s.qd).total })
    s = dynStep(a, s, [0, 0], dt)
  }
  return out
}

export interface JointRef { q: V2; qd: V2; qdd: V2 }

/** Rest-to-rest quintic from qa to qb in T s, starting at `t0`; holds before and after. */
export function restMove(qa: readonly number[], qb: readonly number[], T: number, t0 = 0) {
  const c = quinticCoeffs(0, 1, 0, 0, 0, 0, T)
  return (t: number): JointRef => {
    const u = t - t0
    const r = u <= 0 ? { p: 0, v: 0, a: 0 } : u >= T ? { p: 1, v: 0, a: 0 } : polyAt(c, u)
    const at = (k: number) => [0, 1].map((i) => (qb[i] - qa[i]) * k) as V2
    const q = at(r.p)
    return { q: [qa[0] + q[0], qa[1] + q[1]], qd: at(r.v), qdd: at(r.a) }
  }
}

/** Output torque a drive can give at speed w in the direction of τ: full stall when braking, the straight T–ω line when driving. */
export function driveClip(d: Drive, w: number, tau: number) {
  const free = (d.freeRpm * 2 * Math.PI) / 60
  const pushing = Math.sign(tau) === Math.sign(w) ? Math.abs(w) : 0
  const cap = Math.max(0, d.stallNm * (1 - pushing / free))
  return Math.max(-cap, Math.min(cap, tau))
}

export type FeedForward = 'none' | 'gravity' | 'full'
export interface TrackCfg {
  kp: V2
  kd: V2
  ff: FeedForward
  drives?: [Drive, Drive]
  /** The model the feed-forward believes (default: the true arm). */
  model?: TwoLink
}
export interface TrackFrame { t: number; q: V2; qd: V2; qdd: V2; ref: JointRef; pd: V2; ff: V2; tau: V2; clipped: [boolean, boolean]; split: TorqueSplit }

/** PD per joint (pidTick) plus feed-forward: none, g(q_ref), or full inverse dynamics on the reference; torques clipped by each drive. */
export function trackRun(a: TwoLink, ref: (t: number) => JointRef, c: TrackCfg, seconds: number, dt = 0.002): TrackFrame[] {
  const model = c.model ?? a
  const r0 = ref(0)
  let s: DynState = { q: [...r0.q], qd: [0, 0] }
  let mem: [PidMem, PidMem] = [PID_MEM0, PID_MEM0]
  const out: TrackFrame[] = []
  for (let k = 0; k <= Math.round(seconds / dt); k++) {
    const t = k * dt
    const r = ref(t)
    const pids = [0, 1].map((i) => pidTick(mem[i], r.q[i], s.q[i], { kp: c.kp[i], ki: 0, kd: 0, limit: Infinity }, dt))
    mem = [pids[0].mem, pids[1].mem]
    const pd = pids.map((p, i) => p.terms.p + c.kd[i] * (r.qd[i] - s.qd[i])) as V2
    const ff: V2 = c.ff === 'none' ? [0, 0] : c.ff === 'gravity' ? gravity(model, r.q) : inverseDynamics(model, r.q, r.qd, r.qdd).tau
    const want = [0, 1].map((i) => pd[i] + ff[i])
    const tau = want.map((v, i) => (c.drives ? driveClip(c.drives[i], s.qd[i], v) : v)) as V2
    const qdd = forwardDynamics(a, s.q, s.qd, tau)
    out.push({ t, q: s.q, qd: s.qd, qdd, ref: r, pd, ff, tau, clipped: [Math.abs(tau[0] - want[0]) > 1e-9, Math.abs(tau[1] - want[1]) > 1e-9], split: inverseDynamics(a, s.q, s.qd, qdd) })
    s = dynStep(a, s, tau, dt)
  }
  return out
}

/** Worst share of the drive's available torque along a planned move (> 1 = it cannot follow). */
export function moveDemand(a: TwoLink, qa: readonly number[], qb: readonly number[], T: number, drives: [Drive, Drive] = SERVO_DRIVES, n = 120) {
  const ref = restMove(qa, qb, T)
  let worst = 0
  let joint = 0
  for (let k = 0; k <= n; k++) {
    const r = ref((k / n) * T)
    const tau = inverseDynamics(a, r.q, r.qd, r.qdd).tau
    tau.forEach((v, i) => {
      const cap = Math.abs(driveClip(drives[i], r.qd[i], v * 1e6)) || 1e-12
      const share = Math.abs(v) / cap
      if (share > worst) [worst, joint] = [share, i]
    })
  }
  return { worst, joint }
}

/** Shortest move time the drives can follow (bisection); Infinity if even holding fails. */
export function fastestMove(a: TwoLink, qa: readonly number[], qb: readonly number[], drives: [Drive, Drive] = SERVO_DRIVES, hi = 20) {
  if (moveDemand(a, qa, qb, hi, drives).worst > 1) return Infinity
  let lo = 0.02
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (moveDemand(a, qa, qb, mid, drives).worst > 1) lo = mid
    else hi = mid
  }
  return hi
}

/** Heaviest payload for a move in T s (bisection over kg). */
export function maxPayload(qa: readonly number[], qb: readonly number[], T: number, build: (kg: number) => TwoLink, drives: [Drive, Drive] = SERVO_DRIVES, hi = 2) {
  if (moveDemand(build(0), qa, qb, T, drives).worst > 1) return 0
  let lo = 0
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (moveDemand(build(mid), qa, qb, T, drives).worst > 1) hi = mid
    else lo = mid
  }
  return lo
}
