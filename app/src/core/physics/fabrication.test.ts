import {
  FIELD_MM,
  NODES,
  SCANNERS,
  WAFER_MM,
  WAFER_USD,
  atomsAcross,
  costPerGoodDie,
  gatesAcrossHair,
  defectCount,
  defectSpots,
  depthOfFocus,
  diesPerWaferEstimate,
  halfPitch,
  killedDies,
  nand2Density,
  opticsThroughput,
  poissonYield,
  waferGrid,
} from '.'

describe('lithography', () => {
  it('EUV prints ~12 nm half-pitch, DUV immersion ~43 nm, High-NA ~7 nm', () => {
    const hp = (s: { nm: number; na: number }) => halfPitch(s.nm, s.na)
    expect(hp(SCANNERS.duv)).toBeCloseTo(42.9, 1)
    expect(hp(SCANNERS.euv)).toBeCloseTo(12.3, 1)
    expect(hp(SCANNERS.highNa)).toBeCloseTo(7.4, 1)
  })
  it('a higher NA sharpens the image but thins the focus', () => {
    expect(depthOfFocus(13.5, 0.55)).toBeLessThan(depthOfFocus(13.5, 0.33) / 2.5)
  })
  it('11 EUV mirrors at 70 % pass ~2 % of the light; DUV keeps most of it', () => {
    expect(opticsThroughput(SCANNERS.euv)).toBeCloseTo(0.0198, 3)
    expect(opticsThroughput(SCANNERS.duv)).toBeCloseTo(0.857, 3)
  })
})

describe('wafer', () => {
  it('counts whole dies inside the usable circle, close to the textbook estimate', () => {
    for (const side of [5, 10, 20]) {
      const n = waferGrid(WAFER_MM, side, side).length
      expect(n / diesPerWaferEstimate(WAFER_MM, side * side)).toBeGreaterThan(0.9)
      expect(n / diesPerWaferEstimate(WAFER_MM, side * side)).toBeLessThan(1.1)
    }
    expect(waferGrid(WAFER_MM, 10, 10).every((d) => Math.hypot(Math.abs(d.x) + 5, Math.abs(d.y) + 5) <= 147)).toBe(true)
  })
  it('exposure fields cover the whole wafer, edge fields included', () => {
    const fields = waferGrid(WAFER_MM, FIELD_MM.w, FIELD_MM.h, 3, 'touch')
    expect(fields.length).toBeGreaterThan((Math.PI * 147 ** 2) / (FIELD_MM.w * FIELD_MM.h))
    expect(fields.length).toBeLessThan(110)
  })
  it('Poisson yield: 1 cm² at 0.1 defects/cm² → 90 %; big dies lose far more', () => {
    expect(poissonYield(100, 0.1)).toBeCloseTo(0.905, 3)
    expect(poissonYield(800, 0.1)).toBeCloseTo(0.449, 3)
  })
  it('scattered defects kill roughly the share of dies Poisson predicts', () => {
    const side = 10
    const dies = waferGrid(WAFER_MM, side, side)
    const spots = defectSpots(defectCount(WAFER_MM, 0.2), WAFER_MM / 2)
    expect(spots.every((p) => Math.hypot(p.x, p.y) <= WAFER_MM / 2)).toBe(true)
    const good = killedDies(dies, side, side, spots).filter((k) => !k).length / dies.length
    expect(good).toBeGreaterThan(poissonYield(side * side, 0.2) - 0.05)
    expect(good).toBeLessThan(poissonYield(side * side, 0.2) + 0.05)
  })
})

describe('cost', () => {
  it('a 100 mm² die on a $20k wafer costs ~$36 once yield is counted; a wafer of rejects is priceless', () => {
    const dies = waferGrid(WAFER_MM, 10, 10).length
    expect(costPerGoodDie(WAFER_USD, dies * poissonYield(100, 0.1))).toBeCloseTo(35.9, 1)
    expect(costPerGoodDie(WAFER_USD, 0)).toBe(Infinity)
  })
})

describe('process nodes', () => {
  it('“3 nm” names a gate pitch 16× larger', () => {
    expect(NODES.n3.cpp / 3).toBe(16)
  })
  it('NAND2 cell density lands near the published 90–200 M transistors/mm²', () => {
    expect(nand2Density(NODES.n7.cpp, NODES.n7.cellH) / 1e6).toBeCloseTo(97.5, 0)
    expect(nand2Density(NODES.n3.cpp, NODES.n3.cellH) / 1e6).toBeCloseTo(164, 0)
    expect(nand2Density(NODES.n2.cpp, NODES.n2.cellH)).toBeGreaterThan(nand2Density(NODES.n3.cpp, NODES.n3.cellH))
  })
  it('a 5 nm fin is ~21 silicon atoms across; 3 nm is 13', () => {
    expect(atomsAcross(5)).toBe(21)
    expect(atomsAcross(3)).toBe(13)
  })
  it('~1 500 gates at 3 nm sit side by side across a hair', () => {
    expect(gatesAcrossHair(NODES.n3.cpp)).toBe(1458)
  })
})
