import { medianMs } from '../../stopwatch'
import { stlBytes } from '../materials/cad'
import {
  HUB,
  cuspOf,
  formatView,
  hubLayerPath,
  hubShape,
  infillStiffness,
  infillView,
  layerHeightView,
  layerHeights,
  overhangs,
  pathMm,
  sectionStiffness,
  seamAngles,
  seamView,
  sliceHub,
  supportView,
  wallsFit,
  wallsView,
} from './slicing'

describe('hub shape', () => {
  it('is flange, chamfer, boss and dome; flipping mirrors it', () => {
    const s = hubShape(45)
    expect(s.h).toBeCloseTo(HUB.flangeH + 6 + HUB.bossH + HUB.domeH, 9)
    expect(s.rAt(1)).toBe(HUB.flangeR)
    expect(s.rAt(7)).toBeCloseTo(13, 9)
    expect(s.rAt(15)).toBe(HUB.bossR)
    expect(s.rAt(s.h - 0.01)).toBeLessThan(1)
    const f = hubShape(45, true)
    expect(f.rAt(1)).toBeCloseTo(s.rAt(s.h - 1), 9)
  })
})

describe('STL and 3MF', () => {
  it('STL is 50 B per triangle; 3MF zipped is smaller and keeps units, colours, settings', () => {
    const v = formatView(64, 1)
    expect(v.stl).toBe(stlBytes(v.tris))
    expect(v.zip).toBeLessThan(v.stl)
    expect(v.stlAscii).toBeGreaterThan(4 * v.stl)
    expect(v.stlKeeps.filter(Boolean)).toHaveLength(1)
    expect(v.mfKeeps.every(Boolean)).toBe(true)
    expect(formatView(64, 3).tris).toBe(3 * v.tris)
  })
})

describe('layer height', () => {
  it('cusp = h·sin(lean): none on a vertical wall, h on a flat one', () => {
    expect(cuspOf(0.2, 0)).toBe(0)
    expect(cuspOf(0.2, 1e6)).toBeCloseTo(0.2, 5)
  })
  it('adaptive layers are thick on the boss, thin on the dome, and faster than fine fixed layers', () => {
    const s = hubShape()
    const hs = layerHeights(s, 0.28, true)
    expect(Math.max(...hs)).toBeCloseTo(0.28, 6)
    expect(hs[hs.length - 2]).toBeLessThan(0.15)
    expect(hs.reduce((a, b) => a + b, 0)).toBeCloseTo(s.h, 6)
    const a = layerHeightView('adaptive', 0.28, 0.4)
    const f = layerHeightView('fixed', 0.28, 0.4)
    expect(a.cusp).toBeLessThan(f.cusp)
    expect(a.slice.total).toBeLessThan(a.fineTime)
    expect(f.tooThick).toBe(false)
    expect(layerHeightView('fixed', 0.36, 0.4).tooThick).toBe(true)
    expect(layerHeightView('fixed', 0.36, 0.4).bond).toBeLessThan(f.bond)
  })
})

describe('walls', () => {
  it('fits walls while they fit, then gap fill, and more walls take longer but are stiffer', () => {
    expect(wallsFit(10, 2.5, 3).m).toBe(3)
    expect(wallsFit(3.2, 2.5, 3).m).toBe(1)
    expect(wallsFit(3.3, 2.5, 1).gap).toBe(false)
    const v = wallsView(3, 10, 'outer')
    expect(v.path[0].kind).toBe('outer')
    expect(wallsView(3, 10, 'inner').path[0].kind).toBe('inner')
    expect(v.sweep[5].time).toBeGreaterThan(v.sweep[0].time)
    expect(v.sweep[5].stiff).toBeGreaterThan(v.sweep[0].stiff)
    const top = wallsView(3, hubShape().h - 0.6, 'outer')
    expect(top.fit.m).toBeLessThan(3)
  })
  it('skins the flange top under the step', () => {
    const s = sliceHub(hubShape(90), { layerH: 0.2, walls: 2, infill: 0.2 })
    const L = s.layers[Math.round(3.7 / 0.2)]
    expect(L.rCore).toBeLessThan(L.rOut - 2)
    expect(hubLayerPath(L, { infill: 0.2 }).some((g) => g.kind === 'skin')).toBe(true)
  })
})

