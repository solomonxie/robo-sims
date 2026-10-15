import * as THREE from 'three/webgpu'
import { FilterKind, decibels, rcAsymptote, rcCutoff, rcGain, rcPhase, rcSteadyCycle, rcTau } from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, hertz, millivolts, ohms, pct, si, tiny, volts } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HIGH_V,
  LABEL,
  RING,
  acSource,
  ceramicAlong,
  emptyGroup,
  frac,
  glide,
  glowMat,
  groundAt,
  junction,
  label,
  peakToPeak,
  presence,
  pulseLabel,
  resistorAlong,
  scope,
  wire,
} from '../fx'
import { Control, Lesson, Params, Stage, n } from '../types'

const FARADS = 1e-6
const VDD = 3.3
const CYCLE_S = 1.2
const SAMPLES = 1024
const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
const sin = (c: number) => Math.sin(2 * Math.PI * c)

const rSlider: Control = { kind: 'slider', key: 'r', label: 'Resistor R (C = 1 µF)', min: 1e3, max: 1e5, initial: 1e4, log: true, format: (v) => ohms(nearestE12(v)) }
const fSlider = (max: number, initial: number): Control => ({ kind: 'slider', key: 'f', label: 'Signal frequency f', min: 1, max, initial, step: 0.01, log: true, format: hertz })

/** Reads a settled cycle (sample k at cycle (k + 1) / N) at any `cycles`, interpolated. */
function cycleAt(v: number[], cycles: number) {
  const x = frac(cycles) * v.length - 1
  const i = Math.floor(x)
  const a = v[(i + v.length) % v.length]
  const b = v[(i + 1) % v.length]
  return a + (b - a) * (x - i)
}

// --- Signals: what the source puts in. Two-part ones keep their parts apart, so each part's survival can be measured. ---

const NOISE = Array.from({ length: 14 }, (_, k) => ({ k: 17 + 2 * k + (k % 3), a: 0.09 + 0.07 * frac(Math.sin(k * 12.9898) * 43758.5), ph: k * 2.4 }))
const noise = (c: number) => NOISE.reduce((s, h) => s + h.a * Math.sin(2 * Math.PI * h.k * c + h.ph), 0)
const knock = (c: number) => 1.3 * Math.exp(-(((frac(c) - 0.62) / 0.007) ** 2))

interface Mode {
  label: string
  wave: (c: number) => number
  parts?: { names: [string, string]; waves: [(c: number) => number, (c: number) => number] }
}

const MODES: Record<FilterKind, Record<string, Mode>> = {
  low: {
    sine: { label: 'Sine', wave: (c) => 1.65 + 1.5 * sin(c) },
    pwm: { label: 'PWM 30 %', wave: (c) => (frac(c) < 0.3 ? VDD : 0) },
    noisy: {
      label: 'Noisy sensor',
      wave: (c) => 1.65 + sin(c) + noise(c),
      parts: { names: ['Signal kept', 'Noise left'], waves: [(c) => 1.65 + sin(c), noise] },
    },
  },
  high: {
    sine: { label: 'Sine on 1.65 V', wave: (c) => 1.65 + 1.5 * sin(c) },
    square: { label: 'Square', wave: (c) => (frac(c) < 0.5 ? VDD : 0) },
    bump: {
      label: 'Bump sensor',
      wave: (c) => 1.65 + 0.8 * sin(c) + knock(c),
      parts: { names: ['Tilt left', 'Knock kept'], waves: [(c) => 1.65 + 0.8 * sin(c), knock] },
    },
  },
}

const modeOf = (kind: FilterKind, p: Params) => (String(p.signal) in MODES[kind] ? String(p.signal) : 'sine')

function solve(kind: FilterKind, mode: string, f: number, r: number) {
  const fc = rcCutoff(r, FARADS)
  const tau = rcTau(r, FARADS)
  const m = MODES[kind][mode]
  const { input, output } = rcSteadyCycle(kind, m.wave, f, tau, SAMPLES)
  const kept = m.parts?.waves.map((w) => {
    const c = rcSteadyCycle(kind, w, f, tau, SAMPLES)
    return peakToPeak(c.output) / peakToPeak(c.input)
  })
  return { kind, mode, m, f, r, fc, tau, input, output, kept, gain: rcGain(kind, f, fc), phase: rcPhase(kind, f, fc) }
}
type Solved = ReturnType<typeof solve>
const solveParams = (kind: FilterKind, p: Params) => solve(kind, modeOf(kind, p), n(p, 'f'), nearestE12(n(p, 'r')))

