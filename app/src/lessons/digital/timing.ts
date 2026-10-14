import * as THREE from 'three/webgpu'
import {
  TimingPath,
  WATCH_HZ,
  captureImbalance,
  clockLevel,
  divideBy,
  edgesBy,
  expectedCapture,
  maxClock,
  metastableLevel,
  pathAt,
  pathDelay,
  pathSlack,
  resolveTime,
  syncMtbf,
} from '../../core/physics'
import { secs, sci, si } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HIGH_V,
  LABEL,
  LED_RED,
  POWER,
  RING,
  ease,
  emptyGroup,
  flipFlopBlock,
  gateSymbol,
  glowMat,
  groundSymbol,
  hc49Crystal,
  inBall,
  junction,
  ledOut,
  partLetter,
  potentialColor,
  segmentDisplay,
  signalWire,
  timingDiagram,
} from '../fx'
import { Lesson, Stage, n } from '../types'

const WIRES = { color: '#ff4d4d', label: 'Wires: red = 1, blue = 0; LED on = 1', shape: 'dot' } as const
const CLK_COLOR = '#5ad8e6'
const D_COLOR = '#b48cff'
const glide = (dt: number, from: number, to: number) => from + (to - from) * ease(dt, 14)

/** Toggle flip-flop: Q̄ from a NOT gate above the block feeds D back. Returns the Q and Q̄ wires and the q branch x. */
function toggleLoop(parent: THREE.Object3D, b: ReturnType<typeof flipFlopBlock>, x: number, notY: number) {
  const g = gateSymbol(parent, [x, notY, 0], 'NOT', { size: 2.8, stub: 0.8 })
  g.group.rotation.z = Math.PI
  const flip = (p: V3): V3 => [2 * x - p[0], 2 * notY - p[1], 0]
  const qx = x + 3.6
  const back = x - 3.6
  const q = signalWire(parent, [b.pins.q, [qx, b.pins.q[1], 0], [qx, notY, 0], flip(g.pins.a)])
  const tap = junction(parent, [qx, b.pins.q[1], 0], 0.4)
  const nq = signalWire(parent, [flip(g.pins.out), [back, notY, 0], [back, b.pins.d[1], 0], b.pins.d])
  return {
    qx,
    set(level: number) {
      q(level)
      tap.set(level)
      nq(1 - level)
      g.set(1 - level)
      g.inputs(level, 0)
    },
  }
}

/** Glow ball that flashes green (ok) or red (missed) and fades. */
function verdictLamp(parent: THREE.Object3D, at: V3) {
  const m = glowMat(GREY, 0.2)
  add(parent, new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), m), at)
  const s = { flash: 0 }
  return {
    fire(ok: boolean) {
      m.color.set(ok ? POWER : HIGH_V)
      m.emissive.set(ok ? POWER : HIGH_V)
      s.flash = 1
    },
    frame(dt: number) {
      s.flash *= Math.exp(-dt * 1.5)
      m.emissiveIntensity = 0.15 + 1.4 * s.flash
    },
  }
}

// --- Propagation delay: a launch flip-flop, a chain of inverters and a capture flip-flop on one clock. ---

const HC = { tcq: 14e-9, tpd: 8e-9, tsu: 10e-9 }
const NS_S = 0.05
const ns = (s: number) => `${+(s * 1e9).toFixed(1)} ns`
const pdPath = (p: Record<string, unknown>): TimingPath => ({ ...HC, period: 1e-6 / Number(p.mhz), stages: Number(p.stages) })
const LX = -22
const CX = 22
const PD_Y = 1.6
const PD_BUS = -4.6

