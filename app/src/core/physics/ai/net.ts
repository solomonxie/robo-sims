// Dense neural nets: forward pass, losses, backprop, gradient-descent training.
import { gaussRng, parkMiller } from '../common'

export type Activation = 'sigmoid' | 'tanh' | 'relu' | 'linear'
/** f(z) and its slope, given z and a = f(z). */
export const ACTIVATIONS: Record<Activation, { f: (z: number) => number; df: (z: number, a: number) => number }> = {
  sigmoid: { f: (z) => 1 / (1 + Math.exp(-z)), df: (_z, a) => a * (1 - a) },
  tanh: { f: Math.tanh, df: (_z, a) => 1 - a * a },
  relu: { f: (z) => (z > 0 ? z : 0), df: (z) => (z > 0 ? 1 : 0) },
  linear: { f: (z) => z, df: () => 1 },
}

/** W[j][i]: input i → neuron j. */
export interface Dense { W: number[][]; b: number[]; act: Activation }
export type Mlp = Dense[]
export type LossKind = 'mse' | 'bce'
export interface Sample { x: number[]; t: number[] }
export interface MlpGrads { gW: number[][][]; gb: number[][] }

/** Gaussian weights, std √(1/fan-in) (√(2/fan-in) for ReLU), zero biases. */
export function mlpInit(sizes: readonly number[], acts: readonly Activation[], seed = 1): Mlp {
  const g = gaussRng(parkMiller(seed))
  return acts.map((act, l) => {
    const s = Math.sqrt((act === 'relu' ? 2 : 1) / sizes[l])
    return { act, W: Array.from({ length: sizes[l + 1] }, () => Array.from({ length: sizes[l] }, () => g() * s)), b: new Array(sizes[l + 1]).fill(0) }
  })
}

export const mlpClone = (net: Mlp): Mlp => net.map((L) => ({ act: L.act, W: L.W.map((r) => r.slice()), b: L.b.slice() }))
export const mlpSizes = (net: Mlp) => [net[0].W[0].length, ...net.map((L) => L.b.length)]
export const mlpParams = (net: Mlp) => net.reduce((s, L) => s + L.b.length * (L.W[0].length + 1), 0)

/** Pre-activations z[l] and activations a[l] (a[0] = input). */
export function mlpForward(net: Mlp, x: readonly number[]) {
  const z: number[][] = []
  const a: number[][] = [x.slice()]
  for (const L of net) {
    const inp = a[a.length - 1]
    const f = ACTIVATIONS[L.act].f
    const zl = L.b.map((b, j) => {
      let s = b
      const w = L.W[j]
      for (let i = 0; i < inp.length; i++) s += w[i] * inp[i]
      return s
    })
    z.push(zl)
    a.push(zl.map(f))
  }
  return { z, a }
}

export function mlpOut(net: Mlp, x: readonly number[]) {
  let a = x as number[]
  for (const L of net) {
    const f = ACTIVATIONS[L.act].f
    a = L.b.map((b, j) => {
      let s = b
      const w = L.W[j]
      for (let i = 0; i < a.length; i++) s += w[i] * a[i]
      return f(s)
    })
  }
  return a
}

const EPS = 1e-12
/** MSE = ½ Σ (y − t)²; BCE = −Σ t ln y + (1 − t) ln(1 − y). */
export function lossOf(y: ArrayLike<number>, t: ArrayLike<number>, kind: LossKind) {
  let s = 0
  for (let k = 0; k < y.length; k++)
    s += kind === 'mse' ? 0.5 * (y[k] - t[k]) ** 2 : -(t[k] * Math.log(Math.max(EPS, y[k])) + (1 - t[k]) * Math.log(Math.max(EPS, 1 - y[k])))
  return s
}

/** Backprop for one sample: dLoss/dW, dLoss/db and the loss. */
export function mlpGrads(net: Mlp, x: readonly number[], t: readonly number[], kind: LossKind): MlpGrads & { loss: number } {
  const { z, a } = mlpForward(net, x)
  const y = a[net.length]
  const out = net[net.length - 1]
  let delta = y.map((yk, k) =>
    kind === 'bce' && out.act === 'sigmoid'
      ? yk - t[k]
      : (kind === 'mse' ? yk - t[k] : (yk - t[k]) / Math.max(EPS, yk * (1 - yk))) * ACTIVATIONS[out.act].df(z[net.length - 1][k], yk),
  )
  const gW: number[][][] = new Array(net.length)
  const gb: number[][] = new Array(net.length)
  for (let l = net.length - 1; l >= 0; l--) {
    const inp = a[l]
    gW[l] = delta.map((d) => inp.map((v) => d * v))
    gb[l] = delta
    if (l === 0) break
    const below = net[l - 1]
    const W = net[l].W
    delta = inp.map((al, i) => {
      let s = 0
      for (let j = 0; j < delta.length; j++) s += W[j][i] * delta[j]
      return s * ACTIVATIONS[below.act].df(z[l - 1][i], al)
    })
  }
  return { gW, gb, loss: lossOf(y, t, kind) }
}

