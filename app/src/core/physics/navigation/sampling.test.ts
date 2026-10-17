import { seededRng } from '../common'
import { walledRoom } from '../room'
import { XY, pathLength } from '../software/costmap'
import { FLAT, GRID_MAP, TRAP } from './gridsearch'
import { SAMPLING, cutCorners, pathClearance, rrtPath, rrtRun, segmentFree, sharpestTurn, shortcutRun, treeAt, turnSum } from './sampling'

const OPEN = walledRoom(3, 2, 0.3, [])
const S = GRID_MAP.start
const G = GRID_MAP.goal
const allFree = (room: typeof FLAT, p: XY[]) => p.slice(1).every((q, i) => segmentFree(room, p[i], q))

describe('seeded rng', () => {
  it('repeats per seed and stays in [0, 1)', () => {
    const [a, b, c] = [seededRng(3), seededRng(3), seededRng(4)]
    const xs = Array.from({ length: 50 }, a)
    expect(Array.from({ length: 50 }, b)).toEqual(xs)
    expect(c()).not.toBe(xs[0])
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
})

describe('segment check', () => {
  it('open floor is free, a divider blocks, a wall closer than r blocks', () => {
    expect(segmentFree(OPEN, [0.5, 1], [2.5, 1])).toBe(true)
    expect(segmentFree(FLAT, [1, 1], [2.5, 1])).toBe(false)
    expect(segmentFree(FLAT, [1, 0.5], [2.5, 0.5])).toBe(true)
    expect(segmentFree(OPEN, [0.5, 0.1], [2.5, 0.1])).toBe(false)
    expect(segmentFree(OPEN, [0.5, 0.13], [2.5, 0.13])).toBe(true)
  })
})

describe('RRT', () => {
  it('finds a straight-ish path in an open room', () => {
    const r = rrtRun(OPEN, [0.3, 0.3], [2.7, 1.7], { step: 0.3, bias: 0.1, star: false, seed: 1 })
    expect(r.firstAt).toBeGreaterThanOrEqual(0)
    const p = rrtPath(r, r.parent, r.iters[r.iters.length - 1].bestNode)
    expect(pathLength(p)).toBeGreaterThanOrEqual(Math.hypot(2.4, 1.4) - 1e-9)
    expect(allFree(OPEN, p)).toBe(true)
  })
  it('gets through the two rooms, same seed same tree', () => {
    const o = { step: 0.25, bias: 0.1, star: false, seed: 2 }
    const a = rrtRun(FLAT, S, G, o)
    expect(a.firstAt).toBeGreaterThanOrEqual(0)
    expect(rrtRun(FLAT, S, G, o).pts).toEqual(a.pts)
    const last = a.iters[a.iters.length - 1]
    expect(allFree(FLAT, rrtPath(a, a.parent, last.bestNode))).toBe(true)
    expect(a.iters.slice(a.firstAt).every((it) => it.best === a.iters[a.firstAt].best)).toBe(true)
  })
  it('RRT* cost never rises and ends below its first path', () => {
    for (const room of [FLAT, TRAP]) {
      const r = rrtRun(room, S, G, { step: 0.25, bias: 0.1, star: true, seed: 5 })
      const b = r.iters.map((it) => it.best)
      expect(r.firstAt).toBeGreaterThanOrEqual(0)
      b.slice(1).forEach((x, i) => expect(x).toBeLessThanOrEqual(b[i] + 1e-9))
      expect(b[b.length - 1]).toBeLessThan(b[r.firstAt])
      const p = rrtPath(r, r.parent, r.iters[r.iters.length - 1].bestNode)
      expect(pathLength(p)).toBeCloseTo(b[b.length - 1], 6)
      expect(allFree(room, p)).toBe(true)
    }
  })
  it('replaying every sample rebuilds the final tree', () => {
    const r = rrtRun(FLAT, S, G, { step: 0.25, bias: 0.1, star: true, seed: 3, n: 300 })
    expect(Array.from(treeAt(r, r.iters.length - 1))).toEqual(r.parent)
    expect(treeAt(r, 0).filter((p) => p !== -2).length).toBeLessThanOrEqual(2)
  })
})

describe('smoothing', () => {
  const zig: XY[] = [[0.3, 0.3], [0.8, 1.5], [1.3, 0.4], [1.8, 1.6], [2.7, 1.0]]
  it('shortcuts an open-room zigzag to one chord', () => {
    const t = shortcutRun(OPEN, zig, 40, 1)
    expect(t[t.length - 1].path).toEqual([zig[0], zig[4]])
  })
  it('stops once every chord is blocked', () => {
    const t = shortcutRun(FLAT, [[1, 1], [1.875, 1.875], [2.5, 1]], 20, 1)
    expect(t).toHaveLength(1)
    expect(t[0].ok).toBe(false)
  })
  it('shortcuts and corner cuts keep ends, shorten and stay free', () => {
    const r = rrtRun(FLAT, S, G, { step: 0.25, bias: 0.1, star: false, seed: 2 })
    const raw = rrtPath(r, r.parent, r.iters[r.iters.length - 1].bestNode)
    const tries = shortcutRun(FLAT, raw, 30, 4)
    let prev = pathLength(raw)
    for (const t of tries) {
      expect(pathLength(t.path)).toBeLessThanOrEqual(prev + 1e-9)
      prev = pathLength(t.path)
    }
    const short = tries[tries.length - 1].path
    expect(allFree(FLAT, short)).toBe(true)
    const round = cutCorners(FLAT, cutCorners(FLAT, short))
    expect(round[0]).toEqual(S)
    expect(round[round.length - 1]).toEqual(G)
    expect(pathLength(round)).toBeLessThanOrEqual(pathLength(short) + 1e-9)
    expect(turnSum(round)).toBeLessThanOrEqual(turnSum(short) + 1e-9)
    expect(sharpestTurn(round)).toBeLessThan(sharpestTurn(short))
    expect(pathClearance(FLAT, round)).toBeGreaterThanOrEqual(SAMPLING.r - 0.01)
  })
  it('turn sum of a square corner and a straight line', () => {
    expect(turnSum([[0, 0], [1, 0], [1, 1]])).toBeCloseTo(Math.PI / 2)
    expect(turnSum([[0, 0], [1, 0], [2, 0]])).toBe(0)
    expect(sharpestTurn([[0, 0], [1, 0], [1, 1], [2, 1]])).toBeCloseTo(Math.PI / 2)
  })
})
