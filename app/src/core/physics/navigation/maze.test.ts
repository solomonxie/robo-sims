import { TT_TRACK_M } from '../sensors/encoder'
import { boxMaze, cellDrive, centreGoal, descend, floodFill, genMaze, isPerfect, mouseRun, neighbour, setWall, tremaux, wallAt, wallFollow } from './maze'

describe('maze grid', () => {
  it('walls are shared by both cells and the boundary is closed', () => {
    const m = boxMaze(2, 2, false)
    expect(wallAt(m, 0, 2)).toBe(true)
    expect(wallAt(m, 0, 1)).toBe(false)
    setWall(m, 0, 1, true)
    expect(wallAt(m, 1, 3)).toBe(true)
    expect(neighbour(m, 0, 3)).toBe(-1)
    expect(neighbour(m, 0, 0)).toBe(2)
    expect(centreGoal(boxMaze(8, 8, false))).toEqual([27, 28, 35, 36])
  })
  it('generator is deterministic and perfect', () => {
    expect(genMaze(8, 8, 3).walls).toEqual(genMaze(8, 8, 3).walls)
    expect(genMaze(8, 8, 3).walls).not.toEqual(genMaze(8, 8, 4).walls)
    for (let s = 1; s <= 20; s++) expect(isPerfect(genMaze(8, 8, s))).toBe(true)
    const loopy = genMaze(8, 8, 3, { loops: 6 })
    expect(isPerfect(loopy)).toBe(false)
    expect(floodFill(loopy, [0]).every((d) => d >= 0)).toBe(true)
  })
})

describe('flood fill', () => {
  it('hand-worked 2 × 2 with one wall', () => {
    // 2 3
    // 0|1   wall between 0 and 1: the way round is 0 → 2 → 3 → 1
    const m = boxMaze(2, 2, false)
    setWall(m, 0, 1, true)
    expect([...floodFill(m, [1])]).toEqual([3, 0, 2, 1])
    expect(descend(m, floodFill(m, [1]), 0, 0)).toEqual([0, 2, 3, 1])
    expect([...floodFill(boxMaze(3, 1, false), [2])]).toEqual([2, 1, 0])
    expect([...floodFill(boxMaze(2, 1, true), [1])]).toEqual([-1, 0])
  })
})

describe('wall follower and Trémaux', () => {
  it('a hand rule solves every perfect maze', () => {
    for (let s = 1; s <= 10; s++) {
      const m = genMaze(8, 8, s)
      expect(wallFollow(m, 0, 0, centreGoal(m), 'left').reached).toBe(true)
      expect(wallFollow(m, 0, 0, centreGoal(m), 'right').reached).toBe(true)
    }
  })
  it('both hands circle forever when the goal is an island; Trémaux still gets there', () => {
    for (let s = 1; s <= 10; s++) {
      const m = genMaze(8, 8, s, { island: true, loops: 4 })
      const g = centreGoal(m)
      expect(floodFill(m, g)[0]).toBeGreaterThan(0)
      for (const hand of ['left', 'right'] as const) {
        const w = wallFollow(m, 0, 0, g, hand)
        expect(w.reached).toBe(false)
        expect(w.looped).toBe(true)
      }
      const t = tremaux(m, 0, 0, g)
      expect(t.reached).toBe(true)
      expect(Math.max(...t.marks)).toBeLessThanOrEqual(2)
    }
  })
  it('loops back to its start state in an open ring', () => {
    // 3 × 3 with a centre pillar of walls round cell 4: the outer ring is a loop, the goal (4) sealed
    const m = boxMaze(3, 3, false)
    for (let d = 0; d < 4; d++) setWall(m, 4, d, true)
    const w = wallFollow(m, 0, 0, [4], 'left')
    expect(w.looped).toBe(true)
    expect(w.cells).toEqual([0, 3, 6, 7, 8, 5, 2, 1, 0, 3]) // (3, N) again: one lap, forever
  })
})

describe('micromouse', () => {
  it('perfect maze: search reaches the goal and the fast run is the shortest path', () => {
    for (let s = 1; s <= 6; s++) {
      const m = genMaze(8, 8, s)
      const r = mouseRun(m, centreGoal(m), false)
      const last = r.steps.filter((x) => x.phase === 'search').pop()!
      expect(centreGoal(m)).toContain(last.cell)
      expect(r.fast).toBe(r.best)
      expect(r.search).toBeGreaterThanOrEqual(r.best)
    }
  })
  it('island maze with a return trip: fast run between the shortest and the first search', () => {
    for (let s = 1; s <= 6; s++) {
      const m = genMaze(8, 8, s, { island: true, loops: 4 })
      const r = mouseRun(m, centreGoal(m), true)
      expect(r.fast).toBeGreaterThanOrEqual(r.best)
      expect(r.fast).toBeLessThanOrEqual(r.search)
      expect(r.steps.filter((x) => x.phase === 'return').pop()!.cell).toBe(0)
      expect(r.refloods).toBe(r.search + r.back + 2)
    }
  })
})

describe('cell drive', () => {
  it('turns on the spot then drives one cell', () => {
    const m = boxMaze(2, 1, false)
    const d = cellDrive(m, [0, 1], Math.PI / 2, 4, 0.25)
    const end = d.poses[d.poses.length - 1]
    expect(end.x).toBeCloseTo(0.375, 9)
    expect(end.y).toBeCloseTo(0.125, 9)
    expect(end.th).toBeCloseTo(0, 9)
    expect(d.dL[d.dL.length - 1] - d.dR[d.dR.length - 1]).toBeCloseTo((Math.PI / 2) * TT_TRACK_M, 9)
    expect(d.poses.length).toBe(9)
  })
})
