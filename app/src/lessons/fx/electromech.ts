// Moving-contact parts, cut open: relay and SSR, tact and toggle switches, rotary pot.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL, TIN } from '../../models/kit'
import { Helix } from '../../models/power'
import { glowHalo } from './circuit'
import { CONVENTIONAL, COPPER, HIGH_V, LOW_V, RING, glowMat, potentialColor } from './colors'
import { inductorCoil } from './fields'
import { Flow } from './flows'
import { heatGlow } from './heat'
import { litEpoxy } from './parts'
import { plusGeometry } from './shapes'
import { UP, clamp01, lerp } from './util'

const CX = -1.5
const COIL_R = 1.15
const COIL_LEN = 3.6
const COIL_Y = 2.5
const POLE = 4.8
const HX = -3.75
const HY = POLE + 0.15
const ARM = CX - HX
const TIP = 8
const OPEN = Math.atan(0.55 / ARM)
const RIVET = 0.25
const NO_X = HX + TIP
const NO_Y = HY - 2 * RIVET
const NC_X = HX + TIP * Math.cos(OPEN)
const NC_Y = HY + TIP * Math.sin(OPEN) + 2 * RIVET
const NC_POST = NO_X + 1.1
const PIN_Y = -1.7
const SPRING_Y = 2.4
const TAIL = 1
const COM_X = 2.3
const COM_TOP = 3.6
const PIGTAIL = 5.6

const shell = (color: string, opacity: number, roughness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness, depthWrite: false })

/** Electromagnetic relay facing +z, cut open, `scale` × lesson size; `at` is the middle of the base's top. A vertical coil on
 *  an iron core; a steel yoke up its left to the hinge; the armature over the pole, held up by a spring on its tail; a copper
 *  blade from it to the moving contact, which rests on NC (above) and is pulled onto NO (below). Pins point down.
 *  `set(close 0..1, field 0..1)` swings the armature and glows the core; `coilFlow` runs round the turns. */
