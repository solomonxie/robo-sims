import {
  TT_MOTOR,
  motorAmps,
  motorRpm,
  DRIVER_LIMIT_A,
  GEARBOXES,
  TT_THERMAL,
  armatureAmps,
  backEmf,
  coilShares,
  freeSpeed,
  gearEfficiency,
  gearRatio,
  loadedSpeed,
  motorPoint,
  motorTau,
  peakEfficiency,
  peakPower,
  shaftTorque,
  spinUp,
  stallAmps,
  stallRun,
  stallTorque,
  wheelDrive,
} from '.'

describe('DC motor', () => {
  it('stalls below I0·R, then holds the no-load current and spins ∝ back-EMF', () => {
    expect(motorAmps(0.5)).toBeCloseTo(0.1, 9)
    expect(motorRpm(0.5)).toBe(0)
    expect(motorAmps(5)).toBe(TT_MOTOR.noLoadA)
    expect(motorRpm(5)).toBeCloseTo(162, 0)
    expect(motorRpm(6)).toBeCloseTo(200, 0)
  })

  it('splits the supply into I·R + back-EMF, current falling as it speeds up', () => {
    const w = freeSpeed(5)
    expect(backEmf(w) + armatureAmps(5, w) * TT_MOTOR.ohms).toBeCloseTo(5, 9)
    expect(armatureAmps(5, w)).toBeCloseTo(TT_MOTOR.noLoadA, 9)
    expect(armatureAmps(5, 0)).toBe(stallAmps(5))
    expect(freeSpeed(5) * 60 / (2 * Math.PI) / 48).toBeCloseTo(motorRpm(5), 6)
    expect(spinUp(5, 0)).toBe(0)
    expect(spinUp(5, 5 * motorTau())).toBeCloseTo(w * (1 - Math.exp(-5)), 6)
    expect(spinUp(5, 1, stallTorque(5) * 2)).toBe(0)
  })

  it('has a straight torque–speed line with power peaking at half speed', () => {
    const ts = stallTorque(6)
    expect(shaftTorque(6, freeSpeed(6))).toBeCloseTo(0, 12)
    expect(shaftTorque(6, freeSpeed(6) / 2)).toBeCloseTo(ts / 2, 12)
    expect(ts * 48 * 0.73 * 100 / 9.81).toBeGreaterThan(1)
    const pp = peakPower(6)
    expect(motorPoint(6, pp.radS * 0.9).powerOut).toBeLessThan(pp.powerOut)
    const pe = peakEfficiency(6)
    expect(pe.radS).toBeGreaterThan(pp.radS)
    expect(motorPoint(6, pe.radS * 0.97).eff).toBeLessThan(pe.eff)
    expect(motorPoint(6, Math.min(freeSpeed(6), pe.radS * 1.03)).eff).toBeLessThan(pe.eff)
    expect(loadedSpeed(6, ts / 2)).toBeCloseTo(freeSpeed(6) / 2, 6)
    expect(loadedSpeed(6, ts)).toBeCloseTo(0, 6)
    expect(loadedSpeed(6, 0, TT_MOTOR, 1e-6)).toBeLessThan(freeSpeed(6))
  })

  it('commutates a 3-slot rotor: coil shares always sum to 0', () => {
    for (const th of [0, 0.3, Math.PI / 6, 1, 2.5, 4]) expect(coilShares(th).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9)
    expect(coilShares(Math.PI / 2)).toEqual([2 / 3, -1 / 3, -1 / 3])
    expect(coilShares(0)).toEqual([-1 / 3, 2 / 3, -1 / 3])
    expect(coilShares(-Math.PI / 2)).toEqual([-2 / 3, 1 / 3, 1 / 3])
  })

  it('heats a stalled winding until R rises; a PTC or current limit saves it', () => {
    const hot = stallRun(6, 'none')
    expect(hot[0].amps).toBeCloseTo(1.2, 9)
    expect(hot.at(-1)!.tempC).toBeGreaterThan(TT_THERMAL.maxC)
    expect(hot.at(-1)!.amps).toBeLessThan(1.2)
    expect(stallRun(3, 'none').at(-1)!.tempC).toBeLessThan(TT_THERMAL.maxC)
    const ptc = stallRun(6, 'ptc')
    const trip = ptc.find((f) => f.tripped)!
    expect(trip.t).toBeGreaterThan(0.5)
    expect(trip.t).toBeLessThan(3)
    expect(ptc.at(-1)!.tempC).toBeLessThan(40)
    expect(stallRun(3, 'ptc').some((f) => f.tripped)).toBe(false)
    expect(Math.max(...stallRun(6, 'limit').map((f) => f.amps))).toBe(DRIVER_LIMIT_A)
  })

  it('trades speed for torque in the gearbox', () => {
    expect(gearRatio(GEARBOXES.tt48)).toBe(48)
    expect(gearRatio(GEARBOXES.direct)).toBe(1)
    expect(gearEfficiency(GEARBOXES.tt48)).toBeCloseTo(0.729, 9)
    const flat = wheelDrive(5, GEARBOXES.tt48, 0)
    expect(flat.speed).toBeGreaterThan(0.4)
    expect(flat.speed).toBeLessThan(0.6)
    const slow = wheelDrive(5, GEARBOXES.tt120, 0)
    expect(slow.speed).toBeLessThan(flat.speed)
    expect(slow.maxN).toBeGreaterThan(flat.maxN)
    const direct = wheelDrive(5, GEARBOXES.direct, 0.26)
    expect(direct.speed).toBe(0)
    expect(direct.amps).toBe(stallAmps(5))
    const hill = wheelDrive(5, GEARBOXES.tt48, 0.26)
    expect(hill.speed).toBeLessThan(flat.speed)
    expect(hill.amps).toBeGreaterThan(flat.amps)
  })
})
