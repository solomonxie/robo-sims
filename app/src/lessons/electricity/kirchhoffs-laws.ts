import * as THREE from 'three/webgpu'
import { BRIDGE, bridgeCircuit, bridgeCurrents, bridgeMatrix, bridgeNodes, TWO_SOURCE_LOOPS, twoSourceLoop, twoSourceNode } from '../../core/physics'
import { kclResidual, relaxNode } from '../../core/nodal'
import { amps, fitDigits, mA, volts } from '../../core/units'
import { V3, add, lead } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  HIGH_V,
  LANE,
  LOW_V,
  OHMS_LABEL,
  POWER,
  R_SCALE,
  RING,
  RS,
  arrow,
  cell,
  cellFraction,
  dropAlong,
  ease,
  emptyGroup,
  glowMat,
  groundSymbol,
  inOutBars,
  junction,
  path,
  plusFlow,
  pointArrow,
  pulseLabel,
  resistorAlong,
  swapResistor,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n, resistorSlider } from '../types'


// --- Two sources feeding one node N (top middle); R₃ from N down to the ground rail. ---

const T_W = 11
const T_H = 5
const T_RX = 5.5
const T_V1 = 9
const T_R1 = 100
const T_R2 = 150
const MAX_V = 12
const T_SPEED = 70 // drawn units/s per amp
const v2Slider = { kind: 'slider', key: 'v2', label: 'V₂', min: 0, max: MAX_V, initial: 5, step: 0.5, format: (v: number) => `${v} V` } as const

/** Cells V₁ (left) and V₂ (right), R₁ and R₂ along the top into node N, R₃ down the middle; + charges coloured by potential. */
function twoSourceFrame(parent: THREE.Object3D) {
  wire(parent, [[0, -T_H, 0], [-T_W, -T_H, 0], [-T_W, T_H, 0], [T_W, T_H, 0], [T_W, -T_H, 0], [0, -T_H, 0]])
  wire(parent, [[0, T_H, 0], [0, -T_H, 0]])
  for (const x of [-T_W, T_W]) add(parent, cell(CELL_H, 1.5), [x, 0, 0])
  resistorAlong(parent, T_R1, [-T_RX - 1, T_H, 0], [-T_RX + 1, T_H, 0], R_SCALE)
  resistorAlong(parent, T_R2, [T_RX - 1, T_H, 0], [T_RX + 1, T_H, 0], R_SCALE)
  const r3 = add(parent, new THREE.Group())
  const node = junction(parent, [0, T_H, 0], 0.85)
  add(parent, groundSymbol(), [-T_RX, -T_H, 0])

  const level = { v2: 0, n: 0 }
  const side = (x: number, f: () => number) => (at: THREE.Vector3) => {
    if (Math.abs(at.x - x) < 0.01) return cellFraction(at.y) * f()
    if (at.y >= T_H - 0.01) return dropAlong(at, [x, T_H, 0], [0, T_H, 0], f(), level.n, RS)
    return 0
  }
  const left = plusFlow(parent, [[0, -T_H, LANE], [-T_W, -T_H, LANE], [-T_W, T_H, LANE], [0, T_H, LANE]], side(-T_W, () => T_V1 / MAX_V))
  const right = plusFlow(parent, [[0, -T_H, LANE], [T_W, -T_H, LANE], [T_W, T_H, LANE], [0, T_H, LANE]], side(T_W, () => level.v2))
  const mid = plusFlow(parent, [[0, T_H, LANE], [0, -T_H, LANE]], (at) => dropAlong(at, [0, T_H, 0], [0, -T_H, 0], level.n, 0, RS))

  let shownR3 = NaN
  let shownN = NaN
  return {
    /** Swaps R₃, eases the node colour and moves the charges at the solved currents. */
    update(dt: number, v2: number, r3Ohms: number, s: ReturnType<typeof twoSourceNode>) {
      if (r3Ohms !== shownR3) {
        shownR3 = r3Ohms
        swapResistor(r3, r3Ohms, [0, 1, 0], [0, -1, 0])
      }
      shownN = Number.isNaN(shownN) ? s.node : shownN + (s.node - shownN) * ease(dt)
      level.n = shownN / MAX_V
      level.v2 = v2 / MAX_V
      node.set(level.n)
      left.step(dt * s.i1 * T_SPEED)
      right.step(dt * s.i2 * T_SPEED)
      mid.step(dt * s.i3 * T_SPEED)
    },
  }
}

