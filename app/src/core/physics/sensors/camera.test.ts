import {
  LENSES,
  OV2640,
  blurPx,
  clipShares,
  distort,
  fovDeg,
  histogram,
  lineTime,
  pixelDn,
  project,
  propellerAt,
  rowTime,
  sensorMm,
  signalE,
  snrDb,
  turnDeg,
  undistort,
} from './camera'

describe('Camera', () => {
  it('pinhole: twice as far → half as big; the OV2640 + 3.4 mm lens sees ~66° across the diagonal', () => {
    expect(project([1, 0.5, 2], 4)).toEqual([2, 1])
    expect(project([1, 0.5, 4], 4)).toEqual([1, 0.5])
    const diag = Math.hypot(sensorMm(OV2640.w), sensorMm(OV2640.h))
    expect(diag).toBeCloseTo(4.4, 1)
    expect(fovDeg(diag, OV2640.focalMm)).toBeCloseTo(66, -0.5)
  })

  it('rolling shutter reads SVGA in ~30 ms, row by row; global samples every row at once', () => {
    const { lines, fps, h } = OV2640.svga
    const line = lineTime(fps, lines)
    expect(line * 1e6).toBeCloseTo(49.6, 1)
    expect(rowTime(h, line, false) * 1e3).toBeCloseTo(29.8, 1)
    expect(rowTime(h, line, true)).toBe(0)
    expect(turnDeg(600, 0.0298)).toBeCloseTo(107, 0)
  })

  it('propeller coverage: hub, blades every 120°, gaps between', () => {
    expect(propellerAt(0, 0, 0)).toBe(0)
    expect(propellerAt(0.6, 0, 0)).toBe(0)
    expect(propellerAt(Math.cos(2.094) * 0.6, Math.sin(2.094) * 0.6, 0)).toBe(1)
    expect(propellerAt(Math.cos(1.05) * 0.6, Math.sin(1.05) * 0.6, 0)).toBe(-1)
    expect(propellerAt(1.2, 0, 0)).toBe(-1)
    expect(propellerAt(0, 0.6, Math.PI / 2)).toBe(0)
  })

  it('exposure: signal ∝ time / N², gain brightens but leaves SNR alone, the full well clips', () => {
    const e = signalE(50, 1 / 30, 2)
    expect(e).toBeGreaterThan(300)
    expect(e).toBeLessThan(800)
    expect(signalE(50, 2 / 30, 2)).toBeCloseTo(2 * e)
    expect(signalE(50, 1 / 30, 2.8)).toBeCloseTo(e / 1.96, 0)
    expect(signalE(1e5, 1, 2)).toBe(OV2640.fullWell)
    expect(pixelDn(e, 4)).toBeCloseTo(4 * pixelDn(e, 1), -1)
    expect(pixelDn(OV2640.fullWell, 2)).toBe(255)
    expect(snrDb(e)).toBeGreaterThan(snrDb(e / 16) + 10)
    const draws = Array.from({ length: 400 }, (_, k) => pixelDn(e, 4, k))
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(mean).toBeCloseTo(pixelDn(e, 4), -1)
  })

  it('motion blur and histogram clipping', () => {
    expect(blurPx(1200, 1 / 30)).toBeCloseTo(40)
    expect(histogram([0, 10, 128, 255, 255], 4)).toEqual([2, 0, 1, 2])
    expect(clipShares([0, 0, 5, 255])).toEqual({ low: 0.5, high: 0.25 })
  })

  it('radial distortion: barrel pulls corners in, pincushion pushes out; undistort inverts it', () => {
    const w = LENSES.wide
    const [bx] = distort([0.8, 0], w.k1, w.k2)
    expect(bx).toBeLessThan(0.8)
    const [px] = distort([0.8, 0], LENSES.tele.k1, LENSES.tele.k2)
    expect(px).toBeGreaterThan(0.8)
    for (const l of Object.values(LENSES))
      for (const p of [[0.3, 0.2], [0.8, 0.6], [-0.5, 0.55]]) {
        const [x, y] = undistort(distort(p, l.k1, l.k2), l.k1, l.k2)
        expect(x).toBeCloseTo(p[0], 6)
        expect(y).toBeCloseTo(p[1], 6)
      }
    const [cx, cy] = undistort([0.8, 0.6], w.k1, w.k2)
    expect(Math.hypot(cx, cy)).toBeCloseTo(1.4, 1)
  })
})
