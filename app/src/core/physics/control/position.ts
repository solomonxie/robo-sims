// Position control: trapezoid and S-curve motion profiles, and the TT car driven to a mark by a cascade (position P → wheel speed FF + PI).
import { TT_CAR, TT_GEAR, TT_INERTIA } from '../actuators/dcmotor'
import { clamp } from '../common'
import { wheelCpr, ffVolts, wheelFf, wheelStep, WHEEL } from './speed'
import { PID_MEM0, pidTick } from './pid'

/** Constant-jerk piece; `a` (if set) steps the acceleration at its start (trapezoid corners). */
interface ProfileSeg { dur: number; j: number; a?: number }
export interface Move { kind: 'step' | 'trapezoid' | 'scurve'; dist: number; segs: ProfileSeg[]; T: number; vPeak: number; aPeak: number; jPeak: number }
interface MoveState { p: number; v: number; a: number; j: number }

const moveOf = (kind: Move['kind'], dist: number, segs: ProfileSeg[], vPeak: number, aPeak: number, jPeak: number): Move => {
  const kept = segs.filter((s) => s.dur > 1e-12)
  return { kind, dist, segs: kept, T: kept.reduce((a, s) => a + s.dur, 0), vPeak, aPeak, jPeak }
}

/** Target jumps straight to `dist`. */
export const stepMove = (dist: number) => moveOf('step', dist, [], Infinity, Infinity, Infinity)

/** Accelerate at `aMax` to `vMax`, cruise, brake at `aMax`; a triangle when `dist` is too short to reach `vMax`. */
export function trapezoidMove(dist: number, vMax: number, aMax: number): Move {
  const v = Math.min(vMax, Math.sqrt(dist * aMax))
  const ta = v / aMax
  const tv = (dist - v * ta) / v
  return moveOf('trapezoid', dist, [{ dur: ta, j: 0, a: aMax }, { dur: tv, j: 0, a: 0 }, { dur: ta, j: 0, a: -aMax }], v, aMax, Infinity)
}

/** Ramp-up of a symmetric jerk-limited speed change 0 → v: jerk time, constant-accel time, distance. */
function sRamp(v: number, aMax: number, jMax: number) {
  const tj = v * jMax >= aMax * aMax ? aMax / jMax : Math.sqrt(v / jMax)
  const tc = Math.max(0, v / aMax - tj)
  return { tj, tc, d: (v * (2 * tj + tc)) / 2 }
}

/** Seven-segment S-curve: jerk-limited ramps (`jMax`) into a trapezoid; lowers the peak speed if `dist` is short. */
export function sCurveMove(dist: number, vMax: number, aMax: number, jMax: number): Move {
  let v = vMax
  if (2 * sRamp(vMax, aMax, jMax).d > dist) {
    let [lo, hi] = [0, vMax]
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (2 * sRamp(mid, aMax, jMax).d > dist) hi = mid
      else lo = mid
    }
    v = lo
  }
  const { tj, tc, d } = sRamp(v, aMax, jMax)
  const tv = Math.max(0, (dist - 2 * d) / v)
  const J = jMax
  const segs: ProfileSeg[] = [
    { dur: tj, j: J, a: 0 },
    { dur: tc, j: 0 },
    { dur: tj, j: -J },
    { dur: tv, j: 0, a: 0 },
    { dur: tj, j: -J },
    { dur: tc, j: 0 },
    { dur: tj, j: J },
  ]
  return moveOf('scurve', dist, segs, v, Math.min(aMax, J * tj), J)
}

/** Position, speed, acceleration and jerk `t` s into the move (rest before 0, parked on `dist` after T). */
export function moveAt(m: Move, t: number): MoveState {
  if (t < 0) return { p: 0, v: 0, a: 0, j: 0 }
  if (t >= m.T) return { p: m.dist, v: 0, a: 0, j: 0 }
  let [p, v, a, left] = [0, 0, 0, t]
  for (const s of m.segs) {
    a = s.a ?? a
    const tau = Math.min(left, s.dur)
    p += v * tau + (a * tau * tau) / 2 + (s.j * tau ** 3) / 6
    v += a * tau + (s.j * tau * tau) / 2
    a += s.j * tau
    left -= tau
    if (left <= 0) return { p, v, a, j: s.j }
  }
  return { p, v, a, j: 0 }
}

const R = TT_CAR.wheelM
/** Motor rotor plus the driven wheel's share of the car mass, seen at the motor shaft. */
export const CAR_INERTIA = TT_INERTIA + ((TT_CAR.massKg / TT_CAR.driven) * R * R) / (TT_GEAR * TT_GEAR)
const mpsToRpm = (v: number) => (v / (2 * Math.PI * R)) * 60
/** Top car speed the loop may ask for (m/s); camera mast: bending mode (Hz), damping ratio, height (m). */
export const CAR_MOVE = { vLimit: (WHEEL.maxRpm / 60) * 2 * Math.PI * R, kpos: 8, pi: { kp: 0.005, ki: 0.08, kd: 0 }, mast: { hz: 3, zeta: 0.03, h: 0.18 } }

