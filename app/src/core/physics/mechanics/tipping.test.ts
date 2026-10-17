import { G } from '../common'
import { designCom, massCentre, plumbHit, tableTipRun, tipAccels, tipLimits } from './tipping'

describe('centre of mass', () => {
  it('weights each part by its mass', () => {
    const c = massCentre([{ kg: 1, x: 0, z: 0 }, { kg: 3, x: 0.4, z: 0.2 }])
    expect(c.kg).toBe(4)
    expect(c.x).toBeCloseTo(0.3)
    expect(c.z).toBeCloseTo(0.15)
  })

  it('tips when the plumb line leaves the footprint: tan θ = (half track)/h', () => {
    const { back, forward } = tipLimits(0, 0.1, -0.1, 0.1)
    expect(back).toBeCloseTo(Math.PI / 4)
    expect(forward).toBeCloseTo(Math.PI / 4)
    expect(plumbHit(0, 0.1, back)).toBeCloseTo(-0.1)
    expect(tipLimits(0.05, 0.1, -0.1, 0.1).back).toBeGreaterThan(back)
  })

  it('braking at the nose-over limit puts the resultant on the front edge', () => {
    const a = tipAccels(0, 0.1, -0.06, 0.06, 0.1)
    expect(plumbHit(0, 0.1, 0.1, a.nose)).toBeCloseTo(0.06)
    expect(plumbHit(0, 0.1, 0.1, a.wheelie)).toBeCloseTo(-0.06)
    expect(tipAccels(0, 0.1, -0.06, 0.06, 0).nose).toBeCloseTo(-G * 0.6)
  })

  it('stays put below the tip angle and falls past it', () => {
    const base = { x: 0, h: 0.1, rear: -0.06, ramp: 2, seconds: 4, gyr: 0.05 }
    const beta = Math.atan2(0.06, 0.1)
    expect(tableTipRun({ ...base, tilt: beta - 0.05 }).tipAt).toBe(Infinity)
    const r = tableTipRun({ ...base, tilt: beta + 0.1 })
    expect(r.tipAt).toBeGreaterThan(2 * (beta / (beta + 0.1)) - 0.01)
    expect(r.frames.at(-1)!.roll).toBeCloseTo(Math.PI / 2)
  })

  it('low and wide beats tall and narrow; a roof battery lowers both limits', () => {
    const lim = (d: 'tall' | 'wide', high: boolean) => {
      const c = designCom(d, high)
      return tipLimits(c.x, c.z, -0.5 * (d === 'tall' ? 0.12 : 0.22), 0).back
    }
    expect(lim('wide', false)).toBeGreaterThan(lim('tall', false))
    expect(lim('tall', true)).toBeLessThan(lim('tall', false))
    expect(lim('wide', true)).toBeLessThan(lim('wide', false))
  })
})
