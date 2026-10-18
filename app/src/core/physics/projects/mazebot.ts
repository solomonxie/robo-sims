// Maze-solver car: three VL53L0X wall sensors in a 25 cm cell maze (mount, cone, floor returns, threshold), and the micromouse run on a TT car (sense, flood, spin, drive; fast run on merged straights).
import { ENCODERS, TT_WHEEL_MM, TT_TRACK_M, mmPerTick, ticksPerWheelRev } from '../sensors/encoder'
import { TT_GEAR } from '../actuators/dcmotor'
import { DEG, gaussAt, wrapPi } from '../common'
import { moveAt, trapezoidMove } from '../control/position'
import { DIR_TH, Dir, MAZE, Maze, cellDrive, mouseRun, neighbour, wallAt } from '../navigation/maze'
import { Pose, rayDir, toRoom } from '../room'
import { TOF_MODES, VL53L0X, reportedMm, tofRanging } from '../sensors/tof'

/** Sensor deck: z above the floor; front sensor on the nose; side pair straight out (90°) or angled forward (45°). Robot frame x forward, y left. */
export const MAZE_BOT = {
  z: 0.04,
  front: { x: 0.075, y: 0 },
  sides: { 90: { x: 0.045, y: 0.05 }, 45: { x: 0.06, y: 0.045 } },
  wallRefl: 0.88,
  floorRefl: 0.3,
  klux: 0.3,
}
export type SideMount = 90 | 45
const CONE = (VL53L0X.fovDeg / 2) * DEG
const CONE_RAYS: [number, number][] = [[0, 0], [CONE, 0], [-CONE, 0], [0, CONE], [0, -CONE]]

/** Nearest hit (m) of a ray from (x, y, z) along unit (dx, dy, dz) on maze walls (thin slabs on the grid lines), corner posts (1.3 × wall width) or the floor;
 *  `floor` when the floor is what it hit. Walks only the grid lines it crosses, so it is cheap enough for every frame. */
export function castMaze(m: Maze, o: [number, number, number], d: [number, number, number], maxM: number, cellM = MAZE.cellM, wallM = MAZE.wallM, h = MAZE.wallH) {
  let best = maxM
  let floor = false
  if (d[2] < 0 && -o[2] / d[2] < best) [best, floor] = [-o[2] / d[2], true]
  const w2 = wallM / 2
  const p2 = (wallM * 1.3) / 2
  const tall = (t: number) => {
    const z = o[2] + d[2] * t
    return z >= 0 && z <= h
  }
  for (const ax of [0, 1]) {
    const v = d[ax]
    if (Math.abs(v) < 1e-12) continue
    const s = Math.sign(v)
    const n = ax === 0 ? m.w : m.h
    const along = ax === 0 ? m.h : m.w
    for (let i = s > 0 ? Math.max(0, Math.floor(o[ax] / cellM)) : Math.min(n, Math.ceil(o[ax] / cellM)); i >= 0 && i <= n; i += s) {
      const line = i * cellM
      const tMin = (line - s * p2 - o[ax]) / v
      if (tMin >= best) break
      for (const [half, post] of [[w2, false], [p2, true]] as const) {
        const t = (line - s * half - o[ax]) / v
        if (t <= 1e-9 || t >= best) continue
        const q = o[1 - ax] + d[1 - ax] * t
        const k = Math.round(q / cellM)
        const nearPost = Math.abs(q - k * cellM) <= p2 && k >= 0 && k <= along
        if (post ? !nearPost : nearPost) continue
        if (!post) {
          const j = Math.floor(q / cellM)
          if (j < 0 || j >= along) continue
          const c = ax === 0 ? j * m.w + Math.min(i, m.w - 1) : Math.min(i, m.h - 1) * m.w + j
          const side = ax === 0 ? (i < m.w ? 3 : 1) : i < m.h ? 2 : 0
          if (!wallAt(m, c, side)) continue
        }
        if (tall(t)) [best, floor] = [t, false]
      }
    }
  }
  return { m: best, floor }
}

