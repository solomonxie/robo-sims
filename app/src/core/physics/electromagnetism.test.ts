import {
  AIR_ARC_V,
  capacitorCharge,
  capacitorEnergy,
  chargesField,
  compassDeflection,
  COULOMB_K,
  coulombForce,
  DIELECTRIC,
  dipoleEmf,
  dipoleFlux,
  EARTH_B_H,
  EPSILON_0,
  faradayEmf,
  forceInField,
  inductorEnergy,
  inductorVolts,
  IRON_CORE,
  MAGNET_BR,
  magnetMoment,
  magnetStroke,
  MU_0,
  plateCapacitance,
  plateField,
  pointField,
  solenoidB,
  solenoidInductance,
  strokePeakEmf,
  switchOffSpike,
  wireB,
  wireForce,
  TT_MOTOR,
  motorAmps,
  motorRpm,
  SRD_05,
  SSR_25DA,
  coilAmps,
  coilDecayTime,
  coilRiseTime,
  contactHeat,
  dropOutAmps,
  flybackStep,
  nextZeroCross,
  operateTime,
  pullInAmps,
  relayLatch,
  relayPull,
  releaseTime,
  ssrHeat,
  ssrInputAmps,
  ssrTriggered,
  zeroCrossConducts,
} from '.'

describe('electric fields', () => {
  it('Coulomb force: sign says repel or attract, inverse square in r', () => {
    expect(coulombForce(1e-6, 1e-6, 0.1)).toBeCloseTo(0.8988, 4)
    expect(coulombForce(2e-6, -3e-6, 0.12)).toBeCloseTo(-3.745, 3)
    expect(coulombForce(2e-6, 2e-6, 0.2) / coulombForce(2e-6, 2e-6, 0.1)).toBeCloseTo(0.25, 12)
    expect(coulombForce(0, 5e-6, 0.05)).toBe(0)
  })

  it('field of charges: E = kq / r², F = qE, superposed', () => {
    expect(pointField(2e-9, 0.05)).toBeCloseTo(7190, 0)
    expect(chargesField([{ q: 2e-9, at: [0, 0, 0] }], [0.05, 0, 0])[0]).toBeCloseTo(pointField(2e-9, 0.05), 6)
    const mid = chargesField([{ q: 2e-9, at: [-0.05, 0, 0] }, { q: -2e-9, at: [0.05, 0, 0] }], [0, 0, 0])
    expect(mid[0]).toBeCloseTo(2 * pointField(2e-9, 0.05), 6)
    expect(forceInField(1e-9, 7190)).toBeCloseTo(7.19e-6, 12)
    expect(forceInField(1e-6, pointField(1e-6, 0.1))).toBeCloseTo(coulombForce(1e-6, 1e-6, 0.1), 12)
    expect(COULOMB_K * 4 * Math.PI * EPSILON_0).toBeCloseTo(1, 9)
  })

  it('parallel plates: C = ε₀εrA / d, Q = CV, E = V / d, U = ½CV²', () => {
    const c = plateCapacitance(0.01, 0.002)
    expect(c).toBeCloseTo(44.27e-12, 14)
    expect(plateCapacitance(0.01, 0.001, DIELECTRIC.mica)).toBeCloseTo(12 * c, 14)
    expect(capacitorCharge(c, 9)).toBeCloseTo(398.4e-12, 13)
    expect(plateField(9, 0.002)).toBe(4500)
    expect(capacitorEnergy(c, 9)).toBeCloseTo(1.793e-9, 12)
    expect(capacitorEnergy(c, 9)).toBeCloseTo((capacitorCharge(c, 9) * 9) / 2, 18)
  })
})

