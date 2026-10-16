// Occupancy grid: log-odds per cell, inverse sensor models for narrow (lidar) and wide-cone (sonar) beams, Bresenham traversal, and a mapping run with odometry drift.
import { clamp, wrapPi } from '../common'
import { Pose, Room, castRoom, rayDir } from '../room'
import { LETHAL, staticLayer } from '../software/costmap'
import { HCSR04, beamGain } from '../sensors/ultrasonic'

export interface OccGrid {
  ox: number
  oy: number
  res: number
  nx: number
  ny: number
  /** Log-odds per cell, row-major (k = j·nx + i); 0 = unknown (p = 0.5). */
  lo: Float32Array
}
/** Inverse sensor model in log-odds: added on a hit / a pass-through, clamped to [lMin, lMax]. */
export interface InverseModel {
  lOcc: number
  lFree: number
  lMin: number
  lMax: number
}

export const logOdds = (p: number) => Math.log(p / (1 - p))
export const probOf = (l: number) => 1 / (1 + Math.exp(-l))
/** `clampP` ≥ 1 = no clamp. */
export const occModel = (pHit = 0.7, pMiss = 0.4, clampP = 0.97): InverseModel => {
  const lim = clampP >= 1 ? Infinity : logOdds(clampP)
  return { lOcc: logOdds(pHit), lFree: logOdds(pMiss), lMin: -lim, lMax: lim }
}

export const occGrid = (ox: number, oy: number, res: number, nx: number, ny: number): OccGrid => ({ ox, oy, res, nx, ny, lo: new Float32Array(nx * ny) })
/** Same cells as costmap `roomGrid`: the room plus one ring for the walls. */
export const roomOccGrid = (room: Room, res: number) => occGrid(-res, -res, res, Math.ceil(room.w / res) + 2, Math.ceil(room.d / res) + 2)
export const cloneOcc = (g: OccGrid): OccGrid => ({ ...g, lo: g.lo.slice() })
export const occCentre = (g: OccGrid, k: number): [number, number] => [g.ox + ((k % g.nx) + 0.5) * g.res, g.oy + (Math.floor(k / g.nx) + 0.5) * g.res]
export const occCellOf = (g: OccGrid, x: number, y: number): [number, number] => [Math.floor((x - g.ox) / g.res), Math.floor((y - g.oy) / g.res)]
export const occIndex = (g: OccGrid, i: number, j: number) => (i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i)

/** Every cell a line from cell (i0, j0) to (i1, j1) crosses, both ends included, 8-connected. */
export function bresenham(i0: number, j0: number, i1: number, j1: number): [number, number][] {
  const out: [number, number][] = []
  const dx = Math.abs(i1 - i0)
  const dy = -Math.abs(j1 - j0)
  const sx = i0 < i1 ? 1 : -1
  const sy = j0 < j1 ? 1 : -1
  let err = dx + dy
  let [i, j] = [i0, j0]
  for (;;) {
    out.push([i, j])
    if (i === i1 && j === j1) return out
    const e2 = 2 * err
    if (e2 >= dy) [err, i] = [err + dy, i + sx]
    if (e2 <= dx) [err, j] = [err + dx, j + sy]
  }
}

export const addLogOdds = (g: OccGrid, k: number, dl: number, m: InverseModel) => {
  if (k >= 0) g.lo[k] = clamp(g.lo[k] + dl, m.lMin, m.lMax)
}

/** One beam, robot-relative: angle `a` from the heading, range `m`, `hit` false = nothing within max range; `half` > 0 = cone half-angle. */
export interface Beam {
  a: number
  m: number
  hit: boolean
  half: number
}
/** Cells a beam touches: `free` before the end, `occ` at it. */
export interface BeamCells {
  free: number[]
  occ: number[]
}

/** Narrow beam: Bresenham from the robot cell to the end cell; free along it, occupied at the end if it hit. */
export function rayCells(g: OccGrid, x0: number, y0: number, th: number, m: number, hit: boolean): BeamCells {
  const nudge = hit ? 1e-4 : 0
  const [i0, j0] = occCellOf(g, x0, y0)
  const [i1, j1] = occCellOf(g, x0 + (m + nudge) * Math.cos(th), y0 + (m + nudge) * Math.sin(th))
  const line = bresenham(i0, j0, i1, j1).map(([i, j]) => occIndex(g, i, j))
  const end = line.pop()!
  const free = line.filter((k) => k >= 0)
  return hit ? { free, occ: end >= 0 ? [end] : [] } : { free: end >= 0 ? [...free, end] : free, occ: [] }
}

/** Wide cone: every cell centre inside it is free short of the range; the whole arc at the range is "occupied somewhere here". */
export function coneCells(g: OccGrid, x0: number, y0: number, th: number, half: number, m: number, hit: boolean): BeamCells & { gain: number[] } {
  const out = { free: [] as number[], occ: [] as number[], gain: [] as number[] }
  const r = m + g.res
  const [ia, ja] = occCellOf(g, x0 - r, y0 - r)
  const [ib, jb] = occCellOf(g, x0 + r, y0 + r)
  for (let j = Math.max(0, ja); j <= Math.min(g.ny - 1, jb); j++)
    for (let i = Math.max(0, ia); i <= Math.min(g.nx - 1, ib); i++) {
      const k = j * g.nx + i
      const [cx, cy] = occCentre(g, k)
      const d = Math.hypot(cx - x0, cy - y0)
      const off = wrapPi(Math.atan2(cy - y0, cx - x0) - th)
      if (Math.abs(off) > half) continue
      if (d < m - g.res / 2) out.free.push(k)
      else if (hit && d <= m + g.res / 2) {
        out.occ.push(k)
        out.gain.push(beamGain(off, half))
      }
    }
  return out
}

