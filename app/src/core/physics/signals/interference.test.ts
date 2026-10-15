import { capPickup, motorField, emfPeak, groundLoop, loopEmf, pairFlux, shieldPickup, pairFacing } from '..'

describe('interference', () => {
  it('loop EMF is 2π·f·B·A', () => {
    expect(loopEmf(20e-6, 1, 50)).toBeCloseTo(6.283e-3, 6)
    expect(emfPeak(1e-8, 2e4)).toBeCloseTo(1.2566e-3, 7)
  })

  it('a ground loop turns EMF into current and hum; one path stops both', () => {
    const s = { bT: 20e-6, areaM2: 1, hz: 50, loopOhms: 0.4, sharedOhms: 0.2 }
    const g = groundLoop(s)
    expect(g.amps).toBeCloseTo(15.7e-3, 4)
    expect(g.hum).toBeCloseTo(3.14e-3, 5)
    expect(groundLoop(s, false)).toEqual({ emf: g.emf, amps: 0, hum: 0 })
  })

  it('a twisted pair flips its loop every half-twist', () => {
    expect(pairFacing(0.01, 1, 0)).toBe(1)
    expect(pairFacing(-0.25, 1, 1)).toBeCloseTo(1, 12)
    expect(pairFacing(0.25, 1, 1)).toBeCloseTo(-1, 12)
    expect(pairFacing(0, 1, 1)).toBeCloseTo(0, 12)
  })

  it('motor field falls as 1/r³ along the cable', () => {
    const b = motorField(1e-3, 0.02, 0.01)
    expect(b(0.01)).toBeCloseTo(1e-3, 12)
    expect(b(0.03)).toBeCloseTo(1e-3 / 2 ** 1.5, 12)
  })

  it('twisting cancels pickup: exactly in a uniform field, mostly in a local one', () => {
    expect(pairFlux(() => 1e-3, 0.3, 0.002, 0)).toBeCloseTo(6e-7, 10)
    expect(Math.abs(pairFlux(() => 1e-3, 0.3, 0.002, 10))).toBeLessThan(1e-12)
    const b = motorField(1e-3, 0.02, 0.013)
    const flat = Math.abs(pairFlux(b, 0.3, 0.002, 0))
    const t10 = Math.abs(pairFlux(b, 0.3, 0.002, 10))
    const t40 = Math.abs(pairFlux(b, 0.3, 0.002, 40))
    expect(t10).toBeLessThan(flat)
    expect(t40).toBeLessThan(t10)
    expect(t40 / flat).toBeLessThan(0.1)
  })

  it('capacitive pickup rises with frequency and input impedance', () => {
    expect(capPickup(230, 50, 10e-12, 1e6)).toBeCloseTo(0.7225, 3)
    expect(capPickup(230, 50, 10e-12, 1e3)).toBeCloseTo(7.2e-4, 5)
    expect(capPickup(1, 1e9, 1e-9, 1e6)).toBeCloseTo(1, 6)
  })

  it('a floating shield passes the noise on; a grounded one drains it', () => {
    const s = { volts: 230, hz: 50, couple: 10e-12, shieldToGround: 30e-12, coreToShield: 100e-12, ohms: 1e6, leak: 5e-4 }
    const none = shieldPickup('none', s).core
    const floating = shieldPickup('floating', s)
    expect(floating.shieldV).toBeCloseTo(57.5, 6)
    expect(floating.core).toBeGreaterThan(none)
    expect(shieldPickup('one', s).core).toBeCloseTo(none * 5e-4, 9)
    expect(shieldPickup('both', s).core).toBe(shieldPickup('one', s).core)
  })
})
