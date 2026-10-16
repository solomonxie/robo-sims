// PID test rig: a 12 V gearmotor swings an arm up from hanging (0°) against a return spring, gravity and a tip payload.
import { DEG, clamp, gaussAt } from '../common'
import { PID_MEM0, PidCfg, pidTick } from './pid'

/** Free speed (rad/s), mechanical time constant (s), return spring (duty per rad), duty to hold the bare arm level, extra duty
 *  per gram at the tip, top end stop (°), pot + driver lag (s), loop period (s), run length, setpoint step time (s) and target (°). */
export const ARM = { wMax: 8, tau: 0.2, spring: 0.5, hold: 0.2, perGram: 0.001, top: 180, lag: 0.05, dt: 0.005, seconds: 3, stepAt: 0.25, target: 40 }

export interface ArmState { th: number; w: number }
/** Duty that holds the arm still at `deg` with `grams` at the tip: spring + gravity. */
export const loadDuty = (deg: number, grams = 0) => ARM.spring * deg * DEG + (ARM.hold + ARM.perGram * grams) * Math.sin(deg * DEG)
/** Where P alone comes to rest: Kp·(target − θ) = load(θ). */
export function pRestDeg(kp: number, target: number, grams = 0) {
  let [lo, hi] = [0, target]
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (kp * (target - mid) > loadDuty(mid, grams)) lo = mid
    else hi = mid
  }
  return lo
}

/** One step: motor torque (u − ω/ωmax) against spring and gravity; the frame's top stop or a block at `stopDeg` halts it going up. */
export function armStep(s: ArmState, u: number, dt: number, grams: number, stopDeg?: number): ArmState {
  const a = (ARM.wMax / ARM.tau) * (clamp(u, -1, 1) - s.w / ARM.wMax - loadDuty(s.th / DEG, grams))
  let w = s.w + a * dt
  let th = s.th + w * dt
  const stop = Math.min(stopDeg ?? ARM.top, ARM.top) * DEG
  if (th >= stop) [th, w] = [stop, Math.min(0, w)]
  return { th, w }
}

export interface ArmCfg {
  pid: PidCfg
  grams?: number
  noiseDeg?: number
  /** Arm held at `deg` until `until` s (a hand or a jammed gear). */
  block?: { deg: number; until: number }
  target?: number
  seconds?: number
  /** Start at rest at `from` (°), setpoint `from` until the step. */
  from?: number
  /** Pot + driver lag (s), default `ARM.lag`. */
  lag?: number
  /** Add the duty that holds the setpoint (spring + gravity feed-forward). */
  ff?: boolean
}
export interface ArmFrame { t: number; sp: number; th: number; meas: number; u: number; p: number; i: number; d: number; raw: number; sat: boolean; blocked: boolean }

/** Closed loop in degrees: setpoint steps 0 → target at `ARM.stepAt`; the controller sees the angle `ARM.lag` late plus noise. */
export function armRun(c: ArmCfg): ArmFrame[] {
  const { dt } = ARM
  const late = Math.round((c.lag ?? ARM.lag) / dt)
  const seconds = c.seconds ?? ARM.seconds
  const from = c.from ?? 0
  const past: number[] = Array(late + 1).fill(from)
  let s: ArmState = { th: from * DEG, w: 0 }
  let mem = PID_MEM0
  const out: ArmFrame[] = []
  for (let k = 0; k * dt <= seconds + 1e-9; k++) {
    const t = k * dt
    const sp = t >= ARM.stepAt ? (c.target ?? ARM.target) : from
    const th = s.th / DEG
    past.push(th)
    past.shift()
    const meas = past[0] + (c.noiseDeg ?? 0) * gaussAt(k)
    const r = pidTick(mem, sp, meas, c.pid, dt)
    mem = r.mem
    const u = c.ff ? clamp(r.terms.out + loadDuty(sp, c.grams ?? 0), -1, 1) : r.terms.out
    const stop = c.block && t < c.block.until ? c.block.deg : undefined
    const blocked = stop !== undefined
    out.push({ t, sp, th, meas, u, p: r.terms.p, i: r.terms.i, d: r.terms.d, raw: r.terms.raw, sat: r.terms.sat, blocked })
    s = armStep(s, u, dt, c.grams ?? 0, stop)
  }
  return out
}
