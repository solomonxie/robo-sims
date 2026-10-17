import { medianMs } from '../../stopwatch'
import { G } from '../common'
import { CHASSIS, MOTOR_LEAD, balanceSweep, cableRoute, chassisBalance, chassisLayout, couplingSpike, driveLoadN, flatMutual, sclTrace, sideMargin, twistResidual } from './chassis'

describe('layout and balance', () => {
  it('battery forward puts more weight on the drive wheels and lifts the accel limit, but braking tips sooner', () => {
    const back = chassisBalance(chassisLayout(-0.09, 'low', 0.1, 'axle'), 0.1)
    const fwd = chassisBalance(chassisLayout(0.02, 'low', 0.1, 'axle'), 0.1)
    expect(fwd.share).toBeGreaterThan(back.share)
    expect(fwd.accel).toBeGreaterThan(back.accel)
    expect(fwd.brake).toBeLessThan(back.brake)
    expect(fwd.brakeBy).toBe('tips')
    expect(back.stable && fwd.stable).toBe(true)
  })
  it('a top deck raises the CoM: lower turn-tip and brake limits', () => {
    const lo = chassisBalance(chassisLayout(0, 'low', 0.1, 'axle'), 0.1)
    const hi = chassisBalance(chassisLayout(0, 'top', 0.1, 'axle'), 0.1)
    expect(hi.h).toBeGreaterThan(lo.h)
    expect(hi.turnTip).toBeLessThan(lo.turnTip)
    expect(hi.brake).toBeLessThan(lo.brake)
  })
  it('drive load: static share, shifts off the drive axle when accelerating', () => {
    expect(driveLoadN(1, -0.05, 0.03, 0.1)).toBeCloseTo(G / 2, 6)
    expect(driveLoadN(1, -0.05, 0.03, 0.1, 2)).toBeLessThan(G / 2)
  })
  it('side margin is zero on the triangle edge and negative outside', () => {
    expect(sideMargin(-0.05, CHASSIS.track / 4, 0.1, CHASSIS.track)).toBeCloseTo(0, 9)
    expect(sideMargin(-0.09, 0.05, 0.1, CHASSIS.track)).toBeLessThan(0)
    expect(sideMargin(0, 0, 0.1, CHASSIS.track)).toBeGreaterThan(0)
  })
  it('IMU off the axle sees the spin as ω²r', () => {
    const a = chassisBalance(chassisLayout(0, 'low', 0.1, 'axle'), 0.1)
    const f = chassisBalance(chassisLayout(0, 'low', 0.1, 'front'), 0.1)
    expect(f.imuAccel).toBeGreaterThan(5 * a.imuAccel)
    expect(f.imuAccel).toBeCloseTo((2 * Math.PI * CHASSIS.spinHz) ** 2 * f.imuR, 9)
  })
  it('a battery behind the caster tips back: limits go to 0 in the sweep', () => {
    const s = balanceSweep('low', 0.06, 'axle', -0.2, 0.04)
    expect(s[0].share).toBeLessThan(0)
    expect(s[0].accel).toBe(0)
    expect(s.some((p) => p.accel > 0)).toBe(true)
  })
})

describe('cable routing', () => {
  it('mutual inductance falls about as 1/d² far away', () => {
    const r = flatMutual(0.003, 0.003, 0.05) / flatMutual(0.003, 0.003, 0.1)
    expect(r).toBeGreaterThan(3.3)
    expect(r).toBeLessThan(4.5)
  })
  it('pairing then twisting cuts the spike; distance cuts it more', () => {
    const l = couplingSpike('loose', 0.005, 0.15).volts
    const p = couplingSpike('paired', 0.005, 0.15).volts
    const t = couplingSpike('twisted', 0.005, 0.15).volts
    expect(p).toBeLessThan(l)
    expect(t).toBeLessThan(p / 2)
    expect(couplingSpike('loose', 0.05, 0.15).volts).toBeLessThan(l / 10)
    expect(twistResidual(0, 0.01, 0.1)).toBe(1)
  })
  it('loose wires next to I²C glitch; thin long leads sag and heat', () => {
    expect(cableRoute('loose', 0.003, 22, 0.3).verdict).toBe('glitch')
    expect(cableRoute('twisted', 0.03, 22, 0.3).verdict).toBe('ok')
    const thin = cableRoute('twisted', 0.03, 30, 0.6)
    const thick = cableRoute('twisted', 0.03, 20, 0.6)
    expect(thin.dropFrac).toBeGreaterThan(5 * thick.dropFrac)
    expect(thin.run.tempC).toBeGreaterThan(thick.run.tempC)
    expect(thin.verdict).not.toBe('ok')
  })
  it('SCL trace: square wave plus spikes at the PWM edges', () => {
    expect(sclTrace(1e-6, 0)).toBe(MOTOR_LEAD.vdd)
    expect(sclTrace(6e-6, 0)).toBe(0)
    expect(sclTrace(0, 0.5)).toBeCloseTo(MOTOR_LEAD.vdd + 0.5, 9)
    expect(sclTrace(0.3 / MOTOR_LEAD.pwmHz, 0.5)).toBeLessThan(MOTOR_LEAD.vdd)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => balanceSweep('top', 0.12, 'front', -0.15, 0.04))).toBeLessThan(50)
    expect(medianMs(() => cableRoute('twisted', 0.01, 26, 0.4))).toBeLessThan(50)
  })
})
