// Slicing a wheel hub: STL vs 3MF, adaptive layer height, walls, infill patterns, supports, seams (typical values).
import { DEG, TAU, parkMiller } from '../common'
import { stlBytes } from '../materials/cad'
import { LINE_W } from './fdm'
import { LAYER_OVERHEAD_S, PathSeg, SOLID_LAYERS } from './layers'

/** Wheel hub, mm: flange, chamfer, boss, domed cap, through bore for a 5 mm shaft. */
export const HUB = { flangeR: 22, flangeH: 4, chamferR: 16, bossR: 10, bossH: 8, domeH: 6, boreR: 2.5, squareR: 13 }
export const PLA_G_MM3 = 1.24e-3
export type HubForm = 'round' | 'square'

export interface HubShape {
  h: number
  boreR: number
  /** Outer radius at height z (0 outside the part). */
  rAt: (z: number) => number
  /** Closed (r, z) outline, outside surface bottom → top, then down the bore. */
  profile: [number, number][]
}

export function hubShape(chamferDeg = 45, flipped = false, form: HubForm = 'round'): HubShape {
  const H = HUB
  if (form === 'square') {
    const h = 20
    return { h, boreR: H.boreR, rAt: (z) => (z < 0 || z > h ? 0 : H.squareR), profile: [[H.boreR, 0], [H.squareR, 0], [H.squareR, h], [H.boreR, h], [H.boreR, 0]] }
  }
  const dh = chamferDeg >= 89.9 ? 0 : (H.chamferR - H.bossR) / Math.tan(chamferDeg * DEG)
  const z1 = H.flangeH
  const z2 = z1 + dh
  const z3 = z2 + H.bossH
  const top = z3 + H.domeH
  const Rs = (H.bossR ** 2 + H.domeH ** 2) / (2 * H.domeH)
  const dome = (z: number) => Math.sqrt(Math.max(0, Rs * Rs - (z - (top - Rs)) ** 2))
  const up = (z: number) => (z < 0 || z > top ? 0 : z < z1 ? H.flangeR : z < z2 ? H.chamferR - ((H.chamferR - H.bossR) * (z - z1)) / dh : z < z3 ? H.bossR : dome(z))
  const zBore = top - Rs + Math.sqrt(Rs * Rs - H.boreR ** 2)
  const out: [number, number][] = [[H.boreR, 0], [H.flangeR, 0], [H.flangeR, z1], [H.chamferR, z1], [H.bossR, z2], [H.bossR, z3]]
  for (let i = 1; i <= 10; i++) {
    const z = z3 + ((zBore - z3) * i) / 10
    out.push([dome(z), z])
  }
  out.push([H.boreR, zBore], [H.boreR, 0])
  if (!flipped) return { h: top, boreR: H.boreR, rAt: up, profile: out }
  const flip = out.map(([r, z]): [number, number] => [r, Math.max(0, top - z)]).reverse()
  return { h: top, boreR: H.boreR, rAt: (z) => (z <= 0 || z > top ? 0 : up(top - z)), profile: flip }
}

/** Steepest outline slope |dr/dz| between z0 and z1 (sampled). */
function slopeIn(s: HubShape, z0: number, z1: number) {
  let m = 0
  const n = 6
  for (let i = 0; i < n; i++) {
    const a = z0 + ((z1 - z0) * i) / n
    const b = z0 + ((z1 - z0) * (i + 1)) / n
    const ra = s.rAt(Math.min(a + 1e-6, s.h))
    const rb = s.rAt(Math.min(b, s.h - 1e-6))
    if (ra > 0 && rb > 0) m = Math.max(m, Math.abs(rb - ra) / (b - a))
  }
  return Math.min(m, 50)
}

/** Stair step (cusp) left by a layer `h` thick where the wall leans `slope` = dr/dz: h·sin(lean). */
export const cuspOf = (h: number, slope: number) => (h * slope) / Math.hypot(1, slope)

