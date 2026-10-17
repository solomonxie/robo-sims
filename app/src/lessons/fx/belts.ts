// Timing pulleys and belt loops (face-on, xy plane), and shaft couplers along x; `k` scene units per mm.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { ringTube } from './bearings'

const ALU = () => mat('#c9ced6', { metal: 0.55, rough: 0.35 })
const RUBBER = '#2a2c31'

/** GT2-style pulley face-on (axis z): `z` teeth of pitch `p` mm, flange behind, hub boss with a set screw in front. */
export function timingPulley(parent: THREE.Object3D, z: number, k: number, at: V3 = [0, 0, 0], { p = 2, width = 7 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const alu = ALU()
  const rp = ((z * p) / (2 * Math.PI)) * k
  const w = width * k
  cylinder(group, rp - 0.75 * k, w, alu, [0, 0, 0], 'z', Math.max(24, z * 2))
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8 * k, p * 0.5 * k, w), alu, z)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const one = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < z; i++) {
    const a = ((i + 0.5) / z) * 2 * Math.PI
    teeth.setMatrixAt(i, m.compose(new THREE.Vector3((rp - 0.45 * k) * Math.cos(a), (rp - 0.45 * k) * Math.sin(a), 0), q.setFromAxisAngle(Z, a), one))
  }
  group.add(teeth)
  cylinder(group, rp + 1.4 * k, 0.8 * k, alu, [0, 0, -w / 2 - 0.4 * k], 'z', 48)
  const boss = Math.max(rp * 0.6, 4.5 * k)
  cylinder(group, boss, 4 * k, alu, [0, 0, w / 2 + 2 * k], 'z', 32)
  cylinder(group, 1.2 * k, 0.3 * k, mat('#1d1e22'), [0, boss * 0.6, w / 2 + 4.1 * k], 'z', 6)
  return { group, rp }
}

/** Open belt loop over pulleys of pitch radius r1 (at 0) and r2 (at C, 0), mm; teeth inside, every 10th tooth lighter.
 *  `set(travel, sag)`: belt moved `travel` mm (anticlockwise round the small pulley), lower span sagging `sag` scene units. */
export function beltLoop(parent: THREE.Object3D, r1: number, r2: number, C: number, k: number, at: V3 = [0, 0, 0], { p = 2, width = 6 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const phi = Math.asin(Math.min(1, (r2 - r1) / C))
  const span = Math.sqrt(Math.max(0, C * C - (r2 - r1) ** 2))
  const a1 = r1 * (Math.PI - 2 * phi)
  const a2 = r2 * (Math.PI + 2 * phi)
  const L = 2 * span + a1 + a2
  const count = Math.round(L / p)
  const step = L / count
  const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(step * k * 1.04, 0.9 * k, width * k), mat(RUBBER, { rough: 0.8 }), count)
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(step * k * 0.5, 0.75 * k, width * k), new THREE.MeshStandardMaterial({ roughness: 0.8 }), count)
  for (let i = 0; i < count; i++) teeth.setColorAt(i, new THREE.Color(i % 10 ? RUBBER : '#d9d4c7'))
  group.add(backs, teeth)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const one = new THREE.Vector3(1, 1, 1)
  const pos = new THREE.Vector3()
  const lo1 = 1.5 * Math.PI - phi
  const hi = 0.5 * Math.PI + phi
  /** Point and direction of travel at arc length s along the pitch line. */
  const at_ = (s: number, sag: number): [number, number, number] => {
    if (s < a1) {
      const a = hi + s / r1
      return [r1 * Math.cos(a), r1 * Math.sin(a), a + Math.PI / 2]
    }
    s -= a1
    if (s < span) {
      const u = s / span
      const x0 = r1 * Math.cos(lo1)
      const y0 = r1 * Math.sin(lo1)
      const x1 = C + r2 * Math.cos(lo1)
      const y1 = r2 * Math.sin(lo1)
      const dip = sag / k
      return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - dip * 4 * u * (1 - u), Math.atan2(y1 - y0 - (dip * 4 * (1 - 2 * u)), x1 - x0)]
    }
    s -= span
    if (s < a2) {
      const a = lo1 + s / r2
      return [C + r2 * Math.cos(a), r2 * Math.sin(a), a + Math.PI / 2]
    }
    s -= a2
    const u = s / span
    const x0 = C + r2 * Math.cos(hi)
    const y0 = r2 * Math.sin(hi)
    const x1 = r1 * Math.cos(hi)
    const y1 = r1 * Math.sin(hi)
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, Math.atan2(y1 - y0, x1 - x0)]
  }
  return {
    group,
    length: L,
    set(travel: number, sag = 0) {
      for (let i = 0; i < count; i++) {
        const s = (((i * step + travel) % L) + L) % L
        const [x, y, dir] = at_(s, sag)
        q.setFromAxisAngle(Z, dir)
        const nx = -Math.sin(dir)
        const ny = Math.cos(dir)
        backs.setMatrixAt(i, m.compose(pos.set((x - nx * 0.45) * k, (y - ny * 0.45) * k, 0), q, one))
        teeth.setMatrixAt(i, m.compose(pos.set((x + nx * 0.4) * k, (y + ny * 0.4) * k, 0), q, one))
      }
      backs.instanceMatrix.needsUpdate = true
      teeth.instanceMatrix.needsUpdate = true
    },
  }
}

