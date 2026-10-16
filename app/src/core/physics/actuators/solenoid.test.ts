import {
  SOLENOID_12V as S,
  coilLimitS,
  coilSteadyC,
  coilWatts,
  maxDutyCycle,
  pwmHoldAmps,
  solenoidDropOutAmps,
  solenoidDuty,
  solenoidForceN,
  solenoidGapB,
  solenoidHenries,
  solenoidPullInAmps,
  solenoidRun,
  solenoidSummary,
} from './index'

const full = S.volts / S.ohms

describe('solenoid force', () => {
  it('rises ~25× from open to seated at the same current', () => {
    expect(solenoidForceN(full, 0) / solenoidForceN(full, S.strokeM)).toBeCloseTo(25)
    expect(solenoidForceN(full, S.strokeM)).toBeGreaterThan(S.springN)
  })
  it('stays below iron saturation', () => {
    expect(solenoidGapB(full, 0)).toBeLessThan(1.6)
  })
  it('inductance grows as the gap closes', () => {
    expect(solenoidHenries(0)).toBeCloseTo(5 * solenoidHenries(S.strokeM))
  })
  it('pull-in needs far more current than holding', () => {
    expect(solenoidPullInAmps(1) / solenoidDropOutAmps(1)).toBeCloseTo(5)
    expect(solenoidPullInAmps(1)).toBeLessThan(full)
    expect(solenoidPullInAmps(3)).toBeGreaterThan(full)
    expect(pwmHoldAmps(0.25)).toBeGreaterThan(solenoidDropOutAmps(1))
  })
})

describe('coil heat', () => {
  it('full power cooks it; a 25 % hold runs cool', () => {
    expect(coilSteadyC(coilWatts(full))).toBeGreaterThan(S.maxC)
    expect(coilLimitS(coilWatts(full))).toBeCloseTo(48.7, 0)
    expect(maxDutyCycle(coilWatts(full))).toBeCloseTo(1 / 3)
    expect(coilWatts(pwmHoldAmps(0.25))).toBeLessThan(coilWatts(full) / 16)
    expect(coilLimitS(coilWatts(pwmHoldAmps(0.25)))).toBe(Infinity)
  })
})

describe('solenoid drive', () => {
  const base = { holdDuty: 0.25, loadN: 1, diode: true }
  it('duty: full peak then hold', () => {
    const o = { ...base, drive: 'peakhold' as const }
    expect([solenoidDuty(0, o), solenoidDuty(10e-3, o), solenoidDuty(50e-3, o), solenoidDuty(90e-3, o)]).toEqual([0, 1, 0.25, 0])
  })
  it('peak-and-hold seats, holds on a quarter of the current, then releases', () => {
    const o = { ...base, drive: 'peakhold' as const }
    const s = solenoidSummary(solenoidRun(o), o)
    expect(s.seatS).toBeLessThan(30e-3)
    expect(s.held).toBe(true)
    expect(s.holdAmps).toBeCloseTo(pwmHoldAmps(0.25), 1)
    expect(s.releaseS).not.toBeNull()
    expect(s.peakDrainV).toBeLessThan(14)
  })
  it('the moving plunger dips the current', () => {
    const o = { ...base, drive: 'full' as const }
    const f = solenoidRun(o).frames
    const seat = f.findIndex((x) => x.gapM <= 0)
    const before = f.slice(0, seat).filter((x) => x.t > 6e-3)
    const peak = Math.max(...before.map((x) => x.amps))
    expect(f[seat].amps).toBeLessThan(peak)
  })
  it('PWM alone never pulls in', () => {
    const o = { ...base, drive: 'pwm' as const }
    expect(solenoidSummary(solenoidRun(o), o).seatS).toBeNull()
  })
  it('without a diode the hold collapses and the drain avalanches', () => {
    const o = { ...base, drive: 'peakhold' as const, diode: false }
    const run = solenoidRun(o)
    const s = solenoidSummary(run, o)
    expect(s.held).toBe(false)
    expect(s.peakDrainV).toBe(55)
    expect(run.avalancheJ).toBeGreaterThan(0)
  })
  it('too heavy a load stalls even at full current', () => {
    const o = { ...base, drive: 'full' as const, loadN: 3 }
    expect(solenoidSummary(solenoidRun(o), o).seatS).toBeNull()
  })
})
