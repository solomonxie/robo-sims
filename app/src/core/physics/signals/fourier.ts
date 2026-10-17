// Fourier series of classic waves, a small DFT, and sampling: every periodic signal is a sum of sines.
import { frac } from '../common'

export type Periodic = 'square' | 'saw' | 'triangle'

/** One term amp · sin(k · 2π · cycles). */
export interface Harmonic {
  k: number
  amp: number
}

/** The ideal wave, ±1 peak: square high for the first half, saw ramping −1 → 1 through 0 at cycle 0, triangle like a sine. */
export function periodicAt(shape: Periodic, cycles: number) {
  const c = frac(cycles)
  if (shape === 'square') return c < 0.5 ? 1 : -1
  if (shape === 'saw') return 2 * frac(cycles + 0.5) - 1
  return c < 0.25 ? 4 * c : c < 0.75 ? 2 - 4 * c : 4 * c - 4
}

/** Sine amplitude of harmonic k: square 4/πk (odd), saw ±2/πk, triangle ±8/π²k² (odd). */
export function harmonicAmp(shape: Periodic, k: number) {
  if (shape === 'saw') return ((k % 2 ? 1 : -1) * 2) / (Math.PI * k)
  if (k % 2 === 0) return 0
  if (shape === 'square') return 4 / (Math.PI * k)
  return ((((k - 1) / 2) % 2 ? -1 : 1) * 8) / (Math.PI * Math.PI * k * k)
}

/** The non-zero terms up to harmonic `maxK`. */
export const fourierTerms = (shape: Periodic, maxK: number): Harmonic[] =>
  Array.from({ length: maxK }, (_, i) => ({ k: i + 1, amp: harmonicAmp(shape, i + 1) })).filter((h) => h.amp !== 0)

export const seriesAt = (terms: Harmonic[], cycles: number) => terms.reduce((s, h) => s + h.amp * Math.sin(2 * Math.PI * h.k * cycles), 0)

/** Highest point of the partial sum over one cycle; above 1 is the Gibbs overshoot. */
export function seriesPeak(terms: Harmonic[], samples = 4096) {
  let peak = -Infinity
  for (let i = 0; i < samples; i++) peak = Math.max(peak, seriesAt(terms, i / samples))
  return peak
}

/** RMS gap between the partial sum and the ideal wave. */
export function seriesRmsError(shape: Periodic, terms: Harmonic[], samples = 2048) {
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const c = (i + 0.5) / samples
    sum += (seriesAt(terms, c) - periodicAt(shape, c)) ** 2
  }
  return Math.sqrt(sum / samples)
}

/** Single-sided amplitude spectrum, bins 0 … N/2 (bin m = m · fs / N): a sine of amplitude A on a bin reads A.
 *  `hann` tapers the window so off-bin tones leak less. */
export function dftAmplitudes(samples: number[], hann = false) {
  const N = samples.length
  const cos = Array.from({ length: N }, (_, i) => Math.cos((2 * Math.PI * i) / N))
  const sin = Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / N))
  const w = samples.map((x, i) => (hann ? x * (1 - cos[i]) : x))
  return Array.from({ length: Math.floor(N / 2) + 1 }, (_, m) => {
    let re = 0
    let im = 0
    for (let i = 0, k = 0; i < N; i++, k = (k + m) % N) {
      re += w[i] * cos[k]
      im -= w[i] * sin[k]
    }
    return (Math.hypot(re, im) / N) * (m === 0 || m === N / 2 ? 1 : 2)
  })
}

/** Where a tone at `hz` lands after sampling at `fs`: folded into −fs/2 … fs/2 (negative = runs backwards). */
export const aliasFrequency = (hz: number, fs: number) => hz - fs * Math.round(hz / fs)

export const nyquist = (fs: number) => fs / 2
