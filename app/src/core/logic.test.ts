import {
  ALARM,
  Bit,
  DECODER2,
  D_FLIP_FLOP,
  D_LATCH,
  FULL_ADDER,
  GATES,
  HALF_ADDER,
  MAJORITY,
  MUX2,
  PARITY,
  REGISTER_BIT,
  SR_LATCH,
  cmosNand,
  counterRipple,
  evalNet,
  fromBits,
  fullAdder,
  halfAdder,
  mux,
  netDepth,
  netRun,
  netSettle,
  netSteps,
  netTable,
  oneHot,
  rippleSteps,
  shiftIn,
  shiftOutSteps,
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

  it('feedback holds a bit: SR latch sets, holds, resets; S = R = 1 then release races', () => {
    const sr = (S: Bit, R: Bit) => ({ S, R })
    const q = netRun(SR_LATCH, [sr(1, 0), sr(0, 0), sr(0, 1), sr(0, 0)], [0, 1]).map((s) => s[0])
    expect(q).toEqual([1, 1, 0, 0])
    expect(evalNet(SR_LATCH, sr(0, 0), [1, 0])).toEqual([1, 0])
    expect(evalNet(SR_LATCH, sr(0, 0), [0, 1])).toEqual([0, 1])
    const both = netSettle(SR_LATCH, sr(1, 1), [1, 0])
    expect(both).toEqual({ state: [0, 0], stable: true })
    expect(netSettle(SR_LATCH, sr(0, 0), both.state).stable).toBe(false)
  })

  it('a D latch is transparent while enabled; a flip-flop samples D only on the rising clock edge', () => {
    const lat = netRun(D_LATCH, [{ D: 1, E: 1 }, { D: 0, E: 1 }, { D: 1, E: 0 }], [0, 1, 1, 0, 1])
    expect(lat.map((s) => s[3])).toEqual([1, 0, 0])
    const ff = (D: Bit, CLK: Bit) => ({ D, CLK })
    const start = netRun(D_FLIP_FLOP, [ff(0, 1), ff(0, 0)], evalNet(D_FLIP_FLOP, ff(0, 0)))[1]
    const seq = [ff(1, 0), ff(1, 1), ff(0, 1), ff(0, 0), ff(1, 0), ff(0, 0), ff(0, 1)]
    expect(netRun(D_FLIP_FLOP, seq, start).map((s) => s[8])).toEqual([0, 1, 1, 1, 1, 1, 0])
    expect(netRun(D_FLIP_FLOP, seq, start).every((s) => s[8] !== s[9])).toBe(true)
  })

  it('a register bit loads on the edge only while LOAD = 1', () => {
    const r = (D: Bit, LOAD: Bit, CLK: Bit) => ({ D, LOAD, CLK })
    const start = netRun(REGISTER_BIT, [r(0, 1, 1), r(0, 1, 0)], evalNet(REGISTER_BIT, r(0, 1, 0)))[1]
    const seq = [r(1, 1, 0), r(1, 1, 1), r(0, 0, 0), r(0, 0, 1), r(0, 1, 0), r(0, 1, 1)]
    expect(netRun(REGISTER_BIT, seq, start).map((s) => s[12])).toEqual([0, 1, 1, 1, 1, 0])
  })

  it('a shift register moves every bit up one place per edge', () => {
    expect(shiftIn(0b1011, 1, 4)).toBe(0b0111)
    expect([1, 0, 0, 0, 0].reduce((r, b) => shiftIn(r, b as Bit, 4), 0)).toBe(0b0000)
    expect([1, 0, 0].reduce((r, b) => shiftIn(r, b as Bit, 4), 0)).toBe(0b0100)
  })

  it('a ripple counter passes through wrong counts before it settles', () => {
    expect(counterRipple(0, 4)).toEqual([1])
    expect(counterRipple(1, 4)).toEqual([0, 2])
    expect(counterRipple(7, 4)).toEqual([6, 4, 0, 8])
    expect(counterRipple(15, 4)).toEqual([14, 12, 8, 0])
  })

  it('74HC595: eight SRCLK edges load a byte MSB first, outputs change only on RCLK', () => {
    const steps = shiftOutSteps({ shift: 0x0f, latch: 0x0f }, 0xa5)
    expect(steps.map((x) => x.ser)).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 0])
    expect(steps[0].s).toEqual({ shift: 0x1f, latch: 0x0f })
    expect(steps[7].s).toEqual({ shift: 0xa5, latch: 0x0f })
    expect(steps.slice(0, 8).every((x) => x.s.latch === 0x0f)).toBe(true)
    expect(steps[8].s).toEqual({ shift: 0xa5, latch: 0xa5 })
  })
})
