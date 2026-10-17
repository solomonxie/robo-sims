import { ACCELERATORS } from '../perception/inference'
import { KB } from '../mcu/memory'
import { Mlp, argmax, confusion, confusionAccuracy, mlpInit, mlpOut } from './net'
import { toySet } from './data'
import { FIRMWARE_FLASH, SYSTEM_SRAM, TINY_MODELS, actRanges, deployCost, dequantizeQ, fakeQuant, intDot, mlpArena, mlpMacs, mlpOutQ, quantParams, quantizeMlp, quantizeQ, spanHistogram } from './tinyml'
import { FEATURE_MACS, GESTURE_KEYS, gestureFeatures, gestureNet, gestureSet, gestureWindow } from './gesture'

describe('quantization', () => {
  it('symmetric int8: scale = max|v| / 127, zero 0', () => {
    const q = quantParams(-0.5, 1.27, 8)
    expect(q.scale).toBeCloseTo(0.01)
    expect(q.zero).toBe(0)
    expect(quantizeQ(0.5, q)).toBe(50)
    expect(quantizeQ(-9, q)).toBe(-127)
    expect(dequantizeQ(50, q)).toBeCloseTo(0.5)
  })
  it('asymmetric: 0…2.55 uses all 256 codes, zero-point −128, 0 exact', () => {
    const q = quantParams(0, 2.55, 8, false)
    expect(q.scale).toBeCloseTo(0.01)
    expect(q.zero).toBe(-128)
    expect(quantizeQ(0, q)).toBe(-128)
    expect(fakeQuant(0, q)).toBe(0)
    expect(quantizeQ(2.55, q)).toBe(127)
  })
  it('round trip error ≤ half a step; fewer bits, bigger steps', () => {
    for (const bits of [2, 4, 8]) {
      const q = quantParams(-1, 1, bits)
      for (let v = -1; v <= 1; v += 0.013) expect(Math.abs(fakeQuant(v, q) - v)).toBeLessThanOrEqual(q.scale / 2 + 1e-12)
    }
    expect(quantParams(-1, 1, 4).scale).toBeCloseTo(1 / 7)
  })
  it('integer dot product ≈ float dot product', () => {
    expect(intDot([1, 2, 3], [4, -5, 6])).toBe(12)
    expect(intDot([10, 12], [3, 5], 10, 1)).toBe(8)
    const a = [0.3, -0.7, 0.55, 0.1]
    const w = [0.9, 0.2, -0.45, 0.6]
    const qa = quantParams(-1, 1, 8, false)
    const qw = quantParams(-1, 1, 8)
    const acc = intDot(a.map((v) => quantizeQ(v, qa)), w.map((v) => quantizeQ(v, qw)), qa.zero, qw.zero)
    const real = a.reduce((s, v, i) => s + v * w[i], 0)
    expect(acc * qa.scale * qw.scale).toBeCloseTo(real, 2)
  })
  it('per-channel beats per-tensor when rows differ in size', () => {
    const net: Mlp = [{ act: 'linear', W: [[1, -0.8], [0.013, 0.021]], b: [0, 0] }]
    const t = quantizeMlp(net, 4, 'tensor')
    const c = quantizeMlp(net, 4, 'channel')
    expect(t.net[0].W[1]).toEqual([0, 0])
    expect(c.rms).toBeLessThan(t.rms)
    expect(quantizeMlp(net, 8, 'channel').rms).toBeLessThan(c.rms)
  })
  it('int8 weights and activations keep a trained net\'s outputs', () => {
    const data = toySet('moons', 60, 0.1, 3)
    const net = mlpInit([2, 8, 1], ['tanh', 'sigmoid'], 2)
    const r = actRanges(net, data)
    expect(r[0][0]).toBeLessThan(0)
    const q = quantizeMlp(net, 8, 'channel').net
    for (const d of data.slice(0, 10)) expect(mlpOutQ(q, d.x, r)[0]).toBeCloseTo(mlpOut(net, d.x)[0], 1)
  })
  it('histogram over a span', () => {
    expect(spanHistogram([-1, -0.1, 0.1, 0.9, 5], -1, 1, 4)).toEqual([1, 1, 1, 2])
  })
})

