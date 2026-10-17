import * as THREE from 'three/webgpu'
import { Bit, D_FLIP_FLOP, D_LATCH, Inputs, Net, REGISTER_BIT, SR_LATCH, bit, evalNet, netRun, netStep, toBits } from '../../core/logic'
import { binary, hex } from '../../core/numbers'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  DATA_COLOR,
  GREY,
  LED_RED,
  LOGIC_WIRES,
  NetLayout,
  RING,
  ease,
  emptyGroup,
  flipFlopBlock,
  gateNet,
  glowBox,
  groundSymbol,
  junction,
  ledLamp,
  partLetter,
  segmentDisplay,
  signalWire,
  timingDiagram,
  wire,
  rand01,
} from '../fx'
import { Lesson, Stage, n } from '../types'

const GATE_PS = 15
const DELAY_S = 0.12
const SLOW = DELAY_S / (GATE_PS * 1e-12)
const CLK_S = 4
const REAL_GHZ = SLOW / CLK_S / 1e9
const slowText = `${GATE_PS} ps gate delay shown as ${DELAY_S} s (${(SLOW / 1e9).toFixed(0)} × 10⁹ slower)`

/** Live unit-delay run: every DELAY_S each gate reads the last outputs, so the feedback loops hold their state. */
function live(net: Net, from: Bit[]) {
  const s = { state: from, acc: 0, lv: from.map(Number), ins: {} as Record<string, number> }
  return {
    s,
    frame(dt: number, ins: Inputs) {
      if (!Object.keys(s.ins).length) Object.assign(s.ins, ins)
      for (s.acc += dt; s.acc >= DELAY_S; s.acc -= DELAY_S) s.state = netStep(net, ins, s.state)
      s.lv = s.lv.map((l, i) => l + (s.state[i] - l) * ease(dt, 14))
      for (const k in ins) s.ins[k] += (ins[k] - s.ins[k]) * ease(dt, 14)
      return s
    },
  }
}

/** Power up, then clock a 0 in so every run starts from Q = 0. */
const cleared = (net: Net, ins: Inputs, clk: string) => netRun(net, [{ ...ins, [clk]: 1 }, { ...ins, [clk]: 0 }], evalNet(net, { ...ins, [clk]: 0 }))[1]
const clockAt = (t: number): Bit => bit(t % CLK_S >= CLK_S / 2)

/** Cross-coupled pair: gate `top` at (x, 4) reads `bot` on pin b, `bot` at (x, −4) reads `top` on pin a. */
const crossVia = (top: number, bot: number, x: number): NetLayout['via'] => ({
  [`${top}.1`]: [[x + 5, -4, 0], [x + 5, -1, 0], [x - 5.6, -1, 0]],
  [`${bot}.0`]: [[x + 5, 4, 0], [x + 5, 1, 0], [x - 4.8, 1, 0]],
})

// --- SR latch: two NORs, each feeding the other, remember which input was last 1. ---

type SrIn = 'set' | 'hold' | 'reset' | 'both'
const SR_IN: Record<SrIn, { S: Bit; R: Bit; label: string }> = {
  set: { S: 1, R: 0, label: 'S = 1' },
  hold: { S: 0, R: 0, label: 'Hold' },
  reset: { S: 0, R: 1, label: 'R = 1' },
  both: { S: 1, R: 1, label: 'S = R = 1' },
}
const AUTO: SrIn[] = ['set', 'hold', 'reset', 'hold']
const PHASE_S = 2.5
const RACE_S = 1.6
const SR_LAYOUT: NetLayout = {
  inputs: { R: [-12, 4.9, 0], S: [-12, -4.9, 0] },
  gates: [[0, 4, 0], [0, -4, 0]],
  via: crossVia(0, 1, 0),
  outputs: [{ src: 0, at: [11, 4, 0], label: 'Q' }, { src: 1, at: [11, -4, 0], label: 'Q̄' }],
  ledScale: 0.75,
}
const SR_NET: Net = SR_LATCH
const srPhase = (p: Record<string, unknown>, t: number): SrIn => (p.in === 'auto' ? AUTO[Math.floor(t / PHASE_S) % AUTO.length] : (p.in as SrIn))

