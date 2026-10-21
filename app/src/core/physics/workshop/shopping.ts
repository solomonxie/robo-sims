// Tool kit, Parts shopping list: the robo-car bill of materials (Robot projects › Robo-car) checked part against part:
// pack + 5 V converter (carPower), main and motor plugs (plugRun), wire gauge vs crimp terminals and heat (TERMINALS,
// ampacity), driver current and drop (DRIVERS), spare consumables and a budget. Prices are rough illustrative ranges
// (USD, hobby market), not quotes.
import { puzzleVerdict } from '../challenges/verdict'
import { CAR_PACKS, CarPack, carPower } from '../projects/robocar'
import { DCDC_MODULES } from '../power/converters'
import { CONNECTORS, ConnectorId, INSULATION_MAX_C, ampacity } from '../power/wiring'
import { DRIVERS, DriverChip, driverLoss } from '../actuators/hbridge'
import { ConnectorJob, plugRun } from './connectors'
import { TERMINALS } from './crimp'
import { Usd, usdMid, usdSum, usdTimes } from './toolkit'

export type BuckKind = keyof typeof DCDC_MODULES

/** Price per unit, USD (illustrative). */
const PART_USD = {
  esp32: [4, 10],
  motor: [2, 4],
  caster: [1, 3],
  plate: [3, 8],
  holder: [1, 2],
  switch: [0.5, 1.5],
  fuse: [0.3, 1],
  terminal: [0.03, 0.1],
  wireM: [0.5, 1.5],
  header: [0.3, 1],
  shrink: [2, 4],
} satisfies Record<string, Usd>
const CELL_USD: Record<CarPack, Usd> = { aa4: [0.5, 1], nimh4: [2, 3.5], li1: [4, 8], li2: [4, 8] }
const DRIVER_USD: Record<DriverChip, Usd> = { l298n: [2, 5], tb6612: [2, 5], drv8833: [1.5, 4] }
const BUCK_USD: Record<BuckKind, Usd> = { lm2596: [1.5, 3], mt3608: [1, 2], xl6009: [2, 4] }
/** One mated pair (housings, contacts or solder cups). */
const PLUG_USD: Record<ConnectorId, Usd> = { dupont: [0.1, 0.3], jstph: [0.2, 0.5], jstxh: [0.2, 0.5], xt30: [0.5, 1], xt60: [0.8, 1.5] }

/** Solder-cup connectors take any wire up to this thick (AWG); the rest take crimp terminals (`TERMINALS`). */
const CUP_MAX_AWG: Partial<Record<ConnectorId, number>> = { xt30: 16, xt60: 12 }
/** Does wire `awg` fit the connector's terminal (crimp barrel range or solder cup)? */
export function plugTakes(conn: ConnectorId, awg: number) {
  const cup = CUP_MAX_AWG[conn]
  if (cup !== undefined) return awg >= cup
  const [thick, thin] = TERMINALS[conn as keyof typeof TERMINALS].awg
  return awg >= thick && awg <= thin
}
const isCrimped = (conn: ConnectorId) => CUP_MAX_AWG[conn] === undefined

/** The car: target budget, power wire run (red + black), spare consumables you should add (rule of thumb: first crimps
 *  and headers get wasted), drop a driver may cost (share of the pack). */
export const CAR_BOM = { usd: 50, wireM: 2, spareMin: 0.2, driverDrop: 0.1, hardStartS: 2 }
export const SPARE_LEVELS = { none: { name: 'No spares', share: 0 }, some: { name: '+25 % consumables', share: 0.25 }, double: { name: 'Double consumables', share: 1 } }
export type SpareLevel = keyof typeof SPARE_LEVELS

/** Main power lead job for a pack: cruise current, a hard start held for `hardStartS` (wheels against a wall), reverse
 *  plugging kills the electronics, plugged every charge. */
export function carMainJob(pack: CarPack): ConnectorJob {
  const P = carPower(pack)
  return { name: 'Robo-car main lead', pins: 2, volts: P.ocv, amps: P.cruise.packA, burstA: 2 * P.stall.motorA, burstS: CAR_BOM.hardStartS, swap: 'damage', cycles: 300, tugN: 10, dropFrac: 0.02 }
}

export interface BomCfg {
  pack: CarPack
  driver: DriverChip
  buck: BuckKind
  mainPlug: ConnectorId
  motorPlug: ConnectorId
  awg: number
  spares: SpareLevel
}

interface BomLine {
  key: string
  name: string
  qty: number
  unit: Usd
  total: Usd
  /** Gets used up or wasted while learning: buy spares. */
  consumable: boolean
}

