// TinyML: post-training quantization (scale + zero-point), integer dot products, and what a model costs on an ESP32
// (flash for weights, SRAM for the tensor arena, time and energy per inference).
import { clamp } from '../common'
import { KB, REGION_BYTES, appSlot } from '../mcu/memory'
import { Accel } from '../perception/inference'
import { ACTIVATIONS, Mlp, Sample, mlpOut } from './net'

/** real ≈ scale · (q − zero), q an integer in qmin…qmax. */
export interface QParams { scale: number; zero: number; qmin: number; qmax: number }

/** Symmetric: zero = 0, ±max|v| ↦ ±(2^(b−1) − 1). Asymmetric: lo…hi ↦ the full −2^(b−1)…2^(b−1) − 1 (0 stays exact). */
export function quantParams(lo: number, hi: number, bits: number, symmetric = true): QParams {
  const qmax = 2 ** (bits - 1) - 1
  if (symmetric) return { scale: Math.max(Math.abs(lo), Math.abs(hi), 1e-12) / qmax, zero: 0, qmin: -qmax, qmax }
  const qmin = -qmax - 1
  const [a, b] = [Math.min(lo, 0), Math.max(hi, 0)]
  const scale = Math.max(b - a, 1e-12) / (qmax - qmin)
  return { scale, zero: clamp(Math.round(qmin - a / scale), qmin, qmax), qmin, qmax }
}
export const quantizeQ = (v: number, q: QParams) => clamp(Math.round(v / q.scale) + q.zero, q.qmin, q.qmax)
export const dequantizeQ = (k: number, q: QParams) => (k - q.zero) * q.scale
export const fakeQuant = (v: number, q: QParams) => dequantizeQ(quantizeQ(v, q), q)

/** Integer accumulator Σ (a − za)(w − zw); the real dot product is sa · sw · acc. */
export function intDot(qa: readonly number[], qw: readonly number[], za = 0, zw = 0) {
  let acc = 0
  for (let i = 0; i < qa.length; i++) acc += (qa[i] - za) * (qw[i] - zw)
  return acc
}

export type QGrain = 'tensor' | 'channel'

/** Weights to `bits` (symmetric), one scale per layer or per output neuron. Biases stay exact (int32 on the chip). */
export function quantizeMlp(net: Mlp, bits: number, grain: QGrain) {
  let se = 0
  let n = 0
  const out: Mlp = net.map((L) => {
    const layerQ = quantParams(0, Math.max(...L.W.flat().map(Math.abs)), bits)
    return {
      act: L.act,
      b: L.b.slice(),
      W: L.W.map((row) => {
        const q = grain === 'channel' ? quantParams(0, Math.max(...row.map(Math.abs)), bits) : layerQ
        return row.map((v) => {
          const r = fakeQuant(v, q)
          se += (r - v) ** 2
          n++
          return r
        })
      }),
    }
  })
  return { net: out, rms: Math.sqrt(se / Math.max(1, n)) }
}

/** Min/max of the input and of every layer's output over `data` (calibration set). */
export function actRanges(net: Mlp, data: readonly Sample[]): [number, number][] {
  const r: [number, number][] = Array.from({ length: net.length + 1 }, () => [Infinity, -Infinity])
  for (const d of data) {
    let a = d.x
    const see = (l: number) => a.forEach((v) => (r[l] = [Math.min(r[l][0], v), Math.max(r[l][1], v)]))
    see(0)
    net.forEach((L, l) => {
      a = mlpOut([L], a)
      see(l + 1)
    })
  }
  return r
}

/** Forward pass with every activation tensor fake-quantized (asymmetric, `bits`) on its calibrated range. */
export function mlpOutQ(net: Mlp, x: readonly number[], ranges: readonly [number, number][], bits = 8) {
  const qs = ranges.map(([lo, hi]) => quantParams(lo, hi, bits, false))
  let a = x.map((v) => fakeQuant(v, qs[0]))
  net.forEach((L, l) => {
    const f = ACTIVATIONS[L.act].f
    a = L.b.map((b, j) => f(L.W[j].reduce((s, w, i) => s + w * a[i], b)))
    a = a.map((v) => fakeQuant(v, qs[l + 1]))
  })
  return a
}

/** Histogram of `vs` over [lo, hi] in `bins`. */
export function spanHistogram(vs: readonly number[], lo: number, hi: number, bins: number) {
  const h = new Array(bins).fill(0)
  for (const v of vs) h[clamp(Math.floor(((v - lo) / (hi - lo)) * bins), 0, bins - 1)]++
  return h
}

export const mlpMacs = (net: Mlp) => net.reduce((s, L) => s + L.W.length * L.W[0].length, 0)
/** Two live activation buffers (a layer's input and output) at `bytes` each. */
export const mlpArena = (net: Mlp, bytes = 1) => bytes * Math.max(...net.map((L) => L.W[0].length + L.W.length))

/** A deployable model: weights, multiply-adds per inference, peak activation memory at int8. */
export interface TinyModel { name: string; params: number; macs: number; arena: number }
/** Rough published sizes. */
export const TINY_MODELS: Record<string, TinyModel> = {
  kws: { name: 'Keyword spotter (DS-CNN S)', params: 38e3, macs: 5.4e6, arena: 22 * KB },
  person: { name: 'Person detector (MobileNet v1 0.25, 96 × 96)', params: 208e3, macs: 7.5e6, arena: 136 * KB },
  mobilenet: { name: 'MobileNet v2 1.0, 224 × 224', params: 3.4e6, macs: 300e6, arena: 1200 * KB },
}
export const FIRMWARE_FLASH = 400 * KB
export const SYSTEM_SRAM = 100 * KB
export const FLASH_BUDGET = appSlot('huge')
export const SRAM_BUDGET = REGION_BYTES.dram

/** Flash and SRAM use, time and energy per inference for weights at `bits` (32 = float). Below 8 bits weights are
 *  packed in flash but unpacked to int8 to compute, so time and arena match int8. */
export function deployCost(m: TinyModel, bits: number, chip: Accel) {
  const float = bits >= 32
  const weights = Math.ceil((m.params * bits) / 8)
  const arena = m.arena * (float ? 4 : 1)
  const flash = FIRMWARE_FLASH + weights
  const sram = SYSTEM_SRAM + arena
  const seconds = m.macs / (float ? chip.f32 : chip.int8)
  return { weights, arena, flash, sram, fitsFlash: flash <= FLASH_BUDGET, fitsSram: sram <= SRAM_BUDGET, seconds, energyJ: seconds * chip.watts }
}
