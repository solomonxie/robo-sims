// CAN bus: differential levels and terminations, wired-AND arbitration, classic 11-bit frames (CRC-15, bit stuffing).
import { CABLE_PF_PER_M, TWIST_RESIDUAL, motorNoise } from './uart'

export const CAN_RECESSIVE_V = 2.5
export const CAN_TERM = 120
/** Transceiver differential drive: open-circuit volts and output resistance (both legs). */
export const CAN_VOD_OPEN = 3
export const CAN_RDRV = 30
/** Receiver reads dominant above this H − L (ISO 11898: recessive < 0.5 V, dominant > 0.9 V). */
export const CAN_RX_THRESHOLD = 0.7
/** Per-node differential input resistance and capacitance (SN65HVD230 class). */
export const CAN_NODE_RIN = 30e3
export const CAN_NODE_PF = 30e-12
/** SN65HVD230 common-mode input range. */
export const CAN_CM_RANGE: [number, number] = [-2, 7]

/** Resistance across H–L: terminators in parallel with every node's input. */
export const canLoad = (terms: number, nodes: number) => 1 / (terms / CAN_TERM + nodes / CAN_NODE_RIN)
/** H − L while one node drives dominant into that load. */
export const canDominantDiff = (terms: number, nodes: number) => {
  const r = canLoad(terms, nodes)
  return (CAN_VOD_OPEN * r) / (r + CAN_RDRV)
}
/** Dominant edges are driven (driver ∥ load); recessive is not driven: only the load discharges the pair. */
export function canTau(terms: number, nodes: number, meters: number) {
  const r = canLoad(terms, nodes)
  const c = CABLE_PF_PER_M * meters + nodes * CAN_NODE_PF
  return { dom: ((r * CAN_RDRV) / (r + CAN_RDRV)) * c, rec: r * c }
}

export interface CanLinkSpec {
  terms: number
  nodes: number
  meters: number
  noiseV: number
  baud: number
  perBit?: number
  /** Sample point as a fraction of the bit. */
  sample?: number
}
/** Sends `bits` (0 = dominant) on the pair; common-mode noise hits both wires. Reads differentially, and CANH alone vs 3 V for comparison. */
export function canLink(bits: number[], { terms, nodes, meters, noiseV, baud, perBit = 40, sample = 0.75 }: CanLinkSpec) {
  const dt = 1 / (baud * perBit)
  const tau = canTau(terms, nodes, meters)
  const vDom = canDominantDiff(terms, nodes)
  const kOf = (t: number) => 1 - Math.exp(-dt / Math.max(t, 1e-12))
  const [kd, kr] = [kOf(tau.dom), kOf(tau.rec)]
  const h: number[] = []
  const l: number[] = []
  const diff: number[] = []
  let v = 0
  for (let i = 0; i < bits.length * perBit; i++) {
    const target = bits[Math.floor(i / perBit)] ? 0 : vDom
    v += (target - v) * (target > v ? kd : kr)
    const n = noiseV * motorNoise(i * dt)
    h.push(CAN_RECESSIVE_V + v / 2 + n)
    l.push(CAN_RECESSIVE_V - v / 2 + n)
    diff.push(v + TWIST_RESIDUAL * n)
  }
  const at = (b: number) => b * perBit + Math.floor(perBit * sample)
  const read = bits.map((_, b) => (diff[at(b)] > CAN_RX_THRESHOLD ? 0 : 1))
  const single = bits.map((_, b) => (h[at(b)] > CAN_RECESSIVE_V + 0.5 ? 0 : 1))
  const count = (r: number[]) => r.filter((x, b) => x !== bits[b]).length
  const cmPeak = CAN_RECESSIVE_V + noiseV
  return { dt, h, l, diff, read, single, errors: count(read), singleErrors: count(single), vDom, tau, inRange: cmPeak - vDom / 2 >= CAN_CM_RANGE[0] && cmPeak + vDom / 2 <= CAN_CM_RANGE[1] }
}

// --- Arbitration: every node sends its ID MSB first; dominant 0 overwrites recessive 1. ---

export const idBits = (id: number, n = 11) => Array.from({ length: n }, (_, k) => Math.floor(id / 2 ** (n - 1 - k)) % 2)

