import * as THREE from 'three/webgpu'
import { Vec3, chargeLines, traceLine, wireField } from '../../core/fields'
import {
  EARTH_B_H,
  IRON_CORE,
  MAGNET_BR,
  MagnetKind,
  compassDeflection,
  dipoleFlux,
  magnetMoment,
  magnetStroke,
  solenoidB,
  strokePeakEmf,
  wireB,
  wireForce,
} from '../../core/physics'
import { fitDigits, niceCeil, si } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CONVENTIONAL,
  Flow,
  FORCE,
  NORTH,
  POWER,
  RING,
  SOUTH,
  arrow,
  arrowGrid,
  barMagnet,
  coil,
  coilLines,
  compass,
  dimField,
  ease,
  emptyGroup,
  fieldLines,
  glowMat,
  path,
  plusGeometry,
  presence,
  pulseLabel,
  scope,
  turnAboutX,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const tesla = (b: number) => si(b, 'T', 3)
const amps = (a: number) => `${a > 0 ? '+' : ''}${a} A`

const times = (x: number) => (x >= 100 ? String(Math.round(x)) : String(+x.toPrecision(3)))

// --- Wire and compass: current makes a field that circles the wire (Oersted, 1820). ---

const MAX_I = 10
const CARD_R = 12.5
const WIRE_H = 7
const DELTA_B = 10e-6
const LINE_R: [number, number] = [1.7, 10.5]
const PLANES = [-5, 5]
const COMPASSES = 8

/** Radii (cm) where the wire's field is 10, 20, 30 … µT, so lines crowd where it's strong. */
const circleRadii = (i: number) => {
  const out: number[] = []
  for (let k = 1; k < 40; k++) {
    const r = wireB(Math.abs(i), 0.01) / (k * DELTA_B)
    if (r < LINE_R[0]) break
    if (r <= LINE_R[1]) out.push(r)
  }
  return out
}

const solveWire = (p: Params) => {
  const i = n(p, 'amps')
  const r = n(p, 'r')
  const b = wireB(i, r / 100)
  const turn = compassDeflection(b)
  return { i, r, b, deg: (turn * 180) / Math.PI }
}

