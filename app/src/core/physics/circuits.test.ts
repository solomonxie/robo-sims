import {
  floatingPickup,
  logicLevel,
  pulledPin,
  adcCounts,
  bridgeCircuit,
  bridgeCurrents,
  bridgeMatrix,
  bridgeNodes,
  cellPack,
  dividerOut,
  loadedDivider,
  nortonLoad,
  parallelBranches,
  powerTransfer,
  decoupleStep,
  electrolyticLeakage,
  rcFraction,
  rcStep,
  rcTau,
  rlTau,
  rcTimeTo,
  resistorPair,
  seriesChain,
  seriesWithPair,
  theveninDemo,
  theveninLoad,
  twoSourceLoop,
  twoSourceNode,
  SWITCHES,
  bounceEdges,
  bouncedState,
  debounceStep,
  latchToggle,
  rcDebounceStep,
  schmittHigh,
} from '.'
import { gaussSolve, relaxSweep } from '../nodal'

describe('circuits', () => {
  it('series adds, parallel splits current toward the smaller resistor', () => {
    expect(resistorPair(100, 200, 9, 'series').totalOhms).toBe(300)
    const p = resistorPair(100, 100, 9, 'parallel')
    expect(p.totalOhms).toBe(50)
    expect(p.amps1 + p.amps2).toBeCloseTo(p.amps)
  })
  it('a series chain shares the voltage in proportion to R', () => {
    const s = seriesChain(9, [100, 200])
    expect(s.totalOhms).toBe(300)
    expect(s.amps).toBeCloseTo(0.03)
    expect(s.drops[0]).toBeCloseTo(3)
    expect(s.drops[0] + s.drops[1]).toBeCloseTo(9)
  })
  it('parallel branches: currents add, total below the smallest', () => {
    const p = parallelBranches(9, [100, 100, 220])
    expect(p.branchAmps[0]).toBeCloseTo(0.09)
    expect(p.branchAmps.reduce((a, b) => a + b)).toBeCloseTo(p.amps)
    expect(p.totalOhms).toBeLessThan(100)
    expect(parallelBranches(9, [100, 100]).totalOhms).toBeCloseTo(50)
  })
  it('cells: series adds volts, parallel adds mAh', () => {
    expect(cellPack(1.5, 2000, 2, 1)).toEqual({ volts: 3, mAh: 2000, wh: 6, cells: 2 })
    expect(cellPack(1.5, 2000, 1, 2)).toEqual({ volts: 1.5, mAh: 4000, wh: 6, cells: 2 })
    expect(cellPack(3.7, 3000, 2, 2).wh).toBeCloseTo(44.4)
  })
  it('R1 + (R2 ∥ R3) reduces step by step', () => {
    const m = seriesWithPair(100, 220, 220, 9)
    expect(m.pairOhms).toBeCloseTo(110)
    expect(m.totalOhms).toBeCloseTo(210)
    expect(m.v1 + m.pairV).toBeCloseTo(9)
    expect(m.amps2 + m.amps3).toBeCloseTo(m.amps)
  })
  it('a divider gives Vin × R₂ / (R₁ + R₂); only the ratio matters', () => {
    expect(dividerOut(9, 10e3, 10e3)).toBeCloseTo(4.5)
    expect(dividerOut(9, 1e3, 1e3)).toBeCloseTo(4.5)
    expect(dividerOut(5, 1e3, 2e3)).toBeCloseTo(3.333, 3)
    expect(dividerOut(9, 2.2e3, 1e3)).toBeCloseTo(2.8125)
  })
  it('a load across R₂ drags Vout down; ten times R₂ costs about 5 %', () => {
    const d = loadedDivider(9, 10e3, 10e3, 100e3)
    expect(d.unloaded).toBeCloseTo(4.5)
    expect(d.vout).toBeCloseTo(4.286, 3)
    expect(d.sag).toBeCloseTo(0.0476, 3)
    expect(d.amps2 + d.loadAmps).toBeCloseTo(d.amps)
    expect(d.sourceOhms).toBeCloseTo(5000)
    expect(loadedDivider(9, 10e3, 10e3, 1e3).vout).toBeCloseTo(0.75)
    expect(loadedDivider(9, 1e3, 1e3, 1e3).vout).toBeCloseTo(3)
    expect(loadedDivider(9, 1e3, 1e3, 1e9).sag).toBeLessThan(1e-5)
  })
  it('a 12-bit ADC maps 0..Vref onto 0..4095', () => {
    expect(adcCounts(0, 3.3, 12)).toBe(0)
    expect(adcCounts(1.65, 3.3, 12)).toBe(2048)
    expect(adcCounts(3.3, 3.3, 12)).toBe(4095)
    expect(adcCounts(5, 3.3, 12)).toBe(4095)
    expect(adcCounts(-1, 3.3, 10)).toBe(0)
  })
  it('one time constant charges to 63%', () => {
    expect(rcStep(0, 1, 2, 2)).toBeCloseTo(0.632, 3)
  })

  it('τ = RC: 63 % after one τ, over 99 % after five, and rcTimeTo inverts it', () => {
    expect(rcTau(22e3, 100e-6)).toBeCloseTo(2.2, 9)
    expect(rlTau(100, 10e-3)).toBeCloseTo(100e-6, 12)
    expect(rcFraction(2.2, 2.2)).toBeCloseTo(0.632, 3)
    expect(rcFraction(11, 2.2)).toBeGreaterThan(0.993)
    expect(rcTimeTo(rcFraction(3, 2), 2)).toBeCloseTo(3, 9)
  })

  it('decoupling: no cap sags by I·R at once; a cap supplies a short burst, ΔV ≈ I·Δt / C', () => {
    expect(decoupleStep(3.3, 3.3, 5, 0, 0.1, 1e-9)).toBeCloseTo(2.8, 9)
    expect(3.3 - decoupleStep(3.3, 3.3, 5, 100e-9, 0.1, 10e-9)).toBeCloseTo(0.01, 3)
    expect(decoupleStep(2.8, 3.3, 5, 1e-9, 0, 1e-6)).toBeCloseTo(3.3, 6)
  })

  it('electrolytic leakage: 0.01·C·V, at least 3 µA', () => {
    expect(electrolyticLeakage(100e-6, 9)).toBeCloseTo(9e-6, 12)
    expect(electrolyticLeakage(1e-6, 5)).toBeCloseTo(3e-6, 12)
  })
})

