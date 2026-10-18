// Design for printing: slice a 2D section into layers, find what hangs or bridges, droop and sag (typical values);
// orientation vs layer strength, pin-in-hole fits, hole shapes, edge profiles.
import { DEG, clamp01 } from '../common'
import { facetedHoleMm, segmentsFor } from '../materials/cad'
import { MATERIALS, bendingStress, rectI } from '../materials/stress'
import { PROBE_Z } from './adhesion'
import { LINE_W } from './fdm'
import { footParts } from './problems'
import { cuspOf } from './slicing'

export type PtMm = readonly [number, number]
export type Ring = readonly PtMm[]

/** Inside intervals of a horizontal line at y through closed rings (even-odd, so a ring inside another is a hole). */
export function scanSpans(rings: readonly Ring[], y: number): [number, number][] {
  const xs: number[] = []
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i]
      const [x1, y1] = r[(i + 1) % r.length]
      if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
    }
  xs.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]])
  return out
}

export type SegKindDfp = 'solid' | 'hang' | 'bridge'
export interface SliceSpan {
  x0: number
  x1: number
  kind: SegKindDfp
  /** Downward droop or sag of this segment, mm (typical). */
  droop: number
}
export interface SliceLayer {
  y0: number
  h: number
  segs: SliceSpan[]
}
export interface PrintOpts {
  h: number
  fan?: number
  speed?: number
  lineW?: number
}

/** Share of the bead that may hang past the layer below before it curls down: more with the part fan on. */
export const hangLimit = (fan: number) => 0.35 + 0.4 * clamp01(fan)
/** Steepest overhang (degrees from vertical) that prints clean for a layer height and fan. */
export const cleanAngle = (h: number, fan: number, w = LINE_W) => Math.atan((hangLimit(fan) * w) / h) / DEG
/** Edge droop of one layer hanging `hangMm` past the one below (mm, typical). */
export const layerDroop = (hangMm: number, h: number, fan: number, w = LINE_W) => 3 * h * Math.max(0, Math.min(3, hangMm / w) - hangLimit(fan)) ** 1.5
/** Mid-span sag of a bridge `L` mm long (typical): grows with L², less with fan, least near 25 mm/s. */
export const bridgeSag = (L: number, fan: number, speed: number) => 4e-4 * L * L * (1.3 - clamp01(fan)) * (1 + ((speed - 25) / 50) ** 2)
const CARRY = 0.7

/** Slice `rings` into layers of `h`, scanned at mid-layer; each span split into what sits on the layer below,
 *  what hangs off one side and what bridges between two supports. Droop carries up 70 % to the next hanging layer. */
export function printSlices(rings: readonly Ring[], { h, fan = 1, speed = 30, lineW = LINE_W }: PrintOpts, top?: number): SliceLayer[] {
  const yMax = top ?? Math.max(...rings.flatMap((r) => r.map((p) => p[1])))
  const out: SliceLayer[] = []
  let below: [number, number][] = []
  let prev: SliceSpan[] = []
  for (let y0 = 0; y0 + h / 2 < yMax; y0 += h) {
    const spans = scanSpans(rings, y0 + h / 2)
    const segs: SliceSpan[] = []
    for (const [a, b] of spans) {
      if (out.length === 0) {
        segs.push({ x0: a, x1: b, kind: 'solid', droop: 0 })
        continue
      }
      const cuts = below.map(([c, d]) => [Math.max(a, c), Math.min(b, d)] as const).filter(([c, d]) => d > c)
      let x = a
      const free: [number, number, boolean, boolean][] = []
      for (const [c, d] of cuts) {
        if (c > x) free.push([x, c, x > a, true])
        segs.push({ x0: c, x1: d, kind: 'solid', droop: 0 })
        x = d
      }
      if (x < b) free.push([x, b, cuts.length > 0, false])
      for (const [c, d, left, right] of free) {
        const near = prev.filter((s) => s.kind !== 'solid' && s.x1 > c - 3 * lineW && s.x0 < d + 3 * lineW)
        const carried = CARRY * Math.max(0, ...near.map((s) => s.droop))
        const bridge = left && right
        const own = bridge ? bridgeSag(d - c, fan, speed) : cuts.length === 0 ? h * 4 : layerDroop(d - c, h, fan, lineW)
        segs.push({ x0: c, x1: d, kind: bridge ? 'bridge' : 'hang', droop: bridge ? own : own + carried })
      }
    }
    segs.sort((p, q) => p.x0 - q.x0)
    out.push({ y0, h, segs })
    below = spans
    prev = segs
  }
  return out
}

