import { bandValue, e12Above, nearestE12, resistorColorBands, resistorDigits, toleranceRange } from './resistorColors'

describe('resistorColorBands', () => {
  it('220 ohms -> red, red, brown, gold', () => {
    expect(resistorColorBands(220)).toEqual(['#ff0000', '#ff0000', '#7b3f00', '#d4af37'])
  })
  it('1000 ohms -> brown, black, red, gold', () => {
    expect(resistorColorBands(1000)).toEqual(['#7b3f00', '#000000', '#ff0000', '#d4af37'])
  })
})

describe('resistorDigits', () => {
  it('4.7 kΩ is 4, 7 and two zeros; the bands decode back to the value', () => {
    expect(resistorDigits(4700)).toEqual({ first: 4, second: 7, exponent: 2 })
    expect(bandValue(4, 7, 2)).toBe(4700)
  })
  it('handles the ends of the range and rounding up to the next decade', () => {
    expect(resistorDigits(10)).toEqual({ first: 1, second: 0, exponent: 0 })
    expect(resistorDigits(1e6)).toEqual({ first: 1, second: 0, exponent: 5 })
    expect(resistorDigits(996)).toEqual({ first: 1, second: 0, exponent: 2 })
  })
})

describe('nearestE12', () => {
  it('snaps to the standard series on a log scale', () => {
    expect(nearestE12(220)).toBe(220)
    expect(nearestE12(4500)).toBe(4700)
    expect(nearestE12(95)).toBe(100)
    expect(nearestE12(10)).toBe(10)
    expect(nearestE12(1e6)).toBe(1e6)
  })
})

describe('toleranceRange', () => {
  it('a 5 % 4.7 kΩ part reads 4465–4935 Ω', () => {
    const [lo, hi] = toleranceRange(4700, 5)
    expect(lo).toBeCloseTo(4465)
    expect(hi).toBeCloseTo(4935)
  })
})

describe('e12Above', () => {
  it('rounds up to the next standard value', () => {
    expect(e12Above(150)).toBe(150)
    expect(e12Above(350)).toBeCloseTo(390, 9)
    expect(e12Above(65)).toBe(68)
    expect(e12Above(95)).toBe(100)
  })
})
