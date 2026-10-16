// Fiducial tags (ArUco/AprilTag style): a 4 × 4 bit code inside a black border, a small dictionary with Hamming-distance error
// correction and rotation, rendering into the camera image, detection (adaptive threshold → quad → unwarp → bits → ID) and pose.
import { clamp, stdDev } from '../common'
import { P3 } from '../room'
import { Mat } from '../control/linalg'
import { chain4, rotAbout4 } from '../kinematics/transforms'
import { Mat4, invert4 } from '../software/urdf'
import { Img, grainImg, grayImg, makeImg, sampleImg } from './image'
import { labelBlobs } from './tracking'
import { Intrinsics } from './projection'
import { Plate, RenderScene, renderView } from './render'
import { applyH, homography, poseFromH } from './calibration'

type V2 = [number, number]
type Rgb = [number, number, number]

export const TAG_BITS = 4
/** Cells across the black square: bits + 1-cell border each side. */
export const TAG_CELLS = TAG_BITS + 2
/** 8 codes, every pair (and every code with its own turns) ≥ 6 bits apart in all 4 rotations. */
export const TAG_DICT = [0xdc16, 0xf538, 0xa54b, 0x9e63, 0x70ca, 0x0fea, 0x1522, 0x2e90]
export const TAG_MIN_DIST = 6
export const TAG_CORRECT = Math.floor((TAG_MIN_DIST - 1) / 2)

/** Code → 16 bits, row by row from the top-left (1 = white). */
export const tagBits = (code: number) => Array.from({ length: TAG_BITS * TAG_BITS }, (_, i) => Math.floor(code / 2 ** (TAG_BITS * TAG_BITS - 1 - i)) % 2)

/** Bit grid turned `q` quarter-turns clockwise. */
export function rotBits(bits: readonly number[], q: number): number[] {
  let b = [...bits]
  const n = TAG_BITS
  for (let k = 0; k < ((q % 4) + 4) % 4; k++) b = b.map((_, i) => b[(n - 1 - (i % n)) * n + Math.floor(i / n)])
  return b
}

export const hamming = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + (x !== b[i] ? 1 : 0), 0)

export interface TagCode { id: number; rot: number; dist: number; fixed: number[] }
/** Nearest dictionary code over all 4 turns; `rot` = how far the seen grid is turned clockwise; null if more than `maxErr` bits off. */
export function decodeTag(bits: readonly number[], dict = TAG_DICT, maxErr = TAG_CORRECT): TagCode | null {
  let best: TagCode | null = null
  dict.forEach((code, id) => {
    for (let rot = 0; rot < 4; rot++) {
      const ref = rotBits(tagBits(code), rot)
      const dist = hamming(ref, bits)
      if (!best || dist < best.dist) best = { id, rot, dist, fixed: ref.flatMap((b, i) => (b !== bits[i] ? [i] : [])) }
    }
  })
  return best && (best as TagCode).dist <= maxErr ? best : null
}

const BITS = new Map<number, number[]>()

/** Print colour at tag coords (x right, y up, metres, centre origin): black border, bits, one white cell of margin; `flip` = smudged bit indices. */
export function tagColor(code: number, size: number, x: number, y: number, flip: readonly number[] = []): Rgb | null {
  const cell = size / TAG_CELLS
  const c = Math.floor((x + size / 2) / cell)
  const r = Math.floor((size / 2 - y) / cell)
  if (c < -1 || r < -1 || c > TAG_CELLS || r > TAG_CELLS) return null
  const white: Rgb = [232, 232, 226]
  const black: Rgb = [26, 28, 32]
  if (c < 0 || r < 0 || c >= TAG_CELLS || r >= TAG_CELLS) return white
  if (c === 0 || r === 0 || c === TAG_CELLS - 1 || r === TAG_CELLS - 1) return black
  const i = (r - 1) * TAG_BITS + (c - 1)
  const bits = BITS.get(code) ?? BITS.set(code, tagBits(code)).get(code)!
  const bit = flip.includes(i) ? 1 - bits[i] : bits[i]
  return bit ? white : black
}

export const tagPlate = (tf: Mat4, code: number, size: number, flip: readonly number[] = []): Plate => ({ tf, color: (x, y) => tagColor(code, size, x, y, flip) })

