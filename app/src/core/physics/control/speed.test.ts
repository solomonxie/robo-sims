import { RPM_PER_RADS, freeSpeed, motorK } from '../actuators/dcmotor'
import { stepMetrics } from './pid'
import { WHEEL, ffVolts, rampSp, wheelSpeedRun, speedStats, speedStep, stepSp, wheelCpr, wheelFf, wheelStep } from './speed'

const PI = { kp: 0.005, ki: 0.08, kd: 0, antiWindup: 'clamp' as const }
const sp = stepSp(140, 0.2)
const ramp = { at: 1.6, deg: 15 }
const flat = (r: ReturnType<typeof wheelSpeedRun>) => speedStats(r, 1, 1.6)
const climb = (r: ReturnType<typeof wheelSpeedRun>) => speedStats(r, 2.4, 3)

describe('wheel speed loop', () => {
  test('encoder counts and speed step', () => {
    expect(wheelCpr('hall')).toBe(2112)
    expect(wheelCpr('slot')).toBe(80)
    expect(speedStep('slot', 0.01)).toBeCloseTo(75)
    expect(speedStep('hall', 0.1)).toBeCloseTo(60 / 211.2)
  })

  test('plant: free speed matches the motor model; friction holds it at rest', () => {
    let w = 0
    for (let k = 0; k < 4000; k++) w = wheelStep(w, WHEEL.volts, 0, WHEEL.dt)
    expect(w).toBeLessThan(freeSpeed(WHEEL.volts))
    expect(w).toBeGreaterThan(0.95 * freeSpeed(WHEEL.volts))
    expect(wheelStep(0, 0.5, 0, WHEEL.dt)).toBe(0)
    expect(motorK()).toBeGreaterThan(0)
  })

  test('feed-forward alone holds the calibrated speed, and drops with a flat pack', () => {
    const f = wheelFf()
    expect(ffVolts(100, 0, f)).toBeCloseTo(f.kS + 100 * f.kV)
    const prof = rampSp([[0, 0], [0.2, 0], [0.8, 180], [3, 180]])
    expect(Math.abs(speedStats(wheelSpeedRun({ sp: prof, seconds: 3, enc: 'hall', ff: true }), 1.5).meanErr)).toBeLessThan(1)
    expect(speedStats(wheelSpeedRun({ sp: prof, seconds: 3, enc: 'hall', ff: true, volts: 6.6 }), 1.5).meanErr).toBeGreaterThan(20)
    expect(Math.abs(speedStats(wheelSpeedRun({ sp: prof, seconds: 3, enc: 'hall', ff: true, pid: PI, volts: 6.6 }), 1.5).meanErr)).toBeLessThan(1)
  })

  test('FF tracks a ramp profile better than feedback alone', () => {
    const prof = rampSp([[0, 0], [0.2, 0], [0.8, 180], [1.6, 180], [2, 80], [3, 80]])
    const fb = speedStats(wheelSpeedRun({ sp: prof, seconds: 3, enc: 'hall', pid: PI }), 0.2)
    const both = speedStats(wheelSpeedRun({ sp: prof, seconds: 3, enc: 'hall', pid: PI, ff: true }), 0.2)
    expect(both.rmsErr).toBeLessThan(fb.rmsErr / 3)
  })

  test('open loop sags on a ramp; PI on encoders recovers', () => {
    expect(climb(wheelSpeedRun({ sp, seconds: 3, enc: null, ramp })).meanErr).toBeGreaterThan(25)
    expect(Math.abs(climb(wheelSpeedRun({ sp, seconds: 3, enc: 'hall', pid: PI, ramp })).meanErr)).toBeLessThan(1)
  })

  test('coarse encoder makes the duty buzz; a long window makes the loop swing', () => {
    const hall = flat(wheelSpeedRun({ sp, seconds: 3, enc: 'hall', pid: PI }))
    const slot = flat(wheelSpeedRun({ sp, seconds: 3, enc: 'slot', pid: PI }))
    const slow = flat(wheelSpeedRun({ sp, seconds: 3, enc: 'slot', window: 20, pid: PI }))
    expect(slot.jitter).toBeGreaterThan(10 * hall.jitter)
    expect(slow.rmsErr).toBeGreaterThan(5 * slot.rmsErr)
  })

  test('P leaves a speed error, I removes it, D amplifies count noise', () => {
    const p = flat(wheelSpeedRun({ sp, seconds: 3, enc: 'hall', pid: { ...PI, ki: 0 } }))
    expect(p.meanErr).toBeGreaterThan(20)
    const pi = wheelSpeedRun({ sp, seconds: 3, enc: 'hall', pid: PI })
    expect(Math.abs(flat(pi).meanErr)).toBeLessThan(0.5)
    expect(stepMetrics(pi.slice(0, 160).map((f) => f.rpm), WHEEL.loopS, 20, 0, 140).overshoot).toBeLessThan(0.05)
    const pid = flat(wheelSpeedRun({ sp, seconds: 3, enc: 'hall', pid: { ...PI, kd: 0.0003, dOnMeas: true } }))
    expect(pid.jitter).toBeGreaterThan(20 * flat(pi).jitter)
    expect(RPM_PER_RADS).toBeCloseTo(9.549, 2)
  })
})
