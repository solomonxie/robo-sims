// Memory cells: an SRAM latch (6T), a DRAM capacitor that leaks, a Flash floating gate charged by tunnelling.
import { MODERN_NMOS, Mosfet, mosfetDrain } from './semiconductors'

// --- SRAM: two cross-coupled CMOS inverters, two NMOS access switches to the bit lines. ---

export const SRAM_VDD = 1.2
/** Transistor strengths: the pull-down beats the access switch (reads don't flip), the access switch beats the pull-up (writes do). */
export const SRAM = {
  pullUp: MODERN_NMOS,
  access: { ...MODERN_NMOS, k: 2 * MODERN_NMOS.k },
  pullDown: { ...MODERN_NMOS, k: 4 * MODERN_NMOS.k },
  nodeF: 1e-15,
  bitlineF: 20e-15,
}

export interface SramCell {
  q: number
  qb: number
  bl: number
  blb: number
}

/** Current from `a` to `b` through an NMOS switch with gate at `vg` (the lower side is its source). */
export function nmosPass(vg: number, va: number, vb: number, m: Mosfet) {
  const lo = Math.min(va, vb)
  const i = mosfetDrain(vg - lo, Math.abs(va - vb), m).amps
  return va >= vb ? i : -i
}

/** Current an inverter with input `vin` pushes into its output node at `vout`. */
const inverterAmps = (vin: number, vout: number, vdd: number) =>
  mosfetDrain(vdd - vin, vdd - vout, SRAM.pullUp).amps - mosfetDrain(vin, vout, SRAM.pullDown).amps

/** Advances the cell by `dt` s. Word line `wl` (V) opens the access switches; `drive` forces the bit lines (write),
 *  else they float on their capacitance (read). */
export function sramStep(s: SramCell, { wl, drive }: { wl: number; drive?: [number, number] }, dt: number, vdd = SRAM_VDD): SramCell {
  const steps = Math.min(5000, Math.ceil(dt / ((0.05 * SRAM.nodeF) / (SRAM.pullDown.k * vdd))))
  const h = dt / steps
  let { q, qb, bl, blb } = drive ? { ...s, bl: drive[0], blb: drive[1] } : s
  const clip = (v: number) => Math.min(vdd, Math.max(0, v))
  for (let i = 0; i < steps; i++) {
    const ia = nmosPass(wl, bl, q, SRAM.access)
    const ib = nmosPass(wl, blb, qb, SRAM.access)
    const dq = (inverterAmps(qb, q, vdd) + ia) / SRAM.nodeF
    const dqb = (inverterAmps(q, qb, vdd) + ib) / SRAM.nodeF
    q = clip(q + dq * h)
    qb = clip(qb + dqb * h)
    if (!drive) {
      bl = clip(bl - (ia / SRAM.bitlineF) * h)
      blb = clip(blb - (ib / SRAM.bitlineF) * h)
    }
  }
  return { q, qb, bl, blb }
}

export const sramBit = (s: SramCell) => (s.q > s.qb ? 1 : 0)

// --- DRAM: one access transistor and one capacitor; the charge leaks away and must be refreshed. ---

export const DRAM = {
  vdd: 1.1,
  cellF: 20e-15,
  bitlineF: 80e-15,
  /** Leak time constant at 25 °C; leakage doubles every 10 °C. */
  tau25: 16,
  /** Smallest bit-line swing the sense amplifier resolves, V. */
  senseV: 0.04,
}

export const dramTau = (celsius: number) => DRAM.tau25 / 2 ** ((celsius - 25) / 10)

/** Cell voltage `t` s after it was written to `v0`, leaking toward 0 V. */
export const dramLeak = (v0: number, t: number, tauS: number) => v0 * Math.exp(-t / tauS)

/** Opening the word line shares the cell's charge with the bit line precharged to Vdd/2: both settle at one voltage. */
export function chargeShare(vCell: number, { vdd, cellF, bitlineF } = DRAM) {
  const vpre = vdd / 2
  const v = (cellF * vCell + bitlineF * vpre) / (cellF + bitlineF)
  return { v, signal: v - vpre }
}

/** Bit the sense amplifier reads, or null when the swing is too small to tell. */
export function senseBit(vCell: number, cfg = DRAM) {
  const { signal } = chargeShare(vCell, cfg)
  return Math.abs(signal) < cfg.senseV ? null : signal > 0 ? 1 : 0
}

/** How long a written 1 stays readable: until its swing on the bit line drops below the sense margin. */
export function dramRetention(tauS: number, cfg = DRAM) {
  const vMin = cfg.vdd / 2 + (cfg.senseV * (cfg.cellF + cfg.bitlineF)) / cfg.cellF
  return tauS * Math.log(cfg.vdd / vMin)
}

// --- Flash: a floating gate between the channel and the control gate; tunnelling electrons shift the threshold. ---

const E = 1.602e-19

export const FLASH = {
  /** Tunnel oxide thickness, m, and area, m². */
  tox: 8e-9,
  area: 1e-15,
  /** Floating gate's coupling to the control gate and to the channel, F. */
  ccg: 0.06e-15,
  cch: 0.04e-15,
  /** Threshold with no stored charge, V. */
  vth0: 0,
  /** Fowler–Nordheim constants for SiO₂: J = A·E²·exp(−B/E). */
  fnA: 1.25e-6,
  fnB: 2.33e10,
  /** Read voltage on the control gate, between the erased and programmed thresholds. */
  vread: 1,
}

/** Fowler–Nordheim tunnel current density, A/m², at oxide field `field` V/m (signed). */
export function fnCurrent(field: number, cfg = FLASH) {
  const f = Math.abs(field)
  if (f < 1e6) return 0
  return Math.sign(field) * cfg.fnA * f * f * Math.exp(-cfg.fnB / f)
}

/** Floating-gate voltage from capacitive coupling plus its own charge `q` (C, negative = stored electrons). */
export const floatingGateV = (q: number, vcg: number, vch: number, cfg = FLASH) => (cfg.ccg * vcg + cfg.cch * vch + q) / (cfg.ccg + cfg.cch)

/** Threshold seen from the control gate: stored electrons push it up by −q/Ccg. */
export const flashVth = (q: number, cfg = FLASH) => cfg.vth0 - q / cfg.ccg

export const electrons = (q: number) => -q / E

/** Advances the floating-gate charge by `dt` s with `vcg` on the control gate and `vch` on the channel/substrate:
 *  electrons tunnel through the oxide toward the more positive side. Steps stay short enough that Vfg moves ≤ 2 mV each.
 *  `verify` stops the pulse once Vth has moved past it (program/erase verify). */
export function flashStep(q: number, { vcg, vch, verify }: { vcg: number; vch: number; verify?: number }, dt: number, cfg = FLASH) {
  const ct = cfg.ccg + cfg.cch
  let left = dt
  for (let i = 0; left > 0 && i < 20000; i++) {
    const field = (floatingGateV(q, vcg, vch, cfg) - vch) / cfg.tox
    const amps = fnCurrent(field, cfg) * cfg.area
    if (!amps || (verify !== undefined && (amps > 0 ? flashVth(q, cfg) >= verify : flashVth(q, cfg) <= verify))) break
    const h = Math.min(left, (0.002 * ct) / Math.abs(amps))
    q -= amps * h
    left -= h
  }
  return q
}

/** Cell conducts at the read voltage → reads 1 (erased); stored electrons block it → 0 (programmed). */
export const flashRead = (q: number, cfg = FLASH) => (cfg.vread > flashVth(q, cfg) ? 1 : 0)
