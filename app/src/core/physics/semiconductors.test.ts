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
  MOSFETS,
  HOLE_MOBILITY_RATIO,
  channelCarriers,
  channelOverdrive,
  cmosInverter,
  dynamicPower,
  inverterDelay,
  inverterStep,
  mosfetDrain,
  rdsOn,
  switchingEnergy,
  switchingPoint,
  BJTS,
  baseResistorFor,
  bjtCollector,
  bjtSwitch,
  ledStringAmps,
  FET_PARTS,
  fetSwitch,
  gateDrivePeriod,
  junctionTemp,
  millerPlateau,
  thresholdAt,
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

describe('MOSFET model', () => {
  const m = MODERN_NMOS
  it('is cut off below threshold, triode at small Vds, saturated past Vds = Vgs − Vth', () => {
    expect(mosfetDrain(0.2, 0.5).region).toBe('cutoff')
    expect(mosfetDrain(0.85, 0.2).region).toBe('triode')
    expect(mosfetDrain(0.85, 0.6).region).toBe('saturation')
    const clm = (vds: number) => 1 + m.lambda! * vds
    expect(mosfetDrain(0.85, 0.2).amps).toBeCloseTo(m.k * (0.5 * 0.2 - 0.02) * clm(0.2), 5)
    expect(mosfetDrain(0.85, 0.6).amps).toBeCloseTo((m.k / 2) * 0.25 * clm(0.6), 5)
  })
  it('is continuous at the triode/saturation edge and nearly flat beyond it', () => {
    expect(mosfetDrain(0.85, 0.5 - 1e-9).amps).toBeCloseTo(mosfetDrain(0.85, 0.5).amps, 9)
    expect(mosfetDrain(0.85, 1).amps / mosfetDrain(0.85, 0.5).amps).toBeCloseTo(1.1 / 1.05, 3)
    expect(mosfetDrain(0.85, 0).amps).toBe(0)
  })
  it('leaks ~10x less per 77 mV below threshold, and swaps source and drain for Vds < 0', () => {
    expect(mosfetDrain(0.2, 0.5).amps / mosfetDrain(0.2 - 0.0775, 0.5).amps).toBeCloseTo(10, 0)
    expect(mosfetDrain(0.85, -0.2).amps).toBeCloseTo(-mosfetDrain(1.05, 0.2).amps, 9)
  })
  it('discrete parts match their datasheet on-resistance', () => {
    expect(rdsOn(10, MOSFETS['2N7000'])).toBeCloseTo(1.8, 1)
    expect(rdsOn(5, MOSFETS.IRLZ44N)).toBeCloseTo(0.022, 3)
    expect(rdsOn(1, MOSFETS.IRLZ44N)).toBe(Infinity)
  })
  it('the channel thins toward the drain and pinches off in saturation', () => {
    expect(channelOverdrive(0, 0.85, 0.3)).toBeCloseTo(0.5)
    expect(channelOverdrive(1, 0.85, 0.3)).toBeCloseTo(0.2)
    expect(channelOverdrive(1, 0.85, 0.8)).toBe(0)
    expect(channelOverdrive(0.5, 0.2, 0.3)).toBe(0)
    expect(channelCarriers(0.5, 1.2e-9)).toBeCloseTo(9e4, -4)
  })
})

describe('CMOS inverter', () => {
  const weak = { ...MODERN_NMOS, k: MODERN_NMOS.k / HOLE_MOBILITY_RATIO }
  it('swings rail to rail and flips at Vdd/2 when matched', () => {
    expect(cmosInverter(0, 1).vout).toBeGreaterThan(0.999)
    expect(cmosInverter(1, 1).vout).toBeLessThan(0.001)
    expect(cmosInverter(0.5, 1).vout).toBeCloseTo(0.5, 2)
    expect(switchingPoint(1)).toBeCloseTo(0.5)
  })
  it('a weaker PMOS pulls the switching point down', () => {
    const vm = switchingPoint(1, MODERN_NMOS, weak)
    expect(vm).toBeLessThan(0.47)
    expect(cmosInverter(vm - 0.02, 1, MODERN_NMOS, weak).vout).toBeGreaterThan(0.5)
    expect(cmosInverter(vm + 0.02, 1, MODERN_NMOS, weak).vout).toBeLessThan(0.5)
    expect(cmosInverter(0.5, 1, MODERN_NMOS, weak).vout).toBeLessThan(0.3)
  })
  it('draws current only while switching', () => {
    expect(cmosInverter(0, 1).amps).toBeLessThan(1e-9)
    expect(cmosInverter(0.5, 1).amps).toBeCloseTo((MODERN_NMOS.k / 2) * 0.15 ** 2 * 1.05, 5)
  })
  it('charging a load draws C·V² from the supply and burns half of it in the PMOS', () => {
    const c = 10e-15
    let s = { vout: 0, supplyJ: 0, pmosJ: 0, nmosJ: 0 }
    s = inverterStep(s, { vin: 0, vdd: 1, farads: c }, 2e-9)
    expect(s.vout).toBeCloseTo(1, 3)
    expect(s.supplyJ).toBeCloseTo(switchingEnergy(c, 1), 17)
    expect(s.pmosJ / s.supplyJ).toBeCloseTo(0.5, 2)
    s = inverterStep(s, { vin: 1, vdd: 1, farads: c }, 2e-9)
    expect(s.vout).toBeLessThan(1e-3)
    expect(s.nmosJ / switchingEnergy(c, 1)).toBeCloseTo(0.5, 2)
  })
  it('lower supply saves V² energy but switches slower', () => {
    expect(switchingEnergy(1e-15, 0.5) / switchingEnergy(1e-15, 1)).toBeCloseTo(0.25)
    expect(dynamicPower(1e-15, 1, 1e9, 0.1)).toBeCloseTo(1e-7)
    const fast = inverterDelay(1, 10e-15)
    expect(fast).toBeGreaterThan(5e-12)
    expect(fast).toBeLessThan(50e-12)
    expect(inverterDelay(0.5, 10e-15) / fast).toBeGreaterThan(5)
  })
})

