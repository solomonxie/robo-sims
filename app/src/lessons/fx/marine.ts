// Underwater robots in metres (x forward, y left, z up): a BlueROV2-style vectored ROV with foam, lead and six T200s; a glass tank.
import * as THREE from 'three/webgpu'
import { ROV, THRUSTERS } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { B_FIELD, HEAT, POWER, glowMat } from './colors'
import { Flow } from './flows'
import { shellMat, stretchArrow } from './shapes'

export const WATER_TINT = '#3a8fd0'
const FOAM_SLOTS: V3[] = [0.08, 0.14, 0.2].flatMap((z): V3[] => [[0.1, 0, z], [-0.1, 0, z]])
const LEAD_SLOTS: V3[] = [-0.15, -0.09, -0.03, 0.03, 0.09, 0.15, 0.21, -0.21].flatMap((x): V3[] => [[x, 0.13, 0], [x, -0.13, 0]])
const DUCT_R = 0.045

/** BlueROV2-style ROV (457 × 338 × 254 mm). `trim(foam, lead, foamLow)` shows foam slabs (1 L) on top and lead bars on the skids (swapped when foamLow);
 *  `set(spin, share, colors)` turns each thruster's prop and sizes its force arrow (share −1…1 along its axis); `wake(dt, share)` blows bubbles out of the ducts. */
