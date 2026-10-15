import { COMP, compRun, crossoverHz, fuseRun, gaussPdf, headingBlend, highGain, kalmanRun, kfGain, kfPredict, kfSteady, kfUpdate, loopRate, lowGain } from './fusion'

const DEG = Math.PI / 180

describe('1D Kalman filter', () => {
  it('predicts by adding the move and the process variance', () => {
    const b = kfPredict({ x: 2, P: 0.25 }, 1, 0.09)
    expect(b.x).toBe(3)
    expect(b.P).toBeCloseTo(0.34, 12)
  })

  it('weights by variances: equal trust meets halfway, a sharper sensor wins', () => {
    const half = kfUpdate({ x: 0, P: 1 }, 2, 1)
    expect(half).toEqual({ x: 1, P: 0.5, K: 0.5 })
    expect(kfGain(1, 0.01)).toBeCloseTo(0.99, 2)
    expect(kfUpdate({ x: 0, P: 0.01 }, 2, 1).x).toBeCloseTo(0.0198, 4)
    const post = kfUpdate({ x: 0, P: 0.4 }, 1, 0.6)
    expect(1 / post.P).toBeCloseTo(1 / 0.4 + 1 / 0.6, 9)
  })

  it('settles to the steady-state gain', () => {
    const { P, K } = kfSteady(0.09, 0.25)
    expect(P * P - 0.09 * P - 0.09 * 0.25).toBeCloseTo(0, 12)
    const run = kalmanRun(0.3, 0.5, 30)
    expect(run[29].K).toBeCloseTo(K, 6)
    expect(run[29].prior.P).toBeCloseTo(P, 6)
    expect(kfSteady(0.01, 1).K).toBeLessThan(kfSteady(1, 1).K)
  })

  it('beats the raw measurements on average', () => {
    const run = kalmanRun(0.1, 0.8, 200)
    const err = (f: (s: (typeof run)[0]) => number) => Math.sqrt(run.reduce((a, s) => a + (f(s) - s.truth) ** 2, 0) / run.length)
    expect(err((s) => s.post.x)).toBeLessThan(0.6 * err((s) => s.z))
  })

  it('has a unit-area bell curve', () => {
    let a = 0
    for (let x = -5; x < 5; x += 0.01) a += gaussPdf(x, 0.3, 0.7) * 0.01
    expect(a).toBeCloseTo(1, 4)
    expect(gaussPdf(0, 0, 0.1)).toBeCloseTo(10 * gaussPdf(0, 0, 1), 9)
  })
})

describe('why fuse', () => {
  it('gives each sensor its own error character, and fusion beats all three', () => {
    const r = fuseRun(0.05, 1.5)
    const end = r.t.length - 1
    expect(r.odo[end] - r.truth[end]).toBeGreaterThan(0.6)
    expect(r.err.gps).toBeGreaterThan(1)
    expect(r.err.gps).toBeLessThan(2.2)
    expect(r.err.post).toBeGreaterThan(1.5)
    expect(r.gpsFix.filter(Boolean).length).toBe(36)
    expect(r.postFix.filter(Boolean).length).toBe(Math.floor(r.truth[end] / 5))
    for (const [slip, sigma] of [[0.01, 0.5], [0.05, 3], [0.1, 0.5], [0.1, 3]]) {
      const e = fuseRun(slip, sigma).err
      expect(e.fused).toBeLessThan(Math.min(e.odo, e.gps, e.post))
    }
  })

  it('lets either helper rein in odometry, GPS less than the posts', () => {
    const r = fuseRun(0.1, 1.5)
    const gpsOnly = fuseRun(0.1, 1.5, { gps: true, posts: false }).err.fused
    const postsOnly = fuseRun(0.1, 1.5, { gps: false, posts: true }).err.fused
    expect(gpsOnly).toBeLessThan(0.7 * Math.min(r.err.odo, r.err.gps))
    expect(postsOnly).toBeLessThan(gpsOnly)
    expect(r.err.fused).toBeLessThan(gpsOnly)
  })

  it('shrinks the uncertainty at each landmark post', () => {
    const r = fuseRun(0.05, 1.5)
    const k = r.postFix.indexOf(true)
    expect(r.sigma[k]).toBeLessThan(0.06)
    expect(r.sigma[k - 1]).toBeGreaterThan(2 * r.sigma[k])
  })
})

describe('complementary heading', () => {
  it('splits the band at the crossover, gains in quadrature', () => {
    expect(crossoverHz(1)).toBeCloseTo(0.159, 3)
    const f = crossoverHz(2)
    expect(lowGain(f, 2)).toBeCloseTo(Math.SQRT1_2, 9)
    expect(highGain(f, 2)).toBeCloseTo(Math.SQRT1_2, 9)
    expect(lowGain(0.001, 2)).toBeGreaterThan(0.99)
    expect(highGain(10, 2)).toBeGreaterThan(0.99)
    for (const x of [0.01, 0.3, 4]) expect(lowGain(x, 2) ** 2 + highGain(x, 2) ** 2).toBeCloseTo(1, 9)
  })

  it('blends across the 0/360 wrap', () => {
    const h = headingBlend(359 * DEG, 0, 1 * DEG, 0.5)
    expect(h / DEG).toBeCloseTo(0, 6)
    expect(headingBlend(0, 0.1, 5, 1)).toBeCloseTo(0.1, 9)
  })

  it('drives a square loop', () => {
    let a = 0
    for (let t = 0; t < 4 * (COMP.straight + COMP.turn); t += COMP.dt) a += loopRate(t) * COMP.dt
    expect(a).toBeCloseTo(2 * Math.PI, 1)
    const r = compRun(2, 0, 0)
    const [x, y] = r.pos[r.pos.length - 1]
    expect(Math.hypot(x, y)).toBeLessThan(0.1)
  })

  it('trades odometry drift against compass noise', () => {
    const d = (v: number) => v / DEG
    const mid = compRun(2, 0.005, 8 * DEG)
    expect(d(mid.err.fused)).toBeLessThan(Math.min(d(mid.err.odo), d(mid.err.mag)))
    expect(compRun(20, 0.02, 8 * DEG).err.fused).toBeGreaterThan(compRun(0.5, 0.02, 8 * DEG).err.fused)
    expect(compRun(20, 0, 8 * DEG).err.fused).toBeLessThan(compRun(0.1, 0, 8 * DEG).err.fused)
  })
})
