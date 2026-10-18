// Calibration: E-steps (mark-and-measure, gear slip), flow multiplier from a single-wall cube, pressure advance (melt lag vs K),
// retraction (stringing vs jams and grinding), temperature tower (adhesion, stringing, droop per band).
import { stepsPerRev } from '../actuators/stepper'
import { clamp, clamp01 } from '../common'
import { beadSection } from './adhesion'
import { FILAMENT_D, LINE_W, filamentArea, maxFlow } from './fdm'
import { FILAMENTS, FilamentKey } from './filaments'
import { measureFix } from './motion'

const sweep = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
const sig = (x: number) => 0.5 + 0.5 * Math.tanh(x)

// --- E-steps: mark 120 mm above the extruder, feed 100 mm, measure what is left. ---

/** Effective drive-gear pitch diameter (mm), gear ratio and hob grip (N), typical. */
export const EXTRUDERS = {
  mk8: { name: 'Single-gear direct (MK8)', ratio: 1, gearMm: 10.95, gripN: 35 },
  bmg: { name: 'Dual-gear 3:1 (BMG-style)', ratio: 3, gearMm: 7.36, gripN: 60 },
}
export type ExtruderKey = keyof typeof EXTRUDERS
export const E_TEST = { markMm: 120, feedMm: 100, blockC: FILAMENTS.pla.nozzleC, micro: 16 }
export const eStepsOf = (k: ExtruderKey) => (stepsPerRev(E_TEST.micro) * EXTRUDERS[k].ratio) / (Math.PI * EXTRUDERS[k].gearMm)
/** Feed (mm/s) the PLA melt allows at the test temperature. */
export const meltFeed = () => maxFlow('v6', E_TEST.blockC) / filamentArea()

/** Share of the gear travel lost when the push needed (back pressure ∝ feed²) beats the grip. */
export function gearSlip(k: ExtruderKey, feed: number) {
  const need = 8 + 25 * (feed / meltFeed()) ** 2
  return clamp(1 - EXTRUDERS[k].gripN / need, 0, 0.5)
}

export function eStepsView(k: ExtruderKey, errPct: number, feed: number) {
  const trueSpm = eStepsOf(k)
  const fwSpm = trueSpm * (1 + errPct / 100)
  const gearMm = (E_TEST.feedMm * fwSpm) / trueSpm
  const slip = gearSlip(k, feed)
  const fedMm = gearMm * (1 - slip)
  const fixedSpm = measureFix(fwSpm, E_TEST.feedMm, fedMm)
  const curve = sweep(0.5, 10, 40).map((f) => ({ feed: f, fed: gearMm * (1 - gearSlip(k, f)) }))
  return { trueSpm, fwSpm, gearMm, slip, fedMm, leftMm: E_TEST.markMm - fedMm, fixedSpm, fixErr: fixedSpm / trueSpm - 1, meltFeed: meltFeed(), curve }
}

// --- Flow rate: single-wall cube, wall measured with calipers vs the slicer line width. ---

export const FLOW_CUBE = { lineW: LINE_W, h: 0.2, sideMm: 20 }
/** Width of a stadium bead of area `a` at height `h`. */
export const beadWidth = (a: number, h: number) => (a - (Math.PI * h * h) / 4) / h + h

/** Slicer flow multiplier `flow`, real filament diameter `dMm`: wall width, the fix, and the top-surface state. */
export function flowCalView(flow: number, dMm: number) {
  const { lineW, h } = FLOW_CUBE
  const area = beadSection(h, lineW, h).area
  const factor = flow * (dMm / FILAMENT_D) ** 2
  const wallMm = beadWidth(area * factor, h)
  const fixed = measureFix(flow, lineW, wallMm)
  const state = factor < 0.95 ? 'under' : factor > 1.05 ? 'over' : 'good'
  const curve = sweep(0.85, 1.15, 31).map((f) => beadWidth(area * f * (dMm / FILAMENT_D) ** 2, h))
  return { area, factor, wallMm, fixed, spacing: lineW - h * (1 - Math.PI / 4), state: state as 'under' | 'good' | 'over', curve }
}

// --- Pressure advance: melt in the nozzle lags like a spring + damper; K pushes extra E ahead of the speed change. ---

/** Melt lag τ (s) ≈ the right K, and the test sweep, typical. */
export const PA_SETUPS = {
  direct: { name: 'Direct drive', tau: 0.04, kMax: 0.1 },
  bowden: { name: 'Bowden, 400 mm tube', tau: 0.4, kMax: 1 },
}
export type PaSetup = keyof typeof PA_SETUPS
/** Test line: slow, fast, slow (mm, mm/s), accel mm/s². */
export const PA_LINE = { slow: 20, fast: 100, a: 1500, legs: [20, 40, 20], lines: 11, dt: 0.001 }

