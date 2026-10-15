import { CAN_TERM, canArbitrate, canCrc15, canDominantDiff, canFrame, canLink, canLoad, canStuff, canTau, idBits } from './can'

const BITS = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]
const link = (terms: number, noiseV: number) => canLink(BITS, { terms, nodes: 4, meters: 4, noiseV, baud: 500e3 })

describe('levels and terminations', () => {
  it('two 120 Ω ends load the pair with ~60 Ω and give ~2 V dominant', () => {
    expect(canLoad(2, 0)).toBeCloseTo(CAN_TERM / 2)
    expect(canDominantDiff(2, 4)).toBeCloseTo(2, 1)
  })
  it('without terminators the recessive edge is slower than a 500 kbit/s bit', () => {
    expect(canTau(0, 4, 4).rec).toBeGreaterThan(2e-6)
    expect(canTau(2, 4, 4).rec).toBeLessThan(0.1e-6)
  })
  it('reads cleanly with both ends terminated', () => {
    const r = link(2, 0)
    expect(r.read).toEqual(BITS)
    expect(r.errors).toBe(0)
  })
  it('loses recessive bits with no termination', () => {
    expect(link(0, 0).errors).toBeGreaterThan(0)
  })
  it('rejects common-mode noise that breaks a single-ended read', () => {
    const r = link(2, 3)
    expect(r.errors).toBe(0)
    expect(r.singleErrors).toBeGreaterThan(0)
    expect(r.inRange).toBe(true)
  })
  it('noise moves CANH and CANL together', () => {
    const r = link(2, 3)
    r.h.forEach((h, i) => expect(h - r.l[i]).toBeCloseTo(r.diff[i], 0))
  })
})

describe('arbitration', () => {
  it('lowest ID wins and losers drop out at their first recessive-vs-dominant bit', () => {
    const a = canArbitrate([0x124, 0x121, 0x130])
    expect(a.winner).toBe(1)
    expect(a.lostAt).toEqual([8, -1, 6])
    expect(a.bus).toEqual(idBits(0x121))
    expect(a.tie).toBe(false)
  })
  it('flags two nodes with the same ID', () => {
    expect(canArbitrate([0x121, 0x121]).tie).toBe(true)
  })
})

describe('frame', () => {
  it('CRC-15 of the frame plus its CRC leaves no remainder', () => {
    const bits = [0, ...idBits(0x121), 0, 0, 0, ...idBits(2, 4), ...idBits(0x01, 8), ...idBits(0xf4, 8)]
    expect(canCrc15([...bits, ...idBits(canCrc15(bits), 15)])).toBe(0)
    expect(canCrc15([0, 0, 0])).toBe(0)
  })
  it('stuffs an opposite bit after five equal ones', () => {
    const s = canStuff([0, 0, 0, 0, 0, 0, 1])
    expect(s.bits).toEqual([0, 0, 0, 0, 0, 1, 0, 1])
    expect(s.stuffAt).toEqual([5])
    expect(s.pos).toEqual([0, 1, 2, 3, 4, 6, 7])
  })
  it('lays out fields in order with the ACK slot dominant on the bus only', () => {
    const f = canFrame(0x121, [0x01, 0xf4])
    expect(f.fields.map((x) => x.field)).toEqual(['SOF', 'ID', 'CTRL', 'DLC', 'DATA', 'DATA', 'CRC', 'CRC DEL', 'ACK', 'ACK DEL', 'EOF'])
    f.fields.slice(1).forEach((x, i) => expect(x.start).toBe(f.fields[i].start + f.fields[i].len))
    const ack = f.fields[8].start
    expect([f.bus[ack], f.tx[ack]]).toEqual([0, 1])
    expect(f.bus.length).toBe(f.rawBits + f.stuffAt.length)
    expect(f.rawBits).toBe(1 + 11 + 3 + 4 + 16 + 15 + 10)
  })
  it('never leaves six equal bits before the CRC delimiter', () => {
    const f = canFrame(0x000, [0x00, 0x00])
    const end = f.fields[7].start
    for (let i = 0; i + 6 <= end; i++) expect(new Set(f.bus.slice(i, i + 6)).size).toBe(2)
  })
})
