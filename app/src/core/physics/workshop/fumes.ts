// Soldering fume and bench habits: rosin burnt per joint (soldering.ts `fluxBurnRate` at the joint temperature), a
// near-field / far-field (two-zone, Nicas) box model of the air you breathe, a bench extractor's capture velocity
// (Dalla Valle: v = Q / (10x² + A)), and the habits that protect eyes, hands and the bench.
// Room, airflow and extractor numbers are illustrative; the limits are the UK HSE EH40 WELs for rosin-based solder flux fume.
import { puzzleVerdict } from '../challenges/verdict'
import { INSULATION_MAX_C } from '../power/wiring'
import { TIPS, steadyJointC } from './iron'
import { ALLOYS, IDEAL_MM3, fluxBurnRate } from './soldering'

/** UK HSE EH40 workplace exposure limits for rosin-based solder flux fume, mg/m³: 15-min STEL and 8-h TWA. A sensitiser:
 *  it can cause asthma, so exposure should be as low as practicable, not just under the line. */
export const ROSIN_WEL = { stel: 0.15, twa: 0.05 }

/** Rosin share of cored wire by mass (2.2 % is a common core), Sn63 density mg/mm³. */
export const FLUX_CORE = { massFrac: 0.022, mgPerMm3: 8.4 }
/** Rosin in one joint's worth of wire, mg. */
export const ROSIN_PER_JOINT_MG = IDEAL_MM3 * FLUX_CORE.mgPerMm3 * FLUX_CORE.massFrac

/** Session: joints a minute, iron on each for `dwellS`, session length; room volume, near-field hemisphere radius (m). */
export const FUME_SESSION = { perMin: 4, dwellS: 3, minutes: 30, dtS: 5, roomM3: 30, nearM: 0.3 }

/** Bench extractor (small carbon-filter fan box): airflow m³/min, face area m², capture velocity needed to pull in a
 *  soldering plume (m/s), best capture share. */
export const EXTRACTOR = { m3PerMin: 1.5, faceM2: 0.017, needMS: 0.3, best: 0.95 }

/** Ventilation: air changes an hour, random air speed round the bench (m/s), extractor distance (cm) or none. */
export const FUME_VENTS = {
  still: { name: 'Closed room, nothing running', ach: 0.5, airMS: 0.05, extractCm: 0 },
  window: { name: 'Window open, no extractor', ach: 4, airMS: 0.15, extractCm: 0 },
  far: { name: 'Extractor 25 cm away', ach: 0.5, airMS: 0.05, extractCm: 25 },
  near: { name: 'Extractor 6 cm from the joint', ach: 0.5, airMS: 0.05, extractCm: 6 },
} as const
export type FumeVent = keyof typeof FUME_VENTS

/** Air speed (m/s) an extractor's opening pulls at `xM` m in front of it (Dalla Valle, plain opening). */
export const captureSpeed = (xM: number, e = EXTRACTOR) => e.m3PerMin / 60 / (10 * xM * xM + e.faceM2)
/** Share of the plume pulled in at `cm` (0 = no extractor): speed over what's needed, capped at `best`. */
export const captureShare = (cm: number, e = EXTRACTOR) => (cm <= 0 ? 0 : Math.min(e.best, captureSpeed(cm / 100, e) / e.needMS))

/** Joint temperature with a 1.6 mm chisel on a signal pad at tip `tipC`; share of the rosin burnt off into fume in a dwell. */
export const fumeJointC = (tipC: number) => steadyJointC(tipC, 'chisel', 'signal', TIPS.chisel.wetWPerK)
export const fumeShare = (tipC: number, dwellS = FUME_SESSION.dwellS) => 1 - Math.exp(-fluxBurnRate(fumeJointC(tipC)) * dwellS)
/** Rosin fume released, mg/min. */
export const fumeRate = (tipC: number) => FUME_SESSION.perMin * ROSIN_PER_JOINT_MG * fumeShare(tipC)

/** Euler sub-steps per frame: the near field (β / V_N up to ~45 /min) needs steps well under a second. */
const FUME_SUBSTEPS = 10

export interface FumeCfg {
  vent: FumeVent
  tipC: number
  glasses: boolean
  /** Iron back in its stand between joints, or laid on the bench. */
  stand: boolean
  /** Hands washed, no food or drink at the bench. */
  wash: boolean
}

export interface FumeFrame {
  t: number
  /** Near field (breathing zone) and far field (room), mg/m³. */
  near: number
  far: number
}

/** Two-zone run: dC_N/dt = (G(1 − η) + β(C_F − C_N)) / V_N, dC_F/dt = (β(C_N − C_F) − Q·C_F) / V_F, β = ½·FSA·s.
 *  Captured fume is filtered out. */
export function fumeRun(cfg: FumeCfg) {
  const S = FUME_SESSION
  const V = FUME_VENTS[cfg.vent]
  const G = fumeRate(cfg.tipC)
  const eta = captureShare(V.extractCm)
  const fsa = 2 * Math.PI * S.nearM ** 2
  const vN = (2 / 3) * Math.PI * S.nearM ** 3
  const vF = S.roomM3 - vN
  const beta = 0.5 * fsa * V.airMS * 60
  const q = (V.ach * S.roomM3) / 60
  const dt = S.dtS / 60
  const h = dt / FUME_SUBSTEPS
  const frames: FumeFrame[] = []
  let [cn, cf] = [0, 0]
  for (let k = 0; k * dt <= S.minutes + 1e-9; k++) {
    frames.push({ t: k * dt, near: cn, far: cf })
    for (let j = 0; j < FUME_SUBSTEPS; j++) {
      const dn = (G * (1 - eta) + beta * (cf - cn)) / vN
      const df = (beta * (cn - cf) - q * cf) / vF
      cn += dn * h
      cf += df * h
    }
  }
  const win = Math.round(15 / dt)
  let sum = 0
  let peak15 = 0
  frames.forEach((f, i) => {
    sum += f.near
    if (i >= win) sum -= frames[i - win].near
    if (i >= win - 1) peak15 = Math.max(peak15, sum / win)
  })
  const mean = frames.reduce((s, f) => s + f.near, 0) / frames.length
  const clipped = S.perMin * S.minutes
  const hotTip = cfg.tipC > ALLOYS.sn63.tipC[1] + 15
  const verdict = puzzleVerdict([
    { id: 'stel', ok: peak15 <= ROSIN_WEL.stel, near: peak15 <= 2 * ROSIN_WEL.stel },
    { id: 'eyes', ok: cfg.glasses },
    { id: 'stand', ok: cfg.stand },
    { id: 'hands', ok: cfg.wash },
    // As if you soldered like this all day: the session mean against the 8-h limit.
    { id: 'twa', ok: mean <= ROSIN_WEL.twa, near: true },
    { id: 'hot', ok: !hotTip, near: true },
  ])
  return { cfg, frames, G, eta, beta, q, jointC: fumeJointC(cfg.tipC), share: fumeShare(cfg.tipC), peak15, mean, clipped, pvcMelts: cfg.tipC > INSULATION_MAX_C.pvc, verdict }
}
export type FumeRun = ReturnType<typeof fumeRun>

/** Frame at minute `t` (the last one past the end). */
export const fumeAt = (r: FumeRun, t: number) => r.frames[Math.max(0, Math.min(r.frames.length - 1, Math.round((t * 60) / FUME_SESSION.dtS)))]