// --- KCL at a node: whatever flows in flows out. ---

const I_COLORS = [CONVENTIONAL, RING, POWER]
const BAR_PER_A = 85

const solveNode = (p: Params) => {
  const v2 = n(p, 'v2')
  const r3 = e12(p, 'r3')
  return { v2, r3, ...twoSourceNode(T_V1, T_R1, v2, T_R2, r3) }
}
const signed = (a: number) => `${a < 0 ? '−' : ''}${+Math.abs(mA(a)).toPrecision(3)}`

export const kclAtANode: Lesson = {
  id: 'kirchhoff-s-laws-kcl-at-a-node',
  title: 'KCL at a node',
  tagline: 'What flows in flows out',
  formula: (p) => {
    const s = solveNode(p)
    return `I₁ + I₂ = I₃: ${signed(s.i1)} + (${signed(s.i2)}) = ${signed(s.i3)} mA`
  },
  legend: [
    { color: CONVENTIONAL, label: 'I₁ from V₁, mA', shape: 'dot' },
    { color: RING, label: 'I₂ from V₂, mA', shape: 'dot' },
    { color: POWER, label: 'I₃ down R₃, mA', shape: 'dot' },
    { color: HIGH_V, label: 'V₂, V', shape: 'dot' },
  ],
  points: [
    'A node is any point where wires meet. Charge can’t pile up there, so every coulomb that arrives each second leaves again: the currents in add up to the currents out.',
    'That’s Kirchhoff’s current law (KCL): I₁ + I₂ = I₃ at the glowing node. Count currents in as + and out as −, and they always sum to 0.',
    'The two columns on the left keep the books: currents arriving stack on the left, leaving on the right. Move anything and they stay equal.',
    'Turn V₂ below the node’s voltage and I₂ reverses: the 9 V cell now pushes current into V₂ (charging it). Its block hops to the out column, and KCL still balances.',
    'You already used KCL for parallel resistors: the main wire carries the sum of the branches. It holds at every node of every circuit, however tangled.',
  ],
  controls: [v2Slider, resistorSlider('r3', 'R₃', 220)],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const frame = twoSourceFrame(scene)
    const bars = inOutBars(scene, I_COLORS, BAR_PER_A, 1.5, 0.4)
    bars.group.position.set(-6.2, -T_H + 0.7, -1)
    const arrows = [
      arrow(scene, [-2.6, T_H + 1.3, 0], [1, 0, 0], CONVENTIONAL, 0.7),
      arrow(scene, [2.6, T_H + 1.3, 0], [-1, 0, 0], RING, 0.7),
      arrow(scene, [1.4, T_H - 1.6, 0], [0, -1, 0], POWER, 0.7),
    ]
    const labels = [
      pulseLabel(scene, 3, CONVENTIONAL, [-T_RX, T_H + 2.4, 0], 1.4),
      pulseLabel(scene, 3, RING, [T_RX, T_H + 2.4, 0], 1.4),
      pulseLabel(scene, 3, POWER, [3, 1.2, 0], 1.4),
    ]
    const v2Label = pulseLabel(scene, 3, HIGH_V, [T_W - 3.8, -2, 0], 1.4)

    const shown = [0, 0, 0]
    return {
      scene,
      view: { center: [0, 1, 0], radius: 48, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveNode(p)
        frame.update(dt, s.v2, s.r3, s)
        const into = [s.i1, s.i2, -s.i3]
        into.forEach((v, k) => {
          shown[k] += (v - shown[k]) * ease(dt, 8)
          pointArrow(arrows[k], k === 2 ? [0, v < 0 ? -1 : 1, 0] : [(k === 0 ? 1 : -1) * (v < 0 ? -1 : 1), 0, 0])
          labels[k].show(fitDigits(Math.abs(mA(v)), 3))
        })
        bars.set(shown)
        v2Label.show(fitDigits(s.v2, 3))
        for (const l of [...labels, v2Label]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveNode(p)
        return [
          { label: 'Node N', value: volts(s.node) },
          { label: 'I₁ in', value: amps(s.i1) },
          { label: s.i2 < 0 ? 'I₂ out' : 'I₂ in', value: amps(Math.abs(s.i2)), tone: s.i2 < 0 ? 'warn' : undefined },
          { label: 'I₃ out', value: amps(s.i3), tone: 'ok' },
        ]
      },
    }
  },
}

