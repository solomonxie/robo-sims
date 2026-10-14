// Multi-cell packs: ratings, BMS cutoffs, and cells drifting apart over many cycles.
import { Chemistry, openCircuitVolts } from './batteries'
import { cellPack } from './circuits'

/** Volts per unit of state of charge beyond the curve ends: overcharge climbs, over-discharge collapses. */
const OVER_SLOPE = 2
const UNDER_SLOPE = 20

/** Rest voltage with the ends extended: above full (overcharged) and below empty (over-discharged, floored at 0 V). */
export function cellVolts(c: Chemistry, soc: number): number {
  if (soc > 1) return c.full + (soc - 1) * OVER_SLOPE
  if (soc < 0) return Math.max(0, c.cutoff + soc * UNDER_SLOPE)
  return openCircuitVolts(c, soc)
}

/** `series`S`parallel`P pack of one chemistry: volts add in series; capacity, max current and conductance add in parallel. */
export function packRating(c: Chemistry, series: number, parallel: number, cellMaxAmps: number) {
  const p = cellPack(c.nominal, c.cell.mAh, series, parallel)
  const maxAmps = cellMaxAmps * parallel
  return {
    ...p,
    full: c.full * series,
    empty: c.cutoff * series,
    maxAmps,
    maxWatts: p.volts * maxAmps,
    ohms: (c.cell.ohms * series) / parallel,
    grams: c.cell.grams * p.cells,
  }
}

export interface BmsLimits {
  /** Over-voltage per cell (charging stops). */
  ovp: number
  /** Under-voltage per cell (load disconnects). */
  uvp: number
  /** Over-current, either direction. */
  ocp: number
}

export const BMS_LIMITS: BmsLimits = { ovp: 4.25, uvp: 2.75, ocp: 12 }

export type BmsFault = 'over-current' | 'over-charge' | 'over-discharge'

/** First fault a BMS sees in its cell taps and shunt; null = MOSFETs stay on. */
export function bmsFault(cellV: number[], amps: number, l: BmsLimits = BMS_LIMITS): BmsFault | null {
  if (Math.abs(amps) > l.ocp) return 'over-current'
  if (cellV.some((v) => v > l.ovp)) return 'over-charge'
  if (cellV.some((v) => v < l.uvp)) return 'over-discharge'
  return null
}

/** Cell volts under a discharge of `amps` (same current through every series cell). */
export const loadedCellVolts = (c: Chemistry, socs: number[], amps: number) => socs.map((s) => cellVolts(c, s) - amps * c.cell.ohms)

/** Discharging series cells from `socs` at `amps`: mAh drawn when the BMS trips, and why. */
export function bmsTrip(c: Chemistry, socs: number[], amps: number, l: BmsLimits = BMS_LIMITS): { mAh: number; fault: BmsFault } {
  const at = (mAh: number) => loadedCellVolts(c, socs.map((s) => s - mAh / c.cell.mAh), amps)
  const first = bmsFault(at(0), amps, l)
  if (first) return { mAh: 0, fault: first }
  let lo = 0
  let hi = c.cell.mAh * (Math.max(...socs) + 1)
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (bmsFault(at(mid), amps, l)) hi = mid
    else lo = mid
  }
  return { mAh: hi, fault: 'over-discharge' }
}

export interface DriftWeek {
  /** State of charge per cell after charging (and balancing). */
  top: number[]
  /** After a week on the shelf. */
  stored: number[]
  /** After driving to the first cell's cutoff. */
  bottom: number[]
  topVolts: number[]
  bledMAh: number[]
  usableMAh: number
}

/** Series cells charged to `series × full` (or the first cell's OVP), left a week leaking `leakMAh`, then driven until the
 *  weakest cell is empty. Balancing bleeds high cells by up to `bleedMAh` toward the lowest, then tops up. */
export function driftWeeks(
  c: Chemistry,
  capsMAh: number[],
  leakMAh: number[],
  weeks: number,
  { balance = false, bleedMAh = 60, startSoc = 0.5, l = BMS_LIMITS } = {},
): DriftWeek[] {
  const q = capsMAh.map((cap) => cap * startSoc)
  const soc = () => q.map((x, i) => x / capsMAh[i])
  const charge = () => {
    const over = (x: number) => {
      const v = q.map((qi, i) => cellVolts(c, (qi + x) / capsMAh[i]))
      return v.reduce((s, vi) => s + vi, 0) > c.full * q.length || v.some((vi) => vi > l.ovp)
    }
    let lo = 0
    let hi = Math.max(...capsMAh)
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2
      if (over(mid)) hi = mid
      else lo = mid
    }
    q.forEach((_, i) => (q[i] += lo))
  }
  const out: DriftWeek[] = []
  for (let w = 0; w < weeks; w++) {
    charge()
    const bled = q.map(() => 0)
    if (balance) {
      const low = Math.min(...soc())
      q.forEach((qi, i) => {
        bled[i] = Math.min(bleedMAh, qi - low * capsMAh[i])
        q[i] -= bled[i]
      })
      charge()
    }
    const top = soc()
    q.forEach((qi, i) => (q[i] = Math.max(0, qi - leakMAh[i])))
    const stored = soc()
    const usable = Math.min(...q)
    q.forEach((_, i) => (q[i] -= usable))
    out.push({ top, stored, bottom: soc(), topVolts: top.map((s) => cellVolts(c, s)), bledMAh: bled, usableMAh: usable })
  }
  return out
}
