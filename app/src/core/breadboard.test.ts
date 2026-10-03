import { buildBoardResolver, generateHoles, holePosition, netKeyOf } from './breadboard'

describe('netKeyOf', () => {
  it('groups a whole rail into one net regardless of column', () => {
    expect(netKeyOf({ row: 'top+', col: 1 })).toBe(netKeyOf({ row: 'top+', col: 29 }))
  })
  it('keeps rails separate', () => {
    expect(netKeyOf({ row: 'top+', col: 5 })).not.toBe(netKeyOf({ row: 'top-', col: 5 }))
    expect(netKeyOf({ row: 'top+', col: 5 })).not.toBe(netKeyOf({ row: 'bottom+', col: 5 }))
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

describe('generateHoles', () => {
  it('has 10x30 strip holes and 4 rails of 25', () => {
    expect(generateHoles()).toHaveLength(300 + 4 * 25)
  })
})

describe('holePosition', () => {
  it('spaces columns one pitch apart, centered', () => {
    expect(holePosition({ row: 'a', col: 1 }).x).toBe(-14.5)
    expect(holePosition({ row: 'a', col: 30 }).x).toBe(14.5)
  })
  it('puts the center channel between e and f', () => {
    expect(holePosition({ row: 'e', col: 1 }).z).toBeLessThan(0)
    expect(holePosition({ row: 'f', col: 1 }).z).toBeGreaterThan(0)
  })
})

describe('buildBoardResolver', () => {
  it('pre-unions every hole in a strip column', () => {
    const resolver = buildBoardResolver()
    expect(resolver.netOf('a3')).toBe(resolver.netOf('e3'))
    expect(resolver.netOf('a3')).not.toBe(resolver.netOf('f3'))
  })

  it('a wire union merges two previously separate nets', () => {
    const resolver = buildBoardResolver()
    expect(resolver.netOf('a3')).not.toBe(resolver.netOf('a10'))
    resolver.union('a3', 'a10')
    expect(resolver.netOf('a3')).toBe(resolver.netOf('a10'))
  })
})
