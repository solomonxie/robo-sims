// Strength of prints (typical values): layer welding vs interface temperature × time, walls vs infill in a bent bar, annealing.
import { clamp, clamp01, sweep } from '../common'
import { MATERIALS, bendingStress, rectI } from '../materials/stress'
import { LINE_W } from './fdm'
import { FILAMENTS } from './filaments'
import { GCODE_HEAT } from './gcode'
import { INFILL_PATTERNS, InfillPattern, infillStiffness } from './slicing'

const AMB = GCODE_HEAT.ambient

// --- Layer adhesion: chains diffuse across the interface while it is above Tg; weld = (∫ dt / τ(T))^¼ ---

/** zMax = best Z / XY strength, eaK = activation (K) of the chain relaxation time τ(T), tauS = τ at the usual nozzle temperature. */
export const WELD_MATS = {
  pla: { zMax: 0.9, eaK: 14000, tauS: 0.006 },
  petg: { zMax: 0.92, eaK: 14000, tauS: 0.006 },
  asa: { zMax: 0.75, eaK: 14000, tauS: 0.01 },
  nylon: { zMax: 0.85, eaK: 14000, tauS: 0.006 },
}
export type WeldMat = keyof typeof WELD_MATS
export const WELD_MAT_KEYS = Object.keys(WELD_MATS) as WeldMat[]
/** Bead lands `beadDrop` under the nozzle; the layer below cools with τ = coolS / (1 + fanK·fan), the buried interface with ifaceS / (1 + 1.5 fan). */
export const WELD = { beadDrop: 15, coolS: 16, fanK: 3, ifaceS: 2.2, dt: 0.005, barMm2: 40 }
export const WELD_TIME_SWEEP = sweep(2, 30, 15)

const weldAir = (m: WeldMat) => (FILAMENTS[m].enclosure ? 40 : AMB)

/** Interface weld for one layer change: landing temperatures, seconds above Tg, weld 0…1 and Z strength as a share of XY. */
export function layerWeld(m: WeldMat, nozzleC: number, fan: number, layerS: number) {
  const f = FILAMENTS[m]
  const M = WELD_MATS[m]
  const air = weldAir(m)
  const lay = nozzleC - WELD.beadDrop
  const below = air + (lay - air) * Math.exp((-layerS * (1 + WELD.fanK * fan)) / WELD.coolS)
  const t0 = (lay + below) / 2
  const tauI = WELD.ifaceS / (1 + 1.5 * fan)
  const ref = 1 / (f.nozzleC - WELD.beadDrop + 273)
  let heal = 0
  let above = 0
  for (let t = 0; t < 40; t += WELD.dt) {
    const T = air + (t0 - air) * Math.exp(-t / tauI)
    if (T <= f.tgC) break
    above = t + WELD.dt
    heal += WELD.dt / (M.tauS * Math.exp(M.eaK * (1 / (T + 273) - ref)))
  }
  const weld = Math.min(1, heal ** 0.25)
  return { lay, below, t0, above, heal, weld, zFrac: M.zMax * weld }
}

/** Tensile bars of `WELD.barMm2`: flat (lines along the pull) breaks at UTS, upright (pull across the layers) at zFrac × UTS. */
export function weldView(m: WeldMat, nozzleC: number, fan: number, layerS: number) {
  const cur = layerWeld(m, nozzleC, fan, layerS)
  const uts = FILAMENTS[m].utsPa
  const flatN = uts * WELD.barMm2 * 1e-6
  return {
    cur,
    flatN,
    uprightN: flatN * cur.zFrac,
    curve: WELD_TIME_SWEEP.map((s) => layerWeld(m, nozzleC, fan, s).zFrac),
    mats: WELD_MAT_KEYS.map((k) => layerWeld(k, FILAMENTS[k].nozzleC + (nozzleC - FILAMENTS[m].nozzleC), fan, layerS).zFrac),
  }
}

// --- Walls vs infill: a bar in 3-point bending; the shell is the outer fibres, infill the core ---

/** Bar section W × H (mm), span L, shell thickness = walls × line width all round (top/bottom layers to match). */
export const SHELL_BAR = { W: 20, H: 12, L: 80 }
export const WALL_SWEEP = [1, 2, 3, 4, 5, 6, 7, 8, 10, 13]
const SHELL_INFILL_SWEEP = sweep(0, 1, 21)
export const SHELL_RECIPES = [
  { name: '2 walls, 20 %', walls: 2, infill: 0.2 },
  { name: '4 walls, 20 %', walls: 4, infill: 0.2 },
  { name: '2 walls, 60 %', walls: 2, infill: 0.6 },
  { name: 'Solid', walls: 13, infill: 1 },
] as const

const torsionRect = (a: number, b: number) => {
  const [l, s] = a >= b ? [a, b] : [b, a]
  if (s <= 0) return 0
  return l * s ** 3 * (1 / 3 - 0.21 * (s / l) * (1 - s ** 4 / (12 * l ** 4)))
}

/** Bending stiffness/strength, torsion stiffness and mass of the bar, each relative to solid. */
export function shellBar(walls: number, infill: number, pattern: InfillPattern, { W, H } = SHELL_BAR) {
  const t = Math.min(walls * LINE_W, H / 2)
  const [wi, hi] = [Math.max(0, W - 2 * t), Math.max(0, H - 2 * t)]
  const e = infillStiffness(pattern, infill)[0]
  const solidI = rectI(W, H)
  const coreI = rectI(wi, hi)
  const bend = (solidI - coreI + e * coreI) / solidI
  const area = W * H
  const mass = (area - wi * hi + infill * wi * hi) / area
  const twist = 1 - ((1 - e) * torsionRect(wi, hi)) / torsionRect(W, H)
  return { t, e, bend, mass, twist, perGram: bend / mass }
}

