import * as THREE from 'three/webgpu'
import { GATES, GateName, bit, cmosNand, rippleSteps, toBits, truthTable } from '../../core/logic'
import { MODERN_NMOS, MODERN_PMOS, Mosfet, channelOverdrive, mosfetDrain } from '../../core/physics'
import { si, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ELECTRON,
  GREY,
  HOLE,
  LABEL,
  LED_RED,
  RING,
  clamp01,
  ease,
  emptyGroup,
  gateSymbol,
  groundSymbol,
  icPackage,
  junction,
  ledLamp,
  litWire,
  mosfetDie,
  partLetter,
  potentialColor,
  pulseLabel,
  segmentDisplay,
  storyClock,
  storySlider,
  wire,
} from '../fx'
import { Lesson, Params, Stage, bitChoice, n } from '../types'

const VDD = 1.2
const HI = potentialColor(1)
const LO = potentialColor(0)

// --- NAND from transistors: two PMOS in parallel pull Y up, two NMOS in series pull it down. ---

const W1 = 9
const D1 = 3.4
const XP = 5.5
const YP = 4.4
const YN = -7.4
const YB = YP - D1 - 2.6
const XW = 11
const XO = 14.2
const YG = YN - D1 - 0.4

/** On-ness of a switch, 0..1, from its gate overdrive. */
const onness = (vgs: number, m: Mosfet) => clamp01((vgs - m.vthV) / (VDD - m.vthV))

const nand1 = (p: Params) => {
  const a = bit(n(p, 'a'))
  const b = bit(n(p, 'b'))
  return { a, b, ...cmosNand(a, b) }
}

