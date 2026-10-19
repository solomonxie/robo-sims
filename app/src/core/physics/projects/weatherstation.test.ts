import { I2C_MODES, i2cRiseTime } from '../mcu/i2c'
import { DEVKIT_EXTRA_A, averageAmps, nodeCycle } from '../mcu/sleep'
import { airPressureAt } from '../waves/fluids'
import { medianMs } from '../../stopwatch'
import {
  WX_ADDR,
  WX_ALERT,
  WX_PULLUPS,
  WX_WEEK,
  wxBus,
  wxBusPf,
  wxCycle,
  wxJson,
  wxSeaLevel,
  wxSeaPa,
  wxSensorC,
  wxSunAt,
  wxWeek,
} from './weatherstation'

describe('wire the sensors', () => {
  it('pull-ups add in parallel and the cable adds capacitance', () => {
    expect(WX_PULLUPS.both.ohms).toBeCloseTo(5000, 6)
    expect(wxBusPf(2) - wxBusPf(0)).toBeCloseTo(120, 9)
    const b = wxBus(1, 'both', 'fast')
    expect(b.tr).toBeCloseTo(i2cRiseTime(5000, wxBusPf(1) * 1e-12), 15)
  })
  it('a long cable breaks 400 kHz on the breakout pull-ups; 100 kHz or a 2.2 kΩ fixes it', () => {
    expect(wxBus(0, 'both', 'fast').state).toBe('ok')
    expect(wxBus(2, 'both', 'fast').state).toBe('fail')
    expect(wxBus(2, 'both', 'fast').found).toEqual([])
    expect(wxBus(2, 'both', 'standard').state).toBe('ok')
    expect(wxBus(2, 'added', 'fast').state).toBe('ok')
    expect(wxBus(2, 'added', 'fast').found).toEqual([WX_ADDR.oled, WX_ADDR.bmp])
  })
  it('the longest in-spec cable is where the rise time hits the limit', () => {
    const b = wxBus(0, 'both', 'standard')
    expect(i2cRiseTime(5000, wxBusPf(b.maxCableM) * 1e-12)).toBeCloseTo(I2C_MODES.standard.trMax, 12)
    expect(wxBus(0, 'one', 'fast').maxCableM).toBe(0)
  })
  it('inside the sealed box the sensor reads the board’s heat; on a cable it reads the air', () => {
    const inBox = wxSensorC(0, 12)
    expect(inBox.rise).toBeGreaterThan(3)
    expect(inBox.readC).toBeCloseTo(12 + inBox.rise, 9)
    expect(wxSensorC(1, 12).readC).toBe(12)
  })
})

describe('send over wi-fi', () => {
  it('sea-level reduction undoes the altitude', () => {
    const p = airPressureAt(250, 100_900)
    expect(p).toBeLessThan(100_900 - 2500)
    expect(wxSeaLevel(p, 250)).toBeCloseTo(100_900, 6)
  })
  it('a DevKit adds its 8 mA to every step; the panel gives its full-sun hours per day', () => {
    const c = wxCycle(600, 'wifi', 'devkit')
    expect(averageAmps(c) - averageAmps(nodeCycle(600, 'wifi'))).toBeCloseTo(DEVKIT_EXTRA_A, 9)
    let sum = 0
    for (let t = 0; t < 24; t += 0.01) sum += wxSunAt('winter', t) * 0.01
    expect(sum).toBeCloseTo(1, 2)
    expect(wxSunAt('summer', 2)).toBe(0)
  })
  it('DevKit, no panel: flat before the storm, no alert; bare module or summer panel catch it', () => {
    const dev = wxWeek({ everyS: 600, radio: 'wifi', board: 'devkit', sun: 'none' })
    expect(dev.emptyH).not.toBeNull()
    expect(dev.emptyH!).toBeLessThan(dev.trueAlertH!)
    expect(dev.alertH).toBeNull()
    const bare = wxWeek({ everyS: 600, radio: 'wifi', board: 'bare', sun: 'none' })
    expect(bare.emptyH).toBeNull()
    expect(bare.alertH! - bare.trueAlertH!).toBeGreaterThanOrEqual(0)
    expect(bare.alertH! - bare.trueAlertH!).toBeLessThan(600 / 3600 + 1e-9)
    const sun = wxWeek({ everyS: 600, radio: 'wifi', board: 'devkit', sun: 'summer' })
    expect(sun.inMahPerDay).toBeGreaterThan(sun.useMahPerDay)
    expect(sun.alertH).not.toBeNull()
  })
  it('the true fall passes 3.5 hPa in 3 h during the front, and reports follow the true curve', () => {
    const r = wxWeek({ everyS: 3600, radio: 'static', board: 'bare', sun: 'none' })
    const t = r.trueAlertH!
    expect(t).toBeGreaterThan(WX_WEEK.frontH)
    expect(wxSeaPa(t) - wxSeaPa(t - 3)).toBeCloseTo(-WX_ALERT.pa, 0)
    expect(r.reports.length).toBe(WX_WEEK.days * 24 + 1)
    for (const s of r.reports) expect(Math.abs(s.seaPa - wxSeaPa(s.t))).toBeLessThan(5)
    expect(r.alertH! - t).toBeLessThan(1 + 1e-9)
  })
  it('JSON payload and a week is fast to recompute', () => {
    expect(JSON.parse(wxJson(101_325, 9.5, 3.92))).toEqual({ id: 'wx1', p: 1013.3, t: 9.5, v: 3.92 })
    expect(medianMs(() => wxWeek({ everyS: 60, radio: 'wifi', board: 'devkit', sun: 'winter' }), 3)).toBeLessThan(800)
  })
})
