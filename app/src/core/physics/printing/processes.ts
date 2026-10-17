// Resin (MSLA, laser SLA) and powder (SLS) vs FDM: layer times, peel force, nesting, picking a process. Values typical.
import { MATERIALS } from '../materials/stress'
import { LAYER_OVERHEAD_S, sliceLayers } from './layers'

const DEG = Math.PI / 180

/** Typical desktop MSLA: 50 µm LCD pixels, 405 nm backlight; laser SLA draws the same layer with a spot. */
export const RESIN = { pixelMm: 0.05, exposeS: 2.5, liftS: 6, suctionNmm2: 0.02, laserMm2s: 250, plate: [128, 80] as const, layerMm: 0.05 }
/** The resin demo part: a bracket plate L × W × t mm. */
export const RESIN_PART = { L: 30, W: 20, t: 4 }
export const RESIN_MAX_PARTS = 6
export const FDM_LAYER = 0.2

const FDM_RATE = (() => {
  const ls = sliceLayers({ shape: 'box', layerH: FDM_LAYER, infill: 0.2, speed: 60 })
  return (ls[50].time - LAYER_OVERHEAD_S) / 400
})()
/** FDM time for one layer with `area` mm² of cross-section (walls + 20 % infill at 60 mm/s, scaled from the sliced box). */
export const fdmLayerS = (area: number) => LAYER_OVERHEAD_S + area * FDM_RATE
export const mslaLayerS = () => RESIN.exposeS + RESIN.liftS
export const laserLayerS = (area: number) => RESIN.liftS + area / RESIN.laserMm2s

/** x-extent [x0, x1] at height z of an L × t slab tilted `deg` up from the plate (lowest corner at z = 0), or null. */
export function slabSection(deg: number, L: number, t: number, z: number): [number, number] | null {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  const P = [[0, 0], [L * c, L * s], [L * c - t * s, L * s + t * c], [-t * s, t * c]]
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = P[i]
    const [x1, z1] = P[(i + 1) % 4]
    if ((z < Math.min(z0, z1)) || z > Math.max(z0, z1)) continue
    const x = z1 === z0 ? Math.min(x0, x1) : x0 + ((z - z0) / (z1 - z0)) * (x1 - x0)
    const xs = z1 === z0 ? [x0, x1] : [x]
    for (const v of xs) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  return lo <= hi ? [lo, hi] : null
}

export const slabHeight = (deg: number, L: number, t: number) => L * Math.sin(deg * DEG) + t * Math.cos(deg * DEG)

/** Plate slots for `n` copies of the part (centres in mm, plate centred): columns `dx` apart, two rows `dy` apart. */
export function plateSlots(n: number, dx = 40, dy = 34): [number, number][] {
  const cols = Math.ceil(n / 2)
  return Array.from({ length: n }, (_, i) => [(Math.floor(i / 2) - (cols - 1) / 2) * dx, n === 1 ? 0 : ((i % 2) - 0.5) * dy] as [number, number])
}

export const AREA_SWEEP = Array.from({ length: 21 }, (_, i) => i * 250)

export interface ResinIn {
  parts: number
  tiltDeg: number
  layerH: number
}

export function resinView({ parts, tiltDeg, layerH }: ResinIn) {
  const { L, W, t } = RESIN_PART
  const H = slabHeight(tiltDeg, L, t)
  const n = Math.max(1, Math.ceil(H / layerH - 1e-9))
  const areas: number[] = []
  for (let i = 0; i < n; i++) {
    const sec = slabSection(tiltDeg, L, t, Math.min(H, (i + 0.5) * layerH))
    areas.push(sec ? (sec[1] - sec[0]) * W * parts : 0)
  }
  const peakA = Math.max(...areas)
  const layerS = mslaLayerS()
  const total = n * layerS
  const laserTotal = areas.reduce((s, a) => s + laserLayerS(a), 0)
  const fdmTotal = Math.ceil(H / FDM_LAYER) * fdmLayerS(peakA)
  const perMm = (a: number) => ({ msla: mslaLayerS() / layerH, laser: laserLayerS(a) / layerH, fdm: fdmLayerS(a) / FDM_LAYER })
  return {
    H,
    layers: n,
    areas,
    peakA,
    layerS,
    total,
    perPart: total / parts,
    laserTotal,
    fdmTotal,
    peelN: RESIN.suctionNmm2 * peakA,
    litPixels: peakA / RESIN.pixelMm ** 2,
    perMm: perMm(peakA),
    sweep: AREA_SWEEP.map(perMm),
  }
}

