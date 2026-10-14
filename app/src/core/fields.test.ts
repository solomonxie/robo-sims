import { Vec3, chargeLines, inverseSquare, norm, ringSeeds, traceLine } from './fields'

const dist = (a: Vec3, b: Vec3) => norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]])

describe('fields', () => {
  it('superposes inverse-square sources', () => {
    expect(inverseSquare([{ q: 2, at: [0, 0, 0] }], [2, 0, 0])).toEqual([0.5, 0, 0])
    const mid = inverseSquare([{ q: 1, at: [-1, 0, 0] }, { q: 1, at: [1, 0, 0] }], [0, 0, 0])
    expect(norm(mid)).toBeCloseTo(0, 12)
    const dipole = inverseSquare([{ q: 1, at: [-1, 0, 0] }, { q: -1, at: [1, 0, 0] }], [0, 0, 0])
    expect(dipole[0]).toBeCloseTo(2, 12)
    expect(inverseSquare([{ q: 1, at: [0, 0, 0] }], [0, 0, 0])).toEqual([0, 0, 0])
  })

  it('a single charge’s line runs straight out', () => {
    const f = (p: Vec3) => inverseSquare([{ q: 1, at: [0, 0, 0] }], p)
    const line = traceLine(f, [0, 1, 0], { step: 0.5, maxSteps: 10 })
    expect(line).toHaveLength(11)
    for (const p of line) expect(Math.abs(p[0]) + Math.abs(p[2])).toBeLessThan(1e-9)
    expect(line[10][1]).toBeCloseTo(6, 9)
    expect(traceLine(f, [0, 3, 0], { step: 0.5, maxSteps: 2, dir: -1 })[2][1]).toBeCloseTo(2, 9)
  })

  it('dipole lines leave + and end on −', () => {
    const f = (p: Vec3) => inverseSquare([{ q: 1, at: [-2, 0, 0] }, { q: -1, at: [2, 0, 0] }], p)
    const near = (p: Vec3) => dist(p, [2, 0, 0]) < 0.3
    for (const s of ringSeeds([-2, 0, 0], 0.3, 6, 0.3).slice(0, 3)) {
      const line = traceLine(f, s, { step: 0.05, maxSteps: 4000, stop: near })
      expect(near(line[line.length - 1])).toBe(true)
    }
  })

  it('a circling field closes its loop', () => {
    const swirl = (p: Vec3): Vec3 => [-p[1], p[0], 0]
    const line = traceLine(swirl, [3, 0, 0], { step: 0.05, maxSteps: 2000, closeWithin: 0.1 })
    expect(line.length).toBeLessThan(400)
    expect(line[line.length - 1]).toEqual([3, 0, 0])
    for (const p of line) expect(norm(p)).toBeCloseTo(3, 2)
  })

  it('seeds a ring', () => {
    const s = ringSeeds([1, 1, 0], 2, 4)
    expect(s[0]).toEqual([3, 1, 0])
    expect(s[1][0]).toBeCloseTo(1, 12)
    expect(s[1][1]).toBeCloseTo(3, 12)
  })
})

describe('chargeLines', () => {
  it('draws perUnit lines per unit charge; the smaller side adds only lines that escape', () => {
    expect(chargeLines([{ q: 2, at: [0, 0, 0] }], { perUnit: 4 })).toHaveLength(8)
    expect(chargeLines([{ q: -1, at: [-4, 0, 0] }, { q: -2, at: [4, 0, 0] }], { perUnit: 4 })).toHaveLength(12)
    expect(chargeLines([{ q: 0, at: [0, 0, 0] }])).toHaveLength(0)
    const big = chargeLines([{ q: 3, at: [-2, 0, 0] }, { q: -1, at: [2, 0, 0] }], { perUnit: 4, box: [60, 60], step: 0.1, maxSteps: 3000 })
    expect(big).toHaveLength(12)
    const dipole = chargeLines([{ q: 1, at: [-2, 0, 0] }, { q: -1, at: [2, 0, 0] }], { perUnit: 8, box: [6, 6] })
    const escapeIn = dipole.filter((l) => l[l.length - 1][0] === 2 && Math.abs(l[0][0]) + Math.abs(l[0][1]) > 6)
    const escapeOut = dipole.filter((l) => l[0][0] === -2 && Math.abs(l[l.length - 1][0]) + Math.abs(l[l.length - 1][1]) > 6)
    expect(escapeIn.length).toBe(escapeOut.length)
    expect(escapeIn.length).toBeGreaterThan(0)
  })

  it('lines start at their charge and end on the opposite charge or the box edge', () => {
    const lines = chargeLines([{ q: 1, at: [-4, 0, 0] }, { q: -1, at: [4, 0, 0] }], { perUnit: 8, box: [16, 10] })
    const atPlus = (p: Vec3) => dist(p, [-4, 0, 0]) === 0
    const atMinus = (p: Vec3) => dist(p, [4, 0, 0]) === 0
    const outside = (p: Vec3) => Math.abs(p[0]) > 16 || Math.abs(p[1]) > 10
    for (const l of lines) {
      const [a, b] = [l[0], l[l.length - 1]]
      expect((atPlus(a) && (atMinus(b) || outside(b))) || (outside(a) && atMinus(b))).toBe(true)
    }
    const inward = chargeLines([{ q: -1, at: [0, 0, 0] }], { perUnit: 4, box: [5, 5] })
    for (const l of inward) {
      expect(norm(l[0])).toBeGreaterThan(5)
      expect(l[l.length - 1]).toEqual([0, 0, 0])
    }
  })
})
