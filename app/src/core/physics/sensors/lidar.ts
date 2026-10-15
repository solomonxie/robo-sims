import { Optic, P3, RobotPose, Room, RoomSolid, castRoom, rayDir, toRoom } from '../room'

// --- Spinning laser rangefinders: one ToF ranger on a turntable. ---

/** RPLIDAR A1: 785 nm laser triangulation, 0.15–12 m (70 % white), 2–10 Hz, 8 k samples/s in boost mode. */
export const RPLIDAR_A1 = { nm: 785, minM: 0.15, maxM: 12, refRefl: 0.7, hz: 5.5, sampleHz: 8000, baud: 115200 }
/** Velodyne VLP-16: 16 lasers over ±15°, 0.2° steps at 10 Hz, 100 m. */
export const VLP16 = { channels: 16, fovDeg: 30, hz: 10, resDeg: 0.2, minM: 0.5, maxM: 100, refRefl: 0.1 }
export type RangerSpec = { minM: number; maxM: number; refRefl: number }

export const pointsPerRev = (sampleHz: number, scanHz: number) => Math.floor(sampleHz / scanHz)
/** Degrees between neighbouring samples. */
export const angularRes = (sampleHz: number, scanHz: number) => (360 * scanHz) / sampleHz
/** Gap between neighbouring beams at range `m`. */
export const beamGap = (m: number, resDeg: number) => (m * resDeg * Math.PI) / 180
/** Chance one scan lands a beam on a target `w` wide at `m`. */
export const seenChance = (w: number, m: number, resDeg: number) => Math.min(1, w / beamGap(m, resDeg))
/** Return ∝ ρ / d², so the reach scales with √ρ, capped at the rated range. */
export const lidarReach = (refl: number, spec: RangerSpec = RPLIDAR_A1) => Math.min(spec.maxM, spec.maxM * Math.sqrt(Math.max(0, refl) / spec.refRefl))
/** Driving at `v` m/s, the robot moves this far during one revolution: the seam where the scan starts and ends. */
export const seamShift = (v: number, scanHz: number) => v / scanHz
export const turnSkewDeg = (degPerS: number, scanHz: number) => degPerS / scanHz
/** Within this many degrees of square-on, glass and mirrors bounce the beam straight back. */
export const SPECULAR_DEG = 6
/** Sample angles drift from one revolution to the next (the motor isn't locked to the sampler). */
export const scanPhase = (rev: number) => (rev * 0.618034) % 1

export interface LidarReturn {
  /** Range the sensor reports, or null (no return). */
  m: number | null
  /** Beam path, sensor first. */
  path: P3[]
  what: string | null
  optic: Optic | null
  intensity: number
  /** Bounced off a mirror: the point lands behind it. */
  phantom: boolean
  /** Went through glass first. */
  through: boolean
}

/** One laser shot: glass passes it, a mirror bounces it (unless square-on), diffuse surfaces return ρ·cos(incidence). */
export function lidarRay(room: Room, o: P3, d: P3, spec: RangerSpec = RPLIDAR_A1): LidarReturn {
  const path: P3[] = [o]
  let from = o
  let dir = d
  let travelled = 0
  let skip: RoomSolid | undefined
  let phantom = false
  let through = false
  for (let bounce = 0; bounce < 4; bounce++) {
    const h = castRoom(room, from, dir, spec.maxM - travelled, skip)
    if (!h) {
      const rest = spec.maxM - travelled
      path.push([from[0] + dir[0] * rest, from[1] + dir[1] * rest, from[2] + dir[2] * rest])
      return { m: null, path, what: null, optic: null, intensity: 0, phantom, through }
    }
    path.push(h.p)
    travelled += h.m
    const dn = dir[0] * h.n[0] + dir[1] * h.n[1] + dir[2] * h.n[2]
    const cos = Math.abs(dn)
    const optic = h.solid?.optic ?? 'diffuse'
    const specular = cos >= Math.cos((SPECULAR_DEG * Math.PI) / 180)
    if (optic !== 'diffuse' && !specular) {
      if (optic === 'glass') through = true
      else {
        phantom = true
        dir = [dir[0] - 2 * dn * h.n[0], dir[1] - 2 * dn * h.n[1], dir[2] - 2 * dn * h.n[2]]
      }
      from = h.p
      skip = h.solid ?? undefined
      continue
    }
    const intensity = optic === 'diffuse' ? (h.solid?.refl ?? 0.3) * cos : 1
    const ok = travelled >= spec.minM && travelled <= lidarReach(intensity, spec)
    return { m: ok ? travelled : null, path, what: h.solid?.name ?? 'floor', optic, intensity, phantom, through }
  }
  return { m: null, path, what: null, optic: null, intensity: 0, phantom, through }
}

export interface ScanPoint {
  /** Sample angle, rad, clockwise from straight ahead (as the A1 reports it). */
  a: number
  m: number | null
  /** Where the point really is, and where it lands if the whole scan is placed at the start pose. */
  world: [number, number] | null
  raw: [number, number] | null
  phantom: boolean
}

