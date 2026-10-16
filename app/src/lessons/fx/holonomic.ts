// Holonomic robots on a floor, in metres (x forward, y left, z up): mecanum, omni (kiwi / X) and FRC swerve.
import * as THREE from 'three/webgpu'
import { MECANUM, MecLayout, OMNI, OmniBase, Pose, SWERVE, Wheel4, mecWheels, omniWheels, swerveModules } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildMecanum } from '../../models/motion'
import { B_FIELD, POWER, glowMat, setGlow } from './colors'
import { placeAt } from './drive'
import { KIT_UNIT_M, lightPatches, slipPatch } from './wheeled'

/** Real 60 mm mecanum wheel in metres, axle along y; `hand(mirror)` flips the rollers (unmirrored: floor roller axle along x = −y). Roll it with `group.rotation.y = travel / r`. */
export function mecanumWheel(parent: THREE.Object3D, at: V3, mirror = false) {
  const group = add(parent, new THREE.Group(), at)
  const model = add(group, buildMecanum())
  model.rotation.x = -Math.PI / 2
  const hand = (m: boolean) => model.scale.set(KIT_UNIT_M, KIT_UNIT_M, (m ? -1 : 1) * KIT_UNIT_M)
  hand(mirror)
  return { group, model, hand }
}

const frontMark = (group: THREE.Object3D, x: number) => {
  box(group, [0.055, 0.028, 0.003], mat('#1d6fd1', { rough: 0.5 }), [x, 0, 0.054])
  box(group, [0.008, 0.006, 0.003], glowMat('#ff5a7a', 1), [x + 0.025, 0.008, 0.057])
}

/** Four-wheel mecanum robot (170 × 200 mm, wheels FL FR RL RR); `set(pose, travel)` places it and rolls each wheel, `layout` swaps roller hands, `slip(u[4])` lights the contact patches. */
export function mecanumBot(parent: THREE.Object3D, layout: MecLayout = 'x') {
  const group = add(parent, new THREE.Group())
  const { halfL: L, halfW: W, wheelR: R } = MECANUM
  box(group, [2 * L + 0.05, 2 * W - 0.05, 0.004], mat('#e8ecf2', { rough: 0.3, opacity: 0.85 }), [0, 0, 0.05])
  box(group, [0.07, 0.04, 0.022], mat('#2a2c32', { rough: 0.6 }), [-0.03, 0, 0.064])
  frontMark(group, 0.05)
  const wheels = mecWheels(layout).map((k) => {
    box(group, [0.022, 0.05, 0.02], mat('#f2c12e', { rough: 0.55 }), [k.x, Math.sign(k.y) * (W - 0.042), R])
    return mecanumWheel(group, [k.x, k.y, R], k.tanB > 0)
  })
  const patches = mecWheels(layout).map((k) => slipPatch(group, [0.03, 0.026, 0.002], [k.x, k.y, 0.002]))
  return {
    group,
    wheels,
    layout(l: MecLayout) {
      mecWheels(l).forEach((k, i) => wheels[i].hand(k.tanB > 0))
    },
    set(p: Pose, travel: Wheel4 | number[] = [0, 0, 0, 0]) {
      placeAt(group, p)
      wheels.forEach((w, i) => (w.group.rotation.y = travel[i] / R))
    },
    slip(u: number[]) {
      lightPatches(patches, u)
    },
  }
}

let rollerGeo: THREE.LatheGeometry | undefined
const omniRollerGeo = (r: number, len: number) =>
  (rollerGeo ??= new THREE.LatheGeometry(
    Array.from({ length: 9 }, (_, i) => new THREE.Vector2(r * (0.55 + 0.45 * Math.sin((i / 8) * Math.PI)), -len / 2 + (i / 8) * len)),
    16,
  ))

/** 58 mm double-row omni wheel in metres: two rows of free rollers turned 90° to the axle (local y), rolling along local x.
 *  `set(travel, side)` rolls it and spins the rollers touching the floor by the sideways travel. */
