import { chargingAndDischarging, decoupling, electrolyticVsCeramic, rcTimeConstant } from '../lessons/components/capacitor'
import { flybackDiode, forwardDrop, reverseBlocking, zenerClamp } from '../lessons/components/diode'
import { energyInACoil, flybackSpike, rlTimeConstant } from '../lessons/components/inductor'
import { currentLimitingResistor, forwardVoltageAndColour, ledMatrix, rgbLed } from '../lessons/components/led'
import { baseResistor, gainAndSaturation, npnAsASwitch } from '../lessons/components/transistor-bjt'
import { gateDrive, gateThreshold, logicLevelMosfets, lowSideSwitching } from '../lessons/components/mosfet'
import { coilAndContacts, drivingARelay, solidStateRelay } from '../lessons/components/relay'
import { contactBounce, debouncing, toggleVsMomentary } from '../lessons/components/switches-buttons'
import { linearVsLogTaper, wiperAsDivider } from '../lessons/components/potentiometer'
import { fuseRatings, reversePolarity, tvsDiode } from '../lessons/components/fuses-protection'
import { clockAccuracy, loadCapacitors, resonance } from '../lessons/components/crystal-oscillator'
import { comparator, idealRules, invertingAmplifier, voltageFollower } from '../lessons/components/op-amp'
import { boostConverter, buckConverter, dropoutAndHeat, linearLdo } from '../lessons/components/voltage-regulators'
import { powerRating, pullUpAndPullDown, valueAndTolerance } from '../lessons/components/resistor'
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
import { adders, nandFromTransistors, truthTables } from '../lessons/semiconductors/logic-gates'
import { dramCapacitor, flashFloatingGate, sramLatch } from '../lessons/semiconductors/memory-cell'
import { breakdown, depletionRegion, forwardAndReverseBias } from '../lessons/semiconductors/pn-junction'
import { bandGap, holesAndElectrons, nAndPType } from '../lessons/semiconductors/silicon-doping'
import { binaryCounting, hexShorthand, twosComplement } from '../lessons/digital/binary-hex'
import { decoder, halfAndFullAdder, multiplexer, tableToCircuit } from '../lessons/digital/combinational-logic'
import { dFlipFlop, registers, srLatch } from '../lessons/digital/flip-flops-latches'
import { hc595, rippleCounter, shiftRegister } from '../lessons/digital/counters-shift-registers'
import { mooreVsMealy, robotBehaviour, trafficLight } from '../lessons/digital/state-machines'
import { clockDividers, metastability, propagationDelay } from '../lessons/digital/timing'
import { bidirectionalShifter, dividerShifter, logicThresholds } from '../lessons/digital/level-shifting'
import { blinkyInHardware, luts } from '../lessons/digital/fpga-basics'
import { capacityAndCRate, cellVoltageCurve, internalResistance } from '../lessons/power/battery-chemistry'
import { balancing, bmsProtection, oneSToFourS } from '../lessons/power/18650-packs'
import { chargeCurveLesson, thermalLimits, tp4056 } from '../lessons/power/charging'
import { choosingAModule, efficiency, inductorRipple } from '../lessons/power/buck-boost'
import { addUpTheLoads, peakVsAverage, runtimeEstimate } from '../lessons/power/power-budget'
import { connectorRatings, starGround, voltageDrop } from '../lessons/power/wiring-gauge'
import { bulkCapacitors, motorNoise, separateRails } from '../lessons/power/noise-decoupling'
import { currentSpikes, diagnosingResets } from '../lessons/power/brownouts'
import { bodePlot, highPass, rcLowPass } from '../lessons/signals/filters'
import { aliasing, nyquistLimit, spectrum } from '../lessons/signals/fourier-intuition'
import { decodingBus, probing, triggering } from '../lessons/signals/oscilloscope'
import { captureI2c, captureSpi, patternTrigger, sampleRate } from '../lessons/signals/logic-analyzer'
import { reflections, termination } from '../lessons/signals/transmission-lines'
import { antennaTypes, lora, twoFourGhz } from '../lessons/signals/radio-basics'
import { cableShields, groundLoops, twistedPairs } from '../lessons/signals/grounding-shielding'
import { layoutRules, manufacturing, schematicCapture, tracesAndVias } from '../lessons/signals/pcb-design'
import { Lesson } from '../lessons/types'
import { electronics } from './electronics'
import { driveStrength, interrupts, outputAndInputModes, pullUps } from '../lessons/microcontrollers/gpio'
import { averageVoltage, dutyCycle, frequencyChoice, servoPulses } from '../lessons/microcontrollers/pwm'
import { esp32AdcQuirks, noiseAndAveraging, resolutionAndRange, sampling } from '../lessons/microcontrollers/adc'
import { audioOut, r2rLadder } from '../lessons/microcontrollers/dac'
import { hardwareTimers, isrRules, millisWithoutDelay } from '../lessons/microcontrollers/timers-interrupts'
import { framingAndBaud, gpsAndModules, levelAndNoise } from '../lessons/microcontrollers/uart-serial'
import { addresses, busScan, pullUpResistors, readingAnImu } from '../lessons/microcontrollers/i2c'
import { chipSelect, clockModes, sdCardsAndDisplays } from '../lessons/microcontrollers/spi'
import { arbitration, differentialSignalling } from '../lessons/microcontrollers/can-bus'
import { bleGatt, espNow, httpAndWebSocket, stationAndAp } from '../lessons/microcontrollers/wifi-bluetooth'
import { batteryBudget, deepSleep, wakeSources } from '../lessons/microcontrollers/power-modes'
import { flashLayout, littleFs, stackAndHeap } from '../lessons/microcontrollers/memory-storage'
import { mutexes, queues, tasksAndPriorities } from '../lessons/microcontrollers/rtos-basics'
import { bootModes, otaUpdates } from '../lessons/microcontrollers/bootloader-flashing'
import { beamAngle, softTargetErrors, timeOfFlight } from '../lessons/sensors/ultrasonic'
import { lineFollower, obstacleSensor, sunlightInterference } from '../lessons/sensors/infrared'
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
  'components/resistor/value-and-tolerance': valueAndTolerance,
  'components/resistor/power-rating': powerRating,
  'components/resistor/pull-up-and-pull-down': pullUpAndPullDown,
  'components/capacitor/charging-and-discharging': chargingAndDischarging,
  'components/capacitor/rc-time-constant': rcTimeConstant,
  'components/capacitor/decoupling': decoupling,
  'components/capacitor/electrolytic-vs-ceramic': electrolyticVsCeramic,
  'components/inductor/energy-in-a-coil': energyInACoil,
  'components/inductor/rl-time-constant': rlTimeConstant,
  'components/inductor/flyback-spike': flybackSpike,
  'components/diode/forward-drop': forwardDrop,
  'components/diode/reverse-blocking': reverseBlocking,
  'components/diode/flyback-diode': flybackDiode,
  'components/diode/zener-clamp': zenerClamp,
  'components/led/forward-voltage-and-colour': forwardVoltageAndColour,
  'components/led/current-limiting-resistor': currentLimitingResistor,
  'components/led/rgb-led': rgbLed,
  'components/led/led-matrix': ledMatrix,
  'components/transistor-bjt/npn-as-a-switch': npnAsASwitch,
  'components/transistor-bjt/gain-and-saturation': gainAndSaturation,
  'components/transistor-bjt/base-resistor': baseResistor,
  'components/mosfet/gate-threshold': gateThreshold,
  'components/mosfet/low-side-switching': lowSideSwitching,
  'components/mosfet/logic-level-mosfets': logicLevelMosfets,
  'components/mosfet/gate-drive': gateDrive,
  'components/relay/coil-and-contacts': coilAndContacts,
  'components/relay/driving-a-relay': drivingARelay,
  'components/relay/solid-state-relay': solidStateRelay,
  'components/switches-buttons/contact-bounce': contactBounce,
  'components/switches-buttons/debouncing': debouncing,
  'components/switches-buttons/toggle-vs-momentary': toggleVsMomentary,
  'components/potentiometer/wiper-as-divider': wiperAsDivider,
  'components/potentiometer/linear-vs-log-taper': linearVsLogTaper,
  'components/fuses-protection/fuse-ratings': fuseRatings,
  'components/fuses-protection/reverse-polarity-protection': reversePolarity,
  'components/fuses-protection/tvs-diode': tvsDiode,
  'components/crystal-oscillator/resonance': resonance,
  'components/crystal-oscillator/load-capacitors': loadCapacitors,
  'components/crystal-oscillator/clock-accuracy': clockAccuracy,
  'components/op-amp/ideal-rules': idealRules,
  'components/op-amp/inverting-amplifier': invertingAmplifier,
  'components/op-amp/voltage-follower': voltageFollower,
  'components/op-amp/comparator': comparator,
  'components/voltage-regulators/linear-ldo': linearLdo,
  'components/voltage-regulators/dropout-and-heat': dropoutAndHeat,
  'components/voltage-regulators/buck-converter': buckConverter,
  'components/voltage-regulators/boost-converter': boostConverter,
  'semiconductors/silicon-doping/band-gap': bandGap,
  'semiconductors/silicon-doping/n-type-and-p-type': nAndPType,
  'semiconductors/silicon-doping/holes-and-electrons': holesAndElectrons,
  'semiconductors/pn-junction/depletion-region': depletionRegion,
  'semiconductors/pn-junction/forward-and-reverse-bias': forwardAndReverseBias,
  'semiconductors/pn-junction/breakdown': breakdown,
  'semiconductors/mosfet-physics/channel-formation': channelFormation,
  'semiconductors/mosfet-physics/cmos-inverter': cmosInverterLesson,
  'semiconductors/mosfet-physics/switching-energy': switchingEnergyLesson,
  'semiconductors/logic-gates/nand-from-transistors': nandFromTransistors,
  'semiconductors/logic-gates/truth-tables': truthTables,
  'semiconductors/logic-gates/adders': adders,
  'semiconductors/memory-cell/sram-latch': sramLatch,
  'semiconductors/memory-cell/dram-capacitor': dramCapacitor,
  'semiconductors/memory-cell/flash-floating-gate': flashFloatingGate,
  'digital/binary-hex/binary-counting': binaryCounting,
  'digital/binary-hex/hex-shorthand': hexShorthand,
  'digital/binary-hex/two-s-complement': twosComplement,
  'digital/combinational-logic/truth-tables': tableToCircuit,
  'digital/combinational-logic/multiplexer': multiplexer,
  'digital/combinational-logic/decoder': decoder,
  'digital/combinational-logic/half-and-full-adder': halfAndFullAdder,
  'digital/flip-flops-latches/sr-latch': srLatch,
  'digital/flip-flops-latches/d-flip-flop': dFlipFlop,
  'digital/flip-flops-latches/registers': registers,
  'digital/counters-shift-registers/ripple-counter': rippleCounter,
  'digital/counters-shift-registers/shift-register': shiftRegister,
  'digital/counters-shift-registers/74hc595-output-expander': hc595,
  'digital/state-machines/moore-vs-mealy': mooreVsMealy,
  'digital/state-machines/traffic-light-fsm': trafficLight,
  'digital/state-machines/robot-behaviour-fsm': robotBehaviour,
  'digital/timing/propagation-delay': propagationDelay,
  'digital/timing/metastability': metastability,
  'digital/timing/clock-dividers': clockDividers,
  'digital/level-shifting/logic-thresholds': logicThresholds,
  'digital/level-shifting/divider-shifter': dividerShifter,
  'digital/level-shifting/bidirectional-shifter': bidirectionalShifter,
  'digital/fpga-basics/luts': luts,
  'digital/fpga-basics/blinky-in-hardware': blinkyInHardware,
  'semiconductors/chip-making/lithography-machine': lithographyMachine,
  'semiconductors/chip-making/wafer-to-chip': waferToChip,
  'semiconductors/chip-making/what-3-nm-means': what3nmMeans,
  'power/battery-chemistry/cell-voltage-curve': cellVoltageCurve,
  'power/battery-chemistry/capacity-and-c-rate': capacityAndCRate,
  'power/battery-chemistry/internal-resistance': internalResistance,
  'power/18650-packs/1s-to-4s': oneSToFourS,
  'power/18650-packs/bms-protection': bmsProtection,
  'power/18650-packs/balancing': balancing,
  'power/charging/tp4056': tp4056,
  'power/charging/charge-curve': chargeCurveLesson,
  'power/charging/thermal-limits': thermalLimits,
  'power/buck-boost/inductor-ripple': inductorRipple,
  'power/buck-boost/efficiency': efficiency,
  'power/buck-boost/choosing-a-module': choosingAModule,
  'power/power-budget/add-up-the-loads': addUpTheLoads,
  'power/power-budget/runtime-estimate': runtimeEstimate,
  'power/power-budget/peak-vs-average': peakVsAverage,
  'power/wiring-gauge/voltage-drop': voltageDrop,
  'power/wiring-gauge/connector-ratings': connectorRatings,
  'power/wiring-gauge/star-ground': starGround,
  'power/noise-decoupling/motor-noise': motorNoise,
  'power/noise-decoupling/bulk-capacitors': bulkCapacitors,
  'power/noise-decoupling/separate-rails': separateRails,
  'power/brownouts/current-spikes': currentSpikes,
  'power/brownouts/diagnosing-resets': diagnosingResets,
  'signals/filters/rc-low-pass': rcLowPass,
  'signals/filters/high-pass': highPass,
  'signals/filters/bode-plot': bodePlot,
  'signals/fourier-intuition/spectrum': spectrum,
  'signals/fourier-intuition/aliasing': aliasing,
  'signals/fourier-intuition/nyquist': nyquistLimit,
  'signals/oscilloscope/triggering': triggering,
  'signals/oscilloscope/probing': probing,
  'signals/oscilloscope/decoding-a-bus': decodingBus,
  'signals/logic-analyzer/sample-rate': sampleRate,
  'signals/logic-analyzer/pattern-trigger': patternTrigger,
  'signals/logic-analyzer/capture-i2c': captureI2c,
  'signals/logic-analyzer/capture-spi': captureSpi,
  'signals/transmission-lines/reflections': reflections,
  'signals/transmission-lines/termination': termination,
  'signals/radio-basics/2-4-ghz': twoFourGhz,
  'signals/radio-basics/antenna-types': antennaTypes,
  'signals/radio-basics/lora': lora,
  'signals/grounding-shielding/ground-loops': groundLoops,
  'signals/grounding-shielding/twisted-pairs': twistedPairs,
  'signals/grounding-shielding/cable-shields': cableShields,
  'signals/pcb-design/schematic-capture': schematicCapture,
  'signals/pcb-design/layout-rules': layoutRules,
  'signals/pcb-design/traces-and-vias': tracesAndVias,
  'signals/pcb-design/manufacturing': manufacturing,
  'microcontrollers/gpio/output-and-input-modes': outputAndInputModes,
  'microcontrollers/gpio/pull-ups': pullUps,
  'microcontrollers/gpio/drive-strength': driveStrength,
  'microcontrollers/gpio/interrupts': interrupts,
  'microcontrollers/pwm/duty-cycle': dutyCycle,
  'microcontrollers/pwm/frequency-choice': frequencyChoice,
  'microcontrollers/pwm/servo-pulses': servoPulses,
  'microcontrollers/pwm/average-voltage': averageVoltage,
  'microcontrollers/adc/resolution-and-range': resolutionAndRange,
  'microcontrollers/adc/sampling': sampling,
  'microcontrollers/adc/noise-and-averaging': noiseAndAveraging,
  'microcontrollers/adc/esp32-adc-quirks': esp32AdcQuirks,
  'microcontrollers/dac/r-2r-ladder': r2rLadder,
  'microcontrollers/dac/audio-out': audioOut,
  'microcontrollers/timers-interrupts/hardware-timers': hardwareTimers,
  'microcontrollers/timers-interrupts/isr-rules': isrRules,
  'microcontrollers/timers-interrupts/millis-without-delay': millisWithoutDelay,
  'microcontrollers/uart-serial/framing-and-baud': framingAndBaud,
  'microcontrollers/uart-serial/level-and-noise': levelAndNoise,
  'microcontrollers/uart-serial/gps-and-modules': gpsAndModules,
  'microcontrollers/i2c/addresses': addresses,
  'microcontrollers/i2c/pull-up-resistors': pullUpResistors,
  'microcontrollers/i2c/reading-an-imu': readingAnImu,
  'microcontrollers/i2c/bus-scan': busScan,
  'microcontrollers/spi/clock-modes': clockModes,
  'microcontrollers/spi/chip-select': chipSelect,
  'microcontrollers/spi/sd-cards-and-displays': sdCardsAndDisplays,
  'microcontrollers/can-bus/differential-signalling': differentialSignalling,
  'microcontrollers/can-bus/arbitration': arbitration,
  'microcontrollers/wi-fi-bluetooth/station-and-ap': stationAndAp,
  'microcontrollers/wi-fi-bluetooth/http-and-websocket': httpAndWebSocket,
  'microcontrollers/wi-fi-bluetooth/ble-gatt': bleGatt,
  'microcontrollers/wi-fi-bluetooth/esp-now': espNow,
  'microcontrollers/power-modes/deep-sleep': deepSleep,
  'microcontrollers/power-modes/wake-sources': wakeSources,
  'microcontrollers/power-modes/battery-budget': batteryBudget,
  'microcontrollers/memory-storage/flash-layout': flashLayout,
  'microcontrollers/memory-storage/stack-and-heap': stackAndHeap,
  'microcontrollers/memory-storage/littlefs': littleFs,
  'microcontrollers/rtos-basics/tasks-and-priorities': tasksAndPriorities,
  'microcontrollers/rtos-basics/queues': queues,
  'microcontrollers/rtos-basics/mutexes': mutexes,
  'microcontrollers/bootloader-flashing/boot-modes': bootModes,
  'microcontrollers/bootloader-flashing/ota-updates': otaUpdates,
  'sensors/ultrasonic/time-of-flight': timeOfFlight,
  'sensors/ultrasonic/beam-angle': beamAngle,
  'sensors/ultrasonic/soft-target-errors': softTargetErrors,
  'sensors/infrared/obstacle-sensor': obstacleSensor,
  'sensors/infrared/line-follower': lineFollower,
  'sensors/infrared/sunlight-interference': sunlightInterference,
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
