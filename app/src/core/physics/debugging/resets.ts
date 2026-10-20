// Random resets: brownouts on a shared pack when the motors start, and a weak 3.3 V regulator. Resets are transient, so
// the probes include MIN/MAX hold, a scope on the 3.3 V rail and esp_reset_reason().
import { mean, memoize } from '../common'
import { CHEMISTRIES } from '../power/batteries'
import { cellVolts } from '../power/packs'
import { TT_CRUISE_A } from '../power/budget'
import { TT_MOTOR } from '../actuators/dcmotor'
import { DRIVERS } from '../actuators/hbridge'
import { BrownoutRig, ESP32_BOD, ESP32_TIMELINE, brownoutRun } from '../power/brownout'
import { CAPS, Cap, railTrace } from '../power/noise'
import { loopOhms } from '../power/wiring'
import { AMS1117_33, ldoThermalStep, linearReg } from '../regulators'
import { ROOM_C } from '../dc'
import { MeterRead, huntOf, logRead, volt } from './hunt'

/** What `esp_reset_reason()` returns after the last reset (ESP_RST_…). */
type ResetReason = 'POWERON' | 'BROWNOUT' | 'PANIC' | 'TASK_WDT'

const kindReason = (k: string | undefined): ResetReason => (k === 'brownout' ? 'BROWNOUT' : k === 'panic' ? 'PANIC' : 'POWERON')

// --- Motor spike resets: 4 × AA → DRV8833 + four TT motors, and a Schottky + 10 mF hold-up into the DevKit's VIN ---

/** The 4WD car: 4 × AA alkaline at 70 % (150 mΩ cells + 0.35 Ω of holder springs), two TT motors per DRV8833 channel, a
 *  20 AWG lead 20 cm long (a thin one: 28 AWG, 1.5 m), a Schottky + 10 mF hold-up cap before the AMS1117, BOD level 0;
 *  the scope sees 1.2 s from 50 ms before the motors start (every 0.1 ms). A blocked loop trips the task watchdog after 5 s. */
export const SPIKE_BOT = {
  series: 4,
  motors: 4,
  soc: 0.7,
  flatSoc: 0.3,
  springOhms: 0.35,
  lead: { gauge: 20, m: 0.2 },
  thin: { gauge: 28, m: 1.5 },
  holdup: { farads: 10e-3, diodeV: 0.3 },
  tau: 0.05,
  pre: 0.05,
  window: 1.2,
  dt: 1e-4,
  wdtS: 5,
}
const AA = CHEMISTRIES.alkaline

export const SPIKE_FAULTS = {
  cap: { name: 'Hold-up cap missing' },
  lead: { name: 'Thin, long supply lead' },
  flat: { name: 'Run-down cells' },
  wdt: { name: 'Blocking ramp code' },
}
export type SpikeFault = keyof typeof SPIKE_FAULTS
export type SpikeProbe = 'rest' | 'lead' | 'vin' | 'rail' | 'scope' | 'reason'
export const SPIKE_PROBES: Record<SpikeProbe, { name: string }> = {
  rest: { name: 'Pack, motors off' },
  lead: { name: 'Lead drop, MAX' },
  vin: { name: 'VIN, MIN hold' },
  rail: { name: '3.3 V, DMM' },
  scope: { name: '3.3 V, scope' },
  reason: { name: 'Reset reason' },
}

/** Pack resistance (cells + springs) and the lead's loop resistance. */
export const spikeOhms = (thin = false) => {
  const l = thin ? SPIKE_BOT.thin : SPIKE_BOT.lead
  return { pack: SPIKE_BOT.series * AA.cell.ohms + SPIKE_BOT.springOhms, lead: loopOhms(l.gauge, l.m) }
}

/** `n` stalled motors in parallel, each behind a DRV8833 channel's R_on, from `ocv` through `srcOhms`: Ohm's law. */
export const stallBurstA = (ocv: number, n: number, srcOhms: number) => ocv / ((TT_MOTOR.ohms + DRIVERS.drv8833.drop(1)) / n + srcOhms)

/** The brownout rig with `fault` in the build: four TT motors starting hard from the shared pack. */
function spikeRig(fault: SpikeFault | 'ok'): BrownoutRig {
  const ocv = SPIKE_BOT.series * cellVolts(AA, fault === 'flat' ? SPIKE_BOT.flatSoc : SPIKE_BOT.soc)
  const r = spikeOhms(fault === 'lead')
  return {
    ocv,
    ohms: r.pack + r.lead,
    reg: AMS1117_33,
    bod: ESP32_BOD[0],
    stallA: stallBurstA(ocv, SPIKE_BOT.motors, r.pack + r.lead),
    cruiseA: SPIKE_BOT.motors * TT_CRUISE_A,
    rampS: 0,
    tau: SPIKE_BOT.tau,
    holdup: fault === 'cap' ? undefined : SPIKE_BOT.holdup,
  }
}

