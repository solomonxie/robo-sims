// Battery puzzles: size a pack's chemistry and parallel count for a robot's runtime; pick the series count that keeps
// the regulator and motors in their voltage window from full to empty.
import { CHEMISTRIES, Chemistry, ChemistryId, terminalVolts, usableFraction } from '../power/batteries'
import { RobotState, averageBudget, budgetOf, packRuntime, sagged, stateAmps } from '../power/budget'
import { DCDC_MODULES, DcdcModule, dcdcPoint, regulatedShare } from '../power/converters'
import { cellVolts, packRating } from '../power/packs'
import { DRIVERS, DriverChip } from '../actuators/hbridge'
import { TT_MOTOR } from '../actuators/dcmotor'
import { bisectEdge } from '../common'
import { puzzleVerdict } from './verdict'

// --- Runtime target ---

/** Keep 20 % in reserve: ageing (80 % capacity at end of life), cold and a pack that isn't quite full. */
export const RUNTIME_PUZZLE = { margin: 0.8, maxParallel: 4 }

/** Packs for the robo-car (LM2596 → 5 V logic, L298N → 2 × TT), series fixed near 7 V; `cellMaxA` = continuous rating. */
export const RUNTIME_PACKS: Record<ChemistryId, { name: string; series: number; cellMaxA: number }> = {
  liion: { name: '18650 Li-ion 3000 mAh, 2S', series: 2, cellMaxA: 10 },
  lfp: { name: '18650 LiFePO4 1500 mAh, 2S', series: 2, cellMaxA: 4.5 },
  nimh: { name: 'AA NiMH 2000 mAh, 6S', series: 6, cellMaxA: 4 },
  alkaline: { name: 'AA alkaline 2500 mAh, 6S', series: 6, cellMaxA: 1 },
}

/** Time split between robot states, the peak state (motor start or servo sweep), runtime goal and pack weight budget. */
export const RUNTIME_MISSIONS = {
  patrol: { name: 'Patrol: drive 50 %, park 50 %', parts: [[0.5, 'cruise'], [0.5, 'idle']], peak: 'stall', hours: 8, maxGrams: 250 },
  explorer: { name: 'Explorer: drive 70 %, scan 30 %', parts: [[0.7, 'cruise'], [0.3, 'scan']], peak: 'stall', hours: 4, maxGrams: 200 },
  sentry: { name: 'Sentry: scan 10 %, park 90 %', parts: [[0.1, 'scan'], [0.9, 'idle']], peak: 'scan', hours: 24, maxGrams: 300 },
} satisfies Record<string, { name: string; parts: [number, RobotState][]; peak: RobotState; hours: number; maxGrams: number }>
export type RuntimeMission = keyof typeof RUNTIME_MISSIONS

type RuntimeFail = 'peak' | 'short' | 'heavy' | 'margin'

/** Average pack power of the mission at nominal volts → runtime to cutoff (sag-derated Wh), peak cell current, weight. */
export function runtimeTarget(chem: ChemistryId, parallel: number, mission: RuntimeMission) {
  const c = CHEMISTRIES[chem]
  const P = RUNTIME_PACKS[chem]
  const m = RUNTIME_MISSIONS[mission]
  const pack = packRating(c, P.series, parallel, P.cellMaxA)
  const vpack = pack.volts
  const avg = averageBudget(m.parts.map(([f, s]) => [f, budgetOf(stateAmps(s, vpack), vpack)]))
  const peakA = budgetOf(stateAmps(m.peak, vpack), vpack).packA
  const run = packRuntime(c, P.series, parallel, avg.packW)
  const cellA = avg.packW / vpack / parallel
  const cellPeakA = peakA / parallel
  const ratedWh = (pack.volts * pack.mAh) / 1000
  const derated = run.hours * RUNTIME_PUZZLE.margin
  const verdict = puzzleVerdict<RuntimeFail>([
    { id: 'peak', ok: cellPeakA <= P.cellMaxA, near: cellPeakA <= 1.5 * P.cellMaxA },
    { id: 'short', ok: run.hours >= m.hours, near: run.hours >= 0.8 * m.hours },
    { id: 'heavy', ok: pack.grams <= m.maxGrams, near: pack.grams <= 1.15 * m.maxGrams },
    { id: 'margin', ok: derated >= m.hours, near: true },
  ])
  return {
    ...pack,
    series: P.series,
    parallel,
    avgW: avg.packW,
    items: avg.items,
    peakA,
    cellA,
    cellPeakA,
    peakC: cellPeakA / (c.cell.mAh / 1000),
    usable: usableFraction(c, cellA),
    ratedWh,
    wh: run.wh,
    hours: run.hours,
    derated,
    target: m.hours,
    maxGrams: m.maxGrams,
    cellMaxA: P.cellMaxA,
    verdict,
  }
}

