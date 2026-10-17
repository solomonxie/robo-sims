import { medianMs } from '../../stopwatch'
import { EM_LANDMARKS, OBSTACLES, landmarkNear, Obstacle, SPECTRUM_PARTS, SpectrumPart, emAt, emBandOf, hzOfLambda, partView, photonEvAt, sizeLike, sunShare, throughDb, throughShare } from './spectrum'

describe('c = f·λ and photon energy', () => {
  test('Wi-Fi is 12 cm, green light 2.3 eV, X-rays ionise', () => {
    const w = emAt(2.437e9)
    expect(w.lambda * 100).toBeCloseTo(12.3, 1)
    expect(w.band.key).toBe('radio')
    expect(w.antenna! * 100).toBeCloseTo(2.92, 1)
    expect(photonEvAt(hzOfLambda(540e-9))).toBeCloseTo(2.3, 1)
    expect(emAt(hzOfLambda(540e-9)).band.key).toBe('visible')
    expect(emAt(hzOfLambda(540e-9)).seenBy).toEqual(['eye', 'silicon'])
    expect(emAt(hzOfLambda(940e-9)).seenBy).toEqual(['silicon'])
    expect(emAt(1e18).ionising).toBe(true)
    expect(emAt(hzOfLambda(300e-9)).ionising).toBe(false)
    expect(emAt(1e15).antenna).toBeNull()
  })

  test('bands cover the axis in order', () => {
    expect([3, 0.05, 10e-6, 500e-9, 100e-9, 1e-10, 1e-13].map((m) => emBandOf(m).key)).toEqual(['radio', 'microwave', 'infrared', 'visible', 'uv', 'xray', 'gamma'])
  })

  test('landmarks snap within a few hundredths of a decade', () => {
    expect(landmarkNear(2.5e9)?.name).toBe('Wi-Fi')
    expect(landmarkNear(3.5e9)).toBeNull()
    expect(EM_LANDMARKS.every((l, i) => i === 0 || l.hz > EM_LANDMARKS[i - 1].hz)).toBe(true)
  })

  test('sizes compare in log', () => {
    expect(sizeLike(0.123).name).toBe('a phone')
    expect(sizeLike(500e-9).name).toBe('a bacterium')
    expect(sizeLike(1e-12).name).toBe('an atom')
  })

  test('a sweep of 1000 frequencies is fast', () => {
    const ms = medianMs(() => {
      for (let i = 0; i < 1000; i++) emAt(10 ** (8 + i * 0.011))
    })
    expect(ms).toBeLessThan(200)
  })
})

describe('what blocks each band', () => {
  test('obstacle losses at known points, interpolated between', () => {
    expect(throughDb('wall', 0.125)).toBeCloseTo(10)
    expect(throughDb('wall', 0.0125)).toBe(40)
    expect(throughDb('wall', 500e-9)).toBe(100)
    expect(throughDb('wall', 10)).toBe(5)
    const mid = throughDb('wall', Math.sqrt(0.125 * 0.06))
    expect(mid).toBeCloseTo(12.5, 6)
    expect(throughShare('glass', 550e-9)).toBeGreaterThan(0.85)
    expect(throughShare('glass', 10e-6)).toBeLessThan(1e-3)
    expect(throughDb('fog', 0.0125)).toBeLessThan(1)
    expect(throughDb('fog', 550e-9)).toBeGreaterThan(30)
  })

  test('every obstacle table runs long to short', () => {
    for (const o of Object.keys(OBSTACLES) as Obstacle[]) {
      const ls = OBSTACLES[o].pts.map(([l]) => l)
      expect(ls.every((l, i) => i === 0 || l < ls[i - 1])).toBe(true)
    }
  })

  test('sunlight: about 40 % is visible, none is radio', () => {
    expect(sunShare(380e-9, 750e-9)).toBeGreaterThan(0.35)
    expect(sunShare(380e-9, 750e-9)).toBeLessThan(0.5)
    expect(sunShare(0.12, 0.125)).toBeLessThan(1e-9)
  })

  test('parts sit where expected and explain themselves', () => {
    for (const k of Object.keys(SPECTRUM_PARTS) as SpectrumPart[]) {
      const v = partView(k)
      expect(v.lo).toBeLessThan(v.hi)
      expect(v.hzLo).toBeLessThan(v.hzHi)
      expect(v.loss).toHaveLength(4)
    }
    expect(partView('wifi').band.key).toBe('radio')
    expect(partView('radar').band.key).toBe('microwave')
    expect(partView('tof').band.key).toBe('infrared')
    expect(partView('thermal').loss[1]).toBeGreaterThan(50)
    expect(partView('camera').loss[1]).toBeLessThan(1)
    expect(partView('radar').loss[0]).toBeGreaterThan(30)
    expect(partView('lora').loss[0]).toBeLessThan(10)
    expect(partView('gps').antenna! * 100).toBeCloseTo(4.5, 1)
  })
})
