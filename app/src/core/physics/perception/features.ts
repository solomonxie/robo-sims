// Edges and features on small grey images: Sobel gradient, Canny (NMS + hysteresis), Hough lines, Harris / Shi-Tomasi corners, patch descriptors and matching, a rigid warp for a second view.
import { clamp } from '../common'
import { Img, KERNELS, convolveImg, grayImg, imgAt, makeImg } from './image'

export interface Gradient {
  w: number
  h: number
  gx: Float32Array
  gy: Float32Array
  mag: Float32Array
  /** atan2(gy, gx) in radians, image y down. */
  ang: Float32Array
}

/** Sobel gradient of channel 0 (grey). */
export function gradientOf(img: Img): Gradient {
  const g = grayImg(img)
  const gx = convolveImg(g, KERNELS.sobelX).data
  const gy = convolveImg(g, KERNELS.sobelY).data
  const n = g.w * g.h
  const mag = new Float32Array(n)
  const ang = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    mag[i] = Math.hypot(gx[i], gy[i])
    ang[i] = Math.atan2(gy[i], gx[i])
  }
  return { w: g.w, h: g.h, gx, gy, mag, ang }
}

/** Gradient direction rounded to 0°, 45°, 90° or 135° (index 0…3). */
export const dirBin = (ang: number) => Math.round((((ang * 180) / Math.PI + 180) % 180) / 45) % 4
const STEP = [[1, 0], [1, 1], [0, 1], [-1, 1]]

/** Non-maximum suppression: keep a magnitude only where it beats both neighbours across the edge (ties: the first wins). */
export function thinEdges(g: Gradient): Float32Array {
  const out = new Float32Array(g.w * g.h)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? 0 : g.mag[y * g.w + x])
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x
      const m = g.mag[i]
      const [dx, dy] = STEP[dirBin(g.ang[i])]
      if (m > 0 && m >= at(x - dx, y - dy) && m > at(x + dx, y + dy)) out[i] = m
    }
  return out
}

/** Hysteresis classes per pixel. */
export const EDGE = { none: 0, dropped: 1, weak: 2, strong: 3 } as const

/** ≥ hi = strong; lo…hi kept only if 8-connected to a strong pixel, else dropped. `depth` (optional) gets each kept pixel's step count from the nearest strong one. */
export function hysteresis(thin: Float32Array, w: number, h: number, lo: number, hi: number, depth?: Int16Array): Uint8Array {
  const cls = new Uint8Array(w * h)
  const queue: number[] = []
  depth?.fill(-1)
  for (let i = 0; i < w * h; i++) {
    if (thin[i] >= hi) {
      cls[i] = EDGE.strong
      queue.push(i)
      if (depth) depth[i] = 0
    } else if (thin[i] >= lo) cls[i] = EDGE.dropped
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const u = x + dx
        const v = y + dy
        if (u < 0 || v < 0 || u >= w || v >= h) continue
        const j = v * w + u
        if (cls[j] === EDGE.dropped) {
          cls[j] = EDGE.weak
          queue.push(j)
          if (depth) depth[j] = depth[i] + 1
        }
      }
  }
  return cls
}

/** Canny: optional Gaussian blur (`blur` passes of 3 × 3), Sobel, NMS, hysteresis. `edges` is 255 on kept pixels. */
export function canny(img: Img, lo: number, hi: number, blur = 1) {
  let g = grayImg(img)
  for (let k = 0; k < blur; k++) g = convolveImg(g, KERNELS.gauss)
  const grad = gradientOf(g)
  const thin = thinEdges(grad)
  const depth = new Int16Array(g.w * g.h)
  const cls = hysteresis(thin, g.w, g.h, lo, hi, depth)
  const edges = makeImg(g.w, g.h, 1)
  let count = 0
  for (let i = 0; i < cls.length; i++)
    if (cls[i] >= EDGE.weak) {
      edges.data[i] = 255
      count++
    }
  return { smooth: g, grad, thin, cls, depth, edges, count }
}

// --- Hough lines: ρ = x cos θ + y sin θ, θ in [0, 180°) ---

export interface HoughLine {
  rho: number
  theta: number
  votes: number
}

