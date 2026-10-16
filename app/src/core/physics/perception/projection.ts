// Camera model: intrinsics K, extrinsics [R|t], pinhole projection and back-projection, ground-plane hits, a tiny ray-cast renderer,
// checkerboard calibration (DLT homographies, Zhang's closed form, linear k1/k2, reprojection error) and stereo triangulation.
import { DEG, clamp, gaussAt, hash01 } from '../common'
import { P3 } from '../room'
import { Mat, cholSolve, matInv, symEig } from '../control/linalg'
import { chain4, rotAbout4, trans4 } from '../kinematics/transforms'
import { Mat4, apply4, invert4 } from '../software/urdf'
import { distort, undistort } from '../sensors/camera'
import { Img, makeImg } from './image'

type V2 = [number, number]
type Rgb = [number, number, number]

/** Pixel units; pixel centres at integers, (0, 0) top-left, v down. */
export interface Intrinsics { fx: number; fy: number; cx: number; cy: number; w: number; h: number }
/** Radial distortion in normalized coords (x/z, y/z). */
export interface Lens { k1: number; k2: number }
export const NO_LENS: Lens = { k1: 0, k2: 0 }

export const focalPx = (fovDeg: number, sizePx: number) => sizePx / 2 / Math.tan((fovDeg * DEG) / 2)
export const fovOfFocal = (fPx: number, sizePx: number) => (2 * Math.atan(sizePx / 2 / fPx)) / DEG

/** Square pixels, principal point at the image centre, horizontal field of view `hfovDeg`. */
export function intrinsicsOf(w: number, h: number, hfovDeg: number): Intrinsics {
  const f = focalPx(hfovDeg, w)
  return { fx: f, fy: f, cx: (w - 1) / 2, cy: (h - 1) / 2, w, h }
}
export const kMatrix = (k: Intrinsics): Mat => [[k.fx, 0, k.cx], [0, k.fy, k.cy], [0, 0, 1]]

/** World (z up) ← camera (x right, y down, z forward) for a camera at `pos`, heading `yaw` (0 = world +X, + = left) and pitched down `tilt`. */
export function camTf(pos: P3, yaw: number, tilt: number): Mat4 {
  const base = [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1]
  return chain4(trans4(pos), rotAbout4(2, yaw), rotAbout4(1, tilt), base)
}

/** Corner-normalized lens (r = 1 at the sensor corner, as `LENSES`) → normalized-coords lens for intrinsics `k`. */
export function lensFor(l: Lens, k: Intrinsics): Lens {
  const rc2 = ((k.w / 2) / k.fx) ** 2 + ((k.h / 2) / k.fy) ** 2
  return { k1: l.k1 / rc2, k2: l.k2 / rc2 ** 2 }
}

/** Camera-frame point → pixel (u, v) and depth z (z ≤ 0: behind the camera). */
export function toPixel(k: Intrinsics, pc: P3, lens: Lens = NO_LENS): [number, number, number] {
  const [x, y] = distort([pc[0] / pc[2], pc[1] / pc[2]], lens.k1, lens.k2)
  return [k.fx * x + k.cx, k.fy * y + k.cy, pc[2]]
}

/** World point → pixel through camera pose `Twc` (world ← camera). */
export const projectPx = (k: Intrinsics, Twc: Mat4, p: P3, lens: Lens = NO_LENS) => toPixel(k, apply4(invert4(Twc), p), lens)

export const inImage = (k: Intrinsics, u: number, v: number) => u >= -0.5 && v >= -0.5 && u <= k.w - 0.5 && v <= k.h - 0.5

export interface Ray { o: P3; d: P3 }
/** Pixel → unit ray in the world: undistort, K⁻¹, rotate by R. */
export function pixelRay(k: Intrinsics, Twc: Mat4, u: number, v: number, lens: Lens = NO_LENS): Ray {
  const xd = (u - k.cx) / k.fx
  const yd = (v - k.cy) / k.fy
  const [x, y] = lens.k1 || lens.k2 ? undistort([xd, yd], lens.k1, lens.k2) : [xd, yd]
  const n = Math.hypot(x, y, 1)
  const c = [x / n, y / n, 1 / n]
  return { o: [Twc[3], Twc[7], Twc[11]], d: [0, 1, 2].map((r) => Twc[r * 4] * c[0] + Twc[r * 4 + 1] * c[1] + Twc[r * 4 + 2] * c[2]) as P3 }
}

