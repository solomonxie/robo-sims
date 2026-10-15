import { fsmRun } from '../../fsm'
import { BB, BB_PORTS, BbFrame, FETCH, FETCH_FSM, FetchFrame, bbAge, bbRun, fetchRun } from './fetchbot'

describe('fetch robot', () => {
  const end = (f: FetchFrame[]) => f[f.length - 1]

  it('delivers on a full battery either way', () => {
    for (const r of [false, true]) {
      const e = end(fetchRun(r, 100, 'ok'))
      expect(e.root).toBe('success')
      expect(e.cup).toBe('table')
    }
  })

  it('a memory sequence never re-checks the battery; a reactive one goes to charge', () => {
    const mem = fetchRun(false, 35, 'ok')
    expect(end(mem).dead).toBe(true)
    expect(mem.some((f) => f.doing === 'GoCharge')).toBe(false)
    const re = fetchRun(true, 35, 'ok')
    expect(re.some((f) => f.charging)).toBe(true)
    expect(end(re).cup).toBe('table')
    expect(Math.min(...re.map((f) => f.battery))).toBeGreaterThan(0)
  })

  it('retries a slipping grasp, asks for help when the cup is missing', () => {
    const slip = fetchRun(true, 100, 'slip')
    expect(end(slip).tries).toBe(FETCH.tries)
    expect(end(slip).cup).toBe('table')
    const gone = fetchRun(true, 100, 'missing')
    expect(end(gone).root).toBe('success')
    expect(gone.some((f) => f.doing === 'AskForHelp')).toBe(true)
    expect(end(gone).tries).toBe(FETCH.tries)
  })

  it('as an FSM the battery needs an edge into and out of every task state', () => {
    expect(FETCH_FSM.edges.filter((e) => e.from === 'CHARGE' || e.to === 'CHARGE')).toHaveLength(8)
    const r = fsmRun(FETCH_FSM, [
      { done: false, low: true, full: false, was: 'GRASP' },
      { done: false, low: false, full: true, was: 'GRASP' },
    ], 'GRASP')
    expect(r.map((q) => q.state)).toEqual(['CHARGE', 'GRASP'])
  })
})

describe('blackboard', () => {
  const end = (f: BbFrame[]) => f[f.length - 1]

  it('fetches when the cup stays put', () => {
    const f = bbRun(false, Infinity)
    expect(end(f).root).toBe('success')
    expect(end(f).bb.holding.v).toBe(false)
    expect(end(f).cup).toEqual(FETCH.table)
  })

  it('a stale cup_pose sends the grasp to where the cup used to be', () => {
    const f = bbRun(true, Infinity)
    expect(end(f).root).toBe('failure')
    expect(end(f).bb.cup_pose.v).toEqual(BB.from)
    expect(end(f).doing === 'Grasp' || f.some((q) => q.note.includes('air'))).toBe(true)
  })

  it('a max_age port re-runs DetectCup and follows the moved cup', () => {
    const f = bbRun(true, 2)
    expect(end(f).root).toBe('success')
    expect(f.filter((q) => Object.values(q.io).includes('w') && q.io[BB_PORTS.findIndex((p) => p.node === 'DetectCup' && p.key === 'cup_pose')] === 'w').length).toBeGreaterThan(2)
    expect(bbAge(end(f).bb, 'table_pose', end(f).t)).toBe(end(f).t)
  })
})
