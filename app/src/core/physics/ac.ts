import { driftVelocity } from './dc'

export type Wave = 'sine' | 'square' | 'triangle'

/** Unit-peak wave at `cycles` (any real; 1 = one full period), rising through 0 at whole cycles. */
export function waveAt(shape: Wave, cycles: number): number {
  const c = cycles - Math.floor(cycles)
  if (shape === 'square') return c < 0.5 ? 1 : -1
  if (shape === 'triangle') return c < 0.25 ? 4 * c : c < 0.75 ? 2 - 4 * c : 4 * c - 4
  return Math.sin(2 * Math.PI * c)
}

/** Vrms / Vpeak for each wave. */
export const RMS_FACTOR: Record<Wave, number> = { sine: Math.SQRT1_2, square: 1, triangle: 1 / Math.sqrt(3) }

export const rmsFromPeak = (peak: number, shape: Wave = 'sine') => peak * RMS_FACTOR[shape]
export const peakFromRms = (rms: number, shape: Wave = 'sine') => rms / RMS_FACTOR[shape]
export const peakToPeak = (peak: number) => 2 * peak

/** Root of the mean square of samples. */
export const rmsOf = (samples: number[]) => Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length)

/** v(t) = Vp · wave(f·t). */
export const acVolts = (peak: number, hz: number, seconds: number, shape: Wave = 'sine') => peak * waveAt(shape, hz * seconds)

export const periodOf = (hz: number) => 1 / hz
export const angularFrequency = (hz: number) => 2 * Math.PI * hz

/** Mains supplies: RMS volts and frequency. */
export const MAINS = { eu: { rms: 230, hz: 50 }, us: { rms: 120, hz: 60 } }

/** Resistance of a lamp rated `watts` at `volts` (RMS for AC): R = V² / P. */
export const lampOhms = (volts: number, watts: number) => (volts * volts) / watts

/** How far free electrons slosh each way in AC: peak drift speed / ω. */
export const sloshAmplitude = (peakAmps: number, areaM2: number, hz: number) => driftVelocity(peakAmps, areaM2) / angularFrequency(hz)
