import {
  DRAM,
  FLASH,
  SRAM_VDD,
  chargeShare,
  dramLeak,
  dramRetention,
  dramTau,
  electrons,
  flashRead,
  flashStep,
  flashVth,
  floatingGateV,
  fnCurrent,
  nmosPass,
  senseBit,
  sramBit,
  sramStep,
} from '.'
import { MODERN_NMOS } from './semiconductors'

const V = SRAM_VDD

describe('memory', () => {
  it('SRAM latch holds its bit and recovers from a small upset', () => {
    const held = sramStep({ q: V, qb: 0, bl: V, blb: V }, { wl: 0 }, 1e-9)
    expect(held.q).toBeGreaterThan(0.99 * V)
    expect(held.qb).toBeLessThan(0.01 * V)
    const upset = sramStep({ q: 0.7 * V, qb: 0.3 * V, bl: V, blb: V }, { wl: 0 }, 1e-10)
    expect(sramBit(upset)).toBe(1)
    expect(upset.q).toBeGreaterThan(0.95 * V)
  })

  it('SRAM write overpowers the latch through the access switches', () => {
    const w = sramStep({ q: V, qb: 0, bl: V, blb: V }, { wl: V, drive: [0, V] }, 20e-12)
    expect(sramBit(w)).toBe(0)
    const after = sramStep(w, { wl: 0 }, 1e-9)
    expect(after.qb).toBeGreaterThan(0.99 * V)
    expect(sramStep({ q: V, qb: 0, bl: 0, blb: 0 }, { wl: 0, drive: [0, V] }, 1e-9).q).toBeGreaterThan(0.99 * V)
  })

  it('SRAM read pulls one precharged bit line down without flipping the cell', () => {
    const r = sramStep({ q: 0, qb: V, bl: V, blb: V }, { wl: V }, 50e-12)
    expect(sramBit(r)).toBe(0)
    expect(r.q).toBeLessThan(0.3 * V)
    expect(r.bl).toBeLessThan(0.5 * V)
    expect(r.blb).toBeCloseTo(V, 3)
  })

  it('NMOS pass current flows from the higher side, zero when off', () => {
    expect(nmosPass(V, V, 0, MODERN_NMOS)).toBeGreaterThan(0)
    expect(nmosPass(V, 0, V, MODERN_NMOS)).toBeCloseTo(-nmosPass(V, V, 0, MODERN_NMOS), 12)
    expect(Math.abs(nmosPass(0, V, 0, MODERN_NMOS))).toBeLessThan(1e-6)
  })

  it('DRAM leakage doubles every 10 °C and decays exponentially', () => {
    expect(dramTau(35)).toBeCloseTo(dramTau(25) / 2, 9)
    expect(dramLeak(1, dramTau(25), dramTau(25))).toBeCloseTo(Math.exp(-1), 9)
  })

  it('DRAM read shares charge with the bit line: a small swing either way', () => {
    const one = chargeShare(DRAM.vdd)
    expect(one.signal).toBeCloseTo((DRAM.vdd / 2) * (DRAM.cellF / (DRAM.cellF + DRAM.bitlineF)), 9)
    expect(chargeShare(0).signal).toBeCloseTo(-one.signal, 9)
    expect(senseBit(DRAM.vdd)).toBe(1)
    expect(senseBit(0)).toBe(0)
    expect(senseBit(DRAM.vdd / 2 + 0.01)).toBeNull()
  })

  it('DRAM retention outlasts the 64 ms refresh up to 85 °C, not at 95 °C', () => {
    expect(dramRetention(dramTau(85))).toBeGreaterThan(0.064)
    expect(dramRetention(dramTau(95))).toBeLessThan(0.064)
    expect(dramRetention(dramTau(95))).toBeGreaterThan(0.032)
    const tau = dramTau(25)
    const t = dramRetention(tau)
    expect(senseBit(dramLeak(DRAM.vdd, t * 0.99, tau))).toBe(1)
    expect(senseBit(dramLeak(DRAM.vdd, t * 1.01, tau))).toBeNull()
  })

  it('Fowler–Nordheim current is odd in field and steeply exponential', () => {
    expect(fnCurrent(-1e9)).toBeCloseTo(-fnCurrent(1e9), 6)
    expect(fnCurrent(1.2e9) / fnCurrent(1e9)).toBeGreaterThan(10)
    expect(fnCurrent(0)).toBe(0)
  })

  it('Flash program pulse adds electrons and raises Vth past the read voltage; low voltage barely does', () => {
    expect(floatingGateV(0, 18, 0)).toBeCloseTo(18 * 0.6, 9)
    const q = flashStep(0, { vcg: 18, vch: 0 }, 10e-6)
    expect(electrons(q)).toBeGreaterThan(500)
    expect(flashVth(q)).toBeGreaterThan(FLASH.vread + 1)
    expect(flashRead(q)).toBe(0)
    expect(flashRead(flashStep(0, { vcg: 14, vch: 0 }, 10e-6))).toBe(1)
    expect(flashVth(flashStep(0, { vcg: 20, vch: 0 }, 10e-6))).toBeGreaterThan(flashVth(q))
  })

  it('Flash keeps its charge with power off for years; erase pulls it back out', () => {
    const q = flashStep(0, { vcg: 18, vch: 0 }, 10e-6)
    const tenYears = flashStep(q, { vcg: 0, vch: 0 }, 10 * 3.15e7)
    expect(tenYears / q).toBeGreaterThan(0.999)
    const erased = flashStep(q, { vcg: 0, vch: 18 }, 10e-6)
    expect(flashVth(erased)).toBeLessThan(FLASH.vth0)
    expect(flashRead(erased)).toBe(1)
    const verified = flashStep(q, { vcg: 0, vch: 18, verify: FLASH.vth0 }, 10e-6)
    expect(flashVth(verified)).toBeLessThanOrEqual(FLASH.vth0)
    expect(Math.abs(electrons(verified))).toBeLessThan(5)
  })
})
