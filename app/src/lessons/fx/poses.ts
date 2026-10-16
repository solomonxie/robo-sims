// Pose estimates on a floor (metres, z up): covariance ellipses and polyline paths.
import * as THREE from 'three/webgpu'
import { Cov3, covEllipse, ellipsePoints } from '../../core/physics'
import { V3 } from '../../models/kit'
import { glowMat } from './colors'
import { rayFan } from './rooms'

/** Up to `max` k-σ ellipses drawn as `n`-segment rings; `draw([[cx, cy, P], …])`. */
export function covRings(parent: THREE.Object3D, max: number, color: string, { n = 24, k = 2, width = 0.006, z = 0.012 } = {}) {
  const fan = rayFan(parent, max * n, glowMat(color, 1), width)
  return (rings: [number, number, Cov3][]) => {
    const segs: [V3, V3][] = []
    for (const [cx, cy, P] of rings.slice(0, max)) {
      const pts = ellipsePoints(cx, cy, covEllipse(P, k), n)
      pts.forEach((a, i) => segs.push([[a[0], a[1], z], [pts[(i + 1) % n][0], pts[(i + 1) % n][1], z]]))
    }
    fan(segs)
  }
}

/** Polyline through up to `max` + 1 floor points; `draw(points, count)` redraws only when they change. */
export function chordPath(parent: THREE.Object3D, max: number, color: string, width = 0.005, z = 0.008) {
  const fan = rayFan(parent, max, glowMat(color, 1), width)
  const st = { n: -1, pts: null as unknown }
  return (pts: readonly { x: number; y: number }[], count = pts.length) => {
    if (count === st.n && pts === st.pts) return
    Object.assign(st, { n: count, pts })
    const segs: [V3, V3][] = []
    for (let i = 1; i < Math.min(count, max + 1); i++) segs.push([[pts[i - 1].x, pts[i - 1].y, z], [pts[i].x, pts[i].y, z]])
    fan(segs)
  }
}
