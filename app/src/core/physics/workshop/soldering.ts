// Soldering a through-hole joint: alloys, flux, wetting and the fillet, run on the iron heat circuit (iron.ts).
import { puzzleVerdict } from '../challenges/verdict'
import { IronNodes, PadKey, TIPS, TipKey, ironIdle, ironStep, padDoseRate, tipOxide } from './iron'
import { bandChecks, doublingRate } from './technique'

/** Solder alloys: solidus / liquidus (°C), resistivity (Ω·m). Sn63/Pb37 is eutectic: it melts at one temperature. */
export const ALLOYS = {
  sn63: { name: 'Sn63/Pb37 leaded', solidusC: 183, liquidusC: 183, rho: 0.145e-6, tipC: [315, 345] },
  sac305: { name: 'SAC305 lead-free', solidusC: 217, liquidusC: 220, rho: 0.13e-6, tipC: [340, 370] },
} as const
export type AlloyKey = keyof typeof ALLOYS

/** Rosin flux: active above `activeC`; burns off with an e-fold life of `lifeS` at 300 °C, halving every 20 °C hotter; `spent` below this share of its peak. */
export const FLUX = { activeC: 150, lifeS: 5, refC: 300, doubleC: 20, spent: 0.2 }
export const FLUX_KINDS = { none: 'No flux (solid wire)', core: 'Rosin-core wire', pen: 'Core + flux pen' }
export type FluxKind = keyof typeof FLUX_KINDS
/** Share of flux burnt per second at joint temperature `c` (0 below activation). */
export const fluxBurnRate = (c: number) => (c < FLUX.activeC ? 0 : doublingRate(c, FLUX.refC, FLUX.lifeS, FLUX.doubleC))

/** Through-hole joint on a 1.6 mm board, mm: hole, lead, pad diameters, lead left above the pad. 0.8 mm wire. */
export const JOINT = { boardMm: 1.6, holeMm: 1.0, leadMm: 0.6, padMm: 1.8, stubMm: 1.5, wireMm: 0.8 }
export const WIRE_MM2 = Math.PI * (JOINT.wireMm / 2) ** 2
/** Barrel annulus volume (hole − lead), mm³. */
export const BARREL_MM3 = (Math.PI / 4) * (JOINT.holeMm ** 2 - JOINT.leadMm ** 2) * JOINT.boardMm

/** Solder fill and wetting: wetting at full speed takes `wetS` with `superC` above the liquidus; no flux slows it ×`dry`. */
export const WETTING = { superC: 30, wetS: 0.7, dry: 0.08, feedAtS: 0.8, feedMmS: 4, coolS: 3, dt: 0.01, keep: 5 }

/** Contact angle from the wetted share: 20° fully wetted (concave), 120° not at all (a ball). */
export const contactAngle = (wet: number) => 120 - 100 * Math.min(1, Math.max(0, wet))

/** Fillet round the lead: height h(r) = H·((R − r)/(R − r_l))^p from the lead (r_l) out to the spread radius R.
 *  Low contact angle → p > 1 (concave); excess solder bulges it (p < 1). Solves H for the volume. Points [r, h] in mm. */
export function filletProfile(volMm3: number, angleDeg: number, wet: number, volFrac = 1, n = 12) {
  const rl = JOINT.leadMm / 2
  const R = rl + (JOINT.padMm / 2 - rl) * Math.max(0.3, Math.min(1, wet))
  const p = Math.max(0.3, Math.min(3, 1 + (90 - angleDeg) / 45) / Math.max(1, volFrac) ** 0.7)
  const w = R - rl
  const unitVol = 2 * Math.PI * w * (R / (p + 1) - w / (p + 2))
  const H = Math.max(0, volMm3) / unitVol
  const points: [number, number][] = Array.from({ length: n + 1 }, (_, i) => {
    const r = rl + (w * i) / n
    return [r, H * Math.max(0, (R - r) / w) ** p]
  })
  return { H, p, R, points }
}

