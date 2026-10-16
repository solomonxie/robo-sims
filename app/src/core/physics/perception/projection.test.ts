import { LENSES } from '../sensors/camera'
import { trans4 } from '../kinematics/transforms'
import { applyH, boardPoints, boardPoses, boardShots, boardViews, calibrate, homography, intrinsicsFromH, poseFromH } from './calibration'
import { boardColor, renderView } from './render'
import { camTf, cropK, depthFromDisparity, depthStep, disparityPx, focalPx, fovOfFocal, groundHit, groundSpan, inImage, intrinsicsOf, lensFor, matchDisparity, pixelRay, projectPx, stereoRig, toPixel, triangulate } from './projection'

const K = intrinsicsOf(320, 240, 60)

test('focal length ↔ field of view: 320 px at 90° is f = 160 px; round trip', () => {
  expect(focalPx(90, 320)).toBeCloseTo(160)
  expect(fovOfFocal(focalPx(66, 800), 800)).toBeCloseTo(66)
  expect(K.cx).toBe(159.5)
})

test('pinhole by hand: a point 1 m ahead, 0.1 m right and 0.05 m down lands at (cx + 0.1 f, cy + 0.05 f)', () => {
  const [u, v, z] = toPixel(K, [0.1, 0.05, 1])
  expect(u).toBeCloseTo(K.cx + 0.1 * K.fx)
  expect(v).toBeCloseTo(K.cy + 0.05 * K.fx)
  expect(z).toBe(1)
})

test('camTf: a level camera at the origin sees world +X straight ahead, +Y (left) left of centre, +Z up above it', () => {
  const T = camTf([0, 0, 0], 0, 0)
  expect(projectPx(K, T, [2, 0, 0]).slice(0, 2).map((x) => +x.toFixed(6))).toEqual([K.cx, K.cy])
  expect(projectPx(K, T, [2, 0.2, 0])[0]).toBeLessThan(K.cx)
  expect(projectPx(K, T, [2, 0, 0.2])[1]).toBeLessThan(K.cy)
  expect(projectPx(K, T, [-2, 0, 0])[2]).toBeLessThan(0)
})

test('back-projection round trip with distortion; the centre ray of a tilted camera hits the floor at h / tan(tilt)', () => {
  const T = camTf([0.3, -0.1, 0.2], 0.4, 0.5)
  const lens = lensFor(LENSES.wide, K)
  const p: [number, number, number] = [1.2, 0.4, 0.05]
  const [u, v, z] = projectPx(K, T, p, lens)
  const ray = pixelRay(K, T, u, v, lens)
  const s = Math.hypot(p[0] - ray.o[0], p[1] - ray.o[1], p[2] - ray.o[2])
  ray.d.forEach((d, i) => expect(ray.o[i] + d * s).toBeCloseTo(p[i], 6))
  expect(z).toBeGreaterThan(0)
  const level = camTf([0, 0, 0.2], 0, 0.3)
  const hit = groundHit(pixelRay(K, level, K.cx, K.cy))!
  expect(hit[0]).toBeCloseTo(0.2 / Math.tan(0.3))
  expect(groundSpan(K, 0.2, 0.3).centreM).toBeCloseTo(hit[0])
  expect(groundHit(pixelRay(K, level, K.cx, 0))).toBeNull()
  expect(groundSpan(K, 0.2, 0.3).horizonV).toBeCloseTo(K.cy - K.fy * Math.tan(0.3))
})

test('homography from 4 exact matches reproduces a known H', () => {
  const H = [[2, 0.1, 30], [-0.2, 1.5, 12], [0.001, 0.002, 1]]
  const src: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 3]]
  const dst = src.map((p) => applyH(H, p))
  const Hf = homography(src, dst)
  Hf.flat().forEach((x, i) => expect(x).toBeCloseTo(H.flat()[i], 6))
})

test('Zhang: exact views recover K and the board poses', () => {
  const pts = boardPoints(8, 6, 0.025)
  const poses = boardPoses(5, 0.45)
  const obs = boardViews(K, { k1: 0, k2: 0 }, poses, pts)
  const Hs = obs.map((v) => homography(pts.map((p) => [p[0], p[1]]), v))
  const k = intrinsicsFromH(Hs, K.w, K.h)
  expect(k.fx).toBeCloseTo(K.fx, 3)
  expect(k.cy).toBeCloseTo(K.cy, 3)
  poseFromH(k, Hs[2]).forEach((x, i) => expect(x).toBeCloseTo(poses[2][i], 5))
})

test('calibration on a wide lens: k1/k2 fitted beats ignoring distortion; noise shows up as reprojection error', () => {
  const pts = boardPoints(8, 6, 0.025)
  const lens = lensFor(LENSES.wide, K)
  const poses = boardPoses(8, 0.45)
  const exact = boardViews(K, lens, poses, pts)
  const fit = calibrate(pts, exact, K.w, K.h, true)
  expect(fit.linearRms).toBeGreaterThan(0.5)
  expect(fit.rms).toBeLessThan(0.01)
  expect(Math.abs(fit.k.fx / K.fx - 1)).toBeLessThan(0.005)
  expect(fit.lens.k1).toBeCloseTo(lens.k1, 2)
  const plain = calibrate(pts, exact, K.w, K.h, false)
  expect(plain.rms).toBeGreaterThan(0.3)
  expect(Math.abs(plain.k.fx / K.fx - 1)).toBeGreaterThan(0.1)
  const noisy = calibrate(pts, boardViews(K, lens, poses, pts, 0.5, 3), K.w, K.h, true)
  expect(noisy.rms).toBeGreaterThan(0.55)
  expect(noisy.rms).toBeLessThan(0.5 * Math.SQRT2)
  expect(Math.abs(noisy.k.fx / K.fx - 1)).toBeLessThan(0.03)
})

