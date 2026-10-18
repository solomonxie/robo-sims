import { DEG } from '../common'
import { ARM_CAL, TOOTH_DEG } from '../kinematics/armbuild'
import { medianMs } from '../../stopwatch'
import {
  ARM_HORN_DEG, ARM_JOB, CAL_SPAN_US, DESK_SPOTS, MOUNT_CENTRES, calErrors, calibrateArm, calibrateServo, gripHold, jobPath, jobRun, mountCals, mountCheck, protractorDeg,
  segmentGap, servoTravel, servoTruths, spotErrors, spotReach, usableRange,
} from './armkit'

const plan = (teeth = [0, 0, 0, 0], centred = true) => ({ centred, teeth })

describe('assemble', () => {
  it('designed centres: base ahead, upper arm up, elbow and wrist straight', () => {
    expect(MOUNT_CENTRES.map((q) => Math.round(q / DEG))).toEqual([0, 90, 0, 0])
  })
  it('each servo gives 180° of travel; the horn decides where it sits', () => {
    const c = mountCals(plan())
    c.forEach((x) => {
      const [lo, hi] = servoTravel(x)
      expect((hi - lo) / DEG).toBeCloseTo(180)
    })
    expect(servoTravel(c[1]).map((v) => v / DEG)).toEqual([expect.closeTo(-6, 5), expect.closeTo(174, 5)])
    const flat = mountCals(plan([0, -6, 0, 0]))
    expect(servoTravel(flat[1])[0] / DEG).toBeCloseTo(-6 - 6 * TOOTH_DEG, 5)
    const [lo, hi] = usableRange(c[2], 2)
    expect(lo).toBeGreaterThanOrEqual(-135 * DEG)
    expect(hi).toBeLessThanOrEqual(135 * DEG)
  })
  it('centred servos reach every spot; loose horns or a shifted shoulder lose some', () => {
    const good = mountCheck(plan())
    expect(good.reached).toBe(DESK_SPOTS.length)
    expect(good.trims.map((t) => Math.round(t / DEG))).toEqual(ARM_HORN_DEG)
    expect(mountCheck(plan(undefined, false)).reached).toBeLessThanOrEqual(3)
    const flat = mountCheck(plan([0, -6, 0, 0]))
    expect(flat.spots.find((s) => s.name === 'shelf')!.why).toBe('travel')
    expect(mountCheck(plan([0, 4, 0, 0])).reached).toBeLessThanOrEqual(2)
    expect(mountCheck(plan([0, 0, -3, 0])).spots.filter((s) => s.why !== 'ok').map((s) => s.name)).toEqual(['shelf'])
  })
  it('a miss is measured from the nearest pose the servos allow', () => {
    const r = spotReach(DESK_SPOTS[1].at, mountCals(plan([0, 4, 0, 0])))
    expect(r.why).toBe('travel')
    expect(r.miss).toBeGreaterThan(0.05)
    expect(spotReach([0.6, 0, 0], mountCals(plan())).why).toBe('reach')
  })
})

describe('calibrate servos', () => {
  it('protractor rounds to its marks', () => {
    expect(protractorDeg(31.4 * DEG, 1)).toBe(31)
    expect(protractorDeg(31.4 * DEG, 5)).toBe(30)
  })
  it('two-point recovers zero and slope; centre-only leaves the scale error', () => {
    const tr = servoTruths()
    const exact = calibrateServo('twoPoint', ARM_CAL[1], tr[1], 0)
    expect(exact.usPerRad).toBeCloseTo(tr[1].usPerRad, -1)
    expect(Math.abs(exact.zeroUs - tr[1].zeroUs)).toBeLessThan(3)
    const none = calErrors(calibrateArm('none', tr, 1), tr).worst
    const centre = calErrors(calibrateArm('centre', tr, 1), tr).worst
    const two = calErrors(calibrateArm('twoPoint', tr, 1), tr).worst
    expect(none / DEG).toBeGreaterThan(10)
    expect(centre / DEG).toBeGreaterThan(2)
    expect(centre).toBeLessThan(none)
    expect(two / DEG).toBeLessThan(1)
    expect(CAL_SPAN_US).toBe(600)
  })
  it('two-point catches a servo mounted the wrong way; centre-only does not', () => {
    const tr = servoTruths(true)
    expect(calErrors(calibrateArm('centre', tr, 1), tr).joints[2].worst / DEG).toBeGreaterThan(90)
    const c = calibrateArm('twoPoint', tr, 1)
    expect(Math.sign(c[2].usPerRad)).toBe(Math.sign(tr[2].usPerRad))
    expect(calErrors(c, tr).worst / DEG).toBeLessThan(1)
  })
  it('coarser protractor, bigger hand miss', () => {
    const tr = servoTruths()
    const miss = (res: number) => Math.max(...spotErrors(calibrateArm('twoPoint', tr, res), tr))
    expect(miss(0.5)).toBeLessThan(miss(5))
    expect(Math.max(...spotErrors(calibrateArm('none', tr, 1), tr))).toBeGreaterThan(0.02)
  })
})

describe('IK control', () => {
  it('job path: nine segments, faster = shorter', () => {
    const s = jobPath(0.2)
    expect(s.map((x) => x.label)).toEqual(['to the pick', 'down', 'close', 'lift', 'carry', 'down', 'open', 'up', 'home'])
    const T = (v: number) => jobPath(v).reduce((a, x) => a + x.T, 0)
    expect(T(0.4)).toBeLessThan(T(0.2))
  })
  it('gripper: squeeze grows with push past contact; 2° cannot lift the block', () => {
    expect(gripHold(2).holdN).toBeLessThan(gripHold(2).weightN)
    expect(gripHold(6).holdN).toBeGreaterThan(gripHold(6).weightN)
    expect(gripHold(10).normalN).toBeGreaterThan(gripHold(6).normalN)
    expect(jobRun('cartesian', 0.2, 2).result).toBe('not gripped')
  })
  it('straight lines stay on the line; joint interpolation swings wide', () => {
    const c = jobRun('cartesian', 0.2, 6)
    const j = jobRun('joint', 0.2, 6)
    expect(c.result).toBe('placed')
    expect(j.result).toBe('placed')
    expect(c.devMax).toBeLessThan(0.005)
    expect(j.devMax).toBeGreaterThan(0.03)
    expect(c.T).toBeCloseTo(j.T, 5)
  })
  it('servos lag more at speed; a hard lift with a light squeeze drops the block', () => {
    expect(jobRun('cartesian', 0.6, 6).lagMax).toBeGreaterThan(jobRun('cartesian', 0.1, 6).lagMax)
    const fast = jobRun('cartesian', 0.6, 4)
    expect(fast.result).toBe('dropped')
    expect(fast.slipAt).not.toBeNull()
    expect(fast.frames.at(-1)!.block[2]).toBeCloseTo(ARM_JOB.pick[2], 5)
  })
  it('segment gap', () => {
    expect(segmentGap([0, 1, 0], [0, 0, 0], [2, 0, 0])).toBeCloseTo(1)
    expect(segmentGap([3, 0, 0], [0, 0, 0], [2, 0, 0])).toBeCloseTo(1)
  })
  it('runs fast', () => {
    expect(medianMs(() => jobRun('cartesian', 0.05, 6), 3)).toBeLessThan(400)
    expect(medianMs(() => mountCheck({ centred: false, teeth: [1, 2, 3, 0] }), 3)).toBeLessThan(100)
  })
})
