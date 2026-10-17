import { G } from '../common'
import { TRACK_FLOORS, U_TRACK, driveChain, trackAt, trackLength, trackTop, uTrackRun, winchFreeSpeed, winchLift, winchPull } from './energy'

describe('kinetic and potential', () => {
  test('track shape: tops at both ends, flat bottom', () => {
    expect(trackAt(0).y).toBeCloseTo(trackTop())
    expect(trackAt(trackLength()).y).toBeCloseTo(trackTop())
    expect(trackAt(U_TRACK.slope + U_TRACK.flat / 2).y).toBe(0)
    expect(trackAt(0.1).pitch).toBeLessThan(0)
  })

  test('no losses: KE + PE constant, reaches the same height on the far side, √(2gh) at the bottom', () => {
    const r = uTrackRun(1, 0.3, 0)
    for (const f of r.frames) expect((f.ke + f.pe) / r.e0).toBeCloseTo(1, 2)
    expect(Math.max(...r.frames.filter((f) => f.s > U_TRACK.slope + U_TRACK.flat).map((f) => f.h))).toBeCloseTo(0.3, 2)
    expect(r.bottomV).toBeCloseTo(Math.sqrt(2 * G * 0.3), 1)
    expect(r.idealV).toBeCloseTo(Math.sqrt(2 * G * 0.3))
  })

  test('rolling resistance: KE + PE + heat = start energy; it settles on the flat; motion independent of mass', () => {
    const r = uTrackRun(0.8, 0.3, TRACK_FLOORS.carpet.crr)
    for (const f of r.frames) expect((f.ke + f.pe + f.loss) / r.e0).toBeCloseTo(1, 2)
    const last = r.frames[r.frames.length - 1]
    expect(last.v).toBe(0)
    expect(last.h).toBe(0)
    expect(last.loss / r.e0).toBeCloseTo(1, 2)
    expect(r.bottomV).toBeLessThan(r.idealV)
    const heavy = uTrackRun(1.6, 0.3, TRACK_FLOORS.carpet.crr)
    expect(heavy.frames[3000].s).toBeCloseTo(r.frames[3000].s, 6)
    expect(heavy.e0).toBeCloseTo(2 * r.e0)
  })
})

describe('work and power', () => {
  test('W = m g d whatever the speed; P = F v; slower takes longer', () => {
    const a = winchLift(0.5, 0.6, 0.02)
    const b = winchLift(0.5, 0.6, 0.04)
    expect(a.work).toBeCloseTo(0.5 * G * 0.6)
    expect(b.work).toBeCloseTo(a.work)
    expect(a.power).toBeCloseTo(0.5 * G * 0.02)
    expect(a.time).toBeCloseTo(2 * b.time)
  })

  test('the motor caps the speed; its pull curve meets the load at that top speed', () => {
    const r = winchLift(1, 0.5, 1)
    expect(r.limited).toBe(true)
    expect(r.v).toBeCloseTo(r.topV)
    expect(winchPull(r.topV).force).toBeCloseTo(r.force, 3)
    expect(winchLift(2, 0.5, 1).topV).toBeLessThan(r.topV)
    expect(winchPull(winchFreeSpeed()).force).toBeCloseTo(0, 6)
  })

  test('same current at any speed, so a slow lift spends more electrical energy as heat', () => {
    const slow = winchLift(0.5, 0.6, 0.01)
    const fast = winchLift(0.5, 0.6, 0.05)
    expect(slow.amps).toBeCloseTo(fast.amps)
    expect(slow.energyIn).toBeGreaterThan(fast.energyIn)
    expect(fast.energyIn).toBeGreaterThan(fast.work)
    expect(slow.energyIn - slow.heat).toBeGreaterThan(slow.work)
  })
})

describe('efficiency', () => {
  test('every watt accounted for: chemical in = losses + lift', () => {
    for (const chip of ['l298n', 'tb6612', 'drv8833'] as const)
      for (const gear of ['tt48', 'tt120'] as const)
        for (const deg of [0, 10, 20]) {
          const c = driveChain(chip, gear, deg)
          const sum = Object.values(c.losses).reduce((a, b) => a + b, 0) + c.liftW
          expect(c.stalled).toBe(false)
          expect(sum / c.chemW).toBeCloseTo(1, 6)
        }
  })

  test('L298N wastes more than a MOSFET driver; flat ground lifts nothing', () => {
    const l = driveChain('l298n', 'tt48', 10)
    const d = driveChain('drv8833', 'tt48', 10)
    expect(l.losses.driver).toBeGreaterThan(5 * d.losses.driver)
    expect(d.toWheel).toBeGreaterThan(l.toWheel)
    expect(driveChain('drv8833', 'tt48', 0).liftW).toBe(0)
    expect(d.hours).toBeGreaterThan(0)
  })
})
