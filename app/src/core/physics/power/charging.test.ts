import { BMS_LIMITS, CHEMISTRIES, TP4056, cellTemp, chargeCurve, chargePoint, dieC, liionCharger, sampleAt, throttledAmps, tp4056Amps, tp4056Point } from '..'

const { liion } = CHEMISTRIES

describe('charging', () => {
  it('picks pre-charge, CC, CV and done by cell voltage', () => {
    const ch = liionCharger(1)
    expect(chargePoint(liion, -0.01, ch)).toMatchObject({ phase: 'pre', amps: 0.1 })
    expect(chargePoint(liion, 0.5, ch)).toMatchObject({ phase: 'cc', amps: 1 })
    expect(chargePoint(liion, 0.5, ch).volts).toBeCloseTo(3.875)
    const cv = chargePoint(liion, 0.95, ch)
    expect(cv.phase).toBe('cv')
    expect(cv.volts).toBe(4.2)
    expect(cv.amps).toBeLessThan(1)
    expect(chargePoint(liion, 1, ch)).toMatchObject({ phase: 'done', amps: 0 })
  })

  it('charges an empty cell CC then CV and stops at C/10', () => {
    const curve = chargeCurve(liion, liionCharger(1), -0.01)
    const end = curve[curve.length - 1]
    expect(end.phase).toBe('done')
    expect(end.soc).toBeGreaterThan(0.98)
    expect(end.hours).toBeGreaterThan(3)
    expect(end.hours).toBeLessThan(4.5)
    expect(Math.max(...curve.map((s) => s.volts))).toBeCloseTo(4.2)
    const lastCv = curve[curve.length - 2]
    expect(lastCv.phase).toBe('cv')
    expect(lastCv.amps).toBeCloseTo(0.1, 1)
    expect(sampleAt(curve, 1).phase).toBe('cc')
    expect(sampleAt(curve, 99)).toBe(end)
  })

  it('spends longer in CV at a higher rate', () => {
    const cvShare = (a: number) => {
      const c = chargeCurve(liion, liionCharger(a), 0)
      return c.filter((s) => s.phase === 'cv').length / c.length
    }
    expect(cvShare(3)).toBeGreaterThan(cvShare(0.75))
  })

  it('a CC-only supply runs past 4.2 V until the BMS cuts', () => {
    const curve = chargeCurve(liion, liionCharger(1.5, Infinity), 0, { cutVolts: BMS_LIMITS.ovp })
    const end = curve[curve.length - 1]
    expect(end.phase).toBe('cut')
    expect(end.volts).toBeGreaterThan(BMS_LIMITS.ovp)
    expect(end.soc).toBeLessThan(1)
  })

  it('sets TP4056 current with R_PROG and throttles a hot die', () => {
    expect(tp4056Amps(1200)).toBeCloseTo(1)
    expect(tp4056Amps(10e3)).toBeCloseTo(0.12)
    expect(tp4056Amps(500)).toBe(1)
    expect(dieC(25, 3.7, 1)).toBeCloseTo(90)
    expect(throttledAmps(1, 25, 3.7)).toBe(1)
    const a = throttledAmps(1, 25, 3)
    expect(a).toBeLessThan(1)
    expect(dieC(25, 3, a)).toBeCloseTo(TP4056.dieLimitC)
    expect(throttledAmps(1, 130, 3.7)).toBe(0)
  })

  it('only charges between 0 and 45 °C', () => {
    expect(cellTemp(-5)).toBe('cold')
    expect(cellTemp(25)).toBe('ok')
    expect(cellTemp(50)).toBe('hot')
  })
})

describe('tp4056Point', () => {
  it('pauses outside the NTC window, throttles a hot die', () => {
    expect(tp4056Point(liion, 0.3, 1200, -5, true).phase).toBe('paused')
    expect(tp4056Point(liion, 0.3, 1200, 50, true).phase).toBe('paused')
    const cold = tp4056Point(liion, 0.3, 1200, -5, false)
    expect(cold).toMatchObject({ phase: 'cc', cell: 'cold' })
    const room = tp4056Point(liion, 0.3, 1200, 25, true)
    expect(room).toMatchObject({ phase: 'cc', amps: 1, throttled: false })
    const warm = tp4056Point(liion, 0.05, 1200, 44, true)
    expect(warm.throttled).toBe(true)
    expect(warm.amps).toBeLessThan(1)
    expect(warm.dieC).toBeLessThan(TP4056.dieLimitC + 1)
  })
})
