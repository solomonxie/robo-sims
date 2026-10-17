import { G } from '../common'
import { BALLS, driveProfile, flightAt, flightRun, profileAt, projectileIdeal, strobeRun, uniformAt } from './motion'

describe('constant acceleration', () => {
  test('s = ut + ½at², v = u + at, v² = u² + 2as', () => {
    const { s, v } = uniformAt(0.2, 0.6, 2)
    expect(s).toBeCloseTo(0.4 + 1.2)
    expect(v).toBeCloseTo(1.4)
    expect(v * v).toBeCloseTo(0.04 + 2 * 0.6 * s)
  })

  test('braking stops at rest instead of reversing', () => {
    const r = uniformAt(0.6, -0.3, 5)
    expect(r.v).toBeCloseTo(0)
    expect(r.s).toBeCloseTo(0.6 ** 2 / 0.6)
    expect(r.stopped).toBe(true)
  })

  test('strobe gaps grow by a·τ² each flash', () => {
    const run = strobeRun(0.1, 0.8, 0.5, 2.5)
    expect(run).toHaveLength(6)
    for (let i = 2; i < run.length; i++) expect(run[i].ds - run[i - 1].ds).toBeCloseTo(0.8 * 0.25)
    const fromRest = strobeRun(0, 1, 1, 3).map((f) => f.ds)
    expect(fromRest.slice(1)).toEqual([0.5, 1.5, 2.5])
  })
})

describe('drive profile on a v–t plot', () => {
  const p = driveProfile({ accel: 0.5, speed: 1, cruise: 1, brake: 1 })
  test('area under v–t is the distance; slope is the acceleration', () => {
    expect(p.T).toBeCloseTo(2 + 1 + 1)
    expect(p.areas).toEqual([1, 1, 0.5])
    expect(p.distance).toBeCloseTo(2.5)
    expect(profileAt(p, 1).v).toBeCloseTo(0.5)
    expect(profileAt(p, 1).a).toBe(0.5)
    expect(profileAt(p, 3.5).a).toBe(-1)
    expect(profileAt(p, p.T - 1e-9).s).toBeCloseTo(p.distance)
    expect(profileAt(p, 10)).toMatchObject({ v: 0, s: 2.5, phase: -1 })
    let s = 0
    for (let t = 0; t < p.T; t += 0.001) s += profileAt(p, t + 0.0005).v * 0.001
    expect(s).toBeCloseTo(p.distance, 2)
  })
})

describe('projectile motion', () => {
  test('no air matches the closed form; 45° goes furthest', () => {
    const th = (40 * Math.PI) / 180
    const ideal = projectileIdeal(6, th)
    const sim = flightRun(6, th, 0)
    expect(sim.range).toBeCloseTo(ideal.range, 3)
    expect(sim.T).toBeCloseTo(ideal.T, 3)
    expect(sim.peak.y).toBeCloseTo(ideal.peak, 3)
    expect(ideal.range).toBeCloseTo((36 * Math.sin(2 * th)) / G)
    const r = (deg: number) => projectileIdeal(6, (deg * Math.PI) / 180).range
    expect(r(45)).toBeGreaterThan(r(40))
    expect(r(30)).toBeCloseTo(r(60))
  })

  test('drag shortens the flight, more for the light ball', () => {
    const th = Math.PI / 4
    const ideal = flightRun(7, th, 0).range
    const tennis = flightRun(7, th, BALLS.tennis.k)
    const ping = flightRun(7, th, BALLS.pingpong.k)
    expect(tennis.range).toBeLessThan(ideal)
    expect(ping.range).toBeLessThan(tennis.range * 0.8)
    expect(ping.landSpeed).toBeLessThan(7)
    expect(ping.peak.x).toBeGreaterThan(ping.range / 2)
  })

  test('flightAt interpolates and holds after landing', () => {
    const f = flightRun(5, 0.6, 0)
    const mid = flightAt(f.run, 0.1234)
    expect(mid.x).toBeCloseTo(5 * Math.cos(0.6) * 0.1234, 4)
    expect(flightAt(f.run, 99).y).toBe(0)
  })
})
