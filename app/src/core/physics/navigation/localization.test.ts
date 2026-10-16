import { walledRoom } from '../room'
import { XY } from '../software/costmap'
import { CLUTTER } from './avoid'
import { beamAngles, icpRun, lidarScan, likelihoodField, lowVarianceResample, mapPoints, mclRun, neff, particleStats, rigidFit, scanLogLik, scanPoints, scanWorld } from './localization'

const BOX = walledRoom(2, 1, 0.3, [])

describe('weights and resampling', () => {
  it('Neff is N for equal weights and 1 for a single winner', () => {
    expect(neff([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(4)
    expect(neff([1, 0, 0, 0])).toBeCloseTo(1)
    expect(neff([0.5, 0.5, 0, 0])).toBeCloseTo(2)
  })
  it('low-variance resampling keeps N and copies particles in proportion to weight', () => {
    const idx = lowVarianceResample([0.5, 0.25, 0.125, 0.125], 0.5)
    expect(idx).toEqual([0, 0, 1, 2])
    const many = lowVarianceResample([0.7, 0.1, 0.2], 0.3, 100)
    expect(many).toHaveLength(100)
    expect(many.filter((i) => i === 0).length).toBe(70)
    expect(many.filter((i) => i === 2).length).toBe(20)
  })
  it('a zero-weight particle is never copied', () => {
    for (const u of [0, 0.3, 0.99]) expect(lowVarianceResample([0.5, 0, 0.5], u)).not.toContain(1)
  })
  it('weighted mean and covariance of a particle set', () => {
    const { mean, P } = particleStats([0, 2], [0, 0], [0.1, -0.1], [0.5, 0.5])
    expect(mean.x).toBeCloseTo(1)
    expect(mean.th).toBeCloseTo(0)
    expect(P[0][0]).toBeCloseTo(1)
    expect(P[1][1]).toBeCloseTo(0)
    expect(P[2][2]).toBeCloseTo(0.01)
  })
})

describe('measurement model', () => {
  it('likelihood field holds distance to the nearest wall', () => {
    const f = likelihoodField(BOX)
    expect(f.at(1, 0.5)).toBeCloseTo(0.5, 1)
    expect(f.at(0.11, 0.5)).toBeCloseTo(0.11, 1)
    expect(f.at(-1, 0.5)).toBe(-1)
  })
  it('the true pose explains its own scan better than a shifted or turned one', () => {
    const f = likelihoodField(CLUTTER)
    const p = { x: 1.2, y: 1.4, th: 0.3 }
    const a = beamAngles(12)
    const r = lidarScan(CLUTTER, p, a)
    const at = (q: typeof p) => scanLogLik(f, q, a, r)
    expect(at(p)).toBeGreaterThan(at({ ...p, x: 1.4 }))
    expect(at(p)).toBeGreaterThan(at({ ...p, th: 0.6 }))
    expect(at({ ...p, x: 1.0, y: 0.2 })).toBe(-50)
  })
  it('lidar ranges in an empty box hit the walls', () => {
    const r = lidarScan(BOX, { x: 0.5, y: 0.5, th: 0 }, beamAngles(4))
    expect(r[0]).toBeCloseTo(1.5)
    expect(r[1]).toBeCloseTo(0.5)
    expect(r[2]).toBeCloseTo(0.5)
  })
})

describe('Monte Carlo localisation', () => {
  it('a lost robot with 500 particles converges and beats odometry', () => {
    const { frames } = mclRun(500, 8, 0.05, 'lost', 2)
    const last = frames[frames.length - 1]
    expect(frames[0].err).toBeGreaterThan(0.2)
    expect(last.err).toBeLessThan(0.1)
    expect(last.err).toBeLessThan(last.odoErr)
    expect(frames.every((f) => f.px.length === 500)).toBe(true)
    expect(frames.some((f) => f.resampled)).toBe(true)
  })
  it('kidnapped: no random particles → never recovers; injected particles → recovers', () => {
    const stuck = mclRun(300, 8, 0, 'kidnap', 1)
    const saved = mclRun(300, 8, 0.2, 'kidnap', 1)
    expect(stuck.frames[stuck.frames.length - 1].err).toBeGreaterThan(0.5)
    expect(saved.frames[saved.frames.length - 1].err).toBeLessThan(0.15)
  })
})

describe('ICP scan matching', () => {
  it('rigid fit recovers a known rotation and shift exactly', () => {
    const a: XY[] = [[0, 0], [1, 0], [1, 2], [-0.5, 1]]
    const [th, tx, ty] = [0.4, 0.3, -0.2]
    const b = a.map(([x, y]) => [Math.cos(th) * x - Math.sin(th) * y + tx, Math.sin(th) * x + Math.cos(th) * y + ty] as XY)
    const f = rigidFit(a, b)
    expect(f.dth).toBeCloseTo(th)
    expect(f.tx).toBeCloseTo(tx)
    expect(f.ty).toBeCloseTo(ty)
  })
  it('pulls a 20 cm / 17° guess onto the true pose and the residual falls', () => {
    const truth = { x: 1.2, y: 1.2, th: 0.3 }
    const scan = scanPoints(CLUTTER, truth, 90, 0, 1)
    const map = mapPoints(CLUTTER)
    const its = icpRun(scan, map, { x: 1.4, y: 1.1, th: 0.6 }, 25, 0.5)
    const last = its[its.length - 1]
    expect(Math.hypot(last.pose.x - truth.x, last.pose.y - truth.y)).toBeLessThan(0.01)
    expect(last.pose.th).toBeCloseTo(truth.th, 2)
    expect(last.rms).toBeLessThan(its[0].rms / 5)
    const w = scanWorld(last.pose, scan[0])
    expect(Math.min(...map.map((m) => Math.hypot(m[0] - w[0], m[1] - w[1])))).toBeLessThan(0.02)
  })
  it('a guess far outside the basin settles in the wrong place', () => {
    const truth = { x: 1.2, y: 1.2, th: 0.3 }
    const its = icpRun(scanPoints(CLUTTER, truth, 90, 0, 1), mapPoints(CLUTTER), { x: 1.7, y: 0.95, th: 0.9 }, 25, 0.5)
    expect(Math.hypot(its[its.length - 1].pose.x - truth.x, its[its.length - 1].pose.y - truth.y)).toBeGreaterThan(0.1)
  })
})