/** Signal source → series part → node → shunt part to ground, out on the right. Low-pass: R then C; high-pass: C then R. */
function rcCircuit(parent: THREE.Object3D, at: V3, kind: FilterKind, scale = 1) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const W = 8
  const H = 6.4
  const top = H / 2
  const NX = 2
  const series: [V3, V3] = [[-2.6, top, 0], [1.24, top, 0]]
  const shunt: [V3, V3] = [[NX, 2.3, 0], [NX, -1.54, 0]]
  wire(group, [[-W / 2, 1.25, 0], [-W / 2, top, 0], series[0]])
  wire(group, [series[1], [W / 2, top, 0]])
  wire(group, [[NX, top, 0], shunt[0]])
  wire(group, [shunt[1], [NX, -top, 0]])
  wire(group, [[-W / 2, -1.25, 0], [-W / 2, -top, 0], [W / 2, -top, 0]])
  add(group, acSource(1.2), [-W / 2, 0, 0])
  groundAt(group, [-1, -top, 0])
  const inNode = junction(group, [-W / 2, top, 0], 0.5)
  const outNode = junction(group, [W / 2, top, 0], 0.6)
  junction(group, [NX, top, 0], 0.32).set(0.5)
  junction(group, [W / 2, -top, 0], 0.4).set(0)
  add(group, label('IN', { size: 0.8, color: HIGH_V, align: 'right' }), [-W / 2 - 0.8, top + 0.9, 0])
  add(group, label('OUT', { size: 0.8, color: B_FIELD, align: 'left' }), [W / 2 + 0.9, top, 0])
  add(group, label('0 V', { size: 0.6, color: GREY, align: 'left' }), [W / 2 + 0.7, -top, 0])
  const rHolder = add(group, new THREE.Group())
  const [rAt, cAt] = kind === 'low' ? [series, shunt] : [shunt, series]
  ceramicAlong(group, cAt[0], cAt[1], 1.5)
  const cText: V3 = kind === 'low' ? [NX + 1.9, 0.4, 0] : [-0.7, top + 2.1, 0]
  add(group, label('C 1 µF', { size: 0.6, color: LABEL, align: kind === 'low' ? 'left' : 'center' }), cText)
  let shownR = 0
  return {
    group,
    setR(r: number) {
      if (r === shownR) return
      shownR = r
      emptyGroup(rHolder)
      resistorAlong(rHolder, r, rAt[0], rAt[1])
      const text = `R ${ohms(r).toUpperCase()}`
      if (kind === 'low') add(rHolder, label(text, { size: 0.6 }), [-0.7, top + 1.5, 0])
      else add(rHolder, label(text, { size: 0.6, align: 'left' }), [NX + 1.2, 0.4, 0])
    },
    setIn: (v: number) => inNode.set(v / VDD),
    setOut: (v: number) => outNode.set(kind === 'low' ? v / VDD : 0.5 + v / (2 * VDD)),
  }
}

// --- RC low-pass and high-pass: the same two parts, swapped. Live scope of in and out, timebase slowed to one cycle per 1.2 s. ---

const SC_X = 4.6
const SC_W = 14.4
const SC_H = 9.6
const CIRCUIT_X = -12.6

