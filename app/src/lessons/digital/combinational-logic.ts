import * as THREE from 'three/webgpu'
import {
  ALARM,
  Bit,
  DECODER2,
  FULL_ADDER,
  HALF_ADDER,
  Inputs,
  MAJORITY,
  MUX2,
  Net,
  PARITY,
  bit,
  evalNet,
  netDepth,
  netSteps,
  netTable,
  toBits,
} from '../../core/logic'
import { binary } from '../../core/numbers'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, LABEL, LED_RED, LOGIC_WIRES, NetLayout, RING, ease, emptyGroup, gateNet, glowBox, litWire, partLetter, segmentDisplay, storyClock, storySlider } from '../fx'
import { Lesson, Params, Stage, bitChoice, n } from '../types'

const DELAY_S = 0.4
const GATE_PS = 15
const SLOW = DELAY_S / (GATE_PS * 1e-12)
const delayText = (net: Net) => `${netDepth(net)} gate${netDepth(net) > 1 ? 's' : ''} ≈ ${netDepth(net) * GATE_PS} ps`

/** Unit-delay playback: on an input change the gates update one level per DELAY_S; levels ease toward that state. */
function settler(net: Net) {
  const s = { key: '', steps: [] as Bit[][], t: 0, ins: {} as Record<string, number>, gates: [] as number[] }
  const now = () => s.steps[Math.min(s.steps.length - 1, Math.floor(s.t / DELAY_S))]
  return {
    frame(dt: number, ins: Inputs) {
      const key = Object.values(ins).join()
      if (key !== s.key) {
        const from = s.steps.length ? now() : evalNet(net, ins)
        if (!s.gates.length) Object.assign(s, { gates: [...from], ins: { ...ins } })
        Object.assign(s, { key, steps: netSteps(net, ins, from), t: 0 })
      }
      s.t += dt
      const target = now()
      s.gates = s.gates.map((l, i) => l + (target[i] - l) * ease(dt, 14))
      for (const k in ins) s.ins[k] += (ins[k] - s.ins[k]) * ease(dt, 14)
      return s
    },
  }
}

// --- Truth tables: any table becomes AND terms ORed together; three examples with three inputs. ---

const ABC = ['A', 'B', 'C']
const IN3: Record<string, V3> = { A: [-20, 6.9, 0], B: [-20, 0, 0], C: [-20, -6.9, 0] }
const Y_LED: NetLayout['outputs'][number]['at'] = [13, -1.5, 0]
const FUNCS: Record<string, { label: string; expr: string; net: Net; layout: NetLayout }> = {
  majority: {
    label: 'Majority',
    expr: 'Y = AB + BC + AC',
    net: MAJORITY,
    layout: {
      inputs: IN3,
      gates: [[-8, 6, 0], [-8, 0, 0], [-8, -6, 0], [0, 3, 0], [8, -1.5, 0]],
      bus: { A: -16, B: -14, C: -12, 0: -4.2, 1: -4.2, 2: -4.2, 3: 3.8 },
      outputs: [{ src: 4, at: Y_LED, label: 'Y' }],
    },
  },
  parity: {
    label: 'Odd parity',
    expr: 'Y = A ⊕ B ⊕ C',
    net: PARITY,
    layout: {
      inputs: IN3,
      gates: [[-8, 6, 0], [8, -1.5, 0]],
      bus: { A: -16, B: -14, C: -12, 0: -4.2 },
      outputs: [{ src: 1, at: Y_LED, label: 'Y' }],
    },
  },
  alarm: {
    label: 'Alarm',
    expr: 'Y = A · (B + C)',
    net: ALARM,
    layout: {
      inputs: IN3,
      gates: [[-8, 0, 0], [8, -1.5, 0]],
      bus: { A: 2, B: -14, C: -12, 0: 0 },
      outputs: [{ src: 1, at: Y_LED, label: 'Y' }],
    },
  },
}
const outOf = (net: Net) => net.length - 1
const ROWS3 = Array.from({ length: 8 }, (_, r) => `A B C = ${binary(r, 3).split('').join(' ')}`)
const ROW3_S = 2.2
const TX = -10
const TY = -13
const ROW_H = 1.7
const COL_W = 2.3
const colX = (k: number) => k * COL_W