/** Sensor origin (room x, y) and beam heading for slot 0 left, 1 front, 2 right. */
export function sensorRay(p: Pose, slot: number, mount: SideMount): { at: [number, number]; th: number } {
  if (slot === 1) return { at: toRoom(p, MAZE_BOT.front.x, 0), th: p.th }
  const s = MAZE_BOT.sides[mount]
  const k = slot === 0 ? 1 : -1
  return { at: toRoom(p, s.x, k * s.y), th: p.th + k * mount * DEG }
}

/** One VL53L0X ranging: nearest return inside its 25° cone (5 rays; walls, posts or the floor), photon-limited noise, 8190 if no valid return. */
export function tofWallMm(m: Maze, at: [number, number], th: number, k: number) {
  let best: { m: number; refl: number } | null = null
  for (const [a, e] of CONE_RAYS) {
    const hit = castMaze(m, [at[0], at[1], MAZE_BOT.z], rayDir(th + a, e), VL53L0X.maxM)
    if (hit.m < VL53L0X.maxM && (!best || hit.m < best.m)) best = { m: hit.m, refl: hit.floor ? MAZE_BOT.floorRefl : MAZE_BOT.wallRefl }
  }
  if (!best) return VL53L0X.outOfRange
  const r = tofRanging(best.m, best.refl, MAZE_BOT.klux, 'default')
  return reportedMm(best.m, r.sigma, r.ok, gaussAt(k))
}

/** [left, front, right] in mm. */
export const wallReads = (m: Maze, p: Pose, mount: SideMount, k = 0) => [0, 1, 2].map((s) => {
  const r = sensorRay(p, s, mount)
  return tofWallMm(m, r.at, r.th, 3 * k + s)
})

/** How far ahead of the axle the side beams meet the middle of a side wall with the robot centred. */
export function sideReadAhead(mount: SideMount, cellM = MAZE.cellM, wallM = MAZE.wallM) {
  const s = MAZE_BOT.sides[mount]
  return s.x + (mount === 90 ? 0 : (cellM / 2 - wallM / 2 - s.y) / Math.tan(mount * DEG))
}

/** Robot-frame shift `offM` to the left and heading error `err` (rad). */
export const skewPose = (p: Pose, offM: number, err: number): Pose => ({ x: p.x - Math.sin(p.th) * offM, y: p.y + Math.cos(p.th) * offM, th: p.th + err })

const stepDir = (m: Maze, a: number, b: number) => [0, 1, 2, 3].find((d) => neighbour(m, a, d) === b) ?? -1

interface CellRead {
  cell: number
  dir: Dir
  /** Pose of the side reading and of the front reading (at the cell centre). */
  sideAt: Pose
  frontAt: Pose
  reads: number[]
  seen: boolean[]
  truth: boolean[]
}

/** Drive `cells`, misaligned by `offM` / `errDeg`; side walls read where the side beams cross the middle of each cell, the front wall at its centre.
 *  Wall if a reading is under `thrMm`. The start cell is skipped: the rules say it has walls on three sides. */
export function senseRun(m: Maze, cells: number[], mount: SideMount, thrMm: number, offM: number, errDeg: number, sub = 8) {
  const err = errDeg * DEG
  const drive = cellDrive(m, cells, DIR_TH[MAZE.startDir], sub)
  const samples = drive.poses.map((p, i) => wallReads(m, skewPose(p, offM, err), mount, i))
  const ahead = sideReadAhead(mount)
  const legs: CellRead[] = []
  for (let k = 1; k < cells.length; k++) {
    const dir = stepDir(m, cells[k - 1], cells[k]) as Dir
    const th = DIR_TH[dir]
    const cx = ((cells[k] % m.w) + 0.5) * MAZE.cellM
    const cy = (Math.floor(cells[k] / m.w) + 0.5) * MAZE.cellM
    const frontAt = skewPose({ x: cx, y: cy, th }, offM, err)
    const sideAt = skewPose({ x: cx - Math.cos(th) * ahead, y: cy - Math.sin(th) * ahead, th }, offM, err)
    const side = wallReads(m, sideAt, mount, 10000 + k)
    const reads = [side[0], wallReads(m, frontAt, mount, 20000 + k)[1], side[2]]
    legs.push({ cell: cells[k], dir, sideAt, frontAt, reads, seen: reads.map((r) => r < thrMm), truth: [3, 0, 1].map((t) => wallAt(m, cells[k], (dir + t) % 4)) })
  }
  const wrong = legs.reduce((s, l) => s + l.seen.filter((v, i) => v !== l.truth[i]).length, 0)
  const right = legs.filter((l) => l.seen.every((v, i) => v === l.truth[i])).length
  const margin = Math.min(...legs.flatMap((l) => l.reads.map((r) => Math.abs(Math.min(r, 1000) - thrMm))))
  const both = legs.filter((l) => l.truth[0] && l.truth[2] && l.seen[0] && l.seen[2])
  const sin = Math.sin(mount * DEG)
  const centre = both.length ? both.reduce((s, l) => s + ((l.reads[2] - l.reads[0]) / 2000) * sin, 0) / both.length : null
  return { drive, samples, legs, wrong, right, margin, centre }
}

