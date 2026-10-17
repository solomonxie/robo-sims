import { assignTotal, auctionAssign, boidRules, costMatrix, driveToGoals, flockRun, greedyAssign, groupsOf, optimalAssign, polarisation, taskLayout, tripCrossings } from './swarm'
import { parkMiller } from '../common'

describe('boid rules', () => {
  const self = { x: 0, y: 0, vx: 0.2, vy: 0 }
  const mates = [
    { x: 0.2, y: 0, vx: 0, vy: 0.2 },
    { x: 0, y: 1, vx: 0, vy: 0.2 },
  ]
  it('hand-worked vectors for two neighbours', () => {
    const r = boidRules(self, mates, 0.35)
    expect(r.sep[0]).toBeCloseTo(-0.2 / 0.04)
    expect(r.sep[1]).toBeCloseTo(0)
    expect(r.ali[0]).toBeCloseTo(-0.2)
    expect(r.ali[1]).toBeCloseTo(0.2)
    expect(r.coh[0]).toBeCloseTo(0.1)
    expect(r.coh[1]).toBeCloseTo(0.5)
  })
  it('no neighbours, no push', () => {
    expect(boidRules(self, [], 0.35)).toEqual({ sep: [0, 0], ali: [0, 0], coh: [0, 0] })
  })
  it('polarisation and groups', () => {
    expect(polarisation([0.3, 0.3, 0.3])).toBeCloseTo(1)
    expect(polarisation([0, Math.PI])).toBeCloseTo(0)
    expect(groupsOf([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }], 0.6)).toBe(2)
  })
})

describe('flocking run', () => {
  const all = flockRun({ range: 0.9, loss: 0, rules: 'all' })
  const end = all[all.length - 1]
  it('lines up into one flock with all three rules', () => {
    expect(all[0].order).toBeLessThan(0.6)
    expect(end.order).toBeGreaterThan(0.85)
    expect(end.groups).toBeLessThanOrEqual(2)
  })
  it('separation keeps them from bumping', () => {
    const nosep = flockRun({ range: 0.9, loss: 0, rules: 'nosep' })
    expect(nosep[nosep.length - 1].bumps).toBeGreaterThan(end.bumps)
  })
  it('packet loss drops links', () => {
    const lossy = flockRun({ range: 0.9, loss: 0.8, rules: 'all' })
    expect(lossy[0].links.length).toBeLessThan(all[0].links.length)
  })
})

describe('task allocation', () => {
  const C = [
    [1, 2],
    [2, 10],
  ]
  it('greedy takes the cheapest pair first and ends worse', () => {
    const g = greedyAssign(C)
    expect(g.picks[0]).toEqual([0, 0])
    expect(assignTotal(C, g.assign)).toBe(11)
    expect(optimalAssign(C).total).toBe(4)
  })
  it('auction finds the optimum on a tiny matrix', () => {
    const a = auctionAssign(C, 0.1)
    expect(a.assign).toEqual([1, 0])
    expect(a.rounds.length).toBeGreaterThan(1)
  })
  it('auction stays within n·ε of the optimum; bigger ε, fewer rounds', () => {
    const rng = parkMiller(3)
    const rounds = [0, 0]
    for (let k = 0; k < 20; k++) {
      const M = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => rng() * 3))
      const opt = optimalAssign(M).total
      const fine = auctionAssign(M, 0.01)
      expect(assignTotal(M, fine.assign)).toBeLessThanOrEqual(opt + 6 * 0.01 + 1e-9)
      expect(new Set(fine.assign).size).toBe(6)
      rounds[0] += fine.rounds.length
      rounds[1] += auctionAssign(M, 0.5).rounds.length
    }
    expect(rounds[1]).toBeLessThan(rounds[0])
  })
  it('the optimal plan has no crossing trips', () => {
    for (let s = 1; s <= 8; s++) {
      const L = taskLayout(6, s)
      const M = costMatrix(L.robots, L.tasks)
      expect(tripCrossings(L.robots, L.tasks, optimalAssign(M).assign)).toEqual([])
    }
  })
  it('crossing point of two swapped trips', () => {
    const robots = [{ x: 0, y: 0 }, { x: 0, y: 2 }]
    const x = tripCrossings(robots, [[2, 0], [2, 2]], [1, 0])
    expect(x).toHaveLength(1)
    expect(x[0][0]).toBeCloseTo(1)
    expect(x[0][1]).toBeCloseTo(1)
    expect(tripCrossings(robots, [[2, 0], [2, 2]], [0, 1])).toEqual([])
  })
  it('robots reach their goals', () => {
    const L = taskLayout(4, 2)
    const run = driveToGoals(L.robots, L.tasks)
    const last = run[run.length - 1].poses
    last.forEach((p, i) => expect(Math.hypot(p.x - L.tasks[i][0], p.y - L.tasks[i][1])).toBeLessThan(0.03))
  })
})