/** Layer heights bottom → top: fixed, or adaptive (thick on vertical walls, thin where the outline leans) within [hMin, hMax]. */
export function layerHeights(s: HubShape, hMax: number, adaptive: boolean, cusp = 0.05, hMin = 0.08) {
  const out: number[] = []
  let z = 0
  while (z < s.h - 1e-6 && out.length < 2000) {
    let h = hMax
    if (adaptive) {
      for (let k = 0; k < 4; k++) {
        const sl = slopeIn(s, z, Math.min(s.h, z + h))
        const lean = sl / Math.hypot(1, sl)
        h = Math.min(hMax, Math.max(hMin, lean > 1e-6 ? cusp / lean : hMax))
      }
    }
    const left = s.h - z
    if (left < h + hMin) h = left > hMax ? left / 2 : left
    out.push(h)
    z += h
  }
  return out
}

export const INFILL_PATTERNS = {
  lines: { name: 'Lines', speed: 1, k: [0.3, 0.3, 0.1], e: [1, 1, 1.5] },
  grid: { name: 'Grid', speed: 0.92, k: [0.3, 0.3, 0.5], e: [1, 1, 1] },
  cubic: { name: 'Cubic', speed: 0.95, k: [0.3, 0.3, 0.3], e: [1.1, 1.1, 1.1] },
  gyroid: { name: 'Gyroid', speed: 0.8, k: [0.32, 0.32, 0.32], e: [1.15, 1.15, 1.15] },
  honeycomb: { name: 'Honeycomb', speed: 0.7, k: [0.15, 0.15, 0.6], e: [1.6, 1.6, 1] },
}
export type InfillPattern = keyof typeof INFILL_PATTERNS
/** Infill stiffness along X, Y, Z relative to solid plastic (typical): k·density^e, solid at 100 %. */
export const infillStiffness = (p: InfillPattern, d: number) => {
  const P = INFILL_PATTERNS[p]
  const x = Math.min(1, Math.max(0, d))
  return P.k.map((k, i) => k * x ** P.e[i] + (1 - k) * x ** 8)
}

export interface SliceSpec {
  layerH?: number
  heights?: readonly number[]
  walls: number
  infill: number
  pattern?: InfillPattern
  speed?: number
  lineW?: number
}

export interface HubLayer {
  z: number
  h: number
  rOut: number
  rIn: number
  /** Outer edge of the sparse infill (inside it, skin out to the walls). */
  rCore: number
  walls: number
  len: number
  time: number
}

const ringLen = (form: HubForm, r: number) => (form === 'square' ? 8 * r : TAU * r)
const discArea = (form: HubForm, r: number) => (r <= 0 ? 0 : form === 'square' ? 4 * r * r : Math.PI * r * r)

/** How many walls fit in a ring rIn…rOut, and the leftover band. */
export function wallsFit(rOut: number, rIn: number, walls: number, lineW = LINE_W) {
  let m = 0
  while (m < walls && rOut - rIn - 2 * (m + 1) * lineW >= -0.5 * lineW) m++
  const band = rOut - rIn - 2 * m * lineW
  return { m, band, gap: band > 0.15 * lineW && band < 1.5 * lineW }
}

