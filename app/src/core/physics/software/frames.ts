// TF frame tree: 2D pose algebra, a loop drive with drifting odometry, and a lidar point chained lidar_link → base_link → odom → map.
import { Pose, P3, toRoom } from '../room'
import { wrapPi } from '../sensors/magnetometer'
import { Mat4, ROVER, apply4, invert4, linkFrames, mul4, tf3 } from './urdf'

/** a ∘ b: pose b given in frame a, expressed in a's parent. */
export function compose2(a: Pose, b: Pose): Pose {
  const [x, y] = toRoom(a, b.x, b.y)
  return { x, y, th: wrapPi(a.th + b.th) }
}

export function invert2(a: Pose): Pose {
  const c = Math.cos(a.th)
  const s = Math.sin(a.th)
  return { x: -(c * a.x + s * a.y), y: s * a.x - c * a.y, th: wrapPi(-a.th) }
}

/** Planar pose as a 4×4 at height `z`. */
export const poseTf = (p: Pose, z = 0): Mat4 => tf3([p.x, p.y, z], [0, 0, p.th])

/** Loop: straights of `LOOP.straight` m joined by half circles of `LOOP.r` m, counter-clockwise, starting at `LOOP.start`. */
export const LOOP = { straight: 2, r: 0.8, start: { x: -1, y: 0, th: 0 } as Pose }
export const loopLength = () => 2 * LOOP.straight + 2 * Math.PI * LOOP.r

/** True robot pose in map after driving `s` m around the loop. */
export function loopPose(s: number): Pose {
  const { straight: L, r, start } = LOOP
  let u = ((s % loopLength()) + loopLength()) % loopLength()
  const arc = Math.PI * r
  for (const [cx, cy, th0] of [
    [start.x + L, start.y + r, 0],
    [start.x, start.y + r, Math.PI],
  ]) {
    if (u < L) return { x: start.x + (th0 ? L - u : u), y: th0 ? start.y + 2 * r : start.y, th: th0 }
    u -= L
    if (u < arc) {
      const th = th0 + u / r
      return { x: cx + r * Math.sin(th), y: cy - r * Math.cos(th), th: wrapPi(th) }
    }
    u -= arc
  }
  return start
}

/** Odometry errors: wheel scale (distance), turn scale, and heading creep per metre. */
export const ODOM_ERR = { scale: 0.015, turn: 0.03, creepPerM: 0.02 }
const ODOM_DS = 0.005

/** Odometry's pose in the odom frame (0 at the start) after `s` m: integrates the true increments with `ODOM_ERR`. */
export function odomPose(s: number): Pose {
  let p: Pose = { x: 0, y: 0, th: 0 }
  let prev = loopPose(0)
  for (let d = ODOM_DS; d <= s + 1e-9; d += ODOM_DS) {
    const cur = loopPose(d)
    const ds = ODOM_DS * (1 + ODOM_ERR.scale)
    const dth = wrapPi(cur.th - prev.th) * (1 + ODOM_ERR.turn) + ODOM_ERR.creepPerM * ODOM_DS
    const mid = p.th + dth / 2
    p = { x: p.x + ds * Math.cos(mid), y: p.y + ds * Math.sin(mid), th: wrapPi(p.th + dth) }
    prev = cur
  }
  return p
}

/** The post the lidar watches: centre in map, radius, m. */
export const POST = { x: 0.4, y: 2.3, r: 0.06 }

export interface TfChain {
  truth: Pose
  odom: Pose
  /** map → odom used: the localizer's correction, or frozen at the start without one. */
  mapOdom: Pose
  baseLidar: Mat4
  /** The lidar hit expressed in lidar_link, base_link, odom, map. */
  p: [P3, P3, P3, P3]
  /** Where the hit really is, in map. */
  hit: P3
  /** |computed − real| in map, m. */
  err: number
}

/** Lidar hit on `POST` after `s` m, chained to map through `ROVER`'s lidar_joint, odometry and map → odom. */
export function tfChain(s: number, corrected: boolean): TfChain {
  const truth = loopPose(s)
  const odom = odomPose(s)
  const mapOdom = corrected ? compose2(truth, invert2(odom)) : LOOP.start
  const baseLidar = linkFrames(ROVER).lidar_link
  const mapLidar = mul4(poseTf(truth), baseLidar)
  const l = apply4(mapLidar, [0, 0, 0])
  const d = Math.hypot(POST.x - l[0], POST.y - l[1])
  const hit: P3 = [POST.x - (POST.r * (POST.x - l[0])) / d, POST.y - (POST.r * (POST.y - l[1])) / d, l[2]]
  const pl = apply4(invert4(mapLidar), hit)
  const pb = apply4(baseLidar, pl)
  const po = apply4(poseTf(odom), pb)
  const pm = apply4(poseTf(mapOdom), po)
  return { truth, odom, mapOdom, baseLidar, p: [pl, pb, po, pm], hit, err: Math.hypot(pm[0] - hit[0], pm[1] - hit[1], pm[2] - hit[2]) }
}
