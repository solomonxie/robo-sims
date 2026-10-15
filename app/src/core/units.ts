const PREFIXES: [number, string][] = [
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
export const hexByte = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`
/** Whole ms from 10 ms up, `digits` decimals below. */
export const msText = (s: number, digits = 1) => `${+(s * 1000).toFixed(s < 0.01 ? digits : 0)} ms`
export const mAText = (a: number) => `${(a * 1000).toFixed(a < 0.01 ? 1 : 0)} mA`
export const dbmText = (x: number) => `${x < -0.5 ? '−' : ''}${Math.abs(Math.round(x))} dBm`
export const pct = (f: number) => `${Math.round(f * 100)} %`
/** Always-signed fixed-point text: +1.0, −0.5. */
export const signed = (v: number, digits = 1) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`
export const millivolts = (v: number) => `${Math.round(v * 1000)} mV`
/** Minutes under an hour, else hours to `digits` decimals. */
export const hoursText = (h: number, digits = 1) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(digits)} h`)
/** Battery-life style span: hours, then days, then years. */
export const spanText = (h: number) => (h < 48 ? hoursText(h) : h < 24 * 365 ? `${Math.round(h / 24)} days` : `${+(h / 8766).toFixed(1)} years`)

/** 0 when |x| < eps, so readouts don't show −0 or float dust. */
export const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)
/** Binary sizes: 512 B, 20 KB, 1.25 MB. */
export const bytesText = (b: number) => (b >= 1048576 ? `${+(b / 1048576).toFixed(3)} MB` : b >= 1024 ? `${+(b / 1024).toFixed(1)} KB` : `${Math.round(b)} B`)
