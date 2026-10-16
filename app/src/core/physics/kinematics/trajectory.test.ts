import { twoLinkIk } from './ik'
import { cartesianLine, chordTimes, cubicCoeffs, jointLine, jointScale, lineDeviation, peakRates, polyAt, quinticCoeffs, splineVelocities, syncScale, timeScale, unwrapPath, viaAt, viaPath } from './trajectory'

test('cubic and quintic rest-to-rest by hand', () => {
  expect(cubicCoeffs(0, 1, 0, 0, 1)).toEqual([0, 0, 3, -2])
  const c = polyAt([0, 0, 3, -2], 0.5)
  expect(c.p).toBeCloseTo(0.5, 12)
  expect(c.v).toBeCloseTo(1.5, 12)
  expect(polyAt([0, 0, 3, -2], 0).a).toBe(6)
  expect(polyAt([0, 0, 3, -2], 1).a).toBe(-6)
  expect(quinticCoeffs(0, 1, 0, 0, 0, 0, 1).map((x) => +x.toFixed(12))).toEqual([0, 0, 0, 10, -15, 6])
  const q = [0, 0, 0, 10, -15, 6]
  expect(polyAt(q, 0.5).v).toBeCloseTo(1.875, 12)
  expect(polyAt(q, 0).a).toBe(0)
  expect(polyAt(q, 1).a).toBeCloseTo(0, 9)
  expect(polyAt(q, (3 - Math.sqrt(3)) / 6).a).toBeCloseTo(10 / Math.sqrt(3), 9)
})

test('polynomials meet arbitrary boundary conditions', () => {
  expect(cubicCoeffs(0, 1, 1, 1, 1).map((x) => +x.toFixed(12))).toEqual([0, 1, 0, 0])
  const c = cubicCoeffs(2, -1, 0.5, -3, 2)
  expect(polyAt(c, 2).p).toBeCloseTo(-1, 12)
  expect(polyAt(c, 2).v).toBeCloseTo(-3, 12)
  const q = quinticCoeffs(1, 4, 2, -1, 0.5, -2, 3)
  const e = polyAt(q, 3)
  expect([e.p, e.v, e.a].map((x) => +x.toFixed(9))).toEqual([4, -1, -2])
  expect(polyAt(q, 0).a).toBeCloseTo(0.5, 12)
})

test('joint line bows the hand; Cartesian line stays straight', () => {
  const l: [number, number] = [1, 1]
  const j = jointLine(l, [0, 0], [Math.PI / 2, 0], 200)
  // straight arm swings on a radius-2 arc: midpoint 2 − √2 off the chord
  expect(lineDeviation(j.map((s) => s.tip), [2, 0], [0, 2])).toBeCloseTo(2 - Math.SQRT2, 4)
  const c = cartesianLine(l, [1.5, 0.2], [0.2, 1.5], 50)
  expect(c.every((s) => s.onLine)).toBe(true)
  expect(lineDeviation(c.map((s) => s.tip), [1.5, 0.2], [0.2, 1.5])).toBeLessThan(1e-9)
  const ends = twoLinkIk(1, 1, 1.5, 0.2).up
  expect(c[0].q[0]).toBeCloseTo(ends[0], 12)
})

test('Cartesian line through the base hole is clamped and spins the shoulder', () => {
  const l: [number, number] = [1, 0.5]
  const c = cartesianLine(l, [1, -0.2], [-1, -0.1], 200)
  expect(c.some((s) => !s.onLine)).toBe(true)
  const qs = unwrapPath(c.map((s) => s.q))
  const j = jointLine(l, qs[0], qs[qs.length - 1], 200).map((s) => s.q)
  expect(peakRates(qs)[0]).toBeGreaterThan(5 * peakRates(j)[0])
})

test('unwrap removes 2π jumps', () => {
  expect(unwrapPath([[3], [-3], [-2.5]]).map((q) => +q[0].toFixed(6))).toEqual([3, +(2 * Math.PI - 3).toFixed(6), +(2 * Math.PI - 2.5).toFixed(6)])
})

