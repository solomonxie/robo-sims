import { FaultHunt, caseFaults, decisiveProbe, faultTable, huntVerdict, probesNeeded, ruledOutBy, sameReading, stillSuspect } from './hunt'

type F = 'a' | 'b' | 'c'
type P = 'x' | 'y'
const V = (value: number) => ({ value, unit: 'V' as const })
const TABLE: Record<F | 'ok', Record<P, number>> = { ok: { x: 5, y: 3.3 }, a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 5.05, y: 0 } }
const H: FaultHunt<F, P> = { faults: ['a', 'b', 'c'], probes: ['x', 'y'], read: (f, p) => V(TABLE[f][p]) }

describe('fault hunt', () => {
  it('readings within a meter’s tolerance are the same; units, OL, flicker, label, hold and log lines tell apart', () => {
    expect(sameReading(V(5), V(5.1))).toBe(true)
    expect(sameReading(V(5), V(4))).toBe(false)
    expect(sameReading(V(5), { value: 5, unit: 'A' })).toBe(false)
    expect(sameReading({ value: 0, unit: 'Ω', open: true }, { value: 0.1, unit: 'Ω' })).toBe(false)
    expect(sameReading(V(4.5), { ...V(4.5), alt: 8 })).toBe(false)
    expect(sameReading({ value: 150, unit: '°C', label: 'buck' }, { value: 150, unit: '°C', label: 'LDO' })).toBe(false)
    expect(sameReading({ ...V(2.2), hold: 'min' }, V(2.2))).toBe(false)
    expect(sameReading({ value: 0, unit: 'log', label: 'BROWNOUT' }, { value: 3, unit: 'log', label: 'BROWNOUT' })).toBe(true)
    expect(sameReading({ value: 0, unit: 'log', label: 'BROWNOUT' }, { value: 0, unit: 'log', label: 'PANIC' })).toBe(false)
  })
  it('table, ruled-out suspects, the probe that splits two, and the shortest probe list', () => {
    expect(faultTable(H).ok.y.value).toBe(3.3)
    expect(ruledOutBy(H, 'b', 'x')).toEqual(['a'])
    expect(stillSuspect(H, 'b', ['x', 'y'])).toEqual(['b', 'c'])
    expect(decisiveProbe(H, 'a', 'b')).toBe('x')
    expect(decisiveProbe(H, 'b', 'c')).toBeNull()
    expect(probesNeeded(H, 'a')).toEqual(['x'])
  })
  it('cases: a seeded shuffle, every suspect once, repeatable', () => {
    const c = caseFaults(['a', 'b', 'c', 'd', 'e'], 7)
    expect([...c].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(caseFaults(['a', 'b', 'c', 'd', 'e'], 7)).toEqual(c)
  })
  it('verdict: no diagnosis yet is a near miss, wrong fails, right passes', () => {
    expect(huntVerdict('a', null)).toEqual({ pass: false, near: true, fail: 'probe' })
    expect(huntVerdict('a', 'b')).toEqual({ pass: false, near: false, fail: 'wrong' })
    expect(huntVerdict('a', 'a').pass).toBe(true)
  })
})
