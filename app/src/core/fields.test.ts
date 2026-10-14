import { Vec3, chargeLines, coilField, cross, ellipticKE, inverseSquare, loopField, loopLines, norm, ringSeeds, traceLine, wireField } from './fields'

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

describe('magnetic fields', () => {
  it('cross product follows the right hand', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
  })

  it('a wire’s field circles it and falls as 1 / r', () => {
    const b = wireField([0.1, 0, 5])
    expect(b[0]).toBeCloseTo(0, 12)
    expect(b[1]).toBeCloseTo(1 / (2 * Math.PI * 0.1), 9)
    expect(norm(wireField([0, -0.2, 0])) * 2).toBeCloseTo(norm(wireField([0.1, 0, 0])), 9)
    const loop = traceLine(wireField, [2, 0, 0], { step: 0.05, maxSteps: 2000, closeWithin: 0.05 })
    expect(loop[loop.length - 1]).toEqual([2, 0, 0])
    for (const p of loop) expect(norm(p)).toBeCloseTo(2, 2)
  })

  it('elliptic integrals', () => {
    expect(ellipticKE(0)[0]).toBeCloseTo(Math.PI / 2, 12)
    expect(ellipticKE(0)[1]).toBeCloseTo(Math.PI / 2, 12)
    expect(ellipticKE(0.5)[0]).toBeCloseTo(1.8540746773, 9)
    expect(ellipticKE(0.5)[1]).toBeCloseTo(1.3506438810, 9)
  })

  it('a loop: μ₀I / 2a at its centre, μ₀Ia² / 2(a² + z²)^1.5 on its axis', () => {
    expect(loopField(0.05, 0, [0, 0, 0])[0]).toBeCloseTo(1 / 0.1, 9)
    expect(loopField(2, 1, [4, 0, 0])[0]).toBeCloseTo(4 / (2 * 13 ** 1.5), 9)
    const off = loopField(1, 0, [0.5, 0.7, 0])
    const mirror = loopField(1, 0, [-0.5, 0.7, 0])
    expect(off[0]).toBeCloseTo(mirror[0], 12)
    expect(off[1]).toBeCloseTo(-mirror[1], 12)
    const round = loopField(1, 0, [0.5, 0, 0.7])
    expect(round[2]).toBeCloseTo(off[1], 12)
  })

  it('a long solenoid holds n = N / L inside and little outside', () => {
    expect(coilField(0.01, 1, 1000, [0, 0, 0])[0]).toBeCloseTo(1000, -1)
    expect(coilField(0.01, 1, 1000, [0.5, 0, 0])[0] / 1000).toBeCloseTo(0.5, 2)
    expect(Math.abs(coilField(0.01, 1, 1000, [0, 0.05, 0])[0])).toBeLessThan(1)
  })

  it('loop lines close round a coil or run edge to edge', () => {
    const field = (p: Vec3) => coilField(2, 8, 20, p)
    const [axis, inner] = loopLines(field, [[0, 0, 0], [0, 1.7, 0]], { step: 0.1, box: [14, 9] })
    expect(Math.abs(axis[0][0])).toBeGreaterThan(14)
    expect(axis[axis.length - 1][0]).toBeGreaterThan(14)
    expect(inner[inner.length - 1]).toEqual([0, 1.7, 0])
    expect(inner.some((p) => p[1] > 2.5)).toBe(true)
  })
})