/** Central finite differences of the loss, for checking backprop. */
export function mlpNumGrads(net: Mlp, x: readonly number[], t: readonly number[], kind: LossKind, h = 1e-5): MlpGrads {
  const f = () => lossOf(mlpOut(net, x), t, kind)
  const nudge = (row: number[], i: number) => {
    const v = row[i]
    row[i] = v + h
    const up = f()
    row[i] = v - h
    const dn = f()
    row[i] = v
    return (up - dn) / (2 * h)
  }
  return { gW: net.map((L) => L.W.map((r) => r.map((_, i) => nudge(r, i)))), gb: net.map((L) => L.b.map((_, j) => nudge(L.b, j))) }
}

/** Mean loss over a set, plus ½·l2·Σw² if given. */
export function mlpLoss(net: Mlp, data: readonly Sample[], kind: LossKind, l2 = 0) {
  let s = 0
  for (const d of data) s += lossOf(mlpOut(net, d.x), d.t, kind)
  return s / Math.max(1, data.length) + (l2 ? 0.5 * l2 * weightSq(net) : 0)
}
const weightSq = (net: Mlp) => net.reduce((s, L) => s + L.W.reduce((q, r) => q + r.reduce((u, w) => u + w * w, 0), 0), 0)

/** Mean gradient over a batch (+ l2·W) and the mean loss; same maths as `mlpGrads`, on flat buffers for speed. */
export function mlpBatchGrads(net: Mlp, batch: readonly Sample[], kind: LossKind, l2 = 0) {
  const sizes = mlpSizes(net)
  const nL = net.length
  const Wf = net.map((L) => Float64Array.from(L.W.flat()))
  const bf = net.map((L) => Float64Array.from(L.b))
  const gWf = Wf.map((w) => new Float64Array(w.length))
  const gbf = bf.map((b) => new Float64Array(b.length))
  const a = sizes.map((n) => new Float64Array(n))
  const z = sizes.map((n) => new Float64Array(n))
  const dl = sizes.map((n) => new Float64Array(n))
  const fast = kind === 'bce' && net[nL - 1].act === 'sigmoid'
  let loss = 0
  for (const d of batch) {
    const a0 = a[0]
    for (let i = 0; i < sizes[0]; i++) a0[i] = d.x[i]
    for (let l = 0; l < nL; l++) {
      const W = Wf[l]
      const b = bf[l]
      const inp = a[l]
      const zo = z[l + 1]
      const ao = a[l + 1]
      const nIn = inp.length
      for (let j = 0; j < b.length; j++) {
        let s = b[j]
        for (let i = 0, o = j * nIn; i < nIn; i++) s += W[o + i] * inp[i]
        zo[j] = s
      }
      activate(net[l].act, zo, ao)
    }
    const y = a[nL]
    const dOut = dl[nL]
    for (let k = 0; k < y.length; k++) {
      const yk = y[k]
      const tk = d.t[k]
      loss += kind === 'mse' ? 0.5 * (yk - tk) ** 2 : -(tk * Math.log(Math.max(EPS, yk)) + (1 - tk) * Math.log(Math.max(EPS, 1 - yk)))
      dOut[k] = fast ? yk - tk : (kind === 'mse' ? yk - tk : (yk - tk) / Math.max(EPS, yk * (1 - yk))) * ACTIVATIONS[net[nL - 1].act].df(z[nL][k], yk)
    }
    for (let l = nL - 1; l >= 0; l--) {
      const inp = a[l]
      const dd = dl[l + 1]
      const W = Wf[l]
      const gW = gWf[l]
      const gb = gbf[l]
      const nIn = inp.length
      for (let j = 0; j < dd.length; j++) {
        const dj = dd[j]
        for (let i = 0, o = j * nIn; i < nIn; i++) gW[o + i] += dj * inp[i]
        gb[j] += dj
      }
      if (l === 0) break
      const dIn = dl[l]
      for (let i = 0; i < nIn; i++) {
        let s = 0
        for (let j = 0; j < dd.length; j++) s += W[j * nIn + i] * dd[j]
        dIn[i] = s
      }
      slope(net[l - 1].act, z[l], inp, dIn)
    }
  }
  const k = 1 / Math.max(1, batch.length)
  const gW = net.map((L, l) => L.W.map((r, j) => r.map((w, i) => gWf[l][j * r.length + i] * k + l2 * w)))
  const gb = gbf.map((g) => Array.from(g, (v) => v * k))
  return { gW, gb, loss: loss * k + (l2 ? 0.5 * l2 * weightSq(net) : 0) }
}

