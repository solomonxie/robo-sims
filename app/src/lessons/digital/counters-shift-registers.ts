import * as THREE from 'three/webgpu'
import { Bit, Hc595, bit, counterRipple, shiftIn, shiftOutSteps, toBits } from '../../core/logic'
import { binary, hex } from '../../core/numbers'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { CLK_COLOR, DATA_COLOR, GREY, LED_RED, LOGIC_WIRES, RING, ease, flipFlopBlock, gateSymbol, groundSymbol, inBall, junction, ledLamp, partLetter, segmentDisplay, signalWire, timingDiagram } from '../fx'
import { Lesson, Stage, n } from '../types'

const BUS_DY = -3.6
const SP = 8.4
const rowXs = (k: number, sp = SP) => Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * sp)
const ease1 = (dt: number, from: number[], to: number[]) => from.map((l, i) => l + (to[i] - l) * ease(dt, 14))

/** LED hanging off a signal at (x, from[1]): the wire drops to `ly`, cathode to ground; `set(level)` drives both. */
function ledDrop(parent: THREE.Object3D, from: V3, x: number, ly: number, label: string) {
  const s = 0.6
  const c = x + 0.6 + s / 2
  const feed = signalWire(parent, from[0] === x ? [from, [x, ly, 0], [c - s / 2, ly, 0]] : [from, [x, from[1], 0], [x, ly, 0], [c - s / 2, ly, 0]])
  const lamp = ledLamp(parent, LED_RED, [c, ly, 0], { scale: s, anodeRight: false })
  signalWire(parent, [[c + s / 2, ly, 0], [c + s / 2, ly - 0.8, 0]])(0)
  add(parent, groundSymbol(), [c + s / 2, ly - 0.8, 0]).scale.setScalar(0.45)
  partLetter(parent, label, [c, ly - 2.4, 0], 0.8, RING)
  return (dt: number, level: number) => {
    feed(level)
    lamp.set(level)
    lamp.step(dt)
  }
}

/** Flip-flops at `xs` on one clock bus below them, fed from a ball at `inX`; with `chain` each Q feeds the next D. */
function ffRow(parent: THREE.Object3D, xs: number[], y: number, inX: number, clkLabel: string, chain: boolean) {
  const blocks = xs.map((x) => flipFlopBlock(parent, [x, y, 0]))
  const busY = y + BUS_DY
  const clkBall = inBall(parent, clkLabel, [inX, busY, 0])
  const bus = signalWire(parent, [[inX, busY, 0], [xs.at(-1)! - 4, busY, 0]])
  const drops = blocks.map((b, i) => {
    if (i < xs.length - 1) junction(parent, [xs[i] - 4, busY, 0], 0.4)
    return signalWire(parent, [[xs[i] - 4, busY, 0], [xs[i] - 4, b.pins.clk[1], 0], b.pins.clk])
  })
  const links = chain ? blocks.slice(0, -1).map((b, i) => signalWire(parent, [b.pins.q, blocks[i + 1].pins.d])) : []
  return {
    blocks,
    set(qs: number[], clk: number) {
      clkBall.set(clk)
      bus(clk)
      drops.forEach((d) => d(clk))
      links.forEach((l, i) => l(qs[i]))
      blocks.forEach((b, i) => b.set(qs[i], clk))
    },
  }
}

// --- Ripple counter: each flip-flop toggles (D = Q̄) and clocks the next, so the bits count in binary. ---

const RC_BITS = 4
const RC_CLK = 2.4
const TPD_NS = 20
const RC_DELAY = { real: 0.04, slow: 0.4 }
type RcSpeed = keyof typeof RC_DELAY
const rcEdges = (t: number) => Math.max(0, Math.floor((t - RC_CLK / 2) / RC_CLK) + 1)

/** Counter value at time t: the last edge's ripple advances one flip-flop per `delay`. */
function rippleAt(t: number, delay: number) {
  const k = rcEdges(t)
  if (!k) return 0
  const prev = (k - 1) % 2 ** RC_BITS
  const steps = counterRipple(prev, RC_BITS)
  const j = Math.floor((t - (k - 0.5) * RC_CLK) / delay)
  return j ? steps[Math.min(j, steps.length) - 1] : prev
}

