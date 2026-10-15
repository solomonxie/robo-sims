import {
  INTERNAL_PULL_OHMS,
  PIN_MAX_A,
  buttonDown,
  driveOhms,
  drivenPin,
  nextLoopRead,
  noisySensor,
  padSwitches,
  pollMissChance,
  pollSees,
  press,
  pullPad,
  pullRiseTime,
} from './gpio'
import { LEDS } from './semiconductors'

describe('gpio', () => {
  it('switches the push-pull pair by bit and tri-states inputs', () => {
    expect(padSwitches('output', 1)).toEqual({ p: true, n: false, up: false, down: false })
    expect(padSwitches('output', 0)).toEqual({ p: false, n: true, up: false, down: false })
    expect(padSwitches('input', 1)).toEqual({ p: false, n: false, up: false, down: false })
    expect(padSwitches('opendrain', 1)).toEqual({ p: false, n: false, up: true, down: false })
    expect(padSwitches('opendrain', 0).n).toBe(true)
  })

  it('pulls through ~45 kΩ', () => {
    expect(pullPad('input', false).volts).toBeNull()
    expect(pullPad('pullup', false).volts).toBeCloseTo(3.3 - 50e-9 * INTERNAL_PULL_OHMS)
    expect(pullPad('pullup', true)).toEqual({ volts: 0, amps: 3.3 / 45e3 })
    expect(pullPad('pulldown', true).volts).toBe(3.3)
    expect(pullPad('opendrain', false, 0).volts).toBe(0)
    expect(pullPad('opendrain', false, 1).volts).toBeGreaterThan(3.29)
  })

  it('rises slowly through a weak pull-up', () => {
    expect(pullRiseTime(45e3, 100e-12)).toBeCloseTo(45e3 * 100e-12 * Math.log(4))
    expect(pullRiseTime(4.7e3, 100e-12)).toBeLessThan(pullRiseTime(45e3, 100e-12) / 9)
  })

  it('drives loads through the cap’s on-resistance', () => {
    expect(driveOhms(3)).toBeCloseTo(16.5)
    expect(driveOhms(0)).toBeCloseTo(132)
    const led = drivenPin(2, { ohms: 330, led: LEDS.red })
    expect(led.amps).toBeGreaterThan(0.003)
    expect(led.amps).toBeLessThan(0.005)
    expect(drivenPin(3, { ohms: 0, led: LEDS.red }).amps).toBeGreaterThan(PIN_MAX_A)
    const motor = drivenPin(3, { ohms: 5 })
    expect(motor.amps).toBeCloseTo(3.3 / 21.5)
    expect(motor.pinV).toBeCloseTo(motor.amps * 5)
    expect(motor.heatW).toBeCloseTo(motor.amps ** 2 * 16.5)
  })

  it('polls: a press is seen only if a read lands inside it', () => {
    expect(pollSees(0.05, 0.02, 0.1)).toBe(false)
    expect(pollSees(0.05, 0.06, 0.1)).toBe(true)
    expect(pollSees(0.1, 0.01, 0.1)).toBe(true)
    expect(pollSees(0.05, 0.01, 0.1, 0.055)).toBe(true)
    expect(pollMissChance(0.05, 0.2)).toBeCloseTo(0.75)
    expect(pollMissChance(0.3, 0.2)).toBe(0)
    expect(nextLoopRead(0.25, 0.1)).toBeCloseTo(0.3)
    expect(nextLoopRead(0.3, 0.1)).toBeCloseTo(0.3)
  })

  it('repeats a press train', () => {
    const p = press(1)
    expect(buttonDown(p.start + p.len / 2)).toBe(true)
    expect(buttonDown(p.start + p.len + 0.01)).toBe(false)
    expect(press(7).len).toBe(press(1).len)
  })

  it('ripples a slow sensor signal across both Schmitt thresholds', () => {
    const v = Array.from({ length: 500 }, (_, k) => noisySensor(k / 100))
    expect(Math.min(...v)).toBeLessThan(0.3 * 3.3)
    expect(Math.max(...v)).toBeGreaterThan(0.55 * 3.3)
    expect(Math.max(...v)).toBeLessThanOrEqual(3.3)
  })
})