function omniWheel(parent: THREE.Object3D, at: V3, yaw: number) {
  const { wheelR: R, rollers: n, rollerR: rr } = OMNI
  const group = add(parent, new THREE.Group(), at)
  group.rotation.z = yaw
  const spin = add(group, new THREE.Group())
  const alu = mat('#c3c8d0', { metal: 0.5, rough: 0.35 })
  cylinder(spin, 0.009, 0.022, mat('#3a3d44', { rough: 0.5 }), [0, 0, 0], 'y', 16)
  for (const y of [-0.0105, 0, 0.0105]) cylinder(spin, 0.021, 0.0016, alu, [0, y, 0], 'y', 6)
  const up = new THREE.Vector3(0, 1, 0)
  const rubber = [mat('#555a64', { rough: 0.8 }), mat('#7a808b', { rough: 0.8 })]
  const rollers = [0, 1].flatMap((rowI) =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + rowI / 2) / n) * Math.PI * 2
      const c = R - rr
      const pivot = add(spin, new THREE.Group(), [Math.cos(a) * c, rowI ? 0.0055 : -0.0055, Math.sin(a) * c])
      pivot.quaternion.setFromUnitVectors(up, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)))
      return { a, roll: add(pivot, mesh(omniRollerGeo(rr, (2 * Math.PI * c) / n - 0.002), rubber[rowI])) }
    }),
  )
  let lastSide = 0
  return {
    group,
    set(travel: number, side: number) {
      const th = travel / R
      spin.rotation.y = th
      const d = side - lastSide
      lastSide = side
      rollers.forEach((r) => {
        if (Math.sin(r.a - th) < -0.7) r.roll.rotation.y -= d / rr
      })
    },
  }
}

/** Omni robot: kiwi (three wheels at 120°, round deck) or X (four wheels on the diagonals); `set(pose, travel[], side[])` places it, rolls each wheel and spins its floor rollers. */
export function omniBot(parent: THREE.Object3D, base: OmniBase) {
  const group = add(parent, new THREE.Group())
  const deck = mat('#e8ecf2', { rough: 0.3, opacity: 0.85 })
  if (base === 'kiwi') cylinder(group, 0.1, 0.004, deck, [0, 0, 0.05], 'z', 40)
  else box(group, [0.15, 0.15, 0.004], deck, [0, 0, 0.05])
  box(group, [0.06, 0.04, 0.022], mat('#2a2c32', { rough: 0.6 }), [-0.03, 0, 0.064])
  frontMark(group, 0.04)
  const can = mat('#b8bcc4', { metal: 0.6, rough: 0.3 })
  const wheels = omniWheels(base).map((k) => {
    const phi = Math.atan2(k.y, k.x)
    const r = Math.hypot(k.x, k.y)
    const m = add(group, new THREE.Group(), [Math.cos(phi) * (r - 0.036), Math.sin(phi) * (r - 0.036), OMNI.wheelR])
    m.rotation.z = phi
    cylinder(m, 0.011, 0.04, can, [0, 0, 0], 'x', 16)
    box(m, [0.012, 0.03, 0.03], mat('#f2c12e', { rough: 0.55 }), [0.024, 0, 0])
    return omniWheel(group, [k.x, k.y, OMNI.wheelR], k.d)
  })
  return {
    group,
    set(p: Pose, travel: number[], side: number[]) {
      placeAt(group, p)
      wheels.forEach((w, i) => w.set(travel[i], side[i]))
    },
  }
}

/** FRC swerve robot (bumpered square, four modules): each module steers its 4" wheel with a steer motor and rolls it with a drive motor.
 *  `set(pose, angles[4], travel[4])` places, steers and rolls; `glow(drive[4], steer[4], scrub[4])` lights motor rings 0…1 and the scrub patches. */
