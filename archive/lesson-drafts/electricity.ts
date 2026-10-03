import * as THREE from 'three/webgpu'
import { solveLedLoop } from '../core/circuit'
import {
  driftVelocity,
  electronsPerSecond,
  Metal,
  RESISTIVITY,
  rcStep,
  resistorPair,
  wireResistance,
} from '../core/physics'
import { sci, si } from '../core/units'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../models/kit'
import { buildLed, resistorBody } from '../models/passives'
import { Helix } from '../models/power'
import { createStage } from '../scene/stage'
import { CELL_HALF, CIRCUIT_VIEW, H, LOOP, W, circuitScene, conventionalArrows, standardLoop } from './circuit'
import {
  CONVENTIONAL,
  ELECTRON,
  Flow,
  HOLE,
  Swarm,
  arrow,
  cell,
  clamp01,
  dotSpeed,
  glowMat,
  inTube,
  path,
  rand,
  slot,
  wire,
} from './fx'
import { Lesson, Params, Stage, n, onChange } from './types'

const ohms = (v: number) => si(v, 'Ω', 2)
const volts = (v: number) => si(v, 'V', 2)

/** Two significant figures, so color bands match the value. */
const niceOhms = (v: number) => +v.toPrecision(2)

function resistorAt(parent: THREE.Object3D, r: number, at: V3, vertical: boolean) {
  const body = resistorBody(niceOhms(r))
  body.scale.setScalar(2.6)
  if (vertical) body.rotation.z = Math.PI / 2
  body.position.set(...at)
  parent.add(body)
  return body
}

// --- Metal wire interior: fixed + ions, free electrons ---

interface MetalInterior {
  electrons: Swarm
  step: (dt: number, drift: number) => void
}

function metalInterior(parent: THREE.Object3D, length: number, radius: number, ionSpacing: number, thermal: number): MetalInterior {
  const ionBase: THREE.Vector3[] = []
  for (let x = -length / 2 + ionSpacing / 2; x < length / 2; x += ionSpacing) {
    for (let y = -radius; y <= radius; y += ionSpacing) {
      for (let z = -radius; z <= radius; z += ionSpacing) {
        if (Math.hypot(y, z) < radius - 0.3) ionBase.push(new THREE.Vector3(x, y, z))
      }
    }
  }
  const ions = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), mat('#e3a35f', { rough: 0.5 }), ionBase.length)
  ions.frustumCulled = false
  parent.add(ions)

  const volume = length * Math.PI * radius * radius
  const count = Math.min(420, Math.round(volume / 2.2))
  const electrons = new Swarm(new THREE.SphereGeometry(0.24, 10, 8), glowMat(ELECTRON, 0.9), count, (p) => {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * (radius - 0.2)
    p.set(rand(-length / 2, length / 2), Math.cos(a) * r, Math.sin(a) * r)
  })
  parent.add(electrons.mesh)

  const m = new THREE.Matrix4()
  const jiggle = new THREE.Vector3()
  return {
    electrons,
    step(dt, drift) {
      ionBase.forEach((b, i) => {
        jiggle.set(rand(-0.08, 0.08), rand(-0.08, 0.08), rand(-0.08, 0.08)).add(b)
        ions.setMatrixAt(i, m.makeTranslation(jiggle))
      })
      ions.instanceMatrix.needsUpdate = true
      electrons.update(dt, {
        thermal,
        drift: [-drift, 0, 0],
        collideRate: 4,
        contain: (p, v) => inTube(p, v, length, radius - 0.2),
      })
    },
  }
}

function glassWire(parent: THREE.Object3D, length: number, radius: number, color: string) {
  const glass = mesh(
    new THREE.CylinderGeometry(radius, radius, length, 48, 1, true),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  )
  glass.rotation.z = Math.PI / 2
  glass.castShadow = false
  parent.add(glass)
  for (const s of [-1, 1]) {
    const ring = add(parent, mesh(new THREE.TorusGeometry(radius, 0.12, 8, 48), mat(color, { metal: 0.3 })), [(s * length) / 2, 0, 0])
    ring.rotation.y = Math.PI / 2
  }
}

