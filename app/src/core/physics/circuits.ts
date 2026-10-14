// Networks: series/parallel, dividers, Kirchhoff, Thevenin & Norton.
import { Element, branchCurrents, loopSteps, solveNodal, theveninAt } from '../nodal'
import { wattHours } from './dc'

export interface PairResult {
  totalOhms: number
  amps: number
  amps1: number
  amps2: number
  volts1: number
  volts2: number
}

export function resistorPair(r1: number, r2: number, volts: number, mode: 'series' | 'parallel'): PairResult {
  if (mode === 'series') {
    const totalOhms = r1 + r2
    const amps = volts / totalOhms
    return { totalOhms, amps, amps1: amps, amps2: amps, volts1: amps * r1, volts2: amps * r2 }
  }
  const totalOhms = 1 / (1 / r1 + 1 / r2)
  return { totalOhms, amps: volts / totalOhms, amps1: volts / r1, amps2: volts / r2, volts1: volts, volts2: volts }
}

/** Series chain across `volts`: one current through all, each resistor drops I·R. */
export function seriesChain(volts: number, ohms: number[]) {
  const totalOhms = ohms.reduce((s, r) => s + r, 0)
  const amps = volts / totalOhms
  return { totalOhms, amps, drops: ohms.map((r) => amps * r) }
}

/** Parallel branches across `volts`: each gets the full voltage, the currents add. */
export function parallelBranches(volts: number, ohms: number[]) {
  const totalOhms = 1 / ohms.reduce((s, r) => s + 1 / r, 0)
  const branchAmps = ohms.map((r) => volts / r)
  return { totalOhms, amps: volts / totalOhms, branchAmps }
}

/** `series` cells per string, `parallel` strings: volts add along a string, capacity adds across strings. */
export function cellPack(cellV: number, cellMAh: number, series: number, parallel: number) {
  const volts = cellV * series
  const mAh = cellMAh * parallel
  return { volts, mAh, wh: wattHours(volts, mAh), cells: series * parallel }
}

/** R₁ in series with (R₂ ∥ R₃) across `volts`: reduce the pair, then the chain. */
export function seriesWithPair(r1: number, r2: number, r3: number, volts: number) {
  const pairOhms = 1 / (1 / r2 + 1 / r3)
  const totalOhms = r1 + pairOhms
  const amps = volts / totalOhms
  const pairV = amps * pairOhms
  return { pairOhms, totalOhms, amps, v1: amps * r1, pairV, amps2: pairV / r2, amps3: pairV / r3 }
}

// --- Voltage divider ---

/** Unloaded divider: Vout = Vin·R₂ / (R₁ + R₂), R₂ the bottom resistor. */
export const dividerOut = (vin: number, r1: number, r2: number) => (vin * r2) / (r1 + r2)

/** Divider with `load` across R₂: the load sits in parallel with R₂ and pulls Vout down. */
export function loadedDivider(vin: number, r1: number, r2: number, load: number) {
  const bottomOhms = 1 / (1 / r2 + 1 / load)
  const vout = dividerOut(vin, r1, bottomOhms)
  const unloaded = dividerOut(vin, r1, r2)
  return {
    vout,
    unloaded,
    sag: 1 - vout / unloaded,
    amps: (vin - vout) / r1,
    amps2: vout / r2,
    loadAmps: vout / load,
    sourceOhms: 1 / (1 / r1 + 1 / r2),
  }
}

/** Ideal ADC reading: 0 V → 0, `vref` → 2ᴺ − 1, clamped. */
export const adcCounts = (volts: number, vref: number, bits: number) => {
  const top = 2 ** bits - 1
  return Math.min(top, Math.max(0, Math.round((volts / vref) * top)))
}

/** Exact RC step: capacitor voltage after `dt` heading toward `target`. */
export const rcStep = (vc: number, target: number, tauS: number, dt: number) =>
  target + (vc - target) * Math.exp(-dt / tauS)

// --- Kirchhoff ---

/** Node numbers of the two-source circuit: V₁ and V₂ each feed node N through R₁ and R₂; R₃ runs from N to ground. */
export const TWO_SOURCE = { v1: 1, v2: 2, n: 3 }
/** Clockwise loops from the ground rail, as node lists: left V₁·R₁·R₃, right R₃·R₂·V₂, outer V₁·R₁·R₂·V₂. */
export const TWO_SOURCE_LOOPS = { left: [0, 1, 3], right: [0, 3, 2], outer: [0, 1, 3, 2] }

/** i₁ and i₂ flow into N (negative = out, charging that source), i₃ flows out of N down R₃. */
export function twoSourceNode(v1: number, r1: number, v2: number, r2: number, r3: number) {
  const { v1: a, v2: b, n } = TWO_SOURCE
  const elements: Element[] = [
    { kind: 'V', a, b: 0, volts: v1 },
    { kind: 'V', a: b, b: 0, volts: v2 },
    { kind: 'R', a, b: n, ohms: r1 },
    { kind: 'R', a: b, b: n, ohms: r2 },
    { kind: 'R', a: n, b: 0, ohms: r3 },
  ]
  const { volts, amps } = solveNodal(3, elements)!
  return { volts, node: volts[n], i1: amps[2], i2: amps[3], i3: amps[4] }
}

