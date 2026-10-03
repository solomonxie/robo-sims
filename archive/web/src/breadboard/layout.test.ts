import { describe, expect, it } from 'vitest'
import { buildBoardResolver, netKeyOf } from './layout'

describe('netKeyOf', () => {
  it('groups a whole rail into one net regardless of column', () => {
    expect(netKeyOf({ row: '+', col: 1 })).toBe(netKeyOf({ row: '+', col: 30 }))
  })
  it('keeps + and - rails separate', () => {
    expect(netKeyOf({ row: '+', col: 5 })).not.toBe(netKeyOf({ row: '-', col: 5 }))
  })
  it('joins a-e in the same column into one strip', () => {
    expect(netKeyOf({ row: 'a', col: 3 })).toBe(netKeyOf({ row: 'e', col: 3 }))
  })
  it('keeps top (a-e) and bottom (f-j) strips separate even in the same column', () => {
    expect(netKeyOf({ row: 'a', col: 3 })).not.toBe(netKeyOf({ row: 'f', col: 3 }))
  })
  it('keeps adjacent columns separate', () => {
    expect(netKeyOf({ row: 'a', col: 3 })).not.toBe(netKeyOf({ row: 'a', col: 4 }))
  })
})

describe('buildBoardResolver', () => {
  it('pre-unions every hole in a strip column', () => {
    const resolver = buildBoardResolver(30)
    expect(resolver.netOf('a3')).toBe(resolver.netOf('e3'))
    expect(resolver.netOf('a3')).not.toBe(resolver.netOf('f3'))
  })

  it('a wire union merges two previously separate nets', () => {
    const resolver = buildBoardResolver(30)
    expect(resolver.netOf('a3')).not.toBe(resolver.netOf('a10'))
    resolver.union('a3', 'a10') // simulates a jumper wire between two holes
    expect(resolver.netOf('a3')).toBe(resolver.netOf('a10'))
  })
})