export const rayAt = (r: Ray, s: number): P3 => [r.o[0] + r.d[0] * s, r.o[1] + r.d[1] * s, r.o[2] + r.d[2] * s]

/** Where a ray meets the floor z = `z0`, or null if it never comes down to it. */
export function groundHit(r: Ray, z0 = 0): P3 | null {
  if (r.d[2] >= -1e-9) return null
  return rayAt(r, (z0 - r.o[2]) / r.d[2])
}

/** Image row of the horizon and floor distance seen along the optical axis, for a level camera `h` up, tilted down `tilt`. */
export function groundSpan(k: Intrinsics, h: number, tilt: number) {
  const vfov = 2 * Math.atan(k.h / 2 / k.fy)
  return {
    horizonV: k.cy - k.fy * Math.tan(tilt),
    centreM: tilt > 1e-6 ? h / Math.tan(tilt) : Infinity,
    nearM: tilt + vfov / 2 < Math.PI / 2 ? h / Math.tan(tilt + vfov / 2) : 0,
    farM: tilt - vfov / 2 > 1e-6 ? h / Math.tan(tilt - vfov / 2) : Infinity,
  }
}

// --- Ray-cast renderer ---

export interface Ball { c: P3; r: number; rgb: Rgb; speckle?: number }
export interface Board { tf: Mat4; nx: number; ny: number; sq: number }
/** Any flat print: `color(x, y)` in plate coords (z = 0 plane of `tf`, world ← plate), null where there is no plate. */
export interface Plate { tf: Mat4; color: (x: number, y: number) => Rgb | null }
export interface RenderScene { floor?: { tile: number; a: Rgb; b: Rgb; x?: [number, number]; y?: [number, number]; off?: Rgb }; balls?: Ball[]; board?: Board; plates?: Plate[]; wallX?: number; sky?: Rgb }

const LIGHT: P3 = (() => {
  const l = [0.35, 0.45, 0.82]
  const n = Math.hypot(...l)
  return l.map((x) => x / n) as P3
})()
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]

/** Repeatable two-scale dot texture (0.45…1) at unit direction `n`, `cells` around the equator: gives block matching something to lock onto. */
function speckleAt(n: readonly number[], cells: number) {
  const lon = (Math.atan2(n[1], n[0]) / (2 * Math.PI) + 0.5) * cells
  const lat = (Math.asin(clamp(n[2], -1, 1)) / Math.PI + 0.5) * cells * 0.5
  const fine = hash01(Math.floor(lon) * 7919 + Math.floor(lat) * 104729)
  const coarse = hash01(Math.floor(lon / 4) * 15485863 + Math.floor(lat / 4) * 32452843 + 17)
  return 0.45 + 0.3 * fine + 0.25 * coarse
}

/** Board-plane colour at board coords (x, y): black/white squares with a one-square white margin, null off the board. */
export function boardColor(b: Board, x: number, y: number): Rgb | null {
  const hx = ((b.nx + 1) / 2 + 1) * b.sq
  const hy = ((b.ny + 1) / 2 + 1) * b.sq
  if (Math.abs(x) > hx || Math.abs(y) > hy) return null
  const ix = Math.floor(x / b.sq + (b.nx + 1) / 2)
  const iy = Math.floor(y / b.sq + (b.ny + 1) / 2)
  const inside = ix >= 0 && ix <= b.nx && iy >= 0 && iy <= b.ny
  return inside && (ix + iy) % 2 === 0 ? [28, 30, 36] : [236, 236, 230]
}

