import * as THREE from 'three/webgpu'
import { V3, add, mat, mesh } from '../../models/kit'
import { CONVENTIONAL, glowMat } from './colors'
import { UP } from './util'

/** A flat "+" token, facing +z. */
export function plusGeometry(size = 0.8): THREE.BufferGeometry {
  const t = size * 0.32
  const shape = new THREE.Shape()
  const a = size / 2
  const b = t / 2
  shape.moveTo(-b, a)
  for (const [x, y] of [[b, a], [b, b], [a, b], [a, -b], [b, -b], [b, -a], [-b, -a], [-b, -b], [-a, -b], [-a, b], [-b, b]]) shape.lineTo(x, y)
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
  g.translate(0, 0, -t / 2)
  return g
}

export function arrow(parent: THREE.Object3D, at: V3, dir: V3, color = CONVENTIONAL, size = 1) {
  const g = new THREE.Group()
  const material = glowMat(color, 0.5)
  add(g, mesh(new THREE.CylinderGeometry(0.18 * size, 0.18 * size, 1.4 * size, 10), material), [0, -0.5 * size, 0])
  add(g, mesh(new THREE.ConeGeometry(0.55 * size, 1.1 * size, 16), material), [0, 0.6 * size, 0])
  g.position.set(...at)
  pointArrow(g, dir)
  parent.add(g)
  return g
}

export function pointArrow(a: THREE.Object3D, dir: V3) {
  a.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize())
}

/** Translucent glowing box, e.g. a highlight behind part of a schematic. */
export function glowBox(parent: THREE.Object3D, size: V3, at: V3, color: string, opacity = 0.2) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, transparent: true, opacity, depthWrite: false })
  const box = add(parent, new THREE.Mesh(new THREE.BoxGeometry(...size), m), at)
  box.castShadow = false
  return { mesh: box, m }
}

/** Dark backing plate behind lit panels. */
export const trayMat = () => mat('#1b1d22', { rough: 0.7 })

/** Box that casts no shadow. */
export const flatBox = (parent: THREE.Object3D, size: V3, m: THREE.Material, at: V3) => {
  const o = add(parent, mesh(new THREE.BoxGeometry(...size), m), at)
  o.castShadow = false
  return o
}

/** See-through housing material. */
export const shellMat = (color: string, opacity: number, roughness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness, depthWrite: false })
