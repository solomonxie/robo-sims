import * as THREE from 'three/webgpu'
import {
  ADC_PUZZLE,
  ADC_SOURCES,
  AdcSource,
  AttenKey,
  DIVIDER_JOBS,
  DIVIDER_PUZZLE,
  DividerJob,
  ESP32_ABS_MAX,
  ESP32_ATTEN,
  adcMatch,
  adcTapRead,
  shiftDivider,
} from '../../core/physics'
import { E12, E24 } from '../../core/resistorColors'
import { fixedText, ohms, pct, si, volts } from '../../core/units'
import { V3 } from '../../models/kit'
import { FACE_VIEW, GAUGE_CAPTION_Y, HIGH_V, LABEL, POWER, RING, dividerBench, liveLabel, memoBy, puzzleStage, verdictTint, windowGauge } from '../fx'
import { Lesson, Params, Stage, namesOf, opts, pick, seriesOhms, seriesSlider, toneOf, verdictReadout } from '../types'

// --- Shared layout: divider bench on the left, three gauges on the right. ---

const BENCH = { x0: -15.5, xd: -10.5, xt: -5, top: 2.6, tap: -2.6, bottom: -9.2 }
const GX = 8
const GW = 7.6
const GY = [1.4, -3, -7.4]
const D = DIVIDER_PUZZLE
const AP = ADC_PUZZLE
const LEGEND = [
  { color: POWER, label: 'Target window / pass', shape: 'dot' as const },
  { color: RING, label: 'Close miss', shape: 'dot' as const },
  { color: HIGH_V, label: 'Fail / absolute limit', shape: 'dot' as const },
  { color: LABEL, label: 'Voltmeter across the tap', shape: 'dot' as const },
]
const watts = (w: number) => si(w, 'W', 2)
const errPct = (f: number) => `${fixedText(f * 100, 1)} %`
const time = (s: number) => (Number.isFinite(s) ? si(s, 's', 2) : 'never')
const liveCaption = (scene: THREE.Object3D, y: number) => liveLabel(scene, [GX - GW / 2, y + GAUGE_CAPTION_Y, 0.2], { size: 0.3, align: 'left' })
const tagAt = (scene: THREE.Object3D, at: V3) => liveLabel(scene, at, { size: 0.3, align: 'left' })

// --- 3.3 V from 5 V: pick R1 / R2 so a 5 V HIGH lands safely in the ESP32's window, fast and cool. ---

const JOB_NAMES = namesOf(DIVIDER_JOBS)
const shParams = (p: Params) => ({ job: pick(JOB_NAMES, p.job, 'echo') as DividerJob, r1: seriesOhms(p, 'r1', E12), r2: seriesOhms(p, 'r2', E12) })
type ShQ = ReturnType<typeof shParams>
const shSolve = memoBy((q: ShQ) => `${q.job}|${q.r1}|${q.r2}`, (q: ShQ) => shiftDivider(q.job, q.r1, q.r2))
const inWindow = (v: number) => v >= D.lo && v <= D.hi
const pinTint = (v: number, vih: number) => verdictTint(inWindow(v), v >= vih && v <= D.hi * 1.1)

