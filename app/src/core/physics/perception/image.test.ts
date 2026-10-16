import {
  KERNELS, SCENE_SPOTS, bitDepthImg, channelImg, contrastImg, convolveImg, cumulative, equalizeImg, imageBytes, grayImg, hsvMask, hsvToRgb, hueGap, imgAt, imgHistogram, imgStats, lumaOf, makeImg, maskIoU, maskStats,
  noisyImg, otsuLevel, pixelOf, resizeImg, rgbToHsv, setPixel, tabletopImg, thresholdImg,
} from './image'

const W = 48
const H = 36
const spot = (k: keyof typeof SCENE_SPOTS): [number, number] => [Math.floor(SCENE_SPOTS[k][0] * W), Math.floor(SCENE_SPOTS[k][1] * H)]

test('pixel access clamps at edges', () => {
  const img = makeImg(3, 2, 3)
  setPixel(img, 2, 1, [10, 20, 30])
  expect(pixelOf(img, 2, 1)).toEqual([10, 20, 30])
  expect(imgAt(img, 9, 9, 1)).toBe(20)
  expect(imageBytes(320, 240, 16)).toBe(153600)
})

test('tabletop scene is deterministic and the objects have their colours', () => {
  const a = tabletopImg(W, H)
  expect(tabletopImg(W, H).data).toEqual(a.data)
  const hue = (k: keyof typeof SCENE_SPOTS) => rgbToHsv(...(pixelOf(a, ...spot(k)) as [number, number, number]))
  expect(hueGap(hue('ball')[0], 0)).toBeLessThan(15)
  expect(hueGap(hue('block')[0], 125)).toBeLessThan(20)
  expect(hueGap(hue('cup')[0], 222)).toBeLessThan(20)
  expect(hueGap(hue('tape')[0], 50)).toBeLessThan(12)
  expect(hue('wall')[1]).toBeLessThan(0.3)
  expect(hue('ball')[1]).toBeGreaterThan(0.7)
})

test('light scales RGB but leaves hue alone', () => {
  const dim = pixelOf(tabletopImg(W, H, 0.4), ...spot('ball'))
  const lit = pixelOf(tabletopImg(W, H, 1), ...spot('ball'))
  expect(dim[0]).toBeCloseTo(lit[0] * 0.4, 5)
  const [h0, s0] = rgbToHsv(dim[0], dim[1], dim[2])
  const [h1, s1] = rgbToHsv(lit[0], lit[1], lit[2])
  expect(hueGap(h0, h1)).toBeLessThan(0.01)
  expect(s0).toBeCloseTo(s1, 6)
})

test('HSV round-trips and hits the primaries', () => {
  expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1])
  expect(rgbToHsv(0, 255, 0)[0]).toBeCloseTo(120)
  expect(rgbToHsv(0, 0, 255)[0]).toBeCloseTo(240)
  expect(rgbToHsv(128, 128, 128)).toEqual([0, 0, 128 / 255])
  for (const c of [[200, 40, 30], [12, 180, 99], [70, 80, 250], [255, 255, 0]]) {
    const back = hsvToRgb(...rgbToHsv(c[0], c[1], c[2]))
    back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 6))
  }
  expect(hueGap(350, 10)).toBe(20)
})

test('grey uses BT.601 luma; channel split', () => {
  expect(lumaOf(255, 255, 255)).toBeCloseTo(255)
  expect(lumaOf(0, 255, 0)).toBeCloseTo(149.685)
  const img = tabletopImg(8, 6)
  const g = grayImg(img)
  expect(g.ch).toBe(1)
  expect(g.data[5]).toBeCloseTo(lumaOf(img.data[15], img.data[16], img.data[17]))
  expect(channelImg(img, 2).data[5]).toBe(img.data[17])
})

