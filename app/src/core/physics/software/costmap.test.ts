import { walledRoom } from '../room'
import {
  INSCRIBED,
  LETHAL,
  NAV,
  NAV_DROP,
  alongPath,
  blankLike,
  cellOf,
  costAt,
  costmapRun,
  inflate,
  inflationCost,
  markAndClear,
  maxLayers,
  pathLength,
  planGrid,
  roomGrid,
  scanHits,
  staticLayer,
} from './costmap'

const ROOM = walledRoom(3, 2, 1, [{ kind: 'box', name: 'wall', x: [1.4, 1.6], y: [0, 1.4], h: 1, refl: 0.5 }])

describe('costmap layers', () => {
  it('marks walls and solids lethal in the static layer', () => {
    const g = staticLayer(ROOM, 0.1)
    expect(costAt(g, -0.05, 1)).toBe(LETHAL)
    expect(costAt(g, 1.5, 0.5)).toBe(LETHAL)
    expect(costAt(g, 0.75, 1)).toBe(0)
    expect(costAt(g, 1.5, 1.7)).toBe(0)
  })

  it('inflates: inscribed, then decaying, then free', () => {
    expect(inflationCost(0, 0.2, 0.6, 3)).toBe(LETHAL)
    expect(inflationCost(0.15, 0.2, 0.6, 3)).toBe(INSCRIBED)
    expect(inflationCost(0.4, 0.2, 0.6, 3)).toBe(Math.floor(252 * Math.exp(-0.6)))
    expect(inflationCost(0.7, 0.2, 0.6, 3)).toBe(0)
    const g = inflate(staticLayer(ROOM, 0.1), 0.2, 0.6, 3)
    expect(costAt(g, 1.25, 0.5)).toBe(INSCRIBED)
    expect(costAt(g, 1.05, 0.5)).toBeGreaterThan(costAt(g, 0.95, 0.5))
    expect(costAt(g, 0.75, 1)).toBe(0)
  })

  it('obstacle layer marks scan hits and clears along the beam', () => {
    const g = blankLike(roomGrid(ROOM, 0.1))
    const c = cellOf(g, 0.75, 0.5)!
    g.cost[c[1] * g.nx + c[0]] = LETHAL
    markAndClear(g, { x: 0.5, y: 0.5, th: 0 }, scanHits(ROOM, { x: 0.5, y: 0.5, th: 0 }, 4, 5))
    expect(costAt(g, 0.75, 0.5)).toBe(0)
    expect(costAt(g, 1.45, 0.5)).toBe(LETHAL)
  })

  it('max of layers wins', () => {
    const a = blankLike(roomGrid(ROOM, 0.1))
    const b = blankLike(a)
    a.cost[3] = 10
    b.cost[3] = 20
    b.cost[4] = 5
    const m = maxLayers(a, b)
    expect([m.cost[3], m.cost[4]]).toEqual([20, 5])
  })
})

describe('A* on the costmap', () => {
  it('goes around the wall, away from it when inflated', () => {
    const still = staticLayer(ROOM, 0.1)
    const bare = planGrid(still, [0.5, 0.5], [2.5, 0.5])!
    const soft = planGrid(maxLayers(still, inflate(still, 0.2, 0.6, 3)), [0.5, 0.5], [2.5, 0.5])!
    expect(bare.path.some(([, y]) => y > 1.4)).toBe(true)
    expect(pathLength(soft.path)).toBeGreaterThan(pathLength(bare.path))
    expect(planGrid(still, [0.5, 0.5], [1.5, 0.5])).toBeNull()
  })

  it('walks along a polyline', () => {
    const p = alongPath([[0, 0], [1, 0], [1, 1]], 1.5)
    expect(p.at[0]).toBeCloseTo(1)
    expect(p.at[1]).toBeCloseTo(0.5)
    expect(p.dir).toBeCloseTo(Math.PI / 2)
  })
})

describe('costmap run', () => {
  const near = costmapRun(0.55, false)
  const dropped = costmapRun(0.55, true)
  const passes = (f: typeof near, y: (v: number) => boolean) => f.some((q) => Math.abs(q.pose.x - 2.95) < 0.1 && y(q.pose.y))
  it('takes the near doorway, re-plans through the far one after the drop', () => {
    expect(near[near.length - 1].reached).toBe(true)
    expect(passes(near, (y) => y < 0.9)).toBe(true)
    expect(dropped[dropped.length - 1].reached).toBe(true)
    expect(passes(dropped, (y) => y > 3.1)).toBe(true)
    const seen = dropped.find((f) => f.t > NAV.dropS && costAt(f.obs, NAV_DROP.kind === 'box' ? NAV_DROP.x[0] + 0.05 : 0, 0.5) === LETHAL)
    expect(seen!.t).toBeLessThan(NAV.dropS + 0.3)
  })
})
