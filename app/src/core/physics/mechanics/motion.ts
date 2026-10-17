// Linear kinematics: constant acceleration, a drive profile on a v–t plot, projectile flight with optional air drag.
import { G } from '../common'

/** Position and speed after `t` s from speed `u` at constant `a`; braking (a < 0) stops at v = 0 rather than reversing. */
export function uniformAt(u: number, a: number, t: number) {
  const tStop = a < 0 && u > 0 ? -u / a : Infinity
  const tt = Math.min(t, tStop)
  return { s: u * tt + 0.5 * a * tt * tt, v: u + a * tt, stopped: t >= tStop }
}

/** Strobe snapshots every `tau` s up to `seconds`: position, speed and the gap Δs since the previous flash. */
export function strobeRun(u: number, a: number, tau: number, seconds: number) {
  const out: { t: number; s: number; v: number; ds: number }[] = []
  for (let i = 0; i * tau <= seconds + 1e-9; i++) {
    const t = i * tau
    const { s, v } = uniformAt(u, a, t)
    out.push({ t, s, v, ds: i ? s - out[i - 1].s : 0 })
  }
  return out
}

interface DrivePhase { name: 'accelerate' | 'cruise' | 'brake'; t0: number; t1: number; a: number; v0: number; s0: number }

/** Accelerate at `accel` to `speed`, cruise `cruise` s, brake at `brake` to rest. */
export function driveProfile({ accel, speed, cruise, brake }: { accel: number; speed: number; cruise: number; brake: number }) {
  const ta = speed / accel
  const tb = speed / brake
  const sa = (speed * ta) / 2
  const sc = speed * cruise
  const phases: DrivePhase[] = [
    { name: 'accelerate', t0: 0, t1: ta, a: accel, v0: 0, s0: 0 },
    { name: 'cruise', t0: ta, t1: ta + cruise, a: 0, v0: speed, s0: sa },
    { name: 'brake', t0: ta + cruise, t1: ta + cruise + tb, a: -brake, v0: speed, s0: sa + sc },
  ]
  return { phases, T: ta + cruise + tb, areas: [sa, sc, (speed * tb) / 2], distance: sa + sc + (speed * tb) / 2 }
}
type DriveProfile = ReturnType<typeof driveProfile>

/** State on a `driveProfile` at time `t` (holds at rest after the end). */
export function profileAt(p: DriveProfile, t: number) {
  const i = p.phases.findIndex((ph) => t < ph.t1)
  if (i < 0) return { s: p.distance, v: 0, a: 0, phase: -1 }
  const ph = p.phases[i]
  const dt = Math.max(0, t - ph.t0)
  return { s: ph.s0 + ph.v0 * dt + 0.5 * ph.a * dt * dt, v: ph.v0 + ph.a * dt, a: ph.a, phase: i }
}

/** Ideal (vacuum) projectile from ground level: flight time, range and peak. */
export function projectileIdeal(speed: number, theta: number) {
  const vx = speed * Math.cos(theta)
  const vy = speed * Math.sin(theta)
  return { vx, vy, T: (2 * vy) / G, range: (2 * vx * vy) / G, peak: (vy * vy) / (2 * G), tPeak: vy / G }
}

/** Ball drag constant k = ½ ρ Cd A / m (1/m): deceleration = k v². */
export const BALLS = {
  vacuum: { name: 'No air', k: 0 },
  tennis: { name: 'Tennis ball', k: (0.5 * 1.2 * 0.55 * Math.PI * 0.0335 ** 2) / 0.057 },
  pingpong: { name: 'Ping-pong ball', k: (0.5 * 1.2 * 0.5 * Math.PI * 0.02 ** 2) / 0.0027 },
}

interface FlightFrame { t: number; x: number; y: number; vx: number; vy: number }

/** Flight from the ground at `speed`, `theta` rad with quadratic drag `k`; RK4 steps of `dt` until it lands (last frame at y = 0). */
export function flightRun(speed: number, theta: number, k: number, dt = 0.005) {
  type S = [number, number, number, number]
  const f = ([, , vx, vy]: S): S => {
    const v = Math.hypot(vx, vy)
    return [vx, vy, -k * v * vx, -G - k * v * vy]
  }
  const step = (s: S, h: number): S => {
    const k1 = f(s)
    const k2 = f(s.map((x, i) => x + (h / 2) * k1[i]) as S)
    const k3 = f(s.map((x, i) => x + (h / 2) * k2[i]) as S)
    const k4 = f(s.map((x, i) => x + h * k3[i]) as S)
    return s.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) as S
  }
  let s: S = [0, 0, speed * Math.cos(theta), speed * Math.sin(theta)]
  const out: FlightFrame[] = [{ t: 0, x: 0, y: 0, vx: s[2], vy: s[3] }]
  let peak = out[0]
  for (let i = 1; i < 20000; i++) {
    const n = step(s, dt)
    if (n[1] < 0) {
      const u = s[1] / (s[1] - n[1])
      const lerp = (j: number) => s[j] + (n[j] - s[j]) * u
      out.push({ t: (i - 1 + u) * dt, x: lerp(0), y: 0, vx: lerp(2), vy: lerp(3) })
      break
    }
    s = n
    const fr = { t: i * dt, x: s[0], y: s[1], vx: s[2], vy: s[3] }
    out.push(fr)
    if (fr.y > peak.y) peak = fr
  }
  const end = out[out.length - 1]
  return { run: out, T: end.t, range: end.x, peak, landSpeed: Math.hypot(end.vx, end.vy) }
}

/** Frame of a `flightRun` at time `t`, interpolated; holds the landing frame after touchdown. */
export function flightAt(run: readonly FlightFrame[], t: number, dt = 0.005): FlightFrame {
  const i = Math.min(run.length - 2, Math.max(0, Math.floor(t / dt)))
  const a = run[i]
  const b = run[i + 1]
  const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)))
  return { t: Math.min(t, b.t), x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, vx: a.vx + (b.vx - a.vx) * u, vy: a.vy + (b.vy - a.vy) * u }
}