export const dividerPuzzles3v3From5v: Lesson = {
  id: 'divider-puzzles-3-3-v-from-5-v',
  title: '3.3 V from 5 V',
  tagline: 'Pick two E12 resistors that bring a 5 V signal safely into an ESP32 pin: in the window, worst case, fast and cool',
  formula: (p) => {
    const q = shParams(p)
    const s = shSolve(q)
    const load = DIVIDER_JOBS[q.job].load
    const bottom = Number.isFinite(load) ? `R2 ∥ ${ohms(load)}` : 'R2'
    return `V_pin = 5 V × ${bottom} / (R1 + ${bottom}) = ${volts(s.vout)} · τ = R_th × 15 pF = ${time(s.tau)} · P = ${watts(s.wasteW)} · goal 2.8–3.6 V`
  },
  legend: LEGEND,
  points: [
    'The puzzle: a 5 V part (HC-SR04 echo, an Arduino’s TX) drives an ESP32 input, which is not 5 V tolerant: absolute max 3.6 V. Pick R1 (top) and R2 (bottom) from E12 so the pin HIGH lands in 2.8–3.6 V, VIH (2.48 V) plus a 0.3 V noise margin (Digital › Level shifting › Logic thresholds).',
    'Start from the ratio: V_pin = 5 × R2 / (R1 + R2), so R2 ≈ 2 × R1 gives 3.33 V. 10 k over 22 k gives 3.44 V (Electricity › Voltage divider › The divider formula).',
    'Then check the worst case: gold-band parts are ±5 %, and the two errors can stack. Aim near the middle of the window, not at an edge.',
    'Size sets the trade. The divider burns 5 V² / (R1 + R2) while the line is HIGH, so small values waste power; the pin’s ~15 pF charges through R1 ∥ R2, so big values round the edges. An echo pulse is slow (1 mm of range = 5.8 µs); UART at 115200 needs edges under a tenth of a bit, 0.87 µs (Digital › Level shifting › Divider shifter).',
    'Now try powering a 3.3 V module from it. Its 10 mA sits in parallel with R2 and drags the tap down; stiff enough values burn more than the module uses. A divider shifts signals, it doesn’t supply power: use a regulator (Electricity › Voltage divider › Loading a divider).',
  ],
  controls: [
    { kind: 'choice', key: 'job', options: opts(JOB_NAMES), initial: 'echo' },
    seriesSlider('r1', 'R1, top (E12)', E12, 100, 2.2e6, 10e3),
    seriesSlider('r2', 'R2, bottom (E12)', E12, 100, 2.2e6, 10e3),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const bench = dividerBench(scene, { ...BENCH, vmax: 5, fullA: 0.001 })
    tagAt(scene, [BENCH.x0 - 1.2, BENCH.top + 0.8, 0.3]).set('5 V HIGH in', LABEL)
    const loadTag = tagAt(scene, [BENCH.xt - 0.3, BENCH.tap + 0.9, 0.3])
    const vG = windowGauge(scene, [GX, GY[0], 0], GW, {
      min: 0,
      max: 5,
      window: [D.lo, D.hi],
      caption: 'Pin HIGH (bar = ±5 % worst case)',
      marks: [[2.475, 'VIH', RING], [D.hi, 'max', HIGH_V]],
      ticks: [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5 V']],
    })
    const eG = windowGauge(scene, [GX, GY[1], 0], GW, {
      min: 1e-8,
      max: 1e-4,
      log: true,
      window: [1e-8, 1e-4],
      caption: '',
      ticks: [[1e-8, '10 ns'], [1e-7, '100 ns'], [1e-6, '1 µs'], [1e-5, '10 µs'], [1e-4, '100 µs']],
    })
    const eCap = liveCaption(scene, GY[1])
    const wG = windowGauge(scene, [GX, GY[2], 0], GW, {
      min: 1e-4,
      max: 0.1,
      log: true,
      window: [1e-4, D.wasteW],
      caption: 'Divider heat while HIGH (≤ 5 mW)',
      ticks: [[1e-4, '0.1'], [1e-3, '1'], [1e-2, '10'], [0.1, '100 mW']],
    })
    const st = { job: '' }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = shParams(p)
        const s = shSolve(q)
        const j = DIVIDER_JOBS[q.job]
        const module = q.job === 'module'
        if (q.job !== st.job) {
          st.job = q.job
          bench.setLoad(module ? { kind: 'R', ohms: j.load } : { kind: 'C' })
          loadTag.set(module ? '3.3 V module ≈ 330 Ω' : 'ESP32 pin ≈ 15 pF', LABEL)
          eG.setWindow(1e-8, Math.min(j.edgeS, 1e-4))
          eCap.set(module ? 'Edge time (no budget: it’s power)' : `Edge to VIH (≤ ${time(j.edgeS)})`, LABEL)
        }
        bench.setR1(q.r1)
        bench.setR2(q.r2)
        bench.set(D.vin, s.vout)
        bench.step(dt, s.amps, s.amps2, s.loadAmps)
        bench.meter.display.set(fixedText(s.vout, 2))
        vG.set(s.vout, volts(s.vout), pinTint(s.vout, s.vih), s.corners)
        const slow = !module && s.edgeS > j.edgeS
        eG.set(Math.min(s.edgeS, 1e-4), time(s.edgeS), verdictTint(!slow, s.edgeS <= 2 * j.edgeS))
        wG.set(s.wasteW, watts(s.wasteW), verdictTint(s.wasteW <= D.wasteW, s.wasteW <= 2 * D.wasteW))
        const v = s.verdict
        const why = {
          over: `${volts(s.vout)} is over the ESP32’s 3.6 V absolute max. Bigger R1 or smaller R2`,
          low: module
            ? `The module’s ${si(s.loadAmps, 'A', 2)} drags the tap to ${volts(s.vout)}. A divider can’t power it: use a regulator`
            : s.vout >= s.vih
              ? `${volts(s.vout)} just reads HIGH, under 0.3 V of margin over VIH. Raise R2 a step`
              : `${volts(s.vout)} is below VIH (${volts(s.vih)}): the pin may read 0. Bigger R2`,
          spread: `5 % parts swing it ${volts(s.corners[0])} … ${volts(s.corners[1])}, out of 2.8–3.6 V. Aim nearer 3.2 V`,
          slow: `A ${ohms(s.rth)} source into 15 pF: edges take ${time(s.edgeS)} to reach VIH. Smaller resistors`,
          waste: module
            ? `It burns ${watts(s.wasteW)} in the resistors to feed the module. Use a 3.3 V regulator`
            : `The divider burns ${watts(s.wasteW)} while HIGH, over 5 mW. Bigger resistors, same ratio`,
        }
        header.set(
          module ? 'feed a 3.3 V module (10 mA) from 5 V with two resistors' : `bring a 5 V ${q.job === 'uart' ? 'UART line' : 'echo pulse'} into an ESP32 pin at 2.8–3.6 V`,
          v,
          v.fail ? why[v.fail] : `${volts(s.vout)} HIGH, ${volts(s.corners[0])} … ${volts(s.corners[1])} worst case, ${time(s.edgeS)} edge: wire it`,
          'Hint: R2 / (R1 + R2) ≈ 3.3 / 5, so R2 ≈ 2 × R1',
        )
      },
      readouts: (p) => {
        const q = shParams(p)
        const s = shSolve(q)
        const j = DIVIDER_JOBS[q.job]
        return [
          { label: 'Pin HIGH', value: volts(s.vout), tone: toneOf(inWindow(s.vout), s.vout >= s.vih && s.vout <= D.hi * 1.1) },
          { label: 'Worst case', value: `${fixedText(s.corners[0], 2)} … ${volts(s.corners[1])}`, tone: toneOf(inWindow(s.corners[0]) && inWindow(s.corners[1]), true) },
          { label: 'Edge → VIH', value: time(s.edgeS), tone: q.job === 'module' ? undefined : toneOf(s.edgeS <= j.edgeS, s.edgeS <= 2 * j.edgeS) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- ADC range matching: scale a battery into the ESP32 ADC's linear range with a divider and the right attenuation. ---

const SOURCE_NAMES = namesOf(ADC_SOURCES)
const ATTEN_NAMES = Object.fromEntries(
  (Object.keys(ESP32_ATTEN) as AttenKey[]).map((k) => [k, `${k} dB (${fixedText(ESP32_ATTEN[k].lo, 2)}–${fixedText(ESP32_ATTEN[k].hi, 2)} V)`]),
) as Record<AttenKey, string>
const CAPS = { none: 'No pin cap', cap: '100 nF on the pin' }
const amParams = (p: Params) => ({
  src: pick(SOURCE_NAMES, p.src, 'pack2s') as AdcSource,
  atten: pick(ATTEN_NAMES, p.atten, '11') as AttenKey,
  r1: seriesOhms(p, 'r1', E24),
  r2: seriesOhms(p, 'r2', E24),
  cap: pick(CAPS, p.cap, 'none') === 'cap',
})
type AmQ = ReturnType<typeof amParams>
const amSolve = memoBy((q: AmQ) => `${q.src}|${q.atten}|${q.r1}|${q.r2}|${q.cap}`, (q: AmQ) => adcMatch(q.src, q.r1, q.r2, q.atten, q.cap))
const SWEEP_S = 8

export const dividerPuzzlesAdcRangeMatching: Lesson = {
  id: 'divider-puzzles-adc-range-matching',
  title: 'ADC range matching',
  tagline: 'Scale a battery into the ESP32 ADC’s linear range with E24 resistors and the right attenuation, without draining it',
  formula: (p) => {
    const q = amParams(p)
    const m = amSolve(q)
    const [vLo, vHi] = ADC_SOURCES[q.src].range
    return `k = R2 / (R1 + R2) = ${fixedText(m.k, 3)}: ${volts(vLo)} … ${volts(vHi)} → ${volts(m.pinLo)} … ${volts(m.pinHi)} vs linear ${volts(m.window[0])} … ${volts(m.window[1])} · drain ${si(m.drainA, 'A', 2)} · R1 ∥ R2 = ${ohms(m.rth)}`
  },
  legend: [...LEGEND.slice(0, 3), { color: LABEL, label: 'Battery span on the pin (bar)', shape: 'dot' }],
  points: [
    'The puzzle: the ESP32 should read its own battery. The battery is far above 3.3 V, so a divider scales it down, and the whole span (empty … full) must land in the ADC’s linear range for the attenuation you pick.',
    'The original ESP32 ADC bends at both ends: dead near 0 V, flat near the top. Espressif’s calibration (eFuse Vref) is only exact between lo and hi, e.g. 0.15–2.45 V at 11 dB (Microcontrollers › ADC › ESP32 ADC quirks).',
    'Use the range: put full charge near the top (≥ 75 % of hi) so each count means fewer millivolts of battery, but keep it under hi or the reading flattens and reads low (Microcontrollers › ADC › Resolution and range).',
    'The divider is always on, so it drains the battery: under 100 µA means big resistors. But the ADC charges a sampling capacitor from the tap, and a source over ~10 kΩ can’t refill it in time, so readings sag and drift (Electricity › Voltage divider › Divider as a sensor input).',
    'The fix for both: big resistors plus a 100 nF cap from the pin to ground. The cap holds the tap still and hands the sampler its charge; the battery voltage changes far slower than its τ = (R1 ∥ R2) · C.',
  ],
  controls: [
    { kind: 'choice', key: 'src', options: opts(SOURCE_NAMES), initial: 'pack2s' },
    { kind: 'choice', key: 'atten', options: opts(ATTEN_NAMES), initial: '11' },
    seriesSlider('r1', 'R1, top (E24)', E24, 1e3, 1e6, 47e3),
    seriesSlider('r2', 'R2, bottom (E24)', E24, 1e3, 1e6, 27e3),
    { kind: 'choice', key: 'cap', options: opts(CAPS), initial: 'none' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const bench = dividerBench(scene, { ...BENCH, vmax: 14.4, fullA: 100e-6 })
    const srcTag = tagAt(scene, [BENCH.x0 - 1.2, BENCH.top + 0.8, 0.3])
    tagAt(scene, [BENCH.xt - 0.3, BENCH.tap + 0.9, 0.3]).set('ESP32 ADC pin', LABEL)
    const readTag = tagAt(scene, [BENCH.xd + 0.8, BENCH.top + 0.8, 0.3])
    const pG = windowGauge(scene, [GX, GY[0], 0], GW, {
      min: 0,
      max: 3.8,
      window: [0.15, 2.45],
      caption: 'ADC pin: linear range, battery span',
      marks: [[ESP32_ABS_MAX, 'max', HIGH_V]],
      ticks: [[0, '0'], [1, '1'], [2, '2'], [3, '3 V']],
    })
    const dG = windowGauge(scene, [GX, GY[1], 0], GW, {
      min: 1e-6,
      max: 1e-2,
      log: true,
      window: [1e-6, AP.drainA],
      caption: 'Battery drain, always on (≤ 100 µA)',
      ticks: [[1e-6, '1 µA'], [1e-5, '10'], [1e-4, '100'], [1e-3, '1 mA'], [1e-2, '10 mA']],
    })
    const sG = windowGauge(scene, [GX, GY[2], 0], GW, {
      min: 100,
      max: 1e6,
      log: true,
      window: [100, AP.sourceOhms],
      caption: '',
      ticks: [[100, '100'], [1e3, '1k'], [1e4, '10k'], [1e5, '100k'], [1e6, '1 MΩ']],
    })
    const sCap = liveCaption(scene, GY[2])
    const st = { key: '', cap: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = amParams(p)
        const m = amSolve(q)
        const a = ESP32_ATTEN[q.atten]
        const [vLo, vHi] = ADC_SOURCES[q.src].range
        const key = `${q.src}|${q.atten}`
        if (key !== st.key) {
          st.key = key
          srcTag.set(`battery ${volts(vLo)} … ${volts(vHi)}`, LABEL)
          pG.setWindow(a.lo, a.hi)
        }
        const capKey = String(q.cap)
        if (capKey !== st.cap) {
          st.cap = capKey
          bench.setLoad(q.cap ? { kind: 'C' } : null)
          sG.setWindow(100, q.cap ? 1e6 : AP.sourceOhms)
          sCap.set(q.cap ? 'Source impedance (the cap feeds it)' : 'Source impedance (≤ 10 kΩ, or a cap)', LABEL)
        }
        st.t = (st.t + dt) % SWEEP_S
        const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * st.t) / SWEEP_S)
        const vIn = vHi - (vHi - vLo) * u
        const r = adcTapRead(vIn, q.r1, q.r2, q.atten)
        const ia = vIn / (q.r1 + q.r2)
        bench.setR1(q.r1)
        bench.setR2(q.r2)
        bench.set(vIn, r.vpin)
        bench.step(dt, ia, ia, 0)
        bench.meter.display.set(fixedText(r.vpin, 2))
        const err = (r.readV - vIn) / vIn
        readTag.set(`raw ${r.raw} → reads ${fixedText(r.readV, 2)} V of ${fixedText(vIn, 2)} V`, verdictTint(Math.abs(err) < 0.01, Math.abs(err) < 0.05))
        const pinOk = r.vpin >= a.lo && r.vpin <= a.hi
        pG.set(r.vpin, volts(r.vpin), verdictTint(pinOk, r.vpin <= a.full), [m.pinLo, m.pinHi])
        dG.set(m.drainA, si(m.drainA, 'A', 2), verdictTint(m.drainA <= AP.drainA, m.drainA <= 2 * AP.drainA))
        sG.set(m.rth, ohms(m.rth), verdictTint(q.cap || m.rth <= AP.sourceOhms, m.rth <= 2 * AP.sourceOhms))
        const v = m.verdict
        const why = {
          abs: `Full charge puts ${volts(m.pinHi)} on the pin, over the 3.6 V absolute max. Bigger R1`,
          clip: `Full charge puts ${volts(m.pinHi)} on the pin, over ${volts(a.hi)}: the top bends, reads up to ${errPct(m.worstErr)} off. Bigger R1 or more dB`,
          toe: `Empty is only ${volts(m.pinLo)} on the pin, under ${volts(a.lo)}: the ADC’s dead toe. Smaller R1 or fewer dB`,
          range: `Full charge reaches only ${pct(m.pinHi / a.hi)} of the linear range: wasted counts. Bigger R2 or fewer dB`,
          drain: `The divider drains ${si(m.drainA, 'A', 2)} from the battery all the time. Scale both resistors up`,
          source: `A ${ohms(m.rth)} source is too weak to refill the sampler in time. Add the 100 nF cap`,
        }
        header.set(
          `read a ${volts(vLo)} … ${volts(vHi)} battery inside the ADC’s linear range at ${q.atten} dB`,
          v,
          v.fail ? why[v.fail] : `${volts(m.pinLo)} … ${volts(m.pinHi)} on the pin, ${si(m.drainA, 'A', 2)} drain, worst error ${errPct(m.worstErr)}: wire it`,
          `Hint: k = R2 / (R1 + R2) ≈ ${fixedText(0.9 * a.hi, 2)} V / ${volts(vHi)}`,
        )
      },
      readouts: (p) => {
        const q = amParams(p)
        const m = amSolve(q)
        return [
          { label: 'Pin span', value: `${fixedText(m.pinLo, 2)} … ${volts(m.pinHi)}`, tone: toneOf(m.verdict.fail !== 'abs' && m.verdict.fail !== 'clip' && m.verdict.fail !== 'toe', m.verdict.fail !== 'abs') },
          { label: 'Worst error', value: errPct(m.worstErr), tone: toneOf(m.worstErr < 0.01, m.worstErr < 0.05) },
          { label: 'Drain', value: si(m.drainA, 'A', 2), tone: toneOf(m.drainA <= AP.drainA, m.drainA <= 2 * AP.drainA) },
          verdictReadout(m.verdict),
        ]
      },
    }
  },
}