export function sliceHub(s: HubShape, spec: SliceSpec, form: HubForm = 'round') {
  const w = spec.lineW ?? LINE_W
  const P = INFILL_PATTERNS[spec.pattern ?? 'grid']
  const speed = spec.speed ?? 60
  const hs = spec.heights ?? layerHeights(s, spec.layerH ?? 0.2, false)
  const zs: number[] = []
  let zAt = 0
  for (const h of hs) {
    zs.push(zAt)
    zAt += h
  }
  const rs = zs.map((z, i) => s.rAt(z + hs[i] / 2))
  const layers: HubLayer[] = rs.map((rOut, i) => {
    const rIn = s.boreR
    const f = wallsFit(rOut, rIn, spec.walls, w)
    let len = 0
    for (let k = 0; k < f.m; k++) len += ringLen(form, rOut - (k + 0.5) * w) + ringLen('round', rIn + (k + 0.5) * w)
    let rc = rIn + f.m * w
    if (f.gap) len += ringLen(form, (rOut + rIn) / 2)
    else if (f.band > 0) {
      let cover = rOut
      for (let j = i - SOLID_LAYERS; j <= i + SOLID_LAYERS; j++) cover = Math.min(cover, rs[j] ?? 0)
      rc = Math.max(rIn + f.m * w, cover - f.m * w)
      const sparse = discArea(form, rc) - discArea('round', rIn + f.m * w)
      const skin = discArea(form, rOut - f.m * w) - discArea(form, rc)
      len += skin / w + (sparse * (spec.infill >= 0.99 ? 1 : spec.infill)) / w / P.speed
    }
    return { z: zs[i], h: hs[i], rOut, rIn, rCore: rc, walls: f.m, len, time: len / speed + LAYER_OVERHEAD_S }
  })
  const total = layers.reduce((a, l) => a + l.time, 0)
  const mm3 = layers.reduce((a, l) => a + l.len * w * l.h, 0)
  return { layers, total, mm3, grams: mm3 * PLA_G_MM3 }
}

/** Worst stair step on the outside of the sliced part; flat shelves (outline jumps) print exactly and are skipped. */
export function worstCusp(s: HubShape, hs: readonly number[]) {
  let z = 0
  let worst = 0
  for (const h of hs) {
    const m = z + h / 2
    const lean = Math.abs(s.rAt(Math.min(s.h - 1e-6, m + 0.01)) - s.rAt(Math.max(1e-6, m - 0.01))) / 0.02
    if (lean < 20) worst = Math.max(worst, cuspOf(h, lean))
    z += h
  }
  return worst
}

/** Layer bond (typical): full squish up to 50 % of the nozzle, falling to ~60 % at a full nozzle width. */
export const layerBond = (h: number, nozzle: number) => Math.max(0.4, Math.min(1, 1 - 0.8 * (h / nozzle - 0.5)))

export function layerHeightView(mode: 'fixed' | 'adaptive', hMax: number, nozzle: number, speed = 60) {
  const s = hubShape()
  const hs = layerHeights(s, hMax, mode === 'adaptive')
  const sl = sliceHub(s, { heights: hs, walls: 3, infill: 0.2, speed })
  const fixedFine = sliceHub(s, { layerH: 0.08, walls: 3, infill: 0.2, speed })
  return {
    shape: s,
    heights: hs,
    slice: sl,
    cusp: worstCusp(s, hs),
    minH: Math.min(...hs),
    bond: layerBond(hMax, nozzle),
    tooThick: hMax > 0.75 * nozzle + 1e-9,
    fineTime: fixedFine.total,
  }
}

export type SegKind = 'outer' | 'inner' | 'gap' | 'skin' | 'infill'
export interface SliceSeg extends PathSeg {
  kind: SegKind
  w: number
}

/** Chord intervals of a line (offset c, direction angle a) inside the ring r0…r1. */
function lineInRing(c: number, a: number, r0: number, r1: number, form: HubForm): [number, number][] {
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const cx = -uy * c
  const cy = ux * c
  let t0 = -Infinity
  let t1 = Infinity
  if (form === 'square') {
    for (const [p, u] of [[cx, ux], [cy, uy]]) {
      if (Math.abs(u) < 1e-9) {
        if (Math.abs(p) > r1) return []
        continue
      }
      const lo = (-r1 - p) / u
      const hi = (r1 - p) / u
      t0 = Math.max(t0, Math.min(lo, hi))
      t1 = Math.min(t1, Math.max(lo, hi))
    }
  } else {
    if (Math.abs(c) >= r1) return []
    const h = Math.sqrt(r1 * r1 - c * c)
    t0 = -h
    t1 = h
  }
  if (t1 <= t0) return []
  if (Math.abs(c) >= r0) return [[t0, t1]]
  const g = Math.sqrt(r0 * r0 - c * c)
  return [[t0, -g], [g, t1]].filter(([p, q]) => q - p > 0.05) as [number, number][]
}