/** Tag corners in tag coords, OpenCV order: top-left, top-right, bottom-right, bottom-left. */
export const tagCorners = (size: number): P3[] => [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => [(x * size) / 2, (y * size) / 2, 0])

// --- Detection ---

/** Dark where a pixel is `c` below the mean of its (2r+1)² box (integral image); also returns the local means. */
export function adaptiveThreshold(gray: Img, r = 5, c = 10) {
  const { w, h } = gray
  const S = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++)
    for (let x = 0, row = 0; x < w; x++) {
      row += gray.data[(y * w + x) * gray.ch]
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row
    }
  const mask = makeImg(w, h, 1)
  const mean = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [x0, y0, x1, y1] = [Math.max(0, x - r), Math.max(0, y - r), Math.min(w, x + r + 1), Math.min(h, y + r + 1)]
      const m = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0))
      mean[y * w + x] = m
      mask.data[y * w + x] = gray.data[(y * w + x) * gray.ch] < m - c ? 255 : 0
    }
  return { mask, mean }
}

const cross2 = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Total-least-squares line n·p = d through points. */
function fitLine(pts: V2[]) {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let [a, b, c] = [0, 0, 0]
  for (const [x, y] of pts) {
    a += (x - mx) ** 2
    b += (x - mx) * (y - my)
    c += (y - my) ** 2
  }
  const th = 0.5 * Math.atan2(2 * b, a - c)
  const n: V2 = [-Math.sin(th), Math.cos(th)]
  return { n, d: n[0] * mx + n[1] * my }
}
const meet = (l: ReturnType<typeof fitLine>, m: ReturnType<typeof fitLine>): V2 => {
  const det = l.n[0] * m.n[1] - l.n[1] * m.n[0]
  return [(l.d * m.n[1] - l.n[1] * m.d) / det, (l.n[0] * m.d - l.d * m.n[0]) / det]
}

export interface TagQuad { corners: V2[]; fitErr: number; area: number; blob: number }

/**
 * Four-sided outline of one dark blob: outer edge points per row and column (sub-pixel, where the grey crosses the local mean),
 * rough corners by farthest points, then a line fit per side; null if it is not a clean quadrilateral.
 */