export const rippleCounter: Lesson = {
  id: 'counters-shift-registers-ripple-counter',
  title: 'Ripple counter',
  tagline: 'Flip-flops that count in binary',
  formula: (p) =>
    p.speed === 'slow'
      ? `D = Q̄, so each edge flips Q · Q0 flips on CLK, each Q flips when the one before falls 1 → 0, one ${TPD_NS} ns delay later`
      : `count ← count + 1 on each rising edge of CLK · 4 bits: 0 … 15, then back to 0`,
  legend: [
    { color: RING, label: 'CLK = clock; Q0 (1s) on the left … Q3 (8s)', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: 'Scope: CLK and the four Q bits', shape: 'arrow-right' },
  ],
  points: [
    'Wire a D flip-flop’s Q̄ back to its own D and every rising clock edge flips Q: 0, 1, 0, 1. Q runs at half the clock frequency, so one flip-flop divides by two.',
    'Clock the next flip-flop from that Q̄. It flips each time Q falls 1 → 0, which is every second edge. Chain four and Q0…Q3 read the number of edges in binary, 0 to 15, then wrap to 0.',
    'Each stage waits for the one before, so after an edge the change ripples down the chain one flip-flop delay at a time. Pick Slow motion: going 7 → 8 the outputs briefly read 6, 4 and 0.',
    'Fine for an LED or a frequency divider; wrong for logic that reads the count at once. A synchronous counter clocks every flip-flop together and uses an adder to work out the next value (Registers).',
    `A 74HC74 flip-flop takes about ${TPD_NS} ns; Slow motion shows it as ${RC_DELAY.slow} s, Real speed as ${RC_DELAY.real} s. The ${RC_CLK} s clock stands in for a few MHz.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'speed',
      options: [
        { value: 'real', label: 'Real speed' },
        { value: 'slow', label: 'Slow motion' },
      ],
      initial: 'slow',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const xs = rowXs(RC_BITS, 11)
    const NOT_Y = 6
    const TOP_Y = 8.6
    const stages = xs.map((x, i) => {
      const b = flipFlopBlock(scene, [x, 0, 0])
      const g = gateSymbol(scene, [x, NOT_Y, 0], 'NOT', { size: 2.8, stub: 0.8 })
      g.group.rotation.z = Math.PI
      const flip = (p: V3): V3 => [2 * x - p[0], 2 * NOT_Y - p[1], 0]
      const gin = flip(g.pins.a)
      const gout = flip(g.pins.out)
      const qx = x + 3.6
      const back = x - 3.6
      const qWire = signalWire(scene, [b.pins.q, [qx, b.pins.q[1], 0], [qx, NOT_Y, 0], gin])
      junction(scene, [qx, b.pins.q[1], 0], 0.4)
      const nqWire = signalWire(scene, [gout, [back, NOT_Y, 0], [back, b.pins.d[1], 0], b.pins.d])
      const next = xs[i + 1]
      const carry = next === undefined ? null : signalWire(scene, [[back, NOT_Y, 0], [back, TOP_Y, 0], [next - 4.4, TOP_Y, 0], [next - 4.4, -1.6, 0], [next - 3.1, -1.6, 0]])
      if (carry) junction(scene, [back, NOT_Y, 0], 0.4)
      const ledAt: V3 = [x + 5.2, b.pins.q[1], 0]
      const ledWire = signalWire(scene, [[qx, ledAt[1], 0], [ledAt[0] - 0.35, ledAt[1], 0]])
      const lamp = ledLamp(scene, LED_RED, ledAt, { scale: 0.7, anodeRight: false })
      signalWire(scene, [[ledAt[0] + 0.35, ledAt[1], 0], [ledAt[0] + 0.35, -2.6, 0]])(0)
      add(scene, groundSymbol(), [ledAt[0] + 0.35, -2.6, 0]).scale.setScalar(0.5)
      partLetter(scene, `Q${i}`, [ledAt[0] + 0.2, NOT_Y + 0.4, 0], 0.9, RING)
      return { b, g, qWire, nqWire, carry, ledWire, lamp }
    })
    const inX = xs[0] - 7.5
    const clkBall = inBall(scene, 'CLK', [inX, -1.6, 0])
    const clkWire = signalWire(scene, [[inX, -1.6, 0], stages[0].b.pins.clk])
    const count = segmentDisplay(2, 3, LED_RED, true)
    add(scene, count.group, [24.5, -14, 0])
    const scope = timingDiagram(scene, [0, -14, 0], [
      { label: 'CLK', color: CLK_COLOR },
      ...stages.map((_, i) => ({ label: `Q${i}`, color: LED_RED })),
    ], { width: 40, rowH: 2.4, window: 24 })
    const s = { key: '', t: 0, lv: Array<number>(RC_BITS).fill(0), c: 0 }
    return {
      scene,
      view: { center: [1.5, -4.4, 0], radius: 92, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        if (p.speed !== s.key) Object.assign(s, { key: p.speed, t: 0 })
        s.t += dt
        const C = bit(s.t % RC_CLK >= RC_CLK / 2)
        const value = rippleAt(s.t, RC_DELAY[p.speed as RcSpeed])
        const q = toBits(value, RC_BITS)
        s.lv = ease1(dt, s.lv, q)
        s.c += (C - s.c) * ease(dt, 14)
        clkBall.set(s.c)
        clkWire(s.c)
        stages.forEach((st, i) => {
          const l = s.lv[i]
          const clk = i ? 1 - s.lv[i - 1] : s.c
          st.b.set(l, clk)
          st.qWire(l)
          st.ledWire(l)
          st.g.inputs(l, l)
          st.g.set(1 - l)
          st.nqWire(1 - l)
          st.carry?.(1 - l)
          st.lamp.set(l)
          st.lamp.step(dt)
        })
        count.set(String(value).padStart(2, ' '))
        scope.frame(dt, [C, ...q])
      },
      readouts: (p) => [
        { label: 'Counts', value: `0 … ${2 ** RC_BITS - 1}, wraps` },
        { label: 'Flip-flop delay', value: `${TPD_NS} ns → ${RC_DELAY[p.speed as RcSpeed]} s` },
        { label: '7 → 8 passes', value: p.speed === 'slow' ? '6, 4, 0' : 'too fast to see', tone: p.speed === 'slow' ? 'warn' : 'ok' },
      ],
    }
  },
}

// --- Shift register: eight flip-flops in a chain on one clock; each edge moves every bit one place along. ---

const SR_BITS = 8
const SR_CLK = 1.6
const SR_DATA: Record<string, { label: string; at: (k: number) => Bit; text: string }> = {
  one: { label: 'Single 1', at: (k) => bit(k % SR_BITS === 0), text: 'a single 1 every 8 edges walks along' },
  alt: { label: '1010…', at: (k) => bit(k % 2 === 0), text: '1, 0, 1, 0: the pattern slides, every LED blinks' },
  fill: { label: '8 × 1, 8 × 0', at: (k) => bit(k % (2 * SR_BITS) < SR_BITS), text: 'eight 1s fill the row, eight 0s empty it' },
}

export const shiftRegister: Lesson = {
  id: 'counters-shift-registers-shift-register',
  title: 'Shift register',
  tagline: 'Bits marching down a chain',
  formula: (p) => `Q0 ← D, Q1 ← Q0, …, Q7 ← Q6 on each rising edge of CLK · ${SR_DATA[String(p.data)].text}`,
  legend: [
    { color: RING, label: 'D = serial data in, CLK = clock; Q0 … Q7 out', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: 'Scope: CLK, D and Q0–Q3, each one edge later', shape: 'arrow-right' },
  ],
  points: [
    'Chain D flip-flops Q to D and clock them all together. On each rising edge every flip-flop copies the one before it, so the whole pattern moves one place along.',
    'Each flip-flop catches the old Q of its neighbour, not the new one: Q only changes after the edge, a few ns too late to be seen by the flip-flop next door. That is why the chain never runs through in one go.',
    'Serial in, parallel out: one data wire and one clock fill eight outputs, one bit per edge. Read the scope: Q0 is D one edge later, Q1 two edges later, and so on.',
    'Run it the other way, load eight bits at once and clock them out one by one, and you have parallel in, serial out: how UART, SPI and I²C send a byte down one wire.',
    `Real chips clock at tens of MHz; here one edge every ${SR_CLK} s.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'data',
      options: Object.entries(SR_DATA).map(([value, d]) => ({ value, label: d.label })),
      initial: 'one',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const xs = rowXs(SR_BITS)
    const y = 2
    const inX = xs[0] - 7
    const row = ffRow(scene, xs, y, inX, 'CLK', true)
    const dBall = inBall(scene, 'D', [inX, y + 1.6, 0])
    const dWire = signalWire(scene, [[inX, y + 1.6, 0], row.blocks[0].pins.d])
    const leds = row.blocks.map((b, i) => {
      if (i < SR_BITS - 1) junction(scene, [xs[i] + 3.6, b.pins.q[1], 0], 0.4)
      return ledDrop(scene, i < SR_BITS - 1 ? [xs[i] + 3.6, b.pins.q[1], 0] : b.pins.q, xs[i] + 3.6, y - 10, `Q${i}`)
    })
    const scope = timingDiagram(scene, [0, -20.6, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'D', color: DATA_COLOR },
      ...[0, 1, 2, 3].map((k) => ({ label: `Q${k}`, color: LED_RED })),
    ], { width: 52, rowH: 2.2 })
    const s = { key: '', t: 0, edges: 0, reg: 0, lv: Array<number>(SR_BITS).fill(0), c: 0, d: 0 }
    return {
      scene,
      view: { center: [0.6, -8.8, 0], radius: 122, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const data = SR_DATA[String(p.data)]
        if (p.data !== s.key) Object.assign(s, { key: p.data, t: 0, edges: 0, reg: 0 })
        s.t += dt
        const C = bit(s.t % SR_CLK >= SR_CLK / 2)
        const D = data.at(Math.floor(s.t / SR_CLK))
        for (const k = Math.floor(s.t / SR_CLK + 0.5); s.edges < k; s.edges++) s.reg = shiftIn(s.reg, data.at(s.edges), SR_BITS)
        const q = toBits(s.reg, SR_BITS)
        s.lv = ease1(dt, s.lv, q)
        s.c += (C - s.c) * ease(dt, 14)
        s.d += (D - s.d) * ease(dt, 14)
        row.set(s.lv, s.c)
        dBall.set(s.d)
        dWire(s.d)
        leds.forEach((l, i) => l(dt, s.lv[i]))
        scope.frame(dt, [C, D, ...q.slice(0, 4)])
      },
      readouts: (p) => [
        { label: 'Data in', value: SR_DATA[String(p.data)].label },
        { label: 'Wires', value: '2 in → 8 out', tone: 'ok' },
        { label: 'Clock', value: `${SR_CLK} s per edge` },
      ],
    }
  },
}

