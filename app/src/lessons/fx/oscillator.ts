import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh } from '../../models/kit'
import { GREY, potentialColor } from './colors'

const CAN_W = 4.35
const CAN_D = 1.83
const CAN_H = 5.3
const BASE_H = 0.45
const PIN_X = 0.96
const LEG = 1.6
const BLANK_R = 1.55
const BLANK_T = 0.24
const BLANK_Y = 3
const ELECTRODE_R = 0.95
const SHEAR = 0.24

function stadium(w: number, d: number) {
  const r = d / 2
  const c = w / 2 - r
  const s = new THREE.Shape()
  s.absarc(c, 0, r, -Math.PI / 2, Math.PI / 2, false)
  s.absarc(-c, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false)
  return s
}

function stadiumSolid(w: number, d: number, h: number, hole = 0) {
  const s = stadium(w, d)
  if (hole) s.holes.push(new THREE.Path(stadium(w - 2 * hole, d - 2 * hole).getPoints(24)))
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 16 }).rotateX(-Math.PI / 2)
}

/** Cut-open HC-49/U crystal (11 × 4.7 × 13.5 mm can) standing on its legs, `scale` × the real part, centred on its quartz
 *  blank at `at`. The disc is held edge-on by two spring clips, a silver electrode on each face. `set(strain, volts)`:
 *  strain −1..1 shears the faces against each other and flexes the disc (thickness-shear, hugely exaggerated); volts −1..1
 *  tints the electrodes by potential, front against back. `legs` are the lead tips. */
export function hc49Crystal(parent: THREE.Object3D, at: V3, { scale = 1 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const body = add(group, new THREE.Group(), [0, -BLANK_Y, 0])
  const steel = mat('#c9cdd4', { metal: 0.4, rough: 0.35 })
  const shell = new THREE.MeshStandardMaterial({ color: '#d6dae2', metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.13, depthWrite: false })
  add(body, mesh(stadiumSolid(CAN_W, CAN_D, CAN_H - BASE_H, 0.06), shell), [0, BASE_H, 0]).castShadow = false
  add(body, mesh(stadiumSolid(CAN_W, CAN_D, 0.06), shell), [0, CAN_H - 0.06, 0]).castShadow = false
  add(body, mesh(stadiumSolid(CAN_W + 0.16, CAN_D + 0.16, BASE_H), steel))
  const seal = mat('#7fa59a', { rough: 0.3 })
  for (const s of [-1, 1]) {
    cylinder(body, 0.2, 0.08, seal, [s * PIN_X, BASE_H + 0.04, 0], 'y', 16)
    lead(body, [[s * PIN_X, -LEG, 0], [s * PIN_X, BASE_H + 0.6, 0], [s * (BLANK_R + 0.1), BLANK_Y - 1, 0], [s * (BLANK_R + 0.1), BLANK_Y, 0]], 0.07, steel)
    box(body, [0.22, 0.7, 0.42], steel, [s * (BLANK_R + 0.04), BLANK_Y, 0])
  }

  const blank = add(group, new THREE.Group())
  const geo = new THREE.CylinderGeometry(BLANK_R, BLANK_R, BLANK_T, 56, 1).rotateX(Math.PI / 2)
  const rest = Float32Array.from(geo.attributes.position.array)
  const quartz = new THREE.MeshStandardMaterial({ color: '#e6eef5', roughness: 0.15, transparent: true, opacity: 0.62, emissive: '#7fc4ff', emissiveIntensity: 0 })
  add(blank, mesh(geo, quartz))
  const electrodes = [1, -1].map((side) => {
    const m = new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.4, roughness: 0.3, emissive: '#000000' })
    const e = cylinder(blank, ELECTRODE_R, 0.03, m, [0, 0, side * (BLANK_T / 2 + 0.015)], 'z', 40)
    box(e, [BLANK_R - ELECTRODE_R + 0.15, 0.03, 0.2], m, [-side * (ELECTRODE_R + (BLANK_R - ELECTRODE_R) / 2), 0, 0])
    return { e, m, side }
  })

  const legs: [V3, V3] = [-1, 1].map((s) => [at[0] + s * PIN_X * scale, at[1] - (BLANK_Y + LEG) * scale, at[2]] as V3) as [V3, V3]
  const color = new THREE.Color()
  return {
    group,
    legs,
    set(strain: number, volts: number) {
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const x = rest[3 * i]
        const y = rest[3 * i + 1]
        const z = rest[3 * i + 2]
        const w = Math.max(0, 1 - (x * x + y * y) / (BLANK_R * BLANK_R))
        pos.setXYZ(i, x + SHEAR * strain * w * (2 * z) / BLANK_T, y, z + 0.4 * SHEAR * strain * w)
      }
      pos.needsUpdate = true
      geo.computeVertexNormals()
      quartz.emissiveIntensity = 0.35 * Math.abs(strain)
      for (const { e, m, side } of electrodes) {
        e.position.x = 0.8 * SHEAR * strain * side
        e.position.z = side * (BLANK_T / 2 + 0.015) + 0.4 * SHEAR * strain
        m.emissive.copy(potentialColor(0.5 + 0.5 * side * volts, color))
        m.emissiveIntensity = 0.9 * Math.abs(volts)
      }
    },
  }
}

/** Clock face facing +z at `at`: 12 ticks, bright hands in `color` and grey ghost hands for the true time.
 *  `set(shown, truth)` takes seconds after 12:00:00 for each. */
export function clockFace(parent: THREE.Object3D, at: V3, r: number, color: string) {
  const group = add(parent, new THREE.Group(), at)
  cylinder(group, r + 0.35, 0.5, mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.3], 'z', 64)
  cylinder(group, r, 0.1, mat('#e9e6dc', { rough: 0.7 }), [0, 0, 0], 'z', 64)
  const ink = mat('#2b2d33')
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * 2 * Math.PI
    const big = k % 5 === 0
    const tick = box(group, [big ? 0.16 : 0.06, big ? 0.7 : 0.3, 0.05], ink, [Math.sin(a) * (r - (big ? 0.5 : 0.3)), Math.cos(a) * (r - (big ? 0.5 : 0.3)), 0.08])
    tick.rotation.z = -a
  }
  const hand = (len: number, width: number, material: THREE.Material, z: number) => {
    const g = add(group, new THREE.Group(), [0, 0, z])
    box(g, [width, len + 0.4, 0.06], material, [0, len / 2 - 0.2, 0]).castShadow = false
    return g
  }
  const ghost = new THREE.MeshStandardMaterial({ color: GREY, transparent: true, opacity: 0.55, depthWrite: false })
  const bright = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 })
  const dark = mat('#1d1f24')
  const sets = [
    [hand(0.5 * r, 0.32, ghost, 0.14), hand(0.78 * r, 0.22, ghost, 0.18), hand(0.9 * r, 0.1, ghost, 0.22)],
    [hand(0.5 * r, 0.3, dark, 0.26), hand(0.78 * r, 0.2, dark, 0.3), hand(0.9 * r, 0.09, bright, 0.34)],
  ]
  cylinder(group, 0.22, 0.5, bright, [0, 0, 0.3], 'z', 20)
  const turn = (hands: THREE.Group[], s: number) => {
    const [h, m, sec] = hands
    h.rotation.z = (-2 * Math.PI * s) / 43200
    m.rotation.z = (-2 * Math.PI * s) / 3600
    sec.rotation.z = (-2 * Math.PI * s) / 60
  }
  return {
    group,
    set(shown: number, truth: number) {
      turn(sets[1], shown)
      turn(sets[0], truth)
    },
  }
}
