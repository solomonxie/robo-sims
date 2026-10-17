// Stress & strain: Hooke's law, cantilever links, stress–strain curves, safety factor.
import { G } from '../common'

const MPA = 1e6
const GPA = 1e9

/** Brittle materials (ductile false) follow σ = utsPa·tanh(E·ε/utsPa) and snap at failStrain with no yield. */
export interface Material {
  name: string
  short: string
  E: number
  yieldPa: number
  utsPa: number
  failStrain: number
  ductile: boolean
}

export const MATERIALS = {
  al6061: { name: 'Aluminium 6061', short: 'Al 6061', E: 69 * GPA, yieldPa: 276 * MPA, utsPa: 310 * MPA, failStrain: 0.12, ductile: true },
  steel: { name: 'Mild steel', short: 'Steel', E: 200 * GPA, yieldPa: 250 * MPA, utsPa: 400 * MPA, failStrain: 0.22, ductile: true },
  petg: { name: 'PETG (printed)', short: 'PETG', E: 2.1 * GPA, yieldPa: 45 * MPA, utsPa: 50 * MPA, failStrain: 0.1, ductile: true },
  pla: { name: 'PLA (printed)', short: 'PLA', E: 3.5 * GPA, yieldPa: 52 * MPA, utsPa: 52 * MPA, failStrain: 0.03, ductile: false },
  acrylic: { name: 'Acrylic (PMMA)', short: 'Acrylic', E: 3.2 * GPA, yieldPa: 72 * MPA, utsPa: 72 * MPA, failStrain: 0.05, ductile: false },
  plywood: { name: 'Birch plywood', short: 'Plywood', E: 9 * GPA, yieldPa: 42 * MPA, utsPa: 42 * MPA, failStrain: 0.01, ductile: false },
} satisfies Record<string, Material>
export type MaterialKey = keyof typeof MATERIALS

const NECK_AT = 0.6
const NECK_DROP = 0.15

/** Engineering stress (Pa) at strain ε on a monotonic pull; 0 once broken. */
export function stressAt(m: Material, eps: number) {
  if (eps <= 0) return 0
  if (eps > m.failStrain) return 0
  if (!m.ductile) return m.utsPa * Math.tanh((m.E * eps) / m.utsPa)
  const ey = m.yieldPa / m.E
  if (eps <= ey) return m.E * eps
  const eu = NECK_AT * m.failStrain
  if (eps <= eu) {
    const s = (eps - ey) / (eu - ey)
    return m.yieldPa + (m.utsPa - m.yieldPa) * (1 - (1 - s) ** 2)
  }
  const s = (eps - eu) / (m.failStrain - eu)
  return m.utsPa * (1 - NECK_DROP * s * s)
}

/** Stress a part may safely carry: yield for ductile, the breaking stress for brittle. */
export const strengthOf = (m: Material) => (m.ductile ? m.yieldPa : stressAt(m, m.failStrain))
export const yieldStrain = (m: Material) => strengthOf(m) / m.E
export const neckStrain = (m: Material) => (m.ductile ? NECK_AT * m.failStrain : m.failStrain)

/** Strain left after loading to `peak` and letting go: unloads along slope E (brittle: none). */
export function permanentSet(m: Material, peak: number) {
  if (!m.ductile || peak <= m.yieldPa / m.E) return 0
  return Math.max(0, Math.min(peak, m.failStrain) - stressAt(m, Math.min(peak, m.failStrain)) / m.E)
}

/** Pull to `peak` strain then release: loading and unloading (ε, σ) paths. */
export function pullPath(m: Material, peak: number, steps = 80) {
  const broke = peak > m.failStrain
  const top = Math.min(peak, m.failStrain)
  const load = Array.from({ length: steps + 1 }, (_, i) => {
    const e = (top * i) / steps
    return [e, stressAt(m, e)] as const
  })
  const peakStress = stressAt(m, top)
  const set = broke ? 0 : permanentSet(m, top)
  const unload = broke ? [] : m.ductile ? [[top, peakStress] as const, [set, 0] as const] : load.slice().reverse()
  return { load, unload, broke, set, peakStress, top }
}

/** Where on the curve a pull to `peak` gets. */
export type Regime = 'elastic' | 'plastic' | 'necking' | 'broken'
export function regimeOf(m: Material, peak: number): Regime {
  if (peak > m.failStrain) return 'broken'
  if (peak <= yieldStrain(m) || !m.ductile) return 'elastic'
  return peak > neckStrain(m) ? 'necking' : 'plastic'
}

// --- Beams ---

/** Rectangle [centre x, centre y, width, height] in metres; y is the bending (vertical) axis. */
export type Rect = readonly [number, number, number, number]

