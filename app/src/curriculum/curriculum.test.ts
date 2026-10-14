import { CATEGORIES, LEARN, SECTIONS, search } from '.'
import { UNITS } from '../lessons'

const entries = CATEGORIES.flatMap((c) => c.topics.flatMap((t) => t.entries))

describe('curriculum', () => {
  it('has unique ids', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length)
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length)
  })

  it('attaches each ready lesson to its entry, with id = entry id minus category, "/" → "-"', () => {
    const ready = entries.filter((e) => e.lesson)
    expect(ready.length).toBeGreaterThanOrEqual(3)
    for (const e of ready) expect(e.lesson!.id).toBe(e.id.split('/').slice(1).join('-'))
  })

  it('attaches every lesson in UNITS', () => {
    const attached = new Set(entries.map((e) => e.lesson?.id))
    for (const l of UNITS.flatMap((u) => u.lessons)) expect(attached).toContain(l.id)
  })

  it('searches topics and lessons', () => {
    expect(search('pid').length).toBeGreaterThan(0)
    expect(search('')).toEqual([])
  })
})

describe('home sections', () => {
  it('place every learn category exactly once', () => {
    const ids = SECTIONS.flatMap((s) => s.categories.map((c) => c.id))
    expect(ids.sort()).toEqual(LEARN.map((c) => c.id).sort())
  })
})
