import { Mlp, mlpAccuracy, mlpBatchGrads, mlpField, mlpForward, mlpGrads, mlpInit, mlpLoss, mlpNumGrads, mlpOut, mlpTrain, lossOf, LossKind, Activation } from './net'
import { gateSet, toySet, TOY_SPAN } from './data'
import { perceptronOut, perceptronRun } from './perceptron'

const HAND: Mlp = [
  { act: 'relu', W: [[1, -1], [0.5, 0.5]], b: [0, -0.5] },
  { act: 'linear', W: [[2, -1]], b: [0.5] },
]

describe('forward and backprop', () => {
  it('hand-worked forward pass', () => {
    const { z, a } = mlpForward(HAND, [1, 0.5])
    expect(z[0]).toEqual([0.5, 0.25])
    expect(a[1]).toEqual([0.5, 0.25])
    expect(a[2][0]).toBeCloseTo(1.25)
    expect(mlpOut(HAND, [1, 0.5])[0]).toBeCloseTo(1.25)
  })
  it('hand-worked gradients (MSE, t = 1)', () => {
    const g = mlpGrads(HAND, [1, 0.5], [1], 'mse')
    expect(g.loss).toBeCloseTo(0.03125)
    expect(g.gW[1][0][0]).toBeCloseTo(0.125)
    expect(g.gW[1][0][1]).toBeCloseTo(0.0625)
    expect(g.gb[1][0]).toBeCloseTo(0.25)
    expect(g.gW[0][0]).toEqual([0.5, 0.25])
    expect(g.gW[0][1]).toEqual([-0.25, -0.125])
    expect(g.gb[0]).toEqual([0.5, -0.25])
  })
  it('BCE loss values', () => {
    expect(lossOf([0.5], [1], 'bce')).toBeCloseTo(Math.LN2)
    expect(lossOf([0.9], [0], 'bce')).toBeCloseTo(-Math.log(0.1))
  })
  const cases: [Activation[], LossKind][] = [
    [['tanh', 'sigmoid'], 'bce'],
    [['sigmoid', 'sigmoid'], 'mse'],
    [['relu', 'tanh', 'linear'], 'mse'],
    [['tanh', 'relu', 'sigmoid'], 'bce'],
  ]
  it.each(cases)('backprop matches finite differences: %s, %s', (acts, kind) => {
    const sizes = [2, ...acts.slice(0, -1).map((_, i) => 3 + i), 2]
    const net = mlpInit(sizes, acts, 7)
    net.forEach((L) => L.b.forEach((_, j) => (L.b[j] = 0.1 * (j + 1))))
    const x = [0.4, -0.7]
    const t = [1, 0]
    const g = mlpGrads(net, x, t, kind)
    const num = mlpNumGrads(net, x, t, kind)
    g.gW.forEach((m, l) => m.forEach((r, j) => r.forEach((v, i) => expect(v).toBeCloseTo(num.gW[l][j][i], 6))))
    g.gb.forEach((r, l) => r.forEach((v, j) => expect(v).toBeCloseTo(num.gb[l][j], 6)))
  })
  it('batch gradient = mean of per-sample gradients + l2·W', () => {
    const net = mlpInit([2, 4, 1], ['tanh', 'sigmoid'], 3)
    const data = toySet('moons', 6, 0.1, 2)
    const l2 = 0.01
    const B = mlpBatchGrads(net, data, 'bce', l2)
    const each = data.map((d) => mlpGrads(net, d.x, d.t, 'bce'))
    net.forEach((L, l) => L.W.forEach((r, j) => r.forEach((w, i) => expect(B.gW[l][j][i]).toBeCloseTo(each.reduce((s, g) => s + g.gW[l][j][i], 0) / 6 + l2 * w, 10))))
    expect(B.gb[1][0]).toBeCloseTo(each.reduce((s, g) => s + g.gb[1][0], 0) / 6, 10)
    expect(B.loss).toBeCloseTo(mlpLoss(net, data, 'bce', l2), 10)
  })
})

