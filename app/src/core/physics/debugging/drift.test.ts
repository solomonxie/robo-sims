import { medianMs } from '../../stopwatch'
import { TT_MOTOR } from '../actuators/dcmotor'
import { turnRadius } from '../mobility/diffdrive'
import { straightCal } from '../navigation/odometry'
import { pwmWheelSpeed } from '../projects/robocar'
import { TT_TRACK_M, TT_WHEEL_MM, headingDrift } from '../sensors/encoder'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import { DRIFT_BOT, MISMATCH_HUNT, ODO_BOT, WHEELSIZE_HUNT, driftPath, driftWheel, inoMap, motorMismatch, odoSetup, tprOf, wheelSizeError } from './drift'

const HUNTS = [MISMATCH_HUNT, WHEELSIZE_HUNT] as unknown as FaultHunt<string, string>[]

describe('drift faults', () => {
  it('every hunt separates every fault, and each differs from the healthy build', () => {
    for (const h of HUNTS) {
      const t = faultTable(h)
      for (const f of h.faults) {
        expect(h.probes.some((p) => !sameReading(t.ok[p], t[f][p]))).toBe(true)
        expect(stillSuspect(h, f, h.probes)).toEqual([f])
        expect(probesNeeded(h, f).length).toBeGreaterThan(0)
      }
    }
  })
  it('a wheel: on the floor it matches the robo-car’s PWM speed; wheels up it runs faster at the no-load current', () => {
    const d = inoMap(DRIFT_BOT.speed, 0, 100, 0, 255) / 255
    expect(inoMap(70, 0, 100, 0, 255)).toBe(178)
    expect(inoMap(70, 0, 100, 0, 230)).toBe(161)
    expect(driftWheel(d).speed).toBeCloseTo(pwmWheelSpeed(d), 9)
    const up = driftWheel(d, { share: 0 })
    expect(up.speed).toBeGreaterThan(driftWheel(d).speed)
    expect(up.amps).toBeCloseTo(TT_MOTOR.noLoadA, 9)
  })
  it('mismatch: slow motor and low PWM curve right, the slow one at full volts, the low one at less; a rub draws more; weight only shows on the floor', () => {
    const ok = motorMismatch('ok')
    expect(ok.reads.trail.value).toBeCloseTo(0, 6)
    expect(ok.reads.trail.label).toBe('straight')
    const slow = motorMismatch('motor')
    expect(slow.up[1].rpm / ok.up[1].rpm).toBeCloseTo(1 / DRIFT_BOT.slowK, 2)
    expect(slow.up[1].amps).toBeCloseTo(ok.up[1].amps, 9)
    expect(slow.reads.trail.value).toBeGreaterThan(200)
    expect(slow.reads.trail.label).toBe('veers R')
    const pwm = motorMismatch('pwm')
    expect(pwm.pwm).toEqual([178, 161])
    expect(pwm.reads.volts.value).toBeLessThan(ok.reads.volts.value * 0.95)
    expect(motorMismatch('rub').reads.amps.value).toBeGreaterThan(ok.reads.amps.value + 0.04)
    const w = motorMismatch('weight')
    expect(w.up).toEqual(ok.up)
    expect(w.floor[1].speed).toBeLessThan(w.floor[0].speed)
    expect(w.reads.trail.value).toBeGreaterThan(30)
    // The path is an arc about the ICC: offset = R (1 − cos θ).
    const R = Math.abs(turnRadius(slow.floor[0].speed, slow.floor[1].speed, TT_TRACK_M))
    expect(slow.reads.trail.value / 1000).toBeCloseTo(R * (1 - Math.cos(slow.end.th)), 9)
  })
  it('path: straight when the wheels match, samples evenly', () => {
    const p = driftPath(0.5, 0.5, 2)
    expect(p).toHaveLength(DRIFT_BOT.samples + 1)
    expect(p[p.length - 1]).toEqual({ x: 1, y: 0, th: 0 })
  })
  it('wheel size: the healthy car agrees with the tape; each wrong number scales distance or spin as the ratio says', () => {
    const ok = wheelSizeError('ok')
    expect(tprOf(48)).toBe(2112)
    expect(ok.drive.tapeMm).toBeCloseTo(1000, -1)
    expect(ok.spin.realDeg).toBeCloseTo(360, 0)
    expect(wheelSizeError('dia').drive.tapeMm / 1000).toBeCloseTo(straightCal((TT_WHEEL_MM / ODO_BOT.codeMm - 1) * 100, 1, ODO_BOT.codeMm).realM, 3)
    expect(wheelSizeError('gear').drive.tapeMm).toBeCloseTo(400, -1)
    expect(wheelSizeError('track').spin.realDeg).toBeCloseTo((360 * ODO_BOT.codeTrackM) / TT_TRACK_M, 0)
    expect(wheelSizeError('track').reads.trail.value).toBeCloseTo(0, 6)
    const t = wheelSizeError('tyre')
    expect(t.drive.offsetMm).toBeGreaterThan(80)
    expect(t.drive.end.th).toBeCloseTo(headingDrift((t.drive.dL + t.drive.dR) / 2, ODO_BOT.smallMm / TT_WHEEL_MM, TT_TRACK_M), 9)
    expect(odoSetup('gear').tpr).toBe(5280)
  })
  it('speed: both tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
