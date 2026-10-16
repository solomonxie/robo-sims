// Depth cameras: true depth images, a full stereo disparity map (SAD cost volume, ¼ px, texture + left-right checks), an active IR dot
// projector, a phase-based ToF camera (wrap, flying pixels, shot noise), back-projection to a point cloud, edge filter and voxel grid.
import { LIGHT_C, clamp, gaussAt, hash01 } from '../common'
import { chain4, trans4 } from '../kinematics/transforms'
import { P3 } from '../room'
import { Mat4, apply4, invert4 } from '../software/urdf'
import { Img, grainImg, lumaOf, makeImg } from './image'
import { Intrinsics, depthFromDisparity, pixelRay } from './projection'
import { RenderScene, sceneCaster } from './render'

/** Hole reasons in a depth image. */
export const DEPTH_HOLE = { ok: 0, unclear: 1, lr: 2, weak: 3 } as const

/** Optical-axis depth z per pixel (0 = nothing hit) and the camera image, one ray per pixel centre. */
export function depthView(k: Intrinsics, Twc: Mat4, s: RenderScene) {
  const cast = sceneCaster(s)
  const z = new Float32Array(k.w * k.h)
  const img = makeImg(k.w, k.h, 3)
  const ax = [Twc[2], Twc[6], Twc[10]]
  for (let v = 0; v < k.h; v++)
    for (let u = 0; u < k.w; u++) {
      const r = pixelRay(k, Twc, u, v)
      const h = cast(r)
      const i = v * k.w + u
      z[i] = Number.isFinite(h.t) ? h.t * (r.d[0] * ax[0] + r.d[1] * ax[1] + r.d[2] * ax[2]) : 0
      for (let c = 0; c < 3; c++) img.data[3 * i + c] = clamp(h.rgb[c], 0, 255)
    }
  return { z, img }
}

/** Projected IR dot brightness 0…1 at normalized projector coords (x/z, y/z): one jittered dot per `pitch` cell, ~70 % of cells lit. */
export function dotPattern(x: number, y: number, pitch: number) {
  const [i, j] = [Math.floor(x / pitch), Math.floor(y / pitch)]
  const seed = i * 92821 + j * 68917
  if (hash01(seed) > 0.7) return 0
  const cx = (i + 0.2 + 0.6 * hash01(seed + 1)) * pitch
  const cy = (j + 0.2 + 0.6 * hash01(seed + 2)) * pitch
  return Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (0.09 * pitch * pitch))
}

/** Grey (IR) image of `s`: scene luma × `ambient`, plus the dot pattern of a projector at `proj` (world ← projector) if given; `aa` × `aa` rays per pixel. */
export function irView(k: Intrinsics, Twc: Mat4, s: RenderScene, ambient: number, proj: Mat4 | null, pitch: number, gain = 170, aa = 2) {
  const cast = sceneCaster(s)
  const inv = proj ? invert4(proj) : null
  const img = makeImg(k.w, k.h, 1)
  for (let v = 0; v < k.h; v++)
    for (let u = 0; u < k.w; u++) {
      let g = 0
      for (let j = 0; j < aa; j++)
        for (let i = 0; i < aa; i++) {
          const r = pixelRay(k, Twc, u - 0.5 + (i + 0.5) / aa, v - 0.5 + (j + 0.5) / aa)
          const h = cast(r)
          const y = lumaOf(h.rgb[0], h.rgb[1], h.rgb[2])
          g += ambient * y
          if (inv && Number.isFinite(h.t)) {
            const q = apply4(inv, [r.o[0] + r.d[0] * h.t, r.o[1] + r.d[1] * h.t, r.o[2] + r.d[2] * h.t])
            if (q[2] > 0) g += gain * (0.5 + y / 510) * dotPattern(q[0] / q[2], q[1] / q[2], pitch)
          }
        }
      img.data[v * k.w + u] = clamp(g / (aa * aa), 0, 255)
    }
  return img
}

export interface DisparityMap { w: number; h: number; d: Float32Array; hole: Uint8Array }

/** Left-image disparity by SAD block matching on grey rectified images: a (2r+1)² block, d = 0…maxD, ¼ px parabola fit.
 *  Holes: `unclear` where the block's mean |∂I/∂x| is under `minTexture` or a match ≥ 2 px away costs within `unique` of the best;
 *  `lr` where matching back from the right image disagrees by > `lrTol` px. */
