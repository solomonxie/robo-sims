// Gravity and inertia: an accelerometer reads specific force (acceleration minus gravity), not gravity. A dropped IMU reads
// ~0 g until drag or the floor push on it; free-fall detection and h = ½gt²; the body-frame reading in everyday motions.
import { G } from '../common'
import { Vec3 } from '../../fields'
import { accelPitch } from '../mcu/i2c'
import { toBody } from '../sensors/magnetometer'
import { FLUIDS } from './fluids'

const RHO_AIR = FLUIDS.air.rho
/** MPU-6050 at its widest range: ±16 g; harder knocks clip. */
export const ACCEL_FS_G = 16
const ACCEL_ODR_S = 0.001

/** Dropped things: mass, drag area Cd·A (m²), contact stiffness (N/m) and damping ratio of what hits the floor. */
export const DROP_BODIES = {
  phone: { name: 'Phone in a case', kg: 0.2, cda: 0.012, k: 1e5, zeta: 0.8 },
  robot: { name: 'Rover, 1.5 kg', kg: 1.5, cda: 0.02, k: 4e5, zeta: 0.8 },
  drone: { name: 'Drone, motors cut', kg: 0.9, cda: 0.09, k: 6e4, zeta: 0.8 },
} as const
export type DropBody = keyof typeof DROP_BODIES

/** Drop time from rest without drag: t = √(2h/g). */
export const dropTime = (h: number) => Math.sqrt((2 * h) / G)
/** Height back from a fall time: h = ½gt². */
export const fallHeight = (t: number) => 0.5 * G * t * t
/** Terminal speed where drag ½ρCdA·v² equals the weight. */
export const terminalSpeed = (kg: number, cda: number) => Math.sqrt((2 * kg * G) / (RHO_AIR * cda))

export interface DropSample {
  t: number
  z: number
  v: number
  /** Accelerometer magnitude (g), averaged over one output sample and clipped at full scale. */
  g: number
  /** Unclipped average. */
  raw: number
}
/** Holds `holdS` at rest (1 g), drops from `h` m with quadratic drag, hits a spring–damper floor, settles; samples every ms. */
export function dropRun(h: number, body: DropBody, { holdS = 0.3, afterS = 0.5, dt = 2e-5 } = {}) {
  const B = DROP_BODIES[body]
  const c = 2 * B.zeta * Math.sqrt(B.k * B.kg)
  const drag = 0.5 * RHO_AIR * B.cda
  const per = Math.round(ACCEL_ODR_S / dt)
  const out: DropSample[] = []
  let z = h
  let v = 0
  let t = 0
  let impactT = Infinity
  let peakRaw = 0
  let acc = 0
  let n = 0
  while (t < impactT + afterS && t < 30) {
    const held = t < holdS
    const pen = Math.max(0, -z)
    const contact = pen > 0 ? Math.max(0, B.k * pen - c * v) : 0
    const fNon = held ? B.kg * G : contact - drag * v * Math.abs(v)
    const a = held ? 0 : fNon / B.kg - G
    if (pen > 0 && impactT === Infinity) impactT = t
    v += a * dt
    z += v * dt
    t += dt
    acc += Math.abs(fNon) / (B.kg * G)
    if (++n === per) {
      const raw = acc / per
      peakRaw = Math.max(peakRaw, raw)
      out.push({ t, z, v, raw, g: Math.min(ACCEL_FS_G, raw) })
      acc = n = 0
    }
  }
  const fallS = impactT - holdS
  const hit = out.find((s) => s.t >= impactT) ?? out[out.length - 1]
  const before = out.filter((s) => s.t < impactT)
  return { samples: out, holdS, impactT, fallS, peakRaw, clipped: peakRaw > ACCEL_FS_G, impactV: -(before[before.length - 1]?.v ?? 0), dragAtImpact: before[before.length - 1]?.raw ?? 0, hitG: hit.g, vt: terminalSpeed(B.kg, B.cda) }
}

/** Free-fall interrupt: magnitude below `thresholdG` for at least `minS` → a fall; its length gives h = ½gt². */
export function detectFall(samples: readonly DropSample[], thresholdG: number, minS = 0.03) {
  let start = -1
  for (let i = 0; i < samples.length; i++) {
    const low = samples[i].g < thresholdG
    if (low && start < 0) start = i
    if (!low && start >= 0) {
      const lenS = samples[i].t - samples[start].t
      if (lenS >= minS) return { found: true, fromS: samples[start].t, toS: samples[i].t, lenS, heightM: fallHeight(lenS) }
      start = -1
    }
  }
  return { found: false, fromS: 0, toS: 0, lenS: 0, heightM: 0 }
}

// --- Accelerometer reading: specific force in the body frame for everyday motions. ---

/** World acceleration (g, north/west/up) for each motion at strength `a` g; the turn is a left turn (centripetal to the left). */
export const MOTIONS = {
  still: { name: 'Sitting still', a: (): Vec3 => [0, 0, 0] },
  forward: { name: 'Speeding up', a: (a: number): Vec3 => [a, 0, 0] },
  brake: { name: 'Braking', a: (a: number): Vec3 => [-a, 0, 0] },
  liftUp: { name: 'Lift starting up', a: (a: number): Vec3 => [0, 0, a] },
  liftDown: { name: 'Lift starting down', a: (a: number): Vec3 => [0, 0, -a] },
  turn: { name: 'Turning left', a: (a: number): Vec3 => [0, a, 0] },
  fall: { name: 'Free fall', a: (): Vec3 => [0, 0, -1] },
} as const
export type Motion = keyof typeof MOTIONS

/** Accelerometer reading (g, body X forward, Y left, Z up) = R⁻¹ (a − g): a still, level sensor reads (0, 0, +1). */
export const specificForce = (aWorld: Vec3, pitch: number, roll = 0) => toBody([aWorld[0], aWorld[1], aWorld[2] + 1], 0, pitch, roll)

/** The reading for a motion, its size and the pitch and roll a tilt-from-accelerometer estimate would report. */
export function accelReading(motion: Motion, aG: number, pitch: number, roll = 0) {
  const a = MOTIONS[motion].a(aG)
  const f = specificForce(a, pitch, roll)
  const mag = Math.hypot(...f)
  const est = mag > 0.05 ? accelPitch(f) : NaN
  const estRoll = mag > 0.05 ? Math.atan2(f[1], f[2]) : NaN
  return { a, f, mag, est, err: est - pitch, estRoll, rollErr: estRoll - roll }
}

/** Turn speed (m/s) giving `aG` of centripetal acceleration on a radius `r`: v = √(a r). */
export const turnSpeed = (aG: number, r: number) => Math.sqrt(aG * G * r)
