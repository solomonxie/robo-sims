import { medianMs } from '../../stopwatch'
import { CHASSIS_PLATE, HoleKey, SHEETS, SheetKey, cutContour, fitOf, kerfOf, kerfView, mountTest, notchFactor, plateCompare, tabSlot } from './cutting'

const sheets = Object.keys(SHEETS) as SheetKey[]

describe('kerf', () => {
  it('widens with power and cuts through only past the line-energy threshold', () => {
    for (const sk of sheets) {
      const lo = kerfOf(sk, 20)
      const hi = kerfOf(sk, 100)
      expect(hi.kerf).toBeGreaterThan(lo.kerf)
      expect(lo.through).toBe(false)
      expect(hi.through).toBe(true)
      expect(hi.kerf).toBeGreaterThan(0.1)
      expect(hi.kerf).toBeLessThan(0.4)
    }
    expect(kerfOf('acrylic', 100).char).toBe(0)
    expect(kerfOf('plywood', 100).char).toBeGreaterThan(0)
  })
  it('shrinks outlines and grows holes by k/2 per side; compensation k/2 restores them', () => {
    const k = 0.2
    const [outline, , , hole] = CHASSIS_PLATE
    expect(cutContour(outline, k, 0).edge.w).toBeCloseTo(outline.w - k)
    expect(cutContour(hole, k, 0).edge.w).toBeCloseTo(hole.w + k)
    expect(cutContour(outline, k, k / 2).edge.w).toBeCloseTo(outline.w)
    expect(cutContour(hole, k, k / 2).edge.w).toBeCloseTo(hole.w)
    expect(cutContour(outline, k, 0.05).beam.w).toBeCloseTo(outline.w + 0.1)
    expect(cutContour(hole, k, 0.05).beam.w).toBeCloseTo(hole.w - 0.1)
  })
  it('tab-and-slot gap = 2(k − 2c): loose uncompensated, press fit just past k/2', () => {
    const j = tabSlot('acrylic', 70, 0)
    expect(j.gap).toBeCloseTo(2 * j.kerf)
    expect(j.fit).toBe('loose')
    expect(tabSlot('acrylic', 70, j.ideal).gap).toBeCloseTo(0)
    expect(tabSlot('acrylic', 70, j.ideal + 0.01).fit).toBe('press')
    expect(tabSlot('acrylic', 70, j.ideal + 0.05).fit).toBe('tight')
    expect(tabSlot('plywood', 70, kerfOf('plywood', 70).kerf / 2 + 0.03).fit).toBe('press')
    expect(fitOf(0.05, -0.1)).toBe('slip')
  })
})

describe('acrylic vs plywood mount', () => {
  it('plywood is stiffer and lighter; acrylic feels the hole more', () => {
    const a = mountTest('acrylic', 10, 'plain')
    const p = mountTest('plywood', 10, 'plain')
    expect(p.delta).toBeLessThan(a.delta)
    expect(p.grams).toBeLessThan(a.grams)
    expect(notchFactor('acrylic')).toBeGreaterThan(notchFactor('plywood'))
    expect(a.tSameStiff).toBeGreaterThan(0.004)
    expect(mountTest('acrylic', 20, 'hole').sf).toBeLessThan(mountTest('acrylic', 20, 'plain').sf)
  })
  it('breaking load matches the crack test, and over-tightening lowers it', () => {
    for (const sk of sheets)
      for (const hk of ['plain', 'hole', 'tight'] as HoleKey[]) {
        const { breakN } = mountTest(sk, 1, hk)
        expect(mountTest(sk, breakN * 0.99, hk).cracked).toBe(false)
        expect(mountTest(sk, breakN * 1.01, hk).cracked).toBe(true)
      }
    expect(mountTest('acrylic', 1, 'tight').breakN).toBeLessThan(mountTest('acrylic', 1, 'hole').breakN)
    expect(mountTest('acrylic', 1, 'tight').breakN).toBeLessThan(mountTest('plywood', 1, 'tight').breakN)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => {
      for (let c = 0; c <= 25; c++) kerfView('plywood', 60, c / 100).gapAt(0.1)
      plateCompare(25, 'tight', 60)
    })).toBeLessThan(50)
  })
})
