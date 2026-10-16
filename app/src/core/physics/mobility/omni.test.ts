import { OMNI, holoTopSpeed, omniForward, omniInverse, omniSideSlip } from './omni'

const signs = (s: number[]) => s.map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v)))

describe('omni kinematics', () => {
  it('X base reads like mecanum: forward, strafe, spin', () => {
    expect(signs(omniInverse(0.2, 0, 0, 'x'))).toEqual([1, 1, 1, 1])
    expect(signs(omniInverse(0, 0.2, 0, 'x'))).toEqual([-1, 1, 1, -1])
    expect(signs(omniInverse(0, 0, 1, 'x'))).toEqual([-1, 1, -1, 1])
    omniInverse(0.2, 0, 0, 'x').forEach((s) => expect(s).toBeCloseTo(0.2 / Math.SQRT2))
  })
  it('kiwi: back wheel idles going forward, carries a strafe alone at full speed', () => {
    const f = omniInverse(0.2, 0, 0, 'kiwi')
    expect(f[0]).toBeCloseTo(0.2 * Math.cos(Math.PI / 6))
    expect(f[2]).toBeCloseTo(0)
    const s = omniInverse(0, 0.2, 0, 'kiwi')
    expect(s).toEqual([expect.closeTo(-0.1), expect.closeTo(0.1), expect.closeTo(0.2)])
    omniInverse(0, 0, 1, 'kiwi').forEach((v) => expect(Math.abs(v)).toBeCloseTo(OMNI.kiwiR))
  })
  it('forward undoes inverse for both bases', () => {
    for (const base of ['kiwi', 'x'] as const) {
      const f = omniForward(omniInverse(0.1, -0.2, 0.7, base), base)
      expect([f.vx, f.vy, f.w].map((v) => +v.toFixed(6))).toEqual([0.1, -0.2, 0.7])
      f.scrub.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-6))
    }
    expect(Math.max(...omniForward([0.2, 0.2, 0.2, -0.2], 'x').scrub.map(Math.abs))).toBeGreaterThan(0.05)
  })
  it('rollers take the sideways part: rolling² + slip² = point speed²', () => {
    const [s, r] = [omniInverse(0.3, 0.1, 0, 'x'), omniSideSlip(0.3, 0.1, 0, 'x')]
    s.forEach((v, i) => expect(v * v + r[i] * r[i]).toBeCloseTo(0.1))
  })
  it('top speed by direction', () => {
    expect(holoTopSpeed('x', 0)).toBeCloseTo(OMNI.maxRim * Math.SQRT2)
    expect(holoTopSpeed('x', Math.PI / 4)).toBeCloseTo(OMNI.maxRim)
    expect(holoTopSpeed('kiwi', 0)).toBeCloseTo(OMNI.maxRim / Math.cos(Math.PI / 6))
    expect(holoTopSpeed('kiwi', Math.PI / 2)).toBeCloseTo(OMNI.maxRim)
    expect(holoTopSpeed('mecanum', 0)).toBeCloseTo(OMNI.maxRim)
  })
})