export function relayPart(parent: THREE.Object3D, at: V3, { scale = 1.4, cased = false } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]
  const steel = mat('#8f96a3', { metal: 0.35, rough: 0.4 })
  const plastic = mat('#2b2e36', { rough: 0.6 })

  box(group, [10.8, 0.7, 3.2], plastic, [0.3, -0.35, 0])
  const winding = inductorCoil(group, { radius: COIL_R, length: COIL_LEN, turns: 8.5, thickness: 0.14, core: 0.55 })
  winding.group.position.set(CX, COIL_Y, 0)
  winding.group.rotation.z = Math.PI / 2
  for (const y of [COIL_Y - COIL_LEN / 2 - 0.12, COIL_Y + COIL_LEN / 2 + 0.12]) cylinder(group, COIL_R + 0.4, 0.2, plastic, [CX, y, 0], 'y', 32)
  cylinder(group, 0.78, 0.2, steel, [CX, POLE - 0.1, 0], 'y', 32)
  box(group, [ARM + 0.3, 0.3, 1.4], steel, [(CX + HX) / 2, 0.15, 0])
  box(group, [0.3, HY, 1.4], steel, [HX, HY / 2, 0])
  box(group, [TAIL + 0.4, 0.25, 1], steel, [HX - (TAIL + 0.1) / 2, SPRING_Y, 0])
  const coilFlow = new Flow(winding.lane(0.24), 1.1, CONVENTIONAL, 0.13)
  winding.group.add(coilFlow.mesh)

  const ends: [number, number][] = [
    [CX - COIL_R, COIL_Y - COIL_LEN / 2],
    [CX + COIL_R, COIL_Y + COIL_LEN / 2],
  ]
  const coilPins = [CX - COIL_R, CX + COIL_R + 0.2]
  rod(group, [ends[0][0], ends[0][1], 0], [coilPins[0], PIN_Y, 0], 0.08, COPPER())
  rod(group, [ends[1][0], ends[1][1], 0], [coilPins[1], ends[1][1], 0], 0.08, COPPER())
  rod(group, [coilPins[1], ends[1][1], 0], [coilPins[1], PIN_Y, 0], 0.08, COPPER())
  for (const x of [COM_X, NO_X, NC_POST]) rod(group, [x, 0, 0], [x, PIN_Y, 0], 0.11, STEEL())
  box(group, [0.3, COM_TOP, 0.8], COPPER(), [COM_X, COM_TOP / 2, 0])
  const pigtail = add(group, mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), COPPER()))

  const silver = mat('#dfe3ea', { metal: 0.3, rough: 0.25 })
  box(group, [0.3, NO_Y - RIVET, 0.8], COPPER(), [NO_X, (NO_Y - RIVET) / 2, 0])
  cylinder(group, 0.34, 2 * RIVET, silver, [NO_X, NO_Y, 0], 'y', 20)
  box(group, [0.3, NC_Y + 0.6, 0.8], COPPER(), [NC_POST, (NC_Y + 0.6) / 2, 0])
  box(group, [NC_POST - NC_X + 0.3, 0.3, 0.8], COPPER(), [(NC_POST + NC_X) / 2, NC_Y + RIVET + 0.15, 0])
  cylinder(group, 0.34, 2 * RIVET, silver, [NC_X, NC_Y, 0], 'y', 20)

  const armature = add(group, new THREE.Group(), [HX, HY, 0])
  box(armature, [ARM + 1.3 + TAIL, 0.3, 1.4], steel, [(ARM + 1.3 - TAIL) / 2, 0, 0])
  box(armature, [TIP - ARM - 0.6, 0.12, 0.7], COPPER(), [(TIP + ARM + 0.6) / 2, 0, 0])
  cylinder(armature, 0.34, 2 * RIVET, silver, [TIP, 0, 0], 'y', 20)
  cylinder(group, 0.22, 1.6, steel, [HX, HY, 0], 'z', 16)

  const spring = add(group, new THREE.Group(), [HX - TAIL, SPRING_Y, 0])
  spring.rotation.z = Math.PI / 2
  add(spring, mesh(new THREE.TubeGeometry(new Helix(0.28, 1, 9), 220, 0.05, 6), STEEL())).castShadow = false

  if (cased) {
    const lid = add(group, mesh(new THREE.BoxGeometry(11, 9.2, 3.6), shell('#3f73d9', 0.13)), [0.3, 4.6, 0])
    lid.castShadow = false
  }

  const along = (d: number, close: number): [number, number] => {
    const a = OPEN * (1 - clamp01(close))
    return [HX + d * Math.cos(a), HY + d * Math.sin(a)]
  }
  const tipAt = (close: number) => w(...along(TIP, close))
  const from = new THREE.Vector3(COM_X, COM_TOP, 0)
  const dir = new THREE.Vector3()
  const set = (close: number, field: number) => {
    const a = OPEN * (1 - clamp01(close))
    armature.rotation.z = a
    spring.scale.x = HY - TAIL * Math.sin(a) - SPRING_Y
    const [bx, by] = along(PIGTAIL, close)
    dir.set(bx, by - 0.1, 0).sub(from)
    pigtail.position.copy(from).addScaledVector(dir, 0.5)
    pigtail.scale.y = dir.length()
    pigtail.quaternion.setFromUnitVectors(UP, dir.normalize())
    winding.set(field)
  }
  set(0, 0)
  return {
    group,
    pins: { coil: coilPins.map((x) => w(x, PIN_Y)) as [V3, V3], com: w(COM_X, PIN_Y), no: w(NO_X, PIN_Y), nc: w(NC_POST, PIN_Y) },
    coilFlow,
    tipAt,
    /** Fixed contact rivets. */
    contacts: { no: w(NO_X, NO_Y), nc: w(NC_X, NC_Y) },
    /** Lane `z` in front: COM pin, up its post and pigtail to the blade, out to the moving contact, then down NO (closed)
     *  or NC to its pin. */
    contactLane(closed: boolean, z: number): V3[] {
      const c = closed ? 1 : 0
      const out = closed ? [w(NO_X, PIN_Y)] : [w(NC_X, NC_Y + RIVET + 0.15), w(NC_POST, NC_Y + RIVET + 0.15), w(NC_POST, PIN_Y)]
      return [w(COM_X, PIN_Y), w(COM_X, COM_TOP), w(...along(PIGTAIL, c)), tipAt(c), ...out].map((p): V3 => [p[0], p[1], z])
    },
    set,
  }
}

