// Anomaly detection on a gearmotor's vibration: synthetic accelerometer windows (g), 8 log band levels, a per-band
// healthy baseline (z-scores), a fixed RMS threshold and a small net that predicts the healthy spectrum from speed and load.
import { gaussRng, mean, once, parkMiller, stdDev } from '../common'
import { dftAmplitudes } from '../signals/fourier'
import { Mlp, mlpInit, mlpOut, mlpTrain } from './net'

export const VIB_HZ = 1024
export const VIB_N = 256
export const VIB_WINDOW_S = VIB_N / VIB_HZ
export const PINION_TEETH = 12
const BEARING_ORDER = 3.6
export const VIB_EDGES = [5, 45, 90, 140, 200, 270, 350, 430, 512]
export const VIB_BANDS = VIB_EDGES.length - 1
export const VIB_FAULTS = { healthy: 'Healthy', imbalance: 'Imbalance', bearing: 'Bearing wear', loose: 'Loose mount' }
export type VibFault = keyof typeof VIB_FAULTS
export const NOMINAL = { rpm: 1500, load: 0.6 }

interface VibState { rpm: number; load: number; fault: VibFault; severity: number; drift?: number }

/** One window (VIB_N samples at VIB_HZ, g, gravity removed): 1× shaft, 2×, gear mesh at 12×, white noise, plus the fault. */
export function vibWindow(s: VibState, seed: number) {
  const rng = parkMiller(seed * 7919 + 13)
  const gauss = gaussRng(rng)
  const f1 = (s.rpm / 60) * (1 + 0.01 * gauss())
  const k = s.rpm / NOMINAL.rpm
  const sev = s.severity
  const imb = s.fault === 'imbalance' ? sev : 0
  const bear = s.fault === 'bearing' ? sev : 0
  const loose = s.fault === 'loose' ? sev : 0
  const drift = s.drift ?? 0
  const a1 = 0.02 * k * k * (1 + 0.15 * gauss()) * (1 + 5 * imb)
  const a2 = 0.008 * k * (1 + 5 * loose)
  const a3 = 0.03 * loose * k
  const aHalf = 0.025 * loose
  const aMesh = 0.03 * (0.4 + s.load) * k * (1 + 0.1 * gauss()) * (1 + drift)
  const noise = (0.008 + 0.004 * s.load) * (1 + drift)
  const ph = Array.from({ length: 5 }, () => 2 * Math.PI * rng())
  const out: number[] = []
  for (let i = 0; i < VIB_N; i++) {
    const t = i / VIB_HZ
    const w = 2 * Math.PI * f1 * t
    const pulse = (0.5 + 0.5 * Math.cos(BEARING_ORDER * w + ph[4])) ** 6
    out.push(
      a1 * Math.sin(w + ph[0]) + a2 * Math.sin(2 * w + ph[1]) + a3 * Math.sin(3 * w + ph[2]) + aHalf * Math.sin(0.5 * w + ph[3])
      + aMesh * Math.sin(PINION_TEETH * w + ph[1]) + 0.12 * bear * pulse * Math.sin(2 * Math.PI * 470 * t) + noise * gauss(),
    )
  }
  return out
}

/** RMS about the mean (gravity and offset removed). */
export const vibRms = stdDev

/** Amplitude per DFT bin (Hann) and log10 rms level per band. */
export function vibSpectrum(xs: readonly number[]) {
  const amps = dftAmplitudes(xs, true)
  const df = VIB_HZ / xs.length
  const levels = Array.from({ length: VIB_BANDS }, (_, b) => {
    let e = 0
    amps.forEach((a, m) => {
      const f = m * df
      if (f >= VIB_EDGES[b] && f < VIB_EDGES[b + 1]) e += (a * a) / 2
    })
    return Math.log10(Math.sqrt(e) + 1e-4)
  })
  return { amps, levels }
}

export interface Baseline { mean: number[]; std: number[]; rms: { mean: number; std: number } }

/** Per-band mean and spread of the log levels over `n` healthy windows at `s`. */
export function learnBaseline(s: Omit<VibState, 'fault' | 'severity'>, n: number, seed = 1000): Baseline {
  const rows = Array.from({ length: n }, (_, i) => vibWindow({ ...s, fault: 'healthy', severity: 0 }, seed + i))
  const lv = rows.map((r) => vibSpectrum(r).levels)
  const rms = rows.map(vibRms)
  return {
    mean: Array.from({ length: VIB_BANDS }, (_, b) => mean(lv.map((r) => r[b]))),
    std: Array.from({ length: VIB_BANDS }, (_, b) => Math.max(0.02, stdDev(lv.map((r) => r[b])))),
    rms: { mean: mean(rms), std: stdDev(rms) },
  }
}

export const zScores = (levels: readonly number[], b: Baseline) => levels.map((v, i) => (v - b.mean[i]) / b.std[i])
/** Anomaly score: the largest |z| over the bands. */
export const zScore = (z: readonly number[]) => Math.max(...z.map(Math.abs))

// --- Model of normal: a small net predicts the healthy band levels from speed and load (motor current). ---

