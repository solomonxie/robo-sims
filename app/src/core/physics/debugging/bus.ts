// Bus not responding: an MPU-6050 that NACKs (AD0 strapped high, the 8-bit address in code, SDA/SCL swapped, no power)
// and a bus that dies at 400 kHz (no pull-ups, the SCL one missing, a long cable, SDA held low). New probes: an I²C
// scanner's serial log and a logic-analyser capture: open-drain RC edges, thresholded at I²C levels, decoded.
import { Bit } from '../../logic'
import { rcStep } from '../circuits'
import { LOGIC_INPUTS, readInput } from '../levels'
import { GPIO_VDD, INTERNAL_PULL_OHMS } from '../mcu/gpio'
import { I2C_CHIPS, I2C_MODES, SINK_OHMS, chipAddress, i2cRiseTime, i2cScan, lowVolts, openDrainClock } from '../mcu/i2c'
import { I2cEvent, i2cDecode, i2cRegisterSteps, i2cSteps } from '../signals/buses'
import { ohmsPerMetre } from '../power/wiring'
import { FaultHunt, MeterRead } from './hunt'

const volt = (value: number): MeterRead => ({ value, unit: 'V' })
const ohm = (value: number): MeterRead => ({ value, unit: 'Ω' })
const OL: MeterRead = { value: Infinity, unit: 'Ω', open: true }
const line = (label: string): MeterRead => ({ value: 0, unit: 'log', label })
const memo = <K extends string, V>(f: (k: K) => V) => {
  const m = new Map<K, V>()
  return (k: K) => {
    let hit = m.get(k)
    if (!hit) m.set(k, (hit = f(k)))
    return hit
  }
}
const hunt = <F extends string, P extends string>(faults: Record<F, unknown>, probes: Record<P, unknown>, read: (f: F | 'ok', p: P) => MeterRead): FaultHunt<F, P> => ({
  faults: Object.keys(faults) as F[],
  probes: Object.keys(probes) as P[],
  read,
})
const hex2 = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`

/** The byte Wire puts on the bus for `address`: (address << 1) | R/W in 8 bits, so an 8-bit datasheet address loses its top bit. */
export const wireAddressByte = (address: number, read = false) => ((address * 2) % 256) + (read ? 1 : 0)

/** I²C bench: ESP32 DevKit at 3.3 V, SDA GPIO 21 / SCL GPIO 22, a 4.7 kΩ pair to 3V3 at the ESP32 (the breakouts' own
 *  pull-ups removed), an MPU-6050 (GY-521, AD0 pulled down on the board) on a 0.3 m 4-core lead or a 4 m one, optionally
 *  an SSD1306 OLED on the same bus. Capacitance: ESP32 pin 10 pF, breadboard 15 pF, 10 pF per breakout, 60 pF/m of cable
 *  (as the weather station). The firmware reads WHO_AM_I (0x75 → 0x68). Logic analyser and the MPU-6050 switch at I²C levels
 *  (0.3 / 0.7 VDD, hysteresis); 40 samples per quarter clock. Jumpers 20 cm of 26 AWG. */
export const BUS_BOT = {
  vdd: GPIO_VDD,
  pullOhms: 4.7e3,
  pf: { esp: 10, wiring: 15, board: 10, perM: 60 },
  shortM: 0.3,
  longM: 4,
  imu: chipAddress(I2C_CHIPS.mpu6050, 0),
  oled: chipAddress(I2C_CHIPS.ssd1306, 0),
  whoAmI: { reg: 0x75, value: 0x68 },
  datasheet8bit: 0xd0,
  perQ: 40,
  pad: { before: 4, after: 10 },
  jumper: { gauge: 26, m: 0.2 },
}

/** Bus capacitance (F) with `boards` breakouts on `cableM` of lead. */
export const busFarads = (cableM: number, boards: number) => {
  const p = BUS_BOT.pf
  return (p.esp + p.wiring + boards * p.board + p.perM * cableM) * 1e-12
}

/** One open-drain line, a level per quarter clock: low = a driver pulls toward VOL (fast), released = the pull-up charges
 *  the line (τ = R·C). `held` = something holds it low throughout. `perQ` samples per quarter; starts settled at VDD. */
export function openDrainVolts(levels: readonly Bit[], ohms: number, farads: number, perQ: number, quarterS: number, held = false, vdd = BUS_BOT.vdd) {
  const dt = quarterS / perQ
  const up = ohms * farads
  const down = ((ohms * SINK_OHMS) / (ohms + SINK_OHMS)) * farads
  const vLow = lowVolts(ohms, vdd)
  const out: number[] = []
  let v = held ? vLow : vdd
  for (const lv of levels) {
    const low = held || lv === 0
    for (let i = 0; i < perQ; i++) out.push((v = rcStep(v, low ? vLow : vdd, low ? down : up, dt)))
  }
  return out
}

/** Volts → bits at I²C input levels; the forbidden band keeps the last bit (hysteresis). */
export function i2cBits(volts: readonly number[], vdd = BUS_BOT.vdd): Bit[] {
  let last: Bit = 1
  return volts.map((v) => {
    const r = readInput(v, LOGIC_INPUTS.i2c, vdd)
    if (r !== null) last = r
    return last
  })
}

/** A bus build: pull-ups per line (Ω), capacitance, clock, and the target. `swap` = SDA/SCL crossed at the sensor;
 *  `held` = the sensor holds SDA low; `sensor` = the address it answers to (null: unpowered). */
export interface BusSetup {
  sclOhms: number
  sdaOhms: number
  farads: number
  hz: number
  sensor: number | null
  swap?: boolean
  held?: boolean
}

/** Analog SCL / SDA and the decode for quarter-clock `steps` (padded with idle). */
function capture(steps: { scl: Bit; sda: Bit }[], b: BusSetup) {
  const pad = (n: number) => Array.from({ length: n }, () => ({ scl: 1 as Bit, sda: 1 as Bit }))
  const all = [...pad(BUS_BOT.pad.before), ...steps, ...pad(BUS_BOT.pad.after)]
  const q = 1 / (4 * b.hz)
  const scl = openDrainVolts(all.map((s) => s.scl), b.sclOhms, b.farads, BUS_BOT.perQ, q)
  const sda = openDrainVolts(all.map((s) => s.sda), b.sdaOhms, b.farads, BUS_BOT.perQ, q, !!b.held)
  const sclBits = i2cBits(scl)
  const sdaBits = i2cBits(sda)
  return { scl, sda, sclBits, sdaBits, dt: q / BUS_BOT.perQ, events: fromStart(i2cDecode(sclBits, sdaBits)) }
}

/** An analyser decodes nothing before the first START. */
const fromStart = (ev: I2cEvent[]) => {
  const i = ev.findIndex((e) => e.kind === 'start')
  return i < 0 ? [] : ev.slice(i)
}

/** Short text for a decoded frame: the first address and its ACK, else what the analyser did see. */
export function frameText(events: readonly I2cEvent[]) {
  const i = events.findIndex((e) => e.kind === 'addr')
  if (i < 0) return events.some((e) => e.kind === 'start') ? 'START only' : 'no START'
  const reply = events[i + 1]
  return `${hex2(events[i].value)} ${reply?.kind === 'ack' ? 'ACK' : reply?.kind === 'nack' ? 'NACK' : '?'}`
}

/** Whether the sensor ACKs a call to `address`: it decodes the address byte from the lines as it sees them (crossed if `swap`). */
export function sensorAcks(address: number, b: BusSetup) {
  if (b.sensor === null || b.held) return false
  const c = capture(i2cSteps({ addr: address, data: [], ack: false }), b)
  const ev = b.swap ? fromStart(i2cDecode(c.sdaBits, c.sclBits)) : c.events
  const a = ev.find((e) => e.kind === 'addr')
  return !!a && a.value === b.sensor && !a.read
}

/** The firmware's WHO_AM_I read with `code` as the address it passes to Wire: what goes on the bus, as captured. */
export function busFrame(code: number, b: BusSetup) {
  const addr = Math.floor(wireAddressByte(code) / 2)
  const acks = sensorAcks(addr, b)
  const steps = acks ? i2cRegisterSteps(addr, BUS_BOT.whoAmI.reg, [BUS_BOT.whoAmI.value]) : i2cSteps({ addr, data: [], ack: false })
  const c = capture(steps, b)
  return { ...c, addr, acks, text: frameText(c.events) }
}

/** SCL rise time 30 → 70 % on a scope at `hz` (null: the line never reaches 70 % before the clock pulls it down again). */
export function sclRise(ohms: number, farads: number, hz: number, vdd = BUS_BOT.vdd) {
  return openDrainClock(hz, ohms, farads, vdd).top >= 0.7 * vdd ? i2cRiseTime(ohms, farads) : null
}

const nsRead = (s: number | null): MeterRead => (s === null ? { value: Infinity, unit: 'ns', open: true } : { value: s * 1e9, unit: 'ns' })
const jumperOhms = () => ohmsPerMetre(BUS_BOT.jumper.gauge) * BUS_BOT.jumper.m

// --- Wrong address: the IMU NACKs ---

export const ADDR_FAULTS = {
  ad0: { name: 'AD0 strapped high' },
  eight: { name: '8-bit address in code' },
  swap: { name: 'SDA / SCL swapped' },
  vcc: { name: 'IMU not powered' },
}
export type AddrFault = keyof typeof ADDR_FAULTS
export type AddrProbe = 'scan' | 'frame' | 'ad0' | 'vcc' | 'sda'
export const ADDR_PROBES: Record<AddrProbe, { name: string }> = {
  scan: { name: 'I²C scanner' },
  frame: { name: 'Analyser' },
  ad0: { name: 'AD0 pin' },
  vcc: { name: 'IMU VCC' },
  sda: { name: '21 ↔ IMU SDA' },
}

/** The short bus at 100 kHz (Wire's default) with an OLED beside the IMU, with `fault`. */
export function addrSetup(fault: AddrFault | 'ok'): BusSetup {
  const b = BUS_BOT
  return {
    sclOhms: b.pullOhms,
    sdaOhms: b.pullOhms,
    farads: busFarads(b.shortM, 2),
    hz: I2C_MODES.standard.hz,
    sensor: fault === 'vcc' ? null : chipAddress(I2C_CHIPS.mpu6050, fault === 'ad0' ? 1 : 0),
    swap: fault === 'swap',
  }
}

/** Wrong address with `fault`: the firmware's frame, the scanner's list and the readings. */
export const wrongAddress = memo((fault: AddrFault | 'ok') => {
  const b = BUS_BOT
  const s = addrSetup(fault)
  const frame = busFrame(fault === 'eight' ? b.datasheet8bit : b.imu, s)
  // The OLED sits on the right lines whatever the IMU's wiring; the scanner lists whoever ACKs an empty write.
  const imuAt = s.sensor
  const present = [b.oled, ...(imuAt !== null && sensorAcks(imuAt, s) ? [imuAt] : [])]
  const scan = i2cScan(present).found
  const reads: Record<AddrProbe, MeterRead> = {
    scan: line(scan.length ? scan.map(hex2).join(' ') : 'none'),
    frame: line(frame.text),
    ad0: volt(fault === 'ad0' ? b.vdd : 0),
    vcc: volt(fault === 'vcc' ? 0 : b.vdd),
    // Power off, crossed: GPIO 21 reaches the IMU's SDA pin only through both pull-ups via 3V3.
    sda: ohm(fault === 'swap' ? 2 * b.pullOhms + 2 * jumperOhms() : jumperOhms()),
  }
  return { setup: s, frame, scan, reads }
})

export const ADDR_HUNT = hunt(ADDR_FAULTS, ADDR_PROBES, (f, p) => wrongAddress(f).reads[p])

// --- Missing pull-ups: the bus dies at 400 kHz ---

export const PULL_FAULTS = {
  none: { name: 'Both pull-ups missing' },
  scl: { name: 'SCL pull-up missing' },
  cable: { name: '4 m cable at 400 kHz' },
  held: { name: 'IMU holds SDA low' },
}
export type PullFault = keyof typeof PULL_FAULTS
export type PullProbe = 'sda' | 'rSda' | 'rScl' | 'rise' | 'fast' | 'slow'
export const PULL_PROBES: Record<PullProbe, { name: string }> = {
  sda: { name: 'SDA idle' },
  rSda: { name: '3V3 ↔ SDA' },
  rScl: { name: '3V3 ↔ SCL' },
  rise: { name: 'SCL rise' },
  fast: { name: '400 kHz' },
  slow: { name: '100 kHz' },
}

/** The IMU-only bus at `hz` with `fault`: a missing resistor leaves the ESP32's internal 45 kΩ pull-up (on while powered). */
export function pullSetup(fault: PullFault | 'ok', hz: number): BusSetup {
  const b = BUS_BOT
  return {
    sclOhms: fault === 'none' || fault === 'scl' ? INTERNAL_PULL_OHMS : b.pullOhms,
    sdaOhms: fault === 'none' ? INTERNAL_PULL_OHMS : b.pullOhms,
    farads: busFarads(fault === 'cable' ? b.longM : b.shortM, 1),
    hz,
    sensor: b.imu,
    held: fault === 'held',
  }
}

/** Missing pull-ups with `fault`: frames at 400 and 100 kHz, the scope's SCL rise (at 100 kHz, where it completes) and the readings. */
export const missingPullups = memo((fault: PullFault | 'ok') => {
  const b = BUS_BOT
  const fastSetup = pullSetup(fault, I2C_MODES.fast.hz)
  const slowSetup = pullSetup(fault, I2C_MODES.standard.hz)
  const fast = busFrame(b.imu, fastSetup)
  const slow = busFrame(b.imu, slowSetup)
  const rise = sclRise(slowSetup.sclOhms, slowSetup.farads, slowSetup.hz)
  // Power off for Ω: the internal pull-ups are gone, so a missing resistor reads open.
  const rOff = (o: number) => (o === INTERNAL_PULL_OHMS ? OL : ohm(o))
  const reads: Record<PullProbe, MeterRead> = {
    sda: volt(fault === 'held' ? lowVolts(b.pullOhms) : b.vdd),
    rSda: rOff(fastSetup.sdaOhms),
    rScl: rOff(fastSetup.sclOhms),
    rise: nsRead(rise),
    fast: line(fast.text),
    slow: line(slow.text),
  }
  return { fastSetup, slowSetup, fast, slow, rise, reads }
})

export const PULL_HUNT = hunt(PULL_FAULTS, PULL_PROBES, (f, p) => missingPullups(f).reads[p])
