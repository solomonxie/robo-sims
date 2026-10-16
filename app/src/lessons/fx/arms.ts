// Serial arm rig driven by `armFk`: bar links, joint housings with turning rotor rings, joint-axis markers, optional frame triads and a gripper (z-up metres; caller scales).
import * as THREE from 'three/webgpu'
import { Mat4, SerialArm, armFk, dhRowAt, mul4, rotAbout4, trans4 } from '../../core/physics'
import { add, mat, mesh } from '../../models/kit'
import { glowMat, setGlow } from './colors'
import { frameTriad, setTf } from './frames'

/** Joint 1, 2, 3, 4… accent colours (rotor rings, axis markers, sliders' legend). */
export const JOINT_COLORS = ['#ff9a4d', '#5ad8e6', '#c38cff', '#f25ca8', '#5ce17a', '#ffd84d'] as const

const BOX = new THREE.BoxGeometry(1, 1, 1)
const DISC = new THREE.CylinderGeometry(1, 1, 1, 32).rotateX(Math.PI / 2)
const RING_GEO = new THREE.TorusGeometry(1, 0.11, 10, 40)

export interface ArmLook {
  /** Bar width and thickness (along the joint axis), metres. */
  w?: number
  t?: number
  link?: string
  housing?: string
  /** Joint-axis rods through each housing. */
  axes?: boolean
  /** Frame triads at frames 0…n, this long (0 = none). */
  triads?: number
  gripper?: boolean
  /** Column below frame 0 down to z = 0 of the base (floor-standing arms). */
  pedestal?: number
}

function placeScaled(o: THREE.Object3D, m: Mat4, s: [number, number, number]) {
  setTf(o, m)
  o.scale.set(...s)
}

/** `set(q)` poses it and returns the frames; `glow(i, k)` lights joint i's rotor ring (0 = idle). */
export function serialArm(parent: THREE.Object3D, arm: SerialArm, look: ArmLook = {}) {
  const { w = 0.024, t = 0.018, link = '#f2c230', housing = '#2a2c32', axes = true, triads = 0, gripper = true, pedestal = 0 } = look
  const g = add(parent, new THREE.Group())
  const linkMat = mat(link, { rough: 0.45, metal: 0.1 })
  const caseMat = mat(housing, { rough: 0.4, metal: 0.2 })
  const steel = mat('#b8bec8', { rough: 0.3, metal: 0.7 })
  if (pedestal > 0) {
    const col = add(g, mesh(DISC, caseMat))
    placeScaled(col, mul4(arm.base, trans4([0, 0, -pedestal / 2])), [w * 1.6, w * 1.6, pedestal])
    const foot = add(g, mesh(DISC, caseMat))
    placeScaled(foot, mul4(arm.base, trans4([0, 0, -pedestal + t * 0.3])), [w * 3, w * 3, t * 0.6])
  }
  const joints = arm.rows.map((r, i) => {
    const c = JOINT_COLORS[i % JOINT_COLORS.length]
    const ringMat = glowMat(c, 0.5)
    const stator = add(g, mesh(r.kind === 'revolute' ? DISC : BOX, caseMat))
    const rotor = add(g, new THREE.Group())
    for (const s of [-1, 1]) {
      const ring = add(rotor, mesh(RING_GEO, ringMat), [0, 0, s * t * 0.78])
      ring.scale.setScalar(w * 1.05)
      ring.castShadow = false
      const tick = add(rotor, mesh(BOX, ringMat), [w * 0.62, 0, s * t * 0.78])
      tick.scale.set(w * 0.55, w * 0.16, t * 0.06)
      tick.castShadow = false
    }
    const axis = axes ? add(g, mesh(DISC, glowMat(c, 0.35))) : null
    if (axis) axis.castShadow = false
    const column = add(g, mesh(DISC, r.kind === 'prismatic' ? steel : linkMat))
    const bar = add(g, mesh(BOX, linkMat))
    const caps = [0, 1].map(() => add(g, mesh(DISC, linkMat)))
    return { r, c, ringMat, stator, rotor, axis, column, bar, caps }
  })
  const tri = triads > 0 ? arm.rows.map((_, i) => frameTriad(g, triads, `${i}`, '#e8e8e8', triads * 0.035, { size: triads * 0.3 })).concat(frameTriad(g, triads, `${arm.rows.length}`, '#e8e8e8', triads * 0.035, { size: triads * 0.3 })) : []
  const grip = gripper ? add(g, new THREE.Group()) : null
  const fingers: THREE.Mesh[] = []
  if (grip) {
    add(grip, mesh(BOX, caseMat), [w * 0.25, 0, 0]).scale.set(w * 0.5, w * 2.2, t * 1.1)
    for (const s of [-1, 1]) fingers.push(add(grip, mesh(BOX, steel), [w * 1.1, s * w * 0.8, 0]))
    fingers.forEach((f) => f.scale.set(w * 1.4, w * 0.22, t * 0.8))
  }

  const set = (q: readonly number[]) => {
    const f = armFk(arm, q)
    joints.forEach((j, i) => {
      const x = dhRowAt(j.r, q[i] ?? 0)
      const prev = f[i]
      if (j.r.kind === 'revolute') placeScaled(j.stator, prev, [w * 1.25, w * 1.25, t * 1.5])
      else placeScaled(j.stator, mul4(prev, trans4([0, 0, t * 0.75])), [w * 1.5, w * 1.5, t * 1.5])
      const turned = mul4(prev, rotAbout4(2, x.theta))
      setTf(j.rotor, turned)
      if (j.axis) placeScaled(j.axis, prev, [w * 0.12, w * 0.12, t * 3.6])
      const lifted = mul4(turned, trans4([0, 0, x.d]))
      const d = Math.abs(x.d)
      j.column.visible = d > 1e-4
      if (j.column.visible) placeScaled(j.column, mul4(turned, trans4([0, 0, x.d / 2])), [w * (j.r.kind === 'prismatic' ? 0.4 : 0.6), w * (j.r.kind === 'prismatic' ? 0.4 : 0.6), d])
      const a = Math.abs(x.a)
      j.bar.visible = a > 1e-4
      j.caps.forEach((c) => (c.visible = j.bar.visible))
      if (j.bar.visible) {
        placeScaled(j.bar, mul4(lifted, trans4([x.a / 2, 0, 0])), [a, w, t])
        placeScaled(j.caps[0], lifted, [w / 2, w / 2, t])
        placeScaled(j.caps[1], mul4(lifted, trans4([x.a, 0, 0])), [w / 2, w / 2, t])
      }
    })
    tri.forEach((tr, i) => setTf(tr.group, f[i]))
    if (grip) setTf(grip, f[f.length - 1])
    return f
  }
  const glow = (i: number, k: number) => {
    const j = joints[i]
    if (j) setGlow(j.ringMat, j.c, 0.5 + k * 1.2)
  }
  const face = () => tri.forEach((tr) => tr.face())
  set(arm.rows.map(() => 0))
  return { group: g, set, glow, face, triads: tri, joints, colors: joints.map((j) => j.c) }
}
