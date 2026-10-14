// Visual vocabulary shared by lessons: moving charges, wires, arrows, cells.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, rod, STEEL } from '../models/kit'
import { Helix } from '../models/power'

export const ELECTRON = '#4da6ff'
export const CONVENTIONAL = '#ff9a2e'
export const RING = '#ffd84d'
export const COPPER = () => mat('#c8803f', { metal: 0.35, rough: 0.4 })

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

export function path(points: V3[], closed = false): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map((p) => new THREE.Vector3(...p))
  const c = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) c.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  if (closed) c.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]))
  return c
}

/** Evenly spaced dots sliding along a path; wraps at the ends. */
export class Flow {
  readonly mesh: THREE.InstancedMesh
  readonly length: number
  readonly count: number
  private offset = 0
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()

  constructor(
    private readonly curve: THREE.Curve<THREE.Vector3>,
    spacing = 1.6,
    color = ELECTRON,
    radius = 0.32,
    geometry: THREE.BufferGeometry = new THREE.SphereGeometry(radius, 12, 8),
  ) {
    this.length = curve.getLength()
    this.count = Math.max(2, Math.round(this.length / spacing))
    this.mesh = new THREE.InstancedMesh(geometry, glowMat(color), this.count)
    this.mesh.frustumCulled = false
    this.place()
  }

  /** Moves every dot `distance` along the path (negative goes backwards). */
  step(distance: number) {
    this.offset = (((this.offset + distance / this.length) % 1) + 1) % 1
    this.place()
  }

  /** Places the dots `distance` along the path from their start. */
  moveTo(distance: number) {
    this.offset = 0
    this.step(distance)
  }

  private place() {
    for (let i = 0; i < this.count; i++) {
      this.curve.getPointAt((i / this.count + this.offset) % 1, this.p)
      this.mesh.setMatrixAt(i, this.m.makeTranslation(this.p))
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

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

const UP = new THREE.Vector3(0, 1, 0)

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

/** A cell standing on y, + on top; flip with `rotation.z = π`. */
export function cell(height = 5, r = 1.6): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, r, height * 0.7, mat('#26272c', { rough: 0.4 }), [0, -height * 0.15, 0], 'y', 32)
  cylinder(g, r, height * 0.3, mat('#c9772b', { metal: 0.3, rough: 0.35 }), [0, height * 0.35, 0], 'y', 32)
  cylinder(g, r * 0.35, 0.4, STEEL(), [0, height / 2 + 0.2, 0], 'y', 16)
  const red = mat('#ff4d4d', { emissive: '#aa1111' })
  const blue = mat('#4d8dff', { emissive: '#1133aa' })
  box(g, [0.9, 0.22, 0.1], red, [0, height * 0.35, r])
  box(g, [0.22, 0.9, 0.1], red, [0, height * 0.35, r])
  box(g, [0.9, 0.22, 0.1], blue, [0, -height * 0.3, r])
  return g
}

/** Copper wire through `points`. */
export function wire(parent: THREE.Object3D, points: V3[], r = 0.28) {
  lead(parent, points, r, COPPER())
}

/** Incandescent bulb, filament centred at the origin; screw base below. */
export function bulb(): { group: THREE.Group; setGlow: (g: number) => void } {
  const group = new THREE.Group()
  const base = mat('#b9bec6', { metal: 0.45, rough: 0.35 })
  cylinder(group, 1.1, 1.8, base, [0, -2.1, 0], 'y', 24)
  for (let i = 0; i < 4; i++) {
    const t = add(group, mesh(new THREE.TorusGeometry(1.12, 0.12, 6, 24), base), [0, -2.8 + i * 0.45, 0])
    t.rotation.x = Math.PI / 2
  }
  cylinder(group, 0.5, 0.3, mat('#222'), [0, -3.1, 0], 'y', 16)
  const glass = mesh(
    new THREE.SphereGeometry(2.7, 40, 24),
    new THREE.MeshStandardMaterial({ color: '#f4f6ff', transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }),
  )
  glass.castShadow = false
  add(group, glass, [0, 1.5, 0])
  for (const s of [-1, 1]) rod(group, [s * 0.4, -1.2, 0], [s * 1.1, 1.6, 0], 0.07, STEEL())
  const filamentMat = new THREE.MeshStandardMaterial({ color: '#6b5a4a', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.4 })
  const filament = add(group, mesh(new THREE.TubeGeometry(new Helix(0.22, 2.2, 12), 160, 0.05, 6), filamentMat), [-1.1, 1.6, 0])
  filament.castShadow = false
  const light = new THREE.PointLight('#ffcf8a', 0, 60, 2)
  add(group, light, [0, 1.6, 0])
  return {
    group,
    setGlow(g) {
      filamentMat.emissiveIntensity = g * 6
      light.intensity = g * 500
    },
  }
}

/** See-through wire along x, with copper rims at the ends. */
export function glassTube(parent: THREE.Object3D, length: number, radius: number) {
  const glass = mesh(
    new THREE.CylinderGeometry(radius, radius, length, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f0c090', transparent: true, opacity: 0.07, roughness: 0.1, side: THREE.FrontSide, depthWrite: false }),
  )
  glass.rotation.z = Math.PI / 2
  glass.castShadow = false
  parent.add(glass)
  for (const s of [-1, 1]) {
    const rim = add(parent, mesh(new THREE.TorusGeometry(radius, 0.1, 10, 64), mat('#c8803f', { metal: 0.4, rough: 0.3 })), [(s * length) / 2, 0, 0])
    rim.rotation.y = Math.PI / 2
  }
}

/** The glowing cross-section that current is counted through, at x = `x`. */
export function countingRing(parent: THREE.Object3D, radius: number, x = 0) {
  const material = glowMat(RING, 0.9)
  const ring = add(parent, mesh(new THREE.TorusGeometry(radius + 0.25, 0.12, 12, 64), material), [x, 0, 0])
  ring.rotation.y = Math.PI / 2
  const disc = mesh(
    new THREE.CircleGeometry(radius + 0.2, 64),
    new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  )
  disc.position.x = x
  disc.rotation.y = Math.PI / 2
  disc.castShadow = false
  parent.add(disc)
  return material
}

export function randomDir(len: number): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len)
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