describe('magnetism', () => {
  it('wire and compass: B = μ₀I / 2πr against Earth’s field', () => {
    expect(wireB(10, 0.01)).toBeCloseTo(200e-6, 10)
    expect(wireB(-5, 0.02)).toBeCloseTo(-50e-6, 10)
    expect(compassDeflection(EARTH_B_H)).toBeCloseTo(Math.PI / 4, 12)
    expect(compassDeflection(0)).toBe(0)
    expect(compassDeflection(-1)).toBeCloseTo(-Math.PI / 2, 4)
  })

  it('solenoid: B = μ₀μr·nI, a core saturates', () => {
    expect(solenoidB(100, 0.1, 1)).toBeCloseTo(1.2566e-3, 7)
    expect(solenoidB(100, 0.1, -2)).toBeCloseTo(-2.5133e-3, 7)
    expect(solenoidB(10, 0.1, 1, IRON_CORE)).toBeCloseTo(200 * MU_0 * 100, 9)
    expect(solenoidB(1000, 0.1, -3, IRON_CORE)).toBe(-1.6)
  })

  it('force on a wire: F = IL × B, |F| = BIL sin θ', () => {
    expect(wireForce(2, [0.05, 0, 0], [0, -0.5, 0])).toEqual([0, 0, -0.05])
    expect(wireForce(-2, [0.05, 0, 0], [0, -0.5, 0])[2]).toBeCloseTo(0.05, 12)
    expect(wireForce(3, [0, -0.05, 0], [0, -0.5, 0])).toEqual([0, 0, 0])
    const tilted = wireForce(1, [0.05 * Math.sin(Math.PI / 6), -0.05 * Math.cos(Math.PI / 6), 0], [0, -1, 0])
    expect(tilted[2]).toBeCloseTo(-0.025, 12)
  })

  it('induction: dipole flux through a loop and ε = −N dΦ/dt', () => {
    const m = magnetMoment(MAGNET_BR.neodymium, 1e-6)
    expect(m).toBeCloseTo(1.0345, 3)
    expect(dipoleFlux(m, 0.015, 0)).toBeCloseTo((MU_0 * m) / 0.03, 12)
    expect(dipoleFlux(m, 0.015, 0.02)).toBeLessThan(dipoleFlux(m, 0.015, 0.01))
    const dz = 1e-7
    const z = 0.012
    const v = 0.3
    const numeric = faradayEmf(200, dipoleFlux(m, 0.015, z + v * dz) - dipoleFlux(m, 0.015, z), dz)
    expect(dipoleEmf(200, m, 0.015, z, v)).toBeCloseTo(numeric, 6)
    expect(dipoleEmf(200, m, 0.015, 0, v)).toBe(0)
    expect(dipoleEmf(200, m, 0.015, -z, v)).toBeCloseTo(-dipoleEmf(200, m, 0.015, z, v), 12)
  })

  it('magnet stroke: EMF grows with speed and turns, none when still', () => {
    const s = magnetStroke(100, 1, 0.015, 0.05, 1, 0.25)
    expect(s.z).toBeCloseTo(0.05, 12)
    expect(s.v).toBeCloseTo(0, 12)
    expect(s.emf).toBeCloseTo(0, 12)
    const peak = strokePeakEmf(100, 1, 0.015, 0.05, 1)
    expect(strokePeakEmf(200, 1, 0.015, 0.05, 1)).toBeCloseTo(2 * peak, 9)
    expect(strokePeakEmf(100, 1, 0.015, 0.05, 2) / peak).toBeCloseTo(2, 2)
    expect(strokePeakEmf(100, 1, 0.015, 0.05, 0)).toBe(0)
    expect(peak).toBeGreaterThan(0.01)
  })
})

describe('inductors', () => {
  it('L = μ₀μr·N²A / l: twice the turns, four times the inductance', () => {
    const l = solenoidInductance(100, 0.05, 0.008)
    expect(l).toBeCloseTo(50.5e-6, 7)
    expect(solenoidInductance(200, 0.05, 0.008) / l).toBeCloseTo(4)
    expect(solenoidInductance(100, 0.05, 0.008, IRON_CORE.mur) / l).toBeCloseTo(IRON_CORE.mur)
  })
  it('½LI² equals the field energy B²/2μ₀ × volume inside a long coil', () => {
    const [n, len, r, i] = [100, 0.05, 0.008, 1.2]
    const b = solenoidB(n, len, i)
    expect(inductorEnergy(solenoidInductance(n, len, r), i)).toBeCloseTo(((b * b) / (2 * MU_0)) * Math.PI * r * r * len, 12)
    expect(inductorEnergy(0.01, 2) / inductorEnergy(0.01, 1)).toBeCloseTo(4)
  })
  it('V = L·dI/dt: cutting 50 mA through 0.2 H in 1 µs makes 10 kV', () => {
    expect(inductorVolts(0.2, 0.05, 1e-6)).toBeCloseTo(10000)
    expect(inductorVolts(0.2, 0.05, 10e-3)).toBeCloseTo(1)
    expect(switchOffSpike(12, 0.05, 0.2, 1e-3)).toBeCloseTo(22)
    expect(switchOffSpike(12, 0.05, 0.2, 10e-6)).toBeGreaterThan(AIR_ARC_V)
  })
})

describe('DC motor', () => {
  it('stalls below I0·R, then holds the no-load current and spins ∝ back-EMF', () => {
    expect(motorAmps(0.5)).toBeCloseTo(0.1, 9)
    expect(motorRpm(0.5)).toBe(0)
    expect(motorAmps(5)).toBe(TT_MOTOR.noLoadA)
    expect(motorRpm(5)).toBeCloseTo(162, 0)
    expect(motorRpm(6)).toBeCloseTo(200, 0)
  })
})

