// Cell mazes (walls between cells): seeded generator, hand-rule wall follower, Trémaux, flood fill, micromouse search + fast run.
import { seededRng } from '../common'
import { Pose } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'

/** 0 N (+y), 1 E (+x), 2 S, 3 W. */
export type Dir = 0 | 1 | 2 | 3
const MAZE_DX = [0, 1, 0, -1]
const MAZE_DY = [1, 0, -1, 0]
export const DIR_TH = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]
/** Cells `w` × `h`, index y·w + x; `walls[4c + d]` = 1: wall on side d of cell c. */
export interface Maze {
  w: number
  h: number
  walls: Uint8Array
}
/** 8 × 8 cells of 25 cm (a TT car needs more than micromouse's 18 cm), walls 5 cm high; start bottom-left facing north. */
export const MAZE = { n: 8, cellM: 0.25, wallM: 0.02, wallH: 0.05, start: 0, startDir: 0 as Dir }

const turnDir = (d: number, k: number) => (((d + k) % 4) + 4) % 4 as Dir
const cellXY = (m: Maze, c: number): [number, number] => [c % m.w, Math.floor(c / m.w)]
export const wallAt = (m: Maze, c: number, d: number) => m.walls[4 * c + d] === 1
export function neighbour(m: Maze, c: number, d: number) {
  const [x, y] = cellXY(m, c)
  const nx = x + MAZE_DX[d]
  const ny = y + MAZE_DY[d]
  return nx < 0 || ny < 0 || nx >= m.w || ny >= m.h ? -1 : ny * m.w + nx
}
/** Sets or clears the wall on side d of c and the matching side of its neighbour. */
export function setWall(m: Maze, c: number, d: number, on: boolean) {
  const b = neighbour(m, c, d)
  m.walls[4 * c + d] = on ? 1 : 0
  if (b >= 0) m.walls[4 * b + turnDir(d, 2)] = on ? 1 : 0
}
/** All walls (`full`) or just the outer boundary. */
export function boxMaze(w: number, h: number, full: boolean): Maze {
  const m = { w, h, walls: new Uint8Array(4 * w * h) }
  for (let c = 0; c < w * h; c++) for (let d = 0; d < 4; d++) if (full || neighbour(m, c, d) < 0) m.walls[4 * c + d] = 1
  return m
}
const openDirs = (m: Maze, c: number) => ([0, 1, 2, 3] as Dir[]).filter((d) => !wallAt(m, c, d))
/** The 2 × 2 centre (one cell when a side is odd). */
export function centreGoal(m: Maze) {
  const xs = m.w % 2 ? [(m.w - 1) / 2] : [m.w / 2 - 1, m.w / 2]
  const ys = m.h % 2 ? [(m.h - 1) / 2] : [m.h / 2 - 1, m.h / 2]
  return ys.flatMap((y) => xs.map((x) => y * m.w + x))
}

/** Seeded recursive backtracker (a perfect maze: one path between any two cells). `loops` knocks out extra walls;
 *  `island` opens a moat round the centre goal (one entrance), so its walls touch nothing else. */
export function genMaze(w: number, h: number, seed: number, { loops = 0, island = false } = {}): Maze {
  const m = boxMaze(w, h, true)
  const rnd = seededRng(seed)
  const seen = new Uint8Array(w * h)
  const stack = [0]
  seen[0] = 1
  while (stack.length) {
    const c = stack[stack.length - 1]
    const ds = [0, 1, 2, 3].filter((d) => neighbour(m, c, d) >= 0 && !seen[neighbour(m, c, d)])
    if (!ds.length) {
      stack.pop()
      continue
    }
    const d = ds[Math.floor(rnd() * ds.length)]
    const b = neighbour(m, c, d)
    setWall(m, c, d, false)
    seen[b] = 1
    stack.push(b)
  }
  const goal = centreGoal(m)
  if (island && goal.length === 4) {
    const [gx, gy] = cellXY(m, goal[0])
    const inGoal = (c: number) => goal.includes(c)
    const ring: number[] = []
    for (let y = gy - 1; y <= gy + 2; y++) for (let x = gx - 1; x <= gx + 2; x++) if (!inGoal(y * w + x)) ring.push(y * w + x)
    for (const c of ring) for (let d = 0; d < 4; d++) if (ring.includes(neighbour(m, c, d))) setWall(m, c, d, false)
    const doors: [number, number][] = []
    for (const c of goal)
      for (let d = 0; d < 4; d++) {
        const b = neighbour(m, c, d)
        setWall(m, c, d, !inGoal(b))
        if (!inGoal(b)) doors.push([c, d])
      }
    const [c, d] = doors[Math.floor(rnd() * doors.length)]
    setWall(m, c, d, false)
  }
  for (let i = 0, tries = 0; i < loops && tries < 50 * loops; tries++) {
    const c = Math.floor(rnd() * w * h)
    const d = Math.floor(rnd() * 4)
    const b = neighbour(m, c, d)
    if (b < 0 || !wallAt(m, c, d) || (island && goal.includes(c) !== goal.includes(b))) continue
    setWall(m, c, d, false)
    i++
  }
  return m
}

