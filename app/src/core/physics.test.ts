import {
  builtInVoltage,
  carrierCurrent,
  chargeFlowed,
  E_CHARGE,
  electronsIn,
  depletionWidth,
  diodeCurrent,
  drainCurrent,
  driftVelocity,
  electronsPerSecond,
  energyAcross,
  filamentOhms,
  meterReading,
  relativeTo,
  seriesPotentials,
  intrinsicCarriers,
  MODERN_NMOS,
  rcStep,
  resistorPair,
  RESISTIVITY,
  ROOM_C,
  TEMP_COEFF,
  awgDiameter,
  metalResistance,
  relativeChange,
  wireArea,
  wireResistance,
} from './physics'
import { sci, si } from './units'

describe('electricity', () => {
  it('a filament starts at a tenth of its hot resistance and reaches it at the rated voltage', () => {
    expect(filamentOhms(0, 120, 12)).toBeCloseTo(12)
    expect(filamentOhms(12, 120, 12)).toBeCloseTo(120)
    expect(filamentOhms(3, 120, 12)).toBeCloseTo(66)
    expect(filamentOhms(-3, 120, 12)).toBe(filamentOhms(3, 120, 12))
  })
  it('1 A is about 6.24e18 electrons per second', () => {
    expect(electronsPerSecond(1)).toBeCloseTo(6.2415e18, -15)
  })
  it('1 A for 1 s moves 1 C; 20 mA for an hour moves 72 C; 1 mAh is 3.6 C', () => {
    expect(chargeFlowed(1, 1)).toBe(1)
    expect(chargeFlowed(0.02, 3600)).toBeCloseTo(72)
    expect(chargeFlowed(1e-3, 3600)).toBeCloseTo(3.6)
    expect(electronsIn(1)).toBeCloseTo(6.2415e18, -15)
    expect(electronsIn(-1)).toBe(electronsIn(1))
  })
  it('electrons drifting backwards carry the same current as + charges drifting forwards', () => {
    const v = driftVelocity(1, 1e-6)
    expect(carrierCurrent(-E_CHARGE, -v, 1e-6)).toBeCloseTo(1)
    expect(carrierCurrent(E_CHARGE, v, 1e-6)).toBeCloseTo(1)
  })
  it('1 V gives 1 J per coulomb; an electron across 1 V gains 1 eV', () => {
    expect(energyAcross(9, 1)).toBe(9)
    expect(energyAcross(1, E_CHARGE)).toBeCloseTo(1.602e-19, 22)
  })
  it('a 1k + 2k chain on 9 V sits at 9, 6, 0 V; moving ground keeps the differences', () => {
    const v = seriesPotentials(9, [1000, 2000])
    expect(v[0]).toBe(9)
    expect(v[1]).toBeCloseTo(6)
    expect(v[2]).toBe(0)
    const fromMiddle = relativeTo(v, v[1])
    expect(fromMiddle[0]).toBeCloseTo(3)
    expect(fromMiddle[2]).toBeCloseTo(-6)
    expect(fromMiddle[0] - fromMiddle[1]).toBeCloseTo(v[0] - v[1])
  })
  it('a meter reads red minus black, so swapped probes read negative', () => {
    expect(meterReading(9, 6)).toBe(3)
    expect(meterReading(6, 9)).toBe(-3)
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
  it('AWG 22 is 0.64 mm; every 6 gauges halves the diameter, so R quadruples', () => {
    expect(awgDiameter(22) * 1000).toBeCloseTo(0.644, 3)
    expect(awgDiameter(36) * 1000).toBeCloseTo(0.127, 6)
    expect(awgDiameter(16) / awgDiameter(22)).toBeCloseTo(2, 1)
    const r = (g: number) => wireResistance(RESISTIVITY.copper, 1, awgDiameter(g))
    expect(r(22)).toBeCloseTo(0.0516, 3)
    expect(r(28) / r(22)).toBeCloseTo(4, 0)
    expect(wireArea(2e-3)).toBeCloseTo(Math.PI * 1e-6, 12)
  })
  it('copper gains ~39 % resistance per 100 °C; nichrome barely moves', () => {
    expect(metalResistance(100, TEMP_COEFF.copper, ROOM_C)).toBe(100)
    expect(metalResistance(100, TEMP_COEFF.copper, ROOM_C + 100)).toBeCloseTo(139)
    expect(relativeChange(metalResistance(100, TEMP_COEFF.nichrome, ROOM_C + 100), 100)).toBeCloseTo(0.04)
    expect(metalResistance(100, TEMP_COEFF.copper, ROOM_C - 50)).toBeLessThan(100)
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
