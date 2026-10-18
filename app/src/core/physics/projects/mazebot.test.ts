import { MAZE, Maze, boxMaze, centreGoal, genMaze, neighbour, setWall, wallAt, wallFollow } from '../navigation/maze'
import { Room, RoomSolid, castRoom, rayDir } from '../room'
import { medianMs } from '../../stopwatch'
import { castMaze, cellTicks, mapBytes, mouseAt, mouseTimeline, senseRun, sideReadAhead, wallReads } from './mazebot'

/** The same maze as plain room boxes, to check the grid-walking caster against the general one. */
function asRoom(m: Maze): Room {
  const { cellM, wallM, wallH: h } = MAZE
  const solids: RoomSolid[] = []
  const [w2, p2] = [wallM / 2, (wallM * 1.3) / 2]
  for (let c = 0; c < m.w * m.h; c++) {
    const [x, y] = [(c % m.w) * cellM, Math.floor(c / m.w) * cellM]
    for (const d of [0, 1, 2, 3])
      if (wallAt(m, c, d) && (d < 2 || neighbour(m, c, d) < 0)) {
        const k = d === 0 ? y + cellM : d === 2 ? y : d === 1 ? x + cellM : x
        const along = d % 2 === 0
        solids.push({ kind: 'box', name: 'wall', h, refl: 1, x: along ? [x, x + cellM] : [k - w2, k + w2], y: along ? [k - w2, k + w2] : [y, y + cellM] })
      }
  }
  for (let i = 0; i <= m.w; i++) for (let j = 0; j <= m.h; j++) solids.push({ kind: 'box', name: 'post', h, refl: 1, x: [i * cellM - p2, i * cellM + p2], y: [j * cellM - p2, j * cellM + p2] })
  return { w: m.w * cellM, d: m.h * cellM, solids }
}

/** A straight 1 × 4 corridor going north, with a side opening on the left of cell 2. */
function corridor() {
  const m = boxMaze(3, 4, true)
  for (let y = 0; y < 3; y++) setWall(m, y * 3 + 1, 0, false)
  setWall(m, 2 * 3 + 1, 3, false)
  return { m, cells: [1, 4, 7, 10] }
}

describe('wall sensing', () => {
  it('grid-walking caster matches the general ray caster', () => {
    const m = genMaze(8, 8, 5)
    const room = asRoom(m)
    for (let i = 0; i < 800; i++) {
      const o: [number, number, number] = [0.05 + 1.9 * Math.abs(Math.sin(i * 1.7)), 0.05 + 1.9 * Math.abs(Math.sin(i * 2.3)), 0.04]
      if (room.solids.some((s) => s.kind === 'box' && o[0] > s.x[0] && o[0] < s.x[1] && o[1] > s.y[0] && o[1] < s.y[1])) continue
      const d = rayDir(i * 0.37, ((i % 7) - 3) * 0.07)
      const h = castRoom(room, o, d, 2)
      expect(castMaze(m, o, d, 2).m).toBeCloseTo(h ? h.m : 2, 6)
    }
  })
  it('centred: side walls ~65 mm, front wall ~40 mm; an open side sees the floor through the 25° cone (~185 mm)', () => {
    const { m } = corridor()
    const c = (cell: number, th: number) => ({ x: ((cell % 3) + 0.5) * MAZE.cellM, y: (Math.floor(cell / 3) + 0.5) * MAZE.cellM, th })
    const [l, f, r] = wallReads(m, c(10, Math.PI / 2), 90)
    expect(l).toBeGreaterThan(55)
    expect(l).toBeLessThan(75)
    expect(r).toBeCloseTo(l, -1)
    expect(f).toBeGreaterThan(30)
    expect(f).toBeLessThan(50)
    const open = wallReads(m, { ...c(7, Math.PI / 2), y: c(7, 0).y - sideReadAhead(90) }, 90)[0]
    expect(open).toBeGreaterThan(170)
    expect(open).toBeLessThan(200)
  })
  it('a 45° pair reads the side walls 13 cm ahead of the axle', () => {
    expect(sideReadAhead(90)).toBeCloseTo(0.045)
    expect(sideReadAhead(45)).toBeCloseTo(0.13, 3)
  })
  it('threshold between wall and floor reads every wall right; too high turns the floor into walls, too low misses angled walls', () => {
    const m = genMaze(8, 8, 5)
    const cells = wallFollow(m, 0, 0, centreGoal(m), 'left').cells.slice(0, 41)
    const ok = senseRun(m, cells, 90, 120, 0, 0)
    expect(ok.wrong).toBe(0)
    expect(ok.right).toBe(ok.legs.length)
    expect(ok.margin).toBeGreaterThan(40)
    const high = senseRun(m, cells, 90, 200, 0, 0)
    expect(high.legs.every((l) => l.seen.every(Boolean))).toBe(true)
    expect(senseRun(m, cells, 45, 80, 0, 0).wrong).toBeGreaterThan(10)
  })
  it('side readings centre the robot: (R − L)/2 = offset; misalignment breaks the 45° pair first', () => {
    const m = genMaze(8, 8, 5)
    const cells = wallFollow(m, 0, 0, centreGoal(m), 'left').cells.slice(0, 41)
    expect(senseRun(m, cells, 90, 120, 0.03, 0).centre!).toBeCloseTo(0.03, 2)
    expect(senseRun(m, cells, 90, 120, 0, 20).wrong).toBe(0)
    expect(senseRun(m, cells, 45, 120, 0, 20).wrong).toBeGreaterThan(5)
  })
  it('fast enough to redo on a slider drag', () => {
    const m = genMaze(8, 8, 3)
    const cells = wallFollow(m, 0, 0, centreGoal(m), 'left').cells.slice(0, 41)
    expect(medianMs((i) => senseRun(m, cells, 45, 120 + i, 0.01, 5), 3)).toBeLessThan(150)
  })
})

