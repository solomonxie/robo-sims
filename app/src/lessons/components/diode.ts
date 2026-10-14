import * as THREE from 'three/webgpu'
import { DIODES, Diode, Flyback, diodeAmps, diodeNode, diodeVolts, flybackSpike, flybackStep } from '../../core/physics'
import { fitDigits, ohms, si, volts } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CELL_H,
  CONVENTIONAL,
  HIGH_V,
  LANE,
  RING,
  RS,
  acSource,
  bulb,
  cell,
  cellFraction,
  clamp01,
  coil,
  diodeAlong,
  diodeSymbol,
  dropAlong,
  ease,
  emptyGroup,
  glowMat,
  groundSymbol,
  junction,
  knifeSwitch,
  lerp,
  plusFlow,
  presence,
  pulseLabel,
  rand,
  scope,
  segmentDisplay,
  swapResistor,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])
const GHOST = '#6a5a3a'
const GREY = '#8a8f99'
const D_SCALE = 2.2
const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)

type Plot = ReturnType<typeof scope>

/** Grey tick numbers: under the screen at x fractions, right of it at y fractions. */
function ticks(plot: Plot, x: [number, string][], y: [number, string][]) {
  const label = (text: string, at: V3) => {
    const d = segmentDisplay(text.replace('.', '').length, 0.8, GREY, true)
    d.set(text)
    add(plot.group, d.group, at)
  }
  for (const [u, s] of x) label(s, [plot.xAt(u), -plot.height / 2 - 1.1, 0])
  for (const [v, s] of y) label(s, [plot.width / 2 + 1.5, v * plot.height - plot.height / 2, 0])
}

/** A plot screen with a glowing operating-point dot. */
function ivScreen(scene: THREE.Object3D, at: V3, w: number, h: number, divs: [number, number]) {
  const plot = scope(scene, w, h, { divs, zeroAt: 0 })
  plot.group.position.set(...at)
  const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat('#ffffff', 1.4)))
  return { plot, dot, y: (f: number) => f * h - h / 2 }
}

// --- Forward drop: below ~0.5 V nothing flows; above it the current climbs ×10 per 0.1 V, so the drop barely moves. ---

const V1_MAX = 9
const R1 = 220
const L1 = -15
const X1 = -5
const H1 = 4.5
const R1_X = (L1 + X1) / 2
const D1 = 2.2
const S1: V3 = [6.4, 0.4, 0]
const S1_W = 11
const S1_H = 8
const I1_MAX = 0.04
const PARTS: Record<string, { d: Diode; glass: boolean }> = {
  '1N4148': { d: DIODES['1N4148'], glass: true },
  '1N5819': { d: DIODES['1N5819'], glass: false },
}

const solveForward = (p: Params) => {
  const part = (p.part as string) in PARTS ? (p.part as string) : '1N4148'
  return { part, ...PARTS[part], v: n(p, 'v') }
}