function linesFill(out: SliceSeg[], kind: SegKind, a: number, gap: number, shift: number, r0: number, r1: number, form: HubForm, w: number) {
  const span = form === 'square' ? r1 * Math.SQRT2 : r1
  let flip = false
  const start = -span + ((((shift % gap) + gap) % gap) || gap / 2)
  for (let c = start; c < span; c += gap) {
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    for (const [p, q] of lineInRing(c, a, r0, r1, form)) {
      const A: [number, number] = [-uy * c + ux * p, ux * c + uy * p]
      const B: [number, number] = [-uy * c + ux * q, ux * c + uy * q]
      out.push(flip ? { a: B, b: A, wall: false, kind, w } : { a: A, b: B, wall: false, kind, w })
    }
    flip = !flip
  }
}

const inRing = (x: number, y: number, r0: number, r1: number, form: HubForm) => {
  const r = Math.hypot(x, y)
  return r > r0 && (form === 'square' ? Math.max(Math.abs(x), Math.abs(y)) < r1 : r < r1)
}

/** Polyline clipped to the ring by short pieces. */
function polyFill(out: SliceSeg[], pts: [number, number][], r0: number, r1: number, form: HubForm, w: number) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.2))
    for (let j = 0; j < n; j++) {
      const p: [number, number] = [ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]
      const q: [number, number] = [ax + ((bx - ax) * (j + 1)) / n, ay + ((by - ay) * (j + 1)) / n]
      if (inRing((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, r0, r1, form) && inRing(p[0], p[1], r0 - 0.3, r1 + 0.3, form) && inRing(q[0], q[1], r0 - 0.3, r1 + 0.3, form)) out.push({ a: p, b: q, wall: false, kind: 'infill', w })
    }
  }
}

function sparseFill(out: SliceSeg[], pattern: InfillPattern, d: number, z: number, index: number, r0: number, r1: number, form: HubForm, w: number) {
  if (d <= 0 || r1 - r0 < w) return
  if (d >= 0.99) return linesFill(out, 'infill', index % 2 ? -Math.PI / 4 : Math.PI / 4, w, 0, r0, r1, form, w)
  const R = form === 'square' ? r1 * Math.SQRT2 : r1
  if (pattern === 'lines') linesFill(out, 'infill', index % 2 ? -Math.PI / 4 : Math.PI / 4, w / d, 0, r0, r1, form, w)
  else if (pattern === 'grid') for (const a of [Math.PI / 4, -Math.PI / 4]) linesFill(out, 'infill', a, (2 * w) / d, 0, r0, r1, form, w)
  else if (pattern === 'cubic') for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) linesFill(out, 'infill', a, (3 * w) / d, z / Math.SQRT2, r0, r1, form, w)
  else if (pattern === 'honeycomb') {
    const s = (1.54 * w) / d
    const hh = (s * Math.sqrt(3)) / 2
    for (let j = Math.floor(-R / hh) - 1; j * hh < R + hh; j++) {
      const pts: [number, number][] = []
      const x0 = ((j * 1.5 * s) % (3 * s)) - 3 * s - R
      for (let x = x0; x < R + 3 * s; x += 3 * s) pts.push([x, j * hh], [x + s, j * hh], [x + 1.5 * s, (j + 1) * hh], [x + 2.5 * s, (j + 1) * hh])
      polyFill(out, pts, r0, r1, form, w)
    }
  } else {
    const p = (1.1 * w) / d
    const lam = 4 * p
    const along = Math.floor(z / (lam / 2)) % 2 === 0
    const amp = 0.35 * p * Math.abs(Math.cos((TAU * z) / lam))
    for (let c = -R; c < R; c += p) {
      const pts: [number, number][] = []
      for (let t = -R; t <= R; t += 0.8) {
        const v = c + amp * Math.sin((TAU * t) / lam + (TAU * c) / lam)
        pts.push(along ? [t, v] : [v, t])
      }
      polyFill(out, pts, r0, r1, form, w)
    }
  }
}