/** One motor start: the run, the pack's terminal volts and the lead drop per sample, the readings. */
export const motorSpike = memoize((fault: SpikeFault | 'ok') => {
  const rig = spikeRig(fault)
  const { lead } = spikeOhms(fault === 'lead')
  const run = brownoutRun(rig, SPIKE_BOT.window, SPIKE_BOT.dt, ESP32_TIMELINE.motorAt - SPIKE_BOT.pre)
  const amps = run.pack.map((v) => (rig.ocv - v) / rig.ohms)
  const terminals = amps.map((a) => rig.ocv - (rig.ohms - lead) * a)
  const leadDrop = amps.map((a) => a * lead)
  const resets = run.resets.length
  const why: ResetReason = fault === 'wdt' ? 'TASK_WDT' : kindReason(run.resets[0]?.kind)
  const reads: Record<SpikeProbe, MeterRead> = {
    rest: volt(terminals[0]),
    lead: volt(Math.max(...leadDrop), 'max'),
    vin: volt(Math.min(...run.vin), 'min'),
    rail: volt(mean(run.rail)),
    scope: volt(Math.min(...run.rail), 'min'),
    reason: logRead(why),
  }
  return { rig, run, terminals, leadDrop, resets, why, reads }
})

export const SPIKE_HUNT = huntOf(SPIKE_FAULTS, SPIKE_PROBES, (f, p) => motorSpike(f).reads[p])

// --- Weak regulator: the DevKit's AMS1117 feeding the ESP32 and 60 mA of sensors, VIN from a 5 V buck ---

/** The board: 60 mA of sensors on 3.3 V too; VIN from a 5 V buck (50 mΩ), or straight from 4 × AA alkaline at 20 %
 *  (650 mΩ), or a 3S Li-ion pack at 90 %. 3.3 V decoupling 10 µF + 100 nF (just the 100 nF when it's missing) behind
 *  ~1.5 µH of regulator response and trace; scope zoom 12 µs round the Wi-Fi start burst (every 2 ns), thermal run 120 s. */
export const WEAK_BOT = {
  sensorA: 0.06,
  buck: { volts: 5, ohms: 0.05 },
  aa: { series: 4, soc: 0.1, leadOhms: 0.05 },
  lipo: { series: 3, soc: 0.9, leadOhms: 0.05 },
  railHenries: 1.5e-6,
  railOhms: 0.05,
  strayF: 1e-9,
  caps: [CAPS.ceramic10u, CAPS.ceramic100n] as Cap[],
  bare: [CAPS.ceramic100n] as Cap[],
  zoomS: 12e-6,
  stepAt: 2e-6,
  riseS: 0.2e-6,
  every: 2e-9,
  thermalS: 120,
  thermalDt: 0.05,
  window: 2,
  dt: 2e-4,
}

export const WEAK_FAULTS = {
  low: { name: '4 × AA straight into VIN' },
  hot: { name: '3S pack into VIN: LDO cooks' },
  cap: { name: '3.3 V decoupling cap missing' },
  crash: { name: 'Firmware crash' },
}
export type WeakFault = keyof typeof WEAK_FAULTS
export type WeakProbe = 'vin' | 'rail' | 'scope' | 'heat' | 'reason'
export const WEAK_PROBES: Record<WeakProbe, { name: string }> = {
  vin: { name: 'VIN' },
  rail: { name: '3.3 V, DMM' },
  scope: { name: '3.3 V, scope' },
  heat: { name: 'Thermal camera' },
  reason: { name: 'Reset reason' },
}

/** VIN source with `fault`: rest volts and resistance. */
function weakSupply(fault: WeakFault | 'ok') {
  const pack = (chem: 'alkaline' | 'liion', p: { series: number; soc: number; leadOhms: number }) => {
    const c = CHEMISTRIES[chem]
    return { volts: p.series * cellVolts(c, p.soc), ohms: p.series * c.cell.ohms + p.leadOhms }
  }
  return fault === 'low' ? pack('alkaline', WEAK_BOT.aa) : fault === 'hot' ? pack('liion', WEAK_BOT.lipo) : WEAK_BOT.buck
}

/** ESP32 timeline with the sensors' current added to every phase. */
export const WEAK_TIMELINE = (() => {
  const t = ESP32_TIMELINE
  const s = WEAK_BOT.sensorA
  return { ...t, resetA: t.resetA + s, bootA: t.bootA + s, wifiA: t.wifiA + s, runA: t.runA + s, txA: t.txA + s }
})()

