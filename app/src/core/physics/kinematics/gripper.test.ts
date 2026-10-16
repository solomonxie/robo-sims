import { DEG, G } from '../common'
import {
  FINGER, JAWS, angularTouchDeg, fingerClose, fingerForces, fingerPoints, gripWrap, jawForceN, jawHalfGap, jawHoldN, jawTouchDeg, liftAt, requiredSqueezeN, segmentNearest, servoSqueezeNm, squeezesOut,
  suctionForceN, suctionNeedN, suctionRun, vacuumAt, vacuumSteadyKPa, vacuumTauS, wrapHoldN,
} from './gripper'

test('rack jaws: h = h0 − r·θ, F = τ/2r', () => {
  expect(jawHalfGap('rack', 0)).toBe(45)
  expect(jawHalfGap('rack', 90)).toBeCloseTo(45 - 25 * (Math.PI / 2), 9)
  expect(jawForceN('rack', 0.18, 30, 20)).toBeCloseTo(3.6, 9)
  expect(jawTouchDeg('rack', 20)).toBeCloseTo((25 / 25) / DEG, 9)
})

test('parallelogram jaws: cosine gap, force grows toward the toggle', () => {
  expect(jawHalfGap('linkage', 80)).toBeCloseTo(5, 9)
  expect(jawForceN('linkage', 1, 80, 5)).toBeCloseTo(12.5, 9)
  expect(jawForceN('linkage', 1, 20, 5)).toBeCloseTo(25, 9)
  expect(jawHalfGap('linkage', jawTouchDeg('linkage', 30))).toBeCloseTo(30, 9)
})

test('angular finger touches where the face line is R from the ball centre', () => {
  const t = angularTouchDeg(20)
  expect(t.phiDeg).toBeCloseTo(-7.83, 2)
  const phi = t.phiDeg * DEG
  expect(JAWS.angPivotMm * Math.cos(phi) - JAWS.depthMm * Math.sin(phi)).toBeCloseTo(20, 9)
  expect(t.armMm).toBeCloseTo(42.67, 2)
  expect(t.servoDeg).toBeCloseTo(t.phiDeg + 30, 9)
  expect(angularTouchDeg(10).phiDeg).toBeGreaterThan(0)
})

test('servo squeeze ramps over its band then stalls', () => {
  expect(servoSqueezeNm(20, 25, 1, 10)).toBe(0)
  expect(servoSqueezeNm(30, 25, 1, 10)).toBeCloseTo(0.5, 9)
  expect(servoSqueezeNm(60, 25, 1, 10)).toBe(1)
})

test('friction grip: N ≥ s·m(g + a)/2μ; tilted faces cradle or squeeze out', () => {
  expect(requiredSqueezeN(0.2, 0.5, 2)).toBeCloseTo(2 * 0.2 * G, 9)
  expect(requiredSqueezeN(0.1, 0.25, 1, 0.19)).toBeCloseTo(2, 9)
  expect(jawHoldN(10, 0.5)).toBeCloseTo(10, 9)
  expect(jawHoldN(10, 0.5, 30)).toBeCloseTo(20 * (0.5 * Math.cos(30 * DEG) + 0.5), 9)
  expect(jawHoldN(10, 0.3, -20)).toBe(0)
  expect(squeezesOut(0.3, -20)).toBe(true)
  expect(squeezesOut(0.3, -10)).toBe(false)
})

test('suction: F = ΔP·A, pump curve meets the leak', () => {
  expect(suctionForceN(60, 30)).toBeCloseTo((60 * Math.PI * 225) / 1000, 9)
  expect(vacuumSteadyKPa(0)).toBe(65)
  expect(vacuumSteadyKPa(0.8)).toBeCloseTo(65 / (1 + (0.8 * 65) / 83), 9)
  expect(vacuumTauS(0)).toBeCloseTo(60 / (101.3 * (83 / 65)), 9)
  expect(vacuumAt(vacuumTauS(0), 0)).toBeCloseTo(65 * (1 - Math.exp(-1)), 9)
  expect(suctionNeedN(1, 0, 'side')).toBeCloseTo(2 * G, 9)
})

test('cycloidal lift: ends at H, peak a = 2πH/T²', () => {
  expect(liftAt(10).z).toBeCloseTo(90, 9)
  expect(liftAt(1.5 + 0.1).accel).toBeCloseTo((2 * Math.PI * 0.09) / 0.16, 9)
  expect(liftAt(1.5 + 0.3).accel).toBeLessThan(0)
})

