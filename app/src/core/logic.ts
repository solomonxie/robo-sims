// Gate-level boolean logic: gates, truth tables, CMOS NAND switch states, adders.

export type Bit = 0 | 1
export const bit = (x: boolean | number): Bit => (x ? 1 : 0)

export type GateName = 'NOT' | 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR'

/** Each gate's function, input count and static-CMOS transistor count (AND/OR = NAND/NOR + inverter). */
export const GATES: Record<GateName, { inputs: 1 | 2; transistors: number; fn: (a: Bit, b: Bit) => Bit }> = {
  NOT: { inputs: 1, transistors: 2, fn: (a) => bit(!a) },
  AND: { inputs: 2, transistors: 6, fn: (a, b) => bit(a && b) },
  OR: { inputs: 2, transistors: 6, fn: (a, b) => bit(a || b) },
  NAND: { inputs: 2, transistors: 4, fn: (a, b) => bit(!(a && b)) },
  NOR: { inputs: 2, transistors: 4, fn: (a, b) => bit(!(a || b)) },
  XOR: { inputs: 2, transistors: 12, fn: (a, b) => bit(a !== b) },
  XNOR: { inputs: 2, transistors: 12, fn: (a, b) => bit(a === b) },
}

/** Rows in counting order: A is the high bit. A 1-input gate has 2 rows with b = 0. */
export function truthTable(g: GateName): { a: Bit; b: Bit; out: Bit }[] {
  const rows = GATES[g].inputs === 1 ? [0, 2] : [0, 1, 2, 3]
  return rows.map((r) => {
    const a = bit(r >= 2)
    const b = bit(r % 2)
    return { a, b, out: GATES[g].fn(a, b) }
  })
}

/** Static CMOS NAND: PMOS A ∥ PMOS B from Vdd, NMOS A in series with NMOS B to ground. A PMOS conducts on 0, an NMOS on 1. */
export function cmosNand(a: Bit, b: Bit) {
  const pmos: [boolean, boolean] = [!a, !b]
  const nmos: [boolean, boolean] = [!!a, !!b]
  const toVdd = pmos[0] || pmos[1]
  const toGnd = nmos[0] && nmos[1]
  return { pmos, nmos, toVdd, toGnd, out: bit(toVdd) }
}

export const halfAdder = (a: Bit, b: Bit) => ({ sum: bit(a !== b), carry: bit(a && b) })

export function fullAdder(a: Bit, b: Bit, cin: Bit) {
  const first = halfAdder(a, b)
  const second = halfAdder(first.sum, cin)
  return { sum: second.sum, carry: bit(first.carry || second.carry) }
}

/** `width` bits of `n`, least significant first. */
export const toBits = (n: number, width: number): Bit[] => Array.from({ length: width }, (_, i) => bit(Math.floor(n / 2 ** i) % 2))
export const fromBits = (bits: Bit[]) => bits.reduce<number>((n, b, i) => n + b * 2 ** i, 0)

export interface RippleState {
  /** carries[i] = carry into bit i; carries[width] = carry out. */
  carries: Bit[]
  sums: Bit[]
  value: number
}

/** Ripple-carry adder one full-adder delay at a time, every carry starting at 0. Step k has carries settled up to bit k;
 *  the last step (index `width`) is the exact sum. Sums past the wave can be wrong for a moment: the glitch. */
export function rippleSteps(a: number, b: number, width: number, cin: Bit = 0): RippleState[] {
  const as = toBits(a, width)
  const bs = toBits(b, width)
  let carries: Bit[] = [cin, ...Array<Bit>(width).fill(0)]
  const states: RippleState[] = []
  for (let k = 0; k <= width; k++) {
    const sums = as.map((x, i) => fullAdder(x, bs[i], carries[i]).sum)
    states.push({ carries, sums, value: fromBits([...sums, carries[width]]) })
    carries = [cin, ...as.map((x, i) => fullAdder(x, bs[i], carries[i]).carry)]
  }
  return states
}

