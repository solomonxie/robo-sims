import { chargingAndDischarging, decoupling, electrolyticVsCeramic, rcTimeConstant } from './components/capacitor'
import { flybackDiode, forwardDrop, reverseBlocking, zenerClamp } from './components/diode'
import { energyInACoil, flybackSpike, rlTimeConstant } from './components/inductor'
import { currentLimitingResistor, forwardVoltageAndColour, ledMatrix, rgbLed } from './components/led'
import { baseResistor, gainAndSaturation, npnAsASwitch } from './components/transistor-bjt'
import { gateDrive, gateThreshold, logicLevelMosfets, lowSideSwitching } from './components/mosfet'
import { coilAndContacts, drivingARelay, solidStateRelay } from './components/relay'
import { contactBounce, debouncing, toggleVsMomentary } from './components/switches-buttons'
import { powerRating, pullUpAndPullDown, valueAndTolerance } from './components/resistor'
import { frequencyAndPeriod, mainsVsBattery, sineAndRms } from './electricity/ac-dc'
import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from './electricity/current'
import { capacitanceFromPlates, coulombLaw, fieldLineMap } from './electricity/electric-fields'
import { induction, rightHandRule, solenoid, wireAndCompass } from './electricity/magnetism'
import { ohmPlot, solvingALoop, vEqualsIR } from './electricity/ohms-law'
import { kclAtANode, kvlAroundALoop, nodalAnalysis } from './electricity/kirchhoffs-laws'
import { heatInAResistor, pEqualsVI, whAndMah } from './electricity/power-energy'
import { cellsSeriesParallel, mixedNetworks, parallelResistors, seriesResistors } from './electricity/series-parallel'
import { readingResistorBands, resistivityAndGauge, temperatureEffects } from './electricity/resistance'
import { dividerFormula, dividerSensor, loadingDivider } from './electricity/voltage-divider'
import { maximumPowerTransfer, theveninEquivalent } from './electricity/thevenin-norton'
import { groundAndReference, measuringWithMultimeter, potentialDifference } from './electricity/voltage'
import { lithographyMachine, waferToChip, what3nmMeans } from './semiconductors/chip-making'
import { channelFormation, cmosInverterLesson, switchingEnergyLesson } from './semiconductors/mosfet-physics'
import { breakdown, depletionRegion, forwardAndReverseBias } from './semiconductors/pn-junction'
import { bandGap, holesAndElectrons, nAndPType } from './semiconductors/silicon-doping'
import { Unit } from './types'

export const UNITS: Unit[] = [
  { title: 'Electricity', lessons: [whatFlows, conventionalVsElectron, ampsAndCoulomb, potentialDifference, groundAndReference, measuringWithMultimeter, resistivityAndGauge, temperatureEffects, readingResistorBands, vEqualsIR, solvingALoop, ohmPlot, pEqualsVI, heatInAResistor, whAndMah, seriesResistors, parallelResistors, cellsSeriesParallel, mixedNetworks, dividerFormula, loadingDivider, dividerSensor, kclAtANode, kvlAroundALoop, nodalAnalysis, theveninEquivalent, maximumPowerTransfer, sineAndRms, frequencyAndPeriod, mainsVsBattery, coulombLaw, fieldLineMap, capacitanceFromPlates, wireAndCompass, solenoid, rightHandRule, induction] },
  { title: 'Components', lessons: [valueAndTolerance, powerRating, pullUpAndPullDown, chargingAndDischarging, rcTimeConstant, decoupling, electrolyticVsCeramic, energyInACoil, rlTimeConstant, flybackSpike, forwardDrop, reverseBlocking, flybackDiode, zenerClamp, forwardVoltageAndColour, currentLimitingResistor, rgbLed, ledMatrix, npnAsASwitch, gainAndSaturation, baseResistor, gateThreshold, lowSideSwitching, logicLevelMosfets, gateDrive, coilAndContacts, drivingARelay, solidStateRelay, contactBounce, debouncing, toggleVsMomentary] },
  { title: 'Semiconductors', lessons: [bandGap, nAndPType, holesAndElectrons, depletionRegion, forwardAndReverseBias, breakdown, channelFormation, cmosInverterLesson, switchingEnergyLesson, lithographyMachine, waferToChip, what3nmMeans] },
]