describe('BJT', () => {
  const q = BJTS['2N2222']
  const resistor = (ohms: number) => (v: number) => v / ohms
  it('Vbe sits near 0.65–0.75 V over the useful base currents', () => {
    expect(diodeVolts(10e-3 / q.beta, q.be)).toBeCloseTo(0.65, 3)
    expect(diodeVolts(1e-3, q.be)).toBeGreaterThan(0.68)
    expect(diodeVolts(1e-3, q.be)).toBeLessThan(0.76)
  })
  it('active: Ic = β·Ib, raised slightly by Vce (Early)', () => {
    const r = bjtCollector(50e-6, 5, q)
    expect(r.region).toBe('active')
    expect(r.amps / 50e-6).toBeGreaterThan(q.beta)
    expect(r.amps / 50e-6).toBeLessThan(q.beta * 1.1)
    expect(bjtCollector(50e-6, 1, q).amps).toBeLessThan(r.amps)
  })
  it('saturation: the current collapses below ~0.1 V and is 0 with no base current', () => {
    expect(bjtCollector(50e-6, 0.05, q).region).toBe('saturation')
    expect(bjtCollector(50e-6, 0.05, q).amps).toBeLessThan(0.5 * q.beta * 50e-6)
    expect(bjtCollector(0, 5, q).amps).toBe(0)
  })
  it('a 1 kΩ base from 3.3 V saturates a 20 mA load: Vce ≈ 0.1 V, the load gets almost all of Vcc', () => {
    const r = bjtSwitch({ vin: 3.3, rb: 1000, vcc: 5, load: resistor(250) }, q)
    expect(r.ib).toBeCloseTo((3.3 - r.vbe) / 1000, 6)
    expect(r.region).toBe('saturation')
    expect(r.vce).toBeLessThan(0.15)
    expect(r.ic).toBeCloseTo((5 - r.vce) / 250, 6)
    expect(r.gain).toBeLessThan(10)
  })
  it('0 V on the base: cut off, the whole supply across the transistor', () => {
    const r = bjtSwitch({ vin: 0, rb: 1000, vcc: 5, load: resistor(250) }, q)
    expect(r.region).toBe('cutoff')
    expect(r.ic).toBeLessThan(1e-6)
    expect(r.vce).toBeGreaterThan(4.99)
  })
  it('too little base current: active, Ic = β·Ib and the transistor eats the rest as heat', () => {
    const r = bjtSwitch({ vin: 3.3, rb: 100e3, vcc: 5, load: resistor(25) }, q)
    expect(r.region).toBe('active')
    expect(r.ic / r.ib).toBeGreaterThan(q.beta)
    expect(r.vce).toBeGreaterThan(1)
    expect(r.watts).toBeCloseTo(r.ic * r.vce + r.ib * r.vbe, 9)
  })
  it('base off with an LED load: only nA leak through it, so Vce ≈ the supply', () => {
    const led = (v: number) => ledStringAmps(v, 150, LEDS.red)
    for (const vin of [0, 0.01, 0.1]) {
      const r = bjtSwitch({ vin, rb: 4700, vcc: 5, load: led }, q)
      expect(r.region).toBe('cutoff')
      expect(r.vce).toBeGreaterThan(4.95)
    }
    expect(led(5)).toBeCloseTo(diodeNode(5, 150, LEDS.red).sourceA, 6)
  })
  it('base resistor rule: Rb = (Vin − 0.7) · β / (3·Ic)', () => {
    expect(baseResistorFor(3.3, 0.15, q)).toBeCloseTo(866.7, 1)
    const r = bjtSwitch({ vin: 3.3, rb: 820, vcc: 5, load: resistor(5 / 0.15) }, q)
    expect(r.region).toBe('saturation')
    expect(r.vce).toBeLessThan(0.3)
  })
})

