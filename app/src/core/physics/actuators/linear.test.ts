import {
  ACTUATOR_12V,
  AXIS,
  SCREWS,
  actuatorFreeMmS,
  actuatorMmS,
  actuatorStallN,
  actuatorThrustN,
  backDriveEfficiency,
  backDrives,
  homeErrorMm,
  homingRun,
  homingSummary,
  limitBounceTrace,
  limitHit,
  limitPinHigh,
  mmPerMicrostep,
  screwEfficiency,
  screwLeadMm,
  screwRpm,
  selfLocking,
  stepperThrustN,
  stepsPerMm,
  thrustN,
  weightN,
} from './linear'

describe('lead screw', () => {
  it('lead = pitch × starts; steps per mm', () => {
    expect(screwLeadMm(SCREWS.t8l8)).toBe(8)
    expect(stepsPerMm(8, 16)).toBe(400)
    expect(mmPerMicrostep(2, 16)).toBeCloseTo(0.000625)
    expect(screwRpm(10, 2)).toBe(300)
  })
  it('efficiency: fine trapezoidal ~30 %, coarse ~60 %, ball ~90 %', () => {
    expect(screwEfficiency(SCREWS.t8l2)).toBeCloseTo(0.3, 1)
    expect(screwEfficiency(SCREWS.t8l8)).toBeCloseTo(0.59, 1)
    expect(screwEfficiency(SCREWS.sfu1204)).toBeGreaterThan(0.88)
  })
  it('self-locking only when the lead angle is under the friction angle', () => {
    expect(selfLocking(SCREWS.t8l2)).toBe(true)
    expect(backDriveEfficiency(SCREWS.t8l2)).toBe(0)
    expect(selfLocking(SCREWS.t8l8)).toBe(false)
    expect(backDriveEfficiency(SCREWS.sfu1204)).toBeGreaterThan(0.85)
  })
  it('F = 2πηT/lead', () => {
    expect(thrustN(0.4, 2, 0.3)).toBeCloseTo(377, 0)
  })
  it('thrust falls with speed, faster on a fine lead', () => {
    expect(stepperThrustN(SCREWS.t8l2, 2)).toBeGreaterThan(stepperThrustN(SCREWS.t8l8, 2))
    expect(stepperThrustN(SCREWS.t8l2, 40)).toBeLessThan(stepperThrustN(SCREWS.t8l2, 2))
  })
  it('unpowered: a coarse or ball screw drops the load, the fine one holds', () => {
    expect(backDrives(SCREWS.t8l2, weightN(30))).toBe(false)
    expect(backDrives(SCREWS.t8l8, weightN(5))).toBe(true)
    expect(backDrives(SCREWS.sfu1204, weightN(5))).toBe(true)
  })
  it('12 V actuator: ~20 mm/s free, ~470 N stall, linear in between', () => {
    expect(actuatorFreeMmS()).toBeCloseTo(20)
    expect(actuatorStallN()).toBeCloseTo(473, 0)
    expect(actuatorMmS(actuatorStallN() / 2)).toBeCloseTo(10)
    expect(actuatorMmS(1e4, ACTUATOR_12V)).toBe(0)
    expect(actuatorThrustN(10)).toBeCloseTo(actuatorStallN() / 2)
    expect(selfLocking(ACTUATOR_12V.screw)).toBe(true)
  })
})

describe('limit switch', () => {
  it('NO reads LOW when hit, NC HIGH; a broken wire reads HIGH', () => {
    expect(limitPinHigh('no', true)).toBe(false)
    expect(limitPinHigh('nc', true)).toBe(true)
    expect(limitHit('nc', limitPinHigh('nc', false, true))).toBe(true)
    expect(limitHit('no', limitPinHigh('no', true, true))).toBe(false)
  })
  it('bounce makes many raw edges; debounce leaves one', () => {
    const raw = limitBounceTrace('no', 0, 6e-3)
    expect(raw.rawEdges).toBeGreaterThan(4)
    const db = limitBounceTrace('no', 2e-3, 6e-3)
    expect(db.stableEdges).toBe(1)
    expect(db.out[db.out.length - 1].stable).toBe(false)
  })
  it('a broken wire reads HIGH through the click, no edges', () => {
    const b = limitBounceTrace('no', 0, 6e-3, true)
    expect(b.rawEdges).toBe(0)
    expect(b.out.every((f) => f.raw && f.stable)).toBe(true)
  })
  it('zero error ∝ approach speed', () => {
    expect(homeErrorMm(AXIS.fastMmS, 0)).toBeCloseTo(10 * homeErrorMm(AXIS.slowMmS, 0))
  })
})

describe('homing', () => {
  it('two-pass zeroes within the slow-pass error, then stops at the soft limit', () => {
    const s = homingSummary(homingRun('two', 'nc', false, 0))
    expect(Math.abs(s.zeroMm ?? 9)).toBeLessThanOrEqual(homeErrorMm(AXIS.slowMmS, 0) + 1e-9)
    expect(s.crashAt).toBeNull()
    expect(s.end.phase).toBe('done')
    expect(s.end.believed).toBeCloseTo(AXIS.travelMm)
  })
  it('one fast pass zeroes less precisely', () => {
    const one = homingSummary(homingRun('one', 'no', false, 2e-3))
    const two = homingSummary(homingRun('two', 'no', false, 2e-3))
    expect(Math.abs(one.zeroMm ?? 0)).toBeGreaterThan(Math.abs(two.zeroMm ?? 0))
  })
  it('NO with a broken wire never trips: crash, then gives up', () => {
    const s = homingSummary(homingRun('two', 'no', true, 0))
    expect(s.crashAt).not.toBeNull()
    expect(s.alarmAt).not.toBeNull()
    expect(s.zeroMm).toBeNull()
  })
  it('NC with a broken wire reads hit at once: alarm, no motion', () => {
    const run = homingRun('two', 'nc', true, 0)
    expect(run[0].phase).toBe('alarm')
    expect(run[run.length - 1].x).toBe(AXIS.startMm)
  })
  it('no switch: zero is the power-on spot, the jog runs into the frame', () => {
    const s = homingSummary(homingRun('none', 'no', false, 0))
    expect(s.zeroMm).toBe(AXIS.startMm)
    expect(s.crashAt).not.toBeNull()
    expect(s.end.x).toBe(AXIS.travelMm + AXIS.endStopMm)
    expect(s.end.believed).toBeCloseTo(AXIS.travelMm)
  })
})
