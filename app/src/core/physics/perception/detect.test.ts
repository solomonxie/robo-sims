import { BBox, ConvLayer, Det, boxIoU, convRelu, detDataset, detFrame, int8Layer, matchDets, maxPool, netCost, nmsSteps, prAt, prCurve, runDetector, truthBoxes } from './detect'
import { ACCELERATORS, DETECT_MODELS, frameBudget, tinyMemory, travelOf } from './inference'

const det = (box: BBox, score: number, cls = 0): Det => ({ box, score, cls, cell: [0, 0] })

test('box IoU: identical 1, disjoint 0, half-overlapping squares 1/3', () => {
  expect(boxIoU([0, 0, 2, 2], [0, 0, 2, 2])).toBe(1)
  expect(boxIoU([0, 0, 2, 2], [3, 3, 4, 4])).toBe(0)
  expect(boxIoU([0, 0, 2, 2], [1, 0, 3, 2])).toBeCloseTo(1 / 3, 9)
})

test('NMS keeps the best box, drops same-class overlaps above the threshold, keeps other classes and far boxes', () => {
  const d = [det([0, 0, 10, 10], 0.6), det([1, 0, 11, 10], 0.9), det([20, 0, 30, 10], 0.5), det([0, 0, 10, 10], 0.8, 1)]
  const s = nmsSteps(d, 0.5)
  expect(s.order).toEqual([1, 3, 0, 2])
  expect(s.steps).toEqual([{ keep: 1, drop: [0] }, { keep: 3, drop: [] }, { keep: 2, drop: [] }])
  expect(nmsSteps(d, 0.9).kept).toEqual([1, 3, 0, 2])
})

test('a 3 × 3 conv + ReLU on a known patch, and a 2 × 2 max pool', () => {
  const p = { w: 3, h: 3, data: Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]) }
  const L: ConvLayer = { k: [[[0, -1, 0, -1, 4, -1, 0, -1, 0]], [[0, 1, 0, 1, -4, 1, 0, 1, 0]]], bias: [0, 0] }
  const [a, b] = convRelu([p], L)
  expect(Array.from(a.data)).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0])
  expect(Array.from(b.data)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0])
  expect(Array.from(maxPool({ w: 4, h: 2, data: Float32Array.from([1, 5, 2, 0, 3, 4, 7, 1]) }, 2).data)).toEqual([5, 7])
})

test('int8 weights land on 255 levels of max|w| / 127', () => {
  const q = int8Layer({ k: [[[1.27, 0.004, -0.5, 0, 0, 0, 0, 0, 0]]], bias: [0] })
  expect(q.k[0][0][0]).toBeCloseTo(1.27, 9)
  expect(q.k[0][0][1]).toBe(0)
  expect(q.k[0][0][2]).toBeCloseTo(-0.5, 2)
})

test('precision/recall: greedy matching, PR points and AP', () => {
  const truth = [{ cls: 0, box: [0, 0, 10, 10] as BBox }, { cls: 0, box: [20, 0, 30, 10] as BBox }]
  const m = matchDets([det([0, 0, 10, 10], 0.9), det([1, 1, 10, 10], 0.8), det([40, 0, 50, 10], 0.7)], truth)
  expect(m.map((x) => x.tp)).toEqual([true, false, false])
  const pr = prCurve([{ score: 0.9, tp: true }, { score: 0.8, tp: false }, { score: 0.7, tp: true }], 2)
  expect(pr.pts.map((q) => [q.p, q.r])).toEqual([[1, 0.5], [0.5, 0.5], [2 / 3, 1]])
  expect(pr.ap).toBeCloseTo(0.5 + 0.5 * (2 / 3), 9)
  expect(prAt([{ score: 0.9, tp: true }, { score: 0.8, tp: false }], 2, 0.85)).toEqual({ p: 1, r: 0.5, tp: 1, fp: 0, fn: 1 })
})

test('the hand-set net finds a lone red ball with a tight box and the right class', () => {
  const objs = [{ cls: 0, x: 0.6, y: 0, size: 0.08 }]
  const R = runDetector(detFrame(objs))
  expect(R.conv1).toHaveLength(4)
  expect([R.pool2[0].w, R.pool2[0].h]).toEqual([8, 6])
  const best = [...R.dets].sort((a, b) => b.score - a.score)[0]
  expect(best.cls).toBe(0)
  expect(best.score).toBeGreaterThan(0.6)
  expect(boxIoU(best.box, truthBoxes(objs)[0].box)).toBeGreaterThan(0.6)
})

test('labelled set is repeatable; the net scores AP > 0.6 at 48 × 36 and much less at 24 × 18', () => {
  const ds = detDataset(12, 1)
  expect(detDataset(12, 1)).toEqual(ds)
  const ap = (w: number, h: number) => {
    const s: { score: number; tp: boolean }[] = []
    let n = 0
    ds.forEach((d, i) => {
      const t = truthBoxes(d.objs, w, h)
      n += t.length
      const dets = runDetector(detFrame(d.objs, w, h, d.card, i + 1)).dets
      s.push(...matchDets(nmsSteps(dets, 0.45).kept.map((k) => dets[k]), t).map((x) => ({ score: x.det.score, tp: x.tp })))
    })
    return prCurve(s, n).ap
  }
  expect(ap(48, 36)).toBeGreaterThan(0.6)
  expect(ap(24, 18)).toBeLessThan(ap(48, 36) - 0.2)
})

test('net cost: conv1 on 48 × 36 is 48·36·4·3·9 MACs', () => {
  const c = netCost(48, 36)
  expect(c.layers[0].macs).toBe(48 * 36 * 4 * 3 * 9)
  expect(c.layers[2].macs).toBe(24 * 18 * 3 * 4 * 9)
  expect(c.params).toBe(4 * 28 + 3 * 37 + 4)
})

test('frame budget: the tiny net is camera-bound on an ESP32, YOLOv8n takes minutes, float SSD does not fit, faster chips raise fps', () => {
  const tiny = frameBudget(ACCELERATORS.esp32, DETECT_MODELS.tiny)
  expect(tiny.cameraBound).toBe(true)
  expect(tiny.fps).toBeCloseTo(25, 6)
  expect(frameBudget(ACCELERATORS.esp32, DETECT_MODELS.yolov8n).netS).toBeGreaterThan(60)
  expect(frameBudget(ACCELERATORS.esp32, DETECT_MODELS.ssd, false).fits).toBe(false)
  const ssdPi = frameBudget(ACCELERATORS.pi5, DETECT_MODELS.ssd)
  const v8Hailo = frameBudget(ACCELERATORS.hailo, DETECT_MODELS.yolov8n)
  const v8Pi = frameBudget(ACCELERATORS.pi5, DETECT_MODELS.yolov8n)
  expect(ssdPi.netS).toBeCloseTo(0.8e9 / 30e9 + 1e-3, 6)
  expect(v8Hailo.fps).toBeGreaterThan(v8Pi.fps)
  expect(v8Hailo.latencyS).toBeLessThan(v8Pi.latencyS)
  expect(tinyMemory(48, 36, true).total).toBeLessThan(tinyMemory(48, 36, false).total)
  expect(travelOf(1, 10, 0.2)).toEqual({ between: 0.1, stale: 0.2 })
})