export const nandFromTransistors: Lesson = {
  id: 'logic-gates-nand-from-transistors',
  title: 'NAND from transistors',
  tagline: 'Four switches, the gate everything is built from',
  formula: (p) => {
    const f = nand1(p)
    const via = f.toGnd ? 'both NMOS on in series → Y tied to ground' : `PMOS ${f.pmos[0] ? 'A' : 'B'}${f.pmos[0] && f.pmos[1] ? ' and B' : ''} on → Y tied to Vdd`
    return `Y = NOT(A · B) = NOT(${f.a} · ${f.b}) = ${f.out}: ${via}`
  },
  legend: [
    { color: HOLE, label: 'PMOS (top): on when its gate is 0', shape: 'arrow-left' },
    { color: ELECTRON, label: 'NMOS (bottom): on when its gate is 1', shape: 'arrow-right' },
    { color: '#ff4d4d', label: 'Lit path: Y tied to Vdd (red) or ground (blue)', shape: 'dot' },
    { color: RING, label: 'Inputs A, B; Y and Vdd in volts', shape: 'dot' },
  ],
  points: [
    'A logic gate is a few MOSFETs used as switches. A 1 is Vdd (here 1.2 V), a 0 is ground. An NMOS conducts when its gate is 1, a PMOS when its gate is 0.',
    'NAND: two PMOS side by side (in parallel) from Vdd to the output Y, two NMOS stacked (in series) from Y to ground. Each input drives one PMOS and one NMOS.',
    'If either input is 0, its PMOS ties Y to Vdd and its NMOS breaks the ground path: Y = 1. Only A = B = 1 turns both NMOS on and both PMOS off: Y = 0.',
    'Always exactly one network conducts, so no current flows from Vdd to ground except while switching: the CMOS trick from the inverter, with two inputs.',
    'NAND is universal: tie both inputs together and it is a NOT; NAND then NOT is AND; every other gate, adders and memory can be built from NANDs alone.',
  ],
  controls: [bitChoice('a', 'A', 1), bitChoice('b', 'B', 1)],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const pA = mosfetDie(scene, [-XP, YP, 0], { kind: 'p', width: W1, depth: D1, flip: true })
    const pB = mosfetDie(scene, [XP, YP, 0], { kind: 'p', width: W1, depth: D1 })
    const nA = mosfetDie(scene, [-XP, YN, 0], { kind: 'n', width: W1, depth: D1, flip: true })
    const nB = mosfetDie(scene, [XP, YN, 0], { kind: 'n', width: W1, depth: D1, flip: true })
    const dies = [pA, pB, nA, nB]
    const yv = YP + 3.2
    const ym = YN + 1.8
    const vddNet: V3[][] = [
      [[0, yv, 0], [pA.pins.source[0], yv, 0], pA.pins.source],
      [[0, yv, 0], [pB.pins.source[0], yv, 0], pB.pins.source],
    ]
    const upNet: V3[][] = [
      [pA.pins.drain, [pA.pins.drain[0], YP + 1.6, 0], [-XW, YP + 1.6, 0], [-XW, YB, 0]],
      [pB.pins.drain, [pB.pins.drain[0], YP + 1.6, 0], [XW, YP + 1.6, 0], [XW, YB, 0]],
    ]
    const outNet: V3[] = [[-XW, YB, 0], [XO, YB, 0]]
    const downNet: V3[][] = [
      [[nA.pins.drain[0], YB, 0], nA.pins.drain],
      [nA.pins.source, [nA.pins.source[0], ym, 0], [nB.pins.drain[0], ym, 0], nB.pins.drain],
      [nB.pins.source, [nB.pins.source[0], ym, 0], [XW + 0.6, ym, 0], [XW + 0.6, YG, 0]],
    ]
    for (const pts of [...vddNet, ...upNet, outNet, ...downNet]) wire(scene, pts)
    wire(scene, [[0, yv, 0], [0, yv + 1.2, 0]])
    const vddBall = junction(scene, [0, yv + 1.2, 0], 0.6)
    vddBall.set(1)
    pulseLabel(scene, 3, RING, [-2.4, yv + 1.2, 0], 0.9).show('1.2')
    add(scene, groundSymbol(), [XW + 0.6, YG, 0])
    const lit = {
      vdd: vddNet.map((pts) => litWire(scene, pts)),
      up: upNet.map((pts) => litWire(scene, pts)),
      out: litWire(scene, outNet),
      down: downNet.map((pts) => litWire(scene, pts)),
    }
    const outBall = junction(scene, [0, YB, 0], 0.55)
    const midBall = junction(scene, [0, ym, 0], 0.45)
    for (const x of [-XW, XW, nA.pins.drain[0]]) junction(scene, [x, YB, 0], 0.4).set(0.5)
    const yLabel = pulseLabel(scene, 2, RING, [0, YB - 1.4, 0], 0.9)

    const inputs = dies.map((d, i) => {
      const top: V3 = [d.pins.gate[0], d.pins.gate[1] + 1.6, 0]
      wire(scene, [d.pins.gate, top])
      return { ball: junction(scene, top, 0.55), label: pulseLabel(scene, 2, RING, [top[0] - 2.1, top[1], 0], 0.9), name: i % 2 ? 'B' : 'A' }
    })

    const ledX = XO + 1.4
    const lamp = ledLamp(scene, LED_RED, [ledX, YB, 0], { scale: 1.4, anodeRight: false })
    wire(scene, [[ledX + 0.7, YB, 0], [ledX + 2, YB, 0], [ledX + 2, YG, 0]])
    add(scene, groundSymbol(), [ledX + 2, YG, 0])

    const s = { a: 1, b: 1, vout: 0, mid: 0, flow: 0 }
    return {
      scene,
      view: { center: [2.4, 2.4, 0], radius: 68, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const f = nand1(p)
        s.a += (f.a - s.a) * ease(dt, 5)
        s.b += (f.b - s.b) * ease(dt, 5)
        const vin = [s.a * VDD, s.b * VDD]
        const on = [onness(VDD - vin[0], MODERN_PMOS), onness(VDD - vin[1], MODERN_PMOS), onness(vin[0], MODERN_NMOS), onness(vin[1], MODERN_NMOS)]
        const up = on[0] + on[1]
        const down = (on[2] * on[3]) / (on[2] + on[3] + 1e-6)
        const target = (up / (up + down + 1e-9)) * VDD
        const before = s.vout
        s.vout += (target - s.vout) * ease(dt, 6 * (up + down))
        s.flow += (Math.min(1, (Math.abs(s.vout - before) / dt / VDD) * 1.5) - s.flow) * ease(dt, 10)
        if (on[3] > 0.5) s.mid += -s.mid * ease(dt, 8)
        else if (on[2] > 0.5) s.mid += (s.vout - s.mid) * ease(dt, 8)
        const charging = s.vout < target
        dies.forEach((d, i) => {
          const m = i < 2 ? MODERN_PMOS : MODERN_NMOS
          const vg = vin[i % 2]
          const vgs = i < 2 ? VDD - vg : vg
          const share = i < 2 ? (charging ? on[i] / (up + 1e-6) : 0) : charging ? 0 : 1
          d.step(dt, {
            gate: clamp01(vgs / VDD),
            deplete: 0.8 * Math.sqrt(clamp01(vgs / m.vthV)),
            channel: (u) => channelOverdrive(u, vgs, 0.05, m) / (VDD - m.vthV),
            flow: 2 + 10 * s.flow * share,
          })
          d.paintGate(vg / VDD)
          inputs[i].ball.set(vg / VDD)
          inputs[i].label.show(`${inputs[i].name}${Math.round(vg / VDD)}`)
          inputs[i].label.frame(dt)
        })
        lit.vdd.forEach((l, i) => l.set(on[i], HI))
        lit.up.forEach((l, i) => l.set(on[i], HI))
        const gnd = on[2] * on[3]
        lit.down[0].set(gnd, LO)
        lit.down[1].set(gnd, LO)
        lit.down[2].set(gnd, LO)
        lit.out.set(1, potentialColor(s.vout / VDD))
        outBall.set(s.vout / VDD)
        midBall.set(s.mid / VDD)
        yLabel.show(`Y${Math.round(s.vout / VDD)}`)
        yLabel.frame(dt)
        lamp.set(clamp01((s.vout / VDD - 0.5) * 2))
        lamp.step(dt)
      },
      readouts: (p) => {
        const f = nand1(p)
        const offLeak = mosfetDrain(0, VDD, MODERN_NMOS).amps
        return [
          { label: 'Y', value: `${f.out} (${volts(f.out * VDD)})`, tone: 'ok' },
          { label: 'Path', value: f.toGnd ? 'Ground' : 'Vdd' },
          { label: 'Switches on', value: `${f.pmos.filter(Boolean).length} P + ${f.nmos.filter(Boolean).length} N` },
          { label: 'Leak per off FET', value: si(offLeak, 'A', 2) },
        ]
      },
    }
  },
}

