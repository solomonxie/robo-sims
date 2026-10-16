import {
  EDGE, HARRIS_K, canny, cornerField, descDistance, dirBin, eigen2, gradientOf, harrisBoundary, houghLines, hysteresis, lineInImg, matchDescriptors, patchDescriptor, pickCorners, thinEdges, warpImg, warpPoint,
} from './features'
import { Img, makeImg, setPixel, tabletopImg } from './image'

const fromRows = (rows: number[][]): Img => {
  const img = makeImg(rows[0].length, rows.length, 1)
  rows.forEach((r, y) => r.forEach((v, x) => setPixel(img, x, y, [v])))
  return img
}
const step = (w = 8, h = 5, at = 4) => fromRows(Array.from({ length: h }, () => Array.from({ length: w }, (_, x) => (x >= at ? 100 : 0))))
const square = (n = 20, a = 6, b = 13) => fromRows(Array.from({ length: n }, (_, y) => Array.from({ length: n }, (__, x) => (x >= a && x <= b && y >= a && y <= b ? 200 : 20))))

test('Sobel on a vertical step: |∇| = 4 × 100 either side, pointing +x', () => {
  const g = gradientOf(step())
  const i = 2 * 8
  expect(g.gx[i + 3]).toBe(400)
  expect(g.gx[i + 4]).toBe(400)
  expect(g.gx[i + 1]).toBe(0)
  expect(g.gy[i + 3]).toBe(0)
  expect(g.mag[i + 3]).toBe(400)
  expect(g.ang[i + 3]).toBe(0)
  expect(dirBin(Math.PI / 2)).toBe(2)
  expect(dirBin(-Math.PI)).toBe(0)
  expect(dirBin(Math.PI / 4)).toBe(1)
})

test('non-maximum suppression keeps one column of the two-pixel-wide ridge', () => {
  const g = gradientOf(step())
  const thin = thinEdges(g)
  for (let y = 0; y < 5; y++) {
    const row = Array.from(thin.subarray(y * 8, y * 8 + 8))
    expect(row.filter((v) => v > 0)).toEqual([400])
  }
})

test('hysteresis keeps weak pixels only when joined to a strong one', () => {
  const thin = new Float32Array([90, 50, 50, 0, 50, 0])
  const cls = hysteresis(thin, 6, 1, 40, 80)
  expect(Array.from(cls)).toEqual([EDGE.strong, EDGE.weak, EDGE.weak, EDGE.none, EDGE.dropped, EDGE.none])
  const depth = new Int16Array(6)
  hysteresis(thin, 6, 1, 40, 80, depth)
  expect(Array.from(depth)).toEqual([0, 1, 2, -1, -1, -1])
})

test('Canny on a square finds a closed one-pixel outline', () => {
  const c = canny(square(), 100, 300)
  expect(c.count).toBeGreaterThan(24)
  expect(c.count).toBeLessThan(36)
  expect(c.edges.data[10 * 20 + 10]).toBe(0)
  expect(c.edges.data[2 * 20 + 2]).toBe(0)
})

test('Hough: a horizontal line at y = 5 peaks at θ = 90°, ρ = 5; a vertical at x = 7 at θ = 0, ρ = 7', () => {
  const img = makeImg(16, 12, 1)
  for (let x = 0; x < 16; x++) setPixel(img, x, 5, [255])
  for (let y = 0; y < 12; y++) setPixel(img, 7, y, [255])
  const { lines } = houghLines(img, 90, 2, 8)
  const h = lines.find((l) => Math.abs(l.theta - Math.PI / 2) < 1e-9)!
  const v = lines.find((l) => l.theta === 0)!
  expect(h.rho).toBe(5)
  expect(h.votes).toBe(16)
  expect(v.rho).toBe(7)
  expect(v.votes).toBe(12)
  expect(lineInImg(h, 16, 12)!.flat().map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 5, 15, 5])
})