function filterLesson(kind: FilterKind, meta: Omit<Lesson, 'build' | 'controls' | 'legend' | 'formula'>, initial: string): Lesson {
  const low = kind === 'low'
  const zeroAt = low ? 0.1 : 0.5
  const perV = low ? (SC_H * 0.84) / VDD : (SC_H * 0.46) / VDD
  const toY = (v: number) => v * perV + (zeroAt - 0.5) * SC_H
  const extras = (s: Solved) => {
    if (s.mode === 'sine') {
      const lag = Math.abs(s.phase) / (2 * Math.PI * s.f)
      return [
        { label: 'Gain |H|', value: `× ${+s.gain.toPrecision(2)} · ${decibels(s.gain).toFixed(1)} dB`, tone: s.gain > 0.7 ? ('ok' as const) : undefined },
        { label: low ? 'Phase lag' : 'Phase lead', value: `${deg(s.phase)} · ${si(lag, 's', 2)}` },
      ]
    }
    if (s.mode === 'pwm') {
      const ripple = peakToPeak(s.output)
      return [
        { label: 'Average out', value: volts(mean(s.output)), tone: 'ok' as const },
        { label: 'Ripple p-p', value: millivolts(ripple), tone: ripple < 0.1 ? ('ok' as const) : ('warn' as const) },
      ]
    }
    if (s.mode === 'square') {
      const peak = Math.max(...s.output)
      const sag = 1 - s.output[SAMPLES / 2 - 2] / peak
      return [
        { label: 'Edge peak', value: volts(peak), tone: 'ok' as const },
        { label: 'Sag by next edge', value: pct(sag), tone: sag > 0.5 ? ('warn' as const) : undefined },
      ]
    }
    const [a, b] = s.kept!
    const names = s.m.parts!.names
    return [
      { label: names[0], value: pct(a), tone: (low ? a > 0.8 : a < 0.3) ? ('ok' as const) : ('warn' as const) },
      { label: names[1], value: pct(b), tone: (low ? b < 0.3 : b > 0.6) ? ('ok' as const) : ('warn' as const) },
    ]
  }

  return {
    ...meta,
    formula: (p) => {
      const s = solveParams(kind, p)
      const h = low ? '1 / √(1 + (f/fc)²)' : '(f/fc) / √(1 + (f/fc)²)'
      return `fc = 1 / 2πRC = 1 / (2π × ${ohms(s.r)} × 1 µF) = ${hertz(s.fc)} · at ${hertz(s.f)}: |H| = ${h} = ${s.gain.toFixed(2)}`
    },
    legend: [
      { color: HIGH_V, label: 'Input from the source', shape: 'dot' },
      { color: B_FIELD, label: low ? 'Output across C' : 'Output across R', shape: 'dot' },
      { color: RING, label: 'Output peaks / average', shape: 'dot' },
    ],
    controls: [
      { kind: 'choice', key: 'signal', options: Object.entries(MODES[kind]).map(([value, m]) => ({ value, label: m.label })), initial },
      fSlider(1000, low ? 10 : 30),
      rSlider,
    ],
    build(): Stage {
      const scene = createStage({ span: 22 })
      const circuit = rcCircuit(scene, [CIRCUIT_X, 0.6, 0], kind)
      const fcLabel = pulseLabel(scene, 3, RING, [CIRCUIT_X - 0.4, -5.2, 0], 1.2)
      add(scene, label('FC', { size: 0.8, color: RING, align: 'right' }), [CIRCUIT_X - 3, -5.2, 0])
      add(scene, label('HZ', { size: 0.8, color: RING, align: 'left' }), [CIRCUIT_X + 2.2, -5.2, 0])
      const screen = scope(scene, SC_W, SC_H, { divs: [10, 8], zeroAt })
      screen.group.position.set(SC_X, 0, 0)
      const inTrace = screen.trace(HIGH_V, { samples: 480, radius: 0.1 })
      const outTrace = screen.trace(B_FIELD, { samples: 480, radius: 0.14 })
      const marks = [screen.level(RING), screen.level(RING)]
      add(scene, label('2 CYCLES', { size: 0.55, color: GREY }), [SC_X, -SC_H / 2 - 1.3, 0])

      const st = { cyc: 0, logF: 0, logR: 0, key: '', s: null as Solved | null }
      return {
        scene,
        view: { center: [-3, 0.4, 0], radius: 59, polar: 1.42, azimuth: 0.08 },
        frame(dt, p) {
          const mode = modeOf(kind, p)
          const target = { f: Math.log10(n(p, 'f')), r: Math.log10(nearestE12(n(p, 'r'))) }
          if (!st.s) Object.assign(st, { logF: target.f, logR: target.r })
          st.logF = glide(dt, st.logF, target.f, 6)
          st.logR = glide(dt, st.logR, target.r, 6)
          const key = `${mode}|${st.logF.toFixed(4)}|${st.logR.toFixed(4)}`
          if (key !== st.key || !st.s) {
            st.key = key
            st.s = solve(kind, mode, 10 ** st.logF, 10 ** st.logR)
          }
          const s = st.s
          st.cyc += dt / CYCLE_S
          circuit.setR(nearestE12(n(p, 'r')))
          inTrace.scroll((c) => toY(cycleAt(s.input, c)), st.cyc, 2)
          outTrace.scroll((c) => toY(cycleAt(s.output, c)), st.cyc, 2)
          const mid = low ? 1.65 : 0
          const amp = 1.5 * s.gain
          if (mode === 'sine') {
            marks[0].set(toY(mid + amp))
            marks[1].set(toY(mid - amp))
          } else if (mode === 'pwm') {
            marks[0].set(toY(mean(s.output)))
            marks[1].set(1e3)
          } else for (const m of marks) m.set(1e3)
          circuit.setIn(cycleAt(s.input, st.cyc))
          circuit.setOut(cycleAt(s.output, st.cyc))
          fcLabel.show(fitDigits(s.fc, 3))
          fcLabel.frame(dt)
        },
        readouts: (p) => {
          const s = solveParams(kind, p)
          return [
            { label: 'Cutoff fc', value: `${hertz(s.fc)} · f = ${+(s.f / s.fc).toPrecision(2)} fc` },
            ...extras(s),
            { label: 'Time slowed', value: `${+(s.f * CYCLE_S).toPrecision(2)}×` },
          ]
        },
      }
    },
  }
}

