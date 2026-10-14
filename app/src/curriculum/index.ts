import { chargingAndDischarging, decoupling, electrolyticVsCeramic, rcTimeConstant } from '../lessons/components/capacitor'
import { flybackDiode, forwardDrop, reverseBlocking, zenerClamp } from '../lessons/components/diode'
import { currentLimitingResistor, forwardVoltageAndColour, ledMatrix, rgbLed } from '../lessons/components/led'
import { frequencyAndPeriod, mainsVsBattery, sineAndRms } from '../lessons/electricity/ac-dc'
import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from '../lessons/electricity/current'
import { capacitanceFromPlates, coulombLaw, fieldLineMap } from '../lessons/electricity/electric-fields'
import { induction, rightHandRule, solenoid, wireAndCompass } from '../lessons/electricity/magnetism'
import { ohmPlot, solvingALoop, vEqualsIR } from '../lessons/electricity/ohms-law'
import { kclAtANode, kvlAroundALoop, nodalAnalysis } from '../lessons/electricity/kirchhoffs-laws'
import { heatInAResistor, pEqualsVI, whAndMah } from '../lessons/electricity/power-energy'
import { cellsSeriesParallel, mixedNetworks, parallelResistors, seriesResistors } from '../lessons/electricity/series-parallel'
import { readingResistorBands, resistivityAndGauge, temperatureEffects } from '../lessons/electricity/resistance'
import { dividerFormula, dividerSensor, loadingDivider } from '../lessons/electricity/voltage-divider'
import { maximumPowerTransfer, theveninEquivalent } from '../lessons/electricity/thevenin-norton'
import { groundAndReference, measuringWithMultimeter, potentialDifference } from '../lessons/electricity/voltage'
import { lithographyMachine, waferToChip, what3nmMeans } from '../lessons/semiconductors/chip-making'
import { channelFormation, cmosInverterLesson, switchingEnergyLesson } from '../lessons/semiconductors/mosfet-physics'
import { breakdown, depletionRegion, forwardAndReverseBias } from '../lessons/semiconductors/pn-junction'
import { bandGap, holesAndElectrons, nAndPType } from '../lessons/semiconductors/silicon-doping'
import { Lesson } from '../lessons/types'
import { electronics } from './electronics'
import { physics } from './physics'
import { practice } from './practice'
import { robotics } from './robotics'
import { Category, Entry, Topic } from './types'

export const CATEGORIES: Category[] = [...electronics, ...robotics, ...physics, ...practice]

export const LEARN = CATEGORIES.filter((c) => c.group === 'learn')

const SECTION_IDS: [title: string, ids: string[]][] = [
  ['Electronics', ['electricity', 'components', 'semiconductors', 'digital', 'power', 'signals']],
  ['Embedded', ['microcontrollers', 'sensors', 'software']],
  ['Robotics', ['actuators', 'mobility', 'control', 'kinematics', 'perception', 'navigation', 'ai']],
  ['Physics & maths', ['mechanics', 'waves', 'math']],
  ['Making', ['materials', 'printing']],
]
export const SECTIONS = SECTION_IDS.map(([title, ids]) => ({ title, categories: ids.map((id) => LEARN.find((c) => c.id === id)!) }))
export const PRACTICE = CATEGORIES.filter((c) => c.group === 'practice')

