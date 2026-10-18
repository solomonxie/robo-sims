// Wheeled robots on a floor, in metres (x forward, y left, z up) inside a `floorView`: TT two-wheeler, an Ackermann RC car and a two-wheeled self-balancer.
import * as THREE from 'three/webgpu'
import { ACKERMANN, BALANCER, Pose, TT_TRACK_M, TT_WHEEL_MM } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import { B_FIELD, GREY, HEAT, HIGH_V, POWER, glowMat, setGlow } from './colors'
import { placeAt } from './drive'
import { addRod, stretchRod } from './layout'
import { IDLE } from './mcu'
import { esp32Board, i2cBreakout, sg90Servo } from './modules'
import { flatBox, stretchArrow } from './shapes'

const WHEEL_R = TT_WHEEL_MM / 2000
export const KIT_UNIT_M = 0.00254

export function slipPatch(parent: THREE.Object3D, size: V3, at: V3) {
  const pm = glowMat(HIGH_V, 0)
  pm.transparent = true
  pm.opacity = 0
  pm.depthWrite = false
  box(parent, size, pm, at).castShadow = false
  return pm
}
export const lightPatches = (patches: THREE.MeshStandardMaterial[], u: number[]) =>
  u.forEach((v, i) => {
    if (!patches[i]) return
    setGlow(patches[i], HIGH_V, 1.6 * v)
    patches[i].opacity = Math.min(1, v * 1.2)
  })

/** Two-wheel TT robot (65 mm wheels, caster at the back); `set(pose, left m, right m)` places it and rolls the wheels, `slip(l, r)` lights the contact patches 0…1.
 *  With `ghost` it is a see-through glowing footprint (an odometry estimate). */
export function diffBot(parent: THREE.Object3D, { track = TT_TRACK_M, ghost }: { track?: number; ghost?: string } = {}) {
  const group = add(parent, new THREE.Group())
  const half = track / 2
  const wheels: THREE.Group[] = []
  const patches: THREE.MeshStandardMaterial[] = []
  if (ghost) {
    const m = glowMat(ghost, 1)
    const [L, W, t] = [0.17, track + 0.03, 0.006]
    for (const [size, at] of [
      [[L, t, t], [-0.02, W / 2, 0.07]],
      [[L, t, t], [-0.02, -W / 2, 0.07]],
      [[t, W, t], [0.065, 0, 0.07]],
      [[t, W, t], [-0.105, 0, 0.07]],
    ] as [V3, V3][])
      box(group, size, m, at).castShadow = false
    const nose = add(group, mesh(new THREE.ConeGeometry(0.03, 0.06, 12), glowMat(ghost, 1.2)), [0.1, 0, 0.07])
    nose.rotation.z = -Math.PI / 2
    nose.castShadow = false
  } else {
    box(group, [0.17, track - 0.035, 0.004], mat('#e8ecf2', { rough: 0.3, opacity: 0.85 }), [-0.02, 0, 0.05])
    box(group, [0.07, 0.03, 0.02], mat('#2a2c32', { rough: 0.6 }), [-0.05, 0, 0.063])
    box(group, [0.05, 0.028, 0.003], mat('#1d6fd1', { rough: 0.5 }), [0.03, 0, 0.055])
    box(group, [0.008, 0.006, 0.003], glowMat('#ff5a7a', 1), [0.055, 0.008, 0.058])
    for (const s of [1, -1]) box(group, [0.07, 0.022, 0.019], mat('#f2c12e', { rough: 0.55 }), [0.0, s * (half - 0.03), 0.034])
    cylinder(group, 0.006, 0.03, mat('#8a8f99', { metal: 0.3, rough: 0.4 }), [-0.08, 0, 0.026], 'z', 10)
    add(group, mesh(new THREE.SphereGeometry(0.008, 12, 8), mat('#d4d7dc', { metal: 0.4, rough: 0.3 })), [-0.08, 0, 0.008])
    for (const s of [1, -1]) {
      const w = add(group, new THREE.Group(), [0, s * half, WHEEL_R])
      const tyre = add(w, buildWheel())
      tyre.scale.setScalar(KIT_UNIT_M)
      tyre.rotation.x = -s * (Math.PI / 2)
      wheels.push(w)
      patches.push(slipPatch(group, [0.05, 0.034, 0.002], [0, s * half, 0.002]))
    }
  }
  return {
    group,
    set(p: Pose, dL = 0, dR = 0) {
      placeAt(group, p)
      if (wheels.length) {
        wheels[0].rotation.y = dL / WHEEL_R
        wheels[1].rotation.y = dR / WHEEL_R
      }
    },
    slip(l: number, r: number) {
      lightPatches(patches, [l, r])
    },
  }
}

