import { medianMs } from '../../stopwatch'
import { FILAMENTS } from './filaments'
import { clogView, footView, rankCauses, shiftView, stringingView, underView, warpView } from './problems'

describe('rankCauses', () => {
  it('ranks by the drop from fixing each cause alone, none above the floor', () => {
    const r = rankCauses({ a: 3, b: 1 }, (x) => x.a + x.b, { a: { name: 'A', fix: { a: 0 } }, b: { name: 'B', fix: { b: 0 } } }, 2)
    expect(r.top?.key).toBe('a')
    expect(r.list.map((c) => c.gain)).toEqual([2, 1])
    expect(rankCauses({ a: 1 }, (x) => x.a, { a: { name: 'A', fix: { a: 0 } } }, 2).top).toBeNull()
  })
})

describe('Print problems', () => {
  it('stringing: clean when tuned; wet PETG strings and drying is the fix', () => {
    const ok = stringingView({ fil: 'pla', dc: 0, retractMm: 0.8, wetDays: 0, travelMmS: 150 })
    expect(ok.count).toBeLessThanOrEqual(2)
    expect(ok.rank.top).toBeNull()
    const wet = stringingView({ fil: 'petg', dc: 0, retractMm: 0.8, wetDays: 10, travelMmS: 150 })
    expect(wet.count).toBeGreaterThan(6)
    expect(wet.rank.top?.key).toBe('wet')
    const hot = stringingView({ fil: 'pla', dc: 20, retractMm: 0.8, wetDays: 0, travelMmS: 150 })
    expect(hot.rank.top?.key).toBe('temp')
    expect(hot.curve[0]).toBeLessThan(hot.curve[40])
  })
  it('warping: ASA in open air lifts, PLA holds; brim and enclosure help', () => {
    expect(warpView({ mat: 'pla', bedC: 60, enclosed: false, draft: 0, brimMm: 0 }).lift).toBe(0)
    const asa = warpView({ mat: 'asa', bedC: 100, enclosed: false, draft: 0.5, brimMm: 0 })
    expect(asa.lift).toBeGreaterThan(0.5)
    expect(asa.rank.top).not.toBeNull()
    expect(warpView({ mat: 'asa', bedC: 100, enclosed: true, draft: 0, brimMm: 8 }).margin).toBeGreaterThan(asa.margin * 2)
    expect(warpView({ mat: 'pla', bedC: 25, enclosed: false, draft: 0, brimMm: 0 }).lift).toBeGreaterThan(0)
  })
  it('layer shift: skips when demand beats the motor or the belt', () => {
    const base = { speed: 150, accel: 3000, amps: 0.8, belt: 'tight' as const, curl: false }
    expect(shiftView(base).mm).toBe(0)
    const hit = shiftView({ ...base, curl: true })
    expect(hit.mm).toBeGreaterThan(0)
    expect(['curl', 'amps']).toContain(hit.rank.top?.key)
    const loose = shiftView({ ...base, accel: 10000, belt: 'loose' })
    expect(loose.byBelt).toBe(true)
    expect(loose.mm % 2).toBe(0)
    expect(shiftView({ ...base, speed: 580 }).motor).toBeLessThan(shiftView(base).motor)
  })
  it('under-extrusion: past max flow, a clog, a slipping gear and thin filament each lose flow', () => {
    expect(underView('none', 80, 210).ratio).toBe(1)
    expect(underView('none', 180, 210).lost.melt).toBeGreaterThan(0)
    const clog = underView('clog', 80, 210)
    expect(clog.lost.clog).toBeGreaterThan(0)
    expect(clog.gapMm).toBeGreaterThan(0.05)
    expect(underView('gear', 80, 210).slip).toBeGreaterThan(0)
    expect(underView('diameter', 40, 210).ratio).toBeCloseTo((1.65 / 1.75) ** 2, 6)
    const u = underView('gear', 120, 210)
    expect(u.want - u.got).toBeCloseTo(u.lost.melt + u.lost.clog + u.lost.gear + u.lost.diameter, 6)
  })
  it('elephant foot: squish and a hot bed bulge; a chamfer hides it', () => {
    const ok = footView({ mat: 'pla', zOffset: -1.85, bedC: 55, chamfer: 0 })
    expect(ok.fits).toBe(true)
    const bad = footView({ mat: 'pla', zOffset: -1.95, bedC: 70, chamfer: 0 })
    expect(bad.bulge).toBeGreaterThan(0.3)
    expect(footView({ mat: 'pla', zOffset: -1.95, bedC: 70, chamfer: 0.5 }).left).toBe(0)
    expect(bad.curve[0]).toBeGreaterThan(bad.curve[bad.curve.length - 1])
  })
  it('clogged nozzle: heat creep from a weak fan or hot enclosure, long retraction; clean setups never clog', () => {
    expect(clogView({ mat: 'pla', fan: 1, airC: 25, retractMm: 0.8 }).stopMin).toBe(Infinity)
    const hot = clogView({ mat: 'pla', fan: 1, airC: 45, retractMm: 0.8 })
    expect(hot.rank.top?.key).toBe('air')
    expect(hot.sink).toBeGreaterThan(FILAMENTS.pla.tgC)
    expect(clogView({ mat: 'asa', fan: 1, airC: 45, retractMm: 0.8 }).stopMin).toBe(Infinity)
    const bad = clogView({ mat: 'pla', fan: 0.3, airC: 25, retractMm: 3 })
    expect(bad.stopMin).toBeLessThan(hot.stopMin)
    expect(bad.flow[bad.flow.length - 1]).toBe(0)
  })
  it('recomputes fast', () => {
    const ms = medianMs(() => {
      stringingView({ fil: 'nylon', dc: 10, retractMm: 0.4, wetDays: 20, travelMmS: 60 })
      warpView({ mat: 'asa', bedC: 90, enclosed: false, draft: 0.4, brimMm: 4 })
      shiftView({ speed: 400, accel: 8000, amps: 0.6, belt: 'slack', curl: true })
      underView('gear', 120, 220)
      footView({ mat: 'petg', zOffset: -1.9, bedC: 85, chamfer: 0.2 })
      clogView({ mat: 'pla', fan: 0.5, airC: 40, retractMm: 2.5 })
    })
    expect(ms).toBeLessThan(50)
  })
})
