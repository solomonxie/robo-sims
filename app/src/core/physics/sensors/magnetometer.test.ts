import { wrapPi } from '../common'
import { tiltAccel } from '../mcu/i2c'
import {
  MAG_SITES,
  QMC5883L,
  calAttitude,
  circleFit,
  dipoleAxisB,
  earthField,
  ironReading,
  magHeading,
  minMaxCentre,
  qmcCounts,
  sphereFit,
  tiltCompHeading,
  toBody,
  toLevel,
  trueHeading,
  worstHeadingError,
} from './magnetometer'

const DEG = Math.PI / 180
const { fUT, dip } = MAG_SITES.london
const B = earthField(fUT, dip)

describe('Magnetometer', () => {
  it('level: heading = atan2(y, x), clockwise from magnetic north', () => {
    for (const h of [0, 45, 90, 200, 315]) expect(magHeading(toBody(B, h * DEG, 0)) / DEG).toBeCloseTo(h, 9)
    expect(toBody(B, 90 * DEG, 0)[1]).toBeCloseTo(B[0], 9)
    expect(toBody(B, 0, 0)[2]).toBeCloseTo(-fUT * Math.sin(dip * DEG), 9)
  })

  it('tilt matches the accelerometer frame and undoes cleanly', () => {
    toBody([0, 0, 1], 1, 0.3, -0.2).forEach((v, i) => expect(v).toBeCloseTo(tiltAccel(0.3, -0.2)[i], 12))
    toLevel(toBody(B, 1, 0.3, -0.2), 0.3, -0.2).forEach((v, i) => expect(v).toBeCloseTo(toBody(B, 1, 0, 0)[i], 9))
  })

  it('tilting 20° spoils the raw heading; accel tilt compensation fixes it', () => {
    const m = toBody(B, 90 * DEG, 20 * DEG)
    expect(Math.abs(wrapPi(magHeading(m) - 90 * DEG)) / DEG).toBeGreaterThan(20)
    expect(tiltCompHeading(m, tiltAccel(20 * DEG, 0)) / DEG).toBeCloseTo(90, 9)
    expect(tiltCompHeading(toBody(B, 30 * DEG, -0.2, 0.4), tiltAccel(-0.2, 0.4)) / DEG).toBeCloseTo(30, 9)
  })

  it('declination turns magnetic into true heading', () => {
    expect(trueHeading(355 * DEG, 13) / DEG).toBeCloseTo(8, 9)
  })

  it('QMC5883L counts 120 per µT and saturates past ±200 µT', () => {
    expect(qmcCounts([10, -50, 300])).toEqual([1200, -6000, QMC5883L.rangeUT * 120])
  })

  it('a motor magnet 10 cm away rivals Earth: B = μ₀m / 2πr³', () => {
    expect(dipoleAxisB(0.32, 0.1)).toBeCloseTo(64, 0)
    expect(dipoleAxisB(0.32, 0.2)).toBeCloseTo(8, 0)
  })

  it('a flat turn traces a circle centred on the hard-iron offset', () => {
    const hard: [number, number, number] = [30, -12, 8]
    const pts = Array.from({ length: 60 }, (_, k) => ironReading(B, (k / 60) * 2 * Math.PI, 0, hard))
    const f = circleFit(pts)
    expect(f.centre[0]).toBeCloseTo(30, 6)
    expect(f.centre[1]).toBeCloseTo(-12, 6)
    expect(f.r).toBeCloseTo(B[0], 6)
    expect(minMaxCentre(pts)[0]).toBeCloseTo(30, 0)
  })

  it('a tumble fills a sphere; the fit finds all three offsets even with noise', () => {
    const hard: [number, number, number] = [30, -12, 8]
    const pts = Array.from({ length: 300 }, (_, k) => {
      const a = calAttitude('tumble', k / 299)
      return ironReading(B, a.yaw, a.pitch, hard, 0, k, 0.5)
    })
    const f = sphereFit(pts)
    f.centre.forEach((c, i) => expect(Math.abs(c - hard[i])).toBeLessThan(0.3))
    expect(f.r).toBeCloseTo(fUT, 0)
  })

  it('heading error: large with hard iron, gone after subtracting it', () => {
    const hard: [number, number, number] = [30, -12, 8]
    expect(worstHeadingError(B, [0, 0, 0], 0)).toBeLessThan(1e-9)
    expect(worstHeadingError(B, hard, 0) / DEG).toBeGreaterThan(40)
    expect(worstHeadingError(B, hard, 0, hard)).toBeLessThan(1e-9)
    expect(worstHeadingError(B, hard, 0.2, hard) / DEG).toBeGreaterThan(4)
  })
})
