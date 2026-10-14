// Chip making: lithography resolution, dies on a wafer, yield, and what a process node's name measures.
import { halton } from '../halton'

export interface Scanner {
  name: string
  nm: number
  /** Numerical aperture: sine of the widest ray angle at the wafer, times the medium's index (water: 1.44). */
  na: number
  /** Mirrors the light bounces off between source and wafer, the rest is lenses. */
  mirrors: number
  reflectance: number
}

export const K1 = 0.3
export const EUV_MIRROR_REFLECTANCE = 0.7
export const MASK_REDUCTION = 4

export const SCANNERS = {
  duv: { name: 'ArF immersion', nm: 193, na: 1.35, mirrors: 3, reflectance: 0.95 },
  euv: { name: 'EUV', nm: 13.5, na: 0.33, mirrors: 11, reflectance: EUV_MIRROR_REFLECTANCE },
  highNa: { name: 'High-NA EUV', nm: 13.5, na: 0.55, mirrors: 11, reflectance: EUV_MIRROR_REFLECTANCE },
} satisfies Record<string, Scanner>

/** Rayleigh: the smallest printable half-pitch, k1·λ/NA (k1 ≈ 0.25 is the physical floor). */
export const halfPitch = (nm: number, na: number, k1 = K1) => (k1 * nm) / na

/** Depth of focus λ/NA²: how flat the wafer must be. */
export const depthOfFocus = (nm: number, na: number) => nm / na ** 2

/** Share of the light left after the scanner's mirror bounces (lens losses ignored). */
export const opticsThroughput = ({ mirrors, reflectance }: Pick<Scanner, 'mirrors' | 'reflectance'>) => reflectance ** mirrors

export interface Cell {
  x: number
  y: number
}

/** Rectangles `w` × `h` (mm) on a grid centred on the wafer, kept when fully inside the usable radius (`inside`) or
 *  when they touch it at all (exposure fields). Centres in mm. */
export function waferGrid(diameter: number, w: number, h: number, edge = 3, mode: 'inside' | 'touch' = 'inside'): Cell[] {
  const r = diameter / 2 - edge
  const nx = Math.ceil(r / w) + 1
  const ny = Math.ceil(r / h) + 1
  const out: Cell[] = []
  for (let j = -ny; j < ny; j++)
    for (let i = -nx; i < nx; i++) {
      const x = (i + 0.5) * w
      const y = (j + 0.5) * h
      const far = Math.hypot(Math.abs(x) + w / 2, Math.abs(y) + h / 2)
      const near = Math.hypot(Math.max(0, Math.abs(x) - w / 2), Math.max(0, Math.abs(y) - h / 2))
      if (mode === 'inside' ? far <= r : near < r) out.push({ x, y })
    }
  return out
}

/** Classic estimate: wafer area / die area, minus the dies lost around the rim. */
export const diesPerWaferEstimate = (diameter: number, area: number) =>
  (Math.PI * (diameter / 2) ** 2) / area - (Math.PI * diameter) / Math.sqrt(2 * area)

/** Poisson yield: the chance a die of `mm2` catches none of `perCm2` random killer defects, e^(−A·D0). */
export const poissonYield = (mm2: number, perCm2: number) => Math.exp((-mm2 / 100) * perCm2)

/** `count` defects scattered evenly (Halton) over a disk of `radius` mm, deterministic. */
export function defectSpots(count: number, radius: number): Cell[] {
  return Array.from({ length: count }, (_, i) => {
    const r = radius * Math.sqrt(halton(i, 2))
    const a = 2 * Math.PI * halton(i, 3)
    return { x: r * Math.cos(a), y: r * Math.sin(a) }
  })
}

/** Defects on a wafer of `diameter` mm at `perCm2`. */
export const defectCount = (diameter: number, perCm2: number) => Math.round((Math.PI * (diameter / 20) ** 2) * perCm2)

/** Which dies (`w` × `h` at the given centres) hold at least one defect. */
export const killedDies = (dies: Cell[], w: number, h: number, defects: Cell[]) =>
  dies.map((d) => defects.some((p) => Math.abs(p.x - d.x) <= w / 2 && Math.abs(p.y - d.y) <= h / 2))

export const WAFER_MM = 300
export const FIELD_MM = { w: 26, h: 33 }

export interface Node {
  name: string
  arch: 'finfet' | 'gaa'
  /** Contacted gate pitch, nm. */
  cpp: number
  /** Tightest metal pitch, nm. */
  mmp: number
  /** Standard-cell height, nm. */
  cellH: number
  /** Fin width, or nanosheet thickness, nm. */
  fin: number
  /** Fin height, or top of the sheet stack, nm. */
  finH: number
  /** Fin (or sheet stack) spacing, nm. */
  finPitch: number
  year: number
}

/** Public estimates for TSMC's nodes. */
export const NODES = {
  n16: { name: '16 nm', arch: 'finfet', cpp: 90, mmp: 64, cellH: 576, fin: 8, finH: 40, finPitch: 48, year: 2015 },
  n7: { name: '7 nm', arch: 'finfet', cpp: 57, mmp: 40, cellH: 240, fin: 6, finH: 50, finPitch: 30, year: 2018 },
  n3: { name: '3 nm', arch: 'finfet', cpp: 48, mmp: 23, cellH: 169, fin: 5, finH: 55, finPitch: 26, year: 2022 },
  n2: { name: '2 nm', arch: 'gaa', cpp: 45, mmp: 23, cellH: 138, fin: 5, finH: 45, finPitch: 36, year: 2025 },
} satisfies Record<string, Node>

export const SI_BOND_NM = 0.235

/** Transistors per mm² if the chip were all NAND2 cells: 4 transistors in 3 gate pitches × one cell height. */
export const nand2Density = (cppNm: number, cellHNm: number) => 4 / ((3 * cppNm * cellHNm) / 1e12)

/** Silicon atoms side by side across `nm`. */
export const atomsAcross = (nm: number) => Math.round(nm / SI_BOND_NM)

export const HAIR_NM = 70000

/** Gates side by side across a 70 µm hair. */
export const gatesAcrossHair = (cppNm: number) => Math.floor(HAIR_NM / cppNm)

/** Leading-edge (3 nm) wafer price, USD. */
export const WAFER_USD = 20000

export const costPerGoodDie = (waferUsd: number, good: number) => (good > 0 ? waferUsd / good : Infinity)