export const tableToCircuit: Lesson = {
  id: 'combinational-logic-truth-tables',
  title: 'Truth tables',
  tagline: 'From a table of rows to a circuit of gates',
  formula: (p) => {
    const f = FUNCS[String(p.fn)]
    const ones = netTable(f.net, ABC, outOf(f.net)).flatMap((r, i) => (r.out ? [binary(i, 3)] : []))
    return `${f.expr} · Y = 1 on rows ${ones.join(', ')}`
  },
  legend: [
    { color: RING, label: 'Inputs; lit column = this row of the table', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: `Change ripples 1 gate per ${DELAY_S} s (≈ ${GATE_PS} ps)`, shape: 'arrow-right' },
  ],
  points: [
    'A combinational circuit has no memory: its outputs depend only on the inputs right now. So a truth table describes it completely; 3 inputs give 2³ = 8 rows.',
    'Any table becomes gates: for every row where Y = 1, AND the inputs (inverting the ones that are 0), then OR those terms together. This is the sum of products.',
    'Then simplify. Majority is 1 on rows 011, 101, 110, 111; four 3-input terms shrink to AB + BC + AC, five small gates. Alarm: armed (A) and door (B) or window (C) open.',
    'Odd parity is 1 when an odd number of inputs are 1: two XORs. A serial link sends it as an extra bit so the receiver catches any single flipped bit.',
    `Each gate takes about ${GATE_PS} ps, shown here slowed ${SLOW.toExponential(0).replace('e+', ' × 10^')}×. A change ripples through level by level; the longest path sets how fast the circuit may be clocked.`,
  ],
  controls: [
    { kind: 'choice', key: 'fn', options: Object.entries(FUNCS).map(([value, f]) => ({ value, label: f.label })), initial: 'majority' },
    { ...storySlider(ROWS3), label: 'Inputs' },
  ],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const holder = add(scene, new THREE.Group())
    const table = add(scene, new THREE.Group(), [TX, TY, 0])
    add(table, new THREE.Mesh(new THREE.BoxGeometry(9 * COL_W + 0.6, 4 * ROW_H + 1.6, 0.4), new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.6 })), [colX(3), -1.5 * ROW_H, -0.6])
    const highlight = glowBox(table, [1.8, 4 * ROW_H + 1, 0.2], [colX(0), -1.5 * ROW_H, 0], RING, 0.22)
    ;['A', 'B', 'C', 'Y'].forEach((t, i) => {
      partLetter(table, t, [colX(-1), -i * ROW_H - (i === 3 ? 0.5 : 0), 0], 1, i === 3 ? LED_RED : RING)
    })
    add(table, new THREE.Mesh(new THREE.BoxGeometry(0.1, 4 * ROW_H + 1, 0.1), new THREE.MeshStandardMaterial({ color: GREY })), [colX(-0.5), -1.5 * ROW_H, 0])
    add(table, new THREE.Mesh(new THREE.BoxGeometry(9 * COL_W, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: GREY })), [colX(3), -2.75 * ROW_H, 0])
    const cells = Array.from({ length: 8 }, (_, k) =>
      [0, 1, 2, 3].map((i) => {
        const d = segmentDisplay(1, 1, i === 3 ? LED_RED : LABEL, true)
        add(table, d.group, [colX(k), -i * ROW_H - (i === 3 ? 0.5 : 0), 0])
        return d
      }),
    )
    let cellOut: THREE.Group[] = []
    const live = { fn: '', net: null as ReturnType<typeof gateNet> | null, sim: settler(MAJORITY), col: colX(0) }
    const clock = storyClock(ROWS3.map(() => ROW3_S))
    const rebuild = (fn: string) => {
      emptyGroup(holder)
      const f = FUNCS[fn]
      live.net = gateNet(holder, f.net, f.layout)
      live.sim = settler(f.net)
      for (const g of cellOut) g.removeFromParent()
      cellOut = netTable(f.net, ABC, outOf(f.net)).map((r, k) => {
        ;[r.ins.A, r.ins.B, r.ins.C].forEach((v, i) => cells[k][i].set(String(v)))
        cells[k][3].set(String(r.out))
        const dim = segmentDisplay(1, 1, '#3a3f48', true)
        dim.set(String(r.out))
        dim.group.visible = !r.out
        cells[k][3].group.visible = !!r.out
        return add(table, dim.group, [colX(k), -3 * ROW_H - 0.5, 0])
      })
      live.fn = fn
    }
    return {
      scene,
      view: { center: [-3, -3, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        if (p.fn !== live.fn) rebuild(String(p.fn))
        clock.frame(dt, n(p, 'step'))
        const [c, b, a] = toBits(clock.step, 3)
        const s = live.sim.frame(dt, { A: a, B: b, C: c })
        live.net!.frame(dt, s.ins, s.gates)
        live.col += (colX(clock.step) - live.col) * ease(dt, 10)
        highlight.mesh.position.x = live.col
      },
      readouts: (p) => {
        const f = FUNCS[String(p.fn)]
        const rows = netTable(f.net, ABC, outOf(f.net))
        const step = n(p, 'step')
        const y = step ? rows[step - 1].out : null
        return [
          { label: 'Y', value: y === null ? 'cycling rows' : String(y), tone: y ? 'ok' : undefined },
          { label: 'Rows Y = 1', value: `${rows.filter((r) => r.out).length} of 8` },
          { label: 'Gates · slowest path', value: `${f.net.length} · ${delayText(f.net)}` },
        ]
      },
    }
  },
}

