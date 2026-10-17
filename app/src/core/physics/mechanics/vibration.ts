// Vibration: rotating unbalance shaking a sprung frame, an accelerometer on it, and isolating mounts.
import { G, gaussAt } from '../common'
import { rpmToRadS } from '../actuators/stepper'
import { dftAmplitudes } from '../signals/fourier'
import { ampRatio, phaseLag } from './oscillation'

/** Rotating force of mass `kg` at radius `m` spinning at ω: m·e·ω² (N). */
export const unbalanceForce = (kg: number, m: number, w: number) => kg * m * w * w

interface ShakeRig {
  M: number
  fn: number
  zeta: number
}
/** Motor and its plate on rubber feet. */
export const MOTOR_PLATE: ShakeRig = { M: 0.3, fn: 25, zeta: 0.1 }

/** Steady whirl of a frame of mass M shaken by an unbalance m·e at ω: X = (m·e/M)·r²·H(r), lag behind the force. */
export function frameShake(rig: ShakeRig, kg: number, m: number, rpm: number) {
  const w = rpmToRadS(rpm)
  const r = w / (2 * Math.PI * rig.fn)
  const x = ((kg * m) / rig.M) * r * r * ampRatio(rig.zeta, r)
  return { w, hz: rpm / 60, r, force: unbalanceForce(kg, m, w), x, accel: w * w * x, lag: phaseLag(rig.zeta, r) }
}

export const ACC_HZ = 1000
export const ACC_N = 256
export const ACC_NOISE_G = 0.01

/** Accelerometer samples (g, gravity removed) of a ±`ampG` sine at `hz` plus white noise, `ACC_HZ` sample rate. */
export function accelSamples(ampG: number, hz: number, noiseG: number, seed: number, n = ACC_N, phase = 0) {
  return Array.from({ length: n }, (_, i) => ampG * Math.sin((2 * Math.PI * hz * i) / ACC_HZ + phase) + noiseG * gaussAt(seed + i))
}

/** Amplitude spectrum (Hann) of samples at `ACC_HZ`, and its tallest bin. */
export function accelSpectrum(xs: readonly number[]) {
  const amps = dftAmplitudes(xs, true)
  const df = ACC_HZ / xs.length
  let k = 1
  for (let i = 2; i < amps.length; i++) if (amps[i] > amps[k]) k = i
  return { amps, df, peakHz: k * df, peak: amps[k] }
}

export const accelG = (ms2: number) => ms2 / G

/** Base-excited mount: board amplitude ÷ frame amplitude, √(1 + (2ζr)²) / √((1 − r²)² + (2ζr)²). */
export const transmissibility = (zeta: number, r: number) => Math.hypot(1, 2 * zeta * r) * ampRatio(zeta, r)
/** Board motion lag behind the frame (rad). */
export const transmitLag = (zeta: number, r: number) => Math.atan2(2 * zeta * r ** 3, 1 - r * r + (2 * zeta * r) ** 2)
/** Above r = √2 the mount passes less than it gets, whatever ζ. */
export const ISOLATION_R = Math.SQRT2
/** Mount stiffness for a board of `kg` to sit at fn: k = m·(2π·fn)². */
export const mountStiffness = (kg: number, fn: number) => kg * (2 * Math.PI * fn) ** 2

export const MOUNTS = { none: 'Hard-mounted', stiff: 'Stiff rubber', soft: 'Soft gummies' }
export type Mount = keyof typeof MOUNTS
export const MOUNT_FN: Record<Mount, number> = { none: Infinity, stiff: 120, soft: 30 }
export const mountTransmit = (mount: Mount, zeta: number, hz: number) => (mount === 'none' ? 1 : transmissibility(zeta, hz / MOUNT_FN[mount]))
export const mountLag = (mount: Mount, zeta: number, hz: number) => (mount === 'none' ? 0 : transmitLag(zeta, hz / MOUNT_FN[mount]))
