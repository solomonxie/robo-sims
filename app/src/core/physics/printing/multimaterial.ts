// Multi-material (typical values): filament changer purge vs tool changer swaps on a two-colour cover; soluble vs breakaway supports.
import { sweep } from '../common'
import { FILAMENTS } from './filaments'


// --- Tool changers and AMS ---

/** L = lightness 0…1, h = hue (deg), c = chroma 0…1. */
export const MM_COLOURS = {
  black: { name: 'Black', hex: '#2a2c31', L: 0.05, h: 0, c: 0 },
  white: { name: 'White', hex: '#f2f2ee', L: 0.95, h: 0, c: 0 },
  red: { name: 'Red', hex: '#d8352f', L: 0.35, h: 25, c: 0.9 },
  yellow: { name: 'Yellow', hex: '#f2c418', L: 0.8, h: 85, c: 0.9 },
  blue: { name: 'Blue', hex: '#2f6fd8', L: 0.3, h: 255, c: 0.8 },
}
export type MmColour = keyof typeof MM_COLOURS

/** Purge to flush one colour out of a shared nozzle: base + lighten × (L_to − L_from)⁺ + hue × chroma distance; purged at `flow`. */
const PURGE = { base: 120, lighten: 620, hue: 180, flow: 10, rho: FILAMENTS.pla.rho / 1000 }

export function purgeMm3(from: MmColour, to: MmColour) {
  if (from === to) return 0
  const a = MM_COLOURS[from]
  const b = MM_COLOURS[to]
  const ab = (c: typeof a) => [c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)]
  const [ax, ay] = ab(a)
  const [bx, by] = ab(b)
  return PURGE.base + PURGE.lighten * Math.max(0, b.L - a.L) + (PURGE.hue * Math.hypot(ax - bx, ay - by)) / 2
}

/** steps = fixed seconds per change; flush = purge (shared nozzle) or a small prime of the parked tool's ooze. */
export const MM_METHODS = {
  ams: { name: 'Filament changer (AMS)', short: 'AMS', heads: 1, flush: 'purge', primeMm3: 0, priceUsd: 350, steps: [['retract + cut', 4], ['unload', 14], ['load new', 16], ['purge', 0], ['wipe', 3]] },
  tool: { name: 'Tool changer', short: 'Tool changer', heads: 5, flush: 'prime', primeMm3: 25, priceUsd: 2500, steps: [['park tool', 3], ['pick tool', 3], ['prime', 0], ['wipe', 2]] },
  idex: { name: 'IDEX (2 heads)', short: 'IDEX', heads: 2, flush: 'prime', primeMm3: 15, priceUsd: 900, steps: [['park head', 2], ['other head in', 2], ['prime', 0]] },
} as const
export type MmMethod = keyof typeof MM_METHODS
export const MM_METHOD_KEYS = Object.keys(MM_METHODS) as MmMethod[]

/** One colour change: flush volume, waste grams, seconds and the step timeline. */
export function colourChange(m: MmMethod, from: MmColour, to: MmColour) {
  const M = MM_METHODS[m]
  const flushMm3 = M.flush === 'purge' ? purgeMm3(from, to) : M.primeMm3
  const steps = M.steps.map(([name, s]) => ({ name, s: s || flushMm3 / PURGE.flow }))
  return { flushMm3, grams: flushMm3 * PURGE.rho, seconds: steps.reduce((t, s) => t + s.s, 0), steps }
}

/** Cover 60 × 40 × 6 mm (30 layers); the logo runs through the top `layers`; it prints at `flow` mm³/s. */
export const MM_COVER = { w: 60, d: 40, layers: 30, layerMm: 0.2, flow: 8 }
export const MM_LAYER_SWEEP = sweep(0, MM_COVER.layers, 16)

/** Changes alternate base → logo → base; one per layer if the slicer starts each layer with the last colour. */
export function mmJob(m: MmMethod, base: MmColour, logo: MmColour, perLayer: number, layers: number) {
  const go = colourChange(m, base, logo)
  const back = colourChange(m, logo, base)
  const changes = perLayer * layers
  const nGo = Math.ceil(changes / 2)
  const nBack = changes - nGo
  const C = MM_COVER
  const partG = C.w * C.d * C.layers * C.layerMm * PURGE.rho
  const wasteG = nGo * go.grams + nBack * back.grams
  const addS = nGo * go.seconds + nBack * back.seconds
  const printS = (partG / PURGE.rho) / C.flow
  return { go, back, changes, wasteG, addS, partG, printS, wasteShare: wasteG / partG, slowdown: (printS + addS) / printS }
}

