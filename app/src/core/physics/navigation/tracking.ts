// Path tracking: route frame (closest point, signed cross-track error, heading), lookahead circle hit, pure pursuit on a diff-drive with wheel lag, Stanley vs pure pursuit on a bicycle car.
import { clamp, wrapPi } from '../common'
import { Pose } from '../room'
import { CAR_SERVO, CarOpts, carTrack, pursuitSteer } from '../mobility/ackermann'
import { diffInverse, diffStep } from '../mobility/diffdrive'
import { XY } from '../software/costmap'

export type Route = ReturnType<typeof routeOf>

/** Closed (or open) polyline with arc length: `wrap(s)`, `at(s)`, `dirAt(s)`, `frame(x, y)` → closest s, signed error e (+ = robot left of the route), route heading. */
export function routeOf(pts: XY[], closed = true) {
  const segs: { a: XY; dx: number; dy: number; len: number; s0: number; dir: number }[] = []
  let length = 0
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-9) continue
    segs.push({ a, dx: b[0] - a[0], dy: b[1] - a[1], len, s0: length, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) })
    length += len
  }
  const wrap = (s: number) => (closed ? ((s % length) + length) % length : clamp(s, 0, length))
  const segAt = (s: number) => {
    let [lo, hi] = [0, segs.length - 1]
    while (lo < hi) {
      const m = Math.ceil((lo + hi) / 2)
      if (segs[m].s0 <= s) lo = m
      else hi = m - 1
    }
    return lo
  }
  const at = (s: number): XY => {
    const u = wrap(s)
    const g = segs[segAt(u)]
    const t = Math.min(1, (u - g.s0) / g.len)
    return [g.a[0] + g.dx * t, g.a[1] + g.dy * t]
  }
  return {
    pts,
    closed,
    length,
    segs,
    wrap,
    at,
    dirAt: (s: number) => segs[segAt(wrap(s))].dir,
    frame(x: number, y: number) {
      let best = { d2: Infinity, i: 0, t: 0 }
      segs.forEach((g, i) => {
        const t = clamp(((x - g.a[0]) * g.dx + (y - g.a[1]) * g.dy) / (g.len * g.len), 0, 1)
        const d2 = (x - g.a[0] - t * g.dx) ** 2 + (y - g.a[1] - t * g.dy) ** 2
        if (d2 < best.d2) best = { d2, i, t }
      })
      const g = segs[best.i]
      const c: XY = [g.a[0] + g.dx * best.t, g.a[1] + g.dy * best.t]
      const side = g.dx * (y - c[1]) - g.dy * (x - c[0])
      const d = Math.sqrt(best.d2)
      return { s: wrap(g.s0 + best.t * g.len), e: side < 0 ? -d : d, dir: g.dir, at: c, i: best.i, t: best.t }
    },
  }
}

/** First point ahead of the closest one where the route leaves a circle of radius `look` round (x, y); `hit` false (closest point) when the route is further than `look`; `e` = signed error at (x, y). */
export function lookaheadPoint(r: Route, x: number, y: number, look: number) {
  const f = r.frame(x, y)
  if (Math.abs(f.e) >= look) return { at: f.at, s: f.s, hit: false, e: f.e }
  const n = r.segs.length
  let t0 = f.t
  for (let k = 0; k < (r.closed ? n + 1 : n - f.i); k++) {
    const g = r.segs[(f.i + k) % n]
    const [ox, oy] = [g.a[0] - x, g.a[1] - y]
    const A = g.len * g.len
    const B = ox * g.dx + oy * g.dy
    const C = ox * ox + oy * oy - look * look
    const t = (-B + Math.sqrt(Math.max(0, B * B - A * C))) / A
    if (t >= t0 && t <= 1) return { at: [g.a[0] + g.dx * t, g.a[1] + g.dy * t] as XY, s: r.wrap(g.s0 + t * g.len), hit: true, e: f.e }
    t0 = 0
  }
  return { at: r.at(r.closed ? f.s : r.length), s: r.closed ? f.s : r.length, hit: true, e: f.e }
}

/** Round every corner turning more than `minTurn` rad with a circular arc of radius `r` (smaller where the legs are short); end points stay. */
export function filleted(pts: XY[], r: number, minTurn = 0.35, k = 10): XY[] {
  const out: XY[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const l1 = Math.hypot(a[0] - b[0], a[1] - b[1])
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1])
    const u1: XY = [(a[0] - b[0]) / l1, (a[1] - b[1]) / l1]
    const u2: XY = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2]
    const inner = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1))
    if (Math.PI - inner < minTurn) {
      out.push(b)
      continue
    }
    const t = Math.min(r / Math.tan(inner / 2), l1 / 2, l2 / 2)
    const rr = t * Math.tan(inner / 2)
    const bis = Math.hypot(u1[0] + u2[0], u1[1] + u2[1])
    const h = rr / Math.sin(inner / 2)
    const o: XY = [b[0] + ((u1[0] + u2[0]) / bis) * h, b[1] + ((u1[1] + u2[1]) / bis) * h]
    const p1: XY = [b[0] + u1[0] * t, b[1] + u1[1] * t]
    const p2: XY = [b[0] + u2[0] * t, b[1] + u2[1] * t]
    const a1 = Math.atan2(p1[1] - o[1], p1[0] - o[0])
    const sweep = wrapPi(Math.atan2(p2[1] - o[1], p2[0] - o[0]) - a1)
    for (let j = 0; j <= k; j++) out.push([o[0] + rr * Math.cos(a1 + (sweep * j) / k), o[1] + rr * Math.sin(a1 + (sweep * j) / k)])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Robot-frame offset of a world point (x ahead, y left). */