/** Typical small SLS printer: 165 mm square bed, 300 mm tall; recoat + heat per layer, laser area rate, cool-down ≈ build time. */
export const SLS = { bed: 165, height: 300, recoatS: 15, laserMm2s: 400, gapMm: 4, coolFactor: 1 }
/** The SLS demo part: a 30 mm spur gear 10 mm thick (≈ a disc). */
export const SLS_GEAR = { d: 30, h: 10, vol: Math.PI * 15 * 15 * 10 * 0.95 }
export const SLS_PARTS_MAX = 64

export interface Nest {
  perRow: number
  perLevel: number
  levels: number
  height: number
}

/** Parts of footprint `size` mm × `h` mm nested in the bed: a grid per level, levels stacked with gaps. */
export function slsNest(qty: number, size: number, h: number): Nest {
  const perRow = Math.max(1, Math.floor((SLS.bed - SLS.gapMm) / (size + SLS.gapMm)))
  const perLevel = perRow * perRow
  const levels = Math.ceil(qty / perLevel)
  return { perRow, perLevel, levels, height: levels * (h + SLS.gapMm) + SLS.gapMm }
}

/** Build of `qty` parts of volume `vol` mm³: layers × recoat + Σ sintered area / laser rate, then cool-down. */
export function slsBuild(qty: number, size: number, h: number, vol: number, layerH: number) {
  const nest = slsNest(qty, size, h)
  const layers = Math.ceil(nest.height / layerH)
  const recoat = layers * SLS.recoatS
  const scan = (qty * vol) / layerH / SLS.laserMm2s
  const build = recoat + scan
  const total = build * (1 + SLS.coolFactor)
  return { nest, layers, recoat, scan, build, total, perPart: total / qty, packing: (qty * vol) / (SLS.bed * SLS.bed * nest.height), fits: nest.height <= SLS.height }
}

export const SLS_SWEEP = Array.from({ length: SLS_PARTS_MAX }, (_, i) => i + 1)

export function slsView(parts: number, layerH: number) {
  const { d, h, vol } = SLS_GEAR
  const b = slsBuild(parts, d, h, vol, layerH)
  return { ...b, sweep: SLS_SWEEP.map((q) => slsBuild(q, d, h, vol, layerH).total) }
}

/** Typical process data. uts MPa × zRatio = weak (Z) direction; tough = impact, 1 best; cost in $ per cm³ of part and per machine hour. */
export const PROCESSES = {
  fdm: { name: 'FDM', material: 'PLA', uts: MATERIALS.pla.utsPa / 1e6, zRatio: 0.55, tough: 0.7, featureMm: 0.4, raUm: 15, perCm3: 0.03, perHour: 0.2, postMin: 5, where: 'home or school', supports: 'overhangs' },
  msla: { name: 'MSLA', material: 'standard resin', uts: 45, zRatio: 0.95, tough: 0.4, featureMm: 0.1, raUm: 2, perCm3: 0.05, perHour: 0.3, postMin: 20, where: 'home, gloves and fumes', supports: 'almost always' },
  sls: { name: 'SLS', material: 'nylon PA12', uts: 48, zRatio: 0.9, tough: 1, featureMm: 0.5, raUm: 8, perCm3: 0.12, perHour: 4, postMin: 10, where: 'print service', supports: 'never' },
}
export type ProcessKey = keyof typeof PROCESSES
export const PROCESS_KEYS = Object.keys(PROCESSES) as ProcessKey[]

