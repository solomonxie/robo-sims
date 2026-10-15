// MEMS microphone (INMP441 → I²S → ESP32) and sound direction from time differences between mics.
import { SOUND_C } from '../common'
import { EPSILON_0 } from '../electromagnetism'
import { dftAmplitudes } from '../signals/fourier'
import { wrapPi } from './magnetometer'

export const INMP441 = { sensDbfs: -26, refDb: 94, snrDb: 61, aopDb: 120, bits: 24, slot: 32, highHz: 15000 }
/** MEMS capsule: diaphragm radius, gap to the backplate, compliance, bias. */
export const MEMS = { radiusM: 0.3e-3, gapM: 3e-6, mPerPa: 4e-9, biasV: 10 }

export const splToPa = (db: number) => 20e-6 * 10 ** (db / 20)
export const paToSpl = (pa: number) => 20 * Math.log10(Math.abs(pa) / 20e-6)
/** Diaphragm push toward the backplate (m), + = gap closes. */
export const diaphragmShift = (pa: number) => MEMS.mPerPa * pa
export const micCapF = (shiftM: number) => (EPSILON_0 * Math.PI * MEMS.radiusM ** 2) / (MEMS.gapM - shiftM)
/** Full-scale level: −26 dBFS at 94 dB SPL, 0 dBFS (clipping) at the 120 dB acoustic overload point. */
export const micDbfs = (spl: number) => INMP441.sensDbfs + spl - INMP441.refDb
const FULL = 2 ** (INMP441.bits - 1)
/** Signed 24-bit sample for a pressure in Pa, clipped at full scale. */
export const micCode = (pa: number) => Math.max(-FULL, Math.min(FULL - 1, Math.round(pa * 10 ** (INMP441.sensDbfs / 20) * FULL)))
export const noiseFloorSpl = () => INMP441.refDb - INMP441.snrDb
/** I²S bit clock: two 32-bit slots (L, R) per sample. */
export const i2sSck = (fs: number) => 2 * INMP441.slot * fs

/** First-order sigma-delta: input −1…1 → 1-bit stream whose density of 1s follows the input. */
export function pdmBits(x: number[]) {
  let acc = 0
  let y = 0
  return x.map((v) => {
    acc += v - y
    y = acc >= 0 ? 1 : -1
    return y > 0 ? 1 : (0 as number)
  })
}

export type Sound = 'clap' | 'whine' | 'tone'
export const WHINE_HZ = 1200
export const TONE_HZ = 2000
const CLAP_TAU = 0.004

const hash = (i: number) => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1
const CLAP_PARTS = Array.from({ length: 64 }, (_, i) => {
  const hz = 300 * (12000 / 300) ** (i / 63)
  const amp = Math.exp(-((Math.log2(hz / 2500) / 1.6) ** 2))
  return { hz, amp, ph: 2 * Math.PI * hash(i) }
})
const WHINE_PARTS = [{ hz: 90, amp: 0.35, ph: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ hz: WHINE_HZ * (i + 1), amp: 1 / (i + 1), ph: hash(i + 99) * 6 }))]
const sumAt = (parts: { hz: number; amp: number; ph: number }[], t: number, cut: number) =>
  parts.reduce((s, p) => (p.hz < cut ? s + p.amp * Math.sin(2 * Math.PI * p.hz * t + p.ph) : s), 0)
const CLAP_NORM = 1 / Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(sumAt(CLAP_PARTS, i / 48000, Infinity))))
const WHINE_NORM = 1 / WHINE_PARTS.reduce((s, p) => s + p.amp, 0)

/** Normalised pressure (peak ≈ 1) at time t (s); the clap starts at t = 0, whine and tone run forever. Partials at or above `cut` are filtered off. */
export function soundAt(kind: Sound, t: number, cut = Infinity) {
  if (kind === 'tone') return TONE_HZ < cut ? Math.sin(2 * Math.PI * TONE_HZ * t) : 0
  if (kind === 'whine') return WHINE_NORM * sumAt(WHINE_PARTS, t, cut)
  if (t < 0) return 0
  return CLAP_NORM * (1 - Math.exp(-t / 0.0003)) * Math.exp(-t / CLAP_TAU) * sumAt(CLAP_PARTS, t, cut)
}

/** What the INMP441 delivers at `fs`: its decimation filter drops everything above fs/2 (and its 15 kHz band edge), so nothing aliases. */
export const micCutoff = (fs: number) => Math.min(fs / 2, INMP441.highHz)
const micSamples = (kind: Sound, fs: number, n: number, t0 = 0) => Array.from({ length: n }, (_, i) => soundAt(kind, t0 + i / fs, micCutoff(fs)))

/** Hann-windowed spectrum of `n` samples: bin Hz, amplitude, dB below the strongest bin (floor −60), and flatness over the passband. */
export function micSpectrum(kind: Sound, fs: number, n = 256) {
  const amps = dftAmplitudes(micSamples(kind, fs, n, kind === 'clap' ? -0.0005 : 0), true)
  const top = Math.max(...amps.slice(1))
  const pass = Math.floor((micCutoff(fs) / fs) * n)
  return { hz: amps.map((_, m) => (m * fs) / n), amps, db: amps.map((a) => Math.max(-60, 20 * Math.log10(a / top || 1e-9))), flatness: spectralFlatness(amps.slice(0, pass)) }
}
export const dominantHz = (amps: number[], fs: number, n: number) => {
  let best = 1
  for (let m = 2; m < amps.length; m++) if (amps[m] > amps[best]) best = m
  return (best * fs) / n
}
/** Geometric over arithmetic mean of power (DC skipped): ~1 for flat noise, → 0 for a few lines. */
export function spectralFlatness(amps: number[]) {
  const p = amps.slice(1).map((a) => a * a + 1e-20)
  return Math.exp(p.reduce((s, v) => s + Math.log(v), 0) / p.length) / (p.reduce((s, v) => s + v, 0) / p.length)
}

