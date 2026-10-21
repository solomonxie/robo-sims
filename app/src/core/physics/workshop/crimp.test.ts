import { CONNECTORS, ampacity } from '../power/wiring'
import { CRIMP, CRIMP_LAPSE, CRIMP_LAPSE_S, CrimpCfg, TERMINALS, conductorMm2, crimpAt, crimpFill, crimpOhms, crimpRun, pullOutN, pullSpecN, stripCover, stripWindow, strandsCut, wireBreakN, wireOdMm } from './crimp'

const GOOD: CrimpCfg = { terminal: 'dupont', awg: 24, stripMm: 2.5, die: 'match', fullStroke: true }
const run = (o: Partial<CrimpCfg> = {}) => crimpRun({ ...GOOD, ...o })

describe('wire and spec', () => {
  it('22 AWG is ~0.33 mm², breaks at ~72 N; IEC wants 40 N', () => {
    expect(conductorMm2(22)).toBeCloseTo(0.326, 2)
    expect(wireBreakN(22)).toBeCloseTo(71.7, 0)
    expect(pullSpecN(0.32)).toBe(40)
    expect(pullSpecN(0.41)).toBeCloseTo(50, 9)
    expect(pullSpecN(0.025)).toBeCloseTo(3, 9)
  })
  it('thin-wall insulation: 0.5 mm of wall on top of the copper', () => {
    expect(wireOdMm(26)).toBeCloseTo(0.405 + 0.5, 2)
  })
})

describe('crimp model', () => {
  it('the matching die lands on the target fill; a slot off is 1.59× in area', () => {
    expect(crimpFill(24, 24)).toBeCloseTo(CRIMP.target, 12)
    expect(crimpFill(24, 22)).toBeCloseTo(CRIMP.target / 1.59, 2)
    expect(crimpFill(24, 24, false)).toBeCloseTo(CRIMP.target / CRIMP.earlyRoom, 12)
  })
  it('strands start cutting past 0.97 and are all gone 0.08 later', () => {
    expect(strandsCut(0.95)).toBe(0)
    expect(strandsCut(1.01)).toBeCloseTo(0.5, 9)
    expect(strandsCut(1.2)).toBe(1)
  })
  it('resistance: open when loose or on insulation, rises as the squeeze drops', () => {
    expect(crimpOhms(24, CRIMP.looseFill, 1)).toBe(Infinity)
    expect(crimpOhms(24, 0.9, 0)).toBe(Infinity)
    const good = crimpOhms(24, 0.9, 1)
    expect(good).toBeCloseTo(CRIMP.gasOhmMm2 / conductorMm2(24), 12)
    expect(crimpOhms(24, 0.84, 1)).toBeGreaterThan(1.9 * good)
    expect(crimpOhms(24, 0.9, 0.5)).toBeCloseTo(2 * good, 12)
  })
  it('pull-out peaks between loose and cut', () => {
    expect(pullOutN(22, 0.9, 1)).toBeCloseTo(CRIMP.holdEff * wireBreakN(22), 9)
    expect(pullOutN(22, 0.83, 1)).toBeLessThan(pullOutN(22, 0.9, 1))
    expect(pullOutN(22, 1.05, 1)).toBe(0)
  })
  it('strip window: barrel all on strands, insulation ends in the gap', () => {
    const T = TERMINALS.dupont
    const [lo, hi] = stripWindow(T)
    expect(stripCover(T, lo).cond).toBeCloseTo(1, 9)
    expect(stripCover(T, lo).insul).toBe(1)
    expect(stripCover(T, hi).insul).toBe(1)
    expect(stripCover(T, hi + T.insulMm / 2).insul).toBeCloseTo(0.5, 9)
    expect(stripCover(T, CRIMP.brushMm + T.condMm / 2).cond).toBeCloseTo(0.5, 9)
  })
})

describe('crimpRun verdicts', () => {
  it('a matched die, full stroke, right strip passes', () => {
    for (const [terminal, awg, stripMm] of [['dupont', 24, 2.5], ['jstxh', 22, 2.4], ['jstph', 28, 1.9]] as const) {
      const r = run({ terminal, awg, stripMm })
      expect(r.verdict).toEqual({ pass: true, near: false, fail: null })
      expect(r.holdN).toBeGreaterThan(r.specN)
      expect(r.heat!.tempC).toBeLessThan(CRIMP.coolC)
    }
  })
  it('each mistake is the reason', () => {
    expect(run({ awg: 20 }).verdict.fail).toBe('range')
    expect(run({ terminal: 'jstph', awg: 22 }).verdict).toMatchObject({ fail: 'range', near: true })
    expect(run({ stripMm: 1.2 }).verdict.fail).toBe('short')
    expect(run({ die: 'small' }).verdict).toMatchObject({ fail: 'over', near: false })
    expect(run({ die: 'big' }).verdict).toMatchObject({ fail: 'pull', near: false })
    expect(run({ fullStroke: false }).verdict).toMatchObject({ fail: 'pull', near: true })
    expect(run({ stripMm: 3.6 }).verdict).toMatchObject({ fail: 'long', near: true })
    expect(run({ awg: 28 }).verdict.pass).toBe(true)
    expect(run({ terminal: 'jstph', awg: 24, stripMm: 1.9 }).verdict).toMatchObject({ fail: 'insul', near: true })
  })
  it('a loose crimp has no contact to heat', () => {
    const r = run({ die: 'big' })
    expect(r.ohms).toBe(Infinity)
    expect(r.heat).toBeNull()
  })
  it('test current is the lesser of the terminal rating and the wire ampacity', () => {
    const r = run({ awg: 30, terminal: 'jstph', stripMm: 1.9 })
    expect(r.testA).toBe(Math.min(CONNECTORS.jstph.ratedA, ampacity(30, 80)))
  })
})

describe('time-lapse', () => {
  it('closes, then tugs to 1.3 × spec; a good crimp holds, a loose one lets go', () => {
    const good = run()
    expect(crimpAt(good, CRIMP_LAPSE.closeS).closed).toBe(1)
    const end = crimpAt(good, CRIMP_LAPSE_S)
    expect(end.failed).toBe(false)
    expect(end.forceN).toBeCloseTo(CRIMP_LAPSE.over * good.specN, 9)
    const early = run({ fullStroke: false })
    expect(crimpAt(early, CRIMP_LAPSE.closeS).closed).toBeLessThan(1)
    const loose = crimpAt(early, CRIMP_LAPSE_S)
    expect(loose.failed).toBe(true)
    expect(loose.forceN).toBe(0)
    expect(loose.slideMm).toBeGreaterThan(0)
  })
})
