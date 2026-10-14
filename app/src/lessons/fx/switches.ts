// Switches cut open: a 6 mm tactile button (snap dome over a centre pad) and a miniature SPDT toggle (bat lever, rocker).
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL, TIN } from '../../models/kit'
import { glowHalo } from './circuit'
import { RING } from './colors'
import { clamp01, lerp } from './util'

const shell = (color: string, opacity: number) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.15, depthWrite: false })

const world = (at: V3, scale: number) => (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]

const TW = 2.36
const DOME_Y = 0.42
const DOME_H = 0.36
const DOME_R = 0.86
const PAD_TOP = 0.3
const PLUNGE = 0.5
const LEG_Y = -0.9

/** 6 × 6 mm tact switch facing +z, real size × `scale`, front half cut away; `at` is the middle of the base's bottom, front
 *  legs at z = 0. The plunger presses a steel dome; it snaps through onto the centre pad, joining the left legs (rim) to the
 *  right legs (pad). `pins.a`/`pins.b`: left/right front leg feet. `set(press 0..1, closed)`: closed flattens the dome onto
 *  the pad and flashes it; pressed but open (a bounce) leaves it hovering just above. */
export function tactSwitch(parent: THREE.Object3D, at: V3, { scale = 2.6, cap = '#2a2b30' } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = world(at, scale)
  const zc = -TW / 2 + 0.45
  const black = mat('#1c1d22', { rough: 0.65 })
  box(group, [TW, 0.26, TW], black, [0, 0.13, zc])
  box(group, [TW, 0.95, 0.12], black, [0, 0.74, zc - TW / 2 + 0.06])
  for (const s of [-1, 1]) box(group, [0.14, 0.95, TW], black, [s * (TW / 2 - 0.07), 0.74, zc])
  add(group, mesh(new THREE.BoxGeometry(TW, 0.95, 0.05), shell('#6a6f7a', 0.1)), [0, 0.74, zc + TW / 2]).castShadow = false
  box(group, [TW + 0.04, 0.07, TW + 0.04], STEEL(), [0, 1.25, zc])
  for (const s of [-1, 1]) box(group, [0.07, 0.75, 0.6], STEEL(), [s * (TW / 2 + 0.04), 0.9, zc])

  for (const s of [-1, 1])
    for (const z of [0, 2 * zc]) {
      const x = s * (TW / 2 + 0.1)
      rod(group, [s * (TW / 2 - 0.2), 0.2, z], [x, 0.2, z], 0.07, TIN())
      rod(group, [x, 0.2, z], [x, LEG_Y, z], 0.07, TIN())
    }
  const copper = mat('#c8803f', { metal: 0.35, rough: 0.35 })
  for (const s of [-1, 1]) box(group, [0.34, 0.06, 0.5], copper, [s * DOME_R, PAD_TOP - 0.02, zc])
  rod(group, [-TW / 2 + 0.2, 0.27, zc], [-DOME_R, 0.27, zc], 0.04, copper)
  rod(group, [-DOME_R, 0.27, zc], [-DOME_R, 0.27, 0], 0.04, copper)
  rod(group, [0, 0.27, zc], [TW / 2 - 0.2, 0.27, zc], 0.04, copper)
  rod(group, [TW / 2 - 0.2, 0.27, zc], [TW / 2 - 0.2, 0.27, 0], 0.04, copper)
  const pad = cylinder(group, 0.24, 0.06, copper, [0, PAD_TOP - 0.03, zc], 'y', 20)
  pad.castShadow = false

  const sphereR = (DOME_R ** 2 + DOME_H ** 2) / (2 * DOME_H)
  const domeGeo = new THREE.SphereGeometry(sphereR, 32, 8, 0, Math.PI * 2, 0, Math.asin(DOME_R / sphereR))
  domeGeo.translate(0, -(sphereR - DOME_H), 0)
  const dome = add(group, mesh(domeGeo, new THREE.MeshStandardMaterial({ color: '#d5dae2', metalness: 0.4, roughness: 0.25, side: THREE.DoubleSide })), [0, DOME_Y, zc])

  const plunger = add(group, new THREE.Group(), [0, 0, zc])
  cylinder(plunger, 0.68, 0.75, mat(cap, { rough: 0.55 }), [0, 1.62, 0], 'y', 28)
  cylinder(plunger, 0.3, 0.55, mat(cap, { rough: 0.55 }), [0, 1.0, 0], 'y', 16)
  const halo = glowHalo(group, [0, PAD_TOP + 0.05, zc + 0.9], 0.2)
  const closedFlat = (PAD_TOP + 0.02 - DOME_Y) / DOME_H
  const nearFlat = (PAD_TOP + 0.16 - DOME_Y) / DOME_H
  return {
    group,
    pins: { a: w(-(TW / 2 + 0.1), LEG_Y), b: w(TW / 2 + 0.1, LEG_Y) },
    /** Top of the plunger cap. */
    top: w(0, 2, zc),
    set(press: number, closed: boolean) {
      const p = clamp01(press)
      const s = closed ? closedFlat : p > 0.55 ? nearFlat : lerp(1, nearFlat, p / 0.55)
      dome.scale.y = s
      plunger.position.y = Math.max(-PLUNGE, DOME_H * (s - 1))
      halo.set(closed ? 0.9 : 0, RING)
    },
  }
}

