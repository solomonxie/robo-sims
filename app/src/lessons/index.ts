import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from './electricity/current'
import { groundAndReference, measuringWithMultimeter, potentialDifference } from './electricity/voltage'
import { Unit } from './types'

export const UNITS: Unit[] = [{ title: 'Electricity', lessons: [whatFlows, conventionalVsElectron, ampsAndCoulomb, potentialDifference, groundAndReference, measuringWithMultimeter] }]