export const worstDroop = (L: readonly SliceLayer[], kind?: SegKindDfp) =>
  Math.max(0, ...L.flatMap((l) => l.segs.filter((s) => (kind ? s.kind === kind : s.kind !== 'solid')).map((s) => s.droop)))
/** Overhang area that needs support (droop over `okMm`), mm per mm of depth, and its support volume per mm of depth. */
export function supportNeed(L: readonly SliceLayer[], okMm = 0.5) {
  let width = 0
  let area = 0
  for (const l of L) for (const s of l.segs) if (s.kind === 'hang' && s.droop > okMm) [width, area] = [width + (s.x1 - s.x0), area + (s.x1 - s.x0) * l.y0]
  return { width, area }
}

const range = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
export const rectRing = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
export const circleRing = (cx: number, cy: number, r: number, n = 48): Ring => range(0, 1, n + 1).slice(0, n).map((u) => [cx + r * Math.cos(u * 2 * Math.PI), cy + r * Math.sin(u * 2 * Math.PI)] as PtMm)

// --- Overhangs and bridges: a wedge leaning out at an angle, and a deck between two posts. ---

export const OVERHANG = { baseMm: 6, heightMm: 10 }
export const overhangRing = (deg: number, { baseMm, heightMm } = OVERHANG): Ring => {
  const lean = heightMm * Math.tan(Math.min(85, deg) * DEG)
  return [[0, 0], [baseMm, 0], [baseMm + lean, heightMm], [lean, heightMm]].map(([x, y]) => [x, y] as PtMm)
}
export const BRIDGE_TEST = { postMm: 6, heightMm: 10, deckMm: 2 }
export const bridgeRings = (L: number, { postMm, heightMm, deckMm } = BRIDGE_TEST): Ring[] => [
  [[0, 0], [postMm, 0], [postMm, heightMm], [postMm + L, heightMm], [postMm + L, 0], [2 * postMm + L, 0], [2 * postMm + L, heightMm + deckMm], [0, heightMm + deckMm]],
]
export const OVERHANG_SWEEP = range(0, 80, 17)

export function overhangView(deg: number, h: number, fan: number, L: number, speed: number) {
  const opts = { h, fan, speed }
  const wedge = printSlices([overhangRing(deg)], opts)
  const deck = printSlices(bridgeRings(L), opts)
  return {
    wedge,
    deck,
    hangMm: h * Math.tan(Math.min(85, deg) * DEG),
    share: (h * Math.tan(Math.min(85, deg) * DEG)) / LINE_W,
    clean: cleanAngle(h, fan),
    droop: worstDroop(wedge),
    sag: worstDroop(deck, 'bridge'),
    curve: OVERHANG_SWEEP.map((a) => worstDroop(printSlices([overhangRing(a)], opts))),
  }
}

// --- Orientation: an L bracket, load at the tip of the upright, in four print orientations. ---

export const BRACKET_L = { base: 30, up: 40, b: 20, t: 4, zFrac: 0.5, flowMm3s: 8, layerS: 2.5, supportFill: 0.15 }
export const ORIENTS = {
  flat: { name: 'Flat on its base', deg: 0, loadDeg: 90, finish: 0.9 },
  upright: { name: 'Standing on its end', deg: 180, loadDeg: 90, finish: 0.5 },
  side: { name: 'On its side', deg: 0, loadDeg: 0, finish: 0.8 },
  corner: { name: 'On the corner, 45°', deg: 45, loadDeg: 45, finish: 0.6 },
} as const
export type OrientKey = keyof typeof ORIENTS
/** Hankinson: strength with the load `deg` off the layer plane, 1 in-plane, `zFrac` straight across the layers. */
export const layerStrength = (deg: number, zFrac = BRACKET_L.zFrac) => {
  const s = Math.sin(deg * DEG) ** 2
  return zFrac / (zFrac * (1 - s) + s)
}
export const LOAD_SWEEP = range(0, 90, 19)

