// Won't power on: the robo-car on a 6 × AA holder (switch, T1A fuse, LM2596 → 5 V, ESP32 DevKit with its AMS1117 → 3.3 V)
// and the supply faults that leave it dead: a worn or flat pack, a reversed plug, a short.
import { CHEMISTRIES } from '../power/batteries'
import { cellVolts } from '../power/packs'
import { LM2596, boardC, dcdcPoint } from '../power/converters'
import { WIFI_PEAK_A } from '../power/budget'
import { ESP32_BOD } from '../power/brownout'
import { runPoint } from '../power/wiring'
import { AMS1117_33, junctionC, linearReg } from '../regulators'
import { DIODES, diodeVolts } from '../semiconductors'
import { FUSES, fuseMeltTime, reverseGuard, seriesDiode } from '../protection'
import { bisectRoot, memoize } from '../common'
import { ROOM_C } from '../dc'
import { MeterRead, amp, huntOf, volt } from './hunt'

/** The build: 6 × AA alkaline at 85 %, 50 mΩ of leads, the ESP32's boot Wi-Fi burst on 3.3 V, a T1A glass fuse (0.1 Ω),
 *  22 AWG holder leads 15 cm long; a board that's off (buck under its minimum input) looks like 10 kΩ. */
export const SUPPLY_BOT = {
  series: 6,
  soc: 0.85,
  wiringOhms: 0.05,
  rail: 5,
  bootA: WIFI_PEAK_A,
  fuseOhms: 0.1,
  gauge: 22,
  leadM: 0.15,
  offOhms: 10e3,
}
const AA = CHEMISTRIES.alkaline
const flicker = (value: number, alt: number): MeterRead => ({ value, unit: 'V', alt })

/** Rest voltage of the holder at state of charge `soc` (below 0 = drained past cutoff); `reversed` cells subtract. */
export const holderVolts = (soc = SUPPLY_BOT.soc, reversed = 0) => (SUPPLY_BOT.series - 2 * reversed) * cellVolts(AA, soc)
/** Internal resistance of the holder's cells plus its leads. */
export const holderOhms = (cellOhms = AA.cell.ohms) => SUPPLY_BOT.series * cellOhms + SUPPLY_BOT.wiringOhms

interface BootPoint {
  /** The ESP32 comes up and stays up. */
  boots: boolean
  /** The buck starts at all (its input is over the minimum with no load). */
  starts: boolean
  amps: number
  packV: number
  buckIn: number
  rail: number
  mcu: number
  /** No steady point: the buck input falls to its minimum, the buck quits, the pack recovers, repeat. Lowest volts seen. */
  dip: { pack: number; buckIn: number } | null
}

/** Switch on: rest volts `ocv`, pack resistance `rs`, line resistance `rl` (switch, contacts, fuse) and an optional
 *  series drop `drop(I)` (a guard diode) feed the LM2596 carrying the boot burst. The current rises from 0 to the
 *  first steady point; if the buck input falls under its minimum first (or the ESP32 browns out), the supply hiccups. */
export function bootPoint(ocv: number, rs: number, rl = 0, drop: (amps: number) => number = () => 0): BootPoint {
  const iout = SUPPLY_BOT.bootA + AMS1117_33.iq
  const vinAt = (a: number) => ocv - (rs + rl) * a - drop(a)
  let amps = 0
  let p = dcdcPoint(LM2596, vinAt(0), SUPPLY_BOT.rail, iout)
  for (let k = 0; k < 400 && p.limit !== 'off'; k++) {
    const next = p.iin
    if (Math.abs(next - amps) < 1e-7) break
    amps = next
    p = dcdcPoint(LM2596, vinAt(amps), SUPPLY_BOT.rail, iout)
  }
  const starts = amps > 0 || p.limit !== 'off'
  const mcu = p.limit === 'off' ? 0 : linearReg(AMS1117_33, p.vout, SUPPLY_BOT.bootA).vout
  const boots = mcu >= ESP32_BOD[0]
  const buckIn = vinAt(boots ? amps : 0)
  const low = p.limit === 'off' ? LM2596.vinMin : vinAt(amps)
  const dip = boots || !starts ? null : { pack: ocv - ((ocv - low) * rs) / (rs + rl), buckIn: low }
  return { boots, starts, amps: boots ? amps : 0, packV: ocv - rs * (boots ? amps : 0), buckIn, rail: boots ? p.vout : 0, mcu, dip }
}

