// Using a multimeter: the robo-car supply bench (6 × AA → lead → JST → switch → 1N4007 or T1A fuse → LM2596 → ESP32's
// AMS1117, optional DRV8833 + TT motor on the pack rail) as a netlist the meter model (dmm) clips onto, and three hunts
// where every probe needs the right dial, socket and probe spot: continuity, voltage, current.
import { Element } from '../../nodal'
import { CHEMISTRIES } from '../power/batteries'
import { LM2596, dcdcPoint } from '../power/converters'
import { TT_CRUISE_A } from '../power/budget'
import { AMS1117_33 } from '../regulators'
import { DIODES } from '../semiconductors'
import { DRIVERS } from '../actuators/hbridge'
import { TT_MOTOR } from '../actuators/dcmotor'
import { ROBOCAR } from '../projects/robocar'
import { DMM_RIGHT, DmmResult, DmmSetup, MeterNet, MeterWant, dmmRead } from './dmm'
import { MeterRead, huntOf } from './hunt'
import { SHORT_OHMS, SUPPLY_BOT, bridgedBuck, holderVolts } from './supply'

/** Node numbers of the bench (0 = GND at the buck / ESP32). */
export const METER_NODE = { cell: 1, pack: 2, swIn: 3, swOut: 4, buckIn: 5, rail5: 6, rail33: 7, gndPack: 8, drvOut: 9, motor: 10, buckSrc: 11, ldoSrc: 12 }
const NODES = 12
const BUCK_OUT_OHMS = 0.01
/** An unpowered board looks like `SUPPLY_BOT.offOhms`; every node leaks 1 GΩ to GND so nothing floats; switch 20 mΩ;
 *  each pack lead half of `SUPPLY_BOT.wiringOhms`; the ESP32 draws `ROBOCAR.logicA` (Wi-Fi connected) through its AMS1117. */
export const METER_BOT = { leakOhms: 1e9, switchOhms: 0.02, coldJointOhms: 40, leakCapOhms: 47, dragA: 0.6, espA: ROBOCAR.logicA, ldoOhms: 0.05 }

export interface MeterBench {
  /** Cells in the holder, at `soc`. */
  cells: boolean
  soc?: number
  /** Switch closed, its resistance (a cold joint). */
  sw: boolean
  swOhms?: number
  /** + lead resistance; Infinity = broken inside the insulation. */
  leadOhms?: number
  /** Guard between switch and buck: fuse, 1N4007 (stripe toward the buck), backwards, or open (a blown fuse). */
  guard: 'fuse' | 'diode' | 'back' | 'open'
  /** Solder bridge across the 5 V rail; a cap leaking `leak5` Ω across it. */
  bridge5?: boolean
  leak5?: number
  buckDead?: boolean
  ldoDead?: boolean
  /** DRV8833 + TT motor on the pack rail: driver off, running (draws `runA`), starting (= stalled) or the winding open;
   *  `lead: false` = motor lead unplugged at the driver (a gap between drvOut and motor). */
  motor?: { state: 'off' | 'run' | 'stall' | 'open'; runA?: number; lead?: boolean }
}

const AA = CHEMISTRIES.alkaline
const R = (a: number, b: number, ohms: number): Element => ({ kind: 'R', a, b, ohms })
const V = (a: number, b: number, volts: number): Element => ({ kind: 'V', a, b, volts })

/** The bench as a netlist, given the last solution (the buck runs only while its input is over its minimum, and draws
 *  its input current at that input voltage; a bridged rail holds the buck at its current limit). Loads are resistors at
 *  their operating point: a running motor = the resistance that draws `runA` from the rested pack. */
