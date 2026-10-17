import { medianMs } from '../../stopwatch'
import { ANCHORS, AnchorKey, LOCKS, LockKey, METRIC_SCREWS, M3_PROOF_N, ScrewKey, anchorCurves, anchorPullout, caliperReading, ironInstall, loosenRun, preloadOf, screwFor, sizeFromCaliper, torqueFor } from './fasteners'

const sizes = Object.keys(METRIC_SCREWS) as ScrewKey[]

describe('metric sizes', () => {
  it('clearance hole > d > tap drill, tap ≈ d − pitch', () => {
    for (const k of sizes) {
      const s = METRIC_SCREWS[k]
      expect(s.clear).toBeGreaterThan(s.d)
      expect(s.tap).toBeLessThan(s.d)
      expect(s.tap).toBeCloseTo(s.d - s.pitch, 1)
    }
  })
  it('picks the shortest stock length that leaves enough thread', () => {
    const nut = screwFor('m3', 'cap', 'nut', 6)
    expect(nut.length).toBe(10)
    expect(nut.past).toBeGreaterThanOrEqual(2 * 0.5 - 1e-9)
    const pla = screwFor('m3', 'cap', 'plastic', 6)
    expect(pla.length).toBe(12)
    expect(pla.engaged).toBeGreaterThanOrEqual(6)
    expect(screwFor('m3', 'csk', 'plastic', 6).length).toBe(12)
    expect(screwFor('m5', 'cap', 'plastic', 40).length).toBeNull()
  })
  it('reads a screw on a caliper and names its size', () => {
    for (const k of sizes) {
      const r = caliperReading(k)
      expect(r).toBeLessThan(METRIC_SCREWS[k].d)
      expect(sizeFromCaliper(r)).toBe(k)
    }
  })
})

describe('anchors in PLA', () => {
  it('captive nut > insert > screw into plastic with full walls', () => {
    const f = (k: AnchorKey) => anchorPullout(k, 3).force
    expect(f('nut')).toBeGreaterThan(f('insert'))
    expect(f('insert')).toBeGreaterThan(f('screw'))
    expect(f('screw')).toBeGreaterThan(300)
    expect(f('insert')).toBeLessThan(2000)
  })
  it('thin walls and re-use weaken; a cold iron leaves the knurls empty', () => {
    expect(anchorPullout('insert', 1).force).toBeLessThan(anchorPullout('insert', 2.3).force)
    expect(anchorPullout('insert', 1).mode).toMatch(/splits/)
    expect(anchorPullout('screw', 3, 220, 5).force).toBeLessThan(anchorPullout('screw', 3).force)
    expect(anchorPullout('insert', 3, 220, 5).force).toBeCloseTo(anchorPullout('insert', 3).force)
    expect(ironInstall(150).ok).toBe(false)
    expect(ironInstall(220).fill).toBe(1)
    expect(ironInstall(280).fill).toBeLessThan(1)
    expect(anchorCurves(4, 220)).toHaveLength(Object.keys(ANCHORS).length)
  })
})

describe('preload and loosening', () => {
  it('T = K·F·d round trip; recommended M3 torque stays under proof', () => {
    expect(preloadOf(1.2)).toBeCloseTo(2000)
    expect(torqueFor(preloadOf(0.7))).toBeCloseTo(0.7)
    expect(preloadOf(1.2)).toBeLessThan(M3_PROOF_N)
  })
  it('a snug screw holds; a loose one backs off; locker holds; nyloc keeps the nut on', () => {
    expect(loosenRun(1.2, 8, 'none').slipAt).toBeNull()
    const loose = loosenRun(0.3, 8, 'none')
    expect(loose.end).toBe(0)
    expect(loose.fellOff).toBe(true)
    expect(loosenRun(0.3, 8, 'blue').end).toBeGreaterThan(0.9 * loose.F0)
    const ny = loosenRun(0.3, 8, 'nyloc')
    expect(ny.fellOff).toBe(false)
    expect(loosenRun(0.3, 8, 'washer').end).toBeLessThanOrEqual(loosenRun(0.3, 8, 'blue').end)
  })
  it('recomputes every lock well under 100 ms', () => {
    const ms = medianMs(() => (Object.keys(LOCKS) as LockKey[]).forEach((k) => loosenRun(0.4, 10, k)))
    expect(ms).toBeLessThan(100)
  })
})