/** Votes of every white pixel over `nTheta` angles and 1 px ρ bins; up to `max` peaks with ≥ `minVotes`, each a local max away from stronger ones. */
export function houghLines(mask: Img, nTheta = 90, max = 4, minVotes = 8) {
  const rMax = Math.ceil(Math.hypot(mask.w, mask.h))
  const nRho = 2 * rMax + 1
  const acc = new Float32Array(nTheta * nRho)
  const cs = Array.from({ length: nTheta }, (_, t) => Math.cos((t * Math.PI) / nTheta))
  const sn = Array.from({ length: nTheta }, (_, t) => Math.sin((t * Math.PI) / nTheta))
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.data[(y * mask.w + x) * mask.ch] > 127)
        for (let t = 0; t < nTheta; t++) acc[t * nRho + Math.round(x * cs[t] + y * sn[t]) + rMax]++
  const order = Array.from(acc.keys()).filter((i) => acc[i] >= minVotes).sort((a, b) => acc[b] - acc[a])
  const lines: HoughLine[] = []
  const near = (a: number, b: number) => {
    const ta = Math.floor(a / nRho)
    const tb = Math.floor(b / nRho)
    const dt = Math.min(Math.abs(ta - tb), nTheta - Math.abs(ta - tb))
    return dt <= nTheta / 18 && Math.abs((a % nRho) - (b % nRho)) <= 3
  }
  const kept: number[] = []
  for (const i of order) {
    if (lines.length >= max) break
    if (kept.some((k) => near(k, i))) continue
    kept.push(i)
    lines.push({ rho: (i % nRho) - rMax, theta: (Math.floor(i / nRho) * Math.PI) / nTheta, votes: acc[i] })
  }
  return { acc, nTheta, nRho, rMax, lines }
}

/** End points of a Hough line clipped to the w × h image (pixel centres), or null. */
export function lineInImg(l: HoughLine, w: number, h: number): [[number, number], [number, number]] | null {
  const c = Math.cos(l.theta)
  const s = Math.sin(l.theta)
  const pts: [number, number][] = []
  const add = (x: number, y: number) => {
    if (x >= -1e-6 && x <= w - 1 + 1e-6 && y >= -1e-6 && y <= h - 1 + 1e-6 && !pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-6)) pts.push([x, y])
  }
  if (Math.abs(s) > 1e-9) {
    add(0, l.rho / s)
    add(w - 1, (l.rho - (w - 1) * c) / s)
  }
  if (Math.abs(c) > 1e-9) {
    add(l.rho / c, 0)
    add((l.rho - (h - 1) * s) / c, h - 1)
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null
}

// --- Corners: the structure tensor M = Σ w [gx², gx gy; gx gy, gy²] over a window ---

/** Eigenvalues (large, small) of the symmetric 2 × 2 [a b; b c]. */
export function eigen2(a: number, b: number, c: number): [number, number] {
  const m = (a + c) / 2
  const d = Math.sqrt(((a - c) / 2) ** 2 + b * b)
  return [m + d, m - d]
}

export type CornerMethod = 'harris' | 'shi'
export const HARRIS_K = 0.05

/** Per pixel: λ1 ≥ λ2 of M (Gaussian-weighted 5 × 5 window of Sobel products, scaled by 1/16²) and the response
 *  Harris R = λ1 λ2 − k (λ1 + λ2)² or Shi-Tomasi R = λ2. */
export function cornerField(img: Img, method: CornerMethod = 'harris', k = HARRIS_K) {
  const g = gradientOf(img)
  const { w, h } = g
  const n = w * h
  const prod = [makeImg(w, h, 1), makeImg(w, h, 1), makeImg(w, h, 1)]
  for (let i = 0; i < n; i++) {
    const x = g.gx[i] / 16
    const y = g.gy[i] / 16
    prod[0].data[i] = x * x
    prod[1].data[i] = x * y
    prod[2].data[i] = y * y
  }
  const [sxx, sxy, syy] = prod.map((p) => convolveImg(convolveImg(p, KERNELS.gauss), KERNELS.gauss).data)
  const l1 = new Float32Array(n)
  const l2 = new Float32Array(n)
  const resp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [a, b] = eigen2(sxx[i], sxy[i], syy[i])
    l1[i] = a
    l2[i] = Math.max(0, b)
    resp[i] = method === 'shi' ? l2[i] : a * b - k * (a + b) ** 2
  }
  return { w, h, l1, l2, resp, grad: g }
}

/** Smaller λ2 on the Harris level set R = t for a given λ1 (null if R < t for every λ2 ≤ λ1). */
export function harrisBoundary(l1: number, t: number, k = HARRIS_K): number | null {
  const b = l1 * (2 * k - 1)
  const disc = b * b - 4 * k * (k * l1 * l1 + t)
  if (disc < 0) return null
  const l2 = (-b - Math.sqrt(disc)) / (2 * k)
  return l2 <= l1 ? l2 : null
}