const L_PROFILE = ({ base, up, t } = BRACKET_L): PtMm[] => [[0, 0], [base, 0], [base, t], [t, t], [t, up], [0, up]]
const turn = (deg: number, [x, y]: PtMm): PtMm => [x * Math.cos(deg * DEG) - y * Math.sin(deg * DEG), x * Math.sin(deg * DEG) + y * Math.cos(deg * DEG)]
const bedShift = (deg: number) => {
  const r = L_PROFILE().map((p) => turn(deg, p))
  return [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1]))] as const
}
/** Bracket point (u along the base, v up the upright) in print coordinates, turned `deg` about the corner and dropped onto the bed. */
export function bracketPoint(deg: number, p: PtMm): PtMm {
  const [x, y] = turn(deg, p)
  const [mx, my] = bedShift(deg)
  return [x - mx, y - my]
}
export const bracketRing = (deg: number): Ring => L_PROFILE().map((p) => bracketPoint(deg, p))
/** Bending moment at a print point, share of the corner moment: falls to 0 at the loaded tip and at the base screw. */
export function bracketMoment(deg: number, p: PtMm, { base, up, t } = BRACKET_L) {
  const [mx, my] = bedShift(deg)
  const [u, v] = turn(-deg, [p[0] + mx, p[1] + my])
  return v > t ? clamp01((up - v) / (up - t)) : clamp01(1 - (u - t) / (base - t - 5))
}

export function orientOne(o: OrientKey, loadN: number, h = 0.2) {
  const B = BRACKET_L
  const O = ORIENTS[o]
  const ring = bracketRing(O.deg)
  const height = o === 'side' ? B.b : Math.max(...ring.map((p) => p[1]))
  const sl = o === 'side' ? [] : printSlices([ring], { h })
  const sup = supportNeed(sl)
  const sigma = bendingStress(loadN * (B.up / 1000), B.t / 2000, rectI(B.b / 1000, B.t / 1000))
  const strength = MATERIALS.pla.utsPa * layerStrength(O.loadDeg)
  const volume = (B.base + B.up - B.t) * B.t * B.b
  const supportMm3 = sup.area * B.b * B.supportFill
  const timeMin = (volume / B.flowMm3s + supportMm3 / (2 * B.flowMm3s) + (height / h) * B.layerS) / 60
  return { o, ring, height, sl, supportMm3, sigma, strength, sf: strength / sigma, timeMin, finish: O.finish, loadDeg: O.loadDeg }
}

export function orientView(o: OrientKey, loadN: number) {
  const all = (Object.keys(ORIENTS) as OrientKey[]).map((k) => orientOne(k, loadN))
  const maxSup = Math.max(1, ...all.map((a) => a.supportMm3))
  const fastest = Math.min(...all.map((a) => a.timeMin))
  const scores = all.map((a) => 0.45 * clamp01(a.sf / 2) + 0.2 * (1 - a.supportMm3 / maxSup) + 0.2 * a.finish + 0.15 * (fastest / a.timeMin))
  const best = scores.indexOf(Math.max(...scores))
  return { cur: all.find((a) => a.o === o)!, all, scores, best: all[best].o, curve: LOAD_SWEEP.map((d) => layerStrength(d)) }
}

// --- Tolerances and fits: a pin in a hole, diametral clearance in CAD vs what prints. ---

