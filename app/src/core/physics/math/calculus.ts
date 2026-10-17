// Calculus: derivative as a secant slope shrinking to the tangent, integral as signed area, numerical integration rules.
import { gaussAt } from '../common'

// --- A robot driving a straight line: speed v = a + b·sin(2πt/P), position x = ∫v. ---

export const DRIVE_T = 6
export const ENCODER_DT = 0.02
const PERIOD = 4
export const LINE_DRIVES = { cruise: { a: 0.25, b: 0.15 }, reverse: { a: 0.05, b: 0.3 } } as const
export type LineDrive = keyof typeof LINE_DRIVES

/** Position (m), speed (m/s) and acceleration (m/s²) at t. */
export function lineDriveAt(kind: LineDrive, t: number) {
  const { a, b } = LINE_DRIVES[kind]
  const w = (2 * Math.PI) / PERIOD
  return { x: a * t + (b / w) * (1 - Math.cos(w * t)), v: a + b * Math.sin(w * t), acc: b * w * Math.cos(w * t) }
}

/** Encoder position samples every `dt` with Gaussian noise σ (m), repeatable. */
export const encoderSamples = (kind: LineDrive, sigma: number, dt = ENCODER_DT, T = DRIVE_T) =>
  Array.from({ length: Math.round(T / dt) + 1 }, (_, i) => lineDriveAt(kind, i * dt).x + sigma * gaussAt(i + 101))

/**
 * Secant from t to t + h on noisy encoder samples: slope Δx/Δt vs the true derivative at t.
 * `est[i]` = forward difference at every sample, `truncation` ≈ x''·h/2, `noiseGain` = √2·σ/h (spread of Δx/Δt from noise alone).
 */
export function secantView(kind: LineDrive, t: number, h: number, sigma: number, dt = ENCODER_DT) {
  const xs = encoderSamples(kind, sigma, dt)
  const k = Math.max(1, Math.round(h / dt))
  const i = Math.min(Math.round(t / dt), xs.length - 1 - k)
  const [t0, t1] = [i * dt, (i + k) * dt]
  const dx = xs[i + k] - xs[i]
  const slope = dx / (k * dt)
  const at = lineDriveAt(kind, t0)
  const est = xs.slice(0, xs.length - k).map((x, j) => (xs[j + k] - x) / (k * dt))
  return { xs, t0, t1, h: k * dt, x0: xs[i], x1: xs[i + k], dx, slope, truth: at.v, error: slope - at.v, truncation: (at.acc * k * dt) / 2, noiseGain: (Math.SQRT2 * sigma) / (k * dt), est }
}

// --- Integration rules. ---

export const RULES = { left: 'Left', right: 'Right', mid: 'Midpoint', trap: 'Trapezoid', simpson: 'Simpson' } as const
export type Rule = keyof typeof RULES
/** A strip under the curve from u0 to u1, top edge from y0 to y1 (a rectangle when equal). */
export type Strip = { t0: number; t1: number; y0: number; y1: number }

/** Strips each rule adds up on [a, b] with n steps; Simpson's parabolas drawn as `sub` thin trapezoids per step (n even). */
export function ruleStrips(f: (t: number) => number, a: number, b: number, n: number, rule: Rule, sub = 4): Strip[] {
  const h = (b - a) / n
  const out: Strip[] = []
  for (let i = 0; i < n; i++) {
    const [t0, t1] = [a + i * h, a + (i + 1) * h]
    if (rule === 'trap') out.push({ t0, t1, y0: f(t0), y1: f(t1) })
    else if (rule === 'simpson') {
      const p0 = a + (i - (i % 2)) * h
      const [f0, f1, f2] = [f(p0), f(p0 + h), f(p0 + 2 * h)]
      const q = (t: number) => {
        const s = (t - p0) / h
        return f0 * ((s - 1) * (s - 2)) / 2 - f1 * s * (s - 2) + (f2 * s * (s - 1)) / 2
      }
      for (let j = 0; j < sub; j++) out.push({ t0: t0 + (j * h) / sub, t1: t0 + ((j + 1) * h) / sub, y0: q(t0 + (j * h) / sub), y1: q(t0 + ((j + 1) * h) / sub) })
    } else {
      const y = f(rule === 'left' ? t0 : rule === 'right' ? t1 : (t0 + t1) / 2)
      out.push({ t0, t1, y0: y, y1: y })
    }
  }
  return out
}

