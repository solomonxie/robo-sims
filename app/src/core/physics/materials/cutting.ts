// Laser cutting: kerf width from power, kerf compensation, press-fit joints; acrylic vs plywood chassis plates.
import { MATERIALS, beamStiffness, bendingStress, cantileverDeflection, rectI, strengthOf } from './stress'

const LASER_W = 40
const SPOT_MM = 0.1

/** 3 mm sheets on a 40 W CO₂ laser: feed speed, line energy (J/mm) to cut through, kerf growth per J/mm, char per J/mm. */
export const SHEETS = {
  acrylic: { name: '3 mm acrylic', speed: 8, cutJmm: 2.6, widen: 0.04, char: 0, density: 1190, sheetCost: 12, tightMm: -0.06 },
  plywood: { name: '3 mm plywood', speed: 12, cutJmm: 1.5, widen: 0.06, char: 0.09, density: 680, sheetCost: 4, tightMm: -0.15 },
} as const
export type SheetKey = keyof typeof SHEETS
const SHEET_T = 0.003

/** Line energy J/mm at `powerPct`, the kerf it leaves (mm), how deep it gets (1 = through) and the char band on each edge (mm). */
export function kerfOf(sk: SheetKey, powerPct: number) {
  const s = SHEETS[sk]
  const jmm = (LASER_W * powerPct) / 100 / s.speed
  const depth = Math.min(1, jmm / s.cutJmm)
  return { jmm, depth, through: depth >= 1, kerf: SPOT_MM + s.widen * jmm, char: s.char * jmm }
}

/** Outline (part outside) or hole (part around it), sizes in mm on the plate; rect: w × h, circle: w = diameter. */
export interface Contour {
  shape: 'rect' | 'circle'
  cx: number
  cy: number
  w: number
  h: number
  hole: boolean
}

/** A chassis plate 100 × 70 mm: two 3 mm tab slots and a 20 mm wire hole. */
export const CHASSIS_PLATE: readonly Contour[] = [
  { shape: 'rect', cx: 0, cy: 0, w: 100, h: 70, hole: false },
  { shape: 'rect', cx: -30, cy: 15, w: 15, h: 3, hole: true },
  { shape: 'rect', cx: 30, cy: 15, w: 15, h: 3, hole: true },
  { shape: 'circle', cx: 0, cy: -10, w: 20, h: 20, hole: true },
]

/** Grow (d > 0) or shrink a contour by d on every side. */
export const grown = (c: Contour, d: number): Contour => ({ ...c, w: c.w + 2 * d, h: c.h + 2 * d })

/** Beam centre path offset by `comp` away from the part (out of outlines, into holes); the real edge sits k/2 nearer the part. */
export function cutContour(c: Contour, kerf: number, comp: number) {
  const away = c.hole ? -1 : 1
  return { beam: grown(c, away * comp), edge: grown(c, away * (comp - kerf / 2)) }
}

/** Points round a contour (mm), counter-clockwise from its right-hand middle; `n` for circles. */
export function contourPoints(c: Contour, n = 32): [number, number][] {
  if (c.shape === 'circle') return Array.from({ length: n + 1 }, (_, i) => [c.cx + (c.w / 2) * Math.cos((i / n) * 2 * Math.PI), c.cy + (c.w / 2) * Math.sin((i / n) * 2 * Math.PI)])
  const [x, y] = [c.w / 2, c.h / 2]
  return [[x, 0], [x, y], [-x, y], [-x, -y], [x, -y], [x, 0]].map(([a, b]) => [c.cx + a, c.cy + b])
}

export const FITS = {
  loose: 'loose: falls apart',
  slip: 'slip fit: slides in, needs glue',
  press: 'press fit: snug, holds',
  tight: 'too tight',
} as const
export type FitKey = keyof typeof FITS
/** Fit of a tab in a slot from the gap (mm, < 0 = interference); `tightMm` is how much squeeze the sheet takes. */
export function fitOf(gap: number, tightMm: number): FitKey {
  if (gap > 0.12) return 'loose'
  if (gap > 0.02) return 'slip'
  return gap >= tightMm ? 'press' : 'tight'
}

