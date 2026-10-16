import { DEG } from '../common'
import { SERVO_ARM, planarArm, planarFk } from './chain'
import { cellMeasure, dexterity, dexterityGrid, dexterousBand, headingReach, headingSet, jointGrid, planarPoseAt, reachCloud, twoLinkRadii } from './workspace'

const FREE: [number, number][] = [
  [-Math.PI, Math.PI],
  [-Math.PI, Math.PI],
  [-Math.PI, Math.PI],
]

test('joint grid: every combination, ends included', () => {
  const g = jointGrid([[0, 1], [-2, 2], [5, 9]], [2, 3, 1])
  expect(g.length).toBe(6)
  expect(g[0]).toEqual([0, -2, 5])
  expect(g[5]).toEqual([1, 2, 5])
  expect(jointGrid([[0, 1], [0, 2]], [2, 3], true)).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0]])
})

test('two-link reach ring by hand', () => {
  expect(twoLinkRadii(0.3, 0.2, Math.PI)).toEqual({ inner: expect.closeTo(0.1, 12), outer: 0.5 })
  // L1 = L2 = 1, elbow ±90°: inner = √2
  expect(twoLinkRadii(1, 1, Math.PI / 2).inner).toBeCloseTo(Math.SQRT2, 12)
  expect(twoLinkRadii(1, 1, 0).inner).toBeCloseTo(2, 12)
})

test('full two-link cloud fills the annulus π(R² − r²)', () => {
  const arm = planarArm([0.3, 0.2])
  const pts = reachCloud(arm, [360, 360])
  const r = pts.map((s) => Math.hypot(s.p[0], s.p[1]))
  expect(r.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(0.1 - 1e-6)
  expect(r.reduce((a, b) => Math.max(a, b))).toBeLessThan(0.5 + 1e-9)
  const area = cellMeasure(pts.map((s) => [s.p[0], s.p[1]]), 0.01)
  expect(area / (Math.PI * (0.25 - 0.01))).toBeGreaterThan(0.97)
  expect(area / (Math.PI * (0.25 - 0.01))).toBeLessThan(1.08)
})

test('limit cut: shoulder 0…90°, elbow locked straight = a quarter arc', () => {
  const arm = { ...planarArm([0.3, 0.2]), limits: [[0, Math.PI / 2], [0, 0]] as [number, number][] }
  const pts = reachCloud(arm, [10, 5])
  pts.forEach((s) => {
    expect(Math.hypot(s.p[0], s.p[1])).toBeCloseTo(0.5, 12)
    expect(s.p[0]).toBeGreaterThan(-1e-12)
    expect(s.p[1]).toBeGreaterThan(-1e-12)
  })
  // elbow ±90°, shoulder free: hole radius √(0.13)
  const hole = reachCloud({ ...planarArm([0.3, 0.2]), limits: [[-Math.PI, Math.PI], [-Math.PI / 2, Math.PI / 2]] }, [90, 31])
  expect(Math.min(...hole.map((s) => Math.hypot(s.p[0], s.p[1])))).toBeCloseTo(Math.sqrt(0.13), 9)
})

test('table cut keeps the upper half; servo arm stays within its reach', () => {
  const arm = planarArm([0.3, 0.2])
  const all = reachCloud(arm, [72, 36])
  const above = reachCloud(arm, [72, 36], { keep: (f) => f.slice(1).every((m) => m[7] >= -1e-9) })
  above.forEach((s) => expect(s.p[1]).toBeGreaterThan(-1e-9))
  expect(above.length).toBeLessThan(all.length / 2)
  const servo = reachCloud(SERVO_ARM, [7, 7, 7, 1])
  expect(servo.length).toBe(343)
  servo.forEach((s) => expect(Math.hypot(s.p[0], s.p[1], s.p[2] - 0.08)).toBeLessThan(0.31 + 1e-9))
})

test('pose for a heading lands on the target with that heading', () => {
  const l: [number, number, number] = [0.3, 0.2, 0.05]
  const q = planarPoseAt(l, FREE, 0.25, 0.1, -60 * DEG)!
  const { points, phi } = planarFk(l, q)
  expect(points[3][0]).toBeCloseTo(0.25, 9)
  expect(points[3][1]).toBeCloseTo(0.1, 9)
  expect(Math.cos(phi - -60 * DEG)).toBeCloseTo(1, 9)
  expect(planarPoseAt(l, FREE, 0.6, 0, 0)).toBeNull()
  // wrist locked at 0: only the heading along the arm line works at full stretch
  expect(planarPoseAt(l, [FREE[0], FREE[1], [0, 0]], 0.55, 0, 0)).not.toBeNull()
  expect(planarPoseAt(l, [FREE[0], FREE[1], [0, 0]], 0.55, 0, 0.3)).toBeNull()
})

test('dexterous band matches the unlimited arm by hand', () => {
  const l: [number, number, number] = [0.3, 0.2, 0.05]
  const b = dexterousBand(...l)
  expect(b.inner).toBeCloseTo(0.15, 12)
  expect(b.outer).toBeCloseTo(0.45, 12)
  expect(b.disc).toBe(0)
  const hs = headingSet(36)
  expect(dexterity(headingReach(l, FREE, 0.3, 0, hs))).toBe(1)
  expect(dexterity(headingReach(l, FREE, 0, 0.44, hs))).toBe(1)
  const edge = dexterity(headingReach(l, FREE, 0.48, 0, hs))
  expect(edge).toBeGreaterThan(0)
  expect(edge).toBeLessThan(1)
  expect(dexterity(headingReach(l, FREE, 0.12, 0, hs))).toBeLessThan(1)
  expect(dexterousBand(0.2, 0.2, 0.1).disc).toBeCloseTo(0.1, 12)
  expect(dexterousBand(0.2, 0.1, 0.2).empty).toBe(true)
})

test('dexterity grid: wrist limits shrink the dexterous region', () => {
  const l: [number, number, number] = [0.3, 0.2, 0.05]
  const hs = headingSet(24)
  const free = dexterityGrid(l, FREE, 0.55, 0.05, hs)
  const tight = dexterityGrid(l, [FREE[0], FREE[1], [-45 * DEG, 45 * DEG]], 0.55, 0.05, hs)
  const full = (g: typeof free) => g.filter((c) => c.d === 1).length
  expect(full(free)).toBeGreaterThan(0)
  expect(full(tight)).toBe(0)
  expect(tight.length).toBeGreaterThan(0)
  expect(headingSet(3, 0, Math.PI)).toEqual([0, Math.PI / 2, Math.PI])
})
