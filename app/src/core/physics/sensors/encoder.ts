// Wheel encoders: quadrature decoding, counts per wheel turn, speed from ticks, two-wheel odometry.
import { ISR_LATENCY_S } from '../mcu/timers'

/** Quadrature states in forward order (A leads B by 90°): index 0..3 = AB 00, 10, 11, 01. */
export const QUAD_STATES = ['00', '10', '11', '01'] as const
export type Decoding = 1 | 2 | 4

/** Two TT-motor encoders: an 11-pole-pair magnet ring on the motor shaft with two halls, or a 20-slot disc on the wheel shaft with two optical forks. */
export const ENCODERS = { hall: { ppr: 11, onMotor: true }, slot: { ppr: 20, onMotor: false } }
export type EncoderKind = keyof typeof ENCODERS
/** 65 mm wheel, 130 mm track (wheel centre to centre) on a two-motor robot car. */
export const TT_WHEEL_MM = 65
export const TT_TRACK_M = 0.13

/** State index at `q` quarter-cycles of travel (four per pulse). */
export const quadIndex = (q: number) => ((Math.floor(q) % 4) + 4) % 4
/** Channel levels at `q` quarter-cycles: A high for indices 1–2, B for 2–3. */
export const quadLevels = (q: number): [number, number] => {
  const i = quadIndex(q)
  return [i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0]
}

/** One Gray-code step: +1 forward, −1 reverse, 0 unchanged, 2 = both pins flipped (an edge was missed). */
export function quadStep(from: number, to: number): -1 | 0 | 1 | 2 {
  const d = (((to - from) % 4) + 4) % 4
  return d === 0 ? 0 : d === 1 ? 1 : d === 3 ? -1 : 2
}

/** Count change for a valid step under ×1 (A edge while B low), ×2 (any A edge) or ×4 (every edge). */
export function decodeStep(from: number, to: number, mode: Decoding) {
  const d = quadStep(from, to)
  if (d === 0 || d === 2) return 0
  if (mode === 4) return d
  const lo = d === 1 ? from : to
  return (mode === 2 ? lo === 0 || lo === 2 : lo === 0) ? d : 0
}

/** Pulses per rev × decoding = counts per rev of the encoder shaft. */
export const encoderCpr = (ppr: number, mode: Decoding) => ppr * mode
/** Ticks per wheel turn: motor-shaft counts × gear ratio (1 for a disc on the wheel). */
export const ticksPerWheelRev = (ppr: number, mode: Decoding, gear: number) => encoderCpr(ppr, mode) * gear
/** Wheel travel per tick (mm). */
export const mmPerTick = (wheelMm: number, ticksPerRev: number) => (Math.PI * wheelMm) / ticksPerRev
/** Odometry: ticks × mm/tick (m). */
export const odometryM = (ticks: number, mmTick: number) => (ticks * mmTick) / 1000

/** Edges per second on both channels at `rpm` of the encoder shaft. */
export const quadEdgeHz = (rpm: number, ppr: number) => (Math.abs(rpm) / 60) * ppr * 4
/** Fastest shaft rpm an ISR of `isrS` can follow (one edge per ISR). */
export const maxIsrRpm = (isrS: number, ppr: number) => 60 / (isrS * ppr * 4)

export interface QuadReader {
  state: number
  count: number
  /** Illegal two-step jumps seen. */
  errors: number
  busyUntil: number
  pending: boolean
}
export const quadReader = (state = 0): QuadReader => ({ state, count: 0, errors: 0, busyUntil: -Infinity, pending: false })

/** CHANGE interrupt on A and B: each run reads both pins after the latency and lasts `isrS`; edges while busy
 *  only set one pending flag, so a slow ISR skips states (errors) or even reads a step backwards. */
export function quadIsr(r: QuadReader, edges: number[], stateAt: (t: number) => number, isrS: number, until: number, mode: Decoding = 4): QuadReader {
  const o = { ...r }
  const run = (t: number) => {
    const s = stateAt(t + ISR_LATENCY_S)
    if (quadStep(o.state, s) === 2) o.errors++
    else o.count += decodeStep(o.state, s, mode)
    o.state = s
    o.busyUntil = t + isrS
    o.pending = false
  }
  for (const t of edges) {
    while (o.pending && o.busyUntil <= t) run(o.busyUntil)
    if (t >= o.busyUntil) run(t)
    else o.pending = true
  }
  while (o.pending && o.busyUntil <= until) run(o.busyUntil)
  return o
}

/** Edge times in (t0, t1] for travel `q(t)` in quarter-cycles at constant rate `qps` from `q0` at t0. */
export function quadEdges(q0: number, qps: number, t0: number, t1: number) {
  const out: number[] = []
  if (qps === 0) return out
  const q1 = q0 + qps * (t1 - t0)
  const [lo, hi] = qps > 0 ? [Math.floor(q0) + 1, q1] : [Math.ceil(q0) - 1, q1]
  if (qps > 0) for (let k = lo; k <= hi; k++) out.push(t0 + (k - q0) / qps)
  else for (let k = lo; k >= hi; k--) out.push(t0 + (k - q0) / qps)
  return out
}

/** Whole ticks passed after `mm` of travel. */
export const ticksAt = (mm: number, mmTick: number) => Math.floor(mm / mmTick + 1e-9)
/** Window method: ticks counted in `windowS` → mm/s. */
export const windowSpeed = (ticks: number, mmTick: number, windowS: number) => (ticks * mmTick) / windowS
/** Smallest speed step the window method can show. */
export const windowResolution = (mmTick: number, windowS: number) => mmTick / windowS
/** Period method: time between two ticks, read by a timer of `timerS` steps → mm/s. */
export function periodSpeed(periodS: number, mmTick: number, timerS = 1e-6) {
  if (!Number.isFinite(periodS)) return 0
  return mmTick / Math.max(timerS, Math.round(periodS / timerS) * timerS)
}
/** Period-method step at speed `v`: one timer count's worth of change. */
export const periodResolution = (v: number, mmTick: number, timerS = 1e-6) => (v * v * timerS) / mmTick

export interface Pose2 {
  x: number
  y: number
  th: number
}
/** Differential-drive odometry step from wheel travels (m) and track width (m). */
export function odoStep(p: Pose2, dL: number, dR: number, track: number): Pose2 {
  const ds = (dL + dR) / 2
  const dth = (dR - dL) / track
  const mid = p.th + dth / 2
  return { x: p.x + ds * Math.cos(mid), y: p.y + ds * Math.sin(mid), th: p.th + dth }
}
/** Heading drift (rad) after `distM` when one wheel travels `ratio` × the other, e.g. a 1 % larger tyre. */
export const headingDrift = (distM: number, ratio: number, track: number) => (2 * distM * (ratio - 1)) / ((ratio + 1) * track)