export function mmView(m: MmMethod, base: MmColour, logo: MmColour, perLayer: number, layers: number) {
  const cur = mmJob(m, base, logo, perLayer, layers)
  const curves = MM_METHOD_KEYS.map((k) => MM_LAYER_SWEEP.map((l) => mmJob(k, base, logo, perLayer, l).wasteG))
  const jobs = MM_METHOD_KEYS.map((k) => mmJob(k, base, logo, perLayer, layers))
  return { cur, curves, jobs }
}

// --- Soluble supports ---

/** rate20 = effective dissolve front speed (mm/h) through sparse support at 20 °C, still; ×2 per `doubleC`. scarUm = underside roughness left. */
export const SUPPORT_MATS = {
  same: { name: 'Same material', solvent: '', rate20: 0, scarUm: 150, gapMm: 0.2, costKg: 0, openDays: 30 },
  breakaway: { name: 'Breakaway', solvent: '', rate20: 0, scarUm: 60, gapMm: 0.1, costKg: 45, openDays: 7 },
  pva: { name: 'PVA', solvent: 'water', rate20: 0.8, scarUm: 15, gapMm: 0, costKg: 90, openDays: 1 },
  bvoh: { name: 'BVOH', solvent: 'water', rate20: 1.6, scarUm: 15, gapMm: 0, costKg: 110, openDays: 1 },
  hips: { name: 'HIPS', solvent: 'limonene', rate20: 0.4, scarUm: 20, gapMm: 0, costKg: 25, openDays: 14 },
}
export type SupportMat = keyof typeof SUPPORT_MATS
export const SUPPORT_MAT_KEYS = Object.keys(SUPPORT_MATS) as SupportMat[]
export const SUPPORT_MODELS = ['pla', 'petg', 'asa'] as const
export type SupportModel = (typeof SUPPORT_MODELS)[number]
/** How well each support sticks to the model (≥ `minBond` holds through the print). */
const SUPPORT_BOND: Record<SupportModel, Record<SupportMat, number>> = {
  pla: { same: 1, breakaway: 0.6, pva: 0.8, bvoh: 0.7, hips: 0.15 },
  petg: { same: 1, breakaway: 0.4, pva: 0.2, bvoh: 0.75, hips: 0.3 },
  asa: { same: 1, breakaway: 0.4, pva: 0.15, bvoh: 0.5, hips: 0.85 },
}
export const AGITATION = { still: { name: 'Still', k: 1 }, stirred: { name: 'Stirred / pump', k: 2.5 }, ultrasonic: { name: 'Ultrasonic', k: 4 } }
export type Agitation = keyof typeof AGITATION
/** Pliers reach `reachMm` into a cavity; by hand ~`handMinPerMm` per mm of support; limonene is not heated past `limoneneMaxC` (flammable). */
export const SOLUBLE = { doubleC: 10, minBond: 0.35, reachMm: 8, handMinPerMm: 0.6, supportG: 12, limoneneMaxC: 30, softenBelowTg: 10 }
export const WATER_SWEEP = sweep(20, 70, 26)

const solventC = (s: SupportMat, waterC: number) => (SUPPORT_MATS[s].solvent === 'limonene' ? Math.min(waterC, SOLUBLE.limoneneMaxC) : waterC)
const dissolveRate = (s: SupportMat, waterC: number, a: Agitation) =>
  SUPPORT_MATS[s].rate20 * 2 ** ((solventC(s, waterC) - 20) / SOLUBLE.doubleC) * AGITATION[a].k

/** Hours to free a support `depthMm` deep from the opening (null = by hand); hand removal stalls past the pliers' reach. */
export function freeHours(s: SupportMat, waterC: number, a: Agitation, depthMm: number) {
  const r = dissolveRate(s, waterC, a)
  if (r > 0) return { hours: depthMm / r, hand: false, stuckMm: 0 }
  const reach = Math.min(depthMm, SOLUBLE.reachMm)
  return { hours: (reach * SOLUBLE.handMinPerMm) / 60, hand: true, stuckMm: depthMm - reach }
}

export function solubleView(model: SupportModel, s: SupportMat, waterC: number, a: Agitation, depthMm: number) {
  const S = SUPPORT_MATS[s]
  const bond = SUPPORT_BOND[model][s]
  const free = freeHours(s, waterC, a, depthMm)
  const solvent = S.solvent === 'water'
  return {
    bond,
    holds: bond >= SOLUBLE.minBond,
    rate: dissolveRate(s, waterC, a),
    ...free,
    softens: solvent && waterC > FILAMENTS[model].tgC - SOLUBLE.softenBelowTg,
    capped: S.solvent === 'limonene' && waterC > SOLUBLE.limoneneMaxC,
    costUsd: (SOLUBLE.supportG * (S.costKg || FILAMENTS[model].costKg)) / 1000,
    curve: WATER_SWEEP.map((c) => freeHours(s, c, a, depthMm).hours),
    mats: SUPPORT_MAT_KEYS.map((k) => freeHours(k, waterC, a, depthMm)),
  }
}
