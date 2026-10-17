// A part sliced into layers: walls + infill per layer, print time vs layer height, stair-stepping on curved tops.
import { TAU } from '../common'
import { LINE_W } from './fdm'

export const PRINT_SHAPES = {
  box: { name: 'Box 20 mm', h: 20, round: false, rAt: (_z: number) => 10 },
  cylinder: { name: 'Cylinder 20 mm', h: 20, round: true, rAt: (_z: number) => 10 },
  dome: { name: 'Dome 24 mm', h: 12, round: true, rAt: (z: number) => Math.sqrt(Math.max(0, 144 - z * z)) },
}
export type PrintShape = keyof typeof PRINT_SHAPES
export const WALLS = 2
export const SOLID_LAYERS = 3
/** Travel, retraction and layer change per layer, s (typical). */
export const LAYER_OVERHEAD_S = 1.5

const perimeter = (round: boolean, r: number) => (round ? TAU * r : 8 * r)
const areaOf = (round: boolean, r: number) => (round ? Math.PI * r * r : 4 * r * r)

export interface SliceIn {
  shape: PrintShape
  layerH: number
  infill: number
  speed: number
  lineW?: number
}

export interface PrintLayer {
  z: number
  r: number
  solid: boolean
  len: number
  time: number
}

export function sliceLayers({ shape, layerH, infill, speed, lineW = LINE_W }: SliceIn): PrintLayer[] {
  const S = PRINT_SHAPES[shape]
  const n = Math.max(1, Math.round(S.h / layerH))
  const out: PrintLayer[] = []
  for (let i = 0; i < n; i++) {
    const r = S.rAt((i + 0.5) * layerH)
    if (r < lineW) break
    const solid = i < SOLID_LAYERS || i >= n - SOLID_LAYERS
    let len = 0
    for (let w = 0; w < WALLS; w++) len += perimeter(S.round, Math.max(0, r - (w + 0.5) * lineW))
    const rIn = Math.max(0, r - WALLS * lineW)
    len += (areaOf(S.round, rIn) * (solid ? 1 : infill)) / lineW
    out.push({ z: i * layerH, r, solid, len, time: len / speed + LAYER_OVERHEAD_S })
  }
  return out
}

export const LAYER_SWEEP = Array.from({ length: 13 }, (_, i) => 0.08 + i * 0.02)

export function sliceView(q: SliceIn) {
  const layers = sliceLayers(q)
  const total = layers.reduce((s, l) => s + l.time, 0)
  let step = 0
  for (let i = 1; i < layers.length; i++) step = Math.max(step, layers[i - 1].r - layers[i].r)
  const top = layers.length * q.layerH
  return {
    layers,
    total,
    step,
    heightErr: PRINT_SHAPES[q.shape].h - top,
    filamentMm3: layers.reduce((s, l) => s + l.len, 0) * (q.lineW ?? LINE_W) * q.layerH,
    sweep: LAYER_SWEEP.map((h) => sliceLayers({ ...q, layerH: h }).reduce((s, l) => s + l.time, 0)),
  }
}

export interface PathSeg {
  a: [number, number]
  b: [number, number]
  wall: boolean
}

/** Toolpath of one layer: walls outside in, then ±45° infill lines alternating per layer, clipped to the inner outline. */
export function layerPath(shape: PrintShape, l: PrintLayer, index: number, infill: number, lineW = LINE_W): PathSeg[] {
  const { round } = PRINT_SHAPES[shape]
  const segs: PathSeg[] = []
  const sides = round ? 36 : 4
  for (let w = 0; w < WALLS; w++) {
    const r = l.r - (w + 0.5) * lineW
    if (r <= 0) continue
    const R = round ? r : r * Math.SQRT2
    const at = (k: number): [number, number] => {
      const a = (k / sides) * TAU + (round ? 0 : Math.PI / 4)
      return [R * Math.cos(a), R * Math.sin(a)]
    }
    for (let k = 0; k < sides; k++) segs.push({ a: at(k), b: at(k + 1), wall: true })
  }
  const frac = l.solid ? 1 : infill
  const rIn = l.r - WALLS * lineW
  if (frac <= 0 || rIn <= 0) return segs
  const gap = lineW / frac
  const dir = index % 2 ? -1 : 1
  const ux = Math.SQRT1_2
  const uy = dir * Math.SQRT1_2
  const span = round ? rIn : rIn * Math.SQRT2
  let flip = false
  for (let c = -span + gap / 2; c < span; c += gap) {
    const cx = -uy * c
    const cy = ux * c
    let t0: number
    let t1: number
    if (round) {
      const h = Math.sqrt(Math.max(0, rIn * rIn - c * c))
      t0 = -h
      t1 = h
    } else {
      ;[t0, t1] = clipSquare(cx, cy, ux, uy, rIn)
    }
    if (t1 - t0 < lineW) continue
    const p0: [number, number] = [cx + ux * t0, cy + uy * t0]
    const p1: [number, number] = [cx + ux * t1, cy + uy * t1]
    segs.push(flip ? { a: p1, b: p0, wall: false } : { a: p0, b: p1, wall: false })
    flip = !flip
  }
  return segs
}

function clipSquare(cx: number, cy: number, ux: number, uy: number, r: number): [number, number] {
  let lo = -Infinity
  let hi = Infinity
  for (const [p, u] of [[cx, ux], [cy, uy]]) {
    const a = (-r - p) / u
    const b = (r - p) / u
    lo = Math.max(lo, Math.min(a, b))
    hi = Math.min(hi, Math.max(a, b))
  }
  return [lo, hi]
}

export const toolpathLength = (segs: readonly PathSeg[]) => segs.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), 0)

/** Nozzle position after `d` mm along the path, and how many segments are finished. */
export function toolpathAt(segs: readonly PathSeg[], d: number) {
  let left = d
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]
    const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])
    if (left <= L) {
      const u = L > 0 ? left / L : 1
      return { x: g.a[0] + (g.b[0] - g.a[0]) * u, y: g.a[1] + (g.b[1] - g.a[1]) * u, done: i, u }
    }
    left -= L
  }
  const g = segs[segs.length - 1]
  return { x: g?.b[0] ?? 0, y: g?.b[1] ?? 0, done: segs.length, u: 0 }
}