// --- Dead battery ---

export const DEAD_FAULTS = {
  worn: { name: 'Worn-out cells', soc: 0.7, cellOhms: 2 },
  flat: { name: 'Flat pack', soc: -0.015, cellOhms: AA.cell.ohms },
  switch: { name: 'Switch contacts open', soc: SUPPLY_BOT.soc, cellOhms: AA.cell.ohms },
  contact: { name: 'Corroded holder springs', soc: SUPPLY_BOT.soc, cellOhms: AA.cell.ohms },
  buck: { name: 'Dead buck module', soc: SUPPLY_BOT.soc, cellOhms: AA.cell.ohms },
}
export type DeadFault = keyof typeof DEAD_FAULTS
export type DeadProbe = 'rest' | 'loaded' | 'buckIn' | 'rail'
export const DEAD_PROBES: Record<DeadProbe, { name: string }> = {
  rest: { name: 'Pack, switch off' },
  loaded: { name: 'Pack, switch on' },
  buckIn: { name: 'Buck input' },
  rail: { name: '5 V rail' },
}
/** Green crust on the springs from a leaked cell: 15 Ω between the cells and the switch. */
const CONTACT_OHMS = 15

function deadCase(fault: DeadFault | 'ok') {
  const f = fault === 'ok' ? { soc: SUPPLY_BOT.soc, cellOhms: AA.cell.ohms } : DEAD_FAULTS[fault]
  const ocv = holderVolts(f.soc)
  const rs = holderOhms(f.cellOhms)
  const rl = fault === 'contact' ? CONTACT_OHMS : 0
  const boot = fault === 'switch' || fault === 'buck' ? null : bootPoint(ocv, rs, rl)
  const reads: Record<DeadProbe, MeterRead> = {
    rest: volt(ocv),
    loaded: boot?.dip ? flicker(boot.dip.pack, ocv) : volt(boot ? boot.packV : ocv),
    buckIn: fault === 'switch' ? volt(0) : boot?.dip ? flicker(boot.dip.buckIn, ocv) : volt(boot ? boot.buckIn : ocv),
    rail: boot?.dip ? flicker(0, SUPPLY_BOT.rail) : volt(boot ? boot.rail : 0),
  }
  /** Power the buck needs at the burst (from a stiff source) vs the most this source can ever deliver: OCV² / 4R. */
  const stiff = bootPoint(ocv, 0, 0)
  return { ocv, rs, rl, boot, needW: stiff.buckIn * stiff.amps, maxW: (ocv * ocv) / (4 * (rs + rl)), reads }
}

/** The holder's numbers with `fault` in the build (memoised: every input is fixed). */
export const deadBattery = memoize(deadCase)

export const DEAD_HUNT = huntOf(DEAD_FAULTS, DEAD_PROBES, (f, p) => deadBattery(f).reads[p])

// --- Reverse polarity: a series 1N4007 guards the board ---

export const REVERSE_FAULTS = {
  plug: { name: 'Plug wired backwards' },
  cells: { name: 'Two cells in backwards' },
  diode: { name: 'Guard diode backwards' },
  buck: { name: 'Buck killed earlier' },
}
export type ReverseFault = keyof typeof REVERSE_FAULTS
export type ReverseProbe = 'plug' | 'guard' | 'buckIn' | 'rail' | 'amps'
export const REVERSE_PROBES: Record<ReverseProbe, { name: string }> = {
  plug: { name: 'Plug, red wire' },
  guard: { name: 'Across the diode' },
  buckIn: { name: 'Buck input' },
  rail: { name: '5 V rail' },
  amps: { name: 'Current in' },
}
const GUARD = DIODES['1N4007']

