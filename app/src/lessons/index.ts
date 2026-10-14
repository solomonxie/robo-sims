import { frequencyAndPeriod, mainsVsBattery, sineAndRms } from './electricity/ac-dc'
import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from './electricity/current'
import { ohmPlot, solvingALoop, vEqualsIR } from './electricity/ohms-law'
import { kclAtANode, kvlAroundALoop, nodalAnalysis } from './electricity/kirchhoffs-laws'
import { heatInAResistor, pEqualsVI, whAndMah } from './electricity/power-energy'
import { cellsSeriesParallel, mixedNetworks, parallelResistors, seriesResistors } from './electricity/series-parallel'
import { readingResistorBands, resistivityAndGauge, temperatureEffects } from './electricity/resistance'
import { dividerFormula, dividerSensor, loadingDivider } from './electricity/voltage-divider'
import { maximumPowerTransfer, theveninEquivalent } from './electricity/thevenin-norton'
import { groundAndReference, measuringWithMultimeter, potentialDifference } from './electricity/voltage'
import { Unit } from './types'

export const UNITS: Unit[] = [{ title: 'Electricity', lessons: [whatFlows, conventionalVsElectron, ampsAndCoulomb, potentialDifference, groundAndReference, measuringWithMultimeter, resistivityAndGauge, temperatureEffects, readingResistorBands, vEqualsIR, solvingALoop, ohmPlot, pEqualsVI, heatInAResistor, whAndMah, seriesResistors, parallelResistors, cellsSeriesParallel, mixedNetworks, dividerFormula, loadingDivider, dividerSensor, kclAtANode, kvlAroundALoop, nodalAnalysis, theveninEquivalent, maximumPowerTransfer, sineAndRms, frequencyAndPeriod, mainsVsBattery] }]
