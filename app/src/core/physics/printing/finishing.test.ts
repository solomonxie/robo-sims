import { medianMs } from '../../stopwatch'
import { GRITS, fillLevel, paintJob, paintView, ridgeProfile, roughnessRa, sandAt, sandRun, sandView, vapourRidge, vapourView } from './finishing'

describe('Post-processing', () => {
  it('ridges: bead depth from the layer height, stair steps on slopes', () => {
    const w = ridgeProfile(0.2, 'wall')
    expect(w.rz).toBeCloseTo(80)
    expect(ridgeProfile(0.2, 'dome').rz).toBeGreaterThan(2 * w.rz)
    expect(Math.min(...w.y)).toBeGreaterThanOrEqual(0)
    expect(roughnessRa(w.y)).toBeGreaterThan(5)
    expect(fillLevel(w.y, 0)).toBe(0)
    expect(fillLevel(w.y, 200)).toBeGreaterThan(w.rz)
  })
  it('sanding: Ra falls grit by grit, filler saves time and dimension', () => {
    const r = sandRun(0.2, 'wall', 400, 0)
    expect(r.steps.map((s) => s.grit)).toEqual([...GRITS])
    for (let i = 1; i < r.steps.length; i++) expect(r.steps[i].ra).toBeLessThan(r.steps[i - 1].ra)
    expect(r.ra).toBeLessThan(r.raw / 3)
    expect(r.lossUm).toBeGreaterThan(r.p.rz)
    const f = sandRun(0.2, 'wall', 400, 2)
    expect(f.lossUm).toBeLessThan(r.lossUm)
    expect(f.minutes).toBeLessThan(r.minutes)
    expect(sandRun(0.3, 'dome', 400, 0).gap).toBeGreaterThan(r.gap)
    expect(sandAt(r, 0).ra).toBeCloseTo(r.raw, 0)
    expect(sandAt(r, r.minutes).ra).toBeCloseTo(r.ra, 5)
  })
  it('vapour: ABS/ASA levels, finer ridges first; PLA and PETG untouched; long exposure rounds edges and slumps', () => {
    expect(vapourRidge('asa', 'cold', 30, 0.2)).toBeLessThan(0.01 * vapourRidge('asa', 'cold', 0, 0.2))
    expect(vapourRidge('asa', 'cold', 10, 0.12) / 48).toBeLessThan(vapourRidge('asa', 'cold', 10, 0.28) / 112)
    expect(vapourRidge('pla', 'hot', 60, 0.2)).toBeCloseTo(80)
    expect(vapourView('petg', 'hot', 60, 0.2).works).toBe(false)
    const hot = vapourView('asa', 'hot', 60, 0.2)
    expect(hot.slumps && hot.textLost).toBe(true)
    expect(vapourView('asa', 'cold', 15, 0.2).slumps).toBe(false)
  })
  it('painting: primer for adhesion, filler to hide lines, close spraying runs', () => {
    expect(paintJob('pla', 'none', 3, 25, 'satin', 0.2).adhesion).toBeLessThan(paintJob('pla', 'primer', 3, 25, 'satin', 0.2).adhesion)
    expect(paintJob('pla', 'primer', 3, 25, 'gloss', 0.2).visible).toBe(true)
    expect(paintJob('pla', 'filler', 2, 25, 'gloss', 0.2).visible).toBe(false)
    expect(paintJob('pla', 'scuff', 2, 12, 'matte', 0.2).runs).toBe(true)
    expect(paintJob('pla', 'scuff', 2, 25, 'matte', 0.2).runs).toBe(false)
    const c = paintView('asa', 'scuff', 3, 25, 'satin', 0.2).curve
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1])
  })
  it('recomputes fast', () => {
    expect(medianMs(() => { sandView(0.28, 'dome', 400, 3); vapourView('asa', 'hot', 40, 0.2); paintView('pla', 'filler', 4, 20, 'clear', 0.2) })).toBeLessThan(100)
  })
})