// --- Multiplexer: S enables one AND gate; the chosen data input reaches Y. ---

const MUX_LAYOUT: NetLayout = {
  inputs: { d0: [-15, 4.4, 0], d1: [-15, -2.6, 0], S: [-15, -7.5, 0] },
  gates: [[-8, -7.5, 0], [2, 3.5, 0], [2, -3.5, 0], [10, 0, 0]],
  bus: { S: -12.6, 0: -3, 1: 5.8, 2: 5.8 },
  outputs: [{ src: 3, at: [16, 0, 0], label: 'Y' }],
}
const MUX_NET: Net = MUX2.map((g) => ({ ...g, in: g.in.map((s) => (s === 'D0' ? 'd0' : s === 'D1' ? 'd1' : s)) }))
const FLIP_S = 2.4
const muxIns = (p: Params, t: number) => ({
  d0: bit(n(p, 'd0')),
  d1: bit(n(p, 'd1')),
  S: p.sel === 'flip' ? bit(Math.floor(t / FLIP_S) % 2) : bit(n(p, 'sel')),
})

export const multiplexer: Lesson = {
  id: 'combinational-logic-multiplexer',
  title: 'Multiplexer',
  tagline: 'A switch for data, steered by a select bit',
  formula: (p) => {
    const sel = p.sel === 'flip' ? 'S flips' : `S = ${p.sel} → Y = D${p.sel} = ${n(p, `d${p.sel}`)}`
    return `Y = S̄·D0 + S·D1 · ${sel}`
  },
  legend: [
    { color: RING, label: 'Path the selected data takes to Y', shape: 'arrow-right' },
    LOGIC_WIRES,
    { color: GREY, label: `S = 0 enables the top AND, S = 1 the bottom`, shape: 'dot' },
  ],
  points: [
    'A multiplexer (mux) is a data switch: the select input S decides which data input reaches the output. Y = S̄·D0 + S·D1.',
    'The inverter makes S̄, so exactly one AND gate is enabled. It passes its D; the other one outputs 0 whatever its D is, and the OR merges the two.',
    'More select bits choose among more inputs: 2 bits pick 1 of 4, 3 bits 1 of 8 (74HC151). An analog mux lets one ADC read many sensor pins in turn.',
    'Set D0 = D1 = 1 and let S flip. When S falls, the bottom AND switches off one gate delay before the top one switches on, so Y dips to 0 for an instant: a glitch, or hazard. Adding the term D0·D1 removes it.',
    'Wire a truth table’s outputs to the data pins of a 2ⁿ:1 mux and the inputs, on the select pins, look up the answer. These lookup tables are what an FPGA is made of.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'sel',
      options: [
        { value: '0', label: 'S = 0' },
        { value: '1', label: 'S = 1' },
        { value: 'flip', label: 'S flips' },
      ],
      initial: 'flip',
    },
    bitChoice('d0', 'D0', 1),
    bitChoice('d1', 'D1', 0),
  ],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const net = gateNet(scene, MUX_NET, MUX_LAYOUT)
    const sim = settler(MUX_NET)
    const pathOf = (g: number) => [net.wires.find((w) => w.gate === g && w.pin === 0)!.pts, net.wires.find((w) => w.src === g)!.pts]
    const paths = [1, 2].map((g) => ({ glows: [...pathOf(g), net.outs[0].pts].map((pts) => litWire(scene, pts, 0.5)), f: 0 }))
    const ring = new THREE.Color(RING)
    const clock = { t: 0 }
    return {
      scene,
      view: { center: [1.2, -1.6, 0], radius: 74, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        clock.t += dt
        const ins = muxIns(p, clock.t)
        const v = sim.frame(dt, ins)
        net.frame(dt, v.ins, v.gates)
        paths.forEach((q, i) => {
          q.f += ((ins.S === i ? 1 : 0) - q.f) * ease(dt, 8)
          q.glows.forEach((g, j) => g.set(0.45 * (j === 2 ? Math.max(paths[0].f, paths[1].f) : q.f), ring))
        })
      },
      readouts: (p) => {
        const flip = p.sel === 'flip'
        const s = n(p, 'sel')
        return [
          { label: 'Y', value: flip ? 'D0 ↔ D1' : `D${s} = ${n(p, `d${s}`)}`, tone: !flip && n(p, `d${s}`) ? 'ok' : undefined },
          { label: 'S', value: flip ? `flips, ${FLIP_S} s` : `${s} → D${s}` },
          { label: 'Slowest path', value: delayText(MUX_NET) },
        ]
      },
    }
  },
}

