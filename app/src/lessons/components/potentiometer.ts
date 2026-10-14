import * as THREE from 'three/webgpu'
import { POT_SWEEP_DEG, Taper, adcCounts, attenuationDb, perceivedLevel, potDivider, taperFraction } from '../../core/physics'
import { amps, fitDigits, mA, ohms, pct, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import { GREY, LANE, POWER, RING, ease, groundSymbol, plusFlow, pulseLabel, rotaryPot, scope, ticks, wire } from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const turnSlider = { kind: 'slider', key: 'turn', label: 'Knob', min: 0, max: POT_SWEEP_DEG, initial: 135, step: 1, format: (v: number) => `${Math.round(v)}°` } as const
const turnOf = (p: Params) => n(p, 'turn') / POT_SWEEP_DEG

// --- Wiper as divider: the wiper splits the track in two, so the pot is a voltage divider you set by hand. ---

const VCC = 3.3
const ADC_BITS = 12
const TOTALS: Record<string, number> = { '1k': 1e3, '10k': 10e3, '100k': 100e3 }
const POT_AT: V3 = [-6, 1.6, 0]
const POT_SCALE = 1.15
const BOARD_X = 6
const BOARD_Y = 0.6
const BOARD_SCALE = 0.42
const W_SPEED = 6 // drawn units/s per mA

const solveWiper = (p: Params, turn = turnOf(p)) => {
  const total = TOTALS[String(p.ohms)] ?? 10e3
  const s = potDivider(VCC, total, turn)
  return { total, turn, ...s, counts: adcCounts(s.vout, VCC, ADC_BITS) }
}

export const wiperAsDivider: Lesson = {
  id: 'potentiometer-wiper-as-divider',
  title: 'Wiper as divider',
  tagline: 'A divider you set by hand',
  formula: (p) => {
    const s = solveWiper(p)
    return `Vout = 3.3 V × R₁₂ / R = 3.3 V × ${Math.round(n(p, 'turn'))}° / 270° = ${volts(s.vout)} → ${s.counts}`
  },
  legend: [
    { color: RING, label: 'Wiper Vout, V', shape: 'dot' },
    { color: POWER, label: 'ADC reading, 0–4095', shape: 'dot' },
  ],
  points: [
    'Inside a pot is a horseshoe of carbon track with a pin at each end, and a springy metal wiper that the shaft drags along it. The wiper is the middle pin.',
    'Put 3.3 V on pin 3 and ground on pin 1. Current runs through the whole track; the wiper taps it partway, so the track above and below the wiper are R₁ and R₂ of a divider.',
    'Turn clockwise and the wiper slides toward pin 3: more track below it, so Vout climbs from 0 V to 3.3 V. Halfway round (135°) gives 1.65 V, about 2048 on the ESP32’s ADC.',
    'The total resistance never changes, only the split. 1 kΩ, 10 kΩ and 100 kΩ pots give the same Vout; a bigger pot just wastes less current (3.3 mA vs 33 µA).',
    'For an ADC input, 10 kΩ is the usual pick: low enough that the pin’s input and noise don’t pull the reading, high enough to waste only 0.33 mA.',
  ],
  controls: [
    turnSlider,
    {
      kind: 'choice',
      key: 'ohms',
      options: [
        { value: '1k', label: 'B1K' },
        { value: '10k', label: 'B10K' },
        { value: '100k', label: 'B100K' },
      ],
      initial: '10k',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const pot = rotaryPot(scene, POT_AT, { scale: POT_SCALE })
    const board = buildEsp32()
    board.scale.setScalar(BOARD_SCALE)
    board.rotation.set(Math.PI / 2, Math.PI, 0)
    board.position.set(BOARD_X, BOARD_Y, 0)
    scene.add(board)
    const pinZ = 3.6 * BOARD_SCALE
    const header = (x: number) => BOARD_X - x * BOARD_SCALE
    const rowTop = BOARD_Y + 5 * BOARD_SCALE
    const rowBottom = BOARD_Y - 5 * BOARD_SCALE
    const v3x = header(7)
    const d34x = header(-4)
    const gndX = header(6)
    const [a, w, b] = [pot.pins.a, pot.pins.w, pot.pins.b]
    const mid = 0.4
    const y3 = b[1] - 0.5
    const y2 = b[1] - 1.3
    const over = rowTop + 1.2
    const supply: V3[] = [[v3x, rowTop, pinZ], [v3x, over, 0], [mid, over, 0], [mid, y3, 0], [b[0], y3, 0], b]
    wire(scene, supply, 0.22)
    wire(scene, [w, [w[0], y2, 0], [d34x, y2, 0], [d34x, rowBottom, pinZ]], 0.22)
    wire(scene, [[gndX, rowBottom, pinZ], [gndX, rowBottom - 0.5, 0]], 0.22)
    add(scene, groundSymbol(), [gndX, rowBottom - 0.5, 0]).scale.setScalar(0.7)
    wire(scene, [a, [a[0], a[1] - 0.4, 0]], 0.22)
    add(scene, groundSymbol(), [a[0], a[1] - 0.4, 0]).scale.setScalar(0.7)

    const dz = LANE / POT_SCALE
    const arc = Array.from({ length: 41 }, (_, k) => pot.track(1 - k / 40, dz))
    const lane = (p: V3): V3 => [p[0], p[1], LANE]
    const flowPts = [...supply.map(lane), lane(pot.tops.b), ...arc, lane(pot.tops.a), lane(a), [a[0], a[1] - 0.4, LANE] as V3]
    let turn = turnOf({ turn: turnSlider.initial })
    const bodyR = 3.3 * POT_SCALE
    const paint = (at: THREE.Vector3) => {
      const dx = at.x - POT_AT[0]
      const dy = at.y - POT_AT[1]
      if (dx * dx + dy * dy < bodyR * bodyR) return taperFraction(pot.trackAt(at.x, at.y), 'linear')
      return dx < 0 ? 0 : 1
    }
    const flow = plusFlow(scene, flowPts, paint)

    const voutLabel = pulseLabel(scene, 3, RING, [(w[0] + d34x) / 2 + 1.5, y2 - 1.3, 0], 1.3)
    const adcLabel = pulseLabel(scene, 4, POWER, [BOARD_X + 2.2, rowTop + 1.9, 0], 1.2)

    return {
      scene,
      view: { center: [0.6, -0.2, 0], radius: 38, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        turn += (turnOf(p) - turn) * ease(dt, 6)
        const s = solveWiper(p, turn)
        pot.set(turn, (u) => taperFraction(u, 'linear'))
        flow.step(dt * mA(s.amps) * W_SPEED)
        voutLabel.show(fitDigits(s.vout, 3))
        adcLabel.show(String(s.counts))
        for (const l of [voutLabel, adcLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveWiper(p)
        return [
          { label: 'Pin 1 → wiper', value: ohms(s.lower) },
          { label: 'Wiper → pin 3', value: ohms(s.upper) },
          { label: 'Vout', value: volts(s.vout), tone: 'ok' },
          { label: 'Track current', value: amps(s.amps) },
        ]
      },
    }
  },
}

// --- Linear vs log taper: an audio (A) pot packs most of its resistance change into the last half turn, to suit the ear. ---

const LINEAR = '#7fb2ff'
const T_POT: V3 = [-8.6, 0.6, 0]
const PLOT_W = 11
const PLOT_H = 8
const PLOT_AT: V3 = [4.2, 0.4, 0]

const solveTaper = (p: Params, turn = turnOf(p)) => {
  const taper: Taper = p.taper === 'linear' ? 'linear' : 'log'
  const fraction = taperFraction(turn, taper)
  return { taper, turn, fraction, db: attenuationDb(fraction), heard: perceivedLevel(fraction) }
}


export const linearVsLogTaper: Lesson = {
  id: 'potentiometer-linear-vs-log-taper',
  title: 'Linear vs log taper',
  tagline: 'Turn evenly, hear evenly',
  formula: (p) => {
    const s = solveTaper(p)
    const db = Number.isFinite(s.db) ? `${s.db.toFixed(1)} dB` : '−∞ dB'
    return `${s.taper === 'log' ? 'A (log)' : 'B (linear)'} at ${Math.round(n(p, 'turn'))}°: out ${pct(s.fraction)} = ${db} → feels ${pct(s.heard)}`
  },
  legend: [
    { color: LINEAR, label: 'Linear (B): R vs turn', shape: 'dot' },
    { color: RING, label: 'Log (A): R vs turn', shape: 'dot' },
    { color: POWER, label: 'How loud/bright it feels', shape: 'dot' },
  ],
  points: [
    'A linear (B) pot has an even track: half a turn gives half the resistance between pin 1 and the wiper, so half the voltage.',
    'Ears and eyes don’t work that way. They judge ratios: each halving sounds like the same step down (−6 dB). Loudness and brightness feel roughly logarithmic.',
    'So with a linear volume knob, the first quarter turn already reaches 25 % (−12 dB) and already feels 70 % loud; the rest of the turn hardly changes anything.',
    'An audio (A, log) pot uses a track that is far more resistive at one end: only 10 % at half turn (−20 dB). Mapped over a 40 dB listening range, the green curve becomes a near-straight line.',
    'Use B for sensors, ADC inputs and setting a voltage; use A for volume and for dimmers you judge by eye. The marking is on the case: B10K vs A10K.',
  ],
  controls: [
    turnSlider,
    {
      kind: 'choice',
      key: 'taper',
      options: [
        { value: 'log', label: 'Log (A)' },
        { value: 'linear', label: 'Linear (B)' },
      ],
      initial: 'log',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const pot = rotaryPot(scene, T_POT, { scale: 1.05 })
    const plot = scope(scene, PLOT_W, PLOT_H, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(...PLOT_AT)
    ticks(plot, [[0, '0'], [0.5, '135'], [1, '270']], [[0, '0'], [0.5, '50'], [1, '100']])
    const y = (f: number) => f * PLOT_H - PLOT_H / 2
    const traces = { linear: plot.trace(LINEAR), log: plot.trace(RING) }
    const heard = plot.trace(POWER, { radius: 0.09 })
    heard.group.position.z = 0.12
    const marker = plot.level(GREY)
    const outLabel = pulseLabel(scene, 3, RING, [T_POT[0], T_POT[1] + 5.3, 0], 1.2)
    const heardLabel = pulseLabel(scene, 3, POWER, [PLOT_AT[0], PLOT_AT[1] - PLOT_H / 2 - 3.2, 0], 1.2)

    let turn = turnOf({ turn: turnSlider.initial })
    return {
      scene,
      view: { center: [0, -0.4, 0], radius: 42, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        turn += (turnOf(p) - turn) * ease(dt, 6)
        const s = solveTaper(p, turn)
        for (const t of ['linear', 'log'] as const) {
          const on = t === s.taper
          const m = traces[t].material
          m.emissiveIntensity = on ? 0.9 : 0.15
          m.transparent = !on
          m.opacity = on ? 1 : 0.35
          traces[t].draw((u) => y(taperFraction(u, t)), on ? turn : null)
        }
        heard.draw((u) => y(perceivedLevel(taperFraction(u, s.taper))), turn)
        marker.set(y(s.heard))
        pot.set(turn, (u) => taperFraction(u, s.taper))
        outLabel.show(String(Math.round(s.fraction * 100)))
        heardLabel.show(String(Math.round(s.heard * 100)))
        for (const l of [outLabel, heardLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveTaper(p)
        return [
          { label: 'Out (R₁₂ / R)', value: pct(s.fraction) },
          { label: 'Level', value: Number.isFinite(s.db) ? `${s.db.toFixed(1)} dB` : '−∞ dB' },
          { label: 'Feels like', value: pct(s.heard), tone: 'ok' },
        ]
      },
    }
  },
}
