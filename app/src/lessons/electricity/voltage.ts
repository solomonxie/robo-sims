import * as THREE from 'three/webgpu'
import { ohmsLaw } from '../../core/formulas'
import { E_CHARGE, METER_INPUT_OHMS, energyAcross, meterReading, relativeTo, seriesPotentials } from '../../core/physics'
import { sci, si, volts } from '../../core/units'
import { V3, add, box, mat, mesh, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  Flow,
  HIGH_V,
  LOW_V,
  RING,
  arrow,
  cell,
  clamp01,
  emptyGroup,
  groundSymbol,
  multimeter,
  path,
  plusFlow,
  plusGeometry,
  potentialColor,
  probe,
  resistorAlong,
  segmentDisplay,
  voltScale,
  wire,
} from '../fx'
import { Lesson, Stage, n } from '../types'

const PER_VOLT = 1.1 // drawn height of one volt
const LANE_Z = 1.3 // charges ride in front of the wire so they stay visible through the resistor

// --- Potential difference: potential drawn as height; the battery lifts charge, the resistor lets it fall. ---

const CELL_X = -12
const SCALE_X = -15.5
const HILL_END = 12
const LOAD_OHMS = 100
const SPEED_PER_AMP = 30 // drawn units/s per amp

export const potentialDifference: Lesson = {
  id: 'voltage-potential-difference',
  title: 'Potential difference',
  tagline: 'Energy per charge',
  formula: 'V = E / Q',
  legend: [
    { color: HIGH_V, label: 'High potential (+)', shape: 'dot' },
    { color: LOW_V, label: '0 V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current', shape: 'arrow-right' },
  ],
  points: [
    'Voltage is energy per charge: 1 volt means each coulomb carries 1 joule. A 9 V battery gives every coulomb 9 J.',
    'Picture height. The battery lifts charge uphill; it rolls back down through the resistor, giving that energy up as heat.',
    'Colour is potential: red at the + terminal, blue at 0 V. Copper wire drops almost nothing, so the whole fall happens across the resistor.',
    'Voltage is always between two points, like a height difference. Here it’s from the bottom wire up to the top one.',
    'Raise the voltage and the hill gets taller: more energy per charge, and more current through the same 100 Ω.',
  ],
  controls: [{ kind: 'slider', key: 'volts', label: 'Battery', min: 1.5, max: 12, initial: 6, step: 0.5, format: volts }],
  build(): Stage {
    const scene = createStage({ span: 22, deskY: -0.3 })
    wire(scene, [[CELL_X, 0, 0], [HILL_END, 0, 0]])
    voltScale(scene, SCALE_X, 0, 12, PER_VOLT)
    const marker = box(scene, [0.6, 0.18, 0.18], mat(RING, { emissive: RING }), [SCALE_X + 0.9, 0, 0])
    const hill = new THREE.Group()
    scene.add(hill)
    let flow: Flow | null = null
    let built = NaN

    const rebuild = (v: number) => {
      emptyGroup(hill)
      const h = v * PER_VOLT
      const battery = cell(h, 1.7)
      battery.position.set(CELL_X, h / 2, 0)
      hill.add(battery)
      wire(hill, [[CELL_X, h, 0], [0, h, 0], [HILL_END, 0, 0]])
      resistorAlong(hill, LOAD_OHMS, [0, h, 0], [HILL_END, 0, 0])
      const lane: V3[] = [[CELL_X, 0, LANE_Z], [CELL_X, h, LANE_Z], [0, h, LANE_Z], [HILL_END, 0, LANE_Z]]
      flow = new Flow(path(lane, true), 1.5, CONVENTIONAL, 0.3, plusGeometry(0.75)).colorBy((at, out) => potentialColor(at.y / h, out))
      hill.add(flow.mesh)
      arrow(hill, [-6, h + 1.8, 0], [1, 0, 0], CONVENTIONAL, 0.9)
      marker.position.y = h
      built = v
    }

    return {
      scene,
      view: { center: [-1.8, 6.2, 0], radius: 50, polar: 1.4, azimuth: 0.18 },
      frame(dt, p) {
        const v = n(p, 'volts')
        if (v !== built) rebuild(v)
        flow!.step(dt * ohmsLaw({ voltsV: v, ohms: LOAD_OHMS }).ampsA * SPEED_PER_AMP)
      },
      readouts: (p) => {
        const v = n(p, 'volts')
        return [
          { label: 'Battery', value: volts(v) },
          { label: 'Energy per coulomb', value: si(energyAcross(v, 1), 'J', 3) },
          { label: 'Energy per electron', value: `${sci(energyAcross(v, E_CHARGE))} J` },
          { label: `Current (${LOAD_OHMS} Ω)`, value: si(ohmsLaw({ voltsV: v, ohms: LOAD_OHMS }).ampsA, 'A', 3) },
        ]
      },
    }
  },
}

