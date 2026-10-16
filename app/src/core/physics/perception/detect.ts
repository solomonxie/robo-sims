// Object detection: box IoU, non-maximum suppression, a tiny hand-weighted YOLO-style CNN (conv → ReLU → pool, grid head),
// int8 quantization, a seeded labelled tabletop set and precision/recall.
import { clamp, hash01 } from '../common'
import { P3 } from '../room'
import { Mat4 } from '../software/urdf'
import { Img, grainImg } from './image'
import { Intrinsics, camTf, intrinsicsOf, projectPx } from './projection'
import { RenderScene, renderView } from './render'

/** Pixel box x0, y0, x1, y1 (edges, not centres). */
export type BBox = [number, number, number, number]
const boxArea = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])

/** Intersection over union of two boxes, 0…1. */
export function boxIoU(a: BBox, b: BBox) {
  const inter = boxArea([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])])
  const uni = boxArea(a) + boxArea(b) - inter
  return uni > 0 ? inter / uni : 0
}

export interface Det { box: BBox; score: number; cls: number; cell: [number, number] }

/** Greedy per-class NMS: best score first, drop same-class boxes with IoU > `thr`. Steps list which kept box removed which. */
export function nmsSteps(dets: readonly Det[], thr: number) {
  const order = dets.map((_, i) => i).sort((a, b) => dets[b].score - dets[a].score)
  const gone = new Set<number>()
  const steps: { keep: number; drop: number[] }[] = []
  for (const i of order) {
    if (gone.has(i)) continue
    const drop = order.filter((j) => j !== i && !gone.has(j) && dets[j].cls === dets[i].cls && boxIoU(dets[i].box, dets[j].box) > thr)
    drop.forEach((j) => gone.add(j))
    gone.add(i)
    steps.push({ keep: i, drop })
  }
  return { order, steps, kept: steps.map((s) => s.keep) }
}
export const nms = (dets: readonly Det[], thr: number) => nmsSteps(dets, thr).kept.map((i) => dets[i])

// --- Feature planes and layers ---

export interface Plane { w: number; h: number; data: Float32Array }
const plane = (w: number, h: number): Plane => ({ w, h, data: new Float32Array(w * h) })
/** 3 × 3 kernels [out][in][9] and one bias per output. */
export interface ConvLayer { k: number[][][]; bias: number[] }

const planesOf = (img: Img): Plane[] =>
  Array.from({ length: img.ch }, (_, c) => ({ w: img.w, h: img.h, data: Float32Array.from({ length: img.w * img.h }, (__, i) => img.data[i * img.ch + c] / 255) }))

/** Same-size 3 × 3 convolution (edge pixels repeated) + bias, then ReLU. */
export function convRelu(inp: readonly Plane[], L: ConvLayer): Plane[] {
  const { w, h } = inp[0]
  return L.k.map((ks, o) => {
    const out = plane(w, h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = L.bias[o]
        ks.forEach((k, c) => {
          const d = inp[c].data
          for (let j = 0; j < 9; j++) s += k[j] * d[clamp(y + Math.floor(j / 3) - 1, 0, h - 1) * w + clamp(x + (j % 3) - 1, 0, w - 1)]
        })
        out.data[y * w + x] = Math.max(0, s)
      }
    return out
  })
}

/** `s × s` max pool (stride s). */
export function maxPool(p: Plane, s: number): Plane {
  const out = plane(Math.floor(p.w / s), Math.floor(p.h / s))
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      let m = -Infinity
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) m = Math.max(m, p.data[(y * s + j) * p.w + x * s + i])
      out.data[y * out.w + x] = m
    }
  return out
}

/** Symmetric int8: every weight rounded to one of ±127 steps of max|w| / 127. */
export function int8Layer(L: ConvLayer): ConvLayer {
  const step = Math.max(...L.k.flat(2).map(Math.abs), ...L.bias.map(Math.abs)) / 127
  const q = (v: number) => Math.round(v / step) * step
  return { k: L.k.map((a) => a.map((b) => b.map(q))), bias: L.bias.map(q) }
}
/** uint8 activations on 0…`range`. */
const uint8Plane = (p: Plane, range: number): Plane => ({ ...p, data: p.data.map((v) => (Math.round(clamp(v / range, 0, 1) * 255) * range) / 255) })

// --- The hand-set network: colour/edge filters → pool 2 → class maps → pool 3 → one cell per 6 × 6 pixels ---