export function disparityMap(L: Img, R: Img, r: number, maxD: number, minTexture = 4, unique = 0.15, lrTol = 1): DisparityMap {
  const { w, h } = L
  const D = maxD + 1
  const cost = new Float32Array(w * h * D).fill(Infinity)
  const sat = new Float64Array((w + 1) * (h + 1))
  for (let d = 0; d <= maxD; d++) {
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += x >= d ? Math.abs(L.data[y * w + x] - R.data[y * w + x - d]) : 0
        sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row
      }
    }
    for (let y = r; y < h - r; y++)
      for (let x = r + d; x < w - r; x++) {
        const [x0, x1, y0, y1] = [x - r, x + r + 1, y - r, y + r + 1]
        cost[(y * w + x) * D + d] = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]
      }
  }
  const best = (i: number, step: number, n: number) => {
    let b = 0
    for (let d = 1; d < n; d++) if (cost[i + d * step] < cost[i + b * step]) b = d
    return b
  }
  const out = new Float32Array(w * h)
  const hole = new Uint8Array(w * h).fill(DEPTH_HOLE.lr)
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++) {
      const i = (y * w + x) * D
      const n = Math.min(maxD, x - r) + 1
      const b = best(i, 1, n)
      let tex = 0
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx < x + r; xx++) tex += Math.abs(L.data[yy * w + xx + 1] - L.data[yy * w + xx])
      let second = Infinity
      for (let d = 0; d < n; d++) if (Math.abs(d - b) > 1) second = Math.min(second, cost[i + d])
      if (tex / ((2 * r + 1) * 2 * r) < minTexture || second < (1 + unique) * cost[i + b]) {
        hole[y * w + x] = DEPTH_HOLE.unclear
        continue
      }
      const xr = x - b
      const nR = Math.min(maxD, w - 1 - r - xr) + 1
      const bR = best((y * w + xr) * D, D + 1, nR)
      if (Math.abs(bR - b) > lrTol) continue
      let d = b
      if (b > 0 && b < n - 1) {
        const [a, c, e] = [cost[i + b - 1], cost[i + b], cost[i + b + 1]]
        const den = a - 2 * c + e
        if (den > 0) d = b + Math.round((2 * (a - e)) / den) / 4
      }
      out[y * w + x] = d
      hole[y * w + x] = d > 0 ? DEPTH_HOLE.ok : DEPTH_HOLE.lr
    }
  return { w, h, d: out, hole }
}

/** Disparity map → depth z = f·B/d (0 in holes). */
export const depthOfDisparity = (m: DisparityMap, fPx: number, baseM: number) => m.d.map((d, i) => (m.hole[i] === DEPTH_HOLE.ok ? depthFromDisparity(fPx, baseM, d) : 0))

/** Range at which a phase ToF wraps: c / (2 f). */
export const tofWrapM = (fHz: number) => LIGHT_C / (2 * fHz)
/** Range noise for phase noise σφ: c·σφ / (4π f). */
export const tofSigmaM = (fHz: number, sigmaPhi: number) => (LIGHT_C * sigmaPhi) / (4 * Math.PI * fHz)

/** One ToF pixel from its sub-ray returns (range m, IR albedo 0…1): phasors a·e^{iφ}, a = albedo / r², φ = 4πf·r/c, summed,
 *  then arg → range (mod c/2f) plus shot noise σφ = `phiNoise` / √|A|; null if |A| < `minAmp`. */
export function tofPixel(returns: readonly { r: number; alb: number }[], fHz: number, phiNoise: number, gauss: number, minAmp = 0.02) {
  let [re, im] = [0, 0]
  for (const { r, alb } of returns) {
    if (!Number.isFinite(r)) continue
    const a = alb / (r * r)
    const ph = (4 * Math.PI * fHz * r) / LIGHT_C
    re += a * Math.cos(ph)
    im += a * Math.sin(ph)
  }
  const amp = Math.hypot(re, im) / returns.length
  if (amp < minAmp) return null
  const ph = Math.atan2(im, re) + (phiNoise / Math.sqrt(amp)) * gauss
  const wrap = tofWrapM(fHz)
  return { range: ((((ph * LIGHT_C) / (4 * Math.PI * fHz)) % wrap) + wrap) % wrap, amp }
}

/** ToF depth image: `sub` × `sub` rays per pixel mixed as phasors; z = range × cos(off-axis angle), 0 where too weak. */
export function tofView(k: Intrinsics, Twc: Mat4, s: RenderScene, fHz: number, phiNoise: number, sub = 3, seed = 1) {
  const cast = sceneCaster(s)
  const z = new Float32Array(k.w * k.h)
  const amp = makeImg(k.w, k.h, 1)
  const ax = [Twc[2], Twc[6], Twc[10]]
  const centre = (u: number, v: number) => {
    const d = pixelRay(k, Twc, u, v).d
    return d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]
  }
  for (let v = 0; v < k.h; v++)
    for (let u = 0; u < k.w; u++) {
      const rets: { r: number; alb: number }[] = []
      for (let j = 0; j < sub; j++)
        for (let i = 0; i < sub; i++) {
          const h = cast(pixelRay(k, Twc, u - 0.5 + (i + 0.5) / sub, v - 0.5 + (j + 0.5) / sub))
          rets.push({ r: h.t, alb: lumaOf(h.rgb[0], h.rgb[1], h.rgb[2]) / 255 })
        }
      const px = v * k.w + u
      const m = tofPixel(rets, fHz, phiNoise, gaussAt(seed * 100003 + px))
      z[px] = m ? m.range * centre(u, v) : 0
      amp.data[px] = m ? clamp(255 * Math.sqrt(m.amp), 0, 255) : 0
    }
  return { z, amp }
}

