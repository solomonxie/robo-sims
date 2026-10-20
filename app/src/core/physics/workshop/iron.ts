// Soldering iron on a through-hole joint as a lumped heat circuit (°C/W like Ω, J/K like farads, as in waves/heat):
// regulated heater → tip end → joint top (pad, lead, solder) → barrel, each leaking to the board / air.
import { BENCH_C, doublingRate } from './technique'

/** Temperature-controlled station: heater power, heater + sensor block heat capacity, P-gain, losses to air. */
export const STATION = { watts: 60, heaterJPerK: 4, gainWPerK: 8, airWPerK: 0.02, tipAirWPerK: 0.004 }

/** Tips: heat capacity of the working end (J/K), heater → tip path (W/K), contact to the joint through a solder bridge
 *  (wet) or dry metal-to-metal (dry), W/K. Bigger tips store and pass more heat. */
export const TIPS = {
  conical: { name: 'Conical 0.4 mm', mm: 0.4, heatJPerK: 0.25, feedWPerK: 0.25, wetWPerK: 0.08, dryWPerK: 0.01 },
  chisel: { name: 'Chisel 1.6 mm', mm: 1.6, heatJPerK: 0.8, feedWPerK: 0.8, wetWPerK: 0.25, dryWPerK: 0.03 },
  wide: { name: 'Chisel 3.2 mm', mm: 3.2, heatJPerK: 2, feedWPerK: 1.5, wetWPerK: 0.5, dryWPerK: 0.06 },
} as const
export type TipKey = keyof typeof TIPS

/** Pads: joint-top and barrel heat capacity (J/K), top ↔ barrel link and each one's leak into the board (W/K).
 *  A thermal-relief signal pad is an island; a ground-plane pad without relief spokes is tied to a copper sheet. */
export const PADS = {
  signal: { name: 'Signal pad', jointJPerK: 0.12, barrelJPerK: 0.06, linkWPerK: 0.2, sinkWPerK: 0.006, barrelSinkWPerK: 0.004 },
  plane: { name: 'Ground-plane pad', jointJPerK: 0.25, barrelJPerK: 0.25, linkWPerK: 0.3, sinkWPerK: 0.02, barrelSinkWPerK: 0.03 },
} as const
export type PadKey = keyof typeof PADS

export interface IronNodes {
  heaterC: number
  tipC: number
  jointC: number
  barrelC: number
}

/** Steady idle: heater a P-control offset under the set point, tip just under the heater, board at bench temperature. */
export function ironIdle(setC: number, tip: TipKey): IronNodes {
  const T = TIPS[tip]
  const S = STATION
  const tipLoss = (T.feedWPerK * S.tipAirWPerK) / (T.feedWPerK + S.tipAirWPerK)
  const heaterC = (S.gainWPerK * setC + (S.airWPerK + tipLoss) * BENCH_C) / (S.gainWPerK + S.airWPerK + tipLoss)
  const tipC = (T.feedWPerK * heaterC + S.tipAirWPerK * BENCH_C) / (T.feedWPerK + S.tipAirWPerK)
  return { heaterC, tipC, jointC: BENCH_C, barrelC: BENCH_C }
}

/** Heater power the station asks for: P-control on its sensor, clipped to 0…watts. */
export const heaterWatts = (setC: number, heaterC: number) => Math.min(STATION.watts, Math.max(0, STATION.gainWPerK * (setC - heaterC)))

/** One explicit Euler step; `contactWPerK` = tip ↔ joint conductance (0 with the iron lifted); `extraJPerK` adds to the
 *  joint (braid, fresh solder). */
export function ironStep(n: IronNodes, setC: number, tip: TipKey, pad: PadKey, contactWPerK: number, dt: number, extraJPerK = 0): IronNodes {
  const T = TIPS[tip]
  const P = PADS[pad]
  const feed = T.feedWPerK * (n.heaterC - n.tipC)
  const touch = contactWPerK * (n.tipC - n.jointC)
  const link = P.linkWPerK * (n.jointC - n.barrelC)
  const qH = heaterWatts(setC, n.heaterC) - feed - STATION.airWPerK * (n.heaterC - BENCH_C)
  const qT = feed - touch - STATION.tipAirWPerK * (n.tipC - BENCH_C)
  const qJ = touch - link - P.sinkWPerK * (n.jointC - BENCH_C)
  const qB = link - P.barrelSinkWPerK * (n.barrelC - BENCH_C)
  return {
    heaterC: n.heaterC + (qH / STATION.heaterJPerK) * dt,
    tipC: n.tipC + (qT / T.heatJPerK) * dt,
    jointC: n.jointC + (qJ / (P.jointJPerK + extraJPerK)) * dt,
    barrelC: n.barrelC + (qB / P.barrelJPerK) * dt,
  }
}

/** Steady joint-top temperature with the iron held on for ever at contact `contactWPerK` (heater at the set point). */
export function steadyJointC(setC: number, tip: TipKey, pad: PadKey, contactWPerK: number) {
  const T = TIPS[tip]
  const P = PADS[pad]
  const barrelPath = 1 / (1 / P.linkWPerK + 1 / P.barrelSinkWPerK)
  const sink = P.sinkWPerK + barrelPath
  // Series heater → tip → joint → board, ignoring the tip's own small air loss.
  const r = 1 / T.feedWPerK + 1 / contactWPerK
  return BENCH_C + (setC - BENCH_C) / (1 + sink * r)
}

/** Untinned tip left hot: share of its face covered in oxide after `idleS` (parabolic growth; full in 30 s at 350 °C,
 *  twice as fast every 40 °C hotter). A tinned tip is protected: 0. */
export const OXIDE = { fullS: 30, refC: 350, doubleC: 40 }
export const tipOxide = (tipC: number, idleS: number) => Math.min(1, Math.sqrt(idleS * doublingRate(tipC, OXIDE.refC, OXIDE.fullS, OXIDE.doubleC)))

/** Copper pad bond to FR4: damage dose per second, 1 = lifted (30 s at 300 °C, twice as fast every 20 °C hotter). */
export const PAD_LIFT = { refC: 300, refS: 30, doubleC: 20 }
export const padDoseRate = (jointC: number) => doublingRate(jointC, PAD_LIFT.refC, PAD_LIFT.refS, PAD_LIFT.doubleC)
