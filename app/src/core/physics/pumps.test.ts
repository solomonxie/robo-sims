import {
  AIR_KG_M3,
  CENTRIFUGAL_12V,
  DC_SPEED_FRACTION,
  PERI_PUMP,
  PERI_SUCTION_M,
  WATER_KG_M3,
  centrifugalHeadM,
  centrifugalLpm,
  doseRevs,
  doseSeconds,
  doseSteps,
  dosedMl,
  periDeliveredMl,
  periFlowMlMin,
  periMlPerRev,
  periPrimeMl,
  periPulse,
  periPulseErrorMl,
} from './index'

describe('peristaltic pump', () => {
  it('volume per rev and flow = mL/rev × rpm', () => {
    expect(periMlPerRev()).toBeCloseTo((Math.PI * (2 * Math.PI * 12 - 9)) / 1000, 6)
    expect(periFlowMlMin(100)).toBeCloseTo(100 * periMlPerRev())
  })
  it('pulses once per roller, averaging to 1', () => {
    const n = 360
    const mean = Array.from({ length: n }, (_, i) => periPulse((2 * Math.PI * i) / n)).reduce((a, b) => a + b) / n
    expect(mean).toBeCloseTo(1)
    expect(periPulse(0)).toBeCloseTo(periPulse((2 * Math.PI) / PERI_PUMP.rollers))
  })
  it('delivers exactly mL/rev per turn; mid-pulse error is small', () => {
    expect(periDeliveredMl(2 * Math.PI)).toBeCloseTo(periMlPerRev())
    expect(periPulseErrorMl()).toBeLessThan(0.05 * periMlPerRev())
  })
  it('dosing by revs, steps and time', () => {
    expect(doseRevs(periMlPerRev() * 10)).toBeCloseTo(10)
    expect(doseSteps(periMlPerRev(), 3200)).toBe(3200)
    expect(doseSeconds(5, 30)).toBeCloseTo(10)
  })
  it('a timed DC motor under-doses; a dry line eats the prime', () => {
    expect(dosedMl('stepper', 5, true, 0.4)).toBe(5)
    expect(dosedMl('dc', 5, true, 0.4)).toBeCloseTo(5 * DC_SPEED_FRACTION)
    expect(periPrimeMl(0.4)).toBeCloseTo(0.4 * Math.PI)
    expect(dosedMl('stepper', 5, false, 0.4)).toBeCloseTo(5 - periPrimeMl(0.4))
    expect(PERI_SUCTION_M).toBeGreaterThan(8)
  })
})

describe('centrifugal pump', () => {
  it('head ∝ rpm² and ∝ density: air makes 800× less', () => {
    expect(centrifugalHeadM(6000, WATER_KG_M3)).toBeCloseTo(4 * centrifugalHeadM(3000, WATER_KG_M3))
    expect(centrifugalHeadM(3000, WATER_KG_M3)).toBeCloseTo(1.13, 2)
    expect(centrifugalHeadM(CENTRIFUGAL_12V.maxRpm, AIR_KG_M3)).toBeLessThan(0.01)
  })
  it('primed it lifts; dry it cannot self-prime', () => {
    expect(centrifugalLpm(3000, 0.3, true)).toBeGreaterThan(0)
    expect(centrifugalLpm(6000, 0.3, false)).toBe(0)
    expect(centrifugalLpm(6000, 0, true)).toBeCloseTo(CENTRIFUGAL_12V.maxLpm)
  })
})
