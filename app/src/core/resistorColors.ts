// Standard 4-band resistor color code: 2 significant digits + multiplier +
// tolerance (assumes 5%/gold, the common default for the parts in our catalog).
import { halton } from './halton'

const DIGIT_COLORS = [
  '#000000', // 0 black
  '#7b3f00', // 1 brown
  '#ff0000', // 2 red
  '#ffa500', // 3 orange
  '#ffff00', // 4 yellow
  '#00a651', // 5 green
  '#0000ff', // 6 blue
  '#8b00ff', // 7 violet
  '#808080', // 8 grey
  '#ffffff', // 9 white
]
const GOLD = '#d4af37'
const SILVER = '#c0c0c0'

export const BAND_NAMES = ['Black', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet', 'Grey', 'White']
export const BAND_COLORS = DIGIT_COLORS
export const TOLERANCE = { name: 'Gold', color: GOLD, percent: 5 }

/** Two significant digits and the power of ten: 4700 → { first: 4, second: 7, exponent: 2 }. */
export function resistorDigits(ohms: number): { first: number; second: number; exponent: number } {
  if (ohms < 10) throw new Error('resistorDigits expects ohms >= 10')
  let exponent = 0
  let value = Math.round(ohms)
  while (value >= 100) {
    value /= 10
    exponent++
  }
  value = Math.round(value)
  if (value === 100) return { first: 1, second: 0, exponent: exponent + 1 }
  return { first: Math.floor(value / 10), second: value % 10, exponent }
}

/** Value the bands encode: (10·first + second) × 10^exponent. */
export const bandValue = (first: number, second: number, exponent: number) => (10 * first + second) * 10 ** exponent

export function resistorColorBands(ohms: number): [string, string, string, string] {
  const { first, second, exponent } = resistorDigits(ohms)
  return [DIGIT_COLORS[first], DIGIT_COLORS[second], DIGIT_COLORS[exponent], GOLD]
}

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]

/** Nearest standard E12 value (the 10 % / common 5 % series), compared on a log scale. */
export function nearestE12(ohms: number): number {
  const decade = 10 ** Math.floor(Math.log10(ohms) - 1)
  const options = [...E12, 100].map((v) => v * decade)
  return options.reduce((best, v) => (Math.abs(Math.log(v / ohms)) < Math.abs(Math.log(best / ohms)) ? v : best))
}

/** Smallest E12 value at or above `ohms` (a safe current limit). */
export function e12Above(ohms: number): number {
  const decade = 10 ** Math.floor(Math.log10(ohms) - 1)
  return [...E12, 100].map((v) => v * decade).find((v) => v >= ohms * (1 - 1e-9))!
}

/** Range a part can really measure within ±`percent`. */
export const toleranceRange = (ohms: number, percent: number): [number, number] => [ohms * (1 - percent / 100), ohms * (1 + percent / 100)]

export const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91]
export const E96 = Array.from({ length: 96 }, (_, i) => Math.round(100 * 10 ** (i / 96)) / 10)

/** Tolerance grades: band colour, the E-series made for it (steps about 2× the tolerance), and the usual body. */
export const GRADES = {
  1: { percent: 1, name: 'Brown', color: DIGIT_COLORS[1], series: E96, seriesName: 'E96', body: '#8fb6dc' },
  5: { percent: 5, name: 'Gold', color: GOLD, series: E24, seriesName: 'E24', body: '#d9c08c' },
  10: { percent: 10, name: 'Silver', color: SILVER, series: E12, seriesName: 'E12', body: '#d9c08c' },
}
export type Grade = keyof typeof GRADES

const decadeOf = (ohms: number) => Math.floor(Math.log10(ohms) + 1e-9) - 1
const sig3 = (x: number) => +x.toPrecision(3)

/** Nearest value of a series (mantissas 10..<100), compared on a log scale. */
export function nearestIn(series: number[], ohms: number): number {
  const decade = 10 ** decadeOf(ohms)
  return sig3([...series, 100].map((v) => v * decade).reduce((best, v) => (Math.abs(Math.log(v / ohms)) < Math.abs(Math.log(best / ohms)) ? v : best)))
}

/** The series value `k` steps from the one nearest `ohms` (−1 = next lower). */
export function seriesStep(series: number[], ohms: number, k: number): number {
  const v = nearestIn(series, ohms)
  const e = decadeOf(v)
  const i = series.indexOf(sig3(v / 10 ** e)) + k
  const wrap = Math.floor(i / series.length)
  return sig3(series[i - wrap * series.length] * 10 ** (e + wrap))
}

/** Band colours: 4 bands (2 digits) for 5 and 10 %, 5 bands (3 digits) for 1 %. */
export function resistorBands(ohms: number, grade: Grade = 5): string[] {
  const { color } = GRADES[grade]
  if (grade !== 1) return [...resistorColorBands(ohms).slice(0, 3), color]
  const exponent = Math.floor(Math.log10(ohms) + 1e-9) - 2
  const digits = String(Math.round(ohms / 10 ** exponent)).split('').map(Number)
  const multiplier = exponent >= 0 ? DIGIT_COLORS[exponent] : exponent === -1 ? GOLD : SILVER
  return [...digits.map((d) => DIGIT_COLORS[d]), multiplier, color]
}

/** The `k`-th part of a production batch as measured: bell-shaped around `ohms` (σ ≈ percent / 3), never outside ±percent. */
export const batchPart = (ohms: number, percent: number, k: number) =>
  ohms * (1 + (percent / 100) * ((halton(k, 2) + halton(k, 3) + halton(k, 5)) / 1.5 - 1))
