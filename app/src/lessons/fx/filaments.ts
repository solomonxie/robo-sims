// Filament visuals: per-filament tints, a spool (face-on, see-through flanges) and a bendable strand.
import * as THREE from 'three/webgpu'
import { FilamentKey } from '../../core/physics'
import { V3, add, cylinder, mat } from '../../models/kit'
import { MATERIAL_TINT } from './beams'
import { shadowlessRod, stretchRod } from './layout'
import { shellMat } from './shapes'

export const FILAMENT_TINT: Record<FilamentKey, string> = {
  pla: MATERIAL_TINT.pla,
  petg: MATERIAL_TINT.petg,
  asa: '#e05252',
  tpu: '#7ad151',
  nylon: '#ece4cc',
  pc: '#b08cff',
}

/** 1 kg spool in mm × `k`, axis along z: `set(color, fill)` (fill 0…1 of the winding), `group.rotation` spins it. */
export function filamentSpool(parent: THREE.Object3D, at: V3, k: number) {
  const group = add(parent, new THREE.Group(), at)
  const wind = mat('#ff8a3d', { rough: 0.55 }, true)
  const coil = cylinder(group, 80 * k, 56 * k, wind, [0, 0, 0], 'z', 48)
  for (const z of [-30, 30]) {
    cylinder(group, 100 * k, 3 * k, shellMat('#c9ced6', 0.35), [0, 0, z * k], 'z', 48)
  }
  cylinder(group, 28 * k, 62 * k, mat('#2e323a', { rough: 0.6 }), [0, 0, 0], 'z', 24)
  cylinder(group, 15 * k, 63 * k, mat('#0d0f12', { rough: 0.9 }), [0, 0, 0], 'z', 20)
  return {
    group,
    set(color: string, fill = 1) {
      wind.color.set(color)
      const r = (30 + 50 * Math.max(0.05, fill)) / 80
      coil.scale.set(r, 1, r)
    },
  }
}

/** Strand of `n` rod segments (radius `r`) through a polyline; `set(points)` bends it, `color(c)` tints it. */
export function filamentStrand(parent: THREE.Object3D, n: number, r: number, color: string) {
  const m = mat(color, { rough: 0.5 }, true)
  const rods = Array.from({ length: n }, () => add(parent, shadowlessRod(m)))
  return {
    set(points: readonly V3[]) {
      rods.forEach((rod, i) => {
        rod.visible = i + 1 < points.length
        if (rod.visible) stretchRod(rod, points[i], points[i + 1], r)
      })
    },
    color: (c: string) => m.color.set(c),
  }
}
