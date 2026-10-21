// Breadboard nets for any board: half or full length, power rails that run through or break mid-way. Hole addresses
// ('c12', 'top+3'), the bus each hole sits on, and parts / jumpers on holes → a netlist where every pin reaches its bus
// through one spring clip's contact resistance, solved with diodeNetSolve.
import { BOTTOM_ROWS, Hole, NetResolver, RAIL_ROWS, TOP_ROWS, holePosition, isRail, railHasColumn } from '../../breadboard'
import { Element } from '../../nodal'
import { LED_LEAK_OHMS, Led } from '../semiconductors'
import { diodeNetSolve } from '../debugging/dmm'
import { Connector } from '../power/wiring'

export interface BreadboardSpec {
  name: string
  columns: number
  /** Rails break after this column (left segment 1…n, right n+1…); null = they run the full length. */
  railBreak: number | null
}

export const BREADBOARDS = {
  half: { name: 'Half, 400 points', columns: 30, railBreak: null },
  full: { name: 'Full, 830 points', columns: 63, railBreak: null },
  split: { name: 'Full, rails split mid-way', columns: 63, railBreak: 30 },
} satisfies Record<string, BreadboardSpec>
export type BreadboardKey = keyof typeof BREADBOARDS

/** One spring clip: ~20 mΩ new and rated ~1 A (30 K rise); bent, oxidised clips are ~25× worse. */
export const BOARD_CLIP: Connector = { name: 'Breadboard clip', ratedA: 1, contactOhms: 0.02, maxC: 80 }
export const CLIP_WORN = 25

/** USB breadboard power module, 5 V: the cable, polyfuse and port behind it look like ~2 Ω. */
export const USB_MODULE = { volts: 5, ohms: 2 }

/** Ideal wires and sources still get a sliver of resistance (1 mΩ) for the solver. */
const MIN_OHMS = 1e-3

const HOLE_RE = /^(top[+-]|bottom[+-]|[a-j])(\d+)$/

/** 'c12' → { row: 'c', col: 12 }; rails are 'top+', 'top-', 'bottom+', 'bottom-'. */
export function parseHole(s: string): Hole {
  const m = HOLE_RE.exec(s)
  if (!m) throw new Error(`bad hole ${s}`)
  return { row: m[1], col: Number(m[2]) }
}

export const holeText = (h: Hole) => `${h.row}${h.col}`

/** Strip holes on every column; rail holes in groups of five. */
export const holeExists = (b: BreadboardSpec, h: Hole) =>
  h.col >= 1 && h.col <= b.columns && (isRail(h.row) ? railHasColumn(h.col) : TOP_ROWS.includes(h.row) || BOTTOM_ROWS.includes(h.row))

/** The metal strip a hole's clip belongs to: a 5-hole column strip on one side of the channel, or a rail segment. */
export function busOf(b: BreadboardSpec, hole: Hole | string): string {
  const h = typeof hole === 'string' ? parseHole(hole) : hole
  if (!holeExists(b, h)) throw new Error(`no hole ${holeText(h)} on ${b.name}`)
  if (isRail(h.row)) return `${h.row}:${b.railBreak !== null && h.col > b.railBreak ? 2 : 1}`
  return `${TOP_ROWS.includes(h.row) ? 'top' : 'bottom'}${h.col}`
}

/** Every hole on a bus. */
export function busHoles(b: BreadboardSpec, bus: string): Hole[] {
  const out: Hole[] = []
  for (const row of [...RAIL_ROWS, ...TOP_ROWS, ...BOTTOM_ROWS])
    for (let col = 1; col <= b.columns; col++) {
      const h = { row, col }
      if (holeExists(b, h) && busOf(b, h) === bus) out.push(h)
    }
  return out
}

/** Board-local (x, z) in hole pitches, board centred on the origin. */
export const boardXZ = (b: BreadboardSpec, h: Hole) => ({ x: h.col - (b.columns + 1) / 2, z: holePosition(h).z })

/** The rail hole nearest column `col` (rails skip every sixth column). */
export const railColNear = (col: number) => (railHasColumn(col) ? col : col - 1)

/** A part with pins in holes (`a` = anode / + terminal). Supply: `volts` behind `ohms`; I: a fixed load current a → b. */
export type BoardPart =
  | { kind: 'V'; a: string; b: string; volts: number; ohms: number }
  | { kind: 'R'; a: string; b: string; ohms: number }
  | { kind: 'I'; a: string; b: string; amps: number }
  | { kind: 'wire'; a: string; b: string; ohms: number }
  | { kind: 'LED'; a: string; b: string; led: Led }

