import { cellVolts } from '../power/packs'
import { loopOhms } from '../power/wiring'
import { LIPO_CHEM, LIPO_HEAT, LIPO_PACK, LipoCfg, lipoAt, lipoChargeRun, lipoShort, selfHeatW, sideShare } from './batterysafety'

const GOOD: LipoCfg = { mode: 'lipo2s', rateC: 1, balance: true, state: 'storage', spot: 'tile' }
const run = (o: Partial<LipoCfg> = {}) => lipoChargeRun({ ...GOOD, ...o })

describe('heat terms', () => {
  it('side reactions start past 4.20 V, all heat by 5.0 V', () => {
    expect(sideShare(4.2)).toBe(0)
    expect(sideShare(4.6)).toBeCloseTo(0.25, 12)
    expect(sideShare(5.4)).toBe(1)
  })
  it('self-heating is off under the onset, doubles every 10 °C above', () => {
    expect(selfHeatW(59)).toBe(0)
    expect(selfHeatW(LIPO_HEAT.refC)).toBeCloseTo(LIPO_HEAT.selfW, 12)
    expect(selfHeatW(90) / selfHeatW(80)).toBeCloseTo(2, 12)
  })
  it('bare leads touching: hundreds of amps, kilowatts inside the pack', () => {
    const s = lipoShort('storage')
    expect(s.amps).toBeCloseTo((2 * 3.8) / (2 * LIPO_PACK.ohms + loopOhms(12, 0.1)), 6)
    expect(s.amps).toBeGreaterThan(300)
    expect(s.packW).toBeGreaterThan(2000)
  })
})

describe('lipoChargeRun', () => {
  it('2S balance charge at 1C from storage: CC then CV, ends near 4.20 V/cell, barely warm, passes', () => {
    const r = run()
    expect(r.verdict).toEqual({ pass: true, near: false, fail: null })
    expect(r.frames.some((f) => f.phase === 'cc')).toBe(true)
    expect(r.frames.some((f) => f.phase === 'cv')).toBe(true)
    expect(r.last.phase).toBe('done')
    expect(r.maxV).toBeCloseTo(4.2, 6)
    expect(r.peakC).toBeLessThan(30)
    expect(r.seconds / 60).toBeGreaterThan(20)
    expect(r.seconds / 60).toBeLessThan(40)
    expect(lipoAt(r, 1e9)).toBe(r.last)
  })
  it('amps conserve charge: state of charge rises by ∫I dt / capacity', () => {
    const r = run()
    const ah = r.frames.slice(0, -1).reduce((s, f) => s + (f.amps * 10) / 3600, 0)
    expect(r.last.socs[0] - 0.6).toBeCloseTo(ah / 2.2, 6)
  })
  it('drifted cells without the balance lead: the high cell passes 4.20 V', () => {
    const r = run({ state: 'flown', balance: false })
    expect(r.verdict.fail).toBe('over')
    expect(Math.max(...r.last.rest)).toBeGreaterThan(4.22)
    const b = run({ state: 'flown' })
    expect(b.verdict.pass).toBe(true)
    expect(b.maxV).toBeLessThanOrEqual(4.2 + 1e-9)
  })
  it('matched cells without the balance lead get away with it: a close miss', () => {
    expect(run({ balance: false }).verdict).toEqual({ pass: false, near: true, fail: 'balance' })
  })
  it('3S on a 2S pack: refused with the balance lead, vents without it; NiMH has no voltage limit and vents', () => {
    const caught = run({ mode: 'lipo3s' })
    expect(caught.last.phase).toBe('refused')
    expect(caught.verdict.fail).toBe('setting')
    const vent = run({ mode: 'lipo3s', balance: false })
    expect(vent.last.phase).toBe('vent')
    expect(vent.last.tempC).toBeGreaterThanOrEqual(LIPO_HEAT.ventC)
    expect(vent.verdict.fail).toBe('vent')
    expect(run({ mode: 'nimh' }).verdict.fail).toBe('vent')
  })
  it('LiHV on a standard pack overcharges to 4.35 V', () => {
    const r = run({ mode: 'lihv2s' })
    expect(r.maxV).toBeCloseTo(4.35, 6)
    expect(r.verdict.fail).toBe('over')
  })
  it('rate: 1.5C is a close miss, 3C fails; 3C warms the pack more', () => {
    expect(run({ rateC: 1.5 }).verdict).toMatchObject({ fail: 'rate', near: true })
    const r3 = run({ rateC: 3 })
    expect(r3.verdict).toMatchObject({ fail: 'rate', near: false })
    expect(r3.peakC).toBeGreaterThan(run().peakC + 4)
  })
  it('puffed and over-discharged packs fail before anything else', () => {
    expect(run({ state: 'puffed' }).verdict.fail).toBe('puffed')
    const flat = run({ state: 'flat' })
    expect(cellVolts(LIPO_CHEM, -0.02)).toBeCloseTo(2.6, 9)
    expect(flat.frames[0].phase).toBe('pre')
    expect(flat.verdict.fail).toBe('flat')
  })
  it('where: a wooden bench is a close miss, charging unattended fails', () => {
    expect(run({ spot: 'bench' }).verdict).toMatchObject({ fail: 'surface', near: true })
    expect(run({ spot: 'away' }).verdict).toMatchObject({ fail: 'alone', near: false })
  })
  it('the bag holds heat in: same charge runs warmer', () => {
    expect(run({ rateC: 3 }).peakC).toBeGreaterThan(run({ rateC: 3, spot: 'bench' }).peakC)
  })
})