const BW = 5.1
const BH = 3.8
const BD = 3.1
const LUG = 1.85
const LUG_Y = -2
const LUG_FOOT = LUG_Y - 0.15
const PIVOT_Y = BH + 0.2
const LEVER = 4.6
const TILT = 0.38
const ROCK = 0.16
const POST = 0.95
const ROCK_Y = 0.5 + POST + 0.42

/** Miniature SPDT toggle (MTS-102) facing +z, real size × `scale`, the front of its case cut away; `at` is the middle of the
 *  case bottom. Three lugs point down: `pins.a` (left), `pins.com`, `pins.b` (right). The bat lever pivots in the threaded
 *  bushing; below the pivot it pushes a copper rocker that joins COM to the lug on the far side from the lever.
 *  `set(throw 0..1, made)`: 0 = lever right, 1 = lever left; `made` is the lug the rocker touches ('a', 'b', or null while it
 *  bounces off), flashing it. */
export function toggleSwitch(parent: THREE.Object3D, at: V3, { scale = 1 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = world(at, scale)
  const steel = mat('#c4c9d1', { metal: 0.45, rough: 0.3 })
  box(group, [BW, 0.5, BD], mat('#1c1d22', { rough: 0.6 }), [0, 0.25, 0])
  box(group, [BW, BH - 0.5, 0.12], mat('#2a2c32', { rough: 0.5 }), [0, (BH + 0.5) / 2, -BD / 2 + 0.06])
  add(group, mesh(new THREE.BoxGeometry(BW, BH - 0.5, BD), shell('#7f8794', 0.12)), [0, (BH + 0.5) / 2, 0]).castShadow = false
  box(group, [BW + 0.1, 0.18, BD + 0.1], steel, [0, BH, 0])
  for (const s of [-1, 1]) box(group, [0.1, 1.4, 1.4], steel, [s * (BW / 2 + 0.05), BH - 0.7, 0])
  cylinder(group, 1.18, 3.2, steel, [0, BH + 1.7, 0], 'y', 28)
  for (let k = 0; k < 7; k++) {
    const ring = add(group, mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 28), steel), [0, BH + 0.4 + k * 0.42, 0])
    ring.rotation.x = Math.PI / 2
  }
  cylinder(group, 1.75, 0.55, steel, [0, BH + 0.6, 0], 'y', 6)

  const lugs = [-LUG, 0, LUG]
  const tin = TIN()
  for (const x of lugs) {
    box(group, [0.75, 2.2, 0.14], tin, [x, LUG_Y / 2 - 0.1, 0])
    box(group, [0.5, 0.06, 0.06], mat('#0b0c0f'), [x, LUG_Y + 0.55, 0.09])
    const h = x ? POST : POST + 0.3
    cylinder(group, 0.12, h, tin, [x, 0.5 + h / 2, 0], 'y', 12)
    cylinder(group, 0.22, 0.12, mat('#e9e2c8', { metal: 0.4, rough: 0.3 }), [x, 0.5 + h + 0.06, 0], 'y', 16)
  }
  const copper = mat('#d08a45', { metal: 0.35, rough: 0.35 })
  const rocker = add(group, new THREE.Group(), [0, ROCK_Y, 0])
  box(rocker, [2 * LUG + 0.5, 0.18, 0.8], copper, [0, 0.09, 0])
  box(rocker, [0.6, 0.35, 0.6], mat('#3a3d45', { rough: 0.5 }), [0, 0.35, 0])

  const lever = add(group, new THREE.Group(), [0, PIVOT_Y, 0])
  rod(lever, [0, -0.2, 0], [0, ROCK_Y + 0.5 - PIVOT_Y, 0], 0.16, steel)
  const bat = add(lever, mesh(new THREE.CylinderGeometry(0.42, 0.26, LEVER, 20), steel), [0, LEVER / 2 + 0.6, 0])
  bat.castShadow = true
  cylinder(lever, 0.3, 0.9, steel, [0, 0.2, 0], 'z', 16)
  add(lever, mesh(new THREE.SphereGeometry(0.42, 16, 12), steel), [0, LEVER + 0.6, 0])
  const halos = lugs.filter((x) => x).map((x) => glowHalo(group, [x * 0.92, ROCK_Y - 0.25, 0.8], 0.45))
  return {
    group,
    pins: { a: w(-LUG, LUG_FOOT), com: w(0, LUG_FOOT), b: w(LUG, LUG_FOOT) },
    /** Lever tip for throw 0 and 1. */
    tip: (u: number): V3 => {
      const a = lerp(-TILT, TILT, u)
      return w(-Math.sin(a) * (LEVER + 0.6), PIVOT_Y + Math.cos(a) * (LEVER + 0.6))
    },
    set(u: number, made: 'a' | 'b' | null) {
      lever.rotation.z = lerp(-TILT, TILT, clamp01(u))
      rocker.rotation.z = made === 'a' ? ROCK : made === 'b' ? -ROCK : (u < 0.5 ? 0.3 : -0.3) * ROCK
      halos[0].set(made === 'a' ? 0.9 : 0, RING)
      halos[1].set(made === 'b' ? 0.9 : 0, RING)
    },
  }
}
