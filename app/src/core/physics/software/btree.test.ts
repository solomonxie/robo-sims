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

describe('generic nodes and decorators', () => {
  it('fallback returns the first success and resumes a running child', () => {
    const fb: BtNode = { id: 'f', kind: 'fallback', kids: [a('a'), a('b'), a('c')] }
    const m = btMemory()
    expect(btTick(fb, m, leaves({ a: 'failure', b: 'running', c: 'success' }), 0)).toBe('running')
    const ticked: string[] = []
    expect(btTick(fb, m, (l) => {
      ticked.push(l.id)
      return l.id === 'b' ? 'success' : 'failure'
    }, 1)).toBe('success')
    expect(ticked).toEqual(['b'])
    expect(btTick(fb, btMemory(), () => 'failure', 0)).toBe('failure')
  })

  it('reactive sequence re-checks earlier children every tick', () => {
    const rs: BtNode = { id: 'r', kind: 'reactiveSequence', kids: [a('ok'), a('work')] }
    const m = btMemory()
    const ticked: string[] = []
    const leaf = (l: BtLeaf): BtStatus => {
      ticked.push(l.id)
      return l.id === 'ok' ? 'success' : 'running'
    }
    btTick(rs, m, leaf, 0)
    btTick(rs, m, leaf, 1)
    expect(ticked).toEqual(['ok', 'work', 'ok', 'work'])
    expect(btTick(rs, m, leaves({ ok: 'failure', work: 'running' }), 2)).toBe('failure')
  })

  it('inverter flips, retry re-runs a failing child, timeout fails a slow one', () => {
    expect(btTick({ id: 'i', kind: 'inverter', kids: [a('x')] }, btMemory(), () => 'failure', 0)).toBe('success')
    const rt: BtNode = { id: 'r', kind: 'retry', tries: 3, kids: [a('x')] }
    const m = btMemory()
    const got = [0, 1, 2].map((t) => btTick(rt, m, () => 'failure', t))
    expect(got).toEqual(['running', 'running', 'failure'])
    const to: BtNode = { id: 't', kind: 'timeout', sec: 2, kids: [a('x')] }
    const m2 = btMemory()
    expect(btTick(to, m2, () => 'running', 0)).toBe('running')
    expect(btTick(to, m2, () => 'running', 1.9)).toBe('running')
    expect(btTick(to, m2, () => 'running', 2)).toBe('failure')
  })
})
