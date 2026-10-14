import * as THREE from 'three/webgpu'
import { Vec3, chargeLines } from '../../core/fields'
import {
  COULOMB_K,
  DIELECTRIC,
  Dielectric,
  EPSILON_0,
  capacitorCharge,
  capacitorEnergy,
  chargesField,
  coulombForce,
  forceInField,
  plateCapacitance,
  plateField,
  rcStep,
} from '../../core/physics'
import { fitDigits, sci, si } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  Flow,
  FORCE,
  HIGH_V,
  LOW_V,
  POWER,
  RING,
  arrowGrid,
  cell,
  chargeBall,
  clamp01,
  ease,
  emptyGroup,
  fieldLines,
  glowMat,
  halton,
  path,
  plusGeometry,
  potentialColor,
  presence,
  pulseLabel,
  scope,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const RULER = '#e8e8e8'
const newtons = (f: number) => si(f, 'N', 3)
const coulombs = (q: number) => `${q > 0 ? '+' : ''}${si(q, 'C', 3)}`
const kSci = sci(COULOMB_K)

// --- Coulomb force: like charges repel, opposite attract, and the push falls off as 1 / r². ---

const UC = 1e-6
const MAX_Q = 5
const CM = 0.65
const ROW_Y = 4.2
const F_MAX = 20
const R_MAX = 30
const PLOT_Y = -6
const PLOT_W = 24
const PLOT_H = 6.4
const RULER_Y = -2.3

const solveCoulomb = (p: Params) => {
  const q1 = n(p, 'q1')
  const q2 = n(p, 'q2')
  const r = n(p, 'r')
  const f = coulombForce(q1 * UC, q2 * UC, r / 100)
  return { q1, q2, r, f, mag: Math.abs(f), kind: f > 0 ? 'Repel' : f < 0 ? 'Attract' : 'None', far: Math.abs(coulombForce(q1 * UC, q2 * UC, (2 * r) / 100)) }
}
/** Arrow length for a force: log-scaled so 0.1 N and 90 N both read. */
const forceLength = (f: number) => (f > 0 ? 0.5 + 0.85 * Math.log(1 + f / 0.1) : 0)

