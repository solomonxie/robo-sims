import { kclResidual, solveNodal } from '../nodal'
import { rcGain } from './signals/filters'
import {
  dacVolts,
  heldCode,
  heldThroughRc,
  imageHz,
  pwmLevel,
  pwmThroughRc,
  r2rElements,
  r2rSolve,
  sqnrDb,
  toneCode,
} from './dac'

describe('R-2R ladder', () => {
  it('outputs code / 2ᴺ of the reference for every code', () => {
    for (let c = 0; c < 16; c++) expect(r2rSolve(c, 4, 3.3, 10e3).out).toBeCloseTo(dacVolts(c, 4, 3.3), 9)
    expect(r2rSolve(200, 8, 3.3, 10e3).out).toBeCloseTo(2.578125, 9)
  })

  it('satisfies KCL at every node', () => {
    const els = r2rElements(11, 4, 3.3, 10e3)
    const sol = solveNodal(8, els)!
    for (const r of kclResidual(8, els, sol.amps).slice(1)) expect(Math.abs(r)).toBeLessThan(1e-12)
  })

  it('splits current in halves: a lone MSB sees 4R, a lone LSB fades node by node to 1/16', () => {
    const msb = r2rSolve(8, 4, 3, 1e3)
    expect(msb.legs[3]).toBeCloseTo(3 / 4e3, 9)
    expect(msb.out).toBeCloseTo(1.5, 9)
    const lsb = r2rSolve(1, 4, 3, 1e3)
    for (let k = 0; k < 3; k++) expect(lsb.nodes[k + 1]).toBeLessThan(lsb.nodes[k])
    expect(lsb.out).toBeCloseTo(3 / 16, 9)
  })

  it('draws nothing at code 0', () => {
    const z = r2rSolve(0, 4, 3.3, 10e3)
    expect(z.supply).toBe(0)
    expect(z.out).toBeCloseTo(0, 12)
  })
})

describe('sampled tones', () => {
  it('maps a sine onto 0 … 2ᴺ−1', () => {
    expect(toneCode(0, 1000, 8)).toBe(128)
    expect(toneCode(0.25e-3, 1000, 8)).toBe(255)
    expect(toneCode(0.75e-3, 1000, 8)).toBe(0)
    expect(toneCode(0.25e-3, 1000, 2)).toBe(3)
  })

  it('holds each sample until the next update', () => {
    const fs = 8000
    expect(heldCode(0.3 / fs, 1000, fs, 8)).toBe(toneCode(0, 1000, 8))
    expect(heldCode(2.9 / fs, 1000, fs, 8)).toBe(toneCode(2 / fs, 1000, 8))
  })

  it('gives ~6 dB per bit and an image at fs − f', () => {
    expect(sqnrDb(8)).toBeCloseTo(49.92, 2)
    expect(sqnrDb(12) - sqnrDb(11)).toBeCloseTo(6.02, 2)
    expect(imageHz(1000, 8000)).toBe(7000)
  })
})

describe('reconstruction', () => {
  it('settles a held level through the RC', () => {
    const out = heldThroughRc(() => 2, 8000, 1e-4, 0, 1e-3, 10)
    for (const v of out) expect(v).toBeCloseTo(2, 3)
  })

  it('passes a well-sampled tone with the RC gain', () => {
    const fs = 1e6
    const tau = 1 / (2 * Math.PI * 3000)
    const out = heldThroughRc((t) => Math.sin(2 * Math.PI * 1000 * t), fs, tau, 0, 1e-3, 400)
    const peak = Math.max(...out)
    expect(peak).toBeCloseTo(rcGain('low', 1000, 3000), 2)
  })

  it('averages PWM to duty × V with small ripple', () => {
    const out = pwmThroughRc(() => 0.25, 100e3, 3.3, 1e-3, 0.5e-3, 1e-3, 50)
    for (const v of out) expect(v).toBeCloseTo(0.825, 2)
  })

  it('gives the same samples from any start time', () => {
    const level = (t: number) => heldCode(t, 1000, 8000, 4)
    const all = heldThroughRc(level, 8000, 5e-5, 0, 1e-3, 20)
    const tail = heldThroughRc(level, 8000, 5e-5, 0.5e-3, 0.5e-3, 10)
    tail.forEach((v, i) => expect(v).toBeCloseTo(all[10 + i], 3))
  })

  it('switches the pin at the held duty', () => {
    const d = () => 0.3
    expect(pwmLevel(0.2e-6, d, 1e5, 3.3)).toBe(3.3)
    expect(pwmLevel(5e-6, d, 1e5, 3.3)).toBe(0)
  })
})
