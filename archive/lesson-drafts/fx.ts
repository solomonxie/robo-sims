// Visual vocabulary shared by lessons: moving charges, wires, arrows, cells.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, STEEL } from '../models/kit'

export const ELECTRON = '#4da6ff'
export const HOLE = '#ff6a5a'
export const CONVENTIONAL = '#ff9a2e'
export const COPPER = () => mat('#c8803f', { metal: 0.35, rough: 0.4 })

export function path(points: V3[], closed = false): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map((p) => new THREE.Vector3(...p))
  const c = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) c.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  if (closed) c.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]))
  return c
}

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

/** Evenly spaced dots sliding along a path; wraps at the ends. */
export class Flow {
  readonly mesh: THREE.InstancedMesh
  private offset = 0
  private readonly length: number
  private readonly count: number
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()

  constructor(
    private readonly curve: THREE.Curve<THREE.Vector3>,
    spacing = 1.6,
    color = ELECTRON,
    radius = 0.32,
    private readonly colorAt?: (p: THREE.Vector3, c: THREE.Color) => void,
  ) {
    this.length = curve.getLength()
    this.count = Math.max(2, Math.round(this.length / spacing))
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 12, 8), glowMat(color), this.count)
    this.mesh.frustumCulled = false
    this.place()
  }

  /** Moves every dot `distance` along the path (negative goes backwards). */
  step(distance: number) {
    this.offset = (((this.offset + distance / this.length) % 1) + 1) % 1
    this.place()
  }

  private place() {
    const color = new THREE.Color()
    for (let i = 0; i < this.count; i++) {
      const u = (i / this.count + this.offset) % 1
      this.curve.getPointAt(u, this.p)
      this.mesh.setMatrixAt(i, this.m.makeTranslation(this.p))
      if (this.colorAt) {
        this.colorAt(this.p, color)
        this.mesh.setColorAt(i, color)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

const UP = new THREE.Vector3(0, 1, 0)

export function arrow(parent: THREE.Object3D, at: V3, dir: V3, color = CONVENTIONAL, size = 1) {
  const g = new THREE.Group()
  const material = glowMat(color, 0.5)
  add(g, mesh(new THREE.CylinderGeometry(0.18 * size, 0.18 * size, 1.4 * size, 10), material), [0, -0.5 * size, 0])
  add(g, mesh(new THREE.ConeGeometry(0.55 * size, 1.1 * size, 16), material), [0, 0.6 * size, 0])
  g.position.set(...at)
  g.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize())
  parent.add(g)
  return g
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

/** Clears and returns a fresh child group, for parts rebuilt on control changes. */
export function slot(parent: THREE.Object3D): () => THREE.Group {
  let current: THREE.Group | null = null
  return () => {
    if (current) parent.remove(current)
    current = new THREE.Group()
    parent.add(current)
    return current
  }
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Visual dot speed for a current: sqrt keeps tiny currents visible. Not to scale. */
export const dotSpeed = (amps: number, refAmps: number, max = 12) => Math.sign(amps) * max * Math.sqrt(Math.min(Math.abs(amps) / refAmps, 1.5))

/** Particles with thermal jitter + drift, kept in shape by `contain`. */
export class Swarm {
  readonly mesh: THREE.InstancedMesh
  readonly pos: THREE.Vector3[]
  readonly vel: THREE.Vector3[]
  private readonly m = new THREE.Matrix4()

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, count: number, init: (p: THREE.Vector3, i: number) => void) {
    this.mesh = new THREE.InstancedMesh(geo, material, count)
    this.mesh.frustumCulled = false
    this.pos = Array.from({ length: count }, (_, i) => {
      const p = new THREE.Vector3()
      init(p, i)
      return p
    })
    this.vel = this.pos.map(() => randomDir(1))
    this.write()
  }

  update(
    dt: number,
    { thermal, drift = [0, 0, 0], collideRate = 3, contain }: {
      thermal: number
      drift?: V3
      collideRate?: number
      contain: (p: THREE.Vector3, v: THREE.Vector3, i: number) => void
    },
  ) {
    for (let i = 0; i < this.pos.length; i++) {
      const v = this.vel[i]
      if (Math.random() < dt * collideRate) v.copy(randomDir(thermal))
      this.pos[i].x += (v.x + drift[0]) * dt
      this.pos[i].y += (v.y + drift[1]) * dt
      this.pos[i].z += (v.z + drift[2]) * dt
      contain(this.pos[i], v, i)
    }
    this.write()
  }

  write() {
    this.pos.forEach((p, i) => this.mesh.setMatrixAt(i, this.m.makeTranslation(p)))
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export function randomDir(len: number): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len)
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Keeps a point inside a cylinder along x, wrapping x around [−L/2, L/2]. */
export function inTube(p: THREE.Vector3, v: THREE.Vector3, length: number, radius: number) {
  if (p.x < -length / 2) p.x += length
  if (p.x > length / 2) p.x -= length
  const r = Math.hypot(p.y, p.z)
  if (r > radius) {
    p.y *= radius / r
    p.z *= radius / r
    v.y = -v.y
    v.z = -v.z
  }
}

/** Keeps a point inside an axis-aligned box, bouncing off the walls. */
export function inBox(p: THREE.Vector3, v: THREE.Vector3, min: V3, max: V3) {
  const keys = ['x', 'y', 'z'] as const
  keys.forEach((k, i) => {
    if (p[k] < min[i]) {
      p[k] = min[i]
      v[k] = Math.abs(v[k])
    } else if (p[k] > max[i]) {
      p[k] = max[i]
      v[k] = -Math.abs(v[k])
    }
  })
}