describe('kirchhoff', () => {
  it('two sources into one node: Millman’s formula, and the currents in add to the current out', () => {
    const s = twoSourceNode(9, 100, 5, 150, 220)
    const g = 1 / 100 + 1 / 150 + 1 / 220
    expect(s.node).toBeCloseTo((9 / 100 + 5 / 150) / g, 10)
    expect(s.i1 + s.i2).toBeCloseTo(s.i3, 12)
    expect(s.i3).toBeCloseTo(s.node / 220, 12)
    expect(s.i2).toBeLessThan(0) // the 5 V cell is being charged
    expect(twoSourceNode(9, 100, 12, 150, 220).i2).toBeGreaterThan(0)
  })
  it('every loop of the two-source circuit sums to 0 and each step is ±I × R or a cell', () => {
    const s = twoSourceNode(9, 100, 5, 150, 220)
    for (const loop of ['left', 'right', 'outer'] as const) expect(twoSourceLoop(s.volts, loop).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12)
    const [cell, r1, r3] = twoSourceLoop(s.volts, 'left')
    expect(cell).toBe(9)
    expect(r1).toBeCloseTo(-s.i1 * 100, 12)
    expect(r3).toBeCloseTo(-s.i3 * 220, 12)
    expect(twoSourceLoop(s.volts, 'outer')[3]).toBe(-5)
  })
  it('a bridge with R₁/R₂ = R₃/R₄ is balanced; unbalanced, the bridge current flows from the higher tap', () => {
    const balanced = bridgeNodes(9, [100, 200, 1000, 2000, 330])
    expect(balanced.amps[4]).toBeCloseTo(0, 12)
    expect(balanced.va).toBeCloseTo(6, 10)
    const s = bridgeNodes(9, [100, 220, 220, 100, 330])
    expect(s.va).toBeGreaterThan(s.vb)
    expect(s.amps[4]).toBeGreaterThan(0)
    expect(s.amps[0]).toBeCloseTo(s.amps[1] + s.amps[4], 12)
    expect(s.supply).toBeCloseTo(s.amps[1] + s.amps[3], 12)
  })
  it('the substituted 2 × 2 system gives the same taps as the full solve', () => {
    const r: [number, number, number, number, number] = [100, 220, 220, 470, 47]
    const { g, i } = bridgeMatrix(9, r)
    const [va, vb] = gaussSolve(g, i)!
    const exact = bridgeNodes(9, r)
    expect(va).toBeCloseTo(exact.va, 10)
    expect(vb).toBeCloseTo(exact.vb, 10)
  })
  it('relaxing the bridge from 0 V reaches the exact taps', () => {
    const r: [number, number, number, number, number] = [100, 220, 220, 100, 330]
    const els = bridgeCircuit(9, r)
    let v = [0, 0, 0, 0]
    for (let k = 0; k < 40; k++) v = relaxSweep(3, els, v)
    const exact = bridgeNodes(9, r)
    expect(v[2]).toBeCloseTo(exact.va, 6)
    expect(bridgeCurrents(els, v).amps[4]).toBeCloseTo(exact.amps[4], 6)
  })
})

