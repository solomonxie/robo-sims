import { CALIBRATED, ENC_MM_TICK, ROLL_FLOORS, calibratedDistance, closedLoopRun, encoderRead, openLoopRun, pDeadband, stallDuty, trialConditions, wheelSpeedSs } from './loop'

const D = calibratedDistance()
const end = (c: typeof CALIBRATED) => openLoopRun(c, D).at(-1)!

describe('open-loop timed move', () => {
  it('lands about 1.1 m on the calibrated pack and floor', () => {
    expect(D).toBeGreaterThan(1)
    expect(D).toBeLessThan(1.2)
    expect(Math.abs(end(CALIBRATED).pose.y)).toBeLessThan(1e-9)
  })
  it('falls short on a sagging pack, heavier load or carpet', () => {
    expect(end({ ...CALIBRATED, volts: 6.4 }).pose.x).toBeLessThan(0.8 * D)
    expect(end({ ...CALIBRATED, payloadKg: 1 }).pose.x).toBeLessThan(D)
    expect(end({ ...CALIBRATED, crr: ROLL_FLOORS.carpet.crr }).pose.x).toBeLessThan(0.97 * D)
  })
  it('curves with a motor mismatch and scatters run to run', () => {
    expect(end({ ...CALIBRATED, mismatch: 0.02 }).pose.y).toBeGreaterThan(0.05)
    const xs = [0, 1, 2, 3].map((k) => end(trialConditions(CALIBRATED, k)).pose.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.01)
    expect(trialConditions(CALIBRATED, 2)).toEqual(trialConditions(CALIBRATED, 2))
  })
  it('stalls below the friction duty and reverses with negative volts', () => {
    expect(wheelSpeedSs(0.05 * 8.4, 0, 0.015)).toBe(0)
    expect(wheelSpeedSs(-5, 0, 0.015)).toBeCloseTo(-wheelSpeedSs(5, 0, 0.015))
    expect(stallDuty({ ...CALIBRATED, crr: ROLL_FLOORS.carpet.crr })).toBeGreaterThan(stallDuty(CALIBRATED))
  })
})

describe('closed loop on encoders', () => {
  it('quantises to ticks', () => {
    expect(encoderRead(0.5, 0, 1) / (ENC_MM_TICK / 1000)).toBeCloseTo(Math.round(0.5 / (ENC_MM_TICK / 1000)))
  })
  it('reaches the target despite sag, load, carpet and a shove, short by the P deadband', () => {
    const c = { volts: 6.6, payloadKg: 0.5, crr: ROLL_FLOORS.carpet.crr, mismatch: 0.03 }
    const f = closedLoopRun(c, { target: D, kp: 4, shove: { at: 1.5, kick: 0.3 } }).at(-1)!
    expect(f.pose.x).toBeLessThan(D)
    expect(D - f.pose.x).toBeLessThan(pDeadband(c, 4) + 0.005)
    expect(Math.abs(f.pose.y)).toBeLessThan(0.02)
  })
  it('higher gain leaves less error; noise jitters the command', () => {
    const e = (kp: number) => D - closedLoopRun(CALIBRATED, { target: D, kp }).at(-1)!.pose.x
    expect(e(10)).toBeLessThan(e(3))
    const tail = (noiseM: number) => closedLoopRun(CALIBRATED, { target: D, kp: 6, noiseM }).filter((f) => f.t > 3).map((f) => f.uL)
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
    expect(span(tail(0.005))).toBeGreaterThan(span(tail(0)) + 0.02)
  })
})