// --- Direction: body frame, x right, y forward; bearing θ clockwise from forward. ---

export type MicSet = 'two' | 'four'
export type MicName = 'L' | 'R' | 'F' | 'B'

export function micArray(set: MicSet, d: number): { name: MicName; x: number; y: number }[] {
  const lr = [
    { name: 'L' as const, x: -d / 2, y: 0 },
    { name: 'R' as const, x: d / 2, y: 0 },
  ]
  return set === 'two' ? lr : [...lr, { name: 'F', x: 0, y: d / 2 }, { name: 'B', x: 0, y: -d / 2 }]
}
/** Plane-wave arrival time at (x, y) relative to the array centre: mics nearer the source hear it first. */
const arrivalS = (x: number, y: number, bearing: number, c = SOUND_C) => -(x * Math.sin(bearing) + y * Math.cos(bearing)) / c
/** t_L − t_R for a pair `d` apart: d·sin θ / c. */
export const tdoa = (bearing: number, d: number, c = SOUND_C) => (d * Math.sin(bearing)) / c
export const maxLagSamples = (d: number, fs: number, c = SOUND_C) => (d / c) * fs
/** Bearing step for a one-sample change in delay, straight ahead. */
export const bearingStep = (d: number, fs: number, c = SOUND_C) => Math.asin(Math.min(1, c / (fs * d)))
/** Two mics a wavelength/2 or more apart can't tell a tone's cycles apart. */
export const spatialAliasing = (d: number, hz: number, c = SOUND_C) => d >= c / (2 * hz)
export const bearingFromDelay = (dt: number, d: number, c = SOUND_C) => Math.asin(Math.max(-1, Math.min(1, (c * dt) / d)))
/** Same delay, other side of the mic axis. */
export const frontBackMirror = (bearing: number) => wrapPi(Math.PI - bearing)

/** Normalised cross-correlation r[k + L] = Σ a[i]·b[i+k] for k = −L…L; a peak at k > 0 means b hears it k samples later. */
export function crossCorr(a: number[], b: number[], L: number) {
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0)) || 1
  return Array.from({ length: 2 * L + 1 }, (_, j) => {
    const k = j - L
    let s = 0
    for (let i = Math.max(0, -k); i < a.length && i + k < b.length; i++) s += a[i] * b[i + k]
    return s / norm
  })
}
/** Sub-sample lag of index j by fitting a parabola through its neighbours. */
const refine = (r: number[], j: number) => {
  if (j <= 0 || j >= r.length - 1) return j
  const den = r[j - 1] - 2 * r[j] + r[j + 1]
  return den === 0 ? j : j + (0.5 * (r[j - 1] - r[j + 1])) / den
}
export function peakLag(r: number[], L: number) {
  let j = 0
  for (let i = 1; i < r.length; i++) if (r[i] > r[j]) j = i
  return refine(r, j) - L
}
/** Local maxima within ±`valid` lags reaching `ratio` of the top one: each is a delay the pair can't rule out. */
export function corrPeaks(r: number[], L: number, valid: number, ratio = 0.8) {
  const top = Math.max(...r)
  const out: number[] = []
  for (let j = 0; j < r.length; j++) {
    const k = j - L
    if (Math.abs(k) > valid + 0.5 || r[j] < ratio * top) continue
    if ((j === 0 || r[j] >= r[j - 1]) && (j === r.length - 1 || r[j] > r[j + 1])) out.push(refine(r, j) - L)
  }
  return out
}

/** Records `kind` from `bearing` on each mic (`n` samples at `fs`, 1 ms in), cross-correlates the pairs and turns peaks into bearings.
 *  Two mics: `estimate` assumes the front half; `candidates` lists every bearing the peaks allow (front and back). Four mics: atan2 of both pairs. */
export function locate(kind: Sound, bearing: number, d: number, set: MicSet, fs = 48000, n = 480) {
  const mics = micArray(set, d)
  const rec = Object.fromEntries(
    mics.map((m) => {
      const t = arrivalS(m.x, m.y, bearing)
      return [m.name, Array.from({ length: n }, (_, i) => soundAt(kind, i / fs - 0.001 - t))]
    }),
  ) as Partial<Record<MicName, number[]>>
  const valid = maxLagSamples(d, fs)
  const L = Math.ceil(valid) + 2
  const lr = crossCorr(rec.R!, rec.L!, L)
  const lagLR = peakLag(lr, L)
  const dtLR = lagLR / fs
  const lrPeaks = corrPeaks(lr, L, valid)
  if (set === 'two') {
    const fronts = lrPeaks.map((k) => bearingFromDelay(k / fs, d))
    const candidates = fronts.flatMap((a) => (Math.abs(Math.abs(a) - Math.PI / 2) < 1e-3 ? [a] : [a, frontBackMirror(a)]))
    return { rec, L, lr, lagLR, dtLR, fb: null, lagFB: 0, estimate: bearingFromDelay(dtLR, d), candidates }
  }
  const fb = crossCorr(rec.F!, rec.B!, L)
  const lagFB = peakLag(fb, L)
  const fbPeaks = corrPeaks(fb, L, valid)
  const u = (k: number) => (SOUND_C * k) / fs / d
  const estimate = Math.atan2(lagLR, lagFB)
  const fits = lrPeaks.flatMap((a) => fbPeaks.filter((b) => Math.abs(u(a) ** 2 + u(b) ** 2 - 1) < 0.3).map((b) => Math.atan2(u(a), u(b))))
  return { rec, L, lr, lagLR, dtLR, fb, lagFB, estimate, candidates: fits.length ? fits : [estimate] }
}
