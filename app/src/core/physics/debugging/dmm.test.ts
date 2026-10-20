import { Element } from '../../nodal'
import { DIODES, diodeNode } from '../semiconductors'
import { FUSES, fuseMeltTime } from '../protection'
import { DMM, MeterNet, diodeNetSolve, dmmMistake, dmmRead, dmmReading, dmmText } from './dmm'

// A 9 V cell (1 Ω inside) on node 1 feeding R = 100 Ω to ground at node 2 through a 1 Ω wire; or a bare part between 1 and 0.
const live = (): MeterNet => ({ nodes: 2, elements: [{ kind: 'V', a: 1, b: 0, volts: 9 }, { kind: 'R', a: 1, b: 2, ohms: 1 }, { kind: 'R', a: 2, b: 0, ohms: 100 }] })
const part = (ohms: number): MeterNet => ({ nodes: 1, elements: [{ kind: 'R', a: 1, b: 0, ohms }] })
const diode = (): MeterNet => ({ nodes: 1, elements: [{ kind: 'R', a: 1, b: 0, ohms: 1e12 }], diodes: [{ a: 1, b: 0, d: DIODES['1N4007'] }] })
const at = (n: MeterNet) => () => n

describe('multimeter model', () => {
  it('diode nodal solve matches the single-diode bisection', () => {
    const els: Element[] = [{ kind: 'V', a: 1, b: 0, volts: 5 }, { kind: 'R', a: 1, b: 2, ohms: 220 }]
    const s = diodeNetSolve(2, els, [{ a: 2, b: 0, d: DIODES['1N4148'] }])!
    const ref = diodeNode(5, 220, DIODES['1N4148'])
    expect(s.volts[2]).toBeCloseTo(ref.v, 4)
    expect(s.diodeA[0]).toBeCloseTo(ref.diodeA, 6)
  })
  it('volts: 10 MΩ across, red minus black; mV overloads; V~ blocks DC', () => {
    expect(dmmRead({ dial: 'vdc', jack: 'v' }, at(live()), 2, 0).shown).toBeCloseTo((9 * 100) / 101, 3)
    expect(dmmRead({ dial: 'vdc', jack: 'v' }, at(live()), 0, 2).shown).toBeCloseTo((-9 * 100) / 101, 3)
    expect(dmmRead({ dial: 'mv', jack: 'v' }, at(live()), 2, 0).shown).toBeNull()
    expect(dmmRead({ dial: 'mv', jack: 'v' }, at(live()), 1, 2).shown).toBeCloseTo((9 / 101) * 1000, 1)
    expect(dmmRead({ dial: 'vac', jack: 'v' }, at(live()), 2, 0).shown).toBe(0)
  })
  it('ohms: the leads add 0.2 Ω, open reads OL, the beeper splits at 30 / 50 Ω', () => {
    expect(dmmRead({ dial: 'ohm', jack: 'v' }, at(part(1000)), 1, 0).shown).toBeCloseTo(1000.2, 3)
    expect(dmmRead({ dial: 'ohm', jack: 'v' }, at(part(1e12)), 1, 0).shown).toBeNull()
    expect(dmmRead({ dial: 'beep', jack: 'v' }, at(part(0.1)), 1, 0).beep).toBe('on')
    expect(dmmRead({ dial: 'beep', jack: 'v' }, at(part(40)), 1, 0).beep).toBe('chirp')
    expect(dmmRead({ dial: 'beep', jack: 'v' }, at(part(80)), 1, 0).beep).toBe('off')
  })
  it('ohms on a live circuit reads the circuit’s own volts, not the resistance', () => {
    const wire = dmmRead({ dial: 'ohm', jack: 'v' }, at(live()), 1, 2).shown!
    expect(wire).toBeGreaterThan(50)
  })
  it('diode test: ~0.55 V one way, OL the other', () => {
    const fwd = dmmRead({ dial: 'diode', jack: 'v' }, at(diode()), 1, 0).shown!
    expect(fwd).toBeGreaterThan(0.45)
    expect(fwd).toBeLessThan(0.65)
    expect(dmmRead({ dial: 'diode', jack: 'v' }, at(diode()), 0, 1).shown).toBeNull()
  })
  it('a current socket is a shunt on every dial: across a cell it is a short', () => {
    const r = dmmRead({ dial: 'vdc', jack: 'a10' }, at(live()), 2, 0)
    expect(r.shown).toBe(0)
    expect(r.amps).toBeCloseTo(9 / (1 + DMM.a10.ohms + DMM.leadOhms), 0)
    expect(dmmMistake('vdc', { dial: 'vdc', jack: 'a10' }, r, { live: true })).toBe('short')
  })
  it('in series: the A range reads the loop current minus a little burden; a voltmeter in series kills it', () => {
    // Gap between nodes 1 and 2: cell → gap → 100 Ω.
    const gap = (): MeterNet => ({ nodes: 2, elements: [{ kind: 'V', a: 1, b: 0, volts: 9 }, { kind: 'R', a: 2, b: 0, ohms: 100 }] })
    const a = dmmRead({ dial: 'amp', jack: 'a10' }, at(gap()), 1, 2)
    expect(a.shown).toBeCloseTo(9 / (100 + DMM.a10.ohms + DMM.leadOhms), 4)
    const ma = dmmRead({ dial: 'ma', jack: 'ma' }, at(gap()), 1, 2)
    expect(ma.burden).toBeCloseTo(ma.amps * (DMM.ma.ohms + DMM.leadOhms), 6)
    expect(dmmMistake('amp', { dial: 'ma', jack: 'ma' }, ma, { live: true, series: true })).toBeNull()
    const v = dmmRead({ dial: 'vdc', jack: 'v' }, at(gap()), 1, 2)
    expect(v.shown).toBeGreaterThan(8.99)
    expect(dmmMistake('amp', { dial: 'vdc', jack: 'v' }, v, { live: true, series: true })).toBe('dial')
  })
  it('the mA fuse melts on a motor’s start current even when the running current fits', () => {
    const gap = (ohms: number) => (): MeterNet => ({ nodes: 2, elements: [{ kind: 'V', a: 1, b: 0, volts: 8 }, { kind: 'R', a: 2, b: 0, ohms }] })
    const r = dmmRead({ dial: 'ma', jack: 'ma' }, gap(30), 1, 2, gap(5))
    expect(r.blown).toBe('ma')
    expect(r.shown).toBe(0)
    expect(r.meltA).toBeCloseTo(8 / (5 + DMM.ma.ohms + DMM.leadOhms), 6)
    expect(r.meltS).toBeCloseTo(fuseMeltTime(r.meltA, FUSES.F400mA), 6)
    expect(dmmRead({ dial: 'amp', jack: 'a10' }, gap(30), 1, 2, gap(5)).blown).toBeNull()
  })
  it('mistakes: wrong socket, wrong dial, live, range, COM', () => {
    const ok = dmmRead({ dial: 'vdc', jack: 'v' }, at(live()), 2, 0)
    expect(dmmMistake('vdc', { dial: 'vdc', jack: 'v' }, ok, { live: true })).toBeNull()
    expect(dmmMistake('vdc', { dial: 'vdc', jack: 'v' }, ok, { live: true, com: true })).toBe('com')
    expect(dmmMistake('vdc', { dial: 'vac', jack: 'v' }, ok, { live: true })).toBe('dial')
    expect(dmmMistake('vdc', { dial: 'ohm', jack: 'v' }, ok, { live: true })).toBe('live')
    const mv = dmmRead({ dial: 'mv', jack: 'v' }, at(live()), 2, 0)
    expect(dmmMistake('vdc', { dial: 'mv', jack: 'v' }, mv, { live: true })).toBe('range')
    const b = dmmRead({ dial: 'beep', jack: 'v' }, at(part(0.1)), 1, 0)
    expect(dmmMistake('beep', { dial: 'beep', jack: 'v' }, b, { live: false })).toBeNull()
    expect(dmmMistake('beep', { dial: 'beep', jack: 'v' }, b, { live: true })).toBe('live')
    expect(dmmMistake('diode', { dial: 'ohm', jack: 'v' }, b, { live: false })).toBe('dial')
  })
  it('display text', () => {
    const r = (shown: number | null, unit: 'V' | 'mV' | 'A' | 'Ω') => ({ shown, unit, beep: 'off' as const, amps: 0, burden: 0, blown: null, meltS: Infinity, meltA: 0, volts: [] })
    expect(dmmText(r(null, 'V'))).toBe('0L')
    expect(dmmText(r(7.624, 'V'))).toBe('7.62')
    expect(dmmText(r(-1.7, 'V'))).toBe('-1.70')
    expect(dmmText(r(0.1234, 'A'))).toBe('0.123')
    expect(dmmReading(r(10000, 'Ω'))).toBe('10.0 kΩ')
    expect(dmmReading(r(0.22, 'Ω'))).toBe('0.2 Ω')
    expect(dmmReading(r(null, 'Ω'))).toBe('OL')
  })
})