describe('Thevenin & Norton', () => {
  it('the demo network reduces to 6 V behind 150 Ω, 40 mA short-circuit', () => {
    const s = theveninDemo(12, [100, 100, 100], 1e3)
    expect(s.vth).toBeCloseTo(6, 12)
    expect(s.rth).toBeCloseTo(150, 9)
    expect(s.norton).toBeCloseTo(0.04, 12)
  })
  it('any load sees the same volts and amps from the network, its Thevenin and its Norton equivalent', () => {
    for (const load of [10, 150, 470, 10e3]) {
      const s = theveninDemo(12, [220, 330, 47], load)
      const t = theveninLoad(s.vth, s.rth, load)
      const n = nortonLoad(s.norton, s.rth, load)
      expect(t.amps).toBeCloseTo(s.il, 12)
      expect(t.volts).toBeCloseTo(s.vl, 10)
      expect(n.amps).toBeCloseTo(s.il, 12)
      expect(n.inRth).toBeCloseTo(s.norton - s.il, 12)
      expect(s.i1).toBeCloseTo(s.i2 + s.il, 12)
    }
  })
  it('load power peaks at RL = Rth with Vth² / 4Rth and 50 % efficiency', () => {
    const best = powerTransfer(6, 150, 150)
    expect(best.loadW).toBeCloseTo(0.06, 12)
    expect(best.maxW).toBeCloseTo(0.06, 12)
    expect(best.efficiency).toBe(0.5)
    expect(best.lostW).toBeCloseTo(best.loadW, 12)
    expect(best.volts).toBeCloseTo(3, 12)
    for (const load of [100, 220, 1000]) expect(powerTransfer(6, 150, load).loadW).toBeLessThan(best.loadW)
    expect(powerTransfer(6, 150, 1500).efficiency).toBeCloseTo(1500 / 1650, 12)
  })
})