type CouplerLook = 'rigid' | 'helical' | 'jaw'

/** Shaft coupler along +x from 0 to `len` mm, outside diameter `od`; set screws on top of each hub.
 *  `set(spin, rise)`: hubs turn about their axes, the right end sits `rise` scene units higher (the flexible middle takes it). */
export function couplerModel(parent: THREE.Object3D, look: CouplerLook, k: number, at: V3 = [0, 0, 0], { len = 25, od = 19 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const alu = ALU()
  const dark = mat('#1d1e22')
  const r = (od / 2) * k
  const L = len * k
  const hubL = look === 'rigid' ? L / 2 : L * 0.3
  const hub = (x0: number) => {
    const g = add(group, new THREE.Group(), [x0 + hubL / 2, 0, 0])
    cylinder(g, r, hubL, alu, [0, 0, 0], 'x', 32)
    cylinder(g, 1.3 * k, 0.4 * k, dark, [0, r, 0], 'y', 6)
    box(g, [hubL * 0.9, 0.3 * k, 0.3 * k], dark, [0, 0, r])
    return g
  }
  const left = hub(0)
  const right = hub(L - hubL)
  const middle: THREE.Object3D[] = []
  if (look === 'helical') {
    const rings = 7
    for (let i = 0; i < rings; i++) {
      const ring = add(group, new THREE.Group(), [hubL + ((i + 0.5) / rings) * (L - 2 * hubL), 0, 0])
      add(ring, mesh(new THREE.TorusGeometry(r * 0.86, r * 0.14, 8, 32), alu)).rotation.y = Math.PI / 2 + 0.25
      middle.push(ring)
    }
  } else if (look === 'jaw') {
    const jaws = (g: THREE.Object3D, dir: number, phase: number) => {
      for (let j = 0; j < 3; j++) {
        const a = phase + (j * 2 * Math.PI) / 3
        box(g, [L * 0.22, r * 0.55, r * 0.55], alu, [dir * (hubL / 2 + L * 0.1), r * 0.62 * Math.cos(a), r * 0.62 * Math.sin(a)])
      }
    }
    jaws(left, 1, 0)
    jaws(right, -1, Math.PI / 3)
    const spider = add(group, new THREE.Group(), [L / 2, 0, 0])
    const ring = ringTube(spider, r * 0.3, r * 0.95, L * 0.16, mat('#d23b3b', { rough: 0.6 }))
    ring.rotation.set(0, 0, Math.PI / 2)
    middle.push(spider)
  }
  return {
    group,
    left,
    right,
    length: L,
    set(spin: number, rise: number) {
      left.rotation.x = spin
      right.rotation.x = spin
      right.position.y = rise
      const span = L - 2 * hubL
      middle.forEach((o) => {
        const u = (o.position.x - hubL) / Math.max(span, 1e-9)
        o.position.y = rise * (3 * u * u - 2 * u * u * u)
        o.rotation.x = spin
        o.rotation.z = (rise / Math.max(span, 1e-9)) * 6 * u * (1 - u)
      })
    },
  }
}
