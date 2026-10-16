// Wheeled robots on a floor, in metres (x forward, y left, z up) inside a `floorView`.
import * as THREE from 'three/webgpu'
import { Pose, TT_TRACK_M, TT_WHEEL_MM } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import { HIGH_V, glowMat, setGlow } from './colors'

const WHEEL_R = TT_WHEEL_MM / 2000
const KIT_UNIT_M = 0.00254

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
      const pm = glowMat(HIGH_V, 0)
      pm.transparent = true
      pm.opacity = 0
      pm.depthWrite = false
      const patch = box(group, [0.05, 0.034, 0.002], pm, [0, s * half, 0.002])
      patch.castShadow = false
      patches.push(pm)
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
      ;[l, r].forEach((u, i) => {
        if (!patches[i]) return
        setGlow(patches[i], HIGH_V, 1.6 * u)
        patches[i].opacity = Math.min(1, u * 1.2)
      })
    },
  }
}
