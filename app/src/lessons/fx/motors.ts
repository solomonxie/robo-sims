// Motors cut open: brushed DC motor (magnets, 3-slot armature, commutator and brushes), spur gear train.
import * as THREE from 'three/webgpu'
import { coilShares } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { HIGH_V, LOW_V, NORTH, SOUTH } from './colors'
import { heatGlow } from './heat'
import { partLetter } from './parts'

/** Ring sector in the xy plane (inner r0, outer r1, centred on angle `mid`, `span` wide), extruded `depth` along +z. */
export function sectorGeometry(r0: number, r1: number, mid: number, span: number, depth: number) {
  const a0 = mid - span / 2
  const a1 = mid + span / 2
  const s = new THREE.Shape()
  s.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0))
  s.absarc(0, 0, r1, a0, a1, false)
  s.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1))
  s.absarc(0, 0, r0, a1, a0, true)
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 20 })
}

const TAU = Math.PI * 2

const tint = (m: THREE.MeshStandardMaterial, color: string, k: number) => {
  m.emissive.set(color)
  m.emissiveIntensity = k
}

/** Brushed DC motor facing +z with its front cap off, rotor radius `r`: ferrite magnets N (left) and S (right) in a steel
 *  can, a 3-slot laminated armature with copper coils, a 3-segment commutator in front and carbon brushes top (+) and
 *  bottom (−). `set(angle, level, heat)`: rotor turned clockwise by `angle`; coils glow N/S by their share of the current
 *  (`level` 0..1), or red-hot when `heat` > 0; the brushes and the segments under them light up. `pins` = [+, −] leads. */
export function brushedMotor(parent: THREE.Object3D, at: V3, r = 2) {
  const group = add(parent, new THREE.Group(), at)
  const L = 1.4 * r
  const can = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide })
  add(group, mesh(new THREE.CylinderGeometry(1.45 * r, 1.45 * r, 1.8 * r, 48, 1, true), can)).rotation.x = Math.PI / 2
  cylinder(group, 1.45 * r, 0.1, mat('#3a3d44', { rough: 0.6 }), [0, 0, -0.9 * r], 'z', 48)
  for (const [mid, color, name] of [[Math.PI, NORTH, 'N'], [0, SOUTH, 'S']] as const) {
    add(group, mesh(sectorGeometry(1.08 * r, 1.42 * r, mid, 1.9, L), mat(color, { rough: 0.55, emissive: color === NORTH ? '#3a0d0a' : '#0c1a40' })), [0, 0, -L / 2])
    partLetter(group, name, [1.25 * r * Math.cos(mid), 0, L / 2 + 0.05], 0.4 * r, '#ffffff')
  }

  const rotor = add(group, new THREE.Group())
  const iron = mat('#6f757e', { metal: 0.3, rough: 0.45 })
  cylinder(rotor, 0.26 * r, L, iron, [0, 0, 0], 'z', 24)
  const coils = [0, 1, 2].map((k) => {
    const a = (TAU * k) / 3
    const arm = add(rotor, new THREE.Group())
    arm.rotation.z = a
    box(arm, [0.62 * r, 0.26 * r, L], iron, [0.5 * r, 0, 0])
    add(rotor, mesh(sectorGeometry(0.8 * r, r, a, 1.45, L), iron), [0, 0, -L / 2])
    const m = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.4 })
    box(arm, [0.4 * r, 0.5 * r, L + 0.28 * r], m, [0.52 * r, 0, 0])
    return m
  })
  const zc = L / 2 + 0.5 * r
  const segs = [0, 1, 2].map((k) => {
    const m = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.35 })
    add(rotor, mesh(sectorGeometry(0.12 * r, 0.32 * r, (TAU * k) / 3 + Math.PI / 3, 1.75, 0.4 * r), m), [0, 0, zc - 0.2 * r])
    return m
  })
  rod(rotor, [0, 0, -1.05 * r], [0, 0, zc + 1.1 * r], 0.08 * r, STEEL())

  const brushMats = [HIGH_V, LOW_V].map((c, i) => {
    const s = i ? -1 : 1
    const m = new THREE.MeshStandardMaterial({ color: '#2d2e33', roughness: 0.8 })
    box(group, [0.24 * r, 0.36 * r, 0.26 * r], m, [0, s * 0.5 * r, zc])
    box(group, [0.08 * r, 0.9 * r, 0.3 * r], mat('#c9a14a', { metal: 0.4, rough: 0.35 }), [0, s * 1.1 * r, zc])
    return { m, c }
  })
  const pins: V3[] = [1, -1].map((s): V3 => [at[0], at[1] + s * 1.55 * r, at[2] + zc])

  return {
    group,
    rotor,
    pins,
    /** Front of the shaft, local coordinates. */
    shaftTip: [0, 0, zc + 1.1 * r] as V3,
    set(angle: number, level: number, heat = 0) {
      rotor.rotation.z = -angle
      const th = rotor.rotation.z
      coilShares(th).forEach((f, k) => (heat > 0 ? heatGlow(coils[k], heat) : tint(coils[k], f > 0 ? NORTH : SOUTH, 0.15 + Math.abs(f) * level * 2.4)))
      const mids = [0, 1, 2].map((k) => Math.sin(th + (TAU * k) / 3 + Math.PI / 3))
      const top = mids.indexOf(Math.max(...mids))
      const bottom = mids.indexOf(Math.min(...mids))
      segs.forEach((m, k) => tint(m, k === top ? HIGH_V : LOW_V, k === top || k === bottom ? level : 0))
      for (const b of brushMats) tint(b.m, b.c, level * 0.8)
    },
  }
}

