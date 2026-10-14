import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from './electricity/current'
import { Unit } from './types'

export const UNITS: Unit[] = [{ title: 'Electricity', lessons: [whatFlows, conventionalVsElectron, ampsAndCoulomb] }]
