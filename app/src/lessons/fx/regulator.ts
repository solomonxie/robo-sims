// Regulator parts: the SOT-223 AMS1117 seen from above.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, STEEL } from '../../models/kit'
import { litEpoxy } from './bjt'
import { glowHalo } from './circuit'
import { CONVENTIONAL } from './colors'
import { heatGlow } from './heat'
import { clamp01 } from './util'

const MM = 1 / 2.54

/** AMS1117 in SOT-223 (6.5 × 3.5 mm body) facing +z at `at`, `scale` × real: the three gull-wing legs point +x
 *  (IN on top, OUT, GND at the bottom), the big OUT tab sticks out −x. `pins` are the leg and tab tips at z = 0.
 *  `set(f, heat)`: f = current / rated glows the die, heat 0..1 reddens the body. */
export function sot223Regulator(parent: THREE.Object3D, at: V3, scale = 2.4) {
  const k = MM * scale
  const group = add(parent, new THREE.Group(), at)
  const bodyMat = mat('#1c1d22', { rough: 0.5 }, true)
  litEpoxy(bodyMat)
  box(group, [3.5 * k, 6.5 * k, 1.6 * k], bodyMat, [0, 0, 0])
  cylinder(group, 0.35 * k, 0.1 * k, mat('#30323a'), [-1 * k, -2.4 * k, 0.8 * k], 'z', 16)
  const tin = STEEL()
  box(group, [2.4 * k, 3 * k, 0.3 * k], tin, [-2.7 * k, 0, -0.65 * k])
  const legX = 1.75 * k
  const ys = [2.3, 0, -2.3].map((y) => y * k)
  for (const y of ys) {
    box(group, [0.9 * k, 0.7 * k, 0.26 * k], tin, [legX + 0.45 * k, y, -0.3 * k])
    box(group, [0.26 * k, 0.7 * k, 0.6 * k], tin, [legX + 0.9 * k, y, -0.55 * k])
    box(group, [0.9 * k, 0.7 * k, 0.26 * k], tin, [legX + 1.35 * k, y, -0.8 * k])
  }
  const halo = glowHalo(group, [0, 0, 1.2 * k], 1.4 * k)
  const tip = legX + 1.8 * k
  const p = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group,
    pins: { in: p(tip, ys[0]), out: p(tip, ys[1]), gnd: p(tip, ys[2]), tab: p(-3.9 * k, 0) },
    set(f: number, heat = 0) {
      halo.set(0.5 * Math.sqrt(clamp01(f)), CONVENTIONAL)
      heatGlow(bodyMat, heat)
    },
  }
}
