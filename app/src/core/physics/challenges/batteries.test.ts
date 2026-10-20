import { medianMs } from '../../stopwatch'
import { CHEMISTRIES } from '../power/batteries'
import { budgetOf, packRuntime, stateAmps } from '../power/budget'
import {
  RUNTIME_PUZZLE,
  SERIES_ROBOTS,
  regulatorSpan,
  runtimeAnswer,
  runtimeTarget,
  runtimeVolts,
  seriesAnswers,
  seriesSweepAt,
  seriesCount,
  seriesStallA,
} from './batteries'

describe('Runtime target', () => {
  it('patrol on 2S1P Li-ion: half cruise, half park, runtime = usable Wh / average W', () => {
    const r = runtimeTarget('liion', 1, 'patrol')
    const drive = budgetOf(stateAmps('cruise', 7.4), 7.4).packW
    const park = budgetOf(stateAmps('idle', 7.4), 7.4).packW
    expect(r.avgW).toBeCloseTo((drive + park) / 2, 9)
    expect(r.hours).toBeCloseTo(packRuntime(CHEMISTRIES.liion, 2, 1, r.avgW).hours, 9)
    expect(Math.abs(r.wh / r.ratedWh - 1)).toBeLessThan(0.05)
    expect(r.derated).toBeCloseTo(r.hours * RUNTIME_PUZZLE.margin, 9)
    expect(r.verdict).toEqual({ pass: false, near: true, fail: 'short' })
  })
  it('order: peak, short, heavy, margin', () => {
    expect(runtimeTarget('alkaline', 1, 'patrol').verdict).toEqual({ pass: false, near: false, fail: 'peak' })
    expect(runtimeTarget('alkaline', 2, 'patrol').verdict).toMatchObject({ fail: 'peak', near: true })
    expect(runtimeTarget('lfp', 1, 'patrol').verdict).toMatchObject({ fail: 'short', near: false })
    expect(runtimeTarget('nimh', 2, 'patrol').verdict.fail).toBe('heavy')
    expect(runtimeTarget('lfp', 3, 'sentry').verdict).toEqual({ pass: false, near: true, fail: 'margin' })
  })
  it('parallel cells split the peak and add runtime; alkaline sags more at the same load', () => {
    const [a, b] = [runtimeTarget('liion', 1, 'explorer'), runtimeTarget('liion', 2, 'explorer')]
    expect(b.cellPeakA).toBeCloseTo(a.cellPeakA / 2, 9)
    expect(b.hours).toBeGreaterThan(2 * a.hours)
    expect(b.grams).toBe(2 * a.grams)
    expect(runtimeTarget('alkaline', 1, 'explorer').usable).toBeLessThan(a.usable)
  })
  it('answers: Li-ion 2P patrols, LiFePO4 needs 3P, NiMH is too heavy everywhere', () => {
    expect(runtimeAnswer('liion', 'patrol')).toBe(2)
    expect(runtimeAnswer('lfp', 'patrol')).toBe(3)
    expect(runtimeAnswer('liion', 'explorer')).toBe(1)
    expect(runtimeAnswer('alkaline', 'sentry')).toBe(2)
    for (const m of ['patrol', 'explorer', 'sentry'] as const) expect(runtimeAnswer('nimh', m)).toBeNull()
  })
  it('pack volts fall from full to cutoff over the run', () => {
    const r = runtimeTarget('liion', 1, 'patrol')
    const c = CHEMISTRIES.liion
    const start = runtimeVolts(c, 2, r.cellA, r.hours, 0)
    const end = runtimeVolts(c, 2, r.cellA, r.hours, r.hours)
    expect(start.volts).toBeCloseTo(2 * (c.full - r.cellA * c.cell.ohms), 9)
    expect(end.volts).toBeCloseTo(2 * c.cutoff, 3)
    expect(runtimeVolts(c, 2, r.cellA, r.hours, r.hours / 2).volts).toBeLessThan(start.volts)
  })
})

