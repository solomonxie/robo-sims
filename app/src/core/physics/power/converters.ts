// DC-DC modules as bought: LM2596 buck, MT3608 boost, XL6009 SEPIC buck-boost. Trim-pot set point, losses, limits.
import { Chemistry } from './batteries'
import { cellVolts } from './packs'
import { Switcher } from '../regulators'

export type Topology = 'buck' | 'boost' | 'sepic'

export interface DcdcModule {
  name: string
  topology: Topology
  sw: Switcher
  /** Feedback reference; Vout = Vref (1 + Rpot / Rlow) with the trimmer on top of the divider. */
  vref: number
  rLow: number
  potOhms: number
  vinMin: number
  vinMax: number
  maxDuty: number
  /** Switch current limit (peak), A; continuous output a bare module handles without a heatsink, A. */
  switchAmps: number
  ratedAmps: number
  /** Controller quiescent draw, A, and switch rise + fall time, s. */
  iq: number
  edgeS: number
  /** Board to air, °C/W. */
  thetaJA: number
}

/** LM2596S-ADJ module: 150 kHz, 33 µH toroid, bipolar switch (~1.5 V drop at 3 A), SS34 catch diode, 10 k multi-turn pot. */
export const LM2596: DcdcModule = {
  name: 'LM2596',
  topology: 'buck',
  sw: { fHz: 150e3, henries: 33e-6, ronOhms: 0.4, diodeV: 0.5, dcrOhms: 0.04 },
  vref: 1.23,
  rLow: 330,
  potOhms: 10e3,
  vinMin: 4.5,
  vinMax: 40,
  maxDuty: 0.93,
  switchAmps: 4.5,
  ratedAmps: 2,
  iq: 0.005,
  edgeS: 250e-9,
  thetaJA: 30,
}

/** MT3608 module: 1.2 MHz, 22 µH, 80 mΩ switch, SS34 diode, 100 k pot. */
export const MT3608: DcdcModule = {
  name: 'MT3608',
  topology: 'boost',
  sw: { fHz: 1.2e6, henries: 22e-6, ronOhms: 0.08, diodeV: 0.45, dcrOhms: 0.1 },
  vref: 0.6,
  rLow: 2200,
  potOhms: 100e3,
  vinMin: 2,
  vinMax: 24,
  maxDuty: 0.9,
  switchAmps: 4,
  ratedAmps: 1,
  iq: 0.002,
  edgeS: 20e-9,
  thetaJA: 60,
}

/** XL6009 buck-boost module: a SEPIC (two 47 µH coils + coupling cap), 400 kHz, 50 k pot; needs 5 V in to start. */
export const XL6009: DcdcModule = {
  name: 'XL6009',
  topology: 'sepic',
  sw: { fHz: 400e3, henries: 47e-6, ronOhms: 0.11, diodeV: 0.5, dcrOhms: 0.08 },
  vref: 1.25,
  rLow: 2200,
  potOhms: 50e3,
  vinMin: 5,
  vinMax: 32,
  maxDuty: 0.9,
  switchAmps: 4,
  ratedAmps: 1.5,
  iq: 0.005,
  edgeS: 40e-9,
  thetaJA: 35,
}

export const DCDC_MODULES = { lm2596: LM2596, mt3608: MT3608, xl6009: XL6009 }

/** Output set by the trimmer (top of the divider) at `rPot` ohms. */
export const potVolts = (m: DcdcModule, rPot: number) => m.vref * (1 + rPot / m.rLow)

/** Trimmer resistance for `vset`, and the fraction of its travel (0 … 1, clamped). */
export function potFor(m: DcdcModule, vset: number) {
  const ohms = Math.min(m.potOhms, Math.max(0, (vset / m.vref - 1) * m.rLow))
  return { ohms, frac: ohms / m.potOhms }
}

export type DcdcLimit = 'off' | 'over-voltage' | 'dropout' | 'pass-through' | 'current-limit'

export interface DcdcPoint {
  vin: number
  vout: number
  iout: number
  iin: number
  duty: number
  /** Inductor (L1) average, peak-to-peak ripple and switch peak, A. */
  il: number
  ripple: number
  peak: number
  losses: { switch: number; diode: number; coil: number; switching: number; quiescent: number }
  loss: number
  efficiency: number
  regulating: boolean
  limit: DcdcLimit | null
}

