import { GATES, cmosNand, fromBits, fullAdder, halfAdder, rippleSteps, toBits, truthTable } from './logic'

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
})