export const rcLowPass = filterLesson(
  'low',
  {
    id: 'filters-rc-low-pass',
    title: 'RC low-pass',
    tagline: 'Let the slow through, soak up the fast',
    points: [
      'A resistor feeds a capacitor; the output is the voltage across C. The cap needs time to charge through R, so it can follow slow changes but not fast ones.',
      'That time is τ = RC. The corner, where the output has dropped to 71 % (−3 dB), is fc = 1 / 2πRC: 10 kΩ with 1 µF gives 16 Hz.',
      'Well below fc the output copies the input. Above it, each 10× in frequency cuts it 10× more, and it lags behind, up to a quarter cycle.',
      'PWM to analog: a 30 % PWM pin averaged by an RC gives 0.3 × 3.3 V ≈ 1 V. Pick fc far below the PWM frequency or a ripple rides on top: try 490 Hz, Arduino’s PWM.',
      'Noisy sensor: motor hash on an analog line is far faster than what the sensor measures. Put fc between them and the noise drains into C. The same smoothing in code: y += α(x − y).',
      'The scope always shows two cycles; time is slowed so each takes 1.2 s.',
    ],
  },
  'sine',
)

export const highPass = filterLesson(
  'high',
  {
    id: 'filters-high-pass',
    title: 'High-pass',
    tagline: 'Block the steady part, pass the changes',
    points: [
      'Swap the parts: C in series, R to ground, output across R. A capacitor blocks DC, so only changes get through.',
      'Same corner fc = 1 / 2πRC, mirrored: above fc the signal passes; below it, each 10× lower in frequency cuts it 10×. The output leads the input, up to a quarter cycle.',
      'A sine riding on 1.65 V comes out centred on 0 V: the steady 1.65 V sits on the capacitor. That’s AC coupling, how audio and microphone inputs drop their offset.',
      'A square wave passes its edges, then sags back toward 0 as C charges. Raise fc (smaller R) and only spikes at the edges are left: an edge detector.',
      'Bump sensor: an accelerometer reads gravity and slow tilt plus a sharp knock when the robot hits something. A high-pass drops the tilt and keeps the knock.',
      'The scope always shows two cycles; time is slowed so each takes 1.2 s.',
    ],
  },
  'sine',
)

// --- Bode plot: gain in dB against log frequency, a straight line past the corner; phase underneath. ---

const DECADES = 4
const B_X = -5
const B_W = 18
const B_Y = 3
const B_H = 8
const DB_TOP = 10
const DB_RANGE = 70
const P_Y = -5.8
const P_H = 3.6
const M_X = 11.4
const M_Y = 3.6
const M_W = 8.4
const M_H = 6.2
const uOf = (f: number) => Math.log10(f) / DECADES
const fOf = (u: number) => 10 ** (u * DECADES)

const bodeKind = (p: Params): FilterKind => (p.kind === 'high' ? 'high' : 'low')
const solveBode = (p: Params) => {
  const kind = bodeKind(p)
  const f = n(p, 'f')
  const r = nearestE12(n(p, 'r'))
  const fc = rcCutoff(r, FARADS)
  const gain = rcGain(kind, f, fc)
  return { kind, f, r, fc, gain, db: tiny(decibels(gain), 0.05), phase: rcPhase(kind, f, fc), x: f / fc }
}