export function toRobot(p: Pose, q: XY): XY {
  const [dx, dy] = [q[0] - p.x, q[1] - p.y]
  return [Math.cos(p.th) * dx + Math.sin(p.th) * dy, -Math.sin(p.th) * dx + Math.cos(p.th) * dy]
}

/** Pure pursuit: curvature of the arc tangent to the heading through the goal, κ = 2y / ld². */
export function pursuitCurvature(p: Pose, goal: XY) {
  const [gx, gy] = toRobot(p, goal)
  return (2 * gy) / Math.max(1e-9, gx * gx + gy * gy)
}

const STANLEY = { soft: 0.1 }

/** Stanley steer at the front axle: heading error + atan(k e / (soft + v)), clamped to lock. */
export function stanleySteer(front: Pose, e: number, dir: number, k: number, v: number, max: number, soft = STANLEY.soft) {
  const head = wrapPi(dir - front.th)
  const cross = Math.atan2(-k * e, soft + Math.abs(v))
  return { delta: clamp(head + cross, -max, max), head, cross }
}

/** TT diff-drive for tracking: track (m), top wheel speed (m/s). */
const TRACK_BOT = { track: 0.135, wheelMax: 0.6 }

interface DiffTrackFrame {
  t: number
  pose: Pose
  goal: XY
  hit: boolean
  e: number
  kappa: number
  vL: number
  vR: number
  sat: boolean
}

interface DiffTrackOpts {
  look: number
  v: number
  /** Wheel speed time constant (s). */
  tau: number
  seconds: number
  /** Start offset left of the route (m). */
  offset: number
  dt?: number
}

/** Start pose `offset` m left of the route start, heading along it. */
export function routeStart(r: Route, offset: number): Pose {
  const [x, y] = r.at(0)
  const th = r.dirAt(0)
  return { x: x - Math.sin(th) * offset, y: y + Math.cos(th) * offset, th }
}

/** Pure pursuit on a diff-drive: ω = v κ → wheel speeds (scaled down together if one exceeds the top speed), each wheel lagging with time constant τ. */
export function pursuitDiffRun(r: Route, o: DiffTrackOpts) {
  const dt = o.dt ?? 0.01
  const { track, wheelMax } = TRACK_BOT
  let pose = routeStart(r, o.offset)
  let [vL, vR] = [0, 0]
  const out: DiffTrackFrame[] = []
  for (let k = 0; k * dt <= o.seconds; k++) {
    const la = lookaheadPoint(r, pose.x, pose.y, o.look)
    const e = la.e
    const kappa = pursuitCurvature(pose, la.at)
    const want = diffInverse(o.v, o.v * kappa, track)
    const peak = Math.max(Math.abs(want[0]), Math.abs(want[1]))
    const sat = peak > wheelMax
    const [cL, cR] = sat ? want.map((w) => (w * wheelMax) / peak) : want
    const a = o.tau > 0 ? 1 - Math.exp(-dt / o.tau) : 1
    vL += (cL - vL) * a
    vR += (cR - vR) * a
    out.push({ t: k * dt, pose, goal: la.at, hit: la.hit, e, kappa, vL, vR, sat })
    pose = diffStep(pose, vL, vR, track, dt)
  }
  return out
}

export interface CarTrackFrame {
  t: number
  pose: Pose
  delta: number
  /** Cross-track error at the controller's own point (front axle for Stanley, rear for pure pursuit). */
  e: number
  target: XY
  head: number
  cross: number
}

/** Front-axle pose of a bicycle car (pose = rear axle). */
export const frontAxle = (p: Pose, L: number): Pose => ({ x: p.x + L * Math.cos(p.th), y: p.y + L * Math.sin(p.th), th: p.th })

/** Stanley at speed v on the bicycle car with servo lag; starts `offset` m left of the route. */
export function stanleyRun(r: Route, k: number, v: number, seconds: number, offset: number, o: CarOpts = CAR_SERVO): CarTrackFrame[] {
  const L = o.g.wheelbase
  const start = routeStart(r, offset)
  return carTrack({ x: start.x - L * Math.cos(start.th), y: start.y - L * Math.sin(start.th), th: start.th }, v, seconds, o, (pose, max) => {
    const f = frontAxle(pose, L)
    const fr = r.frame(f.x, f.y)
    const s = stanleySteer(f, fr.e, fr.dir, k, v, max)
    return { want: s.delta, frame: { e: fr.e, target: fr.at, head: s.head, cross: s.cross } }
  })
}

/** Pure pursuit (lookahead circle round the rear axle) on the same car, same start as `stanleyRun`. */
export function pursuitCarRun(r: Route, look: number, v: number, seconds: number, offset: number, o: CarOpts = CAR_SERVO): CarTrackFrame[] {
  const L = o.g.wheelbase
  const start = routeStart(r, offset)
  return carTrack({ x: start.x - L * Math.cos(start.th), y: start.y - L * Math.sin(start.th), th: start.th }, v, seconds, o, (pose, max) => {
    const la = lookaheadPoint(r, pose.x, pose.y, look)
    return { want: pursuitSteer(pose, la.at, L, max), frame: { e: la.e, target: la.at, head: 0, cross: 0 } }
  })
}

/** RMS and peak |e| over frames after `from` s, plus where the peak happened. */
export function errorStats(run: readonly { t: number; e: number; pose: Pose }[], from = 0) {
  let [sum, n, peak, at] = [0, 0, 0, run[0]?.pose]
  for (const f of run) {
    if (f.t < from) continue
    sum += f.e * f.e
    n++
    if (Math.abs(f.e) > peak) [peak, at] = [Math.abs(f.e), f.pose]
  }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak, at }
}
