// LiPo charging safety: a 2S pouch pack on a hobby balance charger. Per-cell CC/CV with the balance lead (pack-total CV
// without it), a lumped pack temperature with overcharge side-reaction heat and self-heating, and a verdict.
// Thermal constants are illustrative, picked to give the right order of magnitude, not from a cell datasheet.
import { CHEMISTRIES, Chemistry, openCircuitVolts } from '../power/batteries'
import { cellVolts } from '../power/packs'
import { cellTemp, liionCharger } from '../power/charging'
import { loopOhms } from '../power/wiring'
import { puzzleVerdict } from '../challenges/verdict'
import { clamp01, nearestStepAt } from '../common'
import { BENCH_C, doublingRate } from './technique'

/** 2S 2200 mAh pouch pack: per cell DC resistance, charge resistance (DC + polarisation), heat capacity (J/K) and
 *  cooling to still air (W/K); a LiPo bag insulates (`bagCooling` ×); balancer bleed (A) while cells differ by > `spreadV`. */
export const LIPO_PACK = { series: 2, mAh: 2200, ohms: 0.008, chargeOhms: 0.03, jPerK: 45, wPerK: 0.06, bagCooling: 0.7, bleedA: 0.2, spreadV: 0.005 }
/** LiPo = Li-ion polymer: the same 4.20 V full / 3.0 V empty curve as `CHEMISTRIES.liion`. */
export const LIPO_CHEM: Chemistry = { ...CHEMISTRIES.liion, name: 'LiPo', cell: { ...CHEMISTRIES.liion.cell, mAh: LIPO_PACK.mAh, ohms: LIPO_PACK.ohms } }

/** Storage voltage per cell, and the over-discharge line (below it copper can dissolve and short the cell later). */
export const LIPO_STORAGE_V = 3.8
export const LIPO_FLAT_V = 3.0

/** Illustrative heat model: past full, a share ((V − 4.20) / `overV`)² of the charge current goes into side reactions
 *  (heat); above `onsetC` the cell heats itself, `selfW` per cell at `refC`, doubling every `doubleC`; it vents at `ventC`. */
export const LIPO_HEAT = { overV: 0.8, onsetC: 60, selfW: 0.5, refC: 80, doubleC: 10, ventC: 150 }

/** Charger program: cells it thinks it has, CV volts per cell (Infinity = no voltage limit, ends on a timer). */
export const CHARGER_MODES = {
  lipo2s: { name: 'LiPo 2S · 4.20 V/cell', cells: 2, cvCell: 4.2 },
  lipo3s: { name: 'LiPo 3S (wrong cell count)', cells: 3, cvCell: 4.2 },
  lihv2s: { name: 'LiHV 2S · 4.35 V/cell', cells: 2, cvCell: 4.35 },
  nimh: { name: 'NiMH program (no V limit)', cells: 2, cvCell: Infinity },
} as const
export type ChargerMode = keyof typeof CHARGER_MODES

/** Pack condition: state of charge per cell; puffed packs have gassed and their resistance has tripled. */
export const PACK_STATES = {
  storage: { name: 'Stored at 3.8 V/cell', socs: [0.6, 0.6], puffed: false },
  flown: { name: 'Just flown, cells drifted 6 %', socs: [0.36, 0.3], puffed: false },
  flat: { name: 'Run flat: 2.6 V/cell', socs: [-0.02, -0.02], puffed: false },
  puffed: { name: 'Puffed (swollen) pack', socs: [0.5, 0.45], puffed: true },
} as const
export type PackState = keyof typeof PACK_STATES

/** Where it charges: inside a LiPo bag, on something that burns, someone there to act. */
export const CHARGE_SPOTS = {
  tile: { name: 'LiPo bag on a ceramic tile, you nearby', bag: true, flammable: false, attended: true },
  bench: { name: 'Bare on the wooden bench, you nearby', bag: false, flammable: true, attended: true },
  away: { name: 'LiPo bag on the tile, left while you go out', bag: true, flammable: false, attended: false },
} as const
export type ChargeSpot = keyof typeof CHARGE_SPOTS

export interface LipoCfg {
  mode: ChargerMode
  /** Charge current in C (1 C = capacity in A). */
  rateC: number
  balance: boolean
  state: PackState
  spot: ChargeSpot
}

export type LipoPhase = 'refused' | 'pre' | 'cc' | 'cv' | 'done' | 'timer' | 'vent'
interface LipoFrame {
  t: number
  socs: number[]
  rest: number[]
  volts: number[]
  amps: number
  tempC: number
  phase: LipoPhase
}

/** Share of the charge current that goes into side reactions at rest voltage `v` (0 up to full). */
export const sideShare = (v: number, full = LIPO_CHEM.full) => clamp01((v - full) / LIPO_HEAT.overV) ** 2
/** Self-heating per cell, W (0 under the onset). */
export const selfHeatW = (c: number) => (c < LIPO_HEAT.onsetC ? 0 : doublingRate(c, LIPO_HEAT.refC, 1 / LIPO_HEAT.selfW, LIPO_HEAT.doubleC))