export const coulombLaw: Lesson = {
  id: 'electric-fields-coulomb-force',
  title: 'Coulomb force',
  tagline: 'Charges push and pull across empty space',
  formula: (p) => {
    const s = solveCoulomb(p)
    return `F = k·q₁q₂ / r² = ${kSci} × (${coulombs(s.q1 * UC)})(${coulombs(s.q2 * UC)}) / (${s.r / 100} m)² = ${newtons(s.f)}${s.f ? ` → ${s.kind.toLowerCase()}` : ''}`
  },
  legend: [
    { color: HIGH_V, label: '+ / − charge, µC', shape: 'dot' },
    { color: FORCE, label: 'Force on each, N', shape: 'dot' },
    { color: RULER, label: 'Distance r, cm', shape: 'dot' },
    { color: RING, label: 'Field lines', shape: 'dot' },
  ],
  points: [
    'Two charges push or pull on each other without touching. Like charges (+ +, − −) repel; opposite charges (+ −) attract.',
    'Coulomb’s law: F = k·q₁q₂ / r², with k = 8.99 × 10⁹ N·m²/C². Double either charge and the force doubles; the sign of q₁q₂ says repel (+) or attract (−).',
    'Distance matters most: it’s 1 / r². Double r and the force drops to a quarter; the plot’s ring marks that point on the curve. Halve it and the force is 4×.',
    'Both charges feel the same size of force, in opposite directions (Newton’s third law), even when one charge is much bigger.',
    'A coulomb is huge: two 1 C charges 1 m apart would push with 9 × 10⁹ N. Static sparks carry only nanocoulombs to microcoulombs. Arrows here are on a log scale so 0.1 N and 90 N both fit.',
  ],
  controls: [
    { kind: 'slider', key: 'q1', label: 'Charge q₁', min: -MAX_Q, max: MAX_Q, initial: 2, step: 1, format: (v) => coulombs(v * UC) },
    { kind: 'slider', key: 'q2', label: 'Charge q₂', min: -MAX_Q, max: MAX_Q, initial: -3, step: 1, format: (v) => coulombs(v * UC) },
    { kind: 'slider', key: 'r', label: 'Distance r', min: 5, max: R_MAX, initial: 12, step: 1, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const row = add(scene, new THREE.Group(), [0, ROW_Y, 0])
    const lines = fieldLines(row, { color: '#b8a040', radius: 0.05, head: 0.24, spacing: 3.2 })
    const balls = [chargeBall(row, [0, 0, 0], { r0: 0.45, r1: 1.2 }), chargeBall(row, [0, 0, 0], { r0: 0.45, r1: 1.2 })]
    const forces = arrowGrid(row, 2, { color: FORCE, radius: 0.2, head: 0.55, maxLen: 6.6, dim: '#6a3a60' })

    const rulerMat = glowMat(RULER, 0.4)
    const bar = add(row, mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), rulerMat), [0, RULER_Y, 0])
    bar.rotation.z = Math.PI / 2
    const ticks = [0, 1].map(() => box(row, [0.1, 0.9, 0.1], rulerMat))
    const rLabel = pulseLabel(row, 2, RULER, [0, RULER_Y - 1.4, 0], 1.2)
    const qLabels = [0, 1].map(() => pulseLabel(row, 2, HIGH_V, [0, 2.3, 0], 1.1))

    const plot = scope(scene, PLOT_W, PLOT_H, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(0, PLOT_Y, 0)
    const curve = plot.trace(FORCE, { samples: 200 })
    const level = plot.level(FORCE)
    const ghost = add(plot.group, mesh(new THREE.TorusGeometry(0.42, 0.1, 8, 24), glowMat(RULER, 0.8)))
    const fLabel = pulseLabel(scene, 3, FORCE, [0, 0, 0], 1.3)
    const forceY = (f: number) => Math.min(PLOT_H, (f / F_MAX) * PLOT_H) - PLOT_H / 2

    const shown = { r: 12 }
    const signs = [NaN, NaN]
    let traced = ''
    return {
      scene,
      view: { center: [0, -0.2, 0], radius: 46, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveCoulomb(p)
        shown.r += (s.r - shown.r) * ease(dt)
        const half = (shown.r * CM) / 2
        const xs = [-half, half]
        const radii = [s.q1, s.q2].map((q, k) => {
          balls[k].group.position.x = xs[k]
          const rad = balls[k].set(q, MAX_Q)
          qLabels[k].display.group.position.set(xs[k], rad + 1.2, 1)
          qLabels[k].show(String(Math.abs(q)))
          if (Math.sign(q) !== signs[k]) setDisplayColor(qLabels[k].display.group, (signs[k] = Math.sign(q)))
          return rad
        })

        const key = `${s.q1},${s.q2},${shown.r.toFixed(2)}`
        if (key !== traced) {
          traced = key
          const sources = [{ q: s.q1, at: [xs[0], 0, 0] as Vec3 }, { q: s.q2, at: [xs[1], 0, 0] as Vec3 }]
          lines.set(chargeLines(sources, { perUnit: 3, seedR: 0.6, box: [13, 5.6], step: 0.2 }))
        }
        lines.step(dt * 1.6)

        const len = forceLength(s.mag)
        const pts: V3[] = xs.map((x, k) => [x + (k ? 1 : -1) * (radii[k] + 0.35 + len / 2), 0, 0.3])
        forces.set(pts, (at, out) => {
          const outward = at.x > 0 ? 1 : -1
          out.set(outward * Math.sign(s.f) * len, 0, 0)
        })

        bar.scale.y = Math.max(0.001, 2 * half)
        ticks.forEach((t, k) => t.position.set(xs[k], RULER_Y, 0))
        rLabel.show(String(s.r))

        const product = s.q1 * s.q2
        curve.draw((u) => forceY(Math.abs(coulombForce(product * UC, UC, Math.max(0.5, u * R_MAX) / 100))), shown.r / R_MAX)
        level.set(forceY(s.mag))
        ghost.visible = s.mag > 0 && 2 * shown.r <= R_MAX
        ghost.position.set(plot.xAt((2 * shown.r) / R_MAX), forceY(s.far), 0.4)
        const dotX = plot.xAt(shown.r / R_MAX)
        fLabel.display.group.position.set(dotX + (dotX < PLOT_W / 2 - 5 ? 3 : -3), PLOT_Y + Math.min(PLOT_H / 2 - 1, forceY(s.mag) + 1.4), 0.5)
        fLabel.show(fitDigits(s.mag, 3))
        for (const l of [rLabel, fLabel, ...qLabels]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveCoulomb(p)
        return [
          { label: 'Force F', value: newtons(s.mag), tone: 'ok' },
          { label: 'Type', value: s.kind },
          { label: 'At 2r', value: newtons(s.far) },
        ]
      },
    }
  },
}

/** Tints a glowing segment display's lit material by the sign of q. */
function setDisplayColor(group: THREE.Object3D, q: number) {
  const col = q > 0 ? HIGH_V : q < 0 ? LOW_V : '#8a8f99'
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m?.emissive) {
      m.color.set(col)
      m.emissive.set(col)
    }
  })
}

