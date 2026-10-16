// Coordinate frames: RGB axis triads (optional axis letters), z-up groups, 4×4 transforms onto objects, bracketed matrices, and robots built from a parsed URDF (z up, metres).
import * as THREE from 'three/webgpu'
import { Mat4, UrdfModel, UrdfShape, linkFrames } from '../../core/physics'
import { V3, add, mesh } from '../../models/kit'
import { GREY, glowMat } from './colors'
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

const unturn = new THREE.Quaternion()
/** Keeps `o` facing the scene front (+z, upright) whatever its parents' rotation. */
export function faceFront(o: THREE.Object3D) {
  o.parent?.getWorldQuaternion(unturn)
  o.quaternion.copy(unturn.invert())
}

/** RGB axes of length `len` from the origin with tips, plus an optional name at the origin and axis `letters` (e.g. 'xyz') at the tips (`planar`: x and y only); `label.set` to recolour, `face()` each frame to turn the text to the viewer. */
export function frameTriad(parent: THREE.Object3D, len: number, name = '', color = '#e8e8e8', r = len * 0.045, { letters = '', size = len * 0.24, planar = false } = {}) {
  const g = add(parent, new THREE.Group())
  const texts: THREE.Object3D[] = []
  AXIS_RGB.slice(0, planar ? 2 : 3).forEach((c, i) => {
    const m = glowMat(c, 0.8)
    const tip: V3 = [0, 0, 0]
    tip[i] = len
    rodBetween(g, [0, 0, 0], tip, m, r)
    const cone = add(g, mesh(new THREE.ConeGeometry(r * 2.6, len * 0.22, 12), m), tip)
    cone.castShadow = false
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...tip).normalize())
    if (!letters) return
    const at: V3 = [0, 0, 0]
    at[i] = len * 1.28
    const l = liveLabel(g, at, { size: len * 0.2 })
    l.group.rotation.x = Math.PI / 2
    l.set(letters[i], c)
    texts.push(l.group)
  })
  add(g, mesh(new THREE.SphereGeometry(r * 2, 12, 8), glowMat(color, 0.6))).castShadow = false
  const label = liveLabel(g, [len * 0.3, 0, len * 0.3], { size, align: 'left' })
  label.group.rotation.x = Math.PI / 2
  label.set(name, color)
  texts.push(label.group)
  return { group: g, label, face: () => texts.forEach(faceFront) }
}

/** z-up metres → scene (y up): a group the caller fills in robot coordinates, scaled `k`, leaned `tilt` toward the viewer and turned `yaw`. */
export function zUp(parent: THREE.Object3D, at: V3, k: number, tilt = 0, yaw = 0) {
  const outer = add(parent, new THREE.Group(), at)
  outer.rotation.set(tilt, yaw, 0, 'XYZ')
  const g = add(outer, new THREE.Group())
  g.rotation.x = -Math.PI / 2
  g.scale.setScalar(k)
  return g
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

/** Bracketed `rows`×`cols` grid of numbers centred at `at`, cells `cell` wide; `set(texts, colors)` row-major. */
export function matrixGrid(parent: THREE.Object3D, at: V3, rows: number, cols: number, { cell = 1.6, size = 0.4, bracket = GREY } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const h = rows * size * 1.9
  const w = cols * cell
  const m = glowMat(bracket, 0.5)
  for (const s of [-1, 1]) {
    const x = (s * (w + size * 0.6)) / 2
    rodBetween(g, [x, -h / 2, 0], [x, h / 2, 0], m, size * 0.06)
    for (const y of [-h / 2, h / 2]) rodBetween(g, [x, y, 0], [x - s * size * 0.5, y, 0], m, size * 0.06)
  }
  const cells = Array.from({ length: rows * cols }, (_, i) =>
    liveLabel(g, [(-w + cell) / 2 + (i % cols) * cell, h / 2 - size * 0.95 - Math.floor(i / cols) * size * 1.9, 0], { size }),
  )
  return { group: g, w: w + size * 1.6, h, set: (texts: string[], colors: string[]) => cells.forEach((c, i) => c.set(texts[i], colors[i % colors.length])) }
}
