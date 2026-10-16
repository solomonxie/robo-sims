import {
  NEMA17,
  availableAmps,
  chopCurrent,
  lostSteps,
  missedStepRun,
  moveProfile,
  peakOvershoot,
  phaseCurrents,
  pullOutNm,
  rpmToRadS,
  sineErrorPct,
  slipAt,
  stallDiag,
  stallGuardResult,
  stepDeg,
  stepperRun,
  stepsPerRev,
  tableAngle,
  torquePerMicrostep,
  vrefAmps,
} from './stepper'

const move = (rpm: number, acc: number, load: number) => missedStepRun(1600, (rpm * 200) / 60, acc, load, 1.6)

describe('full, half and micro-steps', () => {
  it('200 full steps a rev; microsteps divide the 1.8° step', () => {
    expect(stepDeg(1)).toBeCloseTo(1.8)
    expect(stepsPerRev(16)).toBe(3200)
    expect(stepDeg(16)).toBeCloseTo(0.1125)
  })
  it('full step drives both phases at 70.7 %; half step alternates one and two phases; the table is a sine', () => {
    expect(phaseCurrents(0, 1).a).toBeCloseTo(Math.SQRT1_2)
    expect(phaseCurrents(1, 1).a).toBeCloseTo(-Math.SQRT1_2)
    expect(phaseCurrents(1, 2).a).toBeCloseTo(0)
    expect(phaseCurrents(1, 2).b).toBeCloseTo(1)
    for (let k = 0; k < 64; k++) expect(Math.hypot(phaseCurrents(k, 16).a, phaseCurrents(k, 16).b)).toBeCloseTo(1)
    expect(tableAngle(4, 1) - tableAngle(0, 1)).toBeCloseTo(2 * Math.PI)
  })
  it('finer microsteps hold each step with far less torque', () => {
    expect(torquePerMicrostep(1)).toBeCloseTo(NEMA17.holdNm)
    expect(torquePerMicrostep(16)).toBeCloseTo(NEMA17.holdNm * 0.098, 3)
  })
  it('full steps snap and ring past each detent; 1/16 microsteps glide', () => {
    const full = peakOvershoot(stepperRun(1, 25, 0.16))
    const micro = peakOvershoot(stepperRun(16, 25, 0.16))
    expect(full).toBeGreaterThan(0.5)
    expect(micro).toBeLessThan(0.15)
  })
})

describe('A4988 and TMC drivers', () => {
  it('Vref sets the current limit', () => {
    expect(vrefAmps('a4988', 0.8)).toBeCloseTo(1.47, 2)
    expect(vrefAmps('stealth', 1.2)).toBeCloseTo(1.2, 2)
  })
  it('A4988 stairs and chopper ripple stray further from a sine than StealthChop', () => {
    expect(sineErrorPct('a4988')).toBeGreaterThan(5)
    expect(sineErrorPct('stealth')).toBeLessThan(1)
    expect(sineErrorPct('spread')).toBeGreaterThan(sineErrorPct('stealth'))
    expect(chopCurrent('stealth', 0, 1)).toBeCloseTo(1, 1)
  })
  it('StallGuard falls with load and trips DIAG before the rotor slips', () => {
    expect(stallGuardResult(0, 0.4)).toBe(510)
    expect(stallDiag(stallGuardResult(0.2, 0.4))).toBe(false)
    expect(stallDiag(stallGuardResult(0.36, 0.4))).toBe(true)
  })
})

describe('missed steps', () => {
  it('pull-out torque is flat at low speed, then back-EMF and inductance choke the current', () => {
    expect(pullOutNm(0)).toBeCloseTo(0.4)
    expect(pullOutNm(rpmToRadS(800))).toBeLessThan(0.2)
    expect(pullOutNm(rpmToRadS(900))).toBe(0)
    expect(availableAmps(rpmToRadS(700), 1.5, 12)).toBeLessThan(availableAmps(rpmToRadS(700), 1.5, 24))
  })
  it('a trapezoid move reaches its target with a ramp or without', () => {
    expect(moveProfile(10, 1600, 2000, 4000).pos).toBe(1600)
    expect(moveProfile(0.25, 1600, 2000, 4000).v).toBeCloseTo(1000)
    expect(moveProfile(0.1, 1600, 2000, Infinity).pos).toBeCloseTo(200)
  })
  it('a gentle ramp keeps step; jumping to speed loses steps, open loop never notices', () => {
    expect(lostSteps(move(600, 4000, 0))).toBe(0)
    expect(slipAt(move(600, 4000, 0))).toBeNull()
    expect(lostSteps(move(600, Infinity, 0))).toBeGreaterThan(100)
    expect(lostSteps(move(60, Infinity, 0))).toBe(0)
  })
  it('load plus J·a beyond the pull-out torque slips whole teeth (4 full steps each)', () => {
    expect(lostSteps(move(300, 16000, 0.3)) % 4).toBe(0)
    expect(lostSteps(move(300, 16000, 0.3))).toBeGreaterThan(0)
    expect(lostSteps(move(300, 4000, 0.3))).toBe(0)
    expect(lostSteps(move(800, 4000, 0.3))).toBeGreaterThan(0)
  })
})
