import { MinHeap } from '../common'
import { FLAT, GRID_MAP, GRID_ROOMS, GridMap, SURPRISES, TRAP, cellAtM, dstarLiteRun, gridNeighbours, gridSearch, heuristic, roomGridMap, searchAt, withSolids } from './gridsearch'

const open = (w: number, h: number, walls: number[] = []): GridMap => {
  const blocked = new Uint8Array(w * h)
  for (const c of walls) blocked[c] = 1
  return { w, h, res: 0.2, blocked, pen: new Uint8Array(w * h) }
}
const ends = (m: GridMap) => [cellAtM(m, ...GRID_MAP.start), cellAtM(m, ...GRID_MAP.goal)] as const

describe('min heap', () => {
  it('pops in sorted order', () => {
    const h = new MinHeap<number>((a, b) => a < b)
    const xs = Array.from({ length: 200 }, (_, i) => (i * 7919) % 101)
    xs.forEach((x) => h.push(x))
    const out: number[] = []
    while (h.size) out.push(h.pop()!)
    expect(out).toEqual([...xs].sort((a, b) => a - b))
    expect(h.pop()).toBeUndefined()
  })
})

describe('grid search', () => {
  it('BFS expands a 3 × 3 grid ring by ring', () => {
    const r = gridSearch(open(3, 3), 0, 8, { algo: 'bfs', conn: 4 })
    expect(r.order).toEqual([0, 3, 1, 6, 4, 2, 7, 5, 8])
    expect(r.cost).toBe(40)
    expect(searchAt(r, 9, 2).closed[3]).toBe(1)
    expect(searchAt(r, 9, 2).closed[1]).toBe(0)
  })
  it('steps cost 10 / 14, no corner cutting', () => {
    expect(gridNeighbours(open(2, 2), 0, 8)).toEqual([[2, 10], [1, 10], [3, 14]])
    expect(gridNeighbours(open(2, 2, [1]), 0, 8)).toEqual([[2, 10]])
    expect(gridSearch(open(3, 3), 0, 8, { algo: 'dijkstra', conn: 8 }).cost).toBe(28)
  })
  it('heuristics: Manhattan overestimates a diagonal, octile is exact on open ground', () => {
    const m = open(5, 5)
    expect(heuristic('manhattan', m, 0, 24)).toBe(80)
    expect(heuristic('octile', m, 0, 24)).toBe(56)
    expect(heuristic('euclid', m, 0, 24)).toBeCloseTo(56.57, 2)
    expect(gridSearch(m, 0, 24, { algo: 'dijkstra', conn: 8 }).cost).toBe(56)
  })
  it('A* with an admissible h finds the Dijkstra cost with fewer expansions', () => {
    for (const room of Object.values(GRID_ROOMS))
      for (const clearance of [false, true])
        for (const conn of [4, 8] as const) {
          const m = roomGridMap(room, undefined, clearance)
          const [s, g] = ends(m)
          const d = gridSearch(m, s, g, { algo: 'dijkstra', conn })
          for (const heur of conn === 4 ? (['manhattan', 'euclid', 'octile'] as const) : (['euclid', 'octile'] as const)) {
            const a = gridSearch(m, s, g, { algo: 'astar', conn, heur })
            expect(a.cost).toBe(d.cost)
            expect(a.order.length).toBeLessThan(d.order.length)
          }
          for (const w of [1.5, 3]) expect(gridSearch(m, s, g, { algo: 'astar', conn, heur: 'octile', weight: w }).cost).toBeLessThanOrEqual(w * d.cost)
        }
  })
  it('greedy walks into the trap: fewest expansions, not the cheapest route with clearance', () => {
    const m = roomGridMap(TRAP, undefined, true)
    const [s, g] = ends(m)
    const greedy = gridSearch(m, s, g, { algo: 'greedy', conn: 8, heur: 'octile' })
    const astar = gridSearch(m, s, g, { algo: 'astar', conn: 8, heur: 'octile' })
    expect(greedy.order.length).toBeLessThan(astar.order.length)
    expect(greedy.cost).toBeGreaterThan(astar.cost)
  })
  it('BFS ignores costs; Dijkstra uses the clearance cost to stay off the walls', () => {
    const m = roomGridMap(FLAT, undefined, true)
    const [s, g] = ends(m)
    const bfs = gridSearch(m, s, g, { algo: 'bfs', conn: 8 })
    const dij = gridSearch(m, s, g, { algo: 'dijkstra', conn: 8 })
    const plain = gridSearch(roomGridMap(FLAT), s, g, { algo: 'dijkstra', conn: 8 })
    expect(bfs.path.length).toBeLessThanOrEqual(dij.path.length)
    expect(dij.cost).toBeLessThan(bfs.cost)
    expect(dij.path).not.toEqual(plain.path)
    const pen = (p: number[]) => p.reduce((t, c) => t + m.pen[c], 0)
    expect(pen(dij.path)).toBeLessThan(pen(plain.path))
  })
  it('unreachable goal: empty path, every reachable cell expanded', () => {
    const r = gridSearch(open(3, 3, [1, 4, 7]), 0, 2, { algo: 'astar', conn: 8, heur: 'octile' })
    expect(r.path).toEqual([])
    expect(r.cost).toBe(Infinity)
    expect(r.order.length).toBe(3)
  })
})

describe('D* Lite', () => {
  it('keeps g(robot) equal to a fresh search on what it knows, and reaches the goal', () => {
    for (const k of Object.keys(SURPRISES) as (keyof typeof SURPRISES)[])
      for (const range of [1, 3]) {
        const known = roomGridMap(FLAT)
        const truth = roomGridMap(withSolids(FLAT, SURPRISES[k]))
        const [s, g] = ends(known)
        const fr = dstarLiteRun(truth, known, s, g, range)
        expect(fr[fr.length - 1].at).toBe(g)
        for (const f of fr) expect(f.g[f.at]).toBe(gridSearch({ ...known, blocked: f.known }, f.at, g, { algo: 'dijkstra', conn: 8 }).cost)
      }
  })
  it('repairs only when it sees something new', () => {
    const known = roomGridMap(FLAT)
    const fr = dstarLiteRun(roomGridMap(withSolids(FLAT, SURPRISES.clutter)), known, ...ends(known), 2)
    expect(fr.some((f) => f.seen.length && f.dstar > 0)).toBe(true)
    for (const f of fr.slice(1)) if (!f.seen.length) expect([f.dstar, f.astar]).toEqual([0, 0])
  })
})
