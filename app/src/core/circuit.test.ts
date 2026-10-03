import { minLedResistor, solveLedLoop } from './circuit'

const red = { forwardVoltageV: 2.0, maxCurrentMA: 20 }

describe('solveLedLoop', () => {
  it('lights a red LED from an 18650 through 220 Ω', () => {
    const r = solveLedLoop({ supplyV: 3.7, ohms: 220, ...red })
    expect(r.status).toBe('lit')
    expect(r.currentMA).toBeCloseTo(7.73, 1)
  })
  it('stays off below forward voltage', () => {
    expect(solveLedLoop({ supplyV: 1.5, ohms: 220, ...red }).status).toBe('off')
  })
  it('flags over-current with too small a resistor', () => {
    expect(solveLedLoop({ supplyV: 9, ohms: 100, ...red }).status).toBe('over-current')
  })
})

describe('minLedResistor', () => {
  it('is (V − Vf) / I', () => {
    expect(minLedResistor(5, 2, 20)).toBeCloseTo(150)
  })
})
