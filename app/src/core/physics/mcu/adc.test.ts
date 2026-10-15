import { gaussAt } from '../common'
import {
  ADC_MAX,
  adcReadable,
  averagedReading,
  averagedRms,
  calibratedVolts,
  effectiveBits,
  esp32Raw,
  heldAt,
  lsb,
  naiveVolts,
  quantize,
  sarSteps,
} from './adc'

describe('adc', () => {
  it('quantises into 2ᴺ steps of one LSB', () => {
    expect(lsb(3.3, 12)).toBeCloseTo(0.000806, 6)
    expect(quantize(1.65, 3.3, 12)).toBe(2048)
    expect(quantize(1.65, 3.3, 4)).toBe(8)
    expect(quantize(-0.1, 3.3, 8)).toBe(0)
    expect(quantize(5, 3.3, 8)).toBe(255)
  })

  it('finds the code by binary search, MSB first', () => {
    const steps = sarSteps(2.0, 3.3, 8)
    expect(steps).toHaveLength(8)
    expect(steps[0]).toMatchObject({ bit: 7, trial: 128, keep: true })
    expect(steps[1]).toMatchObject({ bit: 6, trial: 192, keep: false })
    expect(steps[7].code).toBe(quantize(2.0, 3.3, 8))
    for (const v of [0, 0.5, 1.234, 3.29, 3.3]) expect(sarSteps(v, 3.3, 12)[11].code).toBe(quantize(v, 3.3, 12))
  })

  it('holds the input from the last sample instant', () => {
    expect(heldAt((t) => t, 0.37, 10)).toBeCloseTo(0.3)
  })

  it('makes unit normal noise', () => {
    const xs = Array.from({ length: 20000 }, (_, k) => gaussAt(k))
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(sd).toBeCloseTo(1, 1)
  })

  it('averages noise down by √n, buying a bit per 4× samples', () => {
    const q = lsb(3.3, 12)
    expect(effectiveBits(3.3, averagedRms(0, q, 1))).toBeCloseTo(12)
    expect(effectiveBits(3.3, averagedRms(0, q, 64))).toBeCloseTo(12)
    const one = effectiveBits(3.3, averagedRms(5e-3, q, 1))
    expect(effectiveBits(3.3, averagedRms(5e-3, q, 4)) - one).toBeCloseTo(1)
    expect(effectiveBits(3.3, averagedRms(5e-3, q, 64)) - one).toBeCloseTo(3)
    const spread = (n: number) => {
      const r = Array.from({ length: 200 }, (_, k) => averagedReading(1.234, 5e-3, n, 3.3, 12, k * n) * q)
      const m = r.reduce((s, x) => s + x, 0) / r.length
      return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length)
    }
    expect(spread(16) / spread(1)).toBeGreaterThan(0.18)
    expect(spread(16) / spread(1)).toBeLessThan(0.32)
  })

  it('models the ESP32 curve: dead zone, linear middle, bowed top', () => {
    expect(esp32Raw(0.05, '11')).toBe(0)
    expect(esp32Raw(3.3, '11')).toBeLessThan(ADC_MAX)
    expect(esp32Raw(3.3, '0')).toBe(ADC_MAX)
    expect(esp32Raw(1.0, '11')).toBeGreaterThan(1000)
    for (const v of [0.3, 1.0, 2.0]) expect(calibratedVolts(esp32Raw(v, '11', 1.15), '11', 1.15)).toBeCloseTo(v, 2)
    expect(calibratedVolts(esp32Raw(3.2, '11'), '11')).toBeLessThan(3.1)
    expect(Math.abs(naiveVolts(esp32Raw(1.0, '11')) - 1.0)).toBeGreaterThan(0.05)
  })

  it('loses ADC2 to Wi-Fi', () => {
    expect(adcReadable(1, true)).toBe(true)
    expect(adcReadable(2, false)).toBe(true)
    expect(adcReadable(2, true)).toBe(false)
  })
})