/** Bit-by-bit wired-AND: a node that sends 1 but reads 0 stops and listens. Lowest ID is left. */
export function canArbitrate(ids: number[], n = 11) {
  const alive = ids.map(() => true)
  const lostAt = ids.map(() => -1)
  const sent = ids.map((id) => idBits(id, n))
  const bus: number[] = []
  for (let k = 0; k < n; k++) {
    const b = Math.min(...ids.map((_, i) => (alive[i] ? sent[i][k] : 1)))
    bus.push(b)
    ids.forEach((_, i) => {
      if (!alive[i] || sent[i][k] === b) return
      alive[i] = false
      lostAt[i] = k
    })
  }
  const left = ids.map((_, i) => i).filter((i) => alive[i])
  return { bus, sent, lostAt, winner: left[0], tie: left.length > 1 }
}

// --- Frame: SOF, ID, RTR/IDE/r0, DLC, data, CRC-15, ACK, EOF. ---

export const CAN_CRC_POLY = 0x4599
const xor15 = (a: number, b: number) => idBits(a, 15).reduce((acc, x, k) => acc * 2 + (x === idBits(b, 15)[k] ? 0 : 1), 0)
/** CRC-15/CAN: shift each bit through x¹⁵ + x¹⁴ + x¹⁰ + x⁸ + x⁷ + x⁴ + x³ + 1. */
export function canCrc15(bits: number[]) {
  let crc = 0
  for (const b of bits) {
    const top = Math.floor(crc / 0x4000)
    crc = (crc % 0x4000) * 2
    if (b !== top) crc = xor15(crc, CAN_CRC_POLY)
  }
  return crc
}

/** After five equal bits the sender inserts one of the opposite level; `pos[i]` is raw bit i's index in the stuffed stream. */
export function canStuff(bits: number[]) {
  const out: number[] = []
  const pos: number[] = []
  const stuffAt: number[] = []
  let run = 0
  let last = -1
  for (const b of bits) {
    pos.push(out.length)
    out.push(b)
    run = b === last ? run + 1 : 1
    last = b
    if (run === 5) {
      stuffAt.push(out.length)
      out.push(1 - b)
      last = 1 - b
      run = 1
    }
  }
  return { bits: out, pos, stuffAt }
}

export type CanField = 'SOF' | 'ID' | 'CTRL' | 'DLC' | 'DATA' | 'CRC' | 'CRC DEL' | 'ACK' | 'ACK DEL' | 'EOF'
export interface CanFieldSpan {
  field: CanField
  /** First bit and length in the stuffed stream. */
  start: number
  len: number
  value: number
}

/** Classic data frame as it sits on the bus once acknowledged (ACK slot dominant); `tx` is the sender's own stream (ACK recessive). */
export function canFrame(id: number, data: number[]) {
  const dlc = Math.min(8, data.length)
  const parts: [CanField, number, number][] = [
    ['SOF', 0, 1],
    ['ID', id, 11],
    ['CTRL', 0, 3],
    ['DLC', dlc, 4],
    ...data.slice(0, dlc).map((d): [CanField, number, number] => ['DATA', d, 8]),
  ]
  const raw = parts.flatMap(([, v, n]) => idBits(v, n))
  const crc = canCrc15(raw)
  const st = canStuff([...raw, ...idBits(crc, 15)])
  const tail: [CanField, number, number][] = [
    ['CRC DEL', 1, 1],
    ['ACK', 0, 1],
    ['ACK DEL', 1, 1],
    ['EOF', 0x7f, 7],
  ]
  const fields: CanFieldSpan[] = []
  let r = 0
  for (const [field, value, n] of [...parts, ['CRC', crc, 15] as [CanField, number, number]]) {
    const start = st.pos[r]
    r += n
    const end = r < st.pos.length ? st.pos[r] : st.bits.length
    fields.push({ field, start, len: end - start, value })
  }
  const bus = [...st.bits]
  for (const [field, value, n] of tail) {
    fields.push({ field, start: bus.length, len: n, value })
    bus.push(...idBits(value, n))
  }
  const ack = fields.find((f) => f.field === 'ACK')!.start
  const tx = bus.map((b, i) => (i === ack ? 1 : b))
  return { bus, tx, fields, crc, stuffAt: st.stuffAt, pos: st.pos, rawBits: raw.length + 15 + 10 }
}
