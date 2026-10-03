import { CATALOG, CATEGORIES } from './catalog'

describe('CATALOG', () => {
  it('has unique names', () => {
    expect(new Set(CATALOG.map((e) => e.name)).size).toBe(CATALOG.length)
  })
  it('only uses known categories', () => {
    for (const e of CATALOG) expect(CATEGORIES).toContain(e.category)
  })
  it('has unique pin ids per part', () => {
    for (const e of CATALOG) {
      const ids = e.pins.map((p) => `${p.id}@${p.z}`)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})