/** Ideal joint: barrel full plus a 20° concave fillet reaching the pad edge, 0.8 mm up the lead. */
export const FILLET_MM3 = 0.8 / filletProfile(1, 20, 1).H
export const IDEAL_MM3 = BARREL_MM3 + FILLET_MM3
/** Wire length that holds the ideal volume. */
export const IDEAL_FEED_MM = IDEAL_MM3 / WIRE_MM2

/** Joint resistance through the barrel: ρ·L/A over the wetted share of the annulus (Infinity with no solder). */
export function jointOhms(alloy: AlloyKey, volMm3: number, wet: number) {
  if (volMm3 <= 0) return Infinity
  const area = (Math.PI / 4) * (JOINT.holeMm ** 2 - JOINT.leadMm ** 2) * 1e-6
  return (ALLOYS[alloy].rho * JOINT.boardMm * 1e-3) / area / Math.max(0.01, wet)
}

export interface SolderCfg {
  alloy: AlloyKey
  setC: number
  tip: TipKey
  pad: PadKey
  flux: FluxKind
  /** Tip tinned and wiped, or left bare for `IDLE_S` at temperature. */
  tinned: boolean
  /** Iron on the joint for, s. */
  dwellS: number
  /** Wire fed from `feedAtS`, mm. */
  feedMm: number
}
export const IDLE_S = 60

export interface SolderFrame extends IronNodes {
  t: number
  on: boolean
  /** Solder in the joint, mm³; flux left (1 = one joint's worth); wetted share of the pad and of the barrel; pad dose. */
  volMm3: number
  flux: number
  wet: number
  barrelWet: number
  dose: number
  /** Seconds the flux has been charring so far. */
  charS: number
  molten: boolean
}

/** Time-lapse of one joint: iron on for `dwellS`, wire fed at `feedAtS` (melts where it touches the hot tip/joint), then
 *  `coolS` with the iron lifted. Core flux is released with the solder; a pen puts flux on first. */
export function solderRun(c: SolderCfg) {
  const A = ALLOYS[c.alloy]
  const T = TIPS[c.tip]
  const W = WETTING
  const oxide = c.tinned ? 0 : tipOxide(c.setC, IDLE_S)
  const tipWet = 1 - oxide
  let n = ironIdle(c.setC, c.tip)
  let vol = 0
  let fed = 0
  let flux = c.flux === 'pen' ? 1 : 0
  let fluxPeak = flux
  let wet = 0
  let barrelWet = 0
  let dose = 0
  let charS = 0
  let peakC = n.jointC
  let barrelPeakC = n.barrelC
  let minTipC = n.tipC
  const frames: SolderFrame[] = []
  const end = c.dwellS + W.coolS
  const steps = Math.round(end / W.dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * W.dt
    const on = t < c.dwellS
    const present = flux > FLUX.spent * Math.max(fluxPeak, 0.1)
    const active = present && n.jointC >= FLUX.activeC
    if (i % W.keep === 0) frames.push({ ...n, t, on, volMm3: vol, flux, wet, barrelWet, dose, charS, molten: vol > 0 && n.jointC >= A.liquidusC })
    // Contact: dry metal until molten solder bridges tip and joint; an oxidised tip never wets, so no bridge forms.
    const bridge = vol > 0 && n.tipC >= A.liquidusC ? (present ? 1 : 0.6) : c.flux === 'pen' ? 0.5 : 0.3
    const contact = on ? T.dryWPerK + (T.wetWPerK - T.dryWPerK) * tipWet * bridge : 0
    // Wire melts at the tip/joint junction once either is past the liquidus.
    if (on && t >= W.feedAtS && fed < c.feedMm && Math.max(n.tipC, n.jointC) >= A.liquidusC) {
      const d = Math.min(W.feedMmS * W.dt, c.feedMm - fed)
      fed += d
      vol += d * WIRE_MM2
      if (c.flux !== 'none') flux += (d * WIRE_MM2) / IDEAL_MM3
      fluxPeak = Math.max(fluxPeak, flux)
    }
    const k = active ? 1 : W.dry
    const rate = (tc: number) => Math.min(1.5, Math.max(0, (tc - A.liquidusC) / W.superC)) / W.wetS
    if (vol > 0) {
      wet = Math.min(1, wet + rate(n.jointC) * k * W.dt)
      barrelWet = Math.min(wet, barrelWet + rate(n.barrelC) * k * W.dt)
    }
    flux -= flux * fluxBurnRate(n.jointC) * W.dt
    if (on && vol > 0 && n.jointC >= A.liquidusC && fluxPeak > 0 && flux < FLUX.spent * fluxPeak) charS += W.dt
    dose += padDoseRate(n.jointC) * W.dt
    peakC = Math.max(peakC, n.jointC)
    barrelPeakC = Math.max(barrelPeakC, n.barrelC)
    if (on) minTipC = Math.min(minTipC, n.tipC)
    n = ironStep(n, c.setC, c.tip, c.pad, contact, W.dt)
  }
  const barrelFill = Math.min(1, vol / BARREL_MM3) * barrelWet
  const filletMm3 = Math.max(0, vol - barrelFill * BARREL_MM3)
  const volFrac = vol / IDEAL_MM3
  const angleDeg = contactAngle(wet)
  const out: SolderOut = {
    oxide,
    peakC,
    barrelPeakC,
    minTipC,
    volMm3: vol,
    volFrac,
    wet,
    barrelFill,
    filletMm3,
    angleDeg,
    dose,
    charS,
    fluxLeft: flux,
    ohms: jointOhms(c.alloy, vol, wet),
  }
  return { cfg: c, frames, dt: W.dt * W.keep, seconds: end, out, verdict: solderVerdict(c, out) }
}