/** One test line printed with advance K: time, position, speed (= target flow) and nozzle flow (mm/s of line), width ratio per mm, end blob. */
export function paRun(setup: PaSetup, K: number) {
  const { slow, fast, a, legs, dt } = PA_LINE
  const tau = PA_SETUPS[setup].tau
  const x1 = legs[0]
  const x2 = x1 + legs[1]
  const end = x2 + legs[2]
  const t: number[] = []
  const v: number[] = []
  const qo: number[] = []
  const xs: number[] = []
  const bins = Array.from({ length: end }, () => ({ vol: 0, len: 0 }))
  let x = 0
  let s = 0
  let out = 0
  let prev = 0
  for (let i = 0; i < 20000; i++) {
    const cap = Math.min(x >= x1 && x < x2 ? fast : slow, x < x2 ? Math.sqrt(slow * slow + 2 * a * Math.max(0, x2 - x)) : Infinity, Math.sqrt(2 * a * Math.max(0, end - x)))
    s = Math.max(0, Math.min(s + a * dt, cap))
    if (cap < 0.5 * a * dt) s = 0
    const qin = s + (K * (s - prev)) / dt
    out += ((qin - out) * dt) / (tau + dt)
    prev = s
    const b = bins[Math.min(end - 1, Math.floor(x))]
    b.vol += out * dt
    b.len += s * dt
    x = Math.min(end, x + s * dt)
    t.push(i * dt)
    v.push(s)
    qo.push(out)
    xs.push(x)
    if (s === 0) break
  }
  const blob = Math.max(0, out * tau)
  const width = bins.map((b) => clamp(b.vol / Math.max(1e-6, b.len), 0.3, 2.5))
  const err = Math.sqrt(width.reduce((m, w) => m + (w - 1) ** 2, 0) / width.length) + blob / 10
  return { t, v, qo, xs, width, blob, err, tau, K }
}

/** Test pattern: lines with K stepping 0 … kMax; the best line. */
export function paPattern(setup: PaSetup) {
  const { kMax } = PA_SETUPS[setup]
  const lines = sweep(0, kMax, PA_LINE.lines).map((K) => paRun(setup, K))
  const best = lines.reduce((b, l, i) => (l.err < lines[b].err ? i : b), 0)
  return { lines, best, bestK: lines[best].K }
}

// --- Retraction: pull filament back over a travel to drop nozzle pressure; too far jams, too fast grinds. ---

/** Pressure stored in the melt + tube slack (mm of filament), how far is safe before melt reaches the cold heat break, typical. */
export const RETRACT_SETUPS = {
  direct: { name: 'Direct drive', needMm: 0.8, safeMm: 2, maxMm: 3, grindS: 50 },
  bowden: { name: 'Bowden', needMm: 5, safeMm: 7, maxMm: 10, grindS: 70 },
}
export type RetractSetup = keyof typeof RETRACT_SETUPS
export const RETRACT_TEST = { travels: 12, perPrint: 1500 }

const strings = (r: (typeof RETRACT_SETUPS)[RetractSetup], dist: number, speed: number) =>
  clamp01((1 - clamp01(dist / r.needMm)) ** 1.5 + 0.12 + 0.25 * clamp01((25 - speed) / 25))

/** Stringing (share of travels that leave a string), jam and grind risk, time added per print. */
export function retractView(setup: RetractSetup, dist: number, speed: number) {
  const r = RETRACT_SETUPS[setup]
  const string = strings(r, dist, speed)
  const jam = clamp01((dist - r.safeMm) / (0.6 * r.safeMm))
  const grind = clamp01((speed - r.grindS) / 40)
  const curve = sweep(0, r.maxMm, 41).map((d) => ({ d, string: strings(r, d, speed), jam: clamp01((d - r.safeMm) / (0.6 * r.safeMm)) }))
  return { string, count: Math.round(string * RETRACT_TEST.travels), jam, grind, addS: (RETRACT_TEST.perPrint * 2 * dist) / Math.max(1, speed), curve, ...r }
}

// --- Temperature tower: one band per temperature; cold bands split, hot ones string and droop. ---

export const TEMP_TOWER = { bands: 9, step: 5 }
export const CAL_FILAMENTS: readonly FilamentKey[] = ['pla', 'petg', 'asa', 'tpu', 'nylon', 'pc']

/** Band temperatures bottom (hot) to top: nozzleC + 20 down to nozzleC − 20. */
export const towerTemps = (f: FilamentKey) => sweep(FILAMENTS[f].nozzleC + 20, FILAMENTS[f].nozzleC - 20, TEMP_TOWER.bands)

/** Quality of one band (0…1 each, typical trends): layer adhesion, stringing, overhang droop, melt flow headroom. */
export function towerBand(f: FilamentKey, c: number) {
  const c0 = FILAMENTS[f].nozzleC
  const x = (c - c0) / (10 + 0.05 * (c0 - 200))
  const adhesion = sig(1.4 * (x + 1.2))
  const string = sig(1.3 * (x - 0.6))
  const droop = sig(1.2 * (x - 0.9))
  const flowQ = maxFlow('v6', c - c0 + FILAMENTS.pla.nozzleC)
  return { c, adhesion, string, droop, flowQ, score: adhesion * (1 - 0.7 * string) * (1 - 0.6 * droop) }
}

export function towerView(f: FilamentKey) {
  const bands = towerTemps(f).map((c) => towerBand(f, c))
  const best = bands.reduce((b, s, i) => (s.score > bands[b].score ? i : b), 0)
  return { bands, best, bestC: bands[best].c, good: bands.filter((b) => b.score > 0.85 * bands[best].score).map((b) => b.c) }
}
