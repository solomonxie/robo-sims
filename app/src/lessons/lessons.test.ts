import { UNITS } from '.'
import { Lesson, Params, initialParams } from './types'

const lessons = UNITS.flatMap((u) => u.lessons)

function variants(l: Lesson): Params[] {
  const base = initialParams(l)
  const out: Params[] = [base]
  for (const c of l.controls) {
    if (c.kind === 'slider') out.push({ ...base, [c.key]: c.min }, { ...base, [c.key]: c.max })
    else c.options.forEach((o) => out.push({ ...base, [c.key]: o.value }))
  }
  return out
}

describe('lessons', () => {
  it('have unique ids', () => {
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length)
  })

  it.each(lessons.map((l) => [l.id, l] as const))('%s animates across all control extremes', (_, l) => {
    const stage = l.build()
    for (const p of variants(l)) {
      for (let i = 0; i < 20; i++) stage.frame(1 / 60, p)
      stage.frame(0.5, p)
      for (const r of stage.readouts(p)) {
        expect(r.value).not.toMatch(/NaN|undefined/)
      }
      const f = typeof l.formula === 'function' ? l.formula(p) : l.formula
      expect(f.length).toBeGreaterThan(0)
    }
  })
})
