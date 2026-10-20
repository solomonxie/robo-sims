// Logic puzzles: fill a fixed 5-slot gate frame to hit a truth table from a gate kit; next-state logic for a 2-bit counter.
import { Bit, GATES, GateName, Inputs, Net, Src, bit, evalNet, netDepth, netSteps } from '../../logic'
import { HC_TIMING, maxClock, pathSlack } from '../timing'
import { puzzleVerdict } from './verdict'

// --- Build XOR ---

/** A frame slot: a gate, or a plain wire passing its first input on. */
export type GateSlot = GateName | 'WIRE'
/** Slot inputs: g0 = f(A, B), g1 = f(g0, A), g2 = f(g0, B), g3 = f(g1, g2), g4 = f(g3, g3) (tied: NAND/NOR invert). */
const XOR_FRAME: Src[][] = [['A', 'B'], [0, 'A'], [0, 'B'], [1, 2], [3, 3]]

/** 74HC package per gate type and gates in it. */
const HC_CHIPS: Record<GateName, { part: string; per: number }> = {
  NAND: { part: '74HC00', per: 4 },
  NOR: { part: '74HC02', per: 4 },
  AND: { part: '74HC08', per: 4 },
  OR: { part: '74HC32', per: 4 },
  XOR: { part: '74HC86', per: 4 },
  XNOR: { part: '74HC7266', per: 4 },
  NOT: { part: '74HC04', per: 6 },
}

const ALL_GATES = Object.keys(GATES) as GateName[]
type GateKit = 'nand' | 'nor' | 'any'
export const GATE_KITS: Record<GateKit, { name: string; gates: GateName[] }> = {
  nand: { name: 'NAND only (74HC00)', gates: ['NAND'] },
  nor: { name: 'NOR only (74HC02)', gates: ['NOR'] },
  any: { name: 'any 74HC gate', gates: ALL_GATES },
}

export type GateGoal = 'xorNand' | 'xorNor' | 'xnorNand' | 'lockNand' | 'xorAny' | 'lockAny'
const XOR_TEXT = 'alarm if just one bumper is hit (A XOR B)'
const LOCK_TEXT = 'motor runs if enabled (A) AND NOT bumper (B)'
export const GATE_GOALS: Record<GateGoal, { name: string; kit: GateKit; fn: (a: Bit, b: Bit) => Bit; text: string }> = {
  xorNand: { name: 'XOR, NAND only', kit: 'nand', fn: (a, b) => bit(a !== b), text: XOR_TEXT },
  xorNor: { name: 'XOR, NOR only', kit: 'nor', fn: (a, b) => bit(a !== b), text: XOR_TEXT },
  xnorNand: { name: 'XNOR, NAND only', kit: 'nand', fn: (a, b) => bit(a === b), text: 'lamp on if both or neither (A XNOR B)' },
  lockNand: { name: 'Interlock, NAND only', kit: 'nand', fn: (a, b) => bit(a && !b), text: LOCK_TEXT },
  xorAny: { name: 'XOR, any gates', kit: 'any', fn: (a, b) => bit(a !== b), text: XOR_TEXT },
  lockAny: { name: 'Interlock, any gates', kit: 'any', fn: (a, b) => bit(a && !b), text: LOCK_TEXT },
}

/** The wired circuit: wire slots collapse, gates that don't reach the output drop. `slot[i]` = frame slot of gate i. */
export function liveGates(slots: GateSlot[]): { net: Net; out: number; slot: number[] } {
  const full: Net = []
  const at: Src[] = []
  const pos: number[] = []
  XOR_FRAME.forEach((ins, i) => {
    const src = ins.map((s) => (typeof s === 'number' ? at[s] : s))
    const g = slots[i]
    if (g === 'WIRE' && i > 0) at[i] = src[0]
    else {
      full.push({ gate: g === 'WIRE' ? 'AND' : g, in: g === 'NOT' ? [src[0]] : src })
      pos.push(i)
      at[i] = full.length - 1
    }
  })
  const used = new Set<number>()
  const mark = (s: Src) => {
    if (typeof s !== 'number' || used.has(s)) return
    used.add(s)
    full[s].in.forEach(mark)
  }
  mark(at[4])
  const keep = full.map((_, i) => i).filter((i) => used.has(i))
  const re = (s: Src) => (typeof s === 'number' ? keep.indexOf(s) : s)
  return { net: keep.map((i) => ({ gate: full[i].gate, in: full[i].in.map(re) })), out: re(at[4]) as number, slot: keep.map((i) => pos[i]) }
}