function pdCircuit(parent: THREE.Object3D, stages: number) {
  const launch = flipFlopBlock(parent, [LX, 0, 0])
  const capture = flipFlopBlock(parent, [CX, 0, 0])
  const loop = toggleLoop(parent, launch, LX, 6)
  const gap = 28 / stages
  const gates = Array.from({ length: stages }, (_, k) => {
    const x = -14 + (k + 0.5) * gap
    return gateSymbol(parent, [x, PD_Y, 0], 'NOT', { size: 2.6, stub: 0.8 })
  })
  const ends: V3[] = [[loop.qx, PD_Y, 0], ...gates.map((g) => g.pins.out)]
  const sinks: V3[] = [...gates.map((g) => g.pins.a), capture.pins.d]
  const nodes = ends.map((e, k) => signalWire(parent, [e, sinks[k]]))
  const clkBall = inBall(parent, 'CLK', [-27.5, PD_BUS, 0])
  const bus = signalWire(parent, [[-27.5, PD_BUS, 0], [CX - 4, PD_BUS, 0]])
  const drops = [LX, CX].map((x, i) => signalWire(parent, [[x - 4, PD_BUS, 0], [x - 4, -1.6, 0], (i ? capture : launch).pins.clk]))
  const tap = junction(parent, [LX - 4, PD_BUS, 0], 0.4)
  const led = ledOut(parent, capture.pins.q, [CX + 5.2, PD_Y, 0], 'Q2')
  partLetter(parent, 'Q1', [loop.qx + 0.6, 7.6, 0], 0.9, RING)
  const verdict = verdictLamp(parent, [CX, 5.2, 0])
  return {
    verdict,
    set(dt: number, lv: number[], clk: number, cap: number) {
      clkBall.set(clk)
      tap.set(clk)
      bus(clk)
      drops.forEach((d) => d(clk))
      loop.set(lv[0])
      nodes.forEach((w, k) => w(lv[k]))
      gates.forEach((g, k) => {
        g.inputs(lv[k], 0)
        g.set(lv[k + 1])
      })
      launch.set(lv[0], clk)
      capture.set(cap, clk)
      led(dt, cap)
      verdict.frame(dt)
    },
  }
}

export const propagationDelay: Lesson = {
  id: 'timing-propagation-delay',
  title: 'Propagation delay',
  tagline: 'Every gate is a little late',
  formula: (p) => {
    const path = pdPath(p)
    return `f_max = 1 / (t_clk→Q + N · t_pd + t_su) = 1 / (14 + ${path.stages} × 8 + 10 ns) = ${si(maxClock(HC.tcq, path.stages * HC.tpd, HC.tsu), 'Hz')}`
  },
  legend: [
    { color: RING, label: `CLK = clock; inverters ${ns(HC.tpd)} each`, shape: 'dot' },
    WIRES,
    { color: POWER, label: 'Ball: green = caught, red = missed', shape: 'dot' },
  ],
  points: [
    'A gate’s output is a node with capacitance: wires, the next gates’ inputs. Its transistors have to charge or drain that through their on-resistance, so every change comes out a few nanoseconds late. That is the propagation delay t_pd.',
    'Here a 74HC flip-flop launches a new bit on each clock edge (it toggles), it walks through a chain of 74HC04 inverters, and a second flip-flop captures it on the next edge. Watch each wire change one delay after the one before.',
    'The capture flip-flop needs D steady a setup time t_su before its edge. So one clock period must cover t_clk→Q + all the logic delays + t_su. The slowest such path in a chip sets its top clock speed.',
    'Add inverters or raise the clock until the slack goes negative: the bit arrives after the edge, the capture flip-flop keeps the old value and the ball turns red. Real chips fail exactly like this when overclocked.',
    `Typical 74HC numbers at 5 V: t_clk→Q ${ns(HC.tcq)}, t_pd ${ns(HC.tpd)}, t_su ${ns(HC.tsu)}. 1 ns is shown as ${NS_S} s (${sci(NS_S / 1e-9, 2)} × slower).`,
  ],
  controls: [
    { kind: 'slider', key: 'stages', label: 'Inverters', min: 1, max: 6, initial: 4, step: 1, format: (v) => `${v}` },
    { kind: 'slider', key: 'mhz', label: 'Clock', min: 8, max: 40, initial: 12, step: 1, format: (v) => `${v} MHz` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const scope = timingDiagram(scene, [0, -15, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'Q1', color: D_COLOR },
      { label: 'd2', color: RING },
      { label: 'Q2', color: LED_RED },
    ], { width: 44, rowH: 3 })
    const s = { key: '', t: 0, m: -1, lv: [] as number[], clk: 0, cap: 0, ui: null as ReturnType<typeof pdCircuit> | null }
    return {
      scene,
      view: { center: [-0.6, -2.4, 0], radius: 100, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const path = pdPath(p)
        const key = `${p.stages}|${p.mhz}`
        if (key !== s.key) {
          emptyGroup(holder)
          const at0 = pathAt(path, 0)
          Object.assign(s, { key, t: 0, m: -1, lv: at0.nodes.slice(), clk: at0.clk, cap: at0.capture, ui: pdCircuit(holder, path.stages) })
        }
        s.t += dt
        const tReal = (s.t / NS_S) * 1e-9
        const at = pathAt(path, tReal)
        const m = edgesBy(tReal - path.tcq, path.period) - 1
        if (m > s.m) {
          s.m = m
          if (m > 0) s.ui!.verdict.fire(at.capture === expectedCapture(path, m))
        }
        s.lv = s.lv.map((l, k) => glide(dt, l, at.nodes[k]))
        s.clk = glide(dt, s.clk, at.clk)
        s.cap = glide(dt, s.cap, at.capture)
        s.ui!.set(dt, s.lv, s.clk, s.cap)
        scope.frame(dt, [at.clk, at.nodes[0], at.nodes[path.stages], at.capture])
      },
      readouts: (p) => {
        const path = pdPath(p)
        const slack = pathSlack(path)
        return [
          { label: 'Path delay', value: ns(pathDelay(path)) },
          { label: 'Period', value: ns(path.period) },
          { label: 'Slack', value: ns(slack), tone: slack >= 0 ? 'ok' : 'warn' },
          { label: 'f max', value: si(maxClock(HC.tcq, path.stages * HC.tpd, HC.tsu), 'Hz') },
        ]
      },
    }
  },
}