/** Potential changes walking one of `TWO_SOURCE_LOOPS`, one per part, summing to 0. */
export const twoSourceLoop = (volts: number[], loop: keyof typeof TWO_SOURCE_LOOPS) => loopSteps(volts, TWO_SOURCE_LOOPS[loop])

/** Bridge nodes: the supply's + (1), the two taps A (2) and B (3). */
export const BRIDGE = { top: 1, a: 2, b: 3 }

/** Two dividers on one supply (R₁ over R₂ to tap A, R₃ over R₄ to tap B) joined by R₅ from A to B. */
export function bridgeCircuit(volts: number, r: [number, number, number, number, number]): Element[] {
  const { top, a, b } = BRIDGE
  return [
    { kind: 'V', a: top, b: 0, volts },
    { kind: 'R', a: top, b: a, ohms: r[0] },
    { kind: 'R', a, b: 0, ohms: r[1] },
    { kind: 'R', a: top, b, ohms: r[2] },
    { kind: 'R', a: b, b: 0, ohms: r[3] },
    { kind: 'R', a, b, ohms: r[4] },
  ]
}

/** Currents through R₁..R₅ (a → b as wired) and the supply current, for given node potentials. */
export function bridgeCurrents(elements: Element[], volts: number[]) {
  const i = branchCurrents(elements, volts).slice(1)
  return { amps: i, supply: i[0] + i[2] }
}

/** The taps' two KCL equations with the supply substituted in: G·[VA, VB] = I (siemens, amps). */
export function bridgeMatrix(volts: number, [r1, r2, r3, r4, r5]: [number, number, number, number, number]) {
  return {
    g: [
      [1 / r1 + 1 / r2 + 1 / r5, -1 / r5],
      [-1 / r5, 1 / r3 + 1 / r4 + 1 / r5],
    ],
    i: [volts / r1, volts / r3],
  }
}

/** Exact bridge solution: tap potentials and currents. */
export function bridgeNodes(volts: number, r: [number, number, number, number, number]) {
  const elements = bridgeCircuit(volts, r)
  const s = solveNodal(3, elements)!
  return { elements, volts: s.volts, va: s.volts[BRIDGE.a], vb: s.volts[BRIDGE.b], ...bridgeCurrents(elements, s.volts) }
}

// --- Thevenin & Norton ---

/** Nodes of the Thevenin demo: the cell's + (1), the R₁/R₂ tap A (2), the output terminal (3). */
export const T_NET = { top: 1, a: 2, out: 3 }

/** Cell `volts` → R₁ → A, R₂ from A to ground, R₃ from A to the output terminal. */
export function theveninNetwork(volts: number, [r1, r2, r3]: [number, number, number]): Element[] {
  const { top, a, out } = T_NET
  return [
    { kind: 'V', a: top, b: 0, volts },
    { kind: 'R', a: top, b: a, ohms: r1 },
    { kind: 'R', a, b: 0, ohms: r2 },
    { kind: 'R', a, b: out, ohms: r3 },
  ]
}

/** Vth, Rth and IN of the demo network, plus the full solve with `load` across its terminals. */
export function theveninDemo(volts: number, r: [number, number, number], load: number) {
  const elements = theveninNetwork(volts, r)
  const eq = theveninAt(3, elements, T_NET.out)!
  const s = solveNodal(3, [...elements, { kind: 'R', a: T_NET.out, b: 0, ohms: load }])!
  return { ...eq, va: s.volts[T_NET.a], vl: s.volts[T_NET.out], i1: s.amps[1], i2: s.amps[2], il: s.amps[4] }
}

/** Load on a Thevenin source: IL = Vth / (Rth + RL), VL = IL·RL. */
export function theveninLoad(vth: number, rth: number, load: number) {
  const amps = vth / (rth + load)
  return { amps, volts: amps * load }
}

/** Load on a Norton source IN ∥ Rth: the current divides, IL = IN·Rth / (Rth + RL). */
export function nortonLoad(norton: number, rth: number, load: number) {
  const amps = (norton * rth) / (rth + load)
  return { amps, volts: amps * load, inRth: norton - amps }
}

/** Power split between RL and the source's own Rth; the load peaks at Vth² / 4Rth when RL = Rth. */
export function powerTransfer(vth: number, rth: number, load: number) {
  const { amps, volts } = theveninLoad(vth, rth, load)
  return { amps, volts, loadW: volts * amps, lostW: amps * amps * rth, efficiency: load / (rth + load), maxW: (vth * vth) / (4 * rth) }
}