test('via paths: corners, stops and a C2 spline', () => {
  expect(chordTimes([[0, 0], [3, 4], [3, 9]], 2)).toEqual([0, 1, 2])
  // rest ends, knots 0, 1, 2 at t = 0, 1, 2: 4·v1 = 3·(1 + 1)
  expect(splineVelocities([0, 1, 2], [0, 1, 2])).toEqual([0, 1.5, 0])
  expect(splineVelocities([0, 1, 2], [0, 1, 0])[1]).toBeCloseTo(0, 12)
  const times = [0, 1, 2.5, 3]
  const pts = [[0, 0], [1, 2], [3, 1], [4, 0]]
  const sp = viaPath('spline', times, pts)
  for (const [k, t] of [[1, 1], [2, 2.5]]) {
    const L = viaAt(sp, t - 1e-7)
    const R = viaAt(sp, t + 1e-7)
    expect(L.p[0]).toBeCloseTo(pts[k][0], 5)
    expect(R.v[1]).toBeCloseTo(L.v[1], 5)
    expect(R.a[0]).toBeCloseTo(L.a[0], 4)
  }
  expect(viaAt(sp, 3).v.map((x) => +x.toFixed(9))).toEqual([0, 0])
  const st = viaPath('stop', times, pts)
  expect(viaAt(st, 1).v.map((x) => +x.toFixed(9))).toEqual([0, 0])
  const li = viaPath('linear', times, pts)
  expect(viaAt(li, 0.5).v).toEqual([1, 2])
  expect(viaAt(li, 0.5).p).toEqual([0.5, 1])
})

test('time scaling: shortest time under the limits', () => {
  expect(timeScale('linear', 2, 1).T).toBe(0.5)
  expect(timeScale('cubic', 1.5, 1e9).T).toBeCloseTo(1, 9)
  expect(timeScale('cubic', 1e9, 6).T).toBeCloseTo(1, 4)
  expect(timeScale('quintic', 1.875, 1e9).T).toBeCloseTo(1, 9)
  const tr = timeScale('trapezoid', 1, 4)
  expect(tr.T).toBeCloseTo(1.25, 12)
  expect(tr.at(0.6).sd).toBeCloseTo(1, 12)
  expect(tr.at(tr.T).s).toBe(1)
  const sc = timeScale('scurve', 1, 4, 40)
  expect(sc.T).toBeGreaterThan(tr.T)
  for (const k of ['cubic', 'quintic', 'trapezoid', 'scurve'] as const) {
    const s = timeScale(k, 0.8, 3, 30)
    const peak = Array.from({ length: 401 }, (_, i) => s.at((i / 400) * s.T))
    expect(Math.max(...peak.map((x) => x.sd))).toBeLessThanOrEqual(0.8 + 1e-9)
    expect(Math.max(...peak.map((x) => Math.abs(x.sdd)))).toBeLessThanOrEqual(3 + 1e-9)
    expect(s.at(s.T / 2).s).toBeCloseTo(0.5, 6)
  }
})

test('synchronised joints share one s(t); the longest move sets the pace', () => {
  const dq = [1, -0.5, 0]
  const { scale, slowest } = syncScale('trapezoid', dq, [1, 1, 1], [4, 4, 4])
  expect(slowest.v).toBe(0)
  expect(scale.T).toBeCloseTo(1.25, 12)
  // joint 2 alone: d/v + v/a = 0.5 + 0.25
  expect(jointScale('trapezoid', -0.5, 1, 4).T).toBeCloseTo(0.75, 12)
  expect(jointScale('trapezoid', 0.2, 1, 4).T).toBeCloseTo(2 * Math.sqrt(0.2 / 4), 12)
  expect(jointScale('cubic', 0, 1, 1).T).toBe(0)
  const tight = syncScale('cubic', [1, 0.2], [1, 0.1], [10, 10])
  expect(tight.slowest.v).toBe(1)
  expect(tight.scale.T).toBeCloseTo(1.5 / 0.5, 9)
})
