// Constants and helpers shared across physics domains.

/** Speed of light in vacuum, m/s. */
export const LIGHT_C = 299_792_458
/** Speed of sound most sketches bake in (dry air, 20 °C), m/s. */
export const SOUND_C = 343
export const DEG = Math.PI / 180
export const toDeg = (rad: number) => rad / DEG

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const clamp01 = (x: number) => clamp(x, 0, 1)

/** Sample of a fixed-step run (`dt` apart) at time `t`, held at the ends. */
export const fixedStepAt = <T>(run: readonly T[], t: number, dt: number) => run[clamp(Math.floor(t / dt), 0, run.length - 1)]