test('histogram counts every pixel; cumulative ends at 1', () => {
  const g = grayImg(tabletopImg(W, H))
  const h = imgHistogram(g, 16)
  expect(h.reduce((a, b) => a + b, 0)).toBe(W * H)
  const c = cumulative(h)
  expect(c[15]).toBeCloseTo(1)
  expect(c.every((v, i) => i === 0 || v >= c[i - 1])).toBe(true)
})

test('Otsu splits a two-level image between the levels', () => {
  const img = makeImg(10, 10, 1, 40)
  for (let i = 0; i < 30; i++) img.data[i] = 200
  const t = otsuLevel(imgHistogram(img, 256))
  expect(t).toBeGreaterThan(40)
  expect(t).toBeLessThanOrEqual(200)
  const m = maskStats(thresholdImg(img, t))
  expect(m.count).toBe(30)
  expect(m.cy).toBeCloseTo(1)
  expect(maskStats(thresholdImg(img, t, true)).count).toBe(70)
})

test('HSV mask finds the red ball whatever the light', () => {
  for (const light of [0.35, 1]) {
    const m = maskStats(hsvMask(tabletopImg(W, H, light), 0, 20, 0.5, 0.08))
    expect(m.cx / W).toBeCloseTo(0.2, 1)
    expect(m.cy / H).toBeCloseTo(0.6, 1)
  }
})

test('contrast, equalise, stats', () => {
  const g = grayImg(tabletopImg(W, H, 0.4))
  const s = imgStats(g)
  expect(s.min).toBeGreaterThanOrEqual(0)
  const n = grayImg(tabletopImg(W, H))
  expect(imgStats(contrastImg(n, 1.5)).std).toBeGreaterThan(imgStats(n).std)
  expect(imgStats(contrastImg(g, 2)).min).toBe(0)
  const eq = imgStats(equalizeImg(g))
  expect(eq.max).toBe(255)
  expect(eq.mean).toBeGreaterThan(100)
  expect(eq.mean).toBeLessThan(155)
})

test('convolution: box keeps flat areas, Sobel finds a vertical edge', () => {
  const img = makeImg(6, 4, 1, 50)
  for (let y = 0; y < 4; y++) for (let x = 3; x < 6; x++) img.data[y * 6 + x] = 150
  expect(convolveImg(img, KERNELS.box).data[0]).toBeCloseTo(50)
  const gx = convolveImg(img, KERNELS.sobelX)
  expect(gx.data[6 + 2]).toBe(400)
  expect(gx.data[6 + 0]).toBe(0)
  expect(convolveImg(img, KERNELS.sobelY).data[8]).toBe(0)
})

test('resize: nearest copies pixels, bilinear blends', () => {
  const img = makeImg(2, 1, 1)
  img.data.set([0, 100])
  expect(Array.from(resizeImg(img, 4, 1, 'nearest').data)).toEqual([0, 0, 100, 100])
  expect(Array.from(resizeImg(img, 4, 1).data)).toEqual([0, 25, 75, 100])
})

test('noise is repeatable; bit depth leaves 2^bits levels', () => {
  const g = grayImg(tabletopImg(W, H))
  expect(noisyImg(g, 10, 3).data).toEqual(noisyImg(g, 10, 3).data)
  expect(imgStats(noisyImg(makeImg(40, 40, 1, 128), 10, 1)).std).toBeCloseTo(10, 0)
  expect(new Set(bitDepthImg(g, 2).data).size).toBeLessThanOrEqual(4)
  expect(Array.from(bitDepthImg(makeImg(1, 1, 1, 255), 1).data)).toEqual([255])
  expect(bitDepthImg(g, 8).data).toEqual(g.data.map(Math.floor))
})

test('IoU of masks', () => {
  const a = makeImg(4, 1, 1)
  const b = makeImg(4, 1, 1)
  a.data.set([255, 255, 0, 0])
  b.data.set([0, 255, 255, 0])
  expect(maskIoU(a, b)).toBeCloseTo(1 / 3)
  expect(maskIoU(makeImg(2, 2, 1), makeImg(2, 2, 1))).toBe(1)
})
