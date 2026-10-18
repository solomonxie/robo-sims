// Balancing robots: inverted pendulum on wheels (cart-pole), cascaded speed → tilt PID loops.
import { DEG, G, clamp } from '../common'
import { Gains, PID0, pidStep } from '../control/pid'

/** Two-wheeled ESP32 + MPU-6050 balancer: CoM height above the axle (m), wheel radius (m), wheel acceleration at full
 *  torque (m/s²), free speed where back-EMF eats the supply (m/s), motor lag (s), control loop period (s) and the battery's share of the mass. */
export const BALANCER = { h: 0.12, wheelR: 0.0325, aMax: 14, vMax: 1.1, lag: 0.03, dt: 0.005, battery: 0.4 }
export type Balancer = typeof BALANCER
/** Tilt where the body lies on the floor. */
const LIE_ANGLE = 1.35

/** Fall time constant √(h/g): a small tilt grows e-fold every τ. */
export const fallTau = (h: number) => Math.sqrt(h / G)
/** Tilt acceleration gravity gives a point mass `h` above the pivot. */
export const gravityAlpha = (tilt: number, h: number) => (G * Math.sin(tilt)) / h
/** Time to topple from `from` to `to` rad with the wheels still (linear model: θ = θ₀·cosh(t/τ)). */
export const fallTime = (from: number, to: number, h: number) => fallTau(h) * Math.acosh(Math.max(1, to / from))
/** Wheel acceleration that holds a tilt steady (gravity and inertial torques cancel). */
export const catchAccel = (tilt: number) => G * Math.tan(tilt)

/** Torque command after the supply limit at speed `v`: −1 − v/vMax … 1 − v/vMax. */
export const torqueLimit = (cmd: number, v: number, bot: Balancer = BALANCER) => clamp(clamp(cmd, -1, 1), -1 - v / bot.vMax, 1 - v / bot.vMax)

/** CoM angle off the body axis when the battery sits `shift` m forward. */
export const comOffset = (shift: number, bot: Balancer = BALANCER) => Math.atan((bot.battery * shift) / bot.h)
/** Smallest tilt P (torque command per degree) that out-pushes gravity: aMax·Kp > g. */
export const kpMin = (bot: Balancer = BALANCER) => (G * DEG) / bot.aMax

export interface Cart { x: number; v: number; tilt: number; rate: number; a: number; fallen: boolean }
export const CART0: Cart = { x: 0, v: 0, tilt: 0, rate: 0, a: 0, fallen: false }

/** One step of the wheeled pendulum. `cmd` −1…1 asks for torque, lagging by `lag`; back-EMF caps it at
 *  1 − v/vMax forward (1 + v/vMax back), so a fast robot has little left to catch with; `offset` is the
 *  CoM's angle off the body axis (off-centre battery); `kick` adds tilt rate (a push). Lies still once it hits the floor. */
export function cartStep(s: Cart, cmd: number, dt: number, bot: Balancer = BALANCER, offset = 0, kick = 0): Cart {
  if (s.fallen) return { ...s, v: 0, rate: 0, a: 0 }
  const want = bot.aMax * torqueLimit(cmd, s.v, bot)
  const a = s.a + (want - s.a) * Math.min(1, dt / bot.lag)
  const c = s.tilt + offset
  const rate = s.rate + ((G * Math.sin(c) - a * Math.cos(c)) / bot.h) * dt + kick
  const tilt = s.tilt + rate * dt
  const v = s.v + a * dt
  if (Math.abs(tilt) >= LIE_ANGLE) return { x: s.x + v * dt, v: 0, tilt: Math.sign(tilt) * LIE_ANGLE, rate: 0, a: 0, fallen: true }
  return { x: s.x + v * dt, v, tilt, rate, a, fallen: false }
}

export interface BalanceFrame { t: number; x: number; v: number; tilt: number; seen: number; target: number; cmd: number; got: number; p: number; i: number; d: number; sat: boolean; fallen: boolean }
export interface BalanceSetup {
  /** Tilt loop gains in duty per degree (per °·s, per °/s). */
  tilt: Gains
  /** Speed loop gains, target tilt in degrees per m/s; omit for a tilt loop alone holding the body at 0°. */
  speed?: Gains
  /** Target speed (m/s) at time t. */
  drive?: (t: number) => number
  seconds: number
  start?: number
  offset?: number
  /** Pushes: tilt-rate kicks (rad/s) at given times. */
  pushes?: { at: number; kick: number }[]
  /** Battery as a share of full charge: torque and free speed scale with it. */
  supply?: number
  maxLean?: number
  h?: number
  /** Motor overrides (another gearbox). */
  bot?: Partial<Pick<Balancer, 'aMax' | 'vMax' | 'lag'>>
  /** Tilt sensor: makes a fresh reader per run that returns the measured tilt and rate (rad, rad/s) from the true state; default perfect. */
  sense?: () => (s: Cart, n: number, dt: number) => { tilt: number; rate: number }
}
/** Runs the closed loop at the balancer's loop rate: tilt PID (D from the gyro rate) → torque command, optionally under a speed PI → target tilt. */
export function balanceLoop(c: BalanceSetup): BalanceFrame[] {
  const k = c.supply ?? 1
  const base = { ...BALANCER, ...c.bot }
  const bot = { ...base, h: c.h ?? BALANCER.h, aMax: base.aMax * k, vMax: base.vMax * k }
  const read = c.sense?.() ?? ((s: Cart) => s)
  const dt = bot.dt
  const lean = c.maxLean ?? 12
  let s: Cart = { ...CART0, tilt: c.start ?? 0 }
  let inner = PID0
  let outer = PID0
  const out: BalanceFrame[] = []
  const pushes = (c.pushes ?? []).map((p) => ({ n: Math.round(p.at / dt), kick: p.kick }))
  for (let n = 0; n * dt <= c.seconds + 1e-9; n++) {
    const t = n * dt
    let target = 0
    if (c.speed) {
      outer = pidStep(outer, (c.drive?.(t) ?? 0) - s.v, c.speed, dt, lean)
      target = outer.out
    }
    const m = read(s, n, dt)
    inner = pidStep(inner, m.tilt / DEG - target, c.tilt, dt, 1, m.rate / DEG)
    const cmd = s.fallen ? 0 : inner.out
    const got = torqueLimit(cmd, s.v, bot)
    out.push({ t, x: s.x, v: s.v, tilt: s.tilt, seen: m.tilt, target: target * DEG, cmd, got, p: cmd && inner.p, i: cmd && inner.i, d: cmd && inner.d, sat: !s.fallen && (inner.sat || got !== cmd), fallen: s.fallen })
    s = cartStep(s, got, dt, bot, c.offset ?? 0, pushes.find((p) => p.n === n)?.kick ?? 0)
  }
  return out
}
/** First frame lying on the floor, if any. */
export const fellAt = (run: readonly { t: number; fallen: boolean }[]) => run.find((f) => f.fallen)?.t ?? null
