import * as THREE from 'three/webgpu'
import { DIODES, depletion, diodeAmps, diodeNode, junctionPotential, thermalVoltage } from '../../core/physics'
import { fitDigits, sci, si, volts } from '../../core/units'
import { V3, add, box } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ACCEPTOR,
  CELL_H,
  CONVENTIONAL,
  DONOR,
  Dopant,
  ELECTRON,
  GREY,
  HOLE,
  R_SCALE,
  RING,
  arrow,
  cell,
  clamp01,
  ease,
  emptyGroup,
  ivScreen,
  potentialColor,
  pulseLabel,
  resistorAlong,
  scope,
  partLetter,
  siliconCrystal,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

type Crystal = ReturnType<typeof siliconCrystal>

const ROWS = 4
const D_MIN = 15
const D_MAX = 18
const dopingSlider = (key: string, label: string) =>
  ({ kind: 'slider', key, label, min: 10 ** D_MIN, max: 10 ** D_MAX, initial: 1e16, log: true, format: (v: number) => `${sci(v, 2)} /cm³` }) as const
const signedVolts = (v: number) => (v > 0 ? `+${volts(v)}` : volts(v))
const fieldText = (vPerM: number) => si(vPerM / 100, 'V/cm', 3)
/** P-side sites (col, row), spread so every column gets one early; the n side is the mirror image. */
const P_SPOTS: [number, number][] = [[3, 1], [1, 2], [2, 0], [0, 3], [3, 3], [1, 0], [2, 2], [0, 1], [3, 2], [1, 1]]

/** Acceptors on the left half, donors on the right, interleaved so both sides ionize together. */
function junctionDopants(cols: number, p: number, nd: number) {
  const half = cols / 2
  const map = new Map<number, Dopant>()
  for (let i = 0; i < Math.max(p, nd); i++) {
    const [c, r] = P_SPOTS[i]
    const col = c + half - 4
    if (i < p && col >= 0) map.set(r * cols + col, 'acceptor')
    if (i < nd && col >= 0) map.set((ROWS - 1 - r) * cols + (cols - 1 - col), 'donor')
  }
  return map
}

/** Tinted backing behind each half and a pale slab marking the depletion zone; `zone(from, to)` moves it. */
function junctionBacking(parent: THREE.Object3D, width: number, height: number) {
  const glass = (color: string, opacity: number) =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity, roughness: 0.6, depthWrite: false })
  for (const [s, color] of [[-1, ACCEPTOR], [1, DONOR]] as const) box(parent, [width / 2, height, 0.2], glass(color, 0.16), [(s * width) / 4, 0, -1.4]).castShadow = false
  const slab = box(parent, [1, height + 0.6, 0.2], glass('#ffffff', 0.22), [0, 0, -1.2])
  slab.castShadow = false
  const letter = (text: string, x: number, color: string) => {
    partLetter(parent, text, [x, -height / 2 - 1.4, 0], 1.4, color)
  }
  letter('P', -width / 2 + 1, ACCEPTOR)
  letter('N', width / 2 - 1, DONOR)
  return (from: number, to: number) => {
    slab.visible = to - from > 0.05
    slab.scale.x = Math.max(0.01, to - from)
    slab.position.x = (from + to) / 2
  }
}

/** Zone edges in scene units: total width on a √ scale (`k` at 1 µm), split like xp : xn. */
function zoneEdges(d: ReturnType<typeof depletion>, k: number, half: number, min = 0.5) {
  const w = Math.max(min, k * Math.sqrt(d.w / 1e-6))
  const f = d.w > 0 ? d.xp / d.w : 0.5
  return { from: -Math.min(half - 1, w * f), to: Math.min(half - 1, w * (1 - f)) }
}

// --- Depletion region: carriers cross, cancel, and leave bare ions whose field stops the rest. ---

const COLS1 = 10
const PITCH1 = 2.8
const CY1 = 2.4
const PLOT_H = 4
const PLOT_Y = CY1 - (ROWS * PITCH1) / 2 - PLOT_H / 2 - 3
const Z1 = 12
const V_FULL = 1

const countFor = (level: number) => Math.round(2 + 2 * (Math.log10(level) - D_MIN))
const junction1 = (p: Params) => {
  const na = n(p, 'na')
  const nd = n(p, 'nd')
  return { na, nd, ...depletion(na, nd, 0) }
}

