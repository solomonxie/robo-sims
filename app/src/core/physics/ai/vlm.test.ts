import { RUN, VLM_OBJS, cosSim, embedText, groundRef, planTask, runPlan, seeDesk, topDownQ } from './vlm'

const sights = seeDesk(VLM_OBJS, 0)
const plan = (c: string) => planTask(c, VLM_OBJS, sights)

describe('toy grounding', () => {
  it('embeddings are unit vectors; unknown words are dropped', () => {
    sights.forEach((s) => expect(cosSim(s.emb, s.emb)).toBeCloseTo(1, 6))
    const t = embedText('the purple mug')
    expect(t.known).toEqual(['mug'])
    expect(t.unknown).toEqual(['purple'])
  })
  it('two red cups → ask; a relation picks one; whose left matters', () => {
    expect(groundRef('the red cup', sights).verdict).toBe('ask')
    const g = groundRef('the red cup left of the block', sights)
    expect([g.verdict, g.best]).toEqual(['go', 0])
    expect(groundRef('the red cup left of the block', sights, 'facing').best).toBe(1)
  })
  it('missing object → none; unique object → go', () => {
    expect(groundRef('the green cup', sights).verdict).toBe('none')
    expect(groundRef('the yellow ball', sights).best).toBe(5)
    expect(groundRef('the purple mug', sights).verdict).toBe('ask')
  })
  it('a warm lamp shrinks the colour margin', () => {
    const warm = groundRef('the red cup left of the block', seeDesk(VLM_OBJS, 1))
    expect(warm.verdict).not.toBe('go')
    expect(warm.prob[2]).toBeGreaterThan(0.2)
  })
})

describe('toy task planning', () => {
  it('template → find, pick, place', () => {
    const p = plan('Put the red cup left of the block in the tray')
    expect(p.steps.map((s) => s.op)).toEqual(['find', 'pick', 'place'])
    expect(p.issues).toEqual([])
    expect(plan('Put both blocks in the bin').steps).toHaveLength(6)
  })
  it('checks catch ambiguity and reach before moving', () => {
    expect(plan('Put the red cup in the tray').issues[0].why).toMatch(/ask/)
    expect(plan('Put the blue ball in the bin').issues[0].why).toMatch(/reach/)
    expect(topDownQ([0.3, -0.09, 0.02])).toBeNull()
  })
  it('runs reach the goal; surprises need replanning', () => {
    const p = plan('Stack the green block on the blue block')
    const r = runPlan(p, VLM_OBJS, 'none', true)
    expect(r.ok).toBe(true)
    expect(r.frames.every((f) => topDownQ(f.hand) !== null)).toBe(true)
    expect(r.frames[1].t - r.frames[0].t).toBeCloseTo(RUN.dt)
    for (const s of ['slip', 'moved'] as const) {
      expect(runPlan(p, VLM_OBJS, s, false).ok).toBe(false)
      const fix = runPlan(p, VLM_OBJS, s, true)
      expect([fix.ok, fix.replans]).toEqual([true, 1])
      expect(fix.log.some((l) => l.status === 'redo')).toBe(true)
    }
    expect(runPlan(plan('Put both blocks in the bin'), VLM_OBJS, 'none', true).ok).toBe(true)
  })
})

describe('toy planner reach', () => {
  it('every hand point of every task run is a valid top-down pose', () => {
    for (const c of ['Put the red cup left of the block in the tray', 'Put both blocks in the bin', 'Stack the green block on the blue block'])
      for (const s of ['none', 'slip', 'moved'] as const) expect(runPlan(plan(c), VLM_OBJS, s, true).frames.every((f) => topDownQ(f.hand) !== null)).toBe(true)
  })
})
