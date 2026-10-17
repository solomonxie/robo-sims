// Pose estimates on a floor (metres, z up): covariance ellipses, polyline paths, the room + ghost stage and its side scope.
import * as THREE from 'three/webgpu'
import { CLUTTER, Cov3, XY, covEllipse, ellipsePoints } from '../../core/physics'
import { V3 } from '../../models/kit'
import { GREY, LABEL, RING, glowMat } from './colors'
import { floorView, rayFan, roomModel } from './rooms'
import { cursorBar, scope } from './screens'
import { addLabel, liveLabel } from './text'
import { diffBot } from './wheeled'

/** Camera for a tilted room on the left and a scope on the right. */
export const PLAN_VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
/** Camera for the grid and maze boards. */
export const BOARD_VIEW = { center: [-2.2, 2, 0] as V3, radius: 54, polar: Math.PI / 2, azimuth: 0 }
/** Tilted 2.5 m deep room on the left, its top edge, and the scope box on the right. */
export const ROOM_RIG = { at: [-18.6, -5.6, 0] as V3, k: 5.6, tilt: -0.5 }
export const ROOM_TOP = ROOM_RIG.at[1] + 2.5 * ROOM_RIG.k * Math.cos(ROOM_RIG.tilt)
export const PLAN_SCOPE = { x: 10.4, y: -0.6, w: 10.5, h: 6.4 }

export const xyPose = (p: XY) => ({ x: p[0], y: p[1] })
export const floorPt = (p: { x: number; y: number } | XY, z = 0.02): V3 => (Array.isArray(p) ? [p[0], p[1], z] : [p.x, p.y, z])
/** Inside the CLUTTER room plus a 15 cm margin. */
export const inClutter = (w: XY) => w[0] > -0.15 && w[1] > -0.15 && w[0] < CLUTTER.w + 0.15 && w[1] < CLUTTER.d + 0.15

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

/** CLUTTER room on a tilted floor, the true robot, a ghost estimate and status lines over it. */
export function locStage(scene: THREE.Scene, hScale: number, opacity = 1) {
  const g = floorView(scene, ROOM_RIG.at, ROOM_RIG.k, ROOM_RIG.tilt)
  roomModel(g, hScale, opacity).draw(CLUTTER)
  return {
    g,
    bot: diffBot(g),
    ghost: diffBot(g, { ghost: RING }),
    status: liveLabel(scene, [ROOM_RIG.at[0], ROOM_TOP + 2.0, 0.3], { size: 0.44, align: 'left' }),
    sub: liveLabel(scene, [ROOM_RIG.at[0], ROOM_TOP + 1.2, 0.3], { size: 0.3, color: GREY, align: 'left' }),
  }
}

/** Scope on the right: title, range note, x-axis ends (right end live unless given) and three text lines. */
export function planScope(scene: THREE.Scene, title: string, xLeft: string, { xRight = null as string | null, zeroAt = 0 } = {}) {
  const W = PLAN_SCOPE
  const plot = scope(scene, W.w, W.h, { divs: [6, 4], zeroAt })
  plot.group.position.set(W.x, W.y, 0)
  addLabel(scene, title, [W.x - W.w / 2, W.y + W.h / 2 + 1.7, 0.3], LABEL, 0.34, 'left')
  const range = liveLabel(scene, [W.x - W.w / 2, W.y + W.h / 2 + 0.9, 0.3], { size: 0.28, color: GREY, align: 'left' })
  addLabel(scene, xLeft, [W.x - W.w / 2, W.y - W.h / 2 - 0.9, 0.3], GREY, 0.28, 'left')
  const at: V3 = [W.x + W.w / 2, W.y - W.h / 2 - 0.9, 0.3]
  const xEnd = xRight === null ? liveLabel(scene, at, { size: 0.28, color: GREY, align: 'right' }) : (addLabel(scene, xRight, at, GREY, 0.28, 'right'), null)
  const lines = [0, 1, 2].map((k) => liveLabel(scene, [W.x - W.w / 2, W.y - W.h / 2 - 2.0 - k * 0.8, 0.3], { size: 0.32, align: 'left' }))
  return { plot, range, xRight: xEnd!, lines, cursor: cursorBar(plot, LABEL, 0.05) }
}
