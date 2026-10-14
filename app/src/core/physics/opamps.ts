// Op-amps: finite open-loop gain A, output stuck between the rails (minus the stage's headroom) and a current limit.

export interface OpAmp {
  /** Open-loop DC gain, V/V. */
  aol: number
  /** How far short of each rail the output stage stops, V. */
  headroom: number
  /** Output short-circuit current, A. */
  iMax: number
}

/** TL072: JFET input, 200 V/mV, swings to about 1.5 V inside the rails, ~40 mA short circuit. */
export const TL072: OpAmp = { aol: 2e5, headroom: 1.5, iMax: 0.04 }

/** MCP6002: CMOS rail-to-rail output, ~112 dB, swings to 25 mV of the rails, ~20 mA. */
export const MCP6002: OpAmp = { aol: 4e5, headroom: 0.025, iMax: 0.02 }

export interface Rails {
  vcc: number
  vee: number
}

export const swingHigh = (op: OpAmp, r: Rails) => r.vcc - op.headroom
export const swingLow = (op: OpAmp, r: Rails) => r.vee + op.headroom

/** Pins the output inside its swing (and, into a load `rl` to 0 V, inside ±iMax·rl). */
export function saturate(op: OpAmp, v: number, r: Rails, rl = Infinity): number {
  const hi = Math.min(swingHigh(op, r), op.iMax * rl)
  const lo = Math.max(swingLow(op, r), -op.iMax * rl)
  return Math.min(hi, Math.max(lo, v))
}

/** No feedback: Vout = A (V+ − V−), clipped. */
export const openLoopOut = (op: OpAmp, vp: number, vn: number, r: Rails, rl = Infinity) => saturate(op, op.aol * (vp - vn), r, rl)

/** Closed-loop gain of a non-inverting stage with feedback fraction β (V− = β Vout): A / (1 + Aβ) → 1/β as A → ∞. */
export const nonInvertingGain = (aol: number, beta: number) => aol / (1 + aol * beta)

/** Non-inverting stage (follower when β = 1); V− and the leftover input difference follow from the clipped output. */
export function nonInverting(op: OpAmp, vin: number, beta: number, r: Rails, rl = Infinity) {
  const vout = saturate(op, nonInvertingGain(op.aol, beta) * vin, r, rl)
  const vn = beta * vout
  return { vout, vn, diff: vin - vn, clipped: vout !== nonInvertingGain(op.aol, beta) * vin }
}

/** Inverting stage, Vin → rin → V− ← rf ← Vout, V+ at 0 V. Ideal gain −rf/rin; V− stays near 0 V unless it clips. */
export function inverting(op: OpAmp, vin: number, rin: number, rf: number, r: Rails, rl = Infinity) {
  const k = rin / (rin + rf)
  const linear = (-op.aol * (1 - k) * vin) / (1 + op.aol * k)
  const vout = saturate(op, linear, r, rl)
  const vn = (1 - k) * vin + k * vout
  return { vout, vn, amps: (vin - vn) / rin, clipped: vout !== linear }
}

/** Source with internal `rs` driving `rl` straight: a divider. */
export const loadedVolts = (vs: number, rs: number, rl: number) => (vs * rl) / (rs + rl)

/** Comparator with input on V+ through `rin`, `rh` from Vout back to V+ (Infinity = no hysteresis), reference on V−.
 *  Positive feedback makes it bistable, so the last output picks the state. */
export function comparatorStep(op: OpAmp, prev: number, vin: number, ref: number, rin: number, rh: number, r: Rails): number {
  const k = Number.isFinite(rh) ? rin / (rin + rh) : 0
  let out = prev
  for (let i = 0; i < 3; i++) out = openLoopOut(op, (1 - k) * vin + k * out, ref, r)
  return out
}

/** Input levels where it flips: rising past `up` (output low → high), falling past `down`. */
export function comparatorThresholds(op: OpAmp, ref: number, rin: number, rh: number, r: Rails) {
  if (!Number.isFinite(rh)) return { up: ref, down: ref }
  const k = rin / (rin + rh)
  const at = (out: number) => (ref - k * out) / (1 - k)
  return { up: at(swingLow(op, r)), down: at(swingHigh(op, r)) }
}

/** Runs `comparatorStep` over samples; counts output flips. */
export function comparatorRun(op: OpAmp, vin: number[], ref: number, rin: number, rh: number, r: Rails, start = swingLow(op, r)) {
  const out: number[] = []
  let v = start
  let flips = 0
  const mid = (r.vcc + r.vee) / 2
  for (const x of vin) {
    const next = comparatorStep(op, v, x, ref, rin, rh, r)
    if (next > mid !== v > mid) flips++
    out.push((v = next))
  }
  return { out, flips }
}