export function rovModel(parent: THREE.Object3D, { arrowLen = 0.2, arrowR = 0.005, bubbles = false } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, new THREE.Group())
  const hdpe = mat('#24272d', { rough: 0.7 })
  for (const y of [-0.165, 0.165]) {
    box(body, [0.43, 0.012, 0.2], hdpe, [0, y, -0.01])
    box(body, [0.3, 0.013, 0.07], mat('#30343b', { rough: 0.7 }), [0, y, -0.01])
  }
  for (const x of [-0.2, 0.2]) for (const z of [-0.1, 0.07]) cylinder(body, 0.008, 0.33, hdpe, [x, 0, z], 'y', 10)
  const tube = cylinder(body, 0.057, 0.3, shellMat('#bfe6ff', 0.28), [0, 0, 0.02], 'x', 32)
  tube.castShadow = false
  box(body, [0.22, 0.07, 0.004], mat('#1d5e3a', { rough: 0.5 }), [0, 0, 0.02])
  const alu = mat('#8d939c', { metal: 0.35, rough: 0.4 })
  cylinder(body, 0.06, 0.012, alu, [-0.15, 0, 0.02], 'x', 32)
  cylinder(body, 0.06, 0.012, alu, [0.15, 0, 0.02], 'x', 32)
  const dome = add(body, mesh(new THREE.SphereGeometry(0.057, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shellMat('#d8f0ff', 0.3)), [0.156, 0, 0.02])
  dome.rotation.z = -Math.PI / 2
  cylinder(body, 0.014, 0.02, mat('#0d1a2a', { rough: 0.2, metal: 0.3 }), [0.16, 0, 0.02], 'x', 16)
  for (const y of [-0.035, 0.035]) box(body, [0.012, 0.02, 0.02], glowMat('#fff6d8', 1.2), [0.2, y, 0.045])
  cylinder(body, 0.04, 0.25, alu, [0, 0, -0.075], 'x', 24)
  cylinder(body, 0.003, 0.25, mat('#e0b020', { rough: 0.5 }), [-0.16, 0, 0.07], 'x', 6).rotation.z = 0.4

  const foamM = mat('#d9a521', { rough: 0.85 })
  const foam = FOAM_SLOTS.map((p) => box(body, [0.11, 0.13, 0.058], foamM, p))
  const leadM = mat('#6f7378', { metal: 0.2, rough: 0.55 })
  const lead = LEAD_SLOTS.map((p) => box(body, [0.05, 0.024, 0.014], leadM, p))

  const shroud = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5, side: THREE.DoubleSide })
  const arrows: ((a: V3, b: V3, c?: string) => void)[] = []
  const wakes: { g: THREE.Group; flow: Flow }[] = []
  const thr = THRUSTERS.map((t, i) => {
    const mount = add(body, new THREE.Group(), [t.x, t.y, t.z])
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...t.dir))
    const duct = add(mount, mesh(new THREE.CylinderGeometry(DUCT_R, DUCT_R, 0.05, 28, 1, true), shroud))
    duct.rotation.x = Math.PI / 2
    cylinder(mount, 0.017, 0.07, mat('#2c2f36', { rough: 0.4 }), [0, 0, -0.01], 'z', 16)
    const rotor = add(mount, new THREE.Group(), [0, 0, 0.012])
    const blade = mat(i < 4 ? '#3fa7ff' : '#6fe0b0', { rough: 0.4 })
    for (let k = 0; k < 3; k++) {
      const a = add(rotor, new THREE.Group())
      a.rotation.z = (k * 2 * Math.PI) / 3
      const b = box(a, [DUCT_R - 0.02, 0.016, 0.002], blade, [(DUCT_R + 0.014) / 2, 0, 0])
      b.rotation.x = 0.4
    }
    arrows.push(stretchArrow(mount, POWER, arrowR))
    if (bubbles) {
      const g = add(mount, new THREE.Group())
      const flow = new Flow(new THREE.LineCurve3(new THREE.Vector3(0, 0, -0.03), new THREE.Vector3(0, 0, -0.33)), 0.035, '#d8f0ff', 0.006)
      add(g, flow.mesh)
      wakes.push({ g, flow })
    }
    return rotor
  })

  return {
    group,
    body,
    trim(foamN: number, leadN: number, foamLow = false) {
      foam.forEach((b, i) => {
        b.visible = i < foamN
        b.position.z = (foamLow ? -1 : 1) * FOAM_SLOTS[i][2] + (foamLow ? -0.03 : 0)
      })
      lead.forEach((b, i) => {
        b.visible = i < leadN
        b.position.z = foamLow ? -ROV.lead.z - 0.01 : ROV.lead.z
      })
    },
    set(spin: readonly number[], share: readonly number[], colors: readonly string[] = []) {
      thr.forEach((r, i) => {
        r.rotation.z = spin[i]
        const s = share[i]
        arrows[i]([0, 0, 0], [0, 0, (DUCT_R + arrowLen * Math.abs(s)) * Math.sign(s)], colors[i] ?? (s >= 0 ? POWER : HEAT))
      })
    },
    wake(dt: number, share: readonly number[]) {
      wakes.forEach((w, i) => {
        const s = share[i]
        w.g.visible = Math.abs(s) > 0.03
        w.g.scale.z = s >= 0 ? 1 : -1
        w.flow.step(dt * (0.08 + 0.5 * Math.abs(s)))
      })
    },
  }
}

/** Glass tank in metres, `size` = [x, y, depth] with the water surface at z = 0 and the floor at −depth. */
export function waterTank(parent: THREE.Object3D, size: V3) {
  const [sx, sy, d] = size
  const g = add(parent, new THREE.Group())
  const water = add(g, mesh(new THREE.BoxGeometry(sx, sy, d), shellMat(WATER_TINT, 0.1)), [0, 0, -d / 2])
  water.castShadow = water.receiveShadow = false
  const surface = add(g, mesh(new THREE.PlaneGeometry(sx, sy), shellMat(B_FIELD, 0.22)), [0, 0, 0])
  surface.castShadow = false
  box(g, [sx + 0.04, sy + 0.04, 0.02], mat('#2a3038', { rough: 0.8 }), [0, 0, -d - 0.01])
  const rim = mat('#59606b', { metal: 0.3, rough: 0.5 })
  for (const y of [-sy / 2, sy / 2]) {
    box(g, [sx + 0.03, 0.015, 0.015], rim, [0, y, 0.06])
    box(g, [0.015, 0.015, d + 0.07], rim, [-sx / 2, y, -d / 2 + 0.03])
  }
  return { group: g, surface, water }
}
