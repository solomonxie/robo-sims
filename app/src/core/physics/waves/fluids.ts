// Pressure and fluids: continuity and Bernoulli through a venturi, pitot airspeed; the standard atmosphere, barometric altitude,
// BMP280 oversampling/IIR noise, weather drift and the temperature error of a drone holding a baro altitude.
import { G, gaussAt } from '../common'
import { WATERS } from '../mobility/underwater'

export const P_SEA = 101_325
/** Vapour pressure of water near 20 °C (Pa): below it the throat boils (cavitates). */
export const VAPOUR_PA = 2_340
export const FLUIDS = {
  air: { name: 'Air', rho: 1.2 },
  water: { name: 'Water', rho: WATERS.fresh },
} as const
export type FluidKind = keyof typeof FLUIDS

/** Dynamic pressure ½ρv² (Pa): what a pitot tube's total port reads above the static port. */
export const dynamicPa = (rho: number, v: number) => 0.5 * rho * v * v
/** Pitot airspeed from Δp = ½ρv². */
export const pitotSpeed = (rho: number, dp: number) => Math.sqrt((2 * Math.max(0, dp)) / rho)
/** Speed error from `noisePa` of Δp noise at speed v: dv = dp / (ρv); huge at low speed. */
export const pitotSpeedError = (rho: number, v: number, noisePa: number) => (v > 0 ? Math.min(pitotSpeed(rho, noisePa), noisePa / (rho * v)) : pitotSpeed(rho, noisePa))

const THROAT_FROM = 0.3
const THROAT_TO = 0.8
/** Venturi radius along the duct, x = 0 (inlet) … 1 (outlet), as a fraction of the inlet: a smooth neck down to `throat` at the middle. */
export function ductRadius(x: number, throat: number) {
  if (x <= THROAT_FROM || x >= THROAT_TO) return 1
  const u = (x - THROAT_FROM) / (THROAT_TO - THROAT_FROM)
  return 1 - ((1 - throat) * (1 - Math.cos(2 * Math.PI * u))) / 2
}
export const THROAT_X = (THROAT_FROM + THROAT_TO) / 2

/** Continuity A₁v₁ = A₂v₂ then Bernoulli p + ½ρv² = const, along a duct of inlet radius 1. `p` is static pressure relative to the inlet. */
export function ductAt(x: number, v1: number, throat: number, rho: number) {
  const r = ductRadius(x, throat)
  const v = v1 / (r * r)
  const q = dynamicPa(rho, v)
  return { x, r, v, q, p: dynamicPa(rho, v1) - q }
}

export function venturi(v1: number, throat: number, fluid: FluidKind, inletD = 0.04) {
  const { rho } = FLUIDS[fluid]
  const neck = ductAt(THROAT_X, v1, throat, rho)
  const drop = -neck.p
  const flow = Math.PI * (inletD / 2) ** 2 * v1
  return { rho, v1, v2: neck.v, q1: dynamicPa(rho, v1), q2: neck.q, drop, flow, cavitates: P_SEA - drop < VAPOUR_PA, profile: (x: number) => ductAt(x, v1, throat, rho) }
}

/** ISA lapse rate (K/m), sea-level temperature (K), gas constant of dry air (J/(kg·K)) and the exponent g/(R·L). */
export const LAPSE = 0.0065
export const T_SEA = 288.15
export const R_AIR = 287.05
export const BARO_N = G / (R_AIR * LAPSE)

/** Pressure at height h above a ground of pressure p0 and temperature t0 (K), constant lapse. */
export const airPressureAt = (h: number, p0 = P_SEA, t0 = T_SEA) => p0 * (1 - (LAPSE * h) / t0) ** BARO_N
/** The barometric formula the firmware uses: height above the reference pressure, assuming the standard 15 °C. */
export const baroAltitude = (p: number, pRef = P_SEA, t0 = T_SEA) => (t0 / LAPSE) * (1 - (p / pRef) ** (1 / BARO_N))
export const airDensity = (p: number, tK: number) => p / (R_AIR * tK)
/** Pressure change per metre of climb, ρg (Pa/m): about 12 near sea level. */
export const paPerMetre = (h: number, p0 = P_SEA, t0 = T_SEA) => airDensity(airPressureAt(h, p0, t0), t0 - LAPSE * h) * G

/** BMP280 pressure oversampling and IIR filter. Raw noise falls as 1/√samples (1.3 Pa at ×16); a coefficient-c IIR leaves
 *  1/√(2c − 1) of it and lags by about (c − 1) samples. Measurement time from the datasheet: 1 + 2·osrs_t + 2·osrs_p + 0.5 ms. */
export const OVERSAMPLING = { x1: { name: '×1 (fast)', n: 1 }, x4: { name: '×4', n: 4 }, x16: { name: '×16 (fine)', n: 16 } } as const
export type Oversampling = keyof typeof OVERSAMPLING
export const IIR_COEFFS = { off: { name: 'IIR off', c: 1 }, c4: { name: 'IIR 4', c: 4 }, c16: { name: 'IIR 16', c: 16 } } as const
export type IirCoeff = keyof typeof IIR_COEFFS

export function bmp280Mode(os: Oversampling, iir: IirCoeff) {
  const n = OVERSAMPLING[os].n
  const c = IIR_COEFFS[iir].c
  const measS = (1 + 2 * (n === 16 ? 2 : 1) + 2 * n + 0.5) / 1000
  const rawPa = 1.3 * Math.sqrt(16 / n)
  return { n, c, measS, rateHz: 1 / measS, rawPa, noisePa: rawPa / Math.sqrt(2 * c - 1), lagS: (c - 1) * measS }
}
export type Bmp280Mode = ReturnType<typeof bmp280Mode>

/** Filtered pressure noise (Pa), one sample per measurement over `seconds`, repeatable; the IIR starts settled. */
export function baroNoise(mode: Bmp280Mode, seconds: number, seed = 0) {
  const k = Math.ceil(seconds / mode.measS)
  const out = new Float64Array(k)
  let x = 0
  for (let i = -8 * mode.c; i < k; i++) {
    x += (mode.rawPa * gaussAt(seed + i + 8 * mode.c) - x) / mode.c
    if (i >= 0) out[i] = x
  }
  return out
}

export interface BaroHoldCfg {
  holdM: number
  driftPaPerH: number
  tempC: number
}

/** A drone zeroes its baro at take-off (ground at `P_SEA`) and holds a baro altitude of `holdM` while the weather moves the ground
 *  pressure by `driftPaPerH` and the air is `tempC` (not the 15 °C the formula assumes). True height every `dt` for `seconds`. */
export function baroHoldRun(cfg: BaroHoldCfg, seconds: number, dt: number) {
  const target = airPressureAt(cfg.holdM)
  const tg = cfg.tempC + 273.15
  const run: { t: number; p0: number; h: number }[] = []
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    const p0 = P_SEA + (cfg.driftPaPerH * t) / 3600
    run.push({ t, p0, h: baroAltitude(target, p0, tg) })
  }
  return { run, target, tempErrM: run[0].h - cfg.holdM, driftErrM: run[run.length - 1].h - run[0].h }
}