function reverseCase(fault: ReverseFault | 'ok') {
  const rs = holderOhms()
  const ocv = holderVolts(SUPPLY_BOT.soc, fault === 'cells' ? 2 : 0)
  const off = rs + SUPPLY_BOT.offOhms
  if (fault === 'ok') {
    const b = bootPoint(ocv, rs, 0, (a) => diodeVolts(a, GUARD))
    const reads = { plug: volt(b.packV), guard: volt(diodeVolts(b.amps, GUARD)), buckIn: volt(b.buckIn), rail: volt(b.rail), amps: amp(b.amps) }
    return { ocv, rs, reads, boot: b }
  }
  // Blocked or unpowered: the board is just its 10 kΩ off-state load behind the diode.
  const g = fault === 'plug' ? reverseGuard(-ocv, SUPPLY_BOT.offOhms, 'diode', rs) : null
  const s = fault === 'diode' ? seriesDiode(-ocv, off, GUARD) : seriesDiode(ocv, off, GUARD)
  const amps = g ? g.amps : fault === 'diode' ? -s.amps : s.amps
  const across = g ? g.guardV : fault === 'diode' ? -s.v : s.v
  const plugV = (g ? -ocv : ocv) - rs * amps
  const reads = { plug: volt(plugV), guard: volt(across), buckIn: volt(amps * SUPPLY_BOT.offOhms), rail: volt(0), amps: amp(amps) }
  return { ocv, rs, reads, boot: null }
}

/** Readings with `fault` in the build (memoised). */
export const reversePolarity = memoize(reverseCase)

export const REVERSE_HUNT = huntOf(REVERSE_FAULTS, REVERSE_PROBES, (f, p) => reversePolarity(f).reads[p])

/** The same pack and board behind each guard: reversed, how much flows (no guard: the chips' substrate diodes straight
 *  across the cells); the right way round, what the guard costs. */
export function guardCompare() {
  const ok = reversePolarity('ok')
  const b = ok.boot!
  const load = b.buckIn / b.amps
  const none = reverseGuard(-ok.ocv, load, 'none', ok.rs)
  const diode = reverseGuard(ok.ocv, load, 'diode', ok.rs)
  const pfet = reverseGuard(ok.ocv, load, 'pfet', ok.rs)
  return {
    noneA: -none.amps,
    noneW: -none.amps * -none.vLoad,
    diodeV: diode.guardV,
    diodeW: diode.guardV * diode.amps,
    pfetV: pfet.guardV,
    pfetW: pfet.guardV * pfet.amps,
  }
}

// --- Short circuit ---

export const SHORT_FAULTS = {
  lead: { name: 'Pinched pack lead' },
  blown: { name: 'Motor rail shorted' },
  rail5: { name: 'Bridge on the 5 V rail' },
  rail33: { name: 'Shorted 3.3 V cap' },
}
export type ShortFault = keyof typeof SHORT_FAULTS
export type ShortProbe = 'pack' | 'fused' | 'rail5' | 'rail33' | 'fuse' | 'heat'
export const SHORT_PROBES: Record<ShortProbe, { name: string }> = {
  pack: { name: 'Pack terminals' },
  fused: { name: 'After the fuse' },
  rail5: { name: '5 V rail' },
  rail33: { name: '3.3 V rail' },
  fuse: { name: 'Fuse, power off' },
  heat: { name: 'Thermal camera' },
}
/** Resistance of each short: a lead through its insulation onto the chassis, a solder bridge, a cracked cap. */
export const SHORT_OHMS = { lead: 0.02, blown: 0.05, rail5: 0.01, rail33: 0.01 }

/** AMS1117 with its output shorted: the pass device drops all of Vin at its current limit, heats to thermal shutdown
 *  (`tOff`), cools to `tOn`, restarts. Steps the same first-order junction as `ldoThermalStep` for `seconds`; returns the
 *  on-fraction, the cycle period once settled, the hottest junction and the average current. */
export function shortedLdoRun(vin: number, seconds = 60, dt = 0.01) {
  const r = AMS1117_33
  let tj = ROOM_C
  let on = true
  let onT = 0
  let peak = tj
  const starts: number[] = []
  const k = 1 - Math.exp(-dt / r.tauS)
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    const watts = on ? vin * (r.maxAmps + r.iq) : vin * r.iq
    tj += (junctionC(r, watts) - tj) * k
    peak = Math.max(peak, tj)
    const was = on
    on = on ? tj < r.tOff : tj <= r.tOn
    if (on && !was) starts.push(i * dt)
    if (i * dt >= seconds / 2 && on) onT += dt
  }
  const duty = onT / (seconds / 2)
  const period = starts.length > 2 ? starts[starts.length - 1] - starts[starts.length - 2] : Infinity
  const hot = junctionC(r, vin * (r.maxAmps + r.iq))
  return { duty, period, peakC: peak, avgA: duty * r.maxAmps, firstTripS: r.tauS * Math.log((hot - ROOM_C) / (hot - r.tOff)) }
}