/** Solid-state relay facing +z, lid cut away, `scale` × lesson size; `at` is the middle of the base's top. Inside: an IR LED
 *  (input, left) shining across a gap onto a photo-detector die, which fires a triac (output, right). Pins point down:
 *  in + / in − at the left, out at the right. `set(light 0..1, conduct 0..1, heat 0..1)`. */
export function ssrPart(parent: THREE.Object3D, at: V3, { scale = 1.4 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]
  box(group, [10.8, 0.7, 3.2], mat('#2b2e36', { rough: 0.6 }), [0, -0.35, 0])
  add(group, mesh(new THREE.BoxGeometry(10.8, 6, 3.4), shell('#c9ced8', 0.1)), [0, 3, 0]).castShadow = false
  box(group, [10, 0.2, 2.2], mat('#1f5a3a', { rough: 0.5 }), [0, 0.1, 0])

  const ledY = 2.6
  const ledX = -3.3
  cylinder(group, 0.5, 1, mat('#6a6f7a', { rough: 0.4 }), [ledX - 0.4, ledY, 0], 'x', 20)
  const lens = new THREE.MeshStandardMaterial({ color: '#4a2a5a', emissive: '#b02a6a', emissiveIntensity: 0, roughness: 0.2 })
  add(group, mesh(new THREE.SphereGeometry(0.5, 20, 14), lens), [ledX + 0.1, ledY, 0])
  const ledHalo = glowHalo(group, [ledX + 0.3, ledY, 0.3], 0.7)
  for (const x of [-4.2, -2.6]) rod(group, [x, 0.2, 0], [x, PIN_Y, 0], 0.11, STEEL())
  rod(group, [-4.2, 0.2, 0], [ledX - 0.8, ledY, 0], 0.05, COPPER())
  rod(group, [-2.6, 0.2, 0], [ledX - 0.2, ledY - 0.4, 0], 0.05, COPPER())

  const beamMat = new THREE.MeshBasicMaterial({ color: '#ff3d8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const beam = add(group, mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.4, 20, 1, true), beamMat), [-1.6, ledY, 0])
  beam.rotation.z = -Math.PI / 2
  beam.castShadow = false

  const dieMat = new THREE.MeshStandardMaterial({ color: '#30343c', emissive: '#ff3d8a', emissiveIntensity: 0, roughness: 0.4 })
  box(group, [0.5, 1.6, 1.4], dieMat, [-0.15, ledY, 0])
  rod(group, [0.1, ledY, 0], [1.6, 1.6, 0], 0.05, COPPER())

  const triac = add(group, new THREE.Group(), [2.9, 2.1, 0])
  box(triac, [2.6, 0.2, 2], mat('#b9bec6', { metal: 0.4, rough: 0.35 }), [0, -0.9, -0.2])
  const body = new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.5 })
  litEpoxy(body)
  box(triac, [2.4, 1.6, 1.2], body, [0, 0, 0])
  const halo = glowHalo(triac, [0, 0, 0.9], 0.9)
  for (const x of [2.2, 3.6]) rod(group, [x, 1.2, 0], [x, PIN_Y, 0], 0.11, STEEL())
  add(group, mesh(plusGeometry(0.8), glowMat(HIGH_V, 0.8)), [-4.2, 1.2, 1.2])
  box(group, [0.8, 0.22, 0.22], glowMat(LOW_V, 0.8), [-2.6, 1.2, 1.2])
  return {
    group,
    pins: { inP: w(-4.2, PIN_Y), inN: w(-2.6, PIN_Y), out: [w(2.2, PIN_Y), w(3.6, PIN_Y)] as [V3, V3] },
    triacAt: w(2.9, 2.1),
    set(light: number, conduct: number, heat: number) {
      const l = clamp01(light)
      lens.emissiveIntensity = 1.6 * l
      ledHalo.set(0.5 * l, '#ff3d8a')
      beamMat.opacity = 0.35 * l
      dieMat.emissiveIntensity = 0.8 * l
      halo.set(0.5 * Math.sqrt(clamp01(conduct)), CONVENTIONAL)
      heatGlow(body, heat)
    },
  }
}

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
  add(group, mesh(new THREE.BoxGeometry(TW, 0.95, 0.05), shell('#6a6f7a', 0.1, 0.15)), [0, 0.74, zc + TW / 2]).castShadow = false
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
  add(group, mesh(new THREE.BoxGeometry(BW, BH - 0.5, BD), shell('#7f8794', 0.12, 0.15)), [0, (BH + 0.5) / 2, 0]).castShadow = false
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