/** A gate input: a named circuit input or an earlier gate's index. */
export type Src = string | number
export type Net = { gate: GateName; in: Src[] }[]
export type Inputs = Record<string, Bit>

const fire = (g: Net[number], ins: Inputs, vals: Bit[]) => {
  const at = (s: Src) => (typeof s === 'number' ? vals[s] : ins[s])
  return GATES[g.gate].fn(at(g.in[0]), at(g.in.at(-1)!))
}

/** Settled output of every gate, swept in list order. Without feedback one sweep is exact; a gate reading a later one
 *  sees its value in `from` (the held state, default all 0) and sweeps repeat until nothing changes. */
export function evalNet(net: Net, ins: Inputs, from: Bit[] = []): Bit[] {
  const vals = net.map((_, i) => from[i] ?? 0)
  for (let k = 0; k <= net.length; k++) {
    let changed = false
    net.forEach((g, i) => {
      const v = fire(g, ins, vals)
      changed ||= v !== vals[i]
      vals[i] = v
    })
    if (!changed) break
  }
  return vals
}

/** Unit-delay timing from gate outputs `start`: each step every gate reads the previous step's wires. Ends when
 *  nothing changes (the last state is `evalNet`); states in between can briefly be wrong, a glitch. */
export function netSteps(net: Net, ins: Inputs, start: Bit[]): Bit[][] {
  const states = [start]
  for (let k = 0; k <= net.length; k++) {
    const prev = states[k]
    const next = netStep(net, ins, prev)
    if (next.every((v, i) => v === prev[i])) break
    states.push(next)
  }
  return states
}

/** One gate delay: every gate reads the previous outputs, so a gate may read a later one (feedback, i.e. memory). */
export const netStep = (net: Net, ins: Inputs, prev: Bit[]): Bit[] => net.map((g) => fire(g, ins, prev))

/** Where a net with feedback comes to rest from state `from`; `stable` is false if it keeps oscillating. */
export function netSettle(net: Net, ins: Inputs, from: Bit[]) {
  const state = netSteps(net, ins, from).at(-1)!
  return { state, stable: netStep(net, ins, state).every((v, i) => v === state[i]) }
}

/** Settles after each input vector in turn, carrying the state: how a sequential circuit runs. */
export const netRun = (net: Net, seq: Inputs[], from: Bit[]) => seq.map((ins) => (from = netSettle(net, ins, from).state))

/** Gates on the longest input-to-output path: the worst-case delay in gate delays. */
export function netDepth(net: Net) {
  const d: number[] = []
  net.forEach((g, i) => (d[i] = 1 + Math.max(...g.in.map((s) => (typeof s === 'number' ? d[s] : 0)))))
  return Math.max(...d)
}

/** Truth table of gate `out`: rows count in binary with `names[0]` as the high bit. */
export function netTable(net: Net, names: string[], out: number) {
  return Array.from({ length: 2 ** names.length }, (_, r) => {
    const ins = Object.fromEntries(names.map((k, i) => [k, bit(Math.floor(r / 2 ** (names.length - 1 - i)) % 2)])) as Inputs
    return { ins, out: evalNet(net, ins)[out] }
  })
}

/** Majority vote AB + BC + AC; the last gate is the output. */
export const MAJORITY: Net = [
  { gate: 'AND', in: ['A', 'B'] },
  { gate: 'AND', in: ['B', 'C'] },
  { gate: 'AND', in: ['A', 'C'] },
  { gate: 'OR', in: [0, 1] },
  { gate: 'OR', in: [3, 2] },
]
/** Odd parity A ⊕ B ⊕ C. */
export const PARITY: Net = [
  { gate: 'XOR', in: ['A', 'B'] },
  { gate: 'XOR', in: [0, 'C'] },
]
/** Alarm: armed A and (door B or window C). */
export const ALARM: Net = [
  { gate: 'OR', in: ['B', 'C'] },
  { gate: 'AND', in: ['A', 0] },
]

