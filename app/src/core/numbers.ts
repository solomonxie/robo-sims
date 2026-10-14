// Fixed-width integers: binary and hex digits, place values, two's complement and wrap-around addition.
import { Bit, bit } from './logic'

export const digits = (n: number, base: 2 | 16, count: number) => n.toString(base).toUpperCase().padStart(count, '0')
export const binary = (n: number, width: number) => digits(n, 2, width)
export const hex = (n: number, count: number) => digits(n, 16, count)

/** 4-bit groups of `n`, most significant first: 0xBEEF → [11, 14, 14, 15]. */
export const nibbles = (n: number, count: number) => Array.from({ length: count }, (_, i) => Math.floor(n / 16 ** (count - 1 - i)) % 16)

/** Weight of each bit, least significant first; in two's complement the top bit counts negative. */
export const placeValues = (width: number, signed = false) =>
  Array.from({ length: width }, (_, i) => (signed && i === width - 1 ? -(2 ** i) : 2 ** i))

export const signedRange = (width: number) => ({ min: -(2 ** (width - 1)), max: 2 ** (width - 1) - 1 })

/** Bit pattern of any integer kept to `width` bits: −1 → 1111…, 256 → 0 in 8 bits. */
export const wrap = (n: number, width: number) => ((n % 2 ** width) + 2 ** width) % 2 ** width
export const toSigned = (pattern: number, width: number) => (pattern >= 2 ** (width - 1) ? pattern - 2 ** width : pattern)

/** −x = NOT x + 1. */
export function negate(pattern: number, width: number) {
  const inverted = 2 ** width - 1 - pattern
  return { inverted, result: wrap(inverted + 1, width) }
}

/** Fixed-width add: carry = the unsigned result didn't fit; overflow = the signed one didn't (both inputs share a sign the result lacks). */
export function addWrap(a: number, b: number, width: number) {
  const pa = wrap(a, width)
  const pb = wrap(b, width)
  const pattern = wrap(pa + pb, width)
  const value = toSigned(pattern, width)
  const carry: Bit = bit(pa + pb >= 2 ** width)
  const overflow = value !== toSigned(pa, width) + toSigned(pb, width)
  return { pattern, value, carry, overflow }
}

/** Patterns visited counting from a by b one step at a time (|b| + 1 entries, a first). */
export const countSteps = (a: number, b: number, width: number) =>
  Array.from({ length: Math.abs(b) + 1 }, (_, k) => wrap(a + Math.sign(b) * k, width))
