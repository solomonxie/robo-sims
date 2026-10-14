import * as THREE from 'three/webgpu'
import { E_CHARGE, carrierCurrent, chargeFlowed, driftVelocity, electronsIn, electronsPerSecond } from '../../core/physics'
import { sci, si } from '../../core/units'
import { V3, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  ELECTRON,
  Flow,
  RING,
  arrow,
  bulb,
  cell,
  countingRing,
  glassTube,
  glowMat,
  path,
  plusGeometry,
  pointArrow,
  rand,
  randomDir,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const LENGTH = 24
const RADIUS = 3.2
const SPACING = 2 // copper lattice, drawn
const ELECTRONS = 70
const THERMAL = 5 // random speed, units/s
const DRIFT_PER_AMP = 2.2 // exaggerated: the real drift is ~10⁻¹⁰ of the thermal speed
const FLASH_S = 0.4

/** Copper ions on a regular grid, each vibrating about its own spot. */
function lattice(parent: THREE.Object3D) {
  const sites: THREE.Vector3[] = []
  for (let x = -LENGTH / 2 + SPACING / 2; x < LENGTH / 2; x += SPACING) {
    for (const y of [-SPACING, 0, SPACING]) {
      for (const z of [-SPACING, 0, SPACING]) if (Math.hypot(y, z) < RADIUS - 0.4) sites.push(new THREE.Vector3(x, y, z))
    }
  }
  const ions = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 20, 14), mat('#d08a4e', { metal: 0.25, rough: 0.45 }), sites.length)
  parent.add(ions)
  const phase = sites.map(() => [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)])
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  return (t: number) => {
    sites.forEach((s, i) => {
      const [a, b, c] = phase[i]
      p.set(s.x + 0.07 * Math.sin(t * 9 + a), s.y + 0.07 * Math.sin(t * 11 + b), s.z + 0.07 * Math.sin(t * 10 + c))
      ions.setMatrixAt(i, m.makeTranslation(p))
    })
    ions.instanceMatrix.needsUpdate = true
  }
}

/** Free electrons: random thermal motion, plus a shared drift; flash when crossing the ring at x = 0. */
function electronGas(parent: THREE.Object3D) {
  const pos = Array.from({ length: ELECTRONS }, () => {
    const a = rand(0, Math.PI * 2)
    const r = Math.sqrt(Math.random()) * (RADIUS - 0.3)
    return new THREE.Vector3(rand(-LENGTH / 2, LENGTH / 2), Math.cos(a) * r, Math.sin(a) * r)
  })
  const vel = pos.map(() => randomDir(THERMAL))
  const flash = pos.map(() => 0)
  // Unlit, so the per-electron color (blue, or yellow at the ring) is exactly what shows.
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.27, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), ELECTRONS)
  dots.frustumCulled = false
  parent.add(dots)

  const base = new THREE.Color(ELECTRON)
  const hit = new THREE.Color(RING)
  const color = new THREE.Color()
  const m = new THREE.Matrix4()

  return (dt: number, drift: number) => {
    for (let i = 0; i < ELECTRONS; i++) {
      const p = pos[i]
      const v = vel[i]
      if (Math.random() < dt * 4) v.copy(randomDir(THERMAL)) // a collision scatters it
      const before = p.x
      p.x += (v.x - drift) * dt
      p.y += v.y * dt
      p.z += v.z * dt
      if (Math.sign(before) !== Math.sign(p.x) && Math.abs(p.x) < 1) flash[i] = FLASH_S
      if (p.x < -LENGTH / 2) p.x += LENGTH
      if (p.x > LENGTH / 2) p.x -= LENGTH
      const r = Math.hypot(p.y, p.z)
      if (r > RADIUS - 0.3) {
        p.y *= (RADIUS - 0.3) / r
        p.z *= (RADIUS - 0.3) / r
        v.y = -v.y
        v.z = -v.z
      }
      flash[i] = Math.max(0, flash[i] - dt)
      dots.setMatrixAt(i, m.makeTranslation(p))
      dots.setColorAt(i, color.copy(base).lerp(hit, flash[i] / FLASH_S))
    }
    dots.instanceMatrix.needsUpdate = true
    dots.instanceColor!.needsUpdate = true
  }
}

