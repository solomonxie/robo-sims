import { fitDigits, niceCeil, sci, si, superscript } from './units'

describe('units', () => {
  it('formats with SI prefixes and scientific notation', () => {
    expect(si(0.0123, 'A')).toBe('12.3 mA')
    expect(si(4700, 'Ω', 2)).toBe('4.7 kΩ')
    expect(sci(6.24e18)).toBe('6.24 × 10¹⁸')
    expect(superscript(-12)).toBe('⁻¹²')
  })
  it('fits a number into seven-segment cells with the most decimals', () => {
    expect(fitDigits(6, 3)).toBe('6.00')
    expect(fitDigits(27.27, 3)).toBe('27.3')
    expect(fitDigits(220, 3)).toBe('220')
    expect(fitDigits(1000, 4)).toBe('1000')
    expect(fitDigits(9.996, 3)).toBe('10.0')
    expect(fitDigits(-3, 4)).toBe('-3.00')
    expect(fitDigits(0, 2)).toBe('0.0')
  })

  it('rounds up to a 1-2-5 step', () => {
    expect(niceCeil(0.03)).toBeCloseTo(0.05, 12)
    expect(niceCeil(7)).toBe(10)
    expect(niceCeil(2)).toBe(2)
    expect(niceCeil(0.0011)).toBeCloseTo(0.002, 12)
    expect(niceCeil(0)).toBe(0)
  })
})