/** 2:1 multiplexer Y = S̄·D0 + S·D1; gate 3 is Y. */
export const MUX2: Net = [
  { gate: 'NOT', in: ['S'] },
  { gate: 'AND', in: ['D0', 0] },
  { gate: 'AND', in: ['D1', 'S'] },
  { gate: 'OR', in: [1, 2] },
]
export const mux = (data: Bit[], sel: number) => data[sel]

/** 2-to-4 decoder: gates 2..5 are Y0..Y3, exactly one is 1. */
export const DECODER2: Net = [
  { gate: 'NOT', in: ['A1'] },
  { gate: 'NOT', in: ['A0'] },
  { gate: 'AND', in: [0, 1] },
  { gate: 'AND', in: [0, 'A0'] },
  { gate: 'AND', in: ['A1', 1] },
  { gate: 'AND', in: ['A1', 'A0'] },
]
export const oneHot = (n: number, width: number): Bit[] => Array.from({ length: 2 ** width }, (_, i) => bit(i === n))

/** Half adder: gate 0 = sum, 1 = carry. */
export const HALF_ADDER: Net = [
  { gate: 'XOR', in: ['A', 'B'] },
  { gate: 'AND', in: ['A', 'B'] },
]
/** Full adder as two half adders and an OR: gate 1 = sum, 4 = carry out. */
export const FULL_ADDER: Net = [
  { gate: 'XOR', in: ['A', 'B'] },
  { gate: 'XOR', in: [0, 'C'] },
  { gate: 'AND', in: ['A', 'B'] },
  { gate: 'AND', in: [0, 'C'] },
  { gate: 'OR', in: [2, 3] },
]

/** SR latch from two cross-coupled NORs: gate 0 = Q, 1 = Q̄. S = 1 sets, R = 1 resets, both 0 hold. */
export const SR_LATCH: Net = [
  { gate: 'NOR', in: ['R', 1] },
  { gate: 'NOR', in: [0, 'S'] },
]
/** Gated D latch: Q (gate 3) follows D while E = 1 and holds when E = 0; gate 4 = Q̄. */
export const D_LATCH: Net = [
  { gate: 'NOT', in: ['D'] },
  { gate: 'NAND', in: ['D', 'E'] },
  { gate: 'NAND', in: [0, 'E'] },
  { gate: 'NAND', in: [1, 4] },
  { gate: 'NAND', in: [3, 2] },
]
/** Rising-edge D flip-flop: a master D latch open while CLK = 0 feeds a slave open while CLK = 1. Q = gate 8, Q̄ = 9. */
export const D_FLIP_FLOP: Net = [
  { gate: 'NOT', in: ['CLK'] },
  { gate: 'NOT', in: ['D'] },
  { gate: 'NAND', in: ['D', 0] },
  { gate: 'NAND', in: [1, 0] },
  { gate: 'NAND', in: [2, 5] },
  { gate: 'NAND', in: [4, 3] },
  { gate: 'NAND', in: [4, 'CLK'] },
  { gate: 'NAND', in: [5, 'CLK'] },
  { gate: 'NAND', in: [6, 9] },
  { gate: 'NAND', in: [8, 7] },
]
/** One register bit: a mux feeds D (LOAD = 1) or Q back (LOAD = 0) into a D flip-flop. Q = gate 12. */
export const REGISTER_BIT: Net = [
  { gate: 'NOT', in: ['LOAD'] },
  { gate: 'AND', in: ['D', 'LOAD'] },
  { gate: 'AND', in: [12, 0] },
  { gate: 'OR', in: [1, 2] },
  ...D_FLIP_FLOP.map((g) => ({ ...g, in: g.in.map((s) => (typeof s === 'number' ? s + 4 : s === 'D' ? 3 : s)) })),
]
