// FPGA fabric: LUTs as SRAM truth tables, a crossbar of routing switches, flip-flops on one clock, all set by a bitstream.
import { Bit, bit, fromBits, toBits } from './logic'

/** A k-input LUT is 2^k SRAM bits; the inputs (input 0 = LSB) are the address of the bit that comes out. */
export const lutEval = (table: Bit[], ins: Bit[]): Bit => table[fromBits(ins)]

export const lutTable = (k: number, fn: (ins: Bit[]) => boolean | number): Bit[] =>
  Array.from({ length: 2 ** k }, (_, i) => bit(fn(toBits(i, k))))

/** Values along the 2:1 mux tree that reads a LUT: level 0 = the SRAM bits, level l + 1 = level l halved by input l. */
export function muxTree(table: Bit[], ins: Bit[]): Bit[][] {
  const levels = [table]
  for (const s of ins) {
    const prev = levels[levels.length - 1]
    levels.push(Array.from({ length: prev.length / 2 }, (_, j) => prev[2 * j + s]))
  }
  return levels
}

/** Index of the selected node at each mux-tree level, from the SRAM cell to the output. */
export const muxPath = (ins: Bit[]) => Array.from({ length: ins.length + 1 }, (_, l) => Math.floor(fromBits(ins) / 2 ** l))

export const LUT3 = {
  and: { name: 'AND', text: 'A · B · C', fn: ([a, b, c]: Bit[]) => a && b && c },
  or: { name: 'OR', text: 'A + B + C', fn: ([a, b, c]: Bit[]) => a || b || c },
  xor: { name: 'XOR', text: 'A ⊕ B ⊕ C', fn: ([a, b, c]: Bit[]) => (a + b + c) % 2 },
  maj: { name: 'Majority', text: 'AB + BC + AC', fn: ([a, b, c]: Bit[]) => a + b + c >= 2 },
}

/** Serial config chain after `s` shifts: new bits enter at cell 0, last bit first, so after n shifts it holds `next`. */
export const configLoad = (old: Bit[], next: Bit[], s: number): Bit[] =>
  old.map((b, j) => (j < s ? next[next.length - Math.min(s, next.length) + j] : old[j - s]))

/** One logic block: a LUT whose pin k reads routing track `ins[k]` (−1 = unconnected, reads 0), then a flip-flop. */
export interface Clb {
  lut: Bit[]
  ins: number[]
}

/** Each flip-flop drives track = its index; `led` = track routed to the LED pad; `init` = flip-flop power-up values. */
export interface Design {
  clbs: Clb[]
  led: number
  init: Bit[]
}

export const LUT_K = 4

export const fabricStep = (d: Design, q: Bit[]): Bit[] => d.clbs.map((c) => lutEval(c.lut, c.ins.map((t) => (t < 0 ? 0 : q[t]))))

export function fabricRun(d: Design, clocks: number): Bit[][] {
  const out = [d.init]
  for (let i = 0; i < clocks; i++) out.push(fabricStep(d, out[i]))
  return out
}

/** Synchronous binary counter: bit i toggles when all lower bits are 1, so CLB i reads tracks 0…i. */
export function counterDesign(width: number, led: number): Design {
  const clbs = Array.from({ length: width }, (_, i) => ({
    lut: lutTable(LUT_K, (b) => b[i] !== bit(b.slice(0, i).every(Boolean))),
    ins: Array.from({ length: LUT_K }, (_k, k) => (k <= i ? k : -1)),
  }))
  return { clbs, led, init: Array(width).fill(0) }
}

/** Ring of flip-flops passing one 1 around: CLB i copies track i − 1 through a buffer LUT. */
export function ringDesign(width: number, led: number): Design {
  const clbs = Array.from({ length: width }, (_, i) => ({
    lut: lutTable(LUT_K, (b) => b[0]),
    ins: Array.from({ length: LUT_K }, (_k, k) => (k ? -1 : (i + width - 1) % width)),
  }))
  return { clbs, led, init: Array.from({ length: width }, (_, i) => bit(i === 0)) }
}

/** Bitstream: per CLB its LUT bits then a pin × track crossbar (1 = switch closed), then the LED pad switches, then init. */
export function bitstream(d: Design): Bit[] {
  const n = d.clbs.length
  const cross = (on: (t: number) => boolean) => Array.from({ length: n }, (_, t) => bit(on(t)))
  return [
    ...d.clbs.flatMap((c) => [...c.lut, ...c.ins.flatMap((src) => cross((t) => t === src))]),
    ...cross((t) => t === d.led),
    ...d.init,
  ]
}

export const bitstreamLength = (n: number) => n * (2 ** LUT_K + LUT_K * n) + 2 * n

export function loadBitstream(bits: Bit[], n: number): Design {
  let at = 0
  const take = (len: number) => bits.slice(at, (at += len))
  const track = (sw: Bit[]) => sw.indexOf(1)
  const clbs = Array.from({ length: n }, () => {
    const lut = take(2 ** LUT_K)
    return { lut, ins: Array.from({ length: LUT_K }, () => track(take(n))) }
  })
  const led = track(take(n))
  return { clbs, led, init: take(n) }
}

/** LED blink period in clocks: the shortest repeat of the LED track over one full cycle of the state. */
export function ledPeriod(d: Design): number {
  const key = (q: Bit[]) => q.join('')
  const run = fabricRun(d, 2 ** d.clbs.length)
  const cycle = run.slice(1).findIndex((q) => key(q) === key(d.init)) + 1
  const led = run.slice(0, cycle).map((q) => q[d.led])
  for (let p = 1; p < cycle; p++) if (cycle % p === 0 && led.every((v, t) => v === led[(t + p) % cycle])) return p
  return cycle
}