export const DET_CLASSES = ['ball', 'block', 'can'] as const
const BLUR = [1, 2, 1, 2, 4, 2, 1, 2, 1].map((v) => v / 16)
const LAPLACE = [0, -1, 0, -1, 4, -1, 0, -1, 0]
const BOX3 = Array(9).fill(1 / 9)
const outer = (k: readonly number[], per: readonly number[]) => per.map((s) => k.map((v) => v * s))
const OPP = 0.65
const DET_NET = {
  conv1: {
    names: ['red', 'blue', 'green', 'edge'],
    k: [outer(BLUR, [1, -OPP, -OPP]), outer(BLUR, [-OPP, -OPP, 1]), outer(BLUR, [-OPP, 1.25, -OPP]), outer(LAPLACE, [0.6, 1.2, 0.2])],
    bias: [-0.12, -0.12, -0.12, -0.02],
  } as ConvLayer & { names: string[] },
  conv2: {
    names: [...DET_CLASSES],
    k: [0, 1, 2].map((cls) => [0, 1, 2, 3].map((c) => BOX3.map((v) => v * (c === 3 ? 0.15 : c === cls ? 2.2 : -0.6)))),
    bias: [-0.08, -0.08, -0.08],
  } as ConvLayer & { names: string[] },
  head: { gain: 14, bias: 0.3, win: 4, classGain: 8 },
  range: [1, 2],
}

export interface DetCell { c: number; r: number; cls: number; obj: number; resp: number; prob: number; score: number; box: BBox | null }
export interface NetRun { input: Plane[]; conv1: Plane[]; pool1: Plane[]; conv2: Plane[]; pool2: Plane[]; cells: DetCell[]; dets: Det[] }

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** Runs the net on `img` (w, h multiples of 6): every grid cell predicts objectness, class and a box from its window's moments. */
export function runDetector(img: Img, { int8 = false, minScore = 0.05 } = {}): NetRun {
  const N = DET_NET
  const [L1, L2] = int8 ? [int8Layer(N.conv1), int8Layer(N.conv2)] : [N.conv1, N.conv2]
  const act = (ps: Plane[], r: number) => (int8 ? ps.map((p) => uint8Plane(p, r)) : ps)
  const input = act(planesOf(img), 1)
  const conv1 = act(convRelu(input, L1), N.range[0])
  const pool1 = conv1.map((p) => maxPool(p, 2))
  const conv2 = act(convRelu(pool1, L2), N.range[1])
  const pool2 = conv2.map((p) => maxPool(p, 3))
  const { w, h } = pool2[0]
  const cells: DetCell[] = []
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const s = pool2.map((p) => p.data[r * w + c])
      const cls = s.indexOf(Math.max(...s))
      const ex = s.map((v) => Math.exp(N.head.classGain * v))
      const prob = ex[cls] / ex.reduce((a, b) => a + b, 0)
      const obj = sigmoid(N.head.gain * (s[cls] - N.head.bias))
      const box = windowBox(conv2[cls], 3 * c + 1, 3 * r + 1, N.head.win)
      const resp = box ? Math.exp(-(((box.cx - 3 * c - 1) / 3) ** 2 + ((box.cy - 3 * r - 1) / 3) ** 2)) : 0
      cells.push({ c, r, cls, obj, resp, prob, score: obj * resp * prob, box: box?.box ?? null })
    }
  const dets = cells.filter((k) => k.box && k.score >= minScore).map((k) => ({ box: k.box!, score: k.score, cls: k.cls, cell: [k.c, k.r] as [number, number] }))
  return { input, conv1, pool1, conv2, pool2, cells, dets }
}

/** Spread (map px²) the 3 × 3 blurs add to a sharp edge. */
const BLUR_VAR = 0.4

/** Mass, centroid and ±√3 σ extent of a feature map in a (2·win + 1)² window, as a box in input pixels (map is ½ scale). */
function windowBox(p: Plane, x0: number, y0: number, win: number) {
  let m = 0, sx = 0, sy = 0, sxx = 0, syy = 0
  for (let y = Math.max(0, y0 - win); y <= Math.min(p.h - 1, y0 + win); y++)
    for (let x = Math.max(0, x0 - win); x <= Math.min(p.w - 1, x0 + win); x++) {
      const a = p.data[y * p.w + x]
      m += a
      sx += a * x
      sy += a * y
      sxx += a * x * x
      syy += a * y * y
    }
  if (m < 1e-3) return null
  const [cx, cy] = [sx / m, sy / m]
  const hw = Math.sqrt(12 * Math.max(0, sxx / m - cx * cx - BLUR_VAR) + 1)
  const hh = Math.sqrt(12 * Math.max(0, syy / m - cy * cy - BLUR_VAR) + 1)
  const box: BBox = [2 * cx + 1 - hw, 2 * cy + 1 - hh, 2 * cx + 1 + hw, 2 * cy + 1 + hh]
  return { cx, cy, box }
}