// --- Metastability: a D edge right at the clock edge balances the latch on a knife edge; it resolves as e^(t/τ). ---

const T_PS = 1000
const TAU_PS = 30
const WIN_PS = 30
const READ_PS = 300
const F_DATA = 1e7
const NOISE = 1e-6
const PS_S = 0.006
const YEAR = 3.156e7
const budget = (p: Record<string, unknown>) => READ_PS + (p.sync === '2' ? T_PS : 0)
const life = (s: number) => (s < YEAR ? secs(s) : `${sci(s / YEAR, 2)} years`)
const edgeAt = (k: number) => (k + 0.25) * T_PS
const dAt = (t: number, off: number) => edgesBy(t - edgeAt(0) - off, T_PS) % 2
const HILL = { x: 16.8, y: -1.8, a: 5.4, h: 4, r: 0.8 }
const hillY = (u: number) => HILL.h * (1 - u * u) ** 2

function hill(parent: THREE.Object3D) {
  const pts = Array.from({ length: 81 }, (_, i) => {
    const u = -1.22 + (2.44 * i) / 80
    return new THREE.Vector3(HILL.x + HILL.a * u, HILL.y + hillY(u), 0)
  })
  const track = new THREE.MeshStandardMaterial({ color: '#59606c', metalness: 0.4, roughness: 0.4 })
  add(parent, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.22, 10), track), [0, 0, 0])
  const ballMat = glowMat(HIGH_V, 0.8)
  const ball = add(parent, new THREE.Mesh(new THREE.SphereGeometry(HILL.r, 28, 18), ballMat), [HILL.x, HILL.y, 0])
  partLetter(parent, '0', [HILL.x - HILL.a, HILL.y - 1.6, 0], 1.1, LABEL)
  partLetter(parent, '1', [HILL.x + HILL.a, HILL.y - 1.6, 0], 1.1, LABEL)
  partLetter(parent, 'Q1', [HILL.x, HILL.y + HILL.h + 2.4, 0], 0.9, RING)
  return (level: number) => {
    const u = 2 * level - 1
    const slope = (-4 * HILL.h * u * (1 - u * u)) / HILL.a
    const k = (0.22 + HILL.r) / Math.hypot(1, slope)
    ball.position.set(HILL.x + HILL.a * u - slope * k, HILL.y + hillY(u) + k, 0)
    potentialColor(level, ballMat.color)
    ballMat.emissive.copy(ballMat.color)
  }
}

