import {
  accelTilt,
  balanceRun,
  bodyAccel,
  calibrateBias,
  combChange,
  compAlpha,
  compStep,
  compTau,
  coriolisAccel,
  countsToDps,
  driftRun,
  driveSpeed,
  gyroBiasAt,
  gyroCounts,
  headingPath,
  integrateRate,
  proofShift,
  residualBias,
  angleRms,
  yawProfile,
} from './imu'

const DEG = Math.PI / 180

describe('IMU', () => {
  it('flat and still reads 1 g up; tilt comes back from gravity', () => {
    expect(bodyAccel(0, 0)).toEqual([0, 0, 1])
    expect(accelTilt(bodyAccel(20 * DEG, 0))).toBeCloseTo(20 * DEG, 9)
  })

  it('forward acceleration reads as tilt: error = atan(a)', () => {
    expect(accelTilt(bodyAccel(10 * DEG, -0.3)) - 10 * DEG).toBeCloseTo(-Math.atan(0.3), 9)
    const s = 15 * DEG
    const f = bodyAccel(s, 0.2 * Math.cos(s), 0.2 * Math.sin(s))
    expect(f[0]).toBeCloseTo(Math.sin(s) + 0.2, 9)
    expect(f[2]).toBeCloseTo(Math.cos(s), 9)
  })

  it('a 2.5 kHz proof mass moves ~40 nm per g', () => {
    expect(proofShift(1, 2500)).toBeCloseTo(3.98e-8, 9)
    expect(combChange(4e-8, 2e-6)).toBeCloseTo(0.02, 6)
  })

  it('Coriolis: 10 µm at 30 kHz turning 100 °/s gives ~6.6 m/s²', () => {
    const v = driveSpeed(10e-6, 30e3)
    expect(v).toBeCloseTo(1.885, 3)
    expect(coriolisAccel(100 * DEG, v)).toBeCloseTo(6.58, 2)
  })

  it('gyro counts clip at full scale; summing rates gives the angle', () => {
    expect(gyroCounts(100, 250)).toBe(13100)
    expect(gyroCounts(400, 250)).toBe(32767)
    expect(countsToDps(gyroCounts(400, 2000), 2000)).toBeCloseTo(400, 1)
    expect(integrateRate([90, 90, 90, 90], 0.25).at(-1)).toBe(90)
  })

  it('yaw profile turns left fast, back slow, ending where it began', () => {
    const dt = 0.001
    const rates = Array.from({ length: 3000 }, (_, k) => yawProfile(k * dt, 400))
    expect(Math.max(...rates)).toBeCloseTo(400, 0)
    expect(Math.min(...rates)).toBeCloseTo(-100, 0)
    expect(integrateRate(rates, dt).at(-1)).toBeCloseTo(0, 6)
    const clipped = integrateRate(rates.map((r) => countsToDps(gyroCounts(r, 250), 250)), dt).at(-1)!
    expect(clipped).toBeLessThan(-20)
  })

  it('complementary filter: α ↔ τ, and it settles on the accel angle', () => {
    expect(compAlpha(0.99, 0.01)).toBeCloseTo(0.99, 6)
    expect(compTau(compAlpha(0.5, 0.01), 0.01)).toBeCloseTo(0.5, 9)
    let a = 0
    for (let k = 0; k < 2000; k++) a = compStep(a, 0, 0.3, 0.01, 0.98)
    expect(a).toBeCloseTo(0.3, 6)
  })

  it('fused beats raw accel (noise) and raw gyro (drift)', () => {
    const r = balanceRun(0.98, 2, 20)
    const e = (x: number[]) => angleRms(x, r.truth)
    expect(e(r.fused)).toBeLessThan(e(r.accel) / 2)
    expect(e(r.fused)).toBeLessThan(e(r.gyro) / 5)
    expect(Math.abs(r.gyro.at(-1)! - r.truth.at(-1)!)).toBeGreaterThan(30 * DEG)
  })

  it('bias drifts with temperature; a still calibration removes most of it', () => {
    expect(gyroBiasAt(25)).toBeCloseTo(1.6, 9)
    expect(calibrateBias(500, 25)).toBeCloseTo(1.6, 2)
    expect(Math.abs(residualBias('rest', 25))).toBeLessThan(0.01)
    expect(residualBias('rest', 45)).toBeCloseTo(0.9, 1)
    expect(Math.abs(residualBias('temp', 45))).toBeLessThan(0.01)
    expect(driftRun(1.6, 60).at(-1)).toBeCloseTo(96, 0)
    expect(headingPath([0, 0], 1, 0.5).at(-1)).toEqual([1, 0])
    expect(headingPath([90], 2, 1)[0][1]).toBeCloseTo(2, 9)
  })
})
