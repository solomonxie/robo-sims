import * as THREE from 'three/webgpu'
import { CAPS, Cap, Rail, bankOhms, decibels, lcCutoff, lcGain, noiseCounts, peakBins, pwmCurrent, railTrace } from '../../core/physics'
import { si, volts } from '../../core/units'
import { buildEsp32, buildL298n } from '../../models/modules'
import { buildCeramicCap, buildElectrolyticCap } from '../../models/passives'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  arcSpark,
  cableRun,
  cellPackModel,
  ceramicAlong,
  dcdcModule,
  emptyGroup,
  glide,
  glowBox,
  label,
  lane,
  lieFlat,
  motorCan,
  plusFlow,
  presence,
  pulseLabel,
  scope,
  standUp,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const V_RAIL = 5
const PERIOD = 50e-6
const PWM_AT = 5e-6
const RISE = 1e-6
const LOGIC_A = 0.1
const BROWNOUT = 3.5
const EVERY = 10e-9
const BINS = 260
const PLAY_S = 6
const HEAT = '#ff9a4d'
const SPARK = '#cfe3ff'
const mV = (v: number) => `${Math.round(v * 1000)} mV`

const wireRail = (caps: Cap[]): Rail => ({ vs: V_RAIL, ohms: 0.05, henries: 0.5e-6, stray: 47e-9, caps })
const motorAmps = (t: number, amps: number) => pwmCurrent(t - PWM_AT, amps, PERIOD, 0.5, RISE)
const SPIKE_S = 40e-9
/** The driver's switching spike: a 40 ns triangle of current at each turn-on edge. */
const edgeSpike = (t: number, amps: number) => {
  const u = ((((t - PWM_AT) % PERIOD) + PERIOD) % PERIOD) / SPIKE_S
  return u < 1 ? amps * (1 - Math.abs(2 * u - 1)) : 0
}
const span = (v: number[]) => Math.max(...v) - Math.min(...v)
/** ADC jitter for a 5 V sensor divided by 2 into the 3.3 V, 12-bit ADC: the rail's p-p rides on its output. */
const jitter = (pp: number) => noiseCounts(pp / 2, 3.3, 12)

/** Scope with `lines` traces over one window, a brownout line and a sim-time counter; `frame(dt)` sweeps a dot along them. */
function railScope(scene: THREE.Object3D, at: V3, w: number, h: number, lo: number, hi: number, colors: string[], title: string, tickVolts: number[]) {
  const plot = scope(scene, w, h, { divs: [12, 5], zeroAt: 0 })
  plot.group.position.set(...at)
  const y = (v: number) => ((v - lo) / (hi - lo)) * h - h / 2
  ticks(plot, [], tickVolts.map((v): [number, string] => [(v - lo) / (hi - lo), String(v)]), 0.5)
  add(plot.group, label(title, { size: 0.5, color: LABEL, align: 'left' }), [-w / 2, h / 2 + 1, 0])
  add(plot.group, label('µs', { size: 0.45, color: GREY, align: 'left' }), [w / 2 - 0.8, h / 2 + 1, 0])
  const clock = pulseLabel(plot.group, 3, LABEL, [w / 2 - 2.6, h / 2 + 1, 0], 0.6)
  const traces = colors.map((c) => plot.trace(c, { samples: BINS, radius: 0.07 }))
  if (BROWNOUT > lo) {
    plot.level(RING).set(y(BROWNOUT))
    add(plot.group, label(`BROWNOUT ${BROWNOUT} V`, { size: 0.38, color: RING, align: 'right' }), [w / 2 - 0.3, y(BROWNOUT) - 0.45, 0.2])
  }
  const st = { u: 0, data: [] as number[][] }
  return {
    set(data: number[][]) {
      st.data = data.map((d) => peakBins(d, BINS, d[0]))
      st.u = 0
    },
    /** Advances the sweep; returns 0..1 of the window. */
    frame(dt: number, window: number) {
      st.u = (st.u + dt / PLAY_S) % 1
      st.data.forEach((d, k) => traces[k].draw((u) => y(d[Math.min(BINS - 1, Math.round(u * (BINS - 1)))]), st.u))
      clock.show(String(Math.round(st.u * window * 1e6)))
      clock.frame(dt)
      return st.u
    },
  }
}

