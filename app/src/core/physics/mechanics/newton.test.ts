import { G } from '../common'
import { FRICTION_PAIRS, NEWTON_CAR, frictionRun, inclineForces, pushRun, rampRun } from './newton'

describe('F = m a', () => {
  test('acceleration = net force / mass, then coasts to a stop', () => {
    const m = 1.8
    const run = pushRun({ force: 2, mass: m, pushFor: 2, seconds: 6 })
    const rr = NEWTON_CAR.crr * m * G
    expect(run[100].a).toBeCloseTo((2 - rr) / m)
    expect(run[100].net).toBeCloseTo(run[100].drive + run[100].roll)
    expect(run[400].v).toBeGreaterThan(0)
    expect(run[400].a).toBeCloseTo(-NEWTON_CAR.crr * G)
    const peak = Math.max(...run.map((f) => f.v))
    expect(peak).toBeCloseTo(((2 - rr) / m) * 2, 2)
    const carpet = pushRun({ force: 2, mass: m, crr: 0.15, pushFor: 1, seconds: 4 })
    expect(carpet[carpet.length - 1].v).toBe(0)
  })

  test('double the mass, half the acceleration; too weak a push never moves', () => {
    const a1 = pushRun({ force: 3, mass: 1, crr: 0, pushFor: 1, seconds: 1 })[10].a
    const a2 = pushRun({ force: 3, mass: 2, crr: 0, pushFor: 1, seconds: 1 })[10].a
    expect(a1 / a2).toBeCloseTo(2)
    const stuck = pushRun({ force: 0.1, mass: 1, pushFor: 1, seconds: 1 })
    expect(stuck.every((f) => f.v === 0 && f.net === 0)).toBe(true)
  })
})

describe('free-body on a ramp', () => {
  test('components resolve the weight; net force sets the motion', () => {
    const f = inclineForces(1, (30 * Math.PI) / 180, 2)
    expect(f.wPar).toBeCloseTo(G / 2)
    expect(Math.hypot(f.wPar, f.wPerp)).toBeCloseTo(f.w)
    expect(f.n).toBeCloseTo(f.wPerp)
    expect(f.net).toBeCloseTo(2 - G / 2)
    const hold = inclineForces(1, 0.3, G * Math.sin(0.3))
    expect(hold.net).toBeCloseTo(0)
    const back = rampRun({ mass: 1, theta: 0.3, drive: 0, half: 0.5, seconds: 2 })
    expect(back[back.length - 1].s).toBe(-0.5)
    const up = rampRun({ mass: 1, theta: 0.1, drive: 2, half: 10, seconds: 1 })
    expect(up[200].s).toBeCloseTo(0.5 * inclineForces(1, 0.1, 2).a, 1)
  })
})

describe('friction', () => {
  test('static friction matches the push until mu_s N, then kinetic is smaller', () => {
    const { mus, muk } = FRICTION_PAIRS.tile
    const r = frictionRun({ mass: 1, mus, muk, rate: 5, hold: 0.5, seconds: 5 })
    expect(r.breakAt).toBeCloseTo((mus * G) / 5, 2)
    const before = r.run[50]
    expect(before.v).toBe(0)
    expect(before.fric).toBeCloseTo(-before.push)
    const after = r.run.find((f) => f.slipping)!
    expect(after.fric).toBeCloseTo(-muk * G)
    expect(r.kineticN).toBeLessThan(r.breakN)
    expect(Math.max(...r.run.map((f) => f.v))).toBeCloseTo((mus - muk) * G * 0.5, 1)
    expect(r.run[r.run.length - 1].v).toBe(0)
  })

  test('breakaway scales with weight, not with the surface area', () => {
    const p = FRICTION_PAIRS.wood
    const a = frictionRun({ mass: 1, ...p, rate: 5, hold: 0.5, seconds: 3 })
    const b = frictionRun({ mass: 2, ...p, rate: 5, hold: 0.5, seconds: 3 })
    expect(b.breakN / a.breakN).toBeCloseTo(2)
  })
})
