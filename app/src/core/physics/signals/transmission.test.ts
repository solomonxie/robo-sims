import {
  bounces,
  coaxZ0,
  criticalLength,
  launchVolts,
  lineDelay,
  lineVolts,
  pulseShape,
  rampShape,
  reflection,
  settleTime,
  settledVolts,
  twinZ0,
  velocityFactor,
} from '..'

describe('transmission', () => {
  it('cable geometry sets Z0 and speed', () => {
    expect(coaxZ0(2.84, 0.81, 2.25)).toBeCloseTo(50.2, 1)
    expect(twinZ0(0.92, 0.51, 2)).toBeCloseTo(101, 0)
    expect(velocityFactor(2.25)).toBeCloseTo(0.667, 3)
    expect(lineDelay(10, 2 / 3)).toBeCloseTo(50e-9, 10)
    expect(criticalLength(3e-9, 2 / 3)).toBeCloseTo(0.1, 3)
  })

  it('reflection coefficient: open +1, short −1, matched 0', () => {
    expect(reflection(Infinity, 50)).toBe(1)
    expect(reflection(0, 50)).toBe(-1)
    expect(reflection(50, 50)).toBe(0)
    expect(reflection(100, 50)).toBeCloseTo(1 / 3, 9)
  })

  it('lattice legs alternate direction and converge to the DC level', () => {
    const legs = bounces(3.3, 30, 270, Infinity, 200)
    expect(legs[0]).toEqual({ k: 0, amp: launchVolts(3.3, 30, 270), forward: true })
    expect(legs[1].amp).toBeCloseTo(legs[0].amp, 9)
    expect(legs[2].amp).toBeCloseTo(legs[0].amp * reflection(30, 270), 9)
    const atLoad = lineVolts(1, 199.5, legs, rampShape(0))
    expect(atLoad).toBeCloseTo(settledVolts(3.3, 30, Infinity), 3)
  })

  it('a matched source launches half and the open end doubles it', () => {
    const legs = bounces(5, 50, 50, Infinity, 6)
    const step = rampShape(0)
    expect(lineVolts(0.5, 0.4, legs, step)).toBe(0)
    expect(lineVolts(0.5, 0.6, legs, step)).toBeCloseTo(2.5, 9)
    expect(lineVolts(0.5, 1.6, legs, step)).toBeCloseTo(5, 9)
    expect(lineVolts(1, 1.01, legs, step)).toBeCloseTo(5, 9)
  })

  it('a short sends the pulse back inverted', () => {
    const legs = bounces(5, 50, 50, 0, 4)
    const p = pulseShape(0.2, 0)
    expect(lineVolts(0.5, 0.6, legs, p)).toBeCloseTo(2.5, 9)
    expect(lineVolts(0.5, 1.6, legs, p)).toBeCloseTo(-2.5, 9)
    expect(lineVolts(0.5, 2.6, legs, p)).toBe(0)
  })

  it('settle time is the last sample outside the band', () => {
    expect(settleTime([0, 2, 0.9, 1.02, 1], 1, 1)).toBe(3)
    expect(settleTime([1, 1], 1, 1)).toBe(0)
  })
})