export interface Corner {
  x: number
  y: number
  score: number
}

/** Local maxima of `resp` (within `radius`) at or above `min`, strongest first, at most `max`, ≥ `border` px from the edge. */
export function pickCorners(resp: Float32Array, w: number, h: number, min: number, max = 40, radius = 2, border = 2): Corner[] {
  const out: Corner[] = []
  for (let y = border; y < h - border; y++)
    for (let x = border; x < w - border; x++) {
      const v = resp[y * w + x]
      if (v < min || v <= 0) continue
      let best = true
      for (let j = -radius; j <= radius && best; j++)
        for (let i = -radius; i <= radius; i++) {
          const u = x + i
          const t = y + j
          if ((i || j) && u >= 0 && t >= 0 && u < w && t < h && (resp[t * w + u] > v || (resp[t * w + u] === v && t * w + u < y * w + x))) {
            best = false
            break
          }
        }
      if (best) out.push({ x, y, score: v })
    }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}

// --- Descriptors and matching ---

/** (2r + 1)² grey values around (x, y), minus their mean, scaled to unit length (brightness and contrast invariant). */
export function patchDescriptor(img: Img, x: number, y: number, r = 3): Float32Array {
  const g = grayImg(img)
  const d = new Float32Array((2 * r + 1) ** 2)
  let k = 0
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) d[k++] = imgAt(g, x + i, y + j)
  const mean = d.reduce((a, v) => a + v, 0) / d.length
  let s = 0
  for (let i = 0; i < d.length; i++) {
    d[i] -= mean
    s += d[i] * d[i]
  }
  const norm = Math.sqrt(s) || 1
  return d.map((v) => v / norm)
}

/** Sum of squared differences of two unit descriptors (0 = same, 4 = opposite). */
export const descDistance = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)

export interface Match {
  a: number
  b: number
  dist: number
  /** best / second-best distance; low = distinctive. */
  ratio: number
}

/** For each descriptor in `A`, its nearest in `B`; kept when best/second-best ≤ `ratio` (Lowe's test) and the pair is mutual. */
export function matchDescriptors(A: Float32Array[], B: Float32Array[], ratio = 0.8): Match[] {
  const nearest = (d: Float32Array, set: Float32Array[]) => {
    let b1 = -1
    let d1 = Infinity
    let d2 = Infinity
    set.forEach((e, j) => {
      const s = descDistance(d, e)
      if (s < d1) [d2, d1, b1] = [d1, s, j]
      else if (s < d2) d2 = s
    })
    return { j: b1, d1, d2 }
  }
  const out: Match[] = []
  A.forEach((d, i) => {
    const f = nearest(d, B)
    if (f.j < 0) return
    const r = Number.isFinite(f.d2) ? f.d1 / Math.max(1e-9, f.d2) : 0
    if (r > ratio || nearest(B[f.j], A).j !== i) return
    out.push({ a: i, b: f.j, dist: f.d1, ratio: r })
  })
  return out
}

// --- A second view: rotate by `angle` (rad) about the centre, then shift (dx, dy) px ---

export interface Warp {
  angle: number
  dx: number
  dy: number
}

/** Where pixel (x, y) of the source lands in the warped image. */
export function warpPoint(wp: Warp, w: number, h: number, x: number, y: number): [number, number] {
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const c = Math.cos(wp.angle)
  const s = Math.sin(wp.angle)
  return [cx + c * (x - cx) - s * (y - cy) + wp.dx, cy + s * (x - cx) + c * (y - cy) + wp.dy]
}

/** Bilinear warp; pixels from outside the source take `fill`. */
export function warpImg(img: Img, wp: Warp, fill = 0): Img {
  const out = makeImg(img.w, img.h, img.ch, fill)
  const cx = (img.w - 1) / 2
  const cy = (img.h - 1) / 2
  const c = Math.cos(wp.angle)
  const s = Math.sin(wp.angle)
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const u = x - wp.dx - cx
      const v = y - wp.dy - cy
      const sx = cx + c * u + s * v
      const sy = cy - s * u + c * v
      if (sx < -0.5 || sy < -0.5 || sx > img.w - 0.5 || sy > img.h - 0.5) continue
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      for (let ch = 0; ch < img.ch; ch++) {
        const at = (i: number, j: number) => img.data[(clamp(j, 0, img.h - 1) * img.w + clamp(i, 0, img.w - 1)) * img.ch + ch]
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
        out.data[(y * img.w + x) * img.ch + ch] = top + (bot - top) * fy
      }
    }
  return out
}
