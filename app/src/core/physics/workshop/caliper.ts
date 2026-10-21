// Reading a caliper: vernier / dial / digital scales, and the technique errors (zero, heat, tilt, squeeze, parallax)
// that matter more than the resolution.
import { DEG, clamp01 } from '../common'
import { puzzleVerdict } from '../challenges/verdict'
import { BALL_BEARINGS } from '../materials/bearings'
import { caliperReading } from '../materials/fasteners'
import { TT_WHEEL_MM } from '../sensors/encoder'
import { BENCH_C } from './technique'

/** Target: read within ±0.05 mm of the true (room-temperature) size. */
export const MEASURE_TOL = 0.05

/** Vernier: 50 lines over 49 mm, so each line is 0.02 mm short of a main-scale mm. */
export const VERNIER = { lines: 50, spanMm: 49 }
export const VERNIER_LC = 1 - VERNIER.spanMm / VERNIER.lines

/** `res` = smallest step; parallax `eyeGapMm` = pointer height over the scale, `gain` = mm of scale per mm of jaw travel
 *  (dial: 2 mm per turn on a 16 mm-radius face). Typical hobby 150 mm calipers. */
export const CALIPERS = {
  vernier: { name: 'Vernier', res: VERNIER_LC, eyeGapMm: 0.3, gain: 1 },
  dial: { name: 'Dial', res: 0.02, eyeGapMm: 1.5, gain: (2 * Math.PI * 16) / 2, mmPerTurn: 2 },
  digital: { name: 'Digital', res: 0.01, eyeGapMm: 0, gain: 1 },
} as const
export type CaliperKind = keyof typeof CALIPERS

type MeasureMode = 'outside' | 'inside' | 'depth'

/** Parts on the bench: true size at 25 °C, how far it gives per newton of jaw force (both contacts), expansion /K,
 *  temperature straight off the printer bed (printed parts only). */
export const MEASURE_PARTS = {
  tyre: { name: 'TT wheel tyre, outside Ø', mode: 'outside', trueMm: TT_WHEEL_MM, mmPerN: 0.025, alpha: 0, hotC: BENCH_C },
  cell: { name: '18650 cell, outside Ø', mode: 'outside', trueMm: 18.4, mmPerN: 0.003, alpha: 0, hotC: BENCH_C },
  screw: { name: 'M3 screw thread, outside Ø', mode: 'outside', trueMm: Math.round(caliperReading('m3') * 100) / 100, mmPerN: 0.0005, alpha: 0, hotC: BENCH_C },
  bore: { name: '608 bearing bore, inside jaws', mode: 'inside', trueMm: BALL_BEARINGS.b608.d, mmPerN: 0.0002, alpha: 0, hotC: BENCH_C },
  bracket: { name: 'Printed PLA bracket, 42 mm wide', mode: 'outside', trueMm: 42, mmPerN: 0.002, alpha: 68e-6, hotC: 60 },
  depth: { name: 'Printed bearing pocket, depth rod', mode: 'depth', trueMm: 7.2, mmPerN: 0.001, alpha: 68e-6, hotC: 60 },
} as const satisfies Record<string, { name: string; mode: MeasureMode; trueMm: number; mmPerN: number; alpha: number; hotC: number }>
export type MeasurePartKey = keyof typeof MEASURE_PARTS
type MeasurePart = (typeof MEASURE_PARTS)[MeasurePartKey]

/** A caliper zeroed open, or with grit on the jaws, reads this much high (typical). */
export const ZERO_SLIP_MM = 0.08

export interface CaliperCfg {
  part: MeasurePartKey
  kind: CaliperKind
  tiltDeg: number
  forceN: number
  eyeDeg: number
  /** Zeroed with clean jaws closed. */
  zeroed: boolean
  /** Measured straight off the bed (printed parts are still hot). */
  hot: boolean
}

/** Cosine error: tilted jaws read a slant (outside, depth: true / cos θ) or a chord (inside: true · cos θ). */
export function tiltError(mode: MeasureMode, trueMm: number, tiltDeg: number) {
  const c = Math.cos(tiltDeg * DEG)
  return mode === 'inside' ? trueMm * c - trueMm : trueMm / c - trueMm
}

/** Jaw force squeezes the part: outside reads small, inside and depth read large. */
const squeezeError = (p: MeasurePart, forceN: number) => (p.mode === 'outside' ? -1 : 1) * p.mmPerN * forceN

/** Pointer height over the scale seen `eyeDeg` off square, in mm of jaw travel. */
export const parallaxError = (kind: CaliperKind, eyeDeg: number) => (CALIPERS[kind].eyeGapMm * Math.tan(eyeDeg * DEG)) / CALIPERS[kind].gain

