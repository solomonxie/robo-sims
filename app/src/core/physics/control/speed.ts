// Wheel speed loop: a TT gearmotor driving one car wheel, encoder counts per loop tick → speed, feed-forward + PID.
import { GEARBOXES, RPM_PER_RADS, TT_CAR, TT_INERTIA, TT_GEAR, TT_MOTOR, frictionNm, gearEfficiency, motorK } from '../actuators/dcmotor'
import { G, clamp } from '../common'
import { ENCODERS, EncoderKind, ticksPerWheelRev } from '../sensors/encoder'
import { DRIVE_TASK, ROLL_FLOORS } from './loop'
import { PID_MEM0, PidCfg, pidTick } from './pid'

/** 2S pack (full), 100 Hz loop, 0.5 ms physics step; FF is calibrated for `volts` on tile. */
export const WHEEL = { volts: DRIVE_TASK.fullV, loopS: 0.01, dt: 0.0005, crr: ROLL_FLOORS.tile.crr, maxRpm: 300 }
const EFF = gearEfficiency(GEARBOXES.tt48)

/** Counts per wheel turn under ×4 decoding. */
export const wheelCpr = (kind: EncoderKind) => ticksPerWheelRev(ENCODERS[kind].ppr, 4, ENCODERS[kind].onMotor ? TT_GEAR : 1)
/** Smallest speed step (wheel rpm) when counting over `windowS`. */
export const speedStep = (kind: EncoderKind, windowS: number) => 60 / (wheelCpr(kind) * windowS)

/** Motor-shaft load torque of one wheel's share of the car: rolling drag (opposes motion) and the slope pull (signed). */
function wheelLoad(slopeDeg: number, crr = WHEEL.crr) {
  const a = (slopeDeg * Math.PI) / 180
  const perN = ((TT_CAR.massKg / TT_CAR.driven) * G * TT_CAR.wheelM) / (TT_GEAR * EFF)
  return { dragNm: frictionNm() + perN * crr * Math.cos(a), gravNm: perN * Math.sin(a) }
}

/** Feed-forward volts for a wheel speed and acceleration: kS·sign + kV·rpm + kA·rpm/s, from the motor model. */
export function wheelFf(crr = WHEEL.crr, inertia = TT_INERTIA) {
  const k = motorK()
  return {
    kS: (TT_MOTOR.ohms * wheelLoad(0, crr).dragNm) / k,
    kV: TT_MOTOR.voltsPerRpm,
    kA: (TT_MOTOR.ohms * inertia * TT_GEAR) / (k * RPM_PER_RADS),
  }
}
export const ffVolts = (rpm: number, rpmPerS: number, f = wheelFf()) => (Math.abs(rpm) < 1e-9 ? 0 : f.kS * Math.sign(rpm)) + f.kV * rpm + f.kA * rpmPerS

/** One physics step of the motor shaft (rad/s) at `volts`: J·dω/dt = k·i − slope − drag, drag sticks it at rest. */
export function wheelStep(w: number, volts: number, slopeDeg: number, dt: number, crr = WHEEL.crr, inertia = TT_INERTIA) {
  const k = motorK()
  const { dragNm, gravNm } = wheelLoad(slopeDeg, crr)
  const drive = (k * (volts - k * w)) / TT_MOTOR.ohms - gravNm
  if (w === 0 && Math.abs(drive) <= dragNm) return 0
  const dir = w !== 0 ? Math.sign(w) : Math.sign(drive)
  const next = w + ((drive - dir * dragNm) / inertia) * dt
  return w !== 0 && Math.sign(next) !== Math.sign(w) ? 0 : next
}

export interface SpeedCfg {
  /** Setpoint (wheel rpm) at time t. */
  sp: (t: number) => number
  seconds: number
  /** null = open loop (FF duty only). */
  enc: EncoderKind | null
  /** Speed is counts over this many loop ticks. */
  window?: number
  pid?: Omit<PidCfg, 'limit'>
  ff?: boolean
  /** The FF divides by this pack voltage; the motor gets `volts`. */
  ffVolts?: number
  volts?: number
  /** Car meets a ramp of `deg` at `at` s. */
  ramp?: { at: number; deg: number }
  /** Replaces counts / window: reads each tick's count, is told the volts sent. */
  meter?: (cpr: number) => { read(count: number): number; drive(volts: number): void }
}