function syncCircuit(parent: THREE.Object3D, two: boolean) {
  const ffs = (two ? [-14, -2] : [-14]).map((x) => flipFlopBlock(parent, [x, 3, 0]))
  const dBall = inBall(parent, 'D', [-26, 4.6, 0])
  const dWire = signalWire(parent, [[-26, 4.6, 0], ffs[0].pins.d])
  const cBall = inBall(parent, 'CLK', [-26, -1, 0])
  const last = ffs.at(-1)!
  const bus = signalWire(parent, [[-26, -1, 0], [last.pins.clk[0] - 1.4, -1, 0]])
  const drops = ffs.map((b) => signalWire(parent, [[b.pins.clk[0] - 1.4, -1, 0], [b.pins.clk[0] - 1.4, b.pins.clk[1], 0], b.pins.clk]))
  const tap = two ? junction(parent, [ffs[0].pins.clk[0] - 1.4, -1, 0], 0.4) : null
  const link = two ? signalWire(parent, [ffs[0].pins.q, ffs[1].pins.d]) : null
  const lampAt: V3 = [7, 4.6, 0]
  const out = signalWire(parent, [last.pins.q, [lampAt[0] - 0.9, 4.6, 0]])
  const verdict = verdictLamp(parent, lampAt)
  ffs.forEach((_, i) => partLetter(parent, `Q${i + 1}`, [ffs[i].pins.q[0] + 0.4, 6.6, 0], 0.9, RING))
  return {
    verdict,
    set(dt: number, d: number, c: number, qs: number[]) {
      dBall.set(d)
      dWire(d)
      cBall.set(c)
      tap?.set(c)
      bus(c)
      drops.forEach((w) => w(c))
      link?.(qs[0])
      out(qs.at(-1)!)
      ffs.forEach((b, i) => b.set(qs[i], c))
      verdict.frame(dt)
    },
  }
}

