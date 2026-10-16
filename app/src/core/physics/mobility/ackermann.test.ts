import { DEG } from '../common'
import {
  ACKERMANN,
  axleHits,
  bicycleIcc,
  bicycleRadius,
  bicycleStep,
  frontSlip,
  minTurn,
  parkPlan,
  parkPoseAt,
  polyPath,
  pursuitRun,
  pursuitSteer,
  spoolScrub,
  steerAngles,
  wheelSpeeds,
} from './ackermann'

const { wheelbase: L, track: T } = ACKERMANN

describe('steering geometry', () => {
  it('Ackermann: inner wheel turns more, both axes meet at the bicycle ICC', () => {
    const d = 20 * DEG
    const [l, r] = steerAngles(d, 'ackermann')
    expect(l).toBeGreaterThan(d)
    expect(r).toBeLessThan(d)
    const R = bicycleRadius(d, L)
    axleHits([l, r]).forEach((y) => expect(y).toBeCloseTo(R))
    frontSlip([l, r], R).forEach((s) => expect(Math.abs(s)).toBeLessThan(1e-9))
    const [rl, rr] = steerAngles(-d, 'ackermann')
    expect(rl).toBeCloseTo(-r)
    expect(rr).toBeCloseTo(-l)
    frontSlip([rl, rr], -R).forEach((s) => expect(Math.abs(s)).toBeLessThan(1e-9))
    const anti = frontSlip(steerAngles(-d, 'anti'), -R)
    expect(anti[0]).toBeCloseTo(-anti[1], 1)
  })
  it('parallel and anti miss the ICC, so tyres scrub', () => {
    const d = 25 * DEG
    const R = bicycleRadius(d, L)
    for (const geo of ['parallel', 'anti'] as const) {
      const a = steerAngles(d, geo)
      const [hl, hr] = axleHits(a)
      expect(Math.abs(hl - hr)).toBeGreaterThan(0.05)
      expect(Math.max(...frontSlip(a, R).map(Math.abs))).toBeGreaterThan(1 * DEG)
    }
    expect(steerAngles(0, 'ackermann')).toEqual([0, 0])
    expect(axleHits([0, 0])).toEqual([Infinity, Infinity])
  })
  it('min turn radius from lock and wheelbase', () => {
    const m = minTurn(30 * DEG)
    expect(m.rear).toBeCloseTo(L / Math.tan(30 * DEG) + T / 2)
    expect(steerAngles(m.delta, 'ackermann')[0]).toBeCloseTo(30 * DEG)
    expect(m.outer).toBeGreaterThan(m.rear + T / 2)
    expect(minTurn(30 * DEG, { wheelbase: 2 * L, track: T }).rear).toBeGreaterThan(m.rear)
  })
  it('differential: outer wheels faster, average of the rear pair is v', () => {
    const [fl, fr, rl, rr] = wheelSpeeds(1, 20 * DEG)
    expect(rr).toBeGreaterThan(rl)
    expect((rl + rr) / 2).toBeCloseTo(1)
    expect(fr).toBeGreaterThan(fl)
    expect(fl).toBeGreaterThan(rl)
    expect(wheelSpeeds(1, 0)).toEqual([1, 1, 1, 1])
    expect(spoolScrub(1, 0)).toEqual([0, 0])
    expect(spoolScrub(1, 20 * DEG)[0]).toBeCloseTo((T / 2) / bicycleRadius(20 * DEG, L))
  })
})

describe('bicycle model', () => {
  it('constant steer drives a circle about the ICC; never sideways', () => {
    const d = 15 * DEG
    const p0 = { x: 0, y: 0, th: 0 }
    const c = bicycleIcc(p0, d, L)!
    let p = p0
    for (let i = 0; i < 100; i++) {
      const q = bicycleStep(p, 0.5, d, L, 0.02)
      const h = Math.atan2(q.y - p.y, q.x - p.x)
      expect(Math.abs(Math.sin(h - (p.th + q.th) / 2))).toBeLessThan(1e-6)
      p = q
      expect(Math.hypot(p.x - c[0], p.y - c[1])).toBeCloseTo(bicycleRadius(d, L))
    }
    expect(bicycleIcc(p0, 0, L)).toBeNull()
  })
  it('pure pursuit steers toward the carrot and holds a loop', () => {
    expect(pursuitSteer({ x: 0, y: 0, th: 0 }, [1, 0.3], L, 0.5)).toBeGreaterThan(0)
    expect(pursuitSteer({ x: 0, y: 0, th: 0 }, [0, -0.3], L, 0.5)).toBeCloseTo(-0.5)
    const loop: [number, number][] = [[0, 0], [2, 0], [2, 1.5], [0, 1.5], [0, 0]]
    expect(polyPath(loop).length).toBeCloseTo(7)
    const run = pursuitRun(loop, 0.5, 0.6, 20)
    expect(Math.max(...run.slice(200).map((f) => f.err))).toBeLessThan(0.3)
  })
  it('parallel park: more moves in a tighter slot, ends shifted, heading restored', () => {
    const r = minTurn(ACKERMANN.maxSteer).rear
    const wide = parkPlan(0.25, 0.9, r, L)
    const tight = parkPlan(0.25, 0.25, r, L)
    expect(wide.k).toBe(1)
    expect(tight.k).toBeGreaterThan(2)
    expect(tight.travel).toBeLessThanOrEqual(0.25 + 1e-9)
    for (const plan of [wide, tight]) {
      const total = plan.moves.reduce((s, m) => s + m.len, 0)
      const end = parkPoseAt({ x: 0, y: 0, th: 0 }, plan.moves, 0.2, L, total / 0.2 + 1).pose
      expect(end.y).toBeCloseTo(-0.25)
      expect(end.th).toBeCloseTo(0)
    }
  })
})