// --- Ground and reference: one circuit, three choices of 0 V. Only the labels move. ---

const SUPPLY = 9
const CHAIN = [1000, 2000]
const NODE_NAMES = ['A', 'B', 'C']
const GROUND_X = -14

type Node = { at: V3; label: V3 }

export const groundAndReference: Lesson = {
  id: 'voltage-ground-and-reference',
  title: 'Ground and reference',
  tagline: 'Choosing where 0 V is',
  formula: 'V_AB = V_A − V_B',
  legend: [
    { color: HIGH_V, label: 'Higher potential', shape: 'dot' },
    { color: LOW_V, label: 'Lower potential', shape: 'dot' },
    { color: RING, label: 'Volts above ground', shape: 'dot' },
  ],
  points: [
    'A voltage is a difference between two points. Saying “node B is at 6 V” really means “6 V above the point we called 0 V”.',
    'That chosen point is ground. The glass sheet is 0 V; the ruler measures every node from it.',
    'Move ground and every node voltage shifts by the same amount, some going negative. The circuit, its colours and its current don’t change at all.',
    'Differences are untouched: A is always 3 V above B, so R1 always sees 3 V no matter where ground sits.',
    'Most circuits ground the battery’s − terminal, so everything reads positive. Split supplies ground the middle and get ± rails.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'ground',
      options: [
        { value: 'C', label: 'Ground C' },
        { value: 'B', label: 'Ground B' },
        { value: 'A', label: 'Ground A' },
      ],
      initial: 'C',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const potentials = seriesPotentials(SUPPLY, CHAIN)
    const [yA, yB] = potentials.map((v) => v * PER_VOLT)
    const top = yA

    const circuit = new THREE.Group()
    scene.add(circuit)
    const corners: V3[] = [[-10, 0, 0], [-10, yA, 0], [-4, yA, 0], [0, yB, 0], [5, yB, 0], [10, 0, 0]]
    const battery = cell(yA, 1.7)
    battery.position.set(-10, yA / 2, 0)
    circuit.add(battery)
    wire(circuit, [...corners.slice(1), corners[0]])
    resistorAlong(circuit, CHAIN[0], corners[2], corners[3], 1.5)
    resistorAlong(circuit, CHAIN[1], corners[4], corners[5], 1.5)
    const flow = plusFlow(circuit, corners.map(([x, y]): V3 => [x, y, LANE_Z]), (at) => at.y / top, true)

    const nodes: Node[] = [
      { at: [-7, yA, 0], label: [-7, yA + 2, 0] },
      { at: [2.5, yB, 0], label: [3.2, yB + 2, 0] },
      { at: [-2, 0, 0], label: [-2, 2, 0] },
    ]
    const labels = nodes.map(({ at, label }, i) => {
      add(circuit, mesh(new THREE.SphereGeometry(0.5, 20, 14), mat(potentialColor(potentials[i] / SUPPLY).getStyle(), { rough: 0.3 })), at)
      const name = segmentDisplay(1, 1.3, '#e8e8e8', true)
      name.set(NODE_NAMES[i])
      name.group.position.set(label[0] - 1.8, label[1], label[2])
      const value = segmentDisplay(2, 1.3, RING, true)
      value.group.position.set(...label)
      circuit.add(name.group, value.group)
      return value
    })
    const earth = groundSymbol()
    circuit.add(earth)

    const sheet = mesh(
      new THREE.PlaneGeometry(28, 12),
      new THREE.MeshStandardMaterial({ color: '#cfd6e6', transparent: true, opacity: 0.08, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    )
    sheet.rotation.x = -Math.PI / 2
    sheet.position.x = -1
    sheet.castShadow = false
    scene.add(sheet)
    voltScale(scene, GROUND_X, -SUPPLY, SUPPLY, PER_VOLT)
    box(scene, [0.6, 0.18, 0.18], mat(RING, { emissive: RING }), [GROUND_X + 0.9, 0, 0])

    let shown = ''
    return {
      scene,
      view: { center: [-1.5, 1, 0], radius: 55, polar: 1.36, azimuth: 0.2 },
      frame(dt, p) {
        const g = NODE_NAMES.indexOf(String(p.ground))
        const target = -potentials[g] * PER_VOLT
        circuit.position.y += (target - circuit.position.y) * Math.min(1, dt * 5)
        flow.step(dt * 2)
        if (p.ground !== shown) {
          shown = String(p.ground)
          relativeTo(potentials, potentials[g]).forEach((v, i) => labels[i].set(String(Math.round(v))))
          earth.position.set(nodes[g].at[0], nodes[g].at[1] - 0.4, 0)
        }
      },
      readouts: (p) => {
        const rel = relativeTo(potentials, potentials[NODE_NAMES.indexOf(String(p.ground))])
        return [
          { label: 'V_A', value: volts(rel[0]) },
          { label: 'V_B', value: volts(rel[1]) },
          { label: 'V_C', value: volts(rel[2]) },
          { label: 'Across R1 (A − B)', value: volts(rel[0] - rel[1]) },
        ]
      },
    }
  },
}

// --- Measuring with a multimeter: probes across a part read red minus black. ---

const LEFT = -13
const RIGHT = 0
const TOP = 9
const BOTTOM = 0
const MID_X = (LEFT + RIGHT) / 2
const MID_Y = (TOP + BOTTOM) / 2
const CELL_H = 4.6
const R_SPAN = 1.92 // half-length of a 1.6× resistor body
const PROBE_RED = '#e04848'
const PROBE_BLACK = '#9aa0aa'

type Across = 'battery' | 'r1' | 'r2'

const TIPS: Record<Across, [red: V3, black: V3, redNode: number, blackNode: number]> = {
  battery: [[LEFT + 2.5, TOP, 0], [LEFT + 2.5, BOTTOM, 0], 0, 2],
  r1: [[MID_X - 3.2, TOP, 0], [MID_X + 3.2, TOP, 0], 0, 1],
  r2: [[RIGHT, TOP - 1.4, 0], [RIGHT, BOTTOM + 1.4, 0], 1, 2],
}

/** Potential at a point on the loop: cell up the left side, R1 along the top, R2 down the right. */
function loopPotential(x: number, y: number, [vA, vB]: number[]): number {
  if (y <= BOTTOM + 0.01) return 0
  if (x <= LEFT + 0.01) return vA * clamp01((y - MID_Y + CELL_H / 2) / CELL_H)
  if (y >= TOP - 0.01) return vA + (vB - vA) * clamp01((x - MID_X + R_SPAN) / (2 * R_SPAN))
  return vB * clamp01((y - MID_Y + R_SPAN) / (2 * R_SPAN))
}

export const measuringWithMultimeter: Lesson = {
  id: 'voltage-measuring-with-a-multimeter',
  title: 'Measuring with a multimeter',
  tagline: 'Probes across, red minus black',
  formula: 'V = V_red − V_black',
  legend: [
    { color: HIGH_V, label: 'Higher potential', shape: 'dot' },
    { color: LOW_V, label: '0 V', shape: 'dot' },
    { color: PROBE_RED, label: 'Red probe (V jack)', shape: 'dot' },
    { color: PROBE_BLACK, label: 'Black probe (COM)', shape: 'dot' },
  ],
  points: [
    'Set the dial to V⎓ (DC volts). Black lead in COM, red lead in the V jack.',
    'Touch the probes across the part, one on each side, while the circuit runs. You don’t break the circuit to measure voltage.',
    'The meter shows red minus black. Across the battery it reads the full 9 V; across R1 and R2 it reads 3 V and 6 V, which add back up to 9 V.',
    'Swap the probes and the same voltage reads negative. Nothing is broken; it just tells you red is on the lower side.',
    'A voltmeter has about 10 MΩ inside, so it sips under a microamp and barely disturbs what it measures.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'across',
      options: [
        { value: 'battery', label: 'Battery' },
        { value: 'r1', label: 'R1' },
        { value: 'r2', label: 'R2' },
      ],
      initial: 'r2',
    },
    {
      kind: 'choice',
      key: 'leads',
      options: [
        { value: 'normal', label: 'Red on +' },
        { value: 'swapped', label: 'Swapped' },
      ],
      initial: 'normal',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const potentials = seriesPotentials(SUPPLY, CHAIN)
    const loop: V3[] = [[LEFT, BOTTOM, 0], [LEFT, TOP, 0], [RIGHT, TOP, 0], [RIGHT, BOTTOM, 0]]
    wire(scene, [...loop, loop[0]])
    const battery = cell(CELL_H, 1.4)
    battery.position.set(LEFT, MID_Y, 0)
    scene.add(battery)
    resistorAlong(scene, CHAIN[0], [MID_X - 1, TOP, 0], [MID_X + 1, TOP, 0])
    resistorAlong(scene, CHAIN[1], [RIGHT, MID_Y + 1, 0], [RIGHT, MID_Y - 1, 0])
    const lane = loop.map(([x, y]): V3 => [x, y, LANE_Z * 0.8])
    const flow = new Flow(path(lane, true), 1.4, CONVENTIONAL, 0.3, plusGeometry(0.7))
    flow.colorBy((at, out) => potentialColor(loopPotential(at.x, at.y, potentials) / SUPPLY, out))
    scene.add(flow.mesh)

    const meter = multimeter()
    meter.group.scale.setScalar(0.7)
    meter.group.position.set(8, 3.5, 0)
    meter.group.rotation.set(-0.12, -0.3, 0)
    scene.add(meter.group)
    const leads = new THREE.Group()
    scene.add(leads)

    const jack = (local: V3): V3 => {
      meter.group.updateMatrixWorld(true)
      return new THREE.Vector3(...local).applyMatrix4(meter.group.matrixWorld).toArray() as V3
    }
    const redJack = jack(meter.red)
    const blackJack = jack(meter.black)

    let shown = ''
    const reading = (p: Record<string, number | string>) => {
      const [, , r, b] = TIPS[p.across as Across]
      const [red, black] = p.leads === 'swapped' ? [b, r] : [r, b]
      return { red, black, volts: meterReading(potentials[red], potentials[black]) }
    }

    return {
      scene,
      view: { center: [-2, 3, 0], radius: 52, polar: 1.4, azimuth: 0.1 },
      frame(dt, p) {
        flow.step(dt * 2)
        const key = `${p.across}|${p.leads}`
        if (key === shown) return
        shown = key
        emptyGroup(leads)
        const [tipR, tipB] = TIPS[p.across as Across]
        const [red, black] = p.leads === 'swapped' ? [tipB, tipR] : [tipR, tipB]
        for (const [tip, color, to] of [
          [red, PROBE_RED, redJack],
          [black, PROBE_BLACK, blackJack],
        ] as const) {
          const end = probe(leads, tip, [0.2, -0.5, 1], color)
          const low = Math.min(end[1], to[1]) - 3
          const cable: V3[] = [end, [end[0] + 0.6, end[1] - 1.5, end[2] + 0.8], [(end[0] + to[0]) / 2, low, (end[2] + to[2]) / 2 + 2], [to[0], to[1] - 1.5, to[2] + 1], to]
          tube(leads, cable, 0.15, mat(color, { rough: 0.6 }), 64)
        }
        meter.display.set(reading(p).volts.toFixed(2))
      },
      readouts: (p) => {
        const r = reading(p)
        return [
          { label: 'Meter reads', value: volts(r.volts), tone: r.volts < 0 ? 'warn' : 'ok' },
          { label: 'Red probe at', value: volts(potentials[r.red]) },
          { label: 'Black probe at', value: volts(potentials[r.black]) },
          { label: 'Meter draws', value: si(ohmsLaw({ voltsV: Math.abs(r.volts), ohms: METER_INPUT_OHMS }).ampsA, 'A', 2) },
        ]
      },
    }
  },
}
