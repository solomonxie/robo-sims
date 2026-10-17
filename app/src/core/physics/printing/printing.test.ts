import { medianMs } from '../../stopwatch'
import { HOTENDS, PLA_FLOW_C, coreTempAt, filamentArea, flowView, hotendZones, maxFlow } from './fdm'
import { LAYER_SWEEP, layerPath, toolpathAt, toolpathLength, sliceLayers, sliceView } from './layers'
import { AREA_SWEEP, RESIN, RESIN_MAX_PARTS, RESIN_PART, plateSlots, SLS_PARTS_MAX, pickProcess, resinView, slabHeight, slabSection, slsView } from './processes'
import { DELTA, coreXY, coreXYInverse, deltaCarriages, deltaTower, machineView } from './machines'

describe('hotend and flow', () => {
  it('flow = line width × layer height × speed = filament area × feed', () => {
    const v = flowView({ hotend: 'v6', blockC: 210, speed: 60, layerH: 0.2 })
    expect(v.Q).toBeCloseTo(0.45 * 0.2 * 60, 9)
    expect(v.feed * filamentArea()).toBeCloseTo(v.Q, 9)
    expect(filamentArea()).toBeCloseTo(2.405, 3)
  })
  it('a V6 melts about 11 mm³/s at 210 °C; longer or better-heated melt zones and hotter blocks melt more', () => {
    expect(maxFlow('v6', 210)).toBeGreaterThan(9)
    expect(maxFlow('v6', 210)).toBeLessThan(13)
    expect(maxFlow('volcano', 210)).toBeGreaterThan(1.6 * maxFlow('v6', 210))
    expect(maxFlow('highflow', 210)).toBeGreaterThan(maxFlow('volcano', 210))
    expect(maxFlow('v6', 240)).toBeGreaterThan(maxFlow('v6', 210))
    expect(maxFlow('v6', 180)).toBe(0)
  })
  it('the core reaches the flow temperature exactly at the max flow, and falls short above it', () => {
    const z = hotendZones('v6')
    const f = maxFlow('v6', 215) / filamentArea()
    expect(coreTempAt('v6', 215, f, z.tip)).toBeCloseTo(PLA_FLOW_C, 6)
    const fast = flowView({ hotend: 'v6', blockC: 215, speed: 200, layerH: 0.3 })
    expect(fast.ok).toBe(false)
    expect(fast.delivered).toBeLessThan(1)
    expect(coreTempAt('v6', 215, f, z.cold[1] - 1)).toBe(25)
    expect(HOTENDS.v6.meltMm).toBe(z.hot[1] - z.hot[0])
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => flowView({ hotend: 'volcano', blockC: 230, speed: 120, layerH: 0.24 }))).toBeLessThan(50)
  })
})

describe('layer by layer', () => {
  it('thinner layers take longer and step less on a dome', () => {
    const fine = sliceView({ shape: 'dome', layerH: 0.08, infill: 0.2, speed: 60 })
    const coarse = sliceView({ shape: 'dome', layerH: 0.3, infill: 0.2, speed: 60 })
    expect(fine.total).toBeGreaterThan(2 * coarse.total)
    expect(fine.step).toBeLessThan(coarse.step)
    expect(coarse.sweep.length).toBe(LAYER_SWEEP.length)
    for (let i = 1; i < coarse.sweep.length; i++) expect(coarse.sweep[i]).toBeLessThan(coarse.sweep[i - 1])
  })
  it('walls and 3 solid layers at each end; more infill means more filament', () => {
    const ls = sliceLayers({ shape: 'box', layerH: 0.2, infill: 0.2, speed: 60 })
    expect(ls.length).toBe(100)
    expect(ls[0].solid && ls[99].solid && !ls[50].solid).toBe(true)
    const lo = sliceView({ shape: 'cylinder', layerH: 0.2, infill: 0.1, speed: 60 })
    const hi = sliceView({ shape: 'cylinder', layerH: 0.2, infill: 0.6, speed: 60 })
    expect(hi.filamentMm3).toBeGreaterThan(lo.filamentMm3)
  })
  it('layer paths stay inside the outline and the nozzle walks along them', () => {
    const ls = sliceLayers({ shape: 'box', layerH: 0.2, infill: 0.3, speed: 60 })
    const segs = layerPath('box', ls[40], 40, 0.3)
    for (const s of segs) for (const p of [s.a, s.b]) expect(Math.max(Math.abs(p[0]), Math.abs(p[1]))).toBeLessThanOrEqual(10 + 1e-9)
    const end = toolpathAt(segs, toolpathLength(segs) + 1)
    expect(end.done).toBe(segs.length)
    expect(toolpathAt(segs, 0).done).toBe(0)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => sliceView({ shape: 'dome', layerH: 0.08, infill: 0.5, speed: 80 }))).toBeLessThan(50)
  })
})

