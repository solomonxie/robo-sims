import { Element, branchCurrents, gaussSolve, kclResidual, loopSteps, loopSum, relaxNode, relaxSweep, solveNodal, stamp, theveninAt } from './nodal'

const R = (a: number, b: number, ohms: number): Element => ({ kind: 'R', a, b, ohms })
const V = (a: number, b: number, volts: number): Element => ({ kind: 'V', a, b, volts })
const I = (a: number, b: number, amps: number): Element => ({ kind: 'I', a, b, amps })

describe('gaussSolve', () => {
  it('solves a 3×3 system that needs a row swap', () => {
    const x = gaussSolve(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 0],
      ],
      [7, 6, 4],
    )!
    expect(x[0]).toBeCloseTo(1)
    expect(x[1]).toBeCloseTo(2)
    expect(x[2]).toBeCloseTo(3)
  })
  it('returns null for a singular matrix', () => {
    expect(
      gaussSolve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull()
  })
})

describe('stamp', () => {
  it('puts 1/R on the diagonal and −1/R off it', () => {
    const { a } = stamp(2, [R(1, 2, 100), R(2, 0, 200)])
    expect(a[0][0]).toBeCloseTo(0.01)
    expect(a[0][1]).toBeCloseTo(-0.01)
    expect(a[1][1]).toBeCloseTo(0.015)
  })
  it('rejects zero ohms and unknown nodes', () => {
    expect(() => stamp(1, [R(1, 0, 0)])).toThrow()
    expect(() => stamp(1, [R(2, 0, 10)])).toThrow()
  })
})

describe('solveNodal', () => {
  it('a 1k over 2k divider on 9 V taps 6 V and draws 3 mA', () => {
    const s = solveNodal(2, [V(1, 0, 9), R(1, 2, 1000), R(2, 0, 2000)])!
    expect(s.volts[0]).toBe(0)
    expect(s.volts[2]).toBeCloseTo(6)
    expect(s.amps[1]).toBeCloseTo(0.003)
    expect(s.amps[0]).toBeCloseTo(-0.003) // through the source from + to −: delivering
  })
  it('a current source into two parallel 200 Ω gives I × 100 Ω', () => {
    const s = solveNodal(1, [I(0, 1, 0.01), R(1, 0, 200), R(1, 0, 200)])!
    expect(s.volts[1]).toBeCloseTo(1)
  })
  it('a floating source sets a difference, not a level', () => {
    const s = solveNodal(3, [V(1, 0, 10), R(1, 2, 1000), V(2, 3, 2), R(3, 0, 1000)])!
    expect(s.volts[2] - s.volts[3]).toBeCloseTo(2)
    expect(s.volts[2]).toBeCloseTo(6)
    expect(s.amps[1]).toBeCloseTo(0.004)
  })
  it('an unbalanced Wheatstone bridge: KCL holds at every node and every loop sums to 0', () => {
    const els = [V(1, 0, 9), R(1, 2, 100), R(2, 0, 220), R(1, 3, 220), R(3, 0, 100), R(2, 3, 330)]
    const s = solveNodal(3, els)!
    for (const r of kclResidual(3, els, s.amps)) expect(r).toBeCloseTo(0, 12)
    expect(loopSum(s.volts, [0, 1, 2, 3])).toBeCloseTo(0, 12)
    expect(s.volts[2]).toBeGreaterThan(s.volts[3])
  })
  it('a balanced bridge carries nothing across the middle', () => {
    const s = solveNodal(3, [V(1, 0, 9), R(1, 2, 100), R(2, 0, 200), R(1, 3, 1000), R(3, 0, 2000), R(2, 3, 47)])!
    expect(s.amps[5]).toBeCloseTo(0, 12)
    expect(s.volts[2]).toBeCloseTo(6)
  })
  it('null for a floating node or two sources fighting', () => {
    expect(solveNodal(2, [V(1, 0, 5), R(1, 0, 10), R(2, 2, 10)])).toBeNull()
    expect(solveNodal(1, [V(1, 0, 5), V(1, 0, 3)])).toBeNull()
  })
})

describe('loops and branches', () => {
  it('steps around a loop: up the cell, down the parts, back to 0', () => {
    expect(loopSteps([0, 9, 6], [0, 1, 2])).toEqual([9, -3, -6])
    expect(loopSum([0, 9, 6], [0, 1, 2])).toBe(0)
  })
  it('branch currents follow ΔV / R; sources read 0', () => {
    expect(branchCurrents([V(1, 0, 9), R(1, 2, 1000), I(2, 0, 0.5)], [0, 9, 6])).toEqual([0, 0.003, 0.5])
  })
})

describe('relaxSweep', () => {
  it('converges to the exact answer on a bridge', () => {
    const els = [V(1, 0, 9), R(1, 2, 100), R(2, 0, 220), R(1, 3, 220), R(3, 0, 100), R(2, 3, 330), I(0, 3, 0.002)]
    const exact = solveNodal(3, els)!
    let v = [0, 0, 0, 0]
    v = relaxSweep(3, els, v)
    expect(v[1]).toBe(9)
    for (let k = 0; k < 60; k++) v = relaxSweep(3, els, v)
    for (let k = 0; k <= 3; k++) expect(v[k]).toBeCloseTo(exact.volts[k], 9)
  })
  it('each sweep shrinks the error', () => {
    const els = [V(1, 0, 9), R(1, 2, 100), R(2, 0, 100), R(2, 3, 100), R(3, 0, 100)]
    const exact = solveNodal(3, els)!.volts
    const err = (v: number[]) => Math.abs(v[2] - exact[2]) + Math.abs(v[3] - exact[3])
    let v = relaxSweep(3, els, [0, 0, 0, 0])
    for (let k = 0; k < 5; k++) {
      const next = relaxSweep(3, els, v)
      expect(err(next)).toBeLessThan(err(v))
      v = next
    }
  })
  it('relaxing one node balances KCL there and leaves the rest', () => {
    const els = [V(1, 0, 9), R(1, 2, 100), R(2, 0, 220), R(2, 3, 330), R(3, 0, 100)]
    const v = relaxNode(els, [0, 9, 0, 4], 2)
    expect(v[3]).toBe(4)
    expect(kclResidual(3, els, branchCurrents(els, v))[2]).toBeCloseTo(0, 12)
    expect(relaxNode(els, v, 1)[1]).toBe(9)
  })
  it('refuses a floating source', () => {
    expect(() => relaxSweep(2, [V(1, 2, 1), R(1, 0, 1), R(2, 0, 1)], [0, 0, 0])).toThrow()
  })
})

describe('theveninAt', () => {
  it('a divider seen from its tap is Vth = V·R₂/(R₁ + R₂) behind R₁ ∥ R₂', () => {
    const t = theveninAt(2, [V(1, 0, 9), R(1, 2, 1000), R(2, 0, 2000)], 2)!
    expect(t.vth).toBeCloseTo(6, 12)
    expect(t.norton).toBeCloseTo(0.009, 12)
    expect(t.rth).toBeCloseTo(2000 / 3, 9)
  })
  it('a current source in parallel with R is its own Norton form', () => {
    const t = theveninAt(1, [I(0, 1, 0.01), R(1, 0, 470)], 1)!
    expect(t.norton).toBeCloseTo(0.01, 12)
    expect(t.vth).toBeCloseTo(4.7, 12)
    expect(t.rth).toBeCloseTo(470, 9)
  })
})
