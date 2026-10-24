import {
  BPW34,
  SI_CUTOFF_NM,
  SOLAR_CELL,
  cellMpp,
  cellOnLoad,
  cellPhotoA,
  cellVoc,
  darkFloorLux,
  litDiodeAmps,
  pdCapacitance,
  pdDarkA,
  pdPhotoA,
  photocurrent,
  responsivity,
  tia,
} from './photodiodes'
import { TL072 } from './opamps'

const RAILS = { vcc: 5, vee: -5 }

describe('photodiodes', () => {
  it('responsivity rises with λ and stops at the silicon band gap', () => {
    expect(SI_CUTOFF_NM).toBeCloseTo(1107, 0)
    expect(responsivity(900, 1)).toBeCloseTo(0.726, 3)
    expect(responsivity(500)).toBeLessThan(responsivity(900))
    expect(responsivity(1200)).toBe(0)
  })

  it('photocurrent = E·A·R', () => {
    expect(photocurrent(1000, 1e-4, 0.5)).toBeCloseTo(0.05, 9)
    expect(photocurrent(-5, 1e-4, 0.5)).toBe(0)
  })

  it('full sun on the 5 cm cell: Isc 0.85 A, Voc ≈ 0.6 V', () => {
    expect(cellPhotoA(1000)).toBeCloseTo(0.85, 6)
    const voc = cellVoc(1000)
    expect(voc).toBeGreaterThan(0.55)
    expect(voc).toBeLessThan(0.65)
    expect(litDiodeAmps(voc, 1000)).toBeCloseTo(0, 9)
    expect(litDiodeAmps(0, 1000)).toBeCloseTo(-0.85, 9)
  })

  it('light shifts the curve down; Voc grows only logarithmically', () => {
    expect(litDiodeAmps(0.3, 500)).toBeLessThan(litDiodeAmps(0.3, 100))
    const dv = cellVoc(1000) - cellVoc(100)
    expect(dv).toBeCloseTo(1.2 * 0.025852 * Math.log(10), 2)
  })

  it('max-power point beats nearby voltages and has a silicon-like fill factor', () => {
    const m = cellMpp(1000)
    for (const dv of [-0.02, 0.02]) {
      const v = m.v + dv
      expect(v * -litDiodeAmps(v, 1000)).toBeLessThan(m.p)
    }
    expect(m.fill).toBeGreaterThan(0.75)
    expect(m.fill).toBeLessThan(0.86)
    expect(m.efficiency).toBeGreaterThan(0.15)
    expect(m.efficiency).toBeLessThan(0.25)
    expect(cellMpp(0).p).toBe(0)
  })

  it('a load sits on the lit curve; the matched load takes the max power', () => {
    const m = cellMpp(1000)
    const at = cellOnLoad(1000, m.v / m.i)
    expect(at.p).toBeCloseTo(m.p, 4)
    expect(-litDiodeAmps(at.v, 1000)).toBeCloseTo(at.i, 6)
    expect(cellOnLoad(1000, 0.01).i).toBeCloseTo(cellPhotoA(1000), 1)
    expect(cellOnLoad(1000, 1e4).v).toBeCloseTo(cellVoc(1000), 3)
    expect(cellOnLoad(0, 1).p).toBe(0)
  })

  it('reverse bias: less capacitance, some dark current', () => {
    expect(pdCapacitance(0)).toBeCloseTo(BPW34.cj0, 15)
    expect(pdCapacitance(5)).toBeLessThan(pdCapacitance(0) / 2.5)
    expect(pdDarkA(0)).toBe(0)
    expect(pdDarkA(BPW34.darkAtV)).toBeCloseTo(BPW34.darkA, 15)
    expect(pdDarkA(5)).toBeLessThan(BPW34.darkA)
  })

  it('BPW34 gives tens of µA at 1000 lux', () => {
    const a = pdPhotoA(1000)
    expect(a).toBeGreaterThan(20e-6)
    expect(a).toBeLessThan(80e-6)
    expect(darkFloorLux(5)).toBeGreaterThan(0.01)
    expect(darkFloorLux(5)).toBeLessThan(1)
  })

  it('TIA: Vout = I·Rf until the rail; reverse bias and smaller Rf are faster', () => {
    const t = tia(100, 100e3, 0, TL072, RAILS)
    expect(t.vout).toBeCloseTo(pdPhotoA(100) * 100e3, 9)
    expect(t.clipped).toBe(false)
    const bright = tia(100e3, 100e3, 0, TL072, RAILS)
    expect(bright.vout).toBeCloseTo(3.5, 6)
    expect(bright.clipped).toBe(true)
    expect(tia(100, 100e3, 5, TL072, RAILS).hz).toBeGreaterThan(t.hz)
    expect(tia(100, 10e3, 0, TL072, RAILS).hz).toBeGreaterThan(t.hz)
    expect(t.riseS).toBeCloseTo(0.35 / t.hz, 12)
  })

  it('cell numbers come from the SOLAR_CELL spec', () => {
    expect(cellPhotoA(1000, { ...SOLAR_CELL, areaM2: 2 * SOLAR_CELL.areaM2 })).toBeCloseTo(1.7, 6)
  })
})
