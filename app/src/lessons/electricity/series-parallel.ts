import * as THREE from 'three/webgpu'
import { cellPack, parallelBranches, powerV2R, runtimeHours, seriesChain, seriesWithPair } from '../../core/physics'
import { amps, fitDigits, mA, ohms, si, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  Flow,
  HIGH_V,
  LANE,
  LOW_V,
  OHMS_LABEL,
  POWER,
  R_SCALE,
  RS,
  arrow,
  bulb,
  cell,
  cellFraction,
  chargeTank,
  clamp01,
  ease,
  emptyGroup,
  lerp,
  plusFlow,
  pulseLabel,
  resistorAlong,
  swapResistor,
  voltStack,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, resistorSlider } from '../types'

const BATTERY_V = 9

// --- Series resistors: one path, one current; the battery's voltage is shared out. ---

const S_W = 11
const S_H = 5
const R1_X = -3.4
const R2_X = 4.6
const S_SPEED = 80 // drawn units/s per amp

const solveSeries = (p: Params) => {
  const r = [e12(p, 'r1'), e12(p, 'r2')]
  return { r, ...seriesChain(BATTERY_V, r) }
}

export const seriesResistors: Lesson = {
  id: 'series-parallel-series-resistors',
  title: 'Series resistors',
  tagline: 'One path, shared voltage',
  formula: (p) => {
    const s = solveSeries(p)
    return `R = R₁ + R₂ = ${ohms(s.r[0])} + ${ohms(s.r[1])} = ${ohms(s.totalOhms)}`
  },
  legend: [
    { color: HIGH_V, label: 'Drop across each, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current, mA', shape: 'dot' },
    { color: LOW_V, label: 'Potential 0 V', shape: 'dot' },
  ],
  points: [
    'In series the parts sit end to end: one path. Every charge goes through R₁ and then R₂, so the current is the same everywhere in the loop.',
    'The resistances add: R = R₁ + R₂. Each one you add lowers the current: I = V / (R₁ + R₂).',
    'The battery’s 9 V is shared out. Each resistor drops V = I × R, and the drops add back up to 9 V. The charges lose their colour in two steps.',
    'The bigger resistor takes the bigger share. 100 Ω and 220 Ω split 9 V into 2.81 V and 6.19 V. The column on the left stacks the two drops.',
    'One break anywhere stops the lot. Old Christmas lights all went out together because their bulbs were wired in series.',
  ],
  controls: [resistorSlider('r1', 'R₁', 100), resistorSlider('r2', 'R₂', 220)],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[-S_W, -S_H, 0], [-S_W, S_H, 0], [S_W, S_H, 0], [S_W, -S_H, 0], [-S_W, -S_H, 0]])
    const battery = cell(CELL_H, 1.5)
    battery.position.set(-S_W, 0, 0)
    scene.add(battery)
    const holders = [add(scene, new THREE.Group()), add(scene, new THREE.Group())]
    const stack = voltStack(scene, 2, (2 * S_H) / BATTERY_V, BATTERY_V, 1)
    stack.group.position.set(-S_W + 4, -S_H, -1.2)

    let mid = 0
    const fraction = (x: number, y: number) => {
      if (x <= -S_W + 0.01) return cellFraction(y)
      if (y < S_H - 0.01) return 0
      if (x < R1_X - RS) return 1
      if (x < R1_X + RS) return lerp(1, mid, (x - R1_X + RS) / (2 * RS))
      if (x < R2_X - RS) return mid
      return lerp(mid, 0, (x - R2_X + RS) / (2 * RS))
    }
    const lane: V3[] = [[-S_W, -S_H, LANE], [-S_W, S_H, LANE], [S_W, S_H, LANE], [S_W, -S_H, LANE]]
    const flow = plusFlow(scene, lane, (at) => fraction(at.x, at.y), true)

    const v1 = pulseLabel(scene, 3, HIGH_V, [R1_X, S_H + 2.2, 0])
    const v2 = pulseLabel(scene, 3, HIGH_V, [R2_X, S_H + 2.2, 0])
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [-1.4, -S_H - 2.2, 0])
    arrow(scene, [3, -S_H - 2.2, 0], [-1, 0, 0], CONVENTIONAL, 0.8)

    const shown = [NaN, NaN]
    const shownV = [0, 0]
    return {
      scene,
      view: { center: [0, 0.4, 0], radius: 50, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveSeries(p)
        s.r.forEach((r, k) => {
          if (r === shown[k]) return
          shown[k] = r
          const x = k ? R2_X : R1_X
          swapResistor(holders[k], r, [x - 1, S_H, 0], [x + 1, S_H, 0])
        })
        shownV[0] += (s.drops[1] - shownV[0]) * ease(dt, 8)
        shownV[1] += (s.drops[0] - shownV[1]) * ease(dt, 8)
        stack.set(shownV)
        mid = s.drops[1] / BATTERY_V
        flow.step(dt * s.amps * S_SPEED)
        v1.show(fitDigits(s.drops[0], 3))
        v2.show(fitDigits(s.drops[1], 3))
        iLabel.show(fitDigits(mA(s.amps), 3))
        for (const l of [v1, v2, iLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveSeries(p)
        return [
          { label: 'Total R', value: ohms(s.totalOhms) },
          { label: 'Current I', value: amps(s.amps) },
          { label: 'Across R₁', value: volts(s.drops[0]) },
          { label: 'Across R₂', value: volts(s.drops[1]) },
        ]
      },
    }
  },
}

