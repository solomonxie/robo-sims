// Moving charges: dots along a path, and the electrons and ions inside a metal.
import * as THREE from 'three/webgpu'
import { V3, add, mat, mesh } from '../../models/kit'
import { CONVENTIONAL, ELECTRON, RING, glowMat, potentialColor } from './colors'
import { plusGeometry } from './shapes'
import { frac, path, rand, randomDir } from './util'

/** Evenly spaced dots sliding along a path; wraps at the ends. */
export class Flow {
  readonly mesh: THREE.InstancedMesh
  readonly length: number
  readonly count: number
  private offset = 0
  private paint?: (at: THREE.Vector3, out: THREE.Color) => void
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly c = new THREE.Color()

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

  /** Colors each dot by where it is (e.g. by potential); unlit so the color reads exactly. */
  colorBy(paint: (at: THREE.Vector3, out: THREE.Color) => void) {
    this.paint = paint
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.material = new THREE.MeshBasicMaterial({ color: '#ffffff' })
    this.place()
    return this
  }

  private place() {
    for (let i = 0; i < this.count; i++) {
      this.curve.getPointAt((i / this.count + this.offset) % 1, this.p)
      this.mesh.setMatrixAt(i, this.m.makeTranslation(this.p))
      if (this.paint) {
        this.paint(this.p, this.c)
        this.mesh.setColorAt(i, this.c)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
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

/** Metal ions on a square grid filling a wire along x; returns `vibrate(t, amplitude)`. */
export function ionLattice(
  parent: THREE.Object3D,
  length: number,
  radius: number,
  { spacing = 2, size = 0.55, colors = ['#d08a4e'] }: { spacing?: number; size?: number; colors?: string[] } = {},
) {
  const sites: THREE.Vector3[] = []
  const k = Math.floor((radius - 0.4) / spacing)
  for (let x = -length / 2 + spacing / 2; x < length / 2; x += spacing) {
    for (let y = -k; y <= k; y++) {
      for (let z = -k; z <= k; z++) if (Math.hypot(y, z) * spacing < radius - 0.4) sites.push(new THREE.Vector3(x, y * spacing, z * spacing))
    }
  }
  const ions = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 20, 14), new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.45 }), sites.length)
  const c = new THREE.Color()
  sites.forEach((_, i) => ions.setColorAt(i, c.set(colors[i % colors.length])))
  parent.add(ions)
  const phase = sites.map(() => [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)])
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const vibrate = (t: number, amplitude = 0.07) => {
    sites.forEach((s, i) => {
      const [a, b, cc] = phase[i]
      p.set(s.x + amplitude * Math.sin(t * 9 + a), s.y + amplitude * Math.sin(t * 11 + b), s.z + amplitude * Math.sin(t * 10 + cc))
      ions.setMatrixAt(i, m.makeTranslation(p))
    })
    ions.instanceMatrix.needsUpdate = true
  }
  vibrate(0)
  return { ions, vibrate }
}

const FLASH_S = 0.4

/** Free electrons in a wire along x: random thermal motion plus a shared drift (+drift moves them −x).
 *  `scatter` is collisions per second; with `ring`, they flash yellow crossing x = 0. Show fewer with `mesh.count`. */
export function electronGas(parent: THREE.Object3D, length: number, radius: number, { count = 70, thermal = 5, ring = false } = {}) {
  const wall = Math.max(0.1, radius - 0.3)
  const pos = Array.from({ length: count }, () => {
    const a = rand(0, Math.PI * 2)
    const r = Math.sqrt(Math.random()) * wall
    return new THREE.Vector3(rand(-length / 2, length / 2), Math.cos(a) * r, Math.sin(a) * r)
  })
  const vel = pos.map(() => randomDir(thermal))
  const flash = pos.map(() => 0)
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.27, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), count)
  dots.frustumCulled = false
  parent.add(dots)

  const base = new THREE.Color(ELECTRON)
  const hit = new THREE.Color(RING)
  const color = new THREE.Color()
  const m = new THREE.Matrix4()

  const step = (dt: number, drift: number, scatter = 4) => {
    for (let i = 0; i < count; i++) {
      const p = pos[i]
      const v = vel[i]
      if (Math.random() < dt * scatter) v.copy(randomDir(thermal))
      const before = p.x
      p.x += (v.x - drift) * dt
      p.y += v.y * dt
      p.z += v.z * dt
      if (ring && Math.sign(before) !== Math.sign(p.x) && Math.abs(p.x) < 1) flash[i] = FLASH_S
      if (p.x < -length / 2) p.x += length
      if (p.x > length / 2) p.x -= length
      const r = Math.hypot(p.y, p.z)
      if (r > wall) {
        p.y *= wall / r
        p.z *= wall / r
        v.y = -v.y
        v.z = -v.z
      }
      flash[i] = Math.max(0, flash[i] - dt)
      dots.setMatrixAt(i, m.makeTranslation(p))
      dots.setColorAt(i, color.copy(base).lerp(hit, flash[i] / FLASH_S))
    }
    dots.instanceMatrix.needsUpdate = true
    dots.instanceColor!.needsUpdate = true
  }
  step(0, 0)
  return { mesh: dots, step }
}

/** + charges along `points`, each tinted by `potentialColor(paint(at))`. */
export function plusFlow(parent: THREE.Object3D, points: V3[], paint: (at: THREE.Vector3) => number, closed = false) {
  const flow = new Flow(path(points, closed), 1.5, CONVENTIONAL, 0.3, plusGeometry(0.7))
  flow.colorBy((at, out) => potentialColor(paint(at), out))
  parent.add(flow.mesh)
  return flow
}

/** Beads riding a path (closed by default); `step` moves them by `du` of its length. */
export function loopBeads(parent: THREE.Object3D, n: number, color: string, { r = 0.22, closed = true } = {}) {
  const m = glowMat(color, 1.2)
  const beads = Array.from({ length: n }, () => add(parent, mesh(new THREE.SphereGeometry(r, 12, 8), m)))
  beads.forEach((b) => (b.castShadow = false))
  let curve = path([[0, 0, 0], [1, 0, 0]], closed)
  let s = 0
  return {
    setPath(points: V3[]) {
      curve = path(points, closed)
    },
    show(on: boolean) {
      beads.forEach((b) => (b.visible = on))
    },
    step(du: number) {
      s = frac(s + du)
      beads.forEach((b, i) => b.position.copy(curve.getPointAt(frac(s + i / n))))
    },
  }
}
