// Self-balancing robot: the Mobility balancer as a kit. Part stack → pendulum length, gearbox → torque vs top speed,
// the MPU-6050 in the loop (mount height, complementary filter, gyro bias), and a step-by-step tuning sheet.
import { DEG, G, gaussAt } from '../common'
import { GEARBOXES, gearEfficiency, gearRatio } from '../actuators/dcmotor'
import { BALANCER, BalanceFrame, BalanceSetup, Cart, balanceLoop, fallTau, fellAt } from '../mobility/balance'
import { Gains } from '../control/pid'
import { accelTilt, bodyAccel, compAlpha, compStep, residualBias } from '../sensors/imu'

// --- Build the base: what sits where, and which gearbox. ---

/** Deck heights above the axle (m), the pack's centre above its deck, and the body parts (kg, m above the axle; wheels turn freely, so they are not body). */
export const BAL_KIT = {
  decks: [0.016, 0.115, 0.21],
  packUp: 0.013,
  pack: 0.105,
  parts: [
    { name: 'motors', kg: 0.058, z: 0 },
    { name: 'frame', kg: 0.012, z: 0.016 },
    { name: 'frame', kg: 0.012, z: 0.115 },
    { name: 'frame', kg: 0.012, z: 0.21 },
    { name: 'frame', kg: 0.012, z: 0.113 },
    { name: 'motors', kg: 0.004, z: 0.026 },
    { name: 'ESP32 + IMU', kg: 0.003, z: 0.04 },
    { name: 'ESP32 + IMU', kg: 0.01, z: 0.135 },
  ],
}
export type PackDeck = 0 | 1 | 2
export const packZ = (deck: PackDeck) => BAL_KIT.decks[deck] + BAL_KIT.packUp

const bodyParts = (deck: PackDeck) => [...BAL_KIT.parts, { name: '2×18650 pack', kg: BAL_KIT.pack, z: packZ(deck) }]
/** Parts grouped by name (TT motors + DRV8833, frame decks + standoffs, ESP32 + MPU-6050, pack): mass, mean height and m·z, the share of the CoM each lifts. */
export function balGroups(deck: PackDeck) {
  const out: { name: string; kg: number; z: number; mz: number }[] = []
  for (const p of bodyParts(deck)) {
    const g = out.find((o) => o.name === p.name) ?? out[out.push({ name: p.name, kg: 0, z: 0, mz: 0 }) - 1]
    g.kg += p.kg
    g.mz += p.kg * p.z
    g.z = g.mz / g.kg
  }
  return out
}
/** Body with the 2×18650 pack on `deck`: mass, CoM height h = Σmz/Σm, and the pendulum length L = Σmz²/Σmz (I about the axle / m·h) the dynamics see. */
export function balBody(deck: PackDeck) {
  const parts = bodyParts(deck)
  const m = parts.reduce((a, p) => a + p.kg, 0)
  const mz = parts.reduce((a, p) => a + p.kg * p.z, 0)
  const mzz = parts.reduce((a, p) => a + p.kg * p.z * p.z, 0)
  return { m, h: mz / m, L: mzz / mz, tau: fallTau(mzz / mz) }
}

export type BalGear = 'tt48' | 'tt120'
/** Wheel acceleration at full torque and free speed for a TT gearbox, scaled from the 1:48 balancer: torque × ratio·η, speed ÷ ratio. */
export function balMotors(gear: BalGear) {
  const ref = gearRatio(GEARBOXES.tt48) * gearEfficiency(GEARBOXES.tt48)
  const g = GEARBOXES[gear]
  return { ratio: gearRatio(g), aMax: (BALANCER.aMax * gearRatio(g) * gearEfficiency(g)) / ref, vMax: (BALANCER.vMax * gearRatio(GEARBOXES.tt48)) / gearRatio(g) }
}

/** The Mobility lesson's gains: tilt PD (duty per °, per °/s) under a speed PI (° per m/s, per m). */
export const BAL_TILT: Gains = { kp: 0.05, ki: 0, kd: 0.003 }
export const BAL_SPEED: Gains = { kp: 5, ki: 2, kd: 0 }
/** Shove test: a hand on the top deck at 1 s. */
export const BASE_TEST = { seconds: 6, push: 1 }

