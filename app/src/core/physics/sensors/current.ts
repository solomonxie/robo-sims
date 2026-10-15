// Current & voltage sensing: shunt + amplifier + ADC, pack divider, INA219 registers, SoC from voltage vs coulomb counting.
import { clamp } from '../common'
import { dividerOut } from '../circuits'
import { MCP6002, saturate } from '../opamps'
import { lsb, quantize } from '../mcu/adc'
import { Chemistry } from '../power/batteries'
import { cellVolts } from '../power/packs'

const VDD = 3.3
const BITS = 12
const STEP = lsb(VDD, BITS)

export type ShuntSide = 'low' | 'high'

/** `amps` through an `ohms` shunt, amplified `gain`× (1 = wired straight in; a single-supply op-amp floors at ~25 mV) into a 12-bit 3.3 V ADC. Low side: the shunt sits at 0 V and lifts the
 *  load's ground by I·R. High side: it sits at `vbus`, beyond a 3.3 V op-amp's inputs, so it needs a current-sense amp. */
export function shuntSense(amps: number, ohms: number, gain: number, side: ShuntSide, vbus: number) {
  const vsh = amps * ohms
  const vout = gain === 1 ? Math.min(vsh, VDD) : saturate(MCP6002, gain * vsh, { vcc: VDD, vee: 0 })
  const code = quantize(vout, VDD, BITS)
  const scale = gain * ohms
  return {
    vsh,
    vout,
    clipped: vout < gain * vsh - 1e-9,
    floored: vout > gain * vsh + 1e-9,
    code,
    read: (code * STEP) / scale,
    perCount: STEP / scale,
    fullScale: (VDD - MCP6002.headroom) / scale,
    watts: amps * amps * ohms,
    commonMode: side === 'low' ? 0 : vbus - vsh,
    groundLift: side === 'low' ? vsh : 0,
  }
}

/** Pack voltage through an `r1` / `r2` divider into the ADC, scaled back up by firmware; `amps` is the divider's own drain. */
export function packDivider(vpack: number, r1: number, r2: number) {
  const vadc = dividerOut(vpack, r1, r2)
  const code = quantize(vadc, VDD, BITS)
  return { vadc, code, read: (code * STEP * (r1 + r2)) / r2, amps: vpack / (r1 + r2), clipped: vadc >= VDD }
}

/** TI INA219: 10 µV shunt LSB, 4 mV bus LSB, Cal = trunc(0.04096 / (Current_LSB × R)), Power_LSB = 20 × Current_LSB. */
export const INA219 = { addr: 0x40, shuntLsb: 10e-6, busLsb: 4e-3, calK: 0.04096, reg: { config: 0x00, shunt: 0x01, bus: 0x02, power: 0x03, current: 0x04, cal: 0x05 } }

/** Shunt PGA ranges (V) → PG bits. */
export const INA219_PGA = [0.04, 0.08, 0.16, 0.32]

/** CONFIG word: 32 V bus range, PGA, 12-bit shunt and bus ADC, continuous shunt + bus (0x399F at ±320 mV). */
export const ina219Config = (pga: number) => 0x2000 + Math.max(0, INA219_PGA.indexOf(pga)) * 0x800 + 0x180 + 0x18 + 0x7

export const ina219Cal = (currentLsb: number, ohms: number) => Math.trunc(INA219.calK / (currentLsb * ohms))

