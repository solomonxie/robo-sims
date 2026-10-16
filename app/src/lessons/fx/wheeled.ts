// Wheeled robots on a floor, in metres (x forward, y left, z up) inside a `floorView`: TT two-wheeler, mecanum, omni (kiwi / X), FRC swerve and an Ackermann RC car.
import * as THREE from 'three/webgpu'
import { ACKERMANN, MECANUM, MecLayout, OMNI, OmniBase, Pose, SWERVE, TT_TRACK_M, TT_WHEEL_MM, Wheel4, mecWheels, omniWheels, swerveModules } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildMecanum, buildWheel } from '../../models/motion'
import { B_FIELD, HIGH_V, POWER, glowMat, setGlow } from './colors'
import { addRod, stretchRod } from './layout'
import { sg90Servo } from './modules'

const WHEEL_R = TT_WHEEL_MM / 2000
const KIT_UNIT_M = 0.00254

function slipPatch(parent: THREE.Object3D, size: V3, at: V3) {
  const pm = glowMat(HIGH_V, 0)
  pm.transparent = true
  pm.opacity = 0
  pm.depthWrite = false
  box(parent, size, pm, at).castShadow = false
  return pm
}
const lightPatches = (patches: THREE.MeshStandardMaterial[], u: number[]) =>
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
      group.position.set(p.x, p.y, 0)
      group.rotation.z = p.th
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
      group.position.set(p.x, p.y, 0)
      group.rotation.z = p.th
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
export function omniWheel(parent: THREE.Object3D, at: V3, yaw: number) {
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
      group.position.set(p.x, p.y, 0)
      group.rotation.z = p.th
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
      group.position.set(p.x, p.y, 0)
      group.rotation.z = p.th
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
      group.position.set(p.x, p.y, 0)
      group.rotation.z = p.th
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

