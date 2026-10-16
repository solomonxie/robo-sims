// Bang-bang & hysteresis: a relay thermostat heating a box with thermal lag, and a bang-bang line follower that chatters on noise.
import { clamp, gaussAt } from '../common'
import { diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'
import { wheelLag } from './loop'

/** On/off with a hysteresis band around `setpoint`: turns on below the lower threshold, off above the upper, else holds. */
export const bangBang = (on: boolean, meas: number, setpoint: number, band: number) =>
  meas < setpoint - band / 2 ? true : meas > setpoint + band / 2 ? false : on

/** Typical electrical life of a hobby relay's contacts at rated load (operations). */
export const RELAY_LIFE_OPS = 1e5

/** 40 W heater element in an insulated box: element → air → room, thermistor probe in the air. */
export const HEATER_BOX = { ambient: 20, watts: 40, elemWPerK: 2, airJPerK: 400, lossWPerK: 1, sensorTau: 10, dt: 0.5, seconds: 1800 }
/** Element heat capacity (J/K): how much heat it keeps dumping after the relay opens. */
export const HEATERS = { wire: { name: 'Bare wire', jPerK: 10 }, ceramic: { name: 'Ceramic', jPerK: 60 }, oil: { name: 'Oil-filled', jPerK: 240 } }
export type HeaterKind = keyof typeof HEATERS

export interface ThermoFrame {
  t: number
  air: number
  elem: number
  meas: number
  on: boolean
}

/** Relay thermostat run: air temperature (°C) of the box from room temperature, relay switching on the probe reading. */
export function thermostatRun(setpoint: number, band: number, elemJPerK: number, seconds = HEATER_BOX.seconds, b = HEATER_BOX): ThermoFrame[] {
  const s = { air: b.ambient, elem: b.ambient, meas: b.ambient, on: false }
  const out: ThermoFrame[] = []
  for (let i = 0; i * b.dt <= seconds + 1e-9; i++) {
    s.on = bangBang(s.on, s.meas, setpoint, band)
    out.push({ t: i * b.dt, ...s })
    const toAir = b.elemWPerK * (s.elem - s.air)
    s.elem += ((s.on ? b.watts : 0) - toAir) * (b.dt / elemJPerK)
    s.air += (toAir - b.lossWPerK * (s.air - b.ambient)) * (b.dt / b.airJPerK)
    s.meas += (s.air - s.meas) * Math.min(1, b.dt / b.sensorTau)
  }
  return out
}

/** Settled cycling after the first switch-off: relay closures, mean period, air ripple and peak overshoot above the upper threshold. */
export function cycleStats(run: ThermoFrame[], setpoint: number, band: number) {
  const first = run.findIndex((f) => !f.on && f.t > 0)
  const tail = first < 0 ? [] : run.slice(first)
  const ons = tail.filter((f, i) => i > 0 && f.on && !tail[i - 1].on).map((f) => f.t)
  const airs = tail.map((f) => f.air)
  const span = tail.length > 1 ? tail.at(-1)!.t - tail[0].t : 0
  return {
    settledAt: first < 0 ? null : run[first].t,
    closures: ons.length,
    perHour: span > 0 ? (ons.length * 3600) / span : 0,
    period: ons.length > 1 ? (ons.at(-1)! - ons[0]) / (ons.length - 1) : null,
    ripple: airs.length ? Math.max(...airs) - Math.min(...airs) : 0,
    overshoot: airs.length ? Math.max(...airs) - (setpoint + band / 2) : 0,
  }
}

/** Hours of relay life at `perHour` closures. */
export const relayLifeHours = (perHour: number, ops = RELAY_LIFE_OPS) => (perHour > 0 ? ops / perHour : Infinity)

// --- Line follower: one analog IR sensor 6 cm ahead reads the offset from the line edge; the loop steers at 200 Hz. ---

export const FOLLOWER = { v: 0.25, lookM: 0.06, dt: 0.005, turn: 0.7, seconds: 6, startY: 0.03 }
export type FollowMode = 'bang' | 'band' | 'hold' | 'p'

export interface FollowCfg {
  mode: FollowMode
  /** Sensor noise σ (m). */
  noiseM: number
  /** Hysteresis half-width (m), minimum hold time (s), P gain (full turn per metre of offset). */
  bandM: number
  holdS: number
  kp: number
}

export interface FollowFrame {
  t: number
  pose: Pose
  dL: number
  dR: number
  meas: number
  /** Steer −1 (hard left) … 1 (hard right). */
  steer: number
  /** Full-swing reversals so far. */
  flips: number
}

/** Steering decision for one sample; `last` is the previous steer, `since` the time since it last flipped. */
export function followSteer(cfg: FollowCfg, meas: number, last: number, since: number) {
  if (cfg.mode === 'p') return clamp(cfg.kp * meas, -1, 1)
  const want = meas > 0 ? 1 : -1
  if (cfg.mode === 'band') return meas > cfg.bandM ? 1 : meas < -cfg.bandM ? -1 : last || want
  if (cfg.mode === 'hold' && last !== 0 && since < cfg.holdS) return last
  return want
}

/** Line along x; the robot starts `startY` left of it. Steer slows one wheel and speeds the other (`turn` share). */
export function followRun(cfg: FollowCfg, seconds = FOLLOWER.seconds, f = FOLLOWER): FollowFrame[] {
  const s = { pose: { x: 0, y: f.startY, th: 0 } as Pose, vL: f.v, vR: f.v, dL: 0, dR: 0, steer: 0, since: 0, flips: 0 }
  const out: FollowFrame[] = []
  for (let i = 0; i * f.dt <= seconds + 1e-9; i++) {
    const meas = s.pose.y + f.lookM * Math.sin(s.pose.th) + cfg.noiseM * gaussAt(7919 + i)
    const steer = followSteer(cfg, meas, s.steer, s.since)
    if (Math.abs(steer - s.steer) >= 1) s.flips++
    s.since = Math.sign(steer) !== Math.sign(s.steer) ? 0 : s.since + f.dt
    s.steer = steer
    out.push({ t: i * f.dt, pose: s.pose, dL: s.dL, dR: s.dR, meas, steer, flips: s.flips })
    s.vL = wheelLag(s.vL, f.v * (1 + f.turn * steer), 0, f.dt)
    s.vR = wheelLag(s.vR, f.v * (1 - f.turn * steer), 0, f.dt)
    s.pose = diffStep(s.pose, s.vL, s.vR, TT_TRACK_M, f.dt)
    s.dL += s.vL * f.dt
    s.dR += s.vR * f.dt
  }
  return out
}

/** After the first second: reversals per second, peak-to-peak lateral wiggle (m) and RMS offset from the line (m). */
export function followStats(run: FollowFrame[], from = 1) {
  const tail = run.filter((fr) => fr.t >= from)
  const ys = tail.map((fr) => fr.pose.y)
  const span = tail.at(-1)!.t - tail[0].t
  return {
    flipsPerS: (tail.at(-1)!.flips - tail[0].flips) / span,
    wiggle: Math.max(...ys) - Math.min(...ys),
    rms: Math.sqrt(ys.reduce((a, y) => a + y * y, 0) / ys.length),
  }
}