export const whatFlows: Lesson = {
  id: 'current-what-flows-in-a-wire',
  title: 'Current',
  tagline: 'Charge on the move',
  formula: 'I = Q / t',
  legend: [
    { color: ELECTRON, label: 'Free electron', shape: 'dot' },
    { color: '#d08a4e', label: 'Copper ion (+)', shape: 'dot' },
    { color: ELECTRON, label: 'Electron drift', shape: 'arrow-left' },
    { color: CONVENTIONAL, label: 'Conventional current', shape: 'arrow-right' },
  ],
  points: [
    'Copper is a fixed lattice of atoms, each giving up one electron to a shared “gas” of free electrons.',
    'At 0 A the electrons still race around at random. They cross the yellow ring both ways equally, so no charge flows on balance.',
    'Push with a voltage and the whole gas drifts one way. Current is the net charge crossing the ring each second: 1 A = 1 coulomb/s ≈ 6.24 × 10¹⁸ electrons.',
    'The drift is slow: under a tenth of a millimetre per second at 1 A in a 1 mm² wire. It’s hugely exaggerated here. A lamp still lights instantly because the push travels down the wire at near light speed.',
    'Current is drawn flowing + → − (orange), opposite to the electrons. That convention predates the electron’s discovery.',
  ],
  controls: [{ kind: 'slider', key: 'amps', label: 'Current', min: 0, max: 3, initial: 1, step: 0.1, format: (v) => si(v, 'A', 2) }],
  build(): Stage {
    const scene = createStage({ span: 20 })
    glassTube(scene, LENGTH, RADIUS)
    countingRing(scene, RADIUS)
    const vibrate = lattice(scene)
    const move = electronGas(scene)
    const eArrow = arrow(scene, [0, RADIUS + 2.2, 0], [-1, 0, 0], ELECTRON, 1.3)
    const iArrow = arrow(scene, [0, -RADIUS - 2.2, 0], [1, 0, 0], CONVENTIONAL, 1.3)
    let t = 0
    return {
      scene,
      view: { center: [0, 2.6, 0], radius: 46, polar: 1.32, azimuth: 0.2 },
      frame(dt, p) {
        t += dt
        const amps = n(p, 'amps')
        eArrow.visible = iArrow.visible = amps > 0
        vibrate(t)
        move(dt, amps * DRIFT_PER_AMP)
      },
      readouts: (p) => {
        const amps = n(p, 'amps')
        return [
          { label: 'Current', value: si(amps, 'A', 2) },
          { label: 'Electrons per second', value: sci(electronsPerSecond(amps)) },
          { label: 'Real drift (1 mm² wire)', value: si(driftVelocity(amps, 1e-6), 'm/s', 2) },
        ]
      },
    }
  },
}

// --- Conventional vs electron flow: one loop, two equivalent stories. ---

const W = 12
const H = 7
const CELL_HALF = 2.5
const LANE = 0.6 // electrons ride just outside the wire, + charges just inside
const LOOP_SPEED = 3
const AREA = 1e-6 // 1 mm² wire
const LOOP_AMPS = 1

/** Around the loop out of the cell's bottom terminal, back into its top, at `inset` from the wire. */
function loopPoints(inset: number): V3[] {
  const w = W - inset
  const h = H - inset
  return [
    [-w, -CELL_HALF, 0],
    [-w, -h, 0],
    [w, -h, 0],
    [w, h, 0],
    [-w, h, 0],
    [-w, CELL_HALF, 0],
  ]
}

type Show = 'both' | 'electron' | 'conventional'

function loopReadouts(p: Params) {
  const v = driftVelocity(LOOP_AMPS, AREA)
  const flipped = p.battery === 'flipped'
  const iWay = flipped ? 'Anticlockwise' : 'Clockwise'
  const eWay = flipped ? 'Clockwise' : 'Anticlockwise'
  const fromElectrons = si(carrierCurrent(-E_CHARGE, -v, AREA), 'A', 3)
  const fromPlus = si(carrierCurrent(E_CHARGE, v, AREA), 'A', 3)
  if (p.show === 'electron')
    return [
      { label: 'Charge q', value: `${sci(-E_CHARGE)} C` },
      { label: 'Drift v (along I)', value: si(-v, 'm/s', 3) },
      { label: 'Current I', value: fromElectrons },
    ]
  if (p.show === 'conventional')
    return [
      { label: 'Charge q', value: `+${sci(E_CHARGE)} C` },
      { label: 'Drift v (along I)', value: si(v, 'm/s', 3) },
      { label: 'Current I', value: fromPlus },
    ]
  return [
    { label: 'Current', value: iWay },
    { label: 'Electrons', value: eWay },
    { label: 'Same current', value: `${fromElectrons} = ${fromPlus}` },
  ]
}