// --- KVL around a loop: walk any closed path and the rises and drops cancel. ---

type Loop = keyof typeof TWO_SOURCE_LOOPS
type Part = 'v1' | 'r1' | 'r3' | 'r2' | 'v2'

const WALK_SPEED = 6 // drawn units/s
const R3_FIXED = 220
const LOOP_POINTS: Record<Loop, V3[]> = {
  left: [[-T_W, -T_H, 0], [-T_W, T_H, 0], [0, T_H, 0], [0, -T_H, 0]],
  right: [[0, -T_H, 0], [0, T_H, 0], [T_W, T_H, 0], [T_W, -T_H, 0]],
  outer: [[-T_W, -T_H, 0], [-T_W, T_H, 0], [T_W, T_H, 0], [T_W, -T_H, 0]],
}
const LOOP_PARTS: Record<Loop, Part[]> = { left: ['v1', 'r1', 'r3'], right: ['r3', 'r2', 'v2'], outer: ['v1', 'r1', 'r2', 'v2'] }
const PART_AT: Record<Part, V3> = { v1: [-T_W, 0, 0], r1: [-T_RX, T_H, 0], r3: [0, 0, 0], r2: [T_RX, T_H, 0], v2: [T_W, 0, 0] }
const PART_NAME: Record<Part, string> = { v1: 'V₁', r1: 'R₁', r3: 'R₃', r2: 'R₂', v2: 'V₂' }
const LABEL_AT: Record<Part, V3> = { v1: [-T_W + 4, 1.2, 0], r1: [-T_RX, T_H + 2.4, 0], r3: [0, 0, 0], r2: [T_RX, T_H + 2.4, 0], v2: [T_W - 4, 1.2, 0] }

/** Distance along the closed polyline `points` to the point `at` on it. */
function distanceAlong(points: V3[], at: V3) {
  let d = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    const t = ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (len * len)
    if (t >= 0 && t <= 1 && Math.hypot(a[0] + t * dx - at[0], a[1] + t * dy - at[1]) < 0.01) return d + t * len
    d += len
  }
  return d
}

const solveLoop = (p: Params) => {
  const loop = (p.loop as Loop) ?? 'left'
  const v2 = n(p, 'v2')
  const s = twoSourceNode(T_V1, T_R1, v2, T_R2, R3_FIXED)
  const steps = twoSourceLoop(s.volts, loop)
  return { loop, v2, s, steps, parts: LOOP_PARTS[loop] }
}
const signedV = (v: number) => `${v < 0 ? '−' : '+'}${+Math.abs(v).toPrecision(3)}`
const stepDigits = (v: number) => (Math.abs(v) < 5e-4 ? '0.00' : fitDigits(v, v < 0 ? 4 : 3))