const READY: Record<string, Lesson> = {
  'electricity/current/what-flows-in-a-wire': whatFlows,
  'electricity/current/conventional-vs-electron-flow': conventionalVsElectron,
  'electricity/current/amps-and-the-coulomb': ampsAndCoulomb,
  'electricity/voltage/potential-difference': potentialDifference,
  'electricity/voltage/ground-and-reference': groundAndReference,
  'electricity/voltage/measuring-with-a-multimeter': measuringWithMultimeter,
  'electricity/resistance/resistivity-and-wire-gauge': resistivityAndGauge,
  'electricity/resistance/temperature-effects': temperatureEffects,
  'electricity/resistance/reading-resistor-bands': readingResistorBands,
  'electricity/ohm-s-law/v-i-r': vEqualsIR,
  'electricity/ohm-s-law/solving-a-loop': solvingALoop,
  'electricity/ohm-s-law/ohm-plot': ohmPlot,
  'electricity/power-energy/p-v-i': pEqualsVI,
  'electricity/power-energy/heat-in-a-resistor': heatInAResistor,
  'electricity/power-energy/wh-and-mah': whAndMah,
  'electricity/series-parallel/series-resistors': seriesResistors,
  'electricity/series-parallel/parallel-resistors': parallelResistors,
  'electricity/series-parallel/cells-in-series-and-parallel': cellsSeriesParallel,
  'electricity/series-parallel/mixed-networks': mixedNetworks,
  'electricity/voltage-divider/the-divider-formula': dividerFormula,
  'electricity/voltage-divider/loading-a-divider': loadingDivider,
  'electricity/voltage-divider/divider-as-a-sensor-input': dividerSensor,
  'electricity/kirchhoff-s-laws/kcl-at-a-node': kclAtANode,
  'electricity/kirchhoff-s-laws/kvl-around-a-loop': kvlAroundALoop,
  'electricity/kirchhoff-s-laws/nodal-analysis': nodalAnalysis,
  'electricity/thevenin-norton/thevenin-equivalent': theveninEquivalent,
  'electricity/thevenin-norton/maximum-power-transfer': maximumPowerTransfer,
  'electricity/ac-vs-dc/sine-waves-and-rms': sineAndRms,
  'electricity/ac-vs-dc/frequency-and-period': frequencyAndPeriod,
  'electricity/ac-vs-dc/mains-vs-battery': mainsVsBattery,
  'electricity/electric-fields/coulomb-force': coulombLaw,
  'electricity/electric-fields/field-lines': fieldLineMap,
  'electricity/electric-fields/capacitance-from-plates': capacitanceFromPlates,
  'electricity/magnetism/wire-and-compass': wireAndCompass,
  'electricity/magnetism/solenoid': solenoid,
  'electricity/magnetism/right-hand-rule': rightHandRule,
  'electricity/magnetism/induction': induction,
  'components/capacitor/charging-and-discharging': chargingAndDischarging,
  'components/capacitor/rc-time-constant': rcTimeConstant,
  'components/capacitor/decoupling': decoupling,
  'components/capacitor/electrolytic-vs-ceramic': electrolyticVsCeramic,
  'components/diode/forward-drop': forwardDrop,
  'components/diode/reverse-blocking': reverseBlocking,
  'components/diode/flyback-diode': flybackDiode,
  'components/diode/zener-clamp': zenerClamp,
  'components/led/forward-voltage-and-colour': forwardVoltageAndColour,
  'components/led/current-limiting-resistor': currentLimitingResistor,
  'components/led/rgb-led': rgbLed,
  'components/led/led-matrix': ledMatrix,
  'semiconductors/silicon-doping/band-gap': bandGap,
  'semiconductors/silicon-doping/n-type-and-p-type': nAndPType,
  'semiconductors/silicon-doping/holes-and-electrons': holesAndElectrons,
  'semiconductors/pn-junction/depletion-region': depletionRegion,
  'semiconductors/pn-junction/forward-and-reverse-bias': forwardAndReverseBias,
  'semiconductors/pn-junction/breakdown': breakdown,
  'semiconductors/mosfet-physics/channel-formation': channelFormation,
  'semiconductors/mosfet-physics/cmos-inverter': cmosInverterLesson,
  'semiconductors/mosfet-physics/switching-energy': switchingEnergyLesson,
  'semiconductors/chip-making/lithography-machine': lithographyMachine,
  'semiconductors/chip-making/wafer-to-chip': waferToChip,
  'semiconductors/chip-making/what-3-nm-means': what3nmMeans,
}
for (const e of CATEGORIES.flatMap((c) => c.topics.flatMap((t) => t.entries))) e.lesson = READY[e.id]

export const readyCount = (t: Topic) => t.entries.filter((e) => e.lesson).length
export const topicCount = (c: Category) => c.topics.length
export const lessonCount = (c: Category) => c.topics.reduce((n, t) => n + t.entries.length, 0)

export interface Hit {
  category: Category
  topic: Topic
  entry?: Entry
}

export function search(q: string): Hit[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const hits: Hit[] = []
  for (const category of CATEGORIES)
    for (const topic of category.topics) {
      if ((topic.title + ' ' + topic.tagline).toLowerCase().includes(s)) hits.push({ category, topic })
      for (const entry of topic.entries) if (entry.title.toLowerCase().includes(s)) hits.push({ category, topic, entry })
    }
  return hits.slice(0, 60)
}
