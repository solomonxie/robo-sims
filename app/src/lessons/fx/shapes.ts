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

/** Glowing sphere marker of radius `r`. */
export const glowDot = (parent: THREE.Object3D, r: number, color: string, glow = 1.2) => add(parent, mesh(new THREE.SphereGeometry(r, 16, 12), glowMat(color, glow)))

/** See-through housing material. */
export const shellMat = (color: string, opacity: number, roughness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness, depthWrite: false })

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

/** Arrow of any length from `a` to `b` (shaft radius `r`); hidden when shorter than its head. `set(a, b, color?)`. */
export function stretchArrow(parent: THREE.Object3D, color: string, r: number) {
  const m = glowMat(color, 0.9)
  const shaft = add(parent, mesh(new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0), m))
  const head = add(parent, mesh(new THREE.ConeGeometry(r * 2.6, r * 7, 12).translate(0, r * 3.5, 0), m))
  shaft.castShadow = head.castShadow = false
  const d = new THREE.Vector3()
  return (a: V3, b: V3, c?: string) => {
    d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = d.length()
    shaft.visible = head.visible = len > r * 7
    if (!shaft.visible) return
    d.divideScalar(len)
    if (c) {
      m.color.set(c)
      m.emissive.set(c)
    }
    shaft.position.set(...a)
    shaft.quaternion.setFromUnitVectors(UP, d)
    shaft.scale.set(r, len - r * 7, r)
    head.position.set(a[0] + d.x * (len - r * 7), a[1] + d.y * (len - r * 7), a[2] + d.z * (len - r * 7))
    head.quaternion.copy(shaft.quaternion)
  }
}
