// Post-processing (typical values): sanding layer ridges grit by grit with filler primer, acetone vapour smoothing, painting.
import { FILAMENTS } from './filaments'
import { fitClass } from './design'
import { cuspOf } from './slicing'

const sweep = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
const frac = (x: number) => x - Math.floor(x)

// --- Sanding and filling ---

/** Wall face → lean (dr/dz) of the surface: vertical wall, 45° slope, shallow dome top. */
export const FACES = {
  wall: { name: 'Vertical wall', lean: 0 },
  slope: { name: '45° slope', lean: 1 },
  dome: { name: 'Shallow dome top', lean: 3 },
}
export type Face = keyof typeof FACES
export const GRITS = [80, 120, 180, 240, 320, 400] as const
/** bead = rounded bead depth / layer height; scratchK / grit = scratch depth µm; rateK / grit = µm/min on a 20 cm² face; filler sands 3× faster; coatUm = dry filler primer per coat. */
export const SAND = { bead: 0.4, scratchK: 2400, rateK: 3200, fillerFast: 3, coatUm: 25, perPeriod: 40, periods: 3, clearMm: 0.15 }
export const scratchUm = (grit: number) => SAND.scratchK / grit
export const sandRate = (grit: number) => SAND.rateK / grit

/** Magnified surface across 3 layers: u (mm along the face), y (µm above the deepest valley); rz = peak to valley. */
export function ridgeProfile(layerMm: number, face: Face) {
  const lean = FACES[face].lean
  const period = layerMm * Math.hypot(1, lean)
  const D = SAND.bead * layerMm * 1000
  const C = cuspOf(layerMm, lean) * 1000
  const rz = D + C
  const n = SAND.perPeriod * SAND.periods
  const u: number[] = []
  const y: number[] = []
  for (let i = 0; i < n; i++) {
    const v = (i + 0.5) / SAND.perPeriod
    const w = frac(v)
    u.push(v * period)
    y.push(rz - D * (1 - Math.sqrt(Math.max(0, 1 - (2 * w - 1) ** 2))) - C * w)
  }
  return { u, y, rz, period, bead: D, cusp: C }
}
export type Profile = ReturnType<typeof ridgeProfile>

/** Level (µm) a liquid-like coat of mean thickness `um` settles to in the valleys. */
export function fillLevel(y: readonly number[], um: number) {
  if (um <= 0) return 0
  let lo = 0
  let hi = Math.max(...y) + um
  for (let k = 0; k < 40; k++) {
    const L = (lo + hi) / 2
    const m = y.reduce((s, v) => s + Math.max(0, L - v), 0) / y.length
    if (m < um) lo = L
    else hi = L
  }
  return (lo + hi) / 2
}

/** Surface after sanding down to `level` with scratches `scratch` deep on the flats; valleys filled up to `fill`. */
export function sandedSurface(p: Profile, level: number, scratch: number, fill: number) {
  return p.y.map((v, i) => {
    const top = Math.max(v, Math.min(fill, level + 1e-9))
    if (top < level) return top
    const tri = Math.abs(2 * frac(i / 8) - 1)
    return level - scratch * tri
  })
}
/** Ra: mean distance from the mean line (µm). */
export function roughnessRa(y: readonly number[]) {
  const m = y.reduce((s, v) => s + v, 0) / y.length
  return y.reduce((s, v) => s + Math.abs(v - m), 0) / y.length
}

export interface SandStep { grit: number; from: number; to: number; plasticUm: number; fillerUm: number; minutes: number; t0: number; ra: number }

/** Sand from 80 up to `lastGrit` after `coats` of filler primer: the first grit flattens to the filler level, each finer grit removes the last one's scratches. */
export function sandRun(layerMm: number, face: Face, lastGrit: number, coats: number) {
  const p = ridgeProfile(layerMm, face)
  const fill = fillLevel(p.y, coats * SAND.coatUm)
  const steps: SandStep[] = []
  let level = Math.max(fill, p.rz)
  let t = 0
  const grits = GRITS.filter((g) => g <= lastGrit)
  grits.forEach((g, i) => {
    const to = i === 0 ? Math.min(fill, p.rz) : level - scratchUm(grits[i - 1])
    const fillerUm = Math.max(0, level - Math.max(to, p.rz))
    const plasticUm = Math.max(0, Math.min(level, p.rz) - to)
    const minutes = plasticUm / sandRate(g) + fillerUm / (sandRate(g) * SAND.fillerFast)
    steps.push({ grit: g, from: level, to, plasticUm, fillerUm, minutes, t0: t, ra: roughnessRa(sandedSurface(p, to, scratchUm(g), fill)) })
    t += minutes
    level = to
  })
  const lossUm = Math.max(0, p.rz - level)
  const gap = SAND.clearMm + (2 * lossUm) / 1000
  return { p, fill, steps, minutes: t, level, lossUm, raw: roughnessRa(p.y), ra: steps.length ? steps[steps.length - 1].ra : roughnessRa(p.y), gap, fit: fitClass(gap), fitBefore: fitClass(SAND.clearMm) }
}

