// Desoldering an old lead-free through-hole joint: wick it with braid or suck it with a pump, optionally after adding fresh
// leaded solder (flux + a heat bridge + a lower melting point). Same heat circuit as soldering.
import { puzzleVerdict } from '../challenges/verdict'
import { PadKey, ironIdle, ironStep, padDoseRate, TIPS } from './iron'
import { ALLOYS, AlloyKey, BARREL_MM3, FILLET_MM3, FLUX, JOINT, WETTING, fluxBurnRate } from './soldering'
import { PAD_LIFT_NEAR } from './soldering'

/** Mixed solder by volume: solidus and liquidus by the linear rule of mixtures (a rough guide; Pb pulls SAC down fast). */
export function mixAlloy(a: AlloyKey, va: number, b: AlloyKey, vb: number) {
  const f = vb / Math.max(1e-9, va + vb)
  const A = ALLOYS[a]
  const B = ALLOYS[b]
  return { solidusC: A.solidusC * (1 - f) + B.solidusC * f, liquidusC: A.liquidusC * (1 - f) + B.liquidusC * f, fresh: f }
}

/** Fluxed 2.5 mm copper braid: extra heat capacity on the joint, series factor on the tip contact, flux it brings,
 *  solder it can hold (mm³), wick rates of the top and (slowly, against the hole's own capillary) the barrel, 1/s. */
export const BRAID = { heatJPerK: 0.08, contact: 0.6, flux: 0.6, capMm3: 2.5, topPerS: 2.5, barrelPerS: 0.65 }
/** Spring pump fired as the iron lifts: share of molten solder it leaves on top / in the barrel. */
export const PUMP = { topLeft: 0.08, barrelLeft: 0.15 }
/** Fresh Sn63 core wire added first: from `atS`, mm. */
export const FRESH = { atS: 0.3, mm: 1 }
export const DESOLDER_METHODS = { braid: 'Desoldering braid', pump: 'Solder pump' }
export type DesolderMethod = keyof typeof DESOLDER_METHODS

export interface DesolderCfg {
  method: DesolderMethod
  fresh: boolean
  setC: number
  dwellS: number
  pad?: PadKey
}

export interface DesolderFrame {
  t: number
  on: boolean
  jointC: number
  barrelC: number
  tipC: number
  topMm3: number
  barrelMm3: number
  braidMm3: number
  flux: number
  liquidusC: number
}

const TIP = 'chisel'
const WIRE_MM2 = Math.PI * (JOINT.wireMm / 2) ** 2

/** Time-lapse: iron (on braid, or beside the pump nozzle) for `dwellS`, pump fired as it lifts, 2 s cooling. */
export function desolderRun(c: DesolderCfg) {
  const pad = c.pad ?? 'signal'
  const T = TIPS[TIP]
  const W = WETTING
  const braid = c.method === 'braid'
  let n = ironIdle(c.setC, TIP)
  let top = FILLET_MM3
  let barrel = BARREL_MM3
  const old = top + barrel
  let added = 0
  let absorbed = 0
  let flux = braid ? BRAID.flux : 0
  let fluxPeak = flux
  let dose = 0
  let peakC = n.jointC
  let barrelPeakC = n.barrelC
  let mix = mixAlloy('sac305', old, 'sn63', 0)
  let pumped = false
  const frames: DesolderFrame[] = []
  const end = c.dwellS + 2
  const steps = Math.round(end / W.dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * W.dt
    const on = t < c.dwellS
    const topMolten = n.jointC >= mix.liquidusC
    const active = flux > FLUX.spent * Math.max(fluxPeak, 0.1) && n.jointC >= FLUX.activeC
    if (i % W.keep === 0) frames.push({ t, on, jointC: n.jointC, barrelC: n.barrelC, tipC: n.tipC, topMm3: top, barrelMm3: barrel, braidMm3: absorbed, flux, liquidusC: mix.liquidusC })
    if (!on && !pumped) {
      pumped = true
      if (c.method === 'pump' && topMolten) {
        top *= PUMP.topLeft
        if (n.barrelC >= mix.liquidusC) barrel *= PUMP.barrelLeft
      }
    }
    // Old joint: oxidised skin and no flux, so a poor bridge until fresh flux arrives.
    const bridge = topMolten ? (active ? 1 : 0.5) : added > 0 ? 0.7 : 0.35
    const contact = on ? (T.dryWPerK + (T.wetWPerK - T.dryWPerK) * bridge) * (braid ? BRAID.contact : 1) : 0
    if (c.fresh && on && t >= FRESH.atS && added < FRESH.mm * WIRE_MM2 && n.tipC >= ALLOYS.sn63.liquidusC) {
      const d = Math.min(W.feedMmS * W.dt, FRESH.mm - added / WIRE_MM2) * WIRE_MM2
      added += d
      top += d
      flux += d / (FILLET_MM3 + BARREL_MM3)
      fluxPeak = Math.max(fluxPeak, flux)
      mix = mixAlloy('sac305', old, 'sn63', added)
    }
    if (braid && on && topMolten) {
      const room = Math.max(0, 1 - absorbed / BRAID.capMm3)
      const k = active ? 1 : 0.3
      const dTop = top * BRAID.topPerS * room * k * W.dt
      const dBar = n.barrelC >= mix.liquidusC ? barrel * BRAID.barrelPerS * room * k * W.dt : 0
      top -= dTop
      barrel -= dBar
      absorbed += dTop + dBar
    }
    flux -= flux * fluxBurnRate(n.jointC) * W.dt
    dose += padDoseRate(n.jointC) * W.dt
    peakC = Math.max(peakC, n.jointC)
    barrelPeakC = Math.max(barrelPeakC, n.barrelC)
    n = ironStep(n, c.setC, TIP, pad, contact, W.dt, braid && on ? BRAID.heatJPerK : 0)
  }
  const out: DesolderOut = {
    liquidusC: mix.liquidusC,
    peakC,
    barrelPeakC,
    topLeft: top / FILLET_MM3,
    barrelLeft: barrel / BARREL_MM3,
    braidMm3: absorbed,
    addedMm3: added,
    dose,
  }
  return { cfg: c, frames, dt: W.dt * W.keep, seconds: end, out, verdict: desolderVerdict(out) }
}

export interface DesolderOut {
  /** Liquidus of the (mixed) solder, joint / barrel peak °C. */
  liquidusC: number
  peakC: number
  barrelPeakC: number
  /** Left on the pad (÷ original fillet) and in the barrel (÷ barrel), in the braid and added, mm³; pad-lift dose. */
  topLeft: number
  barrelLeft: number
  braidMm3: number
  addedMm3: number
  dose: number
}
export type DesolderFail = 'cold' | 'lifted' | 'stuck' | 'pad'

/** Desolder verdict: never melted, lifted pad, lead still held by the barrel (> 30 %), solder left on the pad. */
export function desolderVerdict(o: DesolderOut) {
  return puzzleVerdict<DesolderFail>([
    { id: 'cold', ok: o.peakC >= o.liquidusC },
    { id: 'lifted', ok: o.dose < PAD_LIFT_NEAR, near: o.dose < 1 },
    { id: 'stuck', ok: o.barrelLeft <= 0.3, near: o.barrelLeft <= 0.5 },
    { id: 'pad', ok: o.topLeft <= 0.3, near: o.topLeft <= 0.8 },
  ])
}
