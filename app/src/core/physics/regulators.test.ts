import {
  AMS1117_33,
  BOOST_DEMO,
  BUCK_DEMO,
  ESP32_AMPS,
  boost,
  buck,
  dropoutVolts,
  inductorAmps,
  junctionC,
  ldoThermalStep,
  linearReg,
  rejectedRipple,
} from '.'

const r = AMS1117_33

describe('regulators', () => {
  it('AMS1117 holds 3.3 V from USB and burns the difference', () => {
    const s = linearReg(r, 5, ESP32_AMPS.transmit)
    expect(s.vout).toBe(3.3)
    expect(s.inDropout).toBe(false)
    expect(s.iin).toBeCloseTo(0.245, 6)
    expect(s.power).toBeCloseTo(1.7 * 0.24 + 5 * 0.005, 6)
    expect(s.efficiency).toBeCloseTo((3.3 * 0.24) / (5 * 0.245), 6)
    expect(dropoutVolts(r, 0.8)).toBeCloseTo(1.102, 3)
  })

  it('below Vout + dropout the output follows the input down', () => {
    const s = linearReg(r, 4, 0.5)
    expect(s.inDropout).toBe(true)
    expect(s.vout).toBeCloseTo(4 - 0.95 - 0.095, 6)
    expect(linearReg(r, 0.5, 0.1).vout).toBe(0)
  })

  it('heat: 12 V at 0.5 A is far past the junction limit, 5 V at 0.1 A is cool', () => {
    expect(junctionC(r, linearReg(r, 12, 0.5).power)).toBeGreaterThan(r.tOff)
    expect(junctionC(r, linearReg(r, 5, 0.1).power)).toBeLessThan(50)
  })

  it('thermal shutdown cycles the output with hysteresis', () => {
    let s = { tj: 25, on: true }
    const seen: boolean[] = []
    for (let i = 0; i < 6000; i++) {
      s = ldoThermalStep(r, s, 0.01, 12, 0.5)
      seen.push(s.on)
      expect(s.tj).toBeLessThan(r.tOff + 1)
    }
    expect(seen.filter((on, i) => i > 0 && on !== seen[i - 1]).length).toBeGreaterThan(4)
    let cool = { tj: 25, on: true }
    for (let i = 0; i < 6000; i++) cool = ldoThermalStep(r, cool, 0.01, 5, 0.1)
    expect(cool.on).toBe(true)
    expect(cool.tj).toBeCloseTo(junctionC(r, linearReg(r, 5, 0.1).power), 1)
  })

  it('75 dB rejection turns 1 V of ripple into under a millivolt', () => {
    expect(rejectedRipple(r, 1)).toBeCloseTo(1.78e-4, 6)
  })

  it('ideal buck: Vout = D·Vin, power in = power out', () => {
    const c = buck(BUCK_DEMO, 12, 0.25, 10, true)
    expect(c.vout).toBeCloseTo(3, 9)
    expect(c.efficiency).toBeCloseTo(1, 9)
    expect(c.iin).toBeCloseTo(0.075, 9)
    expect(c.ripple).toBeCloseTo((9 * 0.25) / 22, 9)
  })

  it('real buck: losses lower Vout and balance the energy', () => {
    const c = buck(BUCK_DEMO, 12, 0.5, 10)
    const i = c.iout
    expect(c.vout).toBeLessThan(6)
    expect(0.5 * (12 - i * 0.05) - 0.5 * 0.4 - i * 0.15).toBeCloseTo(c.vout, 9)
    const loss = i * i * (0.5 * 0.05 + 0.15) + 0.5 * 0.4 * i
    expect(12 * c.iin - c.vout * i).toBeCloseTo(loss, 9)
    expect(c.efficiency).toBeGreaterThan(0.9)
    expect(c.efficiency).toBeGreaterThan(linearReg(r, 12, i).efficiency)
  })

  it('ideal boost: Vout = Vin / (1 − D); real one peaks and falls', () => {
    expect(boost(BOOST_DEMO, 5, 0.5, 47, true).vout).toBeCloseTo(10, 9)
    expect(boost(BOOST_DEMO, 5, 0.5, 47, true).efficiency).toBeCloseTo(1, 9)
    const real = [0.5, 0.8, 0.95, 0.99].map((d) => boost(BOOST_DEMO, 5, d, 22).vout)
    expect(real[1]).toBeGreaterThan(real[0])
    expect(real[3]).toBeLessThan(real[2])
    const c = boost(BOOST_DEMO, 5, 0.6, 47)
    expect(5 * c.iin - c.vout * c.iout).toBeCloseTo(c.il * (c.il * (0.15 + 0.6 * 0.05) + 0.4 * 0.4), 9)
  })

  it('the lesson ranges stay in continuous conduction', () => {
    for (let d = 0.1; d <= 0.9001; d += 0.05)
      for (const load of [4.7, 22]) for (const ideal of [true, false]) expect(buck(BUCK_DEMO, 12, d, load, ideal).ccm).toBe(true)
    for (let d = 0.1; d <= 0.8501; d += 0.05)
      for (const load of [22, 100]) for (const ideal of [true, false]) expect(boost(BOOST_DEMO, 5, d, load, ideal).ccm).toBe(true)
  })

  it('inductor current ramps between iMin and iMax and averages to IL', () => {
    const c = buck(BUCK_DEMO, 12, 0.3, 10)
    expect(inductorAmps(c, 0.3, 0)).toBeCloseTo(c.iMin, 9)
    expect(inductorAmps(c, 0.3, 0.3)).toBeCloseTo(c.iMax, 9)
    let sum = 0
    for (let k = 0; k < 1000; k++) sum += inductorAmps(c, 0.3, (k + 0.5) / 1000)
    expect(sum / 1000).toBeCloseTo(c.il, 6)
  })
})