// --- 74HC595: a shift stage loaded over DS/SHCP, and a storage stage that updates the outputs only on STCP. ---

const BIT_S = 0.5
const CYCLE_SLOTS = 12
const CYCLE_S = CYCLE_SLOTS * BIT_S
const chase = (k: number) => 2 ** (k % 14 < 8 ? k % 14 : 14 - (k % 14))
const SEND: Record<string, { label: string; byte: (k: number, b: number) => number }> = {
  chase: { label: 'Chaser', byte: chase },
  count: { label: 'Count', byte: (k) => (k + 1) % 256 },
  byte: { label: 'Slider byte', byte: (_, b) => b },
}

/** Pins and outputs at time t: each cycle shifts one byte out MSB first (8 slots), pulses STCP, then idles. */
function hc595At(t: number, byteOf: (k: number) => number) {
  const k = Math.floor(t / CYCLE_S)
  const u = t - k * CYCLE_S
  const prevByte = k ? byteOf(k - 1) : 0
  const from: Hc595 = { shift: prevByte, latch: prevByte }
  const steps = shiftOutSteps(from, byteOf(k))
  const slot = Math.floor(u / BIT_S)
  const high = u - slot * BIT_S >= BIT_S / 2
  const done = Math.min(slot + bit(high), steps.length)
  return {
    byte: byteOf(k),
    ser: slot < 8 ? steps[slot].ser : 0,
    shcp: bit(slot < 8 && high),
    stcp: bit(slot === 8 && high),
    s: done ? steps[done - 1].s : from,
  }
}

