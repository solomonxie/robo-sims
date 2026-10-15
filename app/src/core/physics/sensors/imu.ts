// IMU: MEMS accelerometer proof mass, Coriolis gyro, complementary filter, gyro bias drift.
import { Vec3 } from '../../fields'
import { gaussAt } from '../mcu/adc'

const G = 9.81
const DEG = Math.PI / 180

// --- Accelerometer: the proof mass feels specific force (acceleration minus gravity), in g. ---

/** Body-frame reading (g) of a robot pitched nose-up by `pitch` (rad) while accelerating `ah` forward and `av` up (g, world). */
export function bodyAccel(pitch: number, ah: number, av = 0): Vec3 {
  const c = Math.cos(pitch)
  const s = Math.sin(pitch)
  return [ah * c + (1 + av) * s, 0, -ah * s + (1 + av) * c]
}
/** Nose-up tilt from a reading: right only when gravity is the only force. */
export const accelTilt = ([x, , z]: Vec3) => Math.atan2(x, z)
/** Proof-mass shift (m) for `fG` g on a spring–mass resonating at `f0Hz`: x = a / ω₀². */
export const proofShift = (fG: number, f0Hz: number) => (fG * G) / (2 * Math.PI * f0Hz) ** 2
/** Comb capacitance change ΔC / C for a shift `x` across a finger gap `gap` (m). */
export const combChange = (x: number, gap: number) => x / gap

// --- Gyroscope: a driven mass swings along x; rotation about z pushes it along y (Coriolis). ---

/** Peak drive velocity (m/s) of a mass swinging `ampM` at `fHz`. */
export const driveSpeed = (ampM: number, fHz: number) => 2 * Math.PI * fHz * ampM
/** Coriolis acceleration (m/s²) = 2 Ω v. */
export const coriolisAccel = (rateRad: number, v: number) => 2 * rateRad * v

export const GYRO_RANGES = { 250: 131, 500: 65.5, 1000: 32.8, 2000: 16.4 } as const
export type GyroRange = keyof typeof GYRO_RANGES
/** Raw int16 count for `dps` at full scale `fs` °/s: clips at ±32767. */
export const gyroCounts = (dps: number, fs: GyroRange) => Math.max(-32768, Math.min(32767, Math.round(dps * GYRO_RANGES[fs])))
export const countsToDps = (counts: number, fs: GyroRange) => counts / GYRO_RANGES[fs]
/** Yaw rate (°/s) at `t` in a 3 s cycle: a quick left turn peaking at `peak`, then a slow turn back; net angle zero. */
export function yawProfile(t: number, peak: number) {
  const u = ((t % 3) + 3) % 3
  if (u < 0.5) return peak * Math.sin((Math.PI * u) / 0.5) ** 2
  if (u >= 0.75 && u < 2.75) return (-peak / 4) * Math.sin((Math.PI * (u - 0.75)) / 2) ** 2
  return 0
}
/** Angle by summing rate samples (rectangle rule): θ += ω·dt. */
export function integrateRate(rates: number[], dt: number, start = 0) {
  let a = start
  return rates.map((r) => (a += r * dt))
}

// --- Complementary filter: gyro for the short term, accel for the long term. ---

/** α for time constant `tauS` at loop period `dt`: below τ trust the gyro, above it the accel. */
export const compAlpha = (tauS: number, dt: number) => tauS / (tauS + dt)
export const compTau = (alpha: number, dt: number) => (alpha * dt) / (1 - alpha)
/** One filter step: angle = α (angle + ω dt) + (1 − α) accelAngle. */
export const compStep = (angle: number, rate: number, accelAngle: number, dt: number, alpha: number) => alpha * (angle + rate * dt) + (1 - alpha) * accelAngle

