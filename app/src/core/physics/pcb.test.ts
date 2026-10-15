import {
  STACKUPS,
  annularRing,
  boardsPerPanel,
  copperOhms,
  crossings,
  ipcAmps,
  ipcRise,
  ipcWidthMm,
  loopInductance,
  mstEdges,
  returnDensity,
  returnWithin,
  segmentsCross,
  stackMm,
  traceAreaMil2,
  viaAreaMil2,
} from '.'

describe('pcb', () => {
  it('both stackups build a 1.6 mm board', () => {
    expect(stackMm(STACKUPS.two)).toBeCloseTo(1.6, 6)
    expect(stackMm(STACKUPS.four)).toBeCloseTo(1.6, 6)
  })

  it('IPC-2221: a 1 mm, 1 oz outer trace carries ~2.4 A at 10 °C rise', () => {
    const a = traceAreaMil2(1, 1)
    expect(a).toBeCloseTo(53.9, 0)
    expect(ipcAmps(a, 10)).toBeCloseTo(2.38, 1)
    expect(ipcAmps(a, 10, true)).toBeCloseTo(ipcAmps(a, 10) / 2, 9)
    expect(ipcRise(ipcAmps(a, 20), a)).toBeCloseTo(20, 6)
    expect(ipcWidthMm(ipcAmps(a, 10), 10, 1)).toBeCloseTo(1, 6)
  })

  it('a 0.3 mm via barrel has about the copper of a 0.6 mm trace', () => {
    expect(viaAreaMil2(0.3)).toBeCloseTo(33.5, 1)
    expect(viaAreaMil2(0.3) / traceAreaMil2(0.6, 1)).toBeCloseTo(1.03, 1)
  })

  it('copper resistance: 100 mm of 1 mm / 1 oz is ~50 mΩ and rises with temperature', () => {
    const a = traceAreaMil2(1, 1)
    expect(copperOhms(100, a)).toBeCloseTo(0.0502, 3)
    expect(copperOhms(100, a, 125) / copperOhms(100, a, 25)).toBeCloseTo(1.41265 / 1.01965, 4)
  })

  it('loop inductance: 10 cm square of 2 mm wire ≈ 0.31 µH; hugging a plane shrinks it', () => {
    expect(loopInductance(0.1, 0.1, 1e-3)).toBeCloseTo(3.065e-7, 9)
    expect(loopInductance(0.03, 0.01, 6e-5) / loopInductance(0.03, 0.0002, 6e-5)).toBeGreaterThan(4)
  })

  it('the return current crowds under the trace', () => {
    expect(returnDensity(0, 1)).toBeCloseTo(1 / Math.PI, 9)
    expect(returnWithin(1)).toBeCloseTo(0.5, 9)
    expect(returnWithin(3)).toBeCloseTo(0.795, 3)
  })

  it('ratsnest: MST joins every pad by the shortest total length', () => {
    expect(mstEdges([[0, 0], [10, 0], [1, 0], [11, 1]])).toEqual([[0, 2], [2, 1], [1, 3]])
    expect(mstEdges([[0, 0]])).toEqual([])
  })

  it('counts crossings but not shared endpoints', () => {
    expect(segmentsCross([[0, 0], [2, 2]], [[0, 2], [2, 0]])).toBe(true)
    expect(segmentsCross([[0, 0], [2, 2]], [[2, 2], [3, 0]])).toBe(false)
    expect(crossings([[[0, 0], [2, 2]], [[0, 2], [2, 0]], [[1, -1], [1, 3]]])).toBe(3)
  })

  it('annular ring and panelisation', () => {
    expect(annularRing(0.6, 0.3)).toBeCloseTo(0.15, 9)
    expect(annularRing(0.6, 0.3, 0.2)).toBeLessThan(0)
    expect(boardsPerPanel([100, 100], [40, 20], 2, 5)).toBe(8)
    expect(boardsPerPanel([10, 10], [40, 20], 2, 5)).toBe(0)
  })
})
