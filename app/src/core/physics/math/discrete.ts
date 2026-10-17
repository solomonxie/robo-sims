// Signals (maths view): sampling a tone and rebuilding it, spectral copies every fs; a one-pole discrete filter and its z-plane pole.
import { gaussAt } from '../common'
import { aliasFrequency, nyquist } from '../signals/fourier'
import { emaAlpha } from '../signals/filters'

export const RECON = { hold: 'Hold', line: 'Join dots', ideal: 'Ideal (sinc)' } as const
type Recon = keyof typeof RECON

export const foldedHz = (f: number, fs: number) => Math.abs(aliasFrequency(f, fs))
export const sinc = (x: number) => (Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))

/** Spectrum of a real tone f sampled at fs: copies at k·fs ± f up to fMax; `seen` = the copy in 0 … fs/2. */
export function spectralImages(f: number, fs: number, fMax: number) {
  const out: { hz: number; k: number; original: boolean; seen: boolean }[] = []
  const seen = foldedHz(f, fs)
  for (let k = 0; k * fs - f <= fMax; k++)
    for (const s of [-1, 1]) {
      const hz = k * fs + s * f
      if (hz < 0 || hz > fMax || out.some((o) => Math.abs(o.hz - hz) < 1e-9)) continue
      out.push({ hz, k, original: Math.abs(hz - f) < 1e-9, seen: Math.abs(hz - seen) < 1e-9 })
    }
  return out.sort((a, b) => a.hz - b.hz)
}

const SINC_REACH = 40

/** Value at time t rebuilt from samples xs[i] taken at t0 + i/fs. */
export function reconstructAt(kind: Recon, xs: readonly number[], fs: number, t0: number, t: number) {
  const u = (t - t0) * fs
  const i = Math.max(0, Math.min(xs.length - 1, Math.floor(u)))
  if (kind === 'hold') return xs[i]
  if (kind === 'line') return xs[i] + (xs[Math.min(xs.length - 1, i + 1)] - xs[i]) * Math.max(0, Math.min(1, u - i))
  let s = 0
  for (let k = Math.max(0, i - SINC_REACH); k <= Math.min(xs.length - 1, i + SINC_REACH); k++) s += xs[k] * sinc(u - k)
  return s
}

/** Tone sin(2πft) over [0, T] sampled at fs and rebuilt: sample dots in the window, rebuilt curve, RMS error, seen frequency. */
export function sampleRateView(f: number, fs: number, kind: Recon, T: number, points = 400) {
  const tone = (t: number) => Math.sin(2 * Math.PI * f * t)
  const pad = Math.max(0.3, (SINC_REACH + 2) / fs)
  const k0 = Math.floor(-pad * fs)
  const xs = Array.from({ length: Math.ceil((T + 2 * pad) * fs) }, (_, i) => tone((k0 + i) / fs))
  const t0 = k0 / fs
  const dots = xs.map((x, i) => ({ t: t0 + i / fs, x })).filter((d) => d.t >= 0 && d.t <= T)
  const ts = Array.from({ length: points }, (_, i) => (i / (points - 1)) * T)
  const truth = ts.map(tone)
  const rebuilt = ts.map((t) => reconstructAt(kind, xs, fs, t0, t))
  const rms = Math.sqrt(rebuilt.reduce((s, y, i) => s + (y - truth[i]) ** 2, 0) / points)
  const seen = foldedHz(f, fs)
  return { f, fs, kind, T, tone, dots, ts, truth, rebuilt, rms, seen, nyquist: nyquist(fs), perCycle: fs / f, aliased: f > nyquist(fs) }
}

// --- Z-transform intuition: y[n] = a·y[n−1] + b·x[n], H(z) = b·z/(z − a). ---

export const Z_INPUTS = { impulse: 'Impulse', step: 'Step', noisy: 'Noisy step' } as const
type ZInput = keyof typeof Z_INPUTS

/** Input gain b = 1 − a (unity DC gain), kept ≥ 0.05 so a pole at or past 1 still shows its response. */
export const onePoleGain = (a: number) => Math.max(0.05, 1 - a)

export function zInput(kind: ZInput, n: number, noise = 0.25) {
  if (kind === 'impulse') return n === 0 ? 1 : 0
  return n < 0 ? 0 : 1 + (kind === 'noisy' ? noise * gaussAt(n + 17) : 0)
}

/** Runs y[n] = a·y[n−1] + b·x[n] from rest for N samples. */
export function onePoleRun(a: number, b: number, xs: readonly number[]) {
  const ys: number[] = []
  xs.forEach((x, i) => ys.push(a * (i ? ys[i - 1] : 0) + b * x))
  return ys
}

/** Gain and phase at θ = ωT rad/sample: H(e^{jθ}) = b / (1 − a·e^{−jθ}); |H| = b / distance(pole, point on the unit circle). */
export function onePoleAt(a: number, b: number, theta: number) {
  const re = 1 - a * Math.cos(theta)
  const im = a * Math.sin(theta)
  return { mag: Math.abs(b) / Math.hypot(re, im), phase: -Math.atan2(im, re) }
}

/** z = e^{sT}: continuous time constant τ → pole a = e^{−T/τ} (= 1 − EMA α). */
export const poleOfTau = (tauS: number, T: number) => 1 - emaAlpha(T, tauS)
/** s = ln(z)/T for a real pole a (a < 0 maps to the strip edge ±jπ/T). */
export const sOfPole = (a: number, T: number) => ({ re: Math.log(Math.max(Math.abs(a), 1e-9)) / T, im: a < 0 ? Math.PI / T : 0 })

/** Pole a, input kind, N samples at period T, test frequency θ: input, output, steady response at θ, equivalent s pole and τ. */
export function zView(a: number, kind: ZInput, N: number, T: number, theta: number, curve = 121) {
  const b = onePoleGain(a)
  const xs = Array.from({ length: N }, (_, i) => zInput(kind, i))
  const ys = onePoleRun(a, b, xs)
  const s = sOfPole(a, T)
  const freq = Array.from({ length: curve }, (_, i) => onePoleAt(a, b, (i / (curve - 1)) * Math.PI).mag)
  const settle = Math.abs(a) < 1 && Math.abs(a) > 1e-9 ? Math.ceil(Math.log(0.02) / Math.log(Math.abs(a))) : Math.abs(a) < 1 ? 1 : Infinity
  return { a, b, xs, ys, s, tau: a > 0 && a < 1 ? -1 / s.re : NaN, stable: Math.abs(a) < 1, rings: a < 0, at: onePoleAt(a, b, theta), freq, settle, point: [Math.cos(theta), Math.sin(theta)] as [number, number] }
}
