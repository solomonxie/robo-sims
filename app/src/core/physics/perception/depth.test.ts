import { hash01 } from '../common'
import { DEPTH_HOLE, backProject, depthOfDisparity, depthToCloud, depthView, dotHits, disparityMap, dotPattern, edgePixels, irView, tofPixel, tofSigmaM, tofView, tofWrapM, voxelGrid } from './depth'
import { makeImg } from './image'
import { camTf, intrinsicsOf, projectPx } from './projection'

const K = intrinsicsOf(40, 30, 60)
const CAM = camTf([0, 0, 0.5], 0, 0)
const WALL = { wallX: 2, sky: [0, 0, 0] as [number, number, number] }

test('depth image stores z along the optical axis, not ray length: a wall square to the camera reads 2 m in every pixel', () => {
  const { z } = depthView(K, CAM, WALL)
  expect(z[15 * 40 + 20]).toBeCloseTo(2, 6)
  expect(z[0]).toBeCloseTo(2, 6)
})

test('back-projection undoes projection: pixel + z → the same world point', () => {
  const p: [number, number, number] = [1.6, 0.3, 0.2]
  const [u, v, z] = projectPx(K, CAM, p)
  backProject(K, CAM, u, v, z).forEach((x, i) => expect(x).toBeCloseTo(p[i], 9))
  const cloud = depthToCloud(K, CAM, depthView(K, CAM, WALL).z)
  expect(cloud.length).toBeGreaterThan(900)
  cloud.forEach(({ p: q }) => expect(q[0]).toBeCloseTo(2, 6))
})

test('block matching: a random texture shifted 3 px reads d = 3 inside; a blank image is all "too flat" holes', () => {
  const [w, h] = [32, 12]
  const L = makeImg(w, h, 1)
  const R = makeImg(w, h, 1)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      L.data[y * w + x] = 255 * hash01(y * 1000 + x)
      R.data[y * w + x] = 255 * hash01(y * 1000 + x + 3)
    }
  const m = disparityMap(L, R, 2, 8)
  for (let y = 2; y < h - 2; y++) for (let x = 12; x < w - 2; x++) expect([m.d[y * w + x], m.hole[y * w + x]]).toEqual([3, DEPTH_HOLE.ok])
  const flat = disparityMap(makeImg(w, h, 1, 90), makeImg(w, h, 1, 90), 2, 8)
  expect(flat.hole[6 * w + 16]).toBe(DEPTH_HOLE.unclear)
  expect(depthOfDisparity(m, 100, 0.1)[6 * w + 16]).toBeCloseTo(100 * 0.1 / 3)
})

test('ToF by hand: c/2f wrap = 1.5 m at 100 MHz, so a wall 2 m away reads 0.50 m; 20 MHz reads 2 m; σ = c·σφ/(4πf)', () => {
  expect(tofWrapM(100e6)).toBeCloseTo(1.499, 3)
  expect(tofPixel([{ r: 2, alb: 1 }], 100e6, 0, 0)!.range).toBeCloseTo(2 - tofWrapM(100e6), 6)
  expect(tofPixel([{ r: 2, alb: 1 }], 20e6, 0, 0)!.range).toBeCloseTo(2, 6)
  expect(tofSigmaM(20e6, 0.01)).toBeCloseTo(0.01193, 5)
  expect(tofPixel([{ r: 3, alb: 0.05 }], 20e6, 0, 0)).toBeNull()
})

test('flying pixel: a pixel half on 1.0 m, half on 1.2 m (equal returns) reads 1.1 m, a surface that is not there', () => {
  const r = tofPixel([{ r: 1, alb: 1 }, { r: 1.2, alb: 1.44 }], 20e6, 0, 0)!
  expect(r.range).toBeCloseTo(1.1, 3)
  const { z } = tofView(K, CAM, WALL, 20e6, 0, 2)
  expect(z[15 * 40 + 20]).toBeCloseTo(2, 3)
})

test('edge filter flags both sides of a depth jump; voxel grid averages points sharing a cube', () => {
  const z = [1, 1, 2, 2]
  expect(Array.from(edgePixels(4, 1, z))).toEqual([0, 1, 1, 0])
  const v = voxelGrid([[0.01, 0.01, 0.01], [0.03, 0.01, 0.01], [0.2, 0, 0]], 0.05)
  expect(v).toHaveLength(2)
  expect(v[0].p[0]).toBeCloseTo(0.02)
  expect(v[0].n).toBe(2)
  expect(voxelGrid([[0, 0, 0], [0.01, 0, 0]], 0.05, [1, 3])[0].v).toBe(2)
})

test('dot projector: repeatable, about 70 % of cells carry a dot; dots light up an IR image of a blank wall', () => {
  expect(dotPattern(0.123, -0.05, 0.04)).toBe(dotPattern(0.123, -0.05, 0.04))
  let lit = 0
  for (let i = 0; i < 400; i++) lit += Math.max(...[0, 1, 2, 3, 4].flatMap((a) => [0, 1, 2, 3, 4].map((b) => dotPattern((i % 20) + a * 0.2 + 0.1, Math.floor(i / 20) + b * 0.2 + 0.1, 1)))) > 0.3 ? 1 : 0
  expect(lit / 400).toBeGreaterThan(0.55)
  expect(lit / 400).toBeLessThan(0.85)
  const plain = irView(K, CAM, { wallX: 2 }, 0.3, null, 0.15)
  const dots = irView(K, CAM, { wallX: 2 }, 0.3, CAM, 0.15)
  expect(Math.max(...dots.data)).toBeGreaterThan(Math.max(...plain.data) + 80)
  const hits = dotHits(CAM, { wallX: 2 }, 0.1, 0.5, 0.3)
  expect(hits.length).toBeGreaterThan(20)
  hits.forEach((p) => expect(p[0]).toBeCloseTo(2, 6))
})
