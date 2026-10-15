// Li-ion charging: pre-charge, constant current, constant voltage, C/10 stop; a TP4056 linear charger and its thermal limits.
import { Chemistry } from './batteries'
import { cellVolts } from './packs'

export interface Charger {
  /** Constant-current setpoint, A. */
  amps: number
  /** CV setpoint, V; `Infinity` = a dumb CC-only supply. */
  cvVolts: number
  /** Below this rest voltage the cell gets `amps × preFrac` only. */
  preBelow: number
  preFrac: number
  /** Stop once the CV current tapers to `amps × endFrac` (C/10 when `amps` = 1C). */
  endFrac: number
  /** Resistance seen while charging (DC + polarisation), Ω. */
  ohms: number
}

export const liionCharger = (amps: number, cvVolts = 4.2): Charger => ({ amps, cvVolts, preBelow: 2.9, preFrac: 0.1, endFrac: 0.1, ohms: 0.15 })

export type ChargePhase = 'pre' | 'cc' | 'cv' | 'done' | 'cut'

/** Charger output at state of charge `soc` (may be < 0 or > 1, see `cellVolts`): phase, amps into the cell, terminal volts. */
export function chargePoint(c: Chemistry, soc: number, ch: Charger): { phase: ChargePhase; amps: number; volts: number } {
  const rest = cellVolts(c, soc)
  if (rest < ch.preBelow) return { phase: 'pre', amps: ch.amps * ch.preFrac, volts: rest + ch.amps * ch.preFrac * ch.ohms }
  const cvAmps = (ch.cvVolts - rest) / ch.ohms
  if (cvAmps >= ch.amps) return { phase: 'cc', amps: ch.amps, volts: rest + ch.amps * ch.ohms }
  if (cvAmps <= ch.amps * ch.endFrac) return { phase: 'done', amps: 0, volts: rest }
  return { phase: 'cv', amps: cvAmps, volts: ch.cvVolts }
}

export interface ChargeSample {
  hours: number
  soc: number
  amps: number
  volts: number
  phase: ChargePhase
}

/** Steps a charge from `soc0` every `dtS` seconds until it ends: 'done' at the taper, or 'cut' when the terminal passes
 *  `cutVolts` (a BMS over-charge trip). Gives up after `maxHours`. */
export function chargeCurve(c: Chemistry, ch: Charger, soc0: number, { dtS = 20, cutVolts = Infinity, maxHours = 24 } = {}): ChargeSample[] {
  const out: ChargeSample[] = []
  let soc = soc0
  for (let t = 0; t <= maxHours * 3600; t += dtS) {
    const p = chargePoint(c, soc, ch)
    const phase = p.volts > cutVolts ? 'cut' : p.phase
    out.push({ hours: t / 3600, soc, amps: phase === 'cut' ? 0 : p.amps, volts: p.volts, phase })
    if (phase === 'done' || phase === 'cut') break
    soc += (p.amps * dtS) / 3.6 / c.cell.mAh
  }
  return out
}

/** Sample of `curve` at `hours` (the last one past the end). */
export function sampleAt(curve: ChargeSample[], hours: number): ChargeSample {
  const dt = curve.length > 1 ? curve[1].hours : 1
  return curve[Math.max(0, Math.min(curve.length - 1, Math.round(hours / dt)))]
}

/** TP4056 linear Li-ion charger: I = 1200 × 1 V / R_PROG, 4.2 V CV, die held at 120 °C by cutting current.
 *  `thetaJA` is the SOP-8 on a small module, °C/W; TEMP-pin window 0 … 45 °C with the usual NTC divider. */
export const TP4056 = { vin: 5, gain: 1200, progVolts: 1, maxAmps: 1, thetaJA: 50, dieLimitC: 120, coldC: 0, hotC: 45 }

export const tp4056Amps = (rProg: number) => Math.min(TP4056.maxAmps, (TP4056.gain * TP4056.progVolts) / rProg)

/** Linear charger heat: everything between the USB 5 V and the cell burns in the chip. */
export const chargerWatts = (vbat: number, amps: number, vin = TP4056.vin) => Math.max(0, vin - vbat) * amps

export const dieC = (ambientC: number, vbat: number, amps: number) => ambientC + TP4056.thetaJA * chargerWatts(vbat, amps)

/** Current after thermal regulation: the chip lowers it until the die sits at `dieLimitC`. */
export function throttledAmps(setAmps: number, ambientC: number, vbat: number): number {
  const w = chargerWatts(vbat, 1)
  if (w <= 0) return setAmps
  return Math.max(0, Math.min(setAmps, (TP4056.dieLimitC - ambientC) / (TP4056.thetaJA * w)))
}

export type CellTemp = 'cold' | 'ok' | 'hot'

/** Li-ion charge window: below 0 °C lithium plates onto the anode; above 45 °C the cell ages fast and can run away. */
export const cellTemp = (c: number): CellTemp => (c < TP4056.coldC ? 'cold' : c > TP4056.hotC ? 'hot' : 'ok')

export interface Tp4056Point {
  phase: ChargePhase | 'paused'
  amps: number
  volts: number
  dieC: number
  cell: CellTemp
  throttled: boolean
}

/** TP4056 at `ambientC` (cell and chip both sit in it): with an NTC on TEMP it pauses outside the window; tied to GND it
 *  charges anyway. Current is throttled to hold the die at its limit. */
export function tp4056Point(c: Chemistry, soc: number, rProg: number, ambientC: number, ntc: boolean): Tp4056Point {
  const cell = cellTemp(ambientC)
  const rest = cellVolts(c, soc)
  if (ntc && cell !== 'ok') return { phase: 'paused', amps: 0, volts: rest, dieC: ambientC, cell, throttled: false }
  const set = tp4056Amps(rProg)
  const limit = throttledAmps(set, ambientC, rest)
  const p = chargePoint(c, soc, liionCharger(limit))
  return { ...p, dieC: dieC(ambientC, p.volts, p.amps), cell, throttled: limit < set - 1e-6 && p.phase === 'cc' }
}
