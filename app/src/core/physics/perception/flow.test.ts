import { blockMatchAt, carpetPlate, flowField, flowHoldRun, flowRate, flowResidual, flowSpeed, imgDerivs, lkAt, medianFlow, tensorAt } from './flow'
import { Img, makeImg } from './image'
import { warpImg } from './features'
import { camTf, intrinsicsOf } from './projection'
import { renderView } from './render'

const imgOf = (w: number, h: number, f: (x: number, y: number) => number): Img => {
  const img = makeImg(w, h, 1)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = f(x, y)
  return img
}
const blobs = (x: number, y: number) => 128 + 50 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 30 * Math.sin((x + y) * 0.45)
const stripes = (x: number) => 128 + 80 * Math.sin(x * 0.8)
const shifted = (f: (x: number, y: number) => number, dx: number, dy: number) => imgOf(32, 24, (x, y) => f(x - dx, y - dy))

test('brightness constancy: the window residual is ~0 at the true shift and large at zero flow', () => {
  const [a, b] = [imgOf(32, 24, blobs), shifted(blobs, 1, 2)]
  expect(flowResidual(a, b, 16, 12, 2, 1, 2)).toBeLessThan(1e-3)
  expect(flowResidual(a, b, 16, 12, 2, 0, 0)).toBeGreaterThan(10)
})

test('Lucas–Kanade recovers a sub-pixel shift (1.3, −0.6) px on a textured window', () => {
  const [a, b] = [imgOf(32, 24, blobs), shifted(blobs, 1.3, -0.6)]
  const f = lkAt(a, b, imgDerivs(a), 16, 12, 3)
  expect(f.kind).toBe('corner')
  expect(f.u).toBeCloseTo(1.3, 1)
  expect(f.v).toBeCloseTo(-0.6, 1)
})

test('aperture problem: on stripes the structure tensor is rank 1, so only the flow across them (normal flow) is found', () => {
  const s = (x: number) => stripes(x)
  const [a, b] = [imgOf(32, 24, s), shifted(s, 0.8, 1.5)]
  const d = imgDerivs(a)
  const T = tensorAt(d, 16, 12, 2)
  expect(T.b).toBeCloseTo(0, 6)
  expect(T.c).toBeCloseTo(0, 6)
  expect(T.a * T.c - T.b * T.b).toBeCloseTo(0, 6)
  const f = lkAt(a, b, d, 16, 12, 2)
  expect(f.kind).toBe('edge')
  expect(f.u).toBeCloseTo(0.8, 1)
  expect(f.v).toBe(0)
})

test('flat window: no gradient, no flow', () => {
  const a = imgOf(32, 24, () => 90)
  const f = lkAt(a, a, imgDerivs(a), 16, 12, 2)
  expect(f.kind).toBe('flat')
  expect([f.u, f.v]).toEqual([0, 0])
})

test('block matching finds a whole-pixel shift exactly', () => {
  const [a, b] = [imgOf(32, 24, blobs), shifted(blobs, -2, 3)]
  const f = blockMatchAt(a, b, imgDerivs(a), 16, 12, 2)
  expect([f.u, f.v]).toEqual([-2, 3])
  expect(f.err).toBeCloseTo(0, 6)
})

test('field of a warped image: median corner flow = the shift', () => {
  const a = imgOf(32, 24, blobs)
  const [u, v, n] = medianFlow(flowField(a, warpImg(a, { angle: 0, dx: 1, dy: -0.5 }), 4, 2))
  expect(n).toBeGreaterThan(5)
  expect(u).toBeCloseTo(1, 1)
  expect(v).toBeCloseTo(-0.5, 1)
})

test('v = flow·h/f: 42 px/s at 1 m with f = 42 px is 1 m/s; double the height, double the speed', () => {
  expect(flowSpeed(42, 1, 42)).toBeCloseTo(1, 9)
  expect(flowSpeed(42, 2, 42)).toBeCloseTo(2, 9)
  expect(flowRate(0.5, 0.5, 42)).toBeCloseTo(42, 9)
})

test('gyro de-rotation: pitching in place makes flow, adding the pitch rate back cancels it', () => {
  const flow = flowRate(0, 1, 42, 0.5)
  expect(flow).toBeCloseTo(-21, 9)
  expect(flowSpeed(flow, 1, 42, 0)).toBeCloseTo(-0.5, 9)
  expect(flowSpeed(flow, 1, 42, 0.5)).toBeCloseTo(0, 9)
})

test('downward camera 1 m over the carpet, moved 2 cm forward: the image flows f·dx/h px toward the bottom', () => {
  const K = intrinsicsOf(32, 24, 42)
  const sc = { plates: [carpetPlate()] }
  const a = renderView(K, camTf([0, 0, 1], 0, Math.PI / 2), sc)
  const b = renderView(K, camTf([0.02, 0, 1], 0, Math.PI / 2), sc)
  const [u, v] = medianFlow(flowField(a, b, 4, 2))
  expect(Math.abs(u)).toBeLessThan(0.05)
  expect(v / ((K.fx * 0.02) / 1)).toBeGreaterThan(0.93)
  expect(v / ((K.fx * 0.02) / 1)).toBeLessThan(1.07)
})

test('flow position hold: with de-rotation a 1 m/s gust moves the quad < 0.4 m; without, tilting fools it into swinging > 1 m', () => {
  const dev = (derotate: boolean) => Math.max(...flowHoldRun({ wind: 1, h: 1, hUsed: 1, derotate }).map((s) => Math.abs(s.x)))
  expect(dev(true)).toBeLessThan(0.4)
  expect(dev(false)).toBeGreaterThan(1)
})