function hitScene(s: RenderScene, r: Ray, boardInv: Mat4 | null, plateInv: Mat4[] = []): Rgb {
  let best = Infinity
  let col: Rgb = s.sky ?? [70, 80, 96]
  for (const b of s.balls ?? []) {
    const oc = [r.o[0] - b.c[0], r.o[1] - b.c[1], r.o[2] - b.c[2]]
    const hb = dot(oc, r.d)
    const disc = hb * hb - (dot(oc, oc) - b.r * b.r)
    if (disc < 0) continue
    const t = -hb - Math.sqrt(disc)
    if (t <= 1e-6 || t >= best) continue
    best = t
    const p = rayAt(r, t)
    const nrm = [(p[0] - b.c[0]) / b.r, (p[1] - b.c[1]) / b.r, (p[2] - b.c[2]) / b.r]
    col = shade(b.rgb, (0.35 + 0.65 * Math.max(0, dot(nrm, LIGHT))) * (b.speckle ? speckleAt(nrm, b.speckle) : 1))
  }
  const flat = (inv: Mat4, paint: (x: number, y: number) => Rgb | null) => {
    const o = apply4(inv, r.o)
    const d = [0, 1, 2].map((i) => inv[i * 4] * r.d[0] + inv[i * 4 + 1] * r.d[1] + inv[i * 4 + 2] * r.d[2])
    if (Math.abs(d[2]) <= 1e-9) return
    const t = -o[2] / d[2]
    const c = t > 1e-6 && t < best ? paint(o[0] + d[0] * t, o[1] + d[1] * t) : null
    if (c) {
      best = t
      col = c
    }
  }
  const board = s.board
  if (board && boardInv) flat(boardInv, (x, y) => boardColor(board, x, y))
  s.plates?.forEach((p, i) => flat(plateInv[i], p.color))
  if (s.wallX !== undefined && r.d[0] > 1e-9) {
    const t = (s.wallX - r.o[0]) / r.d[0]
    const p = rayAt(r, t)
    if (t < best && p[2] >= 0) {
      best = t
      const brick = (Math.floor(p[2] / 0.08) % 2 ? 0.5 : 0) + p[1] / 0.2
      col = (Math.floor(p[2] / 0.08) + Math.floor(brick)) % 7 === 0 ? [150, 120, 92] : (Math.floor(brick) % 3 === 0 ? [168, 160, 146] : [188, 182, 168])
    }
  }
  if (s.floor && r.d[2] < -1e-9) {
    const t = -r.o[2] / r.d[2]
    if (t < best) {
      const p = rayAt(r, t)
      const f = s.floor
      const out = (f.x && (p[0] < f.x[0] || p[0] > f.x[1])) || (f.y && (p[1] < f.y[0] || p[1] > f.y[1]))
      const odd = (Math.floor(p[0] / f.tile) + Math.floor(p[1] / f.tile)) % 2 !== 0
      col = out ? (f.off ?? [30, 32, 38]) : shade(odd ? f.b : f.a, 1 / (1 + 0.04 * t))
    }
  }
  return col
}

/** Renders `s` as camera `k` at `Twc` sees it through `lens` on an `outW` × `outH` grid, `aa` × `aa` samples averaged per cell. */
export function renderView(k: Intrinsics, Twc: Mat4, s: RenderScene, outW = k.w, outH = k.h, lens: Lens = NO_LENS, aa = 1): Img {
  const img = makeImg(outW, outH, 3)
  const boardInv = s.board ? invert4(s.board.tf) : null
  const plateInv = (s.plates ?? []).map((p) => invert4(p.tf))
  for (let y = 0; y < outH; y++)
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 3
      for (let sy = 0; sy < aa; sy++)
        for (let sx = 0; sx < aa; sx++) {
          const c = hitScene(s, pixelRay(k, Twc, ((x + (sx + 0.5) / aa) * k.w) / outW - 0.5, ((y + (sy + 0.5) / aa) * k.h) / outH - 0.5, lens), boardInv, plateInv)
          for (let ch = 0; ch < 3; ch++) img.data[i + ch] += clamp(c[ch], 0, 255) / (aa * aa)
        }
    }
  return img
}

// --- Calibration ---

/** Inner corners of an `nx` × `ny` checkerboard, square `sq`, centred on the board origin (z = 0), row by row. */
export function boardPoints(nx: number, ny: number, sq: number): P3[] {
  const out: P3[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([(i - (nx - 1) / 2) * sq, (j - (ny - 1) / 2) * sq, 0])
  return out
}

/** `count` repeatable camera ← board poses, `dist` ahead, tipped up to ±35° and shifted around the frame. */
export function boardPoses(count: number, dist: number): Mat4[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i * 2.399963) % (2 * Math.PI)
    const tip = (0.25 + 0.36 * ((i * 0.618034) % 1)) * (i === 0 ? 0.3 : 1)
    const rx = tip * Math.cos(a)
    const ry = tip * Math.sin(a)
    const shift = i === 0 ? 0 : 0.18 * dist
    return chain4(trans4([shift * Math.cos(a + 1), shift * 0.7 * Math.sin(a + 1), dist * (1 + 0.25 * Math.sin(i * 1.7))]), rotAbout4(0, rx), rotAbout4(1, ry), rotAbout4(2, 0.15 * Math.sin(i * 2.3)))
  })
}