/** A balancing robot's wobble at `t` s: tilt (rad), tilt rate (rad/s) and the wheel acceleration (g) that catches it. */
export function balanceWobble(t: number) {
  const w1 = 2 * Math.PI * 0.35
  const w2 = 2 * Math.PI * 1.1
  const tilt = 0.14 * Math.sin(w1 * t) + 0.05 * Math.sin(w2 * t + 1)
  const rate = 0.14 * w1 * Math.cos(w1 * t) + 0.05 * w2 * Math.cos(w2 * t + 1)
  const spin = -0.14 * w1 * w1 * Math.sin(w1 * t) - 0.05 * w2 * w2 * Math.sin(w2 * t + 1)
  return { tilt, rate, ah: 0.1 * Math.tan(tilt) - 0.05 * spin }
}

export interface ImuRun {
  t: number[]
  truth: number[]
  accel: number[]
  gyro: number[]
  fused: number[]
}
/** Runs the wobble through a noisy accel (`noiseG` rms) and a biased gyro (`biasDps`), all angles in rad. */
export function balanceRun(alpha: number, biasDps: number, seconds: number, dt = 0.01, noiseG = 0.04, noiseDps = 0.3): ImuRun {
  const r: ImuRun = { t: [], truth: [], accel: [], gyro: [], fused: [] }
  let gyro = 0
  let fused = 0
  for (let k = 0; k * dt <= seconds + 1e-9; k++) {
    const t = k * dt
    const w = balanceWobble(t)
    const f = bodyAccel(w.tilt, w.ah)
    const acc = accelTilt([f[0] + noiseG * gaussAt(3 * k), 0, f[2] + noiseG * gaussAt(3 * k + 1)])
    const rate = w.rate + (biasDps + noiseDps * gaussAt(3 * k + 2)) * DEG
    if (k === 0) gyro = fused = acc
    else {
      gyro += rate * dt
      fused = compStep(fused, rate, acc, dt, alpha)
    }
    r.t.push(t)
    r.truth.push(w.tilt)
    r.accel.push(acc)
    r.gyro.push(gyro)
    r.fused.push(fused)
  }
  return r
}
export const angleRms = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length)

// --- Drift: zero-rate offset moves with temperature; a still calibration measures it. ---

/** Illustrative MPU-6050-class gyro: zero-rate offset at 25 °C, tempco, noise rms per 100 Hz sample. */
export const GYRO_ZRO = { b25: 1.6, tc: 0.045, noise: 0.05, calC: 25 }
export const gyroBiasAt = (tempC: number) => GYRO_ZRO.b25 + GYRO_ZRO.tc * (tempC - 25)
/** Bias estimate (°/s) from `n` still samples taken at `tempC`: their mean. */
export function calibrateBias(n: number, tempC: number, seed = 0) {
  let s = 0
  for (let k = 0; k < n; k++) s += gyroBiasAt(tempC) + GYRO_ZRO.noise * gaussAt(seed + k)
  return s / n
}
export type CalMode = 'none' | 'rest' | 'temp'
/** Bias left after correction (°/s): none, a still calibration at `calC`, or that plus the tempco model. */
export function residualBias(mode: CalMode, tempC: number, samples = 500) {
  if (mode === 'none') return gyroBiasAt(tempC)
  const est = calibrateBias(samples, GYRO_ZRO.calC, 9000)
  return gyroBiasAt(tempC) - est - (mode === 'temp' ? GYRO_ZRO.tc * (tempC - GYRO_ZRO.calC) : 0)
}
/** Heading error (°) after `t` s: bias × t plus the angle random walk of the noise so far. */
export function driftRun(biasDps: number, seconds: number, dt = 0.01) {
  const err: number[] = []
  let h = 0
  for (let k = 0; k * dt < seconds - 1e-9; k++) err.push((h += (biasDps + GYRO_ZRO.noise * gaussAt(50000 + k)) * dt))
  return err
}
/** Path (m) driven at `v` m/s along headings `deg[]` sampled every `dt` s, from the origin along +x. */
export function headingPath(deg: number[], v: number, dt: number) {
  let x = 0
  let y = 0
  return deg.map((h) => {
    x += v * dt * Math.cos(h * DEG)
    y += v * dt * Math.sin(h * DEG)
    return [x, y] as [number, number]
  })
}
