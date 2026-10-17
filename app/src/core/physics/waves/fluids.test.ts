import { stdDev } from '../common'
import {
  BARO_N,
  P_SEA,
  THROAT_X,
  airPressureAt,
  baroAltitude,
  baroHoldRun,
  baroNoise,
  bmp280Mode,
  ductAt,
  ductRadius,
  dynamicPa,
  paPerMetre,
  pitotSpeed,
  pitotSpeedError,
  venturi,
} from './fluids'

describe('Bernoulli', () => {
  test('continuity: half the radius, four times the speed; flow is the same everywhere', () => {
    expect(ductRadius(0, 0.5)).toBe(1)
    expect(ductRadius(THROAT_X, 0.5)).toBeCloseTo(0.5, 9)
    const v = venturi(5, 0.5, 'air')
    expect(v.v2).toBeCloseTo(20, 9)
    for (const x of [0, 0.4, THROAT_X, 0.7, 1]) {
      const d = ductAt(x, 5, 0.5, 1.2)
      expect(d.r * d.r * d.v).toBeCloseTo(5, 9)
      expect(d.p + d.q).toBeCloseTo(dynamicPa(1.2, 5), 9)
    }
  })

  test('the throat drop is ½ρ(v₂² − v₁²): air tens of pascals, water would cavitate', () => {
    const a = venturi(5, 0.5, 'air')
    expect(a.drop).toBeCloseTo(0.5 * 1.2 * (400 - 25), 9)
    expect(a.cavitates).toBe(false)
    expect(venturi(10, 0.4, 'water').cavitates).toBe(true)
    expect(venturi(1, 0.7, 'water').cavitates).toBe(false)
  })

  test('pitot: 10 m/s of air is 60 Pa, and 1 Pa of noise hurts most at low speed', () => {
    expect(dynamicPa(1.2, 10)).toBeCloseTo(60, 9)
    expect(pitotSpeed(1.2, 60)).toBeCloseTo(10, 9)
    expect(pitotSpeedError(1.2, 2, 1)).toBeGreaterThan(5 * pitotSpeedError(1.2, 20, 1))
    expect(pitotSpeedError(1.2, 0, 1)).toBeCloseTo(pitotSpeed(1.2, 1), 9)
  })
})

describe('barometric altitude', () => {
  test('standard atmosphere: about 12 Pa per metre at sea level, 899 hPa at 1000 m, and the formula inverts', () => {
    expect(BARO_N).toBeCloseTo(5.256, 2)
    expect(paPerMetre(0)).toBeGreaterThan(11.8)
    expect(paPerMetre(0)).toBeLessThan(12.3)
    expect(paPerMetre(3000)).toBeLessThan(paPerMetre(0))
    expect(airPressureAt(1000) / 100).toBeCloseTo(898.8, 0)
    expect(baroAltitude(airPressureAt(123))).toBeCloseTo(123, 6)
  })

  test('BMP280: more oversampling is slower and quieter; IIR 16 cuts noise by √31 but lags', () => {
    const fast = bmp280Mode('x1', 'off')
    const fine = bmp280Mode('x16', 'c16')
    expect(fast.measS).toBeCloseTo(5.5e-3, 9)
    expect(fine.measS).toBeCloseTo(37.5e-3, 9)
    expect(fine.rawPa).toBeCloseTo(1.3, 9)
    expect(fine.noisePa).toBeCloseTo(1.3 / Math.sqrt(31), 9)
    expect(fine.lagS).toBeCloseTo(15 * 37.5e-3, 9)
    expect(fast.lagS).toBe(0)
  })

  test('simulated noise matches the predicted standard deviation', () => {
    for (const m of [bmp280Mode('x1', 'off'), bmp280Mode('x4', 'c4'), bmp280Mode('x16', 'c16')]) {
      const s = baroNoise(m, 300)
      expect(stdDev([...s]) / m.noisePa).toBeGreaterThan(0.85)
      expect(stdDev([...s]) / m.noisePa).toBeLessThan(1.15)
    }
  })

  test('holding a baro altitude: falling pressure lowers the drone, a hot day raises it', () => {
    const calm = baroHoldRun({ holdM: 100, driftPaPerH: 0, tempC: 15 }, 7200, 60)
    expect(calm.tempErrM).toBeCloseTo(0, 6)
    expect(calm.driftErrM).toBeCloseTo(0, 6)
    const storm = baroHoldRun({ holdM: 100, driftPaPerH: -200, tempC: 15 }, 7200, 60)
    expect(storm.run[storm.run.length - 1].p0).toBeCloseTo(P_SEA - 400, 6)
    expect(storm.driftErrM).toBeLessThan(-30)
    expect(storm.driftErrM).toBeGreaterThan(-36)
    const hot = baroHoldRun({ holdM: 100, driftPaPerH: 0, tempC: 35 }, 60, 60)
    expect(hot.tempErrM).toBeCloseTo((100 * 20) / 288.15, 0)
  })
})
