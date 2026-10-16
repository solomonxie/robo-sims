// Multirotors in metres (x forward, y left, z up): a 5" X-frame quad with spinning props, spin arcs and thrust arrows.
import * as THREE from 'three/webgpu'
import { QUAD, QUAD_MOTORS } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { B_FIELD, HEAT, HIGH_V, POWER, glowMat } from './colors'
import { stretchArrow } from './shapes'

/** Prop colour by spin seen from above: clockwise, counter-clockwise. */
export const SPIN_COLORS = { cw: HEAT, ccw: B_FIELD }
const PROP_R = 0.0635

/** Curved arrow of radius `r` around local z (counter-clockwise from above; `cw` mirrors it), `arc` rad long. */
export function spinArc(parent: THREE.Object3D, r: number, color: string, { arc = 4.4, thick = r * 0.06, cw = false } = {}) {
  const g = add(parent, new THREE.Group())
  const m = glowMat(color, 0.9)
  m.side = THREE.DoubleSide
  const ring = add(g, mesh(new THREE.TorusGeometry(r, thick, 6, 40, arc), m))
  const head = add(g, mesh(new THREE.ConeGeometry(thick * 2.6, thick * 7, 12), m), [r * Math.cos(arc), r * Math.sin(arc), 0])
  head.rotation.z = arc
  ring.castShadow = head.castShadow = false
  if (cw) g.rotation.x = Math.PI
  return g
}

/** Quad X (250 mm diagonal, 5" tri-blade props, 4S pack on top); motors in `QUAD_MOTORS` order. `pose(roll, pitch, yaw)` tilts `body`;
 *  `set(spin, share, clipped)` turns each prop by its angle (rad, direction from its spin) and sizes its thrust arrow (share 0…1 → `arrowLen`). */
export function quadcopter(parent: THREE.Object3D, { arrowLen = 0.16, arrowR = 0.0035, arcs = true } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, new THREE.Group())
  body.rotation.order = 'ZYX'
  const carbon = mat('#2a2c30', { rough: 0.45 })
  const d = QUAD.arm / Math.SQRT2
  const at = QUAD_MOTORS.map((m): V3 => [m.x * d, m.y * d, 0])
  for (const p of at) {
    const arm = add(body, new THREE.Group(), [p[0] / 2, p[1] / 2, 0])
    arm.rotation.z = Math.atan2(p[1], p[0])
    box(arm, [QUAD.arm, 0.014, 0.005], carbon)
  }
  box(body, [0.09, 0.05, 0.003], carbon, [0, 0, 0.004])
  box(body, [0.09, 0.05, 0.003], carbon, [0, 0, 0.032])
  for (const x of [-0.04, 0.04]) for (const y of [-0.02, 0.02]) cylinder(body, 0.0018, 0.028, mat('#c9a24a', { metal: 0.4, rough: 0.4 }), [x, y, 0.018], 'z', 8)
  box(body, [0.036, 0.036, 0.002], mat('#1d5e3a', { rough: 0.5 }), [-0.005, 0, 0.012])
  box(body, [0.036, 0.036, 0.002], mat('#20232a', { rough: 0.5 }), [-0.005, 0, 0.02])
  box(body, [0.075, 0.035, 0.03], mat('#3a3f48', { rough: 0.55 }), [-0.01, 0, 0.049])
  box(body, [0.012, 0.037, 0.031], mat('#e0b020', { rough: 0.6 }), [-0.01, 0, 0.049])
  box(body, [0.016, 0.02, 0.018], mat('#1c1c1f', { rough: 0.6 }), [0.04, 0, 0.018])
  cylinder(body, 0.006, 0.006, mat('#0d1a2a', { rough: 0.2, metal: 0.3 }), [0.05, 0, 0.018], 'x', 16)
  box(body, [0.006, 0.01, 0.003], glowMat(HIGH_V, 1.2), [0.046, 0, 0.034])

  const bell = mat('#9aa0a8', { metal: 0.35, rough: 0.4 })
  const thrust: ((a: V3, b: V3, c?: string) => void)[] = []
  const props = QUAD_MOTORS.map((m, i) => {
    const color = m.spin > 0 ? SPIN_COLORS.cw : SPIN_COLORS.ccw
    const mount = add(body, new THREE.Group(), at[i])
    cylinder(mount, 0.012, 0.004, carbon, [0, 0, 0.004], 'z', 20)
    cylinder(mount, 0.014, 0.014, bell, [0, 0, 0.013], 'z', 24)
    cylinder(mount, 0.0145, 0.003, mat(color, { rough: 0.5 }), [0, 0, 0.021], 'z', 24)
    const rotor = add(mount, new THREE.Group(), [0, 0, 0.026])
    cylinder(rotor, 0.005, 0.008, mat('#d8dce2', { metal: 0.4, rough: 0.35 }), [0, 0, 0.002], 'z', 12)
    const blade = mat(color, { rough: 0.4, opacity: 0.9 })
    for (let k = 0; k < 3; k++) {
      const arm = add(rotor, new THREE.Group())
      arm.rotation.z = (k * 2 * Math.PI) / 3
      const b = box(arm, [PROP_R - 0.006, 0.011, 0.0015], blade, [(PROP_R + 0.006) / 2, 0, 0])
      b.rotation.x = -m.spin * 0.3
    }
    const blurM = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    const blur = add(mount, mesh(new THREE.CircleGeometry(PROP_R, 40), blurM), [0, 0, 0.027])
    blur.castShadow = false
    if (arcs) spinArc(mount, PROP_R + 0.012, color, { cw: m.spin > 0, thick: 0.0018 }).position.z = 0.03
    thrust.push(stretchArrow(mount, POWER, arrowR))
    return { rotor, blurM, spin: m.spin }
  })

  return {
    group,
    body,
    /** Motor centre in body coordinates. */
    motorAt: (i: number): V3 => [...at[i]],
    pose(roll: number, pitch: number, yaw = 0) {
      body.rotation.set(roll, -pitch, -yaw)
    },
    set(spin: readonly number[], share: readonly number[], clipped: readonly boolean[] = []) {
      props.forEach((p, i) => {
        p.rotor.rotation.z = -p.spin * spin[i]
        p.blurM.opacity = 0.35 * Math.sqrt(Math.max(0, share[i]))
        thrust[i]([0, 0, 0.034], [0, 0, 0.034 + arrowLen * share[i]], clipped[i] ? HIGH_V : POWER)
      })
    },
  }
}
