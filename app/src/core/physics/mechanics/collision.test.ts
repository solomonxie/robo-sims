import { BUMP_BOT, brakeOnlyStop, bumpRun, cartsRun, collide1d } from './collision'

describe('elastic and inelastic', () => {
  test('momentum always conserved; KE kept only when e = 1', () => {
    for (const e of [0, 0.5, 1]) {
      const c = collide1d(0.8, 0.6, 1.8, -0.2, e)
      expect(c.p1).toBeCloseTo(c.p0, 12)
      expect(c.ke0 - c.ke1).toBeCloseTo(c.lost, 12)
      expect(c.u2 - c.u1).toBeCloseTo(e * (0.6 + 0.2), 12)
    }
    expect(collide1d(1, 0.5, 1, 0, 1)).toMatchObject({ u1: 0, u2: 0.5, lost: 0 })
    const stick = collide1d(1, 0.5, 1, 0, 0)
    expect([stick.u1, stick.u2, stick.lost / stick.ke0]).toEqual([0.25, 0.25, 0.5])
  })

  test('carts touch at tHit and separate with the new speeds', () => {
    const r = cartsRun({ m1: 1, m2: 2, v1: 0.5, v2: 0, e: 0.8 })
    expect(r.tHit).toBeCloseTo((0.45 - 0.21) / 0.5, 12)
    const f = r.frames[r.frames.length - 1]
    expect(f.x2 - f.x1).toBeGreaterThan(0.21)
    expect(f.v1).toBeCloseTo(r.u1, 12)
    expect(cartsRun({ m1: 1, m2: 1, v1: 0.2, v2: 0.3, e: 1 }).tHit).toBe(Infinity)
  })
})

describe('bump sensors', () => {
  test('spring alone: peak squash v·√(m/k), elastic rebound', () => {
    const m = BUMP_BOT.massKg
    const r = bumpRun({ v0: 0.4, k: 400, travel: 1, delay: 10 })
    expect(r.squash).toBeCloseTo(0.4 * Math.sqrt(m / 400), 4)
    expect(r.frames[r.frames.length - 1].v).toBeCloseTo(-0.4, 3)
    expect(r.impulse).toBeCloseTo(2 * m * 0.4, 2)
  })

  test('brakes alone: squash = trip + v·delay + v²/2μg', () => {
    const r = bumpRun({ v0: 0.5, k: 1e-6, travel: 1, delay: 0.03 })
    expect(r.squash).toBeCloseTo(brakeOnlyStop(0.5, 0.03), 4)
    expect(r.hit).toBe(false)
  })

  test('short travel: chassis hits, force spike far above the spring', () => {
    const soft = bumpRun({ v0: 0.8, k: 500, travel: 0.03, delay: 0.02 })
    const short = bumpRun({ v0: 0.8, k: 500, travel: 0.005, delay: 0.02 })
    expect(soft.hit).toBe(false)
    expect(short.hit).toBe(true)
    expect(short.vHard).toBeGreaterThan(0.5)
    expect(short.peak).toBeGreaterThan(10 * soft.peak)
  })
})
