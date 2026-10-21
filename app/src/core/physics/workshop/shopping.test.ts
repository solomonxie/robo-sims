import { DCDC_MODULES } from '../power/converters'
import { ampacity } from '../power/wiring'
import { carPower } from '../projects/robocar'
import { BomCfg, CAR_BOM, bomRun, carBom, carMainJob, plugTakes } from './shopping'
import { usdMid, usdSum } from './toolkit'

const GOOD: BomCfg = { pack: 'li2', driver: 'drv8833', buck: 'lm2596', mainPlug: 'xt30', motorPlug: 'jstph', awg: 24, spares: 'some' }
const run = (o: Partial<BomCfg> = {}) => bomRun({ ...GOOD, ...o })

describe('bill of materials', () => {
  it('lines add up; consumables round up after the spare share', () => {
    const lines = carBom(GOOD)
    const r = run()
    expect(r.cost).toEqual(usdSum(lines.map((l) => l.total)))
    expect(r.mid).toBeCloseTo(usdMid(r.cost), 12)
    expect(lines.find((l) => l.key === 'terminals')!.qty).toBe(5)
    expect(lines.find((l) => l.key === 'wire')!.qty).toBe(3)
    expect(carBom({ ...GOOD, spares: 'none' }).find((l) => l.key === 'terminals')!.qty).toBe(4)
    expect(carBom({ ...GOOD, mainPlug: 'xt30', motorPlug: 'xt30' }).some((l) => l.key === 'terminals')).toBe(false)
  })
  it('terminal fit: crimp barrels by AWG range, solder cups take thinner wire', () => {
    expect(plugTakes('jstph', 24)).toBe(true)
    expect(plugTakes('jstph', 22)).toBe(false)
    expect(plugTakes('dupont', 18)).toBe(false)
    expect(plugTakes('xt30', 28)).toBe(true)
    expect(plugTakes('xt30', 14)).toBe(false)
  })
  it('the main lead job comes from the car’s own power tree', () => {
    const P = carPower('li2')
    expect(carMainJob('li2')).toMatchObject({ amps: P.cruise.packA, burstA: 2 * P.stall.motorA, volts: P.ocv })
  })
})

describe('bomRun', () => {
  it('2S, DRV8833, LM2596, XT30 main, JST-PH motors, 24 AWG, +25 % spares passes inside the budget', () => {
    const r = run()
    expect(r.verdict).toEqual({ pass: true, near: false, fail: null })
    expect(r.mid).toBeLessThanOrEqual(CAR_BOM.usd)
  })
  it('converter: a boost can’t step 2S down (pass-through), a buck can’t make 5 V from one cell, a boost can', () => {
    expect(carPower('li2', undefined, DCDC_MODULES.mt3608).cruise.railV).toBeGreaterThan(7)
    expect(run({ buck: 'mt3608' }).verdict.fail).toBe('rail')
    expect(run({ pack: 'li1' }).verdict.fail).toBe('rail')
    expect(run({ pack: 'li1', buck: 'mt3608' }).railOk).toBe(true)
    expect(run({ pack: 'aa4' }).verdict.fail).toBe('resets')
    expect(run({ pack: 'nimh4' }).P.cruise.railV).toBeLessThan(4.75)
    expect(run({ pack: 'nimh4' }).verdict.fail).toBe('rail')
    expect(run({ pack: 'nimh4', buck: 'mt3608' }).verdict.pass).toBe(true)
  })
  it('plugs: Dupont main lead reverses into the electronics; XT60 is oversize; JST-XH wears out', () => {
    expect(run({ mainPlug: 'dupont' }).verdict).toMatchObject({ fail: 'mainPlug', near: false })
    expect(run({ mainPlug: 'dupont' }).main.verdict.fail).toBe('reverse')
    expect(run({ mainPlug: 'xt60' }).main.verdict).toMatchObject({ fail: 'bulky', near: true })
    expect(run({ mainPlug: 'jstxh' }).main.verdict).toMatchObject({ fail: 'wear', near: true })
    expect(run({ motorPlug: 'dupont' }).verdict).toMatchObject({ fail: 'motorPlug', near: true })
  })
  it('wire: too thick for the terminals, or too thin for a hard start', () => {
    expect(run({ awg: 22 }).verdict.fail).toBe('fit')
    expect(run({ awg: 22, motorPlug: 'jstxh' }).verdict.pass).toBe(true)
    const thin = run({ awg: 30 })
    expect(thin.wireA).toBeCloseTo(ampacity(30, 80), 12)
    expect(thin.wireA).toBeLessThan(thin.burstA)
    expect(thin.verdict).toMatchObject({ fail: 'wire', near: true })
  })
  it('drivers: TB6612 under-rated for a stall, L298N burns ~20 % of the pack', () => {
    expect(run({ driver: 'tb6612' }).verdict).toMatchObject({ fail: 'driver', near: true })
    const l = run({ driver: 'l298n' })
    expect(l.dropShare).toBeGreaterThan(0.15)
    expect(l.verdict).toMatchObject({ fail: 'drop', near: true })
  })
  it('no spares is a close miss; doubling them busts the budget', () => {
    expect(run({ spares: 'none' }).verdict).toMatchObject({ fail: 'spares', near: true })
    const d = run({ spares: 'double' })
    expect(d.mid).toBeGreaterThan(CAR_BOM.usd)
    expect(d.verdict).toMatchObject({ fail: 'budget', near: true })
  })
})