/** Multiply-accumulates, weights and activation sizes per layer for a w × h input. */
export function netCost(w: number, h: number) {
  const [c0, c1, c2] = [3, DET_NET.conv1.k.length, DET_NET.conv2.k.length]
  const layers = [
    { name: 'conv1 3×3', macs: w * h * c1 * c0 * 9, params: c1 * (c0 * 9 + 1), out: w * h * c1 },
    { name: 'pool 2', macs: 0, params: 0, out: (w / 2) * (h / 2) * c1 },
    { name: 'conv2 3×3', macs: (w / 2) * (h / 2) * c2 * c1 * 9, params: c2 * (c1 * 9 + 1), out: (w / 2) * (h / 2) * c2 },
    { name: 'pool 3', macs: 0, params: 0, out: (w / 6) * (h / 6) * c2 },
    { name: 'head', macs: (w / 6) * (h / 6) * (2 * DET_NET.head.win + 1) ** 2 * 5, params: 4, out: (w / 6) * (h / 6) * 6 },
  ]
  const peak = Math.max(...layers.map((l, i) => l.out + (i ? layers[i - 1].out : w * h * c0)))
  return { layers, macs: layers.reduce((a, l) => a + l.macs, 0), params: layers.reduce((a, l) => a + l.params, 0), peak }
}

// --- Labelled tabletop scenes ---

export interface DetObject { cls: number; x: number; y: number; size: number }
type Rgb = [number, number, number]
const DET_RGB: Rgb[] = [[214, 58, 46], [40, 90, 220], [60, 190, 70]]
const CARDBOARD: Rgb = [190, 122, 72]
const DET_FOV = 45
export const DET_K: Intrinsics = intrinsicsOf(48, 36, DET_FOV)
export const DET_CAM: Mat4 = camTf([0, 0, 0.24], 0, 0.32)
const FLOOR = { tile: 0.2, a: [128, 126, 122] as Rgb, b: [92, 94, 98] as Rgb }

/** World solids of an object: ball (sphere), block (cube), can (tall narrow box). */
function solidOf(o: DetObject) {
  const s = o.size / 2
  if (o.cls === 0) return { ball: { c: [o.x, o.y, s] as P3, r: s, rgb: DET_RGB[0] } }
  const [hx, hz] = o.cls === 1 ? [s, 2 * s] : [s * 0.75, 3 * s]
  return { block: { min: [o.x - hx, o.y - hx, 0] as P3, max: [o.x + hx, o.y + hx, hz] as P3, rgb: o.cls === 1 ? DET_RGB[1] : DET_RGB[2] } }
}

function detScene(objs: readonly DetObject[], cardboard: P3 | null = null): RenderScene {
  const solids = objs.map(solidOf)
  const blocks = solids.flatMap((s) => (s.block ? [s.block] : []))
  if (cardboard) blocks.push({ min: [cardboard[0] - 0.06, cardboard[1] - 0.09, 0], max: [cardboard[0] + 0.06, cardboard[1] + 0.09, cardboard[2]], rgb: CARDBOARD })
  return { floor: { ...FLOOR, off: [70, 72, 76] }, sky: [150, 160, 172], wallX: 2.6, light: [-0.6, 0.3, 0.75], balls: solids.flatMap((s) => (s.ball ? [s.ball] : [])), blocks }
}

/** Ground-truth box of each object in a w × h image (projected solid corners / sphere rim, clipped). */
export function truthBoxes(objs: readonly DetObject[], w = DET_K.w, h = DET_K.h, cam = DET_CAM) {
  const k = intrinsicsOf(w, h, DET_FOV)
  return objs.map((o) => {
    const s = solidOf(o)
    const pts: P3[] = s.ball
      ? Array.from({ length: 64 }, (_, i) => {
          const [a, b] = [(i % 8) * (Math.PI / 4), (Math.floor(i / 8) / 7 - 0.5) * Math.PI]
          return [s.ball.c[0] + s.ball.r * Math.cos(b) * Math.cos(a), s.ball.c[1] + s.ball.r * Math.cos(b) * Math.sin(a), s.ball.c[2] + s.ball.r * Math.sin(b)]
        })
      : Array.from({ length: 8 }, (_, i) => [0, 1, 2].map((a) => (Math.floor(i / 2 ** a) % 2 ? s.block!.max[a] : s.block!.min[a])) as P3)
    const px = pts.map((p) => projectPx(k, cam, p))
    const box: BBox = [
      clamp(Math.min(...px.map((p) => p[0])) + 0.5, 0, w), clamp(Math.min(...px.map((p) => p[1])) + 0.5, 0, h),
      clamp(Math.max(...px.map((p) => p[0])) + 0.5, 0, w), clamp(Math.max(...px.map((p) => p[1])) + 0.5, 0, h),
    ]
    return { cls: o.cls, box }
  })
}