export function meterBenchNet(b: MeterBench) {
  return (volts: number[] | null): MeterNet => {
    const ocv = holderVolts(b.soc ?? SUPPLY_BOT.soc)
    const half = SUPPLY_BOT.wiringOhms / 2
    const els: Element[] = []
    for (let n = 1; n <= NODES; n++) els.push(R(n, 0, METER_BOT.leakOhms))
    if (b.cells) els.push(V(METER_NODE.cell, METER_NODE.gndPack, ocv))
    els.push(R(METER_NODE.cell, METER_NODE.pack, SUPPLY_BOT.series * AA.cell.ohms), R(METER_NODE.gndPack, 0, half))
    const lead = b.leadOhms ?? half
    if (Number.isFinite(lead)) els.push(R(METER_NODE.pack, METER_NODE.swIn, lead))
    if (b.sw) els.push(R(METER_NODE.swIn, METER_NODE.swOut, b.swOhms ?? METER_BOT.switchOhms))
    const diodes = b.guard === 'diode' ? [{ a: METER_NODE.swOut, b: METER_NODE.buckIn, d: DIODES['1N4007'] }] : b.guard === 'back' ? [{ a: METER_NODE.buckIn, b: METER_NODE.swOut, d: DIODES['1N4007'] }] : []
    if (b.guard === 'fuse') els.push(R(METER_NODE.swOut, METER_NODE.buckIn, SUPPLY_BOT.fuseOhms))
    // LM2596 → 5 V (stiff until it hits its current limit, then a current source), ESP32 + AMS1117 on 5 V, its 3.3 V
    // output (stiff until 0.8 A). Each regulator's mode comes from the last pass.
    const vin = volts ? volts[METER_NODE.buckIn] : b.cells ? ocv : 0
    const buckOn = !b.buckDead && vin >= LM2596.vinMin
    const ldoA = b.ldoDead ? AMS1117_33.iq : METER_BOT.espA + AMS1117_33.iq
    if (b.bridge5) els.push(R(METER_NODE.rail5, 0, SHORT_OHMS.rail5))
    if (b.leak5) els.push(R(METER_NODE.rail5, 0, b.leak5))
    if (buckOn) {
      const limit = bridgedBuck(vin).iout
      const out = volts ? (volts[METER_NODE.buckSrc] - volts[METER_NODE.rail5]) / BUCK_OUT_OHMS : ldoA
      const limited = volts !== null && (out > limit || (volts[METER_NODE.buckSrc] < 1 && volts[METER_NODE.rail5] < SUPPLY_BOT.rail - 0.01))
      if (limited) {
        const bb = bridgedBuck(vin, Math.max(1e-3, volts![METER_NODE.rail5] / limit))
        els.push({ kind: 'I', a: 0, b: METER_NODE.rail5, amps: bb.iout }, R(METER_NODE.buckIn, 0, vin / bb.iin))
      } else {
        const p = dcdcPoint(LM2596, vin, SUPPLY_BOT.rail, Math.max(out, ldoA))
        els.push(V(METER_NODE.buckSrc, 0, SUPPLY_BOT.rail), R(METER_NODE.buckSrc, METER_NODE.rail5, BUCK_OUT_OHMS), R(METER_NODE.buckIn, 0, vin / p.iin))
      }
      els.push(R(METER_NODE.rail5, 0, SUPPLY_BOT.rail / ldoA))
    } else els.push(R(METER_NODE.buckIn, 0, SUPPLY_BOT.offOhms), R(METER_NODE.rail5, 0, SUPPLY_BOT.offOhms))
    const ldoOn = buckOn && !b.ldoDead && (!volts || volts[METER_NODE.rail5] > AMS1117_33.vout + AMS1117_33.dropout0)
    if (ldoOn) {
      const out = volts ? (volts[METER_NODE.ldoSrc] - volts[METER_NODE.rail33]) / METER_BOT.ldoOhms : 0
      const limited = volts !== null && (out > AMS1117_33.maxAmps || (volts[METER_NODE.ldoSrc] < 1 && volts[METER_NODE.rail33] < AMS1117_33.vout - 0.01))
      if (limited) els.push({ kind: 'I', a: 0, b: METER_NODE.rail33, amps: AMS1117_33.maxAmps })
      else els.push(V(METER_NODE.ldoSrc, 0, AMS1117_33.vout), R(METER_NODE.ldoSrc, METER_NODE.rail33, METER_BOT.ldoOhms))
    } else els.push(R(METER_NODE.rail33, 0, SUPPLY_BOT.offOhms))
    const m = b.motor
    if (m) {
      const ron = DRIVERS.drv8833.drop(1)
      if (m.state !== 'off') els.push(R(METER_NODE.buckIn, METER_NODE.drvOut, ron))
      if (m.lead !== false) els.push(R(METER_NODE.drvOut, METER_NODE.motor, 0.01))
      const motorOhms = m.state === 'run' ? ocv / (m.runA ?? TT_CRUISE_A) - ron : TT_MOTOR.ohms
      if (m.state !== 'open') els.push(R(METER_NODE.motor, 0, motorOhms))
    }
    return { nodes: NODES, elements: els, diodes }
  }
}

