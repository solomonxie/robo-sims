import { rayDir, walledRoom } from '../room'
import {
  RPLIDAR_A1,
  angularRes,
  beamGap,
  beamsAcross,
  cloudScan,
  clusterBoxes,
  clusterPoints,
  layerElevs,
  lidarRay,
  lidarReach,
  pointsPerRev,
  scanRev,
  seamShift,
  seenChance,
} from './lidar'

const deg = (d: number) => (d * Math.PI) / 180

describe('2D lidar scan', () => {
  it('samples per revolution and angular resolution trade off with spin rate', () => {
    expect(pointsPerRev(8000, 5.5)).toBe(1454)
    expect(angularRes(8000, 5.5)).toBeCloseTo(0.2475, 3)
    expect(angularRes(8000, 10)).toBeCloseTo(2 * angularRes(8000, 5))
  })

  it('a parked robot sees the walls where they are; a moving one smears them', () => {
    const room = walledRoom(4, 4, 1, [])
    const still = scanRev(room, () => ({ x: 2, y: 2, th: 0 }), 0, 5, 2000, 0.2)
    expect(still).toHaveLength(400)
    expect(still[0].m).toBeCloseTo(2)
    expect(still[100].a).toBeCloseTo(Math.PI / 2)
    expect(still[100].raw![1]).toBeCloseTo(0)
    const v = 1
    const moving = scanRev(room, (t) => ({ x: 1 + v * t, y: 2, th: 0 }), 0, 5, 2000, 0.2)
    const last = moving[moving.length - 1]
    expect(last.world![0]).toBeCloseTo(4, 5)
    expect(4 - last.raw![0]).toBeCloseTo(seamShift(v, 5), 2)
  })

  it('beams spread apart with range; thin targets fall between them', () => {
    expect(beamGap(1, 1)).toBeCloseTo(0.01745, 4)
    expect(seenChance(0.025, 1, 1)).toBe(1)
    expect(seenChance(0.025, 8, 1)).toBeCloseTo(0.025 / beamGap(8, 1))
    const across = beamsAcross(0.02, 5, 1, 0, 3)
    expect(across).toHaveLength(7)
    expect(across.some((b) => b.hit)).toBe(false)
    expect(beamsAcross(0.02, 5, 1, 0.5, 3)[3]).toEqual({ off: 0, hit: true })
  })
})

describe('surfaces', () => {
  const panel = (optic: 'diffuse' | 'glass' | 'mirror', refl: number) =>
    walledRoom(10, 4, 1, [{ kind: 'box', name: 'panel', x: [4, 4.05], y: [0.5, 3.5], h: 1, refl, optic }])

  it('reach ∝ √ρ, capped at the rated range', () => {
    expect(lidarReach(0.7)).toBe(RPLIDAR_A1.maxM)
    expect(lidarReach(0.9)).toBe(RPLIDAR_A1.maxM)
    expect(lidarReach(0.05)).toBeCloseTo(12 * Math.sqrt(0.05 / 0.7))
  })

  it('black drops out far away, white does not', () => {
    const o: [number, number, number] = [0.5, 2, 0.2]
    expect(lidarRay(panel('diffuse', 0.8), o, rayDir(0)).m).toBeCloseTo(3.5)
    expect(lidarRay(panel('diffuse', 0.05), [3, 2, 0.2], rayDir(0)).m).toBeCloseTo(1)
    expect(lidarRay(panel('diffuse', 0.05), o, rayDir(0)).m).toBeNull()
    expect(lidarRay(panel('diffuse', 0.8), o, rayDir(deg(30))).m).not.toBeNull()
  })

  it('glass: seen square-on, else the beam passes through', () => {
    const room = panel('glass', 0.05)
    expect(lidarRay(room, [0.5, 2, 0.2], rayDir(0)).m).toBeCloseTo(3.5)
    const slant = lidarRay(room, [0.5, 2, 0.2], rayDir(deg(15)))
    expect(slant.through).toBe(true)
    expect(slant.what).toBe('wall')
    expect(slant.path[2][0]).toBeGreaterThan(4.05)
  })

  it('mirror: off-axis beams bounce and the point lands behind the glass', () => {
    const R = lidarRay(panel('mirror', 0.05), [2, 2, 0.2], rayDir(deg(20)))
    expect(R.phantom).toBe(true)
    expect(R.path).toHaveLength(3)
    expect(R.m! * Math.cos(deg(20))).toBeGreaterThan(4)
  })
})

describe('multi-layer point cloud', () => {
  const room = walledRoom(6, 6, 2, [{ kind: 'box', name: 'crate', x: [4, 4.4], y: [2.8, 3.2], h: 0.6, refl: 0.5 }])

  it('lasers fan evenly over the field of view', () => {
    expect(layerElevs(16)).toHaveLength(16)
    expect(layerElevs(16)[0]).toBe(-15)
    expect(layerElevs(16)[15]).toBe(15)
    expect(layerElevs(1)).toEqual([0])
  })

  it('down-tilted lasers ring the floor; clusters split walls from an obstacle', () => {
    const pts = cloudScan(room, [3, 3, 0.5], layerElevs(16), 120)
    expect(pts.some((p) => p.ground)).toBe(true)
    const solid = pts.filter((p) => !p.ground)
    const P = solid.map((p) => p.p)
    const labels = clusterPoints(P, 0.35)
    const boxes = clusterBoxes(P, labels)
    const crate = boxes.filter((b) => b.kind === 'obstacle' && b.lo[0] > 3.8 && b.hi[0] < 4.5)
    expect(crate).toHaveLength(1)
    expect(boxes.some((b) => b.kind === 'wall')).toBe(true)
  })

  it('clustering: near points join, far ones split, singletons are noise', () => {
    const labels = clusterPoints(
      [
        [0, 0, 0],
        [0.1, 0, 0],
        [0.2, 0, 0],
        [2, 0, 0],
        [2.1, 0, 0],
        [2.2, 0, 0],
        [5, 5, 5],
      ],
      0.15,
    )
    expect(labels).toEqual([0, 0, 0, 1, 1, 1, -1])
  })
})