function activate(act: Activation, z: Float64Array, a: Float64Array) {
  for (let j = 0; j < z.length; j++) {
    const v = z[j]
    a[j] = act === 'tanh' ? 1 - 2 / (1 + Math.exp(2 * v)) : act === 'sigmoid' ? 1 / (1 + Math.exp(-v)) : act === 'relu' ? (v > 0 ? v : 0) : v
  }
}
function slope(act: Activation, z: Float64Array, a: Float64Array, d: Float64Array) {
  for (let i = 0; i < d.length; i++) d[i] *= act === 'tanh' ? 1 - a[i] * a[i] : act === 'sigmoid' ? a[i] * (1 - a[i]) : act === 'relu' ? (z[i] > 0 ? 1 : 0) : 1
}

/** w ← w − lr·g (new net). */
export const mlpStep = (net: Mlp, g: MlpGrads, lr: number): Mlp =>
  net.map((L, l) => ({ act: L.act, W: L.W.map((r, j) => r.map((w, i) => w - lr * g.gW[l][j][i])), b: L.b.map((b, j) => b - lr * g.gb[l][j]) }))

export const gradNorm = (g: MlpGrads) => Math.sqrt(g.gW.reduce((s, m) => s + m.reduce((q, r) => q + r.reduce((u, v) => u + v * v, 0), 0), 0) + g.gb.reduce((s, r) => s + r.reduce((u, v) => u + v * v, 0), 0))

export interface TrainOpts { lr: number; epochs: number; loss: LossKind; l2?: number; batch?: number; seed?: number; val?: readonly Sample[]; snaps?: number }
export interface TrainPoint { epoch: number; train: number; val: number; grad: number }

/** Gradient descent: full batch, or shuffled mini-batches of `batch`. Records the curve and `snaps` evenly spaced nets (epoch 0 first). */
export function mlpTrain(net0: Mlp, data: readonly Sample[], o: TrainOpts) {
  const { lr, epochs, loss, l2 = 0, batch = data.length, seed = 1, val, snaps = 60 } = o
  const rng = parkMiller(seed)
  const order = data.map((_, i) => i)
  let net = mlpClone(net0)
  const every = Math.max(1, Math.round(epochs / snaps))
  const curve: TrainPoint[] = []
  const nets: { epoch: number; net: Mlp }[] = []
  for (let e = 0; e <= epochs; e++) {
    const full = mlpBatchGrads(net, data, loss, l2)
    if (e % every === 0 || e === epochs) {
      curve.push({ epoch: e, train: full.loss, val: val ? mlpLoss(net, val, loss) : NaN, grad: gradNorm(full) })
      nets.push({ epoch: e, net })
    }
    if (e === epochs || !Number.isFinite(full.loss)) break
    if (batch >= data.length) {
      net = mlpStep(net, full, lr)
      continue
    }
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (let s = 0; s < order.length; s += batch) net = mlpStep(net, mlpBatchGrads(net, order.slice(s, s + batch).map((i) => data[i]), loss, l2), lr)
  }
  return { net, curve, nets }
}

/** Share of samples whose first output lands on the right side of 0.5. */
export const mlpAccuracy = (net: Mlp, data: readonly Sample[]) => data.filter((d) => mlpOut(net, d.x)[0] > 0.5 === d.t[0] > 0.5).length / Math.max(1, data.length)

/** First output on an n × n grid over [lo, hi]², row 0 at the top (y = hi). */
export function mlpField(net: Mlp, n: number, lo: number, hi: number) {
  const out = new Float32Array(n * n)
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) out[r * n + c] = mlpOut(net, [lo + ((c + 0.5) / n) * (hi - lo), hi - ((r + 0.5) / n) * (hi - lo)])[0]
  return out
}
