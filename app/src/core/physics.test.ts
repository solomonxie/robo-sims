import {
  builtInVoltage,
  depletionWidth,
  diodeCurrent,
  drainCurrent,
  driftVelocity,
  electronsPerSecond,
  intrinsicCarriers,
  MODERN_NMOS,
  rcStep,
  resistorPair,
  RESISTIVITY,
  wireResistance,
} from './physics'
import { sci, si } from './units'

describe('electricity', () => {
  it('1 A is about 6.24e18 electrons per second', () => {
    expect(electronsPerSecond(1)).toBeCloseTo(6.2415e18, -15)
  })
  it('drift speed in 1 mm² copper at 1 A is well under a mm/s', () => {
    const v = driftVelocity(1, 1e-6)
    expect(v).toBeGreaterThan(5e-5)
    expect(v).toBeLessThan(1e-4)
  })
  it('1 m of 1 mm² copper is about 17 mΩ', () => {
    const d = 2 * Math.sqrt(1e-6 / Math.PI)
    expect(wireResistance(RESISTIVITY.copper, 1, d)).toBeCloseTo(0.0168, 4)
  })
  it('series adds, parallel splits current toward the smaller resistor', () => {
    expect(resistorPair(100, 200, 9, 'series').totalOhms).toBe(300)
    const p = resistorPair(100, 100, 9, 'parallel')
    expect(p.totalOhms).toBe(50)
    expect(p.amps1 + p.amps2).toBeCloseTo(p.amps)
  })
  it('one time constant charges to 63%', () => {
    expect(rcStep(0, 1, 2, 2)).toBeCloseTo(0.632, 3)
  })
})

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

describe('units', () => {
  it('formats SI prefixes', () => {
    expect(si(0.0123, 'A')).toBe('12.3 mA')
    expect(si(4700, 'Ω')).toBe('4.7 kΩ')
    expect(si(0, 'V')).toBe('0 V')
    expect(si(3e-9, 'm')).toBe('3 nm')
  })
  it('formats scientific notation', () => {
    expect(sci(6.24e18)).toBe('6.24 × 10¹⁸')
    expect(sci(2.5e-5)).toBe('2.5 × 10⁻⁵')
  })
})