const VIB_SPEEDS = [900, 2100]
const VIB_LOADS = [0.2, 1]

interface VibModel { net: Mlp; sd: number[]; scale: number }
const condIn = (rpm: number, load: number) => [(rpm - NOMINAL.rpm) / 600, (load - NOMINAL.load) / 0.4]
const LEVEL_MID = -2
const residuals = (m: Pick<VibModel, 'net'>, s: Pick<VibState, 'rpm' | 'load'>, lv: readonly number[]) => {
  const y = mlpOut(m.net, condIn(s.rpm, s.load))
  return lv.map((v, i) => v - LEVEL_MID - y[i])
}

/** 2-10-8 net (tanh, linear), MSE, trained once on 160 healthy windows across speeds and loads; score = mean (residual ÷ healthy σ)² ÷ its healthy 95th percentile. */
export const vibModel = once((): VibModel => {
  const rng = parkMiller(77)
  const data = Array.from({ length: 160 }, (_, i) => {
    const rpm = VIB_SPEEDS[0] + (VIB_SPEEDS[1] - VIB_SPEEDS[0]) * rng()
    const load = VIB_LOADS[0] + (VIB_LOADS[1] - VIB_LOADS[0]) * rng()
    return { rpm, load, lv: vibSpectrum(vibWindow({ rpm, load, fault: 'healthy', severity: 0 }, 5000 + i)).levels }
  })
  const net = mlpTrain(mlpInit([2, 10, VIB_BANDS], ['tanh', 'linear'], 4), data.map((d) => ({ x: condIn(d.rpm, d.load), t: d.lv.map((v) => v - LEVEL_MID) })), { lr: 0.06, epochs: 160, loss: 'mse', batch: 16, seed: 5, snaps: 1 }).net
  const res = data.map((d) => residuals({ net }, d, d.lv))
  const sd = Array.from({ length: VIB_BANDS }, (_, b) => Math.max(0.02, stdDev(res.map((r) => r[b]))))
  const raw = res.map((r) => r.reduce((t, v, i) => t + (v / sd[i]) ** 2, 0) / VIB_BANDS).sort((a, b) => a - b)
  return { net, sd, scale: raw[Math.floor(0.95 * raw.length)] }
})

/** Expected healthy band levels at this speed and load. */
export const expectedLevels = (m: VibModel, s: Pick<VibState, 'rpm' | 'load'>) => mlpOut(m.net, condIn(s.rpm, s.load)).map((v) => v + LEVEL_MID)
export const modelScore = (m: VibModel, s: Pick<VibState, 'rpm' | 'load'>, levels: readonly number[]) =>
  residuals(m, s, levels).reduce((t, v, i) => t + (v / m.sd[i]) ** 2, 0) / VIB_BANDS / m.scale

// --- A shift on the robot: a schedule of speed and load, an optional fault from `onset`, two detectors. ---

export const SHIFT_N = 160
export const SHIFT_ONSET = 100
export const SHIFT_SCENES = { steady: 'Steady speed', speeds: 'Speed and load change', drift: 'Warm-up drift' }
type ShiftScene = keyof typeof SHIFT_SCENES

export function shiftState(scene: ShiftScene, fault: VibFault, i: number): VibState {
  const step = [1500, 1800, 1200, 2100, 1500, 1050, 1900, 1350][Math.floor(i / 20) % 8]
  const rpm = scene === 'speeds' ? step : NOMINAL.rpm
  const load = scene === 'speeds' ? 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(i / 9)) : NOMINAL.load
  const drift = scene === 'drift' ? 0.9 * Math.min(1, i / SHIFT_N) : 0
  const severity = fault === 'healthy' || i < SHIFT_ONSET ? 0 : fault === 'bearing' ? 0.3 + 0.5 * ((i - SHIFT_ONSET) / (SHIFT_N - SHIFT_ONSET)) : 0.5
  return { rpm, load, fault: severity ? fault : 'healthy', severity, drift }
}

/** Every window of the shift: state, RMS (g), model score. */
export function shiftRun(scene: ShiftScene, fault: VibFault, seed = 1) {
  const m = vibModel()
  return Array.from({ length: SHIFT_N }, (_, i) => {
    const s = shiftState(scene, fault, i)
    const xs = vibWindow(s, seed * 100_000 + i)
    return { ...s, rms: vibRms(xs), score: modelScore(m, s, vibSpectrum(xs).levels) }
  })
}

/** Alarm = 2 windows in a row over `th`. False alarms before onset (count of alarm starts), first alarm after onset (windows late, or null = missed). */
export function alarmStats(scores: readonly number[], th: number, faulty: boolean, onset = SHIFT_ONSET) {
  const on = scores.map((v, i) => v > th && i > 0 && scores[i - 1] > th)
  let falses = 0
  on.forEach((a, i) => {
    if (a && !on[i - 1] && (!faulty || i < onset)) falses++
  })
  const k = faulty ? on.findIndex((a, i) => a && i >= onset) : -1
  return { on, falses, delay: k < 0 ? null : k - onset }
}
