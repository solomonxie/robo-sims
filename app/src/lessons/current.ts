import * as THREE from 'three/webgpu'
import { driftVelocity, electronsPerSecond } from '../core/physics'
import { sci, si } from '../core/units'
import { add, mat, mesh } from '../models/kit'
import { createStage } from '../scene/stage'
import { CONVENTIONAL, ELECTRON, arrow, glowMat, rand, randomDir } from './fx'
import { Lesson, Stage, n } from './types'

const LENGTH = 24
const RADIUS = 3.2
const SPACING = 2 // copper lattice, drawn
const ELECTRONS = 70
const THERMAL = 5 // random speed, units/s
const DRIFT_PER_AMP = 2.2 // exaggerated: the real drift is ~10⁻¹⁰ of the thermal speed
const FLASH_S = 0.4
const RING = '#ffd84d'

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

function wire(parent: THREE.Object3D) {
  const glass = mesh(
    new THREE.CylinderGeometry(RADIUS, RADIUS, LENGTH, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f0c090', transparent: true, opacity: 0.07, roughness: 0.1, side: THREE.FrontSide, depthWrite: false }),
  )
  glass.rotation.z = Math.PI / 2
  glass.castShadow = false
  parent.add(glass)
  for (const s of [-1, 1]) {
    const rim = add(parent, mesh(new THREE.TorusGeometry(RADIUS, 0.1, 10, 64), mat('#c8803f', { metal: 0.4, rough: 0.3 })), [(s * LENGTH) / 2, 0, 0])
    rim.rotation.y = Math.PI / 2
  }

  // The cross-section that current is counted through.
  const ring = add(parent, mesh(new THREE.TorusGeometry(RADIUS + 0.25, 0.12, 12, 64), glowMat(RING, 0.9)))
  ring.rotation.y = Math.PI / 2
  const disc = mesh(
    new THREE.CircleGeometry(RADIUS + 0.2, 64),
    new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  )
  disc.rotation.y = Math.PI / 2
  disc.castShadow = false
  parent.add(disc)
}

export const current: Lesson = {
  id: 'current',
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
    wire(scene)
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
