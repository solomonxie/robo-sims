import { medianMs } from '../../stopwatch'
import {
  ENTITY_DOF,
  INCH_MM,
  MATES,
  SKETCH_STEPS,
  STL_WHEEL,
  assemblyState,
  bracketSketch,
  chordError,
  facetedHoleMm,
  meshCheck,
  plateAreaMm2,
  plateMassG,
  screwFit,
  segmentsFor,
  sketchPoints,
  sketchStatus,
  stlBytes,
  stlView,
  tessellateWheel,
  wheelTriangles,
} from './cad'

describe('sketch and extrude', () => {
  it('constraints remove all 19 DOF; entities turn fixed in order', () => {
    const total = Object.values(ENTITY_DOF).reduce((a, b) => a + b, 0)
    expect(total).toBe(19)
    expect(SKETCH_STEPS.reduce((a, s) => a + s.dof, 0)).toBe(total)
    expect(sketchStatus(0).total).toBe(19)
    expect(sketchStatus(3).fixed).toEqual({ outline: true, boss: false, holes: false })
    expect(sketchStatus(5).fixed.boss).toBe(true)
    const all = sketchStatus(SKETCH_STEPS.length)
    expect(all.total).toBe(0)
    expect(all.fixed.holes).toBe(true)
    expect(all.dims).toEqual(['w', 'h', 'boss', 'hole', 'bolt'])
  })
  it('one parameter drives the part: motor size sets plate, pattern and screws', () => {
    const a = bracketSketch('nema17', 0)
    expect(a.w).toBe(54)
    expect(a.contours[2].cx).toBeCloseTo(15.5, 9)
    expect(a.contours[2].w).toBe(3.4)
    const b = bracketSketch('nema23', 0)
    expect(b.w).toBeGreaterThan(a.w)
    expect(b.screw).toBe('M5')
  })
  it('area, fillet and mass', () => {
    const p = bracketSketch('nema17', 0)
    const holes = (Math.PI / 4) * (22.5 ** 2 + 4 * 3.4 ** 2)
    expect(plateAreaMm2(p)).toBeCloseTo(54 * 54 - holes, 6)
    const f = bracketSketch('nema17', 5)
    expect(plateAreaMm2(p) - plateAreaMm2(f)).toBeCloseTo((4 - Math.PI) * 25, 6)
    expect(plateMassG(p, 4)).toBeCloseTo((plateAreaMm2(p) * 4 * 1.24) / 1000, 9)
    expect(bracketSketch('nema17', 50).fillet).toBeLessThan(10)
    const pts = sketchPoints(f.contours[0], f.fillet, 4)
    expect(pts[0]).toEqual(pts.at(-1))
    for (const [x, y] of pts) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(27 + 1e-9)
  })
})

describe('assemblies', () => {
  it('mates take 24 DOF to 1: the free spin of a round screw', () => {
    expect(assemblyState(0).total).toBe(24)
    expect(assemblyState(1).free.bracket).toEqual([])
    expect(assemblyState(3).free.motor).toEqual(['rz'])
    const all = assemblyState(MATES.length)
    expect(all.total).toBe(1)
    expect(all.free.screws).toEqual(['rz'])
    expect(all.free.wheel).toEqual([])
  })
  it('screw fit: short, ok, then the tip hits the bottom of the tap', () => {
    expect(screwFit(6, 4).verdict).toBe('short')
    expect(screwFit(8, 4).verdict).toBe('ok')
    const c = screwFit(10, 4)
    expect(c.verdict).toBe('collides')
    expect(c.clash).toBeCloseTo(1.5, 9)
    expect(c.clashMm3).toBeCloseTo((Math.PI / 4) * 9 * 1.5, 9)
  })
})

describe('exporting STL', () => {
  it('segments meet both tolerances', () => {
    for (const tol of [0.001, 0.01, 0.1, 0.5]) {
      const n = segmentsFor(30, tol, 90)
      expect(chordError(30, n)).toBeLessThanOrEqual(tol + 1e-12)
      expect(chordError(30, n - 1)).toBeGreaterThan(tol)
    }
    expect(segmentsFor(2.5, 0.5, 10)).toBe(36)
    expect(facetedHoleMm(5, 6)).toBeCloseTo(5 * Math.cos(Math.PI / 6), 9)
  })
  it('triangles, file size, units', () => {
    const v = stlView(0.01, 30, 'mm', 'none')
    expect(v.tris).toBe(wheelTriangles(v.nOut, v.nIn))
    expect(v.bytes).toBe(84 + 50 * v.tris)
    expect(stlBytes(1000)).toBe(50084)
    expect(stlView(0.01, 30, 'inch', 'none').seenMm).toBeCloseTo(60 / INCH_MM, 9)
    expect(stlView(0.001, 30, 'mm', 'none').tris).toBeGreaterThan(stlView(0.1, 30, 'mm', 'none').tris * 5)
    expect(v.bore).toBeLessThan(5)
  })
  it('mesh is closed, outward and genus 1; defects are caught', () => {
    const m = tessellateWheel(24, 8)
    expect(m.tris.length).toBe(wheelTriangles(24, 8))
    const c = meshCheck(m.verts, m.tris)
    expect(c).toMatchObject({ open: 0, nonManifold: 0, flippedEdges: 0, watertight: true, consistent: true, euler: 0 })
    const { R, r, h } = STL_WHEEL
    const exact = (n: number, rad: number) => 0.5 * n * rad * rad * Math.sin((2 * Math.PI) / n) * h
    expect(c.volume).toBeCloseTo(exact(24, R) - exact(8, r), 6)
    const g = tessellateWheel(24, 8, 'gap')
    expect(meshCheck(g.verts, g.tris)).toMatchObject({ open: 3, watertight: false })
    const f = tessellateWheel(24, 8, 'flipped')
    expect(meshCheck(f.verts, f.tris)).toMatchObject({ watertight: true, consistent: false, flippedEdges: 3 })
  })
  it('finest tessellation + check is fast', () => {
    expect(
      medianMs(() => {
        const v = stlView(0.001, 5, 'mm', 'none')
        const m = tessellateWheel(v.nOut, v.nIn)
        meshCheck(m.verts, m.tris)
      }),
    ).toBeLessThan(60)
  })
})
