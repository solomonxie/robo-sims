import { SOUND_C } from '../common'
import { THRESHOLD, speedOfSound } from '../sensors/ultrasonic'
import { airSpeedLinear, blindRange, dopplerHz, echoDopplerHz, echoEnvelope, echoFronts, echoRanging, fixedSpeedRead, soundSpeedIn, sourceFronts, speedFromEcho } from './sound'

describe('speed of sound', () => {
  test('air ≈ 331 + 0.6·T, water ~4×, steel ~15×', () => {
    for (const T of [-20, 0, 20, 40]) expect(Math.abs(soundSpeedIn('air', T) - airSpeedLinear(T))).toBeLessThan(1.2)
    expect(soundSpeedIn('air', 20)).toBeCloseTo(343.2, 0)
    expect(soundSpeedIn('water', 20)).toBeCloseTo(1483, 0)
    expect(soundSpeedIn('water', -5)).toBe(soundSpeedIn('water', 0))
    expect(soundSpeedIn('steel', 20) / soundSpeedIn('air', 20)).toBeGreaterThan(14)
  })

  test('a 343 m/s sketch reads long in the cold, short in the heat', () => {
    expect(fixedSpeedRead(1, -10)).toBeGreaterThan(1.03)
    expect(fixedSpeedRead(1, 40)).toBeLessThan(0.98)
    expect(fixedSpeedRead(2, 20.1)).toBeCloseTo(2, 2)
  })
})

describe('echo ranging', () => {
  test('square-on hard panel: direct echo at 2d/c, double bounce at twice that', () => {
    const r = echoRanging('hcsr04', 1, 0, 'wall')
    expect(r.echoes[0].t).toBeCloseTo(2 / speedOfSound(20), 9)
    expect(r.echoes[1].t).toBeCloseTo(4 / speedOfSound(20), 9)
    expect(r.reading).toBeCloseTo(1, 6)
    expect(r.echoes[1].amp).toBeLessThan(r.echoes[0].amp)
  })

  test('one-can sensor is blind up close; a buried echo leaves only the double bounce', () => {
    expect(blindRange('jsn')).toBeGreaterThan(0.2)
    expect(blindRange('hcsr04')).toBeLessThan(0.05)
    const r = echoRanging('jsn', 0.18, 0, 'wall')
    expect(r.buried).toBe(true)
    expect(r.first?.kind).toBe('double')
    expect(r.reading).toBeCloseTo(0.36, 6)
    expect(echoRanging('hcsr04', 0.18, 0, 'wall').reading).toBeCloseTo(0.18, 6)
  })

  test('a tilted panel throws the echo aside; past the beam it is lost', () => {
    const a = echoRanging('hcsr04', 1.5, 0, 'wall').echoes[0].amp
    const b = echoRanging('hcsr04', 1.5, 12, 'wall').echoes[0].amp
    expect(b).toBeLessThan(a / 2)
    expect(echoRanging('hcsr04', 1.5, 25, 'wall').reading).toBeNull()
    expect(echoRanging('hcsr04', 3.5, 0, 'foam').reading).toBeNull()
  })

  test('envelope: ringing falls through the threshold at the blank time', () => {
    const r = echoRanging('jsn', 2, 0, 'wall')
    expect(echoEnvelope(r, 'jsn', r.blank)).toBeCloseTo(1, 6)
    expect(echoEnvelope(r, 'jsn', r.echoes[0].t + 1e-4)).toBeGreaterThan(r.echoes[0].amp / THRESHOLD / 2)
  })
})

describe('doppler', () => {
  test('source and listener formulas, echo doubles the shift', () => {
    expect(dopplerHz(1000, 340, 34)).toBeCloseTo(1000 / 0.9, 6)
    expect(dopplerHz(1000, 340, -34)).toBeCloseTo(1000 / 1.1, 6)
    expect(dopplerHz(1000, 340, 0, 34)).toBeCloseTo(1100, 6)
    const fe = echoDopplerHz(40e3, SOUND_C, 2)
    expect((fe - 40e3) / 40e3).toBeCloseTo((2 * 2) / SOUND_C, 3)
    expect(speedFromEcho(40e3, fe, SOUND_C)).toBeCloseTo(2, 9)
  })

  test('fronts bunch up ahead of a moving source', () => {
    const f = sourceFronts(1, 0, 0.5, 1, 0.25, 10)
    expect(f).toHaveLength(5)
    const ahead = f.map((w) => w.x + w.r)
    const behind = f.map((w) => w.x - w.r)
    expect(ahead[1] - ahead[0]).toBeCloseTo(0.125, 9)
    expect(behind[0] - behind[1]).toBeCloseTo(0.375, 9)
  })

  test('echo fronts come back with the (c+v)/(c−v) spacing', () => {
    const c = 1
    const v = 0.2
    const { back } = echoFronts(10, 5, 0, v, c, 0.5, 40)
    const gaps = back.slice(0, 3).map((w, i, a) => (i ? w.x + w.r - (a[i - 1].x + a[i - 1].r) : 0))
    expect(gaps[1]).toBeCloseTo(0.5 * ((c - v) / (c + v)), 9)
  })
})
