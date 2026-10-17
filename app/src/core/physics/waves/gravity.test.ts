import { DEG } from '../common'
import { bodyAccel } from '../sensors/imu'
import { ACCEL_FS_G, accelReading, detectFall, dropRun, dropTime, fallHeight, specificForce, terminalSpeed } from './gravity'

describe('free fall', () => {
  it('h = ½gt² both ways', () => {
    expect(dropTime(1)).toBeCloseTo(0.4515, 3)
    expect(fallHeight(dropTime(2.5))).toBeCloseTo(2.5, 9)
  })

  it('reads 1 g held, ~0 g falling, a clipped spike on impact, then 1 g again', () => {
    const R = dropRun(1.5, 'robot')
    expect(R.samples[100].g).toBeCloseTo(1, 6)
    const mid = R.samples.find((s) => s.t > R.holdS + R.fallS / 2)!
    expect(mid.g).toBeLessThan(0.02)
    expect(R.fallS).toBeGreaterThan(dropTime(1.5))
    expect(R.fallS).toBeLessThan(dropTime(1.5) * 1.01)
    expect(R.peakRaw).toBeGreaterThan(ACCEL_FS_G)
    expect(Math.max(...R.samples.map((s) => s.g))).toBe(ACCEL_FS_G)
    const tail = R.samples.filter((s) => s.t > R.impactT + 0.4)
    expect(tail.reduce((a, s) => a + s.g, 0) / tail.length).toBeCloseTo(1, 1)
  })

  it('drag is the only reading in the air: (v / vt)² g', () => {
    const R = dropRun(3, 'drone')
    expect(R.dragAtImpact).toBeCloseTo((R.impactV / R.vt) ** 2, 1)
    expect(R.dragAtImpact).toBeGreaterThan(0.2)
    expect(terminalSpeed(0.9, 0.09)).toBeCloseTo(12.8, 1)
  })

  it('a free-fall interrupt times the drop; too low a threshold misses a draggy fall', () => {
    const R = dropRun(2, 'phone')
    const D = detectFall(R.samples, 0.3)
    expect(D.found).toBe(true)
    expect(D.fromS).toBeCloseTo(R.holdS, 2)
    expect(D.heightM).toBeCloseTo(2, 0)
    const drone = dropRun(3, 'drone')
    const low = detectFall(drone.samples, 0.15)
    expect(low.lenS).toBeLessThan(drone.fallS * 0.9)
  })
})

describe('accelerometer reading', () => {
  it('still and level reads +1 g up; free fall reads zero', () => {
    expect(specificForce([0, 0, 0], 0)).toEqual([0, 0, 1])
    expect(accelReading('fall', 0, 0).mag).toBeCloseTo(0, 12)
    expect(Number.isNaN(accelReading('fall', 0, 0).est)).toBe(true)
  })

  it('matches bodyAccel for pitch and forward acceleration', () => {
    const f = specificForce([0.3, 0, 0.1], 12 * DEG)
    bodyAccel(12 * DEG, 0.3, 0.1).forEach((v, i) => expect(f[i]).toBeCloseTo(v, 12))
  })

  it('speeding up reads as nose up, braking as nose down, a lift changes only the size', () => {
    expect(accelReading('forward', 0.3, 0).err).toBeCloseTo(Math.atan(0.3), 9)
    expect(accelReading('brake', 0.3, 0).err).toBeCloseTo(-Math.atan(0.3), 9)
    const up = accelReading('liftUp', 0.2, 10 * DEG)
    expect(up.mag).toBeCloseTo(1.2, 9)
    expect(up.err).toBeCloseTo(0, 9)
  })

  it('a left turn pushes the reading onto +Y', () => {
    const r = accelReading('turn', 0.4, 0)
    expect(r.f[1]).toBeCloseTo(0.4, 9)
    expect(r.f[0]).toBeCloseTo(0, 9)
    expect(r.rollErr).toBeCloseTo(Math.atan(0.4), 9)
    expect(r.err).toBeCloseTo(0, 9)
  })
})
