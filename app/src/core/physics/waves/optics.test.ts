import { OPTIC_MEDIA, apparentDepth, blurCircle, criticalDeg, detectorReturn, dofLimits, fresnelR, hyperfocal, magnification, reflect2, scatterAt, snellDeg, thinLensV } from './optics'

describe('reflection', () => {
  test('angle in = angle out', () => {
    const [x, y] = reflect2([Math.sin(0.5), -Math.cos(0.5)], [0, 1])
    expect(x).toBeCloseTo(Math.sin(0.5), 12)
    expect(y).toBeCloseTo(Math.cos(0.5), 12)
  })

  test('a mirror sends almost everything to the mirror angle, paper spreads it', () => {
    expect(scatterAt('mirror', 30, 30).spec).toBeGreaterThan(20 * scatterAt('paper', 30, 30).diffuse)
    expect(scatterAt('mirror', 30, -10).spec).toBeLessThan(1e-6)
    expect(detectorReturn('paper', 30, -10).diffuse).toBeCloseTo(detectorReturn('paper', 30, 10).diffuse, 9)
    expect(detectorReturn('mirror', 30, 30, 15).spec).toBeCloseTo(0.92, 2)
  })

  test('glossy black tape glints at the mirror angle, reads black away from it', () => {
    const at = detectorReturn('tape', 15, 15)
    const off = detectorReturn('tape', 15, 45)
    const white = detectorReturn('paper', 15, 15)
    expect(at.glare).toBeGreaterThan(0.6)
    expect(at.total / white.total).toBeGreaterThan(0.25)
    expect(off.total / detectorReturn('paper', 15, 45).total).toBeLessThan(0.08)
    expect(detectorReturn('tile', 15, 15).total).toBeGreaterThan(white.total)
  })
})

describe('refraction', () => {
  const { air, water, acrylic } = OPTIC_MEDIA
  test("Snell's law bends toward the normal going in, away coming out", () => {
    const t = snellDeg(air.n, water.n, 40)!
    expect(t).toBeCloseTo(28.8, 1)
    expect(snellDeg(water.n, air.n, t)).toBeCloseTo(40, 9)
    expect(snellDeg(air.n, water.n, 0)).toBe(0)
  })

  test('total internal reflection past the critical angle', () => {
    const c = criticalDeg(acrylic.n, air.n)!
    expect(c).toBeCloseTo(42.2, 1)
    expect(snellDeg(acrylic.n, air.n, c + 0.1)).toBeNull()
    expect(fresnelR(acrylic.n, air.n, c + 0.1)).toBe(1)
    expect(criticalDeg(air.n, water.n)).toBeNull()
  })

  test('Fresnel: ~4 % head-on off glass/acrylic, rising to 100 % at grazing', () => {
    expect(fresnelR(air.n, acrylic.n, 0)).toBeCloseTo(0.0387, 3)
    expect(fresnelR(air.n, acrylic.n, 60)).toBeGreaterThan(fresnelR(air.n, acrylic.n, 0))
    expect(fresnelR(air.n, acrylic.n, 89.9)).toBeGreaterThan(0.95)
  })

  test('water looks three quarters as deep', () => {
    expect(apparentDepth(0.1, water.n, air.n)).toBeCloseTo(0.075, 3)
  })
})

describe('thin lens', () => {
  const f = 0.05
  test('1/f = 1/u + 1/v; 2f images 2f at the same size, upside down', () => {
    expect(thinLensV(f, 0.1)).toBeCloseTo(0.1, 12)
    expect(magnification(f, 0.1)).toBeCloseTo(-1, 12)
    expect(thinLensV(f, f)).toBe(Infinity)
    expect(thinLensV(f, 1e9)).toBeCloseTo(f, 9)
  })

  test('blur grows off focus and shrinks with a smaller aperture', () => {
    expect(blurCircle(f, 2, 0.1, 0.1)).toBeCloseTo(0, 12)
    expect(blurCircle(f, 2, 0.12, 0.1)).toBeGreaterThan(blurCircle(f, 8, 0.12, 0.1))
    expect(blurCircle(f, 2, 0.12, 0.1) / blurCircle(f, 8, 0.12, 0.1)).toBeCloseTo(4, 9)
  })

  test('depth-of-field limits are where the blur reaches c', () => {
    const c = 0.2e-3
    const { near, far } = dofLimits(f, 4, 0.12, c)
    const s = thinLensV(f, 0.12)
    expect(blurCircle(f, 4, near, s)).toBeCloseTo(c, 9)
    expect(blurCircle(f, 4, far, s)).toBeCloseTo(c, 9)
    const H = hyperfocal(0.0034, 2, 4.4e-6)
    expect(H).toBeCloseTo(1.317, 2)
    expect(dofLimits(0.0034, 2, H, 4.4e-6).far).toBe(Infinity)
    expect(dofLimits(0.0034, 2, H, 4.4e-6).near).toBeCloseTo(H / 2, 2)
  })
})
