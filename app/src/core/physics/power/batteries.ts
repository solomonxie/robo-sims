// Cell chemistries: open-circuit voltage vs state of charge, internal-resistance sag, C-rate.

export type ChemistryId = 'alkaline' | 'nimh' | 'liion' | 'lfp'

export interface Chemistry {
  name: string
  anode: string
  cathode: string
  /** Ion that crosses the separator; Li⁺ heads to the cathode on discharge, OH⁻ to the anode. */
  ion: 'Li+' | 'OH-'
  nominal: number
  full: number
  cutoff: number
  whPerKg: number
  rechargeable: boolean
  /** Typical cell: format, capacity and DC internal resistance. */
  cell: { format: 'AA' | '18650'; mAh: number; ohms: number; grams: number }
  /** Open-circuit volts at state of charge 0 … 1, rising. */
  curve: [number, number][]
}

export const CHEMISTRIES: Record<ChemistryId, Chemistry> = {
  alkaline: {
    name: 'Alkaline', anode: 'Zn', cathode: 'MnO₂', ion: 'OH-', nominal: 1.5, full: 1.6, cutoff: 0.9, whPerKg: 110, rechargeable: false,
    cell: { format: 'AA', mAh: 2500, ohms: 0.15, grams: 23 },
    curve: [[0, 0.9], [0.1, 1.05], [0.3, 1.2], [0.5, 1.3], [0.7, 1.4], [0.9, 1.5], [1, 1.6]],
  },
  nimh: {
    name: 'NiMH', anode: 'MH', cathode: 'NiOOH', ion: 'OH-', nominal: 1.2, full: 1.4, cutoff: 1.0, whPerKg: 80, rechargeable: true,
    cell: { format: 'AA', mAh: 2000, ohms: 0.03, grams: 27 },
    curve: [[0, 1.0], [0.05, 1.15], [0.15, 1.2], [0.5, 1.24], [0.85, 1.28], [0.95, 1.33], [1, 1.4]],
  },
  liion: {
    name: 'Li-ion', anode: 'C₆', cathode: 'NMC', ion: 'Li+', nominal: 3.7, full: 4.2, cutoff: 3.0, whPerKg: 240, rechargeable: true,
    cell: { format: '18650', mAh: 3000, ohms: 0.04, grams: 46 },
    curve: [[0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.2, 3.55], [0.4, 3.65], [0.6, 3.8], [0.8, 3.95], [1, 4.2]],
  },
  lfp: {
    name: 'LiFePO₄', anode: 'C₆', cathode: 'FePO₄', ion: 'Li+', nominal: 3.2, full: 3.6, cutoff: 2.5, whPerKg: 140, rechargeable: true,
    cell: { format: '18650', mAh: 1500, ohms: 0.05, grams: 41 },
    curve: [[0, 2.5], [0.05, 3.0], [0.1, 3.2], [0.3, 3.27], [0.7, 3.32], [0.9, 3.35], [0.97, 3.4], [1, 3.6]],
  },
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Open-circuit volts at state of charge `soc` (0 empty … 1 full). */
export function openCircuitVolts(c: Chemistry, soc: number): number {
  const s = clamp01(soc)
  const pts = c.curve
  for (let i = 1; i < pts.length; i++) {
    const [s1, v1] = pts[i]
    const [s0, v0] = pts[i - 1]
    if (s <= s1) return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0)
  }
  return pts[pts.length - 1][1]
}

/** Volts at the terminals: OCV minus I × R sag (negative amps = charging, so it rises). */
export const terminalVolts = (c: Chemistry, soc: number, amps: number, ohms = c.cell.ohms) => openCircuitVolts(c, soc) - amps * ohms

/** Amps drawn at a C-rate: 1 C empties the rated capacity in one hour. */
export const cRateAmps = (mAh: number, c: number) => (c * mAh) / 1000

/** Hours the rated capacity lasts at a C-rate, ignoring sag. */
export const cRateHours = (c: number) => 1 / c

/** State of charge where the terminal sags to cutoff at this current. */
export function cutoffSoc(c: Chemistry, amps: number, ohms = c.cell.ohms): number {
  if (terminalVolts(c, 1, amps, ohms) <= c.cutoff) return 1
  let lo = 0
  let hi = 1
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (terminalVolts(c, mid, amps, ohms) > c.cutoff) hi = mid
    else lo = mid
  }
  return hi
}

/** Fraction of rated capacity delivered before the load sees cutoff. */
export const usableFraction = (c: Chemistry, amps: number, ohms = c.cell.ohms) => 1 - cutoffSoc(c, amps, ohms)

/** Energy delivered (Wh) discharging from full to cutoff at a steady current: ∑ V_terminal × ΔAh. */
export function deliveredWh(c: Chemistry, amps: number, steps = 200): number {
  const end = cutoffSoc(c, amps)
  const ah = c.cell.mAh / 1000
  let wh = 0
  for (let k = 0; k < steps; k++) {
    const soc = 1 - ((k + 0.5) / steps) * (1 - end)
    wh += terminalVolts(c, soc, amps) * ((1 - end) / steps) * ah
  }
  return wh
}

/** Current into a dead short at the terminals: OCV ÷ R. */
export const shortCircuitAmps = (c: Chemistry, soc: number, ohms = c.cell.ohms) => openCircuitVolts(c, soc) / ohms