/** Ra along the run at time `t` (min): level eases down through each step. */
export function sandAt(run: ReturnType<typeof sandRun>, t: number) {
  const s = run.steps.find((x) => t < x.t0 + x.minutes) ?? run.steps[run.steps.length - 1]
  if (!s) return { step: null, level: run.p.rz, y: run.p.y.slice(), ra: run.raw }
  const f = s.minutes > 0 ? Math.min(1, Math.max(0, (t - s.t0) / s.minutes)) : 1
  const level = s.from + (s.to - s.from) * f
  const y = sandedSurface(run.p, level, scratchUm(s.grit), run.fill)
  return { step: s, level, y, ra: roughnessRa(y) }
}

export function sandView(layerMm: number, face: Face, lastGrit: number, coats: number) {
  const all = sandRun(layerMm, face, GRITS[GRITS.length - 1], coats)
  const cur = sandRun(layerMm, face, lastGrit, coats)
  const ts = sweep(0, all.minutes, 61)
  return { all, cur, ts, curve: ts.map((t) => sandAt(all, t).ra), noFiller: sandRun(layerMm, face, lastGrit, 0) }
}

// --- Vapour smoothing: a solvent-swollen skin levels ridges by surface tension (Orchard): dA/dt = −A σ d³ (2π/λ)⁴ / 3η, skin d = √(D t) ---

export const VAPOUR_METHODS = {
  cold: { name: 'Cold jar (room temp)', k: 1 },
  hot: { name: 'Heated chamber', k: 10 },
}
export type VapourMethod = keyof typeof VAPOUR_METHODS
/** dSkin m²/s of acetone into ABS/ASA (PLA, PETG ~0); σ N/m, η Pa·s of the swollen skin; edge radius = edgeK × skin; text strokes 0.4 mm; slump when the skin passes slumpUm of a 2-wall shell. */
export const VAPOUR = { dSkin: 4.2e-12, sigma: 0.035, eta: 4e5, edgeK: 1.5, strokeMm: 0.4, slumpUm: 350, maxMin: 60 }
export const VAPOUR_SOLVENT: Record<'pla' | 'petg' | 'asa', number> = { pla: 0, petg: 0, asa: 1 }
export type VapourMat = keyof typeof VAPOUR_SOLVENT
export const VAPOUR_MATS = Object.keys(VAPOUR_SOLVENT) as VapourMat[]
export const VAPOUR_TIME_SWEEP = sweep(0, VAPOUR.maxMin, 31)
export const VAPOUR_LAYERS = [0.12, 0.2, 0.28]

export const skinUm = (m: VapourMat, method: VapourMethod, minutes: number) => Math.sqrt(VAPOUR.dSkin * VAPOUR_SOLVENT[m] * VAPOUR_METHODS[method].k * minutes * 60) * 1e6

/** Ridge left after `minutes` (closed form of the Orchard decay with d ∝ √t): A0 exp(−σ q⁴ D^1.5 t^2.5 / (7.5 η)). */
export function vapourRidge(m: VapourMat, method: VapourMethod, minutes: number, layerMm: number) {
  const a0 = SAND.bead * layerMm * 1000
  const q = (2 * Math.PI) / (layerMm / 1000)
  const D = VAPOUR.dSkin * VAPOUR_SOLVENT[m] * VAPOUR_METHODS[method].k
  const t = minutes * 60
  return a0 * Math.exp((-VAPOUR.sigma * q ** 4 * D ** 1.5 * t ** 2.5) / (7.5 * VAPOUR.eta))
}

export function vapourView(m: VapourMat, method: VapourMethod, minutes: number, layerMm: number) {
  const skin = skinUm(m, method, minutes)
  const edgeUm = VAPOUR.edgeK * skin
  const a0 = SAND.bead * layerMm * 1000
  const ridge = vapourRidge(m, method, minutes, layerMm)
  return {
    a0,
    ridge,
    left: ridge / a0,
    skin,
    edgeUm,
    textLost: edgeUm > (VAPOUR.strokeMm * 1000) / 2,
    slumps: skin > VAPOUR.slumpUm,
    works: VAPOUR_SOLVENT[m] > 0,
    ridgeCurve: VAPOUR_TIME_SWEEP.map((t) => vapourRidge(m, method, t, layerMm)),
    edgeCurve: VAPOUR_TIME_SWEEP.map((t) => VAPOUR.edgeK * skinUm(m, method, t)),
    byLayer: VAPOUR_LAYERS.map((h) => vapourRidge(m, method, minutes, h)),
    name: FILAMENTS[m].name,
  }
}

