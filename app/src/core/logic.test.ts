import {
  ALARM,
  DECODER2,
  FULL_ADDER,
  GATES,
  HALF_ADDER,
  MAJORITY,
  MUX2,
  PARITY,
  cmosNand,
  evalNet,
  fromBits,
  fullAdder,
  halfAdder,
  mux,
  netDepth,
  netSteps,
  netTable,
  oneHot,
  rippleSteps,
  toBits,
  truthTable,
} from './logic'

describe('logic', () => {
  it('truth tables match the gate definitions', () => {
    const outs = (g: keyof typeof GATES) => truthTable(g).map((r) => r.out)
    expect(outs('AND')).toEqual([0, 0, 0, 1])
    expect(outs('OR')).toEqual([0, 1, 1, 1])
    expect(outs('NAND')).toEqual([1, 1, 1, 0])
    expect(outs('NOR')).toEqual([1, 0, 0, 0])
    expect(outs('XOR')).toEqual([0, 1, 1, 0])
    expect(outs('XNOR')).toEqual([1, 0, 0, 1])
    expect(truthTable('NOT')).toEqual([{ a: 0, b: 0, out: 1 }, { a: 1, b: 0, out: 0 }])
  })

  it('CMOS NAND connects the output to exactly one rail', () => {
    for (const { a, b, out } of truthTable('NAND')) {
      const s = cmosNand(a, b)
      expect(s.out).toBe(out)
      expect(s.toVdd).not.toBe(s.toGnd)
    }
    expect(cmosNand(1, 0)).toEqual({ pmos: [false, true], nmos: [true, false], toVdd: true, toGnd: false, out: 1 })
  })

  it('adds bits', () => {
    expect(halfAdder(1, 1)).toEqual({ sum: 0, carry: 1 })
    expect(fullAdder(1, 1, 1)).toEqual({ sum: 1, carry: 1 })
    expect(fullAdder(1, 0, 0)).toEqual({ sum: 1, carry: 0 })
    expect(toBits(6, 4)).toEqual([0, 1, 1, 0])
    expect(fromBits(toBits(13, 4))).toBe(13)
  })

  it('a ripple adder settles to the exact sum after one delay per bit', () => {
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) expect(rippleSteps(a, b, 4).at(-1)!.value).toBe(a + b)
    const wave = rippleSteps(15, 1, 4)
    expect(wave.map((s) => s.value)).toEqual([14, 12, 8, 0, 16])
    expect(wave.map((s) => s.carries[4])).toEqual([0, 0, 0, 0, 1])
    expect(rippleSteps(5, 2, 4).map((s) => s.value)).toEqual([7, 7, 7, 7, 7])
  })

  it('gate networks match their functions for every input', () => {
    const abc = ['A', 'B', 'C']
    expect(netTable(MAJORITY, abc, 4).map((r) => r.out)).toEqual([0, 0, 0, 1, 0, 1, 1, 1])
    expect(netTable(PARITY, abc, 1).map((r) => r.out)).toEqual([0, 1, 1, 0, 1, 0, 0, 1])
    expect(netTable(ALARM, abc, 1).map((r) => r.out)).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
    for (const { ins, out } of netTable(MUX2, ['S', 'D1', 'D0'], 3)) expect(out).toBe(mux([ins.D0, ins.D1], ins.S))
    for (let a = 0; a < 4; a++) expect(evalNet(DECODER2, { A1: toBits(a, 2)[1], A0: toBits(a, 2)[0] }).slice(2)).toEqual(oneHot(a, 2))
    for (const { ins } of netTable(FULL_ADDER, abc, 1)) {
      const v = evalNet(FULL_ADDER, ins)
      expect({ sum: v[1], carry: v[4] }).toEqual(fullAdder(ins.A, ins.B, ins.C))
      const h = evalNet(HALF_ADDER, ins)
      expect({ sum: h[0], carry: h[1] }).toEqual(halfAdder(ins.A, ins.B))
    }
  })

  it('signals settle one gate delay per level, glitching on the way', () => {
    expect([MAJORITY, PARITY, MUX2, DECODER2, HALF_ADDER, FULL_ADDER].map(netDepth)).toEqual([3, 2, 3, 2, 1, 3])
    const from = evalNet(MUX2, { S: 1, D0: 1, D1: 1 })
    const steps = netSteps(MUX2, { S: 0, D0: 1, D1: 1 }, from)
    expect(steps.map((s) => s[3])).toEqual([1, 1, 0, 1])
    expect(steps.at(-1)).toEqual(evalNet(MUX2, { S: 0, D0: 1, D1: 1 }))
    expect(netSteps(PARITY, { A: 1, B: 0, C: 0 }, evalNet(PARITY, { A: 1, B: 0, C: 0 }))).toHaveLength(1)
  })
})
