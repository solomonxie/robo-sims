// Filaments: property table (PLA/PETG from materials/stress), modulus vs temperature, TPU feeding, carbon-fibre blends, moisture.
import { clamp } from '../common'
import { MATERIALS, Material } from '../materials/stress'
import { FILAMENT_D, filamentArea } from './fdm'

const MPA = 1e6
const GPA = 1e9

/** Typical printed values. impact = notched Izod kJ/m² (TPU: no break), hdtC = heat deflection at 0.45 MPa,
 *  crystal = share of modulus kept above Tg, satPct = water at saturation in 50 % RH, d25 = water diffusivity mm²/h at 25 °C,
 *  wetPct = moisture where prints suffer, dryC = hottest safe dryer setting, slide = wear and low friction (0…1). */
export const FILAMENTS = {
  pla: { name: 'PLA', nozzleC: 210, bedC: 60, enclosure: false, E: MATERIALS.pla.E, utsPa: MATERIALS.pla.utsPa, failStrain: MATERIALS.pla.failStrain, ductile: false, tgC: 60, tmC: 170, crystal: 0.01, hdtC: 55, impact: 3, ease: 1, costKg: 20, uv: 0.4, slide: 0.3, rho: 1.24, satPct: 0.35, d25: 0.0008, wetPct: 0.2, dryC: 50 },
  petg: { name: 'PETG', nozzleC: 240, bedC: 80, enclosure: false, E: MATERIALS.petg.E, utsPa: MATERIALS.petg.utsPa, failStrain: MATERIALS.petg.failStrain, ductile: true, tgC: 80, tmC: 250, crystal: 0, hdtC: 70, impact: 6, ease: 0.8, costKg: 22, uv: 0.7, slide: 0.4, rho: 1.27, satPct: 0.3, d25: 0.0025, wetPct: 0.1, dryC: 65 },
  asa: { name: 'ASA / ABS', nozzleC: 250, bedC: 100, enclosure: true, E: 2.2 * GPA, utsPa: 40 * MPA, failStrain: 0.08, ductile: true, tgC: 105, tmC: 230, crystal: 0, hdtC: 95, impact: 12, ease: 0.4, costKg: 24, uv: 1, slide: 0.3, rho: 1.07, satPct: 0.3, d25: 0.002, wetPct: 0.15, dryC: 80 },
  tpu: { name: 'TPU 95A', nozzleC: 225, bedC: 50, enclosure: false, E: 26 * MPA, utsPa: 35 * MPA, failStrain: 5, ductile: true, tgC: -30, tmC: 180, crystal: 0.3, hdtC: 60, impact: 100, ease: 0.35, costKg: 30, uv: 0.6, slide: 0.1, rho: 1.21, satPct: 0.9, d25: 0.004, wetPct: 0.2, dryC: 55 },
  nylon: { name: 'Nylon (PA6)', nozzleC: 260, bedC: 80, enclosure: true, E: 1.8 * GPA, utsPa: 60 * MPA, failStrain: 0.3, ductile: true, tgC: 55, tmC: 220, crystal: 0.45, hdtC: 90, impact: 20, ease: 0.3, costKg: 40, uv: 0.5, slide: 1, rho: 1.14, satPct: 2.6, d25: 0.0036, wetPct: 0.4, dryC: 80 },
  pc: { name: 'Polycarbonate', nozzleC: 280, bedC: 110, enclosure: true, E: 2.3 * GPA, utsPa: 60 * MPA, failStrain: 0.08, ductile: true, tgC: 147, tmC: 260, crystal: 0, hdtC: 130, impact: 15, ease: 0.15, costKg: 35, uv: 0.4, slide: 0.4, rho: 1.2, satPct: 0.25, d25: 0.003, wetPct: 0.05, dryC: 90 },
}
export type FilamentKey = keyof typeof FILAMENTS
export const FILAMENT_KEYS = Object.keys(FILAMENTS) as FilamentKey[]

/** A filament as a materials/stress `Material`, for stress–strain curves and beams. */
export const filamentMaterial = (k: FilamentKey): Material => {
  const f = FILAMENTS[k]
  return { name: f.name, short: f.name, E: f.E, yieldPa: f.utsPa * 0.9, utsPa: f.utsPa, failStrain: f.failStrain, ductile: f.ductile }
}

// --- Material properties: 0…1 scores and a pick for a robot part ---

