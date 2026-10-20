// Divider puzzles: shift a 5 V signal for an ESP32 pin, scale a battery into the ESP32 ADC's linear range.
import { loadedDivider } from '../circuits'
import { ESP32_ABS_MAX, LOGIC_INPUTS, riseTime, thresholds } from '../levels'
import { AttenKey, ESP32_ATTEN, calibratedVolts, esp32Raw } from '../mcu/adc'
import { sweep } from '../common'
import { puzzleVerdict, windowMiss } from './verdict'

export const DIVIDER_PUZZLE = {
  vin: 5,
  vdd: 3.3,
  /** Pin HIGH window: VIH + ~0.3 V margin … absolute max. */
  lo: 2.8,
  hi: ESP32_ABS_MAX,
  /** Gold-band resistors. */
  rTol: 0.05,
  /** Pin + wire capacitance. */
  pinF: 15e-12,
  /** Power burned in the divider while HIGH. */
  wasteW: 0.005,
}
const D = DIVIDER_PUZZLE
const EPS = 1e-9

/** What the tap feeds: a pin (no load) with an edge budget, or a module drawing current. */
export const DIVIDER_JOBS = {
  echo: { name: 'HC-SR04 echo → GPIO', load: Infinity, edgeS: 5.8e-6 },
  uart: { name: 'UART 115200 → RX', load: Infinity, edgeS: 0.1 / 115200 },
  module: { name: 'Power a 3.3 V module', load: 330, edgeS: Infinity },
}
export type DividerJob = keyof typeof DIVIDER_JOBS

type LogicFail = 'over' | 'low' | 'waste' | 'spread' | 'slow'

/** 5 V through R1 / R2 into the job's load: pin HIGH, tolerance corners, edge time to VIH, divider heat. */
export function shiftDivider(job: DividerJob, r1: number, r2: number) {
  const j = DIVIDER_JOBS[job]
  const s = loadedDivider(D.vin, r1, r2, j.load)
  const corners: [number, number] = [
    loadedDivider(D.vin, r1 * (1 + D.rTol), r2 * (1 - D.rTol), j.load).vout,
    loadedDivider(D.vin, r1 * (1 - D.rTol), r2 * (1 + D.rTol), j.load).vout,
  ]
  const { vih } = thresholds(LOGIC_INPUTS.esp32, D.vdd)
  const rth = 1 / (1 / s.sourceOhms + 1 / j.load)
  const tau = rth * D.pinF
  const edgeS = riseTime(vih, s.vout, tau)
  const wasteW = s.amps * s.amps * r1 + s.amps2 * s.amps2 * r2
  const now = windowMiss(s.vout, D.lo, D.hi)
  const spreadMiss = Math.max(windowMiss(corners[0], D.lo, D.hi).miss, windowMiss(corners[1], D.lo, D.hi).miss)
  const verdict = puzzleVerdict<LogicFail>([
    { id: 'over', ok: now.side <= 0, near: now.miss < 0.1 },
    { id: 'low', ok: now.side >= 0, near: s.vout >= vih },
    { id: 'waste', ok: wasteW <= D.wasteW, near: wasteW <= 2 * D.wasteW },
    { id: 'spread', ok: spreadMiss < EPS, near: spreadMiss < 0.05 },
    { id: 'slow', ok: edgeS <= j.edgeS, near: edgeS <= 2 * j.edgeS },
  ])
  return { ...s, corners, vih, rth, tau, edgeS, wasteW, verdict }
}

// --- ADC range matching ---

export const ADC_PUZZLE = {
  /** Top of the input should reach this share of the linear range. */
  use: 0.75,
  /** Always-on divider drain on a battery. */
  drainA: 100e-6,
  /** Source impedance the sampling cap tolerates without a pin cap. */
  sourceOhms: 10e3,
}
const A = ADC_PUZZLE

export const ADC_SOURCES = {
  cell1s: { name: 'Li-ion cell 3.0–4.2 V', range: [3, 4.2] as [number, number] },
  pack2s: { name: '2S pack 6.0–8.4 V', range: [6, 8.4] as [number, number] },
  lead12: { name: '12 V lead-acid 10.5–14.4 V', range: [10.5, 14.4] as [number, number] },
}
export type AdcSource = keyof typeof ADC_SOURCES

/** `vIn` through R1 / R2 onto an ESP32 ADC pin: pin volts, raw code, and the input firmware reconstructs (eFuse-calibrated). */
export function adcTapRead(vIn: number, r1: number, r2: number, atten: AttenKey) {
  const k = r2 / (r1 + r2)
  const vpin = vIn * k
  const raw = esp32Raw(vpin, atten)
  return { vpin, raw, readV: calibratedVolts(raw, atten) / k }
}

type AdcFail = 'abs' | 'clip' | 'toe' | 'range' | 'drain' | 'source'

/** Scale the source into the attenuation's linear lo…hi; keep the drain low and the source impedance low (or add a pin cap). */
export function adcMatch(source: AdcSource, r1: number, r2: number, atten: AttenKey, cap: boolean) {
  const [vLo, vHi] = ADC_SOURCES[source].range
  const a = ESP32_ATTEN[atten]
  const k = r2 / (r1 + r2)
  const pinLo = vLo * k
  const pinHi = vHi * k
  const drainA = vHi / (r1 + r2)
  const rth = (r1 * r2) / (r1 + r2)
  const worstErr = Math.max(...sweep(vLo, vHi, 25).map((v) => Math.abs(adcTapRead(v, r1, r2, atten).readV - v) / v))
  const dead = 0.5 * a.lo
  const verdict = puzzleVerdict<AdcFail>([
    { id: 'abs', ok: pinHi <= ESP32_ABS_MAX },
    { id: 'clip', ok: pinHi <= a.hi + EPS, near: pinHi <= a.full },
    { id: 'toe', ok: pinLo >= a.lo - EPS, near: pinLo > dead },
    { id: 'range', ok: pinHi >= A.use * a.hi, near: pinHi >= 0.5 * a.hi },
    { id: 'drain', ok: drainA <= A.drainA, near: drainA <= 2 * A.drainA },
    { id: 'source', ok: cap || rth <= A.sourceOhms, near: rth <= 2 * A.sourceOhms },
  ])
  return { k, pinLo, pinHi, drainA, rth, worstErr, window: [a.lo, a.hi] as [number, number], verdict }
}