export interface Section {
  name: string
  rects: readonly Rect[]
}
const tube = (o: number, t: number): Rect[] => [
  [0, o / 2 - t / 2, o, t],
  [0, -o / 2 + t / 2, o, t],
  [o / 2 - t / 2, 0, t, o - 2 * t],
  [-o / 2 + t / 2, 0, t, o - 2 * t],
]
/** Four links of about the same area (≈ 100 mm², so the same mass) but very different I. */
export const SECTIONS = {
  strip: { name: 'Flat strip 25 × 4 mm', rects: [[0, 0, 0.025, 0.004]] },
  solid: { name: 'Solid bar 10 × 10 mm', rects: [[0, 0, 0.01, 0.01]] },
  tube: { name: 'Square tube 20 mm', rects: tube(0.02, 0.00135) },
  ibeam: { name: 'I-beam 20 mm', rects: [[0, 0.00875, 0.016, 0.0025], [0, -0.00875, 0.016, 0.0025], [0, 0, 0.00125, 0.015]] },
} satisfies Record<string, Section>
export type SectionKey = keyof typeof SECTIONS

/** Area, second moment of area I about the horizontal centre line, and c = farthest fibre from it. */
export function sectionProps(rects: readonly Rect[]) {
  let area = 0
  let I = 0
  let c = 0
  for (const [, y, w, h] of rects) {
    area += w * h
    I += (w * h ** 3) / 12 + w * h * y * y
    c = Math.max(c, Math.abs(y) + h / 2)
  }
  return { area, I, c }
}
export const rectI = (b: number, t: number) => (b * t ** 3) / 12

const axialStress = (F: number, area: number) => F / area
export const bendingStress = (M: number, c: number, I: number) => (M * c) / I
/** Cantilever with an end load F: deflection at x from the root (x = L: the tip, F·L³/(3EI)). */
export const cantileverDeflection = (F: number, L: number, E: number, I: number, x = L) => (F * x * x * (3 * L - x)) / (6 * E * I)
/** Tip stiffness k = F/δ = 3EI/L³: the link acts as a spring. */
export const beamStiffness = (L: number, E: number, I: number) => (3 * E * I) / L ** 3

/** An end-loaded arm link: root stress and strain, tip deflection, and the deflection of every section in the same material. */
export function hookeView(mk: MaterialKey, sk: SectionKey, F: number, L: number) {
  const m = MATERIALS[mk]
  const { area, I, c } = sectionProps(SECTIONS[sk].rects)
  const sigma = bendingStress(F * L, c, I)
  const strength = strengthOf(m)
  return {
    m,
    area,
    I,
    c,
    sigma,
    eps: sigma / m.E,
    pull: axialStress(F, area),
    delta: cantileverDeflection(F, L, m.E, I),
    k: beamStiffness(L, m.E, I),
    strength,
    elastic: sigma < strength,
    tips: (Object.keys(SECTIONS) as SectionKey[]).map((key) => cantileverDeflection(F, L, m.E, sectionProps(SECTIONS[key].rects).I)),
  }
}

// --- Safety factor ---

/** A mass dropped `h` onto an elastic beam that sags δst under it statically: peak force = weight × (1 + √(1 + 2h/δst)). */
export const impactFactor = (h: number, deltaStatic: number) => 1 + Math.sqrt(1 + (2 * h) / deltaStatic)

export const LOAD_CASES = {
  hold: { name: 'Holding still', accel: 0, drop: 0 },
  swing: { name: 'Fast swing, 15 m/s²', accel: 15, drop: 0 },
  bump: { name: 'Payload drops 10 mm', accel: 0, drop: 0.01 },
} as const
type LoadCase = keyof typeof LOAD_CASES

export const BRACKET = { L: 0.15, b: 0.02 }

/** Rectangular arm link b wide, t thick, L long, payload kg at the tip, worst case `lc`. */
export function bracketLoad(mk: MaterialKey, t: number, kg: number, lc: LoadCase, { L, b } = BRACKET) {
  const m = MATERIALS[mk]
  const I = rectI(b, t)
  const weight = kg * G
  const { accel, drop } = LOAD_CASES[lc]
  const deltaStatic = cantileverDeflection(weight, L, m.E, I)
  const factor = drop > 0 ? impactFactor(drop, deltaStatic) : 1 + accel / G
  const F = weight * factor
  const sigma = bendingStress(F * L, t / 2, I)
  const strength = strengthOf(m)
  return { m, I, weight, factor, F, sigma, strength, sf: strength / sigma, deltaStatic, delta: deltaStatic * factor }
}

/** Thinnest t (m) that reaches `sf`, by bisection (SF grows with t). */
export function thicknessFor(mk: MaterialKey, kg: number, lc: LoadCase, sf: number, lo = 2e-4, hi = 0.1) {
  if (bracketLoad(mk, hi, kg, lc).sf < sf) return Infinity
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (bracketLoad(mk, mid, kg, lc).sf >= sf) hi = mid
    else lo = mid
  }
  return hi
}

export const SF_BAND = [2, 3] as const
export const sfVerdict = (sf: number) => (sf < 1 ? 'breaks' : sf < SF_BAND[0] ? 'too thin' : sf <= SF_BAND[1] ? 'just right' : 'heavy')
