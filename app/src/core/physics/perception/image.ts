// Small images (w × h × 1 or 3 channels, 0…255 floats): a synthetic tabletop scene, pixel access, grey, HSV, histograms, thresholds, convolution, resize, noise, bit depth.
import { clamp, gaussAt } from '../common'
import { quantize } from '../mcu/adc'
import { histogram } from '../sensors/camera'

export interface Img {
  w: number
  h: number
  ch: 1 | 3
  data: Float32Array
}

export const makeImg = (w: number, h: number, ch: 1 | 3 = 3, fill = 0): Img => ({ w, h, ch, data: new Float32Array(w * h * ch).fill(fill) })

/** Channel `c` at (x, y), edges clamped. */
export const imgAt = (img: Img, x: number, y: number, c = 0) => img.data[(clamp(Math.round(y), 0, img.h - 1) * img.w + clamp(Math.round(x), 0, img.w - 1)) * img.ch + c]

/** All channels of pixel (x, y). */
export const pixelOf = (img: Img, x: number, y: number) => Array.from({ length: img.ch }, (_, c) => imgAt(img, x, y, c))

export function setPixel(img: Img, x: number, y: number, v: readonly number[]) {
  for (let c = 0; c < img.ch; c++) img.data[(y * img.w + x) * img.ch + c] = v[c]
}

export const mapImg = (img: Img, f: (v: number, c: number) => number): Img => ({ ...img, data: img.data.map((v, i) => f(v, i % img.ch)) })

/** Bytes for a w × h frame at `bitsPerPixel` (24 = RGB888, 16 = RGB565, 8 = grey). */
export const imageBytes = (w: number, h: number, bitsPerPixel: number) => (w * h * bitsPerPixel) / 8

// --- Synthetic scene: a robot's view of a tabletop (wall, table, red ball, green block, blue cup, yellow tape) ---

const ASPECT = 4 / 3
const LIGHT_DIR = [-0.45, -0.5, 0.74]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mix3 = (a: number[], b: number[], t: number) => a.map((v, i) => lerp(v, b[i], t))

/** Named spots in the scene (u, v in 0…1 of width, height). */
export const SCENE_SPOTS = {
  ball: [0.2, 0.6],
  block: [0.56, 0.66],
  cup: [0.84, 0.62],
  table: [0.45, 0.82],
  tape: [0.62, 0.9],
  wall: [0.5, 0.18],
  shadow: [0.31, 0.75],
} as const

/** Scene colour (0…255 RGB before lighting) at (u, v); `X` = u in height units. */
function tabletopAt(u: number, v: number): number[] {
  const X = u * ASPECT
  const ball = { x: 0.27, y: 0.6, r: 0.13 }
  const dx = (X - ball.x) / ball.r
  const dy = (v - ball.y) / ball.r
  if (dx * dx + dy * dy < 1) {
    const nz = Math.sqrt(1 - dx * dx - dy * dy)
    const d = Math.max(0, dx * LIGHT_DIR[0] + dy * LIGHT_DIR[1] + nz * LIGHT_DIR[2])
    const spec = Math.max(0, d) ** 40
    return mix3([215 * (0.22 + 0.78 * d), 38 * (0.22 + 0.78 * d), 32 * (0.22 + 0.78 * d)], [255, 245, 235], spec * 0.85)
  }
  const cup = { x0: 1.03, x1: 1.21, y0: 0.47, y1: 0.73 }
  if (X > cup.x0 && X < cup.x1 && v > cup.y0 - 0.025 && v < cup.y1) {
    const t = ((X - cup.x0) / (cup.x1 - cup.x0)) * 2 - 1
    const rim = (v - cup.y0) ** 2 / 0.025 ** 2 + t * t < 1
    if (rim) return v < cup.y0 ? [30, 60, 140] : [20, 35, 80]
    if (v > cup.y0) return [40, 95, 215].map((c) => c * (0.35 + 0.65 * Math.max(0, Math.cos(t * 1.4 + 0.45))))
  }
  if (X > 0.66 && X < 0.92 && v > 0.48 && v < 0.78) return v < 0.54 ? [120, 215, 120] : [50, 160, 70].map((c) => c * (X < 0.7 ? 0.75 : 1))
  if (v < 0.42) {
    const win = X > 0.85 && X < 1.2 && v > 0.06 && v < 0.3
    if (win) return v < 0.18 === X < 1.025 ? [205, 225, 240] : [185, 210, 235]
    return [78, 86, 102].map((c) => c * (0.85 + 0.3 * v))
  }
  if (v < 0.45) return [60, 42, 28]
  const grain = 0.9 + 0.1 * Math.sin(X * 46 + Math.sin(v * 9) * 2.4)
  let wood = [172, 122, 76].map((c) => c * grain)
  if (v > 0.86 && v < 0.91 && X > 0.1) wood = [235, 200, 45]
  const sh = ((X - 0.4) / 0.2) ** 2 + ((v - 0.74) / 0.04) ** 2
  const shadow = sh < 1 ? 0.45 + 0.55 * sh : 1
  const blockShadow = X > 0.92 && X < 1.0 && v > 0.62 && v < 0.78 ? 0.6 : 1
  return wood.map((c) => c * shadow * blockShadow)
}

