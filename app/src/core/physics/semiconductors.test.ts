import {
  builtInVoltage,
  depletionWidth,
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
  MODERN_NMOS,
} from '.'

describe('semiconductors', () => {
  it('silicon has ~1e10 intrinsic carriers per cm³ at room temperature, rising steeply with heat', () => {
    expect(intrinsicCarriers(300)).toBeCloseTo(1e10, -8)
    expect(intrinsicCarriers(400) / intrinsicCarriers(300)).toBeGreaterThan(100)
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
