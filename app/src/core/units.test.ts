import { sci, si, superscript } from './units'

describe('units', () => {
  it('formats with SI prefixes and scientific notation', () => {
    expect(si(0.0123, 'A')).toBe('12.3 mA')
    expect(si(4700, 'Ω', 2)).toBe('4.7 kΩ')
    expect(sci(6.24e18)).toBe('6.24 × 10¹⁸')
    expect(superscript(-12)).toBe('⁻¹²')
  })
})