export const FILAMENT_PROPS = ['strength', 'stiffness', 'toughness', 'heat', 'ease', 'cheap', 'outdoor', 'flex', 'wear'] as const
export type FilamentProp = (typeof FILAMENT_PROPS)[number]

const maxOf = (f: (k: FilamentKey) => number) => Math.max(...FILAMENT_KEYS.map(f))
export function filamentScores(k: FilamentKey): Record<FilamentProp, number> {
  const f = FILAMENTS[k]
  return {
    strength: f.utsPa / maxOf((j) => FILAMENTS[j].utsPa),
    stiffness: f.E / maxOf((j) => FILAMENTS[j].E),
    toughness: Math.min(1, f.impact / 25),
    heat: clamp((f.hdtC - 40) / 90, 0, 1),
    ease: f.ease,
    cheap: maxOf((j) => -FILAMENTS[j].costKg) / -f.costKg,
    outdoor: f.uv,
    flex: clamp(Math.log10(f.failStrain / 0.02) / Math.log10(250), 0, 1),
    wear: f.slide,
  }
}

/** Robot parts: weights on each score, hotC = working temperature (a filament needs HDT ≥ hotC + 10). */
export const FILAMENT_PARTS = {
  finger: { name: 'Gripper finger pad', model: 'finger', hotC: 30, w: { flex: 3, toughness: 1, ease: 0.5 } },
  bracket: { name: 'Motor mount', model: 'bracket', hotC: 55, w: { stiffness: 1.5, strength: 1, ease: 1, cheap: 0.5 } },
  gear: { name: 'Gear', model: 'gear', hotC: 40, w: { wear: 2, toughness: 2, strength: 1.5, stiffness: 1.5 } },
  enclosure: { name: 'Electronics box', model: 'enclosure', hotC: 35, w: { ease: 2, cheap: 2, stiffness: 0.5 } },
  outdoor: { name: 'Outdoor sensor box', model: 'enclosure', hotC: 65, w: { outdoor: 3, ease: 0.5, strength: 0.5 } },
} satisfies Record<string, { name: string; model: string; hotC: number; w: Partial<Record<FilamentProp, number>> }>
export type FilamentPart = keyof typeof FILAMENT_PARTS

export function pickFilament(part: FilamentPart) {
  const P = FILAMENT_PARTS[part]
  const rows = FILAMENT_KEYS.map((key) => {
    const s = filamentScores(key)
    const hotOk = FILAMENTS[key].hdtC >= P.hotC + 10
    const score = Object.entries(P.w).reduce((a, [prop, w]) => a + w * s[prop as FilamentProp], 0) - (hotOk ? 0 : 3)
    return { key, score: Math.max(0, score), hotOk }
  })
  return { rows, best: rows.reduce((a, b) => (b.score > a.score ? b : a)).key }
}

// --- Glass transition: modulus vs temperature, and a loaded bracket sagging ---

const TG_WIDTH = 4
const RUBBER = 0.004
const sig = (x: number) => 1 / (1 + Math.exp(-x))

/** E(T) / E(25 °C): drops at Tg to the crystalline share (semi-crystalline) or a rubbery floor, then to ~0 at the melt. */
export function modulusRatio(k: FilamentKey, c: number) {
  const f = FILAMENTS[k]
  const kept = Math.max(RUBBER, f.crystal) * sig((f.tmC - 10 - c) / 6)
  const at = (t: number) => kept + (1 - kept) * sig((f.tgC - t) / TG_WIDTH)
  return at(c) / at(25)
}

/** Printed bracket: 60 mm cantilever, 12 × 4 mm section, load at the tip (typical motor mount arm). */
export const TG_BRACKET = { lenMm: 60, wMm: 12, tMm: 4 }

export function bracketSag(k: FilamentKey, c: number, kg: number) {
  const { lenMm: L, wMm: w, tMm: t } = TG_BRACKET
  const I = (w * t ** 3) / 12
  const E = (FILAMENTS[k].E / MPA) * modulusRatio(k, c)
  const F = kg * 9.81
  const sagMm = (F * L ** 3) / (3 * E * I)
  const stressMPa = (F * L * (t / 2)) / I
  return { E, sagMm, stressMPa, folds: sagMm > L * 0.3, soft: modulusRatio(k, c) < 0.5 }
}