export const wireAndCompass: Lesson = {
  id: 'magnetism-wire-and-compass',
  title: 'Wire and compass',
  tagline: 'Current makes a magnetic field',
  formula: (p) => {
    const s = solveWire(p)
    return `B = μ₀I / 2πr = 4π × 10⁻⁷ × ${Math.abs(s.i)} A / (2π × ${s.r / 100} m) = ${si(Math.abs(s.b), 'T', 3)} · tan θ = B / ${si(EARTH_B_H, 'T', 2)} → θ = ${Math.round(Math.abs(s.deg))}°`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current I, + charges', shape: 'dot' },
    { color: B_FIELD, label: 'Field B, a line per 10 µT', shape: 'dot' },
    { color: NORTH, label: 'Compass north end', shape: 'dot' },
    { color: POWER, label: 'Front needle’s turn, °', shape: 'dot' },
  ],
  points: [
    'A compass needle is a small magnet: with no current it lines up with Earth’s field and points north (up the card here).',
    'Run a current up the wire and the needles swing round it. Moving charge makes a magnetic field, and round a straight wire its lines are circles.',
    'Right-hand grip rule: thumb along the current, and your fingers curl the way the field goes. Reverse the current and every needle flips.',
    'The field falls off as 1 / r: B = μ₀I / 2πr, with μ₀ = 4π × 10⁻⁷ T·m/A. Lines are drawn every 10 µT, so they crowd near the wire. 10 A at 1 cm makes 200 µT.',
    'Earth’s field is about 50 µT, but only its horizontal part (~20 µT in Europe) turns a compass. The needle settles along the sum of both, so it turns by tan θ = B / 20 µT: far out, Earth wins.',
  ],
  controls: [
    { kind: 'slider', key: 'amps', label: 'Current I', min: -MAX_I, max: MAX_I, initial: 6, step: 0.5, format: amps },
    { kind: 'slider', key: 'r', label: 'Compass ring r', min: 3, max: 8, initial: 5, step: 0.5, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const card = add(scene, mesh(new THREE.CylinderGeometry(CARD_R, CARD_R, 0.2, 64), mat('#2e323b', { rough: 0.85, opacity: 0.85 })), [0, -0.1, 0])
    card.castShadow = false
    cylinder(scene, 0.35, 2 * WIRE_H, mat('#c8803f', { metal: 0.35, rough: 0.4 }), [0, 0, 0])
    const charges = new Flow(path([[0, -WIRE_H, 0.45], [0, WIRE_H, 0.45]]), 1.3, CONVENTIONAL, 0.3, plusGeometry(0.55))
    scene.add(charges.mesh)
    arrow(scene, [-9.5, 0.6, 4.5], [0, 0, -1], '#8a93a6', 1.1)

    const lines = fieldLines(scene, { maxSegments: 2400, spacing: 3.6, radius: 0.06, color: B_FIELD })
    const depth = fieldLines(scene, { maxSegments: 4800, radius: 0.045, heads: false })
    const needles = Array.from({ length: COMPASSES }, () => {
      const c = compass(scene, [0, 0.35, 0], 1.05)
      c.group.rotation.x = -Math.PI / 2
      c.set(Math.PI / 2)
      return c
    })
    const marker = add(scene, mesh(new THREE.TorusGeometry(1.4, 0.1, 8, 32), glowMat(POWER, 0.9)), [0, 0.2, 0])
    marker.rotation.x = -Math.PI / 2
    const degLabel = pulseLabel(scene, 3, POWER, [0, 0, 0], 1.2)
    degLabel.display.group.rotation.x = -0.65

    let traced = NaN
    let ring = 5
    return {
      scene,
      view: { center: [0, -0.4, 0.8], radius: 37, polar: 0.92, azimuth: 0.18 },
      frame(dt, p) {
        const s = solveWire(p)
        if (s.i !== traced) {
          traced = s.i
          const circles = circleRadii(s.i).map((r) => {
            const step = Math.max(0.12, r * 0.05)
            const loop = traceLine(wireField, [r, 0, 0], { step, maxSteps: 400, closeWithin: step })
            return s.i < 0 ? [...loop].reverse() : loop
          })
          const at = (y: number) => circles.map((l) => l.map(([u, v]): V3 => [u, y, -v]))
          lines.set(at(0.15))
          depth.set(PLANES.flatMap(at), dimField)
        }
        lines.step(dt * 1.2 * Math.sign(s.i))
        charges.step(dt * 0.6 * s.i)

        ring += (s.r - ring) * ease(dt)
        needles.forEach((c, k) => {
          const a = (k / COMPASSES) * 2 * Math.PI + Math.PI / 2
          const x = ring * Math.cos(a)
          const z = ring * Math.sin(a)
          c.group.position.set(x, 0.35, z)
          const b = wireB(s.i, ring / 100)
          const bx = (b * z) / ring
          const bz = (-b * x) / ring - EARTH_B_H
          c.swing(Math.atan2(-bz, bx), dt)
        })
        marker.position.set(0, 0.2, ring)
        degLabel.display.group.position.set(2, 0.7, ring + 2.3)
        degLabel.show(String(Math.round(Math.abs(s.deg))))
        degLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveWire(p)
        return [
          { label: 'B at r', value: si(Math.abs(s.b), 'T', 3), tone: 'ok' },
          { label: 'Earth', value: si(EARTH_B_H, 'T', 2) },
          { label: 'Needle turns', value: `${Math.round(Math.abs(s.deg))}°${s.i ? (s.i > 0 ? ' E' : ' W') : ''}` },
        ]
      },
    }
  },
}

// --- Solenoid: wind the wire into a coil and the circles add up to a strong, even field inside. ---

const COIL_L = 12
const COIL_R = 2.4
const LOOPS = 16
const PER_DRAWN = 4
const COIL_BOX: [number, number] = [15.5, 8.2]
const TILTS = [Math.PI / 3, -Math.PI / 3]
const PROBES: V3[] = [
  [-COIL_L / 2 - 3, 0, 0],
  [COIL_L / 2 + 3, 0, 0],
  [0, COIL_R + 2.6, 0],
  [0, -COIL_R - 2.6, 0],
]
type Core = 'air' | 'iron'

const solveCoil = (p: Params) => {
  const i = n(p, 'amps')
  const turns = n(p, 'turns')
  const core = (p.core as Core) ?? 'air'
  const b = solenoidB(turns, COIL_L / 100, i, core === 'iron' ? IRON_CORE : undefined)
  const air = solenoidB(turns, COIL_L / 100, i)
  return { i, turns, core, b, air, perM: turns / (COIL_L / 100), saturated: core === 'iron' && Math.abs(b) < Math.abs(air * IRON_CORE.mur) - 1e-9 }
}
/** Line pairs drawn for a field strength: one more per ×4.6 in B, so mT and T both read. */
const pairsFor = (b: number) => (b === 0 ? 0 : Math.max(1, Math.min(6, Math.round(1.5 * Math.log10(Math.abs(b) / 1e-5)))))

export const solenoid: Lesson = {
  id: 'magnetism-solenoid',
  title: 'Solenoid',
  tagline: 'A coil makes a bar magnet you can switch',
  formula: (p) => {
    const s = solveCoil(p)
    const mur = s.core === 'iron' ? ` × ${IRON_CORE.mur}` : ''
    return `B = μ₀${s.core === 'iron' ? 'μr' : ''}·nI = 4π × 10⁻⁷${mur} × ${s.turns} / ${COIL_L / 100} m × ${Math.abs(s.i)} A = ${tesla(Math.abs(s.b))}${s.saturated ? ' (saturated)' : ''}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current I round the turns', shape: 'dot' },
    { color: B_FIELD, label: 'Field B; mT inside', shape: 'dot' },
    { color: NORTH, label: 'North end / needle', shape: 'dot' },
    { color: SOUTH, label: 'South end', shape: 'dot' },
  ],
  points: [
    'Wind the wire into a coil and each turn’s circles of field add up inside: a solenoid. Its field runs straight down the middle and loops round outside, just like a bar magnet’s.',
    'The end where the field comes out is north. Grip the coil with your right hand, fingers along the current: your thumb points to north. Reverse the current and the poles swap.',
    'Inside a long coil the field is even: B = μ₀nI, with n = N / L turns per metre. Double the turns or the current and B doubles. Outside it’s much weaker, and at each end it’s about half.',
    'An iron core multiplies the field: its domains line up with the coil’s field and add their own. An open rod gives ~200×, until the iron saturates near 1.6 T. That’s an electromagnet: relays, motors and speakers are built on it.',
    'Compasses round the coil show the loop: along the axis they point the same way as inside; beside the coil they point back. Each drawn turn stands for 4, and line count grows with log B, so weak and strong coils both read.',
  ],
  controls: [
    { kind: 'choice', key: 'core', options: [{ value: 'air', label: 'Air' }, { value: 'iron', label: 'Iron core' }], initial: 'air' },
    { kind: 'slider', key: 'amps', label: 'Current I', min: -3, max: 3, initial: 2, step: 0.25, format: amps },
    { kind: 'slider', key: 'turns', label: 'Turns N', min: 10, max: 100, initial: 40, step: 10, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group())
    const core = add(scene, new THREE.Group())
    cylinder(core, COIL_R * 0.72, COIL_L + 1.6, mat('#6d7078', { metal: 0.35, rough: 0.45 }), [0, 0, 0], 'x', 32)
    const ends = [-1, 1].map((side) => {
      const m = glowMat(NORTH, 0.6)
      const r = add(scene, mesh(new THREE.TorusGeometry(COIL_R + 0.45, 0.14, 8, 40), m), [(side * COIL_L) / 2, 0, 0])
      r.rotation.y = Math.PI / 2
      return { r, m, side }
    })
    const lines = coilLines(scene, { radius: COIL_R, length: COIL_L, loops: LOOPS, box: COIL_BOX })
    const needles = PROBES.map((at) => {
      const c = compass(scene, at, 0.9)
      c.set(Math.PI / 2)
      return { c, dir: lines.field(at as Vec3) }
    })
    const bLabel = pulseLabel(scene, 4, B_FIELD, [0, -COIL_R - 5.2, 0], 1.3)

    let wound = 0
    let flow: Flow | null = null
    let iron = 0
    return {
      scene,
      view: { center: [0, 0.2, 0], radius: 44, polar: 1.36, azimuth: 0.26 },
      frame(dt, p) {
        const s = solveCoil(p)
        if (s.turns !== wound) {
          wound = s.turns
          emptyGroup(holder)
          const w = 0.16
          const c = coil(holder, { radius: COIL_R, length: COIL_L, turns: Math.max(3, Math.round(s.turns / PER_DRAWN)), thickness: w })
          wire(holder, [[-COIL_L / 2, COIL_R, 0], [-COIL_L / 2, COIL_R + 2.4, 0]], w)
          wire(holder, [[COIL_L / 2, COIL_R, 0], [COIL_L / 2, COIL_R + 2.4, 0]], w)
          flow = new Flow(c.lane(w + 0.12), 1.5, CONVENTIONAL, 0.15)
          holder.add(flow.mesh)
        }
        flow?.step(dt * 1.6 * s.i)

        lines.set(pairsFor(s.b), s.b)
        lines.step(dt * 2 * Math.sign(s.b))

        iron += ((s.core === 'iron' ? 1 : 0) - iron) * ease(dt)
        presence(core, iron)
        for (const e of ends) {
          const col = s.b === 0 ? '#8a8f99' : e.side * s.b > 0 ? NORTH : SOUTH
          e.m.color.set(col)
          e.m.emissive.set(col)
        }
        for (const { c, dir } of needles) if (s.b !== 0) c.swing(Math.atan2(dir[1] * Math.sign(s.b), dir[0] * Math.sign(s.b)), dt)
        bLabel.show(fitDigits(Math.abs(s.b) * 1000, 4))
        bLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveCoil(p)
        return [
          { label: 'n = N / L', value: `${Math.round(s.perM)} /m` },
          { label: 'B inside', value: tesla(Math.abs(s.b)), tone: s.saturated ? 'warn' : 'ok' },
          { label: 'vs Earth', value: `${times(Math.abs(s.b) / EARTH_B_H)}×` },
          { label: 'North end', value: s.b > 0 ? 'Right' : s.b < 0 ? 'Left' : '—' },
        ]
      },
    }
  },
}

// --- Right-hand rule: a current across a field feels a sideways force, F = IL × B. ---

const ROD = 5.4
const ROD_M = 0.05
const GAP = 7
const POLE: V3 = [2.2, 11, 4.4]
const ROWS = [-1.3, 1.3]
const SWING = 1.2
const TRIAD_X = 10.5
const ARM = 3.2

const solveForce = (p: Params) => {
  const i = n(p, 'amps')
  const bT = n(p, 'mt') / 1000
  const deg = n(p, 'angle')
  const th = (deg * Math.PI) / 180
  const f = wireForce(i, wireAlong(th, ROD_M), [0, -bT, 0])
  const mag = Math.abs(f[0])
  return { i, bT, deg, th, f, mag, way: mag < 1e-12 ? 'None' : f[0] > 0 ? 'Right' : 'Left' }
}
/** The wire, tilted θ from the field (straight down) towards the viewer. */
const wireAlong = (th: number, len: number): Vec3 => [0, -Math.cos(th) * len, Math.sin(th) * len]
/** Arrow length for a force, log-scaled so 1 mN and 250 mN both read. */
const forceLength = (f: number) => (f > 1e-6 ? 0.8 + 1.1 * Math.log(1 + f / 0.004) : 0)

export const rightHandRule: Lesson = {
  id: 'magnetism-right-hand-rule',
  title: 'Right-hand rule',
  tagline: 'Current across a field gets pushed sideways',
  formula: (p) => {
    const s = solveForce(p)
    return `F = B·I·L·sin θ = ${s.bT} T × ${Math.abs(s.i)} A × ${ROD_M} m × sin ${s.deg}° = ${si(s.mag, 'N', 3)}${s.mag ? ` → ${s.way.toLowerCase()}` : ''}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current I (index finger)', shape: 'dot' },
    { color: B_FIELD, label: 'Field B, N → S (middle)', shape: 'dot' },
    { color: FORCE, label: 'Force F, mN (thumb)', shape: 'dot' },
  ],
  points: [
    'A current is moving charge, and a magnetic field pushes on moving charge. So a wire carrying current between magnet poles is shoved sideways, across both the current and the field.',
    'Right-hand rule for F = IL × B: point your index finger along the current, bend your middle finger along the field, and your thumb gives the force. The three arrows on the right are your hand.',
    'Size: F = B·I·L·sin θ. Double the field, the current or the length in the field and the push doubles. Reverse the current (or swap the poles) and it flips.',
    'Only the part of the current across the field counts. Tilt the wire until it runs along the field (θ = 0°) and the force vanishes; square across (90°) it’s strongest. The wire here is 5 cm long.',
    'This sideways push is what turns every electric motor and moves a loudspeaker cone. The same force bends electron beams: F = qv × B for a single charge.',
  ],
  controls: [
    { kind: 'slider', key: 'amps', label: 'Current I', min: -5, max: 5, initial: 3, step: 0.5, format: amps },
    { kind: 'slider', key: 'mt', label: 'Field B', min: 50, max: 1000, initial: 400, step: 50, format: (v) => `${v} mT` },
    { kind: 'slider', key: 'angle', label: 'Angle θ to B', min: 0, max: 90, initial: 90, step: 5, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    for (const y of [1, -1]) {
      const m = barMagnet(scene, POLE)
      m.rotation.z = -Math.PI / 2
      m.position.y = y * (GAP / 2 + POLE[0] / 2)
    }
    box(scene, [1.6, GAP + POLE[0] * 2, POLE[2]], mat('#80848e', { metal: 0.3, rough: 0.5 }), [-POLE[1] / 2 - 0.8, 0, 0])
    const lines = fieldLines(scene, { maxSegments: 200, maxHeads: 400, radius: 0.05, head: 0.22, spacing: 2.4, margin: 0.4, color: B_FIELD })

    const swing = add(scene, new THREE.Group())
    const rodGroup = add(swing, new THREE.Group())
    cylinder(rodGroup, 0.3, ROD, mat('#c8803f', { metal: 0.35, rough: 0.4 }), [0, 0, 0])
    for (const y of [1, -1]) wire(rodGroup, [[0, (y * ROD) / 2, 0], [6.4, (y * ROD) / 2, 0]], 0.14)
    const charges = new Flow(path([[0.42, ROD / 2, 0], [0.42, -ROD / 2, 0]]), 0.9, CONVENTIONAL, 0.3, plusGeometry(0.45))
    rodGroup.add(charges.mesh)
    const push = arrowGrid(swing, 1, { color: FORCE, radius: 0.24, head: 0.6, maxLen: 6.5, dim: '#6a3a60' })
    const fLabel = pulseLabel(scene, 3, FORCE, [TRIAD_X, ARM + 1.6, 0], 1.3)

    const triad = add(scene, new THREE.Group(), [TRIAD_X, -0.6, 0])
    add(triad, mesh(new THREE.SphereGeometry(0.3, 16, 12), mat('#e8e8e8', { emissive: '#555555' })))
    const arms = [CONVENTIONAL, B_FIELD, FORCE].map((c) => arrowGrid(triad, 1, { color: c, radius: 0.16, head: 0.42, maxLen: ARM, dim: c }))

    let shift = 0
    let tilt = Math.PI / 2
    let traced = NaN
    return {
      scene,
      view: { center: [2.6, 0.2, 0], radius: 40, polar: 1.25, azimuth: 0.75 },
      frame(dt, p) {
        const s = solveForce(p)
        if (s.bT !== traced) {
          traced = s.bT
          const cols = Math.max(2, Math.round(10 * Math.sqrt(s.bT)))
          const ls: V3[][] = []
          for (let a = 0; a < cols; a++)
            for (const z of ROWS) {
              const x = -4.8 + ((a + 0.5) / cols) * 9.6
              if (Math.abs(x) > 1.5) ls.push([[x, GAP / 2, z], [x, -GAP / 2, z]])
            }
          lines.set(ls)
        }
        lines.step(dt * 2)

        tilt += (s.th - tilt) * ease(dt)
        rodGroup.rotation.x = -tilt
        const shown = wireForce(s.i, wireAlong(tilt, ROD_M), [0, -s.bT, 0])
        shift += (Math.max(-SWING, Math.min(SWING, shown[0] * 8)) - shift) * ease(dt, 3)
        swing.position.x = shift
        charges.step(dt * 0.9 * s.i)

        const len = forceLength(Math.abs(shown[0]))
        const sign = Math.sign(shown[0])
        push.set([[sign * (0.7 + len / 2), 0, 0]], (_, out) => out.set(sign * len, 0, 0))
        fLabel.show(fitDigits(s.mag * 1000, 3))
        fLabel.frame(dt)

        const iDir = new THREE.Vector3(...wireAlong(tilt, Math.sign(s.i) || 1))
        const vecs = [iDir, new THREE.Vector3(0, -1, 0), new THREE.Vector3(sign * Math.min(1, Math.abs(shown[0]) / 0.002), 0, 0)]
        arms.forEach((a, k) => {
          const v = vecs[k].clone().multiplyScalar(ARM)
          a.set([[v.x / 2, v.y / 2, v.z / 2]], (_, out) => out.copy(v))
        })
      },
      readouts: (p) => {
        const s = solveForce(p)
        return [
          { label: 'Force F', value: si(s.mag, 'N', 3), tone: 'ok' },
          { label: 'Direction', value: s.way },
          { label: 'sin θ', value: Math.sin(s.th).toFixed(2) },
        ]
      },
    }
  },
}

// --- Induction: a changing flux through a coil drives a voltage, ε = −N·dΦ/dt. ---

const PER_CM = 1.5
const PICKUP_R = 1.5
const PICKUP_L = 1.2
const STROKE = 5
const MAG_SIZE: V3 = [3, 1, 1]
const MAG_VOL = (MAG_SIZE[0] * MAG_SIZE[1] * MAG_SIZE[2]) / 1e6
const SCOPE_Y = -7.4
const SCOPE_W = 22
const SCOPE_H = 6
const WINDOW = 2

const solveInduction = (p: Params) => {
  const hz = n(p, 'hz')
  const turns = n(p, 'turns')
  const magnet = (p.magnet as MagnetKind) ?? 'neodymium'
  const m = magnetMoment(MAGNET_BR[magnet], MAG_VOL)
  const peak = strokePeakEmf(turns, m, PICKUP_R / 100, STROKE / 100, hz)
  return { hz, turns, magnet, m, peak, range: niceCeil(peak), fluxMax: dipoleFlux(m, PICKUP_R / 100, 0), speed: 2 * Math.PI * hz * STROKE }
}

export const induction: Lesson = {
  id: 'magnetism-induction',
  title: 'Induction',
  tagline: 'A moving magnet drives a current',
  formula: (p) => {
    const s = solveInduction(p)
    return `ε = −N·dΦ/dt: ${s.turns} turns × up to ${si(s.peak / s.turns, 'V', 3)} per turn = ${si(s.peak, 'V', 3)} peak`
  },
  legend: [
    { color: NORTH, label: 'Magnet N / S, field lines', shape: 'dot' },
    { color: B_FIELD, label: 'Flux Φ through the coil', shape: 'dot' },
    { color: RING, label: 'EMF ε, peak in mV', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Induced current', shape: 'dot' },
  ],
  points: [
    'Push a magnet into a coil and a voltage appears across it; pull it out and the voltage reverses. Hold it still, even right inside, and there’s nothing. Only a changing field induces (Faraday, 1831).',
    'Flux Φ is how much field passes through the coil’s turns, in webers. Faraday’s law: ε = −N·dΦ/dt. The scope shows Φ peak as the magnet passes the coil, and ε where Φ changes fastest, either side of it.',
    'Faster motion or more turns, more voltage: double either and ε doubles. A stronger magnet (neodymium vs ferrite) gives more flux to change. The scope rescales in 1-2-5 steps, like a real one.',
    'Lenz’s law (the minus sign): the induced current makes its own field that fights the change. Coming in, the coil repels the magnet; going out, it pulls it back. That’s why generating power takes work.',
    'Generators spin magnets past coils, transformers change the flux with AC instead of motion, and a phone charger pad does it across a gap. Magnet here: 10 × 10 × 30 mm, coil 3 cm across.',
  ],
  controls: [
    { kind: 'choice', key: 'magnet', options: [{ value: 'ferrite', label: 'Ferrite' }, { value: 'neodymium', label: 'Neodymium' }], initial: 'neodymium' },
    { kind: 'slider', key: 'hz', label: 'Strokes per second', min: 0, max: 2, initial: 0.75, step: 0.25, format: (v) => `${v} Hz` },
    { kind: 'slider', key: 'turns', label: 'Turns N', min: 50, max: 500, initial: 200, step: 50, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const magnet = add(scene, new THREE.Group())
    barMagnet(magnet, [MAG_SIZE[0] * PER_CM, MAG_SIZE[1] * PER_CM, MAG_SIZE[2] * PER_CM])
    const pole = MAG_SIZE[0] * PER_CM * 0.36
    const poles = [{ q: 1, at: [pole, 0, 0] as Vec3 }, { q: -1, at: [-pole, 0, 0] as Vec3 }]
    const flat = chargeLines(poles, { perUnit: 8, seedR: 0.4, box: [7.5, 4.6], step: 0.12 })
    const field = fieldLines(magnet, { maxSegments: 1500, spacing: 2.6, radius: 0.05, head: 0.22, color: B_FIELD })
    field.set(flat)
    const depth = fieldLines(magnet, { maxSegments: 3000, radius: 0.04, heads: false })
    depth.set(turnAboutX(flat, TILTS), dimField)

    const pickup = add(scene, new THREE.Group())
    pickup.rotation.x = Math.PI
    cylinder(scene, PICKUP_R * PER_CM - 0.3, PICKUP_L * PER_CM + 0.8, mat('#e8e4d8', { rough: 0.6, opacity: 0.18 }), [0, 0, 0], 'x', 32)
    const r = PICKUP_R * PER_CM
    const leadsY = SCOPE_Y + SCOPE_H / 2 + 0.6
    let flow: Flow | null = null
    let wound = 0

    const screen = scope(scene, SCOPE_W, SCOPE_H)
    screen.group.position.set(0, SCOPE_Y, 0)
    const fluxTrace = screen.trace(B_FIELD)
    const emfTrace = screen.trace(RING, { samples: 220 })
    const peakLabel = pulseLabel(scene, 4, RING, [-SCOPE_W / 2 - 3, SCOPE_Y + SCOPE_H / 4, 0], 1.1)

    let phase = 0
    return {
      scene,
      view: { center: [-1.4, -2.2, 0], radius: 45, polar: 1.38, azimuth: 0.2 },
      frame(dt, p) {
        const s = solveInduction(p)
        const drawn = Math.max(4, Math.min(16, Math.round(s.turns / 30)))
        if (drawn !== wound) {
          wound = drawn
          emptyGroup(pickup)
          const w = 0.16
          const c = coil(pickup, { radius: r, length: PICKUP_L * PER_CM, turns: drawn, thickness: w })
          for (const x of [-1, 1]) wire(pickup, [[(x * PICKUP_L * PER_CM) / 2, r, 0], [x * 2, -leadsY, 0]], w)
          flow = new Flow(c.lane(0.26), 1.5, CONVENTIONAL, 0.14)
          pickup.add(flow.mesh)
        }
        const w = 2 * Math.PI * s.hz
        phase += w * dt
        const at = (back: number) => magnetStroke(s.turns, s.m, PICKUP_R / 100, STROKE / 100, s.hz, (phase - w * back) / (w || 1))
        const now = s.hz ? at(0) : { z: (STROKE / 100) * Math.sin(phase), flux: dipoleFlux(s.m, PICKUP_R / 100, (STROKE / 100) * Math.sin(phase)), emf: 0 }
        magnet.position.x = now.z * 100 * PER_CM
        flow?.step(dt * 10 * (s.range ? now.emf / s.range : 0))

        const half = SCOPE_H / 2
        const sample = (u: number) => (s.hz ? at((1 - u) * WINDOW) : now)
        fluxTrace.draw((u) => -half + (sample(u).flux / s.fluxMax) * SCOPE_H * 0.92)
        emfTrace.draw((u) => (s.range ? (sample(u).emf / s.range) * half : 0))
        peakLabel.show(fitDigits(s.peak * 1000, 4))
        peakLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveInduction(p)
        return [
          { label: 'Peak ε', value: si(s.peak, 'V', 3), tone: s.peak ? 'ok' : undefined },
          { label: 'Peak Φ', value: si(s.fluxMax, 'Wb', 3) },
          { label: 'Top speed', value: `${+s.speed.toPrecision(3)} cm/s` },
          { label: 'Scope', value: s.range ? `±${si(s.range, 'V', 2)}` : '—' },
        ]
      },
    }
  },
}

