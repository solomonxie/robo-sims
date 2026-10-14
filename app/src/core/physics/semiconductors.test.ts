import {
  builtInVoltage,
  carrierDensities,
  conductivity,
  driftSpeeds,
  electronShare,
  intrinsicDensity,
  SEMICONDUCTORS,
  depletionWidth,
  depletion,
  junctionPotential,
  diodeCurrent,
  diodeAmps,
  diodeNode,
  DIODES,
  diodeVolts,
  Diode,
  Flyback,
  flybackSpike,
  flybackStep,
  drainCurrent,
  intrinsicCarriers,
  LED_RATED_A,
  LEDS,
  matrixScan,
  photonEv,
  rowOnFractions,
  MODERN_NMOS,
} from '.'

describe('semiconductors', () => {
  it('silicon has ~1e10 intrinsic carriers per cm³ at room temperature, rising steeply with heat', () => {
    expect(intrinsicCarriers(300)).toBeCloseTo(1e10, -8)
    expect(intrinsicCarriers(400) / intrinsicCarriers(300)).toBeGreaterThan(100)
  })
  it('a wider band gap means far fewer carriers: germanium > silicon > diamond', () => {
    const { germanium, silicon, diamond } = SEMICONDUCTORS
    expect(intrinsicDensity(300, silicon)).toBeCloseTo(1e10, -8)
    expect(intrinsicDensity(300, germanium) / intrinsicDensity(300, silicon)).toBeGreaterThan(1000)
    expect(intrinsicDensity(600, diamond)).toBeLessThan(1)
  })
  it('1e16 phosphorus makes n ≈ 1e16 and p ≈ 1e4, conducting ~a million times better than pure silicon', () => {
    const doped = carrierDensities(300, { donors: 1e16 })
    expect(doped.n).toBeCloseTo(1e16, -12)
    expect(doped.p).toBeCloseTo(1e4, -2)
    const boron = carrierDensities(300, { acceptors: 1e16 })
    expect(boron.p).toBeCloseTo(1e16, -12)
    expect(boron.n * boron.p).toBeCloseTo(boron.ni ** 2, -12)
    const pure = carrierDensities(300)
    expect(pure.n).toBeCloseTo(pure.p, 0)
    const gain = conductivity(doped.n, doped.p) / conductivity(pure.n, pure.p)
    expect(gain).toBeGreaterThan(5e5)
    expect(gain).toBeLessThan(2e6)
    expect(1 / conductivity(doped.n, doped.p)).toBeCloseTo(0.46, 1)
  })
  it('electrons drift ~2.8x faster than holes, so they carry ~74 % of pure silicon’s current', () => {
    const v = driftSpeeds(1, 1e-3)
    expect(v.electron).toBeCloseTo(135, 6)
    expect(v.electron / v.hole).toBeCloseTo(2.81, 2)
    expect(electronShare(1e10, 1e10)).toBeCloseTo(0.738, 2)
  })
  it('a 1e16/1e16 junction has ~0.7 V built in and a ~0.4 µm depletion region', () => {
    expect(builtInVoltage(1e16, 1e16)).toBeCloseTo(0.71, 1)
    const w = depletionWidth(1e16, 1e16, 0)
    expect(w).toBeGreaterThan(0.3e-6)
    expect(w).toBeLessThan(0.5e-6)
  })
  it('reverse bias widens the depletion region, forward narrows it', () => {
    const w0 = depletionWidth(1e16, 1e16, 0)
    expect(depletionWidth(1e16, 1e16, -3)).toBeGreaterThan(w0)
    expect(depletionWidth(1e16, 1e16, 0.5)).toBeLessThan(w0)
  })
  it('a one-sided junction depletes into the lighter side, with Na·xp = Nd·xn', () => {
    const d = depletion(1e18, 1e15, 0)
    expect(d.xp + d.xn).toBeCloseTo(d.w, 12)
    expect(d.xn / d.xp).toBeCloseTo(1000, 6)
    expect(d.peakField).toBeCloseTo((2 * d.barrier) / d.w, -2)
    expect(depletion(1e16, 1e16, 0).peakField).toBeGreaterThan(2e6)
  })
  it('junction potential climbs smoothly from 0 to the barrier', () => {
    expect(junctionPotential(-2, 1, 1, 0.7)).toBe(0)
    expect(junctionPotential(0, 1, 1, 0.7)).toBeCloseTo(0.35)
    expect(junctionPotential(0, 1, 3, 0.8)).toBeCloseTo(0.2)
    expect(junctionPotential(5, 1, 3, 0.8)).toBe(0.8)
  })
  it('diode current grows ~10x per 60 mV', () => {
    expect(diodeCurrent(0.66) / diodeCurrent(0.6)).toBeCloseTo(10.2, 0)
    expect(diodeCurrent(-1)).toBeCloseTo(-1e-12)
  })
  it('a transistor is off below threshold and on above', () => {
    expect(drainCurrent(0)).toBeLessThan(1e-9)
    expect(drainCurrent(0.8)).toBeGreaterThan(5e-5)
    expect(drainCurrent(MODERN_NMOS.vthV + 0.01)).toBeGreaterThan(drainCurrent(MODERN_NMOS.vthV))
  })
})