/** Largest tilt and force that keep the error within `tol`. */
export function tiltLimitDeg(mode: MeasureMode, trueMm: number, tol = MEASURE_TOL) {
  const c = mode === 'inside' ? (trueMm - tol) / trueMm : trueMm / (trueMm + tol)
  return Math.acos(c) / DEG
}
export const squeezeLimitN = (p: MeasurePart, tol = MEASURE_TOL) => tol / p.mmPerN

/** Round to the caliper's step. */
export const roundToStep = (mm: number, res: number) => Math.round(mm / res + 1e-9) * res

/** Main-scale mm left of the vernier zero, and the vernier line that lines up. */
export function vernierRead(mm: number) {
  const steps = Math.round(mm / VERNIER_LC + 1e-9)
  const main = Math.floor((steps * VERNIER_LC) + 1e-9)
  const line = Math.round((steps * VERNIER_LC - main) / VERNIER_LC)
  return { main, line, value: main + line * VERNIER_LC }
}

/** Dial caliper: whole turns on the bar and the needle's fraction of a turn. */
export function dialRead(mm: number) {
  const per = CALIPERS.dial.mmPerTurn
  const v = roundToStep(mm, CALIPERS.dial.res)
  const turns = Math.floor(v / per + 1e-9)
  return { barMm: turns * per, needle: (v - turns * per) / per, value: v }
}

export function caliperRun(cfg: CaliperCfg) {
  const part = MEASURE_PARTS[cfg.part]
  const C = CALIPERS[cfg.kind]
  const hotC = cfg.hot ? part.hotC : BENCH_C
  const errs = {
    zero: cfg.zeroed ? 0 : ZERO_SLIP_MM,
    hot: part.trueMm * part.alpha * (hotC - BENCH_C),
    tilt: tiltError(part.mode, part.trueMm, cfg.tiltDeg),
    squeeze: squeezeError(part, cfg.forceN),
    parallax: parallaxError(cfg.kind, cfg.eyeDeg),
  }
  const gapMm = part.trueMm + errs.hot + errs.tilt + errs.squeeze
  const raw = gapMm + errs.zero + errs.parallax
  const reading = roundToStep(raw, C.res)
  const error = reading - part.trueMm
  const t = MEASURE_TOL
  const one = (id: keyof typeof errs) => ({ id, ok: Math.abs(errs[id]) <= t, near: Math.abs(errs[id]) <= 2 * t })
  const verdict = puzzleVerdict([one('zero'), one('hot'), one('tilt'), one('squeeze'), one('parallax'), { id: 'total' as const, ok: Math.abs(error) <= t + 1e-9, near: Math.abs(error) <= 2 * t }])
  return {
    cfg,
    part,
    hotC,
    errs,
    /** Physical jaw gap (no zero or parallax offset). */
    gapMm,
    reading,
    error,
    vernier: vernierRead(reading),
    dial: dialRead(reading),
    tiltMax: tiltLimitDeg(part.mode, part.trueMm),
    forceMax: squeezeLimitN(part),
    verdict,
  }
}
type CaliperRun = ReturnType<typeof caliperRun>

/** Measuring time-lapse: jaws travel to the part, then the squeeze ramps up and holds. */
export const CALIPER_LAPSE = { closeS: 1.2, squeezeS: 0.6, holdS: 2.2 }
export const CALIPER_LAPSE_S = CALIPER_LAPSE.closeS + CALIPER_LAPSE.squeezeS + CALIPER_LAPSE.holdS

/** Jaw gap and display at time `t`: from `openMm` away to touching (true size), then squeezed to the final gap. */
export function caliperAt(r: CaliperRun, t: number, openMm = 6) {
  const { closeS, squeezeS } = CALIPER_LAPSE
  const touch = r.part.trueMm + r.errs.hot + r.errs.tilt
  const away = r.part.mode === 'outside' ? openMm : -Math.min(openMm, touch * 0.6)
  const u = clamp01(t / closeS)
  const ease = 1 - (1 - u) ** 3
  const s = clamp01((t - closeS) / squeezeS)
  const gapMm = t < closeS ? touch + away * (1 - ease) : touch + r.errs.squeeze * s
  const shown = roundToStep(gapMm + r.errs.zero + r.errs.parallax, CALIPERS[r.cfg.kind].res)
  return { gapMm, shown, forceN: r.cfg.forceN * s, touching: t >= closeS, settled: s >= 1 }
}