/** Buck → shared rail → ESP32 + L298N → motor, with flows on the rail; positions for extra parts. */
function bench(scene: THREE.Object3D) {
  const RAIL_Y = 7.6
  const ESP: V3 = [-5.6, 2.2, 0]
  const DRV: V3 = [4.8, 2.2, 0]
  const MOT: V3 = [12, 3.6, 0]
  const buck = dcdcModule(scene, [-13.6, 2.8, 0], 'lm2596', 0.2)
  add(scene, label('5 V BUCK', { size: 0.5, color: LABEL }), [-13.6, 5.6, 0])
  lieFlat(add(scene, buildEsp32(), ESP))
  add(scene, label('ESP32', { size: 0.5, color: B_FIELD }), [ESP[0], ESP[1] - 2.4, 0])
  lieFlat(add(scene, buildL298n(), DRV))
  add(scene, label('L298N', { size: 0.5, color: HEAT, align: 'left' }), [DRV[0] - 0.4, DRV[1] + 3.2, 0])
  const motor = motorCan(scene, MOT, { r: 1.9, legs: 0.6 })
  const pins = motor.pins.map((q): V3 => [q[0], q[1], 0])
  const out = buck.pins.outP
  const espV: V3 = [ESP[0] - 0.8, ESP[1] + 1.4, 0]
  const drvV: V3 = [DRV[0] - 1.2, DRV[1] + 2.2, 0]
  const feed: V3[] = [out, [out[0] + 1, out[1], 0], [out[0] + 1, RAIL_Y, 0], [drvV[0], RAIL_Y, 0], drvV]
  cableRun(scene, feed)
  cableRun(scene, [[espV[0], RAIL_Y, 0], espV])
  const drvOut: V3 = [DRV[0] + 2, DRV[1] + 0.2, 0]
  const [lowA, lowB] = [pins[0][1] - 1.4, pins[0][1] - 2.2]
  cableRun(scene, [drvOut, [drvOut[0] + 0.8, drvOut[1], 0], [drvOut[0] + 0.8, lowA, 0], [pins[0][0], lowA, 0], pins[0]], '#e0e0e0', 0.12)
  cableRun(scene, [[drvOut[0], drvOut[1] - 0.8, 0], [drvOut[0] + 0.3, drvOut[1] - 0.8, 0], [drvOut[0] + 0.3, lowB, 0], [pins[1][0], lowB, 0], pins[1]], '#e0e0e0', 0.12)
  const flow = plusFlow(scene, lane(feed, 0.5), () => 1)
  const { m: resetMat } = glowBox(scene, [5.4, 3.8, 0.4], [ESP[0], ESP[1], 1], HIGH_V, 0)
  const resetText = add(scene, label('RESET', { size: 0.8, color: '#ffffff' }), [ESP[0], ESP[1], 1.4])
  const st = { flash: 0 }
  return {
    RAIL_Y,
    ESP,
    DRV,
    MOT,
    motor,
    pins,
    /** Per frame: rail current for the flow speed, whether the ESP32 browned out this frame. */
    frame(dt: number, amps: number, browned: boolean) {
      flow.step(dt * Math.min(9, 0.4 + 2 * amps))
      motor.spin(dt, 300 * amps)
      st.flash = browned ? 1 : Math.max(0, st.flash - dt * 1.2)
      resetMat.opacity = 0.45 * st.flash
      resetText.visible = st.flash > 0.05
    },
  }
}

// --- Motor noise: brush arcs at commutation are fast current spikes; without a cap across the motor they land on the shared rail. ---

const ARC_AT = 18e-6
const ARC_S = 40e-9
const ARC_K = 3
const F_ARC = 10e6
const L_LEAD = 0.3e-6
const W1 = 60e-6
const SUPPRESS: Record<string, Cap[]> = { none: [], '10n': [CAPS.ceramic10n], '100n': [CAPS.ceramic100n] }