export const srLatch: Lesson = {
  id: 'flip-flops-latches-sr-latch',
  title: 'SR latch',
  tagline: 'Two gates that remember',
  formula: (p) => {
    const tail: Record<string, string> = {
      auto: 'set, hold, reset, hold',
      set: 'S = 1 forces Q̄ = 0, so Q = 1',
      hold: 'S = R = 0: each NOR passes the other’s output back, Q keeps its value',
      reset: 'R = 1 forces Q = 0, so Q̄ = 1',
      both: 'S = R = 1 forces Q = Q̄ = 0: not allowed',
    }
    return `Q = NOR(R, Q̄), Q̄ = NOR(S, Q) · ${tail[String(p.in)]}`
  },
  legend: [
    { color: RING, label: 'S sets Q = 1, R resets; Q̄ = not Q', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: 'Scope: S, R, Q over the last 12 s', shape: 'arrow-right' },
  ],
  points: [
    'Every circuit so far forgot: its output depended only on the inputs right now. Feed a gate’s output back into another gate’s input and the circuit can hold a state instead.',
    'Two NOR gates, each fed by the other. With S = R = 0 a NOR is just an inverter, so the pair is the same two-inverter loop as the SRAM cell (Semiconductors → Memory cell): Q = 1 holds Q̄ = 0 holds Q = 1.',
    'A 1 on S forces Q̄ = 0, and that makes Q = 1; a 1 on R does the opposite. When the input drops back to 0 the loop keeps the answer. That is one bit of memory.',
    'S = R = 1 drives both outputs to 0, which is not a valid state. Release both at once and the two gates race; here they swap together until a tiny mismatch decides. Real chips call this metastability.',
    `Each change ripples round the loop one gate at a time: ${slowText}.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'in',
      options: [{ value: 'auto', label: 'Auto' }, ...(Object.keys(SR_IN) as SrIn[]).map((k) => ({ value: k, label: SR_IN[k].label }))],
      initial: 'auto',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const net = gateNet(scene, SR_NET, SR_LAYOUT)
    const sim = live(SR_NET, [0, 1])
    const scope = timingDiagram(scene, [0, -15, 0], [
      { label: 'S', color: RING },
      { label: 'R', color: DATA_COLOR },
      { label: 'Q', color: LED_RED },
    ], { width: 26, rowH: 2.4 })
    const s = { key: '', t: 0, race: 0 }
    return {
      scene,
      view: { center: [0, -2.8, 0], radius: 70, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        if (p.in !== s.key) Object.assign(s, { key: p.in, t: 0 })
        s.t += dt
        const { S, R } = SR_IN[srPhase(p, s.t)]
        const v = sim.frame(dt, { S, R })
        const [q, nq] = v.state
        s.race = !S && !R && q === nq ? s.race + dt : 0
        if (s.race > RACE_S) {
          const w = bit(rand01() < 0.5)
          v.state = [w, bit(!w)]
          s.race = 0
        }
        net.frame(dt, v.ins, v.lv)
        scope.frame(dt, [S, R, v.state[0]])
      },
      readouts: (p) => {
        const k = String(p.in)
        const state: Record<string, string> = { auto: 'cycling', set: 'set', hold: 'holding', reset: 'reset', both: 'forbidden' }
        return [
          { label: 'Inputs', value: k === 'auto' ? 'S, hold, R, hold' : SR_IN[k as SrIn].label },
          { label: 'Latch', value: state[k], tone: k === 'both' ? 'warn' : 'ok' },
          { label: 'Gate delay', value: `${GATE_PS} ps → ${DELAY_S} s` },
        ]
      },
    }
  },
}

// --- D latch vs D flip-flop: transparent while the clock is high, or sampled only on its rising edge. ---

const rename = (net: Net): Net => net.map((g) => ({ ...g, in: g.in.map((s) => (s === 'E' ? 'CLK' : s)) }))
const FF_NET = rename(D_FLIP_FLOP)
const LATCH_NET = rename(D_LATCH)
const D_IN: Record<string, V3> = { D: [-30, 4.9, 0], CLK: [-30, -11, 0] }
const FF_LAYOUT: NetLayout = {
  inputs: D_IN,
  gates: [[-21, -8, 0], [-21, -3.1, 0], [-12, 4, 0], [-12, -4, 0], [-2, 4, 0], [-2, -4, 0], [9, 4, 0], [9, -4, 0], [19, 4, 0], [19, -4, 0]],
  bus: { D: -26.5, 0: -16.6 },
  via: { ...crossVia(4, 5, -2), ...crossVia(8, 9, 19), '6.1': [[4, -11, 0]], '7.1': [[4, -11, 0]] },
  outputs: [{ src: 8, at: [29, 4, 0], label: 'Q' }, { src: 9, at: [29, -4, 0], label: 'Q̄' }],
}
const LATCH_LAYOUT: NetLayout = {
  inputs: D_IN,
  gates: [[-21, -3.1, 0], [-12, 4, 0], [-12, -4, 0], [-2, 4, 0], [-2, -4, 0]],
  bus: { D: -26.5, CLK: -16.6 },
  via: crossVia(3, 4, -2),
  outputs: [{ src: 3, at: [9, 4, 0], label: 'Q' }, { src: 4, at: [9, -4, 0], label: 'Q̄' }],
}
const KINDS = {
  ff: { net: FF_NET, layout: FF_LAYOUT, q: 8, shift: 0 },
  latch: { net: LATCH_NET, layout: LATCH_LAYOUT, q: 3, shift: 10 },
}
type Kind = keyof typeof KINDS
/** D toggles at these times within two clock periods: it moves while the clock is high, never at a rising edge. */
const D_TOGGLES = [1.2, 3.0, 3.6, 5.0]
const dAuto = (t: number): Bit => bit(D_TOGGLES.filter((x) => t % (2 * CLK_S) >= x).length % 2)
const dAt = (p: Record<string, unknown>, t: number): Bit => (p.d === 'auto' ? dAuto(t) : bit(Number(p.d)))

export const dFlipFlop: Lesson = {
  id: 'flip-flops-latches-d-flip-flop',
  title: 'D flip-flop',
  tagline: 'Catch D on the clock edge',
  formula: (p) =>
    p.kind === 'ff'
      ? 'Q ← D on each rising clock edge (CLK: 0 → 1) · master latch open while CLK = 0, slave while CLK = 1'
      : 'Q = D while CLK = 1 (transparent) · Q holds while CLK = 0',
  legend: [
    { color: RING, label: 'D = data, CLK = clock; Q̄ = not Q', shape: 'dot' },
    LOGIC_WIRES,
    { color: '#6f8cff', label: 'Shaded latch glows while it is open', shape: 'dot' },
  ],
  points: [
    'Add two gates in front of a latch and only one input is needed: D. While the enable CLK is 1, S̄ and R̄ copy D, so Q follows D. When CLK drops to 0 both stay 1 and the loop holds the last D.',
    'That D latch is transparent: while CLK = 1 any wiggle on D goes straight to Q. In a processor, where outputs feed back into inputs, that would let data race round the loop many times in one clock.',
    'A flip-flop is two latches in series. The master is open while the clock is low and follows D; the slave is open while it is high and copies the master. At the rising edge the master shuts and the slave shows what it held.',
    'So Q changes only at the edge, to whatever D was just before it. D must be steady a little before (setup time) and after (hold time) the edge, or the master can go metastable.',
    `A CPU clock of ${REAL_GHZ.toFixed(0)} GHz is shown at ${(1 / CLK_S).toFixed(2)} Hz: ${slowText}. The flip-flop settles in a few gate delays, well inside one clock period.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'latch', label: 'D latch' },
        { value: 'ff', label: 'Flip-flop' },
      ],
      initial: 'ff',
    },
    {
      kind: 'choice',
      key: 'd',
      options: [
        { value: 'auto', label: 'D wiggles' },
        { value: '0', label: 'D = 0' },
        { value: '1', label: 'D = 1' },
      ],
      initial: 'auto',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const scope = timingDiagram(scene, [0, -19, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'D', color: DATA_COLOR },
      { label: 'Q', color: LED_RED },
    ], { width: 40, rowH: 3 })
    const live0 = { kind: '', d: '', t: 0, net: null as ReturnType<typeof gateNet> | null, sim: live(FF_NET, []), boxes: [] as THREE.MeshStandardMaterial[], dots: [] as ReturnType<typeof junction>[] }
    const rebuild = (kind: Kind, d: string) => {
      emptyGroup(holder)
      const k = KINDS[kind]
      holder.position.x = k.shift
      live0.net = gateNet(holder, k.net, k.layout)
      live0.sim = live(k.net, cleared(k.net, { D: 0 }, 'CLK'))
      live0.boxes = kind === 'ff' ? [glowBox(holder, [21.4, 13.6, 0.2], [-5.8, 0, -1.2], '#6f8cff', 0.1).m, glowBox(holder, [19.6, 13.6, 0.2], [16.1, 0, -1.2], '#ffb84d', 0.1).m] : [glowBox(holder, [21.4, 13.6, 0.2], [-5.8, 0, -1.2], '#6f8cff', 0.1).m]
      live0.dots = kind === 'ff' ? [junction(holder, [-25.2, -11, 0], 0.5), junction(holder, [4, -4.9, 0], 0.5)] : []
      Object.assign(live0, { kind, d, t: 0 })
    }
    return {
      scene,
      view: { center: [0, -6.2, 0], radius: 112, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        if (p.kind !== live0.kind || p.d !== live0.d) rebuild(p.kind as Kind, String(p.d))
        live0.t += dt
        const C = clockAt(live0.t)
        const D = dAt(p, live0.t)
        const v = live0.sim.frame(dt, { D, CLK: C })
        live0.net!.frame(dt, v.ins, v.lv)
        const open = p.kind === 'ff' ? [1 - v.ins.CLK, v.ins.CLK] : [v.ins.CLK]
        live0.boxes.forEach((m, i) => (m.opacity = 0.05 + 0.16 * open[i]))
        for (const j of live0.dots) j.set(v.ins.CLK)
        scope.frame(dt, [C, D, v.state[KINDS[p.kind as Kind].q]])
      },
      readouts: (p) => [
        { label: 'Q changes', value: p.kind === 'ff' ? 'only on CLK rising' : 'whenever CLK = 1', tone: 'ok' },
        { label: 'Clock', value: `${REAL_GHZ.toFixed(0)} GHz → ${CLK_S} s period` },
        { label: 'Gates', value: `${KINDS[p.kind as Kind].net.length}` },
      ],
    }
  },
}