/** Bare pack leads touching: OCV over the cells' resistance plus 10 cm of 12 AWG loop; power burnt inside the pack. */
export function lipoShort(state: PackState) {
  const S = PACK_STATES[state]
  const r = LIPO_PACK.ohms * (S.puffed ? 3 : 1)
  const ocv = S.socs.reduce((s, x) => s + openCircuitVolts(LIPO_CHEM, x), 0)
  const amps = ocv / (S.socs.length * r + loopOhms(12, 0.1))
  return { amps, packW: amps * amps * S.socs.length * r }
}

export const LIPO_DT = 10
/** Charger safety timer (illustrative; most hobby chargers stop somewhere round 2–4 h). */
const LIPO_TIMER_S = 3 * 3600

/** Charge `cfg` from its pack state, LIPO_DT steps until done, the timer, a refusal or venting. */
export function lipoChargeRun(cfg: LipoCfg) {
  const M = CHARGER_MODES[cfg.mode]
  const S = PACK_STATES[cfg.state]
  const P = LIPO_PACK
  const spot = CHARGE_SPOTS[cfg.spot]
  const n = S.socs.length
  const rc = P.chargeOhms * (S.puffed ? 3 : 1)
  const setA = (cfg.rateC * P.mAh) / 1000
  const ch = liionCharger(setA, M.cvCell)
  const perCell = cfg.balance && Number.isFinite(M.cvCell)
  const refused = perCell && M.cells !== n
  const cool = n * P.wPerK * (spot.bag ? P.bagCooling : 1)
  const socs: number[] = [...S.socs]
  let tempC = BENCH_C
  const frames: LipoFrame[] = []
  let phase: LipoPhase = 'pre'
  for (let t = 0; ; t += LIPO_DT) {
    const rest = socs.map((s) => cellVolts(LIPO_CHEM, s))
    const top = Math.max(...rest)
    const spread = top - Math.min(...rest)
    let amps = 0
    if (refused) phase = 'refused'
    else if (Math.min(...rest) < ch.preBelow) [phase, amps] = ['pre', setA * ch.preFrac]
    else {
      const cvA = perCell ? (M.cvCell - top) / rc : (M.cells * M.cvCell - rest.reduce((s, v) => s + v, 0)) / (n * rc)
      amps = Math.max(0, Math.min(setA, cvA))
      phase = amps >= setA ? 'cc' : 'cv'
      if (amps <= setA * ch.endFrac && (!perCell || spread <= 2 * P.spreadV)) [phase, amps] = ['done', 0]
    }
    if (tempC >= LIPO_HEAT.ventC) [phase, amps] = ['vent', 0]
    else if (t >= LIPO_TIMER_S && phase !== 'done' && phase !== 'refused') [phase, amps] = ['timer', 0]
    const volts = rest.map((v) => v + amps * rc)
    frames.push({ t, socs: [...socs], rest, volts, amps, tempC, phase })
    if (phase === 'done' || phase === 'refused' || phase === 'vent' || phase === 'timer') break
    const bleed = rest.map((v) => (perCell && phase === 'cv' && v - Math.min(...rest) > P.spreadV ? P.bleedA : 0))
    const heat = rest.reduce((w, v, i) => w + amps * amps * rc + amps * volts[i] * sideShare(v) + selfHeatW(tempC), 0)
    tempC += ((heat - cool * (tempC - BENCH_C)) / (n * P.jPerK)) * LIPO_DT
    socs.forEach((s, i) => (socs[i] = s + ((amps - bleed[i]) * LIPO_DT) / 3.6 / P.mAh))
  }
  const last = frames[frames.length - 1]
  const peakC = Math.max(...frames.map((f) => f.tempC))
  const maxV = Math.max(...frames.flatMap((f) => f.volts))
  const wrong = M.cells !== n || M.cvCell !== LIPO_CHEM.full
  const vented = last.phase === 'vent'
  const verdict = puzzleVerdict([
    { id: 'puffed', ok: !S.puffed },
    { id: 'flat', ok: Math.min(...S.socs.map((s) => cellVolts(LIPO_CHEM, s))) >= LIPO_FLAT_V },
    { id: 'vent', ok: !vented },
    { id: 'over', ok: maxV <= LIPO_CHEM.full + 0.01 },
    { id: 'setting', ok: !wrong },
    { id: 'rate', ok: cfg.rateC <= 1, near: cfg.rateC <= 2 },
    { id: 'hot', ok: cellTemp(peakC) !== 'hot', near: peakC <= LIPO_HEAT.onsetC },
    { id: 'balance', ok: cfg.balance, near: true },
    { id: 'surface', ok: !spot.flammable, near: true },
    { id: 'alone', ok: spot.attended },
  ])
  return { cfg, frames, seconds: last.t, last, peakC, maxV, setA, refused, vented, short: lipoShort(cfg.state), verdict }
}
type LipoRun = ReturnType<typeof lipoChargeRun>

/** Frame at `t` s (the last one past the end). */
export const lipoAt = (r: LipoRun, t: number) => nearestStepAt(r.frames, t, LIPO_DT)
