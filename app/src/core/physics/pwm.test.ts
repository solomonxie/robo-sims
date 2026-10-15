import {
  audible,
  dutyCounts,
  ledcCount,
  ledcMaxHz,
  ledcResolution,
  pwmAverage,
  pwmHigh,
  pwmRipple,
  servoAngle,
  servoPulse,
  servoStep,
  switchingLoss,
} from './pwm'
import { rcSteadyCycle } from './signals/filters'

describe('pwm', () => {
  it('trades LEDC resolution for frequency', () => {
    expect(ledcResolution(5e3)).toBe(13)
    expect(ledcResolution(20e3)).toBe(11)
    expect(ledcResolution(1e6)).toBe(6)
    expect(ledcResolution(50)).toBe(20)
    expect(ledcMaxHz(8)).toBeCloseTo(312.5e3)
  })

  it('compares the timer count with the duty value', () => {
    expect(dutyCounts(0.5, 8)).toBe(128)
    expect(dutyCounts(1, 8)).toBe(256)
    expect(ledcCount(0.25e-3, 1e3, 8)).toBe(64)
    expect(pwmHigh(0.2e-3, 1e3, 0.25)).toBe(true)
    expect(pwmHigh(0.3e-3, 1e3, 0.25)).toBe(false)
    expect(pwmAverage(3.3, 0.3)).toBeCloseTo(0.99)
  })

  it('matches the simulated RC ripple', () => {
    const tau = 10e-3
    for (const [d, hz] of [[0.5, 490], [0.2, 50], [0.8, 2e3]]) {
      const { output } = rcSteadyCycle('low', (c) => ((c % 1) <= d ? 3.3 : 0), hz, tau, 2048)
      const pp = Math.max(...output) - Math.min(...output)
      expect(pwmRipple(3.3, d, hz, tau)).toBeCloseTo(pp, 2)
    }
    expect(pwmRipple(5, 0, 1e3, 1e-3)).toBe(0)
    expect(pwmRipple(5, 0.5, 20e3, 0.2e-3)).toBeLessThan(pwmRipple(5, 0.5, 1e3, 0.2e-3))
  })

  it('flags audible PWM and scales switching loss with frequency', () => {
    expect(audible(1e3)).toBe(true)
    expect(audible(25e3)).toBe(false)
    expect(switchingLoss(5, 0.5, 100e-9, 20e3)).toBeCloseTo(5e-3)
  })

  it('maps servo pulses to angles and slews the horn', () => {
    expect(servoAngle(1.5e-3)).toBeCloseTo(90)
    expect(servoAngle(0.5e-3)).toBe(0)
    expect(servoPulse(180)).toBeCloseTo(2e-3)
    expect(servoStep(0, 90, 0.05)).toBeCloseTo(30)
    expect(servoStep(80, 90, 0.05)).toBe(90)
  })
})