/** Lines for a configuration; consumables are rounded up after adding the spare share. */
export function carBom(c: BomCfg): BomLine[] {
  const spare = SPARE_LEVELS[c.spares].share
  const P = CAR_PACKS[c.pack]
  const pins = (isCrimped(c.mainPlug) ? 2 : 0) + (isCrimped(c.motorPlug) ? 4 : 0)
  const rows: [string, string, number, Usd, boolean][] = [
    ['esp32', 'ESP32 DevKit', 1, PART_USD.esp32 as Usd, false],
    ['driver', `${DRIVERS[c.driver].name} driver`, 1, DRIVER_USD[c.driver], false],
    ['motors', 'TT motor + wheel', 2, PART_USD.motor as Usd, false],
    ['caster', 'Ball caster', 1, PART_USD.caster as Usd, false],
    ['plate', 'Acrylic plate', 1, PART_USD.plate as Usd, false],
    ['cells', P.name.replace(/^\d+ × /, '').replace(/ \(2S\)$/, ''), P.series, CELL_USD[c.pack], false],
    ['holder', 'Cell holder', 1, PART_USD.holder as Usd, false],
    ['buck', `${DCDC_MODULES[c.buck].name} module`, 1, BUCK_USD[c.buck], false],
    ['switch', 'Power switch', 1, PART_USD.switch as Usd, false],
    ['fuse', 'Polyfuse', 1, PART_USD.fuse as Usd, false],
    ['mainPlug', `${CONNECTORS[c.mainPlug].name} pair, main`, 1, PLUG_USD[c.mainPlug], false],
    ['motorPlug', `${CONNECTORS[c.motorPlug].name} pair, motor`, 2, PLUG_USD[c.motorPlug], false],
    ['terminals', 'Crimp terminals', pins, PART_USD.terminal as Usd, true],
    ['wire', `${c.awg} AWG wire, m`, CAR_BOM.wireM, PART_USD.wireM as Usd, true],
    ['headers', '40-pin header strip', 1, PART_USD.header as Usd, true],
    ['shrink', 'Heat-shrink kit', 1, PART_USD.shrink as Usd, false],
  ]
  return rows
    .map(([key, name, base, unit, consumable]) => {
      const qty = consumable && base > 0 ? Math.ceil(base * (1 + spare) - 1e-9) : base
      return { key, name, qty, unit, total: usdTimes(unit, qty), consumable }
    })
    .filter((l) => l.qty > 0)
}

/** Every check on the list, in order; the first failing one is the reason. */
export function bomRun(c: BomCfg) {
  const lines = carBom(c)
  const cost = usdSum(lines.map((l) => l.total))
  const mid = usdMid(cost)
  const P = carPower(c.pack, undefined, DCDC_MODULES[c.buck])
  const main = plugRun(carMainJob(c.pack), c.mainPlug)
  const motor = plugRun('motor', c.motorPlug)
  const wireA = ampacity(c.awg, INSULATION_MAX_C.pvc)
  const burstA = main.J.burstA
  const D = DRIVERS[c.driver]
  const cruise = driverLoss(c.driver, P.cruise.amps, P.cruise.packV)
  const dropShare = cruise.drop / P.cruise.packV
  const fits = { main: plugTakes(c.mainPlug, c.awg), motor: plugTakes(c.motorPlug, c.awg) }
  const spare = SPARE_LEVELS[c.spares].share
  const railOk = Math.abs(P.cruise.railV - 5) <= 0.25
  const verdict = puzzleVerdict([
    { id: 'rail', ok: railOk },
    { id: 'resets', ok: !P.stall.resets },
    { id: 'mainPlug', ok: main.verdict.pass, near: main.verdict.near },
    { id: 'motorPlug', ok: motor.verdict.pass, near: motor.verdict.near },
    { id: 'fit', ok: fits.main && fits.motor },
    { id: 'wire', ok: wireA >= burstA, near: wireA >= P.cruise.packA },
    { id: 'driver', ok: P.stall.motorA <= D.maxA, near: true },
    { id: 'drop', ok: dropShare <= CAR_BOM.driverDrop, near: true },
    { id: 'slow', ok: P.verdict !== 'slow', near: true },
    { id: 'spares', ok: spare >= CAR_BOM.spareMin, near: true },
    { id: 'budget', ok: mid <= CAR_BOM.usd, near: mid <= 1.1 * CAR_BOM.usd },
  ])
  return { cfg: c, lines, cost, mid, P, main, motor, wireA, burstA, cruise, dropShare, fits, spare, railOk, verdict }
}
export type BomRun = ReturnType<typeof bomRun>