const BODY_R = 3.15
const TRACK_R = 1.85
const TRACK_W = 0.8
const SWEEP = (270 * Math.PI) / 180
const PIN_DX = 2
const TAB_Y = -BODY_R - 0.3
const FOOT_Y = TAB_Y - 2.3
const SEGMENTS = 54

/** Clockwise angle from +y of the track point `s` (0 = pin 1 end, lower left; 1 = pin 3 end, lower right). */
const angleAt = (s: number) => -SWEEP / 2 + SWEEP * clamp01(s)
const onTrack = (s: number, r = TRACK_R): [number, number] => [Math.sin(angleAt(s)) * r, Math.cos(angleAt(s)) * r]

/** 16 mm rotary pot facing +z, real size × `scale`, front cover off; `at` is the shaft centre. The wiper sweeps 270°
 *  clockwise from pin 1 (left) to pin 3 (right); pin 2 is the wiper via the centre ring. `pins.a/w/b`: pin 1/2/3 feet.
 *  `set(turn 0..1, potential(s))` turns the wiper and tints the track (s = 0 at pin 1) and wiper tip by potential. */
export function rotaryPot(parent: THREE.Object3D, at: V3, { scale = 1.6 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]

  const steel = mat('#c4c9d1', { metal: 0.45, rough: 0.3 })
  const phenolic = mat('#7a5530', { rough: 0.7 })
  cylinder(group, BODY_R, 0.3, steel, [0, 0, -0.55], 'z', 48)
  cylinder(group, BODY_R - 0.1, 0.3, phenolic, [0, 0, -0.2], 'z', 48)
  const rim = add(group, mesh(new THREE.CylinderGeometry(BODY_R, BODY_R, 1.1, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide })), [0, 0, -0.15])
  rim.rotation.x = Math.PI / 2
  box(group, [2 * PIN_DX + 1.4, 1.6, 0.3], phenolic, [0, TAB_Y + 0.8, -0.2])

  const segs: THREE.MeshStandardMaterial[] = []
  for (let k = 0; k < SEGMENTS; k++) {
    const t1 = angleAt((k + 1) / SEGMENTS)
    const geo = new THREE.RingGeometry(TRACK_R - TRACK_W / 2, TRACK_R + TRACK_W / 2, 3, 1, Math.PI / 2 - t1, SWEEP / SEGMENTS + 0.004)
    const material = new THREE.MeshStandardMaterial({ color: '#202124', emissive: '#000000', emissiveIntensity: 0.55, roughness: 0.8 })
    add(group, mesh(geo, material), [0, 0, 0.01]).castShadow = false
    segs.push(material)
  }
  const silver = mat('#e3e6ea', { metal: 0.5, rough: 0.25 })
  add(group, mesh(new THREE.RingGeometry(0.45, 0.8, 32), silver), [0, 0, 0.02]).castShadow = false

  const tin = TIN()
  const pinX = [-PIN_DX, 0, PIN_DX]
  for (const x of pinX) {
    box(group, [0.5, 2.3, 0.12], tin, [x, TAB_Y - 1.15, -0.1])
    box(group, [0.5, 0.5, 0.14], silver, [x, TAB_Y + 0.25, 0.02])
  }
  for (const s of [0, 1]) {
    const [x, y] = onTrack(s)
    const [xi, yi] = onTrack(s, TRACK_R - TRACK_W / 2 + 0.05)
    const [xo, yo] = onTrack(s, TRACK_R + TRACK_W / 2 - 0.05)
    rod(group, [xi, yi, 0.06], [xo, yo, 0.06], 0.2, silver)
    const px = s ? PIN_DX : -PIN_DX
    rod(group, [x, y, 0.04], [px, TAB_Y + 0.4, 0.04], 0.14, silver)
  }
  rod(group, [0, -0.6, 0.04], [0, TAB_Y + 0.4, 0.04], 0.14, silver)

  const wiper = add(group, new THREE.Group(), [0, 0, 0.12])
  cylinder(wiper, 0.62, 0.16, steel, [0, 0, 0], 'z', 24)
  box(wiper, [0.34, TRACK_R, 0.05], STEEL(), [0, TRACK_R / 2, 0.02])
  for (const dx of [-0.1, 0.1]) rod(wiper, [dx, TRACK_R - 0.1, 0.04], [dx, TRACK_R + 0.12, -0.06], 0.05, STEEL())
  const tipMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#000000', emissiveIntensity: 0.9, roughness: 0.4 })
  add(wiper, mesh(new THREE.SphereGeometry(0.17, 14, 10), tipMat), [0, TRACK_R, 0.02])
  const knob = add(wiper, new THREE.Group(), [0, 0, 0.6])
  cylinder(knob, 0.55, 1.0, mat('#2a2b30', { rough: 0.55 }), [0, 0, 0], 'z', 28)
  box(knob, [0.16, 0.5, 0.06], mat('#f2f2f2', { emissive: '#777777' }), [0, 0.25, 0.52])
  const halo = glowHalo(group, [0, 0, 0.5], 0.7)

  const color = new THREE.Color()
  return {
    group,
    pins: { a: w(-PIN_DX, FOOT_Y), w: w(0, FOOT_Y), b: w(PIN_DX, FOOT_Y) },
    /** Track centreline at `s`, lifted `dz` (part units) off it. */
    track: (s: number, dz = 0): V3 => {
      const [x, y] = onTrack(s)
      return w(x, y, dz)
    },
    /** Track position under a world point, by its angle round the shaft. */
    trackAt(x: number, y: number) {
      const a = Math.atan2(x - at[0], y - at[1])
      return clamp01((a + SWEEP / 2) / SWEEP)
    },
    /** Where the pin-1 and pin-3 straps meet the pins. */
    tops: { a: w(-PIN_DX, TAB_Y + 0.4), b: w(PIN_DX, TAB_Y + 0.4) },
    set(turn: number, potential: (s: number) => number) {
      const u = clamp01(turn)
      wiper.rotation.z = -angleAt(u)
      segs.forEach((m, k) => potentialColor(potential((k + 0.5) / SEGMENTS), m.emissive))
      potentialColor(potential(u), color)
      tipMat.emissive.copy(color)
      const [x, y] = onTrack(u)
      halo.group.position.set(x, y, 0.5)
      halo.set(0.6, color)
    },
  }
}
