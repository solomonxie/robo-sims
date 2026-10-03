import { describe, expect, it } from 'vitest'
import {
  hBridgeDirection,
  ohmsLaw,
  parallelResistance,
  pwmAverageVoltage,
  rcCharge,
  seriesResistance,
  thermistorResistance,
} from './formulas'

describe('ohmsLaw', () => {
  it('solves for voltage', () => {
    expect(ohmsLaw({ ampsA: 0.02, ohms: 220 }).voltsV).toBeCloseTo(4.4)
  })
  it('solves for current', () => {
    expect(ohmsLaw({ voltsV: 5, ohms: 220 }).ampsA).toBeCloseTo(5 / 220)
  })
  it('solves for resistance', () => {
    expect(ohmsLaw({ voltsV: 5, ampsA: 0.02 }).ohms).toBeCloseTo(250)
  })
  it('rejects anything but exactly two knowns', () => {
    expect(() => ohmsLaw({ voltsV: 5 })).toThrow()
    expect(() => ohmsLaw({ voltsV: 5, ampsA: 1, ohms: 5 })).toThrow()
  })
})

describe('seriesResistance', () => {
  it('matches hello_02_series_circuit.py default: 220,330,1000 -> 1550', () => {
    expect(seriesResistance([220, 330, 1000])).toBeCloseTo(1550)
  })
})

describe('parallelResistance', () => {
  it('two equal resistors halve', () => {
    expect(parallelResistance([1000, 1000])).toBeCloseTo(500)
  })
})

describe('rcCharge', () => {
  it('tau = R*C', () => {
    expect(rcCharge(10_000, 100e-9, 0).tauS).toBeCloseTo(1e-3)
  })
  it('one tau charges to ~63.2%', () => {
    const { tauS, fractionCharged } = rcCharge(10_000, 100e-9, 1e-3)
    expect(fractionCharged).toBeCloseTo(1 - Math.exp(-1), 3)
    expect(tauS).toBeCloseTo(1e-3)
  })
})

describe('hBridgeDirection', () => {
  it('coasts when disabled regardless of inputs', () => {
    expect(hBridgeDirection(true, false, false)).toBe('coast')
  })
  it('drives forward on IN1=1, IN2=0', () => {
    expect(hBridgeDirection(true, false, true)).toBe('forward')
  })
  it('drives reverse on IN1=0, IN2=1', () => {
    expect(hBridgeDirection(false, true, true)).toBe('reverse')
  })
  it('brakes when IN1 and IN2 match', () => {
    expect(hBridgeDirection(true, true, true)).toBe('brake')
    expect(hBridgeDirection(false, false, true)).toBe('brake')
  })
})

describe('pwmAverageVoltage', () => {
  it('50% duty halves the supply voltage', () => {
    expect(pwmAverageVoltage(7.4, 50)).toBeCloseTo(3.7)
  })
})

describe('thermistorResistance', () => {
  it('equals ohmsAt25C at 25°C', () => {
    const r = thermistorResistance({ ohmsAt25C: 10_000, beta: 3950 }, 25)
    expect(r).toBeCloseTo(10_000, 0)
  })
  it('decreases as temperature rises (NTC behavior)', () => {
    const cold = thermistorResistance({ ohmsAt25C: 10_000, beta: 3950 }, 0)
    const hot = thermistorResistance({ ohmsAt25C: 10_000, beta: 3950 }, 50)
    expect(hot).toBeLessThan(cold)
  })
})