describe('relays', () => {
  const r = SRD_05
  it('pull in under the datasheet’s 75 % of coil volts and drop out above its 10 %', () => {
    const pullV = pullInAmps(r) * r.ohms
    const dropV = dropOutAmps(r) * r.ohms
    expect(pullV).toBeCloseTo(3.44, 2)
    expect(pullV).toBeLessThan(0.75 * r.coilV)
    expect(dropV).toBeCloseTo(0.535, 2)
    expect(dropV).toBeGreaterThan(0.1 * r.coilV)
    expect(coilAmps(5, r)).toBeCloseTo(0.0714, 4)
  })

  it('pull grows with I² and 1/g², balancing the spring at pull-in and drop-out, capped by the iron', () => {
    expect(relayPull(pullInAmps(r), r.openGapM, r)).toBeCloseTo(r.springN, 9)
    expect(relayPull(dropOutAmps(r), r.closedGapM, r)).toBeCloseTo(r.springN, 9)
    expect(relayPull(0.02, r.openGapM, r) / relayPull(0.01, r.openGapM, r)).toBeCloseTo(4, 9)
    expect(relayPull(0.01, r.closedGapM, r) / relayPull(0.01, r.openGapM, r)).toBeCloseTo((0.45 / 0.07) ** 2, 6)
    expect(relayPull(1, r.closedGapM, r)).toBeCloseTo((1.6 ** 2 * r.poleM2) / (2 * MU_0), 9)
  })

  it('latch with hysteresis: closes at pull-in, holds down to drop-out', () => {
    expect(relayLatch(false, 0.045, r)).toBe(false)
    expect(relayLatch(false, 0.05, r)).toBe(true)
    expect(relayLatch(true, 0.01, r)).toBe(true)
    expect(relayLatch(true, 0.007, r)).toBe(false)
  })

  it('operate and release times: coil τ to pull-in / drop-out, plus the armature’s flight', () => {
    const tau = r.henries / r.ohms
    expect(coilRiseTime(0.5, 1, 70, 0.1)).toBeCloseTo(tau * Math.LN2, 12)
    expect(coilRiseTime(1, 1, 70, 0.1)).toBe(Infinity)
    expect(operateTime(5, r)).toBeCloseTo(3.67e-3, 5)
    expect(operateTime(3, r)).toBe(Infinity)
    expect(coilDecayTime(1, Math.exp(-1), 70, 0.1, 0)).toBeCloseTo(tau, 12)
    const diode = releaseTime(0.7, r)
    const avalanche = releaseTime(35, r)
    expect(diode).toBeCloseTo(4.2e-3, 4)
    expect(avalanche).toBeLessThan(diode)
    expect(avalanche - r.travelS).toBeLessThan((diode - r.travelS) / 10)
  })

  it('flybackStep agrees: a clamp at breakdown holds the node there while the current falls as coilDecayTime says', () => {
    const coil = { vs: 5, ohms: r.ohms, henries: r.henries, farads: 10e-9, breakdownV: 40, closed: false }
    let s = { amps: coilAmps(5, r), volts: 0 }
    let t = 0
    let peak = 0
    while (s.amps > dropOutAmps(r)) {
      s = flybackStep(s, coil, 1e-8)
      t += 1e-8
      peak = Math.max(peak, s.volts)
    }
    expect(peak).toBe(40)
    expect(t).toBeCloseTo(coilDecayTime(coilAmps(5, r), dropOutAmps(r), r.ohms, r.henries, 35), 5)
    expect(flybackStep({ amps: 0, volts: 0 }, { ...coil, closed: true, onVolts: 0.5 }, 1).amps).toBeCloseTo(4.5 / 70, 9)
    let low = 0
    for (let k = 0; k < 2e5; k++) low = Math.min(low, (s = flybackStep(s, { ...coil, floorV: -0.7 }, 1e-8)).volts)
    expect(low).toBe(-0.7)
    const ringAfter = (lossOhms: number) => {
      let q = { amps: coilAmps(5, r), volts: 5 }
      let swing = 0
      for (let k = 0; k < 6e5; k++) {
        q = flybackStep(q, { ...coil, lossOhms }, 1e-8)
        if (k > 3e5) swing = Math.max(swing, Math.abs(q.volts - 5))
      }
      return swing
    }
    expect(ringAfter(3000)).toBeLessThan(ringAfter(Infinity) / 10)
  })

  it('contacts and a triac SSR heat up differently', () => {
    expect(contactHeat(10, r)).toBeCloseTo(3, 9)
    expect(ssrHeat(10, SSR_25DA)).toBeCloseTo(14.4, 1)
  })

  it('SSR input is an LED: a 3.3 V pin drives it directly', () => {
    expect(ssrInputAmps(3.3, SSR_25DA)).toBeGreaterThan(6e-3)
    expect(ssrInputAmps(3.3, SSR_25DA)).toBeLessThan(8e-3)
    expect(ssrTriggered(3.3, SSR_25DA)).toBe(true)
    expect(ssrTriggered(2, SSR_25DA)).toBe(false)
    expect(ssrInputAmps(0, SSR_25DA)).toBe(0)
  })

  it('zero-cross SSR waits for the mains to pass 0 V, both ways', () => {
    expect(nextZeroCross(0, 50)).toBeCloseTo(0, 12)
    expect(nextZeroCross(4.2e-3, 50)).toBeCloseTo(10e-3, 12)
    expect(nextZeroCross(10e-3, 50)).toBeCloseTo(10e-3, 12)
    expect(zeroCrossConducts(8e-3, 4.2e-3, 54.2e-3, 50)).toBe(false)
    expect(zeroCrossConducts(11e-3, 4.2e-3, 54.2e-3, 50)).toBe(true)
    expect(zeroCrossConducts(58e-3, 4.2e-3, 54.2e-3, 50)).toBe(true)
    expect(zeroCrossConducts(60.5e-3, 4.2e-3, 54.2e-3, 50)).toBe(false)
  })
})