describe('printer kinematics', () => {
  it('CoreXY: a pure X or Y move turns both motors, a diagonal only one', () => {
    expect(coreXY(10, 0)).toEqual([10, 10])
    expect(coreXY(0, 10)).toEqual([10, -10])
    expect(coreXY(10, 10)).toEqual([20, 0])
    expect(coreXYInverse(...coreXY(3, -7))).toEqual([3, -7])
    const v = machineView('diag', 100)
    const cxy = v.kinds.find((k) => k.kind === 'corexy')!
    expect(cxy.moving).toEqual([true, false, false])
    expect(cxy.peak[0]).toBeCloseTo(100 * Math.SQRT2, 0)
  })
  it('delta: carriage heights put every arm at length L; centre is symmetric', () => {
    const c = deltaCarriages(20, -15, 5)
    c.forEach((h, i) => {
      const [tx, ty] = deltaTower(i)
      expect(Math.hypot(20 - tx, -15 - ty, 5 - h)).toBeCloseTo(DELTA.L, 9)
    })
    const m = deltaCarriages(0, 0, 0)
    expect(m[0]).toBeCloseTo(m[1], 9)
    expect(m[1]).toBeCloseTo(m[2], 9)
  })
  it('a bed slinger moves the heavy bed for Y; a delta moves the same light mass every way', () => {
    const y = machineView('y', 100).kinds
    expect(y.find((k) => k.kind === 'cartesian')!.mass).toBeGreaterThan(3 * y.find((k) => k.kind === 'delta')!.mass)
    expect(y.find((k) => k.kind === 'delta')!.moving).toEqual([true, true, true])
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => machineView('circle', 150))).toBeLessThan(50)
  })
})

describe('other processes', () => {
  it('a tilted slab section matches the peak width min(L / cos, t / sin) and the height L sin + t cos', () => {
    const { L, t } = RESIN_PART
    expect(slabHeight(0, L, t)).toBeCloseTo(t, 9)
    expect(slabHeight(90, L, t)).toBeCloseTo(L, 9)
    const H = slabHeight(45, L, t)
    let peak = 0
    for (let i = 1; i < 200; i++) {
      const s = slabSection(45, L, t, (i / 200) * H)!
      peak = Math.max(peak, s[1] - s[0])
    }
    expect(peak).toBeCloseTo(t / Math.SQRT1_2, 3)
    expect(slabSection(45, L, t, H + 1)).toBeNull()
    const flat = slabSection(0, L, t, 2)!
    expect(flat[1] - flat[0]).toBeCloseTo(L, 9)
  })
  it('MSLA layer time ignores part count, so time per part falls; peel force grows with area and tilting cuts it', () => {
    const one = resinView({ parts: 1, tiltDeg: 0, layerH: 0.05 })
    const six = resinView({ parts: 6, tiltDeg: 0, layerH: 0.05 })
    expect(six.total).toBeCloseTo(one.total, 9)
    expect(six.perPart).toBeCloseTo(one.perPart / 6, 9)
    expect(six.peelN).toBeCloseTo(6 * one.peelN, 6)
    expect(six.laserTotal).toBeGreaterThan(2 * one.laserTotal)
    const tilt = resinView({ parts: 6, tiltDeg: 45, layerH: 0.05 })
    expect(tilt.peelN).toBeLessThan(six.peelN / 4)
    expect(tilt.total).toBeGreaterThan(4 * six.total)
    for (const [x, y] of plateSlots(RESIN_MAX_PARTS)) expect(Math.abs(x) + 15 < RESIN.plate[0] / 2 && Math.abs(y) + 10 < RESIN.plate[1] / 2).toBe(true)
    expect(one.litPixels).toBeCloseTo(600 / 0.0025, 0)
    expect(one.sweep.length).toBe(AREA_SWEEP.length)
    for (const s of one.sweep) expect(s.msla).toBeCloseTo(one.sweep[0].msla, 9)
    expect(one.sweep[AREA_SWEEP.length - 1].fdm).toBeGreaterThan(one.sweep[0].msla)
    expect(one.sweep[1].fdm).toBeLessThan(one.sweep[1].msla)
  })
  it('SLS: nesting more parts on a level is nearly free; packing stays low; stacking adds layers', () => {
    const one = slsView(1, 0.1)
    const level = slsView(16, 0.1)
    expect(level.nest.levels).toBe(1)
    expect(level.layers).toBe(one.layers)
    expect(level.perPart).toBeLessThan(one.perPart / 5)
    expect(level.packing).toBeLessThan(0.3)
    const two = slsView(17, 0.1)
    expect(two.nest.levels).toBe(2)
    expect(two.layers).toBeGreaterThan(1.7 * level.layers)
    expect(slsView(SLS_PARTS_MAX, 0.1).fits).toBe(true)
    expect(slsView(16, 0.15).build).toBeLessThan(level.build)
  })
  it('picks resin for a tiny figure, SLS for a batch of gears and FDM for one bracket', () => {
    expect(pickProcess('figure', 1).pick).toBe('msla')
    expect(pickProcess('gear', 40).pick).toBe('sls')
    expect(pickProcess('bracket', 1).pick).toBe('fdm')
    expect(pickProcess('enclosure', 1).pick).toBe('fdm')
    const r = pickProcess('figure', 1).rows
    expect(r.find((x) => x.key === 'fdm')!.detailOk).toBe(false)
    expect(r.find((x) => x.key === 'sls')!.supports).toBe(false)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => resinView({ parts: 6, tiltDeg: 30, layerH: 0.025 }))).toBeLessThan(50)
    expect(medianMs(() => slsView(SLS_PARTS_MAX, 0.06))).toBeLessThan(50)
    expect(medianMs(() => pickProcess('gear', 50))).toBeLessThan(50)
  })
})