/** 1/10 Ackermann RC car, rear-axle centre at the origin: SG90 servo → centre link → tie rods → steering arms on the front knuckles, rear axle through a differential.
 *  `set(pose, [left, right] steer, travel[4])` steers, rolls FL FR RL RR and moves the linkage; `arms(beta)` angles the steering arms (Ackermann > 0 aims them at the rear axle, 0 parallel, < 0 anti); `scrub(u[4])` lights tyre patches. */
export function rcCar(parent: THREE.Object3D) {
  const { wheelbase: L, track: T, wheelR: R } = ACKERMANN
  const group = add(parent, new THREE.Group())
  const off = 0.022
  const plate = mat('#3b4048', { metal: 0.4, rough: 0.45 })
  box(group, [0.36, 0.12, 0.004], plate, [0.11, 0, 0.026])
  box(group, [0.03, 0.2, 0.004], plate, [L, 0, 0.03])
  box(group, [0.11, 0.045, 0.024], mat('#2a6fd1', { rough: 0.5 }), [0.11, 0.025, 0.04])
  box(group, [0.04, 0.035, 0.016], mat('#1f2126', { rough: 0.6 }), [0.12, -0.04, 0.036])
  box(group, [0.008, 0.012, 0.003], glowMat('#ff5a7a', 1), [0.14, -0.04, 0.045])
  cylinder(group, 0.014, 0.04, mat('#b8bcc4', { metal: 0.6, rough: 0.3 }), [0.045, 0, 0.04], 'x', 18)
  box(group, [0.032, 0.04, 0.034], mat('#c9ccd2', { metal: 0.5, rough: 0.35 }), [0, 0, R])
  cylinder(group, 0.016, 0.006, glowMat(POWER, 0.4), [0, 0.022, R], 'y', 20).castShadow = false
  cylinder(group, 0.004, T + 2 * off - 0.03, mat('#9aa0aa', { metal: 0.7, rough: 0.3 }), [0, 0, R], 'y', 8)
  const tread = mat('#2b2d33', { rough: 0.9 })
  const rim = mat('#e0e3e8', { metal: 0.5, rough: 0.3 })
  const tyre = (at: THREE.Object3D, y: number) => {
    const roll = add(at, new THREE.Group(), [0, y, R])
    cylinder(roll, R, 0.03, tread, [0, 0, 0], 'y', 28)
    cylinder(roll, R * 0.62, 0.032, rim, [0, 0, 0], 'y', 6)
    box(roll, [R * 1.25, 0.034, 0.008], glowMat('#ff8c2e', 0.6), [0, 0, 0])
    return roll
  }
  const steelM = mat('#c9ccd2', { metal: 0.6, rough: 0.3 })
  const knuckles = [1, -1].map((s) => {
    const k = add(group, new THREE.Group(), [L, (s * T) / 2, 0])
    cylinder(k, 0.006, 0.05, steelM, [0, 0, R], 'z', 10)
    return { k, roll: tyre(k, s * off), s }
  })
  const rear = [1, -1].map((s) => tyre(add(group, new THREE.Group(), [0, (s * T) / 2, 0]), s * off))
  const linkM = glowMat(B_FIELD, 0.5)
  const armM = mat('#d4d7dc', { metal: 0.6, rough: 0.3 })
  const armRods = knuckles.map(() => addRod(group, armM))
  const tieRods = knuckles.map(() => addRod(group, linkM))
  const centre = addRod(group, linkM)
  const servo = add(group, new THREE.Group())
  servo.scale.setScalar(0.008)
  servo.rotation.z = Math.PI / 2
  const horn = sg90Servo(servo, [0, 0, 0])
  const hornLen = 0.0176
  const zr = R + 0.012
  const patches = [...knuckles.map((k) => slipPatch(group, [0.04, 0.03, 0.002], [L, k.s * (T / 2 + off), 0.002])), ...[1, -1].map((s) => slipPatch(group, [0.04, 0.03, 0.002], [0, s * (T / 2 + off), 0.002]))]
  const st = { beta: Math.atan(T / 2 / L), a: 0.032, angles: [0, 0] as number[] }
  const tip = (i: number, angle: number): V3 => {
    const s = knuckles[i].s
    const [dx, dy] = [-Math.cos(st.beta) * st.a, -s * Math.sin(st.beta) * st.a]
    return [L + dx * Math.cos(angle) - dy * Math.sin(angle), (s * T) / 2 + dx * Math.sin(angle) + dy * Math.cos(angle), zr]
  }
  const linkage = () => {
    const tips = [0, 1].map((i) => tip(i, st.angles[i]))
    const rest = [0, 1].map((i) => tip(i, 0))
    const shift = (tips[0][1] - rest[0][1] + tips[1][1] - rest[1][1]) / 2
    const lx = rest[0][0] - 0.004
    const ends = rest.map((r): V3 => [lx, r[1] * 0.55 + shift, zr])
    knuckles.forEach((k, i) => {
      stretchRod(armRods[i], [L, (k.s * T) / 2, zr], tips[i], 0.004)
      stretchRod(tieRods[i], ends[i], tips[i], 0.0025)
    })
    stretchRod(centre, ends[0], ends[1], 0.0035)
    servo.position.set(lx + hornLen, 0.006, 0.032)
    horn.rotation.z = -Math.asin(Math.max(-1, Math.min(1, shift / hornLen)))
  }
  linkage()
  return {
    group,
    set(p: Pose, angles: number[], travel: number[]) {
      placeAt(group, p)
      st.angles = angles
      knuckles.forEach((k, i) => {
        k.k.rotation.z = angles[i]
        k.roll.rotation.y = travel[i] / R
      })
      rear.forEach((r, i) => (r.rotation.y = travel[2 + i] / R))
      linkage()
    },
    arms(beta: number) {
      st.beta = beta
      linkage()
    },
    scrub(u: number[]) {
      lightPatches(patches, u)
    },
  }
}

