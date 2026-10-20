import { esp32Raw } from '../mcu/adc'
import { medianMs } from '../../stopwatch'
import {
  PLANT_CTRL,
  PLANT_EPS,
  PLANT_SOIL,
  plantBenchMlS,
  plantCalPct,
  plantCapVolts,
  plantEt,
  plantForkLife,
  plantForkOhms,
  plantProbe,
  plantProbeVolts,
  plantPumpDrive,
  plantRun,
  plantSoilPct,
  toppEps,
} from './plantmonitor'

describe('moisture probe', () => {
  it('Topp: dry soil ~3-5, wet soil ~20; the capacitive board hits its air and water voltages', () => {
    expect(toppEps(0)).toBeCloseTo(3.03, 9)
    expect(toppEps(0.35)).toBeGreaterThan(18)
    expect(toppEps(0.35)).toBeLessThan(25)
    expect(plantCapVolts(PLANT_EPS.air)).toBeCloseTo(2.7, 2)
    expect(plantCapVolts(PLANT_EPS.water)).toBeCloseTo(1.25, 2)
  })
  it('both probes read lower when wetter; the fork follows 1/θ²', () => {
    for (const p of ['fork', 'cap'] as const) expect(plantProbeVolts(p, 0.1)).toBeGreaterThan(plantProbeVolts(p, 0.3))
    expect(plantForkOhms(PLANT_SOIL.fcTheta / 2)).toBeCloseTo(4 * plantForkOhms(PLANT_SOIL.fcTheta), 6)
  })
  it('calibrating in air/water squeezes the pot into the middle; in soil it spans 0…100 %', () => {
    const air = plantProbe('cap', PLANT_SOIL.fcTheta, 'adc1', 'air')
    expect(air.pct!).toBeLessThan(0.5)
    const soil = plantProbe('cap', PLANT_SOIL.fcTheta, 'adc1', 'soil')
    expect(soil.pct!).toBeCloseTo(1, 9)
    expect(plantProbe('cap', PLANT_SOIL.dryTheta, 'adc1', 'soil').pct!).toBeCloseTo(0, 9)
    expect(soil.raw).toBe(esp32Raw(soil.volts, '11'))
    expect(plantCalPct(2000, 3000, 2000)).toBe(1)
    expect(plantCalPct(3500, 3000, 2000)).toBe(0)
    expect(plantSoilPct(PLANT_SOIL.fcTheta)).toBeCloseTo(1, 9)
  })
  it('ADC2 reads nothing with Wi-Fi on', () => {
    const r = plantProbe('cap', 0.2, 'adc2', 'soil')
    expect(r.raw).toBeNull()
    expect(r.pct).toBeNull()
  })
  it('an always-on fork corrodes in weeks; pulsed lasts decades; capacitive has no DC in the soil', () => {
    const on = plantForkLife('fork', PLANT_SOIL.fcTheta, 600)
    expect(on.days).toBeGreaterThan(7)
    expect(on.days).toBeLessThan(90)
    expect(plantForkLife('pulsed', PLANT_SOIL.fcTheta, 600).days).toBeGreaterThan(365 * 50)
    expect(plantForkLife('cap', PLANT_SOIL.fcTheta, 600).days).toBe(Infinity)
  })
})

describe('pump control', () => {
  it('a logic-level FET runs the pump; an IRFZ44N at 3.3 V gate does not; the relay adds its coil', () => {
    const l = plantPumpDrive('irlz')
    expect(l.switchV).toBeLessThan(0.05)
    expect(l.mlPerS).toBeGreaterThan(15)
    expect(l.mlPerS).toBeLessThan(25)
    expect(plantPumpDrive('irfz').mlPerS).toBe(0)
    const r = plantPumpDrive('relay')
    expect(r.extraA).toBeCloseTo(5 / 70, 9)
    expect(r.mlPerS).toBeCloseTo(l.mlPerS, 1)
    expect(plantBenchMlS()).toBe(l.mlPerS)
  })
  it('the plant drinks its daily water by daylight, none at night, less when dry', () => {
    let ml = 0
    for (let t = 0; t < 24; t += 0.01) ml += plantEt(t, 0.3) * 36
    expect(ml).toBeCloseTo(100, 0)
    expect(plantEt(2, 0.3)).toBe(0)
    expect(plantEt(12, PLANT_SOIL.dryTheta)).toBe(0)
    expect(plantEt(8 * 24 + 12, 0.3)).toBeCloseTo(2.5 * plantEt(12, 0.3), 12)
  })
  it('pump until wet overshoots past the slow soak, floods the drain and runs the empty tank dry', () => {
    const r = plantRun({ driver: 'irlz', strategy: 'until', tankMl: 1000 })
    expect(r.drainedMl).toBeGreaterThan(500)
    expect(r.tankEmptyH).not.toBeNull()
    expect(r.dryRunH).toBeGreaterThan(100)
  })
  it('dose and soak: exact doses, no drain, two weeks on 3 L; on 1 L it flags the tank with seconds of dry run', () => {
    const big = plantRun({ driver: 'irlz', strategy: 'dose', tankMl: 3000 })
    for (const e of big.events) expect(e.ml).toBeCloseTo(PLANT_CTRL.doseMl, 6)
    expect(big.drainedMl).toBe(0)
    expect(big.dryH).toBe(0)
    expect(big.alerts).toEqual([])
    const small = plantRun({ driver: 'irlz', strategy: 'dose', tankMl: 1000 })
    expect(small.tankAlertH!).toBeGreaterThan(small.tankEmptyH!)
    expect(small.dryRunH).toBeLessThan(0.1)
  })
  it('the timer ignores the heatwave; the dead FET never pumps, and only dose-and-soak notices', () => {
    const tm = plantRun({ driver: 'irlz', strategy: 'timer', tankMl: 3000 })
    expect(tm.pumpedMl).toBeCloseTo(14 * PLANT_CTRL.timerMl, 6)
    expect(tm.dryH).toBeGreaterThan(5)
    const dead = plantRun({ driver: 'irfz', strategy: 'dose', tankMl: 3000 })
    expect(dead.pumpedMl).toBe(0)
    expect(dead.dryRunH).toBe(0)
    expect(dead.tankAlertH).not.toBeNull()
    expect(plantRun({ driver: 'irfz', strategy: 'timer', tankMl: 3000 }).tankAlertH).toBeNull()
  })
  it('two weeks is fast to recompute', () => {
    expect(medianMs(() => plantRun({ driver: 'irlz', strategy: 'until', tankMl: 3000 }), 3)).toBeLessThan(1500)
  })
})