describe('infill', () => {
  it('material and time grow with density; honeycomb and grid are stiff in Z, lines are not', () => {
    const a = infillView('grid', 0.2)
    const b = infillView('grid', 0.4)
    expect(b.slice.grams).toBeGreaterThan(a.slice.grams)
    expect(pathMm(b.path, (g) => g.kind === 'infill')).toBeGreaterThan(1.6 * pathMm(a.path, (g) => g.kind === 'infill'))
    expect(infillStiffness('honeycomb', 0.2)[2]).toBeGreaterThan(infillStiffness('honeycomb', 0.2)[0])
    expect(infillStiffness('lines', 0.2)[2]).toBeLessThan(infillStiffness('lines', 0.2)[0])
    const g = infillStiffness('gyroid', 0.3)
    expect(g[0]).toBeCloseTo(g[2], 9)
    for (const v of infillStiffness('cubic', 1)) expect(v).toBeCloseTo(1, 9)
    for (const p of ['lines', 'grid', 'cubic', 'gyroid', 'honeycomb'] as const) expect(infillView(p, 0.2).path.some((s) => s.kind === 'infill')).toBe(true)
  })
  it('part stiffness has diminishing returns: 0 → 20 % gains more than 20 → 40 %', () => {
    const s = [0, 0.2, 0.4].map((d) => sectionStiffness(3, d, 'grid'))
    expect(s[1] - s[0]).toBeGreaterThan(0)
    expect(sectionStiffness(3, 1)).toBeCloseTo(1, 9)
  })
})

describe('supports', () => {
  it('flange down needs none; flange up needs the shelf, chamfer only past the threshold', () => {
    expect(supportView('down', 45, 45, 'normal', 0.2).area).toBe(0)
    const up = (ch: number) => overhangs(hubShape(ch, true), 45).filter((f) => f.needs).map((f) => Math.round(f.deg))
    expect(up(60)).toContain(60)
    expect(up(40)).not.toContain(40)
    expect(up(40)).toContain(90)
    const n = supportView('up', 45, 45, 'normal', 0.2)
    const t = supportView('up', 45, 45, 'tree', 0.2)
    expect(n.area).toBeGreaterThan(Math.PI * (22 ** 2 - 16 ** 2))
    expect(t.grams).toBeLessThan(n.grams)
    expect(t.contact).toBeLessThan(n.contact)
    expect(supportView('up', 45, 45, 'normal', 0.1).stuck).toBeGreaterThan(supportView('up', 45, 45, 'normal', 0.3).stuck)
    expect(supportView('up', 45, 45, 'normal', 0.3).droop).toBeGreaterThan(n.droop)
  })
})

describe('seams', () => {
  it('aligned stacks every start in one line; random scatters them and adds travel', () => {
    const a = seamAngles('aligned', 50, 'round')
    expect(new Set(a).size).toBe(1)
    expect(new Set(seamAngles('random', 50, 'round')).size).toBe(50)
    expect(seamAngles('random', 50, 'round')).toEqual(seamAngles('random', 50, 'round'))
    expect(seamView('aligned', 'round', false).travelMm).toBe(0)
    expect(seamView('random', 'round', false).travelMm).toBeGreaterThan(500)
    expect(seamView('sharpest', 'square', false).hidden).toBe(true)
    expect(seamView('sharpest', 'round', false).hidden).toBe(false)
    expect(seamView('aligned', 'round', true).zit).toBeLessThan(seamView('aligned', 'round', false).zit)
  })
})

describe('slicing speed', () => {
  it('each view recomputes fast', () => {
    expect(medianMs(() => layerHeightView('adaptive', 0.2, 0.4))).toBeLessThan(60)
    expect(medianMs(() => wallsView(4, 10, 'outer'))).toBeLessThan(60)
    expect(medianMs(() => infillView('gyroid', 0.5))).toBeLessThan(80)
    expect(medianMs(() => supportView('up', 45, 45, 'tree', 0.2))).toBeLessThan(60)
    expect(medianMs(() => seamView('random', 'round', true))).toBeLessThan(60)
  })
})
