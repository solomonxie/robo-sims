// Rotation: moment of inertia of simple rotors, conservation of angular momentum, a shooter flywheel.
import { TAU } from '../common'

/** Same mass `kg` as a disk and a ring of radius `r`, and as two equal masses at `armR` on a light arm (kg·m²). */
export const rotorInertias = (kg: number, r: number, armR: number) => ({ disk: 0.5 * kg * r * r, ring: kg * r * r, arm: kg * armR * armR })
export type RotorShape = keyof ReturnType<typeof rotorInertias>

/** Constant torque `tau` on inertia `inertia` from rest until it has turned `turns`: α = τ/I, time, ω and ½Iω² (= τθ) then. */
export function spinRace(tau: number, inertia: number, turns: number) {
  const alpha = tau / inertia
  const theta = TAU * turns
  const t = Math.sqrt((2 * theta) / alpha)
  return { alpha, t, omega: alpha * t, energy: tau * theta }
}

/** Angle turned `t` s into a race; past the finish the torque stops and it coasts at the speed it reached. */
export const raceAngle = (alpha: number, t: number, finish: number) => (t <= finish ? 0.5 * alpha * t * t : 0.5 * alpha * finish * finish + alpha * finish * (t - finish))

/** Robot body on a turntable (about its yaw axis), hand weights swinging between `armMin` and `armMax` m. */
export const SPINNER = { bodyKgM2: 0.003, armMin: 0.04, armMax: 0.16, period: 6, wheelR: 0.04, ramp: 0.5, hold: 1 }
export const spinnerInertia = (handKg: number, r: number) => SPINNER.bodyKgM2 + 2 * handKg * r * r

/** Arm radius `t` s into the out → in → out cycle. */
export const armRadius = (t: number) => {
  const u = 0.5 - 0.5 * Math.cos((TAU * t) / SPINNER.period)
  return SPINNER.armMax - (SPINNER.armMax - SPINNER.armMin) * u
}

/** Reaction wheel speed relative to the body: ramp up, hold, ramp down, rest, then the same backwards. */
export function wheelRate(t: number, top: number) {
  const { ramp, hold, period } = SPINNER
  const half = period / 2
  const sign = t % period < half ? 1 : -1
  const u = t % half
  const r = u < ramp ? u / ramp : u < ramp + hold ? 1 : u < 2 * ramp + hold ? (2 * ramp + hold - u) / ramp : 0
  return sign * r * top
}

export type SpinMode = 'arms' | 'wheel'
interface SpinFrame { t: number; r: number; inertia: number; omega: number; theta: number; wheel: number; wheelAngle: number; L: number; ke: number }

/** One cycle of the turntable. `arms`: L set by `rpm` with the arms out, then ω = L / I as they move. `wheel`: arms in,
 *  a disk of `wheelKg` spun to `rpm` relative to the body; total L stays 0 so the body turns the other way. */
export function spinnerRun(mode: SpinMode, kg: number, rpm: number, dt = 0.01): SpinFrame[] {
  const out: SpinFrame[] = []
  const iw = 0.5 * kg * SPINNER.wheelR ** 2
  const L0 = spinnerInertia(kg, SPINNER.armMax) * ((rpm * TAU) / 60)
  let theta = 0
  let wheelAngle = 0
  for (let i = 0; i <= Math.round(SPINNER.period / dt); i++) {
    const t = i * dt
    if (mode === 'arms') {
      const r = armRadius(t)
      const inertia = spinnerInertia(kg, r)
      const omega = L0 / inertia
      out.push({ t, r, inertia, omega, theta, wheel: 0, wheelAngle: 0, L: L0, ke: 0.5 * inertia * omega * omega })
      theta += omega * dt
    } else {
      const wheel = wheelRate(t, (rpm * TAU) / 60)
      const ib = SPINNER.bodyKgM2
      const omega = (-iw * wheel) / (ib + iw)
      const L = ib * omega + iw * (omega + wheel)
      out.push({ t, r: SPINNER.armMin, inertia: ib, omega, theta, wheel, wheelAngle, L, ke: 0.5 * ib * omega * omega + 0.5 * iw * (omega + wheel) ** 2 })
      theta += omega * dt
      wheelAngle += wheel * dt
    }
  }
  return out
}