export const hc595: Lesson = {
  id: 'counters-shift-registers-74hc595-output-expander',
  title: '74HC595 output expander',
  tagline: 'Three pins drive eight LEDs',
  formula: (p) =>
    p.mode === 'latch'
      ? 'Shift 8 bits in on SHCP (MSB first), then one STCP pulse copies them to Q0–Q7 at once'
      : 'No storage stage: the LEDs show every bit on its way in',
  legend: [
    { color: RING, label: 'DS data, SHCP shift clock, STCP store clock', shape: 'dot' },
    LOGIC_WIRES,
    { color: '#8a93a6', label: 'Top row shifts, bottom row holds the outputs', shape: 'dot' },
  ],
  points: [
    'A robot runs out of pins fast. A 74HC595 turns three microcontroller pins into eight outputs: data DS, shift clock SHCP and store clock STCP (SER, SRCLK and RCLK on TI datasheets).',
    'Inside are two rows of eight flip-flops. The top row is a shift register: each SHCP edge moves the bits along and takes DS into Q0. After eight edges it holds a whole byte, MSB at Q7.',
    'The bottom row is a register on STCP: one pulse copies all eight bits to the output pins together. The LEDs never show the half-shifted bits; pick No latch to see the flicker it hides.',
    'Q7S passes the bit that falls off the end to the next chip’s DS, so two chips give 16 outputs on the same three wires, three give 24. Arduino’s shiftOut() or an SPI port drive it directly.',
    `Outputs source or sink about 6 mA each at 5 V (35 mA max), plenty for an LED with a resistor; use a transistor driver for motors or relays. Each bit here takes ${BIT_S} s; SPI at 8 MHz sends a byte in 1 µs.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'send',
      options: Object.entries(SEND).map(([value, d]) => ({ value, label: d.label })),
      initial: 'chase',
    },
    { kind: 'slider', key: 'byte', label: 'Byte', min: 0, max: 255, initial: 0xa5, step: 1, format: (v) => `${binary(v, 8)} = ${hex(v, 2)}` },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'latch', label: 'Latched' },
        { value: 'direct', label: 'No latch' },
      ],
      initial: 'latch',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 44 })
    const xs = rowXs(8)
    const SY = 10
    const LY = 0
    const inX = xs[0] - 7.6
    const pkg = new THREE.MeshStandardMaterial({ color: '#3a4152', roughness: 0.6, transparent: true, opacity: 0.35, depthWrite: false })
    add(scene, new THREE.Mesh(new THREE.BoxGeometry(xs.at(-1)! - xs[0] + 10.6, 20.8, 0.4), pkg), [0.5, 5.4, -2]).castShadow = false
    partLetter(scene, '74HC595', [xs.at(-1)! - 2.4, 14.6, 0], 1.1, '#d8dbe0')
    const shift = ffRow(scene, xs, SY, inX, 'SHCP', true)
    const store = ffRow(scene, xs, LY, inX, 'STCP', false)
    const dsBall = inBall(scene, 'DS', [inX, SY + 1.6, 0])
    const dsWire = signalWire(scene, [[inX, SY + 1.6, 0], shift.blocks[0].pins.d])
    const ROUTE_Y = SY + BUS_DY - 0.9
    const loads = xs.map((x, i) => {
      junction(scene, [x + 3.6, SY + 1.6, 0], 0.4)
      return signalWire(scene, [[x + 3.6, SY + 1.6, 0], [x + 3.6, ROUTE_Y, 0], [x - 3.7, ROUTE_Y, 0], [x - 3.7, LY + 1.6, 0], store.blocks[i].pins.d])
    })
    const outX = xs.at(-1)! + 7
    const q7s = signalWire(scene, [shift.blocks[7].pins.q, [outX, SY + 1.6, 0]])
    const q7sBall = junction(scene, [outX, SY + 1.6, 0], 0.55)
    partLetter(scene, 'Q7S', [outX + 2.2, SY + 1.6, 0], 0.9, RING)
    const leds = store.blocks.map((b, i) => ledDrop(scene, b.pins.q, xs[i] + 3.7, -8, `Q${i}`))
    const shown = segmentDisplay(2, 3, LED_RED, true)
    add(scene, shown.group, [outX + 2.6, -6.4, 0])
    const scope = timingDiagram(scene, [0, -17.6, 0], [
      { label: 'DS', color: DATA_COLOR },
      { label: 'SHCP', color: CLK_COLOR },
      { label: 'STCP', color: '#ffb84d' },
    ], { width: 56, rowH: 2.6 })
    const s = { key: '', t: 0, sh: Array<number>(8).fill(0), st: Array<number>(8).fill(0), pins: [0, 0, 0] }
    return {
      scene,
      view: { center: [1.5, -2.6, 0], radius: 138, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.send}|${p.byte}|${p.mode}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const send = SEND[String(p.send)]
        const now = hc595At(s.t, (k) => send.byte(k, n(p, 'byte')))
        const out = p.mode === 'latch' ? now.s.latch : now.s.shift
        s.sh = ease1(dt, s.sh, toBits(now.s.shift, 8))
        s.st = ease1(dt, s.st, toBits(out, 8))
        s.pins = ease1(dt, s.pins, [now.ser, now.shcp, p.mode === 'latch' ? now.stcp : now.shcp])
        const [ds, shcp, stcp] = s.pins
        shift.set(s.sh, shcp)
        store.set(s.st, stcp)
        dsBall.set(ds)
        dsWire(ds)
        loads.forEach((l, i) => l(s.sh[i]))
        q7s(s.sh[7])
        q7sBall.set(s.sh[7])
        leds.forEach((l, i) => l(dt, s.st[i]))
        shown.set(hex(out, 2))
        scope.frame(dt, [now.ser, now.shcp, p.mode === 'latch' ? now.stcp : now.shcp])
      },
      readouts: (p) => {
        const b = n(p, 'byte')
        return [
          { label: 'Sending', value: p.send === 'byte' ? hex(b, 2) : SEND[String(p.send)].label },
          { label: 'Pins', value: '3 → 8', tone: 'ok' },
          { label: 'Outputs', value: p.mode === 'latch' ? 'once per byte' : 'flicker', tone: p.mode === 'latch' ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
