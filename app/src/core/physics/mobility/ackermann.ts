// Ackermann steering: wheel angles per linkage, axle crossings and tyre scrub, turn radius, rear differential; bicycle model, pure pursuit, parallel parking.
import { DEG, clamp, wrapPi } from '../common'
import { Pose } from '../room'
import { diffInverse } from './diffdrive'
import { twistStep } from './mecanum'

/** 1/10 RC car: wheelbase L and kingpin track T (m), wheel radius, servo lock. Pose = rear-axle centre. */
export const ACKERMANN = { wheelbase: 0.26, track: 0.18, wheelR: 0.034, maxSteer: 30 * DEG, length: 0.4, width: 0.2 }
export type SteerGeo = 'ackermann' | 'parallel' | 'anti'
type CarGeo = { wheelbase: number; track: number }

/** Signed turn radius of the rear-axle centre for a bicycle steer δ (+ = left); Infinity when straight. */
export const bicycleRadius = (delta: number, L: number) => (Math.abs(delta) < 1e-9 ? Infinity : L / Math.tan(delta))

/** Front wheel angles [left, right] for a centre steer δ: Ackermann puts both axes through one ICC on the rear axle line; parallel copies δ; anti swaps inner and outer. */
export function steerAngles(delta: number, geo: SteerGeo, g: CarGeo = ACKERMANN): [number, number] {
  if (geo === 'parallel' || Math.abs(delta) < 1e-9) return [delta, delta]
  const R = bicycleRadius(delta, g.wheelbase)
  const l = Math.atan(g.wheelbase / (R - g.track / 2))
  const r = Math.atan(g.wheelbase / (R + g.track / 2))
  return geo === 'ackermann' ? [l, r] : [r, l]
}

/** Where each front wheel's axle line crosses the rear axle line (y, m; Infinity when parallel to it). */
export const axleHits = (angles: [number, number], g: CarGeo = ACKERMANN): [number, number] =>
  [0, 1].map((i) => {
    const a = angles[i]
    return Math.abs(a) < 1e-9 ? Infinity : (i ? -1 : 1) * (g.track / 2) + g.wheelbase / Math.tan(a)
  }) as [number, number]

/** Slip angle of each front tyre (wheel heading minus its true path) when the car turns about the rear-axle ICC at radius R. */
export function frontSlip(angles: [number, number], R: number, g: CarGeo = ACKERMANN): [number, number] {
  return [0, 1].map((i) => {
    const y = (i ? -1 : 1) * (g.track / 2)
    const path = Number.isFinite(R) ? Math.atan(g.wheelbase / (R - y)) : 0
    return wrapPi(angles[i] - path)
  }) as [number, number]
}

/** Tightest turn at full lock (inner wheel at `maxSteer`, Ackermann): rear-axle centre radius and kerb-to-kerb radius of the outer front wheel. */
export function minTurn(maxSteer: number, g: CarGeo = ACKERMANN) {
  const inner = g.wheelbase / Math.tan(maxSteer)
  const rear = inner + g.track / 2
  return { rear, delta: Math.atan(g.wheelbase / rear), outer: Math.hypot(g.wheelbase, rear + g.track / 2) }
}

/** Wheel ground speeds [FL, FR, RL, RR] for rear-centre speed v and centre steer δ; rear pair through a differential. */
export function wheelSpeeds(v: number, delta: number, g: CarGeo = ACKERMANN) {
  const R = bicycleRadius(delta, g.wheelbase)
  if (!Number.isFinite(R)) return [v, v, v, v]
  const [rl, rr] = diffInverse(v, v / R, g.track)
  const front = (y: number) => (v * Math.hypot(g.wheelbase, R - y)) / Math.abs(R)
  return [front(g.track / 2), front(-g.track / 2), rl, rr]
}

/** Locked rear axle (spool): both wheels at v, so each scrubs by its mismatch with the turn (m/s) [RL, RR]. */
export function spoolScrub(v: number, delta: number, g: CarGeo = ACKERMANN): [number, number] {
  const [, , rl, rr] = wheelSpeeds(v, delta, g)
  return [Math.abs(v - rl), Math.abs(v - rr)]
}

/** Exact bicycle-model step: ẋ = v cos θ, ẏ = v sin θ, θ̇ = v tan δ / L (pose at the rear axle). */
export const bicycleStep = (p: Pose, v: number, delta: number, L: number, dt: number) => twistStep(p, v, 0, (v * Math.tan(delta)) / L, dt)

/** World ICC for the bicycle model, null when straight. */
export function bicycleIcc(p: Pose, delta: number, L: number): [number, number] | null {
  const R = bicycleRadius(delta, L)
  return Number.isFinite(R) ? [p.x - R * Math.sin(p.th), p.y + R * Math.cos(p.th)] : null
}

/** Pure pursuit for a car: steer onto the arc through the carrot (rear axle → carrot distance ld), clamped to lock. */
export function pursuitSteer(p: Pose, carrot: [number, number], L: number, maxSteer: number) {
  const dx = carrot[0] - p.x
  const dy = carrot[1] - p.y
  const alpha = wrapPi(Math.atan2(dy, dx) - p.th)
  const ld = Math.max(1e-6, Math.hypot(dx, dy))
  return clamp(Math.atan2(2 * L * Math.sin(alpha), ld), -maxSteer, maxSteer)
}