/** Pack terminal volts `t` hours into a steady run at `cellA` per cell (state of charge falls linearly in time to cutoff). */
export function runtimeVolts(c: Chemistry, series: number, cellA: number, hours: number, t: number) {
  const usable = usableFraction(c, cellA)
  const soc = 1 - usable * Math.min(1, Math.max(0, t / hours))
  return { soc, volts: series * terminalVolts(c, soc, cellA) }
}

/** Smallest parallel count (1…max) that passes, or null. */
export function runtimeAnswer(chem: ChemistryId, mission: RuntimeMission) {
  for (let p = 1; p <= RUNTIME_PUZZLE.maxParallel; p++) if (runtimeTarget(chem, p, mission).verdict.pass) return p
  return null
}

// --- Series count ---

/** 12 V gearmotor (37 mm class): winding resistance and running current under load. */
const GEARMOTOR_12V = { ohms: 4, runA: 0.6 }

export interface SeriesRobot {
  name: string
  reg: keyof typeof DCDC_MODULES
  vset: number
  /** Steady logic draw on the regulated rail, and a Wi-Fi burst on top for the brownout check. */
  logicA: number
  burstA: number
  /** Absolute maximum pack volts and the part that sets it. */
  vMax: number
  maxPart: string
  /** A pack voltage the regulator surely regulates at (search seed). */
  seedV: number
  motor: { driver: DriverChip; ohms: number; runA: number; count: number; min: number; max: number; name: string } | null
}

export const SERIES_ROBOTS = {
  car: {
    name: 'ESP32 car: DRV8833 + LM2596 5 V',
    reg: 'lm2596', vset: 5, logicA: 0.15, burstA: 0.35, vMax: 10.8, maxPart: 'DRV8833 (VM max 10.8 V)', seedV: 8,
    motor: { driver: 'drv8833', ohms: TT_MOTOR.ohms, runA: 0.25, count: 2, min: 3, max: 9, name: 'TT gearmotor' },
  },
  logger: {
    name: 'Logger: MT3608 boost to 5 V',
    reg: 'mt3608', vset: 5, logicA: 0.2, burstA: 0.35, vMax: 24, maxPart: 'MT3608 (VIN max 24 V)', seedV: 3.7,
    motor: null,
  },
  bigbot: {
    name: '12 V bot: L298N + LM2596 5 V',
    reg: 'lm2596', vset: 5, logicA: 0.15, burstA: 0.35, vMax: 40, maxPart: 'LM2596 (VIN max 40 V)', seedV: 12,
    motor: { driver: 'l298n', ohms: GEARMOTOR_12V.ohms, runA: GEARMOTOR_12V.runA, count: 2, min: 9, max: 16, name: '12 V gearmotor' },
  },
} satisfies Record<string, SeriesRobot>
export type SeriesRobotId = keyof typeof SERIES_ROBOTS

export const SERIES_PUZZLE = { maxSeries: 12, wiringOhms: 0.05 }

const regOk = (m: DcdcModule, v: number, r: SeriesRobot) => dcdcPoint(m, v, r.vset, r.logicA).regulating

const REG_SPANS = new Map<string, [number, number]>()
/** Pack volts over which the robot's regulator holds its rail at the steady logic load: [lowest, highest] (bisection). */
export function regulatorSpan(robot: SeriesRobotId): [number, number] {
  const hit = REG_SPANS.get(robot)
  if (hit) return hit
  const r: SeriesRobot = SERIES_ROBOTS[robot]
  const m = DCDC_MODULES[r.reg]
  const boundary = (good: number, bad: number) => bisectEdge((v) => regOk(m, v, r), good, bad, 40)
  const span: [number, number] = [boundary(r.seedV, 0), boundary(r.seedV, m.vinMax + 1)]
  REG_SPANS.set(robot, span)
  return span
}

