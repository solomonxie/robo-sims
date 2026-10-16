import { ACKERMANN, pursuitSteer } from '../mobility/ackermann'
import { XY } from '../software/costmap'
import { errorStats, filleted, lookaheadPoint, pursuitCarRun, pursuitCurvature, pursuitDiffRun, routeOf, routeStart, stanleyRun, stanleySteer, toRobot } from './tracking'

const LINE = routeOf([[0, 0], [10, 0]], false)
const SQUARE: XY[] = [[1.5, 0], [3, 0], [3, 3], [0, 3], [0, 0], [1.5, 0]]
const LOOP = routeOf(SQUARE)

describe('route frame', () => {
  it('closest point, signed error and heading on a straight line', () => {
    const f = LINE.frame(2, 0.6)
    expect(f.s).toBeCloseTo(2)
    expect(f.e).toBeCloseTo(0.6)
    expect(LINE.frame(4, -0.3).e).toBeCloseTo(-0.3)
    expect(f.dir).toBeCloseTo(0)
  })
  it('wraps arc length on a closed loop and turns at corners', () => {
    expect(LOOP.length).toBeCloseTo(12)
    expect(LOOP.at(13)[0]).toBeCloseTo(2.5)
    expect(LOOP.dirAt(4)).toBeCloseTo(Math.PI / 2)
    expect(LOOP.frame(1.5, 1).e).toBeCloseTo(1)
    expect(LOOP.frame(1.5, -1).e).toBeCloseTo(-1)
  })
})

describe('fillet', () => {
  it('rounds a right angle with a quarter circle of radius r, tangent to both legs', () => {
    const f = filleted([[0, 0], [2, 0], [2, 2]], 0.5)
    expect(f[1]).toEqual([expect.closeTo(1.5), expect.closeTo(0)])
    expect(f[f.length - 2]).toEqual([expect.closeTo(2), expect.closeTo(0.5)])
    expect(f.slice(1, -1).every(([x, y]) => Math.abs(Math.hypot(x - 1.5, y - 0.5) - 0.5) < 1e-9)).toBe(true)
    expect(routeOf(f, false).length).toBeLessThan(4)
  })
  it('keeps gentle bends and caps r at half the shorter leg', () => {
    expect(filleted([[0, 0], [1, 0], [2, 0.1]], 0.5)).toHaveLength(3)
    expect(filleted([[0, 0], [0.4, 0], [0.4, 2]], 1)[1][0]).toBeCloseTo(0.2)
  })
})

describe('lookahead point', () => {
  it('hits the circle on a straight line at x0 + √(L² − e²)', () => {
    const la = lookaheadPoint(LINE, 2, 0.6, 1)
    expect(la.hit).toBe(true)
    expect(la.at[0]).toBeCloseTo(2.8, 5)
    expect(la.at[1]).toBeCloseTo(0)
  })
  it('falls back to the closest point when the route is outside the circle', () => {
    const la = lookaheadPoint(LINE, 2, 1.5, 1)
    expect(la.hit).toBe(false)
    expect(la.at[0]).toBeCloseTo(2)
  })
  it('wraps past the end of a closed loop', () => {
    const la = lookaheadPoint(LOOP, 1.2, 0.5, 1)
    expect(la.at[0]).toBeCloseTo(1.2 + Math.sqrt(0.75), 5)
    expect(la.at[1]).toBeCloseTo(0)
    expect(la.s).toBeCloseTo(Math.sqrt(0.75) - 0.3, 5)
  })
})

describe('pure pursuit and Stanley laws', () => {
  it('κ = 2y / ld², matching the car steer atan(L κ)', () => {
    const p = { x: 0, y: 0, th: 0 }
    expect(pursuitCurvature(p, [1, 0.2])).toBeCloseTo(0.4 / 1.04)
    expect(pursuitCurvature(p, [2, 0])).toBe(0)
    expect(pursuitCurvature({ x: 1, y: 1, th: Math.PI / 2 }, [0, 2])).toBeCloseTo(1)
    expect(pursuitSteer(p, [1, 0.2], 0.26, 1)).toBeCloseTo(Math.atan(0.26 * pursuitCurvature(p, [1, 0.2])))
    expect(toRobot({ x: 1, y: 0, th: Math.PI / 2 }, [1, 2])).toEqual([expect.closeTo(2), expect.closeTo(0)])
  })
  it('Stanley: heading error alone, cross-track alone, clamped at lock', () => {
    const p = { x: 0, y: 0, th: 0 }
    expect(stanleySteer(p, 0, 0.1, 2, 1, 1).delta).toBeCloseTo(0.1)
    expect(stanleySteer(p, 0.1, 0, 1, 0.9, 1).delta).toBeCloseTo(-Math.atan(0.1))
    expect(stanleySteer(p, -0.5, 0, 5, 0.4, 0.5).delta).toBeCloseTo(0.5)
  })
})

describe('tracking runs', () => {
  const o = { look: 0.4, v: 0.3, tau: 0.1, seconds: 45, offset: 0.3 }
  it('pure pursuit on a diff-drive converges, and a long lookahead cuts corners deeper', () => {
    const run = pursuitDiffRun(LOOP, o)
    expect(Math.abs(run[0].e)).toBeCloseTo(0.3)
    expect(Math.abs(run.find((f) => f.t >= 2.5)!.e)).toBeLessThan(0.08)
    const long = errorStats(pursuitDiffRun(LOOP, { ...o, look: 0.9 }), 5)
    expect(long.peak).toBeGreaterThan(errorStats(run, 5).peak)
  })
  it('a short lookahead with slow wheels weaves more than with fast ones', () => {
    const slow = errorStats(pursuitDiffRun(LOOP, { ...o, look: 0.12, tau: 0.3 }), 1)
    const fast = errorStats(pursuitDiffRun(LOOP, { ...o, look: 0.12, tau: 0.02 }), 1)
    expect(slow.rms).toBeGreaterThan(fast.rms)
  })
  it('Stanley puts the front axle on the route; pure pursuit starts from the same pose', () => {
    const st = stanleyRun(LOOP, 3, 0.6, 25, 0.3)
    const pp = pursuitCarRun(LOOP, 0.5, 0.6, 25, 0.3)
    expect(st[0].pose).toEqual(pp[0].pose)
    expect(st[0].e).toBeCloseTo(0.3)
    expect(Math.abs(st.find((f) => f.t >= 2)!.e)).toBeLessThan(0.05)
    expect(errorStats(st, 3).peak).toBeLessThan(0.5)
    expect(st.every((f) => Math.abs(f.delta) <= ACKERMANN.maxSteer)).toBe(true)
    expect(routeStart(LOOP, 0.3).y).toBeCloseTo(0.3)
  })
})
