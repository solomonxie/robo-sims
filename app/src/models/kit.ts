// Geometry/material helpers shared by every part model. 1 unit = 2.54 mm.
import * as THREE from 'three/webgpu'

export type V3 = [number, number, number]

interface MatOpts {
  metal?: number
  rough?: number
  opacity?: number
  emissive?: string
}

const cache = new Map<string, THREE.MeshStandardMaterial>()

/** Shared material; pass `unique` when the caller will mutate it (e.g. LED glow). */
export function mat(color: string, o: MatOpts = {}, unique = false): THREE.MeshStandardMaterial {
  const key = `${color}|${o.metal ?? 0}|${o.rough ?? 0.6}|${o.opacity ?? 1}|${o.emissive ?? ''}`
  if (!unique && cache.has(key)) return cache.get(key)!
  const m = new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0,
    roughness: o.rough ?? 0.6,
    transparent: (o.opacity ?? 1) < 1,
    opacity: o.opacity ?? 1,
    emissive: o.emissive ?? '#000000',
  })
  if (!unique) cache.set(key, m)
  return m
}

// No environment map, so metals stay low-metalness to avoid rendering black.
export const TIN = () => mat('#d4d7dc', { metal: 0.45, rough: 0.35 })
export const GOLD = () => mat('#d9b24a', { metal: 0.45, rough: 0.35 })
export const STEEL = () => mat('#b9bec6', { metal: 0.4, rough: 0.4 })
export const BLACK_PLASTIC = () => mat('#1c1c1f', { rough: 0.7 })

export function add<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, pos: V3 = [0, 0, 0]): T {
  obj.position.set(...pos)
  parent.add(obj)
  return obj
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function box(parent: THREE.Object3D, size: V3, material: THREE.Material, pos: V3 = [0, 0, 0]) {
  return add(parent, mesh(new THREE.BoxGeometry(...size), material), pos)
}

type Axis = 'x' | 'y' | 'z'

function orient(obj: THREE.Object3D, axis: Axis) {
  if (axis === 'x') obj.rotation.z = Math.PI / 2
  if (axis === 'z') obj.rotation.x = Math.PI / 2
}

export function cylinder(
  parent: THREE.Object3D,
  r: number,
  h: number,
  material: THREE.Material,
  pos: V3 = [0, 0, 0],
  axis: Axis = 'y',
  segments = 24,
) {
  const m = add(parent, mesh(new THREE.CylinderGeometry(r, r, h, segments), material), pos)
  orient(m, axis)
  return m
}

/** Solid of revolution around `axis` from [radius, along-axis] points. */
export function lathe(
  parent: THREE.Object3D,
  profile: [number, number][],
  material: THREE.Material,
  pos: V3 = [0, 0, 0],
  axis: Axis = 'y',
  segments = 32,
) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y))
  const m = add(parent, mesh(new THREE.LatheGeometry(pts, segments), material), pos)
  orient(m, axis)
  return m
}

const UP = new THREE.Vector3(0, 1, 0)

/** Straight cylinder from a to b. */
export function rod(parent: THREE.Object3D, a: V3, b: V3, r: number, material: THREE.Material, segments = 10) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const dir = vb.clone().sub(va)
  const m = mesh(new THREE.CylinderGeometry(r, r, dir.length(), segments), material)
  m.position.copy(va).add(vb).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(UP, dir.normalize())
  parent.add(m)
  return m
}

/** A bent wire through `points`, rounded at each corner. */
export function lead(parent: THREE.Object3D, points: V3[], r: number, material: THREE.Material = TIN()) {
  for (let i = 0; i < points.length - 1; i++) rod(parent, points[i], points[i + 1], r, material)
  for (let i = 1; i < points.length - 1; i++) {
    add(parent, mesh(new THREE.SphereGeometry(r, 10, 8), material), points[i])
  }
}

export function tube(parent: THREE.Object3D, points: V3[], r: number, material: THREE.Material, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return add(parent, mesh(new THREE.TubeGeometry(curve, segments, r, 10, false), material))
}

/** Square header pins: plastic spacer under the PCB, metal posts through it. */
export function header(
  parent: THREE.Object3D,
  xs: number[],
  z: number,
  spacerY: number,
  pinTop: number,
  pinBottom: number,
) {
  const spacer = BLACK_PLASTIC()
  box(parent, [xs.length, 1, 1], spacer, [(xs[0] + xs[xs.length - 1]) / 2, spacerY, z])
  const geo = new THREE.BoxGeometry(0.25, pinTop - pinBottom, 0.25)
  const pins = new THREE.InstancedMesh(geo, GOLD(), xs.length)
  const m = new THREE.Matrix4()
  xs.forEach((x, i) => pins.setMatrixAt(i, m.makeTranslation(x, (pinTop + pinBottom) / 2, z)))
  pins.castShadow = true
  parent.add(pins)
}

export const range = (n: number, start = 0, step = 1) => Array.from({ length: n }, (_, i) => start + i * step)
