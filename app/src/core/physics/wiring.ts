// Wiring a robot: copper runs (drop, I²R heat vs insulation), connector contacts, and shared ground returns.
import { Element, solveNodal } from '../nodal'
import { RESISTIVITY, ROOM_C, TEMP_COEFF, awgDiameter, wireArea } from './dc'

/** Hook-up wire insulation wall (m) and the free-air heat transfer (convection + radiation, W/m²·K). */
export const INSULATION_WALL = 0.4e-3
export const AIR_H = 12
export const INSULATION_MAX_C = { pvc: 80, silicone: 200 }
export type Insulation = keyof typeof INSULATION_MAX_C

const CU_DENSITY = 8960
const CU_HEAT = 385
const PVC_HEAT_PER_M3 = 1.3e6

/** Copper resistance per metre at `tempC`. */
export const ohmsPerMetre = (gauge: number, tempC = ROOM_C) =>
  (RESISTIVITY.copper / wireArea(awgDiameter(gauge))) * (1 + TEMP_COEFF.copper * (tempC - ROOM_C))

/** Out-and-back run: both conductors count. */
export const loopOhms = (gauge: number, lengthM: number, tempC = ROOM_C) => 2 * lengthM * ohmsPerMetre(gauge, tempC)

/** Heat each metre sheds per kelvin above ambient (W/m·K), from its outer surface. */
export const shedPerKelvin = (gauge: number) => AIR_H * Math.PI * (awgDiameter(gauge) + 2 * INSULATION_WALL)

/** Steady rise above ambient, R growing with temperature: ΔT = I²R′ / (G − I²R′α). Infinity = runaway. */
export function wireRiseC(gauge: number, amps: number, ambientC = ROOM_C) {
  const p = amps * amps * ohmsPerMetre(gauge, ambientC)
  const room = shedPerKelvin(gauge) - p * TEMP_COEFF.copper
  return room > 0 ? p / room : Infinity
}

/** Current that holds the wire at `maxC` in still air. */
export function ampacity(gauge: number, maxC: number, ambientC = ROOM_C) {
  const rise = maxC - ambientC
  return Math.sqrt((shedPerKelvin(gauge) * rise) / (ohmsPerMetre(gauge, ambientC) * (1 + TEMP_COEFF.copper * rise)))
}

/** Thermal time constant of a metre of insulated wire: (copper + PVC heat capacity) / G. */
export function wireTauS(gauge: number) {
  const d = awgDiameter(gauge)
  const cu = wireArea(d) * CU_DENSITY * CU_HEAT
  const pvc = (wireArea(d + 2 * INSULATION_WALL) - wireArea(d)) * PVC_HEAT_PER_M3
  return (cu + pvc) / shedPerKelvin(gauge)
}

/** Wire temperature `t` seconds after the current starts. */
export const wireTempAt = (gauge: number, amps: number, t: number, ambientC = ROOM_C) =>
  ambientC + Math.min(wireRiseC(gauge, amps, ambientC), 1e4) * (1 - Math.exp(-t / wireTauS(gauge)))

export const COPPER_MELT_C = 1085

export interface RunPoint {
  amps: number
  ohms: number
  drop: number
  loadV: number
  heatW: number
  tempC: number
  fused: boolean
}

/** A pack feeding a motor that would draw `demandA` on ideal leads, through `lengthM` of twin wire. The wire's resistance
 *  (at its steady temperature) cuts the current; if the copper would pass its melting point it fuses open. */
export function runPoint(packV: number, gauge: number, lengthM: number, demandA: number, ambientC = ROOM_C): RunPoint {
  const loadOhms = packV / demandA
  let tempC = ambientC
  let amps = demandA
  for (let k = 0; k < 60; k++) {
    amps = packV / (loadOhms + loopOhms(gauge, lengthM, tempC))
    const next = ambientC + Math.min(wireRiseC(gauge, amps, ambientC), 1e4)
    if (next > COPPER_MELT_C) return { amps: 0, ohms: Infinity, drop: packV, loadV: 0, heatW: 0, tempC: COPPER_MELT_C, fused: true }
    tempC = (tempC + next) / 2
  }
  const ohms = loopOhms(gauge, lengthM, tempC)
  const drop = amps * ohms
  return { amps, ohms, drop, loadV: packV - drop, heatW: amps * drop, tempC, fused: false }
}