export const depletionRegion: Lesson = {
  id: 'pn-junction-depletion-region',
  title: 'Depletion region',
  tagline: 'Where the carriers cancel out',
  formula: (p) => {
    const j = junction1(p)
    return `Vbi = Vt·ln(Na·Nd / ni²) = ${volts(j.barrier)} · W = √(2ε·Vbi/q · (1/Na + 1/Nd)) = ${si(j.w, 'm', 3)} · Na·xp = Nd·xn`
  },
  legend: [
    { color: ACCEPTOR, label: 'P side: boron, − ion once its hole leaves', shape: 'dot' },
    { color: DONOR, label: 'N side: phosphorus, + ion', shape: 'dot' },
    { color: '#ffffff', label: 'Depletion zone: bare ions, no carriers', shape: 'dot' },
    { color: RING, label: 'Field; potential across, V', shape: 'arrow-left' },
  ],
  points: [
    'Put p-type silicon (holes, red rings) against n-type (free electrons, blue). Right at the boundary each side has plenty of what the other lacks, so they wander across and cancel: each flash is an electron dropping into a hole.',
    'That leaves a strip with no free carriers, the depletion region. Only the dopant ions are left in it, bare and fixed in the crystal: − on the p side, + on the n side (drawn bigger).',
    'Those charges set up a field pointing from n to p. It pushes electrons back to the n side and holes back to the p side, so the crossing stops. The potential rises across the zone: the built-in voltage, ~0.7 V for silicon.',
    'Each side gives up equal charge: Na·xp = Nd·xn. Dope one side far more heavily and the zone reaches almost entirely into the lighter side.',
    'Heavier doping squeezes the zone thinner and the field stronger. Real zones are 0.05–1.5 µm; the strip here is drawn on a √ scale.',
  ],
  controls: [dopingSlider('na', 'P doping (Na)'), dopingSlider('nd', 'N doping (Nd)')],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = add(scene, new THREE.Group(), [0, CY1, 0])
    const width = COLS1 * PITCH1
    const height = ROWS * PITCH1
    const zone = junctionBacking(rig, width, height)
    const holder = add(rig, new THREE.Group())
    const field = arrow(rig, [0, -height / 2 - 1.4, 0.4], [-1, 0, 0], RING, 1.3)
    const plot = scope(scene, width, PLOT_H, { divs: [10, 2], zeroAt: 0 })
    plot.group.position.set(0, PLOT_Y, 0)
    ticks(plot, [], [[0, '0'], [1, '1']])
    const trace = plot.trace(RING, { radius: 0.12 })
    const vLabel = pulseLabel(scene, 4, RING, [width / 2 - 3.6, PLOT_Y + PLOT_H / 2 + 1.1, 0], 0.9)

    let crystal: Crystal | null = null
    const state = { key: '', from: 0, to: 0, barrier: 0 }
    return {
      scene,
      view: { center: [0, 1.6, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const j = junction1(p)
        const key = `${countFor(j.na)}|${countFor(j.nd)}`
        if (key !== state.key) {
          state.key = key
          emptyGroup(holder)
          crystal = siliconCrystal(holder, { cols: COLS1, rows: ROWS, pitch: PITCH1, dopants: junctionDopants(COLS1, countFor(j.na), countFor(j.nd)), wrap: false, ionizeAfter: 0.3 })
          state.from = state.to = state.barrier = 0
        }
        const target = zoneEdges(j, Z1, width / 2)
        const k = ease(dt, 1.2)
        state.from += (target.from - state.from) * k
        state.to += (target.to - state.to) * k
        state.barrier += (j.barrier - state.barrier) * k
        crystal?.step(dt, { junction: { from: state.from, to: state.to } })
        zone(state.from, state.to)
        field.position.x = (state.from + state.to) / 2
        field.scale.setScalar(clamp01(0.6 + 0.25 * Math.log10(j.peakField / 1e6)) * Math.min(1, state.barrier / j.barrier))
        trace.draw((u) => (junctionPotential(u * width - width / 2, -state.from, state.to, state.barrier) / V_FULL) * PLOT_H - PLOT_H / 2, null)
        vLabel.show(fitDigits(state.barrier, 4))
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const j = junction1(p)
        return [
          { label: 'Built-in Vbi', value: volts(j.barrier), tone: 'ok' },
          { label: 'Width W', value: si(j.w, 'm', 3) },
          { label: 'Into n side', value: `${Math.round((100 * j.xn) / j.w)} %` },
          { label: 'Peak field', value: fieldText(j.peakField) },
        ]
      },
    }
  },
}

