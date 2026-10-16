import { TT_TRACK_M } from '../sensors/encoder'
import { FLOORS, diffForward, diffInverse, diffStep, gripAccel, iccOf, slipRun, squareRun, turnRadius } from './diffdrive'

const b = TT_TRACK_M

describe('diff-drive kinematics', () => {
  it('forward and inverse round-trip', () => {
    const { v, w } = diffForward(0.1, 0.3, b)
    expect(v).toBeCloseTo(0.2)
    expect(w).toBeCloseTo(0.2 / b)
    const [l, r] = diffInverse(v, w, b)
    expect(l).toBeCloseTo(0.1)
    expect(r).toBeCloseTo(0.3)
  })
  it('turn radius: straight, spin in place, one wheel stopped', () => {
    expect(turnRadius(0.2, 0.2, b)).toBe(Infinity)
    expect(turnRadius(-0.2, 0.2, b)).toBe(0)
    expect(turnRadius(0, 0.2, b)).toBeCloseTo(b / 2)
    expect(turnRadius(0.2, 0, b)).toBeCloseTo(-b / 2)
  })
  it('ICC sits on the axle line, left for a left turn', () => {
    const c = iccOf({ x: 1, y: 1, th: 0 }, 0.1, 0.3, b)!
    expect(c[0]).toBeCloseTo(1)
    expect(c[1]).toBeCloseTo(1 + b)
    expect(iccOf({ x: 0, y: 0, th: 0 }, 0.2, 0.2, b)).toBeNull()
  })
  it('an arc step stays on the circle about the ICC', () => {
    const p = { x: 0, y: 0, th: 0.3 }
    const c = iccOf(p, 0.1, 0.3, b)!
    const q = diffStep(p, 0.1, 0.3, b, 0.7)
    expect(Math.hypot(q.x - c[0], q.y - c[1])).toBeCloseTo(b, 6)
    expect(q.th).toBeCloseTo(0.3 + (0.2 / b) * 0.7)
    expect(diffStep(p, 0.2, 0.2, b, 1).x).toBeCloseTo(0.2 * Math.cos(0.3))
  })
})

describe('UMBmark square', () => {
  it('a calibrated robot ends where it thinks', () => {
    const r = squareRun(0, 0, false, 1)
    expect(r.ends).toHaveLength(1)
    expect(r.ends[0].distM).toBeLessThan(0.003)
    expect(Math.abs(r.ends[0].headDeg)).toBeLessThan(0.5)
  })
  it('a 5 % wide track under-turns each corner, growing with laps', () => {
    const r = squareRun(0, 5, false, 2)
    expect(r.ends[0].headDeg).toBeCloseTo(-4 * 90 * (1 - 1 / 1.05), 0)
    expect(r.ends[1].distM).toBeGreaterThan(r.ends[0].distM)
  })
  it('track error mirrors between CW and CCW; wheel error curves the straights', () => {
    const ccw = squareRun(0, 3, false, 1).ends[0]
    const cw = squareRun(0, 3, true, 1).ends[0]
    expect(cw.distM).toBeCloseTo(ccw.distM, 2)
    expect(cw.headDeg).toBeCloseTo(-ccw.headDeg, 1)
    expect(squareRun(1, 0, false, 1).ends[0].distM).toBeGreaterThan(0.02)
  })
})

describe('wheel slip', () => {
  it('grip limit is μ·g on the driven share', () => {
    expect(gripAccel(0.5, 0.2)).toBeCloseTo(0.5 * 9.81 * 0.8)
  })
  it('a gentle launch on carpet keeps odometry honest', () => {
    const r = slipRun('launch', FLOORS.carpet.mu, 1, 0.25)
    expect(r.end.distM).toBeLessThan(0.01)
    expect(r.truthEnd.x).toBeGreaterThan(0.5)
  })
  it('a hard launch on dusty tile spins the wheels and odometry overshoots', () => {
    const r = slipRun('launch', FLOORS.dusty.mu, 8, 0.25)
    expect(r.estEnd.x - r.truthEnd.x).toBeGreaterThan(0.015)
    expect(r.peakSlip).toBeGreaterThan(0.1)
  })
  it('a hard spin on tile loses heading', () => {
    const r = slipRun('spin', FLOORS.tile.mu, 8, 0.4)
    expect(Math.abs(r.end.headDeg)).toBeGreaterThan(3)
    expect(Math.abs(slipRun('spin', FLOORS.carpet.mu, 1, 0.25).end.headDeg)).toBeLessThan(1)
  })
})
