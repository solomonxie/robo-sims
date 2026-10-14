import * as THREE from 'three/webgpu'
import {
  Design,
  LUT3,
  LUT_K,
  bitstream,
  bitstreamLength,
  configLoad,
  counterDesign,
  fabricRun,
  ledPeriod,
  lutTable,
  muxPath,
  muxTree,
  ringDesign,
} from '../../core/fpga'
import { Bit, toBits } from '../../core/logic'
import { clockLevel, edgesBy } from '../../core/physics'
import { si } from '../../core/units'
import { V3, add, box, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  LABEL,
  RING,
  ease,
  emptyGroup,
  flipFlopBlock,
  glowMat,
  inBall,
  junction,
  ledOut,
  litWire,
  partLetter,
  potentialColor,
  signalWire,
  wire,
} from '../fx'
import { Lesson, Stage, n } from '../types'

const WIRES = { color: '#ff4d4d', label: 'Wires and bits: red = 1, blue = 0', shape: 'dot' } as const
const glide = (dt: number, from: number, to: number) => from + (to - from) * ease(dt, 14)
const DARK = '#2b3039'
const OFF = new THREE.Color('#1c1f25')
const GOLD = new THREE.Color(RING)

/** SRAM bit: a glowing cell with a 0/1 digit; `set(level, loaded, hot)` colours it by bit, dark until loaded. */
function sramCell(parent: THREE.Object3D, at: V3, size: [number, number], digits = 0) {
  const m = glowMat(DARK, 0.6)
  const cell = box(parent, [size[0], size[1], 0.5], m, at)
  const glyphs = digits ? ['0', '1'].map((t) => partLetter(parent, t, [at[0], at[1], at[2] + 0.3], digits, '#f2f4f8')) : []
  const c = new THREE.Color()
  return (level: number, loaded: boolean, hot: number) => {
    if (loaded) potentialColor(level, c)
    else c.copy(OFF)
    m.color.copy(c)
    m.emissive.copy(c).lerp(GOLD, 0.45 * hot)
    m.emissiveIntensity = loaded ? 0.35 + 0.5 * level + 0.8 * hot : 0
    cell.scale.setScalar(1 + 0.18 * hot)
    glyphs.forEach((g, i) => (g.visible = loaded && i === Math.round(level)))
  }
}

// --- LUTs: eight SRAM bits hold a 3-input truth table; the inputs steer a 2:1 mux tree to the one bit addressed. ---

type Fn = keyof typeof LUT3
const SRAM_X = -14
const MUX_X = [-6, 2, 10]
const MUX_W = 1.8
const SEL_Y = -12.6
const LED_AT: V3 = [16, 0, 0]
const SHIFT_DT = 0.22
const nodeY = (l: number, j: number) => 8.4 - 2.4 * (j * 2 ** l + (2 ** l - 1) / 2)
const muxH = (l: number) => (l === 1 ? 2.6 : 3.2)
const insOf = (abc: number) => toBits(abc, 3)
const cba = (abc: number) => insOf(abc).slice().reverse().join(' ')

function muxSymbol(parent: THREE.Object3D, at: V3, h: number) {
  const w = MUX_W / 2
  const shape = new THREE.Shape([new THREE.Vector2(-w, h / 2), new THREE.Vector2(w, 0.3 * h), new THREE.Vector2(w, -0.3 * h), new THREE.Vector2(-w, -h / 2)])
  add(parent, mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), glowMat('#5d6676', 0.3)), [at[0], at[1], -0.25])
  partLetter(parent, '0', [at[0] - w + 0.45, at[1] + h / 4, 0.4], 0.45, LABEL)
  partLetter(parent, '1', [at[0] - w + 0.45, at[1] - h / 4, 0.4], 0.45, LABEL)
}

