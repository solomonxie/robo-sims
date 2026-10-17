import { DEMO_SLIP, FEATURES, clonePolicy, collectRounds, demoLaps, expertCurv, imitationGap, laneScore, laneState, laneFeatures, lineAt, netCurv, peanutTrack, toSamples } from './imitation'

const tr = peanutTrack()

describe('lane track', () => {
  it('closed peanut with left and right bends', () => {
    expect(tr.length).toBeCloseTo(8.19, 1)
    expect(Math.max(...tr.pts.map((p) => p.k))).toBeGreaterThan(1)
    expect(Math.min(...tr.pts.map((p) => p.k))).toBeLessThan(-0.5)
  })
  it('offset is + to the left, heading error wraps', () => {
    const q = tr.pts[10]
    const s = laneState(tr, { x: q.x - 0.05 * Math.sin(q.th), y: q.y + 0.05 * Math.cos(q.th), th: q.th + 0.1 })
    expect(s.d).toBeCloseTo(0.05, 3)
    expect(s.psi).toBeCloseTo(0.1, 3)
    expect(lineAt({ ...s, k: 0, psi: 0 }, 0.1)).toBeCloseTo(-0.05, 3)
  })
  it('camera strip peaks where the line is', () => {
    const f = laneFeatures({ d: 0, psi: 0, k: 0, i: 0 })
    expect(f).toHaveLength(FEATURES)
    expect(f[3]).toBeCloseTo(1)
    expect(f[0]).toBeLessThan(0.01)
  })
})

describe('behaviour cloning', () => {
  const steps = demoLaps(tr, 2, DEMO_SLIP).flatMap((r) => r.steps)
  const net = clonePolicy(toSamples(steps))
  it('the demonstrator survives a slippery floor', () => {
    expect(laneScore(tr, expertCurv, 0.6).done).toBe(1)
  })
  it('fits the demos, works near them, fails when pushed away', () => {
    expect(imitationGap(net, steps)).toBeLessThan(0.1)
    expect(laneScore(tr, (s) => netCurv(net, s), 0.05).done).toBe(1)
    const pushed = laneScore(tr, (s) => netCurv(net, s), 0.45)
    expect(pushed.done).toBe(0)
    expect(imitationGap(net, pushed.runs.flatMap((r) => r.steps))).toBeGreaterThan(5 * imitationGap(net, steps))
  })
})

describe('data collection', () => {
  const done = (how: 'more' | 'noisy' | 'dagger') => collectRounds(tr, how, 4, 0.3).map((r) => laneScore(tr, (s) => netCurv(r.net, s), 0.3).done)
  it('DAgger and noisy demos fix the clone, more clean demos do not', () => {
    const more = done('more')
    expect(more[0]).toBeLessThan(1)
    expect(more.at(-1)).toBeLessThan(1)
    expect(done('dagger').at(-1)).toBe(1)
    expect(done('noisy').at(-1)).toBe(1)
  })
})