/** Average CCM model with an `iout` current-source load: output at duty `d` (volt-seconds on the coil, conduction drops in),
 *  the coil and switch currents, and the loss split. */
function atDuty(m: DcdcModule, vin: number, d: number, iout: number) {
  const { fHz, henries: L, ronOhms: ron, diodeV: vd, dcrOhms: dcr } = m.sw
  const off = 1 - d
  const sw = 0.5 * m.edgeS * fHz
  if (m.topology === 'buck') {
    const vout = Math.max(0, d * (vin - iout * ron) - off * vd - iout * dcr)
    const ripple = (Math.max(0, vin - vout) * d) / (L * fHz)
    return {
      vout, il: iout, ripple, peak: iout + ripple / 2,
      losses: { switch: iout * iout * ron * d, diode: vd * iout * off, coil: iout * iout * dcr, switching: sw * vin * iout * (d > 0 ? 1 : 0) },
    }
  }
  if (m.topology === 'boost') {
    const il = iout / off
    const vout = Math.max(0, (vin - il * dcr - d * il * ron) / off - vd)
    const ripple = (vin * d) / (L * fHz)
    return {
      vout, il, ripple, peak: il + ripple / 2,
      losses: { switch: il * il * ron * d, diode: vd * iout, coil: il * il * dcr, switching: d > 0 ? sw * (vout + vd) * il : 0 },
    }
  }
  const i1 = (iout * d) / off
  const isw = i1 + iout
  const vout = Math.max(0, (d / off) * (vin - isw * ron - i1 * dcr) - vd - iout * dcr)
  const ripple = (vin * d) / (L * fHz)
  return {
    vout, il: i1, ripple, peak: isw + ripple / 2,
    losses: { switch: isw * isw * ron * d, diode: vd * iout, coil: (i1 * i1 + iout * iout) * dcr, switching: d > 0 ? sw * (vin + vout + vd) * isw : 0 },
  }
}