export const bodePlot: Lesson = {
  id: 'filters-bode-plot',
  title: 'Bode plot',
  tagline: 'The whole filter on one chart',
  formula: (p) => {
    const s = solveBode(p)
    return `Gain = 20 log₁₀|H| = 20 log₁₀(${s.gain.toFixed(3)}) = ${s.db.toFixed(1)} dB at ${hertz(s.f)}; fc = ${hertz(s.fc)}, phase ${deg(s.phase)}`
  },
  legend: [
    { color: B_FIELD, label: 'Gain, dB; output on the scope', shape: 'dot' },
    { color: RING, label: 'Corner fc, −3 dB, 45°', shape: 'dot' },
    { color: HIGH_V, label: 'Phase; input on the scope', shape: 'dot' },
  ],
  points: [
    'A Bode plot draws the gain for every frequency at once. Frequency goes along a log axis, each grid line 10× the last; gain in decibels, 20 log₁₀ |Vout / Vin|.',
    'On those axes an RC filter is two straight lines (grey): flat at 0 dB, then falling 20 dB per decade past the corner. The real curve rounds the bend, 3 dB down right at fc.',
    'The dot is the slider frequency, and the small scope shows that sine going in and coming out. −20 dB is ×0.1, −40 dB is ×0.01.',
    'The phase plot below: a low-pass slides from 0° to −90° lag, a high-pass from +90° lead to 0°. At fc it’s exactly halfway, 45°.',
    'Choosing fc for a robot: a line sensor changes at about 10 Hz, PWM hash sits at 490 Hz. fc = 30 Hz keeps the signal at −0.5 dB and cuts the PWM by 24 dB.',
    'Need a steeper cut? Chain two stages for 40 dB per decade, or use an LC filter (Power › Noise).',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'low', label: 'Low-pass' },
        { value: 'high', label: 'High-pass' },
      ],
      initial: 'low',
    },
    fSlider(10000, 100),
    rSlider,
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const gainPlot = scope(scene, B_W, B_H, { divs: [DECADES, 7], zeroAt: 1 - DB_TOP / DB_RANGE })
    gainPlot.group.position.set(B_X, B_Y, 0)
    const dbY = (db: number) => B_H / 2 - ((DB_TOP - db) / DB_RANGE) * B_H
    const asym = gainPlot.trace(LABEL, { samples: 120, radius: 0.08 })
    const curve = gainPlot.trace(B_FIELD, { samples: 200, radius: 0.15 })
    gainPlot.level(RING).set(dbY(-3))
    const phasePlot = scope(scene, B_W, P_H, { divs: [DECADES, 2] })
    phasePlot.group.position.set(B_X, P_Y, 0)
    const phY = (rad: number) => (rad / (Math.PI / 2)) * (P_H / 2) * 0.96
    const phaseCurve = phasePlot.trace(HIGH_V, { samples: 200, radius: 0.13 })
    const cornerMat = glowMat(RING, 0.8)
    const corner = add(scene, new THREE.Group())
    const bar = add(corner, mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), cornerMat), [0, 0, 0.3])
    bar.castShadow = false
    const top = B_Y + B_H / 2
    const bottom = P_Y - P_H / 2
    bar.scale.y = top - bottom
    bar.position.y = (top + bottom) / 2

    const small = (text: string, at: V3, color = GREY, align: 'left' | 'center' | 'right' = 'center') => add(scene, label(text, { size: 0.6, color, align }), at)
    ;['1', '10', '100', '1K', '10K'].forEach((t, k) => small(t, [B_X + gainPlot.xAt(k / DECADES), P_Y - P_H / 2 - 1, 0]))
    small('HZ', [B_X + B_W / 2 + 1.1, P_Y - P_H / 2 - 1, 0], GREY, 'left')
    for (const db of [0, -20, -40, -60]) small(db ? `−${-db}` : '0', [B_X + B_W / 2 + 0.8, B_Y + dbY(db), 0], GREY, 'left')
    small('DB', [B_X + B_W / 2 + 0.8, top + 0.9, 0], B_FIELD, 'left')
    for (const [a, t] of [[1, '+90°'], [0, '0°'], [-1, '−90°']] as const) small(t, [B_X + B_W / 2 + 0.8, P_Y + phY((a * Math.PI) / 2), 0], GREY, 'left')
    const dbLabel = pulseLabel(scene, 3, B_FIELD, [B_X, top + 1.4, 0], 1.1)

    const mini = scope(scene, M_W, M_H, { divs: [6, 6] })
    mini.group.position.set(M_X, M_Y, 0)
    const inTrace = mini.trace(HIGH_V, { samples: 140, radius: 0.09 })
    const outTrace = mini.trace(B_FIELD, { samples: 140, radius: 0.12 })
    const circuits = (['low', 'high'] as const).map((k) => {
      const holder = add(scene, new THREE.Group(), [M_X - 0.6, -4.6, 0])
      const c = rcCircuit(holder, [0, 0, 0], k, 0.62)
      return { k, holder, c, w: 0 }
    })

    const st = { cyc: 0, logF: 0, logFc: 0, kind: '' as FilterKind | '', hi: 0 }
    return {
      scene,
      view: { center: [0.6, -0.2, 0], radius: 60, polar: 1.42, azimuth: 0.08 },
      frame(dt, p) {
        const s = solveBode(p)
        if (!st.kind) Object.assign(st, { logF: Math.log10(s.f), logFc: Math.log10(s.fc), hi: s.kind === 'high' ? 1 : 0, kind: s.kind })
        st.logF = glide(dt, st.logF, Math.log10(s.f), 6)
        st.logFc = glide(dt, st.logFc, Math.log10(s.fc), 6)
        st.hi = glide(dt, st.hi, s.kind === 'high' ? 1 : 0, 6)
        const f = 10 ** st.logF
        const fc = 10 ** st.logFc
        const gainOf = (x: number) => (1 - st.hi) * rcGain('low', x, fc) + st.hi * rcGain('high', x, fc)
        const phaseOf = (x: number) => (1 - st.hi) * rcPhase('low', x, fc) + st.hi * rcPhase('high', x, fc)
        const asymOf = (x: number) => (1 - st.hi) * rcAsymptote('low', x, fc) + st.hi * rcAsymptote('high', x, fc)
        const u = uOf(f)
        curve.draw((v) => dbY(decibels(gainOf(fOf(v)))), u)
        asym.draw((v) => dbY(asymOf(fOf(v))), null)
        phaseCurve.draw((v) => phY(phaseOf(fOf(v))), u)
        corner.position.x = B_X + gainPlot.xAt(Math.min(1, Math.max(0, uOf(fc))))

        st.cyc += dt / CYCLE_S
        const g = gainOf(f)
        const ph = phaseOf(f)
        const amp = M_H * 0.42
        inTrace.scroll((c) => amp * sin(c), st.cyc, 2)
        outTrace.scroll((c) => amp * g * sin(c + ph / (2 * Math.PI)), st.cyc, 2)
        for (const c of circuits) {
          c.w = c.k === 'high' ? st.hi : 1 - st.hi
          presence(c.holder, c.w)
          c.c.setR(s.r)
          c.c.setIn(1.65 + 1.5 * sin(st.cyc))
          c.c.setOut(c.k === 'low' ? 1.65 + 1.5 * g * sin(st.cyc + ph / (2 * Math.PI)) : 1.5 * g * sin(st.cyc + ph / (2 * Math.PI)))
        }
        dbLabel.display.group.position.x = B_X + gainPlot.xAt(Math.min(0.86, Math.max(0.08, u)))
        dbLabel.show(fitDigits(s.db, 3))
        dbLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveBode(p)
        const where = s.x < 0.5 ? (s.kind === 'low' ? 'passband' : 'stopband') : s.x > 2 ? (s.kind === 'low' ? 'stopband' : 'passband') : 'near the corner'
        return [
          { label: 'Cutoff fc', value: hertz(s.fc) },
          { label: 'Gain at f', value: `${s.db.toFixed(1)} dB · × ${+s.gain.toPrecision(2)}`, tone: s.gain > 0.7 ? 'ok' : undefined },
          { label: 'Phase', value: deg(s.phase) },
          { label: 'f / fc', value: `${+s.x.toPrecision(2)} · ${where}` },
        ]
      },
    }
  },
}
