import {
  awgDiameter,
  carrierCurrent,
  chargeFlowed,
  deratedPower,
  driftVelocity,
  E_CHARGE,
  electronsIn,
  electronsPerSecond,
  energyAcross,
  energyOver,
  filamentOhms,
  heatingTemp,
  hotSpotC,
  JOULES_PER_WH,
  metalResistance,
  pickRating,
  meterReading,
  powerI2R,
  powerV2R,
  powerVI,
  relativeChange,
  relativeTo,
  RESISTIVITY,
  RESISTOR_MAX_C,
  resistorThermalK,
  ROOM_C,
  runtimeHours,
  seriesPotentials,
  TEMP_COEFF,
  wattHours,
  wireArea,
  wireResistance,
} from '.'

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
})

describe('power and energy', () => {
  it('P = V·I = I²R = V²/R agree', () => {
    expect(powerVI(12, 0.5)).toBe(6)
    expect(powerI2R(0.5, 24)).toBe(6)
    expect(powerV2R(12, 24)).toBe(6)
    expect(powerV2R(5, 100)).toBeCloseTo(0.25)
  })
  it('doubling the voltage across a resistor quadruples its power', () => {
    expect(powerV2R(10, 47) / powerV2R(5, 47)).toBeCloseTo(4)
  })
  it('1 W for a minute is 60 J; 1 Wh is 3600 J', () => {
    expect(energyOver(1, 60)).toBe(60)
    expect(energyOver(1, 3600)).toBe(JOULES_PER_WH)
  })
  it('a resistor at its rating settles at the hot-spot limit', () => {
    const k = resistorThermalK(0.25)
    expect(k).toBeCloseTo((RESISTOR_MAX_C - ROOM_C) / 0.25)
    expect(resistorThermalK(1)).toBeCloseTo(k / 4)
    expect(heatingTemp(ROOM_C, 0.25, k, 20, 0)).toBe(ROOM_C)
    expect(heatingTemp(ROOM_C, 0.25, k, 20, 20)).toBeCloseTo(ROOM_C + 130 * (1 - Math.exp(-1)))
    expect(heatingTemp(ROOM_C, 0.25, k, 20, 1e4)).toBeCloseTo(RESISTOR_MAX_C)
  })
  it('watt-hours compare batteries that mAh alone gets wrong', () => {
    expect(wattHours(3.7, 3000)).toBeCloseTo(11.1)
    expect(wattHours(9, 550)).toBeCloseTo(4.95)
    expect(wattHours(1.2, 2000)).toBeCloseTo(2.4)
    expect(runtimeHours(3000, 200)).toBe(15)
  })
  it('derating: full rating to 70 °C, half at 112.5 °C, none at 155 °C', () => {
    expect(deratedPower(0.25, 25)).toBe(0.25)
    expect(deratedPower(0.25, 70)).toBe(0.25)
    expect(deratedPower(0.25, 112.5)).toBeCloseTo(0.125)
    expect(deratedPower(0.25, 160)).toBe(0)
    expect(hotSpotC(0.25, 0.25, 70)).toBe(RESISTOR_MAX_C)
    expect(hotSpotC(deratedPower(1, 100), 1, 100)).toBeCloseTo(RESISTOR_MAX_C)
  })
  it('picks the smallest rating with 2× headroom', () => {
    expect(pickRating(0.1, 25)).toBe(0.25)
    expect(pickRating(0.125, 25)).toBe(0.25)
    expect(pickRating(0.14, 25)).toBe(0.5)
    expect(pickRating(0.14, 100)).toBe(0.5)
    expect(pickRating(0.2, 100)).toBe(1)
    expect(pickRating(1.5, 25)).toBeNull()
  })
})
