// Constants and helpers shared across physics domains.

/** Speed of light in vacuum, m/s. */
export const LIGHT_C = 299_792_458
/** Speed of sound most sketches bake in (dry air, 20 °C), m/s. */
export const SOUND_C = 343
/** Standard gravity, m/s². */
export const G = 9.81
export const weightN = (kg: number) => kg * G
export const DEG = Math.PI / 180
export const toDeg = (rad: number) => rad / DEG
/** Population standard deviation. */
export const stdDev = (xs: readonly number[]) => {
  const m = xs.reduce((a, x) => a + x, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const clamp01 = (x: number) => clamp(x, 0, 1)

/** Sample of a fixed-step run (`dt` apart) at time `t`, held at the ends. */
export const fixedStepAt = <T>(run: readonly T[], t: number, dt: number) => run[clamp(Math.floor(t / dt), 0, run.length - 1)]

const TAU = 2 * Math.PI
export const frac = (x: number) => x - Math.floor(x)
export const wrap2pi = (a: number) => ((a % TAU) + TAU) % TAU
export const wrapPi = (a: number) => wrap2pi(a + Math.PI) - Math.PI

/** Repeatable 0…1 for integer `i` (sine hash). */
export const hash01 = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
/** Deterministic standard normal for index `k` (sine hash + Box–Muller), so noise looks random but tests are stable. */
export function gaussAt(k: number) {
  const u = (i: number) => clamp(hash01(i), 1e-12, 1 - 1e-12)
  return Math.sqrt(-2 * Math.log(u(2 * k + 1))) * Math.cos(2 * Math.PI * u(2 * k + 2))
}
