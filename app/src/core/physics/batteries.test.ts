import { CHEMISTRIES, cRateAmps, shortCircuitAmps, cRateHours, cutoffSoc, deliveredWh, openCircuitVolts, terminalVolts, usableFraction } from '.'

const { alkaline, nimh, liion, lfp } = CHEMISTRIES

describe('batteries', () => {
  it('OCV runs from cutoff (empty) to full charge and rises monotonically', () => {
    for (const c of Object.values(CHEMISTRIES)) {
      expect(openCircuitVolts(c, 0)).toBeCloseTo(c.cutoff)
      expect(openCircuitVolts(c, 1)).toBeCloseTo(c.full)
      expect(openCircuitVolts(c, 2)).toBeCloseTo(c.full)
      for (let s = 0; s < 1; s += 0.05) expect(openCircuitVolts(c, s + 0.05)).toBeGreaterThan(openCircuitVolts(c, s))
    }
  })

  it('mid-charge sits near the nominal voltage', () => {
    expect(openCircuitVolts(liion, 0.5)).toBeCloseTo(3.725, 3)
    expect(openCircuitVolts(lfp, 0.5)).toBeCloseTo(3.295, 3)
    expect(openCircuitVolts(nimh, 0.5)).toBeCloseTo(1.24)
  })

  it('LiFePO₄ is flat in the middle, alkaline slopes', () => {
    const spread = (c: typeof liion) => openCircuitVolts(c, 0.8) - openCircuitVolts(c, 0.2)
    expect(spread(lfp) / lfp.nominal).toBeLessThan(0.04)
    expect(spread(alkaline) / alkaline.nominal).toBeGreaterThan(0.15)
  })

  it('sags by I × R on discharge and rises on charge', () => {
    expect(terminalVolts(liion, 0.5, 2)).toBeCloseTo(openCircuitVolts(liion, 0.5) - 0.08)
    expect(terminalVolts(liion, 0.5, -1.5)).toBeCloseTo(openCircuitVolts(liion, 0.5) + 0.06)
    expect(terminalVolts(alkaline, 1, 2)).toBeCloseTo(1.3)
    expect(shortCircuitAmps(alkaline, 1)).toBeCloseTo(1.6 / 0.15)
    expect(terminalVolts(liion, 0.5, shortCircuitAmps(liion, 0.5))).toBeCloseTo(0)
  })

  it('C-rate: 1 C of a 3000 mAh cell is 3 A for an hour', () => {
    expect(cRateAmps(3000, 1)).toBe(3)
    expect(cRateAmps(3000, 0.5)).toBe(1.5)
    expect(cRateHours(2)).toBe(0.5)
  })

  it('heavy loads hit cutoff early; alkaline worst', () => {
    expect(usableFraction(liion, 0.01)).toBeGreaterThan(0.99)
    expect(usableFraction(liion, 6)).toBeLessThan(usableFraction(liion, 1))
    expect(usableFraction(alkaline, 2)).toBeLessThan(0.75)
    expect(usableFraction(nimh, 2)).toBeGreaterThan(0.85)
    expect(cutoffSoc(alkaline, 10)).toBe(1)
    expect(terminalVolts(alkaline, cutoffSoc(alkaline, 1), 1)).toBeCloseTo(alkaline.cutoff, 4)
  })

  it('delivered energy shrinks with current', () => {
    const slow = deliveredWh(liion, 0.3)
    expect(slow).toBeGreaterThan(10.5)
    expect(slow).toBeLessThan(11.4)
    expect(deliveredWh(liion, 6)).toBeLessThan(slow * 0.95)
  })
})