function quadOf(gray: Img, mean: Float32Array, labels: Int32Array, id: number, box: [number, number, number, number]): TagQuad | null {
  const { w } = gray
  const [bx0, by0, bx1, by1] = box
  const on = (x: number, y: number) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && labels[y * w + x] === id + 1
  const g = (x: number, y: number) => gray.data[(y * w + x) * gray.ch]
  let [dark, nd, light, nl] = [0, 0, 0, 0]
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      if (!on(x, y)) continue
      dark += g(x, y)
      nd++
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const [ox, oy] = [clamp(x + dx, 0, w - 1), clamp(y + dy, 0, gray.h - 1)]
        if (!on(ox, oy) && !on((x + ox) / 2, (y + oy) / 2) && labels[oy * w + ox] === 0) {
          light += g(ox, oy)
          nl++
        }
      }
    }
  const level = nl ? (dark / nd + light / nl) / 2 : NaN
  const edge = (x: number, y: number, dx: number, dy: number): V2 => {
    const m = Number.isFinite(level) ? level : mean[y * w + x]
    const inside = (k: number) => x + dx * k >= 0 && y + dy * k >= 0 && x + dx * k < w && y + dy * k < gray.h
    for (let k = 2; k >= -1; k--) {
      if (!inside(k) || !inside(k - 1)) continue
      const [go, gi] = [g(x + dx * k, y + dy * k), g(x + dx * (k - 1), y + dy * (k - 1))]
      if (go >= m && gi < m) {
        const t = (go - m) / (go - gi)
        return [x + dx * (k - t), y + dy * (k - t)]
      }
    }
    return [x + dx * 0.5, y + dy * 0.5]
  }
  const rowPts: V2[] = []
  const colPts: V2[] = []
  for (let y = by0; y <= by1; y++) {
    let [a, b] = [-1, -1]
    for (let x = bx0; x <= bx1; x++) if (on(x, y)) [a, b] = [a < 0 ? x : a, x]
    if (a >= 0) rowPts.push(edge(a, y, -1, 0), edge(b, y, 1, 0))
  }
  for (let x = bx0; x <= bx1; x++) {
    let [a, b] = [-1, -1]
    for (let y = by0; y <= by1; y++) if (on(x, y)) [a, b] = [a < 0 ? y : a, y]
    if (a >= 0) colPts.push(edge(x, a, 0, -1), edge(x, b, 0, 1))
  }
  const all = [...rowPts, ...colPts]
  const cx = all.reduce((s, p) => s + p[0], 0) / all.length
  const cy = all.reduce((s, p) => s + p[1], 0) / all.length
  const far = (from: V2, score: (p: V2) => number) => all.reduce((best, p) => (score(p) > score(best) ? p : best), from)
  const p0 = far(all[0], (p) => Math.hypot(p[0] - cx, p[1] - cy))
  const p2 = far(p0, (p) => Math.hypot(p[0] - p0[0], p[1] - p0[1]))
  const p1 = far(p0, (p) => cross2(p0, p2, p))
  const p3 = far(p0, (p) => -cross2(p0, p2, p))
  const rough = [p0, p1, p2, p3]
  const span = Math.hypot(p2[0] - p0[0], p2[1] - p0[1])
  if (span < 6 || cross2(p0, p2, p1) < span || -cross2(p0, p2, p3) < span) return null
  const lines = rough.map((a, i) => {
    const b = rough[(i + 1) % 4]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const pool = Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]) ? rowPts : colPts
    const pts = pool.filter((p) => {
      const s = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len)
      return s > 0.12 && s < 0.88 && Math.abs(cross2(a, b, p)) / len < 1.5
    })
    return { pts, line: pts.length >= 3 ? fitLine(pts) : null }
  })
  if (lines.some((l) => !l.line)) return null
  const fits = lines.map((l) => l.line!)
  const corners = fits.map((_, i) => meet(fits[(i + 3) % 4], fits[i]))
  const res = lines.flatMap((l) => l.pts.map((p) => (l.line!.n[0] * p[0] + l.line!.n[1] * p[1] - l.line!.d) ** 2))
  const fitErr = Math.sqrt(res.reduce((s, x) => s + x, 0) / res.length)
  const area = Math.abs(cross2(corners[0], corners[1], corners[2]) + cross2(corners[0], corners[2], corners[3])) / 2
  if (corners.some((c) => !Number.isFinite(c[0]) || Math.hypot(c[0] - cx, c[1] - cy) > span)) return null
  const order = corners.map((c) => Math.atan2(c[1] - cy, c[0] - cx))
  const sorted = [0, 1, 2, 3].sort((i, j) => order[i] - order[j]).map((i) => corners[i])
  return { corners: sorted, fitErr, area, blob: id }
}

/** Cell-centre greys of the unwarped square (6 × 6, row by row) through the cell-grid → image homography. */
function sampleCells(gray: Img, H: Mat) {
  const out: number[] = []
  for (let r = 0; r < TAG_CELLS; r++) for (let c = 0; c < TAG_CELLS; c++) out.push(sampleImg(gray, ...applyH(H, [c + 0.5, r + 0.5])))
  return out
}

export interface TagHit { id: number; rot: number; dist: number; fixed: number[]; corners: V2[]; samples: number[]; bits: number[]; level: number; quad: TagQuad; H: Mat }
export interface TagScan { gray: Img; mask: Img; quads: TagQuad[]; rejects: TagQuad[]; tags: TagHit[] }
const GRID_SQ: V2[] = [[0, 0], [TAG_CELLS, 0], [TAG_CELLS, TAG_CELLS], [0, TAG_CELLS]]