/** The tabletop scene rendered at w × h with 2 × 2 supersampling; `light` scales exposure (1 = normal), plus a lamp pool and vignette. */
export function tabletopImg(w: number, h: number, light = 1): Img {
  const img = makeImg(w, h, 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0]
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const c = tabletopAt((x + sx) / w, (y + sy) / h)
        for (let k = 0; k < 3; k++) acc[k] += c[k] / 4
      }
      const u = (x + 0.5) / w - 0.5
      const v = (y + 0.5) / h - 0.5
      const vignette = 1 - 0.55 * (u * u + v * v)
      setPixel(img, x, y, acc.map((c) => clamp(c * light * vignette, 0, 255)))
    }
  return img
}

// --- Colour ---

/** Luma (BT.601) of an RGB triple. */
export const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

export function grayImg(img: Img): Img {
  if (img.ch === 1) return img
  const out = makeImg(img.w, img.h, 1)
  for (let i = 0; i < img.w * img.h; i++) out.data[i] = lumaOf(img.data[3 * i], img.data[3 * i + 1], img.data[3 * i + 2])
  return out
}

/** One channel of an RGB image as a grey image. */
export function channelImg(img: Img, c: number): Img {
  const out = makeImg(img.w, img.h, 1)
  for (let i = 0; i < img.w * img.h; i++) out.data[i] = img.data[i * img.ch + c]
  return out
}

function hueOf(r: number, g: number, b: number, max: number, d: number) {
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return (h + 360) % 360
}
/** RGB 0…255 → [hue 0…360°, saturation 0…1, value 0…1]. Grey has hue 0 by convention. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  return [hueOf(r, g, b, max, d), max > 0 ? d / max : 0, max / 255]
}

/** [hue °, saturation 0…1, value 0…1] → RGB 0…255. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return 255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [f(5), f(3), f(1)]
}

/** Shortest distance between two hues (°). */
export const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/** 255 where hue is within `tol`° of `hue` and saturation ≥ `sMin`, value ≥ `vMin`; else 0. */
export function hsvMask(img: Img, hue: number, tol: number, sMin: number, vMin: number): Img {
  const out = makeImg(img.w, img.h, 1)
  const d = img.data
  for (let i = 0; i < img.w * img.h; i++) {
    const r = d[3 * i]
    const g = d[3 * i + 1]
    const b = d[3 * i + 2]
    const max = Math.max(r, g, b)
    const span = max - Math.min(r, g, b)
    if (max / 255 < vMin || max === 0 || span / max < sMin) continue
    out.data[i] = hueGap(hueOf(r, g, b, max, span), hue) <= tol ? 255 : 0
  }
  return out
}

// --- Histograms and thresholds ---

/** Counts of channel `c` in `bins` bins over 0…255. */
export const imgHistogram = (img: Img, bins = 256, c = 0) => histogram(Array.from(channelImg(img, c).data), bins)

/** Mean and standard deviation of channel `c`. */
export function imgStats(img: Img, c = 0) {
  const n = img.w * img.h
  let s = 0
  let s2 = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    const v = img.data[i * img.ch + c]
    s += v
    s2 += v * v
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const mean = s / n
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), min: lo, max: hi }
}

/** Running share of pixels at or below each bin (0…1). */
export function cumulative(hist: readonly number[]) {
  const total = hist.reduce((a, b) => a + b, 0) || 1
  let run = 0
  return hist.map((c) => (run += c) / total)
}

/** Otsu's level: the value t splitting the histogram (bins over 0…255) so the between-class variance is largest; foreground = v ≥ t. */
export function otsuLevel(hist: readonly number[]) {
  const bins = hist.length
  const total = hist.reduce((a, b) => a + b, 0)
  const sumAll = hist.reduce((a, c, i) => a + c * i, 0)
  let wB = 0
  let sumB = 0
  let best = 0
  let bestK = 1
  for (let k = 1; k < bins; k++) {
    wB += hist[k - 1]
    sumB += (k - 1) * hist[k - 1]
    const wF = total - wB
    if (wB === 0 || wF === 0) continue
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2
    if (between > best) [best, bestK] = [between, k]
  }
  return (bestK * 256) / bins
}

/** Binary image: 255 where channel 0 ≥ t (or < t if `invert`). */
export const thresholdImg = (img: Img, t: number, invert = false): Img => {
  const out = makeImg(img.w, img.h, 1)
  for (let i = 0; i < img.w * img.h; i++) out.data[i] = img.data[i * img.ch] >= t !== invert ? 255 : 0
  return out
}

/** White pixel count and centroid (px) of a binary image. */
export function maskStats(mask: Img) {
  let count = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.data[(y * mask.w + x) * mask.ch] > 127) {
        count++
        sx += x
        sy += y
      }
  return { count, share: count / (mask.w * mask.h), cx: count ? sx / count : NaN, cy: count ? sy / count : NaN }
}

