// Ball bearings (face-on, open, spinning; or in section) and plain-bushing rings, `k` scene units per mm.
import * as THREE from 'three/webgpu'
import { V3, add, mat, mesh } from '../../models/kit'

const RACE_STEEL = () => mat('#d3d8e0', { metal: 0.3, rough: 0.35 })
export const BRONZE = () => mat('#b9803f', { metal: 0.6, rough: 0.4 })

export interface BearingLook {
  d: number
  D: number
  B: number
  balls: number
  ball: number
}

/** Flat ring facing +z (axis along z), radii `rIn`…`rOut`, `w` deep, centred on z = 0. */
export function ringTube(parent: THREE.Object3D, rIn: number, rOut: number, w: number, m: THREE.Material, at: V3 = [0, 0, 0]) {
  const profile = [new THREE.Vector2(rIn, -w / 2), new THREE.Vector2(rOut, -w / 2), new THREE.Vector2(rOut, w / 2), new THREE.Vector2(rIn, w / 2), new THREE.Vector2(rIn, -w / 2)]
  const ring = add(parent, mesh(new THREE.LatheGeometry(profile, 48), m), at)
  ring.rotation.x = Math.PI / 2
  return ring
}

/** Open deep-groove bearing seen face-on; `set(inner, cage, ballColors?)` turns the inner race and the cage of balls. */
export function ballBearing(parent: THREE.Object3D, b: BearingLook, k: number, at: V3 = [0, 0, 0]) {
  const group = add(parent, new THREE.Group(), at)
  const steel = RACE_STEEL()
  const pitch = ((b.d + b.D) / 4) * k
  const rb = (b.ball / 2) * k
  const w = b.B * k
  ringTube(group, pitch + rb * 0.5, (b.D / 2) * k, w, steel)
  const inner = add(group, new THREE.Group())
  ringTube(inner, (b.d / 2) * k, pitch - rb * 0.5, w, steel)
  add(inner, mesh(new THREE.BoxGeometry(rb * 0.5, pitch - rb * 0.5 - (b.d / 2) * k, 0.05), mat('#3a3f4a')), [0, (b.d / 4) * k + (pitch - rb * 0.5) / 2, w / 2 + 0.03])
  const cage = add(group, new THREE.Group())
  const cageM = mat('#b8862e', { metal: 0.5, rough: 0.45 })
  add(cage, mesh(new THREE.TorusGeometry(pitch, rb * 0.15, 8, 64), cageM), [0, 0, -w * 0.3])
  const ballMats = Array.from({ length: b.balls }, () => new THREE.MeshStandardMaterial({ color: '#e6eaf0', metalness: 0.3, roughness: 0.25 }))
  ballMats.forEach((m, i) => {
    const a = (i / b.balls) * 2 * Math.PI
    add(cage, mesh(new THREE.SphereGeometry(rb, 20, 14), m), [pitch * Math.sin(a), -pitch * Math.cos(a), 0])
  })
  return {
    group,
    pitch,
    ballMats,
    /** Ball i sits at angle cage + i·2π/z from straight down. */
    set(innerAngle: number, cageAngle: number, colors?: readonly (string | null)[]) {
      inner.rotation.z = innerAngle
      cage.rotation.z = cageAngle
      ballMats.forEach((m, i) => {
        const c = colors?.[i] ?? null
        m.emissive.set(c ?? '#000000')
        m.emissiveIntensity = c ? 0.7 : 0
      })
    },
  }
}

/** Bearing cut through its axis, axis along x at (x, 0): outer and inner race blocks with a ball, above and below the shaft. */
export function bearingSection(parent: THREE.Object3D, b: BearingLook, k: number, at: V3 = [0, 0, 0]) {
  const group = add(parent, new THREE.Group(), at)
  const steel = RACE_STEEL()
  const pitch = ((b.d + b.D) / 4) * k
  const rb = (b.ball / 2) * k
  const w = b.B * k
  for (const s of [-1, 1]) {
    const outH = (b.D / 2) * k - pitch - rb * 0.6
    const inH = pitch - rb * 0.6 - (b.d / 2) * k
    add(group, mesh(new THREE.BoxGeometry(w, outH, w), steel), [0, s * ((b.D / 2) * k - outH / 2), 0])
    add(group, mesh(new THREE.BoxGeometry(w, inH, w), steel), [0, s * ((b.d / 2) * k + inH / 2), 0])
    add(group, mesh(new THREE.SphereGeometry(rb, 16, 12), mat('#dfe4ea', { metal: 0.7, rough: 0.2 })), [0, s * pitch, 0])
  }
  return group
}
