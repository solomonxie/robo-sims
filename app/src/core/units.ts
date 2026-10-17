import { DEG, toDeg } from './physics/common'

const PREFIXES: [number, string][] = [
  [1e18, 'E'],
  [1e15, 'P'],
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
]

/** 0.0123, 'A' → "12.3 mA". */
export function si(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `∞ ${unit}`
  if (value === 0) return `0 ${unit}`
  const abs = Math.abs(value)
  const [scale, prefix] = PREFIXES.find(([s]) => abs >= s * 0.9995) ?? PREFIXES[PREFIXES.length - 1]
  return `${+(value / scale).toPrecision(digits)} ${prefix}${unit}`
}

/** 6.24e18 → "6.24 × 10¹⁸". */
export function sci(value: number, digits = 3): string {
  if (value === 0) return '0'
  const exp = Math.floor(Math.log10(Math.abs(value)))
  if (exp >= -2 && exp <= 3) return `${+value.toPrecision(digits)}`
  const mant = +(value / 10 ** exp).toPrecision(digits)
  return `${mant} × 10${superscript(exp)}`
}

/** -12 → "⁻¹²". */
export const superscript = (n: number) => String(n).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)])

/** Fills `cells` seven-segment digits with as many decimals as fit: (6, 3) → "6.00", (27.27, 3) → "27.3". */
export function fitDigits(value: number, cells: number): string {
  const sign = value < 0 ? 1 : 0
  for (let decimals = Math.max(0, cells - 1 - sign); decimals > 0; decimals--) {
    const s = Math.abs(value).toFixed(decimals)
    if (s.length - 1 + sign <= cells) return (sign ? '-' : '') + s
  }
  return (sign ? '-' : '') + Math.round(Math.abs(value))
}

/** Smallest 1-2-5 step ≥ x, like a scope's volts/div: 0.03 → 0.05, 7 → 10. */
export function niceCeil(x: number): number {
  if (x <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(x))
  return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= x * (1 - 1e-12))!
}