const current: Lesson = {
  id: 'current',
  title: 'Current',
  tagline: 'Charge on the move',
  formula: 'I = Q / t',
  points: [
    'A metal is full of free electrons (blue) zipping randomly between fixed atoms (orange). Random motion alone carries no current.',
    'Apply a voltage and they all drift the same way. That net drift is current: how much charge passes the ring each second.',
    '1 ampere = 1 coulomb per second ≈ 6.24 × 10¹⁸ electrons per second.',
    'The real drift is slow, under a millimetre per second, but the push travels at near light speed, so a lamp lights instantly. The drift here is hugely exaggerated.',
    'Conventional current (orange arrow) is drawn + → −, opposite to the electrons. A historical choice that stuck.',
  ],
  controls: [{ kind: 'slider', key: 'amps', label: 'Current', min: 0, max: 3, initial: 1, step: 0.1, format: (v) => si(v, 'A', 2) }],
  build(): Stage {
    const scene = createStage({ span: 22, deskY: -6 })
    const L = 36
    const R = 3
    glassWire(scene, L, R, '#c8803f')
    const gate = add(scene, mesh(new THREE.TorusGeometry(R + 0.2, 0.18, 10, 48), glowMat('#ffd84d', 0.8)))
    gate.rotation.y = Math.PI / 2
    const metal = metalInterior(scene, L, R, 2.3, 3)
    const eArrow = arrow(scene, [0, R + 2.4, 0], [-1, 0, 0], ELECTRON)
    const iArrow = arrow(scene, [0, -R - 2.4, 0], [1, 0, 0], CONVENTIONAL)
    return {
      scene,
      view: { center: [0, 0, 0], radius: 40, polar: 1.2, azimuth: 0.5 },
      frame(dt, p) {
        const a = n(p, 'amps')
        eArrow.visible = iArrow.visible = a > 0
        metal.step(dt, a * 2.5)
      },
      readouts: (p) => {
        const a = n(p, 'amps')
        return [
          { label: 'Current', value: si(a, 'A', 2) },
          { label: 'Electrons / s', value: sci(electronsPerSecond(a)) },
          { label: 'Real drift (1 mm² Cu)', value: si(driftVelocity(a, 1e-6), 'm/s', 2) },
        ]
      },
    }
  },
}

const voltage: Lesson = {
  id: 'voltage',
  title: 'Voltage',
  tagline: 'Push per charge',
  formula: 'V = E / Q',
  points: [
    'Voltage is energy per charge: 1 volt = 1 joule for every coulomb.',
    'Think of height. The battery lifts charge up; it runs back down through the resistor, giving the energy up as heat.',
    'Color is potential: red is high, blue is 0 V. Wires lose almost nothing; the whole drop happens across the resistor.',
    'Voltage is always measured between two points. Here the bottom wire is the 0 V reference (ground).',
    'More voltage, steeper hill, faster flow through the same resistor.',
  ],
  controls: [{ kind: 'slider', key: 'v', label: 'Battery', min: 0, max: 12, initial: 6, step: 0.5, format: volts }],
  build(): Stage {
    const scene = createStage({ span: 22, deskY: -3 })
    const next = slot(scene)
    for (let v = 0; v <= 12; v++) {
      box(scene, [v % 6 === 0 ? 1.6 : 0.9, 0.12, 0.12], mat(v % 6 === 0 ? '#e8e8e8' : '#8a8f99'), [-17, 0.3 + v * 1.1, 0])
    }
    rod(scene, [-17, 0.3, 0], [-17, 0.3 + 13.2, 0], 0.08, mat('#8a8f99'))
    let flow: Flow | null = null
    const rebuild = onChange(['v'], (p) => {
      const v = n(p, 'v')
      const h = 0.3 + v * 1.1
      const g = next()
      const pts: V3[] = [[-12, 0, 0], [-12, h, 0], [0, h, 0], [12, 0, 0]]
      const c = cell(Math.max(h, 1.2), 1.7)
      c.position.set(-12, h / 2, 0)
      g.add(c)
      wire(g, [pts[1], pts[2]])
      wire(g, [pts[3], pts[0]])
      rod(g, pts[2], pts[3], 0.9, mat('#d9c08c', { rough: 0.55 }))
      const lo = new THREE.Color(ELECTRON)
      const hi = new THREE.Color('#ff4d4d')
      flow = new Flow(path(pts, true), 1.5, CONVENTIONAL, 0.36, (q, col) => col.copy(lo).lerp(hi, clamp01(q.y / h)))
      g.add(flow.mesh)
      box(g, [0.5, 0.12, 0.12], mat('#ffd84d', { emissive: '#ffd84d' }), [-16.2, h, 0])
    })
    return {
      scene,
      view: { center: [0, 5, 0], radius: 44, polar: 1.25, azimuth: 0.3 },
      frame(dt, p) {
        rebuild(p)
        flow?.step(dt * n(p, 'v') * 1.1)
      },
      readouts: (p) => {
        const v = n(p, 'v')
        return [
          { label: 'Voltage', value: volts(v) },
          { label: 'Energy per coulomb', value: `${v} J` },
          { label: 'Current through 100 Ω', value: si(v / 100, 'A', 2) },
        ]
      },
    }
  },
}

