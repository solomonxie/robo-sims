import {
  FW_PERIOD,
  changedLayers,
  commandError,
  controlGaps,
  fixedRateRun,
  loopJitter,
  motorStack,
  motorVolts,
  overshoot,
  rangeReadMs,
  rangeStack,
  rtosFirmwareRun,
  superLoopRun,
} from './firmware'

describe('super-loop vs RTOS', () => {
  it('a super-loop keeps 10 ms until telemetry blocks, then the control gap grows by the stall', () => {
    expect(new Set(controlGaps(superLoopRun(0).drives))).toEqual(new Set([FW_PERIOD]))
    const gaps = controlGaps(superLoopRun(20).drives)
    expect(Math.max(...gaps)).toBe(25)
    expect(superLoopRun(20).lanes[0].slice(0, 6)).toEqual(['read', 'compute', 'drive', 'telemetry', 'telemetry', null])
  })
  it('RTOS tasks keep every control gap at 10 ms whatever telemetry does', () => {
    for (const stall of [0, 20, 40]) expect(new Set(controlGaps(rtosFirmwareRun(stall).drives))).toEqual(new Set([FW_PERIOD]))
    const tel = rtosFirmwareRun(20).lanes[1]
    expect(tel.filter((s) => s === 'stall').length).toBeGreaterThan(10)
    expect(tel).toContain('ready')
  })
  it('a stalled loop holds a stale motor command; tasks track the setpoint', () => {
    expect(commandError(superLoopRun(20))).toBeGreaterThan(1.4 * commandError(rtosFirmwareRun(20)))
    expect(commandError(rtosFirmwareRun(20))).toBeCloseTo(commandError(rtosFirmwareRun(0)), 6)
  })
})

describe('hardware abstraction', () => {
  it('swapping a driver chip or mocking it changes only the driver layer', () => {
    expect(changedLayers(motorStack('l298n'), motorStack('tb6612'))).toEqual(['driver'])
    expect(changedLayers(motorStack('l298n'), motorStack('mock'))).toEqual(['driver'])
    expect(changedLayers(rangeStack('vl53'), rangeStack('hcsr04'))).toEqual(['driver'])
  })
  it('the MOSFET bridge gives the motor more volts; sonar reads faster than the ToF budget', () => {
    expect(motorVolts('tb6612', 0.6)).toBeGreaterThan(motorVolts('l298n', 0.6) + 0.8)
    expect(rangeReadMs('hcsr04')).toBeCloseTo(2.46, 1)
    expect(rangeReadMs('vl53')).toBe(33)
  })
})

describe('fixed-rate loop', () => {
  it('on time: no late or dropped ticks, settles at 90° without overshoot', () => {
    const r = fixedRateRun(0, true)
    expect(r.steps.every((s) => s.late === 0 && s.dropped === 0)).toBe(true)
    expect(loopJitter(r.steps)).toBeLessThan(1e-9)
    expect(overshoot(r.th)).toBeLessThan(0.01)
    expect(r.th[r.th.length - 1]).toBeCloseTo(Math.PI / 2, 2)
  })
  it('overruns: late and dropped ticks; assumed dt over-turns, measured dt lands on target', () => {
    const fixed = fixedRateRun(25, false)
    const meas = fixedRateRun(25, true)
    expect(fixed.steps.some((s) => s.late > 0)).toBe(true)
    expect(fixed.steps.some((s) => s.dropped > 0)).toBe(true)
    expect(Math.abs(fixed.th[fixed.th.length - 1] - Math.PI / 2)).toBeGreaterThan(0.1)
    expect(Math.abs(meas.th[meas.th.length - 1] - Math.PI / 2)).toBeLessThan(0.05)
  })
  it('long overruns make even measured-dt control ring', () => {
    expect(overshoot(fixedRateRun(35, true).th)).toBeGreaterThan(0.05)
  })
})