/** Motor current at stall behind the driver: (V − drop) over winding + driver resistance (L298N: 1.4 V + 0.6 Ω). */
export function seriesStallA(robot: SeriesRobotId, vpack: number) {
  const mo = (SERIES_ROBOTS[robot] as SeriesRobot).motor
  if (!mo) return 0
  const one = mo.driver === 'l298n' ? Math.max(0, vpack - 1.4) / (mo.ohms + 0.6) : vpack / (mo.ohms + 0.36)
  return mo.count * one
}

type SeriesFail = 'over' | 'motorHi' | 'regulate' | 'weak' | 'brownout'

/** `series` cells of `chem` from full to cutoff: absolute max, motor window after the driver drop, regulator holding the
 *  rail all the way down, and the motor-start + Wi-Fi spike on an empty pack. */
export function seriesCount(robot: SeriesRobotId, chem: ChemistryId, series: number) {
  const r: SeriesRobot = SERIES_ROBOTS[robot]
  const c = CHEMISTRIES[chem]
  const m = DCDC_MODULES[r.reg]
  const full = series * c.full
  const empty = series * c.cutoff
  const drop = r.motor ? DRIVERS[r.motor.driver].drop(r.motor.runA) : 0
  const motorFull = full - drop
  const motorEmpty = Math.max(0, empty - drop)
  const reg = regulatedShare(m, c, series, r.vset, r.logicA)
  const ohms = series * c.cell.ohms + SERIES_PUZZLE.wiringOhms
  const spikeV = sagged(empty, ohms, (v) => seriesStallA(robot, v) + dcdcPoint(m, v, r.vset, r.burstA).iin)
  const spike = dcdcPoint(m, spikeV, r.vset, r.burstA)
  const [regLo, regHi] = regulatorSpan(robot)
  const need: [number, number] = [
    Math.max(regLo, r.motor ? r.motor.min + drop : 0),
    Math.min(r.vMax, regHi, r.motor ? r.motor.max + drop : Infinity),
  ]
  const mo = r.motor
  const verdict = puzzleVerdict<SeriesFail>([
    { id: 'over', ok: full <= r.vMax + 1e-9, near: full <= 1.1 * r.vMax },
    { id: 'motorHi', ok: !mo || motorFull <= mo.max, near: !!mo && motorFull <= 1.15 * mo.max },
    { id: 'regulate', ok: reg.share >= 1, near: reg.share >= 0.8 },
    { id: 'weak', ok: !mo || motorEmpty >= mo.min, near: !!mo && motorEmpty >= 0.85 * mo.min },
    { id: 'brownout', ok: spike.regulating, near: true },
  ])
  return { full, empty, drop, motorFull, motorEmpty, share: reg.share, failAt: reg.failAt, spikeV, spikeRail: spike.vout, need, verdict }
}

/** Rest pack volts at state of charge `soc`, the regulated rail and the motor's volts behind the driver. */
export function seriesSweepAt(robot: SeriesRobotId, chem: ChemistryId, series: number, soc: number) {
  const r: SeriesRobot = SERIES_ROBOTS[robot]
  const vpack = series * cellVolts(CHEMISTRIES[chem], soc)
  const p = dcdcPoint(DCDC_MODULES[r.reg], vpack, r.vset, r.logicA)
  const drop = r.motor ? DRIVERS[r.motor.driver].drop(r.motor.runA) : 0
  return { vpack, rail: p.limit === 'off' ? 0 : p.vout, limit: p.limit, motorV: r.motor ? Math.max(0, vpack - drop) : 0 }
}

/** Series counts (1…max) that pass for this robot and chemistry. */
export const seriesAnswers = (robot: SeriesRobotId, chem: ChemistryId) =>
  Array.from({ length: SERIES_PUZZLE.maxSeries }, (_, k) => k + 1).filter((s) => seriesCount(robot, chem, s).verdict.pass)

