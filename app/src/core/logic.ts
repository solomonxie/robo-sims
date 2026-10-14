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