// --- Truth tables: every input combination, one row each; the gate picks the output column. ---

const GATE_ORDER: GateName[] = ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR', 'NOT']
const EXPR: Record<GateName, string> = {
  NOT: 'Y = NOT A',
  AND: 'Y = A · B',
  OR: 'Y = A + B',
  NAND: 'Y = NOT(A · B)',
  NOR: 'Y = NOT(A + B)',
  XOR: 'Y = A ⊕ B',
  XNOR: 'Y = NOT(A ⊕ B)',
}
const ROWS = ['A 0 · B 0', 'A 0 · B 1', 'A 1 · B 0', 'A 1 · B 1']
const ROW_S = 2
const GX = -5.4
const TX = 11.6
const ROW_H = 2.2

/** Row index 0..3 → table row for `gate` (NOT ignores B). */
const rowOf = (gate: GateName, r: number) => (GATES[gate].inputs === 1 ? Math.floor(r / 2) : r)

export const truthTables: Lesson = {
  id: 'logic-gates-truth-tables',
  title: 'Truth tables',
  tagline: 'Every input, every output, one row each',
  formula: (p) => {
    const g = p.gate as GateName
    return `${EXPR[g]} · outputs for A B = ${truthTable(g)
      .map((r) => (GATES[g].inputs === 1 ? `${r.a}→${r.out}` : `${r.a}${r.b}→${r.out}`))
      .join(', ')}`
  },
  legend: [
    { color: RING, label: 'Inputs A, B now; lit row = this combination', shape: 'dot' },
    { color: LED_RED, label: 'LED on = Y is 1', shape: 'dot' },
    { color: '#ff4d4d', label: 'Wires: red = 1 (Vdd), blue = 0', shape: 'dot' },
  ],
  points: [
    'A truth table lists every input combination and the output for each. Two inputs give 2² = 4 rows, counted in binary 00, 01, 10, 11; n inputs give 2ⁿ.',
    'AND is 1 only when both inputs are 1; OR when either is. NAND and NOR are the same with the output inverted: the bubble on the symbol.',
    'XOR (exclusive or) is 1 when the inputs differ: it is the sum bit of binary addition. XNOR is 1 when they match: an equality test.',
    'In CMOS the inverting gates are the cheap ones: NAND and NOR take 4 transistors, AND and OR need an extra inverter (6), XOR about 12.',
    'Any truth table can be built from NANDs alone, or NORs alone. Chip tools turn the tables into gates for you.',
  ],
  controls: [
    { kind: 'choice', key: 'gate', options: GATE_ORDER.map((g) => ({ value: g, label: g })), initial: 'AND' },
    { ...storySlider(ROWS), label: 'Inputs' },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    const holder = add(scene, new THREE.Group())
    const ins = [0, 1].map((i) => {
      const at: V3 = [GX - 7.6, 1.3 - i * 2.6, 0]
      return { at, ball: junction(holder, at, 0.6), label: pulseLabel(scene, 2, RING, [at[0] - 2.2, at[1], 0], 0.9) }
    })
    const table = add(scene, new THREE.Group(), [TX, 0, 0])
    const bar = new THREE.MeshStandardMaterial({ color: RING, emissive: RING, emissiveIntensity: 0.6, transparent: true, opacity: 0.22, depthWrite: false })
    const highlight = add(table, new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.9, 0.2), bar))
    highlight.castShadow = false
    const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.6 })
    const back = add(table, new THREE.Mesh(new THREE.BoxGeometry(8.2, 1, 0.4), frame), [0, 0, -0.6])
    const head = ['A', 'B', 'Y'].map((t, i) => {
      const d = segmentDisplay(1, 1.1, i === 2 ? LED_RED : GREY, true)
      d.set(t)
      return add(table, d.group, [-2.6 + i * 2.6, 0, 0])
    })
    let cells: ReturnType<typeof segmentDisplay>[][] = []
    const rule = add(table, new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: GREY })))
    const sep = add(table, new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshStandardMaterial({ color: GREY })), [1.3, 0, 0])

    const ledAt: V3 = [GX + 8.6, 0, 0]
    const lamp = ledLamp(scene, LED_RED, ledAt, { scale: 1.6, anodeRight: false })
    wire(scene, [[ledAt[0] + 0.8, 0, 0], [ledAt[0] + 2, 0, 0], [ledAt[0] + 2, -4.6, 0]])
    add(scene, groundSymbol(), [ledAt[0] + 2, -4.6, 0])

    const live = { gate: '' as GateName | '', sym: null as ReturnType<typeof gateSymbol> | null, outWire: null as ReturnType<typeof litWire> | null, a: 0, b: 0, y: 0, row: 0 }
    const clock = storyClock(ROWS.map(() => ROW_S))
    const rebuild = (g: GateName) => {
      emptyGroup(holder)
      const sym = gateSymbol(holder, [GX, 0, 0], g, { size: 5.2 })
      const one = GATES[g].inputs === 1
      ins.forEach((inp, i) => {
        inp.ball = junction(holder, inp.at, 0.6)
        inp.ball.group.visible = !(one && i === 1)
        inp.label.display.group.visible = inp.ball.group.visible
        if (!inp.ball.group.visible) return
        const pin = i ? sym.pins.b : sym.pins.a
        wire(holder, [inp.at, [inp.at[0] + 2.2, inp.at[1], 0], [inp.at[0] + 2.2, pin[1], 0], pin])
      })
      wire(holder, [sym.pins.out, [ledAt[0] - 0.8, 0, 0]])
      live.outWire = litWire(holder, [sym.pins.out, [ledAt[0] - 0.8, 0, 0]], 0.36)
      live.sym = sym
      const rows = truthTable(g)
      for (const r of cells.flat()) r.group.removeFromParent()
      const top = ((rows.length + 1) / 2) * ROW_H
      cells = rows.map((r, k) =>
        [r.a, r.b, r.out].map((v, i) => {
          const d = segmentDisplay(1, 1.1, i === 2 ? (v ? LED_RED : GREY) : LABEL, true)
          d.set(one && i === 1 ? '-' : String(v))
          add(table, d.group, [-2.6 + i * 2.6, top - (k + 1.5) * ROW_H, 0])
          return d
        }),
      )
      head.forEach((h) => (h.position.y = top - 0.5 * ROW_H))
      head[1].visible = !one
      rule.position.y = top - ROW_H
      back.scale.y = (rows.length + 1) * ROW_H + 0.8
      back.position.y = 0
      sep.scale.y = (rows.length + 1) * ROW_H
      live.gate = g
    }

    return {
      scene,
      view: { center: [0.6, 1.2, 0], radius: 62, polar: 1.45, azimuth: 0.08 },
      frame(dt, p) {
        const g = p.gate as GateName
        if (g !== live.gate) rebuild(g)
        clock.frame(dt, n(p, 'step'))
        const r = clock.step
        const a = bit(r >= 2)
        const b = GATES[g].inputs === 1 ? 0 : bit(r % 2)
        const y = GATES[g].fn(a, b)
        live.a += (a - live.a) * ease(dt, 8)
        live.b += (b - live.b) * ease(dt, 8)
        live.y += (y - live.y) * ease(dt, 8)
        const k = rowOf(g, r)
        const rows = truthTable(g).length
        live.row += ((((rows + 1) / 2) * ROW_H - (k + 1.5) * ROW_H) - live.row) * ease(dt, 10)
        highlight.position.y = live.row
        ins[0].ball.set(live.a)
        ins[1].ball.set(live.b)
        ins[0].label.show(`A${a}`)
        ins[1].label.show(`B${b}`)
        for (const l of ins) l.label.frame(dt)
        live.sym!.inputs(live.a, live.b)
        live.sym!.set(live.y)
        live.outWire!.set(1, potentialColor(live.y))
        lamp.set(live.y)
        lamp.step(dt)
      },
      readouts: (p) => {
        const g = p.gate as GateName
        const rows = truthTable(g)
        const step = n(p, 'step')
        const pinned = step ? rows[rowOf(g, step - 1)] : null
        return [
          { label: 'Rows Y = 1', value: `${rows.filter((r) => r.out).length} of ${rows.length}` },
          { label: 'Transistors', value: String(GATES[g].transistors) },
          { label: 'Y', value: pinned ? String(pinned.out) : 'cycling', tone: pinned?.out ? 'ok' : undefined },
        ]
      },
    }
  },
}

