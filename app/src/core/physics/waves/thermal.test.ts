import { medianMs } from '../../stopwatch'
import { EMISSIVITY, SENSOR_BANDS, THERMAL_CAMS, apparentC, bandShare, deskScene, exitance, kelvinOf, netRadiatedW, pixelFootprint, planckExitance, thermalImage, wienPeakM } from './thermal'

describe('black-body radiation', () => {
  test('the Planck curve integrates to σT⁴ and peaks at Wien’s b/T', () => {
    const T = kelvinOf(37)
    expect(bandShare(T, 0.5e-6, 1e-3, 600)).toBeCloseTo(1, 3)
    const peak = wienPeakM(T)
    expect(peak * 1e6).toBeCloseTo(9.34, 2)
    expect(planckExitance(peak, T)).toBeGreaterThan(planckExitance(peak * 0.9, T))
    expect(planckExitance(peak, T)).toBeGreaterThan(planckExitance(peak * 1.1, T))
  })

  test('power grows as T⁴; a body radiates ~0.5 kW/m²', () => {
    expect(exitance(600) / exitance(300)).toBeCloseTo(16, 9)
    expect(exitance(kelvinOf(37))).toBeCloseTo(525, 0)
    expect(netRadiatedW(37, 0.98, 22, 1.8)).toBeGreaterThan(150)
  })

  test('a thermopile band catches about a third of body heat; almost none of it is visible', () => {
    const T = kelvinOf(37)
    const th = bandShare(T, SENSOR_BANDS.thermal.lo, SENSOR_BANDS.thermal.hi)
    expect(th).toBeGreaterThan(0.3)
    expect(th).toBeLessThan(0.45)
    expect(bandShare(T, SENSOR_BANDS.eye.lo, SENSOR_BANDS.eye.hi)).toBeLessThan(1e-15)
    expect(bandShare(5800, SENSOR_BANDS.eye.lo, SENSOR_BANDS.eye.hi)).toBeGreaterThan(0.35)
  })

  test('shiny metal reads near room temperature, matte paint reads true', () => {
    expect(apparentC(65, EMISSIVITY.paint.eps)).toBeCloseTo(65, 6)
    expect(apparentC(65, EMISSIVITY.aluminium.eps)).toBeLessThan(28)
    expect(apparentC(22, EMISSIVITY.copper.eps)).toBeCloseTo(22, 6)
  })
})

describe('thermal camera', () => {
  test('footprint grows with distance', () => {
    const a = pixelFootprint('amg8833', 1)
    expect(a.px * 100).toBeCloseTo(14.4, 1)
    expect(pixelFootprint('amg8833', 2).px).toBeCloseTo(2 * a.px, 12)
  })

  test('a fine sensor sees the person and the hot regulator; a coarse one averages the regulator away', () => {
    const scene = deskScene(EMISSIVITY.paint.eps)
    const fine = thermalImage('lepton', 0.7, scene)
    expect(fine.at(-0.27, 0.08)!).toBeCloseTo(34, 0)
    expect(fine.hi).toBeGreaterThan(70)
    const coarse = thermalImage('amg8833', 1.5, scene)
    expect(coarse.hi).toBeLessThan(40)
    expect(coarse.lo).toBeGreaterThan(18)
  })

  test('a bare aluminium motor hides in the image; a painted one stands out', () => {
    const painted = thermalImage('mlx90640', 0.6, deskScene(EMISSIVITY.paint.eps)).at(-0.02, -0.205)!
    const bare = thermalImage('mlx90640', 0.6, deskScene(EMISSIVITY.aluminium.eps)).at(-0.02, -0.205)!
    expect(painted).toBeGreaterThan(55)
    expect(bare).toBeLessThan(30)
  })

  test('renders the finest sensor fast', () => {
    expect(medianMs(() => thermalImage('lepton', 1, deskScene(0.95)))).toBeLessThan(200)
    expect(THERMAL_CAMS.lepton.cols * THERMAL_CAMS.lepton.rows).toBe(4800)
  })
})