export interface BoardSolution {
  /** Bus volts against the first supply's − terminal (floating buses read ~0). */
  busV: Record<string, number>
  /** Buses joined to a supply through parts (a dead end still counts); the rest float. */
  live: Set<string>
  /** Current through each part, a → b (supply: out of its + pin). */
  partA: number[]
  /** Current through each part's two clips, [a, b]. */
  clipA: [number, number][]
  /** Volts at each part's two pins (past their clips). */
  pinV: [number, number][]
  maxClipA: number
}

/** Leak from every node to the reference (50 nA at 5 V) so dead-end and floating nets stay solvable. */
const LEAK_OHMS = 1e8

/** Solve parts on a board; each clip is `BOARD_CLIP.contactOhms × wear`. Node 0 = the first supply's − pin. */
export function solveBoard(board: BreadboardSpec, parts: BoardPart[], wear = 1): BoardSolution {
  const net = new NetResolver()
  parts.forEach((p) => net.union(busOf(board, p.a), busOf(board, p.b)))
  const supplies = parts.filter((p) => p.kind === 'V').map((p) => net.netOf(busOf(board, p.a)))
  const isLive = (bus: string) => supplies.includes(net.netOf(bus))
  const buses = new Map<string, number>()
  let nodes = 0
  const node = () => ++nodes
  const busNode = (bus: string) => {
    if (!buses.has(bus)) buses.set(bus, node())
    return buses.get(bus)!
  }
  const clipOhms = BOARD_CLIP.contactOhms * wear
  const els: Element[] = []
  const diodes: { a: number; b: number; d: Led }[] = []
  const clipEl: [number, number][] = []
  const pinN: [number, number][] = []
  const partEl: number[] = []
  const diodeOf: number[] = []
  let grounded = false
  const pin = (hole: string, at?: number) => {
    const bus = busOf(board, hole)
    const n = at ?? node()
    els.push({ kind: 'R', a: n, b: busNode(bus), ohms: clipOhms })
    return { n, el: els.length - 1 }
  }
  for (const p of parts) {
    const ground = p.kind === 'V' && !grounded
    if (ground) grounded = true
    const pa = pin(p.a)
    const pb = pin(p.b, ground ? 0 : undefined)
    clipEl.push([pa.el, pb.el])
    pinN.push([pa.n, pb.n])
    diodeOf.push(-1)
    if (p.kind === 'V') {
      const x = node()
      els.push({ kind: 'V', a: x, b: pb.n, volts: p.volts }, { kind: 'R', a: x, b: pa.n, ohms: Math.max(p.ohms, MIN_OHMS) })
    } else if (p.kind === 'LED') {
      diodes.push({ a: pa.n, b: pb.n, d: p.led })
      diodeOf[diodeOf.length - 1] = diodes.length - 1
      els.push({ kind: 'R', a: pa.n, b: pb.n, ohms: LED_LEAK_OHMS })
    } else if (p.kind === 'I') els.push({ kind: 'I', a: pa.n, b: pb.n, amps: p.amps })
    else els.push({ kind: 'R', a: pa.n, b: pb.n, ohms: Math.max(p.ohms, MIN_OHMS) })
    partEl.push(els.length - 1)
  }
  for (let k = 1; k <= nodes; k++) els.push({ kind: 'R', a: k, b: 0, ohms: LEAK_OHMS })
  const s = diodeNetSolve(nodes, els, diodes)
  if (!s) throw new Error('board has no solution')
  const busV: Record<string, number> = {}
  const live = new Set<string>()
  for (const [bus, n] of buses) {
    busV[bus] = s.volts[n]
    if (isLive(bus)) live.add(bus)
  }
  // LED leak sits in parallel with the diode: count both. The supply's current is its series R (the element at partEl).
  const partA = parts.map((p, i) => s.amps[partEl[i]] + (p.kind === 'LED' ? s.diodeA[diodeOf[i]] : 0))
  const clipA = clipEl.map(([a, b]) => [Math.abs(s.amps[a]), Math.abs(s.amps[b])] as [number, number])
  const pinV = pinN.map(([a, b]) => [s.volts[a], s.volts[b]] as [number, number])
  return { busV, live, partA, clipA, pinV, maxClipA: Math.max(0, ...clipA.flat()) }
}