export const conventionalVsElectron: Lesson = {
  id: 'current-conventional-vs-electron-flow',
  title: 'Conventional vs electron flow',
  tagline: 'Two arrows, one current',
  formula: (p) =>
    p.show === 'electron' ? 'I = n(−q)(−v)A' : p.show === 'conventional' ? 'I = n(+q)(+v)A' : '(−q)(−v) = (+q)(+v)',
  legend: [
    { color: ELECTRON, label: 'Electron (−)', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Positive charge (+)', shape: 'dot' },
    { color: ELECTRON, label: 'Electron flow', shape: 'arrow-left' },
    { color: CONVENTIONAL, label: 'Conventional current', shape: 'arrow-right' },
  ],
  points: [
    'In a metal wire only electrons move. They leave the battery’s − end, go round the loop and return to its + end.',
    'Conventional current is drawn the other way: out of +, round the loop, into −. Franklin picked that direction in the 1700s, before anyone knew which charge moved.',
    'Both stories give the same current. A negative charge going backwards moves charge exactly like a positive charge going forwards: (−q)(−v) = (+q)(+v).',
    'Circuit symbols, diode arrows and every formula use conventional current, so that is the arrow to think in. Electron flow matters when picturing what happens inside the metal.',
    'Flip the battery and both reverse. The bulb doesn’t care which way, but a diode or LED would.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'show',
      options: [
        { value: 'both', label: 'Both' },
        { value: 'electron', label: 'Electrons' },
        { value: 'conventional', label: 'Conventional' },
      ],
      initial: 'both',
    },
    {
      kind: 'choice',
      key: 'battery',
      options: [
        { value: 'normal', label: '+ on top' },
        { value: 'flipped', label: 'Flipped' },
      ],
      initial: 'normal',
    },
  ],
  build(): Stage {
    const scene = createStage({ deskY: -H - 3, span: 22 })
    const loop = loopPoints(0)
    wire(scene, [loop[0], loop[1], loop[2], [W, -3.1, 0]])
    wire(scene, [[W, 4.2, 0], loop[3], loop[4], loop[5]])
    const battery = cell(CELL_HALF * 2)
    battery.position.set(-W, 0, 0)
    scene.add(battery)
    const lamp = bulb()
    lamp.group.position.set(W, 0, 0)
    scene.add(lamp.group)
    lamp.setGlow(0.8)

    const electrons = new Flow(path(loopPoints(-LANE), true), 1.6, ELECTRON, 0.3)
    const charges = new Flow(path(loopPoints(LANE), true), 1.6, CONVENTIONAL, 0.3, plusGeometry(0.75))
    scene.add(electrons.mesh, charges.mesh)

    // Conventional direction with + on top (clockwise); orange arrows inside the loop, blue outside.
    const marks: [inside: V3, outside: V3, dir: V3][] = [
      [[0, H - 1.6, 0], [0, H + 1.6, 0], [1, 0, 0]],
      [[0, -H + 1.6, 0], [0, -H - 1.6, 0], [-1, 0, 0]],
      [[-W + 1.6, -4.8, 0], [-W - 1.6, -4.8, 0], [0, 1, 0]],
    ]
    const iArrows = marks.map(([at, , dir]) => ({ a: arrow(scene, at, dir, CONVENTIONAL, 0.8), dir }))
    const eArrows = marks.map(([, at, dir]) => ({ a: arrow(scene, at, dir, ELECTRON, 0.8), dir }))

    return {
      scene,
      view: { center: [1, 1.5, 0], radius: 56, polar: 1.3, azimuth: 0.15 },
      frame(dt, p) {
        const show = p.show as Show
        const sign = p.battery === 'flipped' ? -1 : 1
        battery.rotation.z = sign > 0 ? 0 : Math.PI
        electrons.mesh.visible = show !== 'conventional'
        charges.mesh.visible = show !== 'electron'
        electrons.step(dt * LOOP_SPEED * sign)
        charges.step(-dt * LOOP_SPEED * sign)
        for (const { a, dir } of iArrows) {
          a.visible = show !== 'electron'
          pointArrow(a, [dir[0] * sign, dir[1] * sign, 0])
        }
        for (const { a, dir } of eArrows) {
          a.visible = show !== 'conventional'
          pointArrow(a, [-dir[0] * sign, -dir[1] * sign, 0])
        }
      },
      readouts: loopReadouts,
    }
  },
}

// --- Amps and the coulomb: count charge through the ring, stack a coin per coulomb. ---

const TUBE_Y = 4
const TUBE_LENGTH = 24
const TUBE_RADIUS = 1.8
const PER_COULOMB = 2.4 // units of drift per coulomb; TUBE_LENGTH holds exactly 10
const STACK = 10
const COIN_H = 0.56
const COIN_GAP = 0.2
const STACK_BASE = -8.5
const DROP_S = 0.35
const DROP_FROM = TUBE_Y - TUBE_RADIUS

const coinY = (k: number) => STACK_BASE + COIN_H / 2 + k * (COIN_H + COIN_GAP)

