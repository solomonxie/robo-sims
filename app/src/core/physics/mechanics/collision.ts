// Collisions: two carts with restitution e, and a sprung bumper with a trip switch hitting a wall.
import { G } from '../common'
import { TT_CAR } from '../actuators/dcmotor'

/** 1-D collision of m1 at v1 with m2 at v2, restitution e (0 = stick, 1 = elastic). */
export function collide1d(m1: number, v1: number, m2: number, v2: number, e: number) {
  const M = m1 + m2
  const vcm = (m1 * v1 + m2 * v2) / M
  const rel = v1 - v2
  const u1 = vcm - (e * m2 * rel) / M
  const u2 = vcm + (e * m1 * rel) / M
  const ke = (a: number, b: number) => 0.5 * m1 * a * a + 0.5 * m2 * b * b
  return { u1, u2, vcm, p0: m1 * v1 + m2 * v2, p1: m1 * u1 + m2 * u2, ke0: ke(v1, v2), ke1: ke(u1, u2), lost: 0.5 * ((m1 * m2) / M) * (1 - e * e) * rel * rel }
}

export interface CartFrame {
  t: number
  x1: number
  x2: number
  v1: number
  v2: number
}

/** Cart centres start at x1 < x2 and touch when x2 − x1 = `len`; runs until either centre passes ±`end` m (or `maxT`). */
export function cartsRun({ m1, m2, v1, v2, e, x1 = -0.4, x2 = 0.05, len = 0.21, end = 0.55, maxT = 3, dt = 0.005 }: { m1: number; m2: number; v1: number; v2: number; e: number; x1?: number; x2?: number; len?: number; end?: number; maxT?: number; dt?: number }) {
  const closing = v1 - v2
  const tHit = closing > 0 ? (x2 - x1 - len) / closing : Infinity
  const c = collide1d(m1, v1, m2, v2, e)
  const at = (t: number): CartFrame => {
    if (t <= tHit) return { t, x1: x1 + v1 * t, x2: x2 + v2 * t, v1, v2 }
    const s = t - tHit
    const h1 = x1 + v1 * tHit
    return { t, x1: h1 + c.u1 * s, x2: h1 + len + c.u2 * s, v1: c.u1, v2: c.u2 }
  }
  const out: CartFrame[] = []
  for (let i = 0; i * dt <= maxT + 1e-9; i++) {
    const f = at(i * dt)
    out.push(f)
    if (Math.max(Math.abs(f.x1), Math.abs(f.x2)) > end) break
  }
  return { frames: out, tHit, seconds: out[out.length - 1].t, ...c }
}

/** TT robot with a sprung front bumper: switch trips after `trip`, chassis hits the wall past `travel`; braking μ·m·g. */
export const BUMP_BOT = { massKg: TT_CAR.massKg, trip: 0.002, mu: 0.7, kHard: 2e5, cHard: 60, lead: 0.06 }

export interface BumpFrame {
  t: number
  x: number
  v: number
  f: number
  braking: boolean
}

/** Bumper face at x (0 = touching the wall, + = squashed) from −v0·lead; spring k, travel limit, brake after trip + delay. */
export function bumpRun({ v0, k, travel, delay, mass = BUMP_BOT.massKg, trip = BUMP_BOT.trip, mu = BUMP_BOT.mu, seconds = 0.3, dt = 2e-5, every = 5 }: { v0: number; k: number; travel: number; delay: number; mass?: number; trip?: number; mu?: number; seconds?: number; dt?: number; every?: number }) {
  const brake = mu * mass * G
  const out: BumpFrame[] = []
  let x = -v0 * BUMP_BOT.lead
  let v = v0
  let tTrip = Infinity
  let tHard = Infinity
  let vHard = 0
  let peak = 0
  let xMax = x
  let impulse = 0
  const n = Math.round(seconds / dt)
  for (let i = 0; i <= n; i++) {
    const t = i * dt
    const s = Math.max(0, x)
    let f = k * s
    if (s > travel) {
      if (tHard === Infinity) [tHard, vHard] = [t, v]
      f += Math.max(0, BUMP_BOT.kHard * (s - travel) + BUMP_BOT.cHard * v)
    }
    if (s >= trip && tTrip === Infinity) tTrip = t
    const braking = t >= tTrip + delay
    if (i % every === 0) out.push({ t, x, v, f, braking })
    peak = Math.max(peak, f)
    impulse += f * dt
    let a = -f / mass
    if (braking) {
      if (Math.abs(v) < 1e-6 && f <= brake) a = 0
      else a -= (Math.sign(v || -f) * brake) / mass
    }
    const vn = v + a * dt
    v = braking && v !== 0 && Math.sign(vn) !== Math.sign(v) ? 0 : vn
    x += v * dt
    xMax = Math.max(xMax, x)
  }
  return { frames: out, dt: dt * every, tTrip, tBrake: tTrip + delay, tHard, vHard, hit: tHard < Infinity, peak, impulse, squash: Math.max(0, xMax), brake }
}

/** Squash needed to stop on brakes alone (no spring): trip + v·delay + v²/(2μg). */
export const brakeOnlyStop = (v0: number, delay: number, trip = BUMP_BOT.trip, mu = BUMP_BOT.mu) => trip + v0 * delay + (v0 * v0) / (2 * mu * G)