export const FIT = { pinMm: 8, pinGrowMm: 0.05, gauge: [0, 0.1, 0.2, 0.3, 0.4, 0.5] }
export const FIT_CLASSES = {
  stuck: 'Will not go in',
  press: 'Press fit: vise or mallet',
  snug: 'Snug: push by hand, no play',
  slide: 'Slide: turns freely',
  loose: 'Loose: wobbles',
} as const
export type FitClass = keyof typeof FIT_CLASSES
export const fitClass = (gap: number): FitClass => (gap < -0.15 ? 'stuck' : gap < 0 ? 'press' : gap < 0.1 ? 'snug' : gap <= 0.3 ? 'slide' : 'loose')
/** Elephant foot per side at a slightly low Z offset on a warm PLA bed (Print problems > Elephant foot), mm. */
export const footBulge = (chamfer = 0) => footParts({ mat: 'pla', zOffset: PROBE_Z.trueMm - 0.05, bedC: 65, chamfer }).left
export const FOOT_FIXES = { none: 'No fix', chamfer: '0.5 mm chamfer at the hole mouth', comp: 'Slicer elephant-foot compensation' } as const
export type FootFix = keyof typeof FOOT_FIXES
export const CLEAR_SWEEP = range(0, 0.6, 25)

export function fitView(clearMm: number, shrinkMm: number, fix: FootFix) {
  const gapOf = (c: number) => c - shrinkMm - FIT.pinGrowMm
  const gap = gapOf(clearMm)
  const foot = fix === 'none' ? footBulge() : fix === 'chamfer' ? footBulge(0.5) : 0
  const mouth = gap - 2 * foot
  const slideCad = 0.2 + shrinkMm + FIT.pinGrowMm
  return {
    gap,
    foot,
    mouth,
    fit: fitClass(gap),
    entry: fitClass(mouth),
    slideCad,
    gauge: FIT.gauge.map((c) => ({ cad: c, gap: gapOf(c), fit: fitClass(gapOf(c)) })),
    curve: CLEAR_SWEEP.map(gapOf),
  }
}

// --- Holes and teardrops: a horizontal hole through a printed plate, and a vertical one from facets and squish. ---

export const HOLE_SHAPES = { round: 'Round', teardrop: 'Teardrop', flat: 'Teardrop, flat top', diamond: 'Diamond' } as const
export type HoleShape = keyof typeof HOLE_SHAPES
export const HOLE = { plateW: 26, below: 5, above: 5, squishMm: 0.1, stlTol: 0.05, stlDeg: 15, fan: 1, speed: 30 }

/** Hole outline centred at (cx, cy); teardrop tip and diamond at 45°, flat top cut at the circle's top. */
export function holeRing(shape: HoleShape, d: number, cx: number, cy: number, n = 48): Ring {
  const r = d / 2
  if (shape === 'round') return circleRing(cx, cy, r, n)
  if (shape === 'diamond') return [[cx + r * Math.SQRT2, cy], [cx, cy + r * Math.SQRT2], [cx - r * Math.SQRT2, cy], [cx, cy - r * Math.SQRT2]]
  const arc = range(Math.PI * 0.75, Math.PI * 2.25, n).map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as PtMm)
  if (shape === 'teardrop') return [...arc, [cx, cy + r * Math.SQRT2]]
  const w = r * (Math.SQRT2 - 1)
  return [...arc, [cx + w, cy + r], [cx - w, cy + r]]
}
export const HOLE_SWEEP = range(3, 16, 14)
export const holeTop = (shape: HoleShape, d: number) => (shape === 'round' || shape === 'flat' ? d / 2 : (d / 2) * Math.SQRT2)

export function holeSlices(shape: HoleShape, d: number, h: number) {
  const top = holeTop(shape, d)
  const cy = HOLE.below + d / 2
  const H = cy + top + HOLE.above
  const rings = [rectRing(0, 0, HOLE.plateW, H), holeRing(shape, d, HOLE.plateW / 2, cy)]
  return { rings, cy, H, layers: printSlices(rings, { h, fan: HOLE.fan, speed: HOLE.speed }) }
}