interface SolderOut {
  /** Tip oxide 0…1; joint / barrel peak and the tip's lowest °C while on. */
  oxide: number
  peakC: number
  barrelPeakC: number
  minTipC: number
  /** Solder in the joint (mm³, ÷ ideal), wetted share, barrel fill, fillet volume, contact angle. */
  volMm3: number
  volFrac: number
  wet: number
  barrelFill: number
  filletMm3: number
  angleDeg: number
  /** Pad-lift dose, seconds of charring flux, flux left, joint resistance Ω. */
  dose: number
  charS: number
  fluxLeft: number
  ohms: number
}
type SolderFail = 'nosolder' | 'tip' | 'flux' | 'cold' | 'lifted' | 'wet' | 'burnt' | 'little' | 'blob' | 'barrel'

/** Joint verdict, worst first: no solder, oxidised tip, no flux, cold (pad never melted it), lifted pad, poor wetting,
 *  burnt flux, too little / too much, barrel under 75 % filled (IPC class 2). */
function solderVerdict(c: SolderCfg, o: SolderOut) {
  return puzzleVerdict<SolderFail>([
    { id: 'nosolder', ok: o.volMm3 > 0 },
    { id: 'tip', ok: o.oxide <= 0.25, near: o.oxide <= 0.5 },
    { id: 'flux', ok: c.flux !== 'none' },
    { id: 'cold', ok: o.peakC >= ALLOYS[c.alloy].liquidusC },
    { id: 'lifted', ok: o.dose < PAD_LIFT_NEAR, near: o.dose < 1 },
    { id: 'wet', ok: o.wet >= 0.9, near: o.wet >= 0.5 },
    { id: 'burnt', ok: o.charS <= 0.3, near: o.charS <= 1.5 },
    ...bandChecks<SolderFail>('little', 'blob', o.volFrac, 0.7, 1.8),
    { id: 'barrel', ok: o.barrelFill >= 0.75, near: o.barrelFill >= 0.5 },
  ])
}
/** Pad dose that already counts as a warning. */
export const PAD_LIFT_NEAR = 0.5