// --- Field lines: the field is force per coulomb, drawn as lines from + to −. ---

type Layout = 'single' | 'dipole' | 'like' | 'unequal'
type View = 'lines' | 'arrows'

const NC = 1e-9
const SEP = 5
const LAYOUTS: Record<Layout, { q: number; at: Vec3 }[]> = {
  single: [{ q: 3, at: [0, 0, 0] }],
  dipole: [{ q: 2, at: [-SEP, 0, 0] }, { q: -2, at: [SEP, 0, 0] }],
  like: [{ q: 2, at: [-SEP, 0, 0] }, { q: 2, at: [SEP, 0, 0] }],
  unequal: [{ q: 3, at: [-SEP, 0, 0] }, { q: -1, at: [SEP, 0, 0] }],
}
const PROBE_Y = 4
const BOX: [number, number] = [15, 8.5]
const TILTS = [Math.PI / 3, -Math.PI / 3]
const GRID: V3[] = []
for (let x = -14; x <= 14; x += 2) for (let y = -8; y <= 8; y += 2) GRID.push([x, y, 0])

/** SI field at a point of the scene (cm), charges in nC. */
const fieldAt = (layout: Layout, x: number, y: number) =>
  chargesField(LAYOUTS[layout].map((c) => ({ q: c.q * NC, at: [c.at[0] / 100, c.at[1] / 100, 0] as Vec3 })), [x / 100, y / 100, 0])

const solveProbe = (p: Params) => {
  const layout = (p.layout as Layout) ?? 'dipole'
  const x = n(p, 'probe')
  const e = fieldAt(layout, x, PROBE_Y)
  const mag = Math.hypot(e[0], e[1])
  return { layout, x, e, mag, angle: (Math.atan2(e[1], e[0]) * 180) / Math.PI, force: forceInField(NC, mag) }
}
/** Drawn arrow length for a field strength, log-scaled. */
const fieldLength = (e: number, k: number) => k * Math.log(1 + e / 400)

