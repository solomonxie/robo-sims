import {
  E96,
  GRADES,
  bandValue,
  batchPart,
  e12Above,
  nearestE12,
  nearestIn,
  resistorBands,
  resistorColorBands,
  resistorDigits,
  seriesStep,
  toleranceRange,
} from './resistorColors'

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

describe('E-series and grades', () => {
  it('E96 matches the standard table', () => {
    const table = '10.0 10.2 10.5 10.7 11.0 11.3 11.5 11.8 12.1 12.4 12.7 13.0 13.3 13.7 14.0 14.3 14.7 15.0 15.4 15.8 16.2 16.5 16.9 17.4 17.8 18.2 18.7 19.1 19.6 20.0 20.5 21.0 21.5 22.1 22.6 23.2 23.7 24.3 24.9 25.5 26.1 26.7 27.4 28.0 28.7 29.4 30.1 30.9 31.6 32.4 33.2 34.0 34.8 35.7 36.5 37.4 38.3 39.2 40.2 41.2 42.2 43.2 44.2 45.3 46.4 47.5 48.7 49.9 51.1 52.3 53.6 54.9 56.2 57.6 59.0 60.4 61.9 63.4 64.9 66.5 68.1 69.8 71.5 73.2 75.0 76.8 78.7 80.6 82.5 84.5 86.6 88.7 90.9 93.1 95.3 97.6'
    expect(E96).toEqual(table.split(' ').map(Number))
  })
  it('snaps to a series and steps to its neighbours across decades', () => {
    expect(nearestIn(GRADES[5].series, 4600)).toBe(4700)
    expect(nearestIn(GRADES[1].series, 4700)).toBe(4750)
    expect(seriesStep(GRADES[5].series, 4700, -1)).toBe(4300)
    expect(seriesStep(GRADES[5].series, 4700, 1)).toBe(5100)
    expect(seriesStep(GRADES[10].series, 1000, -1)).toBe(820)
    expect(seriesStep(GRADES[1].series, 976, 1)).toBe(1000)
  })
  it('neighbouring tolerance windows about meet', () => {
    for (const g of Object.values(GRADES)) {
      const v = nearestIn(g.series, 4700)
      const up = seriesStep(g.series, v, 1)
      const gap = toleranceRange(up, g.percent)[0] / toleranceRange(v, g.percent)[1]
      expect(gap).toBeGreaterThan(0.95)
      expect(gap).toBeLessThan(1.05)
    }
  })
  it('1 % parts get five bands, 10 % a silver one', () => {
    expect(resistorBands(4750, 1)).toEqual(['#ffff00', '#8b00ff', '#00a651', '#7b3f00', '#7b3f00'])
    expect(resistorBands(10000, 1)).toEqual(['#7b3f00', '#000000', '#000000', '#ff0000', '#7b3f00'])
    expect(resistorBands(220, 10)).toEqual(['#ff0000', '#ff0000', '#7b3f00', '#c0c0c0'])
  })
  it('a batch stays inside its tolerance, centred on the value', () => {
    const parts = Array.from({ length: 200 }, (_, k) => batchPart(1000, 5, k))
    expect(Math.min(...parts)).toBeGreaterThanOrEqual(950)
    expect(Math.max(...parts)).toBeLessThanOrEqual(1050)
    expect(parts.reduce((a, b) => a + b, 0) / parts.length).toBeCloseTo(1000, -1)
  })
})
