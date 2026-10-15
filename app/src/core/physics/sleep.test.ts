import {
  NODE_CELLS,
  POWER_MODES,
  averageAmps,
  bootPhases,
  lifeYears,
  lightBreakEvenS,
  modemSleepAmps,
  nodeCycle,
  stepAt,
  phaseCharge,
  phaseTime,
} from './sleep'

describe('ESP32 power modes', () => {
  it('each mode switches more domains off and draws less', () => {
    const a = (['active', 'modem', 'light', 'deep'] as const).map((m) => POWER_MODES[m].amps)
    a.slice(1).forEach((x, i) => expect(x).toBeLessThan(a[i] / 5))
    expect(POWER_MODES.deep.domains).toMatchObject({ cpu: 'off', ram: 'off', rtcMem: 'on' })
    expect(POWER_MODES.light.domains).toMatchObject({ cpu: 'held', ram: 'held' })
    expect(POWER_MODES.deep.resumes).toBe(false)
  })
  it('modem sleep is the CPU plus a beacon-catching radio duty', () => {
    expect(modemSleepAmps(1)).toBeCloseTo(0.015 + 0.1 * 0.004 / 0.1024)
    expect(modemSleepAmps(10)).toBeLessThan(modemSleepAmps(1))
  })
})

describe('waking from deep sleep', () => {
  it('a wake is a reboot whose length matches the deep-sleep wake time', () => {
    expect(phaseTime(bootPhases(false))).toBeCloseTo(POWER_MODES.deep.wakeS)
    expect(phaseTime(bootPhases(true))).toBeLessThan(0.07)
  })
  it('one boot costs as much charge as minutes of deep sleep', () => {
    const c = phaseCharge(bootPhases(false))
    expect(c / POWER_MODES.deep.amps / 60).toBeGreaterThan(10)
    expect(lightBreakEvenS(c)).toBeCloseTo(9.9, 0)
    expect(lightBreakEvenS(phaseCharge(bootPhases(true)))).toBeLessThan(4)
  })
  it('finds the phase at a time and wraps', () => {
    const ps = bootPhases(false)
    expect(stepAt(ps, 0.03)).toEqual({ i: 1, into: expect.closeTo(0.01) })
    expect(stepAt(ps, 0.19 + 0.005).i).toBe(0)
  })
})

describe('sensor node battery', () => {
  it('the sleep fills the rest of the interval and the average is charge over time', () => {
    const c = nodeCycle(600, 'espnow')
    expect(phaseTime(c)).toBeCloseTo(600)
    expect(averageAmps(c)).toBeCloseTo(25e-6, 6)
  })
  it('Wi-Fi joins dominate; ESP-NOW lasts years', () => {
    const wifi = averageAmps(nodeCycle(600, 'wifi'))
    expect(wifi).toBeGreaterThan(10 * averageAmps(nodeCycle(600, 'espnow')))
    expect(lifeYears('aa2', averageAmps(nodeCycle(600, 'espnow')))).toBeGreaterThan(5)
    expect(lifeYears('li18650', wifi)).toBeLessThan(1)
  })
  it('self-discharge caps an idle Li-ion cell at a few years', () => {
    expect(lifeYears('li18650', 0)).toBeCloseTo(1 / NODE_CELLS.li18650.selfPerYear)
    expect(lifeYears('aa2', 1e-6)).toBeGreaterThan(lifeYears('li18650', 1e-6))
  })
})
