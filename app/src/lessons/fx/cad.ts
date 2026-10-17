// CAD visuals: a sketch pen (2D polylines as glowing rods, one colour each) and a sketch extruded into a plate, `k` scene units per mm.
import * as THREE from 'three/webgpu'
import { PlateSketch, sketchPoints } from '../../core/physics'
import { glowMat } from './colors'
import { addRod, stretchRod } from './layout'

/** CAD colours: blue = under-constrained, white (black in most CAD) = fully constrained. */
export const SKETCH_FREE = '#4da3ff'
export const SKETCH_FIXED = '#f2f2f2'

export type PenLine = { pts: readonly (readonly [number, number])[]; color: string }

/** Pool of rods drawing polylines in the xy plane of `parent`; `draw(lines)` reuses rods and hides the rest. */
export function sketchPen(parent: THREE.Object3D, r = 0.05) {
  const mats = new Map<string, THREE.Material>()
  const matOf = (c: string) => mats.get(c) ?? mats.set(c, glowMat(c, 0.9)).get(c)!
  const rods: THREE.Mesh[] = []
  return {
    draw(lines: readonly PenLine[]) {
      let i = 0
      for (const { pts, color } of lines)
        for (let j = 1; j < pts.length; j++) {
          const rod = rods[i] ?? (rods[i] = addRod(parent, matOf(color)) as THREE.Mesh)
          rod.material = matOf(color)
          stretchRod(rod, [pts[j - 1][0], pts[j - 1][1], 0], [pts[j][0], pts[j][1], 0], r)
          i++
        }
      for (; i < rods.length; i++) rods[i].visible = false
    },
  }
}

/** Sketch outline minus its holes, extruded `t` mm along +z from z = 0. */
export function plateGeometry(p: PlateSketch, k: number, t: number, n = 10) {
  const [outline, ...holes] = p.contours
  const toPath = <T extends THREE.Path>(path: T, pts: [number, number][]) => {
    pts.forEach(([x, y], i) => (i ? path.lineTo(x * k, y * k) : path.moveTo(x * k, y * k)))
    return path
  }
  const shape = toPath(new THREE.Shape(), sketchPoints(outline, p.fillet, n))
  for (const h of holes) shape.holes.push(toPath(new THREE.Path(), sketchPoints(h, 0, 2 * n).reverse()))
  return new THREE.ExtrudeGeometry(shape, { depth: t * k, bevelEnabled: false, curveSegments: 1 })
}