/** Fold one scan taken at `pose` into the grid; returns the cells each beam touched. Mutates `g`. */
export function integrateScan(g: OccGrid, model: InverseModel, pose: Pose, beams: Beam[]): BeamCells[] {
  return beams.map((b) => {
    const th = pose.th + b.a
    if (b.half > 0) {
      const c = coneCells(g, pose.x, pose.y, th, b.half, b.m, b.hit)
      for (const k of c.free) addLogOdds(g, k, model.lFree, model)
      c.occ.forEach((k, i) => addLogOdds(g, k, model.lOcc * c.gain[i], model))
      return c
    }
    const c = rayCells(g, pose.x, pose.y, th, b.m, b.hit)
    for (const k of c.free) addLogOdds(g, k, model.lFree, model)
    for (const k of c.occ) addLogOdds(g, k, model.lOcc, model)
    return c
  })
}

export type OccSensor = 'lidar' | 'sonar'
export const SONAR_HALF = (HCSR04.halfDeg * Math.PI) / 180

/** `n` lidar beams evenly round, or `n` HC-SR04s in a ring (range = nearest thing anywhere in the 30° cone). */
export function occScan(room: Room, pose: Pose, sensor: OccSensor, n: number, maxM: number, z = 0.2): Beam[] {
  const o: [number, number, number] = [pose.x, pose.y, z]
  const range = (th: number) => {
    const h = castRoom(room, o, rayDir(th), maxM)
    return h && h.solid ? h.m : Infinity
  }
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n
    let m = Infinity
    if (sensor === 'lidar') m = range(pose.th + a)
    else for (let s = -6; s <= 6; s++) m = Math.min(m, range(pose.th + a + (s / 6) * SONAR_HALF))
    return { a, m: Math.min(m, maxM), hit: m <= maxM, half: sensor === 'sonar' ? SONAR_HALF : 0 }
  })
}

/** Truth for a static room: 1 where a solid overlaps the cell (costmap static layer). */
export const occTruth = (room: Room, res: number) => staticLayer(room, res).cost.map((c) => (c === LETHAL ? 1 : 0))

/** One pass (p 0.4) or one hit (p 0.7) already counts as known. */
export const OCC_P = { occ: 0.58, free: 0.42 }
export type CellState = 'unknown' | 'free' | 'occ'
export const cellState = (l: number): CellState => (probOf(l) >= OCC_P.occ ? 'occ' : probOf(l) <= OCC_P.free ? 'free' : 'unknown')

/** Free / occupied / unknown counts; `wrong` = known cells that disagree with `truth`. */
export function occStats(g: OccGrid, truth: ArrayLike<number>) {
  const s = { free: 0, occ: 0, unknown: 0, wrong: 0, cells: g.lo.length }
  for (let k = 0; k < g.lo.length; k++) {
    const c = cellState(g.lo[k])
    s[c]++
    if ((c === 'occ' && !truth[k]) || (c === 'free' && truth[k])) s.wrong++
  }
  return s
}

export interface OccFrame {
  t: number
  pose: Pose
  /** Where odometry thinks the robot is: the scan is folded in here. */
  est: Pose
  beams: Beam[]
  lo: Float32Array
}
export interface OccRunOpts {
  room: (t: number) => Room
  path: (t: number) => Pose
  sensor: OccSensor
  beams: number
  maxM: number
  res: number
  model: InverseModel
  /** Odometry heading error per metre driven, rad/m. */
  drift: number
  T: number
  scanHz: number
}

/** Drive `path`, scan at `scanHz`, fold each scan in at the odometry pose; one grid snapshot per scan. */
export function occRun(o: OccRunOpts): OccFrame[] {
  const g = roomOccGrid(o.room(0), o.res)
  const sub = 10
  const dt = 1 / o.scanHz / sub
  let prev = o.path(0)
  const est = { ...prev }
  const out: OccFrame[] = []
  for (let s = 0; s * dt <= o.T + 1e-9; s++) {
    const t = s * dt
    const p = o.path(t)
    if (s > 0) {
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      const fwd = dx * Math.cos(prev.th) + dy * Math.sin(prev.th)
      const left = -dx * Math.sin(prev.th) + dy * Math.cos(prev.th)
      const c = Math.cos(est.th)
      const sn = Math.sin(est.th)
      est.x += fwd * c - left * sn
      est.y += fwd * sn + left * c
      est.th += wrapPi(p.th - prev.th) + o.drift * Math.hypot(dx, dy)
      prev = p
    }
    if (s % sub) continue
    const beams = occScan(o.room(t), p, o.sensor, o.beams, o.maxM)
    integrateScan(g, o.model, est, beams)
    out.push({ t, pose: p, est: { ...est }, beams, lo: g.lo.slice() })
  }
  return out
}

/** Elliptical lap round the room centre at `v` m/s, counter-clockwise, heading along the path. */
export function lapPath(cx: number, cy: number, ax: number, ay: number, v: number) {
  const per = Math.PI * (3 * (ax + ay) - Math.sqrt((3 * ax + ay) * (ax + 3 * ay)))
  return (t: number): Pose => {
    const u = (2 * Math.PI * v * t) / per - Math.PI / 2
    return { x: cx + ax * Math.cos(u), y: cy + ay * Math.sin(u), th: Math.atan2(ay * Math.cos(u), -ax * Math.sin(u)) }
  }
}