// --- Forward and reverse bias: the battery lowers or raises the barrier, and the current follows e^(V/nVt). ---

const COLS2 = 8
const PITCH2 = 2.6
const CX2 = -7.4
const CY2 = -0.4
const DOPING = 1e16
const PART = DIODES['1N4148']
const V2_MIN = -3
const V2_MAX = 0.7
const I2_FULL = 0.02
const Z2 = 11
const S2: V3 = [10, 0.2, 0]

/** Crystal between two plates wired to a cell above (+ on the left when `flip(false)`), optional resistor on the left run. */
function biasRig(scene: THREE.Object3D, at: V3, cols: number, pitch: number, dopants: Map<number, Dopant>, resistor?: number) {
  const rig = add(scene, new THREE.Group(), at)
  const width = cols * pitch
  const height = ROWS * pitch
  const zone = junctionBacking(rig, width, height)
  const crystal = siliconCrystal(rig, { cols, rows: ROWS, pitch, dopants, wrap: false, ionizeAfter: 0.2 })
  const plateX = width / 2 + 0.7
  const plateH = height + 0.6
  const plates = [-1, 1].map((s) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.4 })
    box(rig, [0.7, plateH, 2.4], material, [s * plateX, 0, 0])
    return material
  })
  const topY = plateH / 2 + 3.6
  const cellL = -CELL_H / 2 - 0.4
  wire(rig, [[-plateX, plateH / 2, 0], [-plateX, topY, 0], [cellL, topY, 0]])
  wire(rig, [[CELL_H / 2, topY, 0], [plateX, topY, 0], [plateX, plateH / 2, 0]])
  const battery = add(rig, cell(CELL_H, 1.2), [0, topY, 0])
  if (resistor) resistorAlong(rig, resistor, [-plateX / 2 - 1.4, topY, 0], [-plateX / 2 + 1.4, topY, 0], R_SCALE)
  const field = arrow(rig, [0, topY - 2.4, 0.4], [-1, 0, 0], RING, 0.7)
  const amps = pulseLabel(rig, 3, CONVENTIONAL, [-plateX / 2, topY + 1.7, 0], 1)
  const c = new THREE.Color()
  return {
    crystal,
    width,
    zone,
    field,
    amps,
    /** Plate potentials as fractions of full scale, left then right. */
    paint(left: number, right: number) {
      for (const [m, f] of [[plates[0], left], [plates[1], right]] as const) {
        m.color.copy(potentialColor(f, c))
        m.emissive.copy(c).multiplyScalar(0.4)
      }
      battery.rotation.z = left >= right ? Math.PI / 2 : -Math.PI / 2
    },
  }
}

/** Carriers per second drawn for a current: log-scaled, none below `floor`. */
const rateFor = (amps: number, floor: number) => (amps > floor ? Math.min(7, 1.6 * Math.log10(amps / floor) + 0.8) : 0)

