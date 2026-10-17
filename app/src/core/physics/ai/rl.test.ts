import { argmaxQ, discounted, evalPolicy, greedyPolicy, gwMove, gwOutcomes, gwRollout, parseGrid, qLearn, runningMean, valueIteration, valuesOf } from './rl'

const CLIFF = ['.......', '.......', '.##.#..', '.......', 'SPPPPPG']
const cliff = (step: number) => parseGrid(CLIFF, { step, goal: 10, pit: -10 })

describe('gridworld', () => {
  it('parses rows top first, y up', () => {
    const g = cliff(0)
    expect([g.w, g.h, g.start]).toEqual([7, 5, 0])
    expect(g.cells[6]).toBe('G')
    expect(g.cells[1]).toBe('P')
    expect(g.cells[2 * 7 + 1]).toBe('#')
  })
  it('walls and edges keep the robot in place', () => {
    const g = cliff(0)
    expect(gwMove(g, 0, 3)).toBe(0)
    expect(gwMove(g, 7 + 1, 0)).toBe(7 + 1)
    expect(gwMove(g, 0, 0)).toBe(7)
  })
  it('slip splits into the two perpendicular moves', () => {
    const o = gwOutcomes(cliff(-1), 7, 1, 0.2)
    expect(o.map((x) => x.p)).toEqual([0.8, 0.1, 0.1])
    expect(o.reduce((t, x) => t + x.p, 0)).toBeCloseTo(1)
    const down = o.find((x) => x.moved === 2)!
    expect(down).toMatchObject({ s2: 0, r: -1, done: false })
    const north = gwOutcomes(cliff(-1), 0, 1, 0).find((x) => x.moved === 1)!
    expect(north).toMatchObject({ s2: 1, r: -11, done: true })
  })
  it('argmax ties', () => {
    expect(argmaxQ([1, 3, 3, 0])).toBe(1)
    expect(argmaxQ([0, 0, 0, 0], () => 0.99)).toBe(3)
  })
  it('discounted return and running mean', () => {
    expect(discounted([1, 1, 1], 0.5)).toBeCloseTo(1.75)
    expect(runningMean([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7])
  })
})

describe('value iteration', () => {
  it('deterministic: V is the discounted goal reward along the shortest path', () => {
    const vi = valueIteration(cliff(0), 0.9, 0)
    expect(vi.V[13]).toBeCloseTo(10)
    expect(vi.V[12]).toBeCloseTo(9)
    expect(vi.V[7]).toBeCloseTo(10 * 0.9 ** 6)
    expect(vi.policy[13]).toBe(2)
    expect(vi.policy[12]).toBe(1)
  })
  it('step cost moves the route: long safe way, edge, then jump in', () => {
    const route = (step: number) => {
      const g = cliff(step)
      const vi = valueIteration(g, 0.95, 0.2)
      return evalPolicy(g, vi.policy, 0.2, 300, 1)
    }
    const cheap = route(-0.05)
    const dear = route(-1)
    const brutal = route(-3)
    expect(cheap.goal).toBeGreaterThan(0.98)
    expect(cheap.meanSteps).toBeGreaterThan(20)
    expect(dear.meanSteps).toBeLessThan(16)
    expect(dear.pit).toBeGreaterThan(0.05)
    expect(brutal.pit).toBe(1)
    expect(route(1).timeout).toBeGreaterThan(0.9)
  })
  it('skid on: the start pushes into the wall rather than risk the drop', () => {
    expect(valueIteration(cliff(-0.05), 0.95, 0.2).policy[0]).toBe(3)
  })
})

describe('Q-learning', () => {
  const trap = parseGrid(['.......G', '.#####..', '...N.#..', '.###.#..', 'S.......'], { step: 0, goal: 10, pit: -10, near: 1 })
  it('converges to value iteration on a deterministic world', () => {
    const g = cliff(-0.1)
    const R = qLearn(g, { episodes: 2000, alpha: 0.5, eps: 0.3, gamma: 0.9, slip: 0, seed: 2 })
    const vi = valueIteration(g, 0.9, 0)
    expect(valuesOf(R.Q)[0]).toBeCloseTo(vi.V[0], 1)
    expect(gwRollout(g, greedyPolicy(R.Q), 0, 1).log.length).toBe(gwRollout(g, vi.policy, 0, 1).log.length)
  })
  it('greedy from zero settles for the near prize; optimistic start finds the dock', () => {
    const run = (q0: number) => {
      const R = qLearn(trap, { episodes: 300, alpha: 0.5, eps: 0, gamma: 0.95, slip: 0, seed: 5, q0, snapEvery: 10 })
      expect(R.snaps.length).toBe(31)
      return gwRollout(trap, greedyPolicy(R.Q), 0, 1, 40)
    }
    expect(run(0).end).toBe('near')
    const opt = run(10)
    expect(opt.end).toBe('goal')
    expect(opt.log.length).toBe(11)
  })
  it('domain randomisation keeps off the edge; exact-sim policy falls on a skiddy floor', () => {
    const g = parseGrid(['........', '........', '........', 'SPPPPPPG'], { step: -1, goal: 20, pit: -20 })
    const train = (slip: number | [number, number]) => greedyPolicy(qLearn(g, { episodes: 3000, alpha: 0.1, eps: 0.2, gamma: 0.97, slip, seed: 3 }).Q)
    const exact = train(0)
    const random = train([0, 0.3])
    expect(evalPolicy(g, exact, 0, 200, 1).goal).toBe(1)
    expect(evalPolicy(g, exact, 0.2, 500, 9).goal).toBeLessThan(0.6)
    expect(evalPolicy(g, random, 0.2, 500, 9).goal).toBeGreaterThan(0.8)
  })
})