/** Body height above the axle of a `balanceBot` with its CoM `h` up. */
export const balanceBotHeight = (h: number) => Math.max(0.1, 2 * h - 0.03)

/** Two-wheeled self-balancer (TT motors, MPU-6050 low on the front, ESP32 deck, 2×18650 on top), CoM about `h` above the axle;
 *  `shift` moves the battery forward (m), `packZ` puts its centre that high above the axle (default: on the top deck).
 *  `set(tilt, roll)` leans the body about the axle and turns the wheels by `roll` m. */
export function balanceBot(parent: THREE.Object3D, { h = BALANCER.h, shift = 0, packZ = 0 } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, new THREE.Group(), [0, 0, WHEEL_R])
  const H = balanceBotHeight(h)
  const deck = mat('#e8ecf2', { rough: 0.3, opacity: 0.85 })
  const brass = mat('#c9a24a', { metal: 0.4, rough: 0.4 })
  for (const s of [1, -1]) box(body, [0.065, 0.022, 0.019], mat('#f2c12e', { rough: 0.55 }), [0.012, s * 0.045, 0])
  const decks = [0.016, H * 0.55, H]
  decks.forEach((z) => box(body, [0.09, 0.13, 0.003], deck, [0, 0, z]))
  for (const x of [-0.038, 0.038]) for (const y of [-0.058, 0.058]) cylinder(body, 0.0025, H - 0.016, brass, [x, y, (0.016 + H) / 2], 'z', 8)
  const face = (z: number) => {
    const g = add(body, new THREE.Group(), [0, -0.066, z])
    g.rotation.x = Math.PI / 2
    return g
  }
  const imu = i2cBreakout(face(0.04), [0, 0, 0], { name: 'MPU-6050', k: 0.001 })
  esp32Board(face(decks[1] + 0.02), [-0.009, 0, 0], KIT_UNIT_M)
  box(body, [0.03, 0.022, 0.01], mat('#c8323c', { rough: 0.5 }), [0, 0, 0.026])
  const pack = add(body, new THREE.Group(), [shift, 0, packZ || H + 0.013])
  box(pack, [0.078, 0.042, 0.004], mat('#1c1c1f', { rough: 0.7 }), [0, 0, -0.01])
  for (const y of [-0.0095, 0.0095]) cylinder(pack, 0.009, 0.065, mat('#2f6fd0', { rough: 0.45 }), [0, y, 0], 'x', 16)
  const wheels = [1, -1].map((s) => {
    const w = add(group, new THREE.Group(), [0, s * 0.075, WHEEL_R])
    const tyre = add(w, buildWheel())
    tyre.scale.setScalar(KIT_UNIT_M)
    tyre.rotation.x = -s * (Math.PI / 2)
    return w
  })
  return {
    group,
    body,
    imu,
    height: H,
    set(tilt: number, roll: number) {
      body.rotation.y = tilt
      wheels.forEach((w) => (w.rotation.y = roll / WHEEL_R))
    },
  }
}