// --- Adders: a full adder per bit; the carry ripples from bit 0 to bit 3, one adder delay each. ---

const BITS = 4
const STAGE_S = 1.1
const HOLD_S = 2.4
const FA_PS = 20
const SLOW = STAGE_S / (FA_PS * 1e-12)
const DX = 5.4
const XB = (i: number) => 8.1 - i * DX
const FA = 3.6
const K = 1.1

/** Upside-down LED under a block, anode lead top at (x − K/2, YLED); cathode routed beside it to the ground rail. */
function hangingLed(scene: THREE.Object3D, x: number) {
  const lamp = ledLamp(scene, LED_RED, [x, YLED, 0], { scale: K })
  lamp.group.rotation.z = Math.PI
  wire(scene, [[x + K / 2, YLED, 0], [x + 1.9, YLED, 0], [x + 1.9, YGND, 0]])
  return lamp
}
const YIN = 5
const YLED = -FA / 2 - 1.4
const YGND = YLED - 6.9

const adder3 = (p: Params) => {
  const a = n(p, 'a')
  const b = n(p, 'b')
  const steps = rippleSteps(a, b, BITS)
  const settle = steps.findIndex((s, k) => steps.slice(k).every((t) => t.value === a + b))
  return { a, b, steps, settle }
}
const bin = (v: number, w: number) => toBits(v, w).reverse().join('')
const numSlider = (key: string, label: string, initial: number) =>
  ({ kind: 'slider', key, label, min: 0, max: 15, initial, step: 1, format: (v: number) => `${v} = ${bin(v, 4)}` }) as const

