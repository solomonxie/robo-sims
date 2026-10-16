// Servo-legged robots: hexapod/quadruped walker (3 SG90s per leg) and a small biped.
import * as THREE from 'three/webgpu'
import { BIPED, Pose, Walker } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { GREY, POWER, glowMat, setGlow } from './colors'
import { placeAt } from './drive'
import { addLabel } from './text'

const SERVO = '#2a5bd7'
const LINK = '#d9dce2'

/** SG90 body (23 × 12 × 22 mm) with its output horn on local +y. */
function servoBox(parent: THREE.Object3D, at: V3, axis: 'y' | 'z' = 'y') {
  const g = add(parent, new THREE.Group(), at)
  if (axis === 'z') g.rotation.x = -Math.PI / 2
  box(g, [0.023, 0.022, 0.012], mat(SERVO, { rough: 0.5 }), [0.005, 0, 0])
  box(g, [0.032, 0.022, 0.0025], mat(SERVO, { rough: 0.5 }), [0.005, 0, 0])
  cylinder(g, 0.006, 0.004, mat('#f2f2f2'), [0, 0.013, 0], 'y', 16)
  return g
}

/** Spider-style walker in metres, legs from `w.mounts`: coxa yaw, femur and tibia pitch servos.
 *  `set(pose, angles, down)` places it and bends every leg ({ yaw, hip, knee } from `legAngles`), lighting the feet on the ground. */
export function servoWalker(parent: THREE.Object3D, w: Walker, { names = true } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, new THREE.Group(), [0, 0, w.height])
  const xs = w.mounts.map((m) => Math.abs(m[0]))
  const ys = w.mounts.map((m) => Math.abs(m[1]))
  const [bl, bw] = [2 * Math.max(...xs) + 0.04, 2 * Math.max(...ys) + 0.012]
  const plate = mat('#2b2f38', { rough: 0.6 })
  box(body, [bl, bw, 0.004], plate, [0, 0, 0.009])
  box(body, [bl, bw, 0.004], plate, [0, 0, -0.009])
  box(body, [bl * 0.5, bw * 0.45, 0.004], mat('#1d1f24', { rough: 0.5 }), [-0.005, 0, 0.013])
  box(body, [0.06, 0.03, 0.016], mat('#3a76c4', { rough: 0.5 }), [-0.01, 0, -0.02])
  box(body, [0.008, bw * 0.4, 0.004], glowMat(POWER, 0.8), [bl / 2 + 0.002, 0, 0.012]).castShadow = false
  const link = mat(LINK, { metal: 0.3, rough: 0.4 })
  const legs = w.mounts.map(([mx, my, yaw0], i) => {
    const mount = add(body, new THREE.Group(), [mx, my, 0])
    mount.rotation.z = yaw0
    servoBox(mount, [0, 0, 0], 'z')
    box(mount, [w.coxa, 0.014, 0.004], link, [w.coxa / 2, 0, 0.008])
    const femur = add(mount, new THREE.Group(), [w.coxa, 0, 0])
    servoBox(femur, [0.004, 0, 0])
    box(femur, [w.femur, 0.004, 0.012], link, [w.femur / 2, 0.009, 0])
    box(femur, [w.femur, 0.004, 0.012], link, [w.femur / 2, -0.009, 0])
    const tibia = add(femur, new THREE.Group(), [w.femur, 0, 0])
    servoBox(tibia, [0.004, 0, 0])
    box(tibia, [w.tibia - 0.008, 0.01, 0.008], link, [w.tibia / 2, 0, 0])
    const footM = glowMat(POWER, 0)
    add(tibia, mesh(new THREE.SphereGeometry(0.007, 14, 10), footM), [w.tibia, 0, 0])
    if (names) addLabel(group, w.names[i], [mx + (w.reach + 0.035) * Math.cos(yaw0), my + (w.reach + 0.035) * Math.sin(yaw0), 0.003], GREY, 0.018)
    return { mount, yaw0, femur, tibia, footM }
  })
  return {
    group,
    body,
    set(p: Pose, angles: { yaw: number; hip: number; knee: number }[], down: boolean[]) {
      placeAt(group, p)
      legs.forEach((l, i) => {
        const a = angles[i]
        l.mount.rotation.z = l.yaw0 + a.yaw
        l.femur.rotation.y = -a.hip
        l.tibia.rotation.y = -a.knee
        setGlow(l.footM, down[i] ? POWER : GREY, down[i] ? 1.4 : 0.15)
      })
    },
  }
}

/** Small servo biped in metres, ankle at the origin, x forward, z up; CoM at `h`. `set(lean, tip)`: lean at the ankles, then roll the whole robot about the toe (tip > 0) or heel. */
export function servoBiped(parent: THREE.Object3D, { h = BIPED.h, heel = BIPED.heel, toe = BIPED.toe, footW = BIPED.footW } = {}) {
  const group = add(parent, new THREE.Group())
  const roll = add(group, new THREE.Group())
  const robot = add(roll, new THREE.Group())
  const sole = mat('#30333a', { rough: 0.8 })
  const link = mat(LINK, { metal: 0.3, rough: 0.4 })
  const feet = [1, -1].map((s) => box(robot, [heel + toe, footW, 0.006], sole, [(toe - heel) / 2, s * 0.032, 0.003]))
  const upper = add(robot, new THREE.Group(), [0, 0, 0.012])
  const shin = h * 0.4
  const thigh = h * 0.36
  ;[1, -1].forEach((s) => {
    servoBox(upper, [0, s * 0.032, 0.006])
    box(upper, [0.012, 0.016, shin], link, [0, s * 0.032, shin / 2 + 0.01])
    servoBox(upper, [0, s * 0.032, shin + 0.01])
    box(upper, [0.012, 0.016, thigh], link, [0, s * 0.032, shin + thigh / 2 + 0.016])
  })
  const hipZ = shin + thigh + 0.02
  box(upper, [0.04, 0.09, 0.022], mat(SERVO, { rough: 0.5 }), [0, 0, hipZ])
  const torsoH = 2 * (h - hipZ - 0.012)
  box(upper, [0.05, 0.08, torsoH], mat('#2b2f38', { rough: 0.6 }), [0, 0, hipZ + 0.012 + torsoH / 2])
  box(upper, [0.03, 0.06, 0.03], mat('#3a76c4', { rough: 0.5 }), [-0.026, 0, h])
  box(upper, [0.004, 0.05, 0.02], glowMat(POWER, 0.8), [0.026, 0, h + torsoH * 0.3]).castShadow = false
  return {
    group,
    upper,
    feet,
    set(lean: number, tip: number) {
      upper.position.z = 0.012
      upper.rotation.y = lean
      const edge = tip > 0 ? toe : tip < 0 ? -heel : 0
      roll.position.x = edge
      robot.position.x = -edge
      roll.rotation.y = tip
    },
  }
}
