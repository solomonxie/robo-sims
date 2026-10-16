import {
  CR_SERVO,
  ESP32_BOD,
  SERVO_SPECS,
  crRpm,
  overshootDeg,
  pulseForDeg,
  railSummary,
  servoDuty,
  servoLoopRun,
  servoRailRun,
  servoRest,
  servoSettleS,
  usToDeg,
} from '.'

describe('pulse to angle', () => {
  it('maps each servo range onto 0–180°', () => {
    expect(pulseForDeg(90, [500, 2500])).toBe(1500)
    expect(pulseForDeg(200, [1000, 2000])).toBe(2000)
    expect(servoRest(1500, SERVO_SPECS.wide).deg).toBe(90)
    expect(servoRest(2000, SERVO_SPECS.wide).deg).toBe(135)
    expect(servoRest(1000, SERVO_SPECS.narrow).deg).toBe(0)
  })
  it('pins at the end stop and buzzes at stall current when over-driven', () => {
    const r = servoRest(500, SERVO_SPECS.narrow)
    expect(r.aim).toBe(-90)
    expect(r.deg).toBe(SERVO_SPECS.narrow.stops[0])
    expect(r.amps).toBeCloseTo(SERVO_SPECS.narrow.stallA)
    expect(servoRest(2500, SERVO_SPECS.wide).amps).toBe(0)
  })
  it('turns pulse into speed on a 360° servo, with a deadband round its own neutral', () => {
    expect(crRpm(CR_SERVO.neutralUs + 5)).toBe(0)
    expect(crRpm(1500)).toBeLessThan(0)
    expect(crRpm(1500)).toBeGreaterThan(-3)
    expect(crRpm(2500)).toBe(CR_SERVO.maxRpm)
    expect(crRpm(500)).toBe(-CR_SERVO.maxRpm)
  })
})

describe('inside a hobby servo', () => {
  const step = (t: number) => (t < 0.1 ? 90 : 160)
  it('drives in proportion to the error outside the deadband', () => {
    expect(servoDuty(1, 10, 2)).toBe(0)
    expect(servoDuty(7, 10, 2)).toBeCloseTo(0.5)
    expect(servoDuty(-50, 10, 2)).toBe(-1)
  })
  it('settles a step, slower with low gain, hunting with too much', () => {
    const mid = servoLoopRun(step, 10, 10)
    expect(Math.abs(mid[mid.length - 1].deg - 160)).toBeLessThan(usToDeg(10) + 1)
    expect(servoSettleS(mid)).toBeGreaterThan(0.1 + 70 / 600)
    expect(overshootDeg(servoLoopRun(step, 30, 10))).toBeLessThan(overshootDeg(mid))
    expect(servoSettleS(servoLoopRun(step, 2, 10))).toBeNull()
  })
  it('a deadband stops pot noise from twitching the motor at rest', () => {
    const idle = (dead: number) => Math.max(...servoLoopRun(step, 10, dead).filter((f) => f.t > 0.7).map((f) => f.amps))
    expect(idle(0)).toBeGreaterThan(0.05)
    expect(idle(10)).toBeLessThan(0.01)
  })
})

describe('jitter and power', () => {
  it('four servos starting on a shared USB rail brown the ESP32 out; a separate pack does not', () => {
    const shared = railSummary(servoRailRun(4, 'shared', 0, 'ledc'))
    expect(shared.peakA).toBeCloseTo(4 * 0.7, 1)
    expect(shared.minLogic).toBeLessThan(ESP32_BOD[0])
    expect(shared.resetAt).not.toBeNull()
    const sep = railSummary(servoRailRun(4, 'separate', 0, 'ledc'))
    expect(sep.resetAt).toBeNull()
    expect(sep.minLogic).toBe(3.3)
  })
  it('a bulk cap shaves the dip and the ground bounce', () => {
    const bare = servoRailRun(2, 'shared', 0, 'ledc')
    const cap = servoRailRun(2, 'shared', 2200e-6, 'ledc')
    expect(railSummary(cap).minRail).toBeGreaterThan(railSummary(bare).minRail + 0.3)
    expect(bare.twitches.some((x) => x.lost)).toBe(true)
    expect(cap.twitches.length).toBe(0)
  })
  it('software PWM jitter twitches holding servos on any supply', () => {
    expect(railSummary(servoRailRun(1, 'separate', 0, 'ledc')).twitches).toBe(0)
    expect(railSummary(servoRailRun(1, 'separate', 0, 'soft')).twitches).toBeGreaterThan(5)
  })
})