/** The first `count` of `boardPoses` whose corners all land inside the image (a detector needs the whole board). */
export function boardShots(k: Intrinsics, lens: Lens, count: number, dist: number, pts: P3[]): Mat4[] {
  return boardPoses(count * 6, dist)
    .filter((T) => pts.every((p) => {
      const [u, v, z] = toPixel(k, apply4(T, p), lens)
      return z > 0 && inImage(k, u, v)
    }))
    .slice(0, count)
}

/** Pixel corners of each view (camera ← board poses), distorted by `lens`, plus Gaussian noise `sigma` px. */
export function boardViews(k: Intrinsics, lens: Lens, poses: Mat4[], pts: P3[], sigma = 0, seed = 1): V2[][] {
  return poses.map((T, v) =>
    pts.map((p, i) => {
      const [u, w] = toPixel(k, apply4(T, p), lens)
      const g = seed * 7919 + v * 997 + i * 2
      return [u + sigma * gaussAt(g), w + sigma * gaussAt(g + 1)]
    }),
  )
}

/** Normalizing similarity (centroid to 0, mean distance √2) for DLT conditioning. */
function normalizer(pts: V2[]): Mat {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const md = pts.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) / pts.length || 1
  const s = Math.SQRT2 / md
  return [[s, 0, -s * mx], [0, s, -s * my], [0, 0, 1]]
}
const mul3 = (a: Mat, b: Mat): Mat => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]))
export const applyH = (H: Mat, [x, y]: readonly number[]): V2 => {
  const w = H[2][0] * x + H[2][1] * y + H[2][2]
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
}

/** Plane → image homography from ≥ 4 matches: normalized DLT, least squares with h33 = 1. */
export function homography(src: readonly V2[], dst: readonly V2[]): Mat {
  const Ns = normalizer(src as V2[])
  const Nd = normalizer(dst as V2[])
  const AtA: Mat = Array.from({ length: 8 }, () => Array(8).fill(0))
  const Atb = Array(8).fill(0)
  const addRow = (a: number[], b: number) => a.forEach((ai, i) => {
    Atb[i] += ai * b
    a.forEach((aj, j) => (AtA[i][j] += ai * aj))
  })
  src.forEach((s, i) => {
    const [x, y] = applyH(Ns, s)
    const [u, v] = applyH(Nd, dst[i])
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  })
  const inv = matInv(AtA)
  const h = inv.map((r) => r.reduce((s, x, j) => s + x * Atb[j], 0))
  const Hn: Mat = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]]
  const H = mul3(mul3(matInv(Nd), Hn), Ns)
  return H.map((r) => r.map((x) => x / H[2][2]))
}

/** Zhang's closed form: K (zero skew) from ≥ 2 board homographies. */
export function intrinsicsFromH(Hs: Mat[], w: number, h: number): Intrinsics {
  const v = (H: Mat, i: number, j: number) => [
    H[0][i] * H[0][j],
    H[0][i] * H[1][j] + H[1][i] * H[0][j],
    H[1][i] * H[1][j],
    H[2][i] * H[0][j] + H[0][i] * H[2][j],
    H[2][i] * H[1][j] + H[1][i] * H[2][j],
    H[2][i] * H[2][j],
  ]
  const sc = 2 / w
  const N: Mat = [[sc, 0, -sc * (w - 1) / 2], [0, sc, -sc * (h - 1) / 2], [0, 0, 1]]
  const rows = Hs.map((H0) => {
    const H = mul3(N, H0)
    const m = Math.hypot(...H.flat())
    return H.map((r) => r.map((x) => x / m))
  }).flatMap((H) => [v(H, 0, 1), v(H, 0, 0).map((x, k) => x - v(H, 1, 1)[k])])
  rows.push([0, 1, 0, 0, 0, 0])
  const VtV = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)))
  const { vectors } = symEig(VtV)
  let b = vectors[vectors.length - 1]
  if (b[0] < 0) b = b.map((x) => -x)
  const [B11, B12, B22, B13, B23, B33] = b
  const v0 = (B12 * B13 - B11 * B23) / (B11 * B22 - B12 * B12)
  const lam = B33 - (B13 * B13 + v0 * (B12 * B13 - B11 * B23)) / B11
  const fx = Math.sqrt(Math.abs(lam / B11))
  const fy = Math.sqrt(Math.abs((lam * B11) / (B11 * B22 - B12 * B12)))
  const u0 = (-B13 * fx * fx) / lam
  return { fx: fx / sc, fy: fy / sc, cx: u0 / sc + (w - 1) / 2, cy: v0 / sc + (h - 1) / 2, w, h }
}

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: number[]) => {
  const n = Math.hypot(a[0], a[1], a[2])
  return a.map((x) => x / n)
}