/** Buck with its output bridged by `ohms`: the switch current limit sets the output current; the output is I × R. */
export function bridgedBuck(vin: number, ohms = SHORT_OHMS.rail5) {
  const at = (i: number) => dcdcPoint(LM2596, vin, SUPPLY_BOT.rail, i)
  const iout = bisectRoot((i) => at(i).vout - i * ohms, 0.01, LM2596.switchAmps * 2)
  const p = at(iout)
  return { iout, vout: iout * ohms, iin: p.iin, loss: p.loss, boardC: boardC(LM2596, p.loss) }
}

/** Pack feeding `draw(vin)` through `rs` (pack) + `rl` (fuse): the input current rises from 0 to its steady point. */
function feed(ocv: number, rs: number, rl: number, draw: (vin: number) => number) {
  let amps = 0
  for (let k = 0; k < 200; k++) {
    const next = draw(ocv - (rs + rl) * amps)
    if (Math.abs(next - amps) < 1e-7) break
    amps = next
  }
  return { amps, pack: ocv - rs * amps, fused: ocv - (rs + rl) * amps }
}

function shortCase(fault: ShortFault | 'ok') {
  const ocv = holderVolts()
  const cellsR = SUPPLY_BOT.series * AA.cell.ohms
  const rs = holderOhms()
  const rf = SUPPLY_BOT.fuseOhms
  const fuseOk: MeterRead = { value: rf, unit: 'Ω' }
  const heat = (value: number, label: string): MeterRead => ({ value, unit: '°C', label })
  const cool = heat(ROOM_C, 'nothing')
  if (fault === 'lead') {
    // Cells straight into the short through the holder leads, which heat up (their resistance rises with them).
    const run = runPoint(ocv, SUPPLY_BOT.gauge, SUPPLY_BOT.leadM, ocv / (cellsR + SHORT_OHMS.lead))
    const node = run.amps * SHORT_OHMS.lead
    const reads = { pack: volt(ocv - run.amps * cellsR), fused: volt(node), rail5: volt(0), rail33: volt(0), fuse: fuseOk, heat: heat(run.tempC, 'pack lead') }
    return { ocv, amps: run.amps, reads, run, meltS: Infinity }
  }
  if (fault === 'blown') {
    const amps = ocv / (rs + rf + SHORT_OHMS.blown)
    const reads = { pack: volt(ocv), fused: volt(0), rail5: volt(0), rail33: volt(0), fuse: { value: Infinity, unit: 'Ω' as const, open: true }, heat: cool }
    return { ocv, amps, reads, run: null, meltS: fuseMeltTime(amps, FUSES.T1A) }
  }
  if (fault === 'rail5') {
    const f = feed(ocv, rs, rf, (v) => bridgedBuck(v).iin)
    const b = bridgedBuck(f.fused)
    const reads = { pack: volt(f.pack), fused: volt(f.fused), rail5: volt(b.vout), rail33: volt(0), fuse: fuseOk, heat: heat(b.boardC, 'LM2596') }
    return { ocv, amps: b.iout, reads, run: null, meltS: Infinity }
  }
  const logicA = fault === 'rail33' ? shortedLdoRun(SUPPLY_BOT.rail).avgA : SUPPLY_BOT.bootA
  const draw = (v: number) => dcdcPoint(LM2596, v, SUPPLY_BOT.rail, logicA + AMS1117_33.iq)
  const f = feed(ocv, rs, rf, (v) => draw(v).iin)
  const p = draw(f.fused)
  const ldo = fault === 'rail33' ? shortedLdoRun(p.vout) : null
  const reads = {
    pack: volt(f.pack),
    fused: volt(f.fused),
    rail5: volt(p.vout),
    rail33: volt(ldo ? AMS1117_33.maxAmps * SHORT_OHMS.rail33 * ldo.duty : linearReg(AMS1117_33, p.vout, logicA).vout),
    fuse: fuseOk,
    heat: ldo ? heat(ldo.peakC, 'AMS1117') : heat(boardC(LM2596, p.loss), 'LM2596'),
  }
  return { ocv, amps: ldo ? AMS1117_33.maxAmps : f.amps, reads, run: null, meltS: Infinity, ldo }
}

/** Readings with `fault` in the build (memoised). */
export const shortCircuit = memoize(shortCase)

export const SHORT_HUNT = huntOf(SHORT_FAULTS, SHORT_PROBES, (f, p) => shortCircuit(f).reads[p])
