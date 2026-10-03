import * as THREE from 'three/webgpu'
import { BLACK_PLASTIC, GOLD, V3, box, mat, rod, tube } from './kit'

const HOUSING_TOP = 4

/** Dupont housing standing in a hole at (x, z): pin below, wire leaving the top. */
function dupontEnd(g: THREE.Group, x: number, z: number) {
  box(g, [0.98, HOUSING_TOP - 0.2, 0.98], BLACK_PLASTIC(), [x, 0.2 + (HOUSING_TOP - 0.2) / 2, z])
  rod(g, [x, 0.2, z], [x, -1.5, z], 0.13, GOLD())
}

/** Jumper between two holes, arcing higher the further apart they are. */
export function buildJumper(a: { x: number; z: number }, b: { x: number; z: number }, color: string): THREE.Group {
  const g = new THREE.Group()
  dupontEnd(g, a.x, a.z)
  dupontEnd(g, b.x, b.z)
  const lift = HOUSING_TOP + 1.5 + Math.hypot(b.x - a.x, b.z - a.z) * 0.15
  const pts: V3[] = [
    [a.x, HOUSING_TOP, a.z],
    [a.x, HOUSING_TOP + 1.2, a.z],
    [(a.x + b.x) / 2, lift, (a.z + b.z) / 2],
    [b.x, HOUSING_TOP + 1.2, b.z],
    [b.x, HOUSING_TOP, b.z],
  ]
  tube(g, pts, 0.32, mat(color, { rough: 0.45 }))
  return g
}

/** Loose lead from a point in space down into a hole, ending in a Dupont pin. */
export function buildLead(from: THREE.Vector3, hole: { x: number; z: number }, color: string): THREE.Group {
  const g = new THREE.Group()
  dupontEnd(g, hole.x, hole.z)
  const top: V3 = [hole.x, HOUSING_TOP, hole.z]
  const mid: V3 = [(from.x + hole.x) / 2, Math.max(from.y, HOUSING_TOP) + 2, (from.z + hole.z) / 2]
  tube(g, [from.toArray() as V3, mid, [hole.x, HOUSING_TOP + 1.5, hole.z], top], 0.3, mat(color, { rough: 0.45 }))
  return g
}