// --- Decoder: two address bits raise exactly one of four lines. ---

const DEC_Y = [7.8, 2.6, -2.6, -7.8]
const DEC_LAYOUT: NetLayout = {
  inputs: { A1: [-23, 10.5, 0], A0: [-23, -10.5, 0] },
  gates: [[-13, 10.5, 0], [-13, -10.5, 0], ...DEC_Y.map((y): V3 => [4, y, 0])],
  bus: { A1: -20, A0: -18, 0: -7, 1: -5 },
  outputs: DEC_Y.map((y, i) => ({ src: 2 + i, at: [12, y, 0] as V3, label: `Y${i}` })),
  ledScale: 0.65,
}
const TICK_S = 1.6

export const decoder: Lesson = {
  id: 'combinational-logic-decoder',
  title: 'Decoder',
  tagline: 'A number in, one line out',
  formula: (p) => {
    const a = n(p, 'addr')
    const [a0, a1] = toBits(a, 2)
    return `Y${a} = ${a1 ? 'A1' : 'Ā1'} · ${a0 ? 'A0' : 'Ā0'} · address ${binary(a, 2)} = ${a} → only Y${a} is 1`
  },
  legend: [
    { color: RING, label: 'Address bits A1 A0; outputs Y0–Y3', shape: 'dot' },
    LOGIC_WIRES,
    { color: GREY, label: 'Each AND watches for one address', shape: 'dot' },
  ],
  points: [
    'A decoder turns an n-bit number into 2ⁿ separate lines and raises exactly one: the line whose number is on the inputs. Exactly-one-high is called one-hot.',
    'Each output is an AND gate that recognises its own pattern: Y2 = A1 · Ā0 waits for 10. The two inverters supply the complemented bits the ANDs need.',
    'Memory chips use one to pick a row: the address goes in, one word line goes high. A 74HC138 decodes 3 bits into 8 chip selects, so one CPU can talk to 8 devices on a shared bus.',
    'Every output is one row of the truth table. OR together the outputs of the rows where you want a 1 and any function of the inputs falls out.',
    'Run it backwards and it is an encoder: 2ⁿ lines in, the number of the high one out, like a keypad scanner reporting which key is pressed.',
  ],
  controls: [
    { kind: 'slider', key: 'addr', label: 'Address', min: 0, max: 3, initial: 2, step: 1, format: (v) => `${v} = ${binary(v, 2)}` },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'hold', label: 'Hold' },
        { value: 'count', label: 'Count up' },
      ],
      initial: 'hold',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const net = gateNet(scene, DECODER2, DEC_LAYOUT)
    const sim = settler(DECODER2)
    const s = { key: '', addr: 0, t: 0 }
    return {
      scene,
      view: { center: [-4.5, -0.8, 0], radius: 86, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.addr}|${p.mode}`
        if (key !== s.key) Object.assign(s, { key, addr: n(p, 'addr'), t: 0 })
        if (p.mode === 'count') {
          s.t += dt
          if (s.t >= TICK_S) {
            s.t -= TICK_S
            s.addr = (s.addr + 1) % 4
          }
        }
        const [a0, a1] = toBits(s.addr, 2)
        const v = sim.frame(dt, { A1: a1, A0: a0 })
        net.frame(dt, v.ins, v.gates)
      },
      readouts: (p) => {
        const a = n(p, 'addr')
        return [
          { label: 'High line', value: p.mode === 'count' ? 'counting' : `Y${a}`, tone: 'ok' },
          { label: 'Address', value: `${binary(a, 2)} = ${a}` },
          { label: 'Slowest path', value: delayText(DECODER2) },
        ]
      },
    }
  },
}

// --- Half and full adder: XOR makes the sum bit, AND the carry; two half adders and an OR add three bits. ---

const IN_AB: Record<string, V3> = { A: IN3.A, B: IN3.B }
const ADD_OUT = (sum: number, carry: number): NetLayout['outputs'] => [
  { src: sum, at: [19.5, 4.5, 0], label: 'S' },
  { src: carry, at: [19.5, -4.5, 0], label: 'Co' },
]
const ADDERS: Record<string, { net: Net; layout: NetLayout; sum: number; carry: number }> = {
  half: {
    net: HALF_ADDER,
    layout: { inputs: IN_AB, gates: [[4, 4.5, 0], [4, -4.5, 0]], bus: { A: -16, B: -14 }, outputs: ADD_OUT(0, 1) },
    sum: 0,
    carry: 1,
  },
  full: {
    net: FULL_ADDER,
    layout: {
      inputs: IN3,
      gates: [[-8, 6, 0], [4, 4.5, 0], [-8, -0.5, 0], [4, -3, 0], [13, -4.5, 0]],
      bus: { A: -16, B: -14, C: -12, 0: -4.2, 2: 8.4, 3: 7.8 },
      outputs: ADD_OUT(1, 4),
    },
    sum: 1,
    carry: 4,
  },
}
const addIns = (p: Params): Inputs => ({ A: bit(n(p, 'a')), B: bit(n(p, 'b')), C: p.kind === 'full' ? bit(n(p, 'c')) : 0 })

export const halfAndFullAdder: Lesson = {
  id: 'combinational-logic-half-and-full-adder',
  title: 'Half and full adder',
  tagline: 'One column of binary addition in gates',
  formula: (p) => {
    const { A, B, C } = addIns(p)
    const t = A + B + C
    const sum = p.kind === 'full' ? `S = A ⊕ B ⊕ Cin, Co = AB + Cin(A ⊕ B) · ${A} + ${B} + ${C}` : `S = A ⊕ B, Co = A · B · ${A} + ${B}`
    return `${sum} = ${binary(t, 2)} = ${t}`
  },
  legend: [
    { color: RING, label: 'S is worth 1, Co (carry out) 2; C = carry in', shape: 'dot' },
    LOGIC_WIRES,
    { color: '#6f8cff', label: 'Full adder: shaded = its two half adders', shape: 'dot' },
  ],
  points: [
    'Adding two bits gives a 2-bit answer: 1 + 1 = 10. The low bit, the sum S, is 1 when the inputs differ: XOR. The high bit, the carry, is 1 when both are 1: AND. That pair is a half adder.',
    'Every column but the first also receives a carry from the column to its right, so it must add three bits. A full adder does that; its outputs are worth 1 (S) and 2 (Co).',
    'It is two half adders: the first adds A + B, the second adds that sum to the carry in. If either one carries, the OR passes it on; they can never both carry.',
    'S = A ⊕ B ⊕ Cin is odd parity and Co is the majority of the three: the same two functions as in Truth tables, built more cheaply by sharing the first XOR.',
    'Chain full adders, each carry out into the next carry in, and you get an n-bit adder: see Logic gates → Adders. The carry path, two gates per bit, sets its speed.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'half', label: 'Half adder' },
        { value: 'full', label: 'Full adder' },
      ],
      initial: 'full',
    },
    bitChoice('a', 'A', 1),
    bitChoice('b', 'B', 1),
    bitChoice('c', 'Cin', 0),
  ],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const holder = add(scene, new THREE.Group())
    const live = { kind: '', net: null as ReturnType<typeof gateNet> | null, sim: settler(FULL_ADDER) }
    const rebuild = (kind: string) => {
      emptyGroup(holder)
      const a = ADDERS[kind]
      live.net = gateNet(holder, a.net, a.layout)
      live.sim = settler(a.net)
      if (kind === 'full') {
        glowBox(holder, [8.4, 12, 0.2], [-8, 2.6, -1.2], '#6f8cff', 0.1)
        glowBox(holder, [8.4, 12.4, 0.2], [4, 0.75, -1.2], '#6f8cff', 0.1)
      }
      live.kind = kind
    }
    return {
      scene,
      view: { center: [-0.4, -0.4, 0], radius: 84, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        if (p.kind !== live.kind) rebuild(String(p.kind))
        const v = live.sim.frame(dt, addIns(p))
        live.net!.frame(dt, v.ins, v.gates)
      },
      readouts: (p) => {
        const a = ADDERS[String(p.kind)]
        const ins = addIns(p)
        const v = evalNet(a.net, ins)
        const t = ins.A + ins.B + ins.C
        return [
          { label: 'Sum', value: `${p.kind === 'full' ? `${ins.A} + ${ins.B} + ${ins.C}` : `${ins.A} + ${ins.B}`} = ${t}`, tone: 'ok' },
          { label: 'Co S', value: `${v[a.carry]} ${v[a.sum]} = ${binary(t, 2)}` },
          { label: 'Gates · slowest path', value: `${a.net.length} · ${delayText(a.net)}` },
        ]
      },
    }
  },
}