/** Full detector on one frame: adaptive threshold → dark blobs → quads → unwarp + sample → border check → decode; tag corners come back in tag order. */
export function findTags(img: Img, { r = 5, c = 10, minArea = 16, dict = TAG_DICT, maxErr = TAG_CORRECT } = {}): TagScan {
  const gray = img.ch === 1 ? img : grayImg(img)
  const { mask, mean } = adaptiveThreshold(gray, r, c)
  const { labels, blobs } = labelBlobs(mask, 4)
  const quads: TagQuad[] = []
  const rejects: TagQuad[] = []
  const tags: TagHit[] = []
  for (const b of blobs) {
    if (b.area < minArea || b.x0 <= 0 || b.y0 <= 0 || b.x1 >= gray.w - 1 || b.y1 >= gray.h - 1) continue
    const q = quadOf(gray, mean, labels, b.id, [b.x0, b.y0, b.x1, b.y1])
    if (!q) continue
    if (q.fitErr > 0.8 || q.area < minArea) {
      rejects.push(q)
      continue
    }
    quads.push(q)
    const H = homography(GRID_SQ, q.corners)
    const samples = sampleCells(gray, H)
    const border = samples.filter((_, i) => [0, TAG_CELLS - 1].includes(i % TAG_CELLS) || [0, TAG_CELLS - 1].includes(Math.floor(i / TAG_CELLS)))
    const dark = border.reduce((s, x) => s + x, 0) / border.length
    const level = (dark + Math.max(...samples)) / 2
    if (Math.max(...samples) - dark < 30 || border.filter((x) => x < level).length < border.length - 2) continue
    const bits = samples.flatMap((v, i) => {
      const [rr, cc] = [Math.floor(i / TAG_CELLS), i % TAG_CELLS]
      return rr > 0 && cc > 0 && rr < TAG_CELLS - 1 && cc < TAG_CELLS - 1 ? [v > level ? 1 : 0] : []
    })
    const code = decodeTag(bits, dict, maxErr)
    if (!code) continue
    const corners = [0, 1, 2, 3].map((i) => q.corners[(i + code.rot) % 4])
    tags.push({ ...code, corners, samples, bits, level, quad: q, H })
  }
  return { gray, mask, quads, rejects, tags }
}

/** Camera ← tag pose from its 4 pixel corners (tag order) and side length: homography → [R|t]. */
export function tagPose(k: Intrinsics, corners: readonly V2[], size: number): Mat4 {
  const obj = tagCorners(size).map(([x, y]) => [x, y] as V2)
  return poseFromH(k, homography(obj, corners as V2[]))
}

/** World ← robot from a seen tag: world ← tag (map) · tag ← camera · camera ← robot. */
export const robotFromTag = (worldTag: Mat4, camTag: Mat4, robotCam: Mat4) => chain4(worldTag, invert4(camTag), invert4(robotCam))

export interface JitterCfg { k: Intrinsics; Twc: Mat4; worldTag: Mat4; code: number; size: number; noise: number; frames: number; scene?: RenderScene; aa?: number }
/** One clean render, then `frames` noisy copies through the detector: per frame the image, the scan and camera ← tag (null if missed). */
export function tagJitterRun(c: JitterCfg) {
  const scene: RenderScene = { ...c.scene, plates: [...(c.scene?.plates ?? []), tagPlate(c.worldTag, c.code, c.size)] }
  const clean = renderView(c.k, c.Twc, scene, c.k.w, c.k.h, undefined, c.aa ?? 2)
  const truth = chain4(invert4(c.Twc), c.worldTag)
  const frames = Array.from({ length: c.frames }, (_, i) => {
    const img = c.noise > 0 ? grainImg(clean, c.noise, i + 1) : clean
    const scan = findTags(img)
    const hit = scan.tags.find((t) => t.id === TAG_DICT.indexOf(c.code)) ?? null
    return { img, scan, hit, pose: hit ? tagPose(c.k, hit.corners, c.size) : null }
  })
  return { clean, truth, frames }
}

/** Spread of a set of 3-vectors: per-axis σ. */
export const spread3 = (ps: readonly P3[]): P3 => [0, 1, 2].map((i) => (ps.length > 1 ? stdDev(ps.map((p) => p[i])) : 0)) as P3

/** World ← tag for a tag stood upright at `pos`, its face (tag z) pointing along heading `facing` (0 = world +X), turned `roll` in its own plane. */
export function wallTagTf(pos: P3, facing: number, roll = 0): Mat4 {
  const [co, si] = [Math.cos(facing), Math.sin(facing)]
  return chain4([-si, 0, co, pos[0], co, 0, si, pos[1], 0, 1, 0, pos[2], 0, 0, 0, 1], rotAbout4(2, roll))
}