/** Spur gear in the xy plane (axis z) with `teeth` of module `mod`: pitch radius = mod·teeth / 2. */
export function spurGear(parent: THREE.Object3D, teeth: number, mod: number, width: number, material: THREE.Material) {
  const g = add(parent, new THREE.Group())
  const rp = (mod * teeth) / 2
  cylinder(g, rp - 0.6 * mod, width, material, [0, 0, 0], 'z', Math.max(24, teeth * 2))
  const t = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6 * mod, 1.5 * mod, width), material, teeth)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const z = new THREE.Vector3(0, 0, 1)
  const one = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU
    t.setMatrixAt(i, m.compose(new THREE.Vector3(rp * Math.cos(a), rp * Math.sin(a), 0), q.setFromAxisAngle(z, a), one))
  }
  t.castShadow = true
  g.add(t)
  return g
}

const PINION = 10

/** Face-on train of compound spur stages along +x from `at` (axes along z, each stage one gear-width nearer the viewer),
 *  pinions of 10 teeth. `set(motorAngle)` turns every shaft at its ratio; `shafts` = x of each shaft (last = output). */
export function gearTrain(parent: THREE.Object3D, at: V3, stages: number[], { mod = 0.25, width = 0.7 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const plastic = mat('#f1efe6', { rough: 0.55 })
  const brass = mat('#d9b24a', { metal: 0.35, rough: 0.4 })
  const xs = [0]
  stages.forEach((n) => xs.push(xs[xs.length - 1] + (mod * PINION * (1 + n)) / 2))
  const shafts = xs.map((x) => add(group, new THREE.Group(), [x, 0, 0]))
  const ratios = [1]
  stages.forEach((n, k) => {
    ratios.push(ratios[k] * n)
    spurGear(shafts[k], PINION, mod, width, brass).position.z = k * width
    const big = spurGear(shafts[k + 1], PINION * n, mod, width, plastic)
    big.position.z = k * width
    big.rotation.z = Math.PI / (PINION * n)
  })
  const front = stages.length * width + 0.6
  for (const s of shafts) rod(s, [0, 0, -width], [0, 0, front], 0.12, STEEL())
  const flag = add(shafts[shafts.length - 1], new THREE.Group(), [0, 0, front])
  box(flag, [1.6, 0.35, 0.12], mat('#d23b3b', { rough: 0.5 }), [0.5, 0, 0])
  return {
    group,
    shafts: xs.map((x) => x + at[0]),
    /** Biggest gear radius, for framing. */
    radius: Math.max(mod * PINION, ...stages.map((n) => (mod * PINION * n) / 2)),
    set(motorAngle: number) {
      shafts.forEach((s, k) => (s.rotation.z = ((k % 2 ? 1 : -1) * motorAngle) / ratios[k]))
    },
  }
}