/** Thinnest (highest AWG) gauge from `gauges` keeping the drop under `maxFraction` and the wire under `maxC`. */
export function pickGauge(packV: number, lengthM: number, amps: number, maxFraction: number, maxC: number, gauges: number[]) {
  const ok = gauges.filter((g) => {
    const r = runPoint(packV, g, lengthM, amps)
    return !r.fused && r.drop <= maxFraction * packV && ampacity(g, maxC) >= r.amps
  })
  return ok.length ? Math.max(...ok) : null
}

// --- Connectors: a mated pair per conductor; ratings assume a 30 K rise at the rated current. ---

export const RATED_RISE_C = 30

export interface Connector {
  name: string
  ratedA: number
  /** Per contact, new. */
  contactOhms: number
  /** Housing limit, rise included. */
  maxC: number
}

export const CONNECTORS = {
  dupont: { name: 'Dupont 2.54', ratedA: 3, contactOhms: 0.02, maxC: 85 },
  jstph: { name: 'JST-PH', ratedA: 2, contactOhms: 0.02, maxC: 85 },
  jstxh: { name: 'JST-XH', ratedA: 3, contactOhms: 0.01, maxC: 85 },
  xt30: { name: 'XT30', ratedA: 15, contactOhms: 0.001, maxC: 120 },
  xt60: { name: 'XT60', ratedA: 30, contactOhms: 0.0005, maxC: 120 },
} satisfies Record<string, Connector>
export type ConnectorId = keyof typeof CONNECTORS

/** Each contact's heat, rise and the drop across the + and − pair; `wear` multiplies the contact resistance. */
export function connectorPoint(c: Connector, amps: number, wear = 1, ambientC = ROOM_C) {
  const ohms = c.contactOhms * wear
  const heatW = amps * amps * ohms
  const kPerW = RATED_RISE_C / (c.ratedA * c.ratedA * c.contactOhms)
  const tempC = ambientC + heatW * kPerW
  return { ohms, heatW, tempC, pairDrop: 2 * amps * ohms, load: amps / c.ratedA, melts: tempC > c.maxC }
}

// --- Ground returns: a motor driver and an MCU sharing one pack. ---

export type GroundLayout = 'daisy' | 'star'

export interface GroundSpec {
  packV: number
  motorA: number
  logicA: number
  /** Each return wire (and each + feed), contacts included. */
  wireOhms: number
}

/** Nodes: 0 pack −, 1 pack +, 2 MCU +, 3 MCU gnd, 4 driver +, 5 driver gnd. Daisy: driver gnd → MCU gnd → pack. */
export function groundReturn(layout: GroundLayout, s: GroundSpec) {
  const r = s.wireOhms
  const els: Element[] = [
    { kind: 'V', a: 1, b: 0, volts: s.packV },
    { kind: 'R', a: 1, b: 2, ohms: r },
    { kind: 'R', a: 1, b: 4, ohms: r },
    { kind: 'I', a: 2, b: 3, amps: s.logicA },
    { kind: 'I', a: 4, b: 5, amps: s.motorA },
    { kind: 'R', a: 3, b: 0, ohms: r },
    { kind: 'R', a: 5, b: layout === 'daisy' ? 3 : 0, ohms: r },
  ]
  const v = solveNodal(5, els)!.volts
  const lift = v[3]
  const lossW = [[1, 2], [1, 4], [3, 0], [5, layout === 'daisy' ? 3 : 0]].reduce((w, [a, b]) => w + (v[a] - v[b]) ** 2 / r, 0)
  return { volts: v, lift, logicV: v[2] - v[3], motorV: v[4] - v[5], lossW }
}
