// Electromagnetic parts, cut open: relay and SSR, loudspeaker.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lathe, mat, mesh, rod, STEEL, TIN } from '../../models/kit'
import { Helix } from '../../models/power'
import { glowHalo } from './circuit'
import { CONVENTIONAL, COPPER, HIGH_V, LOW_V, RING, glowMat } from './colors'
import { inductorCoil } from './fields'
import { Flow } from './flows'
import { heatGlow } from './heat'
import { litEpoxy } from './parts'
import { plusGeometry, shellMat } from './shapes'
import { UP, clamp01 } from './util'

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
    const lid = add(group, mesh(new THREE.BoxGeometry(11, 9.2, 3.6), shellMat('#3f73d9', 0.13)), [0.3, 4.6, 0])
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
  add(group, mesh(new THREE.BoxGeometry(10.8, 6, 3.4), shellMat('#c9ced8', 0.1)), [0, 3, 0]).castShadow = false
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

/** Loudspeaker facing +z, centre `at`: frame, paper cone, dust cap, magnet behind and two solder tabs below.
 *  `set(x, loud)` pushes the cone out by x (−1…1) and ripples sound rings scaled by `loud` (0…1). */
export function speaker(parent: THREE.Object3D, at: V3, r = 2.4) {
  const g = add(parent, new THREE.Group(), at)
  cylinder(g, r * 0.5, r * 0.7, mat('#3a3d44', { metal: 0.3, rough: 0.5 }), [0, 0, -r * 0.75], 'z')
  add(g, mesh(new THREE.TorusGeometry(r, r * 0.07, 10, 48), STEEL()))
  const cone = add(g, new THREE.Group())
  const paper = new THREE.MeshStandardMaterial({ color: '#2b2c31', roughness: 0.85, side: THREE.DoubleSide })
  lathe(cone, [[r * 0.3, -r * 0.45], [r * 0.6, -r * 0.25], [r * 0.95, 0]], paper, [0, 0, 0], 'z', 40)
  lathe(cone, [[0, -r * 0.2], [r * 0.18, -r * 0.27], [r * 0.3, -r * 0.42]], mat('#3c3e44', { rough: 0.6 }), [0, 0, 0], 'z', 24)
  const tabs: V3[] = [-0.5, 0.5].map((s): V3 => [at[0] + s * r * 0.6, at[1] - r * 1.05, at[2]])
  for (const t of tabs) box(parent, [0.35, 0.5, 0.15], TIN(), t)
  const rings = Array.from({ length: 3 }, (_, i) => {
    const m = new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0, depthWrite: false })
    const o = add(g, mesh(new THREE.TorusGeometry(r, 0.06, 6, 48, Math.PI * 0.6), m), [0, 0, 0.2])
    o.rotation.z = -Math.PI * 0.3
    o.castShadow = false
    return { o, m, phase: i / 3 }
  })
  let s = 0
  return {
    group: g,
    plus: tabs[1],
    minus: tabs[0],
    set(x: number, loud: number, dt = 0) {
      cone.position.z = 0.18 * r * x
      s = (s + dt * 0.8) % 1
      for (const ring of rings) {
        const ph = (s + ring.phase) % 1
        ring.o.scale.setScalar(1.05 + 1.2 * ph)
        ring.o.position.x = r * 0.6 * ph
        ring.m.opacity = 0.75 * (1 - ph) * loud
      }
    },
  }
}