describe('diode model', () => {
  const si = DIODES['1N4148']
  it('a silicon diode drops ~0.6–0.75 V over three decades of current, a Schottky ~0.2–0.3 V', () => {
    expect(diodeVolts(1e-3, si)).toBeCloseTo(0.585, 2)
    expect(diodeVolts(10e-3, si)).toBeCloseTo(0.689, 2)
    expect(diodeVolts(10e-3, DIODES['1N5819'])).toBeLessThan(0.3)
    expect(diodeAmps(diodeVolts(20e-3, si), si)).toBeCloseTo(20e-3, 8)
  })
  it('reverse current is just the saturation leak until a zener breaks down', () => {
    expect(diodeAmps(-10, si)).toBeCloseTo(-si.saturationA, 15)
    const z = DIODES.zener5V1
    expect(diodeAmps(-5.1, z)).toBeCloseTo(-5e-3, 6)
    expect(Math.abs(diodeAmps(-3, z))).toBeLessThan(1e-9)
  })
  it('a 9 V loop through 220 Ω and a 1N4148 leaves ~0.75 V on the diode', () => {
    const s = diodeNode(9, 220, si)
    expect(s.v).toBeCloseTo(0.75, 1)
    expect(s.sourceA).toBeCloseTo((9 - s.v) / 220, 9)
    expect(s.diodeA).toBeCloseTo(s.sourceA, 6)
    expect(diodeNode(-9, 220, si).sourceA).toBeCloseTo(-si.saturationA, 12)
  })
  it('a zener clamps near 5.1 V until the load takes more than the resistor can supply', () => {
    const z = DIODES.zener5V1
    expect(diodeNode(12, 220, z, { reversed: true }).v).toBeCloseTo(5.2, 1)
    expect(diodeNode(3, 220, z, { reversed: true }).v).toBeCloseTo(3, 3)
    const heavy = diodeNode(9, 220, z, { reversed: true, load: 220 })
    expect(heavy.v).toBeCloseTo(4.5, 2)
    expect(heavy.loadA + heavy.diodeA).toBeCloseTo(heavy.sourceA, 9)
  })
  it('opening a coil switch spikes to I·√(L/C) without a diode, Vs + ~0.7 V with one', () => {
    const coil = { vs: 12, ohms: 240, henries: 0.2, farads: 10e-9 }
    const run = (diode?: Diode) => {
      let s: Flyback = { amps: 0, volts: 0 }
      for (let t = 0; t < 5e-3; t += 1e-6) s = flybackStep(s, { ...coil, diode, closed: true }, 1e-6)
      expect(s.amps).toBeCloseTo(0.05, 3)
      let peak = 0
      for (let t = 0; t < 5e-3; t += 1e-7) {
        s = flybackStep(s, { ...coil, diode, closed: false }, 1e-7)
        peak = Math.max(peak, s.volts)
      }
      return { peak, s }
    }
    const bare = run().peak
    expect(bare).toBeLessThan(flybackSpike(12, 0.05, 0.2, 10e-9))
    expect(bare).toBeGreaterThan(0.95 * flybackSpike(12, 0.05, 0.2, 10e-9))
    const clamped = run(DIODES['1N4007'])
    expect(clamped.peak).toBeGreaterThan(12.5)
    expect(clamped.peak).toBeLessThan(12.8)
    expect(clamped.s).toEqual({ amps: 0, volts: 12 })
  })
})

describe('LEDs', () => {
  const leds = Object.values(LEDS)
  it('drop their rated Vf at 20 mA and climb ×10 per ~0.12 V', () => {
    for (const l of leds) expect(diodeVolts(LED_RATED_A, l)).toBeCloseTo(l.vf, 6)
    expect(diodeVolts(2e-3, LEDS.red)).toBeCloseTo(1.88, 2)
  })
  it('need at least the photon energy: shorter wavelength, higher Vf', () => {
    expect(photonEv(625)).toBeCloseTo(1.98, 2)
    for (const l of leds) expect(l.vf).toBeGreaterThanOrEqual(photonEv(l.nm))
    const byNm = [...leds].sort((a, b) => b.nm - a.nm)
    byNm.slice(1).forEach((l, i) => expect(l.vf).toBeGreaterThan(byNm[i].vf))
  })
  it('a red LED through 150 Ω from 5 V runs near 20 mA; a blue one gets less', () => {
    expect(diodeNode(5, 150, LEDS.red).sourceA).toBeCloseTo(0.0199, 3)
    expect(diodeNode(5, 150, LEDS.blue).sourceA).toBeCloseTo(0.0127, 3)
    expect(diodeNode(2.5, 150, LEDS.blue).sourceA).toBeLessThan(1e-5)
  })
  it('an 8×8 matrix lights 64 LEDs from 16 pins, each on 1/8 of the time', () => {
    expect(matrixScan(8, 8, 800)).toEqual({ frameHz: 100, duty: 0.125, pins: 16, leds: 64 })
    expect(rowOnFractions(0, 1 / 8, 8, 8)).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    const f = rowOnFractions(0.3, 1 / 60, 2000, 8)
    expect(f.reduce((a, b) => a + b)).toBeCloseTo(1, 9)
    for (const x of f) expect(x).toBeCloseTo(0.125, 1)
    expect(rowOnFractions(0.0625, 0.125, 8, 8).slice(0, 2)).toEqual([0.5, 0.5])
  })
})
