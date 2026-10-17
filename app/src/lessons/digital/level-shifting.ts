import * as THREE from 'three/webgpu'
import {
  BSS138,
  ESP32_ABS_MAX,
  LOGIC_INPUTS,
  MOSFETS,
  Mosfet,
  dividerShift,
  noiseMargins,
  rcStep,
  readInput,
  riseTime,
  shifterSolve,
  thresholds,
} from '../../core/physics'
import { si, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { buildHcSr04 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HIGH_V,
  LABEL,
  LED_RED,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  diodeAlong,
  emptyGroup,
  esp32Board,
  fetPart,
  glide,
  glowMat,
  groundAt,
  icPackage,
  junction,
  ledLamp,
  partLetter,
  pushButton,
  resistorAlong,
  segmentDisplay,
  signalWire,
  timingDiagram,
  voltScale,
  rand01,
} from '../fx'
import { Lesson, Stage, e12, n, resistorSlider } from '../types'

const WIRES = { color: HIGH_V, label: 'Wire colour: blue 0 V → red 5 V', shape: 'dot' } as const
const READ_COLOR = LED_RED
const fixed = (v: number) => v.toFixed(2)
/** A read for the scope: 0 / 1, or a mid-level flicker in the forbidden band. */
const shown = (r: 0 | 1 | null) => r ?? 0.35 + 0.3 * rand01()

/** LED from `from` to `at`, cathode to ground below; `(dt, on)`. */
function readLed(parent: THREE.Object3D, from: V3, at: V3) {
  const feed = signalWire(parent, [from, [at[0] - 0.35, at[1], 0]])
  const lamp = ledLamp(parent, LED_RED, at, { scale: 0.8, anodeRight: false })
  signalWire(parent, [[at[0] + 0.4, at[1], 0], [at[0] + 0.4, at[1] - 3.6, 0]])(0)
  groundAt(parent, [at[0] + 0.4, at[1] - 3.6, 0])
  return (dt: number, on: number) => {
    feed(on)
    lamp.set(on)
    lamp.step(dt)
  }
}

// --- Logic thresholds: the ESP32's HIGH against a 5 V receiver's VIH / VIL bands. ---

const RECEIVERS = {
  atmega328: { tag: 'ATmega328', vcc: 5 },
  ws2812: { tag: 'WS2812B', vcc: 5 },
  hct: { tag: '74HCT', vcc: 5 },
} as const
type Receiver = keyof typeof RECEIVERS
const LT = { ladderX: -1, base: -5, perV: 1.8, wireY: 7, rx: 12, rxY: 2, half: 1.2, w: 6, h: 8 }
const LT_PERIOD = 2.4

function ladder(parent: THREE.Object3D, rx: Receiver) {
  const { vil, vih } = thresholds(LOGIC_INPUTS[rx], RECEIVERS[rx].vcc)
  const vcc = RECEIVERS[rx].vcc
  const g = add(parent, new THREE.Group(), [LT.ladderX, LT.base, 0])
  const band = (from: number, to: number, color: string, label: string) => {
    const h = (to - from) * LT.perV
    add(g, new THREE.Mesh(new THREE.BoxGeometry(2 * LT.half, h, 0.6), glowMat(color, 0.35)), [0, from * LT.perV + h / 2, 0])
    if (label) partLetter(g, label, [LT.half + 1.2, from * LT.perV + h / 2, 0], 0.9, color)
  }
  band(0, vil, LOW_V, 'L')
  band(vil, vih, GREY, '')
  band(vih, vcc, HIGH_V, 'H')
  voltScale(g, -LT.half - 0.6, 0, vcc, LT.perV)
  partLetter(g, fixed(vih), [-LT.half - 3.2, vih * LT.perV, 0], 0.8, RING)
  partLetter(g, fixed(vil), [-LT.half - 3.2, vil * LT.perV, 0], 0.8, RING)
  partLetter(parent, RECEIVERS[rx].tag, [LT.rx, LT.rxY - LT.h / 2 - 1.4, 0], 1.1, LABEL)
}

export const logicThresholds: Lesson = {
  id: 'level-shifting-logic-thresholds',
  title: 'Logic thresholds',
  tagline: 'When is 3.3 V a HIGH?',
  formula: (p) => {
    const rx = p.rx as Receiver
    const f = LOGIC_INPUTS[rx]
    const { vih } = thresholds(f, 5)
    const voh = n(p, 'voh')
    const m = noiseMargins(voh, 0, f, 5).high
    const rule = f.ratio ? `${f.vih} × 5 V` : 'fixed (TTL)'
    return `HIGH needs V ≥ VIH = ${rule} = ${volts(vih)} · margin = V_OH − VIH = ${fixed(voh)} − ${fixed(vih)} = ${fixed(m)} V`
  },
  legend: [
    { color: RING, label: 'ESP32 pin toggles into a 5 V chip', shape: 'dot' },
    { color: GREY, label: 'Bands: LOW · ? (undefined) · HIGH', shape: 'dot' },
    { color: LED_RED, label: 'LED / scope READ = what the chip reads', shape: 'dot' },
  ],
  points: [
    'A digital input does not see 0 and 1, it sees a voltage. Below VIL it is a guaranteed LOW, above VIH a guaranteed HIGH. In between the datasheet promises nothing: it may read either way, flicker, or burn extra current.',
    'CMOS chips scale those thresholds with their own supply. An ATmega328 on 5 V needs 0.6 × 5 = 3.0 V for HIGH, so an ESP32’s 3.3 V just passes with 0.3 V of margin. A WS2812B LED needs 0.7 × 5 = 3.5 V: 3.3 V lands in the grey band and the pixels glitch.',
    '74HCT parts were made to take TTL levels: VIH is a fixed 2.0 V whatever the supply. A 74HCT125 buffer on 5 V is the classic fix for driving NeoPixels from a 3.3 V board.',
    'The ESP32’s HIGH sags under load, and long wires add noise. Margin is how much of either you can afford before a 1 turns into a maybe.',
    'The other direction is worse: an ESP32 pin is not 5 V tolerant (absolute max 3.6 V). A 5 V output into it forces current through its protection diodes and can kill the pin. That needs a real down-shift, next lesson.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'rx',
      options: [
        { value: 'atmega328', label: 'ATmega328' },
        { value: 'ws2812', label: 'WS2812B' },
        { value: 'hct', label: '74HCT' },
      ],
      initial: 'ws2812',
    },
    { kind: 'slider', key: 'voh', label: 'ESP32 HIGH', min: 1.8, max: 5, initial: 3.3, step: 0.1, format: (v) => `${v.toFixed(1)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const holder = add(scene, new THREE.Group())
    const pin = esp32Board(scene, [-17, 0.5, 0], 0.55)
    partLetter(scene, 'ESP32', [-17, -3.4, 0], 1.1, LABEL)
    const io = pin(5)
    const chip = add(scene, icPackage(LT.w, LT.h, 4), [LT.rx, LT.rxY, 0])
    chip.castShadow = true
    const inY = LT.rxY + LT.h / 2 - LT.h / 8
    const pinX = LT.w / 2 + 0.4
    const sig = signalWire(scene, [io, [io[0], LT.wireY, io[2]], [io[0], LT.wireY, 0], [LT.rx - pinX - 1.6, LT.wireY, 0], [LT.rx - pinX - 1.6, inY, 0], [LT.rx - pinX, inY, 0]])
    const led = readLed(scene, [LT.rx + pinX, inY, 0], [LT.rx + pinX + 3.6, inY, 0])
    const marker = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), glowMat(RING, 0.9)), [LT.ladderX, LT.base, 1])
    const tag = segmentDisplay(4, 1.3, RING, true)
    add(scene, tag.group, [LT.ladderX + 6, LT.base, 0.4])
    const scope = timingDiagram(scene, [0, -12.8, 0], [
      { label: 'PIN', color: PIN_COLOR },
      { label: 'READ', color: READ_COLOR },
    ], { width: 44, rowH: 2.6 })
    const s = { key: '', t: 0, v: 0, read: 0, flick: 0, r: 0 as number }
    return {
      scene,
      view: { center: [0, -1.6, 0], radius: 86, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const rx = p.rx as Receiver
        if (rx !== s.key) {
          emptyGroup(holder)
          ladder(holder, rx)
          s.key = rx
        }
        s.t += dt
        const high = (s.t % LT_PERIOD) < LT_PERIOD / 2
        s.v = glide(dt, s.v, high ? n(p, 'voh') : 0, 18)
        const r = readInput(s.v, LOGIC_INPUTS[rx], 5)
        s.flick -= dt
        if (s.flick <= 0) {
          s.r = shown(r)
          s.flick = 0.12
        }
        if (r !== null) s.r = r
        s.read = glide(dt, s.read, r === null ? Math.round(s.r) : r, 20)
        sig(s.v / 5)
        marker.position.y = LT.base + s.v * LT.perV
        tag.group.position.y = marker.position.y
        tag.set(fixed(s.v))
        led(dt, s.read)
        scope.frame(dt, [s.v / 5, s.r])
      },
      readouts: (p) => {
        const rx = p.rx as Receiver
        const voh = n(p, 'voh')
        const m = noiseMargins(voh, 0, LOGIC_INPUTS[rx], 5).high
        const r = readInput(voh, LOGIC_INPUTS[rx], 5)
        return [
          { label: 'VIH', value: volts(thresholds(LOGIC_INPUTS[rx], 5).vih) },
          { label: 'Margin', value: `${fixed(m)} V`, tone: m >= 0.2 ? 'ok' : 'warn' },
          { label: 'HIGH reads', value: r === 1 ? '1' : r === 0 ? '0' : 'maybe (grey)', tone: r === 1 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Divider shifter: HC-SR04 echo (5 V) through R1 / R2 into an ESP32 pin with ~15 pF on it. ---

const C_PIN = 15e-12
const BIT_S = 0.6
const UART_SCALE = BIT_S / 1e-6
const ECHO_PERIOD = 2.4
/** 'U' (0x55) at 1 Mbaud: start, 8 bits LSB first, stop, two idle bits. */
const FRAME = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1]
const DV = { y: -2.5, r1: [-10, -4], node: -1, r2: [-4.5, -8.5], board: 15, bs: 0.55, sx: -17, ss: 0.7 }

export const dividerShifter: Lesson = {
  id: 'level-shifting-divider-shifter',
  title: 'Divider shifter',
  tagline: 'Two resistors take 5 V down to 3.3 V',
  formula: (p) => {
    const r1 = e12(p, 'r1')
    const r2 = e12(p, 'r2')
    const d = dividerShift(5, r1, r2, C_PIN)
    return `V_pin = 5 V × R2 / (R1 + R2) = 5 × ${si(r2, 'Ω')} / ${si(r1 + r2, 'Ω')} = ${volts(d.vout)} · τ = (R1 ∥ R2) · 15 pF = ${si(d.tau, 's')}`
  },
  legend: [
    { color: RING, label: 'HC-SR04 echo (5 V) → ESP32 pin', shape: 'dot' },
    WIRES,
    { color: PIN_COLOR, label: 'Scope: ECHO, PIN, READ = what the ESP32 reads', shape: 'arrow-right' },
  ],
  points: [
    'An HC-SR04 runs on 5 V, so its echo pulse is 5 V high. Wired straight to an ESP32 (absolute max 3.6 V) it pushes current through the pin’s protection diode every ping, and the pin slowly dies.',
    'A divider fixes one-way signals for the cost of two resistors: 10 k over 22 k gives 5 × 22 / 32 = 3.44 V, safely under 3.6 V and well over the ESP32’s VIH of 0.75 × 3.3 = 2.48 V.',
    'Too little R2 and the HIGH drops into the undefined band; too much and it creeps over the limit. Big values save current, the divider draws 5 V / (R1 + R2) all the time the line is high.',
    'But the pin and the wire have about 15 pF of capacitance, charged through R1 ∥ R2. Every edge becomes an RC curve with τ = (R1 ∥ R2) · C. For a slow echo that is nothing; switch to UART at 1 Mbaud and big resistors round the bits until the ESP32 misreads them.',
    `It only works one way (5 V → 3.3 V) and only for push-pull outputs. In UART mode 1 µs is shown as ${BIT_S} s (${(UART_SCALE / 1e5).toFixed(0)} × 10⁵ slower).`,
  ],
  controls: [
    { ...resistorSlider('r1', 'R1 (top)', 10000), min: 1000, max: 47000 },
    { ...resistorSlider('r2', 'R2 (bottom)', 20000), min: 1000, max: 100000 },
    {
      kind: 'choice',
      key: 'sig',
      options: [
        { value: 'echo', label: 'Echo pulse' },
        { value: 'uart', label: 'UART 1 Mbaud' },
      ],
      initial: 'echo',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const holder = add(scene, new THREE.Group())
    const sensor = add(scene, buildHcSr04(), [DV.sx, 0.5, 0])
    sensor.scale.setScalar(DV.ss)
    partLetter(scene, 'HC-SR04', [DV.sx, 8.4, 0], 1, LABEL)
    const echo: V3 = [DV.sx + 0.5 * DV.ss, 0.5 - 1.5 * DV.ss, 0]
    partLetter(scene, 'ECHO', [echo[0] + 0.6, echo[1] - 0.6, 0.6], 0.7, RING, 'left')
    const pin = esp32Board(scene, [DV.board, DV.y - 5 * DV.bs, 0], DV.bs)
    partLetter(scene, 'ESP32', [DV.board + 2.4, DV.y + 1.8, 0], 1, LABEL)
    const io = pin(-6)
    const inWire = signalWire(scene, [echo, [echo[0], DV.y, 0], [DV.r1[0], DV.y, 0]])
    const r1Mid = (DV.r1[0] + DV.r1[1]) / 2
    const r2Mid = (DV.r2[0] + DV.r2[1]) / 2
    const r1Ends = [signalWire(scene, [[DV.r1[0], DV.y, 0], [r1Mid, DV.y, 0]]), signalWire(scene, [[r1Mid, DV.y, 0], [DV.r1[1], DV.y, 0]])]
    const nodeWire = signalWire(scene, [[DV.r1[1], DV.y, 0], [io[0], DV.y, 0], io])
    const r2Top = signalWire(scene, [[DV.node, DV.y, 0], [DV.node, r2Mid, 0]])
    signalWire(scene, [[DV.node, r2Mid, 0], [DV.node, DV.r2[1] - 1, 0]])(0)
    groundAt(scene, [DV.node, DV.r2[1] - 1, 0])
    const dot = junction(scene, [DV.node, DV.y, 0], 0.45)
    const zap = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), glowMat(HIGH_V, 1.2)), io)
    const tag = segmentDisplay(4, 1.4, RING, true)
    add(scene, tag.group, [DV.node + 4.2, DV.y + 2.2, 0.4])
    const scope = timingDiagram(scene, [-1, -15.4, 0], [
      { label: 'ECHO', color: RING },
      { label: 'PIN', color: PIN_COLOR },
      { label: 'READ', color: READ_COLOR },
    ], { width: 44, rowH: 2.2, samples: 240 })
    const s = { key: '', t: 0, vin: 0, vpin: 0, r: 0, ratio: 0, tau: 0 }
    return {
      scene,
      view: { center: [-1, -3.4, 0], radius: 88, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const r1 = e12(p, 'r1')
        const r2 = e12(p, 'r2')
        const key = `${r1}|${r2}|${p.sig}`
        if (key !== s.key) {
          emptyGroup(holder)
          resistorAlong(holder, r1, [DV.r1[0], DV.y, 0], [DV.r1[1], DV.y, 0], 1.6)
          resistorAlong(holder, r2, [DV.node, DV.r2[0], 0], [DV.node, DV.r2[1], 0], 1.6)
          partLetter(holder, 'R1', [r1Mid, DV.y + 1.8, 0], 0.9, LABEL)
          partLetter(holder, 'R2', [DV.node - 2.2, r2Mid, 0], 0.9, LABEL)
          const d = dividerShift(5, r1, r2, C_PIN)
          Object.assign(s, { key, t: 0, ratio: d.vout / 5, tau: p.sig === 'uart' ? d.tau * UART_SCALE : 1e-3 })
        }
        s.t += dt
        const high = p.sig === 'uart' ? FRAME[Math.floor(s.t / BIT_S) % FRAME.length] : +(s.t % ECHO_PERIOD < ECHO_PERIOD / 2)
        s.vin = high * 5
        s.vpin = rcStep(s.vpin, s.vin * s.ratio, s.tau, dt)
        const r = readInput(s.vpin, LOGIC_INPUTS.esp32, 3.3)
        s.r = glide(dt, s.r, r ?? 0.5, 30)
        inWire(s.vin / 5)
        r1Ends[0](s.vin / 5)
        r1Ends[1](s.vpin / 5)
        nodeWire(s.vpin / 5)
        r2Top(s.vpin / 5)
        dot.set(s.vpin / 5)
        zap.visible = s.vpin > ESP32_ABS_MAX
        zap.scale.setScalar(1 + 0.35 * Math.sin(s.t * 14))
        tag.set(fixed(s.vpin))
        scope.frame(dt, [s.vin / 5, s.vpin / 5, r ?? 0.5])
      },
      readouts: (p) => {
        const r1 = e12(p, 'r1')
        const r2 = e12(p, 'r2')
        const d = dividerShift(5, r1, r2, C_PIN)
        const { vih } = thresholds(LOGIC_INPUTS.esp32, 3.3)
        const t = riseTime(vih, d.vout, d.tau)
        const ok = d.vout >= vih && d.vout <= ESP32_ABS_MAX
        const slow = p.sig === 'uart' && t > 0.3e-6
        const verdict = d.vout > ESP32_ABS_MAX ? 'over 3.6 V!' : d.vout < vih ? 'below VIH' : slow ? 'edges too slow' : 'safe, reads 1'
        return [
          { label: 'Pin HIGH', value: volts(d.vout), tone: ok ? 'ok' : 'warn' },
          { label: 'Verdict', value: verdict, tone: ok && !slow ? 'ok' : 'warn' },
          { label: 'Draw', value: si(d.amps, 'A') },
          { label: 'Edge → VIH', value: Number.isFinite(t) ? si(t, 's') : 'never', tone: t < 0.3e-6 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Bidirectional shifter: one BSS138 between a 3.3 V and a 5 V I²C SDA line, each with its own pull-up. ---

const FETS = { bss138: BSS138, n2n7000: MOSFETS['2N7000'] } satisfies Record<string, Mosfet>
type Fet = keyof typeof FETS
const PHASES = [
  { lo: false, hi: false, who: 'nobody (idle)' },
  { lo: true, hi: false, who: 'ESP32' },
  { lo: false, hi: false, who: 'nobody (idle)' },
  { lo: false, hi: true, who: '5 V sensor' },
]
const PHASE_S = 1.8
const BD = { fx: -2, lvY: 9, hvY: 10.4, sdaL: -2, sdaH: 5, rlX: -9, rhX: 9, gX: -5.4, dX: -3.6, btnL: -12.5, btnH: 13, sx: 19 }
const shifterCfg = (p: Record<string, unknown>, lo: boolean, hi: boolean) => ({
  lowRail: Number(p.lv),
  highRail: 5,
  lowPull: 10e3,
  highPull: 10e3,
  fet: FETS[p.fet as Fet],
  pullLow: lo,
  pullHigh: hi,
})
const solved = new Map<string, ReturnType<typeof shifterSolve>>()
const solve = (p: Record<string, unknown>, lo: boolean, hi: boolean) => {
  const key = `${p.lv}|${p.fet}|${lo}|${hi}`
  if (!solved.has(key)) solved.set(key, shifterSolve(shifterCfg(p, lo, hi)))
  return solved.get(key)!
}
const fetState = (r: ReturnType<typeof shifterSolve>) => (r.on ? 'on' : r.diodeA > 1e-5 ? 'body diode' : 'off')

export const bidirectionalShifter: Lesson = {
  id: 'level-shifting-bidirectional-shifter',
  title: 'Bidirectional shifter',
  tagline: 'One MOSFET, both directions, for I²C',
  formula: (p) =>
    `Gate on ${p.lv} V · idle: V_GS = 0 → off · 3.3 V side low: V_GS = ${p.lv} V > V_th = ${FETS[p.fet as Fet].vthV} V → on · 5 V side low: body diode drags it to ~0.6 V, then V_GS ≈ ${(Number(p.lv) - 0.6).toFixed(1)} V`,
  legend: [
    { color: RING, label: 'SDA: L = ESP32 side, H = 5 V side', shape: 'dot' },
    WIRES,
    { color: POWER, label: 'Buttons = pins pulling SDA low', shape: 'dot' },
  ],
  points: [
    'I²C lines are open-drain: chips only ever pull SDA and SCL low, pull-up resistors bring them high. Data goes both ways on one wire, so a one-way divider will not do.',
    'The trick is one N-MOSFET per line: gate tied to the low rail, source to the low side, drain to the high side, each side with its own pull-up. Idle, both sides sit at their own rail and V_GS = 0, so the FET is off and isolates them.',
    'When the ESP32 pulls its side low, the source drops, V_GS becomes the full 3.3 V and the channel turns on: the 5 V side is pulled low through a few ohms.',
    'When the sensor pulls the 5 V side low, the FET’s built-in body diode conducts first and drags the low side down to ~0.6 V. That alone raises V_GS past threshold, the channel turns on and finishes the job.',
    'It needs a FET that turns on hard from the low rail. The BSS138 (V_th ≈ 1.3 V) does even from 1.8 V; a 2N7000 (≈ 2.1 V) works at 3.3 V but at 1.8 V it never turns on, and the low side is left stuck in the undefined band. This is the circuit on the common 4-channel shifter boards.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'lv',
      options: [
        { value: '3.3', label: '3.3 V side' },
        { value: '1.8', label: '1.8 V side' },
      ],
      initial: '3.3',
    },
    {
      kind: 'choice',
      key: 'fet',
      options: [
        { value: 'bss138', label: 'BSS138' },
        { value: 'n2n7000', label: '2N7000' },
      ],
      initial: 'bss138',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const holder = add(scene, new THREE.Group())
    const pin = esp32Board(scene, [-19, BD.sdaL + 5 * 0.45, 0], 0.45)
    partLetter(scene, 'ESP32', [-19, BD.sdaL - 1.4, 0], 0.9, LABEL)
    const sensor = add(scene, icPackage(4.4, 6, 3), [BD.sx, BD.sdaH - 2, 0])
    sensor.castShadow = true
    partLetter(scene, 'Sensor', [BD.sx, BD.sdaH - 6.2, 0], 0.9, LABEL)
    const fet = fetPart(scene, [BD.fx, 0, 0], 'TO-92', { scale: 2 })
    const { d, g, s: src } = fet.pins
    const sdaPin = pin(6, false)
    const vPin = pin(-4)
    const lvRail = signalWire(scene, [vPin, [vPin[0], BD.lvY, 0], [BD.gX, BD.lvY, 0]])
    const gate = signalWire(scene, [g, [BD.gX, 0, 0], [BD.gX, BD.lvY, 0]])
    signalWire(scene, [[BD.rhX - 3, BD.hvY, 0], [BD.sx, BD.hvY, 0], [BD.sx, BD.sdaH + 1, 0]])(1)
    const sdaL = signalWire(scene, [src, [sdaPin[0], BD.sdaL, 0], sdaPin])
    const sdaH = signalWire(scene, [d, [BD.dX, d[1], 0], [BD.dX, BD.sdaH, 0], [BD.sx - 2.6, BD.sdaH, 0]])
    const pull = (x: number, top: number, bottom: number) => {
      const mid = (top + bottom) / 2
      resistorAlong(scene, 10e3, [x, mid + 1.6, 0], [x, mid - 1.6, 0], 1.4)
      return [signalWire(scene, [[x, top, 0], [x, mid, 0]]), signalWire(scene, [[x, mid, 0], [x, bottom, 0]])]
    }
    const rl = pull(BD.rlX, BD.lvY, BD.sdaL)
    const rh = pull(BD.rhX, BD.hvY, BD.sdaH)
    rh[0](1)
    partLetter(scene, '10k', [BD.rlX + 1.8, (BD.lvY + BD.sdaL) / 2, 0], 0.7, GREY)
    partLetter(scene, '10k', [BD.rhX + 1.8, (BD.hvY + BD.sdaH) / 2, 0], 0.7, GREY)
    const dots = [junction(scene, [BD.rlX, BD.lvY, 0], 0.4), junction(scene, [BD.rlX, BD.sdaL, 0], 0.4), junction(scene, [BD.rhX, BD.sdaH, 0], 0.4)]
    junction(scene, [BD.rhX, BD.hvY, 0], 0.4).set(1)
    const button = (x: number, y: number) => {
      const b = pushButton(scene, [x, y - 0.8, 0], [x, y - 3.6, 0])
      signalWire(scene, [[x, y, 0], [x, y - 0.8, 0]])
      signalWire(scene, [[x, y - 3.6, 0], [x, y - 4.6, 0]])(0)
      groundAt(scene, [x, y - 4.6, 0])
      return { b, dot: junction(scene, [x, y, 0], 0.4) }
    }
    const bl = button(BD.btnL, BD.sdaL)
    const bh = button(BD.btnH, BD.sdaH)
    const diodeZ = 1.8
    signalWire(scene, [[BD.dX, src[1], 0], [BD.dX, src[1], diodeZ]])
    signalWire(scene, [[BD.dX, d[1], 0], [BD.dX, d[1], diodeZ]])
    const body = diodeAlong(scene, [BD.dX, src[1], diodeZ], [BD.dX, d[1], diodeZ], { scale: 1.5, glass: true })
    partLetter(scene, 'SDA', [BD.btnL + 1.7, BD.sdaL + 1, 0], 0.75, RING)
    partLetter(scene, 'SDA', [BD.btnH + 2.5, BD.sdaH + 1, 0], 0.75, RING)
    partLetter(scene, '5 V', [BD.sx - 3, BD.hvY + 1.1, 0], 0.8, HIGH_V)
    const tags = [segmentDisplay(4, 1.2, PIN_COLOR, true), segmentDisplay(4, 1.2, RING, true)]
    add(scene, tags[0].group, [BD.rlX + 3.4, BD.sdaL - 1.6, 0.4])
    add(scene, tags[1].group, [BD.rhX - 3.6, BD.sdaH + 1.4, 0.4])
    const scope = timingDiagram(scene, [-1, -13.6, 0], [
      { label: 'L', color: PIN_COLOR },
      { label: 'H', color: RING },
    ], { width: 44, rowH: 2.6, samples: 240 })
    const s = { key: '', t: 0, vl: 0, vh: 0, press: [0, 0], ch: 0, dio: 0, sol: [] as ReturnType<typeof shifterSolve>[] }
    return {
      scene,
      view: { center: [-0.6, -1.6, 0], radius: 82, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const lv = Number(p.lv)
        const key = `${p.lv}|${p.fet}`
        if (key !== s.key) {
          emptyGroup(holder)
          partLetter(holder, `${p.lv} V`, [-14, BD.lvY + 1.1, 0], 0.8, HIGH_V)
          s.sol = PHASES.map((ph) => solve(p, ph.lo, ph.hi))
          Object.assign(s, { key, t: 0, vl: lv, vh: 5 })
        }
        s.t += dt
        const k = Math.floor(s.t / PHASE_S) % PHASES.length
        const ph = PHASES[k]
        const r = s.sol[k]
        s.vl = glide(dt, s.vl, r.vl, 12)
        s.vh = glide(dt, s.vh, r.vh, 12)
        s.press = [glide(dt, s.press[0], +ph.lo, 14), glide(dt, s.press[1], +ph.hi, 14)]
        s.ch = glide(dt, s.ch, Math.min(1, Math.abs(r.channelA) / 4e-4), 10)
        s.dio = glide(dt, s.dio, Math.min(1, r.diodeA / 2e-4), 10)
        const lvl = lv / 5
        lvRail(lvl)
        gate(lvl)
        rl[0](lvl)
        dots[0].set(lvl)
        for (const w of [sdaL, rl[1]]) w(s.vl / 5)
        for (const w of [sdaH, rh[1]]) w(s.vh / 5)
        dots[1].set(s.vl / 5)
        dots[2].set(s.vh / 5)
        bl.b.set(s.press[0])
        bh.b.set(s.press[1])
        bl.dot.set(s.vl / 5)
        bh.dot.set(s.vh / 5)
        fet.set(s.ch)
        body.set(s.dio > 0.02 ? s.dio : -0.3 * (1 - s.ch))
        tags[0].set(fixed(s.vl))
        tags[1].set(fixed(s.vh))
        scope.frame(dt, [s.vl / lv, s.vh / 5])
      },
      readouts: (p) => {
        const lv = Number(p.lv)
        const lo = solve(p, true, false)
        const hi = solve(p, false, true)
        const loOk = readInput(lo.vh, LOGIC_INPUTS.atmega328, 5) === 0
        const hiOk = readInput(hi.vl, LOGIC_INPUTS.esp32, lv) === 0
        return [
          { label: 'L low → H', value: volts(lo.vh), tone: loOk ? 'ok' : 'warn' },
          { label: 'H low → L', value: volts(hi.vl), tone: hiOk ? 'ok' : 'warn' },
          { label: 'FET, H low', value: fetState(hi), tone: hi.on ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
