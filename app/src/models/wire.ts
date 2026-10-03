import * as THREE from 'three/webgpu'
import { BLACK_PLASTIC, GOLD, V3, box, mat, rod, tube } from './kit'

export const HOUSING_TOP = 4

/** Dupont housing standing in a hole at (x, z): pin below, wire leaving the top. */
function dupontEnd(g: THREE.Group, x: number, z: number) {
  box(g, [0.98, HOUSING_TOP - 0.2, 0.98], BLACK_PLASTIC(), [x, 0.2 + (HOUSING_TOP - 0.2) / 2, z])
  rod(g, [x, 0.2, z], [x, -1.5, z], 0.13, GOLD())
}

type XZ = { x: number; z: number }

/** Centerline of a jumper, housing top to housing top, arcing higher the further apart the holes are. */
export function jumperPoints(a: XZ, b: XZ): V3[] {
  const lift = HOUSING_TOP + 1.5 + Math.hypot(b.x - a.x, b.z - a.z) * 0.15
  return [
    [a.x, HOUSING_TOP, a.z],
    [a.x, HOUSING_TOP + 1.2, a.z],
    [(a.x + b.x) / 2, lift, (a.z + b.z) / 2],
    [b.x, HOUSING_TOP + 1.2, b.z],
    [b.x, HOUSING_TOP, b.z],
  ]
}

/** Centerline of a loose lead, from `from` to the housing top over the hole. */
export function leadPoints(from: THREE.Vector3, hole: XZ): V3[] {
  const mid: V3 = [(from.x + hole.x) / 2, Math.max(from.y, HOUSING_TOP) + 2, (from.z + hole.z) / 2]
  return [from.toArray() as V3, mid, [hole.x, HOUSING_TOP + 1.5, hole.z], [hole.x, HOUSING_TOP, hole.z]]
}

export function buildJumper(a: XZ, b: XZ, color: string): THREE.Group {
  const g = new THREE.Group()
  dupontEnd(g, a.x, a.z)
  dupontEnd(g, b.x, b.z)
  tube(g, jumperPoints(a, b), 0.32, mat(color, { rough: 0.45 }))
  return g
}

/** Loose lead from a point in space down into a hole, ending in a Dupont pin. */
export function buildLead(from: THREE.Vector3, hole: XZ, color: string): THREE.Group {
  const g = new THREE.Group()
  dupontEnd(g, hole.x, hole.z)
  tube(g, leadPoints(from, hole), 0.3, mat(color, { rough: 0.45 }))
  return g
}