/** Camera frame of the objects at w × h, 2 × 2 samples per pixel, sensor grain. */
export function detFrame(objs: readonly DetObject[], w = DET_K.w, h = DET_K.h, cardboard: P3 | null = null, seed = 1) {
  return grainImg(renderView(intrinsicsOf(w, h, DET_FOV), DET_CAM, detScene(objs, cardboard), w, h, undefined, 2), 5, seed)
}

/** `n` seeded scenes of 1–3 objects (random class, size, place in view) and sometimes a cardboard box. */
export function detDataset(n: number, seed = 1) {
  return Array.from({ length: n }, (_, s) => {
    const rnd = (j: number) => hash01(seed * 7919 + s * 131 + j)
    const objs: DetObject[] = []
    const count = 1 + Math.floor(rnd(0) * 3)
    for (let j = 0; objs.length < count && j < 30; j++) {
      const x = 0.4 + rnd(10 + 4 * j) * 0.55
      const o = { cls: Math.floor(rnd(11 + 4 * j) * 3), x, y: (rnd(12 + 4 * j) - 0.5) * 0.7 * x, size: 0.06 + rnd(13 + 4 * j) * 0.04 }
      if (objs.every((p) => Math.abs(Math.atan2(p.y, p.x) - Math.atan2(o.y, o.x)) > 0.14)) objs.push(o)
    }
    const card: P3 | null = rnd(1) < 0.5 ? [0.6 + rnd(2) * 0.6, (rnd(3) - 0.5) * 0.6, 0.12] : null
    const clear = (c: P3) => objs.every((o) => Math.abs(Math.atan2(o.y, o.x) - Math.atan2(c[1], c[0])) > 0.22)
    if (card && !clear(card)) card[1] = -card[1]
    return { objs, card: card && clear(card) ? card : null, truth: truthBoxes(objs) }
  })
}

/** Greedy match, best score first: a detection is a true positive if it overlaps an unclaimed same-class truth by IoU ≥ `thr`. */
export function matchDets(dets: readonly Det[], truth: readonly { cls: number; box: BBox }[], thr = 0.5) {
  const used = new Set<number>()
  return [...dets]
    .sort((a, b) => b.score - a.score)
    .map((d) => {
      let best = -1, bi = -1
      truth.forEach((t, i) => {
        const v = t.cls === d.cls && !used.has(i) ? boxIoU(d.box, t.box) : 0
        if (v >= thr && v > best) [best, bi] = [v, i]
      })
      if (bi >= 0) used.add(bi)
      return { det: d, tp: bi >= 0 }
    })
}

/** Precision and recall at every distinct score, high to low, and the area under the curve (all-point AP). */
export function prCurve(scored: readonly { score: number; tp: boolean }[], nTruth: number) {
  const s = [...scored].sort((a, b) => b.score - a.score)
  let tp = 0
  const pts = s.map((d, i) => {
    tp += d.tp ? 1 : 0
    return { thr: d.score, p: tp / (i + 1), r: nTruth ? tp / nTruth : 0 }
  })
  let ap = 0, prevR = 0
  pts.forEach((q, i) => {
    const pMax = Math.max(...pts.slice(i).map((x) => x.p))
    ap += (q.r - prevR) * pMax
    prevR = q.r
  })
  return { pts, ap }
}

/** Precision/recall if only scores ≥ `thr` are kept. */
export function prAt(scored: readonly { score: number; tp: boolean }[], nTruth: number, thr: number) {
  const kept = scored.filter((d) => d.score >= thr)
  const tp = kept.filter((d) => d.tp).length
  return { p: kept.length ? tp / kept.length : 1, r: nTruth ? tp / nTruth : 0, tp, fp: kept.length - tp, fn: nTruth - tp }
}