export const ampsAndCoulomb: Lesson = {
  id: 'current-amps-and-the-coulomb',
  title: 'Amps and the coulomb',
  tagline: 'Counting charge per second',
  formula: 'Q = I × t',
  legend: [
    { color: ELECTRON, label: '1 C of electrons', shape: 'dot' },
    { color: RING, label: '1 C counted', shape: 'dot' },
    { color: ELECTRON, label: 'Electron drift', shape: 'arrow-left' },
    { color: CONVENTIONAL, label: 'Current', shape: 'arrow-right' },
  ],
  points: [
    'A coulomb (C) is a fixed amount of charge: about 6.24 × 10¹⁸ electrons’ worth. Each blue ball here stands for one coulomb.',
    'An ampere is one coulomb per second through the ring. At 1 A a ball crosses every second and a coin drops onto the stack.',
    'Charge adds up as Q = I × t. Double the current and the stack fills twice as fast: 2 A for 5 s moves the same 10 C as 1 A for 10 s.',
    'Battery capacity is charge too. 1 mAh is 1 mA for an hour, which is 3.6 C, so a 2000 mAh cell holds 7200 C.',
  ],
  controls: [{ kind: 'slider', key: 'amps', label: 'Current', min: 0.1, max: 5, initial: 1, log: true, format: (v) => si(v, 'A', 2) }],
  build(): Stage {
    const scene = createStage({ span: 20 })
    const tube = new THREE.Group()
    tube.position.y = TUBE_Y
    scene.add(tube)
    glassTube(tube, TUBE_LENGTH, TUBE_RADIUS)
    const ring = countingRing(tube, TUBE_RADIUS)
    const balls = new Flow(path([[TUBE_LENGTH / 2, 0, 0], [-TUBE_LENGTH / 2, 0, 0]]), PER_COULOMB, ELECTRON, 0.75)
    tube.add(balls.mesh)
    arrow(scene, [-6, TUBE_Y + TUBE_RADIUS + 1.8, 0], [-1, 0, 0], ELECTRON, 1.1)
    arrow(scene, [-6, TUBE_Y - TUBE_RADIUS - 1.8, 0], [1, 0, 0], CONVENTIONAL, 1.1)

    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, STACK * (COIN_H + COIN_GAP) + 0.3, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: '#cfd6e6', transparent: true, opacity: 0.08, roughness: 0.1, depthWrite: false }),
    )
    jar.position.y = STACK_BASE + (STACK * (COIN_H + COIN_GAP) + 0.3) / 2
    jar.castShadow = false
    scene.add(jar)
    cylinder(scene, 2.8, 0.4, mat('#2b2e36', { rough: 0.8 }), [0, STACK_BASE - 0.2, 0], 'y', 48)
    const coinGeo = new THREE.CylinderGeometry(1.8, 1.8, COIN_H, 40)
    const coinMat = glowMat(RING, 0.35)
    const coins = Array.from({ length: STACK }, (_, k) => {
      const c = new THREE.Mesh(coinGeo, coinMat)
      c.position.y = coinY(k)
      c.visible = false
      c.castShadow = true
      scene.add(c)
      return c
    })
    const drops = coins.map(() => DROP_S)

    let t = 0
    let amps = NaN
    let stacked = 0
    let pulse = 0
    const charge = () => chargeFlowed(amps, t)

    return {
      scene,
      view: { center: [0, 0, 0], radius: 50, polar: 1.25, azimuth: 0.2 },
      frame(dt, p) {
        const a = n(p, 'amps')
        if (a !== amps) {
          amps = a
          t = 0
          stacked = 0
          coins.forEach((c) => (c.visible = false))
        }
        t += dt
        while (charge() > STACK + 1) t -= STACK / amps
        balls.moveTo(charge() * PER_COULOMB)
        const whole = Math.min(STACK, Math.floor(charge()))
        if (whole !== stacked) {
          if (whole < stacked) coins.forEach((c) => (c.visible = false))
          for (let k = whole < stacked ? 0 : stacked; k < whole; k++) {
            coins[k].visible = true
            drops[k] = 0
          }
          stacked = whole
          pulse = 1
        }
        coins.forEach((c, k) => {
          drops[k] = Math.min(DROP_S, drops[k] + dt)
          const f = drops[k] / DROP_S
          c.position.y = DROP_FROM + (coinY(k) - DROP_FROM) * f * f
        })
        pulse = Math.max(0, pulse - dt * 3)
        ring.emissiveIntensity = 0.9 + 2.5 * pulse
      },
      readouts: (p) => {
        const a = n(p, 'amps')
        const q = a === amps ? charge() : 0
        return [
          { label: 'Current', value: si(a, 'A', 2) },
          { label: 'Time t', value: si(a === amps ? t : 0, 's', 3) },
          { label: 'Charge Q = I·t', value: si(q, 'C', 3) },
          { label: 'Electrons', value: sci(electronsIn(q)) },
        ]
      },
    }
  },
}
