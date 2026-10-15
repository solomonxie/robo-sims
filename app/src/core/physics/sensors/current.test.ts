import { CHEMISTRIES } from '../power/batteries'
import { fixedStepAt } from '../common'
import { INA219, cycleAmps, ina219Cal, ina219Config, ina219Read, packDivider, regWord, shuntSense, socFromVolts, socRun } from './current'
import type { SocRunOpts } from './current'

const LI = CHEMISTRIES.liion

describe('shunt resistor', () => {
  it('1 A through 0.1 Ω is 100 mV and 0.1 W; ×10 into the ADC reads it back to a count', () => {
    const s = shuntSense(1, 0.1, 10, 'low', 7.4)
    expect(s.vsh).toBeCloseTo(0.1, 9)
    expect(s.watts).toBeCloseTo(0.1, 9)
    expect(s.vout).toBeCloseTo(1, 9)
    expect(Math.abs(s.read - 1)).toBeLessThan(s.perCount)
    expect(s.groundLift).toBeCloseTo(0.1, 9)
    expect(s.commonMode).toBe(0)
  })
  it('too much gain clips at the rail; no gain wastes counts', () => {
    const hot = shuntSense(3, 0.1, 50, 'high', 7.4)
    expect(hot.clipped).toBe(true)
    expect(hot.read).toBeLessThan(hot.fullScale + 1e-9)
    expect(hot.commonMode).toBeCloseTo(7.1, 9)
    const bare = shuntSense(0.05, 0.1, 1, 'low', 7.4)
    expect(bare.code).toBeLessThan(7)
    expect(bare.perCount).toBeCloseTo(3.3 / 4096 / 0.1, 9)
    const low = shuntSense(0.05, 0.01, 10, 'low', 7.4)
    expect(low.floored).toBe(true)
    expect(low.read).toBeGreaterThan(0.2)
  })
  it('a 100 k / 33 k divider brings a full 2S pack into ADC range', () => {
    const d = packDivider(8.4, 100e3, 33e3)
    expect(d.vadc).toBeCloseTo(2.084, 3)
    expect(d.read).toBeCloseTo(8.4, 1)
    expect(d.amps).toBeCloseTo(63e-6, 6)
    expect(d.clipped).toBe(false)
  })
})

describe('INA219', () => {
  it('calibration and register scaling (datasheet example: 0.1 mA LSB, 0.1 Ω → 4096)', () => {
    expect(ina219Cal(1e-4, 0.1)).toBe(4096)
    expect(ina219Cal(1e-3, 0.1)).toBe(409)
    const r = ina219Read(0.5, 7.2, 0.1, 0.32, 1e-4)
    expect(r.shunt).toBe(5000)
    expect(r.current).toBe(5000)
    expect(r.amps).toBeCloseTo(0.5, 9)
    expect(Math.floor(r.bus / 8)).toBe(1800)
    expect(r.bus % 4).toBe(2)
    expect(r.busV).toBeCloseTo(7.2, 9)
    expect(r.watts).toBeCloseTo(3.6, 2)
    expect(r.ovf).toBe(false)
  })
  it('PGA range and a too-fine current LSB both overflow', () => {
    const pga = ina219Read(1, 7, 0.1, 0.04, 1e-4)
    expect(pga.shuntOvf).toBe(true)
    expect(pga.shuntV).toBeCloseTo(0.04, 9)
    expect(pga.bus % 2).toBe(1)
    const fine = ina219Read(2, 7, 0.1, 0.32, 5e-5)
    expect(fine.ovf).toBe(true)
    expect(fine.current).toBe(32767)
  })
  it('truncated Cal gives a small gain error; negative words wrap', () => {
    expect(ina219Read(1, 7, 0.1, 0.32, 1e-3).amps).toBeCloseTo(0.998, 3)
    expect(regWord(-1)).toBe(0xffff)
    expect(INA219.addr).toBe(0x40)
    expect(ina219Config(0.32)).toBe(0x399f)
    expect(ina219Config(0.04)).toBe(0x219f)
  })
})

describe('state of charge', () => {
  const base: SocRunOpts = { chem: LI, series: 2, mAh: 3000, assumedMAh: 3000, driveA: 0.7, parkA: 0.16, offsetA: 0, recalS: 0, dt: 5 }
  it('the voltage table inverts the OCV curve', () => {
    expect(socFromVolts(LI, 3.65)).toBeCloseTo(0.4, 9)
    expect(socFromVolts(LI, 3.875)).toBeCloseTo(0.7, 9)
    expect(socFromVolts(LI, 2.5)).toBe(0)
    expect(socFromVolts(LI, 4.5)).toBe(1)
  })
  it('drive cycle alternates driving and parking', () => {
    expect(cycleAmps(10, 1, 0.1)).toEqual({ amps: 1, parked: 0 })
    expect(cycleAmps(400, 1, 0.1)).toEqual({ amps: 0.1, parked: 40 })
  })
  it('sag under load makes the voltage reading low; it recovers when parked', () => {
    const run = socRun({ ...base, driveA: 2 })
    const driving = fixedStepAt(run, 3000, 5)
    expect(cycleAmps(3000, 2, 0.16).parked).toBe(0)
    expect(driving.soc - driving.vSoc).toBeGreaterThan(0.1)
    const parked = fixedStepAt(run, 3560, 5)
    expect(Math.abs(parked.soc - parked.vSoc)).toBeLessThan(0.05)
  })
  it('coulomb counting is exact with a perfect sensor, drifts with offset or a faded pack', () => {
    const ok = socRun(base)
    const end = ok[ok.length - 1]
    expect(Math.abs(end.ccSoc - end.soc)).toBeLessThan(1e-9)
    const off = socRun({ ...base, offsetA: 0.05 })
    const e2 = off[off.length - 1]
    expect(e2.soc - e2.ccSoc).toBeGreaterThan(0.05)
    const aged = socRun({ ...base, mAh: 2550 })
    const e3 = aged[aged.length - 1]
    expect(e3.ccSoc - e3.soc).toBeGreaterThan(0.1)
    expect(e3.t).toBeLessThan(end.t)
  })
  it('re-anchoring to the rested voltage while parked bounds the drift', () => {
    const fixed = socRun({ ...base, offsetA: 0.05, recalS: 180 })
    const worst = Math.max(...fixed.map((s) => Math.abs(s.ccSoc - s.soc)))
    expect(worst).toBeLessThan(0.05)
  })
})