/** A `nominal` tab (outline cut) into an equal slot (hole cut): both off by the kerf, pulled back by the compensation. */
export function tabSlot(sk: SheetKey, powerPct: number, comp: number, nominal = 3) {
  const k = kerfOf(sk, powerPct)
  const tab = nominal - k.kerf + 2 * comp
  const slot = nominal + k.kerf - 2 * comp
  const gap = slot - tab
  return { ...k, tab, slot, gap, fit: fitOf(gap, SHEETS[sk].tightMm), ideal: k.kerf / 2 }
}

/** Kerf lesson: every contour of the chassis plate cut, plus the joint fit and how the outline and hole come out. */
export function kerfView(sk: SheetKey, powerPct: number, comp: number) {
  const j = tabSlot(sk, powerPct, comp)
  const cuts = CHASSIS_PLATE.map((c) => ({ design: c, ...cutContour(c, j.kerf, comp) }))
  return { ...j, cuts, outline: cuts[0].edge.w, hole: cuts[3].edge.w, gapAt: (c: number) => tabSlot(sk, powerPct, c).gap }
}

// --- Acrylic vs plywood: the same 3 mm plate as a cantilever motor mount ---

export const MOUNT = { L: 0.08, b: 0.06, plateW: 0.15, plateH: 0.1, sheetM2: 0.6 * 0.4 }
const HOLE_KT = 2.5
const NOTCH_Q = { acrylic: 0.9, plywood: 0.3 } as const
/** Hoop stress an over-tightened screw leaves round its hole, felt in proportion to notch sensitivity. */
const SCREW_PRE_PA = 20e6
export const HOLES = {
  plain: { name: 'Plain plate', kt: false, screw: false },
  hole: { name: 'Drilled screw hole', kt: true, screw: false },
  tight: { name: 'Screw over-tightened', kt: true, screw: true },
} as const
export type HoleKey = keyof typeof HOLES

/** Notch effect felt by the sheet: brittle acrylic feels nearly all of Kt, plywood fibres bridge round the hole. */
export const notchFactor = (sk: SheetKey) => 1 + NOTCH_Q[sk] * (HOLE_KT - 1)

/** Motor mount sticking out L past a standoff, load F at the tip; peak stress at the hole beside the standoff. */
export function mountTest(sk: SheetKey, F: number, hk: HoleKey, t = SHEET_T) {
  const m = MATERIALS[sk]
  const { L, b, plateW, plateH, sheetM2 } = MOUNT
  const I = rectI(b, t)
  const h = HOLES[hk]
  const kt = h.kt ? notchFactor(sk) : 1
  const sigma = bendingStress(F * L, t / 2, I)
  const pre = h.screw ? SCREW_PRE_PA * NOTCH_Q[sk] * kt : 0
  const peak = sigma * kt + pre
  const strength = strengthOf(m)
  const s = SHEETS[sk]
  const area = plateW * plateH
  const breakN = Math.max(0, (strength - pre) / (kt * bendingStress(L, t / 2, I)))
  return {
    m,
    sigma,
    kt,
    pre,
    peak,
    strength,
    sf: strength / peak,
    cracked: peak >= strength,
    delta: cantileverDeflection(F, L, m.E, I),
    kPerMm: beamStiffness(L, m.E, I) / 1000,
    breakN,
    breakSag: cantileverDeflection(breakN, L, m.E, I),
    grams: area * t * s.density * 1000,
    cost: (s.sheetCost * area) / sheetM2,
    /** Thickness for the stiffness of 3 mm plywood: t ∝ E^-1/3. */
    tSameStiff: t * Math.cbrt(MATERIALS.plywood.E / m.E),
  }
}

/** Both sheets at load F: the test plus the sag-vs-load curve up to `fMax` (cut short where it cracks). */
export function plateCompare(F: number, hk: HoleKey, fMax: number, steps = 60) {
  return (Object.keys(SHEETS) as SheetKey[]).map((sk) => {
    const now = mountTest(sk, F, hk)
    const curve = Array.from({ length: steps + 1 }, (_, i) => (fMax * i) / steps)
      .filter((f) => f <= now.breakN)
      .map((f) => [f, mountTest(sk, f, hk).delta] as const)
    return { sk, now, curve, kerf: kerfOf(sk, 70) }
  })
}
