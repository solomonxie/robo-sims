import { BUCK_COILS, CHEMISTRIES, LM2596, MT3608, XL6009, buckRipple, dcdcPoint, outputRipple, potFor, potVolts, regulatedShare, rippleAmps, runAt, runDown } from '.'

const LI = CHEMISTRIES.liion

describe('dc-dc modules', () => {
  it('trim pot sets Vout = Vref (1 + Rpot / Rlow)', () => {
    expect(potVolts(LM2596, 3000)).toBeCloseTo(1.23 * (1 + 3000 / 330), 9)
    const p = potFor(LM2596, 5)
    expect(potVolts(LM2596, p.ohms)).toBeCloseTo(5, 9)
    expect(p.frac).toBeCloseTo(((5 / 1.23 - 1) * 330) / 10e3, 9)
    expect(potFor(MT3608, 0.3).ohms).toBe(0)
    expect(potFor(MT3608, 100).frac).toBe(1)
  })

  it('LM2596 bucks 12 V to 5 V at 2 A around 85 %, with D a bit above Vout/Vin', () => {
    const p = dcdcPoint(LM2596, 12, 5, 2)
    expect(p.regulating).toBe(true)
    expect(p.vout).toBeCloseTo(5, 2)
    expect(p.duty).toBeGreaterThan(5 / 12)
    expect(p.efficiency).toBeGreaterThan(0.8)
    expect(p.efficiency).toBeLessThan(0.9)
    expect(p.iin * 12).toBeCloseTo(5 * 2 + p.loss, 2)
    expect(p.loss).toBeCloseTo(p.losses.switch + p.losses.diode + p.losses.coil + p.losses.switching + p.losses.quiescent, 9)
  })

  it('a buck drops out when Vin gets near Vout; a boost passes Vin through when Vin > Vout', () => {
    const d = dcdcPoint(LM2596, 6, 5, 2)
    expect(d.limit).toBe('dropout')
    expect(d.vout).toBeLessThan(5)
    expect(d.duty).toBeCloseTo(LM2596.maxDuty, 6)
    const b = dcdcPoint(MT3608, 8.4, 5, 1)
    expect(b.limit).toBe('pass-through')
    expect(b.duty).toBe(0)
    expect(b.vout).toBeCloseTo(8.4 - 0.45 - 0.1, 6)
    expect(dcdcPoint(MT3608, 5, 12, 0.5).regulating).toBe(true)
  })

  it('SEPIC holds the output whether Vin is above or below it', () => {
    for (const vin of [9, 12, 12.6]) expect(dcdcPoint(XL6009, vin, 12, 1).regulating).toBe(true)
    expect(dcdcPoint(XL6009, 4.5, 12, 1).limit).toBe('off')
  })

  it('a big step-up hits the switch current limit', () => {
    const p = dcdcPoint(MT3608, 3, 24, 1)
    expect(p.limit).toBe('current-limit')
    expect(p.peak).toBeLessThanOrEqual(MT3608.switchAmps + 1e-6)
  })

  it('buck ripple: CCM triangle round Iout, DCM below ΔI/2 with the same average', () => {
    const c = BUCK_COILS[1]
    const r = buckRipple(12, 5, 1, c.henries, LM2596.sw.fHz)
    const dI = (7 * (5 / 12)) / (c.henries * 150e3)
    expect(r.ccm).toBe(true)
    expect(r.iMax - r.iMin).toBeCloseTo(dI, 9)
    const light = buckRipple(12, 5, 0.1, c.henries, LM2596.sw.fHz)
    expect(light.ccm).toBe(false)
    let sum = 0
    for (let k = 0; k < 10000; k++) sum += rippleAmps(light, (k + 0.5) / 10000)
    expect(sum / 10000).toBeCloseTo(0.1, 3)
    expect(rippleAmps(light, 0.99)).toBe(0)
    expect(outputRipple(0.5, 150e3, 220e-6, 0.08)).toBeCloseTo(0.04 + 0.5 / (8 * 150e3 * 220e-6), 9)
  })

  it('run-down: pack current climbs as the 2S pack sags, and the buck drops out near the end', () => {
    const run = runDown(LM2596, LI, 2, 5, 2)
    const first = run[0]
    const late = runAt(run, run[run.length - 1].hours * 0.8)
    expect(first.vpack).toBeLessThan(8.4)
    expect(late.point.iin).toBeGreaterThan(first.point.iin)
    expect(run[run.length - 1].point.regulating).toBe(false)
    const s2 = regulatedShare(LM2596, LI, 2, 5, 2)
    expect(s2.share).toBeGreaterThan(0.8)
    expect(s2.share).toBeLessThan(1)
    expect(s2.failAt?.limit).toBe('dropout')
    expect(regulatedShare(LM2596, LI, 3, 5, 2).share).toBe(1)
    expect(regulatedShare(LM2596, LI, 3, 12, 1).share).toBe(0)
    expect(regulatedShare(XL6009, LI, 3, 12, 1).share).toBe(1)
  })
})
