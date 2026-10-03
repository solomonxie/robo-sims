import { describe, expect, it } from 'vitest'
import { resistorColorBands } from './resistorColors'

describe('resistorColorBands', () => {
  it('220 ohms -> red, red, brown, gold', () => {
    expect(resistorColorBands(220)).toEqual(['#ff0000', '#ff0000', '#7b3f00', '#d4af37'])
  })
  it('1000 ohms -> brown, black, red, gold', () => {
    expect(resistorColorBands(1000)).toEqual(['#7b3f00', '#000000', '#ff0000', '#d4af37'])
  })
})