/** Body turn per wheel turn (relative to the body) on a free body: −I_w / (I_b + I_w). */
export const reactionRatio = (bodyKgM2: number, wheelKgM2: number) => -wheelKgM2 / (bodyKgM2 + wheelKgM2)

/** Ball shooter: brushed motor on 4:1 to a 5 cm wheel (wheel + reflected rotor J0), balls fed at `fireAt` s. */
export const SHOOTER = { stallNm: 0.8, freeRadS: 500, wheelR: 0.05, baseKgM2: 3e-4, fireAt: 4, balls: 5, seconds: 7, dt: 0.005 }
export const FLYWHEELS = {
  none: { name: 'No flywheel: shooter wheel only', kg: 0, r: 0 },
  small: { name: 'Small flywheel: 0.3 kg, r 5 cm', kg: 0.3, r: 0.05 },
  big: { name: 'Big flywheel: 0.6 kg, r 7 cm', kg: 0.6, r: 0.07 },
} as const
export type Flywheel = keyof typeof FLYWHEELS
export const shooterInertia = (f: Flywheel) => SHOOTER.baseKgM2 + 0.5 * FLYWHEELS[f].kg * FLYWHEELS[f].r ** 2

/** Mechanical time constant on the straight torque–speed line: J·ω_free / τ_stall. */
export const spinTau = (inertia: number) => (inertia * SHOOTER.freeRadS) / SHOOTER.stallNm

/** Ball `kg` squeezed against the hood leaves at half the rim speed; the wheel pays its momentum at radius r:
 *  J ω₀ = J ω₁ + m (ω₁ r / 2) r. */
export function shot(inertia: number, omega0: number, kg: number) {
  const r = SHOOTER.wheelR
  const omega1 = (inertia * omega0) / (inertia + (kg * r * r) / 2)
  const v = (omega1 * r) / 2
  return { omega1, v, ballJ: 0.5 * kg * v * v, wheelJ: 0.5 * inertia * (omega0 * omega0 - omega1 * omega1) }
}

interface ShooterFrame { t: number; omega: number; energy: number }
interface ShotBall { t: number; omega0: number; v: number; ballJ: number; wheelJ: number }

/** Spin-up from rest, then a burst of balls `gap` s apart; ω relaxes exactly toward ω_free between shots. */
export function shooterRun(f: Flywheel, gap: number, ballKg: number) {
  const { dt, seconds, fireAt, balls: count, freeRadS } = SHOOTER
  const inertia = shooterInertia(f)
  const decay = Math.exp(-dt / spinTau(inertia))
  const frames: ShooterFrame[] = []
  const balls: ShotBall[] = []
  let omega = 0
  for (let i = 0; i <= Math.round(seconds / dt); i++) {
    const t = i * dt
    const k = balls.length
    if (k < count && t >= fireAt + k * gap - 1e-9) {
      const s = shot(inertia, omega, ballKg)
      balls.push({ t, omega0: omega, v: s.v, ballJ: s.ballJ, wheelJ: s.wheelJ })
      omega = s.omega1
    }
    frames.push({ t, omega, energy: 0.5 * inertia * omega * omega })
    omega = freeRadS + (omega - freeRadS) * decay
  }
  const vs = balls.map((b) => b.v)
  const spinUp95 = 3 * spinTau(inertia)
  const ideal = (freeRadS * SHOOTER.wheelR) / 2
  return { inertia, frames, balls, ideal, worst: Math.min(...vs), sag: 1 - Math.min(...vs) / ideal, spinUp95, stored: 0.5 * inertia * freeRadS ** 2 }
}
