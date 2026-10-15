import { BMS_LIMITS, CHEMISTRIES, bmsFault, bmsTrip, cellVolts, driftWeeks, loadedCellVolts, packRating } from '..'

const { liion } = CHEMISTRIES
const CAPS = [3000, 2950, 2900]
const LEAK = [10, 20, 60]

describe('packs', () => {
  it('extends the OCV curve past full and empty', () => {
    expect(cellVolts(liion, 0.5)).toBeCloseTo(3.725)
    expect(cellVolts(liion, 1.025)).toBeCloseTo(4.25)
    expect(cellVolts(liion, -0.05)).toBeCloseTo(2)
    expect(cellVolts(liion, -1)).toBe(0)
  })

  it('rates an SxP pack', () => {
    const p = packRating(liion, 3, 2, 10)
    expect(p.volts).toBeCloseTo(11.1)
    expect(p.mAh).toBe(6000)
    expect(p.full).toBeCloseTo(12.6)
    expect(p.empty).toBeCloseTo(9)
    expect(p.maxAmps).toBe(20)
    expect(p.maxWatts).toBeCloseTo(222)
    expect(p.ohms).toBeCloseTo(0.06)
    expect(p.grams).toBe(276)
  })

  it('reports the first BMS fault', () => {
    expect(bmsFault([3.7, 3.7], 5)).toBeNull()
    expect(bmsFault([3.7, 3.7], BMS_LIMITS.ocp + 1)).toBe('over-current')
    expect(bmsFault([4.3, 3.7], -1)).toBe('over-charge')
    expect(bmsFault([3.7, 2.7], 1)).toBe('over-discharge')
  })

  it('trips on the weakest cell, earlier under heavy load', () => {
    expect(loadedCellVolts(liion, [1], 10)[0]).toBeCloseTo(3.8)
    const gentle = bmsTrip(liion, [1, 0.9], 2)
    expect(gentle.fault).toBe('over-discharge')
    const v = loadedCellVolts(liion, [1, 0.9].map((s) => s - gentle.mAh / 3000), 2)
    expect(Math.min(...v)).toBeCloseTo(BMS_LIMITS.uvp, 2)
    expect(gentle.mAh).toBeGreaterThan(2600)
    expect(gentle.mAh).toBeLessThan(2900)
    expect(bmsTrip(liion, [1, 0.9], 10).mAh).toBeLessThan(gentle.mAh)
    expect(bmsTrip(liion, [1, 1], 20)).toEqual({ mAh: 0, fault: 'over-current' })
  })

  it('drifts apart without balancing and holds together with it', () => {
    const raw = driftWeeks(liion, CAPS, LEAK, 24)
    const bal = driftWeeks(liion, CAPS, LEAK, 24, { balance: true })
    const spread = (w: { topVolts: number[] }) => Math.max(...w.topVolts) - Math.min(...w.topVolts)
    expect(spread(raw[23])).toBeGreaterThan(spread(raw[2]))
    expect(raw[23].usableMAh).toBeLessThan(raw[2].usableMAh - 500)
    expect(Math.max(...raw[23].topVolts)).toBeLessThanOrEqual(BMS_LIMITS.ovp + 1e-6)
    expect(spread(bal[23])).toBeLessThan(0.05)
    expect(bal[23].usableMAh).toBeGreaterThan(2700)
    expect(bal[23].bledMAh[2]).toBe(0)
    for (const w of [...raw, ...bal]) expect(Math.min(...w.bottom)).toBeCloseTo(0)
  })
})