export const adders: Lesson = {
  id: 'logic-gates-adders',
  title: 'Adders',
  tagline: 'Binary sums from XOR and AND, carry by carry',
  formula: (p) => {
    const { a, b } = adder3(p)
    return `Full adder: S = A ⊕ B ⊕ Cin, Cout = A·B + Cin·(A ⊕ B) · ${bin(a, 4)} + ${bin(b, 4)} = ${bin(a + b, 5)} (${a} + ${b} = ${a + b})`
  },
  legend: [
    { color: RING, label: 'Carry wave: the adder working now', shape: 'arrow-left' },
    { color: '#ff4d4d', label: 'Bits: red = 1, blue = 0; LEDs = sum', shape: 'dot' },
    { color: GREY, label: 'Sum in decimal; ps since the inputs changed', shape: 'dot' },
  ],
  points: [
    'Adding two bits gives a sum bit and a carry: 1 + 1 = 10 in binary. Sum = A XOR B, carry = A AND B. That pair of gates is a half adder.',
    'Every column after the first also has a carry in, so it needs a full adder: two half adders and an OR. S = A ⊕ B ⊕ Cin. About 28 transistors in CMOS.',
    'Chain four full adders, each carry out feeding the next carry in, and you add two 4-bit numbers (0–15) into a 5-bit result: a ripple-carry adder.',
    'The catch: bit 3 cannot be right until the carry has rippled through bits 0, 1 and 2. Until then the sum glitches through wrong values: try 15 + 1, the worst case.',
    'Each full adder takes ~20 ps here, so 64 bits would take over a nanosecond. Real CPUs use carry-lookahead adders that compute carries in parallel. Slowed 5 × 10¹⁰×; the wave replays every few seconds.',
  ],
  controls: [numSlider('a', 'A', 11), numSlider('b', 'B', 7)],
  build(): Stage {
    const scene = createStage({ span: 28 })
    const blocks = Array.from({ length: BITS }, (_, i) => {
      const x = XB(i)
      const body = icPackage(FA, FA, 2)
      const mat = (body.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
      const own = mat.clone()
      ;(body.children[0] as THREE.Mesh).material = own
      add(scene, body, [x, 0, 0])
      partLetter(scene, 'FA', [x, -0.4, 0.65], 0.9)
      const inA: V3 = [x - 0.8, YIN, 0]
      const inB: V3 = [x + 0.8, YIN, 0]
      for (const at of [inA, inB]) wire(scene, [at, [at[0], FA / 2, 0]])
      const balls = [junction(scene, inA, 0.5), junction(scene, inB, 0.5)]
      const digits = [inA, inB].map((at) => pulseLabel(scene, 1, RING, [at[0], at[1] + 1.4, 0], 0.9))
      const sumPts: V3[] = [[x - K / 2, -FA / 2, 0], [x - K / 2, YLED, 0]]
      wire(scene, sumPts)
      const lamp = hangingLed(scene, x)
      const sumWire = litWire(scene, sumPts, 0.38)
      return { own, balls, digits, lamp, sumWire, glow: 0, sum: 0 }
    })
    const carries = Array.from({ length: BITS + 1 }, (_, i) => {
      const x0 = i === 0 ? XB(0) + FA / 2 + 1.8 : XB(i - 1) - FA / 2
      const x1 = i === BITS ? XB(BITS - 1) - FA / 2 - 3.2 : XB(i) + FA / 2
      const pts: V3[] = [[x0, 0, 0], [x1, 0, 0]]
      wire(scene, pts)
      return { glow: litWire(scene, pts, 0.38), ball: junction(scene, [(x0 + x1) / 2, 0, 0], 0.42), v: 0 }
    })
    const coutAt: V3 = [XB(BITS - 1) - FA / 2 - 3.2, 0, 0]
    wire(scene, [coutAt, [coutAt[0], YLED, 0]])
    const coutLamp = hangingLed(scene, coutAt[0] + K / 2)
    const groundX = XB(0) + 4.2
    wire(scene, [[coutAt[0] + K / 2 + 1.9, YGND, 0], [groundX, YGND, 0]])
    add(scene, groundSymbol(), [groundX, YGND, 0])
    const sumLabel = pulseLabel(scene, 2, GREY, [coutAt[0] - 2.2, YLED - 3.4, 0], 1.3)
    const clock = pulseLabel(scene, 3, GREY, [XB(0) + 3.4, 2.4, 0], 0.8)

    const sim = { key: '', t: 0, steps: rippleSteps(0, 0, BITS), a: 0, b: 0 }
    return {
      scene,
      view: { center: [-0.6, 0.4, 0], radius: 62, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const f = adder3(p)
        const key = `${f.a}|${f.b}`
        if (key !== sim.key) Object.assign(sim, { key, t: 0, steps: f.steps, a: f.a, b: f.b })
        sim.t = (sim.t + dt) % (BITS * STAGE_S + HOLD_S)
        const k = Math.min(BITS, Math.floor(sim.t / STAGE_S))
        const st = sim.steps[k]
        const as = toBits(sim.a, BITS)
        const bs = toBits(sim.b, BITS)
        const front = k < BITS && sim.t < BITS * STAGE_S ? 1 - (sim.t % STAGE_S) / STAGE_S : 0
        blocks.forEach((bl, i) => {
          bl.balls[0].set(as[i])
          bl.balls[1].set(bs[i])
          bl.digits[0].show(String(as[i]))
          bl.digits[1].show(String(bs[i]))
          for (const d of bl.digits) d.frame(dt)
          bl.sum += (st.sums[i] - bl.sum) * ease(dt, 10)
          bl.lamp.set(bl.sum)
          bl.lamp.step(dt)
          bl.sumWire.set(1, potentialColor(bl.sum))
          bl.glow += ((i === k ? front : 0) - bl.glow) * ease(dt, 12)
          bl.own.emissive.set(RING).multiplyScalar(0.35 * bl.glow)
        })
        carries.forEach((c, i) => {
          c.v += (st.carries[i] - c.v) * ease(dt, 10)
          c.ball.set(c.v)
          c.glow.set(1, potentialColor(c.v))
        })
        coutLamp.set(carries[BITS].v)
        coutLamp.step(dt)
        sumLabel.show(String(st.value))
        sumLabel.frame(dt)
        clock.show(String(Math.round((Math.min(sim.t, BITS * STAGE_S) / SLOW) * 1e12)))
        clock.frame(dt)
      },
      readouts: (p) => {
        const f = adder3(p)
        return [
          { label: 'Sum', value: `${f.a + f.b} = ${bin(f.a + f.b, 5)}`, tone: 'ok' },
          { label: 'Settles after', value: `${f.settle} × ${FA_PS} ps`, tone: f.settle >= BITS ? 'warn' : undefined },
          { label: 'Transistors', value: `${BITS} × 28 = ${BITS * 28}` },
        ]
      },
    }
  },
}