export const gateChips = (net: Net) =>
  ALL_GATES.map((g) => ({ g, n: net.filter((x) => x.gate === g).length }))
    .filter((c) => c.n)
    .map((c) => ({ part: HC_CHIPS[c.g].part, chips: Math.ceil(c.n / HC_CHIPS[c.g].per) }))

/** Row r: A = high bit. */
const rowIns = (r: number): Inputs => ({ A: bit(r >= 2), B: bit(r % 2) })
const tableOf = (net: Net, out: number) => [0, 1, 2, 3].map((r) => evalNet(net, rowIns(r))[out])

const BEST = new Map<GateGoal, { gates: number; slots: GateSlot[] }>()
/** Fewest live gates that solve `goal` in the frame with its kit (brute force), and one such fill. */
export function gateBest(goal: GateGoal) {
  let b = BEST.get(goal)
  if (b) return b
  const g = GATE_GOALS[goal]
  const kit = GATE_KITS[g.kit].gates
  const want = [0, 1, 2, 3].map((r) => g.fn(bit(r >= 2), bit(r % 2)))
  const opts: GateSlot[] = [...kit, 'WIRE']
  b = { gates: Infinity, slots: [] }
  const walk = (slots: GateSlot[]) => {
    if (slots.length === 5) {
      const l = liveGates(slots)
      if (l.net.length < b!.gates && tableOf(l.net, l.out).every((v, r) => v === want[r])) b = { gates: l.net.length, slots: [...slots] }
      return
    }
    for (const o of slots.length ? opts : kit) walk([...slots, o])
  }
  walk([])
  BEST.set(goal, b)
  return b
}

/** Unit-delay output after inputs step from row `from` to row `to`, starting settled. */
export function rowSteps(net: Net, out: number, from: number, to: number): Bit[] {
  return netSteps(net, rowIns(to), evalNet(net, rowIns(from))).map((s) => s[out])
}

/** Row order the inputs cycle through: 00 → 11 → 01 → 10 → 00, two of the steps flip both inputs at once. */
export const GATE_CYCLE = [0, 3, 1, 2]

type GateFail = 'kit' | 'table' | 'gates'

/** Fill the frame: a gate outside the kit fails first, then wrong rows (3 of 4 right is close), then more gates than needed. */
export function gateChallenge(goal: GateGoal, slots: GateSlot[]) {
  const g = GATE_GOALS[goal]
  const live = liveGates(slots)
  const kit = GATE_KITS[g.kit].gates
  const offKit = live.net.findIndex((x) => !kit.includes(x.gate))
  const got = tableOf(live.net, live.out)
  const rows = got.map((v, r) => ({ a: bit(r >= 2), b: bit(r % 2), want: g.fn(bit(r >= 2), bit(r % 2)), got: v }))
  const right = rows.filter((r) => r.want === r.got).length
  const best = gateBest(goal)
  const depth = netDepth(live.net)
  /** Steps where the output leaves a level it starts and ends on. */
  const glitches = GATE_CYCLE.filter((r, k) => {
    const s = rowSteps(live.net, live.out, r, GATE_CYCLE[(k + 1) % 4])
    return s.length > 2 && s[0] === s.at(-1) && s.some((v) => v !== s[0])
  }).length
  const verdict = puzzleVerdict<GateFail>([
    { id: 'kit', ok: offKit < 0 },
    { id: 'table', ok: right === 4, near: right === 3 },
    { id: 'gates', ok: live.net.length <= best.gates, near: true },
  ])
  return {
    ...live,
    offKit: offKit < 0 ? null : { slot: live.slot[offKit], gate: live.net[offKit].gate },
    rows,
    right,
    gates: live.net.length,
    chips: gateChips(live.net),
    best,
    depth,
    settleS: depth * HC_TIMING.tpd,
    glitches,
    verdict,
  }
}

// --- Design a 2-bit counter ---

