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