export interface SpeedFrame {
  t: number
  sp: number
  /** True and measured wheel rpm. */
  rpm: number
  meas: number
  /** Wheel turns so far. */
  rev: number
  /** Counts in the last loop tick. */
  counts: number
  u: number
  ff: number
  p: number
  i: number
  d: number
  sat: boolean
  slope: number
}

/** Fixed-rate loop sampled every `WHEEL.loopS`: count ticks, speed = counts / window, u = FF + PID, clipped to ±1. */
export function wheelSpeedRun(c: SpeedCfg): SpeedFrame[] {
  const { loopS, dt } = WHEEL
  const win = Math.max(1, c.window ?? 1)
  const volts = c.volts ?? WHEEL.volts
  const ffV = c.ffVolts ?? WHEEL.volts
  const cpr = c.enc ? wheelCpr(c.enc) : 1
  const sub = Math.round(loopS / dt)
  const meter = c.enc && c.meter ? c.meter(cpr) : null
  const hist: number[] = [0]
  let theta = 0
  let w = 0
  let mem = PID_MEM0
  const out: SpeedFrame[] = []
  const n = Math.round(c.seconds / loopS)
  for (let j = 0; j <= n; j++) {
    const t = j * loopS
    const sp = c.sp(t)
    const count = Math.floor((theta / TT_GEAR / (2 * Math.PI)) * cpr + 1e-9)
    hist.push(count)
    const back = hist[Math.max(0, hist.length - 1 - win)]
    const meas = meter ? meter.read(count) : c.enc ? ((count - back) / cpr / (Math.min(win, hist.length - 1) * loopS)) * 60 : (w / TT_GEAR) * RPM_PER_RADS
    const acc = (c.sp(t + loopS) - c.sp(Math.max(0, t - loopS))) / (t > 0 ? 2 * loopS : loopS)
    const ff = c.ff || !c.enc ? ffVolts(sp, acc) / ffV : 0
    let terms = { p: 0, i: 0, d: 0, out: 0, sat: false }
    if (c.enc && c.pid) {
      const r = pidTick(mem, sp, meas, { ...c.pid, limit: 1 }, loopS)
      mem = r.mem
      terms = r.terms
    }
    const raw = ff + terms.out
    const u = clamp(raw, -1, 1)
    const slope = c.ramp && t >= c.ramp.at ? c.ramp.deg : 0
    meter?.drive(u * volts)
    out.push({ t, sp, rpm: (w / TT_GEAR) * RPM_PER_RADS, meas, rev: theta / TT_GEAR / (2 * Math.PI), counts: count - hist[hist.length - 2], u, ff, p: terms.p, i: terms.i, d: terms.d, sat: terms.sat || u !== raw, slope })
    for (let k = 0; k < sub; k++) {
      w = wheelStep(w, u * volts, slope, dt)
      theta += w * dt
    }
  }
  return out
}

/** Setpoint step from 0 to `rpm` at `at` s. */
export const stepSp = (rpm: number, at: number) => (t: number) => (t >= at ? rpm : 0)
/** Trapezoid profile through `pts` = [t, rpm] corners, linear between. */
export const rampSp = (pts: [number, number][]) => (t: number) => {
  if (t <= pts[0][0]) return pts[0][1]
  for (let k = 1; k < pts.length; k++) if (t <= pts[k][0]) return pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * (t - pts[k - 1][0])) / (pts[k][0] - pts[k - 1][0])
  return pts[pts.length - 1][1]
}

const rmsOf = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length))
const meanOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length)
/** Frames with from ≤ t < to: mean and RMS speed error (rpm), RMS duty change per tick (jitter). */
export function speedStats(run: SpeedFrame[], from: number, to = Infinity) {
  const f = run.filter((x) => x.t >= from - 1e-9 && x.t < to - 1e-9)
  const err = f.map((x) => x.sp - x.rpm)
  return { meanErr: meanOf(err), rmsErr: rmsOf(err), jitter: rmsOf(f.slice(1).map((x, k) => x.u - f[k].u)) }
}