/** One revolution from `t0`, every `stride`-th sample, angles offset by `phase` samples; the robot may move meanwhile (`poseAt`). Head `z` m up. */
export function scanRev(room: Room, poseAt: (t: number) => RobotPose, t0: number, scanHz: number, sampleHz: number, z: number, stride = 1, phase = 0): ScanPoint[] {
  const N = pointsPerRev(sampleHz, scanHz)
  const start = poseAt(t0)
  const out: ScanPoint[] = []
  for (let i = 0; i < N; i += stride) {
    const a = (2 * Math.PI * (i + phase)) / N
    const pose = poseAt(t0 + i / sampleHz)
    const R = lidarRay(room, [pose.x, pose.y, z], rayDir(pose.th - a))
    const lx = R.m === null ? 0 : R.m * Math.cos(a)
    const ly = R.m === null ? 0 : -R.m * Math.sin(a)
    out.push({ a, m: R.m, world: R.m === null ? null : toRoom(pose, lx, ly), raw: R.m === null ? null : toRoom(start, lx, ly), phantom: R.phantom })
  }
  return out
}

/** Beams crossing a target `w` wide at range `m`: lateral offsets (m) of the nearest `2k+1` beams and which ones hit. */
export function beamsAcross(w: number, m: number, resDeg: number, phase: number, k = 3) {
  const gap = beamGap(m, resDeg)
  return Array.from({ length: 2 * k + 1 }, (_, i) => {
    const off = (i - k + phase - 0.5) * gap
    return { off, hit: Math.abs(off) <= w / 2 }
  })
}

// --- Multi-layer lidar: a stack of lasers at fixed elevations, spun together. ---

/** Elevation of each laser, degrees, bottom first. */
export const layerElevs = (channels: number, fovDeg = VLP16.fovDeg) =>
  channels === 1 ? [0] : Array.from({ length: channels }, (_, i) => -fovDeg / 2 + (i * fovDeg) / (channels - 1))

export interface CloudPoint {
  p: P3
  intensity: number
  what: string
  ground: boolean
  layer: number
}

/** Every laser at `azSteps` azimuths around the head at `o`. */
export function cloudScan(room: Room, o: P3, elevsDeg: number[], azSteps: number, spec: RangerSpec = VLP16): CloudPoint[] {
  const out: CloudPoint[] = []
  for (let j = 0; j < azSteps; j++)
    elevsDeg.forEach((e, layer) => {
      const d = rayDir((2 * Math.PI * j) / azSteps, (e * Math.PI) / 180)
      const R = lidarRay(room, o, d, spec)
      if (R.m === null) return
      const p: P3 = [o[0] + d[0] * R.m, o[1] + d[1] * R.m, o[2] + d[2] * R.m]
      out.push({ p, intensity: R.intensity, what: R.what ?? '', ground: p[2] < 0.05, layer })
    })
  return out
}

/** Euclidean clustering: points within `eps` of each other share a label; clusters under `minPts` get −1. */
export function clusterPoints(pts: P3[], eps: number, minPts = 3) {
  const key = (p: P3) => p.map((c) => Math.floor(c / eps)).join(',')
  const grid = new Map<string, number[]>()
  pts.forEach((p, i) => grid.set(key(p), [...(grid.get(key(p)) ?? []), i]))
  const labels = new Array<number>(pts.length).fill(-2)
  let next = 0
  for (let s = 0; s < pts.length; s++) {
    if (labels[s] !== -2) continue
    const members = [s]
    labels[s] = next
    for (let q = 0; q < members.length; q++) {
      const p = pts[members[q]]
      const c = p.map((v) => Math.floor(v / eps))
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const j of grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
              if (labels[j] !== -2) continue
              if (Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1], pts[j][2] - p[2]) > eps) continue
              labels[j] = next
              members.push(j)
            }
    }
    if (members.length < minPts) members.forEach((j) => (labels[j] = -1))
    else next++
  }
  return labels
}

/** Bounding box per cluster label; longer than `wallM` across the floor → a wall, else an obstacle. */
export function clusterBoxes(pts: P3[], labels: number[], wallM = 1.5) {
  const boxes: { lo: P3; hi: P3; n: number; kind: 'wall' | 'obstacle' }[] = []
  pts.forEach((p, i) => {
    const l = labels[i]
    if (l < 0) return
    const b = (boxes[l] ??= { lo: [...p], hi: [...p], n: 0, kind: 'obstacle' })
    for (let a = 0; a < 3; a++) {
      b.lo[a] = Math.min(b.lo[a], p[a])
      b.hi[a] = Math.max(b.hi[a], p[a])
    }
    b.n++
  })
  for (const b of boxes) b.kind = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]) > wallM ? 'wall' : 'obstacle'
  return boxes
}
