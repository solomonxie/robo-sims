import { CATEGORIES, search } from '.'

const entries = CATEGORIES.flatMap((c) => c.topics.flatMap((t) => t.entries))

describe('curriculum', () => {
  it('has unique ids', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length)
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length)
  })

  it('has the shipped lesson attached', () => {
    expect(entries.filter((e) => e.lesson).map((e) => e.lesson!.id)).toEqual(['current'])
  })

  it('searches topics and lessons', () => {
    expect(search('pid').length).toBeGreaterThan(0)
    expect(search('')).toEqual([])
  })
})