/** Running integral at a, a + h, …, b (Simpson: exact parabola areas, so every node is right). */
export function runningIntegral(f: (t: number) => number, a: number, b: number, n: number, rule: Rule) {
  const h = (b - a) / n
  const sums = [0]
  if (rule === 'simpson') {
    for (let i = 0; i < n; i += 2) {
      const [f0, f1, f2] = [f(a + i * h), f(a + (i + 1) * h), f(a + (i + 2) * h)]
      const last = sums[sums.length - 1]
      sums.push(last + (h * (5 * f0 + 8 * f1 - f2)) / 12, last + (h * (f0 + 4 * f1 + f2)) / 3)
    }
    return sums.slice(0, n + 1)
  }
  for (const s of ruleStrips(f, a, b, n, rule)) sums.push(sums[sums.length - 1] + ((s.t1 - s.t0) * (s.y0 + s.y1)) / 2)
  return sums
}

export const integrateRule = (f: (t: number) => number, a: number, b: number, n: number, rule: Rule) => runningIntegral(f, a, b, n, rule)[n]

/** Signed area of v on [0, T] with n left rectangles vs exact; distance = area of |v| (back-up counted too). */
export function areaView(kind: LineDrive, T: number, n: number) {
  const v = (t: number) => lineDriveAt(kind, t).v
  const strips = ruleStrips(v, 0, T, n, 'left')
  const sum = strips.reduce((s, r) => s + (r.t1 - r.t0) * r.y0, 0)
  const exact = lineDriveAt(kind, T).x
  const fine = ruleStrips((t) => Math.abs(v(t)), 0, T, 400, 'mid')
  const distance = fine.reduce((s, r) => s + (r.t1 - r.t0) * r.y0, 0)
  const back = fine.reduce((s, r) => s + (v((r.t0 + r.t1) / 2) < 0 ? (r.t1 - r.t0) * r.y0 : 0), 0)
  return { strips, sum, exact, error: sum - exact, distance, back, running: runningIntegral(v, 0, T, n, 'left') }
}

// --- Gyro on a turning robot: rate ω(t) = W·(t/τ)·e^(1 − t/τ) °/s, angle θ = ∫ω. ---

export const TURN = { W: 100, tau: 1.2, T: 4 }
export const turnRate = (t: number) => TURN.W * (t / TURN.tau) * Math.exp(1 - t / TURN.tau)
export const turnAngle = (t: number) => {
  const u = t / TURN.tau
  return TURN.W * Math.E * TURN.tau * (1 - Math.exp(-u) * (1 + u))
}

/** Gyro rate (+ bias °/s) integrated with `rule` over n steps: angle at each step, truth, rule error and bias drift. */
export function gyroIntegrate(rule: Rule, n: number, bias: number, T = TURN.T) {
  const read = (t: number) => turnRate(t) + bias
  const angles = runningIntegral(read, 0, T, n, rule)
  const times = angles.map((_, i) => (i * T) / n)
  const truth = turnAngle(T)
  const clean = integrateRule(turnRate, 0, T, n, rule)
  return { times, angles, truth, final: angles[n], ruleError: clean - truth, drift: bias * T, error: angles[n] - truth, strips: ruleStrips(read, 0, T, n, rule) }
}

/** |rule error| (°) of the bias-free turn for each step count. */
export const ruleErrors = (rule: Rule, ns: readonly number[]) => ns.map((n) => Math.abs(integrateRule(turnRate, 0, TURN.T, n, rule) - turnAngle(TURN.T)))

/** Error of Δx/Δt vs step h at t: the curve's own error (≈ |x″|·h/2) grows with h, noise √2·σ/h shrinks; `best` h minimises their sum. */
export function diffTradeoff(kind: LineDrive, t: number, sigma: number, hs: readonly number[]) {
  const at = lineDriveAt(kind, t)
  const rows = hs.map((h) => ({ h, trunc: Math.abs((lineDriveAt(kind, t + h).x - at.x) / h - at.v), noise: (Math.SQRT2 * sigma) / h }))
  const tot = rows.map((r) => r.trunc + r.noise)
  return { rows, best: sigma > 0 ? rows[tot.indexOf(Math.min(...tot))].h : null }
}
