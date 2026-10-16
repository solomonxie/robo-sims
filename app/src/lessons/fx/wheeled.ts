// Wheeled robots on a floor, in metres (x forward, y left, z up) inside a `floorView`: TT two-wheeler, mecanum four-wheeler.
import * as THREE from 'three/webgpu'
import { MECANUM, MecLayout, Pose, TT_TRACK_M, TT_WHEEL_MM, Wheel4, mecWheels } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildMecanum, buildWheel } from '../../models/motion'
import { HIGH_V, glowMat, setGlow } from './colors'

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

/** Four-wheel mecanum robot (170 × 200 mm, wheels FL FR RL RR); `set(pose, travel)` places it and rolls each wheel, `layout` swaps roller hands, `slip(u[4])` lights the contact patches. */
export function mecanumBot(parent: THREE.Object3D, layout: MecLayout = 'x') {
  const group = add(parent, new THREE.Group())
  const { halfL: L, halfW: W, wheelR: R } = MECANUM
  box(group, [2 * L + 0.05, 2 * W - 0.05, 0.004], mat('#e8ecf2', { rough: 0.3, opacity: 0.85 }), [0, 0, 0.05])
  box(group, [0.07, 0.04, 0.022], mat('#2a2c32', { rough: 0.6 }), [-0.03, 0, 0.064])
  box(group, [0.055, 0.028, 0.003], mat('#1d6fd1', { rough: 0.5 }), [0.05, 0, 0.054])
  box(group, [0.008, 0.006, 0.003], glowMat('#ff5a7a', 1), [0.075, 0.008, 0.057])
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
