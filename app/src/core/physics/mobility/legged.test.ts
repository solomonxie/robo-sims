import { DEG } from '../common'
import {
  BIPED,
  GAITS,
  HEXAPOD,
  QUADRUPED,
  footPath,
  gaitFeet,
  gaitMargin,
  gaitSpeed,
  hullMargin,
  leanPath,
  legAngles,
  legFK,
  legIK,
  legPhase,
  supportHull,
  swayAt,
  swayPath,
  tipLean,
  walkerOf,
  zmpRun,
  zmpX,
} from './legged'

describe('gait cycle', () => {
  it('each leg spends β of the cycle on the ground', () => {
    for (const g of Object.values(GAITS)) {
      const N = 600
      g.lift.forEach((_, i) => {
        let down = 0
        for (let k = 0; k < N; k++) if (!legPhase(g, i, k / N).swing) down++
        expect(down / N).toBeCloseTo(g.duty, 2)
      })
    }
  })
  it('tripod swaps two tripods; wave lifts one leg at a time', () => {
    const feet = (g: (typeof GAITS)[keyof typeof GAITS], s: number) => gaitFeet(g, s, 0.06, 0.02).map((f) => f.down)
    expect(feet(GAITS.tripod, 0.25)).toEqual([false, true, false, true, false, true])
    expect(feet(GAITS.tripod, 0.75)).toEqual([true, false, true, false, true, false])
    expect(feet(GAITS.wave, 0.05).filter((d) => !d)).toHaveLength(1)
    expect(feet(GAITS.trot, 0.25)).toEqual([false, true, true, false])
  })
  it('stance foot slides back one stride, swing lifts and returns', () => {
    expect(footPath(false, 0, 0.06, 0.02)).toEqual([0.03, 0])
    expect(footPath(false, 1, 0.06, 0.02)).toEqual([-0.03, 0])
    const mid = footPath(true, 0.5, 0.06, 0.02)
    expect(mid[0]).toBeCloseTo(0)
    expect(mid[1]).toBeCloseTo(0.02)
    expect(footPath(true, 1, 0.06, 0.02)[0]).toBeCloseTo(0.03)
  })
  it('speed = stride / stance time', () => {
    expect(gaitSpeed(0.06, 1, 0.5)).toBeCloseTo(0.12)
    expect(gaitSpeed(0.06, 1, 5 / 6)).toBeCloseTo(0.072)
  })
})

describe('support polygon', () => {
  it('hull drops inner points; margin is the distance to the nearest edge', () => {
    const h = supportHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ])
    expect(h).toHaveLength(4)
    expect(hullMargin([0.5, 0.5], h)).toBeCloseTo(0.5)
    expect(hullMargin([1.5, 0.5], h)).toBeCloseTo(-0.5)
    expect(
      hullMargin(
        [0, 0],
        [
          [-1, -1],
          [1, 1],
        ],
      ),
    ).toBeCloseTo(0)
  })
  it('wave > tripod > 0; trot balances on a line; creep needs its body sway', () => {
    const m = (g: (typeof GAITS)[keyof typeof GAITS]) => gaitMargin(g, 0.06)
    expect(m(GAITS.tripod).minDown).toBe(3)
    expect(m(GAITS.tripod).margin).toBeGreaterThan(0.03)
    expect(m(GAITS.wave).margin).toBeGreaterThan(m(GAITS.tripod).margin)
    expect(m(GAITS.wave).minDown).toBe(5)
    expect(m(GAITS.trot).minDown).toBe(2)
    expect(m(GAITS.trot).margin).toBeLessThanOrEqual(0)
    expect(m(GAITS.creep).margin).toBeGreaterThan(0.02)
    expect(gaitMargin({ ...GAITS.creep, sway: 0 }, 0.06).margin).toBeLessThan(0.005)
    expect(Math.hypot(...swayAt(GAITS.creep, 0.075))).toBeGreaterThan(0.02)
  })
})

describe('leg IK', () => {
  const [L1, L2] = [HEXAPOD.femur, HEXAPOD.tibia]
  it('FK of the IK lands on the target, both knee solutions', () => {
    for (const up of [true, false]) {
      const s = legIK(0.08, -0.05, L1, L2, up)
      const f = legFK(s.hip, s.knee, L1, L2).foot
      expect(f[0]).toBeCloseTo(0.08, 6)
      expect(f[1]).toBeCloseTo(-0.05, 6)
      expect(s.ok).toBe(true)
      expect(Math.sign(s.knee)).toBe(up ? -1 : 1)
    }
  })
  it('law of cosines: knee angle from the reach', () => {
    const d = 0.1
    const s = legIK(d, 0, L1, L2)
    expect(Math.cos(Math.PI - Math.abs(s.knee))).toBeCloseTo((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))
  })
  it('out-of-reach targets are pulled onto the boundary', () => {
    const far = legIK(0.3, 0, L1, L2)
    expect(far.ok).toBe(false)
    expect(Math.hypot(...legFK(far.hip, far.knee, L1, L2).foot)).toBeCloseTo(L1 + L2, 4)
    const near = legIK(0.005, 0, L1, L2)
    expect(near.ok).toBe(false)
    expect(Math.hypot(...legFK(near.hip, near.knee, L1, L2).foot)).toBeCloseTo(L2 - L1, 4)
  })
  it('every foot of every gait stays reachable', () => {
    for (const g of Object.values(GAITS))
      for (let k = 0; k < 60; k++) gaitFeet(g, k / 60, 0.08, 0.03).forEach((f, i) => expect(legAngles(walkerOf(g), i, f.at).ok).toBe(true))
    expect(walkerOf(GAITS.trot)).toBe(QUADRUPED)
  })
})

describe('zero-moment point', () => {
  it('ZMP shifts against the acceleration', () => {
    expect(zmpX(0.01, 0.25, 0)).toBe(0.01)
    expect(zmpX(0, 0.25, 9.81)).toBeCloseTo(-0.25)
  })
  it('static lean tips once the CoM passes the toe', () => {
    const tip = tipLean(BIPED.h, BIPED.toe)
    const end = (lean: number) => zmpRun(leanPath(lean, BIPED.h), BIPED.h).at(-1)!
    expect(end(tip - 1 * DEG).state).toBe('ok')
    expect(end(tip + 3 * DEG).state).toBe('fallen')
    expect(end(tip + 3 * DEG).tip).toBeCloseTo(Math.PI / 2)
  })
  it('a fast sway with the CoM inside the foot still falls: the ZMP leaves first', () => {
    const run = (T: number) => zmpRun(swayPath(0.025, T), BIPED.h)
    const slow = run(3)
    expect(slow.every((f) => f.state === 'ok')).toBe(true)
    const fast = run(1.5)
    expect(Math.max(...fast.map((f) => Math.abs(f.x)))).toBeLessThan(BIPED.heel + 0.001)
    expect(fast.at(-1)!.state).toBe('fallen')
  })
})
