import { medianMs } from '../../stopwatch'
import { HOTENDS, PLA_FLOW_C, coreTempAt, filamentArea, flowView, hotendZones, maxFlow } from './fdm'
import { LAYER_SWEEP, layerPath, toolpathAt, toolpathLength, sliceLayers, sliceView } from './layers'
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
