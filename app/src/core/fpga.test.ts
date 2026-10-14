import {
  LUT3,
  bitstream,
  bitstreamLength,
  configLoad,
  counterDesign,
  fabricRun,
  ledPeriod,
  loadBitstream,
  lutEval,
  lutTable,
  muxPath,
  muxTree,
  ringDesign,
} from './fpga'
import { Bit, fromBits, toBits } from './logic'

describe('fpga', () => {
  it('a LUT returns the SRAM bit its inputs address', () => {
    expect(lutTable(3, LUT3.and.fn)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(lutTable(3, LUT3.or.fn)).toEqual([0, 1, 1, 1, 1, 1, 1, 1])
    expect(lutTable(3, LUT3.xor.fn)).toEqual([0, 1, 1, 0, 1, 0, 0, 1])
    expect(lutTable(3, LUT3.maj.fn)).toEqual([0, 0, 0, 1, 0, 1, 1, 1])
    const t: Bit[] = [0, 0, 0, 0, 0, 1, 0, 0]
    expect(lutEval(t, [1, 0, 1])).toBe(1)
    expect(lutEval(t, [1, 1, 0])).toBe(0)
  })

  it('the mux tree halves each level and follows the address', () => {
    const t = lutTable(3, LUT3.maj.fn)
    const lv = muxTree(t, [1, 1, 0])
    expect(lv.map((l) => l.length)).toEqual([8, 4, 2, 1])
    expect(lv[3][0]).toBe(lutEval(t, [1, 1, 0]))
    expect(muxPath([1, 1, 0])).toEqual([3, 1, 0, 0])
    for (let a = 0; a < 8; a++) {
      const ins = toBits(a, 3)
      expect(muxPath(ins).every((s, l) => muxTree(t, ins)[l][s] === t[a])).toBe(true)
    }
  })

  it('the config chain shifts the new bits in from cell 0', () => {
    const old: Bit[] = [0, 0, 0, 0]
    const next: Bit[] = [1, 0, 1, 1]
    expect(configLoad(old, next, 0)).toEqual(old)
    expect(configLoad(old, next, 1)).toEqual([1, 0, 0, 0])
    expect(configLoad(old, next, 2)).toEqual([1, 1, 0, 0])
    expect(configLoad(old, next, 4)).toEqual(next)
  })

  it('a counter design counts and a ring design rotates', () => {
    expect(fabricRun(counterDesign(4, 3), 17).map(fromBits)).toEqual([...Array(16).keys(), 0, 1])
    expect(fabricRun(ringDesign(4, 0), 4).map(fromBits)).toEqual([1, 2, 4, 8, 1])
  })

  it('the bitstream round-trips the design', () => {
    for (const d of [counterDesign(4, 2), ringDesign(4, 1)]) {
      const bits = bitstream(d)
      expect(bits).toHaveLength(bitstreamLength(4))
      expect(loadBitstream(bits, 4)).toEqual(d)
    }
    expect(bitstreamLength(4)).toBe(136)
  })

  it('the LED blinks at the routed bit’s period', () => {
    expect([0, 1, 2, 3].map((k) => ledPeriod(counterDesign(4, k)))).toEqual([2, 4, 8, 16])
    expect(ledPeriod(ringDesign(4, 2))).toBe(4)
  })
})