// --- Register: four flip-flops on one clock load a 4-bit word together, or hold it while LOAD = 0. ---

const BIT_X = [-16.5, -5.5, 5.5, 16.5]
const Q_BIT = 12
const CLK_Y = -4.6
const LOAD_Y = -6.4
const IN_X = -26

export const registers: Lesson = {
  id: 'flip-flops-latches-registers',
  title: 'Registers',
  tagline: 'A word of flip-flops on one clock',
  formula: (p) => {
    const d = n(p, 'd')
    return p.load === 'on' ? `Q ← D = ${binary(d, 4)} on the next rising edge (LOAD = 1)` : `LOAD = 0: each flip-flop reloads its own Q, the word holds`
  },
  legend: [
    { color: RING, label: 'D3–D0 in, Q3–Q0 out; CLK = clock', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: 'Scope: CLK, LOAD and the four Q bits', shape: 'arrow-right' },
  ],
  points: [
    'A register is a row of D flip-flops sharing one clock: one per bit. On each rising edge all of them copy their D at once, so the stored word changes in one step and never shows half old, half new.',
    'Move the D slider: the LEDs do not follow. The new value only appears at the next rising edge of CLK.',
    'The load enable LOAD picks what each flip-flop sees on D through a small mux: the new data when LOAD = 1, its own Q when LOAD = 0. With LOAD = 0 every edge reloads the same bit, so the word holds.',
    'A CPU’s registers, the program counter and every pipeline stage are made like this, 32 or 64 bits wide. Feeding the output of an adder back into a register gives a counter; see Counters & shift registers.',
    `Each flip-flop here is the 14-gate circuit from D flip-flop plus the load mux, run gate by gate: ${slowText}.`,
  ],
  controls: [
    { kind: 'slider', key: 'd', label: 'D', min: 0, max: 15, initial: 10, step: 1, format: (v) => `${binary(v, 4)} = ${hex(v, 1)}` },
    {
      kind: 'choice',
      key: 'load',
      options: [
        { value: 'on', label: 'LOAD = 1' },
        { value: 'off', label: 'LOAD = 0, hold' },
      ],
      initial: 'on',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const blocks = BIT_X.map((x) => flipFlopBlock(scene, [x, 0, 0], { enable: true }))
    const inBall = (label: string, y: number) => {
      partLetter(scene, label, [IN_X - 1, y, 0], 0.9, RING, 'right')
      return junction(scene, [IN_X, y, 0], 0.55)
    }
    const clkBall = inBall('CLK', CLK_Y)
    const loadBall = inBall('LOAD', LOAD_Y)
    const last = BIT_X.at(-1)!
    const clkBus = signalWire(scene, [[IN_X, CLK_Y, 0], [last - 4, CLK_Y, 0]])
    const loadBus = signalWire(scene, [[IN_X, LOAD_Y, 0], [last - 4.8, LOAD_Y, 0]])
    const bits = blocks.map((b, i) => {
      const x = BIT_X[i]
      const k = 3 - i
      const dBall = junction(scene, [x - 4.6, 8, 0], 0.5)
      partLetter(scene, `D${k}`, [x - 4.6, 9.6, 0], 0.9, RING)
      const dWire = signalWire(scene, [[x - 4.6, 8, 0], [x - 4.6, b.pins.d[1], 0], b.pins.d])
      const cWire = signalWire(scene, [[x - 4, CLK_Y, 0], [x - 4, b.pins.clk[1], 0], b.pins.clk])
      const lWire = signalWire(scene, [[x - 4.8, LOAD_Y, 0], [x - 4.8, b.pins.en[1], 0], b.pins.en])
      const taps = i < BIT_X.length - 1 ? [junction(scene, [x - 4, CLK_Y, 0], 0.4), junction(scene, [x - 4.8, LOAD_Y, 0], 0.4)] : []
      const ledAt: V3 = [x + 5.2, b.pins.q[1], 0]
      const qWire = signalWire(scene, [b.pins.q, [ledAt[0] - 0.35, ledAt[1], 0]])
      const lamp = ledLamp(scene, LED_RED, ledAt, { scale: 0.7, anodeRight: false })
      wire(scene, [[ledAt[0] + 0.35, ledAt[1], 0], [ledAt[0] + 0.35, -2.6, 0]])
      add(scene, groundSymbol(), [ledAt[0] + 0.35, -2.6, 0]).scale.setScalar(0.5)
      partLetter(scene, `Q${k}`, [ledAt[0], 7, 0], 0.9, RING)
      const sim = live(REGISTER_BIT, cleared(REGISTER_BIT, { D: 0, LOAD: 1 }, 'CLK'))
      return { b, k, dBall, dWire, cWire, lWire, taps, qWire, lamp, sim }
    })
    const value = segmentDisplay(1, 3, LED_RED, true)
    add(scene, value.group, [27.5, 3.6, 0])
    const scope = timingDiagram(scene, [0, -17.6, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'LOAD', color: DATA_COLOR },
      ...[3, 2, 1, 0].map((k) => ({ label: `Q${k}`, color: LED_RED })),
    ], { width: 36, rowH: 2.4 })
    const s = { t: 0 }
    return {
      scene,
      view: { center: [0.8, -5.6, 0], radius: 106, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        s.t += dt
        const CLK = clockAt(s.t)
        const LOAD = bit(p.load === 'on')
        const d = toBits(n(p, 'd'), 4)
        const qs = bits.map((x) => {
          const v = x.sim.frame(dt, { D: d[x.k], LOAD, CLK })
          const c = v.ins.CLK
          const q = v.lv[Q_BIT]
          x.dBall.set(v.ins.D)
          x.dWire(v.ins.D)
          x.cWire(c)
          x.lWire(v.ins.LOAD)
          x.taps.forEach((t, j) => t.set(j ? v.ins.LOAD : c))
          x.qWire(q)
          x.b.set(q, c)
          x.lamp.set(q)
          x.lamp.step(dt)
          return v
        })
        const { ins } = qs[0]
        clkBall.set(ins.CLK)
        loadBall.set(ins.LOAD)
        clkBus(ins.CLK)
        loadBus(ins.LOAD)
        const word = qs.reduce((w, v, i) => w + v.state[Q_BIT] * 2 ** bits[i].k, 0)
        value.set(hex(word, 1))
        scope.frame(dt, [CLK, LOAD, ...qs.map((v) => v.state[Q_BIT])])
      },
      readouts: (p) => {
        const d = n(p, 'd')
        return [
          { label: 'D', value: `${binary(d, 4)} = ${hex(d, 1)}` },
          { label: 'LOAD', value: p.load === 'on' ? '1, load' : '0, hold', tone: p.load === 'on' ? 'ok' : 'warn' },
          { label: 'Clock', value: `${REAL_GHZ.toFixed(0)} GHz` },
        ]
      },
    }
  },
}