export function swerveBot(parent: THREE.Object3D, bumper = '#c8323c') {
  const group = add(parent, new THREE.Group())
  const R = SWERVE.wheelR
  const [o, bt, bh] = [0.4, 0.07, 0.12]
  const bm = mat(bumper, { rough: 0.7 })
  box(group, [2 * o, bt, bh], bm, [0, o - bt / 2, bh / 2 + 0.02])
  box(group, [2 * o, bt, bh], bm, [0, -o + bt / 2, bh / 2 + 0.02])
  box(group, [bt, 2 * o - 2 * bt, bh], bm, [o - bt / 2, 0, bh / 2 + 0.02])
  box(group, [bt, 2 * o - 2 * bt, bh], bm, [-o + bt / 2, 0, bh / 2 + 0.02])
  const rail = mat('#9aa0aa', { metal: 0.6, rough: 0.35 })
  const [e, span] = [o - bt - 0.0125, 2 * (SWERVE.halfL - 0.08)]
  for (const s of [1, -1]) {
    box(group, [span, 0.025, 0.05], rail, [0, s * e, 0.06])
    box(group, [0.025, span, 0.05], rail, [s * e, 0, 0.06])
  }
  box(group, [span, span, 0.004], mat('#4b5059', { metal: 0.3, rough: 0.5 }), [0, 0, 0.035])
  box(group, [0.18, 0.08, 0.17], mat('#1f2126', { rough: 0.6 }), [-0.08, 0, 0.12])
  box(group, [0.12, 0.1, 0.03], mat('#d4d7dc', { rough: 0.4 }), [0.1, 0.05, 0.055])
  box(group, [0.02, 0.012, 0.004], glowMat('#ff5a7a', 1), [0.14, 0.05, 0.072])
  const tread = mat('#44474f', { rough: 0.9 })
  const hub = mat('#e0e3e8', { metal: 0.5, rough: 0.3 })
  const modules = swerveModules().map((m) => {
    const at = add(group, new THREE.Group(), [m.x, m.y, 0])
    add(at, mesh(new THREE.TorusGeometry(0.068, 0.007, 8, 32), mat('#7c828c', { metal: 0.5, rough: 0.35 })), [0, 0, 0.115])
    const motor = (dx: number, dy: number, ring: string) => {
      cylinder(at, 0.028, 0.07, mat('#2b2f36', { metal: 0.3, rough: 0.5 }), [dx, dy, 0.1], 'z', 20)
      const g = glowMat(ring, 0.15)
      cylinder(at, 0.029, 0.012, g, [dx, dy, 0.14], 'z', 20).castShadow = false
      return g
    }
    const inX = -Math.sign(m.x) * 0.1
    const inY = -Math.sign(m.y) * 0.1
    const drive = motor(inX, 0, POWER)
    const steer = motor(0, inY, B_FIELD)
    const yoke = add(at, new THREE.Group())
    box(yoke, [0.07, 0.008, 0.07], hub, [0, 0.03, R + 0.02])
    box(yoke, [0.07, 0.008, 0.07], hub, [0, -0.03, R + 0.02])
    const roll = add(yoke, new THREE.Group(), [0, 0, R])
    cylinder(roll, R, 0.038, tread, [0, 0, 0], 'y', 28)
    cylinder(roll, R * 0.6, 0.04, glowMat('#ff8c2e', 0.5), [0, 0, 0], 'y', 6)
    box(roll, [R * 1.4, 0.042, 0.01], hub, [0, 0, 0])
    return { yoke, roll, drive, steer, scrub: slipPatch(at, [0.12, 0.12, 0.002], [0, 0, 0.003]) }
  })
  return {
    group,
    set(p: Pose, angles: number[], travel: number[]) {
      placeAt(group, p)
      modules.forEach((m, i) => {
        m.yoke.rotation.z = angles[i]
        m.roll.rotation.y = travel[i] / R
      })
    },
    glow(drive: number[], steer: number[], scrub: number[]) {
      modules.forEach((m, i) => {
        setGlow(m.drive, POWER, 0.15 + 1.4 * drive[i])
        setGlow(m.steer, B_FIELD, 0.15 + 1.4 * steer[i])
      })
      lightPatches(
        modules.map((m) => m.scrub),
        scrub,
      )
    },
  }
}