/** Next-state logic for one D input, from Q1 and Q0: a wire, an inverter, or one 2-input gate. */
export type DLogic = 'q0' | 'nq0' | 'q1' | 'nq1' | 'xor' | 'xnor' | 'and' | 'or' | 'nand' | 'nor'
export const D_LOGIC: Record<DLogic, { name: string; gate: GateName | null; in: ('Q1' | 'Q0')[] }> = {
  q0: { name: 'Q0', gate: null, in: ['Q0'] },
  nq0: { name: 'NOT Q0', gate: 'NOT', in: ['Q0'] },
  q1: { name: 'Q1', gate: null, in: ['Q1'] },
  nq1: { name: 'NOT Q1', gate: 'NOT', in: ['Q1'] },
  xor: { name: 'Q1 XOR Q0', gate: 'XOR', in: ['Q1', 'Q0'] },
  xnor: { name: 'Q1 XNOR Q0', gate: 'XNOR', in: ['Q1', 'Q0'] },
  and: { name: 'Q1 AND Q0', gate: 'AND', in: ['Q1', 'Q0'] },
  or: { name: 'Q1 OR Q0', gate: 'OR', in: ['Q1', 'Q0'] },
  nand: { name: 'Q1 NAND Q0', gate: 'NAND', in: ['Q1', 'Q0'] },
  nor: { name: 'Q1 NOR Q0', gate: 'NOR', in: ['Q1', 'Q0'] },
}

export type CounterGoal = 'up' | 'down' | 'gray'
/** State = 2·Q1 + Q0; `seq` from 00, repeating. */
export const COUNTER_GOALS: Record<CounterGoal, { name: string; seq: number[] }> = {
  up: { name: 'Count up', seq: [0, 1, 2, 3] },
  down: { name: 'Count down', seq: [0, 3, 2, 1] },
  gray: { name: 'Gray code', seq: [0, 1, 3, 2] },
}

/** Clock choices (Hz). */
export const COUNTER_CLOCKS = { '1': 1, '1e7': 1e7, '2.5e7': 2.5e7, '4e7': 4e7, '5e7': 5e7 }

/** D value of `d` in state s. */
function dValue(d: DLogic, s: number): Bit {
  const q = { Q1: bit(s >= 2), Q0: bit(s % 2) }
  const l = D_LOGIC[d]
  const a = q[l.in[0]]
  return l.gate ? GATES[l.gate].fn(a, q[l.in.at(-1)!]) : a
}

/** State after one clock edge: each flip-flop loads its D. */
const counterNext = (d0: DLogic, d1: DLogic, s: number) => 2 * dValue(d1, s) + dValue(d0, s)

type CounterFail = 'sequence' | 'timing'

/** Next-state logic for `goal`, clocked at `hz`: the wrong sequence fails first (one bit right is close), then a Q → D path
 *  longer than the period less setup (74HC: t_clk→Q + gate t_pd + t_su; within 30 % of the period is close). */
export function counterChallenge(goal: CounterGoal, d0: DLogic, d1: DLogic, hz: number) {
  const seq = COUNTER_GOALS[goal].seq
  const want = [0, 1, 2, 3].map((s) => seq[(seq.indexOf(s) + 1) % 4])
  const next = [0, 1, 2, 3].map((s) => counterNext(d0, d1, s))
  const bitOk = (k: number) => next.every((v, s) => Math.floor(v / 2 ** k) % 2 === Math.floor(want[s] / 2 ** k) % 2)
  const run = [0]
  for (let k = 0; k < 8; k++) run.push(next[run[k]])
  const stages = Math.max(...[d0, d1].map((d) => (D_LOGIC[d].gate ? 1 : 0)))
  const period = 1 / hz
  const path = { ...HC_TIMING, period, stages }
  const slack = pathSlack(path)
  const verdict = puzzleVerdict<CounterFail>([
    { id: 'sequence', ok: bitOk(0) && bitOk(1), near: bitOk(0) || bitOk(1) },
    { id: 'timing', ok: slack >= 0, near: slack > -0.3 * period },
  ])
  return {
    want,
    next,
    run,
    d0ok: bitOk(0),
    d1ok: bitOk(1),
    right: next.filter((v, s) => v === want[s]).length,
    stages,
    needS: HC_TIMING.tcq + stages * HC_TIMING.tpd + HC_TIMING.tsu,
    period,
    fMax: maxClock(HC_TIMING.tcq, stages * HC_TIMING.tpd, HC_TIMING.tsu),
    slack,
    verdict,
  }
}