/** Tilt-rate kick (rad/s) from an impulse `J` (N·s) at the top deck: Δθ̇ = J·z / I, I = m·h·L about the axle. */
export function shoveKick(deck: PackDeck, J: number) {
  const b = balBody(deck)
  return (J * BAL_KIT.decks[2]) / (b.m * b.h * b.L)
}
/** Shove test of a base: cascade with the stock gains, an impulse `J` (N·s) at 1 s. */
export function baseRun(deck: PackDeck, gear: BalGear, J: number) {
  const body = balBody(deck)
  const motors = balMotors(gear)
  const run = balanceLoop({ tilt: BAL_TILT, speed: BAL_SPEED, seconds: BASE_TEST.seconds, h: body.L, bot: { aMax: motors.aMax, vMax: motors.vMax }, pushes: [{ at: BASE_TEST.push, kick: shoveKick(deck, J) }] })
  return { body, motors, run, fell: fellAt(run), peak: Math.max(...run.map((f) => Math.abs(f.tilt))), sat: run.some((f) => f.sat) }
}
/** Largest shove (N·s, 5 mN·s steps up to 0.2) a base survives. */
export function maxShove(deck: PackDeck, gear: BalGear) {
  let k = 0
  while (k < 40 && baseRun(deck, gear, (k + 1) * 0.005).fell === null) k++
  return k * 0.005
}

// --- Read the tilt: MPU-6050 at height r on the body, accel + gyro, complementary filter at 200 Hz. ---

/** Accel noise (g rms, motor vibration included), gyro noise (°/s rms) per 5 ms sample. */
export const BAL_IMU = { noiseG: 0.02, noiseDps: 0.05, low: 0.04 }
export type TiltFilter = 'accel' | 'gyro' | 'comp'
interface ImuCfg {
  filter: TiltFilter
  /** Complementary filter time constant (s). */
  tau: number
  /** Mount height on the body (m above the axle). */
  r: number
  /** Gyro offset left after calibration (°/s). */
  biasDps: number
}

/** Accelerometer reading (g, body X forward, Z up along the body) at `r` up a body leaning `tilt` with rate, tilt accel and wheel acceleration a. */
export function mountedAccel(tilt: number, rate: number, alpha: number, a: number, r: number) {
  const f = bodyAccel(-tilt, a / G)
  return [f[0] + (r * alpha) / G, 0, f[2] - (r * rate * rate) / G] as [number, number, number]
}
/** Tilt the accelerometer alone reports (lean forward > 0). */
export const accelLean = (f: [number, number, number]) => -accelTilt(f)

/** Makes a tilt reader for `balanceLoop`: noisy, biased MPU-6050 through the chosen filter; `log` collects the raw accel tilt per step. */
function imuReader(c: ImuCfg, log?: number[]) {
  return () => {
    let prev: Cart | null = null
    let est = 0
    const alpha = c.filter === 'accel' ? 0 : c.filter === 'gyro' ? 1 : compAlpha(c.tau, BALANCER.dt)
    return (s: Cart, n: number, dt: number) => {
      const spin = prev ? (s.rate - prev.rate) / dt : 0
      prev = s
      const f = mountedAccel(s.tilt, s.rate, spin, s.a, c.r)
      const acc = accelLean([f[0] + BAL_IMU.noiseG * gaussAt(3 * n + 11), 0, f[2] + BAL_IMU.noiseG * gaussAt(3 * n + 12)])
      const rate = s.rate + (c.biasDps + BAL_IMU.noiseDps * gaussAt(3 * n + 13)) * DEG
      if (log) log[n] = acc
      est = n === 0 ? acc : compStep(est, rate, acc, dt, alpha)
      return { tilt: est, rate }
    }
  }
}
export const gyroBias = (calibrated: boolean) => residualBias(calibrated ? 'rest' : 'none', 25)
/** Steady lean error (°) a gyro offset leaves in the complementary filter: bias × τ. */
export const compBiasError = (biasDps: number, tau: number) => biasDps * tau

export const READ_TEST = { seconds: 10, go: 3, stop: 7, v: 0.3, push: 1.5, kick: 1 }
/** Stock robot (pack on top, 1:48) with the IMU in the loop: a push, then a drive at 0.3 m/s and back to a stop. */
export function tiltReadRun(c: ImuCfg) {
  const T = READ_TEST
  const accel: number[] = []
  const run = balanceLoop({
    tilt: BAL_TILT,
    speed: BAL_SPEED,
    seconds: T.seconds,
    h: balBody(2).L,
    pushes: [{ at: T.push, kick: T.kick }],
    drive: (t) => (t >= T.go && t < T.stop ? T.v : 0),
    sense: imuReader(c, accel),
  })
  const live = run.filter((f) => !f.fallen)
  const err = live.map((f) => f.seen - f.tilt)
  return { run, accel, fell: fellAt(run), rms: Math.sqrt(err.reduce((a, e) => a + e * e, 0) / Math.max(1, err.length)), peakErr: Math.max(0, ...err.map(Math.abs)) }
}

