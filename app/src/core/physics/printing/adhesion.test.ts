import { medianMs } from '../../stopwatch'
import { AID_SWEEP, FIRST_LAYER, beadSection, cornerArea, cornerView, levelView, surfaceView, zOffsetGap, zOffsetView } from './adhesion'

describe('Bed levelling', () => {
  it('a plane fit removes tilt but not a bowl; a mesh removes both', () => {
    const tilt = levelView(0.4, 0, 'none')
    const plane = levelView(0.4, 0, 'plane')
    expect(tilt.worst).toBeGreaterThan(0.15)
    expect(plane.worst).toBeLessThan(0.04)
    const bowlPlane = levelView(0.4, 0.25, 'plane')
    const bowlMesh = levelView(0.4, 0.25, 'mesh', 7)
    expect(bowlPlane.worst).toBeGreaterThan(0.1)
    expect(bowlMesh.worst).toBeLessThan(0.05)
    expect(bowlMesh.good).toBeGreaterThan(bowlPlane.good)
    expect(levelView(0.4, 0.25, 'mesh', 3).worst).toBeGreaterThan(bowlMesh.worst)
  })
  it('paper levelling is coarser than probing a plane', () => {
    expect(levelView(0.4, 0, 'paper').worst).toBeGreaterThan(levelView(0.4, 0, 'plane').worst)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs((i) => levelView(0.1 + i * 0.01, 0.2, 'mesh', 9))).toBeLessThan(100)
  })
})

describe('Z offset', () => {
  it('the right offset lays the slicer line; higher leaves gaps, lower spreads and scrapes', () => {
    expect(zOffsetGap(-1.85)).toBeCloseTo(FIRST_LAYER.h, 9)
    const ok = beadSection(FIRST_LAYER.h)
    expect(ok.w).toBeCloseTo(FIRST_LAYER.w, 9)
    expect(ok.state).toBe('good')
    const high = zOffsetView(-1.6).bead
    expect(high.round).toBe(true)
    expect(high.fuse).toBeLessThan(0)
    const low = zOffsetView(-1.97)
    expect(low.bead.state).toBe('scraping')
    expect(low.bead.ridge).toBeGreaterThan(0)
    expect(low.footMm).toBeGreaterThan(0.1)
  })
  it('keeps the cross-section area constant', () => {
    for (const g of [0.06, 0.12, 0.2, 0.28]) {
      const b = beadSection(g)
      expect((b.w - b.h) * b.h + (Math.PI * b.h * b.h) / 4).toBeCloseTo(b.area, 9)
    }
  })
})

describe('Build surfaces', () => {
  it('a cold bed lets PLA lift; a hot one holds; fingerprints cut grip', () => {
    expect(surfaceView('smoothPei', 'pla', 25, 'clean').holds).toBe(false)
    expect(surfaceView('smoothPei', 'pla', 60, 'clean').holds).toBe(true)
    expect(surfaceView('smoothPei', 'pla', 60, 'prints').grip).toBeLessThan(surfaceView('smoothPei', 'pla', 60, 'clean').grip)
  })
  it('PETG tears smooth PEI and glass, glue stick releases it; PLA pops off cooled glass', () => {
    expect(surfaceView('smoothPei', 'petg', 80, 'clean').release).toBe('tears')
    expect(surfaceView('glass', 'petg', 80, 'clean').release).toBe('tears')
    expect(surfaceView('glue', 'petg', 80, 'clean').release).toBe('pops')
    expect(surfaceView('glass', 'pla', 60, 'clean').release).toBe('pops')
    expect(surfaceView('smoothPei', 'pla', 60, 'clean').release).toBe('flex')
  })
})

describe('Brim and raft', () => {
  it('area grows with brim width; ears add a disc', () => {
    expect(cornerArea('none', 0)).toBeCloseTo((Math.PI * 100) / 4, -1)
    expect(cornerArea('brim', 5)).toBeGreaterThan(cornerArea('brim', 2))
    expect(cornerArea('ears', 8)).toBeGreaterThan(cornerArea('none', 0) * 3)
  })
  it('ASA corners lift bare and hold with a brim; PLA holds bare; a raft survives an uneven bed', () => {
    expect(cornerView('asa', 'none', 0, 0).lifts).toBe(true)
    expect(cornerView('asa', 'brim', 5, 0).lifts).toBe(false)
    expect(cornerView('pla', 'none', 0, 0).lifts).toBe(false)
    expect(cornerView('asa', 'brim', 5, 0.2).lifts).toBe(true)
    expect(cornerView('asa', 'raft', 0, 0.2).lifts).toBe(false)
    expect(cornerView('asa', 'raft', 0, 0).grams).toBeGreaterThan(cornerView('asa', 'brim', 5, 0).grams * 3)
  })
  it('recomputes the sweep well under 100 ms', () => {
    expect(medianMs(() => AID_SWEEP.map((b) => cornerView('asa', 'brim', b, 0.05)))).toBeLessThan(100)
  })
})