/** Register values for `amps` through an `ohms` shunt with the bus (VIN−) at `vbus`; `pga` = shunt range in volts (0.04 … 0.32). */
export function ina219Read(amps: number, vbus: number, ohms: number, pga: number, currentLsb: number) {
  const vsh = amps * ohms
  const top = Math.round(pga / INA219.shuntLsb)
  const shunt = clamp(Math.round(vsh / INA219.shuntLsb), -top, top)
  const shuntOvf = Math.abs(vsh) > pga
  const busCount = clamp(Math.round(vbus / INA219.busLsb), 0, 8191)
  const cal = ina219Cal(currentLsb, ohms)
  const rawCurrent = Math.trunc((shunt * cal) / 4096)
  const current = clamp(rawCurrent, -32768, 32767)
  const power = clamp(Math.trunc((current * busCount) / 5000), 0, 65535)
  const ovf = shuntOvf || current !== rawCurrent
  return {
    shunt,
    bus: busCount * 8 + 2 + (ovf ? 1 : 0),
    cal,
    current,
    power,
    ovf,
    shuntOvf,
    shuntV: shunt * INA219.shuntLsb,
    busV: busCount * INA219.busLsb,
    amps: current * currentLsb,
    watts: power * 20 * currentLsb,
  }
}

/** 16-bit register as an unsigned word (two's complement for negatives). */
export const regWord = (v: number) => ((v % 65536) + 65536) % 65536

/** State of charge a rested-cell table gives for `cellV` (inverse of the OCV curve, clamped to 0 … 1). */
export function socFromVolts(c: Chemistry, cellV: number): number {
  const pts = c.curve
  if (cellV <= pts[0][1]) return 0
  for (let i = 1; i < pts.length; i++) {
    const [s0, v0] = pts[i - 1]
    const [s1, v1] = pts[i]
    if (cellV <= v1) return s0 + ((s1 - s0) * (cellV - v0)) / (v1 - v0)
  }
  return 1
}

/** Per-cell polarisation (RC) on top of the ohmic sag: relaxes over minutes after the load stops. */
const POLARISATION = { ohms: 0.03, tau: 90 }

/** Drive cycle: `driveS` seconds driving at `driveA`, then `parkS` parked at `parkA`, repeating. */
export const DRIVE_CYCLE = { driveS: 360, parkS: 240 }
export function cycleAmps(t: number, driveA: number, parkA: number) {
  const u = t % (DRIVE_CYCLE.driveS + DRIVE_CYCLE.parkS)
  return u < DRIVE_CYCLE.driveS ? { amps: driveA, parked: 0 } : { amps: parkA, parked: u - DRIVE_CYCLE.driveS }
}

export interface SocRunOpts {
  chem: Chemistry
  series: number
  /** Real capacity (an aged pack has less) and what the firmware counts against. */
  mAh: number
  assumedMAh: number
  driveA: number
  parkA: number
  /** Current-sensor offset: the counter integrates amps + offset. */
  offsetA: number
  /** Re-anchor the counter to the voltage table once parked this long (0 = never). */
  recalS: number
  dt: number
}

export interface SocSample {
  t: number
  amps: number
  packV: number
  soc: number
  vSoc: number
  ccSoc: number
}

/** One drive from full until a cell under load hits cutoff (or the pack is empty): true SoC vs voltage lookup vs coulomb count. */
export function socRun(o: SocRunOpts): SocSample[] {
  const out: SocSample[] = []
  let soc = 1
  let cc = 1
  let vp = 0
  let anchored = false
  const r0 = o.chem.cell.ohms
  for (let t = 0; ; t += o.dt) {
    const { amps, parked } = cycleAmps(t, o.driveA, o.parkA)
    const cellV = cellVolts(o.chem, soc) - amps * r0 - vp
    const vSoc = socFromVolts(o.chem, cellV)
    if (o.recalS > 0 && parked >= o.recalS && !anchored) {
      cc = vSoc
      anchored = true
    }
    if (!parked) anchored = false
    out.push({ t, amps, packV: o.series * cellV, soc, vSoc, ccSoc: cc })
    if (cellV <= o.chem.cutoff || soc <= 0 || t > 86400) break
    soc -= (amps * o.dt) / (o.mAh * 3.6)
    cc -= ((amps + o.offsetA) * o.dt) / (o.assumedMAh * 3.6)
    vp += (amps * POLARISATION.ohms - vp) * (1 - Math.exp(-o.dt / POLARISATION.tau))
  }
  return out
}

/** Sample of a run at time `t` (held from the step before). */
