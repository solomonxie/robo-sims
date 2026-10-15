// Coordinate frames: RGB axis triads, 4×4 transforms onto objects, and robots built from a parsed URDF (z up, metres).
import * as THREE from 'three/webgpu'
import { Mat4, UrdfModel, UrdfShape, linkFrames } from '../../core/physics'
import { V3, add, mesh } from '../../models/kit'
import { glowMat } from './colors'
import { rodBetween } from './layout'
import { liveLabel } from './text'

/** x red, y green, z blue. */
export const AXIS_RGB = ['#ff5a5a', '#5ce17a', '#5a8cff'] as const

const m4 = new THREE.Matrix4()
/** Places `o` by a row-major 4×4 (relative to its parent). */
export function setTf(o: THREE.Object3D, m: Mat4) {
  m4.set(...(m as Parameters<THREE.Matrix4['set']>))
  m4.decompose(o.position, o.quaternion, o.scale)
}

/** RGB axes of length `len` from the origin with tips, plus an optional name at the origin; `label.set` to recolour. */
export function frameTriad(parent: THREE.Object3D, len: number, name = '', color = '#e8e8e8', r = len * 0.045) {
  const g = add(parent, new THREE.Group())
  AXIS_RGB.forEach((c, i) => {
    const m = glowMat(c, 0.8)
    const tip: V3 = [0, 0, 0]
    tip[i] = len
    rodBetween(g, [0, 0, 0], tip, m, r)
    const cone = add(g, mesh(new THREE.ConeGeometry(r * 2.6, len * 0.22, 12), m), tip)
    cone.castShadow = false
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...tip).normalize())
  })
  add(g, mesh(new THREE.SphereGeometry(r * 2, 12, 8), glowMat(color, 0.6))).castShadow = false
  const label = liveLabel(g, [len * 0.3, 0, len * 0.3], { size: len * 0.24, align: 'left' })
  label.group.rotation.x = Math.PI / 2
  label.set(name, color)
  return { group: g, label }
}

/** Mesh for a URDF box / cylinder (along z) / sphere, placed by its `<origin>`. */
function shapeMesh(s: UrdfShape, m: THREE.Material) {
  const g = s.geom
  const geo =
    g.kind === 'box'
      ? new THREE.BoxGeometry(...g.size)
      : g.kind === 'cylinder'
        ? new THREE.CylinderGeometry(g.radius, g.radius, g.length, 28).rotateX(Math.PI / 2)
        : new THREE.SphereGeometry(g.radius, 16, 12)
  const o = mesh(geo, m)
  o.position.set(...s.xyz)
  o.rotation.set(s.rpy[0], s.rpy[1], s.rpy[2], 'ZYX')
  return o
}

/** One group per link holding its visual (`look(name)`) and collision (translucent `hull` colour) meshes; `pose(q)` moves the links. */
export function urdfModel(parent: THREE.Object3D, model: UrdfModel, look: (link: string) => THREE.Material, hull = '#ff9a4d') {
  const root = add(parent, new THREE.Group())
  const hullMat = new THREE.MeshStandardMaterial({ color: hull, emissive: hull, emissiveIntensity: 0.25, transparent: true, opacity: 0.1, depthWrite: false })
  const links = Object.fromEntries(
    model.links.map((l) => {
      const g = add(root, new THREE.Group())
      const visual = l.visual ? add(g, shapeMesh(l.visual, look(l.name))) : null
      const collision = l.collision ? add(g, shapeMesh(l.collision, hullMat)) : null
      if (collision) collision.castShadow = false
      return [l.name, { g, visual, collision }]
    }),
  )
  const pose = (q: Record<string, number> = {}) => {
    const f = linkFrames(model, q)
    for (const [name, l] of Object.entries(links)) setTf(l.g, f[name])
    return f
  }
  pose()
  return { root, links, pose }
}
