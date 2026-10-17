// Serial arm rig driven by `armFk`: bar links, joint housings with turning rotor rings, joint-axis markers, optional frame triads and a gripper (z-up metres; caller scales).
import * as THREE from 'three/webgpu'
import { ArmServo, Mat4, SERVO_ARM, SerialArm, apply4, armFk, dhRowAt, mul4, rotAbout4, trans4 } from '../../core/physics'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { glowMat, setGlow } from './colors'
import { frameTriad, setTf } from './frames'
import { pointCloud } from './rooms'

/** Slim links for `SERVO_ARM` at desk scale, on a plinth this tall. */
export const SERVO_ARM_LOOK = { w: 0.022, t: 0.017 }
export const PLINTH = 0.014
export const SERVO_JOINT_NAMES = ['base', 'shoulder', 'elbow', 'wrist']
/** Dark base plate under a side-view planar arm. */
export const armPlate = (g: THREE.Object3D, w = 0.11, h = 0.16) => box(g, [w, h, 0.012], mat('#3a3d45', { rough: 0.6 }), [0, 0, -0.03])

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
  /** Finger gap: 1 open … 0 shut. */
  const jaw = (open: number) => fingers.forEach((f, i) => (f.position.y = (i ? 1 : -1) * w * (0.3 + 0.5 * open)))
  set(arm.rows.map(() => 0))
  return { group: g, set, glow, face, jaw, triads: tri, joints, colors: joints.map((j) => j.c) }
}

/** Turns a rig see-through in one flat colour (other IK solutions, past iterations); recolour via the returned material. */
export function ghostRig(o: THREE.Object3D, color: string, opacity = 0.2) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.material = m
      c.castShadow = c.receiveShadow = false
    }
  })
  return m
}

/** Dots drawn fresh each frame: `begin`, add lines/arcs, `end`. */
export function dotPen(parent: THREE.Object3D, max: number, r: number) {
  const pc = pointCloud(parent, max, r)
  let k = 0
  const dot = (p: V3, c: string, s = 1) => {
    if (k < max) pc.set(k++, p, c, s)
  }
  return {
    begin: () => (k = 0),
    end: () => pc.show(k),
    dot,
    line(a: V3, b: V3, step: number, c: string, s = 1) {
      const m = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step))
      for (let i = 0; i <= m; i++) dot([a[0] + ((b[0] - a[0]) * i) / m, a[1] + ((b[1] - a[1]) * i) / m, a[2] + ((b[2] - a[2]) * i) / m], c, s)
    },
    /** Arc in the plane of unit vectors u, v around `o`. */
    arc(o: V3, rad: number, from: number, sweep: number, c: string, s = 1, u: V3 = [1, 0, 0], v: V3 = [0, 1, 0]) {
      const m = Math.max(2, Math.ceil((Math.abs(sweep) * rad) / 0.006))
      for (let i = 0; i <= m; i++) {
        const a = from + (sweep * i) / m
        const [ca, sa] = [Math.cos(a) * rad, Math.sin(a) * rad]
        dot([o[0] + ca * u[0] + sa * v[0], o[1] + ca * u[1] + sa * v[1], o[2] + ca * u[2] + sa * v[2]], c, s)
      }
    },
  }
}

/** Body size (length, width, height along the shaft, m) and colour of each hobby servo; the shaft sits W/2 from one end. */
const SERVO_LOOK: Record<ArmServo, { size: V3; color: string }> = {
  sg90: { size: [0.023, 0.0122, 0.0225], color: '#2a5bd7' },
  mg90s: { size: [0.0228, 0.0122, 0.0284], color: '#3b3f48' },
  mg996r: { size: [0.0407, 0.0197, 0.0429], color: '#16181d' },
}
/** Which way each servo body runs from its shaft in its joint frame: base under the turntable, shoulder hanging down, elbow and wrist back along their links, gripper servo on the hand. */
const MOUNT_TURN = [0, Math.PI / 2, 0, 0, 0]

/** `SERVO_ARM` as a hobby build: aluminium brackets, a servo body beside every joint (+ gripper servo), acrylic base box `baseH` tall
 *  under frame 0. `set(q)` → frames; `fit(i, kind)` swaps a servo; `heat(i, k)` glows a body red; `ports(f)` = cable exits (arm space). */
export function servoArmBuild(parent: THREE.Object3D, kinds: readonly ArmServo[], baseH = 0.05) {
  const t = 0.017
  const rig = serialArm(parent, SERVO_ARM, { w: 0.022, t, link: '#c9ccd2', housing: '#30333a', axes: false })
  add(rig.group, mesh(BOX, mat('#2b2f38', { rough: 0.35, metal: 0.1 })), [-0.005, 0, -baseH / 2]).scale.set(0.085, 0.07, baseH)
  const bodies = kinds.map(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.45, emissive: '#ff3b30', emissiveIntensity: 0 })
    const holder = add(rig.group, new THREE.Group())
    const body = add(holder, mesh(BOX, m))
    const horn = add(holder, mesh(DISC, mat('#f2f2f2', { rough: 0.4 })))
    return { holder, body, horn, m, kind: kinds[0], back: [0, 0, 0] as V3 }
  })
  const fit = (i: number, kind: ArmServo) => {
    const b = bodies[i]
    const [L, W, H] = SERVO_LOOK[kind].size
    const z = i === 0 ? -0.004 - H / 2 : -(t * 0.75 + H / 2)
    b.kind = kind
    b.m.color.set(SERVO_LOOK[kind].color)
    b.body.position.set(-(L / 2 - W / 2), 0, z)
    b.body.scale.set(L, W, H)
    b.horn.position.set(0, 0, i === 0 ? 0 : -t * 0.62)
    b.horn.scale.set(W * 0.42, W * 0.42, 0.002)
    b.back = [-(L - W / 2), 0, z]
  }
  kinds.forEach((k, i) => fit(i, k))
  const mount = (f: Mat4[], i: number) => mul4(f[Math.min(i, f.length - 1)], rotAbout4(2, MOUNT_TURN[i] ?? 0))
  const set = (q: readonly number[]) => {
    const f = rig.set(q)
    bodies.forEach((b, i) => setTf(b.holder, mount(f, i)))
    return f
  }
  set([0, 0, 0, 0])
  return {
    rig,
    group: rig.group,
    set,
    fit,
    heat: (i: number, k: number) => (bodies[i].m.emissiveIntensity = 0.9 * Math.max(0, Math.min(1, k))),
    ports: (f: Mat4[]): V3[] => bodies.map((b, i) => apply4(mount(f, i), b.back) as V3),
  }
}
