// First-order RC filters: low-pass (R in series, C to ground) and high-pass (C in series, R to ground).
import { rcStep } from './circuits'

export type FilterKind = 'low' | 'high'

/** −3 dB corner, 1 / 2πRC. */
export const rcCutoff = (ohms: number, farads: number) => 1 / (2 * Math.PI * ohms * farads)

/** |Vout / Vin| for a sine at `hz`. */
export function rcGain(kind: FilterKind, hz: number, cutoff: number) {
  const x = hz / cutoff
  return (kind === 'low' ? 1 : x) / Math.sqrt(1 + x * x)
}

/** Output phase relative to the input, radians: low-pass lags (0 → −π/2), high-pass leads (π/2 → 0). */
export const rcPhase = (kind: FilterKind, hz: number, cutoff: number) => (kind === 'low' ? 0 : Math.PI / 2) - Math.atan(hz / cutoff)

/** Straight-line Bode asymptote in dB: flat in the passband, ∓20 dB per decade past the corner. */
export const rcAsymptote = (kind: FilterKind, hz: number, cutoff: number) => 20 * Math.min(0, Math.log10(kind === 'low' ? cutoff / hz : hz / cutoff))

/** Firmware twin of the RC low-pass: y += α(x − y) each sample, with α = 1 − e^(−dt/τ). */
export const emaAlpha = (dt: number, tauS: number) => 1 - Math.exp(-dt / tauS)

/** Runs `input` samples (spaced `dt`) through an RC filter; the capacitor starts at `vc`. */
export function rcFilter(kind: FilterKind, input: number[], dt: number, tauS: number, vc = 0) {
  return input.map((x) => {
    vc = rcStep(vc, x, tauS, dt)
    return kind === 'low' ? vc : x - vc
  })
}

/** One settled period of the filter's output for a periodic `wave(cycles)` at `hz`, sampled `samples` times.
 *  The capacitor is linear, so after one period vc → a·vc + b; it settles where vc = b / (1 − a). */
export function rcSteadyCycle(kind: FilterKind, wave: (cycles: number) => number, hz: number, tauS: number, samples = 256) {
  const dt = 1 / hz / samples
  const input = Array.from({ length: samples }, (_, k) => wave((k + 1) / samples))
  const lows = rcFilter('low', input, dt, tauS, 0)
  const a = Math.exp(-1 / hz / tauS)
  const vc = lows[samples - 1] / (1 - a)
  return { input, output: rcFilter(kind, input, dt, tauS, vc) }
}