export const metastability: Lesson = {
  id: 'timing-metastability',
  title: 'Metastability',
  tagline: 'A ball balanced on a hill',
  formula: (p) =>
    `Q1 = ½ + Δv₀ · e^(t/τ) · τ = ${TAU_PS} ps · resolve time = τ · ln(½ / Δv₀) · MTBF = e^(t_r/τ) / (T₀ · f_clk · f_data)` +
    (p.sync === '2' ? ' · second flip-flop adds a whole clock period' : ''),
  legend: [
    { color: RING, label: 'D = async input, CLK = 1 GHz clock', shape: 'dot' },
    WIRES,
    { color: POWER, label: `Lamp: read ${READ_PS} ps after the edge; red = undecided`, shape: 'dot' },
  ],
  points: [
    'Inside a flip-flop is a latch: two inverters in a loop. It has two stable states, like a ball resting in one of two valleys, and one unstable balance point between them, the hilltop.',
    'If D changes well before the clock edge, the latch is pushed hard into the new valley; well after, it stays in the old one. Change D inside the tiny setup/hold window and the latch is left almost on the hilltop.',
    `From there the loop’s gain pulls it off as e^(t/τ), τ ≈ ${TAU_PS} ps here. The closer to balance, the longer it hovers: each 10× smaller push adds τ · ln 10 ≈ ${Math.round(TAU_PS * Math.log(10))} ps. Exactly on the edge only noise decides, and which way it falls is random.`,
    'Buttons, sensors and other chips’ signals are asynchronous: sooner or later one lands on the edge. If logic reads Q1 while it is still in between, different gates can see different values.',
    `The cure is a synchroniser: a second flip-flop that waits one more clock before anyone reads it. That extra ${T_PS} ps of resolve time multiplies the mean time between failures by e^(${T_PS}/${TAU_PS}). 1 ps is shown as ${PS_S} s.`,
  ],
  controls: [
    { kind: 'slider', key: 'off', label: 'D edge vs clock', min: -60, max: 60, initial: 0, step: 1, format: (v) => `${v > 0 ? '+' : ''}${v} ps` },
    {
      kind: 'choice',
      key: 'sync',
      options: [
        { value: '1', label: '1 flip-flop' },
        { value: '2', label: '2-stage synchroniser' },
      ],
      initial: '1',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const holder = add(scene, new THREE.Group())
    const ball = hill(scene)
    const latch = { dv: -0.5, at: 0 }
    const s = {
      key: '',
      t: 0,
      k: -1,
      read: Infinity,
      q: [latch, { ...latch }],
      lv: [0, 0, 0, 0],
      ui: null as ReturnType<typeof syncCircuit> | null,
      scope: null as ReturnType<typeof timingDiagram> | null,
    }
    const level = (q: typeof latch, t: number) => metastableLevel(t - q.at, q.dv, TAU_PS)
    return {
      scene,
      view: { center: [-2, -2, 0], radius: 90, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const two = p.sync === '2'
        const off = n(p, 'off')
        const key = `${p.sync}|${off}`
        if (key !== s.key) {
          emptyGroup(holder)
          s.ui = syncCircuit(holder, two)
          s.scope = timingDiagram(holder, [-2, -12.4, 0], [
            { label: 'CLK', color: CLK_COLOR },
            { label: 'D', color: D_COLOR },
            { label: 'Q1', color: LED_RED },
            ...(two ? [{ label: 'Q2', color: LED_RED }] : []),
          ], { width: 44, rowH: 2.2 })
          Object.assign(s, { key, t: 0, k: -1, read: Infinity, q: [{ ...latch }, { ...latch }], lv: [0, 0, 0, 0] })
        }
        s.t += dt
        const t = s.t / PS_S
        for (; edgeAt(s.k + 1) <= t; s.k++) {
          const e = edgeAt(s.k + 1)
          const q2 = { dv: level(s.q[0], e) - 0.5, at: e }
          const toward = (s.k + 2) % 2 ? 1 : -1
          const dv = captureImbalance(off, WIN_PS) + (Math.random() - 0.5) * 2 * NOISE
          s.q = [{ dv: toward * dv, at: e }, q2]
          s.read = e + READ_PS
        }
        const qs = [level(s.q[0], t), level(s.q[1], t)].slice(0, two ? 2 : 1)
        if (t >= s.read) {
          s.ui!.verdict.fire(Math.abs(qs.at(-1)! - 0.5) > 0.4)
          s.read = Infinity
        }
        const c = clockLevel(t - edgeAt(0), T_PS)
        const d = dAt(t, off)
        s.lv = [c, d, ...qs].map((v, i) => glide(dt, s.lv[i] ?? v, v))
        ball(qs[0])
        s.ui!.set(dt, s.lv[1], s.lv[0], qs)
        s.scope!.frame(dt, [c, d, ...qs])
      },
      readouts: (p) => {
        const off = n(p, 'off')
        const dv = Math.max(Math.abs(captureImbalance(off, WIN_PS)), NOISE / 2)
        const tr = resolveTime(dv, TAU_PS)
        const b = budget(p)
        return [
          { label: 'D edge', value: `${off > 0 ? '+' : ''}${off} ps`, tone: Math.abs(off) < WIN_PS ? 'warn' : 'ok' },
          { label: 'Resolve', value: `${Math.round(tr)} ps`, tone: tr > b ? 'warn' : 'ok' },
          { label: 'Budget', value: `${b} ps` },
          { label: 'MTBF', value: life(syncMtbf(b, TAU_PS, WIN_PS * 1e-12, 1e9, F_DATA)), tone: p.sync === '2' ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Clock dividers: a counter wraps every N/2 edges and toggles a flip-flop, so the output runs at f / N. ---

const SOURCES = {
  watch: { hz: WATCH_HZ, to1: '÷ 2¹⁵, exact' },
  mcu: { hz: 16e6, to1: '÷16 M, not 2ⁿ' },
}
type Source = keyof typeof SOURCES
const CLK_P = 0.8
const XT_X = -28
const CNT_X = -12
const FF_X = 6
const DV_BUS = -4.6

export const clockDividers: Lesson = {
  id: 'timing-clock-dividers',
  title: 'Clock dividers',
  tagline: 'Slow clocks from a fast crystal',
  formula: (p) => {
    const src = SOURCES[p.src as Source]
    const N = n(p, 'n')
    return `f_out = f_in / N = ${si(src.hz, 'Hz')} / ${N} = ${si(src.hz / N, 'Hz')} · counter 0…${N / 2 - 1}, output toggles as it wraps`
  },
  legend: [
    { color: RING, label: 'CLK = crystal clock; TC = 1 at count N/2 − 1', shape: 'dot' },
    WIRES,
    { color: GREY, label: 'Scope: CLK, TC and the divided output', shape: 'arrow-right' },
  ],
  points: [
    'A crystal gives one very accurate, very fast frequency. Everything slower, from a UART baud rate to a 1 Hz seconds tick or a servo’s 50 Hz, is made by counting its edges.',
    'A toggle flip-flop alone divides by 2: it flips on every rising edge, so two input periods make one output period. Chain n of them and you divide by 2ⁿ.',
    'For any even N, a counter runs 0, 1 … N/2 − 1 and wraps. On the edge where it wraps (TC = 1 enables it) the output flip-flop toggles. Half the output period is N/2 input periods, so the output is f / N at a clean 50 % duty.',
    'That is why watch crystals run at 32 768 Hz: it is 2¹⁵, so fifteen toggle stages make exactly 1 Hz. A 16 MHz Arduino needs a 24-bit counter to reach 1 Hz; its timers use a prescaler plus a compare value instead.',
    `Everything changes on the same clock edge, so the divided clocks stay lined up with CLK. The crystal clock is shown as one period per ${CLK_P} s.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'src',
      options: [
        { value: 'watch', label: '32.768 kHz' },
        { value: 'mcu', label: '16 MHz' },
      ],
      initial: 'watch',
    },
    { kind: 'slider', key: 'n', label: 'Divide by N', min: 2, max: 16, initial: 6, step: 2, format: (v) => `÷ ${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const xt = hc49Crystal(scene, [XT_X, 3, 0], { scale: 1 })
    const [l0, l1] = xt.legs
    add(scene, groundSymbol(), l0).scale.setScalar(0.5)
    const clkBall = junction(scene, [l1[0] + 4, DV_BUS, 0], 0.55)
    partLetter(scene, 'CLK', [l1[0] + 4, DV_BUS + 1.6, 0], 0.9, RING)
    const xtWire = signalWire(scene, [l1, [l1[0], DV_BUS, 0], [l1[0] + 4, DV_BUS, 0]])
    const cnt = add(scene, new THREE.Mesh(new THREE.BoxGeometry(8, 6, 0.8), new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.5 })), [CNT_X, 1, -0.1])
    cnt.castShadow = true
    const digits = segmentDisplay(2, 2.4, LED_RED, true)
    add(scene, digits.group, [CNT_X, 1.6, 0.4])
    const ff = flipFlopBlock(scene, [FF_X, 0, 0], { enable: true })
    const loop = toggleLoop(scene, ff, FF_X, 6)
    const cntClk: V3 = [CNT_X - 4, -1, 0]
    const bus = signalWire(scene, [[l1[0] + 4, DV_BUS, 0], [FF_X - 4.6, DV_BUS, 0]])
    const drops = [
      signalWire(scene, [[CNT_X - 5.4, DV_BUS, 0], [CNT_X - 5.4, cntClk[1], 0], cntClk]),
      signalWire(scene, [[FF_X - 4.6, DV_BUS, 0], [FF_X - 4.6, ff.pins.clk[1], 0], ff.pins.clk]),
    ]
    const tap = junction(scene, [CNT_X - 5.4, DV_BUS, 0], 0.4)
    const tcWire = signalWire(scene, [[CNT_X + 4, ff.pins.en[1], 0], ff.pins.en])
    partLetter(scene, 'TC', [CNT_X + 5.4, ff.pins.en[1] + 0.8, 0], 0.8, RING)
    const led = ledOut(scene, [loop.qx, ff.pins.q[1], 0], [FF_X + 7.6, ff.pins.q[1], 0], 'out')
    const scope = timingDiagram(scene, [-6, -14.4, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'TC', color: RING },
      { label: 'out', color: LED_RED },
    ], { width: 44, rowH: 2.4, window: 24, samples: 320 })
    const s = { key: '', t: 0, c: 0, tc: 0, out: 0 }
    return {
      scene,
      view: { center: [-6, -4, 0], radius: 92, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const N = n(p, 'n')
        const key = `${p.src}|${N}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const c = clockLevel(s.t - CLK_P / 2, CLK_P)
        const st = divideBy(edgesBy(s.t - CLK_P / 2, CLK_P), N)
        s.c = glide(dt, s.c, c)
        s.tc = glide(dt, s.tc, st.tc)
        s.out = glide(dt, s.out, st.out)
        const w = Math.sin((2 * Math.PI * s.t) / CLK_P)
        xt.set(0.6 * w, w)
        xtWire(s.c)
        clkBall.set(s.c)
        tap.set(s.c)
        bus(s.c)
        drops.forEach((d) => d(s.c))
        digits.set(String(st.count).padStart(2))
        tcWire(s.tc)
        loop.set(s.out)
        ff.set(s.out, s.c)
        led(dt, s.out)
        scope.frame(dt, [c, st.tc, st.out])
      },
      readouts: (p) => {
        const src = SOURCES[p.src as Source]
        const N = n(p, 'n')
        return [
          { label: 'In', value: si(src.hz, 'Hz', 5) },
          { label: 'Out', value: si(src.hz / N, 'Hz'), tone: 'ok' },
          { label: 'For 1 Hz', value: src.to1 },
        ]
      },
    }
  },
}
