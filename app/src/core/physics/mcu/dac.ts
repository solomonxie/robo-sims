// DACs: R-2R ladder (solved by nodal analysis), sampled tones, reconstruction RC and PWM audio.
import { Element, solveNodal } from '../../nodal'
import { rcStep } from '../circuits'
import { frac } from '../common'

export const ESP32_DAC_BITS = 8

/** Ideal DAC output: code / 2ᴺ of the reference. */
export const dacVolts = (code: number, bits: number, vref: number) => (vref * code) / 2 ** bits

/** Theoretical quantisation SNR of a full-scale sine, dB. */
export const sqnrDb = (bits: number) => 6.02 * bits + 1.76

/** First image of a tone sampled at `fs`: the copy just above Nyquist. */
export const imageHz = (hz: number, fs: number) => fs - hz

/** R-2R ladder, voltage mode. Nodes 1…N along the rungs (1 = LSB end, N = output); node N+1+k is bit k's switch,
 *  held at vref or 0 V. Leg k is 2R from switch k to node k+1; rungs are R; the LSB end ends in 2R to ground. */
export function r2rElements(code: number, bits: number, vref: number, r: number): Element[] {
  const els: Element[] = [{ kind: 'R', a: 1, b: 0, ohms: 2 * r }]
  for (let k = 0; k < bits; k++) {
    els.push({ kind: 'V', a: bits + 1 + k, b: 0, volts: Math.floor(code / 2 ** k) % 2 ? vref : 0 })
    els.push({ kind: 'R', a: bits + 1 + k, b: k + 1, ohms: 2 * r })
  }
  for (let k = 1; k < bits; k++) els.push({ kind: 'R', a: k, b: k + 1, ohms: r })
  return els
}

/** Solved ladder: node volts along the rungs (LSB first), each leg's current into the ladder, each rung's current toward
 *  the output (rung k joins node k and k+1), the termination current to ground and the total drawn from vref. */
export function r2rSolve(code: number, bits: number, vref: number, r: number) {
  const sol = solveNodal(2 * bits, r2rElements(code, bits, vref, r))
  if (!sol) throw new Error('R-2R ladder is singular')
  const legs = Array.from({ length: bits }, (_, k) => sol.amps[2 + 2 * k])
  const rungs = Array.from({ length: bits - 1 }, (_, k) => sol.amps[1 + 2 * bits + k])
  const nodes = sol.volts.slice(1, bits + 1)
  return { nodes, out: nodes[bits - 1], legs, rungs, term: sol.amps[0], supply: legs.filter((i) => i > 0).reduce((s, i) => s + i, 0) }
}

/** 0 … 2ᴺ−1 code of a full-scale sine `hz` at time t. */
export const toneCode = (t: number, hz: number, bits: number) => Math.round(((2 ** bits - 1) * (1 + Math.sin(2 * Math.PI * hz * t))) / 2)

/** The code the DAC holds at time t when it updates `fs` times a second (zero-order hold). */
export const heldCode = (t: number, hz: number, fs: number, bits: number) => toneCode(Math.floor(t * fs) / fs, hz, bits)

/** Held DAC output through an RC low-pass, `points` evenly over [from, from + span) after `warm` s of settling. */
export function heldThroughRc(level: (t: number) => number, fs: number, tauS: number, from: number, span: number, points: number, warm = 10 * tauS) {
  const t0 = from - warm
  let vc = level(t0)
  let t = t0
  const out: number[] = []
  for (let i = 0; i < points; i++) {
    const target = from + (span * i) / points
    while (t < target) {
      const edge = Math.min(target, (Math.floor(t * fs + 1e-9) + 1) / fs)
      vc = rcStep(vc, level((t + edge) / 2), tauS, edge - t)
      t = edge
    }
    out.push(vc)
  }
  return out
}

/** PWM through an RC low-pass, exact per carrier period (duty(t) held for each), sampled like `heldThroughRc`. */
export function pwmThroughRc(duty: (t: number) => number, carrierHz: number, vHigh: number, tauS: number, from: number, span: number, points: number, warm = 10 * tauS) {
  const T = 1 / carrierHz
  const k0 = Math.floor((from - warm) / T)
  let vc = vHigh * duty(k0 * T)
  const out: number[] = []
  let k = k0
  for (let i = 0; i < points; i++) {
    const target = from + (span * i) / points
    while ((k + 1) * T <= target) {
      const d = duty(k * T)
      vc = rcStep(rcStep(vc, vHigh, tauS, d * T), 0, tauS, (1 - d) * T)
      k++
    }
    const d = duty(k * T)
    const into = target - k * T
    out.push(into <= d * T ? rcStep(vc, vHigh, tauS, into) : rcStep(rcStep(vc, vHigh, tauS, d * T), 0, tauS, into - d * T))
  }
  return out
}

/** Instantaneous PWM pin level (0 or vHigh) with the duty held per carrier period. */
export const pwmLevel = (t: number, duty: (t: number) => number, carrierHz: number, vHigh: number) =>
  frac(t * carrierHz) < duty(Math.floor(t * carrierHz) / carrierHz) ? vHigh : 0
