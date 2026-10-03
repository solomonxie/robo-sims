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

export function resistorColorBands(ohms: number): [string, string, string, string] {
  if (ohms < 10) throw new Error('resistorColorBands expects ohms >= 10')

  let exponent = 0
  let value = ohms
  while (value >= 100) {
    value /= 10
    exponent++
  }
  const firstDigit = Math.floor(value / 10)
  const secondDigit = Math.floor(value % 10)

  return [DIGIT_COLORS[firstDigit], DIGIT_COLORS[secondDigit], DIGIT_COLORS[exponent], GOLD]
}