const solveMotor = (p: Params) => {
  const cap = (p.cap as string) in SUPPRESS ? (p.cap as string) : 'none'
  const amps = n(p, 'amps')
  const gain = lcGain(F_ARC, L_LEAD, 0.02, SUPPRESS[cap])
  const arc = (t: number) => (t >= ARC_AT && t < ARC_AT + ARC_S ? ARC_K * amps * gain : 0)
  const [v] = railTrace([wireRail([CAPS.bulk100u])], [(t) => LOGIC_A + motorAmps(t, amps) + arc(t)], W1, EVERY)
  const at = (t: number) => Math.round(t / EVERY)
  const near = v.slice(at(ARC_AT - 0.2e-6), at(ARC_AT + 1.5e-6))
  const before = v[at(ARC_AT - 0.2e-6)]
  return { cap, amps, gain, v, min: Math.min(...v), arcDip: Math.max(...near.map((x) => Math.abs(x - before))), pp: span(v) }
}

export const motorNoise: Lesson = {
  id: 'noise-decoupling-motor-noise',
  title: 'Motor noise',
  tagline: 'Every brush spark is a spike on the rail your ESP32 lives on',
  formula: (p) => {
    const s = solveMotor(p)
    return s.cap === 'none'
      ? `Brush arc: ≈ ${ARC_K} × I = ${si(ARC_K * s.amps, 'A', 2)} for 40 ns, straight into the shared rail → ${mV(s.arcDip)} spike`
      : `Cap across the motor: |Zc| / |jωL_lead + Zc| at 10 MHz = ${decibels(s.gain).toFixed(0)} dB, the arc is ÷ ${Math.round(1 / s.gain)} → ${mV(s.arcDip)}`
  },
  legend: [
    { color: B_FIELD, label: 'Rail at the ESP32 (scope)', shape: 'dot' },
    { color: RING, label: 'Brownout: below it the ESP32 may reset', shape: 'dot' },
    { color: SPARK, label: 'Brush arc at commutation', shape: 'dot' },
  ],
  points: [
    'A brushed motor switches its coils with sliding brushes. Each time a brush leaves a segment the coil’s current is cut and it arcs: a burst of current spikes lasting tens of nanoseconds.',
    'On a robot the motor driver and the ESP32 often share one 5 V rail. The spikes travel back along the motor leads onto that rail, and the ESP32 sees them on its supply.',
    'A big spike dips the rail under the brownout level and the ESP32 resets mid-move. Smaller ones make ADC readings jump: a 5 V sensor’s output rides on the rail.',
    'The fix starts at the source: a 100 nF ceramic soldered across the motor terminals. Its impedance at 10 MHz is a fraction of an ohm, so the spikes circulate in the motor and never reach the wires.',
    'Add two more from each terminal to the can for stubborn motors, and twist the motor leads so their loop radiates less.',
    'The PWM edges (every 50 µs at 20 kHz) are a separate, slower disturbance: bulk capacitors and separate rails deal with those. Time is slowed 100,000×; one arc is caught in the window.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'cap',
      options: [
        { value: 'none', label: 'No cap' },
        { value: '10n', label: '10 nF' },
        { value: '100n', label: '100 nF' },
      ],
      initial: 'none',
    },
    { kind: 'slider', key: 'amps', label: 'Motor current (PWM 20 kHz, 50 %)', min: 0.5, max: 3, initial: 2, step: 0.1, format: (v) => `${v.toFixed(1)} A` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const b = bench(scene)
    const [pa, pb] = b.pins
    const disc = add(scene, new THREE.Group(), [(pa[0] + pb[0]) / 2, pa[1] - 0.1, 1])
    const half = (pb[0] - pa[0]) / 2
    ceramicAlong(disc, [-half, 0, -1], [half, 0, -1], 0.55)
    const capText = add(scene, new THREE.Group(), [b.MOT[0] + 2.6, b.MOT[1] - 2.6, 0])
    const spark = arcSpark(scene, [b.MOT[0], b.MOT[1], 2])
    const sc = railScope(scene, [-1, -7.6, 0], 24, 5, 1.5, 7.5, [B_FIELD], 'SHARED 5 V RAIL AT THE ESP32', [2, 3.5, 5, 6.5])
    const st = { key: '', cap: '', s: solveMotor({ cap: 'none', amps: 2 }), shown: 0 }

    return {
      scene,
      view: { center: [-1, -0.8, 0], radius: 64, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.cap}|${p.amps}`
        if (key !== st.key) {
          st.key = key
          st.s = solveMotor(p)
          sc.set([st.s.v])
          if (st.s.cap !== st.cap) {
            st.cap = st.s.cap
            emptyGroup(capText)
            add(capText, label(st.cap === 'none' ? 'NO CAP' : st.cap === '10n' ? '10 NF' : '100 NF', { size: 0.45, color: st.cap === 'none' ? GREY : POWER, align: 'left' }))
          }
        }
        const s = st.s
        st.shown = glide(dt, st.shown, s.cap === 'none' ? 0 : 1, 8)
        presence(disc, st.shown)
        const u = sc.frame(dt, W1)
        const t = u * W1
        const k = Math.min(s.v.length - 1, Math.round(t / EVERY))
        const arcing = Math.abs(t - ARC_AT) < 1.5e-6
        const r = 1.2
        spark.set([b.MOT[0] - r, b.MOT[1] + 0.3, 2], [b.MOT[0] + r, b.MOT[1] - 0.3, 2], arcing ? (s.cap === 'none' ? 0.5 : 0.2) : 0)
        const lowSoFar = Math.min(...s.v.slice(Math.max(0, k - Math.round((dt / PLAY_S) * W1 / EVERY) - 1), k + 1))
        b.frame(dt, motorAmps(t, s.amps), lowSoFar < BROWNOUT)
      },
      readouts: () => {
        const s = st.s
        return [
          { label: 'Rail at the ESP32, lowest', value: `${volts(s.min)}${s.min < BROWNOUT ? ' · resets' : ''}`, tone: s.min < BROWNOUT ? 'bad' : s.min < 4.5 ? 'warn' : 'ok' },
          { label: 'Brush-arc spike on the rail', value: mV(s.arcDip), tone: s.arcDip > 0.5 ? 'bad' : s.arcDip > 0.1 ? 'warn' : 'ok' },
          { label: 'Cap across the motor, 10 MHz', value: s.cap === 'none' ? '0 dB · nothing there' : `${decibels(s.gain).toFixed(0)} dB` },
          { label: 'ADC jitter (5 V sensor ÷ 2)', value: `${jitter(s.pp)} counts p-p`, tone: jitter(s.pp) > 200 ? 'bad' : jitter(s.pp) > 40 ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Bulk capacitors: the PWM edge needs amps for microseconds (bulk), the driver's switching spike needs them for nanoseconds (ceramic). ---

const W2 = 30e-6
const BANKS: Record<string, { caps: Cap[]; label: string }> = {
  none: { caps: [], label: 'None' },
  ceramic: { caps: [CAPS.ceramic100n], label: '100 nF' },
  bulk: { caps: [CAPS.bulk470u], label: '470 µF' },
  both: { caps: [CAPS.bulk470u, CAPS.ceramic100n], label: 'Both' },
}

const solveBulk = (p: Params) => {
  const bank = (p.bank as string) in BANKS ? (p.bank as string) : 'none'
  const amps = n(p, 'amps')
  const caps = BANKS[bank].caps
  const [v] = railTrace([wireRail(caps)], [(t) => LOGIC_A + motorAmps(t, amps) + edgeSpike(t, amps)], W2, EVERY)
  const at = (t: number) => Math.round(t / EVERY)
  const base = v[at(PWM_AT - 0.1e-6)]
  const spike = Math.max(...v.slice(at(PWM_AT), at(PWM_AT + 0.4e-6)).map((x) => Math.abs(x - base)))
  return { bank, amps, caps, v, min: Math.min(...v), spike, pp: span(v), zLow: bankOhms(caps, 20e3), zHigh: bankOhms(caps, 10e6) }
}

const zText = (z: number) => (z === Infinity ? '∞' : si(z, 'Ω', 2))

export const bulkCapacitors: Lesson = {
  id: 'noise-decoupling-bulk-capacitors',
  title: 'Bulk capacitors',
  tagline: 'A big can for the slow gulps, a small ceramic for the fast ones',
  formula: (p) => {
    const s = solveBulk(p)
    return `|Z| = |ESR + j(ωESL − 1/ωC)|: ${zText(s.zLow)} at 20 kHz (PWM edge, µs), ${zText(s.zHigh)} at 10 MHz (switching spike, ns). Lower |Z| → smaller dip`
  },
  legend: [
    { color: B_FIELD, label: 'Rail at the driver and ESP32 (scope)', shape: 'dot' },
    { color: RING, label: 'Brownout level', shape: 'dot' },
    { color: POWER, label: 'Capacitors fitted', shape: 'dot' },
  ],
  points: [
    'When the PWM switches the motor on, 2 A is suddenly wanted. The 20 cm of wire back to the buck is about 0.5 µH: it can’t speed its current up that fast, so the rail sags and rings.',
    'A bulk electrolytic (100–1000 µF) right at the driver hands out those amps for the microseconds the wire needs. Its sag is about ESR × I: low-ESR types matter.',
    'But an electrolytic’s long foil and leads are ~15 nH: above a few hundred kHz it stops acting as a capacitor. The driver’s nanosecond switching spikes go straight past it.',
    'A 100 nF ceramic has ~1 nH and resonates near 16 MHz: the perfect sponge for the fast spikes, but far too little charge for the slow edge; alone it just rings with the wire.',
    'So fit both, side by side at the driver’s power pins: bulk for µs, ceramic for ns. Their |Z| curves overlap to stay low from kHz to tens of MHz.',
    'Rule of thumb: ~100 µF per amp of motor current, rated 1.5–2× the rail voltage. Time is slowed 100,000×.',
  ],
  controls: [
    { kind: 'choice', key: 'bank', options: Object.entries(BANKS).map(([value, b]) => ({ value, label: b.label })), initial: 'none' },
    { kind: 'slider', key: 'amps', label: 'Motor current step', min: 0.5, max: 3, initial: 2, step: 0.1, format: (v) => `${v.toFixed(1)} A` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const b = bench(scene)
    const x0 = b.DRV[0] - 5.6
    const bulk = standUp(scene, buildElectrolyticCap(), [x0, b.RAIL_Y - 0.1, 0], 0.7, true)
    const cer = standUp(scene, buildCeramicCap(), [x0 + 2.2, b.RAIL_Y - 0.1, 0], 0.7, true)
    const bulkText = add(scene, label('470 µF', { size: 0.42, color: POWER, align: 'right' }), [x0 - 1.1, b.RAIL_Y - 2.6, 0])
    const cerText = add(scene, label('100 NF', { size: 0.42, color: POWER }), [x0 + 2.2, b.RAIL_Y - 4.6, 0])
    const sc = railScope(scene, [-1, -7.6, 0], 24, 5, 1.5, 7.5, [B_FIELD], 'RAIL AT THE DRIVER', [2, 3.5, 5, 6.5])
    const st = { key: '', s: solveBulk({ bank: 'none', amps: 2 }), bulk: 0, cer: 0 }

    return {
      scene,
      view: { center: [-1, -0.8, 0], radius: 64, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.bank}|${p.amps}`
        if (key !== st.key) {
          st.key = key
          st.s = solveBulk(p)
          sc.set([st.s.v])
        }
        const s = st.s
        st.bulk = glide(dt, st.bulk, s.caps.includes(CAPS.bulk470u) ? 1 : 0, 8)
        st.cer = glide(dt, st.cer, s.caps.includes(CAPS.ceramic100n) ? 1 : 0, 8)
        presence(bulk, st.bulk)
        presence(cer, st.cer)
        bulkText.visible = st.bulk > 0.5
        cerText.visible = st.cer > 0.5
        const u = sc.frame(dt, W2)
        const t = u * W2
        const k = Math.min(s.v.length - 1, Math.round(t / EVERY))
        const back = Math.round(((dt / PLAY_S) * W2) / EVERY) + 1
        b.frame(dt, motorAmps(t, s.amps), Math.min(...s.v.slice(Math.max(0, k - back), k + 1)) < BROWNOUT)
      },
      readouts: () => {
        const s = st.s
        return [
          { label: 'Rail, lowest', value: `${volts(s.min)}${s.min < BROWNOUT ? ' · resets' : ''}`, tone: s.min < BROWNOUT ? 'bad' : s.min < 4.5 ? 'warn' : 'ok' },
          { label: 'Switching spike (first 400 ns)', value: mV(s.spike), tone: s.spike > 0.5 ? 'bad' : s.spike > 0.15 ? 'warn' : 'ok' },
          { label: '|Z| at 20 kHz · 10 MHz', value: `${zText(s.zLow)} · ${zText(s.zHigh)}` },
          { label: 'ADC jitter (5 V sensor ÷ 2)', value: `${jitter(s.pp)} counts p-p`, tone: jitter(s.pp) > 200 ? 'bad' : jitter(s.pp) > 40 ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Separate rails: the motor's rail is dirty by nature; give the logic its own, through an LC filter or its own regulator. ---

const W3 = 100e-6
const PREROLL = 400e-6
const L_FILTER = 10e-6
const FILTER_CAPS = [CAPS.bulk100u, CAPS.ceramic100n]
type Mode = 'shared' | 'lc' | 'separate'

const solveRails = (p: Params) => {
  const mode: Mode = p.mode === 'lc' || p.mode === 'separate' ? p.mode : 'shared'
  const amps = n(p, 'amps')
  const motor = (t: number) => motorAmps(t - PREROLL, amps) + edgeSpike(t - PREROLL, amps)
  const motorRail = wireRail([CAPS.bulk100u])
  const filter: Rail = { vs: 0, ohms: 0.05, henries: L_FILTER, stray: 100e-9, caps: FILTER_CAPS }
  const own = wireRail([CAPS.ceramic10u])
  const total = PREROLL + W3
  const [m, l] =
    mode === 'lc'
      ? railTrace([motorRail, filter], [motor, () => LOGIC_A], total, EVERY)
      : mode === 'shared'
        ? (([v]) => [v, v])(railTrace([motorRail], [(t) => motor(t) + LOGIC_A], total, EVERY))
        : [railTrace([motorRail], [motor], total, EVERY)[0], railTrace([own], [() => LOGIC_A], total, EVERY)[0]]
  const from = Math.round(PREROLL / EVERY)
  const [motorV, logicV] = [m.slice(from), l.slice(from)]
  return {
    mode,
    amps,
    motorV,
    logicV,
    motorPp: span(motorV),
    logicPp: span(logicV),
    gain: mode === 'lc' ? lcGain(20e3, L_FILTER, 0.05, FILTER_CAPS) : 1,
  }
}

export const separateRails: Lesson = {
  id: 'noise-decoupling-separate-rails',
  title: 'Separate rails',
  tagline: 'Let the motors have the dirty rail; give the logic a clean one',
  formula: (p) => {
    const s = solveRails(p)
    if (s.mode === 'lc') return `LC filter: f₀ = 1 / 2π√(LC) = ${si(lcCutoff(L_FILTER, CAPS.bulk100u.farads), 'Hz', 2)}; at 20 kHz it passes ${decibels(s.gain).toFixed(0)} dB, ×${s.gain.toFixed(3)}`
    if (s.mode === 'separate') return `Own regulator from the pack: the ESP32 rail only sees its own ${si(LOGIC_A, 'A', 2)}; motor and logic grounds meet at the pack − (star)`
    return `Shared: the ESP32 sits on the motor’s node, so it gets all ${mV(s.motorPp)} p-p of the PWM ripple and spikes`
  },
  legend: [
    { color: HEAT, label: 'Motor rail', shape: 'dot' },
    { color: B_FIELD, label: 'ESP32 rail', shape: 'dot' },
    { color: RING, label: 'Brownout level', shape: 'dot' },
  ],
  points: [
    'However well decoupled, a motor rail carries the PWM’s ripple: amps switching on and off 20,000 times a second through ESR and wire. That is fine for the motor, not for an ADC.',
    'An LC filter (series inductor, then a capacitor to ground) passes DC and blocks anything above its corner f₀ = 1 / 2π√(LC), falling 40 dB per decade. 10 µH + 100 µF ≈ 5 kHz.',
    'A ferrite bead is the lossy little cousin: it barely affects DC and kHz, but turns MHz noise into heat. Use one with a 100 nF after it to stop radio-frequency hash, not PWM ripple.',
    'The cleanest fix is a separate regulator for the logic, fed straight from the pack, and the two grounds joined only at the pack − (star ground).',
    'A big motor stall can still sag the pack itself; that’s the next topic, brownouts. A diode + bulk cap before the logic regulator rides through short sags.',
    'Time is slowed 100,000×: two PWM periods fill the screen.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'shared', label: 'Shared' },
        { value: 'lc', label: 'LC filter' },
        { value: 'separate', label: 'Own buck' },
      ],
      initial: 'shared',
    },
    { kind: 'slider', key: 'amps', label: 'Motor current (PWM 20 kHz, 50 %)', min: 0.5, max: 3, initial: 2, step: 0.1, format: (v) => `${v.toFixed(1)} A` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const RAIL_Y = 7.6
    const PACK: V3 = [-17, 2.4, 0]
    const r = 0.6
    const pack = cellPackModel(scene, 2, 1, { r, dx: 2.4 * r })
    pack.group.position.set(...PACK)
    add(scene, label('2S', { size: 0.5, color: LABEL, align: 'right' }), [PACK[0] - 1.4, PACK[1], 0])
    const plus: V3 = [pack.plus[0] + PACK[0], pack.plus[1] + PACK[1], 0]
    const mBuck = dcdcModule(scene, [-9.6, 5.4, 0], 'lm2596', 0.18)
    add(scene, label('MOTOR BUCK', { size: 0.42, color: HEAT }), [-9.6, 8, 0])
    const inX = mBuck.pins.inP[0] - 1
    cableRun(scene, [plus, [plus[0], RAIL_Y + 1.4, 0], [inX, RAIL_Y + 1.4, 0], [inX, mBuck.pins.inP[1], 0], mBuck.pins.inP])
    const ESP: V3 = [3.4, -0.8, 0]
    const DRV: V3 = [6.6, 4.4, 0]
    const MOT: V3 = [13, 5.2, 0]
    lieFlat(add(scene, buildL298n(), DRV))
    add(scene, label('L298N', { size: 0.45, color: HEAT, align: 'left' }), [DRV[0] + 2.6, DRV[1] + 2.2, 0])
    const motor = motorCan(scene, MOT, { r: 1.3, legs: 0.5 })
    cableRun(scene, [[DRV[0] + 2, DRV[1] + 0.2, 0], [MOT[0] - 1.6, DRV[1] + 0.2, 0]], '#e0e0e0', 0.12)
    lieFlat(add(scene, buildEsp32(), ESP))
    add(scene, label('ESP32', { size: 0.45, color: B_FIELD, align: 'left' }), [ESP[0] + 2.8, ESP[1], 0])
    const out = mBuck.pins.outP
    const drvV: V3 = [DRV[0] - 1.2, DRV[1] + 2.2, 0]
    const motorFeed: V3[] = [out, [out[0] + 0.8, out[1], 0], [out[0] + 0.8, RAIL_Y, 0], [drvV[0], RAIL_Y, 0], drvV]
    cableRun(scene, motorFeed)
    const espV: V3 = [ESP[0] - 0.8, ESP[1] + 1.4, 0]
    const TAP_X = -2.6
    const LOGIC_Y = 2.2

    const shared = add(scene, new THREE.Group())
    const sharedFeed: V3[] = [[TAP_X, RAIL_Y, 0], [TAP_X, LOGIC_Y, 0], [espV[0], LOGIC_Y, 0], espV]
    cableRun(shared, sharedFeed)

    const lc = add(scene, new THREE.Group())
    const coilAt: V3 = [TAP_X, 5, 0.4]
    cableRun(lc, [[TAP_X, RAIL_Y, 0], [TAP_X, coilAt[1] + 1, 0]])
    cableRun(lc, [[TAP_X, coilAt[1] - 1, 0], ...sharedFeed.slice(1)])
    const coil = add(lc, new THREE.Group(), coilAt)
    add(coil, mesh(new THREE.TorusGeometry(0.85, 0.42, 14, 40), new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.4 })))
    add(lc, label('10 µH', { size: 0.4, color: LABEL, align: 'right' }), [TAP_X - 1.6, coilAt[1], 0])
    standUp(lc, buildElectrolyticCap(), [TAP_X + 1.6, LOGIC_Y, 0], 0.5)
    standUp(lc, buildCeramicCap(), [TAP_X + 3.4, LOGIC_Y, 0], 0.5)
    add(lc, label('100 µF + 100 NF', { size: 0.36, color: LABEL }), [TAP_X + 2.4, LOGIC_Y - 1, 0])

    const sep = add(scene, new THREE.Group())
    const lBuck = dcdcModule(sep, [-9.6, -0.8, 0], 'lm2596', 0.18)
    add(sep, label('LOGIC BUCK', { size: 0.42, color: B_FIELD }), [-9.6, 1.9, 0])
    const j: V3 = [plus[0], plus[1] + 0.8, 0]
    cableRun(sep, [j, [inX - 0.6, j[1], 0], [inX - 0.6, lBuck.pins.inP[1], 0], lBuck.pins.inP])
    const lo = lBuck.pins.outP
    const sepFeed: V3[] = [lo, [lo[0] + 0.8, lo[1], 0], [lo[0] + 0.8, LOGIC_Y, 0], [espV[0], LOGIC_Y, 0], espV]
    cableRun(sep, sepFeed)

    const motorFlow = plusFlow(scene, lane(motorFeed, 0.5), () => 1)
    const flows = { shared: plusFlow(shared, lane(sharedFeed, 0.5), () => 1), lc: plusFlow(lc, lane(sharedFeed.slice(1), 0.5), () => 1), separate: plusFlow(sep, lane(sepFeed, 0.5), () => 1) }
    const sc = railScope(scene, [-1, -7.8, 0], 24, 5, 3.5, 6.5, [HEAT, B_FIELD], 'MOTOR RAIL AND ESP32 RAIL', [4, 5, 6])
    const st = { key: '', mode: '' as Mode | '', s: solveRails({ mode: 'shared', amps: 2 }) }

    return {
      scene,
      view: { center: [-2, -0.6, 0], radius: 62, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.mode}|${p.amps}`
        if (key !== st.key) {
          st.key = key
          st.s = solveRails(p)
          sc.set([st.s.motorV, st.s.logicV])
          if (st.s.mode !== st.mode) {
            st.mode = st.s.mode
            shared.visible = st.mode === 'shared'
            lc.visible = st.mode === 'lc'
            sep.visible = st.mode === 'separate'
          }
        }
        const s = st.s
        const u = sc.frame(dt, W3)
        const a = motorAmps(u * W3, s.amps)
        motorFlow.step(dt * Math.min(9, 0.4 + 2 * a))
        flows[s.mode].step(dt * 0.6)
        motor.spin(dt, 300 * a)
      },
      readouts: () => {
        const s = st.s
        const counts = jitter(s.logicPp)
        return [
          { label: 'Motor rail ripple', value: `${mV(s.motorPp)} p-p` },
          { label: 'ESP32 rail ripple', value: `${mV(s.logicPp)} p-p`, tone: s.logicPp > 0.3 ? 'bad' : s.logicPp > 0.05 ? 'warn' : 'ok' },
          { label: 'Path to the ESP32 at 20 kHz', value: s.mode === 'separate' ? 'own regulator' : `${decibels(s.gain).toFixed(0)} dB` },
          { label: 'ADC jitter (5 V sensor ÷ 2)', value: `${counts} counts p-p`, tone: counts > 200 ? 'bad' : counts > 40 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