/** Brightness/contrast about mid-grey: (v − 128) × contrast + 128 + offset, clipped to 0…255. */
export const contrastImg = (img: Img, contrast: number, offset = 0) => mapImg(img, (v) => clamp((v - 128) * contrast + 128 + offset, 0, 255))

/** Histogram equalisation of a grey image: each value → 255 × its cumulative share. */
export function equalizeImg(img: Img): Img {
  const cdf = cumulative(imgHistogram(img, 256))
  const c0 = cdf.find((c) => c > 0) ?? 0
  return mapImg(img, (v) => clamp(Math.round(((cdf[clamp(Math.floor(v), 0, 255)] - c0) / Math.max(1e-9, 1 - c0)) * 255), 0, 255))
}

// --- Filters, sampling, noise, bit depth ---

export type Kernel = readonly (readonly number[])[]

export const KERNELS = {
  box: [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((r) => r.map((v) => v / 9)),
  gauss: [[1, 2, 1], [2, 4, 2], [1, 2, 1]].map((r) => r.map((v) => v / 16)),
  sharpen: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
  sobelX: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
  sobelY: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
} satisfies Record<string, Kernel>

/** Correlate every channel with an odd-sized kernel, edges clamped; results are not clipped (Sobel goes negative). */
export function convolveImg(img: Img, k: Kernel): Img {
  const out = makeImg(img.w, img.h, img.ch)
  const r = (k.length - 1) / 2
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      for (let c = 0; c < img.ch; c++) {
        let s = 0
        for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) s += k[j + r][i + r] * imgAt(img, x + i, y + j, c)
        out.data[(y * img.w + x) * img.ch + c] = s
      }
  return out
}

/** Resample to w × h: nearest pixel or bilinear between the four around each sample centre. */
export function resizeImg(img: Img, w: number, h: number, mode: 'nearest' | 'bilinear' = 'bilinear'): Img {
  const out = makeImg(w, h, img.ch)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * img.w) / w - 0.5
      const sy = ((y + 0.5) * img.h) / h - 0.5
      for (let c = 0; c < img.ch; c++) {
        let v: number
        if (mode === 'nearest') v = imgAt(img, sx, sy, c)
        else {
          const x0 = Math.floor(sx)
          const y0 = Math.floor(sy)
          const fx = sx - x0
          const fy = sy - y0
          const at = (i: number, j: number) => img.data[(clamp(j, 0, img.h - 1) * img.w + clamp(i, 0, img.w - 1)) * img.ch + c]
          v = lerp(lerp(at(x0, y0), at(x0 + 1, y0), fx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy)
        }
        out.data[(y * w + x) * img.ch + c] = v
      }
    }
  return out
}

/** Repeatable Gaussian noise of `sigma` (0…255 units), clipped; `seed` picks the draw. */
export const noisyImg = (img: Img, sigma: number, seed = 0) => ({ ...img, data: img.data.map((v, i) => clamp(v + sigma * gaussAt(seed * 100003 + i), 0, 255)) })

const GRAIN = Array.from({ length: 8191 }, (_, i) => gaussAt(i * 31 + 7))
/** Repeatable Gaussian sample `i` of grain draw `seed` (a cached 8191-sample table walked with a per-seed stride). */
export const grainAt = (i: number, seed: number) => GRAIN[(i * (2 * seed + 1) + seed * 977) % GRAIN.length]
/** Fast repeatable Gaussian grain, σ in grey levels. */
export const grainImg = (img: Img, sigma: number, seed = 1): Img => ({ ...img, data: img.data.map((v, i) => clamp(v + sigma * grainAt(i, seed), 0, 255)) })

/** Bilinear sample, pixel centres at integers. */
export function sampleImg(img: Img, x: number, y: number) {
  const x0 = clamp(Math.floor(x), 0, img.w - 1)
  const y0 = clamp(Math.floor(y), 0, img.h - 1)
  const x1 = Math.min(x0 + 1, img.w - 1)
  const y1 = Math.min(y0 + 1, img.h - 1)
  const fx = clamp(x - x0, 0, 1)
  const fy = clamp(y - y0, 0, 1)
  const at = (u: number, v: number) => img.data[(v * img.w + u) * img.ch]
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
}

/** Values re-quantised to `bits` per channel (ADC codes stretched back to 0…255). */
export const bitDepthImg = (img: Img, bits: number) => mapImg(img, (v) => (quantize(v, 256, bits) * 255) / (2 ** bits - 1))

/** Intersection over union of two binary images (1 when both are empty). */
export function maskIoU(a: Img, b: Img) {
  let both = 0
  let either = 0
  for (let i = 0; i < a.w * a.h; i++) {
    const x = a.data[i * a.ch] > 127
    const y = b.data[i * b.ch] > 127
    if (x && y) both++
    if (x || y) either++
  }
  return either ? both / either : 1
}
