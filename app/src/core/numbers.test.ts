import { addWrap, binary, countSteps, hex, negate, nibbles, placeValues, signedRange, toSigned, wrap } from './numbers'

describe('numbers', () => {
  it('writes fixed-width binary and hex', () => {
    expect(binary(173, 8)).toBe('10101101')
    expect(binary(5, 4)).toBe('0101')
    expect(hex(48879, 4)).toBe('BEEF')
    expect(hex(10, 2)).toBe('0A')
  })

  it('splits into nibbles, most significant first', () => {
    expect(nibbles(0xbeef, 4)).toEqual([11, 14, 14, 15])
    expect(nibbles(0x2a, 2)).toEqual([2, 10])
  })

  it('place values sum back to the number', () => {
    expect(placeValues(4)).toEqual([1, 2, 4, 8])
    expect(placeValues(4, true)).toEqual([1, 2, 4, -8])
    const bits = binary(173, 8).split('').reverse().map(Number)
    expect(placeValues(8).reduce((s, w, i) => s + w * bits[i], 0)).toBe(173)
    const neg = binary(wrap(-3, 8), 8).split('').reverse().map(Number)
    expect(placeValues(8, true).reduce((s, w, i) => s + w * neg[i], 0)).toBe(-3)
  })

  it('two’s complement round-trips the signed range', () => {
    expect(signedRange(8)).toEqual({ min: -128, max: 127 })
    expect(wrap(-1, 8)).toBe(255)
    expect(wrap(256, 8)).toBe(0)
    for (let v = -8; v <= 7; v++) expect(toSigned(wrap(v, 4), 4)).toBe(v)
  })

  it('negates by inverting and adding one', () => {
    expect(negate(wrap(5, 4), 4)).toEqual({ inverted: 0b1010, result: 0b1011 })
    expect(toSigned(negate(wrap(5, 4), 4).result, 4)).toBe(-5)
    expect(negate(0, 4).result).toBe(0)
    expect(negate(wrap(-8, 4), 4).result).toBe(wrap(-8, 4))
  })

  it('flags carry and signed overflow separately', () => {
    expect(addWrap(5, 4, 4)).toEqual({ pattern: 9, value: -7, carry: 0, overflow: true })
    expect(addWrap(-1, 1, 4)).toEqual({ pattern: 0, value: 0, carry: 1, overflow: false })
    expect(addWrap(-8, -1, 4)).toEqual({ pattern: 7, value: 7, carry: 1, overflow: true })
    expect(addWrap(3, -5, 4)).toMatchObject({ value: -2, overflow: false })
  })

  it('counts around the wheel', () => {
    expect(countSteps(6, 3, 4)).toEqual([6, 7, 8, 9])
    expect(countSteps(1, -2, 4)).toEqual([1, 0, 15])
    expect(countSteps(4, 0, 4)).toEqual([4])
  })
})
