const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
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
