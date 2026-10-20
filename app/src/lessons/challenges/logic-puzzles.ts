import * as THREE from 'three/webgpu'
import { GateName, Net, bit } from '../../core/logic'
import {
  COUNTER_CLOCKS,
  COUNTER_GOALS,
  CounterGoal,
  D_LOGIC,
  DLogic,
  GATE_CYCLE,
  GATE_GOALS,
  GATE_KITS,
  GateGoal,
  GateSlot,
  HC_TIMING,
  counterChallenge,
  gateChallenge,
} from '../../core/physics'
import { si } from '../../core/units'
import { V3, add } from '../../models/kit'
import {
  FACE_VIEW,
  GREY,
  HIGH_V,
  LABEL,
  LOGIC_WIRES,
  NetLayout,
  POWER,
  RING,
  ease,
  emptyGroup,
  flipFlopBlock,
  gateNet,
  gateSymbol,
  glowBox,
  inBall,
  ledOut,
  liveLabel,
  memoBy,
  netSettler,
  partLetter,
  puzzleStage,
  segmentDisplay,
  signalWire,
  verdictTint,
  windowGauge,
} from '../fx'
import { Lesson, Params, Stage, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

const LEGEND = [
  { color: POWER, label: 'Pass / right row', shape: 'dot' as const },
  { color: RING, label: 'Close miss', shape: 'dot' as const },
  { color: HIGH_V, label: 'Fail / wrong row', shape: 'dot' as const },
  LOGIC_WIRES,
]
const ns = (s: number) => si(s, 's', 2)
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`

// --- Build XOR: fill a five-slot gate frame from a kit so the output matches a truth table, in as few gates as possible. ---

const GOAL_NAMES = namesOf(GATE_GOALS)
const GATE_OPTS: Record<GateName, string> = { NAND: 'NAND', NOR: 'NOR', AND: 'AND', OR: 'OR', XOR: 'XOR', XNOR: 'XNOR', NOT: 'NOT' }
const SLOT_OPTS = { WIRE: '— wire', ...GATE_OPTS }
const SLOT_LABELS = ['G1(A, B)', 'G2(G1, A)', 'G3(G1, B)', 'G4(G2, G3)', 'G5(G4, G4)']
const slotOpts = (i: number) => opts(i ? SLOT_OPTS : GATE_OPTS).map((o) => ({ ...o, label: `${SLOT_LABELS[i]} = ${o.label}` }))
const prefixed = (rec: Record<string, string>, pre: string) => opts(rec).map((o) => ({ ...o, label: `${pre}${o.label}` }))
const gxParams = (p: Params) => ({
  goal: pick(GOAL_NAMES, p.goal, 'xorNand') as GateGoal,
  slots: [0, 1, 2, 3, 4].map((i) => pick(i ? SLOT_OPTS : GATE_OPTS, p[`g${i + 1}`], 'NAND') as GateSlot),
})
type GxQ = ReturnType<typeof gxParams>
const gxKey = (q: GxQ) => `${q.goal}|${q.slots.join()}`
const gxSolve = memoBy(gxKey, (q: GxQ) => gateChallenge(q.goal, q.slots))
const chipsText = (c: { part: string; chips: number }[]) => c.map((x) => `${x.chips > 1 ? `${x.chips} × ` : ''}${x.part}`).join(' + ')
const GX_HINT: Record<GateGoal, string> = {
  xorNand: 'Hint: NAND(A, B) into two NANDs, one with A, one with B; NAND their outputs',
  xorNor: 'Hint: four NORs in the NAND-XOR shape make XNOR; a NOR with tied inputs inverts',
  xnorNand: 'Hint: build XOR first, then invert it with a tied NAND (G5)',
  lockNand: 'Hint: NAND(A, NAND(A, B)) = NOT(A · NOT B); wire past the gates you don’t need',
  xorAny: 'Hint: one 74HC86 gate is XOR; wire the other slots through',
  lockAny: 'Hint: A AND (A XOR B) is A AND NOT B',
}
const SLOT_AT: V3[] = [[-10.6, -1, 0], [-5, 1.8, 0], [-5, -3.8, 0], [0.6, -1, 0], [5.6, -1, 0]]
const IN_AT: Record<string, V3> = { A: [-15.6, 1.8, 0], B: [-15.6, -3.8, 0] }
const OUT_AT: V3 = [8.6, -1, 0]
const ROW_S = 2.4
const GATE_DELAY_S = 0.3
const TABLE = { x: -16.6, y: -5.6, dy: 0.95 }

/** The live net as drawn: slot-1 gates read (A, G1) so the wires don't cross; inputs by display name. */
function drawn(net: Net, slot: number[]): Net {
  return net.map((g, i) => (slot[i] === 1 && g.in.length === 2 ? { ...g, in: [g.in[1], g.in[0]] } : g))
}
function gxLayout(slot: number[], net: Net, out: number): NetLayout {
  const bus: Record<string, number> = { A: -13.6, B: -12.8 }
  const g0 = slot.indexOf(0)
  if (net.filter((g) => g.in.includes(g0)).length > 1) bus[String(g0)] = -7.5
  return { inputs: IN_AT, gates: slot.map((s) => SLOT_AT[s]), bus, outputs: [{ src: out, at: OUT_AT, label: 'Y' }], size: 2.2, stub: 0.7, ledScale: 0.8 }
}

export const logicPuzzlesBuildXor: Lesson = {
  id: 'logic-puzzles-build-xor',
  title: 'Build XOR',
  tagline: 'Fill five gate slots from a kit so the output matches a truth table: XOR from NANDs only, from NORs, a robot interlock, in the fewest gates',
  formula: (p) => {
    const q = gxParams(p)
    const s = gxSolve(q)
    return `Y = ${s.rows.map((r) => r.got).join('')} for rows 00 01 10 11 (want ${s.rows.map((r) => r.want).join('')}) · ${plural(s.gates, 'gate')}, ${chipsText(s.chips)} · settles in ${s.depth} × ${ns(HC_TIMING.tpd)} = ${ns(s.settleS)}`
  },
  legend: LEGEND,
  points: [
    'The puzzle: a fixed frame of five gate slots. G1 reads both inputs, G2 and G3 each read G1 and one input, G4 joins them, G5 has its inputs tied. Pick a gate for each slot, or “wire” to pass its first input straight on.',
    'NAND is universal: any truth table can be built from NANDs alone, so one 74HC00 (four gates) covers a lot. The classic XOR is four NANDs in exactly this shape (Semiconductors › Logic gates › NAND from transistors).',
    'A NAND or NOR with its inputs tied together is an inverter: that’s what G5 is for. The same shape in NORs gives XNOR, so XOR from NORs needs that fifth gate (Digital › Combinational logic › Truth tables).',
    'Robot uses: an alarm when exactly one bumper is hit (XOR), a motor that runs only when enabled AND the bumper isn’t pressed (an interlock). With any 74HC gate XOR is one 74HC86 gate; the puzzle is doing it from what’s in the drawer.',
    'Every gate adds ~8 ns (74HC at 5 V), so the deepest path sets the settle time. When both inputs flip at once, the paths race and the output can flick the wrong way for a gate delay: a glitch (Digital › Timing › Propagation delay).',
  ],
  controls: [
    { kind: 'choice', key: 'goal', options: opts(GOAL_NAMES), initial: 'xorNand' },
    ...[0, 1, 2, 3, 4].map((i) => ({ kind: 'choice' as const, key: `g${i + 1}`, options: slotOpts(i), initial: i === 3 ? 'AND' : i === 4 ? 'WIRE' : 'NAND' })),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const holder = add(scene, new THREE.Group())
    const slotTags = SLOT_AT.map((at) => liveLabel(scene, [at[0], at[1] + 0.7, 0.3], { size: 0.3 }))
    const head = liveLabel(scene, [TABLE.x, TABLE.y, 0.3], { size: 0.3, align: 'left' })
    const rows = [0, 1, 2, 3].map((r) => liveLabel(scene, [TABLE.x, TABLE.y - (r + 1) * TABLE.dy, 0.3], { size: 0.3, align: 'left' }))
    const rowBar = glowBox(scene, [7.4, 0.8, 0.05], [TABLE.x + 3.5, TABLE.y - TABLE.dy, 0.05], LABEL, 0.12)
    const info = liveLabel(scene, [-7.6, -8.4, 0.3], { size: 0.3, align: 'left' })
    const info2 = liveLabel(scene, [-7.6, -9.4, 0.3], { size: 0.3, align: 'left' })
    const gG = windowGauge(scene, [5.4, -6.2, 0], 7.2, {
      min: 0,
      max: 8,
      window: [0, 4],
      caption: '',
      ticks: [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8 gates']],
    })
    const gCap = liveLabel(scene, [5.4 - 3.6, -6.2 + 2.05, 0.2], { size: 0.3, align: 'left' })
    const live = { key: '', net: null as ReturnType<typeof gateNet> | null, sim: netSettler([], GATE_DELAY_S), t: 0, bar: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = gxParams(p)
        const s = gxSolve(q)
        const g = GATE_GOALS[q.goal]
        const key = gxKey(q)
        if (key !== live.key) {
          live.key = key
          emptyGroup(holder)
          const net = drawn(s.net, s.slot)
          live.net = gateNet(holder, net, gxLayout(s.slot, net, s.out))
          live.sim = netSettler(net, GATE_DELAY_S)
          gG.setWindow(0, s.best.gates)
          gCap.set(`Gates (fewest that work: ${s.best.gates})`, LABEL)
          head.set('A  B   want   got', LABEL)
          s.rows.forEach((r, i) => rows[i].set(`${r.a}  ${r.b}      ${r.want}       ${r.got}   ${r.want === r.got ? 'ok' : 'wrong'}`, r.want === r.got ? POWER : HIGH_V))
          slotTags.forEach((t, i) => t.set(s.slot.includes(i) ? '' : `G${i + 1}: ${q.slots[i] === 'WIRE' ? 'wire' : 'unused'}`, GREY))
          info.set(`${plural(s.gates, 'gate')} on ${chipsText(s.chips)}`, LABEL)
          info2.set(`Settles in ${s.depth} × ${ns(HC_TIMING.tpd)} = ${ns(s.settleS)}${s.glitches ? ` · glitches on ${plural(s.glitches, 'step')}` : ''}`, s.glitches ? RING : LABEL)
        }
        live.t += dt
        const row = GATE_CYCLE[Math.floor(live.t / ROW_S) % 4]
        const st = live.sim.frame(dt, { A: bit(row >= 2), B: bit(row % 2) })
        live.net!.frame(dt, st.ins, st.gates)
        live.bar += (TABLE.y - (row + 1) * TABLE.dy - live.bar) * ease(dt, 10)
        rowBar.mesh.position.y = live.bar
        const v = s.verdict
        gG.set(s.gates, plural(s.gates, 'gate'), verdictTint(s.gates <= s.best.gates, true))
        const bad = s.rows.find((r) => r.want !== r.got)
        const why = {
          kit: s.offKit ? `G${s.offKit.slot + 1} is ${s.offKit.gate}: this kit is ${GATE_KITS[g.kit].name}` : '',
          table: bad ? `${s.right} of 4 rows right: A B = ${bad.a}${bad.b} gives ${bad.got}, want ${bad.want}` : '',
          gates: `Works, but ${plural(s.gates, 'gate')}: ${s.best.gates} can do it. Wire past the extras`,
        }
        header.set(
          `${g.text} from ${GATE_KITS[g.kit].name}, fewest gates`,
          v,
          v.fail ? why[v.fail] : `${plural(s.gates, 'gate')} on ${chipsText(s.chips)}, settles in ${ns(s.settleS)}`,
          GX_HINT[q.goal],
        )
      },
      readouts: (p) => {
        const q = gxParams(p)
        const s = gxSolve(q)
        return [
          { label: 'Rows right', value: `${s.right} of 4`, tone: toneOf(s.right === 4, s.right === 3) },
          { label: 'Gates · chips', value: `${s.gates} · ${chipsText(s.chips)}`, tone: toneOf(s.gates <= s.best.gates, true) },
          { label: 'Settle', value: `${ns(s.settleS)}${s.glitches ? ', glitches' : ''}`, tone: s.glitches ? 'warn' : 'ok' },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- Design a 2-bit counter: pick each flip-flop's next-state logic; check the sequence and the 74HC clock limit. ---

const CG_NAMES = namesOf(COUNTER_GOALS)
const D_NAMES = namesOf(D_LOGIC)
const CLOCK_NAMES = Object.fromEntries(Object.entries(COUNTER_CLOCKS).map(([k, hz]) => [k, si(hz, 'Hz')])) as Record<keyof typeof COUNTER_CLOCKS, string>
const cgParams = (p: Params) => ({
  goal: pick(CG_NAMES, p.goal, 'up') as CounterGoal,
  d0: pick(D_NAMES, p.d0, 'nq0') as DLogic,
  d1: pick(D_NAMES, p.d1, 'or') as DLogic,
  clk: pick(CLOCK_NAMES, p.clk, '1') as keyof typeof COUNTER_CLOCKS,
})
type CgQ = ReturnType<typeof cgParams>
const cgSolve = memoBy((q: CgQ) => `${q.goal}|${q.d0}|${q.d1}|${q.clk}`, (q: CgQ) => counterChallenge(q.goal, q.d0, q.d1, COUNTER_CLOCKS[q.clk]))
const two = (s: number) => `${bit(s >= 2)}${s % 2}`
const seqText = (seq: number[]) => seq.map(two).join(' → ')
const EDGE_S = 1.2
const FF_X = -4.6
const FF_Y = [0.4, -6.4]
const CG_HINT: Record<CounterGoal, string> = {
  up: 'Hint: Q0 flips on every edge; Q1 flips when Q0 = 1',
  down: 'Hint: Q0 flips on every edge; Q1 flips when Q0 = 0',
  gray: 'Hint: one bit changes per step; Q1 takes Q0’s value one edge later',
}

/** D logic for one flip-flop: a gate (or plain wire) from Q1 / Q0 net labels into D. `set(levels)` lights it. */
function dLogic(parent: THREE.Object3D, d: DLogic, dPin: V3) {
  const l = D_LOGIC[d]
  const y = dPin[1]
  const balls: { k: 'Q1' | 'Q0'; ball: ReturnType<typeof inBall>; wire: (v: number) => void }[] = []
  let gate: ReturnType<typeof gateSymbol> | null = null
  let out: ((v: number) => void) | null = null
  if (!l.gate) {
    const at: V3 = [-14.4, y, 0]
    balls.push({ k: l.in[0], ball: inBall(parent, l.in[0], at), wire: signalWire(parent, [at, dPin]) })
  } else {
    gate = gateSymbol(parent, [-10.6, y, 0], l.gate, { size: 2.2 })
    const pins = l.gate === 'NOT' ? [gate.pins.a] : [gate.pins.a, gate.pins.b]
    pins.forEach((pin, i) => {
      const at: V3 = [-14.4, pin[1] + (pins.length > 1 ? (i ? -0.5 : 0.5) : 0), 0]
      balls.push({ k: l.in[i], ball: inBall(parent, l.in[i], at), wire: signalWire(parent, [at, [pin[0] - 0.5, at[1], 0], [pin[0] - 0.5, pin[1], 0], pin]) })
    })
    out = signalWire(parent, [gate.pins.out, dPin])
  }
  return (q: Record<'Q1' | 'Q0', number>, dv: number) => {
    for (const b of balls) {
      b.ball.set(q[b.k])
      b.wire(q[b.k])
    }
    gate?.inputs(q[l.in[0]], q[l.in.at(-1)!])
    gate?.set(dv)
    out?.(dv)
  }
}

export const logicPuzzlesDesignA2BitCounter: Lesson = {
  id: 'logic-puzzles-design-a-2-bit-counter',
  title: 'Design a 2-bit counter',
  tagline: 'Pick the next-state logic for two D flip-flops so they count up, down or in Gray code, then clock it as fast as 74HC parts allow',
  formula: (p) => {
    const q = cgParams(p)
    const s = cgSolve(q)
    return `D1 = ${D_NAMES[q.d1]}, D0 = ${D_NAMES[q.d0]} · t_clk→Q + ${s.stages} × t_pd + t_su = ${ns(s.needS)} vs T = ${ns(s.period)} → f max ${si(s.fMax, 'Hz')}`
  },
  legend: LEGEND,
  points: [
    'The puzzle: two D flip-flops share one clock, so this is a synchronous counter. On each rising edge Q1 loads D1 and Q0 loads D0; you pick the logic that turns the present state (Q1, Q0) into the next one (Digital › Flip-flops & latches › D flip-flop).',
    'Write the table: present state → wanted next state, then read off each bit. Counting up, Q0 flips every edge (D0 = NOT Q0) and Q1 flips when Q0 is 1: D1 = Q1 XOR Q0. That’s a 1-bit adder per stage (Flip-flops & latches › Registers).',
    'Down counting flips Q1 when Q0 is 0 instead. Gray code (00, 01, 11, 10) changes one bit per step, so a slow reader never catches a half-changed value: that’s why encoders use it.',
    'Unlike the ripple counter, every bit changes on the same edge, with no 7 → 6 → 4 → 0 flicker in between (Counters & shift registers › Ripple counter).',
    'Speed limit: after an edge, Q takes t_clk→Q (14 ns), the logic t_pd per gate (8 ns), and D must be steady t_su (10 ns) before the next edge. One gate: 32 ns, ~31 MHz. Plain wires: 24 ns, ~42 MHz (Digital › Timing › Propagation delay).',
  ],
  controls: [
    { kind: 'choice', key: 'goal', options: opts(CG_NAMES), initial: 'up' },
    { kind: 'choice', key: 'd1', options: prefixed(D_NAMES, 'D1 = '), initial: 'or' },
    { kind: 'choice', key: 'd0', options: prefixed(D_NAMES, 'D0 = '), initial: 'nq0' },
    { kind: 'choice', key: 'clk', options: prefixed(CLOCK_NAMES, 'Clock '), initial: '1' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const holder = add(scene, new THREE.Group())
    const ffs = FF_Y.map((y) => flipFlopBlock(scene, [FF_X, y, 0], { w: 3.6, h: 4.2 }))
    ffs.forEach((f, i) => partLetter(scene, `FF${1 - i}`, [FF_X, FF_Y[i] + 2.7, 0.3], 0.7, GREY))
    const clkAt: V3 = [-14.4, -9.3, 0]
    const clkBall = inBall(scene, 'CLK', clkAt)
    const busX = FF_X - 3.2
    const clkWires = [
      signalWire(scene, [clkAt, [busX, clkAt[1], 0], [busX, ffs[0].pins.clk[1], 0], ffs[0].pins.clk]),
      signalWire(scene, [[busX, ffs[1].pins.clk[1], 0], ffs[1].pins.clk]),
    ]
    const leds = ffs.map((f, i) => ledOut(scene, f.pins.q, [i ? 0.6 : 2.2, f.pins.q[1], 0], `Q${1 - i}`))
    const count = segmentDisplay(1, 2.4, '#ff3b30', true)
    add(scene, count.group, [6.4, 1.6, 0])
    const countTag = liveLabel(scene, [6.4, -0.2, 0.3], { size: 0.3 })
    const wantTag = liveLabel(scene, [3.6, -1.6, 0.3], { size: 0.3, align: 'left' })
    const gotTag = liveLabel(scene, [3.6, -2.6, 0.3], { size: 0.3, align: 'left' })
    const tG = windowGauge(scene, [7.2, -6.2, 0], 8, {
      min: 0,
      max: 50e-9,
      window: [0, 25e-9],
      caption: '',
      ticks: [[0, '0'], [10e-9, '10'], [20e-9, '20'], [30e-9, '30'], [40e-9, '40'], [50e-9, '50 ns']],
    })
    const tCap = liveLabel(scene, [7.2 - 4, -6.2 + 2.05, 0.2], { size: 0.3, align: 'left' })
    const st = { key: '', logicKey: '', t: 0, state: 0, edges: 0, lv: [0, 0], clk: 0, draw: [] as ((q: Record<'Q1' | 'Q0', number>, dv: number) => void)[] }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = cgParams(p)
        const s = cgSolve(q)
        const key = `${q.goal}|${q.d0}|${q.d1}|${q.clk}`
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, state: 0, edges: 0 })
          const lk = `${q.d0}|${q.d1}`
          if (lk !== st.logicKey) {
            st.logicKey = lk
            emptyGroup(holder)
            st.draw = [dLogic(holder, q.d1, ffs[0].pins.d), dLogic(holder, q.d0, ffs[1].pins.d)]
          }
          tG.setWindow(0, Math.min(s.period, 50e-9))
          tCap.set(`Q → D + setup ≤ period (${ns(s.period)})`, LABEL)
          wantTag.set(`Want: ${seqText([...COUNTER_GOALS[q.goal].seq, 0])}`, LABEL)
          const got = s.run.slice(0, 5)
          gotTag.set(`Got:  ${seqText(got)}`, s.verdict.fail === 'sequence' ? (s.verdict.near ? RING : HIGH_V) : POWER)
        }
        st.t += dt
        const edges = Math.floor(st.t / EDGE_S)
        while (st.edges < edges) {
          st.state = s.next[st.state]
          st.edges++
        }
        const clk = bit(st.t % EDGE_S < EDGE_S / 2 && st.t >= EDGE_S / 2) as number
        st.clk += (clk - st.clk) * ease(dt, 14)
        const qs = [bit(st.state >= 2), bit(st.state % 2)]
        st.lv = st.lv.map((l, i) => l + (qs[i] - l) * ease(dt, 14))
        const lv = { Q1: st.lv[0], Q0: st.lv[1] }
        const dv = [Math.floor(s.next[st.state] / 2), s.next[st.state] % 2]
        st.draw.forEach((d, i) => d(lv, dv[i]))
        ffs.forEach((f, i) => f.set(st.lv[i], st.clk))
        leds.forEach((l, i) => l(dt, st.lv[i]))
        clkBall.set(st.clk)
        clkWires.forEach((w) => w(st.clk))
        count.set(String(st.state))
        countTag.set(`count ${two(st.state)}`, LABEL)
        tG.set(s.needS, ns(s.needS), verdictTint(s.slack >= 0, s.verdict.near))
        const v = s.verdict
        const why = {
          sequence: `From 00 it goes ${seqText(s.run.slice(0, 5))}: ${s.d1ok ? 'D1 is right, D0 isn’t' : s.d0ok ? 'D0 is right, D1 isn’t' : 'neither D is right yet'}`,
          timing: `At ${si(COUNTER_CLOCKS[q.clk], 'Hz')} the period is ${ns(s.period)}, the path needs ${ns(s.needS)}: D isn’t ready. Max ${si(s.fMax, 'Hz')}`,
        }
        header.set(
          `${COUNTER_GOALS[q.goal].name}: ${seqText(COUNTER_GOALS[q.goal].seq)} at ${si(COUNTER_CLOCKS[q.clk], 'Hz')} (74HC)`,
          v,
          v.fail ? why[v.fail] : `Counts right, ${ns(s.slack)} slack: good to ${si(s.fMax, 'Hz')}`,
          CG_HINT[q.goal],
        )
      },
      readouts: (p) => {
        const q = cgParams(p)
        const s = cgSolve(q)
        return [
          { label: 'Steps right', value: `${s.right} of 4`, tone: toneOf(s.right === 4, s.d0ok || s.d1ok) },
          { label: 'Path', value: `${ns(s.needS)} of ${ns(s.period)}`, tone: toneOf(s.slack >= 0, s.verdict.near) },
          { label: 'f max', value: si(s.fMax, 'Hz') },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}