/** Breadth-first distances (in cells) to the nearest goal; −1 where unreachable. `open(c, d)` defaults to "no wall". */
export function floodFill(m: Maze, goals: number[], open = (c: number, d: number) => !wallAt(m, c, d)) {
  const dist = new Int16Array(m.w * m.h).fill(-1)
  const q = [...goals]
  for (const g of goals) dist[g] = 0
  for (let i = 0; i < q.length; i++) {
    const c = q[i]
    for (let d = 0; d < 4; d++) {
      const b = neighbour(m, c, d)
      if (b >= 0 && dist[b] < 0 && open(c, d)) {
        dist[b] = dist[c] + 1
        q.push(b)
      }
    }
  }
  return dist
}
/** Open passages w·h − 1 and every cell reachable. */
export function isPerfect(m: Maze) {
  let open = 0
  for (let c = 0; c < m.w * m.h; c++) open += openDirs(m, c).filter((d) => neighbour(m, c, d) >= 0).length
  return open / 2 === m.w * m.h - 1 && floodFill(m, [0]).every((d) => d >= 0)
}
/** Downhill walk on `dist` from `from`; ties keep heading `dir`. */
export function descend(m: Maze, dist: Int16Array, from: number, dir: Dir, open = (c: number, d: number) => !wallAt(m, c, d)) {
  const cells = [from]
  let [c, h] = [from, dir]
  while (dist[c] > 0) {
    const d = bestDir(m, dist, c, h, open)
    if (d < 0) break
    ;[c, h] = [neighbour(m, c, d), d as Dir]
    cells.push(c)
  }
  return cells
}
function bestDir(m: Maze, dist: Int16Array, c: number, h: Dir, open: (c: number, d: number) => boolean) {
  let best = -1
  for (const d of [h, turnDir(h, 1), turnDir(h, 3), turnDir(h, 2)]) {
    const b = neighbour(m, c, d)
    if (b >= 0 && open(c, d) && dist[b] >= 0 && (best < 0 || dist[b] < dist[neighbour(m, c, best)])) best = d
  }
  return best
}

export type Hand = 'left' | 'right'
export interface Walk {
  cells: number[]
  reached: boolean
  /** Came back to a (cell, heading) it had already been in: it will circle forever. */
  looped: boolean
}
/** Hand-on-the-wall: try hand side, straight, other side, back. */
export function wallFollow(m: Maze, start: number, dir: Dir, goals: number[], hand: Hand, maxSteps = 4 * m.w * m.h): Walk {
  const order = hand === 'left' ? [3, 0, 1, 2] : [1, 0, 3, 2]
  const states = new Set<number>()
  const cells = [start]
  let [c, h] = [start, dir]
  for (let i = 0; i < maxSteps; i++) {
    if (goals.includes(c)) return { cells, reached: true, looped: false }
    if (states.has(c * 4 + h)) return { cells, reached: false, looped: true }
    states.add(c * 4 + h)
    const d = order.map((k) => turnDir(h, k)).find((dd) => !wallAt(m, c, dd))
    if (d === undefined) break
    ;[c, h] = [neighbour(m, c, d), d]
    cells.push(c)
  }
  return { cells, reached: goals.includes(c), looped: false }
}

/** Trémaux: chalk each passage as you use it; back out of an old cell entered by a fresh passage; never use a passage a third time. */
export function tremaux(m: Maze, start: number, dir: Dir, goals: number[], hand: Hand = 'left', maxSteps = 4 * m.w * m.h) {
  const marks = new Uint8Array(m.w * m.h * 4)
  const key = (c: number, d: number) => (d < 2 ? c * 4 + d : neighbour(m, c, d) * 4 + turnDir(d, 2))
  const order = hand === 'left' ? [3, 0, 1, 2] : [1, 0, 3, 2]
  const visited = new Uint8Array(m.w * m.h)
  const cells = [start]
  let [c, h] = [start, dir]
  let came = -1
  visited[c] = 1
  for (let i = 0; i < maxSteps && !goals.includes(c); i++) {
    const back = turnDir(h, 2)
    const ways = order.map((k) => turnDir(h, k)).filter((d) => !wallAt(m, c, d) && d !== back)
    let d: number | undefined
    if (came >= 0 && visited[c] > 1 && marks[came] === 1) d = back
    else d = ways.find((dd) => marks[key(c, dd)] === 0) ?? ways.find((dd) => marks[key(c, dd)] === 1)
    if (d === undefined) d = !wallAt(m, c, back) ? back : undefined
    if (d === undefined || marks[key(c, d)] >= 2) break
    came = key(c, d)
    marks[came]++
    ;[c, h] = [neighbour(m, c, d), d as Dir]
    visited[c]++
    cells.push(c)
  }
  return { cells, reached: goals.includes(c), marks, markOf: key }
}