export const forwardDrop: Lesson = {
  id: 'diode-forward-drop',
  title: 'Forward drop',
  tagline: 'A small toll to pass',
  formula: (p) => {
    const s = solveForward(p)
    const r = diodeNode(s.v, R1, s.d)
    return `I = (V − Vd) / R = (${volts(s.v)} − ${volts(r.v)}) / ${ohms(R1)} = ${si(r.sourceA, 'A', 3)} · I = Is·(e^(Vd/nVt) − 1)`
  },
  legend: [
    { color: RING, label: 'I–V curve; dot = now', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I, mA', shape: 'dot' },
    { color: '#e8e8e8', label: 'Diode drop Vd, V', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'A diode is a one-way valve. Current goes in at the anode and out at the cathode, the end with the band, the way the symbol’s arrow points.',
    'It takes a push before anything flows: a silicon diode passes almost nothing below ~0.5 V. Above that, every extra 0.1 V multiplies the current by about 10.',
    'So once it conducts the drop hardly moves: 0.6 V at 1 mA, 0.75 V at 40 mA. Call it 0.7 V and let the resistor take the rest: I = (V − 0.7) / R.',
    'The curve is so steep that, without the resistor, a little extra voltage means far too much current, and the diode burns.',
    'A Schottky (1N5819) has a metal–silicon junction and drops only 0.1–0.3 V, wasting less as heat. The price: it leaks more backwards.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'part',
      options: [
        { value: '1N4148', label: 'Silicon' },
        { value: '1N5819', label: 'Schottky' },
      ],
      initial: '1N4148',
    },
    { kind: 'slider', key: 'v', label: 'Battery', min: 0, max: V1_MAX, initial: 5, step: 0.1, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[X1, D1, 0], [X1, H1, 0], [L1, H1, 0], [L1, -H1, 0], [X1, -H1, 0], [X1, -D1, 0]])
    add(scene, cell(CELL_H, 1.5), [L1, 0, 0])
    swapResistor(add(scene, new THREE.Group()), R1, [R1_X - 1, H1, 0], [R1_X + 1, H1, 0])
    const holder = add(scene, new THREE.Group())
    const symbol = add(scene, diodeSymbol(1.3), [X1 + 2.4, 0, 0])
    symbol.rotation.z = -Math.PI / 2
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [R1_X, H1 + 1.7, 0], 1.2)
    const vLabel = pulseLabel(scene, 4, '#e8e8e8', [X1 - 3.9, 0, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, S1, S1_W, S1_H, [10, 4])
    ticks(plot, [[0.5, '0.5'], [1, '1.0']], [[0.5, '20'], [1, '40']])
    const ghost = plot.trace(GHOST, { radius: 0.08 })
    const live = plot.trace(RING, { radius: 0.12 })
    const level = plot.level(CONVENTIONAL)
    const curve = (d: Diode) => (u: number) => y(diodeAmps(u, d) / I1_MAX)

    const state = { part: '', v: 5, vd: 0, amps: 0 }
    let diode: ReturnType<typeof diodeAlong> | null = null
    const flow = plusFlow(
      scene,
      lane([[X1, -H1, 0], [L1, -H1, 0], [L1, H1, 0], [X1, H1, 0]]),
      (at) => {
        const top = state.v / V1_MAX
        const vd = state.vd / V1_MAX
        if (at.y <= -H1 + 0.01) return 0
        if (at.x <= L1 + 0.01) return top * cellFraction(at.y)
        if (at.y >= H1 - 0.01) return dropAlong(at, [L1, H1, 0], [X1, H1, 0], top, vd, RS)
        return vd * clamp01((at.y + D1) / (2 * D1))
      },
      true,
    )
    return {
      scene,
      view: { center: [-0.8, 2.2, 0], radius: 54, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveForward(p)
        if (s.part !== state.part) {
          state.part = s.part
          emptyGroup(holder)
          diode = diodeAlong(holder, [X1, D1, 0], [X1, -D1, 0], { scale: D_SCALE, glass: s.glass })
          const other = Object.values(PARTS).find((q) => q.d !== s.d)!.d
          ghost.draw(curve(other), null)
          live.draw(curve(s.d), null)
        }
        state.v += (s.v - state.v) * ease(dt, 5)
        const r = diodeNode(state.v, R1, s.d)
        state.vd = r.v
        state.amps = r.sourceA
        dot.position.set(plot.xAt(r.v), y(Math.min(1, r.sourceA / I1_MAX)), 0.4)
        level.set(y(r.sourceA / I1_MAX))
        diode?.set(clamp01(r.sourceA / 0.02))
        flow.step(dt * 150 * r.sourceA)
        iLabel.show(fitDigits(r.sourceA * 1000, 3))
        vLabel.show(fitDigits(r.v, 4))
        iLabel.frame(dt)
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveForward(p)
        return [
          { label: 'Diode drop Vd', value: volts(tiny(state.vd, 1e-3)), tone: 'ok' },
          { label: 'Current I', value: si(tiny(state.amps, 1e-9), 'A', 3) },
          { label: 'Across R', value: volts(tiny(state.v - state.vd, 1e-3)) },
          { label: 'Diode heat', value: si(tiny(state.vd * state.amps, 1e-9), 'W', 2), tone: s.v > 0 && state.amps > 0.03 ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Reverse blocking: an AC source flips the push every half cycle; the diode passes one half and blocks the other. ---

const R2 = 100
const HZ = 50
const SLOW2 = 100
const L2 = -15
const X2 = -3
const H2 = 4.5
const D2_X = -9
const LAMP_X = -9
const SRC_R = 1.6
const S2: V3 = [6.4, 0.4, 0]
const S2_W = 11
const S2_H = 8
const V2_FULL = 12
const WINDOW2 = 2 / HZ
const D2 = DIODES['1N4148']

const sourceAt = (peak: number, t: number) => peak * Math.sin(2 * Math.PI * HZ * t)
const lampLoop = (vin: number, flipped: boolean) => {
  const r = diodeNode(vin, R2, D2, { reversed: flipped })
  return { vd: r.v, amps: r.sourceA }
}

export const reverseBlocking: Lesson = {
  id: 'diode-reverse-blocking',
  title: 'Reverse blocking',
  tagline: 'One way only',
  formula: (p) => {
    const peak = n(p, 'peak')
    const fwd = lampLoop(peak, false)
    return `Forward: I = (V − Vd) / R = (${volts(peak)} − ${volts(fwd.vd)}) / ${ohms(R2)} = ${si(fwd.amps, 'A', 3)} · Reverse: I = −Is = −${si(D2.saturationA, 'A', 3)}`
  },
  legend: [
    { color: GREY, label: 'Source voltage, ±12 V', shape: 'dot' },
    { color: RING, label: 'Across the lamp', shape: 'dot' },
    { color: '#dfe6f2', label: 'Blocking: the junction’s wall', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'Turn the push around and a diode stops the current: reverse-biased, it blocks. Here an AC source does the turning, flipping polarity every half cycle (50 Hz, slowed 100×).',
    'Forward half: the diode conducts, keeps its ~0.7 V and the lamp gets the rest. Reverse half: the diode holds the whole source voltage and the lamp goes dark.',
    'Blocking is not perfect: a 1N4148 leaks about 2.5 nA backwards, ten million times less than it passes forwards. Push past its rating (100 V) and it breaks down.',
    'What is left is pulsing DC, current one way only: a half-wave rectifier, the first step of a mains power supply. Flip the diode and the lamp runs on the other halves.',
    'The same one-way trick guards circuits against a battery put in backwards.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'dir',
      options: [
        { value: 'forward', label: 'Band right' },
        { value: 'flipped', label: 'Band left' },
      ],
      initial: 'forward',
    },
    { kind: 'slider', key: 'peak', label: 'Peak voltage', min: 2, max: V2_FULL, initial: 9, step: 0.5, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[D2_X - 2, H2, 0], [L2, H2, 0], [L2, -H2, 0], [LAMP_X - 1.6, -H2, 0]])
    wire(scene, [[D2_X + 2, H2, 0], [X2, H2, 0], [X2, -H2, 0], [LAMP_X + 2.2, -H2, 0]])
    add(scene, acSource(SRC_R), [L2, 0, 0])
    const lamp = bulb()
    lamp.group.scale.setScalar(0.62)
    lamp.group.rotation.z = -Math.PI / 2
    lamp.group.position.set(LAMP_X + 0.4, -H2, 0)
    scene.add(lamp.group)
    const pivot = add(scene, new THREE.Group(), [D2_X, H2, 0])
    const diode = diodeAlong(pivot, [-2, 0, 0], [2, 0, 0], { scale: D_SCALE, glass: true })
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [X2 - 3.4, 0, 0], 1.2)

    const plot = scope(scene, S2_W, S2_H, { divs: [8, 4] })
    plot.group.position.set(...S2)
    const vy = (v: number) => (v / V2_FULL) * (S2_H / 2)
    const vin = plot.trace(GREY, { radius: 0.08 })
    const vLamp = plot.trace(RING, { radius: 0.12 })

    const state = { t: 0, flip: 0, vin: 0, vd: 0, amps: 0 }
    const flow = plusFlow(
      scene,
      lane([[L2, -H2, 0], [L2, H2, 0], [X2, H2, 0], [X2, -H2, 0]]),
      (at) => {
        const f = (v: number) => 0.5 + v / (2 * V2_FULL)
        const vl = state.amps * R2
        if (at.x <= L2 + 0.01) return f(state.vin * clamp01((at.y + SRC_R) / (2 * SRC_R)))
        if (at.y >= H2 - 0.01) return f(dropAlong(at, [L2, H2, 0], [X2, H2, 0], state.vin, vl, 0.4 * D_SCALE))
        if (at.x >= X2 - 0.01) return f(vl)
        return f(dropAlong(at, [X2, -H2, 0], [L2, -H2, 0], vl, 0, 1.6))
      },
      true,
    )
    return {
      scene,
      view: { center: [-0.8, 2.2, 0], radius: 54, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const flipped = p.dir === 'flipped'
        const peak = n(p, 'peak')
        state.t += dt / SLOW2
        state.vin = sourceAt(peak, state.t)
        const r = lampLoop(state.vin, flipped)
        state.vd = r.vd
        state.amps = r.amps
        state.flip += ((flipped ? 1 : 0) - state.flip) * ease(dt, 5)
        pivot.rotation.y = Math.PI * state.flip
        diode.set(Math.abs(r.amps) > 1e-6 ? clamp01(Math.abs(r.amps) / 0.05) : -clamp01(0.3 + Math.abs(r.vd) / V2_FULL))
        lamp.setGlow(clamp01((Math.abs(r.amps) * R2) / 8))
        flow.step(dt * 50 * r.amps)
        vin.scroll((t) => vy(sourceAt(peak, t)), state.t, WINDOW2)
        vLamp.scroll((t) => vy(lampLoop(sourceAt(peak, t), flipped).amps * R2), state.t, WINDOW2)
        iLabel.show(fitDigits(Math.abs(r.amps) < 1e-4 ? 0 : r.amps * 1000, 3))
        iLabel.frame(dt)
      },
      readouts: () => {
        const on = Math.abs(state.amps) > 1e-6
        return [
          { label: 'Source', value: `${state.vin.toFixed(1)} V` },
          { label: 'Diode', value: on ? 'Conducts' : 'Blocks', tone: on ? 'ok' : 'warn' },
          { label: 'Lamp current', value: si(tiny(state.amps, 1e-10), 'A', 2) },
          { label: 'Across diode', value: `${state.vd.toFixed(2)} V` },
        ]
      },
    }
  },
}

// --- Flyback diode: a coil keeps its current going when the switch opens; without a path, the voltage spikes. ---

const R_COIL = 240
const L_COIL = 0.2
const C_STRAY = 10e-9
const ON = 3e-3
const CYCLE = 2 * ON
const SLOW3 = 1000
const SUB3 = 0.5e-6
const REC = 10e-6
const RING_N = Math.round(CYCLE / REC) + 4
const RATED = 40
const D3 = DIODES['1N4007']
const C3_X = -14
const TOP = 3
const BOT = -3.4
const COIL_X = -4
const COIL_L = 6.4
const COIL_R = 1.1
const CL = COIL_X - COIL_L / 2
const CR = COIL_X + COIL_L / 2
const DY = 2.6
const RX = 8
const PIVOT: V3 = [5, BOT, 0]
const BLADE = 3.2
const THROW = (35 * Math.PI) / 180
const CONTACT: V3 = [PIVOT[0] - BLADE, BOT, 0]
const S3_Y = -8.4
const S3_W = 24
const S3_H = 5
const V3_LO = -10
const V3_SPAN = 60
const I_TO_V = 300

const solveFlyback = (p: Params) => {
  const fitted = p.diode === 'fitted'
  const vs = n(p, 'v')
  const amps = vs / R_COIL
  return { fitted, vs, amps, spike: fitted ? vs + diodeVolts(amps, D3) : flybackSpike(vs, amps, L_COIL, C_STRAY) }
}

export const flybackDiode: Lesson = {
  id: 'diode-flyback-diode',
  title: 'Flyback diode',
  tagline: 'A way out for the coil’s current',
  formula: (p) => {
    const s = solveFlyback(p)
    return s.fitted
      ? `V = Vs + Vd = ${volts(s.vs)} + ${volts(s.spike - s.vs)} = ${volts(s.spike)} · I fades with τ = L/R = ${si(L_COIL / R_COIL, 's', 2)}`
      : `V ≈ Vs + I·√(L/C) = ${volts(s.vs)} + ${si(s.amps, 'A', 3)} × √(0.2 H / 10 nF) = ${volts(s.spike)}`
  },
  legend: [
    { color: HIGH_V, label: 'Switch voltage; last spike, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Coil current', shape: 'dot' },
    { color: RING, label: '40 V: a small transistor’s limit', shape: 'dot' },
    { color: B_FIELD, label: 'Field in the core', shape: 'dot' },
  ],
  points: [
    'A relay or motor coil stores energy in its magnetic field while current flows: ½LI². Here a 12 V relay coil, 0.2 H and 240 Ω, carries 50 mA.',
    'Open the switch and the coil will not let its current stop at once. It pushes it on into whatever it finds, raising the voltage as high as it takes: V = L·dI/dt.',
    'With nowhere to go, the current charges the wiring’s few nF of stray capacitance: the switch sees about I·√(L/C) ≈ 230 V, ringing. That arcs mechanical contacts and kills the transistor that usually does the switching.',
    'A flyback diode across the coil, band to +, sits reverse-biased and idle while the switch is closed. At switch-off it gives the current a loop: the switch sees only one diode drop above the supply.',
    'The energy then burns off in the coil’s own resistance, so the current fades over τ = L/R ≈ 0.8 ms and a relay releases a little later. Time here is slowed 1000×.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'diode',
      options: [
        { value: 'none', label: 'No diode' },
        { value: 'fitted', label: 'Flyback diode' },
      ],
      initial: 'none',
    },
    { kind: 'slider', key: 'v', label: 'Supply', min: 5, max: 24, initial: 12, step: 1, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    add(scene, cell(CELL_H, 1.5), [C3_X, 0, 0])
    wire(scene, [CONTACT, [C3_X, BOT, 0], [C3_X, TOP, 0], [CL, TOP, 0]])
    wire(scene, [[CR, TOP, 0], [RX, TOP, 0], [RX, BOT, 0], PIVOT])
    add(scene, groundSymbol(), [C3_X + 4, BOT, 0])
    const toggle = knifeSwitch(scene, PIVOT, BLADE, [Math.PI])
    const winding = coil(scene, { radius: COIL_R, length: COIL_L, turns: 9, thickness: 0.18 })
    winding.group.position.set(COIL_X, TOP - COIL_R, 0)
    const coreMat = new THREE.MeshStandardMaterial({ color: '#6d7480', emissive: B_FIELD, emissiveIntensity: 0, roughness: 0.5 })
    add(winding.group, mesh(new THREE.CylinderGeometry(0.65, 0.65, COIL_L + 0.8, 24), coreMat)).rotation.z = Math.PI / 2

    const branch = add(scene, new THREE.Group(), [COIL_X, TOP, 0])
    const half = COIL_L / 2
    wire(branch, [[-half, 0, 0], [-half, DY, 0], [-2, DY, 0]])
    wire(branch, [[2, DY, 0], [half, DY, 0], [half, 0, 0]])
    const flyback = diodeAlong(branch, [2, DY, 0], [-2, DY, 0], { scale: 1.5 })
    for (const x of [-half, half]) junction(branch, [x, 0, 0], 0.45).set(x < 0 ? 1 : 0.5)

    const sparkMat = glowMat('#cfe3ff', 3)
    const bolt = Array.from({ length: 5 }, () => {
      const m = add(scene, mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 6), sparkMat))
      m.castShadow = false
      return m
    })
    const flash = add(scene, new THREE.PointLight('#bcd8ff', 0, 30, 2), [CONTACT[0] + 0.5, BOT + 1, 1])
    const glowBall = new THREE.MeshBasicMaterial({ color: '#9cc4ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    const halo = add(scene, mesh(new THREE.SphereGeometry(1, 20, 14), glowBall), [CONTACT[0] + 0.4, BOT + 0.9, 0.3])
    halo.castShadow = false
    const peakLabel = pulseLabel(scene, 3, HIGH_V, [RX + 3.2, 0, 0], 1.4)

    const plot = scope(scene, S3_W, S3_H, { divs: [12, 12], zeroAt: -V3_LO / V3_SPAN })
    plot.group.position.set(0, S3_Y, 0)
    const vy = (v: number) => ((v - V3_LO) / V3_SPAN - 0.5) * S3_H
    const vTrace = plot.trace(HIGH_V, { samples: 300, radius: 0.1 })
    const iTrace = plot.trace(CONVENTIONAL, { samples: 300, radius: 0.08 })
    plot.level(RING).set(vy(RATED))

    const ringV = new Float32Array(RING_N)
    const ringI = new Float32Array(RING_N)
    const slot = (t: number) => ((Math.floor(t / REC) % RING_N) + RING_N) % RING_N
    const state = { key: '', t: 0, s: { amps: 0, volts: 0 } as Flyback, closed: true, peak: 0, blade: 0, fitted: 0, vs: 12 }
    const nodeF = () => clamp01(state.s.volts / state.vs)
    const paint = (at: THREE.Vector3) => {
      if (at.y > TOP + 0.01) return dropAlong(at, [CR, TOP + DY, 0], [CL, TOP + DY, 0], nodeF(), 1, 1.6)
      if (at.x <= C3_X + 0.01) return cellFraction(at.y)
      if (at.y <= BOT + 0.01 && at.x < CONTACT[0] + 0.01) return 0
      if (at.y >= TOP - 0.01 && at.x < CR) return lerp(1, nodeF(), (at.x - CL) / COIL_L)
      return nodeF()
    }
    const mainFlow = plusFlow(scene, lane([[C3_X, BOT, 0], [C3_X, TOP, 0], [RX, TOP, 0], [RX, BOT, 0], CONTACT]), paint, true)
    const loopFlow = plusFlow(scene, lane([[CL, TOP, 0], [CR, TOP, 0], [CR, TOP + DY, 0], [CL, TOP + DY, 0]], LANE + 0.6), paint, true)

    return {
      scene,
      view: { center: [-1.6, -1.7, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveFlyback(p)
        const key = `${s.fitted}${s.vs}`
        if (key !== state.key) {
          state.key = key
          state.t = 0
          state.s = { amps: 0, volts: 0 }
          state.peak = 0
          ringV.fill(0)
          ringI.fill(0)
        }
        state.vs = s.vs
        const h = dt / SLOW3
        const steps = Math.max(1, Math.ceil(h / SUB3))
        for (let k = 0; k < steps; k++) {
          state.t += h / steps
          const closed = state.t % CYCLE < ON
          if (state.closed && !closed) state.peak = 0
          state.closed = closed
          state.s = flybackStep(state.s, { vs: s.vs, ohms: R_COIL, henries: L_COIL, farads: C_STRAY, diode: s.fitted ? D3 : undefined, closed }, h / steps)
          if (!closed) state.peak = Math.max(state.peak, state.s.volts)
          ringV[slot(state.t)] = state.s.volts
          ringI[slot(state.t)] = state.s.amps
        }

        state.blade += ((state.closed ? 0 : 1) - state.blade) * ease(dt, 14)
        toggle.set(Math.PI - THROW * state.blade)
        state.fitted += ((s.fitted ? 1 : 0) - state.fitted) * ease(dt, 7)
        presence(branch, state.fitted)
        const reverse = state.closed || state.s.amps <= 0
        flyback.set(reverse ? -0.6 : clamp01(state.s.amps / 0.05))
        coreMat.emissiveIntensity = 1.4 * clamp01(Math.abs(state.s.amps) / 0.1)

        const arc = state.closed ? 0 : clamp01((Math.abs(state.s.volts) - 30) / 120)
        const tip: V3 = [PIVOT[0] + BLADE * Math.cos(Math.PI - THROW * state.blade), BOT + BLADE * Math.sin(Math.PI - THROW * state.blade), 0.3]
        let prev: V3 = [CONTACT[0], CONTACT[1], 0.3]
        bolt.forEach((m, i) => {
          const u = (i + 1) / bolt.length
          const jag = i === bolt.length - 1 ? 0 : rand(-0.35, 0.35)
          const next: V3 = [lerp(CONTACT[0], tip[0], u) + jag, lerp(CONTACT[1], tip[1], u) + jag * 0.5, 0.3]
          const a = new THREE.Vector3(...prev)
          const d = new THREE.Vector3(...next).sub(a)
          m.position.copy(a).addScaledVector(d, 0.5)
          m.scale.set(1, Math.max(0.001, d.length()), 1)
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
          m.visible = arc > 0.02
          prev = next
        })
        sparkMat.emissiveIntensity = 1 + 4 * arc * rand(0.6, 1)
        flash.intensity = 400 * arc * rand(0.5, 1)
        halo.visible = arc > 0.02
        halo.scale.setScalar(0.4 + 0.8 * arc * rand(0.8, 1))
        glowBall.opacity = 0.6 * arc

        mainFlow.mesh.visible = state.closed
        loopFlow.mesh.visible = !state.closed && s.fitted
        ;(state.closed ? mainFlow : loopFlow).step(dt * 60 * state.s.amps)
        vTrace.scroll((t) => vy(ringV[slot(t)]), state.t, CYCLE)
        iTrace.scroll((t) => vy(ringI[slot(t)] * I_TO_V), state.t, CYCLE)
        peakLabel.show(state.peak ? fitDigits(state.peak, 3) : '')
        peakLabel.frame(dt)
      },
      readouts: () => [
        { label: 'Switch', value: state.closed ? 'Closed' : 'Open' },
        { label: 'Coil current', value: si(tiny(state.s.amps, 1e-6), 'A', 3) },
        { label: 'Last spike', value: state.peak ? volts(state.peak) : '–', tone: state.peak > RATED ? 'bad' : state.peak ? 'ok' : undefined },
        { label: 'Sim time', value: si(state.t, 's', 3) },
      ],
    }
  },
}

// --- Zener clamp: a diode made to break down at 5.1 V holds the output there, whatever the supply above it. ---

const V4_MAX = 15
const R4 = 220
const Z = DIODES.zener5V1
const L4 = -15
const ZX = -7
const LX = -2
const H4 = 4.5
const R4_X = (L4 + ZX) / 2
const D4 = 2
const S4: V3 = [6.8, 0.4, 0]
const S4_W = 11
const S4_H = 8
const VZ_FULL = 6
const IZ_FULL = 0.05
const LOADS: Record<string, number> = { none: Infinity, '1k': 1000, '220': 220 }

const solveZener = (p: Params) => {
  const load = (p.load as string) in LOADS ? (p.load as string) : 'none'
  const vs = n(p, 'v')
  return { load, ohms: LOADS[load], vs, ...diodeNode(vs, R4, Z, { reversed: true, load: LOADS[load] }) }
}

export const zenerClamp: Lesson = {
  id: 'diode-zener-clamp',
  title: 'Zener clamp',
  tagline: 'Breaking down on purpose',
  formula: (p) => {
    const s = solveZener(p)
    return `Iz = (Vin − Vout) / R − Vout / R_load = (${volts(s.vs)} − ${volts(s.v)}) / ${ohms(R4)} − ${si(s.loadA, 'A', 3)} = ${si(s.diodeA, 'A', 3)}`
  },
  legend: [
    { color: RING, label: 'Zener I–V; Vout, V', shape: 'dot' },
    { color: GREY, label: 'What the resistor can feed', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Zener current, mA', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'A zener is a diode made to break down backwards at a set voltage, here 5.1 V, without harm. Wired band-up from the output to ground (reverse-biased), it clamps.',
    'Below 5.1 V it blocks, so Vout just follows the supply. Above, it conducts as hard as it must and the output stays near 5.1 V; the series resistor drops the rest.',
    'On the plot: the zener’s curve, and the resistor’s line, the current it can feed at each Vout. Where they cross is the working point. Raise Vin and the line slides up, but the point only climbs the steep knee.',
    'A load takes its share. 1 kΩ needs 5 mA and is fine. 220 Ω wants 23 mA, more than the resistor passes at 9 V, so the zener starves and Vout sags.',
    'The zener burns whatever the load does not use, P = Vz·Iz. Good for references and protecting inputs; for real power use a regulator.',
  ],
  controls: [
    { kind: 'slider', key: 'v', label: 'Supply Vin', min: 0, max: V4_MAX, initial: 9, step: 0.1, format: volts },
    {
      kind: 'choice',
      key: 'load',
      options: [
        { value: 'none', label: 'No load' },
        { value: '1k', label: '1 kΩ' },
        { value: '220', label: '220 Ω' },
      ],
      initial: 'none',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[ZX, D4, 0], [ZX, H4, 0], [L4, H4, 0], [L4, -H4, 0], [ZX, -H4, 0], [ZX, -D4, 0]])
    add(scene, cell(CELL_H, 1.5), [L4, 0, 0])
    swapResistor(add(scene, new THREE.Group()), R4, [R4_X - 1, H4, 0], [R4_X + 1, H4, 0])
    const zener = diodeAlong(scene, [ZX, -D4, 0], [ZX, D4, 0], { scale: D_SCALE, glass: true })
    const out = junction(scene, [ZX, H4, 0], 0.55)
    const loadWire = add(scene, new THREE.Group(), [LX, 0, 0])
    wire(loadWire, [[ZX - LX, H4, 0], [0, H4, 0], [0, -H4, 0], [ZX - LX, -H4, 0]])
    const loadHolder = add(loadWire, new THREE.Group())
    const outLabel = pulseLabel(scene, 3, RING, [ZX, H4 + 1.8, 0], 1.3)
    const izLabel = pulseLabel(scene, 3, CONVENTIONAL, [ZX - 3.2, 0, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, S4, S4_W, S4_H, [6, 5])
    ticks(plot, [[5.1 / VZ_FULL, '5.1']], [[0.4, '20'], [1, '50']])
    const curve = plot.trace(RING, { radius: 0.12 })
    curve.draw((u) => y(-diodeAmps(-u * VZ_FULL, Z) / IZ_FULL), null)
    const feed = plot.trace(GREY, { radius: 0.08 })

    const state = { load: '', vs: 9, v: 0, iz: 0, il: 0, show: 0 }
    const f = (v: number) => v / V4_MAX
    const column = (at: THREE.Vector3, half: number) => f(state.v) * clamp01((at.y + half) / (2 * half))
    const top = (at: THREE.Vector3) => dropAlong(at, [L4, H4, 0], [ZX, H4, 0], f(state.vs), f(state.v), RS)
    const paint = (at: THREE.Vector3) => {
      if (at.y <= -H4 + 0.01) return 0
      if (at.x <= L4 + 0.01) return f(state.vs) * cellFraction(at.y)
      if (at.y >= H4 - 0.01) return at.x > ZX ? f(state.v) : top(at)
      return column(at, at.x > ZX + 0.01 ? RS : D4)
    }
    const supplyFlow = plusFlow(scene, lane([[ZX, -H4, 0], [L4, -H4, 0], [L4, H4, 0], [ZX, H4, 0]]), paint)
    const zFlow = plusFlow(scene, lane([[ZX, H4, 0], [ZX, -H4, 0]]), paint)
    const lFlow = plusFlow(scene, lane([[ZX, H4, 0], [LX, H4, 0], [LX, -H4, 0], [ZX, -H4, 0]]), paint)
    return {
      scene,
      view: { center: [-0.8, 2.2, 0], radius: 54, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveZener(p)
        if (s.load !== state.load) {
          state.load = s.load
          emptyGroup(loadHolder)
          if (Number.isFinite(s.ohms)) swapResistor(loadHolder, s.ohms, [0, 1, 0], [0, -1, 0])
        }
        state.vs += (s.vs - state.vs) * ease(dt, 5)
        const r = diodeNode(state.vs, R4, Z, { reversed: true, load: s.ohms })
        state.v = r.v
        state.iz = r.diodeA
        state.il = r.loadA
        state.show += ((Number.isFinite(s.ohms) ? 1 : 0) - state.show) * ease(dt, 7)
        presence(loadWire, state.show)
        lFlow.mesh.visible = state.show > 0.5

        feed.draw((u) => y(((state.vs - u * VZ_FULL) / R4 - (u * VZ_FULL) / s.ohms) / IZ_FULL), null)
        dot.position.set(plot.xAt(r.v / VZ_FULL), y(Math.min(1, state.iz / IZ_FULL)), 0.4)
        zener.set(state.iz > 1e-4 ? clamp01(state.iz / 0.03) : -0.5)
        out.set(f(r.v))
        supplyFlow.step(dt * 150 * r.sourceA)
        zFlow.step(dt * 150 * state.iz)
        lFlow.step(dt * 150 * state.il)
        outLabel.show(fitDigits(r.v, 3))
        izLabel.show(fitDigits(state.iz * 1000, 3))
        outLabel.frame(dt)
        izLabel.frame(dt)
      },
      readouts: () => {
        const held = state.iz > 1e-3
        return [
          { label: 'Vout', value: volts(tiny(state.v, 1e-3)), tone: held ? 'ok' : 'warn' },
          { label: 'Zener current', value: si(tiny(state.iz, 1e-9), 'A', 3) },
          { label: 'Load current', value: si(tiny(state.il, 1e-9), 'A', 3) },
          { label: 'Zener heat', value: si(state.iz < 1e-6 ? 0 : state.v * state.iz, 'W', 2), tone: state.v * state.iz > 0.5 ? 'bad' : undefined },
        ]
      },
    }
  },
}
