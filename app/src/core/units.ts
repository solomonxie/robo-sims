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
  const sup = String(exp).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)])
  return `${mant} × 10${sup}`
}