function ring(out: SliceSeg[], form: HubForm, r: number, kind: SegKind, w: number, start = 0) {
  const sides = form === 'square' ? 4 : 48
  const R = form === 'square' ? r * Math.SQRT2 : r
  const off = form === 'square' ? Math.PI / 4 : start
  const at = (k: number): [number, number] => [R * Math.cos(off + (k / sides) * TAU), R * Math.sin(off + (k / sides) * TAU)]
  for (let k = 0; k < sides; k++) out.push({ a: at(k), b: at(k + 1), wall: true, kind, w })
}

export interface PathOpts {
  pattern?: InfillPattern
  infill: number
  index?: number
  order?: 'outer' | 'inner'
  form?: HubForm
  lineW?: number
  seamAt?: number
}

/** One layer's toolpath: walls (outer or inner first) on the outline and around the bore, gap fill, skin, sparse infill. */
export function hubLayerPath(L: HubLayer, { pattern = 'grid', infill, index = 0, order = 'outer', form = 'round', lineW = LINE_W, seamAt = 0 }: PathOpts): SliceSeg[] {
  const w = lineW
  const out: SliceSeg[] = []
  const ks = Array.from({ length: L.walls }, (_, k) => k)
  for (const k of order === 'outer' ? ks : ks.reverse()) ring(out, form, L.rOut - (k + 0.5) * w, k === 0 ? 'outer' : 'inner', w, seamAt)
  for (const k of order === 'outer' ? [...ks].sort((a, b) => a - b) : [...ks].sort((a, b) => b - a)) ring(out, 'round', L.rIn + (k + 0.5) * w, k === 0 ? 'outer' : 'inner', w, seamAt)
  const f = wallsFit(L.rOut, L.rIn, L.walls, w)
  const a = L.rIn + L.walls * w
  const b = L.rOut - L.walls * w
  if (f.gap) ring(out, form, (L.rOut + L.rIn) / 2, 'gap', f.band, seamAt)
  else if (b - a >= w) {
    if (b - L.rCore > 0.2 * w) linesFill(out, 'skin', index % 2 ? -Math.PI / 4 : Math.PI / 4, w, 0, Math.max(a, L.rCore), b, form, w)
    sparseFill(out, pattern, infill, L.z, index, a, Math.min(L.rCore, b), form, w)
  }
  return out
}

export const pathMm = (segs: readonly PathSeg[], keep: (s: SliceSeg) => boolean = () => true) =>
  (segs as readonly SliceSeg[]).reduce((t, g) => t + (keep(g) ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : 0), 0)

/** Side-load stiffness of the boss section relative to solid (typical): walls carry fully, infill by its X stiffness. */
export function sectionStiffness(walls: number, infill: number, pattern: InfillPattern = 'grid', lineW = LINE_W) {
  const { bossR: R, boreR: r } = HUB
  const f = wallsFit(R, r, walls, lineW)
  const I = (a: number, b: number) => Math.max(0, b ** 4 - a ** 4)
  const ex = infillStiffness(pattern, infill)[0]
  const wallI = I(R - f.m * lineW, R) + I(r, r + f.m * lineW)
  const coreI = I(r + f.m * lineW, R - f.m * lineW)
  return (wallI + coreI * (f.gap ? 1 : ex)) / I(r, R)
}