describe('MOSFET switch', () => {
  const lamp = (v: number) => v / 6
  const on = (vgs: number, name: keyof typeof MOSFETS) => fetSwitch({ vgs, vdd: 12, load: lamp }, MOSFETS[name])
  it('datasheet Vgs(th): only ~250 µA flows there, with the gate tied to the drain', () => {
    expect(thresholdAt(250e-6, MOSFETS.IRLZ44N)).toBeGreaterThan(1)
    expect(thresholdAt(250e-6, MOSFETS.IRLZ44N)).toBeLessThan(2)
    expect(thresholdAt(1e-3, MOSFETS['2N7000'])).toBeCloseTo(2.26, 1)
    expect(mosfetDrain(thresholdAt(1e-3, MOSFETS['2N7000']), 2, MOSFETS['2N7000']).amps).toBeCloseTo(1e-3, 4)
  })
  it('low side: the load sees Vdd − Vds, the FET burns Vds × Id', () => {
    const r = on(5, 'IRLZ44N')
    expect(r.region).toBe('triode')
    expect(r.amps).toBeCloseTo((12 - r.vds) / 6, 9)
    expect(r.vds / r.amps).toBeCloseTo(0.022, 2)
    expect(r.watts).toBeCloseTo(r.amps ** 2 * (r.vds / r.amps), 9)
    expect(on(0, 'IRLZ44N').amps).toBeLessThan(1e-9)
    expect(on(0, 'IRLZ44N').vds).toBeCloseTo(12, 6)
  })
  it('logic level: an IRFZ44N barely conducts at 3.3 V, the IRLZ44N is fully on; a 2N7000 cannot pass 2 A', () => {
    expect(on(3.3, 'IRFZ44N').region).toBe('saturation')
    expect(on(3.3, 'IRFZ44N').watts).toBeGreaterThan(2)
    expect(on(3.3, 'IRLZ44N').vds).toBeLessThan(0.1)
    expect(on(10, 'IRFZ44N').vds).toBeLessThan(0.05)
    expect(on(5, '2N7000').amps).toBeLessThan(0.4)
  })
  it('junction temperature with no heatsink', () => {
    expect(junctionTemp(1, FET_PARTS.IRLZ44N)).toBe(87)
    expect(junctionTemp(0.4, FET_PARTS['2N7000'])).toBeCloseTo(149.8, 1)
  })
  it('gate drive: the Miller plateau sets the edge, Rg × 10 makes it 10× slower', () => {
    const m = MOSFETS.IRLZ44N
    const part = FET_PARTS.IRLZ44N
    const plateau = millerPlateau(12, lamp, m)
    expect(plateau).toBeGreaterThan(1.6)
    expect(plateau).toBeLessThan(2.2)
    const drive = { vdrive: 5, rg: 100, vdd: 12, load: lamp, hz: 1000 }
    const fast = gateDrivePeriod(drive, m, part)
    const est = (100 * part.cgd * 0.8 * 12) / (5 - plateau)
    expect(fast.onEdge).toBeGreaterThan(0.7 * est)
    expect(fast.onEdge).toBeLessThan(1.3 * est)
    expect(fast.offEdge).toBeGreaterThan(fast.onEdge)
    const slow = gateDrivePeriod({ ...drive, rg: 1000 }, m, part)
    expect(slow.onEdge / fast.onEdge).toBeCloseTo(10, 0)
    expect(slow.switchJ / fast.switchJ).toBeGreaterThan(5)
    const mid = fast.vgs[Math.round(fast.t.length * 0.25)]
    expect(mid).toBeCloseTo(5, 3)
    expect(fast.vds[fast.t.length - 1]).toBeCloseTo(12, 3)
  })
  it('too slow for the PWM period: the FET never fully turns on', () => {
    const r = gateDrivePeriod({ vdrive: 5, rg: 10e3, vdd: 12, load: lamp, hz: 20e3 }, MOSFETS.IRLZ44N, FET_PARTS.IRLZ44N)
    expect(r.onEdge).toBeNaN()
    expect(Math.min(...r.vds)).toBeGreaterThan(1)
    expect(r.switchJ * 20e3).toBeGreaterThan(2)
  })
})
