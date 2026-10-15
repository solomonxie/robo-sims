// Wiring and layout: copper and hookup wire, the charge lane, loop constants, board/part poses.
import * as THREE from 'three/webgpu'
import { V3, add, lead, mesh, tube } from '../../models/kit'
import { COPPER } from './colors'
import { UP, clamp01 } from './util'

/** Copper wire through `points`. */
export function wire(parent: THREE.Object3D, points: V3[], r = 0.28) {
  lead(parent, points, r, COPPER())
}

/** Charges ride this far in front of the wire so they stay visible through the parts. */
export const LANE = 1.3
/** Circuit-lesson resistor scale, its half-length, and cell height. */
export const R_SCALE = 1.8
export const RS = 1.2 * R_SCALE
export const CELL_H = 4.4

/** Potential fraction up a `CELL_H` cell centred at y = `cy`. */
export const cellFraction = (y: number, cy = 0) => clamp01((y - cy + CELL_H / 2) / CELL_H)
/** Points moved onto the charge lane. */
export const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])

const along = new THREE.Vector3()
const seg = new THREE.Vector3()

/** Potential fraction at `at` on a straight wire a → b with a resistor of half-length `rs` at its middle:
 *  `fa` before it, `fb` after, a linear drop across it. */
export function dropAlong(at: THREE.Vector3, a: V3, b: V3, fa: number, fb: number, rs: number) {
  seg.set(b[0] - a[0], b[1] - a[1], 0)
  const len = seg.length()
  const s = along.set(at.x - a[0], at.y - a[1], 0).dot(seg) / len
  return fa + (fb - fa) * clamp01((s - len / 2 + rs) / (2 * rs))
}

/** Insulated hookup wire through `points`, rounded at the bends. */
export function cableRun(parent: THREE.Object3D, points: V3[], color = '#d8322c', r = 0.16) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  for (let i = 0; i < points.length - 1; i++) tube(parent, [points[i], points[i + 1]], r, m, 4)
  for (let i = 1; i < points.length - 1; i++) add(parent, mesh(new THREE.SphereGeometry(r, 12, 8), m), points[i])
}

/** A board model laid face-up toward the camera at `k` × real. */
export const lieFlat = (o: THREE.Object3D, k = 0.22) => {
  o.scale.setScalar(k)
  o.rotation.x = Math.PI / 2
  return o
}

/** A part model standing on (or hanging from) a horizontal wire at `at`, `k` × real. */
export function standUp(parent: THREE.Object3D, part: THREE.Group, at: V3, k: number, hang = false) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.z = hang ? Math.PI : 0
  add(g, part, [0, 1.5 * k, 0]).scale.setScalar(k)
  return g
}

export const UNIT_ROD = new THREE.CylinderGeometry(1, 1, 1, 8)
/** `UNIT_ROD` mesh that casts no shadow, for `stretchRod`. */
export const shadowlessRod = (m: THREE.Material) => {
  const o = mesh(UNIT_ROD, m)
  o.castShadow = false
  return o
}
/** A shadowless rod added to `parent`, ready for `stretchRod`. */
export const addRod = (parent: THREE.Object3D, m: THREE.Material) => add(parent, shadowlessRod(m))
/** A shadowless rod from a to b. */
export function rodBetween(parent: THREE.Object3D, a: V3, b: V3, m: THREE.Material, r = 0.08) {
  const o = addRod(parent, m)
  stretchRod(o, a, b, r)
  return o
}
const rodDir = new THREE.Vector3()

/** Stretches a `UNIT_ROD` mesh of radius `r` from a to b; hidden when a = b. */
export function stretchRod(m: THREE.Object3D, a: V3, b: V3, r = 0.09) {
  rodDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = rodDir.length()
  m.visible = len > 1e-3
  if (!m.visible) return
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  m.quaternion.setFromUnitVectors(UP, rodDir.divideScalar(len))
  m.scale.set(r, len, r)
}