/** Temperature (°C) where the modulus has halved. */
export function softenC(k: FilamentKey) {
  let lo = -60
  let hi = 300
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2
    if (modulusRatio(k, m) > 0.5) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

// --- Flexible TPU: Shore hardness, pad squash, filament buckling between gears and hotend ---

/** Young's modulus (Pa) from Shore A hardness, Gent's relation. */
export const shoreToE = (shoreA: number) => ((0.0981 * (56 + 7.62336 * shoreA)) / (0.137505 * (254 - 2.54 * shoreA))) * MPA

export const TPU_GRADES = {
  a85: { name: 'TPU 85A (soft)', shore: 85, kPush: 9 },
  a90: { name: 'TPU 90A', shore: 90, kPush: 9 },
  a95: { name: 'TPU 95A', shore: 95, kPush: 9 },
  pla: { name: 'PLA (rigid)', shore: 0, kPush: 5 },
}
export type TpuGrade = keyof typeof TPU_GRADES

/** gapMm = unsupported filament between the drive gears and the next guide, pathMm = filament from gears to nozzle. */
export const FEEDERS = {
  bowden: { name: 'Bowden tube', gapMm: 6, pathMm: 450 },
  direct: { name: 'Direct drive', gapMm: 1.5, pathMm: 40 },
}
export type FeederKey = keyof typeof FEEDERS

/** Drive-gear grip before the teeth strip or squash the filament, N (typical). */
export const GRIP_N = 30
const PUSH_BASE_N = 3
const PRINT_LINE_MM2 = 0.45 * 0.2

const gradeE = (g: TpuGrade) => (g === 'pla' ? FILAMENTS.pla.E : shoreToE(TPU_GRADES[g].shore))

/** Euler load of a fixed–fixed column, N: 4π²·E·I / L². */
export function columnBucklingN(E: number, dMm: number, lenMm: number) {
  const I = (Math.PI * dMm ** 4) / 64
  return (4 * Math.PI ** 2 * (E / MPA) * I) / lenMm ** 2
}

/** Push force the melt needs at a print speed (mm/s), N (typical). */
export const pushNeedN = (g: TpuGrade, speed: number) => PUSH_BASE_N + TPU_GRADES[g].kPush * speed * PRINT_LINE_MM2

export function tpuFeed(g: TpuGrade, feeder: FeederKey, speed: number) {
  const E = gradeE(g)
  const F = FEEDERS[feeder]
  const need = pushNeedN(g, speed)
  const pcr = columnBucklingN(E, FILAMENT_D, F.gapMm)
  const limit = Math.min(pcr, GRIP_N)
  const maxSpeed = Math.max(0, (limit - PUSH_BASE_N) / (TPU_GRADES[g].kPush * PRINT_LINE_MM2))
  const springMm = (need * F.pathMm) / ((E / MPA) * filamentArea())
  return { E, need, pcr, buckles: need > pcr, slips: need > GRIP_N && need <= pcr, maxSpeed, springMm, flow: speed * PRINT_LINE_MM2 }
}

/** 20 × 20 × 6 mm pad printed at `infill` squeezed by `forceN`: compression mm (E × infill², soft-capped at 60 % strain). */
export function padSquash(g: TpuGrade, forceN: number, infill = 0.15) {
  const strain = forceN / ((gradeE(g) / MPA) * infill ** 2 * 400)
  return 6 * 0.6 * Math.tanh(strain / 0.6)
}

// --- Carbon-fibre blends ---

/** Short carbon fibre, typical: modulus, density, and efficiency of short, misaligned fibres in a print. */
export const CARBON_FIBRE = { E: 230 * GPA, rho: 1.8, eta: 0.1 }
export const CF_BASES = ['pla', 'petg', 'nylon'] as const
export type CfBase = (typeof CF_BASES)[number]

export const fibreVolume = (base: CfBase, wFrac: number) => {
  const v = wFrac / CARBON_FIBRE.rho
  return v / (v + (1 - wFrac) / FILAMENTS[base].rho)
}

/** Base filament with `wFrac` carbon fibre by weight: modified rule of mixtures for E, embrittlement, weaker layer bonds. */
export function cfBlend(base: CfBase, wFrac: number) {
  const f = FILAMENTS[base]
  const vf = fibreVolume(base, wFrac)
  const E = f.E * (1 - vf) + CARBON_FIBRE.eta * CARBON_FIBRE.E * vf
  const failStrain = f.failStrain * Math.exp(-6 * vf)
  const utsPa = f.utsPa * (1 + 0.6 * vf)
  const mat: Material = { name: `${f.name}-CF`, short: `${f.name}-CF`, E, yieldPa: utsPa * 0.9, utsPa, failStrain, ductile: f.ductile && failStrain > 0.03 }
  return { vf, mat, stiffer: E / f.E, layerBond: Math.max(0.3, 1 - 2 * vf), toughness: Math.exp(-5 * vf) }
}

/** wear = bore growth relative to brass; extraC = hotter setting for the poorer heat conduction (typical). */
export const NOZZLES = {
  brass: { name: 'Brass', wear: 1, extraC: 0 },
  steel: { name: 'Hardened steel', wear: 1 / 30, extraC: 10 },
  ruby: { name: 'Ruby / carbide tip', wear: 1 / 150, extraC: 5 },
}
export type NozzleKey = keyof typeof NOZZLES
const BRASS_WEAR_MM_PER_KG = 1.2
export const NOZZLE_MM = 0.4

/** Nozzle bore (mm) after `kg` of a blend with fibre volume share `vf`, worn up to 1 mm. */
export const nozzleBore = (n: NozzleKey, vf: number, kg: number) => Math.min(1, NOZZLE_MM + BRASS_WEAR_MM_PER_KG * vf * NOZZLES[n].wear * kg)

// --- Moisture: uptake in humid air, drying in a dryer (diffusion into a cylinder) ---

/** Zeros of J0 (McMahon's expansion). */
const BESSEL_ZEROS = Array.from({ length: 60 }, (_, i) => {
  const b = (i + 0.75) * Math.PI
  return b + 1 / (8 * b) - 31 / (384 * b ** 3)
})

/** Fraction of the final moisture change reached after `hours` in a rod of radius `rMm` (series for radial diffusion). */
export function diffusionFrac(dMm2h: number, rMm: number, hours: number) {
  if (hours <= 0) return 0
  const tau = (dMm2h * hours) / (rMm * rMm)
  let left = 0
  for (const a of BESSEL_ZEROS) left += (4 / (a * a)) * Math.exp(-a * a * tau)
  return clamp(1 - left, 0, 1)
}

const EA_K = 4800
/** Water diffusivity mm²/h at `c` °C (Arrhenius, about ×2 per 13 °C). */
export const diffusivity = (k: FilamentKey, c: number) => FILAMENTS[k].d25 * Math.exp(EA_K * (1 / 298 - 1 / (273 + c)))

/** Moisture % after `days` in air at `rh` (0…1) and 25 °C, starting dry. */
export const uptakePct = (k: FilamentKey, days: number, rh = 0.5, dMm = FILAMENT_D) =>
  FILAMENTS[k].satPct * (rh / 0.5) * diffusionFrac(FILAMENTS[k].d25, dMm / 2, days * 24)

/** Moisture % after `hours` in dry air at `c` °C from `startPct`. */
export const dryingPct = (k: FilamentKey, startPct: number, c: number, hours: number, dMm = FILAMENT_D) =>
  startPct * (1 - diffusionFrac(diffusivity(k, c), dMm / 2, hours))

/** Hours at `c` °C until moisture falls to half the wet limit (Infinity past 200 h). */
export function dryHours(k: FilamentKey, startPct: number, c: number, dMm = FILAMENT_D) {
  const goal = FILAMENTS[k].wetPct / 2
  if (startPct <= goal) return 0
  if (dryingPct(k, startPct, c, 200, dMm) > goal) return Infinity
  let lo = 0
  let hi = 200
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2
    if (dryingPct(k, startPct, c, m, dMm) > goal) lo = m
    else hi = m
  }
  return hi
}

/** Spool: 1 kg of filament on a 250 g empty spool, plus its water. */
export const SPOOL_G = { filament: 1000, empty: 250 }
export const spoolGrams = (pct: number) => SPOOL_G.filament * (1 + pct / 100) + SPOOL_G.empty

export function moistureView(k: FilamentKey, days: number, dryC: number, dMm = FILAMENT_D) {
  const wet = uptakePct(k, days, 0.5, dMm)
  const hours = dryHours(k, wet, dryC, dMm)
  const f = FILAMENTS[k]
  return { wet, hours, wetG: spoolGrams(wet), dryG: spoolGrams(Math.min(wet, f.wetPct / 2)), tooHot: dryC > f.dryC, pops: Math.max(0, wet / f.wetPct - 1), isWet: wet > f.wetPct }
}