export const fieldLineMap: Lesson = {
  id: 'electric-fields-field-lines',
  title: 'Field lines',
  tagline: 'Maps of the push a charge would feel',
  formula: (p) => {
    const s = solveProbe(p)
    return `E = Σ k·qᵢ / rᵢ² (as vectors) = ${si(s.mag, 'N/C', 3)} at the probe · F = qE = ${si(s.force, 'N', 3)} on +1 nC`
  },
  legend: [
    { color: HIGH_V, label: '+ / − charge, nC', shape: 'dot' },
    { color: RING, label: 'Field E, from + to −', shape: 'dot' },
    { color: POWER, label: 'Probe: E there, kN/C', shape: 'dot' },
  ],
  points: [
    'A charge changes the space around it: put another charge anywhere nearby and it feels a force. That property of space is the electric field, E = F / q: newtons per coulomb (the same as V/m).',
    'A field line follows the push on a small + test charge: out of + charges, into − ones. Lines never cross, because each point has only one direction of push.',
    'Crowded lines mean a strong field. Each charge here sends out 4 lines per nC, and they spread over a bigger sphere further out, which is where 1 / r² comes from.',
    'With two charges the fields add as vectors. A dipole’s lines arc from + to −; like charges push their lines apart, leaving a point midway where E = 0. With +3 and −1, only one line in three lands on the −; the rest escape.',
    'Arrows show the same field sampled on a grid (log length). Slide the green probe: its arrow and the readout give E at that point and the force on +1 nC.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'layout',
      options: [
        { value: 'single', label: 'Single' },
        { value: 'dipole', label: 'Dipole' },
        { value: 'like', label: 'Like' },
        { value: 'unequal', label: '+3 / −1' },
      ],
      initial: 'dipole',
    },
    {
      kind: 'choice',
      key: 'view',
      options: [
        { value: 'lines', label: 'Lines' },
        { value: 'arrows', label: 'Arrows' },
      ],
      initial: 'lines',
    },
    { kind: 'slider', key: 'probe', label: 'Probe x', min: -10, max: 10, initial: 0, step: 0.5, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const lines = fieldLines(scene, { maxSegments: 3000, spacing: 3.6 })
    const depth = fieldLines(scene, { maxSegments: 6000, radius: 0.05, heads: false })
    const grid = arrowGrid(scene, GRID.length, { maxLen: 1.8 })
    const balls = [chargeBall(scene, [0, 0, 0]), chargeBall(scene, [0, 0, 0])]
    const probe = add(scene, new THREE.Group(), [0, PROBE_Y, 0])
    add(probe, mesh(new THREE.SphereGeometry(0.42, 20, 14), glowMat(POWER, 0.9)))
    add(probe, mesh(plusGeometry(0.5), mat('#ffffff', { emissive: '#bbbbbb' })), [0, 0, 0.42])
    const probeArrow = arrowGrid(probe, 1, { color: POWER, radius: 0.16, head: 0.45, maxLen: 5, dim: '#2a5a44' })
    const eLabel = pulseLabel(probe, 3, POWER, [0, 1.6, 0.5], 1.1)
    const bg = new THREE.Color('#14161b')
    const base = new THREE.Color(RING)

    let traced = ''
    const w = { lines: 1, arrows: 0 }
    let probeX = 0
    return {
      scene,
      view: { center: [0, 0.6, 0], radius: 44, polar: 1.36, azimuth: 0.22 },
      frame(dt, p) {
        const s = solveProbe(p)
        const view = (p.view as View) ?? 'lines'
        const charges = LAYOUTS[s.layout]
        if (s.layout !== traced) {
          traced = s.layout
          const flat = chargeLines(charges, { perUnit: 4, seedR: 0.6, box: BOX, step: 0.18 })
          lines.set(flat)
          depth.set(
            TILTS.flatMap((a) => flat.map((l) => l.map(([x, y]): V3 => [x, y * Math.cos(a), y * Math.sin(a)]))),
            (at, out) => out.copy(base).lerp(bg, Math.min(0.75, 0.3 + Math.abs(at.z) / 8)),
          )
          grid.set(GRID.filter(([x, y]) => charges.every((c) => Math.hypot(x - c.at[0], y - c.at[1]) > 1.6)), (at, out) => {
            const e = fieldAt(s.layout, at.x, at.y)
            const m = Math.hypot(e[0], e[1])
            if (m > 0) out.set(e[0], e[1], 0).multiplyScalar(fieldLength(m, 0.32) / m)
          })
          balls.forEach((b, k) => {
            const c = charges[k]
            b.group.visible = !!c
            if (c) {
              b.group.position.set(...c.at)
              b.set(c.q, 3)
            }
          })
        }
        w.lines += ((view === 'lines' ? 1 : 0) - w.lines) * ease(dt)
        w.arrows = 1 - w.lines
        presence(lines.group, w.lines)
        presence(depth.group, w.lines)
        presence(grid.group, w.arrows)
        lines.step(dt * 2)

        probeX += (s.x - probeX) * ease(dt, 8)
        probe.position.x = probeX
        const e = fieldAt(s.layout, probeX, PROBE_Y)
        const m = Math.hypot(e[0], e[1]) || 1
        const len = fieldLength(m, 0.85)
        const out = 0.5 + len / 2
        probeArrow.set([[(e[0] / m) * out, (e[1] / m) * out, 0.2]], (_, v) => v.set((e[0] / m) * len, (e[1] / m) * len, 0))
        eLabel.display.group.position.y = e[1] > 0 ? -1.6 : 1.6
        eLabel.show(fitDigits(s.mag / 1000, 3))
        eLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveProbe(p)
        return [
          { label: 'E at probe', value: si(s.mag, 'N/C', 3), tone: 'ok' },
          { label: 'Direction', value: `${Math.round(s.angle)}°` },
          { label: 'Force on 1 nC', value: si(s.force, 'N', 3) },
        ]
      },
    }
  },
}

// --- Capacitance from plates: C = ε₀·εr·A / d, charged by a battery through the wires. ---