// --- Painting ---

export const PAINT_PREPS = {
  none: { name: 'None (straight on)', short: 'None' },
  scuff: { name: 'Scuff (320 grit)', short: 'Scuff' },
  primer: { name: 'Scuff + primer', short: 'Primer' },
  filler: { name: 'Filler primer + sand', short: 'Filler' },
}
export type PaintPrep = keyof typeof PAINT_PREPS
export const PAINT_PREP_KEYS = Object.keys(PAINT_PREPS) as PaintPrep[]
/** Cross-hatch tape test class 0…5 (5B = nothing lifts), typical. */
export const PAINT_ADHESION: Record<VapourMat, Record<PaintPrep, number>> = {
  pla: { none: 1, scuff: 3, primer: 5, filler: 5 },
  petg: { none: 0, scuff: 2, primer: 4, filler: 4 },
  asa: { none: 3, scuff: 4, primer: 5, filler: 5 },
}
/** Visible layer-line ridge under each finish (µm); clear = gloss + 2 clear coats. */
export const PAINT_FINISHES = {
  matte: { name: 'Matte', seeUm: 25, clear: 0 },
  satin: { name: 'Satin', seeUm: 15, clear: 0 },
  gloss: { name: 'Gloss', seeUm: 8, clear: 0 },
  clear: { name: 'Gloss + clear coat', seeUm: 8, clear: 2 },
}
export type PaintFinish = keyof typeof PAINT_FINISHES
/** wetUm at 25 cm per pass ∝ (25 / d)²; solids share; runs over runUm wet; dry spray past drySprayCm; flow = share of the dry film that ends up in valleys; times in minutes. */
export const PAINT = { wetUm: 45, refCm: 25, solids: 0.35, runUm: 80, drySprayCm: 35, flow: 0.5, sigma: 0.03, eta: 50, openS: 30, flashMin: 10, touchMin: 30, cureH: 24, primerUm: 20, sandGrit: 320, fillerCoats: 2 }
export const PAINT_COAT_SWEEP = [1, 2, 3, 4, 5, 6]

/** Wet film per pass at `cm`, its dry thickness and how far it levels before it sets (0…1, Orchard over the open time). */
export function paintCoat(cm: number, layerMm: number) {
  const wet = PAINT.wetUm * (PAINT.refCm / cm) ** 2 * (cm > PAINT.drySprayCm ? 0.6 : 1)
  const q = (2 * Math.PI) / (layerMm / 1000)
  const K = (PAINT.sigma * (wet * 1e-6) ** 3 * q ** 4) / (3 * PAINT.eta)
  const level = (1 - Math.exp(-K * PAINT.openS)) * (cm > PAINT.drySprayCm ? 0.3 : 1)
  return { wet, dry: wet * PAINT.solids, level, runs: wet > PAINT.runUm, drySpray: cm > PAINT.drySprayCm }
}

/** Ridge left after the prep: raw bead, scuffed, primed, or filled and sanded flat to 320 (Sanding and filling). */
export function prepRidge(prep: PaintPrep, layerMm: number) {
  const p = ridgeProfile(layerMm, 'wall')
  if (prep === 'filler') return sandRun(layerMm, 'wall', PAINT.sandGrit, PAINT.fillerCoats).steps.at(-1)!.ra * 3
  const primer = prep === 'primer' ? PAINT.primerUm * PAINT.flow : 0
  return Math.max(0, p.rz - primer)
}

export function paintJob(m: VapourMat, prep: PaintPrep, coats: number, cm: number, finish: PaintFinish, layerMm: number) {
  const c = paintCoat(cm, layerMm)
  const F = PAINT_FINISHES[finish]
  const start = prepRidge(prep, layerMm)
  let ridge = start
  for (let i = 0; i < coats + F.clear; i++) ridge = Math.max(0, ridge - c.dry * c.level * PAINT.flow)
  const filmUm = (coats + F.clear) * c.dry + (prep === 'primer' || prep === 'filler' ? PAINT.primerUm : 0)
  const minutes = (coats + F.clear) * PAINT.flashMin + PAINT.touchMin
  return { ...c, start, ridge, visible: ridge > F.seeUm, filmUm, adhesion: PAINT_ADHESION[m][prep], minutes, cureH: PAINT.cureH * (F.clear ? 1.5 : 1) }
}

export function paintView(m: VapourMat, prep: PaintPrep, coats: number, cm: number, finish: PaintFinish, layerMm: number) {
  return {
    cur: paintJob(m, prep, coats, cm, finish, layerMm),
    curve: PAINT_COAT_SWEEP.map((k) => paintJob(m, prep, k, cm, finish, layerMm).ridge),
    preps: PAINT_PREP_KEYS.map((k) => PAINT_ADHESION[m][k]),
  }
}
