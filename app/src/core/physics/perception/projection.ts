// Camera model: intrinsics K, extrinsics [R|t], pinhole projection and back-projection, ground-plane hits, stereo triangulation and block matching.
import { DEG } from '../common'
import { P3 } from '../room'
import { Mat } from '../control/linalg'
import { chain4, rotAbout4, trans4 } from '../kinematics/transforms'
import { Mat4, apply4, invert4 } from '../software/urdf'
import { distort, undistort } from '../sensors/camera'
import { Img } from './image'

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
