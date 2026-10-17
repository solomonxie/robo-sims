// Bearings: ball bearings (load per ball, two-bearing shaft, rolling vs sliding friction) and plain bushings (PV limit, heat, wobble).
import { rpmToRadS } from '../actuators/stepper'

/** Deep-groove ball bearings, mm and N (catalogue values, typical): bore d, outside D, width B, balls, dynamic C, static C0. */
export const BALL_BEARINGS = {
  b608: { name: '608', d: 8, D: 22, B: 7, balls: 7, ball: 3.97, C: 3450, C0: 1370, rpm: 30000, use: 'skateboards, wheels, printer idlers' },
  b625: { name: '625', d: 5, D: 16, B: 5, balls: 7, ball: 2.78, C: 1140, C0: 380, rpm: 40000, use: 'belt idlers, lead screws' },
  mr63: { name: 'MR63', d: 3, D: 6, B: 2.5, balls: 6, ball: 1, C: 210, C0: 60, rpm: 60000, use: 'tiny pivots, servo arms' },
} as const
export type BallBearingKey = keyof typeof BALL_BEARINGS

/** Friction coefficient referred to the bore (typical): rolling balls vs a steel shaft rubbing in a plain hole. */
export const ROLLING_MU = 0.0015
export const PLAIN_HOLE_MU = 0.35

/** Friction torque (N·m) of a shaft of diameter `dMm` carrying `loadN`: T = μ·F·r. */
export const frictionTorque = (mu: number, loadN: number, dMm: number) => (mu * loadN * dMm) / 2000

/** Load on each ball (N) for a radial load `fr` on `z` balls, cage turned `phase` rad: Q = Qmax·cos^1.5 ψ over the loaded half (Stribeck). */
export function ballLoads(z: number, fr: number, phase: number) {
  const psi = Array.from({ length: z }, (_, i) => phase + (i / z) * 2 * Math.PI)
  const shape = psi.map((p) => Math.max(0, Math.cos(p)) ** 1.5)
  const sum = shape.reduce((s, q, i) => s + q * Math.cos(psi[i]), 0)
  const qMax = fr / sum
  return { psi, loads: shape.map((q) => q * qMax), max: qMax, even: fr / z }
}

/** Wheel shaft on two bearings `spacing` mm apart, wheel load `loadN` hanging `overhang` mm past the near one: lever balance about it. */
export function shaftLoads(loadN: number, spacing: number, overhang: number) {
  const far = (loadN * overhang) / spacing
  return { near: loadN + far, far, moment: (loadN * overhang) / 1000 }
}

/** Static safety C0/P and L10 life (million revs, hours at `rpm`) of a bearing under radial load `p`. */
export function bearingLife(bk: BallBearingKey, p: number, rpm: number) {
  const b = BALL_BEARINGS[bk]
  const mrev = (b.C / Math.max(p, 1e-9)) ** 3
  return { s0: b.C0 / Math.max(p, 1e-9), mrev, hours: (mrev * 1e6) / (60 * rpm) }
}

/** Printed hole for a bearing of outside diameter D (typical FDM; tune on a test print). */
export const seatHoles = (D: number) => ({ press: D - 0.1, slip: D + 0.15 })

/** Ball bearing lesson: shaft loads, the near bearing's ball loads, friction and life, plus a plain hole for comparison. */
export function ballBearingView(bk: BallBearingKey, loadN: number, spacing: number, overhang: number, rpm = 300) {
  const b = BALL_BEARINGS[bk]
  const S = shaftLoads(loadN, spacing, overhang)
  const life = bearingLife(bk, S.near, rpm)
  return {
    b,
    ...S,
    life,
    seat: seatHoles(b.D),
    peakBall: ballLoads(b.balls, S.near, 0).max,
    torque: { ball: frictionTorque(ROLLING_MU, S.near, b.d), plain: frictionTorque(PLAIN_HOLE_MU, S.near, b.d) },
  }
}

// --- Bushings ---

/** Plain bushing materials (typical): μ on steel, PV limit (MPa·m/s), max pressure (MPa), max surface speed (m/s), max temperature (°C). */
export const BUSHINGS = {
  bronze: { name: 'Sintered bronze', mu: 0.08, pv: 1.8, pMax: 14, vMax: 6, maxC: 90 },
  polymer: { name: 'Polymer (igus)', mu: 0.15, pv: 0.4, pMax: 40, vMax: 1, maxC: 130 },
  pla: { name: 'Printed PLA hole', mu: 0.35, pv: 0.05, pMax: 10, vMax: 0.3, maxC: 55 },
} as const
export type BushingKey = keyof typeof BUSHINGS

/** 8 mm shaft in a sleeve as long as it is wide; heat path out through the housing (typical). */
export const BUSHING = { d: 8, len: 8, ambientC: 25, rthKW: 12, armMm: 50 }

export type BushingVerdict = 'ok' | 'warm' | 'wears' | 'melts' | 'crushed'

/** One bushing at `loadN`, `rpm` and diametral clearance `clear` mm: P = F/(d·L), v = π·d·n, PV, friction torque, heat, temperature, wobble. */
export function bushingState(bk: BushingKey, loadN: number, rpm: number, clear: number, mu: number = BUSHINGS[bk].mu) {
  const m = BUSHINGS[bk]
  const { d, len } = BUSHING
  const p = loadN / (d * len)
  const v = (Math.PI * d * rpm) / 60000
  const pv = p * v
  const torque = frictionTorque(mu, loadN, d)
  const heatW = torque * rpmToRadS(rpm)
  const tempC = BUSHING.ambientC + heatW * BUSHING.rthKW
  const ratio = pv / m.pv
  const verdict: BushingVerdict = p > m.pMax ? 'crushed' : tempC > m.maxC ? 'melts' : ratio > 1 || v > m.vMax ? 'wears' : ratio > 0.5 ? 'warm' : 'ok'
  const tilt = clear / len
  return { p, v, pv, ratio, torque, heatW, tempC, verdict, tilt, play: tilt * BUSHING.armMm }
}

/** Bushing lesson: the chosen bushing, every option (and a ball bearing) at the same load and speed, and its PV-limit curve. */
export function bushingView(bk: BushingKey, loadN: number, rpm: number, clear: number) {
  const keys = Object.keys(BUSHINGS) as BushingKey[]
  const all = keys.map((k) => bushingState(k, loadN, rpm, clear))
  const ball = bushingState(bk, loadN, rpm, 0.01, ROLLING_MU)
  return { s: all[keys.indexOf(bk)], all, ballTorque: ball.torque, ballHeat: ball.heatW, limitP: (v: number) => BUSHINGS[bk].pv / Math.max(v, 1e-9) }
}