export const kvlAroundALoop: Lesson = {
  id: 'kirchhoff-s-laws-kvl-around-a-loop',
  title: 'KVL around a loop',
  tagline: 'Every round trip sums to zero',
  formula: (p) => {
    const { steps } = solveLoop(p)
    return `ΣV = ${steps.map(signedV).join(' ')} = 0 V`
  },
  legend: [
    { color: OHMS_LABEL, label: 'Change per part, V', shape: 'dot' },
    { color: RING, label: 'Running total, V', shape: 'dot' },
    { color: HIGH_V, label: 'Potential 12 V', shape: 'dot' },
    { color: LOW_V, label: 'Ground 0 V', shape: 'dot' },
  ],
  points: [
    'Potential is like height. Walk any closed loop and you end where you started, so all the climbs and falls on the way add up to zero.',
    'That’s Kirchhoff’s voltage law (KVL): ΣV = 0 around any loop. Climbing a cell from − to + adds its voltage; walking through a resistor with the current loses I × R.',
    'Follow the yellow walker. The total below the circuit jumps at each part it passes and lands back on 0 V when the lap closes.',
    'Pick another loop: right, or the outer one through both cells. Different parts, same zero. Walk a resistor against its current and you climb instead.',
    'With KCL at the nodes and KVL around the loops you can write enough equations to solve any circuit. The next lesson does it systematically.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'loop',
      options: [
        { value: 'left', label: 'Left loop' },
        { value: 'right', label: 'Right loop' },
        { value: 'outer', label: 'Outer loop' },
      ],
      initial: 'left',
    },
    v2Slider,
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const frame = twoSourceFrame(scene)
    const ring = add(scene, new THREE.Group())
    const walker = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), glowMat(RING, 1.1)))
    const labels = Object.fromEntries(
      (Object.keys(PART_AT) as Part[]).map((k) => [k, pulseLabel(scene, 4, OHMS_LABEL, LABEL_AT[k], 1.3)]),
    ) as Record<Part, ReturnType<typeof pulseLabel>>
    const total = pulseLabel(scene, 4, RING, [0, -T_H - 2.4, 0], 1.5)

    let shownLoop = ''
    let curve = path(LOOP_POINTS.left, true)
    let marks: number[] = []
    let dist = 0
    return {
      scene,
      view: { center: [0, 1.3, 0], radius: 49, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const { loop, v2, s, steps, parts } = solveLoop(p)
        frame.update(dt, v2, R3_FIXED, s)
        if (loop !== shownLoop) {
          shownLoop = loop
          emptyGroup(ring)
          const points = LOOP_POINTS[loop]
          const glow = glowMat(RING, 0.5)
          glow.transparent = true
          glow.opacity = 0.2
          glow.depthWrite = false
          lead(ring, [...points, points[0]], 0.5, glow)
          curve = path(points, true)
          marks = parts.map((k) => distanceAlong(points, PART_AT[k]))
          dist = 0
          for (const k of Object.keys(labels) as Part[]) labels[k].display.group.visible = parts.includes(k)
          labels.r3.display.group.position.set(loop === 'left' ? -3.2 : 3.2, -1.6, 0)
        }
        const len = curve.getLength()
        dist = (dist + dt * WALK_SPEED) % len
        curve.getPointAt(dist / len, walker.position)
        walker.position.z = LANE
        parts.forEach((k, i) => labels[k].show(stepDigits(steps[i])))
        const passed = marks.filter((m) => m <= dist).length
        total.show(stepDigits(steps.slice(0, passed).reduce((a, b) => a + b, 0)))
        for (const l of [...Object.values(labels), total]) l.frame(dt)
      },
      readouts: (p) => {
        const { steps, parts } = solveLoop(p)
        return parts.map((k, i) => ({ label: PART_NAME[k], value: `${signedV(steps[i])} V` }))
      },
    }
  },
}

// --- Nodal analysis: name the unknown node voltages, write KCL at each, solve. ---

const N_V = 9
const N_W = 10
const N_H = 6
const A_X = -1
const B_X = 7
const MID_X = (A_X + B_X) / 2
const N_FIXED = [100, 220, 220]
const N_SPEED = 60
const STEP_S = 0.7
const HOLD_S = 3
const SETTLED_V = 1e-3

const solveBridge = (p: Params) => {
  const r = [...N_FIXED, e12(p, 'r4'), e12(p, 'r5')] as [number, number, number, number, number]
  return { r, relax: p.method === 'relax', ...bridgeNodes(N_V, r), ...bridgeMatrix(N_V, r) }
}
const mS = (g: number) => +(g * 1000).toPrecision(3)