test('stereo: Z = fB/d by hand, error grows with Z², triangulation inverts projection', () => {
  expect(depthFromDisparity(300, 0.06, 18)).toBeCloseTo(1)
  expect(disparityPx(300, 0.06, 2)).toBeCloseTo(9)
  expect(depthStep(300, 0.06, 2, 1)).toBeCloseTo(4 / 18)
  expect(depthStep(300, 0.06, 4, 1) / depthStep(300, 0.06, 2, 1)).toBeCloseTo(4)
  const [L, R] = stereoRig([0, 0, 0.1], 0.06)
  const p: [number, number, number] = [1.5, 0.1, 0.2]
  const [uL, vL] = projectPx(K, L, p)
  const [uR, vR] = projectPx(K, R, p)
  expect(vR).toBeCloseTo(vL)
  const q = triangulate(K, 0.06, uL, uR, vL)
  expect(q[2]).toBeCloseTo(1.5)
  expect(q[0]).toBeCloseTo(-0.1)
})

test('block matching finds the disparity of the near face of a speckled ball in a rendered pair', () => {
  const k = intrinsicsOf(160, 40, 60)
  const [L, R] = stereoRig([0, 0, 0.1], 0.08)
  const scene = { floor: { tile: 0.1, a: [120, 110, 95] as [number, number, number], b: [90, 84, 74] as [number, number, number] }, balls: [{ c: [0.8, 0, 0.1] as [number, number, number], r: 0.05, rgb: [220, 40, 30] as [number, number, number], speckle: 48 }], wallX: 2 }
  const [iL, iR] = [renderView(k, L, scene), renderView(k, R, scene)]
  const [u, v] = projectPx(k, L, [0.8, 0, 0.1])
  const truth = disparityPx(k.fx, 0.08, 0.75)
  expect(Math.abs(matchDisparity(iL, iR, Math.round(u), Math.round(u), Math.round(v), 3, 30).d - truth)).toBeLessThanOrEqual(1)
  expect(Math.abs(matchDisparity(iL, iR, Math.round(u), Math.round(u), Math.round(v), 3, 30, true).d - truth)).toBeLessThan(0.75)
})

test('board colours, renderer and image bounds', () => {
  const b = { tf: trans4([0, 0, 0]), nx: 3, ny: 3, sq: 1 }
  expect(boardColor(b, -1.9, -1.9)![0]).toBeLessThan(50)
  expect(boardColor(b, -0.9, -1.9)![0]).toBeGreaterThan(200)
  expect(boardColor(b, 2.5, 0)).not.toBeNull()
  expect(boardColor(b, 3.2, 0)).toBeNull()
  expect(inImage(K, -0.5, 0)).toBe(true)
  expect(inImage(K, 320, 0)).toBe(false)
  const img = renderView(K, camTf([0, 0, 0.2], 0, 0.3), { floor: { tile: 0.25, a: [200, 200, 200], b: [50, 50, 50] } }, 32, 24)
  expect(img.w).toBe(32)
  expect(img.data[0]).toBe(70)
})

test('board shots keep every corner inside the image; a narrow pincushion lens still calibrates from 3 of them', () => {
  const pts = boardPoints(8, 6, 0.025)
  const k = intrinsicsOf(320, 240, LENSES.tele.fov)
  const lens = lensFor(LENSES.tele, k)
  const shots = boardShots(k, lens, 3, 0.45, pts)
  expect(shots).toHaveLength(3)
  const obs = boardViews(k, lens, shots, pts, 0.3, 5)
  obs.flat().forEach(([u, v]) => expect(inImage(k, u, v)).toBe(true))
  const fit = calibrate(pts, obs, k.w, k.h, true)
  expect(fit.rms).toBeLessThan(0.45)
  expect(Math.abs(fit.k.fx / k.fx - 1)).toBeLessThan(0.05)
})

test('a cropped camera renders exactly that window of the full image; matching on crops gives the same disparity', () => {
  const k = intrinsicsOf(160, 40, 60)
  const [L, R] = stereoRig([0, 0, 0.1], 0.08)
  const scene = { balls: [{ c: [0.8, 0, 0.1] as [number, number, number], r: 0.05, rgb: [220, 40, 30] as [number, number, number], speckle: 48 }], wallX: 2 }
  const full = renderView(k, L, scene)
  const crop = renderView(cropK(k, 70, 15, 9, 7), L, scene)
  for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) expect(crop.data[(y * 9 + x) * 3]).toBeCloseTo(full.data[((y + 15) * 160 + x + 70) * 3], 6)
  const fullR = renderView(k, R, scene)
  const [u, v] = projectPx(k, L, [0.75, 0, 0.1]).map(Math.round)
  const a = matchDisparity(full, fullR, u, u, v, 3, 30)
  const cropR = renderView(cropK(k, u - 3 - 30, v - 3, 30 + 7, 7), R, scene)
  const b = matchDisparity(renderView(cropK(k, u - 3, v - 3, 7, 7), L, scene), cropR, 3, 33, 3, 3, 30)
  expect(b.d).toBe(a.d)
})
