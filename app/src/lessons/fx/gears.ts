// Gears and screws: spur and ring gears, compound gear train, lead screw.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { Helix } from '../../models/power'
import { sectorGeometry } from './shapes'

const TAU = Math.PI * 2
export const gearPlastic = () => mat('#f1efe6', { rough: 0.55 })
export const gearBrass = () => mat('#d9b24a', { metal: 0.35, rough: 0.4 })

/** Spur gear in the xy plane (axis z) with `teeth` of module `mod`: pitch radius = mod·teeth / 2; `thick` = tooth thickness. */
export function spurGear(parent: THREE.Object3D, teeth: number, mod: number, width: number, material: THREE.Material, thick = 1.5 * mod) {
  const g = add(parent, new THREE.Group())
  const rp = (mod * teeth) / 2
  cylinder(g, rp - 0.6 * mod, width, material, [0, 0, 0], 'z', Math.max(24, teeth * 2))
  g.add(gearTeeth(teeth, rp, mod, width, material, thick))
  return g
}

function gearTeeth(teeth: number, rp: number, mod: number, width: number, material: THREE.Material, thick: number) {
  const t = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6 * mod, thick, width), material, teeth)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const z = new THREE.Vector3(0, 0, 1)
  const one = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU
    t.setMatrixAt(i, m.compose(new THREE.Vector3(rp * Math.cos(a), rp * Math.sin(a), 0), q.setFromAxisAngle(z, a), one))
  }
  t.castShadow = true
  return t
}

/** Internal (ring) gear in the xy plane, teeth pointing in, pitch radius mod·teeth / 2, `rim` thick outside it. */
export function ringGear(parent: THREE.Object3D, teeth: number, mod: number, width: number, material: THREE.Material, rim = 3 * mod) {
  const g = add(parent, new THREE.Group())
  const rp = (mod * teeth) / 2
  const band = add(g, mesh(sectorGeometry(rp + 0.6 * mod, rp + 0.6 * mod + rim, 0, TAU, width), material), [0, 0, -width / 2])
  band.castShadow = true
  g.add(gearTeeth(teeth, rp, mod, width, material, 1.5 * mod))
  return g
}

const PINION = 10

/** Face-on train of compound spur stages along +x from `at` (axes along z, each stage one gear-width nearer the viewer),
 *  pinions of 10 teeth. `set(motorAngle)` turns every shaft at its ratio; `shafts` = x of each shaft (last = output). */
export function gearTrain(parent: THREE.Object3D, at: V3, stages: number[], { mod = 0.25, width = 0.7 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const plastic = gearPlastic()
  const brass = gearBrass()
  const xs = [0]
  stages.forEach((n) => xs.push(xs[xs.length - 1] + (mod * PINION * (1 + n)) / 2))
  const shafts = xs.map((x) => add(group, new THREE.Group(), [x, 0, 0]))
  const ratios = [1]
  stages.forEach((n, k) => {
    ratios.push(ratios[k] * n)
    spurGear(shafts[k], PINION, mod, width, brass).position.z = k * width
    const big = spurGear(shafts[k + 1], PINION * n, mod, width, plastic)
    big.position.z = k * width
    big.rotation.z = Math.PI / (PINION * n)
  })
  const front = stages.length * width + 0.6
  for (const s of shafts) rod(s, [0, 0, -width], [0, 0, front], 0.12, STEEL())
  const flag = add(shafts[shafts.length - 1], new THREE.Group(), [0, 0, front])
  box(flag, [1.6, 0.35, 0.12], mat('#d23b3b', { rough: 0.5 }), [0.5, 0, 0])
  return {
    group,
    shafts: xs.map((x) => x + at[0]),
    /** Biggest gear radius, for framing. */
    radius: Math.max(mod * PINION, ...stages.map((n) => (mod * PINION * n) / 2)),
    set(motorAngle: number) {
      shafts.forEach((s, k) => (s.rotation.z = ((k % 2 ? 1 : -1) * motorAngle) / ratios[k]))
    },
  }
}

/** Lead screw along local +y from 0 to `length`, radius `r`, `starts` thread helices `lead` apart per turn (drawn coarse),
 *  and its nut: a flanged brass nut, or a steel ball nut with its return tube. `set(y)` puts the nut at `y` and turns the
 *  screw so the thread runs through it (−2π per lead). Rotate `group` to lay it down. */
export function leadScrew(parent: THREE.Object3D, at: V3, length: number, { r = 0.4, lead = 1, starts = 1, ball = false } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const spin = add(group, new THREE.Group())
  const steel = STEEL()
  rod(spin, [0, 0, 0], [0, length, 0], r * 0.78, steel, 16)
  const along = add(spin, new THREE.Group())
  along.rotation.z = Math.PI / 2
  const turns = length / lead
  for (let k = 0; k < starts; k++) {
    const h = add(along, mesh(new THREE.TubeGeometry(new Helix(r * 0.8, length, turns), Math.ceil(turns * 18), r * (ball ? 0.26 : 0.2), 6), steel))
    h.rotation.x = (k * 2 * Math.PI) / starts
  }
  const nut = add(group, new THREE.Group())
  const body = mat(ball ? '#9aa1ab' : '#c9a24a', { metal: 0.4, rough: 0.35 })
  cylinder(nut, r * (ball ? 2.1 : 1.6), r * 2.6, body, [0, 0, 0], 'y', 28)
  cylinder(nut, r * (ball ? 2.9 : 2.5), r * 0.4, body, [0, r * 1.1, 0], 'y', 28)
  if (ball) {
    const tube = mat('#6c737d', { metal: 0.35, rough: 0.4 })
    rod(nut, [r * 2.1, -r * 0.9, r * 0.6], [r * 2.6, -r * 0.9, r * 0.6], r * 0.25, tube)
    rod(nut, [r * 2.6, -r * 0.9, r * 0.6], [r * 2.6, r * 0.5, r * 0.6], r * 0.25, tube)
    rod(nut, [r * 2.6, r * 0.5, r * 0.6], [r * 2.1, r * 0.5, r * 0.6], r * 0.25, tube)
  }
  return {
    group,
    spin,
    nut,
    set(y: number) {
      nut.position.y = y
      spin.rotation.y = (-2 * Math.PI * y) / lead
    },
  }
}