interface PosCfg {
  move: Move
  /** Move starts at this time (s). */
  start: number
  seconds: number
  /** Outer loop gain (1/s): m/s of speed command per metre of error. */
  kpos?: number
  ff?: boolean
  mastHz?: number
  mastZeta?: number
}
export interface PosFrame {
  t: number
  /** Profile position, speed, accel. */
  ref: number
  refV: number
  refA: number
  /** True and encoder car position (m), true speed (m/s), car accel (m/s²). */
  x: number
  meas: number
  v: number
  acc: number
  vCmd: number
  u: number
  sat: boolean
  /** Wheel turns; mast tip deflection (m, + = back). */
  rev: number
  sway: number
}

/** 100 Hz cascade on Hall counts: vCmd = v_ref + Kpos·(x_ref − x_enc) (clipped); u = FF(vCmd, a_ref) + PI on wheel rpm.
 *  The camera mast is a damped spring-mass shaken by the car's acceleration. */
export function positionRun(c: PosCfg): PosFrame[] {
  const { loopS, dt, volts } = WHEEL
  const kpos = c.kpos ?? CAR_MOVE.kpos
  const wn = 2 * Math.PI * (c.mastHz ?? CAR_MOVE.mast.hz)
  const zeta = c.mastZeta ?? CAR_MOVE.mast.zeta
  const cpr = wheelCpr('hall')
  const ffK = wheelFf(WHEEL.crr, CAR_INERTIA)
  const sub = Math.round(loopS / dt)
  const perCount = (2 * Math.PI * R) / cpr
  let [theta, w, sw, swV, prevCount, prevV] = [0, 0, 0, 0, 0, 0]
  let mem = PID_MEM0
  const out: PosFrame[] = []
  for (let k = 0; k * loopS <= c.seconds + 1e-9; k++) {
    const t = k * loopS
    const ref = moveAt(c.move, t - c.start)
    const count = Math.floor((theta / TT_GEAR / (2 * Math.PI)) * cpr + 1e-9)
    const meas = count * perCount
    const rpmMeas = mpsToRpm(((count - prevCount) * perCount) / loopS)
    prevCount = count
    const vCmd = clamp(ref.v + kpos * (ref.p - meas), -CAR_MOVE.vLimit, CAR_MOVE.vLimit)
    const ff = c.ff === false ? 0 : ffVolts(mpsToRpm(vCmd), mpsToRpm(ref.a), ffK) / volts
    const r = pidTick(mem, mpsToRpm(vCmd), rpmMeas, { ...CAR_MOVE.pi, limit: 1, antiWindup: 'clamp' }, loopS)
    mem = r.mem
    const raw = ff + r.terms.out
    const u = clamp(raw, -1, 1)
    const v = (w / TT_GEAR) * R
    out.push({ t, ref: ref.p, refV: ref.v, refA: ref.a, x: (theta / TT_GEAR) * R, meas, v, acc: (v - prevV) / loopS, vCmd, u, sat: u !== raw, rev: theta / TT_GEAR / (2 * Math.PI), sway: sw })
    prevV = v
    for (let j = 0; j < sub; j++) {
      const w1 = wheelStep(w, u * volts, 0, dt, WHEEL.crr, CAR_INERTIA)
      const acc = ((w1 - w) / TT_GEAR) * (R / dt)
      swV += (-wn * wn * sw - 2 * zeta * wn * swV + acc) * dt
      sw += swV * dt
      theta += w1 * dt
      w = w1
    }
  }
  return out
}

/** Settle time from the move start (stays within `band` m of the mark), overshoot (m), peak |accel|, worst tracking error during
 *  the move, sway left once the profile has ended (peak |tip| after T + 0.1 s), final error. */
export function moveStats(run: PosFrame[], c: Pick<PosCfg, 'move' | 'start'>, band = 0.002) {
  const { dist, T } = c.move
  let last = -1
  run.forEach((f, k) => {
    if (Math.abs(f.x - dist) > band) last = k
  })
  const during = run.filter((f) => f.t >= c.start && f.t <= c.start + T)
  const after = run.filter((f) => f.t > c.start + T + 0.1)
  const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0)
  return {
    settle: last >= run.length - 1 ? null : run[last + 1].t - c.start,
    overshoot: Math.max(0, max(run.map((f) => f.x)) - dist),
    peakAcc: max(run.map((f) => Math.abs(f.acc))),
    peakSway: max(run.map((f) => Math.abs(f.sway))),
    track: max(during.map((f) => Math.abs(f.ref - f.x))),
    residual: max(after.map((f) => Math.abs(f.sway))),
    final: run[run.length - 1].x - dist,
  }
}
