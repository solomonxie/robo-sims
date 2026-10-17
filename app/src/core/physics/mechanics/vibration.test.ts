import { medianMs } from '../../stopwatch'
import { rpmToRadS } from '../actuators/stepper'
import { ampRatio } from './oscillation'
import { ACC_NOISE_G, ISOLATION_R, MOTOR_PLATE, accelSamples, accelSpectrum, frameShake, mountStiffness, mountTransmit, transmissibility, transmitLag, unbalanceForce } from './vibration'

describe('motor vibration', () => {
  test('unbalance force grows with speed²', () => {
    expect(unbalanceForce(0.001, 0.01, rpmToRadS(6000))).toBeCloseTo(0.001 * 0.01 * (200 * Math.PI) ** 2, 9)
    expect(unbalanceForce(0.001, 0.01, 2) / unbalanceForce(0.001, 0.01, 1)).toBeCloseTo(4, 9)
  })

  test('frame whirl: tiny far below fn, resonant at fn, m·e/M far above', () => {
    const me = 0.0005 * 0.01
    const slow = frameShake(MOTOR_PLATE, 0.0005, 0.01, 60)
    expect(slow.x).toBeLessThan(0.01 * (me / MOTOR_PLATE.M))
    const at = frameShake(MOTOR_PLATE, 0.0005, 0.01, MOTOR_PLATE.fn * 60)
    expect(at.x).toBeCloseTo((me / MOTOR_PLATE.M) * ampRatio(MOTOR_PLATE.zeta, 1), 12)
    expect(at.lag).toBeCloseTo(Math.PI / 2, 9)
    const fast = frameShake(MOTOR_PLATE, 0.0005, 0.01, 60000)
    expect(fast.x / (me / MOTOR_PLATE.M)).toBeCloseTo(1, 2)
    expect(fast.accel).toBeCloseTo(fast.w ** 2 * fast.x, 9)
  })

  test('accelerometer spectrum peaks at rpm/60 with the shake amplitude', () => {
    const s = accelSpectrum(accelSamples(0.5, 6000 / 60, ACC_NOISE_G, 7))
    expect(Math.abs(s.peakHz - 100)).toBeLessThanOrEqual(s.df)
    expect(s.peak).toBeGreaterThan(0.35)
    expect(s.peak).toBeLessThan(0.55)
  })

  test('slider recompute is fast', () => {
    const ms = medianMs(() => {
      for (let i = 0; i < 20; i++) accelSpectrum(accelSamples(0.3, 50 + i, ACC_NOISE_G, i))
    })
    expect(ms / 20).toBeLessThan(20)
  })
})

describe('damping mounts', () => {
  test('transmissibility: 1 at r = 0 and r = √2 for any ζ, below 1 above √2', () => {
    for (const z of [0.05, 0.2, 0.7]) {
      expect(transmissibility(z, 0)).toBeCloseTo(1, 12)
      expect(transmissibility(z, ISOLATION_R)).toBeCloseTo(1, 12)
      expect(transmissibility(z, 3)).toBeLessThan(1)
      expect(transmissibility(z, 1)).toBeGreaterThan(1)
    }
  })

  test('more damping tames the peak but isolates less up high', () => {
    expect(transmissibility(0.05, 1)).toBeGreaterThan(transmissibility(0.3, 1))
    expect(transmissibility(0.05, 5)).toBeLessThan(transmissibility(0.3, 5))
    expect(transmitLag(0.1, 1)).toBeLessThan(Math.PI / 2)
    expect(transmitLag(0.1, 10)).toBeGreaterThan(Math.PI / 2)
  })

  test('soft mounts isolate motor speeds, hard mount passes everything', () => {
    expect(mountTransmit('none', 0.1, 150)).toBe(1)
    expect(mountTransmit('soft', 0.1, 150)).toBeLessThan(0.1)
    expect(mountTransmit('stiff', 0.1, 150)).toBeGreaterThan(1)
    expect(mountStiffness(0.02, 30)).toBeCloseTo(0.02 * (60 * Math.PI) ** 2, 9)
  })
})
