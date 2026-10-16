import { XY } from '../software/costmap'
import { nearestWithin } from './localization'
import { PgEdge, chi2, densify, findClosures, keyframeMap, poseBetween, poseCompose, poseDist, poseGraphSolve, slamDrive, slamGraph } from './slam'

const edge = (i: number, j: number, x: number, y = 0, th = 0, loop = false): PgEdge => ({ i, j, z: { x, y, th }, wXY: 1, wTh: 1, loop })

describe('pose algebra', () => {
  it('compose undoes between', () => {
    const a = { x: 1, y: 2, th: 0.7 }
    const b = { x: -0.5, y: 0.3, th: -2.9 }
    const c = poseCompose(a, poseBetween(a, b))
    expect(c.x).toBeCloseTo(b.x)
    expect(c.y).toBeCloseTo(b.y)
    expect(c.th).toBeCloseTo(b.th)
    expect(poseBetween({ x: 0, y: 0, th: Math.PI / 2 }, { x: 0, y: 1, th: Math.PI / 2 }).x).toBeCloseTo(1)
  })
  it('densify fills short gaps only', () => {
    const d = densify([[0, 0], [0.1, 0], [1, 0]], 0.025, 0.2)
    expect(d.filter((p) => p[0] > 0 && p[0] < 0.1)).toHaveLength(3)
    expect(d.filter((p) => p[0] > 0.1 && p[0] < 1)).toHaveLength(0)
  })
  it('bucket nearest matches brute force within the radius', () => {
    const pts: XY[] = Array.from({ length: 200 }, (_, k) => [Math.sin(k * 12.9898) * 2, Math.cos(k * 78.233) * 2])
    const near = nearestWithin(pts, 0.3)
    for (const [x, y] of [[0.1, 0.2], [-1.3, 0.8], [1.9, -1.7]]) {
      const d = pts.map((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2)
      const m = Math.min(...d)
      const [k, best] = near(x, y)
      if (m <= 0.09) expect([k, best]).toEqual([d.indexOf(m), m])
    }
  })
})

describe('pose graph', () => {
  it('1-D chain with a loop edge solves exactly in one step', () => {
    const x0 = [0, 1, 2].map((x) => ({ x, y: 0, th: 0 }))
    const r = poseGraphSolve(x0, [edge(0, 1, 1), edge(1, 2, 1), edge(0, 2, 2.3, 0, 0, true)], 1)
    const [p0, p1, p2] = r.poses[1]
    expect(p0.x).toBeCloseTo(0, 6)
    expect(p1.x).toBeCloseTo(1.1, 6)
    expect(p2.x).toBeCloseTo(2.2, 6)
    expect(r.costs[1]).toBeCloseTo(3 * 0.1 ** 2, 6)
  })
  it('square with biased odometry snaps closed after one loop closure', () => {
    const truth = [[0, 0, 0], [1, 0, Math.PI / 2], [1, 1, Math.PI], [0, 1, -Math.PI / 2], [0, 0, 0]].map(([x, y, th]) => ({ x, y, th }))
    const odo = [0, 1, 2, 3].map((k) => ({ ...poseBetween(truth[k], truth[k + 1]), th: poseBetween(truth[k], truth[k + 1]).th + 0.08 }))
    const x0 = [truth[0]]
    odo.forEach((d) => x0.push(poseCompose(x0[x0.length - 1], d)))
    const edges = odo.map((d, k): PgEdge => ({ i: k, j: k + 1, z: d, wXY: 100, wTh: 100, loop: false }))
    edges.push({ i: 0, j: 4, z: { x: 0, y: 0, th: 0 }, wXY: 100, wTh: 100, loop: true })
    const err = (xs: typeof x0) => Math.max(...xs.map((p, k) => poseDist(p, truth[k])))
    const r = poseGraphSolve(x0, edges, 5)
    const last = r.poses[5]
    expect(err(x0)).toBeGreaterThan(0.15)
    expect(err(last)).toBeLessThan(err(x0) / 3)
    expect(poseDist(last[4], last[0])).toBeLessThan(0.02)
    expect(r.costs[5]).toBeLessThan(r.costs[0] / 5)
    expect(chi2(last, edges)).toBeCloseTo(r.costs[5])
  })
})

describe('SLAM run', () => {
  const kfs = slamDrive(0.06, 1)
  const est = kfs.map((k) => k.icp)
  const end = kfs[kfs.length - 1]
  it('lidar odometry drifts less than biased wheel odometry', () => {
    expect(poseDist(end.icp, end.truth)).toBeLessThan(poseDist(end.wheel, end.truth) / 1.5)
    expect(poseDist(end.icp, end.truth)).toBeGreaterThan(0.05)
  })
  it('revisiting the start yields accepted loop closures, and the graph pulls every keyframe in', () => {
    const cl = findClosures(kfs, est, 0.6, 0.03)
    expect(cl.some((c) => c.accepted && c.j <= 1)).toBe(true)
    expect(findClosures(kfs, est, 0.05, 0.03)).toHaveLength(0)
    const r = poseGraphSolve(est, slamGraph(est, cl, 1), 5)
    const errOf = (xs: readonly { x: number; y: number }[]) => Math.max(...xs.map((p, k) => Math.hypot(p.x - kfs[k].truth.x, p.y - kfs[k].truth.y)))
    expect(errOf(r.poses[5])).toBeLessThan(errOf(est) / 3)
  })
  it('keyframe map has walls', () => {
    const g = keyframeMap(kfs, kfs.map((k) => k.truth))
    expect(Array.from(g.lo).filter((l) => l > 1).length).toBeGreaterThan(100)
  })
})