test('suction pick: glass holds, heavy part drops at lift-off, side pick needs 1/μ more', () => {
  expect(Number.isNaN(suctionRun({ diaMm: 30, surface: 'glass', massKg: 0.5, dir: 'top' }).dropT)).toBe(true)
  const heavy = suctionRun({ diaMm: 30, surface: 'glass', massKg: 5, dir: 'top' })
  expect(heavy.dropT).toBeCloseTo(1.5, 2)
  expect(heavy.frames[heavy.frames.length - 1].partZ).toBe(0)
  // 3 kg: 29.4 N static < 46 N, but m(g + 3.5) = 40 N at peak: holds from the top, not from the side.
  expect(Number.isNaN(suctionRun({ diaMm: 30, surface: 'glass', massKg: 3, dir: 'top' }).dropT)).toBe(true)
  expect(suctionRun({ diaMm: 30, surface: 'glass', massKg: 3, dir: 'side' }).dropT).toBeCloseTo(1.5, 2)
  const mid = suctionRun({ diaMm: 30, surface: 'glass', massKg: 3.6, dir: 'top' })
  expect(mid.dropT).toBeGreaterThan(1.5)
  expect(mid.dropZ).toBeGreaterThan(0)
})

const allOf = (g: ReturnType<typeof gripWrap>) => [...g.right.contacts, ...g.left.contacts]

test('segment nearest point', () => {
  const s = segmentNearest([0, 0], [10, 0], [4, 3])
  expect(s.dist).toBe(3)
  expect(s.along).toBe(4)
  expect(segmentNearest([0, 0], [10, 0], [13, 4]).dist).toBe(5)
})

test('free finger bends to τ balance: θ1 = T·r1/k1, θ2 = (T·r2 − pre)/k2', () => {
  const s = fingerClose('underactuated', 10, [0, -900], 1)
  expect(s.t1).toBeCloseTo(180 / 150, 6)
  expect(s.t2).toBeCloseTo((60 - 30) / 40, 6)
  expect(s.contacts.length).toBe(0)
  const [, j, tip] = fingerPoints(Math.PI / 2, 0)
  expect(j[0]).toBeCloseTo(FINGER.baseMm - FINGER.l1, 9)
  expect(tip[0]).toBeCloseTo(FINGER.baseMm - FINGER.l1 - FINGER.l2, 9)
})

test('proximal-only contact: F1 = τ1/d1 (distal held straight by its preload)', () => {
  const r = fingerForces('underactuated', 6, 0, 0, [21, -30], 10)
  expect(r.contacts.length).toBe(1)
  expect(r.contacts[0].link).toBe(1)
  expect(r.contacts[0].forceN).toBeCloseTo((6 * 18) / 30, 6)
  expect(r.contacts[0].n[0]).toBeCloseTo(-1, 9)
})

test('distal contact: F2 = τ2/d2', () => {
  // Proximal straight down, distal bent 90° inward along y = −50 from x = 36 to 0; ball 15 mm above (inside the grasp) the point 16 mm along it.
  const r = fingerForces('underactuated', 40, 0, Math.PI / 2, [20, -35], 10)
  expect(r.contacts.length).toBe(1)
  expect(r.contacts[0].link).toBe(2)
  expect(r.contacts[0].forceN).toBeCloseTo((40 * 6 - 30 - 40 * (Math.PI / 2)) / 16, 6)
})

test('underactuated finger wraps the big ball on both links; the rigid claw only pinches', () => {
  const soft = gripWrap('underactuated', 15, 24, 0)
  const rigid = gripWrap('rigid', 15, 24, 0)
  expect(soft.contacts).toBe(4)
  expect(soft.right.contacts.map((k) => k.link)).toEqual([1, 2])
  expect(soft.right.ejects).toBe(false)
  expect(rigid.contacts).toBe(2)
  for (const k of soft.right.contacts) expect(Math.hypot(k.p[0], k.p[1] + soft.depth)).toBeCloseTo(24 + FINGER.halfW, 0)
  expect(wrapHoldN(allOf(soft), 0.5)).toBeGreaterThan(wrapHoldN(allOf(rigid), 0.5))
})

test('big ball, hard pull: the proximal contact would have to pull, so it ejects', () => {
  expect(gripWrap('underactuated', 30, 24, 0).right.ejects).toBe(true)
  expect(gripWrap('underactuated', 5, 24, 0).right.ejects).toBe(false)
})

test('wrap hold: F(n_y + μ|n_x|) per contact', () => {
  const k = (forceN: number, n: [number, number]) => ({ link: 1 as const, p: [0, 0] as [number, number], along: 0, forceN, n })
  expect(wrapHoldN([k(10, [-1, 0]), k(10, [1, 0])], 0.4)).toBeCloseTo(8, 9)
  expect(wrapHoldN([k(10, [-0.6, 0.8])], 0.5)).toBeCloseTo(11, 9)
  expect(wrapHoldN([k(10, [-0.6, -0.8])], 0.5)).toBe(0)
})

test('offset ball: rigid pair shoves it to the middle, underactuated wraps it where it is', () => {
  expect(gripWrap('rigid', 15, 18, 6).shoveMm).toBe(6)
  const s = gripWrap('underactuated', 15, 18, 6)
  expect(s.shoveMm).toBe(0)
  expect(s.right.t1).toBeLessThan(s.left.t1 - 0.1)
})