interface MouseStep {
  cell: number
  dir: Dir
  phase: 'search' | 'return' | 'fast'
  /** Distances on the mouse's map at this step; sides it has looked at (4c + d); a seen side with a true wall is known. */
  dist: Int16Array
  seen: Uint8Array
}
/** Micromouse: sense the current cell's walls, re-flood the known map (unknown = open), step downhill. Then optionally
 *  explore back to the start, and finally a fast run over cells whose walls are all known. */
export function mouseRun(m: Maze, goals: number[], returnTrip: boolean, start = MAZE.start, dir = MAZE.startDir) {
  const known = boxMaze(m.w, m.h, false)
  const seen = known.walls.slice()
  const steps: MouseStep[] = []
  let refloods = 0
  const sense = (c: number) => {
    for (let d = 0; d < 4; d++) {
      const b = neighbour(m, c, d)
      seen[4 * c + d] = 1
      if (b >= 0) seen[4 * b + turnDir(d, 2)] = 1
      if (wallAt(m, c, d)) setWall(known, c, d, true)
    }
  }
  const snap = (cell: number, h: Dir, phase: MouseStep['phase'], dist: Int16Array) => steps.push({ cell, dir: h, phase, dist, seen: seen.slice() })
  let [c, h] = [start, dir]
  const explore = (to: number[], phase: 'search' | 'return') => {
    const first = steps.length
    for (let i = 0; i < 4 * m.w * m.h; i++) {
      sense(c)
      const dist = floodFill(known, to)
      refloods++
      snap(c, h, phase, dist)
      if (to.includes(c)) break
      const d = bestDir(known, dist, c, h, (cc, dd) => !wallAt(known, cc, dd))
      if (d < 0) break
      ;[c, h] = [neighbour(m, c, d), d as Dir]
    }
    return steps.length - first - 1
  }
  const search = explore(goals, 'search')
  const back = returnTrip ? explore([start], 'return') : 0
  const sure = (cc: number, dd: number) => seen[4 * cc + dd] === 1 && !wallAt(known, cc, dd)
  const fastDist = floodFill(known, goals, sure)
  const fast = descend(known, fastDist, start, dir, sure)
  for (const [i, cell] of fast.entries()) snap(cell, i ? (dirBetween(m, fast[i - 1], cell) as Dir) : dir, 'fast', fastDist)
  const best = floodFill(m, goals)[start]
  const visited = new Set(steps.map((s) => s.cell)).size
  return { steps, search, back, fast: fast.length - 1, best, refloods, visited }
}
function dirBetween(m: Maze, a: number, b: number) {
  for (let d = 0; d < 4; d++) if (neighbour(m, a, d) === b) return d
  return -1
}

/** Centre of cell c in metres (cell 0's corner at the origin). */
const mazeCellCentre = (m: Maze, c: number, cellM = MAZE.cellM): [number, number] => {
  const [x, y] = cellXY(m, c)
  return [(x + 0.5) * cellM, (y + 0.5) * cellM]
}
interface CellDrive {
  poses: Pose[]
  dL: number[]
  dR: number[]
  /** Index into `cells` each pose is heading for. */
  leg: number[]
}
/** Turn on the spot, then drive straight, cell to cell; `sub` samples per cell and per quarter turn. */
export function cellDrive(m: Maze, cells: number[], th0: number, sub = 6, cellM = MAZE.cellM, track = TT_TRACK_M): CellDrive {
  const [x0, y0] = mazeCellCentre(m, cells[0], cellM)
  const out: CellDrive = { poses: [{ x: x0, y: y0, th: th0 }], dL: [0], dR: [0], leg: [0] }
  let [x, y, th, L, R] = [x0, y0, th0, 0, 0]
  const push = (k: number) => {
    out.poses.push({ x, y, th })
    out.dL.push(L)
    out.dR.push(R)
    out.leg.push(k)
  }
  for (let k = 1; k < cells.length; k++) {
    const d = dirBetween(m, cells[k - 1], cells[k])
    if (d < 0) continue
    let turn = DIR_TH[d] - th
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    const n = Math.round((Math.abs(turn) / (Math.PI / 2)) * sub)
    for (let i = 0; i < n; i++) {
      th += turn / n
      L -= ((turn / n) * track) / 2
      R += ((turn / n) * track) / 2
      push(k)
    }
    th = DIR_TH[d]
    for (let i = 0; i < sub; i++) {
      x += (MAZE_DX[d] * cellM) / sub
      y += (MAZE_DY[d] * cellM) / sub
      L += cellM / sub
      R += cellM / sub
      push(k)
    }
  }
  return out
}