describe('deployment cost', () => {
  const net: Mlp = [{ act: 'tanh', W: Array(8).fill(Array(12).fill(0)), b: Array(8).fill(0) }, { act: 'sigmoid', W: Array(4).fill(Array(8).fill(0)), b: Array(4).fill(0) }]
  it('MACs and arena of a 12-8-4 net', () => {
    expect(mlpMacs(net)).toBe(128)
    expect(mlpArena(net)).toBe(20)
    expect(mlpArena(net, 4)).toBe(80)
  })
  it('person detector: float spills out of SRAM, int8 fits; time = MACs ÷ rate', () => {
    const m = TINY_MODELS.person
    const f = deployCost(m, 32, ACCELERATORS.esp32)
    const i = deployCost(m, 8, ACCELERATORS.esp32)
    expect(f.weights).toBe(4 * 208e3)
    expect(i.weights).toBe(208e3)
    expect(i.flash).toBe(FIRMWARE_FLASH + 208e3)
    expect(i.sram).toBe(SYSTEM_SRAM + 136 * KB)
    expect(f.fitsSram).toBe(false)
    expect(i.fitsSram).toBe(true)
    expect(i.seconds).toBeCloseTo(7.5e6 / 30e6)
    expect(deployCost(m, 8, ACCELERATORS.esp32s3).seconds).toBeLessThan(i.seconds / 4)
    expect(i.energyJ).toBeCloseTo(0.5 * i.seconds)
    expect(deployCost(m, 4, ACCELERATORS.esp32).weights).toBe(104e3)
  })
  it('MobileNet v2 int8 is too big for a 3 MB app slot; int4 fits', () => {
    expect(deployCost(TINY_MODELS.mobilenet, 8, ACCELERATORS.esp32).fitsFlash).toBe(false)
    expect(deployCost(TINY_MODELS.mobilenet, 4, ACCELERATORS.esp32).fitsFlash).toBe(true)
  })
})

describe('gestures', () => {
  it('windows are repeatable, gravity shows on z', () => {
    const a = gestureWindow('idle', 3)
    expect(gestureWindow('idle', 3)).toEqual(a)
    const f = gestureFeatures(a)
    expect(f).toHaveLength(12)
    expect(f[8]).toBeGreaterThan(0.9)
    expect(f[1]).toBeLessThan(0.1)
  })
  it('shake: dominant x frequency near 5 Hz; circle: y and z swing', () => {
    const s = gestureFeatures(gestureWindow('shake', 2, 0))
    expect(s[3] * 25).toBeGreaterThan(3.5)
    expect(s[3] * 25).toBeLessThan(6.5)
    const c = gestureFeatures(gestureWindow('circle', 2, 0))
    expect(c[5]).toBeGreaterThan(0.3)
    expect(c[9]).toBeGreaterThan(0.3)
  })
  it('feature cost: 3 axes × 50 samples × (26 bins × 2 + 4)', () => expect(FEATURE_MACS).toBe(8400))
  it('argmax and confusion', () => {
    expect(argmax([0.1, 0.7, 0.2])).toBe(1)
    expect(confusionAccuracy([[3, 1], [0, 4]])).toBe(0.875)
  })
  it('trained net classifies held-out windows, also with int8 weights', () => {
    const { net } = gestureNet()
    const test = gestureSet(20, 0.05, 500)
    const m = confusion(net, test)
    expect(m).toHaveLength(GESTURE_KEYS.length)
    expect(confusionAccuracy(m)).toBeGreaterThan(0.9)
    const q = quantizeMlp(net, 8, 'channel').net
    expect(confusionAccuracy(confusion(q, test))).toBeGreaterThan(0.9)
  })
})
