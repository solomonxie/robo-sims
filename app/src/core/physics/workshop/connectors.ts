// Choosing a connector for a job: pins, contact heat at the running current and through a burst (first-order lag),
// drop across the pair, polarity keying, latch/friction retention vs the tug it sees, and mating-cycle life.
import { CONNECTORS, Connector, ConnectorId, connectorPoint } from '../power/wiring'
import { TT_CRUISE_A } from '../power/budget'
import { stallAmps } from '../actuators/dcmotor'
import { puzzleVerdict } from '../challenges/verdict'

export interface ConnectorSpec {
  /** Most contacts a housing comes with. */
  pins: number
  /** Housing only fits one way round. */
  keyed: boolean
  /** Hold-in force (N): `perPin` = friction per contact (single Dupont housings), else for the whole housing. */
  retainN: number
  perPin: boolean
  /** Rated mating cycles (approximate, contact plating). */
  cycles: number
  /** Contact + housing thermal time constant (s). */
  tauS: number
  /** Big, stiff power housing. */
  bulky: boolean
}

export const CONNECTOR_SPECS: Record<ConnectorId, ConnectorSpec> = {
  dupont: { pins: 40, keyed: false, retainN: 1.5, perPin: true, cycles: 50, tauS: 20, bulky: false },
  jstph: { pins: 16, keyed: true, retainN: 8, perPin: false, cycles: 50, tauS: 20, bulky: false },
  jstxh: { pins: 16, keyed: true, retainN: 12, perPin: false, cycles: 100, tauS: 25, bulky: false },
  xt30: { pins: 2, keyed: true, retainN: 25, perPin: false, cycles: 500, tauS: 40, bulky: true },
  xt60: { pins: 2, keyed: true, retainN: 40, perPin: false, cycles: 1000, tauS: 60, bulky: true },
}

/** What a swapped plug does: nothing much, runs backwards, or kills something. */
export type SwapHarm = 'harmless' | 'backwards' | 'damage'

export interface ConnectorJob {
  name: string
  pins: number
  volts: number
  /** Running and burst current (A), burst length (s). */
  amps: number
  burstA: number
  burstS: number
  swap: SwapHarm
  /** Matings over its life, tug from vibration and snags (N), drop budget (fraction of volts). */
  cycles: number
  tugN: number
  dropFrac: number
}

/** MG996R: ~0.9 A moving, 2.5 A stalled; 2S LiPo main lead: 20 A cruising, 40 A for 5 s; TT motor on 2S. */
export const CONNECTOR_JOBS = {
  servo: { name: 'Servo lead (MG996R)', pins: 3, volts: 6, amps: 0.9, burstA: 2.5, burstS: 0.5, swap: 'harmless', cycles: 20, tugN: 3, dropFrac: 0.03 },
  battery: { name: '2S LiPo main power', pins: 2, volts: 7.4, amps: 20, burstA: 40, burstS: 5, swap: 'damage', cycles: 300, tugN: 20, dropFrac: 0.02 },
  i2c: { name: 'I²C sensor lead', pins: 4, volts: 3.3, amps: 0.005, burstA: 0.01, burstS: 0.1, swap: 'damage', cycles: 20, tugN: 3, dropFrac: 0.03 },
  motor: { name: 'TT motor leads', pins: 2, volts: 7.4, amps: TT_CRUISE_A, burstA: stallAmps(7.4), burstS: 1, swap: 'backwards', cycles: 20, tugN: 5, dropFrac: 0.03 },
  balance: { name: '2S balance lead', pins: 3, volts: 8.4, amps: 0.3, burstA: 0.3, burstS: 0.1, swap: 'damage', cycles: 100, tugN: 5, dropFrac: 0.03 },
} satisfies Record<string, ConnectorJob>
export type JobKey = keyof typeof CONNECTOR_JOBS

/** Burst starts this long into the time-lapse; it ends `tail` × τ after the burst. */
export const PLUG_LAPSE = { burstAtS: 2, tailS: 6 }
export const plugLapseS = (j: ConnectorJob) => PLUG_LAPSE.burstAtS + j.burstS + PLUG_LAPSE.tailS

/** Contact temperature `t` s in: steady at the running current, a first-order rise toward the burst's steady
 *  temperature, then decay back. */
export function plugTempAt(c: Connector, tauS: number, j: ConnectorJob, t: number) {
  const run = connectorPoint(c, j.amps).tempC
  const peak = connectorPoint(c, j.burstA).tempC
  const t0 = PLUG_LAPSE.burstAtS
  if (t < t0) return run
  const rise = (s: number) => run + (peak - run) * (1 - Math.exp(-s / tauS))
  if (t < t0 + j.burstS) return rise(t - t0)
  return run + (rise(j.burstS) - run) * Math.exp(-(t - t0 - j.burstS) / tauS)
}

/** Hold-in force of a housing with `pins` contacts. */
export const retentionN = (s: ConnectorSpec, pins: number) => (s.perPin ? s.retainN * pins : s.retainN)

/** Verdict for a job (a `CONNECTOR_JOBS` key or any `ConnectorJob`) on connector `conn`. */
export function plugRun<K extends JobKey | ConnectorJob>(job: K, conn: ConnectorId) {
  const J: ConnectorJob = typeof job === 'string' ? CONNECTOR_JOBS[job as JobKey] : (job as ConnectorJob)
  const C = CONNECTORS[conn]
  const S = CONNECTOR_SPECS[conn]
  const steady = connectorPoint(C, J.amps)
  const peakC = plugTempAt(C, S.tauS, J, PLUG_LAPSE.burstAtS + J.burstS)
  const drop = connectorPoint(C, J.burstA).pairDrop
  const dropFrac = drop / J.volts
  const holdN = retentionN(S, J.pins)
  const swapped: SwapHarm | 'blocked' = S.keyed ? 'blocked' : J.swap
  const verdict = puzzleVerdict([
    { id: 'pins', ok: S.pins >= J.pins },
    { id: 'melts', ok: peakC <= C.maxC },
    { id: 'reverse', ok: S.keyed || J.swap === 'harmless', near: J.swap === 'backwards' },
    { id: 'drop', ok: dropFrac <= J.dropFrac, near: dropFrac <= 2 * J.dropFrac },
    { id: 'rating', ok: J.amps <= C.ratedA, near: true },
    { id: 'shake', ok: holdN >= J.tugN, near: holdN >= 0.5 * J.tugN },
    { id: 'wear', ok: S.cycles >= J.cycles, near: true },
    { id: 'bulky', ok: !S.bulky || J.burstA * 10 >= C.ratedA, near: true },
  ])
  return { job, conn, J, C, S, steady, peakC, drop, dropFrac, holdN, swapped, verdict }
}
export type PlugRun = ReturnType<typeof plugRun>