// --- Parallel resistors: every branch gets the full voltage; the currents add up in the main wire. ---

const P_W = 11
const P_H = 5
const R3_FIXED = 220
const P_SPEED = 40
const BRANCH_X: Record<string, number[]> = { '2': [0.5, 8.5], '3': [-2.5, 3.5, 9.5] }

const solveParallel = (p: Params) => {
  const r = [e12(p, 'r1'), e12(p, 'r2'), ...(p.paths === '3' ? [R3_FIXED] : [])]
  return { r, ...parallelBranches(BATTERY_V, r) }
}

export const parallelResistors: Lesson = {
  id: 'series-parallel-parallel-resistors',
  title: 'Parallel resistors',
  tagline: 'Full voltage each, currents add',
  formula: (p) => {
    const s = solveParallel(p)
    const terms = s.r.map((_, k) => `1/R${'₁₂₃'[k]}`).join(' + ')
    return `1/R = ${terms} → R = ${ohms(s.totalOhms)}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current per path, mA', shape: 'dot' },
    { color: OHMS_LABEL, label: 'Total R, Ω', shape: 'dot' },
    { color: HIGH_V, label: 'Potential 9 V', shape: 'dot' },
  ],
  points: [
    'In parallel each part bridges the same two wires, so every branch gets the full 9 V.',
    'Each branch draws its own current, I = V / R, and the currents add in the main wire: I = I₁ + I₂. The charges there move as fast as the branches’ combined.',
    'More current from the same voltage means less resistance: 1/R = 1/R₁ + 1/R₂. Two equal resistors in parallel give half: 220 Ω ∥ 220 Ω = 110 Ω.',
    'The total is always below the smallest branch. Most current takes the easy path, but every path carries some.',
    'Add a third path (R₃ = 220 Ω) and the total drops again. Wall sockets are wired this way: each appliance gets full voltage, and the main cable carries the sum.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'paths',
      options: [
        { value: '2', label: '2 paths' },
        { value: '3', label: '3 paths' },
      ],
      initial: '2',
    },
    resistorSlider('r1', 'R₁', 100),
    resistorSlider('r2', 'R₂', 220),
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const battery = cell(CELL_H, 1.5)
    battery.position.set(-P_W, 0, 0)
    scene.add(battery)
    const net = add(scene, new THREE.Group())
    const fraction = (x: number, y: number) => (x <= -P_W + 0.01 ? cellFraction(y) : clamp01((y + RS) / (2 * RS)))
    const paint = (at: THREE.Vector3) => fraction(at.x, at.y)

    let holders: THREE.Group[] = []
    let flows: { flow: Flow; amps: (a: number[], total: number) => number }[] = []
    let labels: ReturnType<typeof pulseLabel>[] = []
    let rLabel: ReturnType<typeof pulseLabel> | null = null
    let iLabel: ReturnType<typeof pulseLabel> | null = null
    let shownPaths = ''
    let shownR: number[] = []
    const rebuild = (paths: string) => {
      emptyGroup(net)
      const xs = BRANCH_X[paths]
      const last = xs[xs.length - 1]
      wire(net, [[xs[0], -P_H, 0], [-P_W, -P_H, 0], [-P_W, P_H, 0], [last, P_H, 0]])
      wire(net, [[xs[0], -P_H, 0], [last, -P_H, 0]])
      xs.forEach((x) => wire(net, [[x, P_H, 0], [x, -P_H, 0]]))
      holders = xs.map(() => add(net, new THREE.Group()))
      shownR = []
      flows = [{ flow: plusFlow(net, [[xs[0], -P_H, LANE], [-P_W, -P_H, LANE], [-P_W, P_H, LANE], [xs[0], P_H, LANE]], paint), amps: (_, t) => t }]
      xs.forEach((x, k) => {
        flows.push({ flow: plusFlow(net, [[x, P_H, LANE], [x, -P_H, LANE]], paint), amps: (a) => a[k] })
        if (k === 0) return
        const rest = (a: number[]) => a.slice(k).reduce((s, v) => s + v, 0)
        flows.push({ flow: plusFlow(net, [[xs[k - 1], P_H, LANE], [x, P_H, LANE]], paint), amps: rest })
        flows.push({ flow: plusFlow(net, [[x, -P_H, LANE], [xs[k - 1], -P_H, LANE]], paint), amps: rest })
      })
      labels = xs.map((x) => pulseLabel(net, 3, CONVENTIONAL, [x, P_H + 2, 0], 1.3))
      iLabel = pulseLabel(net, 3, CONVENTIONAL, [(-P_W + xs[0]) / 2 - 1.4, -P_H - 2.2, 0], 1.6)
      arrow(net, [(-P_W + xs[0]) / 2 + 2.8, -P_H - 2.2, 0], [-1, 0, 0], CONVENTIONAL, 0.8)
      rLabel = pulseLabel(net, 3, OHMS_LABEL, [(-P_W + xs[0]) / 2, 0, 0], 1.5)
    }

    return {
      scene,
      view: { center: [0, 1, 0], radius: 50, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const paths = String(p.paths)
        if (paths !== shownPaths) {
          shownPaths = paths
          rebuild(paths)
        }
        const s = solveParallel(p)
        const xs = BRANCH_X[paths]
        s.r.forEach((r, k) => {
          if (r === shownR[k]) return
          shownR[k] = r
          swapResistor(holders[k], r, [xs[k], 1, 0], [xs[k], -1, 0])
        })
        for (const f of flows) f.flow.step(dt * f.amps(s.branchAmps, s.amps) * P_SPEED)
        labels.forEach((l, k) => {
          l.show(fitDigits(mA(s.branchAmps[k]), 3))
          l.frame(dt)
        })
        iLabel!.show(fitDigits(mA(s.amps), 3))
        iLabel!.frame(dt)
        rLabel!.show(fitDigits(s.totalOhms, 3))
        rLabel!.frame(dt)
      },
      readouts: (p) => {
        const s = solveParallel(p)
        return [
          { label: 'Total R', value: ohms(s.totalOhms) },
          { label: 'Total I', value: amps(s.amps) },
          { label: 'Through R₁', value: amps(s.branchAmps[0]) },
          { label: 'Through R₂', value: amps(s.branchAmps[1]) },
        ]
      },
    }
  },
}

// --- Cells in series and parallel: series stacks volts, parallel stacks capacity. ---

const CELL_V = 1.5
const CELL_MAH = 2000
const LOAD_OHMS = 10
const MAX_PACK_V = 3
const HOURS_PER_S = 4
const HOLD_S = 1.4
const K_LX = -8
const K_RX = 9
const K_H = 5.6
const TANK_H = 3.8
const TANK_R = 1.05
const PITCH = 4.4
const COL_DX = 1.9
const BULB_X = 2.4

const PACKS: Record<string, [series: number, parallel: number]> = { '1x1': [1, 1], '2x1': [2, 1], '1x2': [1, 2], '2x2': [2, 2] }

const solvePack = (p: Params) => {
  const [series, parallel] = PACKS[String(p.pack)]
  const pack = cellPack(CELL_V, CELL_MAH, series, parallel)
  const loadA = pack.volts / LOAD_OHMS
  return { series, parallel, ...pack, loadA, watts: powerV2R(pack.volts, LOAD_OHMS), hours: runtimeHours(pack.mAh, mA(loadA)) }
}

export const cellsSeriesParallel: Lesson = {
  id: 'series-parallel-cells-in-series-and-parallel',
  title: 'Cells in series and parallel',
  tagline: 'Stack the volts or the capacity',
  formula: (p) => {
    const s = solvePack(p)
    return `${s.series}S${s.parallel}P: ${s.series} × ${CELL_V} V = ${s.volts} V, ${s.parallel} × ${CELL_MAH} mAh = ${s.mAh} mAh, ${+s.wh.toPrecision(3)} Wh`
  },
  legend: [
    { color: HIGH_V, label: 'Pack voltage, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Capacity, mAh', shape: 'dot' },
    { color: OHMS_LABEL, label: 'Hours running', shape: 'dot' },
    { color: POWER, label: 'Charge left', shape: 'dot' },
  ],
  points: [
    'In series, the + of one cell touches the − of the next and the voltages stack: two 1.5 V cells make 3 V. The same charge passes through both, so the capacity stays 2000 mAh.',
    'In parallel, + joins + and − joins −. The voltage stays 1.5 V, but the cells share the current, so the capacity adds: 4000 mAh, twice the runtime.',
    'Either way two cells hold twice the energy: Wh = V × Ah = 6 Wh. Series spends it faster, parallel slower.',
    'On a 10 Ω bulb, twice the voltage drives twice the current: 4× the power (P = V² / R). Brighter, but flat in half the time of one cell. The clock runs 4 hours a second.',
    'Combine both: 2S2P is 3 V and 4000 mAh. Packs are named this way, like an e-bike’s 10S4P. Only parallel cells at the same voltage, or current rushes between them.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pack',
      options: [
        { value: '1x1', label: '1 cell' },
        { value: '2x1', label: '2 series' },
        { value: '1x2', label: '2 parallel' },
        { value: '2x2', label: '2S2P' },
      ],
      initial: '1x1',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[K_LX, K_H, 0], [BULB_X - 2.4, K_H, 0]])
    wire(scene, [[BULB_X + 2.2, K_H, 0], [K_RX, K_H, 0], [K_RX, -K_H, 0], [K_LX, -K_H, 0]])
    const lamp = bulb()
    lamp.group.scale.setScalar(0.62)
    lamp.group.rotation.z = -Math.PI / 2
    lamp.group.position.set(BULB_X + 0.4, K_H, 0)
    scene.add(lamp.group)
    const packGroup = add(scene, new THREE.Group())
    let tanks: ReturnType<typeof chargeTank>[] = []

    let level = 0
    const fraction = (x: number, y: number) => (y >= K_H - 0.01 && x < BULB_X ? 1 : 0)
    const lane: V3[] = [[K_LX, K_H, LANE], [K_RX, K_H, LANE], [K_RX, -K_H, LANE], [K_LX, -K_H, LANE]]
    const flow = plusFlow(scene, lane, (at) => fraction(at.x, at.y) * level)

    const labelX = K_LX + 7
    const vLabel = pulseLabel(scene, 3, HIGH_V, [labelX, 1.4, 0], 1.6)
    const cLabel = pulseLabel(scene, 4, CONVENTIONAL, [labelX, -1.4, 0], 1.3)
    const hLabel = pulseLabel(scene, 3, OHMS_LABEL, [BULB_X + 3.2, 0, 0], 1.6)

    const rebuild = (series: number, parallel: number) => {
      emptyGroup(packGroup)
      const xs = parallel === 1 ? [K_LX] : [K_LX - COL_DX, K_LX + COL_DX]
      const ys = series === 1 ? [0] : [PITCH / 2, -PITCH / 2]
      const top = ys[0] + TANK_H / 2 + 0.55
      const bottom = ys[ys.length - 1] - TANK_H / 2 - 0.15
      tanks = []
      for (const x of xs) {
        for (const y of ys) {
          const tank = chargeTank(TANK_H, TANK_R)
          tank.group.position.set(x, y, 0)
          packGroup.add(tank.group)
          tanks.push(tank)
        }
        wire(packGroup, [[x, top, 0], [x, K_H, 0]])
        wire(packGroup, [[x, bottom, 0], [x, -K_H, 0]])
      }
      if (parallel > 1) for (const y of [K_H, -K_H]) wire(packGroup, [[xs[0], y, 0], [xs[1], y, 0]])
    }

    let shown = ''
    let t = 0
    let simH = 0
    return {
      scene,
      view: { center: [0.6, 0.4, 0], radius: 45, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solvePack(p)
        if (p.pack !== shown) {
          shown = String(p.pack)
          rebuild(s.series, s.parallel)
          t = 0
        }
        t = (t + dt) % (s.hours / HOURS_PER_S + HOLD_S)
        simH = Math.min(s.hours, t * HOURS_PER_S)
        const left = 1 - simH / s.hours
        for (const tank of tanks) tank.set(left)
        const running = left > 0
        level = running ? s.volts / MAX_PACK_V : 0
        flow.step(running ? dt * s.loadA * 30 : 0)
        lamp.setGlow(running ? clamp01(s.watts / powerV2R(MAX_PACK_V, LOAD_OHMS)) : 0)
        vLabel.show(fitDigits(s.volts, 3))
        cLabel.show(String(s.mAh))
        hLabel.show(fitDigits(simH, 3))
        for (const l of [vLabel, cLabel, hLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solvePack(p)
        return [
          { label: 'Pack', value: `${s.volts} V` },
          { label: 'Capacity', value: `${s.mAh} mAh` },
          { label: 'Bulb P = V² / R', value: si(s.watts, 'W', 3) },
          { label: 'Runtime', value: `${+s.hours.toPrecision(3)} h` },
        ]
      },
    }
  },
}

// --- Mixed networks: collapse the parallel pair, then the series chain, into one resistor. ---

type Step = 'network' | 'pair' | 'total'

const M_R1 = 100
const M_R2 = 220
const M_LX = -9
const M_RX = 4.4
const M_DX = 4.8
const M_H = 5
const M_R1_X = -2.2
const M_SPEED = 60
const PRESENCE: Record<Step, { r1: number; r2: number; r3: number; pair: number; total: number }> = {
  network: { r1: 1, r2: 1, r3: 1, pair: 0, total: 0 },
  pair: { r1: 1, r2: 0, r3: 0, pair: 1, total: 0 },
  total: { r1: 0, r2: 0, r3: 0, pair: 0, total: 1 },
}

const solveMixed = (p: Params) => {
  const r3 = e12(p, 'r3')
  return { r3, ...seriesWithPair(M_R1, M_R2, r3, BATTERY_V) }
}

export const mixedNetworks: Lesson = {
  id: 'series-parallel-mixed-networks',
  title: 'Mixed networks',
  tagline: 'Reduce it one group at a time',
  formula: (p) => {
    const s = solveMixed(p)
    if (p.step === 'pair') return `R₂ ∥ R₃ = 1 / (1/${M_R2} + 1/${s.r3}) = ${ohms(s.pairOhms)}`
    if (p.step === 'total') return `R = ${ohms(M_R1)} + ${ohms(s.pairOhms)} = ${ohms(s.totalOhms)}, I = 9 V / R = ${amps(s.amps)}`
    return 'R = R₁ + (R₂ ∥ R₃)'
  },
  legend: [
    { color: OHMS_LABEL, label: 'Resistance, Ω', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current, mA', shape: 'dot' },
    { color: HIGH_V, label: 'Potential 9 V', shape: 'dot' },
  ],
  points: [
    'Real circuits mix both. Solve them by reduction: find a group that is purely series or purely parallel, swap it for one equivalent resistor, and repeat.',
    'R₂ and R₃ join the same two points, so they’re in parallel: R₂ ∥ R₃ = 1 / (1/R₂ + 1/R₃). With 220 Ω and 220 Ω that’s 110 Ω.',
    'That equivalent sits in series with R₁, so add: R = R₁ + R₂ ∥ R₃ = 210 Ω. Now it’s one resistor, and I = V / R = 42.9 mA.',
    'Then work back out: R₁ drops I × R₁ = 4.29 V, the pair gets the other 4.71 V, and each branch takes V / R of that.',
    'Make R₃ huge and the pair is just R₂. Make it tiny and it shorts R₂ out, leaving mostly R₁.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'step',
      options: [
        { value: 'network', label: 'Network' },
        { value: 'pair', label: 'R₂ ∥ R₃' },
        { value: 'total', label: 'Total' },
      ],
      initial: 'network',
    },
    resistorSlider('r3', 'R₃', 220),
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const root = add(scene, new THREE.Group())
    wire(root, [[M_LX, -M_H, 0], [M_LX, M_H, 0], [M_RX, M_H, 0], [M_RX, -M_H, 0], [M_LX, -M_H, 0]])
    const battery = cell(CELL_H, 1.5)
    battery.position.set(M_LX, 0, 0)
    root.add(battery)

    const holder = (at: V3, value: number | null) => {
      const g = add(root, new THREE.Group(), at)
      if (value !== null) resistorAlong(g, value, [0, 1, 0], [0, -1, 0], R_SCALE)
      return g
    }
    const r1 = holder([M_R1_X, M_H, 0], null)
    resistorAlong(r1, M_R1, [-1, 0, 0], [1, 0, 0], R_SCALE)
    const r2 = holder([M_RX, 0, 0], M_R2)
    const pair = holder([M_RX, 0, 0], null)
    const total = holder([M_RX, 0, 0], null)
    const branch = add(root, new THREE.Group(), [M_RX, 0, 0])
    wire(branch, [[0, M_H, 0], [M_DX, M_H, 0], [M_DX, -M_H, 0], [0, -M_H, 0]])
    const r3 = add(branch, new THREE.Group())

    let after = 1
    const down = (y: number) => clamp01((y + RS) / (2 * RS))
    const fraction = (x: number, y: number) => {
      if (x <= M_LX + 0.01) return cellFraction(y)
      if (y <= -M_H + 0.01) return 0
      if (y >= M_H - 0.01) return lerp(1, after, (x - M_R1_X + RS) / (2 * RS))
      return after * down(y)
    }
    const mainFlow = plusFlow(root, [[M_RX, -M_H, LANE], [M_LX, -M_H, LANE], [M_LX, M_H, LANE], [M_RX, M_H, LANE]], (at) => fraction(at.x, at.y))
    const sideFlow = plusFlow(root, [[M_RX, M_H, LANE], [M_RX, -M_H, LANE]], (at) => fraction(at.x, at.y))
    const branchFlow = plusFlow(branch, [[0, M_H, LANE], [M_DX, M_H, LANE], [M_DX, -M_H, LANE], [0, -M_H, LANE]], (at) =>
      at.y >= M_H - 0.01 ? after : at.y <= -M_H + 0.01 ? 0 : after * down(at.y),
    )

    const r1Label = pulseLabel(root, 3, OHMS_LABEL, [M_R1_X, M_H + 2.2, 0], 1.5)
    const sideLabel = pulseLabel(root, 3, OHMS_LABEL, [M_RX - 3.6, 0, 0], 1.5)
    const r3Label = pulseLabel(root, 3, OHMS_LABEL, [M_RX + M_DX + 3.4, 0, 0], 1.5)
    const iLabel = pulseLabel(root, 3, CONVENTIONAL, [M_R1_X - 1.4, -M_H - 2.2, 0], 1.5)
    arrow(root, [M_R1_X + 2.8, -M_H - 2.2, 0], [-1, 0, 0], CONVENTIONAL, 0.8)

    const now = { r1: 1, r2: 1, r3: 1, pair: 0, total: 0 }
    let shownR3 = NaN
    let shownPair = NaN
    let shownTotal = NaN
    return {
      scene,
      view: { center: [1.6, 0.6, 0], radius: 52, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveMixed(p)
        const step = (p.step as Step) ?? 'network'
        if (s.r3 !== shownR3) {
          shownR3 = s.r3
          swapResistor(r3, s.r3, [M_DX, 1, 0], [M_DX, -1, 0])
        }
        if (s.pairOhms !== shownPair) {
          shownPair = s.pairOhms
          swapResistor(pair, s.pairOhms, [0, 1, 0], [0, -1, 0])
        }
        if (s.totalOhms !== shownTotal) {
          shownTotal = s.totalOhms
          swapResistor(total, s.totalOhms, [0, 1, 0], [0, -1, 0])
        }
        const target = PRESENCE[step]
        for (const k of Object.keys(now) as (keyof typeof now)[]) now[k] += (target[k] - now[k]) * ease(dt)
        const grow = (g: THREE.Object3D, f: number) => {
          g.visible = f > 0.01
          g.scale.setScalar(Math.max(0.001, f))
        }
        grow(r1, now.r1)
        grow(r2, now.r2)
        grow(pair, now.pair)
        grow(total, now.total)
        branch.visible = now.r3 > 0.01
        branch.scale.x = Math.max(0.001, now.r3)
        root.position.x = (M_DX / 2) * (1 - now.r3)

        after = lerp(1, s.pairV / BATTERY_V, now.r1)
        const side = step === 'network' ? s.amps2 : s.amps
        mainFlow.step(dt * s.amps * M_SPEED)
        sideFlow.step(dt * side * M_SPEED)
        branchFlow.step(dt * s.amps3 * M_SPEED)

        r1Label.display.group.visible = now.r1 > 0.5
        r3Label.display.group.visible = now.r3 > 0.5
        r1Label.show(String(M_R1))
        r3Label.show(String(s.r3))
        sideLabel.show(fitDigits(step === 'network' ? M_R2 : step === 'pair' ? s.pairOhms : s.totalOhms, 3))
        iLabel.show(fitDigits(mA(s.amps), 3))
        for (const l of [r1Label, r3Label, sideLabel, iLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveMixed(p)
        return [
          { label: 'R₂ ∥ R₃', value: ohms(s.pairOhms), tone: p.step === 'pair' ? 'ok' : undefined },
          { label: 'Total R', value: ohms(s.totalOhms), tone: p.step === 'total' ? 'ok' : undefined },
          { label: 'Current I', value: amps(s.amps) },
          { label: 'V₁ / V pair', value: `${+s.v1.toPrecision(3)} / ${+s.pairV.toPrecision(3)} V` },
        ]
      },
    }
  },
}
