// Linear DC nodal analysis. Node 0 is ground; nodes 1..n are unknowns.
// Resistors stamp conductances (G·V = I); each ideal voltage source adds one
// unknown (its current) and one equation (Va − Vb = volts), as in modified nodal analysis.

export type Element =
  | { kind: 'R'; a: number; b: number; ohms: number }
  /** Ideal source: V(a) − V(b) = volts. */
  | { kind: 'V'; a: number; b: number; volts: number }
  /** Ideal current source pushing `amps` from a to b through itself (into b). */
  | { kind: 'I'; a: number; b: number; amps: number }

export interface NodalSolution {
  /** Potential per node, index 0 = ground = 0 V. */
  volts: number[]
  /** Current through each element from a to b, in element order. */
  amps: number[]
}

/** Solves A·x = b in place by Gaussian elimination with partial pivoting; null if singular. */
export function gaussSolve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs))
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (Math.abs(a[pivot][col]) < scale * 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col]
      if (!f) continue
      for (let c = col; c < n; c++) a[r][c] -= f * a[col][c]
      b[r] -= f * b[col]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c]
    x[r] = s / a[r][r]
  }
  return x
}

/** Conductance matrix and injected currents over nodes 1..n (row k = node k + 1), plus one row per voltage source. */
export function stamp(nodes: number, elements: Element[]): { a: number[][]; b: number[] } {
  const sources = elements.filter((e) => e.kind === 'V')
  const size = nodes + sources.length
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const b = new Array<number>(size).fill(0)
  const at = (r: number, c: number, v: number) => {
    if (r > 0 && c > 0) a[r - 1][c - 1] += v
  }
  let row = nodes
  for (const e of elements) {
    if (e.a < 0 || e.b < 0 || e.a > nodes || e.b > nodes) throw new Error(`node out of range in ${JSON.stringify(e)}`)
    if (e.kind === 'R') {
      if (!(e.ohms > 0)) throw new Error(`resistor needs ohms > 0, got ${e.ohms}`)
      const g = 1 / e.ohms
      at(e.a, e.a, g)
      at(e.b, e.b, g)
      at(e.a, e.b, -g)
      at(e.b, e.a, -g)
    } else if (e.kind === 'I') {
      if (e.a > 0) b[e.a - 1] -= e.amps
      if (e.b > 0) b[e.b - 1] += e.amps
    } else {
      // Unknown x = source current a → b: leaves node a, enters node b.
      if (e.a > 0) a[e.a - 1][row] += 1
      if (e.b > 0) a[e.b - 1][row] -= 1
      if (e.a > 0) a[row][e.a - 1] += 1
      if (e.b > 0) a[row][e.b - 1] -= 1
      b[row] = e.volts
      row++
    }
  }
  return { a, b }
}

/** Node potentials and element currents; null when the circuit has no unique answer (floating node, source loop). */
export function solveNodal(nodes: number, elements: Element[]): NodalSolution | null {
  const { a, b } = stamp(nodes, elements)
  const x = gaussSolve(a, b)
  if (!x) return null
  const volts = [0, ...x.slice(0, nodes)]
  let row = nodes
  const amps = elements.map((e) => {
    if (e.kind === 'R') return (volts[e.a] - volts[e.b]) / e.ohms
    if (e.kind === 'I') return e.amps
    return x[row++]
  })
  return { volts, amps }
}

/** Net current leaving each node through the elements (KCL says every entry but ground is 0). */
export function kclResidual(nodes: number, elements: Element[], amps: number[]): number[] {
  const out = new Array<number>(nodes + 1).fill(0)
  elements.forEach((e, k) => {
    out[e.a] += amps[k]
    out[e.b] -= amps[k]
  })
  return out
}

/** Potential change at each step walking `loop` (a node list, closed back to its start). */
export const loopSteps = (volts: number[], loop: number[]) => loop.map((node, i) => volts[loop[(i + 1) % loop.length]] - volts[node])

/** Sum of the changes around a loop; KVL says 0. */
export const loopSum = (volts: number[], loop: number[]) => loopSteps(volts, loop).reduce((s, v) => s + v, 0)

/** Current a → b through each resistor and current source for given potentials; voltage sources read 0. */
export const branchCurrents = (elements: Element[], volts: number[]) =>
  elements.map((e) => (e.kind === 'R' ? (volts[e.a] - volts[e.b]) / e.ohms : e.kind === 'I' ? e.amps : 0))

/** Pins ground and every grounded voltage source's other end; returns the new potentials and the pinned nodes. */
function pin(elements: Element[], volts: number[]) {
  const v = [...volts]
  v[0] = 0
  const pinned = new Set<number>([0])
  for (const e of elements) {
    if (e.kind !== 'V') continue
    if (e.b === 0) v[e.a] = e.volts
    else if (e.a === 0) v[e.b] = -e.volts
    else throw new Error('relaxation needs voltage sources tied to ground')
    pinned.add(e.a || e.b)
  }
  return { v, pinned }
}

/** Moves node `k` alone to the potential that balances its currents, given its neighbours'.
 *  Voltage sources must have one end on ground (they pin the other end). */
export function relaxNode(elements: Element[], volts: number[], k: number): number[] {
  const { v, pinned } = pin(elements, volts)
  if (pinned.has(k)) return v
  let g = 0
  let i = 0
  for (const e of elements) {
    if (e.kind === 'R' && (e.a === k || e.b === k) && e.a !== e.b) {
      g += 1 / e.ohms
      i += v[e.a === k ? e.b : e.a] / e.ohms
    } else if (e.kind === 'I') {
      if (e.b === k) i += e.amps
      if (e.a === k) i -= e.amps
    }
  }
  if (g > 0) v[k] = i / g
  return v
}

/** One Gauss–Seidel sweep: `relaxNode` on nodes 1..n in turn. */
export function relaxSweep(nodes: number, elements: Element[], volts: number[]): number[] {
  let v = pin(elements, volts).v
  for (let k = 1; k <= nodes; k++) v = relaxNode(elements, v, k)
  return v
}

/** Thevenin equivalent seen between node `out` and ground: Vth open-circuit, IN = short-circuit current (Norton),
 *  Rth = Vth / IN. Null if the circuit can't be solved. */
export function theveninAt(nodes: number, elements: Element[], out: number) {
  const open = solveNodal(nodes, elements)
  const shorted = solveNodal(nodes, [...elements, { kind: 'V', a: out, b: 0, volts: 0 }])
  if (!open || !shorted) return null
  const vth = open.volts[out]
  const norton = shorted.amps[elements.length]
  return { vth, norton, rth: vth / norton }
}