describe('Series count', () => {
  it('regulator spans: LM2596 needs ~5.5 V for 5 V, MT3608 boosts 2 V up to just above 5 V', () => {
    const [lo, hi] = regulatorSpan('car')
    expect(lo).toBeGreaterThan(5.3)
    expect(lo).toBeLessThan(5.7)
    expect(hi).toBeCloseTo(40, 3)
    const [blo, bhi] = regulatorSpan('logger')
    expect(blo).toBeCloseTo(2, 3)
    expect(bhi).toBeGreaterThan(5)
    expect(bhi).toBeLessThan(5.6)
  })
  it('car: 2S Li-ion passes; LiFePO4 2S drops out, 3S overdrives the TT motor; 3S Li-ion is over the DRV8833 max', () => {
    expect(seriesAnswers('car', 'liion')).toEqual([2])
    expect(seriesCount('car', 'lfp', 2).verdict).toEqual({ pass: false, near: true, fail: 'regulate' })
    expect(seriesCount('car', 'lfp', 3).verdict.fail).toBe('motorHi')
    expect(seriesCount('car', 'liion', 3).verdict).toMatchObject({ fail: 'over', near: false })
  })
  it('car on 6 × NiMH: regulates at rest but the motor start browns out the empty pack', () => {
    const s = seriesCount('car', 'nimh', 6)
    expect(s.share).toBe(1)
    expect(s.spikeV).toBeLessThan(regulatorSpan('car')[0])
    expect(s.verdict).toEqual({ pass: false, near: true, fail: 'brownout' })
    expect(seriesStallA('car', 6)).toBeCloseTo(2 * (6 / (SERIES_ROBOTS.car.motor.ohms + 0.36)), 9)
  })
  it('logger: one Li-ion or three NiMH / AA cells; a 2S pack passes straight through the boost', () => {
    expect(seriesAnswers('logger', 'liion')).toEqual([1])
    expect(seriesAnswers('logger', 'nimh')).toEqual([3])
    expect(seriesAnswers('logger', 'alkaline')).toEqual([3])
    const two = seriesCount('logger', 'liion', 2)
    expect(two.failAt?.limit).toBe('pass-through')
    expect(seriesCount('logger', 'nimh', 4).verdict).toMatchObject({ fail: 'regulate', near: true })
  })
  it('12 V bot: 4S Li-ion, 11–12S NiMH; 3S Li-ion goes weak when empty; alkaline never fits', () => {
    expect(seriesAnswers('bigbot', 'liion')).toEqual([4])
    expect(seriesAnswers('bigbot', 'nimh')).toEqual([11, 12])
    expect(seriesAnswers('bigbot', 'alkaline')).toEqual([])
    const s = seriesCount('bigbot', 'liion', 3)
    expect(s.motorEmpty).toBeLessThan(SERIES_ROBOTS.bigbot.motor.min)
    expect(s.verdict.fail).toBe('weak')
    expect(seriesCount('bigbot', 'lfp', 5).verdict).toMatchObject({ fail: 'motorHi', near: true })
  })
  it('discharge sweep: rail holds 5 V while the pack sags', () => {
    const full = seriesSweepAt('car', 'liion', 2, 1)
    const empty = seriesSweepAt('car', 'liion', 2, 0)
    expect(full.vpack).toBeCloseTo(8.4, 9)
    expect(empty.vpack).toBeCloseTo(6, 9)
    expect(Math.abs(empty.rail - 5)).toBeLessThan(0.02)
    expect(seriesSweepAt('car', 'liion', 1, 0.5).limit).toBe('off')
  })
  it('solves fast', () => {
    expect(medianMs(() => { for (let k = 1; k <= 12; k++) seriesCount('bigbot', 'nimh', k); runtimeTarget('lfp', 3, 'patrol') })).toBeLessThan(100)
  })
})