export function holeView(shape: HoleShape, d: number, h: number) {
  const s = holeSlices(shape, d, h)
  const roof = worstDroop(s.layers)
  const n = segmentsFor(d / 2, HOLE.stlTol, HOLE.stlDeg)
  const vertical = facetedHoleMm(d, n) - 2 * HOLE.squishMm
  return {
    ...s,
    roof,
    heightMm: holeTop(shape, d) + d / 2 - roof,
    n,
    vertical,
    curve: HOLE_SWEEP.map((x) => worstDroop(holeSlices(shape, x, h).layers)),
  }
}

// --- Chamfers vs fillets: an L section with a bed edge, a top edge and an inside corner. ---

export const EDGE_KINDS = { square: 'Square', chamfer: 'Chamfer 45°', fillet: 'Fillet' } as const
export type EdgeKind = keyof typeof EDGE_KINDS
export const EDGE_PART = { W: 30, base: 10, t: 8, H: 24, ktMax: 3, fan: 1 }

/** Replaces the 90° corner P (edge in along unit a, out along unit b) with a chamfer or a fillet of size s. */
export function cornerPts(P: PtMm, a: PtMm, b: PtMm, kind: EdgeKind, s: number, n = 10): PtMm[] {
  if (kind === 'square' || s <= 0) return [P]
  const T1: PtMm = [P[0] - s * a[0], P[1] - s * a[1]]
  const T2: PtMm = [P[0] + s * b[0], P[1] + s * b[1]]
  if (kind === 'chamfer') return [T1, T2]
  const C: PtMm = [T1[0] + T2[0] - P[0], T1[1] + T2[1] - P[1]]
  return range(0, 1, n + 1).map((u) => {
    const [c, si] = [Math.cos((u * Math.PI) / 2), Math.sin((u * Math.PI) / 2)]
    return [C[0] + c * (T1[0] - C[0]) + si * (T2[0] - C[0]), C[1] + c * (T1[1] - C[1]) + si * (T2[1] - C[1])] as PtMm
  })
}

export function edgeRing(bottom: EdgeKind, top: EdgeKind, inside: EdgeKind, s: number, { W, base, t, H } = EDGE_PART): Ring {
  return [
    ...cornerPts([0, 0], [0, -1], [1, 0], bottom, s),
    [W, 0],
    [W, H],
    [W - t, H],
    ...cornerPts([W - t, base], [0, -1], [-1, 0], inside, s),
    ...cornerPts([0, base], [-1, 0], [0, -1], top, s),
  ]
}
/** Stress raise at an inside corner of a wall `t` thick (typical): sharp → ktMax; a chamfer acts like a fillet of 0.3 × its size. */
export const cornerKt = (kind: EdgeKind, s: number, t = EDGE_PART.t) => {
  const r = kind === 'fillet' ? s : kind === 'chamfer' ? 0.3 * s : 0
  return r <= 0 ? EDGE_PART.ktMax : Math.min(EDGE_PART.ktMax, 1 + 0.6 * Math.sqrt(t / r))
}
export const EDGE_SWEEP = range(0, 4, 17)
const bedDroop = (kind: EdgeKind, s: number, h: number) => {
  const L = printSlices([edgeRing(kind, 'square', 'square', s)], { h, fan: EDGE_PART.fan }, EDGE_PART.base)
  return worstDroop(L)
}

export function edgeView(bottom: EdgeKind, top: EdgeKind, inside: EdgeKind, s: number, h: number) {
  const layers = printSlices([edgeRing(bottom, top, inside, s)], { h, fan: EDGE_PART.fan })
  const bottomLayers = layers.filter((l) => l.y0 < EDGE_PART.base)
  return {
    layers,
    droop: worstDroop(bottomLayers),
    foot: footBulge(bottom === 'chamfer' ? s : bottom === 'fillet' ? Math.min(s, 0.2) : 0),
    cusp: top === 'square' || s <= 0 ? 0 : top === 'chamfer' ? cuspOf(h, 1) : h,
    kt: cornerKt(inside, s),
    curves: { fillet: EDGE_SWEEP.map((x) => bedDroop('fillet', x, h)), chamfer: EDGE_SWEEP.map((x) => bedDroop('chamfer', x, h)) },
  }
}
