// 2-D toy datasets for classifiers: logic gates, XOR blobs, two moons, two circles.
import { gaussRng, parkMiller } from '../common'
import { Sample } from './net'

export const GATES = { and: 'AND', or: 'OR', nand: 'NAND', xor: 'XOR' }
export type Gate = keyof typeof GATES
const GATE_OUT: Record<Gate, (a: number, b: number) => number> = { and: (a, b) => a * b, or: (a, b) => Math.max(a, b), nand: (a, b) => 1 - a * b, xor: (a, b) => Number(a !== b) }

/** `per` jittered copies of each truth-table row, inputs near 0 and 1. */
export function gateSet(gate: Gate, per = 6, spread = 0.12, seed = 1): Sample[] {
  const g = gaussRng(parkMiller(seed))
  const out: Sample[] = []
  for (let k = 0; k < per; k++)
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) out.push({ x: [a + (k ? g() * spread : 0), b + (k ? g() * spread : 0)], t: [GATE_OUT[gate](a, b)] })
  return out
}

export const TOYS = { moons: 'Two moons', circles: 'Ring around a blob', xor: 'XOR blobs' }
export type Toy = keyof typeof TOYS
/** Half-extent of the square the toys live in. */
export const TOY_SPAN = 1.7

/** n points, half of each class, Gaussian noise `noise`, centred inside ±TOY_SPAN. */
export function toySet(kind: Toy, n: number, noise: number, seed = 1): Sample[] {
  const rng = parkMiller(seed)
  const g = gaussRng(rng)
  return Array.from({ length: n }, (_, i) => {
    const c = i % 2
    const u = rng()
    let p: [number, number]
    if (kind === 'moons') {
      const th = Math.PI * u
      p = c ? [0.85 * (0.5 - Math.cos(th)), 0.85 * (0.25 - Math.sin(th))] : [0.85 * (Math.cos(th) - 0.5), 0.85 * (Math.sin(th) - 0.25)]
    } else if (kind === 'circles') {
      const th = 2 * Math.PI * u
      const r = c ? 0.45 * Math.sqrt(rng()) : 1.15
      p = [r * Math.cos(th), r * Math.sin(th)]
    } else {
      const q = Math.floor(u * 4)
      const sx = q % 2 ? 1 : -1
      const sy = (sx > 0) === (c === 1) ? 1 : -1
      p = [sx * 0.75 + g() * 0.25, sy * 0.75 + g() * 0.25]
    }
    return { x: [p[0] + g() * noise, p[1] + g() * noise], t: [c] }
  })
}
