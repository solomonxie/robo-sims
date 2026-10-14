// Standard 4-band resistor color code: 2 significant digits + multiplier +
// tolerance (assumes 5%/gold, the common default for the parts in our catalog).

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