/** Camera ← board pose from K and a board homography: r1, r2, t = λK⁻¹h, Gram–Schmidt to a rotation. */
export function poseFromH(k: Intrinsics, H: Mat): Mat4 {
  const Ki = matInv(kMatrix(k))
  const col = (j: number) => [0, 1, 2].map((r) => Ki[r][0] * H[0][j] + Ki[r][1] * H[1][j] + Ki[r][2] * H[2][j])
  const [h1, h2, h3] = [col(0), col(1), col(2)]
  let lam = 2 / (Math.hypot(...h1) + Math.hypot(...h2))
  if (h3[2] * lam < 0) lam = -lam
  const r1 = unit(h1.map((x) => x * lam))
  const r2raw = h2.map((x) => x * lam)
  const r2 = unit(r2raw.map((x, i) => x - dot(r1, r2raw) * r1[i]))
  const r3 = cross(r1, r2)
  const t = h3.map((x) => x * lam)
  return [r1[0], r2[0], r3[0], t[0], r1[1], r2[1], r3[1], t[1], r1[2], r2[2], r3[2], t[2], 0, 0, 0, 1]
}

/** Linear least squares for k1, k2: observed − ideal = (ideal − c)·(k1 r² + k2 r⁴). */
export function fitRadial(k: Intrinsics, poses: Mat4[], pts: P3[], obs: V2[][]): Lens {
  let [a, b, c, d, e] = [0, 0, 0, 0, 0]
  poses.forEach((T, v) =>
    pts.forEach((p, i) => {
      const pc = apply4(T, p)
      const [x, y] = [pc[0] / pc[2], pc[1] / pc[2]]
      const r2 = x * x + y * y
      for (const [du, o, ideal] of [[k.fx * x, obs[v][i][0], k.fx * x + k.cx], [k.fy * y, obs[v][i][1], k.fy * y + k.cy]]) {
        const [m1, m2, rhs] = [du * r2, du * r2 * r2, o - ideal]
        a += m1 * m1
        b += m1 * m2
        c += m2 * m2
        d += m1 * rhs
        e += m2 * rhs
      }
    }),
  )
  const det = a * c - b * b
  return Math.abs(det) < 1e-12 ? NO_LENS : { k1: (c * d - b * e) / det, k2: (a * e - b * d) / det }
}

/** Per-corner reprojection error vectors (observed − predicted) and their RMS length. */
export function reprojection(k: Intrinsics, lens: Lens, poses: Mat4[], pts: P3[], obs: V2[][]) {
  let sum = 0
  let count = 0
  const errors = poses.map((T, v) =>
    pts.map((p, i): V2 => {
      const [u, w] = toPixel(k, apply4(T, p), lens)
      const e: V2 = [obs[v][i][0] - u, obs[v][i][1] - w]
      sum += e[0] ** 2 + e[1] ** 2
      count++
      return e
    }),
  )
  return { errors, rms: Math.sqrt(sum / Math.max(1, count)) }
}

export interface Calibration { k: Intrinsics; lens: Lens; poses: Mat4[]; rms: number; errors: V2[][]; linearRms: number }

/** Rotation matrix (row-major 3×3 as Mat4 rows 0…2) of rotation vector `w` (Rodrigues). */
function rodrigues(w: readonly number[]): Mat {
  const a = Math.hypot(w[0], w[1], w[2])
  if (a < 1e-12) return [[1, -w[2], w[1]], [w[2], 1, -w[0]], [-w[1], w[0], 1]]
  const [x, y, z] = w.map((v) => v / a)
  const [c, s] = [Math.cos(a), Math.sin(a)]
  const C = 1 - c
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]]
}