// --- Tune the loop: the real robot (IMU through the filter, battery a little off-centre), gains added one stage at a time. ---

/** Comp filter τ = 1 s, calibrated gyro, IMU low on the front. */
const TUNE_IMU: ImuCfg = { filter: 'comp', tau: 1, r: BAL_IMU.low, biasDps: gyroBias(true) }
export const TUNE = { seconds: 8, start: 3 * DEG, push: 4, kick: 1, battShift: 0.005 }
export type TuneStage = 'p' | 'pd' | 'speedP' | 'speedPI'
export const TUNE_STAGES: Record<TuneStage, string> = { p: '1 · Tilt P', pd: '2 · + tilt D', speedP: '3 · + speed P', speedPI: '4 · + speed I' }
export interface TuneGains {
  kp: number
  kd: number
  sp: number
  si: number
}
/** Gains in use at a stage: later terms zeroed. */
function stageGains(stage: TuneStage, g: TuneGains): Pick<BalanceSetup, 'tilt' | 'speed'> {
  const k = Object.keys(TUNE_STAGES).indexOf(stage)
  const tilt = { kp: g.kp, ki: 0, kd: k >= 1 ? g.kd : 0 }
  return k >= 2 ? { tilt, speed: { kp: g.sp, ki: k >= 3 ? g.si : 0, kd: 0 } } : { tilt }
}
export type TuneVerdict = 'topples' | 'oscillates' | 'runsOff' | 'wobbles' | 'creeps' | 'holds'
export const TUNE_VERDICTS: Record<TuneVerdict, string> = {
  topples: 'topples: P too weak',
  oscillates: 'swings out: needs D',
  runsOff: 'runs off: needs a speed loop',
  wobbles: 'stands, wobbling',
  creeps: 'stands, creeping',
  holds: 'holds still',
}
/** Battery `battShift` forward: CoM angle off the body axis. */
export const tuneOffset = () => {
  const b = balBody(2)
  return Math.atan((BAL_KIT.pack * TUNE.battShift) / (b.m * b.h))
}
interface TuneResult {
  run: BalanceFrame[]
  fell: number | null
  /** Tilt sign changes before any fall. */
  swings: number
  /** Tilt swing (peak to peak) over the last second. */
  wobble: number
  /** Speed at the end (m/s). */
  v: number
  verdict: TuneVerdict
}
/** One stage of the tuning procedure: start 3° off, a push at 4 s. */
export function tuneRun(stage: TuneStage, g: TuneGains): TuneResult {
  const run = balanceLoop({
    ...stageGains(stage, g),
    seconds: TUNE.seconds,
    start: TUNE.start,
    h: balBody(2).L,
    offset: tuneOffset(),
    pushes: [{ at: TUNE.push, kick: TUNE.kick }],
    sense: imuReader(TUNE_IMU),
  })
  const fell = fellAt(run)
  const live = run.filter((f) => !f.fallen)
  let swings = 0
  for (let i = 1; i < live.length; i++) if (Math.sign(live[i].tilt) !== Math.sign(live[i - 1].tilt)) swings++
  const tail = live.filter((f) => f.t > TUNE.seconds - 1).map((f) => f.tilt)
  const wobble = tail.length ? Math.max(...tail) - Math.min(...tail) : 0
  const v = run[run.length - 1].v
  const verdict: TuneVerdict =
    fell !== null ? (swings >= 4 ? 'oscillates' : Math.abs(live[live.length - 1].x) > 0.5 ? 'runsOff' : 'topples') : wobble > 2 * DEG ? 'wobbles' : Math.abs(v) > 0.05 ? 'creeps' : 'holds'
  return { run, fell, swings, wobble, v, verdict }
}
/** The sheet: every stage with the same slider gains. */
export const tuneSheet = (g: TuneGains) => (Object.keys(TUNE_STAGES) as TuneStage[]).map((s) => ({ stage: s, ...tuneRun(s, g) }))