describe('micromouse on the car', () => {
  const m = genMaze(8, 8, 5, { island: true, loops: 4 })
  const goal = centreGoal(m)
  it('encoder ticks per 25 cm cell and map size', () => {
    expect(cellTicks()).toBeGreaterThan(2500)
    expect(cellTicks()).toBeLessThan(2700)
    expect(mapBytes(16, 16)).toBe(768)
  })
  it('timeline is contiguous; the fast run beats the same route driven cell by cell and gets faster with speed', () => {
    const r = mouseTimeline(m, goal, true, 0.8)
    r.segs.forEach((s, i) => i && expect(s.t0).toBeCloseTo(r.segs[i - 1].t0 + r.segs[i - 1].T, 9))
    expect(r.T).toBeCloseTo(r.searchS + r.backS + r.fastS, 6)
    expect(r.fastS).toBeLessThan(r.crawlS * 0.7)
    expect(mouseTimeline(m, goal, true, 0.4).fastS).toBeGreaterThan(r.fastS)
    expect(r.run.fast).toBe(r.run.best)
  })
  it('exploring back finds a shorter fast route than search only', () => {
    const a = mouseTimeline(m, goal, false, 0.6)
    const b = mouseTimeline(m, goal, true, 0.6)
    expect(a.backS).toBe(0)
    expect(b.run.fast).toBeLessThanOrEqual(a.run.fast)
    expect(b.fastS).toBeLessThan(a.fastS)
  })
  it('pose follows the segments: drives end on the next cell centre, spins stay put', () => {
    const r = mouseTimeline(m, goal, true, 0.8)
    for (const s of r.segs.slice(0, 40)) {
      const end = mouseAt(m, r.segs, s.t0 + s.T - 1e-9).pose
      const cx = ((s.to % m.w) + 0.5) * MAZE.cellM
      const cy = (Math.floor(s.to / m.w) + 0.5) * MAZE.cellM
      expect(end.x).toBeCloseTo(cx, 4)
      expect(end.y).toBeCloseTo(cy, 4)
    }
    const last = mouseAt(m, r.segs, r.T).pose
    expect(goal).toContain(Math.floor(last.y / MAZE.cellM) * m.w + Math.floor(last.x / MAZE.cellM))
  })
})
