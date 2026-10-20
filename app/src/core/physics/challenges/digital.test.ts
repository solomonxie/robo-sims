import { medianMs } from '../../stopwatch'
import { COUNTER_CLOCKS, COUNTER_GOALS, CounterGoal, D_LOGIC, DLogic, GATE_GOALS, GateGoal, counterChallenge, gateBest, gateChallenge, gateChips, liveGates, rowSteps } from './digital'

describe('Build XOR', () => {
  it('four NANDs in the classic shape are XOR on one 74HC00; an AND last gives XNOR', () => {
    const s = gateChallenge('xorNand', ['NAND', 'NAND', 'NAND', 'NAND', 'WIRE'])
    expect(s.verdict).toEqual({ pass: true, near: false, fail: null })
    expect(s.chips).toEqual([{ part: '74HC00', chips: 1 }])
    expect(s.depth).toBe(3)
    expect(s.settleS).toBeCloseTo(24e-9)
    const wrong = gateChallenge('xorNand', ['NAND', 'NAND', 'NAND', 'AND', 'WIRE'])
    expect(wrong.verdict.fail).toBe('kit')
    expect(gateChallenge('xorAny', ['NAND', 'NAND', 'NAND', 'AND', 'WIRE']).right).toBe(0)
  })
  it('wire slots collapse and dead gates drop', () => {
    const l = liveGates(['NAND', 'NAND', 'NAND', 'WIRE', 'NAND'])
    expect(l.net.length).toBe(3)
    expect(l.slot).toEqual([0, 1, 4])
    expect(l.net[2].in).toEqual([1, 1])
    expect(gateChips(liveGates(['XOR', 'WIRE', 'WIRE', 'WIRE', 'WIRE']).net)).toEqual([{ part: '74HC86', chips: 1 }])
  })
  it('fewest gates per goal: XOR 4 NANDs / 5 NORs / 1 any; XNOR 5 NANDs; interlock 3 NANDs / 2 any', () => {
    const want: Record<GateGoal, number> = { xorNand: 4, xorNor: 5, xnorNand: 5, lockNand: 3, xorAny: 1, lockAny: 2 }
    for (const g of Object.keys(GATE_GOALS) as GateGoal[]) {
      const b = gateBest(g)
      expect([g, b.gates]).toEqual([g, want[g]])
      expect(gateChallenge(g, b.slots).verdict.pass).toBe(true)
    }
  })
  it('order: off-kit, then rows (3 of 4 close), then extra gates (close)', () => {
    expect(gateChallenge('lockNand', ['NAND', 'NAND', 'NAND', 'NAND', 'WIRE']).verdict).toEqual({ pass: false, near: true, fail: 'table' })
    expect(gateChallenge('lockNand', ['NAND', 'NAND', 'NAND', 'NAND', 'NAND']).verdict).toEqual({ pass: false, near: false, fail: 'table' })
    const extra = gateChallenge('xnorNand', ['NAND', 'NAND', 'NAND', 'NAND', 'NAND'])
    expect(extra.verdict.pass).toBe(true)
    const near = gateChallenge('xorAny', ['OR', 'WIRE', 'WIRE', 'WIRE', 'WIRE'])
    expect(near.right).toBe(3)
    expect(near.verdict).toEqual({ pass: false, near: true, fail: 'table' })
    const fat = gateChallenge('xorAny', ['NAND', 'NAND', 'NAND', 'NAND', 'WIRE'])
    expect(fat.verdict).toEqual({ pass: false, near: true, fail: 'gates' })
  })
  it('NAND XOR glitches when both inputs rise at once (00 → 11)', () => {
    const l = liveGates(['NAND', 'NAND', 'NAND', 'NAND', 'WIRE'])
    const s = rowSteps(l.net, l.out, 0, 3)
    expect(s[0]).toBe(0)
    expect(s.at(-1)).toBe(0)
    expect(s).toContain(1)
    expect(gateChallenge('xorNand', ['NAND', 'NAND', 'NAND', 'NAND', 'WIRE']).glitches).toBeGreaterThan(0)
    expect(gateChallenge('xorAny', ['XOR', 'WIRE', 'WIRE', 'WIRE', 'WIRE']).glitches).toBe(0)
  })
  it('best search is fast once cached', () => {
    expect(medianMs(() => gateChallenge('xorNor', ['NOR', 'NOR', 'NOR', 'NOR', 'NOR']))).toBeLessThan(5)
  })
})

describe('Design a 2-bit counter', () => {
  const answers: Record<CounterGoal, [DLogic, DLogic]> = { up: ['nq0', 'xor'], down: ['nq0', 'xnor'], gray: ['nq1', 'q0'] }
  it('D0 = Q̄0, D1 = Q1 ⊕ Q0 counts up; XNOR counts down; D0 = Q̄1, D1 = Q0 is Gray', () => {
    for (const g of Object.keys(COUNTER_GOALS) as CounterGoal[]) {
      const s = counterChallenge(g, ...answers[g], 1)
      expect(s.verdict.pass).toBe(true)
      expect(s.run.slice(0, 5)).toEqual([...COUNTER_GOALS[g].seq, 0])
    }
  })
  it('exactly one D pattern solves each goal', () => {
    const ds = Object.keys(D_LOGIC) as DLogic[]
    for (const g of Object.keys(COUNTER_GOALS) as CounterGoal[]) expect(ds.flatMap((a) => ds.filter((b) => counterChallenge(g, a, b, 1).verdict.pass)).length).toBe(1)
  })
  it('one bit right is close; a stuck D0 = Q0 never leaves 00', () => {
    const s = counterChallenge('up', 'q0', 'xor', 1)
    expect(s.verdict).toEqual({ pass: false, near: true, fail: 'sequence' })
    expect(s.run.slice(0, 3)).toEqual([0, 0, 0])
    expect(counterChallenge('up', 'q0', 'and', 1).verdict.near).toBe(false)
  })
  it('74HC timing: a gate path (32 ns) fails at 40 MHz, a wire path (24 ns) passes; f max 31 / 42 MHz', () => {
    const up = counterChallenge('up', 'nq0', 'xor', COUNTER_CLOCKS['4e7'])
    expect(up.needS).toBeCloseTo(32e-9)
    expect(up.fMax).toBeCloseTo(31.25e6, -3)
    expect(up.verdict).toEqual({ pass: false, near: true, fail: 'timing' })
    expect(counterChallenge('up', 'nq0', 'xor', COUNTER_CLOCKS['2.5e7']).verdict.pass).toBe(true)
    expect(counterChallenge('up', 'nq0', 'xor', COUNTER_CLOCKS['5e7']).verdict).toEqual({ pass: false, near: false, fail: 'timing' })
    const wires = counterChallenge('gray', 'q1', 'q0', COUNTER_CLOCKS['4e7'])
    expect(wires.stages).toBe(0)
    expect(wires.slack).toBeCloseTo(1e-9)
  })
})