function lutCircuit(parent: THREE.Object3D) {
  const cells = Array.from({ length: 8 }, (_, i) => {
    partLetter(parent, cba(i).replace(/ /g, ''), [SRAM_X - 1.8, nodeY(0, i), 0], 0.6, GREY, 'right')
    return sramCell(parent, [SRAM_X, nodeY(0, i), 0], [2.2, 1.8], 0.9)
  })
  partLetter(parent, 'CBA', [SRAM_X - 1.8, nodeY(0, 0) + 2, 0], 0.6, RING, 'right')
  const cfg = signalWire(parent, [[SRAM_X, nodeY(0, 0) + 3.4, -0.5], [SRAM_X, nodeY(0, 7), -0.5]])
  partLetter(parent, 'CFG', [SRAM_X, nodeY(0, 0) + 4.4, 0], 0.8, RING)
  const outOf = (l: number, j: number): V3 => (l ? [MUX_X[l - 1] + MUX_W / 2, nodeY(l, j), 0] : [SRAM_X + 1.1, nodeY(0, j), 0])
  for (let l = 1; l <= 3; l++) for (let j = 0; j < 2 ** (3 - l); j++) muxSymbol(parent, [MUX_X[l - 1], nodeY(l, j), 0], muxH(l))
  const segs = [0, 1, 2].map((l) =>
    Array.from({ length: 2 ** (3 - l) }, (_, s) => {
      const mx = MUX_X[l] - MUX_W / 2
      const pinY = nodeY(l + 1, Math.floor(s / 2)) + (s % 2 ? -1 : 1) * (muxH(l + 1) / 4)
      const from = outOf(l, s)
      const pts: V3[] = [from, [mx - 1.6, from[1], 0], [mx - 1.6, pinY, 0], [mx, pinY, 0]]
      return { level: signalWire(parent, pts), lit: litWire(parent, pts, 0.5) }
    }),
  )
  const sels = MUX_X.map((x, l) => {
    const ball = inBall(parent, 'ABC'[l], [x, SEL_Y, 0])
    const line = signalWire(parent, [[x, SEL_Y, 0], [x, nodeY(l + 1, 0), -0.5]])
    return (v: number) => {
      ball.set(v)
      line(v)
    }
  })
  const outPts: V3[] = [outOf(3, 0), [LED_AT[0] - 0.35, 0, 0]]
  const outLit = litWire(parent, outPts, 0.5)
  const led = ledOut(parent, outOf(3, 0), LED_AT, 'out')
  const ring = new THREE.Color(RING)
  return {
    set(dt: number, bits: number[], levels: number[][], path: number[], hot: number, ins: number[], cfgLevel: number) {
      cells.forEach((c, i) => c(bits[i], true, i === path[0] ? hot : 0))
      segs.forEach((row, l) =>
        row.forEach((sg, s) => {
          sg.level(levels[l][s])
          sg.lit.set(s === path[l] ? hot : 0, ring)
        }),
      )
      sels.forEach((f, l) => f(ins[l]))
      outLit.set(hot, ring)
      cfg(cfgLevel)
      led(dt, levels[3][0])
    },
  }
}