/** Rail deviation (V) after a load step `from` → `to` A, behind the regulator's response with `caps` on the rail. */
export function stepDip(from: number, to: number, caps: Cap[]) {
  const b = WEAK_BOT
  const load = (t: number) => (t < b.stepAt ? from : t < b.stepAt + b.riseS ? from + ((to - from) * (t - b.stepAt)) / b.riseS : to)
  const [v] = railTrace([{ vs: AMS1117_33.vout, ohms: b.railOhms, henries: b.railHenries, stray: b.strayF, caps }], [load], b.zoomS, b.every)
  return v.map((x, i) => x - (AMS1117_33.vout - b.railOhms * load(i * b.every)))
}

/** AMS1117 junction with `vin` and the average 3.3 V load: steps `ldoThermalStep` for 120 s; the second half gives the
 *  on-fraction (thermal shutdown cycling), the hottest junction, the cycle period, the first trip and on/off per step. */
export function ldoHeatRun(vin: number, amps: number) {
  const b = WEAK_BOT
  let s = { tj: ROOM_C, on: true }
  let peak = s.tj
  let onT = 0
  let firstTrip = Infinity
  const starts: number[] = []
  const on: boolean[] = []
  const n = Math.round(b.thermalS / b.thermalDt)
  for (let i = 0; i < n; i++) {
    const was = s.on
    s = ldoThermalStep(AMS1117_33, s, b.thermalDt, vin, amps)
    on.push(s.on)
    peak = Math.max(peak, s.tj)
    if (s.on && !was) starts.push(i * b.thermalDt)
    if (!s.on && was && firstTrip === Infinity) firstTrip = i * b.thermalDt
    if (i >= n / 2 && s.on) onT += b.thermalDt
  }
  const period = starts.length > 2 ? starts[starts.length - 1] - starts[starts.length - 2] : Infinity
  return { duty: onT / (b.thermalS / 2), peakC: peak, period, firstTrip, trips: firstTrip < Infinity, on }
}

/** The weak-regulator board with `fault`: the slow run (2 s from power-on), the TX-burst zoom, the junction, readings. */
export const weakRegulator = memoize((fault: WeakFault | 'ok') => {
  const b = WEAK_BOT
  const tl = WEAK_TIMELINE
  const sup = weakSupply(fault)
  const rig: BrownoutRig = { ocv: sup.volts, ohms: sup.ohms, reg: AMS1117_33, bod: ESP32_BOD[0], stallA: 0, cruiseA: 0, rampS: 0, tau: 1 }
  const run = brownoutRun(rig, b.window, b.dt, 0, tl)
  const vinAt = (a: number) => sup.volts - sup.ohms * (a + AMS1117_33.iq)
  const level = (a: number) => linearReg(AMS1117_33, vinAt(a), a).vout
  const dip = stepDip(tl.bootA, tl.wifiA, fault === 'cap' ? b.bare : b.caps)
  /** Scope zoom on the Wi-Fi start burst: the steady level for the load at each instant plus the regulator's transient. */
  const zoom = dip.map((d, i) => level(i * b.every < b.stepAt ? tl.bootA : tl.wifiA) + d)
  const avgA = tl.runA + ((tl.txA - tl.runA) * tl.txS) / tl.txEvery
  const heat = ldoHeatRun(vinAt(avgA), avgA)
  const tripped = heat.trips
  const zoomMin = Math.min(...zoom)
  const slow = run.resets.find((r) => r.kind !== 'poweron')
  const why: ResetReason = fault === 'crash' ? 'PANIC' : tripped || zoomMin < rig.bod ? 'BROWNOUT' : kindReason(slow?.kind)
  const railMin = tripped ? 0 : Math.min(zoomMin, ...run.rail.slice(Math.round(tl.bootS / b.dt)))
  const dmm = mean(run.rail.slice(Math.round((tl.bootS + tl.wifiS) / b.dt)))
  const reads: Record<WeakProbe, MeterRead> = {
    vin: volt(vinAt(avgA)),
    rail: tripped ? { value: AMS1117_33.vout, unit: 'V', alt: 0 } : volt(dmm),
    scope: volt(railMin, 'min'),
    heat: heat.peakC - ROOM_C < 2 ? { value: ROOM_C, unit: '°C', label: 'nothing' } : { value: heat.peakC, unit: '°C', label: 'AMS1117' },
    reason: logRead(why),
  }
  return { sup, rig, run, zoom, dip, avgA, heat, tripped, zoomMin, why, reads }
})

export const WEAK_HUNT = huntOf(WEAK_FAULTS, WEAK_PROBES, (f, p) => weakRegulator(f).reads[p])
