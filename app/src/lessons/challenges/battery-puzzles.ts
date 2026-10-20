import * as THREE from 'three/webgpu'
import {
  CHEMISTRIES,
  ChemistryId,
  ItemId,
  RUNTIME_MISSIONS,
  RUNTIME_PACKS,
  RUNTIME_PUZZLE,
  RuntimeMission,
  SERIES_PUZZLE,
  SERIES_ROBOTS,
  SeriesRobot,
  SeriesRobotId,
  runtimeTarget,
  runtimeVolts,
  seriesSweepAt,
  seriesCount,
} from '../../core/physics'
import { fixedText, hoursText, pct, si, volts, watts } from '../../core/units'
import {
  FACE_VIEW,
  GAUGE_CAPTION_Y,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  countBars,
  dcdcModule,
  emptyGroup,
  liveLabel,
  memoBy,
  motorCan,
  packBench,
  puzzleStage,
  simClock,
  verdictTint,
  wire,
  windowGauge,
} from '../fx'
import { Lesson, Params, Stage, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

const GX = 8
const GW = 7.6
const GY = [1.4, -3, -7.4]
const PACK = { at: [-12.2, 0, 0] as [number, number, number], w: 8, h: 4 }
const LEGEND = [
  { color: POWER, label: 'Target window / pass', shape: 'dot' as const },
  { color: RING, label: 'Close miss', shape: 'dot' as const },
  { color: HIGH_V, label: 'Fail / over a limit', shape: 'dot' as const },
  { color: LABEL, label: 'Voltmeter across the pack', shape: 'dot' as const },
]
const liveCaption = (scene: THREE.Object3D, y: number) => liveLabel(scene, [GX - GW / 2, y + GAUGE_CAPTION_Y, 0.2], { size: 0.3, align: 'left' })
const grams = (g: number) => `${Math.round(g)} g`
const hrs = (h: number) => (h < 48 ? hoursText(h) : `${+(h / 24).toFixed(1)} days`)
const CHEM_SHORT: Record<ChemistryId, string> = { liion: 'Li-ion', lfp: 'LiFePO4', nimh: 'NiMH', alkaline: 'alkaline' }
const LAPSE = { ticks: 160, slowS: 0.04, holdS: 1.5 }

// --- Runtime target: pick chemistry and parallel count so the pack lasts the mission, survives the peak and fits the weight. ---

const MISSION_NAMES = namesOf(RUNTIME_MISSIONS)
const PACK_NAMES = namesOf(RUNTIME_PACKS)
const PAR_NAMES = { '1': '1P', '2': '2P', '3': '3P', '4': '4P' }
const ITEMS: ItemId[] = ['motors', 'l298n', 'esp32', 'servo', 'sonar', 'buck']
const ITEM_NAME: Record<ItemId, string> = { esp32: 'ESP32', sonar: 'HC-SR04', servo: 'SG90', motors: '2× TT', buck: 'LM2596', l298n: 'L298N' }
const rtParams = (p: Params) => ({
  mission: pick(MISSION_NAMES, p.mission, 'patrol') as RuntimeMission,
  chem: pick(PACK_NAMES, p.chem, 'liion') as ChemistryId,
  parallel: Number(pick(PAR_NAMES, p.parallel, '1')),
})
type RtQ = ReturnType<typeof rtParams>
const rtSolve = memoBy((q: RtQ) => `${q.mission}|${q.chem}|${q.parallel}`, (q: RtQ) => runtimeTarget(q.chem, q.parallel, q.mission))
const packName = (q: RtQ) => `${RUNTIME_PACKS[q.chem].series}S${q.parallel}P ${CHEM_SHORT[q.chem]}`
const PEAK_WHAT: Record<RuntimeMission, string> = { patrol: 'motor start', explorer: 'motor start', sentry: 'servo sweep' }

export const batteryPuzzlesRuntimeTarget: Lesson = {
  id: 'battery-puzzles-runtime-target',
  title: 'Runtime target',
  tagline: 'Pick the cell chemistry and how many in parallel so the robot lasts its mission: peak current, runtime, weight, 20 % reserve',
  formula: (p) => {
    const q = rtParams(p)
    const s = rtSolve(q)
    return `P_avg = ${watts(s.avgW)} · ${packName(q)}: ${fixedText(s.wh, 1)} Wh usable to cutoff → t = ${fixedText(s.wh, 1)} / ${fixedText(s.avgW, 2)} = ${hrs(s.hours)} (× ${RUNTIME_PUZZLE.margin} reserve = ${hrs(s.derated)}) · peak ${si(s.cellPeakA, 'A', 2)} per cell = ${fixedText(s.peakC, 1)} C`
  },
  legend: [...LEGEND, { color: HEAT, label: 'Average power by load', shape: 'dot' }],
  points: [
    'The puzzle: the robo-car (ESP32, HC-SR04, SG90 on an LM2596 5 V rail; two TT motors behind an L298N) has a mission: a mix of driving, scanning and parking, a runtime goal and a weight budget for the pack. Pick the chemistry and how many cells in parallel.',
    'Average the mission first: P_avg = Σ share × power of each state. Runtime = usable Wh ÷ P_avg, where usable means down to the cutoff at this current, a little less than the label (Power › Power budget › Runtime estimate).',
    'Parallel cells add capacity and split the current. The peak matters as much as the average: two TT motors starting draw several amps, and a cell rated for 1 A (alkaline AA) sags and heats far beyond it; 2 C on a NiMH is fine, 10 A on an 18650 easy (Power › Battery chemistry › Capacity and C-rate, Internal resistance).',
    'Weight is the catch: NiMH and alkaline AAs store 80–110 Wh/kg, Li-ion 18650s about 240. A pack heavy enough to last can be heavier than the car can carry (Power › 18650 packs › 1S to 4S).',
    'Then keep 20 % in reserve: cells age to 80 % of their capacity, cold cuts it, and the first charge is rarely full. Size for the goal ÷ 0.8 (Power › Power budget › Peak vs average).',
  ],
  controls: [
    { kind: 'choice', key: 'mission', options: opts(MISSION_NAMES), initial: 'patrol' },
    { kind: 'choice', key: 'chem', options: opts(PACK_NAMES), initial: 'liion' },
    { kind: 'choice', key: 'parallel', options: opts(PAR_NAMES), initial: '1' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const bench = packBench(scene, PACK)
    const timeTag = liveLabel(scene, [PACK.at[0] - PACK.w / 2, -3.6, 0.3], { size: 0.3, align: 'left' })
    const barsTitle = liveLabel(scene, [-16.4, -4.6, 0.3], { size: 0.3, align: 'left' })
    const bars = countBars(scene, [-13.2, -5.5, 0], ITEMS.map((id) => ITEM_NAME[id]), 6, { row: 0.62, size: 0.28, color: HEAT })
    const tG = windowGauge(scene, [GX, GY[0], 0], GW, {
      min: 1,
      max: 100,
      log: true,
      window: [8, 100],
      caption: '',
      ticks: [[1, '1 h'], [3, '3'], [10, '10'], [30, '30'], [100, '100 h']],
    })
    const tCap = liveCaption(scene, GY[0])
    const aG = windowGauge(scene, [GX, GY[1], 0], GW, {
      min: 0.05,
      max: 20,
      log: true,
      window: [0.05, 10],
      caption: '',
      ticks: [[0.1, '0.1'], [1, '1'], [10, '10 A']],
    })
    const aCap = liveCaption(scene, GY[1])
    const wG = windowGauge(scene, [GX, GY[2], 0], GW, {
      min: 0,
      max: 700,
      window: [0, 250],
      caption: '',
      ticks: [[0, '0'], [200, '200'], [400, '400'], [600, '600 g']],
    })
    const wCap = liveCaption(scene, GY[2])
    const clock = simClock(LAPSE.slowS, LAPSE.holdS)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = rtParams(p)
        const s = rtSolve(q)
        const c = CHEMISTRIES[q.chem]
        const key = `${q.mission}|${q.chem}|${q.parallel}`
        if (key !== st.key) {
          st.key = key
          bench.setPack(q.chem, s.series, q.parallel, `${packName(q)} · ${fixedText(s.volts, 1)} V · ${s.mAh} mAh`)
          tG.setWindow(s.target, 100)
          tCap.set(`Runtime, goal ${hrs(s.target)} (bar: −20 %)`, LABEL)
          aG.setWindow(0.05, s.cellMaxA)
          aCap.set(`Peak per cell, rated ${si(s.cellMaxA, 'A', 2)}`, LABEL)
          wG.setWindow(0, s.maxGrams)
          wCap.set(`Pack weight, budget ${grams(s.maxGrams)}`, LABEL)
          const w = ITEMS.map((id) => s.items.find((it) => it.id === id)?.watts ?? 0)
          bars.set(w, w.map((x) => si(x, 'W', 2)), undefined, Math.max(...w))
          barsTitle.set(`Average ${watts(s.avgW)} from the pack`, LABEL)
        }
        const tick = clock(dt, key, LAPSE.ticks)
        st.t = (tick / LAPSE.ticks) * s.hours
        const r = runtimeVolts(c, s.series, s.cellA, s.hours, st.t)
        const left = 1 - (1 - r.soc) / s.usable
        bench.set(r.volts, left, verdictTint(left > 0.2, left > 0.05))
        timeTag.set(`t = ${hrs(st.t)} of ${hrs(s.hours)} · ${LAPSE.ticks * LAPSE.slowS} s loop`, GREY)
        const v = s.verdict
        const shortTint = verdictTint(s.hours >= s.target, s.hours >= 0.8 * s.target)
        tG.set(Math.max(1, s.hours), hrs(s.hours), s.derated >= s.target ? POWER : shortTint, [Math.max(1, s.derated), Math.max(1, s.hours)])
        aG.set(s.cellPeakA, si(s.cellPeakA, 'A', 2), verdictTint(s.cellPeakA <= s.cellMaxA, s.cellPeakA <= 1.5 * s.cellMaxA))
        wG.set(s.grams, grams(s.grams), verdictTint(s.grams <= s.maxGrams, s.grams <= 1.15 * s.maxGrams))
        const why = {
          peak: `A ${PEAK_WHAT[q.mission]} draws ${si(s.peakA, 'A', 2)}${q.parallel > 1 ? `, ${si(s.cellPeakA, 'A', 2)} per cell` : ''} (${fixedText(s.peakC, 1)} C), over its ${si(s.cellMaxA, 'A', 2)}. More in parallel or a stronger cell`,
          short: `${hrs(s.hours)}, short of ${hrs(s.target)}: ${fixedText(s.wh, 1)} Wh ÷ ${watts(s.avgW)}. More in parallel or more Wh per cell`,
          heavy: `Lasts ${hrs(s.hours)}, but ${grams(s.grams)} is over the ${grams(s.maxGrams)} budget. Lighter cells: more Wh per kg`,
          margin: `${hrs(s.hours)} new, but ${hrs(s.derated)} with 20 % reserve, under ${hrs(s.target)}. One more in parallel`,
        }
        header.set(
          `${RUNTIME_MISSIONS[q.mission].name.split(':')[0].toLowerCase()} for ${hrs(s.target)}, pack ≤ ${grams(s.maxGrams)}`,
          v,
          v.fail ? why[v.fail] : `${packName(q)}: ${hrs(s.hours)} (${hrs(s.derated)} with reserve), ${grams(s.grams)}, ${fixedText(s.peakC, 1)} C peak`,
          `Hint: need ≈ ${fixedText((s.target / RUNTIME_PUZZLE.margin) * s.avgW, 0)} Wh; one ${CHEM_SHORT[q.chem]} cell holds ${fixedText((c.nominal * c.cell.mAh) / 1000, 1)} Wh, weighs ${grams(c.cell.grams)}`,
        )
      },
      readouts: (p) => {
        const q = rtParams(p)
        const s = rtSolve(q)
        return [
          { label: 'Average power', value: `${watts(s.avgW)} · ${si(s.avgW / s.volts, 'A', 2)}` },
          { label: `Usable (of ${fixedText(s.ratedWh, 1)} Wh rated)`, value: `${fixedText(s.wh, 1)} Wh` },
          { label: 'Runtime · with reserve', value: `${hrs(s.hours)} · ${hrs(s.derated)}`, tone: toneOf(s.derated >= s.target, s.hours >= s.target) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- Series count: enough cells to keep the regulator and motors in their window from full to empty, not one too many. ---

const ROBOT_NAMES = namesOf(SERIES_ROBOTS)
const CHEM_NAMES: Record<ChemistryId, string> = { liion: 'Li-ion 3.0–4.2 V', lfp: 'LiFePO4 2.5–3.6 V', nimh: 'NiMH 1.0–1.4 V', alkaline: 'Alkaline 0.9–1.6 V' }
const scParams = (p: Params) => ({
  robot: pick(ROBOT_NAMES, p.robot, 'car') as SeriesRobotId,
  chem: pick(CHEM_NAMES, p.chem, 'nimh') as ChemistryId,
  series: Math.round(Math.min(SERIES_PUZZLE.maxSeries, Math.max(1, Number(p.series) || 1))),
})
type ScQ = ReturnType<typeof scParams>
const scSolve = memoBy((q: ScQ) => `${q.robot}|${q.chem}|${q.series}`, (q: ScQ) => seriesCount(q.robot, q.chem, q.series))
const LIMIT_TEXT = { off: 'below its minimum input', 'over-voltage': 'over its input max', dropout: 'drops out (runs out of duty)', 'pass-through': 'passes it straight through (a boost can’t step down)', 'current-limit': 'hits its current limit' }
const MOD_AT: [number, number, number] = [-12.2, -6.9, 0]
const MOTOR_AT: [number, number, number] = [-4.4, -6.4, 0]
const robotOf = (id: SeriesRobotId): SeriesRobot => SERIES_ROBOTS[id]

export const batteryPuzzlesSeriesCount: Lesson = {
  id: 'battery-puzzles-series-count',
  title: 'Series count',
  tagline: 'How many cells in series? Cover the regulator’s and motor’s voltage window from a full pack to an empty one',
  formula: (p) => {
    const q = scParams(p)
    const s = scSolve(q)
    const c = CHEMISTRIES[q.chem]
    return `${q.series} × ${fixedText(c.full, 1)} V = ${volts(s.full)} full … ${q.series} × ${fixedText(c.cutoff, 1)} V = ${volts(s.empty)} empty · needs ${fixedText(s.need[0], 1)}–${fixedText(s.need[1], 1)} V · rail regulated over ${pct(s.share)} of the charge`
  },
  legend: LEGEND,
  points: [
    'The puzzle: a robot needs a voltage window, and a pack doesn’t give one voltage: Li-ion runs 4.2 V full to 3.0 V empty per cell, NiMH 1.4 to 1.0, alkaline 1.6 to 0.9. Pick the chemistry and the series count so the whole swing, full to empty, fits (Power › Battery chemistry › Cell voltage curve).',
    'Top of the window: the lowest absolute maximum on the pack rail (DRV8833: 10.8 V) and the motor’s rating after the driver’s drop. A fresh pack is the worst case (Power › 18650 packs › 1S to 4S).',
    'Bottom: a buck needs headroom: the LM2596 holds 5 V only above ~5.5 V. A boost (MT3608) is the opposite: it works down to 2 V but can’t step down, so a pack above ~5.5 V just passes through. Motors need enough volts to move when the pack is empty (Power › Buck & boost › Choosing a module).',
    'Then the spike: an empty pack sags under the motor start plus a Wi-Fi burst (I × R of every cell in series), and the rail browns out. Higher-resistance cells (NiMH, alkaline) sag more (Power › Brownouts › Current spikes).',
    'Flat curves help: LiFePO4 and NiMH barely move mid-charge, but their empty voltage per cell is low, so they need more cells. The time-lapse runs the pack from full to empty: watch the needles leave the windows.',
  ],
  controls: [
    { kind: 'choice', key: 'robot', options: opts(ROBOT_NAMES), initial: 'car' },
    { kind: 'choice', key: 'chem', options: opts(CHEM_NAMES), initial: 'nimh' },
    { kind: 'slider', key: 'series', label: 'Cells in series', min: 1, max: SERIES_PUZZLE.maxSeries, step: 1, initial: 4, format: (v: number) => `${v}S` },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const bench = packBench(scene, PACK)
    const lapseTag = liveLabel(scene, [PACK.at[0] - PACK.w / 2, -3.7, 0.3], { size: 0.3, align: 'left' })
    const loads = new THREE.Group()
    scene.add(loads)
    const railTag = liveLabel(scene, [MOD_AT[0], MOD_AT[1] + 2.25, 0.3], { size: 0.3 })
    const motorTag = liveLabel(scene, [MOTOR_AT[0], MOTOR_AT[1] + 2.2, 0.3], { size: 0.3 })
    const pG = windowGauge(scene, [GX, GY[0], 0], GW, {
      min: 1,
      max: 50,
      log: true,
      window: [5, 10],
      caption: '',
      ticks: [[1, '1 V'], [2, '2'], [5, '5'], [10, '10'], [20, '20'], [50, '50 V']],
    })
    const pCap = liveCaption(scene, GY[0])
    const mG = windowGauge(scene, [GX, GY[1], 0], GW, {
      min: 0,
      max: 20,
      window: [3, 9],
      caption: '',
      ticks: [[0, '0'], [5, '5'], [10, '10'], [15, '15'], [20, '20 V']],
    })
    const mCap = liveCaption(scene, GY[1])
    const rG = windowGauge(scene, [GX, GY[2], 0], GW, {
      min: 0,
      max: 10,
      window: [4.75, 5.25],
      caption: 'Logic rail (5 V ±5 %)',
      ticks: [[0, '0'], [2.5, '2.5'], [5, '5'], [7.5, '7.5'], [10, '10 V']],
    })
    const clock = simClock(LAPSE.slowS, LAPSE.holdS)
    const st = { robot: '', key: '', soc: 1, motor: null as ReturnType<typeof motorCan> | null, mod: null as ReturnType<typeof dcdcModule> | null }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = scParams(p)
        const s = scSolve(q)
        const r = robotOf(q.robot)
        if (q.robot !== st.robot) {
          st.robot = q.robot
          emptyGroup(loads)
          st.mod = dcdcModule(loads, MOD_AT, r.reg, 0.17)
          const inP = st.mod.pins.inP
          const x = PACK.at[0] + PACK.w / 2 + 1.6
          const low = -9.6
          wire(loads, [[x, PACK.at[1] - PACK.h / 2 - 0.25, 0], [x, low, 0], [-16.8, low, 0], [-16.8, inP[1], 0], inP], 0.1)
          st.motor = r.motor ? motorCan(loads, MOTOR_AT, { r: 1.3 }) : null
          if (st.motor) wire(loads, [[x, low, 0], [st.motor.pins[0][0], low, 0], st.motor.pins[0]], 0.1)
          mG.setWindow(r.motor?.min ?? 0, r.motor?.max ?? 0)
          mCap.set(r.motor ? `Motor volts, ${r.motor.min}–${r.motor.max} V` : 'Motor volts: no motor', r.motor ? LABEL : GREY)
          motorTag.set(r.motor ? `${r.motor.count} × ${r.motor.name}` : '', LABEL)
        }
        const key = `${q.robot}|${q.chem}|${q.series}`
        if (key !== st.key) {
          st.key = key
          bench.setPack(q.chem, q.series, 1, `${q.series}S ${CHEM_SHORT[q.chem]} · ${fixedText(s.full, 1)} → ${fixedText(s.empty, 1)} V`)
          pG.setWindow(Math.max(1, s.need[0]), Math.max(1, s.need[1]))
          pCap.set(`Pack volts, needs ${fixedText(s.need[0], 1)}–${fixedText(s.need[1], 1)} V`, LABEL)
        }
        const tick = clock(dt, key, LAPSE.ticks)
        st.soc = 1 - tick / LAPSE.ticks
        const a = seriesSweepAt(q.robot, q.chem, q.series, st.soc)
        const packOk = a.vpack >= s.need[0] && a.vpack <= s.need[1]
        bench.set(a.vpack, st.soc, packOk ? POWER : HIGH_V)
        lapseTag.set(`Charge ${pct(st.soc)} · full → empty in ${LAPSE.ticks * LAPSE.slowS} s`, GREY)
        pG.set(Math.max(1, a.vpack), volts(a.vpack), packOk ? POWER : HIGH_V, [Math.max(1, s.empty), Math.max(1, s.full)])
        if (r.motor) {
          const mOk = a.motorV >= r.motor.min && a.motorV <= r.motor.max
          mG.set(a.motorV, volts(a.motorV), mOk ? POWER : HIGH_V, [s.motorEmpty, s.motorFull])
          st.motor?.spin(dt, mOk || a.motorV > r.motor.max ? 30 * a.motorV : 4 * a.motorV)
        } else mG.set(0, '—', GREY)
        const railOk = a.limit === null
        rG.set(a.rail, volts(a.rail), railOk ? POWER : HIGH_V)
        st.mod?.set(railOk ? 0.3 : 0, railOk ? 0.6 : 0)
        railTag.set(`${r.reg.toUpperCase()} → ${r.vset} V${a.limit ? `: ${a.limit}` : ''}`, railOk ? POWER : HIGH_V)
        const v = s.verdict
        const c = CHEMISTRIES[q.chem]
        const why = {
          over: `Full pack ${volts(s.full)} is over the ${r.maxPart}. One cell fewer`,
          motorHi: `Fresh pack gives the motor ${volts(s.motorFull)}, over its ${r.motor?.max} V. One cell fewer`,
          regulate: s.failAt
            ? `At ${volts(s.failAt.vpack)} the ${r.reg.toUpperCase()} ${LIMIT_TEXT[s.failAt.limit]}${s.share > 0 ? `: ${r.vset} V for only ${pct(s.share)} of the charge` : ''}`
            : `The ${r.reg.toUpperCase()} doesn’t hold ${r.vset} V`,
          weak: `Empty pack leaves the motor ${volts(s.motorEmpty)}, under ${r.motor?.min} V: it stalls before the pack is flat. One more cell`,
          brownout: `Holds at rest, but an empty pack sags to ${volts(s.spikeV)} on a motor start + Wi-Fi burst and the rail browns out to ${volts(s.spikeRail)}`,
        }
        header.set(
          `power the ${r.name.split(':')[0]} from full to empty`,
          v,
          v.fail ? why[v.fail] : `${q.series}S ${CHEM_SHORT[q.chem]}: ${fixedText(s.full, 1)} → ${fixedText(s.empty, 1)} V stays inside ${fixedText(s.need[0], 1)}–${fixedText(s.need[1], 1)} V, rail holds through the spike`,
          `Hint: S × ${fixedText(c.full, 1)} ≤ ${fixedText(s.need[1], 1)} V and S × ${fixedText(c.cutoff, 1)} ≥ ${fixedText(s.need[0], 1)} V, plus sag margin`,
        )
      },
      readouts: (p) => {
        const q = scParams(p)
        const s = scSolve(q)
        return [
          { label: 'Pack full → empty', value: `${volts(s.full)} → ${volts(s.empty)}` },
          { label: 'Needs', value: `${fixedText(s.need[0], 2)}–${fixedText(s.need[1], 2)} V` },
          { label: 'Rail regulated', value: pct(s.share), tone: toneOf(s.share >= 1, s.share >= 0.8) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}