export function wallsView(walls: number, z: number, order: 'outer' | 'inner') {
  const s = hubShape()
  const sl = sliceHub(s, { layerH: 0.2, walls, infill: 0.2 })
  const i = Math.max(0, Math.min(sl.layers.length - 1, Math.floor(z / 0.2)))
  const L = sl.layers[i]
  const path = hubLayerPath(L, { infill: 0.2, index: i, order })
  const f = wallsFit(L.rOut, L.rIn, walls)
  return {
    shape: s,
    slice: sl,
    index: i,
    layer: L,
    path,
    fit: f,
    wallMm: pathMm(path, (g) => g.kind === 'outer' || g.kind === 'inner'),
    stiff: sectionStiffness(walls, 0.2),
    sweep: [1, 2, 3, 4, 5, 6].map((k) => ({ walls: k, time: sliceHub(s, { layerH: 0.2, walls: k, infill: 0.2 }).total, stiff: sectionStiffness(k, 0.2) })),
  }
}

export const DENSITY_SWEEP = Array.from({ length: 21 }, (_, i) => i * 0.05)
/** Top skin over sparse infill sags (pillowing) below about this density (typical). */
export const PILLOW_BELOW = 0.1

export function infillView(pattern: InfillPattern, d: number) {
  const s = hubShape()
  const run = (x: number) => sliceHub(s, { layerH: 0.2, walls: 3, infill: x, pattern })
  const sl = run(d)
  const i = Math.round(2 / 0.2)
  const L = sl.layers[i]
  const path = hubLayerPath(L, { infill: d, pattern, index: i })
  const total = (x: number) => run(x).total
  return {
    slice: sl,
    layer: L,
    index: i,
    path,
    xyz: infillStiffness(pattern, d),
    part: sectionStiffness(3, d, pattern),
    sweep: DENSITY_SWEEP.map((x) => ({ d: x, time: total(x), part: sectionStiffness(3, x, pattern) })),
  }
}

export type Orientation = 'down' | 'up'
export type SupportKind = 'normal' | 'tree'
export const SUPPORT_KINDS = {
  normal: { name: 'Normal (grid)', fill: 0.15, contact: 1, material: 1 },
  tree: { name: 'Tree', fill: 0.15, contact: 0.35, material: 0.45 },
}

export interface Overhang {
  a: [number, number]
  b: [number, number]
  deg: number
  needs: boolean
}

/** Downward faces of the outline: overhang angle from vertical (0 = wall, 90 = flat ceiling), off the bed. */
export function overhangs(s: HubShape, thresholdDeg: number): Overhang[] {
  const out: Overhang[] = []
  const P = s.profile
  for (let i = 0; i + 1 < P.length; i++) {
    const [r0, z0] = P[i]
    const [r1, z1] = P[i + 1]
    const dr = r1 - r0
    const dz = z1 - z0
    const L = Math.hypot(dr, dz)
    if (L < 1e-9 || Math.min(r0, r1) < s.boreR - 1e-6 || (Math.abs(r0 - s.boreR) < 1e-6 && Math.abs(r1 - s.boreR) < 1e-6)) continue
    const nz = -dr / L
    const deg = nz < 0 ? Math.asin(-nz) / DEG : 0
    const onBed = Math.max(z0, z1) < 0.25
    out.push({ a: [r0, z0], b: [r1, z1], deg, needs: !onBed && deg > thresholdDeg + 1e-9 })
  }
  return out
}