/** Levenberg–Marquardt on every parameter at once (fx, fy, cx, cy, k1, k2, and per view a rotation nudge + t), minimizing pixel reprojection error. */
export function refineCalibration(k0: Intrinsics, lens0: Lens, poses0: Mat4[], pts: P3[], obs: V2[][], radial = true, iters = 40) {
  let q = [k0.fx, k0.fy, k0.cx, k0.cy, lens0.k1, lens0.k2]
  let views = poses0.map((T) => ({ R: [[T[0], T[1], T[2]], [T[4], T[5], T[6]], [T[8], T[9], T[10]]] as Mat, t: [T[3], T[7], T[11]] }))
  const predict = (qq: number[], R: Mat, t: number[], p: P3): V2 => {
    const pc = [0, 1, 2].map((r) => R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2] + t[r])
    const [x, y] = distort([pc[0] / pc[2], pc[1] / pc[2]], qq[4], qq[5])
    return [qq[0] * x + qq[2], qq[1] * y + qq[3]]
  }
  const nudged = (R: Mat, w: number[]) => mul3(rodrigues(w), R)
  const cost = (qq: number[], vs: typeof views) => vs.reduce((s, v, i) => s + pts.reduce((a, p, j) => {
    const [u, w] = predict(qq, v.R, v.t, p)
    return a + (obs[i][j][0] - u) ** 2 + (obs[i][j][1] - w) ** 2
  }, 0), 0)
  const nq = radial ? 6 : 4
  const n = nq + 6 * views.length
  let lam = 1e-3
  let c0 = cost(q, views)
  const H = 1e-6
  for (let it = 0; it < iters; it++) {
    let done = true
    const JtJ: Mat = Array.from({ length: n }, () => Array(n).fill(0))
    const Jtr = Array(n).fill(0)
    views.forEach((v, vi) => {
      const Rs = [0, 1, 2].map((a) => nudged(v.R, [0, 1, 2].map((b) => (a === b ? H : 0))))
      pts.forEach((p, j) => {
        const base = predict(q, v.R, v.t, p)
        const cols: number[] = []
        const d: V2[] = []
        for (let a = 0; a < nq; a++) {
          const qq = [...q]
          qq[a] += a < 4 ? H * 1e3 : H
          const pp = predict(qq, v.R, v.t, p)
          cols.push(a)
          d.push([(pp[0] - base[0]) / (qq[a] - q[a]), (pp[1] - base[1]) / (qq[a] - q[a])])
        }
        for (let a = 0; a < 6; a++) {
          const pp = a < 3 ? predict(q, Rs[a], v.t, p) : predict(q, v.R, v.t.map((x, b) => x + (b === a - 3 ? H : 0)), p)
          cols.push(nq + 6 * vi + a)
          d.push([(pp[0] - base[0]) / H, (pp[1] - base[1]) / H])
        }
        const r = [obs[vi][j][0] - base[0], obs[vi][j][1] - base[1]]
        cols.forEach((ca, ia) => {
          Jtr[ca] += d[ia][0] * r[0] + d[ia][1] * r[1]
          cols.forEach((cb, ib) => (JtJ[ca][cb] += d[ia][0] * d[ib][0] + d[ia][1] * d[ib][1]))
        })
      })
    })
    for (let tries = 0; tries < 6; tries++) {
      const A = JtJ.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lam) + 1e-9 : x)))
      const step = cholSolve(A, Jtr)
      const q2 = q.map((x, a) => (a < nq ? x + step[a] : x))
      const v2 = views.map((v, vi) => ({ R: nudged(v.R, step.slice(nq + 6 * vi, nq + 6 * vi + 3)), t: v.t.map((x, b) => x + step[nq + 6 * vi + 3 + b]) }))
      const c2 = cost(q2, v2)
      if (c2 < c0) {
        done = c0 - c2 < 1e-9 * (1 + c0)
        ;[q, views, c0, lam] = [q2, v2, c2, Math.max(1e-7, lam / 3)]
        break
      }
      lam *= 8
    }
    if (done) break
  }
  const k: Intrinsics = { ...k0, fx: q[0], fy: q[1], cx: q[2], cy: q[3] }
  const poses = views.map(({ R, t }) => [...R[0], t[0], ...R[1], t[1], ...R[2], t[2], 0, 0, 0, 1])
  return { k, lens: { k1: q[4], k2: q[5] }, poses }
}