/** A probe spot: red and black nodes, what it measures, and the bench while you measure. `series` = the probes bridge a
 *  gap; `inrush` = the bench the instant the meter closes it. */
export interface MeterSpot {
  red: number
  black: number
  want: MeterWant
  series?: boolean
  bench: MeterBench
  inrush?: MeterBench
}

/** The meter on a spot with `setup`. */
export const spotRead = (s: MeterSpot, setup: DmmSetup, black = s.black) =>
  dmmRead(setup, meterBenchNet(s.bench), s.red, black, s.inrush && meterBenchNet(s.inrush))

/** A display result as a hunt reading (V / A / Ω; OL = open, mV in volts). */
export function dmmMeterRead(r: DmmResult): MeterRead {
  const unit = r.unit === 'Ω' ? 'Ω' : r.unit === 'A' ? 'A' : 'V'
  if (r.shown === null) return { value: Infinity, unit, open: true }
  return { value: r.unit === 'mV' ? r.shown / 1000 : r.shown, unit }
}

/** What the right setup reads on a spot. */
export const rightRead = (s: MeterSpot) => dmmMeterRead(spotRead(s, DMM_RIGHT[s.want]))

const memo = <F extends string, P extends string>(spot: (f: F | 'ok', p: P) => MeterSpot) => {
  const cache = new Map<string, MeterRead>()
  return (f: F | 'ok', p: P) => {
    const k = `${f}|${p}`
    let hit = cache.get(k)
    if (!hit) cache.set(k, (hit = rightRead(spot(f, p))))
    return hit
  }
}

// --- Continuity test: pack out, beeper / Ω / diode test along the supply chain ---

export const CONT_FAULTS = {
  lead: { name: 'Broken wire in the red lead' },
  joint: { name: 'Cold joint on the switch' },
  diode: { name: 'Guard diode in backwards' },
  bridge: { name: 'Solder bridge, 5 V to GND' },
}
export type ContFault = keyof typeof CONT_FAULTS
export type ContProbe = 'lead' | 'switch' | 'diode' | 'diodeRev' | 'ground' | 'rail'
export const CONT_PROBES: Record<ContProbe, { name: string; red: number; black: number; want: MeterWant }> = {
  lead: { name: 'Red lead', red: METER_NODE.pack, black: METER_NODE.swIn, want: 'beep' },
  switch: { name: 'Switch, on', red: METER_NODE.swIn, black: METER_NODE.swOut, want: 'beep' },
  diode: { name: 'Diode fwd', red: METER_NODE.swOut, black: METER_NODE.buckIn, want: 'diode' },
  diodeRev: { name: 'Diode rev', red: METER_NODE.buckIn, black: METER_NODE.swOut, want: 'diode' },
  ground: { name: 'Black lead', red: METER_NODE.gndPack, black: 0, want: 'beep' },
  rail: { name: '5 V to GND', red: METER_NODE.rail5, black: 0, want: 'beep' },
}

/** The continuity bench with `fault`; `live` = cells in and switched on (the mistake), else the pack is unplugged. */
export function contBench(fault: ContFault | 'ok', live: boolean): MeterBench {
  return {
    cells: live,
    sw: true,
    swOhms: fault === 'joint' ? METER_BOT.coldJointOhms : undefined,
    leadOhms: fault === 'lead' ? Infinity : undefined,
    guard: fault === 'diode' ? 'back' : 'diode',
    bridge5: fault === 'bridge',
  }
}
export const contSpot = (f: ContFault | 'ok', p: ContProbe, live = false): MeterSpot => ({ ...CONT_PROBES[p], bench: contBench(f, live) })
export const CONT_HUNT = huntOf(CONT_FAULTS, CONT_PROBES, memo(contSpot))

