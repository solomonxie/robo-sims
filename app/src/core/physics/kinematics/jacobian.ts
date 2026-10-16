// Position Jacobians: how fast the tool point moves per unit joint speed.
import { Mat } from '../control/linalg'
import { SerialArm, armFk } from './chain'
import { axisOf, originOf } from './transforms'

const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** 3×n: revolute column = z(i−1) × (p_tool − p(i−1)), prismatic column = z(i−1). */
export function armJacobian(arm: SerialArm, q: readonly number[]): Mat {
  const f = armFk(arm, q)
  const tip = originOf(f[f.length - 1])
  const cols = arm.rows.map((r, i) => {
    const z = axisOf(f[i], 2)
    if (r.kind === 'prismatic') return z
    const o = originOf(f[i])
    return cross(z, [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]])
  })
  return [0, 1, 2].map((k) => cols.map((c) => c[k]))
}

/** 2×n for a planar arm: column i = ∂(x, y)/∂q_i = (−(y_tip − y_i), x_tip − x_i). */
export function planarJacobian(lengths: readonly number[], q: readonly number[]): Mat {
  const pts: [number, number][] = [[0, 0]]
  let phi = 0
  lengths.forEach((l, i) => {
    phi += q[i] ?? 0
    pts.push([pts[i][0] + l * Math.cos(phi), pts[i][1] + l * Math.sin(phi)])
  })
  const [tx, ty] = pts[lengths.length]
  return [lengths.map((_, i) => -(ty - pts[i][1])), lengths.map((_, i) => tx - pts[i][0])]
}
