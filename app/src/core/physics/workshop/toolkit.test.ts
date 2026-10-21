import { stallAmps } from '../actuators/dcmotor'
import { CHEMISTRIES } from '../power/batteries'
import { ALLOYS } from './soldering'
import { ironIdle, tipOxide } from './iron'
import { BENCH_TIERS, BUILD_STEPS, KitPicks, PEN_IRON, PSU_FIRST_POWER, STATION_SET_C, TOOLS, ToolId, benchRun, kitTools, oxideFullS, stepChecks, usdMid, usdSum, usdTimes } from './toolkit'

const FULL: KitPicks = { iron: 'rework', wire: 'crimp', test: 'psu', battery: 'bagged', safety: 'extract', extras: 'caliper' }
const kit = (o: Partial<KitPicks> = {}) => kitTools({ ...FULL, ...o })

describe('prices and steps', () => {
  it('ranges add, scale and average', () => {
    expect(usdSum([[1, 2], [3, 5]])).toEqual([4, 7])
    expect(usdTimes([0.5, 1], 4)).toEqual([2, 4])
    expect(usdMid([8, 15])).toBe(11.5)
    for (const t of Object.values(TOOLS)) expect(t.usd[0]).toBeLessThan(t.usd[1])
  })
  it('a step needs one tool from each group; the cheapest missing one is named', () => {
    const [h] = stepChecks(['solder'], ['headers'])
    expect(h).toMatchObject({ ok: false, missing: ['penIron'] })
    expect(stepChecks(['station', 'solder'], ['headers'])[0]).toMatchObject({ ok: true, uses: ['station', 'solder'] })
    expect(stepChecks(kit()).every((s) => s.ok)).toBe(true)
    expect(stepChecks(kit()).length).toBe(Object.keys(BUILD_STEPS).length)
  })
  it('every tool but helping hands and the safety kit serves a build step', () => {
    const used = new Set(Object.values(BUILD_STEPS).flatMap((s) => (s.needs as ToolId[][]).flat()))
    const idle = (Object.keys(TOOLS) as ToolId[]).filter((t) => !used.has(t) && !TOOLS[t].safety)
    expect(idle).toEqual(['hands'])
  })
})

describe('pen iron vs station', () => {
  it('the pen iron idles ~75 °C over the Sn63 window and oxidises in seconds; the station holds its set point', () => {
    expect(PEN_IRON.idleC - ALLOYS.sn63.tipC[1]).toBe(75)
    expect(tipOxide(PEN_IRON.idleC, oxideFullS(PEN_IRON.idleC))).toBeCloseTo(1, 9)
    expect(oxideFullS(PEN_IRON.idleC)).toBeLessThan(10)
    expect(oxideFullS(STATION_SET_C)).toBeGreaterThan(4 * oxideFullS(PEN_IRON.idleC))
    expect(benchRun('first', kit()).ironC).toBeCloseTo(ironIdle(STATION_SET_C, 'chisel').tipC, 9)
  })
})

describe('first power-up', () => {
  it('the PSU limit sits well under one TT stall and the volts match a 2S pack', () => {
    expect(PSU_FIRST_POWER.limitA).toBeLessThan(stallAmps(PSU_FIRST_POWER.volts) / 4)
    expect(PSU_FIRST_POWER.volts).toBeCloseTo(2 * CHEMISTRIES.liion.nominal, 9)
  })
})

describe('benchRun', () => {
  it('a kit sized to each tier passes; the whole kit busts the smaller budgets', () => {
    const first = kit({ iron: 'station', wire: 'none', test: 'dmm', battery: 'none', extras: 'breadboard' })
    const wire = kit({ battery: 'none', extras: 'breadboard' })
    expect(benchRun('first', first).verdict.pass).toBe(true)
    expect(benchRun('wire', wire).verdict.pass).toBe(true)
    expect(benchRun('full', kit()).verdict.pass).toBe(true)
    expect(benchRun('full', kit({ extras: 'hands' })).verdict.pass).toBe(true)
    expect(benchRun('first', kit()).verdict.fail).toBe('budget')
    expect(benchRun('first', kit()).unused).toEqual(expect.arrayContaining(['psu', 'crimper', 'charger']))
    expect(benchRun('full', kit()).mid).toBeLessThanOrEqual(BENCH_TIERS.full.usd)
  })
  it('safety first: glasses with an iron or cutters, an extractor with an iron, a bag with a charger', () => {
    expect(benchRun('full', kit({ safety: 'none' })).verdict.fail).toBe('glasses')
    expect(benchRun('first', kitTools({ ...FULL, iron: 'none', wire: 'cutters', test: 'none', battery: 'none', safety: 'none', extras: 'none' })).verdict.fail).toBe('glasses')
    expect(benchRun('full', kit({ safety: 'glasses' })).verdict.fail).toBe('fumes')
    expect(benchRun('full', kit({ battery: 'charger' })).verdict.fail).toBe('bag')
  })
  it('blocked steps name the missing tool; one blocked step is a close miss', () => {
    const r = benchRun('full', kit({ wire: 'strip' }))
    expect(r.verdict).toMatchObject({ fail: 'blocked', near: true })
    expect(r.blocked.map((s) => [s.id, s.missing])).toEqual([['leads', ['crimper']]])
    const two = benchRun('full', kit({ wire: 'strip', test: 'dmm' }))
    expect(two.verdict).toMatchObject({ fail: 'blocked', near: false })
    expect(benchRun('wire', kit({ iron: 'station', battery: 'none', extras: 'breadboard' })).blocked[0].missing).toEqual(['desolder'])
  })
  it('a pen iron passes every check but the last: a close miss', () => {
    const r = benchRun('first', kit({ iron: 'pen', wire: 'none', test: 'dmm', battery: 'none', extras: 'breadboard' }))
    expect(r.verdict).toEqual({ pass: false, near: true, fail: 'iron' })
    expect(r.hotBy).toBe(75)
  })
})