// --- Micromouse on the car: sense + flood, spin, drive, timed. ---

/** Search: stop in every cell. Fast run: whole straights at `vFast`. Wheel speed in a spin; accel kept under the tyre grip; ESP32 BFS cost per cell. */
export const MOUSE_DRIVE = { searchV: 0.25, spinV: 0.15, accel: 1.0, senseS: TOF_MODES.default.budgetMs / 1000, floodUsPerCell: 1.2, track: TT_TRACK_M }

export const floodUs = (cells: number) => cells * MOUSE_DRIVE.floodUsPerCell
/** Wall + seen bits in one byte per cell, plus a 16-bit distance per cell. */
export const mapBytes = (w: number, h: number) => w * h + 2 * w * h
/** Encoder ticks per cell: TT Hall encoder, ×4 decoding, 1:48 gearbox. */
export const cellTicks = (cellM = MAZE.cellM) => Math.round((cellM * 1000) / mmPerTick(TT_WHEEL_MM, ticksPerWheelRev(ENCODERS.hall.ppr, 4, TT_GEAR)))

export type MousePhase = 'search' | 'return' | 'fast'
export interface MouseSeg {
  kind: 'sense' | 'turn' | 'drive'
  phase: MousePhase
  t0: number
  T: number
  /** Cell at the start, cell at the end, heading at the start and the end. */
  from: number
  to: number
  th0: number
  th1: number
  /** Drive length (m); peak speed; index into `mouseRun` steps whose map is in use. */
  dist: number
  v: number
  step: number
}
const spinS = (turn: number) => (Math.abs(turn) < 1e-9 ? 0 : trapezoidMove((Math.abs(turn) * MOUSE_DRIVE.track) / 2, MOUSE_DRIVE.spinV, MOUSE_DRIVE.accel).T)

