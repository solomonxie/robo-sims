// Swerve drive: every module steers its own wheel; chassis twist → one (angle, speed) vector per module, shortest-turn flips, steering lag.
import { wrapPi } from '../common'
import { fitTwist } from './mecanum'

/** FRC-style frame: 4" wheels on a 520 mm square between module axes, 4.5 m/s top speed. */
export const SWERVE = { halfL: 0.26, halfW: 0.26, wheelR: 0.0508, maxSpeed: 4.5 }
export const SWERVE_MODS = ['FL', 'FR', 'RL', 'RR'] as const
type SwerveGeo = { halfL: number; halfW: number }
export type ModuleState = { speed: number; angle: number }

export const swerveModules = (g: SwerveGeo = SWERVE) => [
  { x: g.halfL, y: g.halfW },
  { x: g.halfL, y: -g.halfW },
  { x: -g.halfL, y: g.halfW },
  { x: -g.halfL, y: -g.halfW },
]

/** Each module's ground velocity for body twist vx, vy (m/s), ω (rad/s, CCW +), as wheel angle (rad from +x) and speed ≥ 0. */
export const swerveStates = (vx: number, vy: number, w: number, g: SwerveGeo = SWERVE): ModuleState[] =>
  swerveModules(g).map((m) => {
    const [ux, uy] = [vx - w * m.y, vy + w * m.x]
    return { speed: Math.hypot(ux, uy), angle: Math.atan2(uy, ux) }
  })

/** Scale all modules together so none exceeds max. */
export function swerveDesat(s: ModuleState[], max: number) {
  const k = Math.min(1, max / Math.max(...s.map((m) => Math.abs(m.speed)), 1e-12))
  return { states: s.map((m) => ({ ...m, speed: m.speed * k })), k }
}

/** Target as a continuous angle near the module's current one: never turn more than 90°, run the wheel backwards instead (`shortest`);
 *  otherwise the wheel always rolls forward and may turn up to 180°. A stopped target keeps the current angle. */
export function swerveOptimize(target: ModuleState, current: number, shortest = true) {
  if (target.speed < 1e-6) return { speed: 0, angle: current, flipped: false }
  const d = wrapPi(target.angle - current)
  const flipped = shortest && Math.abs(d) > Math.PI / 2
  return { speed: flipped ? -target.speed : target.speed, angle: current + (flipped ? wrapPi(d + Math.PI) : d), flipped }
}

/** Steer angle after dt with the steer motor limited to rate (rad/s). */
export const steerToward = (current: number, target: number, rate: number, dt: number) =>
  current + Math.max(-rate * dt, Math.min(rate * dt, target - current))

/** Chassis twist that best fits the wheel vectors the modules actually point (least squares), and each module's scrub (m/s it slides). */
export function swerveFit(actual: ModuleState[], g: SwerveGeo = SWERVE) {
  const ms = swerveModules(g)
  const J = ms.flatMap((m) => [
    [1, 0, -m.y],
    [0, 1, m.x],
  ])
  const s = actual.flatMap((a) => [a.speed * Math.cos(a.angle), a.speed * Math.sin(a.angle)])
  const [vx, vy, w] = fitTwist(J, s)
  const scrub = ms.map((m, i) => Math.hypot(vx - w * m.y - s[2 * i], vy + w * m.x - s[2 * i + 1]))
  return { vx, vy, w, scrub }
}

/** One control tick: optimise each target against the module's angle, steer at a limited rate, drive at the target speed. */
export function swerveTick(angles: number[], targets: ModuleState[], o: { rate: number; shortest: boolean }, dt: number) {
  return targets.map((t, i) => {
    const opt = swerveOptimize(t, angles[i], o.shortest)
    const angle = steerToward(angles[i], opt.angle, o.rate, dt)
    return { speed: opt.speed, angle, target: opt.angle, flipped: opt.flipped, error: opt.angle - angle }
  })
}