describe('training', () => {
  const xor = gateSet('xor')
  it('one neuron cannot do XOR; a hidden layer of two can', () => {
    const one = mlpTrain(mlpInit([2, 1], ['sigmoid'], 2), xor, { lr: 1, epochs: 400, loss: 'bce' })
    const two = mlpTrain(mlpInit([2, 2, 1], ['tanh', 'sigmoid'], 2), xor, { lr: 1, epochs: 400, loss: 'bce' })
    expect(mlpAccuracy(one.net, xor)).toBeLessThanOrEqual(0.75)
    expect(mlpAccuracy(two.net, xor)).toBe(1)
    expect(two.curve[two.curve.length - 1].train).toBeLessThan(0.05)
  })
  it('seeded and repeatable', () => {
    const d = toySet('circles', 40, 0.1, 4)
    const run = () => mlpTrain(mlpInit([2, 4, 1], ['relu', 'sigmoid'], 5), d, { lr: 0.5, epochs: 50, loss: 'bce', batch: 8, seed: 3 })
    expect(run().curve).toEqual(run().curve)
  })
  it('a good step size learns, a huge one blows up', () => {
    const d = toySet('circles', 100, 0.1, 3)
    const run = (lr: number) => mlpTrain(mlpInit([2, 8, 1], ['tanh', 'sigmoid'], 2), d, { lr, epochs: 400, loss: 'bce' })
    const ok = run(3)
    const wild = run(10)
    expect(ok.curve[ok.curve.length - 1].train).toBeLessThan(0.05)
    expect(mlpAccuracy(ok.net, d)).toBe(1)
    expect(wild.curve[wild.curve.length - 1].train).toBeGreaterThan(wild.curve[0].train)
  })
  it('a big net on few points overfits; more points cure it', () => {
    const val = toySet('moons', 200, 0.25, 99)
    const run = (n: number) => mlpTrain(mlpInit([2, 24, 1], ['tanh', 'sigmoid'], 1), toySet('moons', n, 0.25, 5), { lr: 0.3, epochs: 1200, loss: 'bce', val })
    const gap = (r: ReturnType<typeof run>) => r.curve[r.curve.length - 1].val - Math.min(...r.curve.map((c) => c.val))
    const few = run(10)
    expect(few.curve[few.curve.length - 1].train).toBeLessThan(0.05)
    expect(gap(few)).toBeGreaterThan(0.3)
    expect(gap(run(50))).toBeLessThan(0.05)
  })
  it('records snapshots from epoch 0', () => {
    const r = mlpTrain(mlpInit([2, 2, 1], ['tanh', 'sigmoid'], 2), xor, { lr: 1, epochs: 100, loss: 'bce', snaps: 10 })
    expect(r.nets.map((s) => s.epoch)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(r.curve.length).toBe(11)
  })
})

describe('data and helpers', () => {
  it('toy sets are balanced and inside the span', () => {
    for (const k of ['moons', 'circles', 'xor'] as const) {
      const d = toySet(k, 100, 0.1, 1)
      expect(d.filter((s) => s.t[0] === 1).length).toBe(50)
      expect(d.every((s) => Math.abs(s.x[0]) < TOY_SPAN && Math.abs(s.x[1]) < TOY_SPAN)).toBe(true)
    }
  })
  it('field rows run top to bottom', () => {
    const up: Mlp = [{ act: 'sigmoid', W: [[0, 10]], b: [0] }]
    const f = mlpField(up, 4, -1, 1)
    expect(f[0]).toBeGreaterThan(0.99)
    expect(f[15]).toBeLessThan(0.01)
  })
})

describe('perceptron', () => {
  it('first update by hand', () => {
    const r = perceptronRun([{ x: [1, 1], t: [1] }], 0.5, 1)
    expect(r.steps[0]).toEqual({ w: [0.5, 0.5], b: 0.5, i: 0, y: 0, wrong: true })
    expect(perceptronOut(r.w, r.b, [1, 1])).toBe(1)
  })
  it('converges on AND, OR, NAND but never on XOR', () => {
    for (const g of ['and', 'or', 'nand'] as const) {
      const d = gateSet(g)
      const r = perceptronRun(d, 0.2, 50, [0.3, -0.5], 0.1)
      expect(r.converged).not.toBeNull()
      expect(d.every((s) => perceptronOut(r.w, r.b, s.x) === s.t[0])).toBe(true)
    }
    const x = perceptronRun(gateSet('xor'), 0.2, 50, [0.3, -0.5], 0.1)
    expect(x.converged).toBeNull()
    expect(Math.min(...x.mistakes)).toBeGreaterThan(0)
  })
})
