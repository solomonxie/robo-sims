import {
  Body,
  IDEAL,
  PHYS,
  PHYS_RUN,
  ROUTE_LEN,
  contactForces,
  deadbandOut,
  findContacts,
  integrate,
  offRoute,
  physRun,
  physStep,
  projectRoute,
  realPlant,
  realTimeFactor,
  routeAt,
  runError,
  stableDt,
  stepCpuMs,
  tuneTwin,
  twinCost,
  twinRun,
} from './simulation'

const box = (x: number, y: number, m = 1): Body => ({ x, y, vx: 0, vy: 0, w: 0.3, h: 0.3, m })

describe('physics engine', () => {
  it('finds ground and box contacts with the normal along the shallow overlap', () => {
    const c = findContacts([box(0, 0.14), box(0, 0.42), box(2, 1)])
    expect(c.map((k) => [k.a, k.b, k.nx, k.ny])).toEqual([
      [0, -1, 0, 1],
      [0, 1, 0, -1],
    ])
    expect(c[0].depth).toBeCloseTo(0.01)
    expect(c[1].depth).toBeCloseTo(0.02)
  })

  it('pushes back with k·depth, minus damping on approach', () => {
    const b = [{ ...box(0, 0.14), vy: -0.1 }]
    const c = findContacts(b)
    const F = contactForces(b, c, 0.001)
    expect(c[0].fn).toBeCloseTo(PHYS.k * 0.01 + PHYS.c * 0.1)
    expect(F[0][1]).toBeCloseTo(c[0].fn - PHYS.g)
  })

  it('explicit Euler moves with the old velocity, semi-implicit with the new', () => {
    const b = [{ ...box(0, 1), vy: 1 }]
    const F: [number, number][] = [[0, -10]]
    expect(integrate(b, F, 0.1, 'euler')[0].y).toBeCloseTo(1.1)
    expect(integrate(b, F, 0.1, 'semi')[0].y).toBeCloseTo(1)
  })

  it('a resting box settles at its contact depth', () => {
    let b = [box(0, 0.15)]
    for (let i = 0; i < 2000; i++) b = physStep(b, 0.001, 'semi').bodies
    expect(b[0].y).toBeCloseTo(0.15 - PHYS.g / PHYS.k, 4)
  })

  it('small steps track the reference; large steps blow up, Euler first', () => {
    const ref = physRun(PHYS_RUN.refDt, 'semi')
    const last = (r: ReturnType<typeof physRun>) => r[r.length - 1]
    expect(last(ref).blown).toBe(false)
    expect(ref[ref.length - 1].bodies[1].x).toBeGreaterThan(1.3)
    const semi4 = physRun(0.004, 'semi')
    expect(last(semi4).blown).toBe(false)
    expect(runError(semi4, ref, semi4.length - 1)).toBeLessThan(0.05)
    expect(last(physRun(0.004, 'euler')).blown).toBe(true)
    expect(last(physRun(0.01, 'semi')).blown).toBe(true)
    expect(runError(physRun(0.002, 'euler'), ref, 150)).toBeGreaterThan(runError(physRun(0.002, 'semi'), ref, 150))
  })

  it('stability limit: semi-implicit ω·dt < 2, explicit Euler ω·dt < 2ζ', () => {
    expect(stableDt(0.5, 'semi')).toBeCloseTo(0.01)
    expect(stableDt(0.5, 'euler')).toBeCloseTo(0.003)
  })

  it('real-time factor drops once a step costs more CPU than it simulates', () => {
    expect(stepCpuMs(5, 6)).toBeCloseTo(0.93)
    expect(realTimeFactor(0.001, 0.93)).toBe(1)
    expect(realTimeFactor(0.0005, 0.93)).toBeCloseTo(0.54, 2)
  })
})

describe('sim-to-real gap', () => {
  it('measures along the route', () => {
    expect(projectRoute(1.5, 0.7)).toEqual({ s: expect.closeTo(Math.hypot(1.5, 0.7)), d: 0 })
    expect(routeAt(ROUTE_LEN + 1)).toEqual([6, 0])
    expect(deadbandOut(0.05, 0.06)).toBe(0)
    expect(deadbandOut(-0.1, 0.06)).toBeCloseTo(-0.04)
  })

  it('a perfect twin matches the sim exactly', () => {
    const c = { kp: 4, look: 0.3 }
    expect(twinRun(realPlant('none'), c)).toEqual(twinRun(IDEAL, c))
  })

  it('the nominal-sim tune is aggressive and degrades on the real robot', () => {
    const nom = tuneTwin(false)
    expect(nom).toMatchObject({ kp: 12, look: 0.15 })
    const sim = twinRun(IDEAL, nom)
    const real = twinRun(realPlant('all'), nom)
    expect(offRoute(real)).toBeGreaterThan(2 * offRoute(sim))
    expect(real[real.length - 1].t).toBeGreaterThan(sim[sim.length - 1].t * 1.8)
  })

  it('domain randomisation picks a calmer controller that shrinks the gap', () => {
    const nom = tuneTwin(false)
    const dr = tuneTwin(true)
    expect(dr).toMatchObject({ kp: 4, look: 0.3 })
    const gap = (c: typeof nom) => twinCost(twinRun(realPlant('all'), c)) - twinCost(twinRun(IDEAL, c))
    expect(gap(dr)).toBeLessThan(gap(nom) / 2)
  })
})