/** Depth z at pixel (u, v) → world point: X = Twc · z·((u − cx)/fx, (v − cy)/fy, 1). */
export const backProject = (k: Intrinsics, Twc: Mat4, u: number, v: number, z: number): P3 => apply4(Twc, [((u - k.cx) / k.fx) * z, ((v - k.cy) / k.fy) * z, z])

/** Every valid pixel of a depth image → world point, with its pixel index. */
export function depthToCloud(k: Intrinsics, Twc: Mat4, z: ArrayLike<number>) {
  const pts: { p: P3; i: number }[] = []
  for (let i = 0; i < k.w * k.h; i++) if (z[i] > 0) pts.push({ p: backProject(k, Twc, i % k.w, Math.floor(i / k.w), z[i]), i })
  return pts
}

/** Flying-pixel filter: true where a 4-neighbour's depth differs by more than `rel` × z (or the pixel is empty). */
export function edgePixels(w: number, h: number, z: ArrayLike<number>, rel = 0.1) {
  const bad = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!(z[i] > 0)) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [xx, yy] = [x + dx, y + dy]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const zn = z[yy * w + xx]
        if (zn > 0 && Math.abs(zn - z[i]) > rel * z[i]) bad[i] = 1
      }
    }
  return bad
}

/** Voxel-grid downsample: one centroid per occupied `size` cube, with its point count and the mean of `vals` (per point) if given. */
export function voxelGrid(pts: readonly P3[], size: number, vals?: readonly number[]) {
  const cells = new Map<string, { s: P3; n: number; v: number }>()
  pts.forEach((p, i) => {
    const key = p.map((x) => Math.floor(x / size)).join(',')
    const c = cells.get(key) ?? { s: [0, 0, 0] as P3, n: 0, v: 0 }
    c.s = [c.s[0] + p[0], c.s[1] + p[1], c.s[2] + p[2]]
    c.n++
    c.v += vals ? vals[i] : 0
    cells.set(key, c)
  })
  return [...cells.values()].map((c) => ({ p: c.s.map((x) => x / c.n) as P3, n: c.n, v: c.v / c.n }))
}

/** Where the projector's dot centres land: one ray per lit `pitch` cell within ±`spanX`, ±`spanY` (normalized coords). */
export function dotHits(proj: Mat4, s: RenderScene, pitch: number, spanX: number, spanY: number) {
  const cast = sceneCaster(s)
  const k: Intrinsics = { fx: 1, fy: 1, cx: 0, cy: 0, w: 1, h: 1 }
  const out: P3[] = []
  for (let j = Math.floor(-spanY / pitch); j < spanY / pitch; j++)
    for (let i = Math.floor(-spanX / pitch); i < spanX / pitch; i++) {
      const seed = i * 92821 + j * 68917
      if (hash01(seed) > 0.7) continue
      const r = pixelRay(k, proj, (i + 0.2 + 0.6 * hash01(seed + 1)) * pitch, (j + 0.2 + 0.6 * hash01(seed + 2)) * pitch)
      const t = cast(r).t
      if (Number.isFinite(t)) out.push([r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t])
    }
  return out
}

export const DEPTH_SENSORS = { passive: 'Passive stereo', active: 'Active stereo (IR dots)', tof100: 'ToF camera, 100 MHz', tof20: 'ToF camera, 20 MHz' }
export type DepthSensor = keyof typeof DEPTH_SENSORS
export const isStereo = (s: DepthSensor) => s === 'passive' || s === 'active'
export interface DepthCfg { baseM: number; r: number; maxD: number; noise: number; dotPitch: number; phiNoise: number; seed?: number }

/** One depth frame of scene `s` from a rig centred at `rig` (world ← camera): stereo gives the left camera's depth, ToF its own.
 *  Returns the depth camera pose, true and measured z, hole reasons and the grey image the sensor sees. */
export function depthShot(k: Intrinsics, rig: Mat4, s: RenderScene, sensor: DepthSensor, c: DepthCfg) {
  const seed = c.seed ?? 1
  if (isStereo(sensor)) {
    const cam = chain4(rig, trans4([-c.baseM / 2, 0, 0]))
    const right = chain4(rig, trans4([c.baseM / 2, 0, 0]))
    const proj = sensor === 'active' ? rig : null
    const ambient = sensor === 'active' ? 0.45 : 1
    const L = grainImg(irView(k, cam, s, ambient, proj, c.dotPitch), c.noise, seed)
    const R = grainImg(irView(k, right, s, ambient, proj, c.dotPitch), c.noise, seed + 1)
    const m = disparityMap(L, R, c.r, c.maxD)
    return { cam, truth: depthView(k, cam, s).z, z: depthOfDisparity(m, k.fx, c.baseM), hole: m.hole, seen: L }
  }
  const t = tofView(k, rig, s, sensor === 'tof100' ? 100e6 : 20e6, c.phiNoise, 3, seed)
  return { cam: rig, truth: depthView(k, rig, s).z, z: t.z, hole: Uint8Array.from(t.z, (z) => (z > 0 ? DEPTH_HOLE.ok : DEPTH_HOLE.weak)), seen: t.amp }
}