export const volts = (v: number) => si(v, 'V', 3)
export const amps = (a: number) => si(a, 'A', 3)
export const ohms = (r: number) => si(r, 'Ω', 3)
export const watts = (w: number) => si(w, 'W', 3)
export const joules = (j: number) => si(j, 'J', 3)
export const mA = (a: number) => a * 1000
export const secs = (s: number) => si(s, 's', 3)
export const hertz = (f: number) => si(f, 'Hz', 3)
export const paText = (pa: number) => si(pa, 'Pa', 3)
export const hpaText = (pa: number, digits = 1) => `${(pa / 100).toFixed(digits)} hPa`
export const hexByte = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`
/** Whole ms from 10 ms up, `digits` decimals below. */
export const msText = (s: number, digits = 1) => `${+(s * 1000).toFixed(s < 0.01 ? digits : 0)} ms`
export const mAText = (a: number) => `${(a * 1000).toFixed(a < 0.01 ? 1 : 0)} mA`
export const dbmText = (x: number) => `${x < -0.5 ? '−' : ''}${Math.abs(Math.round(x))} dBm`
export const pct = (f: number) => `${Math.round(f * 100)} %`
export const mpsText = (v: number, digits = 2) => `${v.toFixed(digits)} m/s`
export const accelText = (a: number) => `${a.toFixed(2)} m/s²`
export const newtonsText = (f: number, digits = 2) => `${f.toFixed(digits)} N`
export const kgText = (kg: number) => `${kg.toFixed(1)} kg`
/** mJ below 1 J. */
export const energyText = (e: number, digits = 2) => (e < 1 ? `${(e * 1000).toFixed(0)} mJ` : `${e.toFixed(digits)} J`)
/** Always-signed fixed-point text: +1.0, −0.5. */
export const signed = (v: number, digits = 1) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`
export const mmText = (m: number) => `${Math.round(m * 1000)} mm`
/** Tenths of a mm below 10 mm. */
export const mmTenths = (m: number) => `${(m * 1000).toFixed(Math.abs(m) < 0.01 ? 1 : 0)} mm`
/** m from 1 m, cm (1 decimal) from 1 cm, else mm; ∞ for Infinity. */
export const lengthText = (m: number) => (m === Infinity ? '∞' : m >= 1 ? `${m.toFixed(2)} m` : m >= 0.01 ? `${(m * 100).toFixed(1)} cm` : `${(m * 1000).toFixed(1)} mm`)
/** Wavelength: cm/m via `lengthText` from 1 cm up, SI prefixes below ("940 nm"). */
export const wavelengthText = (m: number) => (m >= 0.01 ? lengthText(m) : si(m, 'm', 3))
export const cmText = (m: number) => `${(m * 100).toFixed(1)} cm`
export const cmWhole = (m: number) => `${Math.round(m * 100)} cm`
/** Whole °C, or `digits` decimals. */
export const celsiusText = (c: number, digits = 0) => `${fixedText(c, digits)} °C`
/** Thermal resistance, °C/W: two decimals under 1, one under 10, else whole. */
export const thetaText = (r: number) => `${r < 1 ? r.toFixed(2) : r < 10 ? r.toFixed(1) : Math.round(r)} °C/W`
export const degText = (d: number, digits = 1) => `${d.toFixed(digits)}°`
/** Radians as degrees, values that round to zero shown as 0. */
export const radText = (rad: number, digits = 0) => degText(Math.abs(rad) < 0.5 * 10 ** -digits * DEG ? 0 : toDeg(rad), digits)
/** Fixed digits with a true minus, values that round to zero unsigned. */
export const fixedText = (v: number, digits = 2) => (Math.abs(v) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : v.toFixed(digits).replace('-', '−'))
/** Torque: 0.25 → "0.25 N·m". */
export const nmText = (t: number, digits = 2) => `${fixedText(t, digits)} N·m`
/** Hundredths of a mm: 0.00022 → "0.22 mm". */
export const mmHundredths = (m: number) => `${fixedText(m * 1000, 2)} mm`
/** fixedText of each entry: `(x, y, z)`. */
export const tupleText = (v: readonly number[], digits = 2) => `(${v.map((x) => fixedText(x, digits)).join(', ')})`
/** fixedText as a factor in a written product: negatives in brackets. */
export const factorText = (v: number) => (v < -0.005 ? `(${fixedText(v)})` : fixedText(v))
/** Row-major 2×2 `[a b; c d]`. */
export const mat2Text = (M: readonly number[]) => `[${fixedText(M[0])} ${fixedText(M[1])}; ${fixedText(M[2])} ${fixedText(M[3])}]`
/** Two decimals, '—' when missing. */
export const secsText = (s: number | null) => (s === null || !Number.isFinite(s) ? '—' : `${s.toFixed(2)} s`)
/** PID gains in duty per degree. */
export const kpText = (kp: number) => `${(kp * 100).toFixed(2)} %/°`
export const kiText = (ki: number) => `${(ki * 100).toFixed(1)} %/(°·s)`
export const kdText = (kd: number) => `${(kd * 100).toFixed(2)} %/(°/s)`
/** '+', '−' or '0' (|v| < 1e-6). */
export const signText = (v: number) => (Math.abs(v) < 1e-6 ? '0' : v > 0 ? '+' : '−')
/** Two decimals, signed unless ~0. */
export const velocityText = (v: number) => `${v < -1e-6 ? '−' : v > 1e-6 ? '+' : ''}${Math.abs(v).toFixed(2)}`
export const millivolts = (v: number) => `${Math.round(v * 1000)} mV`
/** Minutes under an hour, else hours to `digits` decimals. */
export const hoursText = (h: number, digits = 1) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(digits)} h`)
/** Battery-life style span: hours, then days, then years. */
export const spanText = (h: number) => (h < 48 ? hoursText(h) : h < 24 * 365 ? `${Math.round(h / 24)} days` : `${+(h / 8766).toFixed(1)} years`)

/** 0 when |x| < eps, so readouts don't show −0 or float dust. */
export const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)
/** Binary sizes: 512 B, 20 KB, 1.25 MB. */
export const bytesText = (b: number) => (b >= 1048576 ? `${+(b / 1048576).toFixed(3)} MB` : b >= 1024 ? `${+(b / 1024).toFixed(1)} KB` : `${Math.round(b)} B`)