export function supportView(o: Orientation, chamferDeg: number, thresholdDeg: number, kind: SupportKind, gap: number, speed = 60) {
  const s = hubShape(chamferDeg, o === 'up')
  const faces = overhangs(s, thresholdDeg)
  let area = 0
  let column = 0
  for (const f of faces.filter((g) => g.needs)) {
    const n = 12
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5) / n
      const r = f.a[0] + (f.b[0] - f.a[0]) * u
      const z = f.a[1] + (f.b[1] - f.a[1]) * u
      const dA = Math.abs((f.b[0] - f.a[0]) / n) * TAU * r
      area += dA
      column += dA * Math.max(0, z - gap)
    }
  }
  const K = SUPPORT_KINDS[kind]
  const mm3 = column * K.fill * K.material + area * K.contact * 0.4
  const lineMm = mm3 / (LINE_W * 0.2)
  const part = sliceHub(s, { layerH: 0.2, walls: 3, infill: 0.2 })
  return {
    shape: s,
    faces,
    area,
    contact: area * K.contact,
    grams: mm3 * PLA_G_MM3,
    minutes: lineMm / speed / 60,
    partGrams: part.grams,
    partMinutes: part.total / 60,
    /** Underside droop of the supported face, mm (typical). */
    droop: area > 0 ? 0.6 * gap + 0.02 : 0,
    /** Removal effort 0…1 (typical): tight gaps weld the support on. */
    stuck: area > 0 ? Math.max(0, Math.min(1, (0.35 - gap) / 0.25)) * (kind === 'tree' ? 0.6 : 1) : 0,
  }
}

export type SeamMode = 'aligned' | 'rear' | 'random' | 'sharpest'
export const SEAM_MODES = { aligned: 'Aligned', rear: 'Rear', random: 'Random', sharpest: 'Sharpest corner' }
/** Seam angle per layer, radians from +X (−π/2 = front, toward the viewer). */
export function seamAngles(mode: SeamMode, layers: number, form: HubForm, seed = 7) {
  const rnd = parkMiller(seed)
  const corner = -Math.PI / 4
  return Array.from({ length: layers }, () => {
    if (mode === 'random') return rnd() * TAU - Math.PI
    if (mode === 'rear') return Math.PI / 2
    if (mode === 'sharpest') return form === 'square' ? corner : -Math.PI / 3
    return -Math.PI / 3
  })
}

/** Zit height at the seam, mm (typical): ooze at the start/stop, cut by coasting + wipe. */
export const zitMm = (wipe: boolean) => (wipe ? 0.05 : 0.18)

export function seamView(mode: SeamMode, form: HubForm, wipe: boolean, travelSpeed = 150) {
  const s = hubShape(45, false, form)
  const sl = sliceHub(s, { layerH: 0.2, walls: 3, infill: 0.2 }, form)
  const ang = seamAngles(mode, sl.layers.length, form)
  let travel = 0
  for (let i = 1; i < ang.length; i++) {
    const r = sl.layers[i].rOut
    travel += 2 * r * Math.abs(Math.sin((ang[i] - ang[i - 1]) / 2))
  }
  const front = ang.filter((a) => Math.sin(a) < -0.2).length / ang.length
  return {
    shape: s,
    slice: sl,
    angles: ang,
    travelMm: travel,
    travelS: travel / travelSpeed,
    zit: zitMm(wipe),
    hidden: (form === 'square' && mode === 'sharpest') || mode === 'rear',
    line: mode !== 'random',
    front,
  }
}

/** File size and what survives: binary STL is 50 B per triangle and nothing else; 3MF is zipped XML with shared vertices. */
export const FORMAT_BYTES = { vertexXml: 52, triXml: 44, objectXml: 400, colourXml: 60, settingsXml: 14000, zip: 0.3, asciiPerTri: 250 }
export const hubTriangles = (segments: number) => 2 * segments * (hubShape().profile.length - 1)

export const FILE_FEATURES = ['Triangles', 'Units (mm)', 'Colours', 'Separate objects', 'Print settings', 'Modifiers'] as const
export function formatView(segments: number, objects: number) {
  const tris = hubTriangles(segments) * objects
  const F = FORMAT_BYTES
  const xml = (tris / 2) * F.vertexXml + tris * F.triXml + objects * (F.objectXml + F.colourXml) + F.settingsXml
  return {
    tris,
    stl: stlBytes(tris),
    stlAscii: 84 + F.asciiPerTri * tris,
    xml,
    zip: xml * F.zip,
    stlKeeps: [true, false, false, false, false, false],
    mfKeeps: [true, true, true, true, true, true],
  }
}
