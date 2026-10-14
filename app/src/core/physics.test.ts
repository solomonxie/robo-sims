import {
  COULOMB_K,
  DIELECTRIC,
  EPSILON_0,
  capacitorCharge,
  capacitorEnergy,
  chargesField,
  coulombForce,
  forceInField,
  plateCapacitance,
  plateField,
  pointField,
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
  energyOver,
  heatingTemp,
  JOULES_PER_WH,
  powerI2R,
  powerV2R,
  powerVI,
  RESISTOR_MAX_C,
  resistorThermalK,
  runtimeHours,
  wattHours,
  filamentOhms,
  meterReading,
  relativeTo,
  seriesPotentials,
  intrinsicCarriers,
  MODERN_NMOS,
  rcStep,
  resistorPair,
  seriesChain,
  parallelBranches,
  cellPack,
  seriesWithPair,
  dividerOut,
  loadedDivider,
  adcCounts,
  RESISTIVITY,
  ROOM_C,
  TEMP_COEFF,
  awgDiameter,
  metalResistance,
  relativeChange,
  wireArea,
  wireResistance,
  twoSourceNode,
  twoSourceLoop,
  bridgeNodes,
  bridgeCircuit,
  bridgeCurrents,
  bridgeMatrix,
  nortonLoad,
  powerTransfer,
  theveninDemo,
  theveninLoad,
  MAINS,
  RMS_FACTOR,
  acVolts,
  angularFrequency,
  lampOhms,
  peakFromRms,
  peakToPeak,
  periodOf,
  rmsFromPeak,
  rmsOf,
  sloshAmplitude,
  waveAt,
} from './physics'
import { gaussSolve, relaxSweep } from './nodal'
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
  it('a series chain shares the voltage in proportion to R', () => {
    const s = seriesChain(9, [100, 200])
    expect(s.totalOhms).toBe(300)
    expect(s.amps).toBeCloseTo(0.03)
    expect(s.drops[0]).toBeCloseTo(3)
    expect(s.drops[0] + s.drops[1]).toBeCloseTo(9)
  })
  it('parallel branches: currents add, total below the smallest', () => {
    const p = parallelBranches(9, [100, 100, 220])
    expect(p.branchAmps[0]).toBeCloseTo(0.09)
    expect(p.branchAmps.reduce((a, b) => a + b)).toBeCloseTo(p.amps)
    expect(p.totalOhms).toBeLessThan(100)
    expect(parallelBranches(9, [100, 100]).totalOhms).toBeCloseTo(50)
  })
  it('cells: series adds volts, parallel adds mAh', () => {
    expect(cellPack(1.5, 2000, 2, 1)).toEqual({ volts: 3, mAh: 2000, wh: 6, cells: 2 })
    expect(cellPack(1.5, 2000, 1, 2)).toEqual({ volts: 1.5, mAh: 4000, wh: 6, cells: 2 })
    expect(cellPack(3.7, 3000, 2, 2).wh).toBeCloseTo(44.4)
  })
  it('R1 + (R2 ∥ R3) reduces step by step', () => {
    const m = seriesWithPair(100, 220, 220, 9)
    expect(m.pairOhms).toBeCloseTo(110)
    expect(m.totalOhms).toBeCloseTo(210)
    expect(m.v1 + m.pairV).toBeCloseTo(9)
    expect(m.amps2 + m.amps3).toBeCloseTo(m.amps)
  })
  it('a divider gives Vin × R₂ / (R₁ + R₂); only the ratio matters', () => {
    expect(dividerOut(9, 10e3, 10e3)).toBeCloseTo(4.5)
    expect(dividerOut(9, 1e3, 1e3)).toBeCloseTo(4.5)
    expect(dividerOut(5, 1e3, 2e3)).toBeCloseTo(3.333, 3)
    expect(dividerOut(9, 2.2e3, 1e3)).toBeCloseTo(2.8125)
  })
  it('a load across R₂ drags Vout down; ten times R₂ costs about 5 %', () => {
    const d = loadedDivider(9, 10e3, 10e3, 100e3)
    expect(d.unloaded).toBeCloseTo(4.5)
    expect(d.vout).toBeCloseTo(4.286, 3)
    expect(d.sag).toBeCloseTo(0.0476, 3)
    expect(d.amps2 + d.loadAmps).toBeCloseTo(d.amps)
    expect(d.sourceOhms).toBeCloseTo(5000)
    expect(loadedDivider(9, 10e3, 10e3, 1e3).vout).toBeCloseTo(0.75)
    expect(loadedDivider(9, 1e3, 1e3, 1e3).vout).toBeCloseTo(3)
    expect(loadedDivider(9, 1e3, 1e3, 1e9).sag).toBeLessThan(1e-5)
  })
  it('a 12-bit ADC maps 0..Vref onto 0..4095', () => {
    expect(adcCounts(0, 3.3, 12)).toBe(0)
    expect(adcCounts(1.65, 3.3, 12)).toBe(2048)
    expect(adcCounts(3.3, 3.3, 12)).toBe(4095)
    expect(adcCounts(5, 3.3, 12)).toBe(4095)
    expect(adcCounts(-1, 3.3, 10)).toBe(0)
  })
  it('one time constant charges to 63%', () => {
    expect(rcStep(0, 1, 2, 2)).toBeCloseTo(0.632, 3)
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

describe('kirchhoff', () => {
  it('two sources into one node: Millman’s formula, and the currents in add to the current out', () => {
    const s = twoSourceNode(9, 100, 5, 150, 220)
    const g = 1 / 100 + 1 / 150 + 1 / 220
    expect(s.node).toBeCloseTo((9 / 100 + 5 / 150) / g, 10)
    expect(s.i1 + s.i2).toBeCloseTo(s.i3, 12)
    expect(s.i3).toBeCloseTo(s.node / 220, 12)
    expect(s.i2).toBeLessThan(0) // the 5 V cell is being charged
    expect(twoSourceNode(9, 100, 12, 150, 220).i2).toBeGreaterThan(0)
  })
  it('every loop of the two-source circuit sums to 0 and each step is ±I × R or a cell', () => {
    const s = twoSourceNode(9, 100, 5, 150, 220)
    for (const loop of ['left', 'right', 'outer'] as const) expect(twoSourceLoop(s.volts, loop).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12)
    const [cell, r1, r3] = twoSourceLoop(s.volts, 'left')
    expect(cell).toBe(9)
    expect(r1).toBeCloseTo(-s.i1 * 100, 12)
    expect(r3).toBeCloseTo(-s.i3 * 220, 12)
    expect(twoSourceLoop(s.volts, 'outer')[3]).toBe(-5)
  })
  it('a bridge with R₁/R₂ = R₃/R₄ is balanced; unbalanced, the bridge current flows from the higher tap', () => {
    const balanced = bridgeNodes(9, [100, 200, 1000, 2000, 330])
    expect(balanced.amps[4]).toBeCloseTo(0, 12)
    expect(balanced.va).toBeCloseTo(6, 10)
    const s = bridgeNodes(9, [100, 220, 220, 100, 330])
    expect(s.va).toBeGreaterThan(s.vb)
    expect(s.amps[4]).toBeGreaterThan(0)
    expect(s.amps[0]).toBeCloseTo(s.amps[1] + s.amps[4], 12)
    expect(s.supply).toBeCloseTo(s.amps[1] + s.amps[3], 12)
  })
  it('the substituted 2 × 2 system gives the same taps as the full solve', () => {
    const r: [number, number, number, number, number] = [100, 220, 220, 470, 47]
    const { g, i } = bridgeMatrix(9, r)
    const [va, vb] = gaussSolve(g, i)!
    const exact = bridgeNodes(9, r)
    expect(va).toBeCloseTo(exact.va, 10)
    expect(vb).toBeCloseTo(exact.vb, 10)
  })
  it('relaxing the bridge from 0 V reaches the exact taps', () => {
    const r: [number, number, number, number, number] = [100, 220, 220, 100, 330]
    const els = bridgeCircuit(9, r)
    let v = [0, 0, 0, 0]
    for (let k = 0; k < 40; k++) v = relaxSweep(3, els, v)
    const exact = bridgeNodes(9, r)
    expect(v[2]).toBeCloseTo(exact.va, 6)
    expect(bridgeCurrents(els, v).amps[4]).toBeCloseTo(exact.amps[4], 6)
  })
})

describe('Thevenin & Norton', () => {
  it('the demo network reduces to 6 V behind 150 Ω, 40 mA short-circuit', () => {
    const s = theveninDemo(12, [100, 100, 100], 1e3)
    expect(s.vth).toBeCloseTo(6, 12)
    expect(s.rth).toBeCloseTo(150, 9)
    expect(s.norton).toBeCloseTo(0.04, 12)
  })
  it('any load sees the same volts and amps from the network, its Thevenin and its Norton equivalent', () => {
    for (const load of [10, 150, 470, 10e3]) {
      const s = theveninDemo(12, [220, 330, 47], load)
      const t = theveninLoad(s.vth, s.rth, load)
      const n = nortonLoad(s.norton, s.rth, load)
      expect(t.amps).toBeCloseTo(s.il, 12)
      expect(t.volts).toBeCloseTo(s.vl, 10)
      expect(n.amps).toBeCloseTo(s.il, 12)
      expect(n.inRth).toBeCloseTo(s.norton - s.il, 12)
      expect(s.i1).toBeCloseTo(s.i2 + s.il, 12)
    }
  })
  it('load power peaks at RL = Rth with Vth² / 4Rth and 50 % efficiency', () => {
    const best = powerTransfer(6, 150, 150)
    expect(best.loadW).toBeCloseTo(0.06, 12)
    expect(best.maxW).toBeCloseTo(0.06, 12)
    expect(best.efficiency).toBe(0.5)
    expect(best.lostW).toBeCloseTo(best.loadW, 12)
    expect(best.volts).toBeCloseTo(3, 12)
    for (const load of [100, 220, 1000]) expect(powerTransfer(6, 150, load).loadW).toBeLessThan(best.loadW)
    expect(powerTransfer(6, 150, 1500).efficiency).toBeCloseTo(1500 / 1650, 12)
  })
})

describe('ac', () => {
  const sample = (f: (c: number) => number, n = 4000) => Array.from({ length: n }, (_, k) => f((k + 0.5) / n))

  it('waves peak at ±1 a quarter cycle in and cross 0 at whole cycles', () => {
    for (const w of ['sine', 'square', 'triangle'] as const) {
      expect(waveAt(w, 0.25)).toBeCloseTo(1, 12)
      expect(waveAt(w, 2.75)).toBeCloseTo(-1, 12)
      expect(waveAt(w, -0.75)).toBeCloseTo(1, 12)
    }
    expect(waveAt('sine', 3)).toBeCloseTo(0, 12)
    expect(waveAt('triangle', 1)).toBeCloseTo(0, 12)
  })

  it('RMS factors match the sampled waves, and the average is 0', () => {
    for (const w of ['sine', 'square', 'triangle'] as const) {
      const s = sample((c) => waveAt(w, c))
      expect(rmsOf(s)).toBeCloseTo(RMS_FACTOR[w], 6)
      expect(s.reduce((a, b) => a + b, 0) / s.length).toBeCloseTo(0, 9)
    }
    expect(rmsFromPeak(12)).toBeCloseTo(8.485, 3)
    expect(peakFromRms(230)).toBeCloseTo(325.3, 1)
    expect(peakFromRms(12, 'square')).toBe(12)
    expect(peakToPeak(325)).toBe(650)
  })

  it('average AC power equals DC power at the RMS voltage', () => {
    const r = 12
    for (const w of ['sine', 'square', 'triangle'] as const) {
      const p = sample((c) => acVolts(10, 1, c, w) ** 2 / r)
      expect(p.reduce((a, b) => a + b, 0) / p.length).toBeCloseTo(rmsFromPeak(10, w) ** 2 / r, 4)
    }
  })

  it('period and angular frequency', () => {
    expect(periodOf(MAINS.eu.hz)).toBeCloseTo(0.02, 12)
    expect(periodOf(MAINS.us.hz) * 1000).toBeCloseTo(16.67, 2)
    expect(angularFrequency(50)).toBeCloseTo(314.16, 2)
    expect(acVolts(325, 50, 0.005)).toBeCloseTo(325, 9)
  })

  it('a 60 W mains lamp: R = V² / P, electrons slosh only tens of nanometres', () => {
    expect(lampOhms(230, 60)).toBeCloseTo(881.7, 1)
    const peak = Math.SQRT2 * (230 / lampOhms(230, 60))
    const x = sloshAmplitude(peak, 1.5e-6, 50)
    expect(x).toBeGreaterThan(30e-9)
    expect(x).toBeLessThan(100e-9)
  })
})

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