const CAP_V = 9
const PER_CM = 0.6
const PER_MM = 1.05
const PLATE_X = 2.4
const PLATE_T = 0.3
const BAT_X = -12
const BAT_H = 4
const MAX_TOKENS = 300
const CHARGE_TAU = 0.45
const Q_MAX = capacitorCharge(plateCapacitance(0.04, 0.001, DIELECTRIC.mica), CAP_V)
const SLAB: Record<Dielectric, string> = { air: '#ffffff', ptfe: '#eef2f6', mica: '#c99a4a' }

const solvePlates = (p: Params) => {
  const area = n(p, 'area')
  const gap = n(p, 'gap')
  const medium = (p.medium as Dielectric) ?? 'air'
  const er = DIELECTRIC[medium]
  const c = plateCapacitance(area / 1e4, gap / 1000, er)
  return { area, gap, medium, er, c, q: capacitorCharge(c, CAP_V), e: plateField(CAP_V, gap / 1000), u: capacitorEnergy(c, CAP_V) }
}

export const capacitanceFromPlates: Lesson = {
  id: 'electric-fields-capacitance-from-plates',
  title: 'Capacitance from plates',
  tagline: 'Two plates and a gap store charge',
  formula: (p) => {
    const s = solvePlates(p)
    return `C = ε₀·εr·A / d = ${si(EPSILON_0, 'F/m', 3)} × ${s.er} × ${+(s.area / 1e4).toPrecision(3)} m² / ${s.gap / 1000} m = ${si(s.c, 'F', 3)}`
  },
  legend: [
    { color: HIGH_V, label: '+ charge, Q in nC', shape: 'dot' },
    { color: LOW_V, label: '− charge', shape: 'dot' },
    { color: RING, label: 'Field E = V / d', shape: 'dot' },
    { color: RULER, label: 'Capacitance C, pF', shape: 'dot' },
  ],
  points: [
    'Two metal plates facing each other across a gap make a capacitor. Connect a 9 V battery and charge flows until the plates sit 9 V apart: + piles up on one, − on the other. Current flows only while that happens.',
    'Capacitance is charge per volt, C = Q / V. For plates C = ε₀·εr·A / d: double the area and it doubles; halve the gap and it doubles too.',
    'Between the plates the field is uniform, E = V / d: the same 9 V over a narrower gap is a stronger field (denser lines), and holding it takes more charge.',
    'Fill the gap with a dielectric and its molecules polarise, cancelling part of the field, so the battery pushes εr times more charge in: PTFE 2.1×, mica 6×.',
    'The values are tiny: 100 cm² at 1 mm in air is just 88.5 pF. Real capacitors reach µF by rolling long foils with very thin, high-εr layers. The energy, U = ½CV², is stored in the field.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'medium',
      options: [
        { value: 'air', label: 'Air' },
        { value: 'ptfe', label: 'PTFE' },
        { value: 'mica', label: 'Mica' },
      ],
      initial: 'air',
    },
    { kind: 'slider', key: 'area', label: 'Plate area A', min: 25, max: 400, initial: 200, step: 25, format: (v) => `${v} cm²` },
    { kind: 'slider', key: 'gap', label: 'Gap d', min: 1, max: 10, initial: 3, step: 0.5, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const battery = add(scene, cell(BAT_H, 1.3), [BAT_X, 0, 0])
    battery.rotation.y = -0.2
    const unit = new THREE.BoxGeometry(1, 1, 1)
    const plate = (f: number) => {
      const c = potentialColor(f)
      const m = mesh(unit, new THREE.MeshStandardMaterial({ color: '#c9ccd3', emissive: c, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false }))
      m.castShadow = false
      return add(scene, m)
    }
    const top = plate(1)
    const bottom = plate(0)
    const slabMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, roughness: 0.3, depthWrite: false })
    const slab = add(scene, mesh(unit, slabMat))
    slab.castShadow = false
    const tokenGeo = new THREE.SphereGeometry(0.2, 10, 8)
    const tokens = [HIGH_V, LOW_V].map((c) => {
      const m = new THREE.InstancedMesh(tokenGeo, glowMat(c, 0.9), MAX_TOKENS)
      m.frustumCulled = false
      m.count = 0
      scene.add(m)
      return m
    })
    const lines = fieldLines(scene, { maxSegments: 300, maxHeads: 600, radius: 0.045, head: 0.2, spacing: 2.6, margin: 0.4 })
    const wires = add(scene, new THREE.Group())
    let flows: Flow[] = []
    const cLabel = pulseLabel(scene, 4, RULER, [0, 0, 0], 1.4)
    const qLabel = pulseLabel(scene, 4, HIGH_V, [0, 0, 0], 1.2)
    const vLabel = pulseLabel(scene, 1, HIGH_V, [BAT_X - 2.4, 0, 0], 1.3)
    vLabel.show(String(CAP_V))

    const m4 = new THREE.Matrix4()
    let shape = ''
    let q = 0
    let side = 0
    let g = 0
    return {
      scene,
      view: { center: [-2.2, 1, 0], radius: 40, polar: 1.25, azimuth: 0.2 },
      frame(dt, p) {
        const s = solvePlates(p)
        const key = `${s.area},${s.gap}`
        if (key !== shape) {
          shape = key
          side = Math.sqrt(s.area) * PER_CM
          g = s.gap * PER_MM
          top.scale.set(side, PLATE_T, side)
          top.position.set(PLATE_X, g / 2 + PLATE_T / 2, 0)
          bottom.scale.set(side, PLATE_T, side)
          bottom.position.set(PLATE_X, -g / 2 - PLATE_T / 2, 0)
          slab.scale.set(side - 0.2, Math.max(0.05, g - 0.12), side - 0.2)
          slab.position.set(PLATE_X, 0, 0)
          emptyGroup(wires)
          const edge = PLATE_X - side / 2
          const y = g / 2 + PLATE_T / 2
          const upper: V3[] = [[BAT_X, BAT_H / 2 + 0.4, 0], [BAT_X, Math.max(y, BAT_H / 2 + 1.4), 0], [edge, Math.max(y, BAT_H / 2 + 1.4), 0], [edge, y, 0]]
          const lower: V3[] = upper.map(([x, yy, z]) => [x, -yy, z])
          wire(wires, upper)
          wire(wires, lower)
          flows = [upper, [...lower].reverse()].map((pts) => {
            const f = new Flow(path(pts.map(([x, yy]): V3 => [x, yy, 0.7])), 1.4, CONVENTIONAL, 0.3, plusGeometry(0.6))
            wires.add(f.mesh)
            return f
          })
          const spacing = 1.5 / Math.sqrt(s.e / 3000)
          const k = Math.max(1, Math.round(side / spacing))
          const ls: V3[][] = []
          for (let i = 0; i < k; i++)
            for (let j = 0; j < k; j++) {
              const x = PLATE_X - side / 2 + ((i + 0.5) / k) * side
              const z = -side / 2 + ((j + 0.5) / k) * side
              ls.push([[x, g / 2, z], [x, -g / 2, z]])
            }
          lines.set(ls)
          cLabel.display.group.position.set((BAT_X + edge) / 2 + 0.6, -1.3, 0)
          qLabel.display.group.position.set((BAT_X + edge) / 2 + 0.6, 1.4, 0)
        }
        slab.visible = s.medium !== 'air'
        slabMat.color.set(SLAB[s.medium])

        const before = q
        q = rcStep(q, s.q, CHARGE_TAU, dt)
        const rate = (q - before) / Math.max(dt, 1e-6) / s.q
        for (const f of flows) f.step(dt * 9 * Math.max(-1.5, Math.min(1.5, rate)))
        for (const f of flows) f.mesh.visible = Math.abs(rate) > 0.02

        const count = Math.min(MAX_TOKENS, Math.round(MAX_TOKENS * Math.sqrt(clamp01(q / Q_MAX))))
        tokens.forEach((t, k) => {
          const y = k ? -g / 2 + 0.22 : g / 2 - 0.22
          for (let i = 0; i < count; i++)
            t.setMatrixAt(i, m4.makeTranslation(PLATE_X + (halton(i, 2) - 0.5) * (side - 0.5), y, (halton(i, 3) - 0.5) * (side - 0.5)))
          t.count = count
          t.instanceMatrix.needsUpdate = true
        })
        lines.step(dt * 1.5)
        cLabel.show(fitDigits(s.c * 1e12, 4))
        qLabel.show(fitDigits(q * 1e9, 4))
        for (const l of [cLabel, qLabel, vLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solvePlates(p)
        return [
          { label: 'C', value: si(s.c, 'F', 3), tone: 'ok' },
          { label: 'Q = CV', value: si(s.q, 'C', 3) },
          { label: 'E = V / d', value: si(s.e, 'V/m', 3) },
          { label: 'U = ½CV²', value: si(s.u, 'J', 3) },
        ]
      },
    }
  },
}
