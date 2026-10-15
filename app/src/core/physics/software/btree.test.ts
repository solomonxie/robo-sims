import { BtLeaf, BtNode, BtStatus, CORRIDOR, NAV_TREE, btMemory, btNavRun, btRows, btTick } from './btree'

const leaves = (r: Record<string, BtStatus>) => (l: BtLeaf) => r[l.id]
const a = (id: string): BtNode => ({ id, kind: 'action', act: id })

describe('behaviour tree tick', () => {
  it('sequence stops at the first failure, resumes a running child', () => {
    const seq: BtNode = { id: 's', kind: 'sequence', kids: [a('a'), a('b'), a('c')] }
    const m = btMemory()
    expect(btTick(seq, m, leaves({ a: 'success', b: 'running', c: 'success' }), 0)).toBe('running')
    const calls: string[] = []
    expect(btTick(seq, m, (l) => {
      calls.push(l.id)
      return 'success'
    }, 1)).toBe('success')
    expect(calls).toEqual(['b', 'c'])
    expect(btTick(seq, m, leaves({ a: 'failure', b: 'success', c: 'success' }), 2)).toBe('failure')
  })

  it('recovery node retries after a successful recovery, then gives up', () => {
    const rec: BtNode = { id: 'r', kind: 'recovery', retries: 2, kids: [a('main'), a('fix')] }
    const m = btMemory()
    let n = 0
    expect(btTick(rec, m, (l) => {
      if (l.id !== 'main') return 'success'
      n++
      return 'failure'
    }, 0)).toBe('failure')
    expect(n).toBe(3)
    expect(btTick(rec, btMemory(), leaves({ main: 'failure', fix: 'failure' }), 0)).toBe('failure')
  })

  it('round robin moves on to the next child each time', () => {
    const rr: BtNode = { id: 'rr', kind: 'roundRobin', kids: [a('x'), a('y'), a('z')] }
    const m = btMemory()
    const seen: string[] = []
    for (let i = 0; i < 4; i++) btTick(rr, m, (l) => {
      seen.push(l.id)
      return 'success'
    }, i)
    expect(seen).toEqual(['x', 'y', 'z', 'x'])
    expect(btTick(rr, btMemory(), () => 'failure', 0)).toBe('failure')
  })

  it('rate controller re-ticks its child once per period', () => {
    const rc: BtNode = { id: 'rc', kind: 'rate', hz: 1, kids: [a('plan')] }
    const m = btMemory()
    let n = 0
    for (let t = 0; t < 2.95; t += 0.1) btTick(rc, m, () => {
      n++
      return 'success'
    }, t)
    expect(n).toBe(3)
  })

  it('lists the Nav2 tree depth first', () => {
    const rows = btRows(NAV_TREE)
    expect(rows[0].node.id).toBe('NavigateRecovery')
    expect(rows.find((r) => r.node.id === 'Spin')!.depth).toBe(3)
    expect(rows.length).toBe(18)
  })
})

describe('navigate tree in a corridor', () => {
  it('drives straight to the goal when nobody stops it', () => {
    const f = btNavRun(0)
    expect(f[f.length - 1].root).toBe('success')
    expect(f[f.length - 1].x).toBeCloseTo(CORRIDOR.goalX)
  })

  it('runs recoveries in turn, then succeeds once the way clears', () => {
    const f = btNavRun(4)
    const did = new Set(f.map((q) => q.doing))
    expect(did.has('Spin')).toBe(true)
    expect(did.has('Wait')).toBe(true)
    expect(f[f.length - 1].root).toBe('success')
  })

  it('aborts after six retries if blocked for good', () => {
    const f = btNavRun(Infinity)
    expect(f[f.length - 1].root).toBe('failure')
    expect(new Set(f.map((q) => q.doing)).has('BackUp')).toBe(true)
    expect(f[f.length - 1].retries).toBe(6)
  })
})