export const luts: Lesson = {
  id: 'fpga-basics-luts',
  title: 'LUTs',
  tagline: 'A truth table you can rewrite',
  formula: (p) => {
    const f = LUT3[p.fn as Fn]
    const abc = n(p, 'abc')
    const table = lutTable(3, f.fn)
    return `out = SRAM[4C + 2B + A] = SRAM[${abc}] = ${table[abc]} · ${f.name}: ${f.text} → bits 0…7 = ${table.join('')}`
  },
  legend: [
    { color: RING, label: 'A, B, C = inputs; gold = the path being read', shape: 'dot' },
    WIRES,
    { color: GREY, label: 'CFG = config chain that writes the bits', shape: 'arrow-right' },
  ],
  points: [
    'An FPGA has no fixed gates. Its logic is made of look-up tables: a LUT with k inputs is just 2^k memory bits plus a tree of 2:1 multiplexers.',
    'The inputs are an address. A picks between neighbouring bits, B between those pairs, C between the halves, so exactly one bit reaches the output. Whatever is stored there is the answer.',
    'So any function of three inputs is just eight bits: write the truth table into the SRAM and the LUT becomes that gate. Pick another function and watch the new bits shift in through the config chain.',
    'Nothing is computed: AND, XOR and majority all take the same time, one trip through the mux tree. Real FPGAs use 4- or 6-input LUTs (16 or 64 bits); bigger functions are split over several LUTs.',
    'Because the bits live in SRAM, they vanish at power-off. An FPGA loads them again from a flash chip every time it boots.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'fn',
      options: (Object.keys(LUT3) as Fn[]).map((k) => ({ value: k, label: LUT3[k].name })),
      initial: 'maj',
    },
    { kind: 'slider', key: 'abc', label: 'Inputs C B A', min: 0, max: 7, initial: 5, step: 1, format: (v) => cba(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const ui = lutCircuit(scene)
    const s = { fn: '', from: [] as Bit[], bits: [] as Bit[], target: [] as Bit[], shift: 8, tShift: 0, lv: null as number[][] | null, ins: [0, 0, 0], hot: 0 }
    return {
      scene,
      view: { center: [1, -0.6, 0], radius: 74, polar: 1.5, azimuth: 0.05 },
      frame(dt, p) {
        const fn = p.fn as Fn
        if (fn !== s.fn) {
          const next = lutTable(3, LUT3[fn].fn)
          Object.assign(s, { from: s.fn ? s.bits : (Array(8).fill(0) as Bit[]), shift: 0, tShift: 0 })
          if (!s.fn) s.bits = s.from
          Object.assign(s, { fn, target: next })
        }
        if (s.shift < 8) {
          s.tShift += dt
          if (s.tShift >= SHIFT_DT) {
            s.tShift -= SHIFT_DT
            s.shift++
            s.bits = configLoad(s.from, s.target, s.shift)
          }
        }
        const ins = insOf(n(p, 'abc'))
        const levels = muxTree(s.bits, ins)
        s.lv = (s.lv ?? levels).map((row, l) => row.map((v, i) => glide(dt, v, levels[l][i])))
        s.ins = s.ins.map((v, i) => glide(dt, v, ins[i]))
        s.hot = glide(dt, s.hot, s.shift < 8 ? 0.25 : 1)
        const entering = s.shift < 8 ? s.target[7 - s.shift] : 0
        ui.set(dt, s.lv[0], s.lv, muxPath(ins), s.hot, s.ins, entering)
      },
      readouts: (p) => {
        const abc = n(p, 'abc')
        const out = lutTable(3, LUT3[p.fn as Fn].fn)[abc]
        return [
          { label: 'Function', value: LUT3[p.fn as Fn].name },
          { label: 'C B A', value: cba(abc) },
          { label: 'Reads bit', value: `${abc}` },
          { label: 'Out', value: `${out}`, tone: out ? 'ok' : undefined },
        ]
      },
    }
  },
}

// --- Blinky in hardware: a bitstream programs four LUT + flip-flop blocks and their routing into a counter; one bit lights the LED. ---

const NB = 4
const CLB_X = (i: number) => -21 + i * 12
const TRACK_Y = (t: number) => 6 + 1.6 * t
const TOP = TRACK_Y(NB - 1) + 0.8
const PIN_Y = 2.4
const CFG_Y = -8.4
const BUS = -5.6
const IO_X = 23
const LED2: V3 = [27.4, 0.6, 0]
const CFG_RATE = 60
const CLK_P = 0.8
const BOARD_HZ = 12e6
const CLB_BITS = 2 ** LUT_K + LUT_K * NB
const pinX = (i: number, k: number) => CLB_X(i) - 2.4 + (k - 1.5) * 1.1
const designOf = (p: Record<string, unknown>): Design => (p.design === 'ring' ? ringDesign : counterDesign)(NB, Number(p.led))
const cfgSecs = bitstreamLength(NB) / CFG_RATE
const stateText = (q: Bit[]) => q.slice().reverse().join('')

function crosspoint(parent: THREE.Object3D, at: V3) {
  const m = glowMat(GREY, 0.2)
  const ball = add(parent, mesh(new THREE.SphereGeometry(0.26, 16, 12), m), at)
  return (closed: number, loaded: boolean) => {
    m.color.set(loaded && closed ? RING : loaded ? '#4a505b' : '#262a31')
    m.emissive.copy(m.color)
    m.emissiveIntensity = loaded && closed ? 1.1 : 0.1
    ball.scale.setScalar(loaded && closed ? 1.5 : 1)
  }
}

function fabric(parent: THREE.Object3D, d: Design) {
  const bits = bitstream(d)
  const tracks = Array.from({ length: NB }, (_, t) => {
    partLetter(parent, `Q${t}`, [-27.4, TRACK_Y(t), 0], 0.7, RING, 'right')
    return signalWire(parent, [[-26.6, TRACK_Y(t), 0], [IO_X, TRACK_Y(t), 0]])
  })
  const clkBall = inBall(parent, 'CLK', [-27, BUS, 0])
  const bus = signalWire(parent, [[-27, BUS, 0], [CLB_X(NB - 1), BUS, 0]])
  const clbs = d.clbs.map((c, i) => {
    const x = CLB_X(i)
    box(parent, [10.4, 8, 0.4], new THREE.MeshStandardMaterial({ color: '#191c22', roughness: 0.6 }), [x, -0.3, -0.7])
    partLetter(parent, `CLB ${i}`, [x + 2.9, -3.3, 0], 0.6, GREY)
    partLetter(parent, 'LUT', [x - 2.4, -2.7, 0], 0.55, LABEL)
    const cells = Array.from({ length: 2 ** LUT_K }, (_, a) => sramCell(parent, [pinX(i, a % 4), 0.2 + (1.5 - Math.floor(a / 4)) * 1.1, 0], [0.85, 0.85]))
    const ff = flipFlopBlock(parent, [x + 2.9, 0.3, 0], { w: 3.2, h: 4.4 })
    const dWire = signalWire(parent, [[x - 0.4, ff.pins.d[1], 0], ff.pins.d])
    const clk = signalWire(parent, [[x, BUS, 0], [x, ff.pins.clk[1], 0], ff.pins.clk])
    const cfg = signalWire(parent, [[x + 4.6, CFG_Y, 0], [x + 4.6, -4.3, 0]])
    junction(parent, [x + 4.6, CFG_Y, 0], 0.3)
    const qx = x + 5.9
    const q = signalWire(parent, [ff.pins.q, [qx, ff.pins.q[1], 0], [qx, TRACK_Y(i), 0]])
    junction(parent, [qx, TRACK_Y(i), 0], 0.3)
    const pins = Array.from({ length: LUT_K }, (_, k) => {
      wire(parent, [[pinX(i, k), PIN_Y, 0], [pinX(i, k), TOP, 0]], 0.1)
      const src = c.ins[k]
      const g = add(parent, new THREE.Group())
      const level = src < 0 ? null : signalWire(g, [[pinX(i, k), PIN_Y, 0], [pinX(i, k), TRACK_Y(src), 0]])
      const xs = Array.from({ length: NB }, (_x, t) => crosspoint(parent, [pinX(i, k), TRACK_Y(t), 0.2]))
      return { g, src, level, xs }
    })
    return { cells, ff, dWire, clk, cfg, q, pins }
  })
  wire(parent, [[IO_X, TOP, 0], [IO_X, LED2[1], 0]], 0.1)
  const ioXs = Array.from({ length: NB }, (_, t) => crosspoint(parent, [IO_X, TRACK_Y(t), 0.2]))
  const ioG = add(parent, new THREE.Group())
  const ioLine = signalWire(ioG, [[IO_X, TRACK_Y(d.led), 0], [IO_X, LED2[1], 0]])
  const led = ledOut(parent, [IO_X, LED2[1], 0], LED2, 'LED')
  const cfgBall = inBall(parent, 'CFG', [-27, CFG_Y, 0])
  const cfgLine = signalWire(parent, [[-27, CFG_Y, 0], [CLB_X(NB - 1) + 4.6, CFG_Y, 0]])
  return {
    set(dt: number, loaded: number, q: number[], dLv: number[], clkLv: number, addr: number[]) {
      const on = (b: number) => b < loaded
      const running = loaded >= bits.length
      clkBall.set(clkLv)
      bus(clkLv)
      const cfgBit = running ? 0 : bits[Math.floor(loaded)]
      cfgBall.set(cfgBit)
      cfgLine(cfgBit)
      tracks.forEach((w, t) => w(q[t]))
      clbs.forEach((c, i) => {
        const base = i * CLB_BITS
        c.cells.forEach((cell, a) => cell(bits[base + a], on(base + a), running && a === addr[i] ? 1 : 0))
        c.ff.set(q[i], clkLv)
        c.dWire(dLv[i])
        c.clk(clkLv)
        c.cfg(Math.floor(loaded / CLB_BITS) === i ? cfgBit : 0)
        c.q(q[i])
        c.pins.forEach((pin, k) => {
          const at = base + 2 ** LUT_K + k * NB
          pin.xs.forEach((x, t) => x(bits[at + t], on(at + t)))
          pin.g.visible = pin.src >= 0 && on(at + pin.src)
          pin.level?.(q[pin.src])
        })
      })
      const io = NB * CLB_BITS
      ioXs.forEach((x, t) => x(bits[io + t], on(io + t)))
      ioG.visible = on(io + d.led)
      ioLine(q[d.led])
      led(dt, running ? q[d.led] : 0)
    },
  }
}

export const blinkyInHardware: Lesson = {
  id: 'fpga-basics-blinky-in-hardware',
  title: 'Blinky in hardware',
  tagline: 'A bitstream wires up a counter',
  formula: (p) => {
    const d = designOf(p)
    const per = ledPeriod(d)
    return p.design === 'ring'
      ? `Q_i ← Q_(i−1) every clock · one 1 circles 4 flip-flops · LED = Q${d.led}: on 1 clock in ${per}`
      : `Q ← Q + 1 every clock · Q${d.led} toggles every 2^${d.led} clocks · LED period = 2^${d.led + 1} = ${per} clocks`
  },
  legend: [
    { color: RING, label: 'Gold dot = routing switch closed by the bitstream', shape: 'dot' },
    WIRES,
    { color: GREY, label: 'CLB = LUT + flip-flop; Q0…Q3 = routing tracks', shape: 'arrow-right' },
  ],
  points: [
    'An FPGA is a sea of identical logic blocks (CLBs), each a LUT feeding a flip-flop, inside a grid of routing wires. Nothing is connected until the chip is configured.',
    `At power-up a bitstream streams in: each LUT’s truth table, one bit per routing switch (closed = gold) and the flip-flops’ start values. Here that is ${bitstreamLength(NB)} bits; a real iCE40 needs about 100 000.`,
    'For a counter, block i reads tracks Q0…Qi and its LUT says: flip my bit when all lower bits are 1. Every flip-flop shares one clock, so the whole count changes on the same edge.',
    'Route a higher bit to the LED pad and it blinks slower: bit k flips every 2^k clocks. On a 12 MHz board, blinky routes bit 23 of a 24-bit counter: 12 MHz / 2^24 ≈ 0.7 Hz.',
    'Switch to the ring: the same blocks get new LUT bits and new switches and become a shift ring. Different hardware, same chip, no soldering. That is what “programming” an FPGA means.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'design',
      options: [
        { value: 'counter', label: 'Counter' },
        { value: 'ring', label: 'Ring' },
      ],
      initial: 'counter',
    },
    { kind: 'slider', key: 'led', label: 'LED on', min: 0, max: NB - 1, initial: 1, step: 1, format: (v) => `Q${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const s = {
      key: '',
      t: 0,
      run: [] as Bit[][],
      d: null as Design | null,
      q: [] as number[],
      dl: [] as number[],
      c: 0,
      now: [] as Bit[],
      ui: null as ReturnType<typeof fabric> | null,
    }
    return {
      scene,
      view: { center: [0.4, 6.4, 0], radius: 108, polar: 1.48, azimuth: 0.05 },
      frame(dt, p) {
        const key = `${p.design}|${p.led}`
        if (key !== s.key) {
          emptyGroup(holder)
          const d = designOf(p)
          Object.assign(s, { key, t: 0, d, run: fabricRun(d, 2 ** NB), q: Array(NB).fill(0), dl: Array(NB).fill(0), c: 0, ui: fabric(holder, d) })
        }
        s.t += dt
        const d = s.d!
        const loaded = s.t * CFG_RATE
        const tr = s.t - cfgSecs - CLK_P / 2
        const running = tr >= -CLK_P / 2
        const edges = edgesBy(tr, CLK_P)
        const q = running ? s.run[edges % 2 ** NB] : (Array(NB).fill(0) as Bit[])
        const next = running ? s.run[(edges + 1) % 2 ** NB] : q
        s.now = q
        const addr = d.clbs.map((c) => c.ins.reduce((a, t, k) => a + (t < 0 ? 0 : q[t]) * 2 ** k, 0))
        s.q = s.q.map((v, i) => glide(dt, v, q[i]))
        s.dl = s.dl.map((v, i) => glide(dt, v, next[i]))
        s.c = glide(dt, s.c, running ? clockLevel(tr, CLK_P) : 0)
        s.ui!.set(dt, loaded, s.q, s.dl, s.c, addr)
      },
      readouts: (p) => {
        const d = designOf(p)
        const per = ledPeriod(d)
        return [
          { label: 'Bitstream', value: `${Math.min(Math.floor(s.t * CFG_RATE), bitstreamLength(NB))} / ${bitstreamLength(NB)} bits` },
          { label: 'LED period', value: `${per} clocks` },
          { label: 'At 12 MHz', value: si(BOARD_HZ / per, 'Hz'), tone: 'ok' },
          { label: 'Q3…Q0', value: s.now.length ? stateText(s.now) : stateText(d.init) },
        ]
      },
    }
  },
}
