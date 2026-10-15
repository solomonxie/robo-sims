import {
  TOF_TARGETS,
  VL53L0X,
  ZoneScene,
  arrivalHistogram,
  castRay,
  lightRoundTrip,
  lightVsSound,
  reportedMm,
  sigmaMm,
  signalMcps,
  steerFrom,
  tofMaxRange,
  tofRanging,
  zoneGrid,
  zoneRay,
  zoneWidth,
} from './tof'

const deg = (d: number) => (d * Math.PI) / 180
const room = (boxX: number, boxY = 0): ZoneScene => ({
  height: 0.1,
  tilt: deg(10),
  solids: [
    { kind: 'box', name: 'wall', x: [1.6, 1.7], y: [-3, 3], h: 2 },
    { kind: 'box', name: 'box', x: [boxX, boxX + 0.3], y: [boxY - 0.15, boxY + 0.15], h: 0.3 },
  ],
})

describe('laser time of flight', () => {
  it('light covers 1 m and back in 6.7 ns, ~10⁶× faster than sound', () => {
    expect(lightRoundTrip(1) * 1e9).toBeCloseTo(6.67, 2)
    expect(lightVsSound(20)).toBeGreaterThan(8.5e5)
    expect(lightVsSound(20)).toBeLessThan(8.9e5)
  })

  it('return rate falls with 1/d² and reflectance', () => {
    expect(signalMcps(0.5, 0.88) / signalMcps(1, 0.88)).toBeCloseTo(4)
    expect(signalMcps(1, 0.17) / signalMcps(1, 0.88)).toBeCloseTo(0.17 / 0.88)
  })

  it('sigma shrinks with counts and grows with ambient', () => {
    expect(sigmaMm(400, 0)).toBeCloseTo(VL53L0X.pulseMm / 20)
    expect(sigmaMm(400, 1000)).toBeGreaterThan(sigmaMm(400, 0) * 2)
  })

  it('reaches ~1.2 m on white indoors, ~2 m in long-range mode, much less in sun', () => {
    expect(tofMaxRange(TOF_TARGETS.white, 0, 'default')).toBeCloseTo(1.2, 1)
    expect(tofMaxRange(TOF_TARGETS.white, 0, 'long')).toBeGreaterThan(1.8)
    expect(tofMaxRange(TOF_TARGETS.grey, 0, 'default')).toBeLessThan(0.6)
    expect(tofMaxRange(TOF_TARGETS.white, 100, 'default')).toBeLessThan(0.5)
  })

  it('statuses: valid, signal fail, sigma fail, out of range', () => {
    expect(tofRanging(0.5, 0.88, 0, 'default').status).toBe(0)
    expect(tofRanging(1.5, 0.88, 0, 'default').status).toBe(2)
    expect(tofRanging(0.6, 0.88, 40, 'default').status).toBe(1)
    expect(tofRanging(2.5, 0.88, 0, 'long').status).toBe(4)
    expect(reportedMm(0.5, 10, true, 1)).toBe(510)
    expect(reportedMm(2.5, 10, false, 0)).toBe(VL53L0X.outOfRange)
  })

  it('histogram peaks at the round-trip time over a flat ambient floor', () => {
    const h = arrivalHistogram(1, 0.88, 5, 'default', 64, 16)
    const peak = h.indexOf(Math.max(...h))
    expect((peak + 0.5) * 0.25).toBeCloseTo(6.67, 0)
    expect(h[0]).toBeCloseTo(h[63], 3)
  })
})

describe('multi-zone ranging', () => {
  it('zones widen with distance', () => {
    expect(zoneWidth(1, 8) * 100).toBeCloseTo(9.8, 1)
    expect(zoneWidth(1, 4)).toBeCloseTo(2 * Math.tan(deg(5.625)) * 1, 3)
  })

  it('rays hit the floor, boxes and walls', () => {
    const sc = room(0.6)
    expect(castRay(sc, zoneRay(0, deg(-45), 0)).what).toBe('floor')
    expect(castRay(sc, zoneRay(0, 0, 0))).toMatchObject({ what: 'box' })
    expect(castRay(sc, zoneRay(0, 0, 0)).m).toBeCloseTo(0.6, 5)
    expect(castRay(sc, zoneRay(deg(20), 0, 0)).what).toBe('wall')
  })

  it('an 8×8 grid sees the box in the middle columns, wall above, floor below', () => {
    const g = zoneGrid(room(0.6), 8)
    expect(g).toHaveLength(8)
    expect(g[4][3].what).toBe('box')
    expect(g[0][0].what).toBe('wall')
    expect(g[7][0].what).toBe('floor')
  })

  it('steers away from the side the box is on, stops when close', () => {
    expect(steerFrom(zoneGrid(room(0.6, 0.15), 8)).action).toBe('right')
    expect(steerFrom(zoneGrid(room(0.6, -0.15), 8)).action).toBe('left')
    expect(steerFrom(zoneGrid(room(0.15), 8)).action).toBe('stop')
    expect(steerFrom(zoneGrid(room(3), 8)).action).toBe('ahead')
  })
})