describe('digital inputs', () => {
  it('ESP32 reads ≤ 0.825 V low and ≥ 2.475 V high at 3.3 V; between is undefined', () => {
    expect(logicLevel(0.8, 3.3)).toBe(0)
    expect(logicLevel(2.5, 3.3)).toBe(1)
    expect(logicLevel(1.65, 3.3)).toBeNull()
  })
  it('a pull-up holds the pin high until the button shorts it to ground', () => {
    const up = pulledPin('up', false, 10e3, 3.3)
    expect(up.volts).toBeCloseTo(3.3 - 50e-9 * 10e3)
    expect(pulledPin('up', true, 10e3, 3.3)).toEqual({ volts: 0, amps: 3.3e-4 })
    expect(pulledPin('down', false, 10e3, 3.3).volts).toBeCloseTo(5e-4)
    expect(pulledPin('down', true, 1e3, 3.3)).toEqual({ volts: 3.3, amps: 3.3e-3 })
  })
  it('without a pull the released pin floats', () => {
    expect(pulledPin('none', false, 10e3, 3.3)).toEqual({ volts: null, amps: 0 })
    expect(pulledPin('none', true, 10e3, 3.3).volts).toBe(0)
    const samples = Array.from({ length: 400 }, (_, i) => floatingPickup(i / 4000, 3.3))
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...samples)).toBeLessThanOrEqual(3.3)
    expect(new Set(samples.map((v) => logicLevel(v, 3.3))).size).toBe(3)
  })
})

describe('switch bounce and debouncing', () => {
  const sw = SWITCHES.toggle
  const edges = bounceEdges(sw.makeS, sw.bounces)
  const pressed = (t: number) => bouncedState(t, edges, false)

  it('bounce edges start at 0, end at the bounce time and leave the contact made', () => {
    expect(edges).toHaveLength(2 * sw.bounces + 1)
    expect(edges[0]).toBe(0)
    expect(edges[edges.length - 1]).toBeCloseTo(sw.makeS, 12)
    expect(edges.every((e, i) => i === 0 || e > edges[i - 1])).toBe(true)
    expect(pressed(-1e-6)).toBe(false)
    expect(pressed(sw.makeS + 1e-6)).toBe(true)
    expect(bouncedState(1, edges, true)).toBe(false)
  })

  const run = (filter: (closed: boolean, dt: number) => boolean) => {
    const dt = 1e-6
    let out = filter(false, dt)
    let changes = 0
    let first = NaN
    for (let t = 0; t < 30e-3; t += dt) {
      const next = filter(pressed(t - 2e-3), dt)
      if (next !== out) {
        changes++
        if (Number.isNaN(first)) first = t - 2e-3
      }
      out = next
    }
    return { changes, first }
  }

  it('a raw pin sees every bounce; RC + Schmitt and a software timer see one press', () => {
    expect(run((c) => c).changes).toBe(2 * sw.bounces + 1)
    let vc = 3.3
    let high = true
    const rc = run((c, dt) => {
      vc = rcDebounceStep(vc, c, 3.3, 10e3, 1e3, 0.5e-6, dt)
      high = schmittHigh(high, vc, 3.3)
      return !high
    })
    expect(rc.changes).toBe(1)
    expect(rc.first).toBeLessThan(sw.makeS)
    let s = { stable: false, last: false, sinceS: 1 }
    const sw10 = run((c, dt) => (s = debounceStep(s, c, dt, 10e-3)).stable)
    expect(sw10.changes).toBe(1)
    expect(sw10.first).toBeCloseTo(sw.makeS + 10e-3, 4)
  })

  it('too short a filter lets bounces through', () => {
    let s = { stable: false, last: false, sinceS: 1 }
    expect(run((c, dt) => (s = debounceStep(s, c, dt, 20e-6)).stable).changes).toBeGreaterThan(1)
  })

  it('schmitt holds between its thresholds; a code toggle flips once per press', () => {
    expect(schmittHigh(true, 1.4, 3.3)).toBe(true)
    expect(schmittHigh(false, 1.4, 3.3)).toBe(false)
    expect(schmittHigh(false, 2, 3.3)).toBe(true)
    expect(latchToggle(false, false, true)).toBe(true)
    expect(latchToggle(true, true, true)).toBe(true)
    expect(latchToggle(true, true, false)).toBe(true)
  })
})
