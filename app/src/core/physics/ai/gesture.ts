// Gesture recognition from an accelerometer: synthetic 1 s windows (x forward, y left, z up, in g), 12 features per
// window (per axis: mean, spread, peak-to-peak, dominant frequency) and a small classifier trained once, seeded.
import { gaussRng, seededRng, stdDev } from '../common'
import { dominantHz } from '../sensors/microphone'
import { dftAmplitudes } from '../signals/fourier'
import { Mlp, Sample, mlpInit, mlpOut, mlpTrain } from './net'

export const GESTURES = { idle: 'Idle', shake: 'Shake', circle: 'Circle', punch: 'Punch' }
export type Gesture = keyof typeof GESTURES
export const GESTURE_KEYS = Object.keys(GESTURES) as Gesture[]
export const IMU_HZ = 50
export const WINDOW_N = 50
export const FEATURE_NAMES = ['x mean', 'x σ', 'x p-p', 'x f', 'y mean', 'y σ', 'y p-p', 'y f', 'z mean', 'z σ', 'z p-p', 'z f']

export interface ImuWindow { ax: number[]; ay: number[]; az: number[] }

const bump = (t: number, at: number, w: number) => Math.exp(-0.5 * ((t - at) / w) ** 2)
const hann = (t: number, a: number, b: number) => (t < a || t > b ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - a)) / (b - a)))

/** One window of `kind`, varied by `seed` (tilt, size, speed, timing) plus white noise of `noiseG` (g rms). */
export function gestureWindow(kind: Gesture, seed: number, noiseG = 0.05): ImuWindow {
  const rng = seededRng(seed * 31 + GESTURE_KEYS.indexOf(kind) * 7919)
  const u = (a: number, b: number) => a + (b - a) * rng()
  const pitch = u(-0.25, 0.25)
  const roll = u(-0.25, 0.25)
  const amp = u(0.75, 1.25)
  const fk = u(0.8, 1.2)
  const t0 = u(0.2, 0.35)
  const ph = u(0, 2 * Math.PI)
  const gauss = gaussRng(rng)
  const w: ImuWindow = { ax: [], ay: [], az: [] }
  for (let i = 0; i < WINDOW_N; i++) {
    const t = i / IMU_HZ
    let [x, y, z] = [-Math.sin(pitch), Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch)]
    if (kind === 'idle') x += 0.04 * amp * Math.sin(2 * Math.PI * 0.6 * t + ph)
    if (kind === 'shake') {
      const e = hann(t, t0 - 0.15, t0 + 0.6)
      x += 1.6 * amp * e * Math.sin(2 * Math.PI * 5 * fk * t + ph)
      y += 0.25 * amp * e * Math.sin(2 * Math.PI * 5 * fk * t + ph + 1)
    }
    if (kind === 'circle') {
      const a = 2 * Math.PI * 1.6 * fk * t + ph
      y += 0.8 * amp * Math.cos(a)
      z += 0.8 * amp * Math.sin(a)
    }
    if (kind === 'punch') {
      const s = 0.04 * fk
      x += 2.6 * amp * bump(t, t0, s) - 1.8 * amp * bump(t, t0 + 0.12, 2 * s)
      z += 0.3 * amp * bump(t, t0 + 0.05, 2 * s)
    }
    w.ax.push(x + noiseG * gauss())
    w.ay.push(y + noiseG * gauss())
    w.az.push(z + noiseG * gauss())
  }
  return w
}

/** 12 features, about −1…1: mean (g), σ (g), peak-to-peak ÷ 4 g, dominant frequency ÷ Nyquist. */
export function gestureFeatures(w: ImuWindow) {
  return [w.ax, w.ay, w.az].flatMap((xs) => {
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length
    return [mean, stdDev(xs), (Math.max(...xs) - Math.min(...xs)) / 4, dominantHz(dftAmplitudes(xs, true), IMU_HZ, xs.length) / (IMU_HZ / 2)]
  })
}

/** Multiply-adds to turn one window into features: a DFT per axis (2 per sample per bin) plus ~4 per sample for the stats. */
export const FEATURE_MACS = 3 * WINDOW_N * ((WINDOW_N / 2 + 1) * 2 + 4)

export const classTarget = (k: number, n: number) => Array.from({ length: n }, (_, i) => (i === k ? 1 : 0))

/** `per` windows of every gesture, seeds from `seed`. */
export function gestureSet(per: number, noiseG: number, seed = 1): Sample[] {
  return GESTURE_KEYS.flatMap((g, k) => Array.from({ length: per }, (_, i) => ({ x: gestureFeatures(gestureWindow(g, seed + i, noiseG)), t: classTarget(k, GESTURE_KEYS.length) })))
}

export function argmax(xs: ArrayLike<number>) {
  let k = 0
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[k]) k = i
  return k
}

/** Rows = true class, columns = predicted (by `predict`, default the float forward pass). */
export function confusion(net: Mlp, data: readonly Sample[], predict: (x: number[]) => ArrayLike<number> = (x) => mlpOut(net, x)) {
  const n = data[0].t.length
  const m = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const d of data) m[argmax(d.t)][argmax(predict(d.x))]++
  return m
}
export const confusionAccuracy = (m: number[][]) => m.reduce((s, r, i) => s + r[i], 0) / Math.max(1, m.flat().reduce((s, v) => s + v, 0))

const trained = new Map<number, { net: Mlp; train: Sample[] }>()
/** The 12-8-4 classifier, trained once per `noiseG` on 40 windows per gesture (mini-batch gradient descent, cross-entropy). */
export function gestureNet(noiseG = 0.05) {
  const hit = trained.get(noiseG)
  if (hit) return hit
  const train = gestureSet(40, noiseG, 1)
  const net = mlpTrain(mlpInit([12, 8, 4], ['tanh', 'sigmoid'], 3), train, { lr: 0.5, epochs: 80, loss: 'bce', batch: 16, seed: 2, snaps: 2 }).net
  trained.set(noiseG, { net, train })
  return { net, train }
}