/** Polyline with arc length: `project(x, y)` → closest s, `at(s)` → point. */
export function polyPath(pts: [number, number][]) {
  const seg = pts.slice(1).map((b, i) => ({ a: pts[i], b, len: Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1]) }))
  const length = seg.reduce((s, g) => s + g.len, 0)
  return {
    length,
    project(x: number, y: number) {
      let best = { s: 0, d: Infinity }
      let s0 = 0
      for (const { a, b, len } of seg) {
        const u = clamp(((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / len ** 2, 0, 1)
        const d = Math.hypot(x - a[0] - u * (b[0] - a[0]), y - a[1] - u * (b[1] - a[1]))
        if (d < best.d) best = { s: s0 + u * len, d }
        s0 += len
      }
      return best
    },
    at(s: number): [number, number] {
      let u = clamp(s, 0, length)
      for (const { a, b, len } of seg) {
        if (u <= len) return [a[0] + ((b[0] - a[0]) * u) / len, a[1] + ((b[1] - a[1]) * u) / len]
        u -= len
      }
      return pts[pts.length - 1]
    },
  }
}

export interface PursuitFrame {
  t: number
  pose: Pose
  delta: number
  carrot: [number, number]
  err: number
}

export type CarOpts = { dt: number; steerRate: number; lag: number; g: typeof ACKERMANN }
export const CAR_SERVO: CarOpts = { dt: 0.01, steerRate: 4, lag: 0.08, g: ACKERMANN }

/** Bicycle car at speed v for `seconds`: `steer(pose)` gives the wanted δ (clamped so the inner wheel stays within lock), applied `lag` s late through a servo slewing at `steerRate` rad/s. */
export function carTrack<F>(start: Pose, v: number, seconds: number, o: CarOpts, steer: (p: Pose, max: number) => { want: number; frame: F }) {
  let pose = start
  let delta = 0
  const max = minTurn(o.g.maxSteer, o.g).delta
  const queue: number[] = []
  const out: (F & { t: number; pose: Pose; delta: number })[] = []
  for (let k = 0; k * o.dt <= seconds; k++) {
    const { want, frame } = steer(pose, max)
    queue.push(clamp(want, -max, max))
    const late = queue.length > Math.round(o.lag / o.dt) ? queue.shift()! : 0
    delta += clamp(late - delta, -o.steerRate * o.dt, o.steerRate * o.dt)
    out.push({ ...frame, t: k * o.dt, pose, delta })
    pose = bicycleStep(pose, v, delta, o.g.wheelbase, o.dt)
  }
  return out
}

/** Follow a closed path with pure pursuit at speed v (carrot `look` m further along the path) through `carTrack`. */
export function pursuitRun(pts: [number, number][], look: number, v: number, seconds: number, o = CAR_SERVO): PursuitFrame[] {
  const path = polyPath(pts)
  const [x0, y0] = pts[0]
  const start: Pose = { x: x0, y: y0, th: Math.atan2(pts[1][1] - y0, pts[1][0] - x0) }
  return carTrack(start, v, seconds, o, (pose, max) => {
    const { s, d } = path.project(pose.x, pose.y)
    const carrot = path.at((s + look) % path.length)
    return { want: pursuitSteer(pose, carrot, o.g.wheelbase, max), frame: { carrot, err: d } }
  })
}

export interface ParkMove {
  dir: 1 | -1
  delta: number
  len: number
}

/** Shift sideways by `d` (m, + = right) with only `room` m of fore-aft travel: k S-shaped moves of two equal arcs at radius ≥ rMin, alternating reverse and forward. */
export function parkPlan(d: number, room: number, rMin: number, L: number) {
  const phiMax = Math.asin(clamp(room / (2 * rMin), 0, 1))
  const perMove = 2 * rMin * (1 - Math.cos(phiMax))
  const k = Math.max(1, Math.ceil(Math.abs(d) / Math.max(perMove, 1e-9) - 1e-9))
  const phi = Math.acos(1 - Math.abs(d) / (2 * rMin * k))
  const steer = Math.atan(L / rMin) * Math.sign(d || 1)
  const moves: ParkMove[] = []
  for (let i = 0; i < k; i++) {
    const dir = i % 2 ? 1 : -1
    moves.push({ dir, delta: -steer, len: rMin * phi }, { dir, delta: steer, len: rMin * phi })
  }
  return { k, phi, travel: 2 * rMin * Math.sin(phi), moves }
}

/** Pose at time t driving the moves at speed v (pose at the rear axle), plus the move index. */
export function parkPoseAt(start: Pose, moves: ParkMove[], v: number, L: number, t: number) {
  let p = start
  let u = t * v
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]
    const run = Math.min(u, m.len)
    p = bicycleStep(p, m.dir * run, m.delta, L, 1)
    if (u <= m.len) return { pose: p, i, move: m }
    u -= m.len
  }
  return { pose: p, i: moves.length, move: undefined }
}