const resistance: Lesson = {
  id: 'resistance',
  title: 'Resistance',
  tagline: 'Friction for electrons',
  formula: 'R = ρ · L / A',
  points: [
    'Drifting electrons keep bumping into the vibrating atoms. Each bump turns some of their energy into heat.',
    'Longer wire means more bumps and more resistance. Thicker wire means more lanes side by side and less.',
    'ρ (resistivity) is the material. Nichrome is ~65× copper, which is why toasters and heaters use it.',
    'With the same voltage across it, a longer or more resistive wire slows the drift. Thickness doesn’t change the drift speed, it adds more electrons moving.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'metal',
      initial: 'copper',
      options: [
        { value: 'copper', label: 'Copper' },
        { value: 'nichrome', label: 'Nichrome' },
      ],
    },
    { kind: 'slider', key: 'len', label: 'Length', min: 0.1, max: 10, initial: 1, log: true, format: (v) => si(v, 'm', 2) },
    { kind: 'slider', key: 'dia', label: 'Diameter', min: 0.1, max: 2, initial: 0.5, step: 0.05, format: (v) => `${v.toFixed(2)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22, deskY: -8 })
    const next = slot(scene)
    let metal: MetalInterior | null = null
    let drift = 0
    const rebuild = onChange(['metal', 'len', 'dia'], (p) => {
      const g = next()
      const rho = RESISTIVITY[p.metal as Metal]
      const len = n(p, 'len')
      const t = Math.log10(len / 0.1) / 2
      const L = 10 + 26 * t
      const R = 0.9 + 2.6 * ((n(p, 'dia') - 0.1) / 1.9)
      const nichrome = p.metal === 'nichrome'
      glassWire(g, L, R, nichrome ? '#9aa0a8' : '#c8803f')
      metal = metalInterior(g, L, R, nichrome ? 1.5 : 2.3, nichrome ? 5 : 3)
      drift = 4 * 2 ** Math.log10((RESISTIVITY.copper * 1) / (rho * len))
    })
    return {
      scene,
      view: { center: [0, 0, 0], radius: 42, polar: 1.2, azimuth: 0.5 },
      frame(dt, p) {
        rebuild(p)
        metal?.step(dt, drift)
      },
      readouts: (p) => {
        const rho = RESISTIVITY[p.metal as Metal]
        const r = wireResistance(rho, n(p, 'len'), n(p, 'dia') / 1000)
        const i = 1.5 / r
        return [
          { label: 'Resistance', value: ohms(r) },
          { label: 'Resistivity ρ', value: `${sci(rho)} Ω·m` },
          { label: 'Current at 1.5 V', value: si(i, 'A', 2), tone: i > 10 ? 'bad' : undefined },
        ]
      },
    }
  },
}

const ohmsLaw: Lesson = {
  id: 'ohm',
  title: 'Ohm’s law',
  tagline: 'Voltage, current, resistance',
  formula: 'I = V / R',
  points: [
    'For a resistor, current is proportional to voltage: double the push, double the flow.',
    'For the same voltage, a bigger resistance means less current.',
    'Dot speed shows current (not to scale). Blue electrons travel − → + around the loop; orange arrows show conventional current.',
    'The bands on the resistor change with its value: two digits, then a multiplier.',
  ],
  controls: [
    { kind: 'slider', key: 'v', label: 'Voltage', min: 0, max: 12, initial: 5, step: 0.5, format: volts },
    { kind: 'slider', key: 'r', label: 'Resistance', min: 10, max: 1000, initial: 220, log: true, format: (v) => ohms(niceOhms(v)) },
  ],
  build(): Stage {
    const scene = circuitScene()
    const { electrons } = standardLoop(scene)
    const next = slot(scene)
    const rebuild = onChange(['r'], (p) => resistorAt(next(), n(p, 'r'), [W, 0, 0], true))
    return {
      scene,
      view: CIRCUIT_VIEW,
      frame(dt, p) {
        rebuild(p)
        electrons.step(dt * dotSpeed(n(p, 'v') / niceOhms(n(p, 'r')), 0.1))
      },
      readouts: (p) => [
        { label: 'Current', value: si(n(p, 'v') / niceOhms(n(p, 'r')), 'A') },
        { label: 'Voltage', value: volts(n(p, 'v')) },
        { label: 'Resistance', value: ohms(niceOhms(n(p, 'r'))) },
      ],
    }
  },
}

function bulb(): { group: THREE.Group; setGlow: (g: number) => void } {
  const group = new THREE.Group()
  const base = mat('#b9bec6', { metal: 0.45, rough: 0.35 })
  cylinder(group, 1.1, 1.8, base, [0, -2.1, 0], 'y', 24)
  for (let i = 0; i < 4; i++) {
    const t = add(group, mesh(new THREE.TorusGeometry(1.12, 0.12, 6, 24), base), [0, -2.8 + i * 0.45, 0])
    t.rotation.x = Math.PI / 2
  }
  cylinder(group, 0.5, 0.3, mat('#222'), [0, -3.1, 0], 'y', 16)
  const glass = mesh(
    new THREE.SphereGeometry(2.7, 40, 24),
    new THREE.MeshStandardMaterial({ color: '#f4f6ff', transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }),
  )
  glass.castShadow = false
  add(group, glass, [0, 1.5, 0])
  for (const s of [-1, 1]) rod(group, [s * 0.4, -1.2, 0], [s * 1.1, 1.6, 0], 0.07, STEEL())
  const filamentMat = new THREE.MeshStandardMaterial({ color: '#6b5a4a', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.4 })
  const filament = add(group, mesh(new THREE.TubeGeometry(new Helix(0.22, 2.2, 12), 160, 0.05, 6), filamentMat), [-1.1, 1.6, 0])
  filament.castShadow = false
  const light = new THREE.PointLight('#ffcf8a', 0, 60, 2)
  add(group, light, [0, 1.6, 0])
  return {
    group,
    setGlow(g) {
      filamentMat.emissiveIntensity = g * 6
      light.intensity = g * 500
    },
  }
}

const power: Lesson = {
  id: 'power',
  title: 'Power',
  tagline: 'Energy per second',
  formula: 'P = V · I = V² / R',
  points: [
    'Power is how fast energy is converted: 1 watt = 1 joule per second.',
    'The filament’s resistance turns electrical energy into heat; hot enough, it glows.',
    'Power grows with the square of voltage: double the voltage doubles the current too, so 4× the power.',
    'Every part has a power rating (¼ W for a small resistor). Exceed it and it overheats.',
  ],
  controls: [
    { kind: 'slider', key: 'v', label: 'Voltage', min: 0, max: 12, initial: 6, step: 0.5, format: volts },
    { kind: 'slider', key: 'r', label: 'Filament', min: 5, max: 100, initial: 12, log: true, format: (v) => ohms(niceOhms(v)) },
  ],
  build(): Stage {
    const scene = circuitScene()
    wire(scene, [LOOP[0], LOOP[1], LOOP[2], [W, -3.1, 0]])
    wire(scene, [[W, 4.2, 0], LOOP[3], LOOP[4], LOOP[5]])
    const c = cell(CELL_HALF * 2)
    c.position.set(-W, 0, 0)
    scene.add(c)
    const electrons = new Flow(path(LOOP, true))
    scene.add(electrons.mesh)
    conventionalArrows(scene)
    const b = bulb()
    b.group.position.set(W, 0, 0)
    scene.add(b.group)
    const watts = (p: Params) => n(p, 'v') ** 2 / niceOhms(n(p, 'r'))
    return {
      scene,
      view: CIRCUIT_VIEW,
      frame(dt, p) {
        b.setGlow(Math.sqrt(clamp01(watts(p) / 12)))
        electrons.step(dt * dotSpeed(n(p, 'v') / niceOhms(n(p, 'r')), 1))
      },
      readouts: (p) => [
        { label: 'Power', value: si(watts(p), 'W', 2) },
        { label: 'Current', value: si(n(p, 'v') / niceOhms(n(p, 'r')), 'A', 2) },
        { label: 'Energy per minute', value: si(watts(p) * 60, 'J', 2) },
      ],
    }
  },
}

const PAIR_V = 9

const seriesParallel: Lesson = {
  id: 'series-parallel',
  title: 'Series & parallel',
  tagline: 'Two ways to combine',
  formula: (p) => (p.mode === 'series' ? 'R = R₁ + R₂' : '1/R = 1/R₁ + 1/R₂'),
  points: [
    'Series: one path. The same current goes through both; the voltage is shared between them.',
    'Parallel: two paths. Each gets the full voltage; the current splits, more through the smaller resistor.',
    'Adding a parallel path always lowers the total resistance. That’s why too many appliances on one socket draw too much current.',
    'Watch the dot speeds: in parallel, the main wire carries the sum of both branches.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'mode',
      initial: 'series',
      options: [
        { value: 'series', label: 'Series' },
        { value: 'parallel', label: 'Parallel' },
      ],
    },
    { kind: 'slider', key: 'r1', label: 'R₁', min: 10, max: 1000, initial: 100, log: true, format: (v) => ohms(niceOhms(v)) },
    { kind: 'slider', key: 'r2', label: 'R₂', min: 10, max: 1000, initial: 330, log: true, format: (v) => ohms(niceOhms(v)) },
  ],
  build(): Stage {
    const scene = circuitScene()
    const c = cell(CELL_HALF * 2)
    c.position.set(-W, 0, 0)
    scene.add(c)
    const next = slot(scene)
    let flows: { flow: Flow; which: 'amps' | 'amps1' | 'amps2' }[] = []
    const result = (p: Params) => resistorPair(niceOhms(n(p, 'r1')), niceOhms(n(p, 'r2')), PAIR_V, p.mode as 'series' | 'parallel')
    const rebuild = onChange(['mode', 'r1', 'r2'], (p) => {
      const g = next()
      if (p.mode === 'series') {
        wire(g, LOOP)
        resistorAt(g, n(p, 'r1'), [0, H, 0], false)
        resistorAt(g, n(p, 'r2'), [W, 0, 0], true)
        flows = [{ flow: new Flow(path(LOOP, true)), which: 'amps' }]
        conventionalArrows(g)
      } else {
        const x = 2
        wire(g, LOOP)
        wire(g, [[x, -H, 0], [x, H, 0]])
        resistorAt(g, n(p, 'r1'), [x, 0, 0], true)
        resistorAt(g, n(p, 'r2'), [W, 0, 0], true)
        flows = [
          { flow: new Flow(path([[x, H, 0], [-W, H, 0], [-W, -H, 0], [x, -H, 0]])), which: 'amps' },
          { flow: new Flow(path([[x, -H, 0], [x, H, 0]])), which: 'amps1' },
          { flow: new Flow(path([[x, -H, 0], [W, -H, 0], [W, H, 0], [x, H, 0]])), which: 'amps2' },
        ]
        arrow(g, [-6, H + 1.6, 0], [1, 0, 0], CONVENTIONAL, 0.8)
        arrow(g, [-6, -H - 1.6, 0], [-1, 0, 0], CONVENTIONAL, 0.8)
      }
      flows.forEach((f) => g.add(f.flow.mesh))
    })
    return {
      scene,
      view: CIRCUIT_VIEW,
      frame(dt, p) {
        rebuild(p)
        const r = result(p)
        flows.forEach((f) => f.flow.step(dt * dotSpeed(r[f.which], 0.2)))
      },
      readouts: (p) => {
        const r = result(p)
        const rows = [
          { label: 'Total resistance', value: ohms(r.totalOhms) },
          { label: 'Total current', value: si(r.amps, 'A', 2) },
          { label: 'Through R₁ / R₂', value: `${si(r.amps1, 'A', 2)} / ${si(r.amps2, 'A', 2)}` },
        ]
        if (p.mode === 'series') rows.push({ label: 'Across R₁ / R₂', value: `${volts(r.volts1)} / ${volts(r.volts2)}` })
        else rows.push({ label: 'Across each', value: volts(PAIR_V) })
        return rows
      },
    }
  },
}

const CAP_F = 100e-6
const CAP_V = 9

const capacitor: Lesson = {
  id: 'capacitor',
  title: 'Capacitor',
  tagline: 'A bucket for charge',
  formula: 'τ = R · C',
  points: [
    'Two metal plates with an insulating gap. No charge crosses the gap.',
    'Charging moves electrons off one plate and piles them onto the other. The top plate is left + (red), the bottom − (blue).',
    'Current is strongest at first and fades as the plates fill: 63% charged after one τ, about full after 5τ.',
    'The energy is stored in the electric field across the gap (yellow). Discharge sends it back through the resistor.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'mode',
      initial: 'charge',
      options: [
        { value: 'charge', label: 'Charge' },
        { value: 'discharge', label: 'Discharge' },
      ],
    },
    { kind: 'slider', key: 'r', label: 'Resistor', min: 1000, max: 100000, initial: 22000, log: true, format: (v) => ohms(niceOhms(v)) },
  ],
  build(): Stage {
    const scene = circuitScene()
    const gap = 0.8
    const plateY = gap + 0.175
    wire(scene, [[W, plateY, 0], LOOP[3], LOOP[4], LOOP[5]])
    wire(scene, [LOOP[0], LOOP[1], LOOP[2], [W, -plateY, 0]])
    const battery = cell(CELL_HALF * 2)
    battery.position.set(-W, 0, 0)
    scene.add(battery)
    const bypass = new THREE.Group()
    wire(bypass, [LOOP[5], LOOP[0]])
    scene.add(bypass)
    const plate = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
    box(scene, [6, 0.35, 6], plate, [W, plateY, 0])
    box(scene, [6, 0.35, 6], plate, [W, -plateY, 0])

    const grid: [number, number][] = []
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) grid.push([-2.5 + i, -2.5 + j])
    const charges = (color: string, y: number) => {
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), glowMat(color, 1), grid.length)
      const m = new THREE.Matrix4()
      grid.forEach(([x, z], i) => im.setMatrixAt(i, m.makeTranslation(W + x, y, z)))
      im.count = 0
      scene.add(im)
      return im
    }
    const plus = charges(HOLE, gap - 0.15)
    const minus = charges(ELECTRON, -gap + 0.15)
    const field = new THREE.MeshStandardMaterial({ color: '#ffd84d', emissive: '#ffd84d', emissiveIntensity: 0.8, transparent: true, opacity: 0 })
    for (const x of [-2, 0, 2]) for (const z of [-2, 0, 2]) cylinder(scene, 0.05, gap * 2 - 0.3, field, [W + x, 0, z], 'y', 6).castShadow = false

    const next = slot(scene)
    const rebuild = onChange(['r'], (p) => resistorAt(next(), n(p, 'r'), [0, H, 0], false))
    const electrons = new Flow(path([[W, plateY, 0], LOOP[3], LOOP[4], LOOP[5], LOOP[0], LOOP[1], LOOP[2], [W, -plateY, 0]]))
    scene.add(electrons.mesh)

    let vc = 0
    let amps = 0
    return {
      scene,
      view: CIRCUIT_VIEW,
      frame(dt, p) {
        rebuild(p)
        const charging = p.mode === 'charge'
        battery.visible = charging
        bypass.visible = !charging
        const r = niceOhms(n(p, 'r'))
        const target = charging ? CAP_V : 0
        amps = (target - vc) / r
        vc = rcStep(vc, target, r * CAP_F, dt)
        const fill = vc / CAP_V
        plus.count = minus.count = Math.round(grid.length * fill)
        field.opacity = 0.9 * fill
        electrons.step(dt * dotSpeed(amps, CAP_V / 1000))
      },
      readouts: (p) => {
        const tau = niceOhms(n(p, 'r')) * CAP_F
        return [
          { label: 'Capacitor voltage', value: volts(vc) },
          { label: 'Current', value: si(Math.abs(amps), 'A', 2) },
          { label: 'τ = R × 100 µF', value: si(tau, 's', 2) },
          { label: 'Charged', value: `${Math.round((vc / CAP_V) * 100)}%` },
        ]
      },
    }
  },
}

const LED_R = 220

const diode: Lesson = {
  id: 'diode',
  title: 'Diode & LED',
  tagline: 'A one-way valve',
  formula: 'I = (V − V_f) / R',
  points: [
    'A diode lets current through one way only: anode (+, long leg) to cathode (−).',
    'It needs a minimum push, the forward voltage (≈2 V for red), before anything flows.',
    'Above that it barely resists, so a series resistor must limit the current.',
    'Flip the battery and the junction blocks: no current, no light. See “PN junction” for why.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'dir',
      initial: 'forward',
      options: [
        { value: 'forward', label: 'Forward' },
        { value: 'reverse', label: 'Reversed' },
      ],
    },
    { kind: 'slider', key: 'v', label: 'Battery', min: 0, max: 9, initial: 3.7, step: 0.1, format: volts },
  ],
  build(): Stage {
    const scene = circuitScene()
    const { battery, electrons } = standardLoop(scene, { arrows: false })
    resistorAt(scene, LED_R, [0, H, 0], false)
    const led = buildLed('#ff2a1a')
    led.scale.setScalar(1.8)
    led.rotation.y = Math.PI
    led.position.set(2, -H + 2.7, 0)
    scene.add(led)
    const reading = (p: Params) =>
      p.dir === 'forward'
        ? solveLedLoop({ supplyV: n(p, 'v'), ohms: LED_R, forwardVoltageV: 2.0, maxCurrentMA: 20 })
        : { currentMA: 0, brightness: 0, status: 'off' as const, reason: 'Reverse-biased: the junction blocks current' }
    return {
      scene,
      view: CIRCUIT_VIEW,
      frame(dt, p) {
        battery.rotation.z = p.dir === 'forward' ? 0 : Math.PI
        const r = reading(p)
        led.userData.setGlow(Math.sqrt(r.brightness))
        electrons.step(dt * dotSpeed(r.currentMA / 1000, 0.02))
      },
      readouts: (p) => {
        const r = reading(p)
        return [
          { label: 'Current', value: si(r.currentMA / 1000, 'A', 2), tone: r.status === 'lit' ? 'ok' : r.status === 'off' ? undefined : 'bad' },
          { label: 'Across resistor', value: volts((r.currentMA / 1000) * LED_R) },
          { label: 'Why', value: r.reason },
        ]
      },
    }
  },
}

export const ELECTRICITY: Lesson[] = [current, voltage, resistance, ohmsLaw, power, seriesParallel, capacitor, diode]