/** Robot parts to choose for: size mm (footprint side, height), volume cm³, finest feature mm, load (needs strength), overhangs, looks (needs a smooth surface). */
export const PICK_PARTS = {
  gear: { name: 'Spur gear 30 mm', size: 30, h: 10, vol: 6.7, featureMm: 0.5, load: 1, overhangs: false, looks: 0.3 },
  bracket: { name: 'Motor bracket', size: 40, h: 30, vol: 9, featureMm: 1, load: 1, overhangs: true, looks: 0 },
  enclosure: { name: 'Electronics box', size: 80, h: 40, vol: 45, featureMm: 1.5, load: 0.2, overhangs: false, looks: 0.5 },
  finger: { name: 'Gripper finger', size: 15, h: 60, vol: 8, featureMm: 0.8, load: 0.8, overhangs: true, looks: 0.2 },
  figure: { name: 'Tiny detailed figure', size: 20, h: 30, vol: 3, featureMm: 0.15, load: 0, overhangs: true, looks: 1 },
}
export type PickPart = keyof typeof PICK_PARTS

const FDM_FLOW_MM3S = 4

/** Hours for `qty` copies of `part` on each process. */
function processHours(key: ProcessKey, part: (typeof PICK_PARTS)[PickPart], qty: number) {
  if (key === 'fdm') {
    const perBed = Math.max(1, Math.floor(220 / (part.size + 5)) ** 2)
    return (qty * part.vol * 1000) / FDM_FLOW_MM3S / 3600 + Math.ceil(qty / perBed) * 0.1
  }
  if (key === 'msla') {
    const perPlate = Math.max(1, Math.floor(RESIN.plate[0] / (part.size + 4)) * Math.floor(RESIN.plate[1] / (part.size + 4)))
    const tall = part.h * Math.sin(45 * DEG) + part.size * 0.7
    return (Math.ceil(qty / perPlate) * (tall / RESIN.layerMm) * mslaLayerS()) / 3600
  }
  return slsBuild(qty, part.size, part.h, part.vol * 1000, 0.1).total / 3600
}

export interface ProcessRow {
  key: ProcessKey
  hours: number
  cost: number
  strength: number
  detailOk: boolean
  supports: boolean
  score: number
}

/** Each process for `qty` of `part`: batch hours, cost per part, weak-direction strength, detail, supports, and a weighted score. */
export function pickProcess(partKey: PickPart, qty: number) {
  const part = PICK_PARTS[partKey]
  const rows: ProcessRow[] = PROCESS_KEYS.map((key) => {
    const P = PROCESSES[key]
    const hours = processHours(key, part, qty)
    const cost = part.vol * P.perCm3 * (key === 'sls' ? 1.6 : 1.15) + (P.perHour * hours) / qty
    const strength = P.uts * P.zRatio
    return { key, hours, cost, strength, detailOk: P.featureMm <= part.featureMm, supports: key === 'msla' || (key === 'fdm' && part.overhangs), score: 0 }
  })
  const best = (f: (r: ProcessRow) => number, low = true) => {
    const vs = rows.map(f)
    const top = low ? Math.min(...vs) : Math.max(...vs)
    return (r: ProcessRow) => (low ? top / f(r) : f(r) / top)
  }
  const cost = best((r) => r.cost)
  const time = best((r) => r.hours)
  const strong = best((r) => r.strength * PROCESSES[r.key].tough, false)
  const smooth = best((r) => PROCESSES[r.key].raUm)
  for (const r of rows) {
    r.score = cost(r) + 0.6 * time(r) + 1.5 * part.load * strong(r) + part.looks * smooth(r) - (r.supports ? 0.25 : 0) - (r.detailOk ? 0 : 3)
  }
  const pick = rows.reduce((a, b) => (b.score > a.score ? b : a)).key
  return { part, rows, pick }
}
