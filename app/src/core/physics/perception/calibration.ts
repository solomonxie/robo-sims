// Checkerboard calibration: DLT homographies, Zhang's closed form, linear k1/k2, LM refinement and reprojection error.
import { gaussAt } from '../common'
import { P3 } from '../room'
import { Mat, cholSolve, matInv, symEig } from '../control/linalg'
import { chain4, rotAbout4, trans4 } from '../kinematics/transforms'
import { Mat4, apply4 } from '../software/urdf'
import { distort } from '../sensors/camera'
import { Intrinsics, Lens, NO_LENS, inImage, kMatrix, toPixel } from './projection'

type V2 = [number, number]

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

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
function fitRadial(k: Intrinsics, poses: Mat4[], pts: P3[], obs: V2[][]): Lens {
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
function refineCalibration(k0: Intrinsics, lens0: Lens, poses0: Mat4[], pts: P3[], obs: V2[][], radial = true, iters = 40) {
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