/** Timeline of a `mouseRun`: every explore step senses and re-floods, spins to the next cell and drives it from a stop; the fast run merges straights. */
export function mouseTimeline(m: Maze, goals: number[], returnTrip: boolean, vFast: number) {
  const run = mouseRun(m, goals, returnTrip)
  const segs: MouseSeg[] = []
  let [t, th] = [0, DIR_TH[MAZE.startDir]]
  const push = (s: Omit<MouseSeg, 't0'>) => {
    if (s.T <= 0) return
    segs.push({ ...s, t0: t })
    t += s.T
  }
  const turnTo = (cell: number, to: number, phase: MousePhase, step: number) => {
    const turn = wrapPi(to - th)
    push({ kind: 'turn', phase, T: spinS(turn), from: cell, to: cell, th0: th, th1: th + turn, dist: 0, v: MOUSE_DRIVE.spinV, step })
    th = to
  }
  const steps = run.steps
  const sense = MOUSE_DRIVE.senseS + floodUs(m.w * m.h) / 1e6
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.phase === 'fast') break
    push({ kind: 'sense', phase: s.phase, T: sense, from: s.cell, to: s.cell, th0: th, th1: th, dist: 0, v: 0, step: i })
    const nx = steps[i + 1]
    if (!nx || nx.phase !== s.phase || nx.cell === s.cell) continue
    const d = stepDir(m, s.cell, nx.cell)
    turnTo(s.cell, DIR_TH[d], s.phase, i)
    push({ kind: 'drive', phase: s.phase, T: trapezoidMove(MAZE.cellM, MOUSE_DRIVE.searchV, MOUSE_DRIVE.accel).T, from: s.cell, to: nx.cell, th0: th, th1: th, dist: MAZE.cellM, v: MOUSE_DRIVE.searchV, step: i })
  }
  const exploreS = t
  const nExplore = steps.findIndex((s) => s.phase === 'fast')
  const fast = steps.slice(nExplore).map((s) => s.cell)
  if (!returnTrip) th = DIR_TH[MAZE.startDir]
  let straights = 0
  for (let i = 0; i + 1 < fast.length; ) {
    const d = stepDir(m, fast[i], fast[i + 1])
    let j = i + 1
    while (j + 1 < fast.length && stepDir(m, fast[j], fast[j + 1]) === d) j++
    turnTo(fast[i], DIR_TH[d], 'fast', nExplore + i)
    const mv = trapezoidMove((j - i) * MAZE.cellM, vFast, MOUSE_DRIVE.accel)
    push({ kind: 'drive', phase: 'fast', T: mv.T, from: fast[i], to: fast[j], th0: th, th1: th, dist: mv.dist, v: mv.vPeak, step: nExplore + i })
    straights++
    i = j
  }
  const sum = (ph: MousePhase) => segs.filter((s) => s.phase === ph).reduce((a, s) => a + s.T, 0)
  const searchS = sum('search')
  const fastS = t - exploreS
  /** Same route as the fast run, but driven the search way: stop, sense and re-flood in every cell. */
  const crawlS = (fast.length - 1) * (sense + trapezoidMove(MAZE.cellM, MOUSE_DRIVE.searchV, MOUSE_DRIVE.accel).T) + segs.filter((s) => s.phase === 'fast' && s.kind === 'turn').reduce((a, s) => a + s.T, 0)
  return { run, segs, nExplore, T: t, exploreS, searchS, backS: sum('return'), fastS, crawlS, straights, turns: segs.filter((s) => s.kind === 'turn').length }
}

/** Pose at time t on a timeline; `seg` index; distance each wheel has rolled (for the tyres). */
export function mouseAt(m: Maze, segs: MouseSeg[], t: number) {
  let i = segs.findIndex((s) => t < s.t0 + s.T)
  if (i < 0) i = segs.length - 1
  const s = segs[i]
  const u = Math.min(1, Math.max(0, (t - s.t0) / s.T))
  const centre = (c: number): [number, number] => [((c % m.w) + 0.5) * MAZE.cellM, (Math.floor(c / m.w) + 0.5) * MAZE.cellM]
  const [x0, y0] = centre(s.from)
  let rolled = 0
  for (let k = 0; k < i; k++) rolled += segs[k].dist
  if (s.kind !== 'drive') {
    const th = s.th0 + (s.th1 - s.th0) * u
    let spun = 0
    for (let k = 0; k < i; k++) spun += segs[k].th1 - segs[k].th0
    spun += th - s.th0
    return { pose: { x: x0, y: y0, th }, seg: i, dL: rolled - (spun * MOUSE_DRIVE.track) / 2, dR: rolled + (spun * MOUSE_DRIVE.track) / 2 }
  }
  const mv = trapezoidMove(s.dist, s.v, MOUSE_DRIVE.accel)
  const p = moveAt(mv, u * mv.T).p
  let spun = 0
  for (let k = 0; k < i; k++) spun += segs[k].th1 - segs[k].th0
  const [L, R] = [rolled + p - (spun * MOUSE_DRIVE.track) / 2, rolled + p + (spun * MOUSE_DRIVE.track) / 2]
  return { pose: { x: x0 + Math.cos(s.th0) * p, y: y0 + Math.sin(s.th0) * p, th: s.th0 }, seg: i, dL: L, dR: R }
}