/** The bar under `loadN` at mid-span in PLA: peak shell stress, safety factor, grams; walls path and infill path for the plot. */
export function shellView(walls: number, infill: number, pattern: InfillPattern, loadN: number) {
  const { W, H, L } = SHELL_BAR
  const cur = shellBar(walls, infill, pattern)
  const I = rectI(W, H) * cur.bend * 1e-12
  const sigma = bendingStress((loadN * L * 1e-3) / 4, (H / 2) * 1e-3, I)
  const grams = W * H * L * cur.mass * FILAMENTS.pla.rho * 1e-3
  return {
    cur,
    sigma,
    sf: MATERIALS.pla.utsPa / sigma,
    grams,
    byWalls: WALL_SWEEP.map((w) => shellBar(w, infill, pattern)),
    byInfill: SHELL_INFILL_SWEEP.map((d) => shellBar(walls, d, pattern)),
    recipes: SHELL_RECIPES.map((r) => shellBar(r.walls, r.infill, pattern)),
    patternName: INFILL_PATTERNS[pattern].name,
  }
}

// --- Annealing: above Tg the chains fold into crystals (Avrami); heat resistance and stiffness rise, the part shrinks in XY and grows in Z ---

/** xMax = crystallinity reachable, peakC/widthC = crystallisation rate bell, halfMin = half-time at the peak, hdtMax = HDT at full crystallinity,
 *  stiff = modulus gain at full, xy/z = size change at full (oriented lines relax), slump = mm/√min per °C above HDT while still soft. */
export const ANNEAL_MATS = {
  pla: { xMax: 0.4, peakC: 105, widthC: 20, halfMin: 6, hdtMax: 110, stiff: 0.2, zGain: 0.15, xy: -0.03, z: 0.02, slump: 0.004 },
  petg: { xMax: 0, peakC: 150, widthC: 20, halfMin: 1e4, hdtMax: 70, stiff: 0, zGain: 0, xy: -0.004, z: 0.002, slump: 0.03 },
  asa: { xMax: 0, peakC: 150, widthC: 20, halfMin: 1e4, hdtMax: 95, stiff: 0, zGain: 0, xy: -0.004, z: 0.002, slump: 0.03 },
  nylon: { xMax: 0.15, peakC: 120, widthC: 35, halfMin: 10, hdtMax: 150, stiff: 0.15, zGain: 0.1, xy: -0.012, z: 0.008, slump: 0.004 },
}
export type AnnealMat = keyof typeof ANNEAL_MATS
export const ANNEAL_MAT_KEYS = Object.keys(ANNEAL_MATS) as AnnealMat[]
export const ANNEAL = { avrami: 2.5, block: { L: 60, W: 20, H: 12 } }
export const ANNEAL_TIME_SWEEP = sweep(0, 120, 25)

/** Crystallisation done (0…1 of xMax) after `min` minutes at `c` °C: 1 − exp(−ln2 (t / t½)^n), t½ grows off the peak, nothing below Tg + 5. */
export function crystalDone(m: AnnealMat, c: number, min: number) {
  const A = ANNEAL_MATS[m]
  if (A.xMax === 0 || c <= FILAMENTS[m].tgC + 5 || min <= 0) return 0
  const half = A.halfMin / Math.exp(-(((c - A.peakC) / A.widthC) ** 2))
  return 1 - Math.exp(-Math.LN2 * (min / half) ** ANNEAL.avrami)
}

/** One anneal: crystallinity, HDT, stiffness and Z strength gains, XY/Z size change, warp/slump (mm on the test block) and the CAD scale that compensates. */
export function annealPart(m: AnnealMat, c: number, min: number) {
  const A = ANNEAL_MATS[m]
  const f = FILAMENTS[m]
  const done = crystalDone(m, c, min)
  const hdt = f.hdtC + (A.hdtMax - f.hdtC) * done
  const warm = clamp01((c - f.tgC) / 40)
  const relax = c > f.tgC ? 1 - Math.exp(-min / 10) : 0
  const xy = A.xy * (A.xMax > 0 ? done : relax * warm)
  const z = A.z * (A.xMax > 0 ? done : relax * warm)
  const soft = Math.max(0, c - Math.max(f.hdtC, hdt))
  const slump = A.slump * soft * Math.sqrt(Math.max(0, min))
  const warp = Math.abs(xy - z) * ANNEAL.block.L * 0.25 * warm + slump
  return {
    done,
    crystal: A.xMax * done,
    hdt,
    stiff: 1 + A.stiff * done,
    zGain: 1 + A.zGain * done,
    xy,
    z,
    warp: clamp(warp, 0, 10),
    slump: clamp(slump, 0, 10),
    scaleXY: 1 / (1 + xy),
    scaleZ: 1 / (1 + z),
  }
}

export function annealView(m: AnnealMat, c: number, min: number) {
  return {
    cur: annealPart(m, c, min),
    hdtCurve: ANNEAL_TIME_SWEEP.map((t) => annealPart(m, c, t).hdt),
    mats: ANNEAL_MAT_KEYS.map((k) => annealPart(k, c, min)),
  }
}