// --- Voltage test: switched on, volts along the chain with COM on GND ---

export const VOLT_FAULTS = {
  flat: { name: 'Flat pack' },
  fuse: { name: 'Blown fuse' },
  buck: { name: 'Dead buck module' },
  ldo: { name: 'Dead 3.3 V regulator' },
}
export type VoltFault = keyof typeof VOLT_FAULTS
export type VoltProbe = 'pack' | 'fuse' | 'buckIn' | 'rail5' | 'rail33'
/** `ground` = measured to ground (COM moves with a misplaced black lead); the fuse is measured across. */
export const VOLT_PROBES: Record<VoltProbe, { name: string; red: number; black: number; ground: boolean }> = {
  pack: { name: 'Pack', red: METER_NODE.pack, black: METER_NODE.gndPack, ground: true },
  fuse: { name: 'Across the fuse', red: METER_NODE.swOut, black: METER_NODE.buckIn, ground: false },
  buckIn: { name: 'Buck input', red: METER_NODE.buckIn, black: 0, ground: true },
  rail5: { name: '5 V rail', red: METER_NODE.rail5, black: 0, ground: true },
  rail33: { name: '3.3 V rail', red: METER_NODE.rail33, black: 0, ground: true },
}
/** A flat pack: drained past cut-off, like Won't power on's. */
export const FLAT_SOC = -0.015

export function voltBench(fault: VoltFault | 'ok'): MeterBench {
  return { cells: true, soc: fault === 'flat' ? FLAT_SOC : undefined, sw: true, guard: fault === 'fuse' ? 'open' : 'fuse', buckDead: fault === 'buck', ldoDead: fault === 'ldo' }
}
export const voltSpot = (f: VoltFault | 'ok', p: VoltProbe): MeterSpot => ({ ...VOLT_PROBES[p], want: 'vdc', bench: voltBench(f) })
export const VOLT_HUNT = huntOf(VOLT_FAULTS, VOLT_PROBES, memo(voltSpot))

// --- Current test: break the circuit, meter in series; a pack that runs flat too fast ---

export const AMP_FAULTS = {
  drag: { name: 'Tight gearbox' },
  leak: { name: 'Leaky 5 V capacitor' },
  stuck: { name: 'Motor never stops' },
  open: { name: 'Motor winding open' },
}
export type AmpFault = keyof typeof AMP_FAULTS
export type AmpProbe = 'idle' | 'run' | 'motor' | 'pack'
export const AMP_PROBES: Record<AmpProbe, { name: string }> = {
  idle: { name: 'Switch gap, idle' },
  run: { name: 'Switch gap, driving' },
  motor: { name: 'Motor lead' },
  pack: { name: 'Pack volts' },
}

/** The drive bench with `fault`: switch, motor command and lead as each probe needs. */
export function ampSpot(f: AmpFault | 'ok', p: AmpProbe): MeterSpot {
  const driving = p !== 'idle' && p !== 'pack'
  const on = driving || f === 'stuck'
  const state = !on ? 'off' : f === 'open' ? 'open' : 'run'
  const runA = f === 'drag' ? METER_BOT.dragA : undefined
  const bench = (s: 'off' | 'run' | 'stall' | 'open'): MeterBench => ({
    cells: true,
    sw: p === 'motor' || p === 'pack',
    guard: 'fuse',
    leak5: f === 'leak' ? METER_BOT.leakCapOhms : undefined,
    motor: { state: s, runA, lead: p !== 'motor' },
  })
  const start = state === 'run' ? 'stall' : state
  if (p === 'pack') return { red: METER_NODE.pack, black: METER_NODE.gndPack, want: 'vdc', series: false, bench: bench(state) }
  const [red, black] = p === 'motor' ? [METER_NODE.drvOut, METER_NODE.motor] : [METER_NODE.swIn, METER_NODE.swOut]
  return { red, black, want: 'amp', series: true, bench: bench(state), inrush: bench(start) }
}
export const AMP_HUNT = huntOf(AMP_FAULTS, AMP_PROBES, memo(ampSpot))