test('Hough finds a 45° diagonal to within the bin size', () => {
  const img = makeImg(12, 12, 1)
  for (let k = 0; k < 12; k++) setPixel(img, k, 11 - k, [255])
  const [l] = houghLines(img, 180, 1).lines
  expect(Math.abs((l.theta * 180) / Math.PI - 45)).toBeLessThanOrEqual(3)
  expect(Math.abs(l.rho - 11 * Math.SQRT1_2)).toBeLessThanOrEqual(1)
  expect(l.votes).toBe(12)
})

test('Harris boundary: R(λ1, λ2) = t on the returned λ2', () => {
  const l2 = harrisBoundary(100, 500)!
  expect(100 * l2 - HARRIS_K * (100 + l2) ** 2).toBeCloseTo(500, 6)
  expect(harrisBoundary(10, 500)).toBeNull()
})

test('eigenvalues of the structure tensor', () => {
  expect(eigen2(4, 0, 1)).toEqual([4, 1])
  const [a, b] = eigen2(2, 1, 2)
  expect(a).toBeCloseTo(3)
  expect(b).toBeCloseTo(1)
})

test('a square has exactly four corners, at its vertices (Harris and Shi-Tomasi)', () => {
  for (const m of ['harris', 'shi'] as const) {
    const f = cornerField(square(), m)
    const peak = Math.max(...f.resp)
    const cs = pickCorners(f.resp, 20, 20, peak * 0.2)
    expect(cs).toHaveLength(4)
    for (const [x, y] of [[6, 6], [13, 6], [6, 13], [13, 13]]) expect(cs.some((c) => Math.hypot(c.x - x, c.y - y) <= 1.5)).toBe(true)
  }
})

test('along a straight edge λ1 ≫ λ2 and Harris R < 0', () => {
  const f = cornerField(square(), 'harris')
  const i = 6 * 20 + 10
  expect(f.l1[i]).toBeGreaterThan(20 * f.l2[i])
  expect(f.resp[i]).toBeLessThan(0)
  expect(f.l1[1]).toBe(0)
})

test('patch descriptor ignores brightness and contrast', () => {
  const a = square()
  const b = { ...a, data: a.data.map((v) => v * 0.5 + 40) }
  expect(descDistance(patchDescriptor(a, 6, 6), patchDescriptor(b, 6, 6))).toBeCloseTo(0, 6)
  expect(descDistance(patchDescriptor(a, 6, 6), patchDescriptor(a, 13, 13))).toBeGreaterThan(1)
})

test('warp moves points and pixels together', () => {
  const wp = { angle: 0, dx: 3, dy: -2 }
  expect(warpPoint(wp, 20, 20, 5, 5)).toEqual([8, 3])
  const w = warpImg(square(), wp)
  expect(w.data[4 * 20 + 9]).toBe(200)
  expect(w.data[3 * 20 + 9]).toBe(20)
  const r = warpPoint({ angle: Math.PI / 2, dx: 0, dy: 0 }, 21, 21, 15, 10)
  expect(r[0]).toBeCloseTo(10)
  expect(r[1]).toBeCloseTo(15)
})

test('corners of the tabletop match across a shifted, turned view', () => {
  const A = tabletopImg(48, 36)
  const wp = { angle: 0.1, dx: 2, dy: 1 }
  const B = warpImg(A, wp, 60)
  const pick = (img: Img) => {
    const f = cornerField(img)
    return pickCorners(f.resp, 48, 36, Math.max(...f.resp) * 0.02, 30, 2, 4)
  }
  const ca = pick(A)
  const cb = pick(B)
  const ms = matchDescriptors(ca.map((c) => patchDescriptor(A, c.x, c.y)), cb.map((c) => patchDescriptor(B, c.x, c.y)), 0.8)
  const good = ms.filter((m) => {
    const [x, y] = warpPoint(wp, 48, 36, ca[m.a].x, ca[m.a].y)
    return Math.hypot(x - cb[m.b].x, y - cb[m.b].y) < 2.5
  })
  expect(ca.length).toBeGreaterThan(8)
  expect(ms.length).toBeGreaterThan(4)
  expect(good.length / ms.length).toBeGreaterThan(0.6)
})
