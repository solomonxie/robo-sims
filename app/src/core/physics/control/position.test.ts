import { CAR_INERTIA, CAR_MOVE, Move, moveAt, moveStats, positionRun, sCurveMove, stepMove, trapezoidMove } from './position'
import { TT_INERTIA } from '../actuators/dcmotor'

const D = 0.8
const run = (move: Move, mastHz?: number) => {
  const c = { move, start: 0.3, seconds: 4, mastHz }
  return moveStats(positionRun(c), c)
}
/** Numeric derivative of moveAt's position. */
const slope = (m: Move, t: number, h = 1e-6) => (moveAt(m, t + h).p - moveAt(m, t - h).p) / (2 * h)

describe('motion profiles', () => {
  test('trapezoid: time, cruise, triangle', () => {
    const m = trapezoidMove(D, 0.6, 2)
    expect(m.T).toBeCloseTo(D / 0.6 + 0.6 / 2)
    expect(moveAt(m, m.T / 2).v).toBeCloseTo(0.6)
    expect(moveAt(m, 0.1).a).toBe(2)
    expect(moveAt(m, m.T - 1e-9).p).toBeCloseTo(D, 6)
    const tri = trapezoidMove(D, 1, 1)
    expect(tri.vPeak).toBeCloseTo(Math.sqrt(D))
    expect(tri.T).toBeCloseTo(2 * Math.sqrt(D))
  })

  test('S-curve: jerk-limited, continuous accel, ends on the mark', () => {
    const m = sCurveMove(D, 0.8, 1.5, 1.5 / 0.3)
    expect(m.segs).toHaveLength(7)
    expect(m.T).toBeCloseTo(trapezoidMove(D, 0.8, 1.5).T + 0.3)
    expect(moveAt(m, m.T - 1e-9).p).toBeCloseTo(D, 6)
    expect(moveAt(m, m.T - 1e-9).v).toBeCloseTo(0, 6)
    for (let t = 0.01; t < m.T; t += 0.01) {
      expect(Math.abs(moveAt(m, t + 1e-4).a - moveAt(m, t).a)).toBeLessThan(1.5 / 0.3 * 1e-4 + 1e-9)
      expect(slope(m, t)).toBeCloseTo(moveAt(m, t).v, 4)
    }
    const short = sCurveMove(0.1, 0.8, 1.5, 5)
    expect(short.vPeak).toBeLessThan(0.8)
    expect(moveAt(short, short.T - 1e-9).p).toBeCloseTo(0.1, 6)
  })
})

describe('car position loop', () => {
  test('car mass adds to the motor inertia', () => {
    expect(CAR_INERTIA).toBeGreaterThan(1.5 * TT_INERTIA)
  })

  test('profiled move tracks within mm and stops on the mark; a step lunges past tyre grip', () => {
    const t = run(trapezoidMove(D, 0.6, 2))
    expect(t.track).toBeLessThan(0.005)
    expect(Math.abs(t.final)).toBeLessThan(0.001)
    expect(t.settle).not.toBeNull()
    expect(t.peakAcc).toBeLessThan(3)
    const s = run(stepMove(D))
    expect(s.peakAcc).toBeGreaterThan(8)
    expect(Math.abs(s.final)).toBeLessThan(0.001)
  })

  test('speed near the motor top saturates the duty and lags the plan', () => {
    const c = { move: trapezoidMove(D, 1, 6), start: 0.3, seconds: 4 }
    const r = positionRun(c)
    expect(Math.max(...r.map((f) => f.v))).toBeLessThanOrEqual(CAR_MOVE.vLimit * 1.02)
    expect(r.some((f) => f.sat)).toBe(true)
    expect(moveStats(r, c).track).toBeGreaterThan(0.01)
  })

  test('mast: jerk time of one period cancels the leftover wobble', () => {
    const hz = 2.75
    const trap = run(trapezoidMove(D, 0.8, 1.5), hz)
    const tuned = run(sCurveMove(D, 0.8, 1.5, 1.5 * hz), hz)
    const short = run(sCurveMove(D, 0.8, 1.5, 1.5 / 0.1), hz)
    expect(trap.residual).toBeGreaterThan(0.005)
    expect(tuned.residual).toBeLessThan(0.1 * trap.residual)
    expect(short.residual).toBeGreaterThan(0.5 * trap.residual)
    expect(tuned.peakSway).toBeLessThan(trap.peakSway)
  })
})
