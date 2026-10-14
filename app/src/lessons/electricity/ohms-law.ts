import * as THREE from 'three/webgpu'
import { ohmsLaw } from '../../core/formulas'
import { filamentOhms } from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, si } from '../../core/units'
import { V3, add, mat, mesh, rod, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  HIGH_V,
  RING,
  arrow,
  bulb,
  cell,
  clamp01,
  emptyGroup,
  formulaTriangle,
  glowMat,
  pulseLabel,
  resistorAlong,
  resistorLoop,
  segmentDisplay,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const MAX_V = 12
const SPEED_PER_AMP = 70 // drawn units/s per amp
const volts = (v: number) => si(v, 'V', 3)
const amps = (a: number) => si(a, 'A', 3)
const ohms = (r: number) => si(r, 'Ω', 3)
const mA = (a: number) => a * 1000

const LEGEND_VIR = [
  { color: HIGH_V, label: 'Voltage V, volts', shape: 'dot' as const },
  { color: CONVENTIONAL, label: 'Current I, mA', shape: 'dot' as const },
  { color: RING, label: 'Resistance R, Ω', shape: 'dot' as const },
]

// --- V = I × R: one loop, two knobs; the current follows. ---

const LOOP_W = 11
const LOOP_H = 6
const MIN_OHMS = 47
const MAX_AMPS = ohmsLaw({ voltsV: MAX_V, ohms: MIN_OHMS }).ampsA

export const vEqualsIR: Lesson = {
  id: 'ohm-s-law-v-i-r',
  title: 'V = I × R',
  tagline: 'Push, flow and resistance',
  formula: 'I = V / R',
  legend: [...LEGEND_VIR, { color: CONVENTIONAL, label: 'Current', shape: 'arrow-right' }],
  points: [
    'Ohm’s law ties the three together: voltage V pushes, resistance R holds back, and current I is what gets through. I = V / R.',
    'Double the voltage and the current doubles. The charges circle twice as fast and the top wire glows redder: more push per charge.',
    'Double the resistance and the current halves for the same push. Ten times the ohms, a tenth of the amps.',
    'It works three ways round: I = V / R, V = I × R, R = V / I. Know any two and you have the third.',
    'Units line up: 1 V across 1 Ω drives 1 A. With kilohms, volts / kΩ gives milliamps: 5 V across 1 kΩ is 5 mA.',
  ],
  controls: [
    { kind: 'slider', key: 'volts', label: 'Battery', min: 0, max: MAX_V, initial: 6, step: 0.5, format: volts },
    { kind: 'slider', key: 'ohms', label: 'Resistor', min: MIN_OHMS, max: 1000, initial: 220, log: true, format: (v) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const loop = resistorLoop(scene, { w: LOOP_W, h: LOOP_H, scale: 2.3, maxVolts: MAX_V })
    const v = pulseLabel(scene, 3, HIGH_V, [-LOOP_W + 5, 0, 0])
    const r = pulseLabel(scene, 4, RING, [LOOP_W - 5.4, 0, 0])
    const i = pulseLabel(scene, 3, CONVENTIONAL, [-1.4, LOOP_H + 2.2, 0])
    const flowArrow = arrow(scene, [4, LOOP_H + 2.2, 0], [1, 0, 0], CONVENTIONAL, 0.9)
    const solve = (p: Params) => ohmsLaw({ voltsV: n(p, 'volts'), ohms: nearestE12(n(p, 'ohms')) })

    return {
      scene,
      view: { center: [0, 1.4, 0], radius: 50, polar: 1.38, azimuth: 0.18 },
      frame(dt, p) {
        const s = solve(p)
        loop.set(s.voltsV, s.ohms)
        loop.flow.step(dt * s.ampsA * SPEED_PER_AMP)
        flowArrow.visible = s.ampsA > 0
        flowArrow.scale.setScalar(0.5 + 0.8 * Math.sqrt(s.ampsA / MAX_AMPS))
        v.show(fitDigits(s.voltsV, 3))
        r.show(String(s.ohms))
        i.show(fitDigits(mA(s.ampsA), 3))
        for (const l of [v, r, i]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solve(p)
        return [
          { label: 'Voltage V', value: volts(s.voltsV) },
          { label: 'Resistance R', value: ohms(s.ohms) },
          { label: 'Current I = V / R', value: amps(s.ampsA) },
        ]
      },
    }
  },
}

// --- Solving a loop: cover the unknown on the triangle, combine the other two. ---

type Unknown = 'amps' | 'ohms' | 'volts'

const PROBLEMS: Record<Unknown, { voltsV?: number; ampsA?: number; ohms?: number }> = {
  amps: { voltsV: 12, ohms: 470 },
  ohms: { voltsV: 5, ampsA: 0.02 },
  volts: { ampsA: 0.02, ohms: 220 },
}
const SLOT: Record<Unknown, number> = { volts: 0, amps: 1, ohms: 2 }
const SOLVE_LINE: Record<Unknown, string> = { volts: 'V = I × R', amps: 'I = V / R', ohms: 'R = V / I' }
const SMALL_W = 7
const SMALL_H = 5
const SMALL_X = -8.5
const TRI_X = 9.5
const LID_S = 0.7
const THINK_S = 1.4
const COUNT_S = 0.9

const solved = (p: Params) => ohmsLaw(PROBLEMS[p.find as Unknown])

export const solvingALoop: Lesson = {
  id: 'ohm-s-law-solving-a-loop',
  title: 'Solving a loop',
  tagline: 'Know two, find the third',
  formula: (p) => {
    const f = p.find as Unknown
    const s = solved(p)
    const answer = { volts: volts(s.voltsV), amps: amps(s.ampsA), ohms: ohms(s.ohms) }[f]
    const given = { volts: `${si(s.ampsA, 'A', 3)} × ${ohms(s.ohms)}`, amps: `${volts(s.voltsV)} / ${ohms(s.ohms)}`, ohms: `${volts(s.voltsV)} / ${amps(s.ampsA)}` }[f]
    return `${SOLVE_LINE[f]} = ${given} = ${answer}`
  },
  legend: [...LEGEND_VIR, { color: '#e8e8e8', label: '÷ bar, × divider', shape: 'dot' }],
  points: [
    'The triangle holds the whole law: V on top, I and R side by side below. The bar means divide, the divider between I and R means multiply.',
    'Cover the one you want and read what’s left. Cover I and you see V over R: I = V / R. Cover V and you see I × R.',
    'Find the current: 12 V across 470 Ω gives 12 / 470 = 25.5 mA.',
    'Find the resistor: to pass 20 mA from 5 V you need 5 / 0.02 = 250 Ω. Convert mA to A first, or you’re off by 1000.',
    'Find the voltage: 20 mA through 220 Ω drops 0.02 × 220 = 4.4 V across it.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'find',
      options: [
        { value: 'amps', label: 'Find I' },
        { value: 'ohms', label: 'Find R' },
        { value: 'volts', label: 'Find V' },
      ],
      initial: 'amps',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const circuit = add(scene, new THREE.Group(), [SMALL_X, 0, 0])
    const loop = resistorLoop(circuit, { w: SMALL_W, h: SMALL_H, cellH: 4, scale: 1.5, maxVolts: MAX_V })
    const labels: Record<Unknown, ReturnType<typeof pulseLabel>> = {
      volts: pulseLabel(circuit, 3, HIGH_V, [-SMALL_W + 3.7, 0, 0], 1.3),
      ohms: pulseLabel(circuit, 3, RING, [SMALL_W - 3.6, 0, 0], 1.3),
      amps: pulseLabel(circuit, 3, CONVENTIONAL, [-1.2, SMALL_H + 2, 0], 1.3),
    }
    arrow(circuit, [3.2, SMALL_H + 2, 0], [1, 0, 0], CONVENTIONAL, 0.8)

    const tri = formulaTriangle(10.5)
    tri.group.position.set(TRI_X, 1.2, 0)
    scene.add(tri.group)
    const icons = [cell(2.6, 0.75), new THREE.Group(), new THREE.Group()]
    arrow(icons[1], [0, 0, 0], [1, 0, 0], CONVENTIONAL, 0.8)
    resistorAlong(icons[2], 220, [-1, 0, 0], [1, 0, 0], 1.1)
    icons.forEach((icon, k) => {
      icon.position.set(...tri.slots[k])
      tri.group.add(icon)
    })
    const lid = new THREE.Group()
    const lidDisc = add(lid, mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 48), mat('#1d2027', { rough: 0.6 })), [0, 0, 0])
    lidDisc.rotation.x = Math.PI / 2
    add(lid, mesh(new THREE.TorusGeometry(1.4, 0.12, 12, 48), glowMat(RING, 1)), [0, 0, 0.16])
    tri.group.add(lid)

    let shown = ''
    let t = 0
    return {
      scene,
      view: { center: [-0.6, 1.4, 0], radius: 54, polar: 1.4, azimuth: 0.12 },
      frame(dt, p) {
        const f = p.find as Unknown
        const s = solved(p)
        if (f !== shown) {
          shown = f
          t = 0
          loop.set(s.voltsV, s.ohms)
        }
        t += dt
        loop.flow.step(dt * s.ampsA * SPEED_PER_AMP)

        const slot = tri.slots[SLOT[f]]
        const drop = clamp01(t / LID_S)
        lid.position.set(slot[0], slot[1] + 9 * (1 - drop) ** 2, 1.2)
        const thinking = t > LID_S && t < LID_S + THINK_S
        const beat = thinking ? 0.5 + 0.5 * Math.sin((t - LID_S) * 9) : 0
        tri.light(t > LID_S ? (f === 'volts' ? 'cross' : 'bar') : null, 1 + beat)
        icons.forEach((icon, k) => icon.scale.setScalar(k !== SLOT[f] && thinking ? 1 + 0.15 * beat : 1))

        const counted = clamp01((t - LID_S - THINK_S) / COUNT_S)
        const value = { volts: s.voltsV, amps: mA(s.ampsA), ohms: s.ohms }
        for (const k of Object.keys(labels) as Unknown[]) {
          const l = labels[k]
          if (k !== f) l.show(fitDigits(value[k], 3))
          else l.show(counted > 0 ? fitDigits(value[k] * counted, 3) : '---')
          l.display.group.visible = k !== f || counted > 0 || Math.sin(t * 12) > -0.3
          l.frame(dt)
        }
      },
      readouts: (p) => {
        const f = p.find as Unknown
        const s = solved(p)
        const done = f === shown && t > LID_S + THINK_S + COUNT_S
        const show = (k: Unknown, text: string) => (k === f && !done ? '?' : text)
        return [
          { label: 'Voltage V', value: show('volts', volts(s.voltsV)), tone: f === 'volts' ? 'ok' : undefined },
          { label: 'Current I', value: show('amps', amps(s.ampsA)), tone: f === 'amps' ? 'ok' : undefined },
          { label: 'Resistance R', value: show('ohms', ohms(s.ohms)), tone: f === 'ohms' ? 'ok' : undefined },
        ]
      },
    }
  },
}

// --- Ohm plot: sweep the voltage, trace current; resistors draw straight lines, a bulb bends. ---

type Part = '100' | '220' | '470' | 'bulb'

const PARTS: Part[] = ['100', '220', '470', 'bulb']
const LAMP_HOT_OHMS = 120
const PER_V = 2 // drawn units per volt
const PER_MA = 0.085 // drawn units per mA
const MAX_MA = 130
const ORIGIN: V3 = [-12, -6, 0]
const SWEEP_S = 6
const FAINT = '#4a4f5a'

const partOhms = (part: Part, v: number) => (part === 'bulb' ? filamentOhms(v, LAMP_HOT_OHMS, MAX_V) : Number(part))
const currentAt = (part: Part, v: number) => ohmsLaw({ voltsV: v, ohms: partOhms(part, v) }).ampsA
const plotAt = (v: number, a: number): V3 => [ORIGIN[0] + v * PER_V, ORIGIN[1] + mA(a) * PER_MA, 0]
const sweepVolts = (t: number) => (MAX_V / 2) * (1 - Math.cos((2 * Math.PI * t) / SWEEP_S))

export const ohmPlot: Lesson = {
  id: 'ohm-s-law-ohm-plot',
  title: 'Ohm plot',
  tagline: 'Straight lines and a bent one',
  formula: (p) => (p.part === 'bulb' ? 'R = V / I changes as it heats' : `I = V / ${p.part} Ω`),
  legend: [
    { color: RING, label: 'I–V curve', shape: 'dot' },
    { color: HIGH_V, label: 'Voltage, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current, mA', shape: 'dot' },
    { color: '#e8e8e8', label: 'R = V / I, Ω', shape: 'dot' },
  ],
  points: [
    'Sweep the voltage up and down and plot the current it drives. Voltage runs along the bottom, current up the side.',
    'A resistor draws a straight line through zero: double V, double I. That straight line is what “obeys Ohm’s law” (ohmic) means.',
    'The slope is 1 / R. 100 Ω is the steepest line; 470 Ω lies almost flat. R = V / I reads the same at every point on the line.',
    'A bulb’s filament bends the curve. Cold it’s about 12 Ω, so current shoots up; as it heats its resistance climbs toward 120 Ω and the curve flattens.',
    'V = I × R still holds at every instant. It’s just that R isn’t fixed for a lamp, a diode or a motor, so their plots aren’t straight.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'part',
      options: [
        { value: '100', label: '100 Ω' },
        { value: '220', label: '220 Ω' },
        { value: '470', label: '470 Ω' },
        { value: 'bulb', label: 'Bulb' },
      ],
      initial: '220',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const axis = mat('#c9ccd3', { emissive: '#3a3d45' })
    const grid = mat('#3a3e48')
    const [x0, y0] = ORIGIN
    const xEnd = x0 + MAX_V * PER_V
    const yEnd = y0 + MAX_MA * PER_MA
    rod(scene, [x0, y0, 0], [xEnd + 1, y0, 0], 0.12, axis)
    rod(scene, [x0, y0, 0], [x0, yEnd + 1, 0], 0.12, axis)
    for (let v = 2; v <= MAX_V; v += 2) {
      rod(scene, [x0 + v * PER_V, y0, -0.2], [x0 + v * PER_V, yEnd, -0.2], 0.04, grid)
      rod(scene, [x0 + v * PER_V, y0 - 0.5, 0], [x0 + v * PER_V, y0, 0], 0.08, axis)
    }
    for (let i = 25; i <= MAX_MA; i += 25) {
      rod(scene, [x0, y0 + i * PER_MA, -0.2], [xEnd, y0 + i * PER_MA, -0.2], 0.04, grid)
      rod(scene, [x0 - 0.5, y0 + i * PER_MA, 0], [x0, y0 + i * PER_MA, 0], 0.08, axis)
    }
    arrow(scene, [xEnd + 1.6, y0, 0], [1, 0, 0], HIGH_V, 0.6)
    arrow(scene, [x0, yEnd + 1.6, 0], [0, 1, 0], CONVENTIONAL, 0.6)

    const lit = glowMat(RING, 0.9)
    const faint = mat(FAINT, { emissive: '#1a1c22' })
    const curves = Object.fromEntries(
      PARTS.map((part) => {
        const pts = Array.from({ length: 49 }, (_, k) => {
          const v = (k / 48) * MAX_V
          return plotAt(v, currentAt(part, v))
        })
        return [part, tube(scene, pts, 0.12, faint, 96)]
      }),
    ) as Record<Part, THREE.Mesh>

    const dot = add(scene, mesh(new THREE.SphereGeometry(0.5, 20, 14), glowMat('#ffffff', 1)))
    const unitRod = new THREE.CylinderGeometry(0.07, 0.07, 1, 8)
    const vLine = add(scene, mesh(unitRod, glowMat(HIGH_V, 0.6)))
    const iLine = add(scene, mesh(unitRod, glowMat(CONVENTIONAL, 0.6)))
    iLine.rotation.z = Math.PI / 2
    const vLabel = segmentDisplay(3, 1.2, HIGH_V, true)
    const iLabel = segmentDisplay(3, 1.2, CONVENTIONAL, true)
    const rLabel = segmentDisplay(3, 1.6, '#e8e8e8', true)
    rLabel.group.position.set(x0 + 11, yEnd + 2.6, 0)
    scene.add(vLabel.group, iLabel.group, rLabel.group)

    const partSlot = add(scene, new THREE.Group(), [x0 + 5, yEnd + 2.6, 0])
    let lamp: ReturnType<typeof bulb> | null = null
    let shown = ''
    let t = 0
    let now = { v: 0, a: 0, r: 0 }

    return {
      scene,
      view: { center: [-1.4, 1.6, 0], radius: 52, polar: 1.45, azimuth: 0.06 },
      frame(dt, p) {
        const part = p.part as Part
        if (part !== shown) {
          shown = part
          for (const k of PARTS) {
            curves[k].material = k === part ? lit : faint
          }
          emptyGroup(partSlot)
          lamp = null
          if (part === 'bulb') {
            lamp = bulb()
            lamp.group.scale.setScalar(0.55)
            lamp.group.rotation.z = -Math.PI / 2
            partSlot.add(lamp.group)
          } else resistorAlong(partSlot, Number(part), [-1, 0, 0], [1, 0, 0], 1.5)
        }
        t += dt
        const v = sweepVolts(t)
        const a = currentAt(part, v)
        now = { v, a, r: partOhms(part, v) }
        const [x, y] = plotAt(v, a)
        dot.position.set(x, y, 0.3)
        vLine.position.set(x, (y + y0) / 2, 0.1)
        vLine.scale.y = Math.max(0.001, y - y0)
        iLine.position.set((x + x0) / 2, y, 0.1)
        iLine.scale.y = Math.max(0.001, x - x0)
        vLabel.set(fitDigits(v, 3))
        vLabel.group.position.set(x, y0 - 1.6, 0)
        iLabel.set(fitDigits(mA(a), 3))
        iLabel.group.position.set(x0 - 2.9, y, 0)
        rLabel.set(fitDigits(now.r, 3))
        lamp?.setGlow(clamp01(a / currentAt('bulb', MAX_V)) ** 1.5)
      },
      readouts: (p) => {
        const part = p.part as Part
        const v = p.part === shown ? now.v : 0
        const a = currentAt(part, v)
        return [
          { label: 'Voltage', value: volts(v) },
          { label: 'Current', value: amps(a) },
          { label: 'R = V / I', value: ohms(partOhms(part, v)), tone: part === 'bulb' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