/** Board corners (z = 0) seen in ≥ 2 views → K, k1/k2 (if `radial`), every board pose, reprojection error.
 *  Closed form first (homographies → Zhang's K → poses → linear k1, k2), then Levenberg–Marquardt on all of it. */
export function calibrate(pts: P3[], obs: V2[][], w: number, h: number, radial = true): Calibration {
  const planar = pts.map((p): V2 => [p[0], p[1]])
  const Hs = obs.map((view) => homography(planar, view))
  const k0 = intrinsicsFromH(Hs, w, h)
  const poses0 = Hs.map((H) => poseFromH(k0, H))
  const lens0 = radial ? fitRadial(k0, poses0, pts, obs) : NO_LENS
  const linearRms = reprojection(k0, lens0, poses0, pts, obs).rms
  const { k, lens, poses } = refineCalibration(k0, lens0, poses0, pts, obs, radial)
  return { k, lens, poses, linearRms, ...reprojection(k, lens, poses, pts, obs) }
}

// --- Stereo ---

export const disparityPx = (fPx: number, baseM: number, z: number) => (fPx * baseM) / z
export const depthFromDisparity = (fPx: number, baseM: number, d: number) => (d > 0 ? (fPx * baseM) / d : Infinity)
/** Depth jump for a disparity error `dd`: ΔZ ≈ Z²·Δd / (f·B). */
export const depthStep = (fPx: number, baseM: number, z: number, dd: number) => (z * z * dd) / (fPx * baseM)

/** Rectified pair, left camera frame: Z = f·B/d, X = (uL − cx)·Z/fx, Y = (v − cy)·Z/fy. */
export function triangulate(k: Intrinsics, baseM: number, uL: number, uR: number, v: number): P3 {
  const z = depthFromDisparity(k.fx, baseM, uL - uR)
  return [((uL - k.cx) * z) / k.fx, ((v - k.cy) * z) / k.fy, z]
}

/** Pixels u0…u0 + w − 1 × v0…v0 + h − 1 of camera `k` as a camera of their own (render just that window). */
export const cropK = (k: Intrinsics, u0: number, v0: number, w: number, h: number): Intrinsics => ({ ...k, w, h, cx: k.cx - u0, cy: k.cy - v0 })

/** Rectified rig: left camera at `pos`, right one `baseM` to its right, both heading `yaw`, level. */
export function stereoRig(pos: P3, baseM: number, yaw = 0): [Mat4, Mat4] {
  const L = camTf(pos, yaw, 0)
  return [L, chain4(L, trans4([baseM, 0, 0]))]
}

/** SAD block match: the (2r+1)² block at column `xL`, row `y` of `L` against column `xR` − d, same row, of `R`, for d = 0…maxD
 *  (clipped so the block stays inside `R`); `xR` differs from `xL` only when the images are crops. `sub`: parabola fit to ¼ px. */
export function matchDisparity(L: Img, R: Img, xL: number, xR: number, y: number, r: number, maxD: number, sub = false) {
  const ch = L.ch
  const top = Math.max(0, y - r)
  const bottom = Math.min(L.h - 1, R.h - 1, y + r)
  const last = Math.min(maxD, xR - r)
  const costs: number[] = []
  for (let d = 0; d <= last; d++) {
    let s = 0
    for (let yy = top; yy <= bottom; yy++) {
      const il = (yy * L.w + xL - r) * ch
      const ir = (yy * R.w + xR - d - r) * ch
      for (let i = 0; i < (2 * r + 1) * ch; i++) s += Math.abs(L.data[il + i] - R.data[ir + i])
    }
    costs.push(s)
  }
  let best = 0
  costs.forEach((c, d) => (c < costs[best] ? (best = d) : 0))
  let d = best
  if (sub && best > 0 && best < costs.length - 1) {
    const [a, b, c] = [costs[best - 1], costs[best], costs[best + 1]]
    const den = a - 2 * b + c
    if (den > 0) d = best + Math.round((2 * (a - c)) / den) / 4
  }
  return { d, costs }
}