export const nodalAnalysis: Lesson = {
  id: 'kirchhoff-s-laws-nodal-analysis',
  title: 'Nodal analysis',
  tagline: 'KCL at every node, then solve',
  formula: (p) => {
    const s = solveBridge(p)
    if (s.relax) return 'Each sweep: VA ← (9/R₁ + VB/R₅) / (1/R₁ + 1/R₂ + 1/R₅), then VB the same way'
    const [[a, b], [c, d]] = s.g
    return `[${mS(a)} ${mS(b)}; ${mS(c)} ${mS(d)}] mS · [VA VB] = [${+mA(s.i[0]).toPrecision(3)} ${+mA(s.i[1]).toPrecision(3)}] mA`
  },
  legend: [
    { color: OHMS_LABEL, label: 'Node voltage VA, VB', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Bridge current, mA', shape: 'dot' },
    { color: POWER, label: 'Sweeps so far', shape: 'dot' },
  ],
  points: [
    'R₅ bridges two dividers, so no pair of resistors is purely in series or parallel. Reduction is stuck; nodal analysis always works.',
    'Pick ground (0 V) and name the other nodes. The supply fixes the top at 9 V, leaving two unknowns, VA and VB. Write KCL at each with I = ΔV / R: (VA − 9)/R₁ + VA/R₂ + (VA − VB)/R₅ = 0, and the same at B.',
    'Stack them as G·V = I: the conductances (1/R) fill the matrix, the supply’s pushes fill I. Gaussian elimination solves it; circuit simulators do exactly this, with thousands of nodes.',
    'Or relax: guess 0 V, then move one node at a time to the voltage that balances its currents. Fixing A unbalances B and back, but each sweep gets closer, and the taps settle onto the exact answer.',
    'Near R₄ = 470 Ω the two dividers nearly match (R₁/R₂ ≈ R₃/R₄), VA ≈ VB, and R₅ goes quiet: a balanced Wheatstone bridge, the trick behind strain-gauge scales.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'method',
      options: [
        { value: 'solve', label: 'Solve G·V = I' },
        { value: 'relax', label: 'Relax step by step' },
      ],
      initial: 'solve',
    },
    resistorSlider('r4', 'R₄', 100),
    resistorSlider('r5', 'R₅ (bridge)', 330),
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[B_X, N_H, 0], [-N_W, N_H, 0], [-N_W, -N_H, 0], [B_X, -N_H, 0]])
    for (const x of [A_X, B_X]) wire(scene, [[x, N_H, 0], [x, -N_H, 0]])
    wire(scene, [[A_X, 0, 0], [B_X, 0, 0]])
    add(scene, cell(CELL_H, 1.5), [-N_W, 0, 0])
    add(scene, groundSymbol(), [MID_X, -N_H, 0])
    resistorAlong(scene, N_FIXED[0], [A_X, N_H / 2 + 1, 0], [A_X, N_H / 2 - 1, 0], R_SCALE)
    resistorAlong(scene, N_FIXED[1], [A_X, -N_H / 2 + 1, 0], [A_X, -N_H / 2 - 1, 0], R_SCALE)
    resistorAlong(scene, N_FIXED[2], [B_X, N_H / 2 + 1, 0], [B_X, N_H / 2 - 1, 0], R_SCALE)
    const r4 = add(scene, new THREE.Group(), [B_X, -N_H / 2, 0])
    const r5 = add(scene, new THREE.Group(), [MID_X, 0, 0])
    const nodes = [junction(scene, [A_X, 0, 0], 0.8), junction(scene, [B_X, 0, 0], 0.8)]

    const f = { a: 0, b: 0 }
    const main = plusFlow(scene, [[A_X, -N_H, LANE], [-N_W, -N_H, LANE], [-N_W, N_H, LANE], [A_X, N_H, LANE]], (at) =>
      at.x <= -N_W + 0.01 ? cellFraction(at.y) : at.y > 0 ? 1 : 0,
    )
    const down = (x: number, top: () => number, mid: () => number) => [
      plusFlow(scene, [[x, N_H, LANE], [x, 0, LANE]], (at) => dropAlong(at, [x, N_H, 0], [x, 0, 0], top(), mid(), RS)),
      plusFlow(scene, [[x, 0, LANE], [x, -N_H, LANE]], (at) => dropAlong(at, [x, 0, 0], [x, -N_H, 0], mid(), 0, RS)),
    ]
    const [f1, f2] = down(A_X, () => 1, () => f.a)
    const [f3, f4] = down(B_X, () => 1, () => f.b)
    const f5 = plusFlow(scene, [[A_X, 0, LANE], [B_X, 0, LANE]], (at) => dropAlong(at, [A_X, 0, 0], [B_X, 0, 0], f.a, f.b, RS))
    const topAB = plusFlow(scene, [[A_X, N_H, LANE], [B_X, N_H, LANE]], () => 1)
    const bottomBA = plusFlow(scene, [[B_X, -N_H, LANE], [A_X, -N_H, LANE]], () => 0)

    const vaLabel = pulseLabel(scene, 3, OHMS_LABEL, [A_X - 4.4, 0, 0], 1.5)
    const vbLabel = pulseLabel(scene, 3, OHMS_LABEL, [B_X + 3.4, 0, 0], 1.5)
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [MID_X, 2.2, 0], 1.3)
    const iArrow = arrow(scene, [MID_X, -1.7, 0], [1, 0, 0], CONVENTIONAL, 0.7)
    const sweepLabel = pulseLabel(scene, 2, POWER, [A_X - 4.4, -3.2, 0], 1.5)

    let key = ''
    let v = [0, N_V, 0, 0]
    let sweepStart = v
    let turn = 0
    let sweeps = 0
    let settled = false
    let t = 0
    const pop = [0, 0]
    const restart = () => {
      v = sweepStart = [0, N_V, 0, 0]
      turn = sweeps = t = 0
      settled = false
    }
    let shownR4 = NaN
    let shownR5 = NaN
    let live = solveBridge({ method: 'solve', r4: 100, r5: 330 })
    const now = () => {
      const { amps: i, supply } = bridgeCurrents(live.elements, v)
      const miss = kclResidual(3, live.elements, [0, ...i])[BRIDGE.a]
      return { i, supply, miss }
    }
    return {
      scene,
      view: { center: [-0.6, 1, 0], radius: 47, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveBridge(p)
        live = s
        const next = `${p.method} ${s.r.join(' ')}`
        if (next !== key) {
          key = next
          restart()
        }
        if (s.r[3] !== shownR4) {
          shownR4 = s.r[3]
          swapResistor(r4, shownR4, [0, 1, 0], [0, -1, 0])
        }
        if (s.r[4] !== shownR5) {
          shownR5 = s.r[4]
          swapResistor(r5, shownR5, [-1, 0, 0], [1, 0, 0])
        }
        if (s.relax) {
          t += dt
          if (!settled && t >= STEP_S) {
            v = relaxNode(bridgeCircuit(N_V, s.r), v, turn ? BRIDGE.b : BRIDGE.a)
            pop[turn] = 1
            turn = 1 - turn
            t = 0
            if (turn === 0) {
              sweeps++
              settled = Math.max(...v.map((x, k) => Math.abs(x - sweepStart[k]))) < SETTLED_V
              sweepStart = v
            }
          } else if (settled && t >= HOLD_S) restart()
        } else v = s.volts
        f.a += (v[BRIDGE.a] / N_V - f.a) * ease(dt)
        f.b += (v[BRIDGE.b] / N_V - f.b) * ease(dt)
        nodes.forEach((node, k) => {
          node.set(k ? f.b : f.a)
          pop[k] = Math.max(0, pop[k] - dt * 2.5)
          node.group.scale.setScalar(1 + 0.6 * pop[k] * pop[k])
        })

        const c = now()
        main.step(dt * c.supply * N_SPEED)
        f1.step(dt * c.i[0] * N_SPEED)
        f2.step(dt * c.i[1] * N_SPEED)
        topAB.step(dt * c.i[2] * N_SPEED)
        f3.step(dt * c.i[2] * N_SPEED)
        f4.step(dt * c.i[3] * N_SPEED)
        bottomBA.step(dt * c.i[3] * N_SPEED)
        f5.step(dt * c.i[4] * N_SPEED)
        pointArrow(iArrow, [c.i[4] < 0 ? -1 : 1, 0, 0])

        vaLabel.show(fitDigits(v[BRIDGE.a], 3))
        vbLabel.show(fitDigits(v[BRIDGE.b], 3))
        iLabel.show(fitDigits(Math.abs(mA(c.i[4])), 3))
        sweepLabel.display.group.visible = s.relax
        sweepLabel.show(String(sweeps))
        for (const l of [vaLabel, vbLabel, iLabel, sweepLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveBridge(p)
        if (!s.relax)
          return [
            { label: 'VA', value: volts(s.va), tone: 'ok' },
            { label: 'VB', value: volts(s.vb), tone: 'ok' },
            { label: 'Through R₅', value: amps(Math.abs(s.amps[4])) },
            { label: 'Supply', value: amps(s.supply) },
          ]
        const c = now()
        return [
          { label: 'VA', value: volts(v[BRIDGE.a]) },
          { label: 'VB', value: volts(v[BRIDGE.b]) },
          { label: 'Sweeps', value: String(sweeps), tone: settled ? 'ok' : undefined },
          { label: 'KCL miss at A', value: `${+Math.abs(mA(c.miss)).toFixed(2)} mA`, tone: settled ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