/** Side view of a `balanceBot` in metres: x forward (screen right), z up, −y toward the viewer; a floor whose 0.1 m tape scrolls under a robot that stays put. */
export function balanceFloor(parent: THREE.Object3D, origin: V3, k: number, half: number) {
  const g = add(parent, new THREE.Group(), origin)
  g.scale.setScalar(k)
  g.rotation.x = -Math.PI / 2 + 0.22
  flatBox(g, [2 * half, 0.2, 0.01], glowMat(IDLE, 0.12), [0, 0, -0.005])
  const tapeM = glowMat(GREY, 0.25)
  const tape = Array.from({ length: Math.round(2 * half * 10) }, () => flatBox(g, [0.004, 0.2, 0.004], tapeM, [0, 0, 0.002]))
  const span = tape.length * 0.1
  return {
    g,
    roll(x: number) {
      tape.forEach((b, i) => (b.position.x = ((((i * 0.1 - x) % span) + span) % span) - half))
    },
  }
}
/** Point `up` metres along a `balanceBot`'s body axis above the axle, leaning `tilt`, at depth `y`. */
export const onBalancer = (tilt: number, up: number, y = -0.1, along = 0): V3 => [
  up * Math.sin(tilt) + along * Math.cos(tilt),
  y,
  BALANCER.wheelR + up * Math.cos(tilt) - along * Math.sin(tilt),
]

/** Shove arrow at the head, wheel-acceleration arrow (red when clipped) and a target flag, on a `balanceFloor` group. */
export function balanceCues(g: THREE.Object3D, half: number) {
  const shove = stretchArrow(g, HEAT, 0.004)
  const push = stretchArrow(g, POWER, 0.004)
  const flag = add(g, new THREE.Group())
  flatBox(flag, [0.004, 0.004, 0.16], glowMat(B_FIELD, 0.8), [0, -0.1, 0.08])
  flatBox(flag, [0.05, 0.003, 0.03], glowMat(B_FIELD, 1), [0.025, -0.1, 0.145])
  return (f: { tilt: number; x: number; ref: number; got: number; sat: boolean }, pushed: boolean) => {
    const top = onBalancer(f.tilt, BALANCER.h * 1.6, -0.1, -0.05)
    shove(pushed ? [top[0] - 0.08, top[1], top[2]] : top, top)
    push([0, -0.1, 0.004], [f.got * 0.12, -0.1, 0.004], f.sat ? HIGH_V : POWER)
    const d = f.ref - f.x
    flag.visible = Math.abs(d) < half - 0.03
    flag.position.x = d
  }
}