/** Largest x in [lo, hi] with ok(x), for ok true below some threshold. */
function bisect(ok: (x: number) => boolean, lo: number, hi: number) {
  if (ok(hi)) return hi
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Steady state of a module set to `vset`, fed `vin`, loaded with `iout`. The loop picks the duty that hits `vset`; it runs out
 *  at max duty (dropout), at the switch current limit, or (boost) can't go below Vin − Vd, so the input passes straight through. */
export function dcdcPoint(m: DcdcModule, vin: number, vset: number, iout: number): DcdcPoint {
  const zero = { switch: 0, diode: 0, coil: 0, switching: 0, quiescent: 0 }
  if (vin < m.vinMin) return { vin, vout: 0, iout: 0, iin: 0, duty: 0, il: 0, ripple: 0, peak: 0, losses: zero, loss: 0, efficiency: 0, regulating: false, limit: 'off' }
  const target = bisect((d) => atDuty(m, vin, d, iout).vout <= vset, 0, m.maxDuty)
  const dCur = bisect((d) => atDuty(m, vin, d, iout).peak <= m.switchAmps, 0, m.maxDuty)
  const duty = Math.min(target, dCur)
  const s = atDuty(m, vin, duty, iout)
  let limit: DcdcLimit | null = null
  if (vin > m.vinMax) limit = 'over-voltage'
  else if (s.vout > vset + 0.01) limit = 'pass-through'
  else if (s.vout < vset - 0.01) limit = dCur < target ? 'current-limit' : 'dropout'
  const losses = { ...s.losses, quiescent: vin * m.iq }
  const loss = losses.switch + losses.diode + losses.coil + losses.switching + losses.quiescent
  const pout = s.vout * iout
  const iin = (pout + loss) / vin
  return { vin, vout: s.vout, iout, iin, duty, il: s.il, ripple: s.ripple, peak: s.peak, losses, loss, efficiency: pout / (pout + loss), regulating: limit === null, limit }
}

export const boardC = (m: DcdcModule, watts: number, ambient = 25) => ambient + m.thetaJA * watts

export interface Coil {
  henries: number
  /** Current where the core saturates and the inductance collapses, A. */
  isat: number
}

/** Same-size drum cores for the LM2596 board: more turns → more µH but a lower saturation current. */
export const BUCK_COILS: Coil[] = [
  { henries: 15e-6, isat: 4.5 },
  { henries: 33e-6, isat: 3 },
  { henries: 68e-6, isat: 2 },
]

/** Ideal buck coil current with discontinuous mode: CCM (Vout = D·Vin, triangle round Iout) until Iout < ΔI/2; below that the
 *  current ramps from 0 to a peak and back to 0 within each period and the duty shrinks to keep the average = Iout.
 *  `d2` is the ramp-down fraction of the period. */
export function buckRipple(vin: number, vout: number, iout: number, henries: number, fHz: number) {
  const ccmDuty = vout / vin
  const ripple = ((vin - vout) * ccmDuty) / (henries * fHz)
  if (iout >= ripple / 2) return { ccm: true, duty: ccmDuty, d2: 1 - ccmDuty, iMin: iout - ripple / 2, iMax: iout + ripple / 2 }
  const duty = Math.sqrt((2 * henries * fHz * iout * vout) / (vin * (vin - vout)))
  const iMax = ((vin - vout) * duty) / (henries * fHz)
  return { ccm: false, duty, d2: (duty * (vin - vout)) / vout, iMin: 0, iMax }
}

/** Coil current at `phase` (0 … 1) of a period for a `buckRipple` result. */
export function rippleAmps(r: ReturnType<typeof buckRipple>, phase: number) {
  if (phase < r.duty) return r.iMin + ((r.iMax - r.iMin) * phase) / r.duty
  if (phase < r.duty + r.d2) return r.iMax - ((r.iMax - r.iMin) * (phase - r.duty)) / r.d2
  return r.iMin
}

/** Output ripple p-p across an electrolytic: ESR × ΔI plus the charge the cap soaks up, ΔI / (8 f C). */
export const outputRipple = (dI: number, fHz: number, farads: number, esr: number) => dI * esr + dI / (8 * fHz * farads)

export interface RunSample {
  hours: number
  soc: number
  vpack: number
  point: DcdcPoint
}

/** Pack of `series` cells (one string of `c.cell.mAh`) feeding a module at `vset` / `iout` until the cells reach cut-off.
 *  The module draws constant power, so the pack current climbs as its voltage sags. */
export function runDown(m: DcdcModule, c: Chemistry, series: number, vset: number, iout: number, steps = 120): RunSample[] {
  const ah = c.cell.mAh / 1000
  const ohms = c.cell.ohms * series
  const at = (soc: number) => {
    const ocv = series * cellVolts(c, soc)
    let vpack = ocv
    let point = dcdcPoint(m, vpack, vset, iout)
    for (let k = 0; k < 6; k++) {
      vpack = ocv - point.iin * ohms
      point = dcdcPoint(m, vpack, vset, iout)
    }
    return { vpack, point }
  }
  const out: RunSample[] = []
  const dSoc = 1 / steps
  let hours = 0
  for (let soc = 1; soc > -1e-9; soc -= dSoc) {
    const s = at(soc)
    out.push({ hours, soc: Math.max(0, soc), ...s })
    if (s.point.iin <= 0) break
    hours += (dSoc * ah) / s.point.iin
  }
  return out
}

/** Interpolated sample at `hours` along a `runDown` (clamped to its ends). */
export function runAt(run: RunSample[], hours: number): RunSample {
  if (hours <= run[0].hours) return run[0]
  for (let i = 1; i < run.length; i++) if (run[i].hours >= hours) return (hours - run[i - 1].hours) < (run[i].hours - hours) ? run[i - 1] : run[i]
  return run[run.length - 1]
}

/** Share of a pack's charge (full → cut-off, rest volts) over which the module regulates, plus the first pack voltage it fails at. */
export function regulatedShare(m: DcdcModule, c: Chemistry, series: number, vset: number, iout: number, steps = 200) {
  let ok = 0
  let failAt: { vpack: number; limit: DcdcLimit } | null = null
  for (let i = 0; i <= steps; i++) {
    const vpack = series * cellVolts(c, 1 - i / steps)
    const p = dcdcPoint(m, vpack, vset, iout)
    if (p.regulating) ok++
    else failAt ??= { vpack, limit: p.limit! }
  }
  return { share: ok / (steps + 1), failAt }
}