export const forwardAndReverseBias: Lesson = {
  id: 'pn-junction-forward-and-reverse-bias',
  title: 'Forward and reverse bias',
  tagline: 'Lower the hill, or raise it',
  formula: (p) => {
    const v = n(p, 'v')
    const i = diodeAmps(v, PART)
    const nvt = PART.ideality * thermalVoltage()
    return `I = Is·(e^(V/nVt) − 1) = ${si(PART.saturationA, 'A', 3)} × (e^(${v.toFixed(2)}/${nvt.toFixed(4)}) − 1) = ${si(i, 'A', 3)} · barrier = Vbi − V = ${volts(depletion(DOPING, DOPING, v).barrier)}`
  },
  legend: [
    { color: ELECTRON, label: 'Electrons cross to p, recombine', shape: 'arrow-left' },
    { color: HOLE, label: 'Holes cross to n, recombine', shape: 'arrow-right' },
    { color: RING, label: 'I–V of a 1N4148; dot = now', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current, mA', shape: 'dot' },
  ],
  points: [
    'Forward bias: + on the p side. The battery pushes holes and electrons toward the junction, the depletion zone thins, and the barrier drops from ~0.7 V by the battery voltage.',
    'Carriers that make it over become minorities on the other side and soon recombine (flash). The battery refills them at the ends: that is the current. In an LED each recombination gives off light.',
    'How many get over depends exponentially on the barrier: I = Is·(e^(V/nVt) − 1). Every ~0.1 V forward multiplies the current by about 10, so a silicon diode “turns on” near 0.6 V.',
    'Reverse bias: + on the n side. It pulls carriers away from the junction, the zone widens and the barrier grows. Nothing crosses; only a leak of nanoamps flows, from the rare pairs heat makes in the zone.',
    'Numbers are a real 1N4148’s; the crossing rate is drawn on a log scale.',
  ],
  controls: [{ kind: 'slider', key: 'v', label: 'Bias', min: V2_MIN, max: V2_MAX, initial: 0.65, step: 0.01, format: signedVolts }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = biasRig(scene, [CX2, CY2, 0], COLS2, PITCH2, junctionDopants(COLS2, 5, 5))
    const { plot, dot, y } = ivScreen(scene, S2, 8.5, 9, [4, 5])
    const uOf = (v: number) => (v - V2_MIN) / (V2_MAX - V2_MIN)
    ticks(plot, [[0, '-3'], [uOf(0), '0'], [1, '0.7']], [[0.5, '10'], [1, '20']])
    plot.trace(RING, { radius: 0.12 }).draw((u) => y(diodeAmps(V2_MIN + u * (V2_MAX - V2_MIN), PART) / I2_FULL), null)

    const state = { v: 0.65, from: 0, to: 0 }
    return {
      scene,
      view: { center: [-1.2, 3.8, 0], radius: 64, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        state.v += (n(p, 'v') - state.v) * ease(dt, 5)
        const d = depletion(DOPING, DOPING, state.v)
        const amps = diodeAmps(state.v, PART)
        const target = zoneEdges(d, Z2, rig.width / 2, 0.6)
        state.from += (target.from - state.from) * ease(dt, 3)
        state.to += (target.to - state.to) * ease(dt, 3)
        rig.crystal.step(dt, { junction: { from: state.from, to: state.to, inject: rateFor(amps, 1e-5), contacts: true } })
        rig.zone(state.from, state.to)
        rig.field.position.x = (state.from + state.to) / 2
        rig.field.scale.setScalar(clamp01(0.25 + d.barrier / 1.2))
        rig.paint(Math.max(0, state.v) / V2_MAX, Math.min(0, state.v) / V2_MIN)
        rig.amps.show(fitDigits(Math.max(0, amps) * 1000, 3))
        rig.amps.frame(dt)
        dot.position.set(plot.xAt(uOf(state.v)), y(Math.min(1, Math.max(0, amps) / I2_FULL)), 0.4)
      },
      readouts: () => {
        const d = depletion(DOPING, DOPING, state.v)
        const amps = diodeAmps(state.v, PART)
        const on = amps > 1e-4
        return [
          { label: 'Barrier', value: volts(d.barrier) },
          { label: 'Width W', value: si(d.w, 'm', 3) },
          { label: 'Current', value: si(amps, 'A', 3), tone: on ? 'ok' : undefined },
          { label: 'State', value: on ? 'On' : state.v < 0 ? 'Blocking' : 'Barely on' },
        ]
      },
    }
  },
}

// --- Breakdown: reverse bias builds a field strong enough to tear electrons out of their bonds. ---

const ZENER = DIODES.zener5V1
const HEAVY = 1e18
const R3 = 1000
const V3_MAX = 10
const VZ_FULL = 6
const IZ_FULL = 0.005
const Z3 = 12
const S3: V3 = [10, 0.2, 0]

const breakdown3 = (p: Params) => {
  const vs = n(p, 'v')
  const r = diodeNode(vs, R3, ZENER, { reversed: true })
  return { vs, vr: r.v, amps: r.sourceA, ...depletion(HEAVY, HEAVY, -r.v) }
}

export const breakdown: Lesson = {
  id: 'pn-junction-breakdown',
  title: 'Breakdown',
  tagline: 'When the field rips bonds apart',
  formula: (p) => {
    const b = breakdown3(p)
    return `E_peak = 2(Vbi + Vr) / W = 2 × ${volts(b.barrier)} / ${si(b.w, 'm', 3)} = ${fieldText(b.peakField)} · I = (Vs − Vz) / R = ${si(b.amps, 'A', 3)}`
  },
  legend: [
    { color: RING, label: 'Pair torn free; peak field, MV/cm', shape: 'dot' },
    { color: ELECTRON, label: 'Electron swept to the n side (+)', shape: 'arrow-right' },
    { color: RING, label: 'Zener reverse I–V; dot = now', shape: 'dot' },
    { color: GREY, label: 'What the 1 kΩ can feed', shape: 'dot' },
  ],
  points: [
    'Reverse bias widens the depletion zone and stores more voltage across it. Heavily doped silicon (10¹⁸ /cm³ here) keeps the zone thin, so the field gets enormous.',
    'Near 1 MV/cm the field is strong enough to pull bond electrons straight through the gap into the conduction band (zener tunnelling). In lighter-doped diodes, fast carriers knock out more pairs instead (avalanche).',
    'Either way, pairs appear inside the zone and the field sweeps them out: electrons to the + side, holes to the − side. Current suddenly flows backwards.',
    'Past the knee the voltage barely rises however much current flows, so a zener diode is made to work here, at 5.1 V. An ordinary diode does it at 50–1000 V, and with no resistor the current only stops when it burns.',
    'The 1 kΩ limits the current: the dot sits where the zener curve meets the resistor’s line.',
  ],
  controls: [{ kind: 'slider', key: 'v', label: 'Reverse supply', min: 0, max: V3_MAX, initial: 8, step: 0.1, format: volts }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = biasRig(scene, [CX2, CY2, 0], COLS2, PITCH2, junctionDopants(COLS2, 6, 6), R3)
    const { plot, dot, y } = ivScreen(scene, S3, 8.5, 9, [6, 5])
    ticks(plot, [[0, '0'], [0.5, '3'], [1, '6']], [[0.5, '2.5'], [1, '5']])
    plot.trace(RING, { radius: 0.12 }).draw((u) => y(-diodeAmps(-u * VZ_FULL, ZENER) / IZ_FULL), null)
    const feed = plot.trace(GREY, { radius: 0.08 })
    const fLabel = pulseLabel(scene, 4, RING, [CX2 + 5.4, CY2 + (ROWS * PITCH2) / 2 + 1.5, 0], 0.9)

    const state = { vs: 8, from: 0, to: 0, key: -1 }
    return {
      scene,
      view: { center: [-1.2, 3.8, 0], radius: 64, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        state.vs += (n(p, 'v') - state.vs) * ease(dt, 5)
        const b = breakdown3({ v: state.vs })
        const target = zoneEdges(b, Z3, rig.width / 2, 0.6)
        state.from += (target.from - state.from) * ease(dt, 3)
        state.to += (target.to - state.to) * ease(dt, 3)
        rig.crystal.step(dt, { junction: { from: state.from, to: state.to, generate: rateFor(b.amps, 1e-6) / 2, contacts: true } })
        rig.zone(state.from, state.to)
        rig.field.position.x = (state.from + state.to) / 2
        rig.field.scale.setScalar(clamp01(0.3 + b.peakField / 1.2e8))
        rig.paint(0, state.vs / V3_MAX)
        rig.amps.show(fitDigits(b.amps * 1000, 3))
        rig.amps.frame(dt)
        fLabel.show(fitDigits(b.peakField / 1e8, 4))
        fLabel.frame(dt)
        if (state.vs !== state.key) {
          state.key = state.vs
          feed.draw((u) => y((state.vs - u * VZ_FULL) / R3 / IZ_FULL), null)
        }
        dot.position.set(plot.xAt(Math.min(1, b.vr / VZ_FULL)), y(Math.min(1, b.amps / IZ_FULL)), 0.4)
      },
      readouts: (p) => {
        const b = breakdown3(p)
        const on = b.amps > 1e-4
        return [
          { label: 'Junction V', value: volts(b.vr) },
          { label: on ? 'Breakdown current' : 'Leak current', value: si(b.amps, 'A', 3), tone: on ? 'warn' : undefined },
          { label: 'Peak field', value: fieldText(b.peakField) },
        ]
      },
    }
  },
}
