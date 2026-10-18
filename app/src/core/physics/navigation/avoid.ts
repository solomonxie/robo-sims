// Reactive obstacle avoidance in a cluttered room: range rays, bumper, rule sets, Braitenberg wirings, right-wall following.
import { DEG, clamp, gaussAt } from '../common'
import { PID_MEM0, PidMem, pidTick } from '../control/pid'
import { diffInverse, diffStep } from '../mobility/diffdrive'
import { Pose, Room, RoomSolid, castRoom, rayDir, toRoom, walledRoom } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'
import { HCSR04 } from '../sensors/ultrasonic'

/** Body circle `r`, sensors `mount` ahead of the axle at height `z`; 50 Hz loop. */
export const AVOID = { r: 0.11, z: 0.06, mount: 0.07, dt: 0.02, seconds: 60, track: TT_TRACK_M, cell: 0.2 }

export const CLUTTER: Room = walledRoom(3.6, 2.4, 0.35, [
  { kind: 'box', name: 'crate', x: [0.9, 1.35], y: [0, 0.45], h: 0.3, refl: 0.6 },
  { kind: 'box', name: 'box', x: [1.6, 2.1], y: [1.8, 2.4], h: 0.3, refl: 0.5 },
  { kind: 'box', name: 'shelf', x: [3.2, 3.6], y: [0.6, 1.2], h: 0.35, refl: 0.7 },
  { kind: 'box', name: 'block', x: [1.6, 1.9], y: [0.95, 1.2], h: 0.2, refl: 0.6 },
  { kind: 'post', name: 'bin', at: [2.6, 1.25], r: 0.13, h: 0.3, refl: 0.4 },
  { kind: 'post', name: 'chair leg', at: [0.75, 1.5], r: 0.03, h: 0.35, refl: 0.5 },
])

/** Signed distance from (x, y) to a solid's outline in the floor plane (< 0 inside). */
export function solidGap(s: RoomSolid, x: number, y: number) {
  if (s.kind === 'post') return Math.hypot(x - s.at[0], y - s.at[1]) - s.r
  const dx = Math.max(s.x[0] - x, 0, x - s.x[1])
  const dy = Math.max(s.y[0] - y, 0, y - s.y[1])
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
  return -Math.min(x - s.x[0], s.x[1] - x, y - s.y[0], s.y[1] - y)
}
export const clearance = (room: Room, x: number, y: number) => room.solids.reduce((m, s) => Math.min(m, solidGap(s, x, y)), Infinity)

/** Range from the sensor mount along robot-frame angle `a` (rad, + left); `maxM` if nothing. */
export function rangeAt(room: Room, p: Pose, a: number, maxM: number) {
  const [x, y] = toRoom(p, AVOID.mount, 0)
  const h = castRoom(room, [x, y, AVOID.z], rayDir(p.th + a), maxM)
  return h ? h.m : maxM
}
/** HC-SR04: nearest echo anywhere in its ±15° cone (5 rays). */
export function sonarAt(room: Room, p: Pose, a: number, maxM = 2) {
  let m = maxM
  for (let k = -2; k <= 2; k++) m = Math.min(m, rangeAt(room, p, a + (k * HCSR04.halfDeg * DEG) / 2, maxM))
  return m
}

/** One loop step; a move that would overlap a solid scrapes along it (x or y part only) or keeps only its turn, and reports a bump. */
export function moveBot(room: Room, p: Pose, vL: number, vR: number, dt = AVOID.dt) {
  const q = diffStep(p, vL, vR, AVOID.track, dt)
  if (clearance(room, q.x, q.y) >= AVOID.r) return { pose: q, hit: false }
  const slide = [{ x: q.x, y: p.y, th: q.th }, { x: p.x, y: q.y, th: q.th }].find((s) => clearance(room, s.x, s.y) >= AVOID.r)
  return { pose: slide ?? { x: p.x, y: p.y, th: q.th }, hit: true }
}
/** +1 if the bumper touched on the left, −1 on the right. */
export function hitSide(room: Room, p: Pose) {
  const c = AVOID.r * Math.SQRT1_2 * 1.2
  const [lx, ly] = toRoom(p, c, c)
  const [rx, ry] = toRoom(p, c, -c)
  return clearance(room, lx, ly) <= clearance(room, rx, ry) ? 1 : -1
}

export interface AvoidFrame {
  t: number
  pose: Pose
  vL: number
  vR: number
  /** Wheel travel so far (m). */
  dL: number
  dR: number
  hit: boolean
  ranges: number[]
  rule: number
}
type Ctl = (p: Pose, t: number, hit: boolean, i: number) => { vL: number; vR: number; ranges: number[]; rule: number }

const REACH = new WeakMap<Room, number>()
function reachCells(room: Room, nx: number, ny: number) {
  let n = REACH.get(room)
  if (n !== undefined) return n
  n = 0
  for (let k = 0; k < nx * ny; k++) if (clearance(room, ((k % nx) + 0.5) * AVOID.cell, (Math.floor(k / nx) + 0.5) * AVOID.cell) >= AVOID.r) n++
  REACH.set(room, n)
  return n
}
/** Reads `sense` only every `every` loop steps and holds it in between (sensor rate below the loop rate). */
export function heldSensor<T>(every: number, sense: (p: Pose) => T) {
  let last: T | null = null
  return (p: Pose, i: number) => (last = i % every === 0 || last === null ? sense(p) : last)
}

/** Steps a controller for `seconds`; restT = when it settled within 5 cm of its end point (null if it never did); coverage = share of reachable `AVOID.cell` squares the body centre visited. */
export function avoidRun(room: Room, start: Pose, ctl: Ctl, seconds = AVOID.seconds) {
  const frames: AvoidFrame[] = []
  const nx = Math.ceil(room.w / AVOID.cell)
  const ny = Math.ceil(room.d / AVOID.cell)
  const seen = new Set<number>()
  let [p, hit, dL, dR, bumps, dist] = [start, false, 0, 0, 0, 0]
  for (let i = 0; i * AVOID.dt <= seconds + 1e-9; i++) {
    const t = i * AVOID.dt
    const c = ctl(p, t, hit, i)
    frames.push({ t, pose: p, vL: c.vL, vR: c.vR, dL, dR, hit, ranges: c.ranges, rule: c.rule })
    seen.add(Math.min(ny - 1, Math.floor(p.y / AVOID.cell)) * nx + Math.min(nx - 1, Math.floor(p.x / AVOID.cell)))
    const m = moveBot(room, p, c.vL, c.vR)
    if (m.hit && !hit) bumps++
    dist += Math.hypot(m.pose.x - p.x, m.pose.y - p.y)
    ;[p, hit] = [m.pose, m.hit]
    dL += c.vL * AVOID.dt
    dR += c.vR * AVOID.dt
  }
  const end = frames[frames.length - 1].pose
  let k = frames.length - 1
  while (k > 0 && Math.hypot(frames[k - 1].pose.x - end.x, frames[k - 1].pose.y - end.y) < 0.05) k--
  const restT = frames[frames.length - 1].t - frames[k].t > 3 ? frames[k].t : null
  return { frames, bumps, dist, restT, coverage: Math.min(1, seen.size / Math.max(1, reachCells(room, nx, ny))), seen, nx }
}

// --- Reactive rules: a priority list from bumper and range sensors to wheel commands. ---

export type RuleSet = 'bump' | 'sonar' | 'three'
export const RULE_TEXT: Record<RuleSet, string[]> = {
  bump: ['bumper hit: back up 0.5 s', 'then spin away from the hit 0.7 s', 'else drive straight'],
  sonar: ['bumper hit: back up, spin away', 'front < stop: spin left until clear', 'else drive straight'],
  three: ['bumper hit: back up, spin away', 'front < stop: spin to the clearer side', 'left < stop: veer right', 'right < stop: veer left', 'else drive straight'],
}
export const REACT = { every: 4, backS: 0.5, spinS: 0.7, sideDeg: 40, maxM: 2, clearK: 1.3, veer: 0.3, start: { x: 0.4, y: 1.0, th: 0.35 } as Pose }

/** Sonar readings for a rule set: none, [front], or [left, front, right]. */
const ruleSonars = (set: RuleSet, room: Room, p: Pose) =>
  set === 'bump' ? [] : set === 'sonar' ? [sonarAt(room, p, 0, REACT.maxM)] : [REACT.sideDeg, 0, -REACT.sideDeg].map((d) => sonarAt(room, p, d * DEG, REACT.maxM))

/** The first rule that fires, as an index into RULE_TEXT[set] and wheel speeds (spin = ±v). */
export function ruleFor(set: RuleSet, ranges: number[], stopM: number, v: number, spinning: number) {
  const spin = (dir: number) => ({ rule: 1, vL: -dir * v, vR: dir * v, dir })
  if (set === 'sonar') {
    const f = ranges[0]
    if (f < stopM || (spinning && f < stopM * REACT.clearK)) return spin(1)
    return { rule: 2, vL: v, vR: v, dir: 0 }
  }
  const [l, f, r] = ranges
  if (f < stopM || (spinning && f < stopM * REACT.clearK)) return spin(spinning || (l >= r ? 1 : -1))
  if (l < stopM) return { rule: 2, vL: v, vR: v * REACT.veer, dir: 0 }
  if (r < stopM) return { rule: 3, vL: v * REACT.veer, vR: v, dir: 0 }
  return { rule: 4, vL: v, vR: v, dir: 0 }
}

export function reactiveRun(set: RuleSet, stopM: number, v: number, room = CLUTTER) {
  const m = { mode: 'go' as 'go' | 'back' | 'spin', until: 0, dir: 1, spinning: 0 }
  const sense = heldSensor(REACT.every, (p) => ruleSonars(set, room, p))
  return avoidRun(room, REACT.start, (p, t, hit, i) => {
    const ranges = sense(p, i)
    if (hit && m.mode !== 'back') Object.assign(m, { mode: 'back', until: t + REACT.backS, dir: -hitSide(room, p), spinning: 0 })
    if (m.mode === 'back' && t >= m.until) Object.assign(m, { mode: 'spin', until: t + REACT.spinS })
    if (m.mode === 'spin' && t >= m.until) m.mode = 'go'
    if (m.mode === 'back') return { vL: -v, vR: -v, ranges, rule: 0 }
    if (m.mode === 'spin') return { vL: -m.dir * v, vR: m.dir * v, ranges, rule: set === 'bump' ? 1 : 0 }
    if (set === 'bump') return { vL: v, vR: v, ranges, rule: 2 }
    const r = ruleFor(set, ranges, stopM, v, m.spinning)
    m.spinning = r.dir
    return { vL: r.vL, vR: r.vR, ranges, rule: r.rule }
  })
}

// --- Braitenberg vehicles: two proximity sensors wired straight or crossed, exciting or inhibiting the wheels. ---

export type BraitWiring = 'fear' | 'aggression' | 'love' | 'explorer'
export const WIRINGS: Record<BraitWiring, { crossed: boolean; sign: 1 | -1 }> = {
  fear: { crossed: false, sign: 1 },
  aggression: { crossed: true, sign: 1 },
  love: { crossed: false, sign: -1 },
  explorer: { crossed: true, sign: -1 },
}
export const BRAIT = { every: 2, noiseM: 0.01, seconds: 40, v0: 0.15, vMax: 0.4, maxM: 0.8, start: { x: 0.4, y: 0.8, th: 0 } as Pose }
/** 0 at `maxM` or beyond, 1 touching. */
export const proximity = (m: number, maxM = BRAIT.maxM) => clamp(1 - m / maxM, 0, 1)

/** Wheel speeds v = v0 ± k·s from the same-side (straight) or opposite (crossed) sensor, clamped to ±vMax. */
export function braitWheels(w: BraitWiring, sL: number, sR: number, k: number, v0 = BRAIT.v0): [number, number] {
  const { crossed, sign } = WIRINGS[w]
  const [a, b] = crossed ? [sR, sL] : [sL, sR]
  return [clamp(v0 + sign * k * a, -BRAIT.vMax, BRAIT.vMax), clamp(v0 + sign * k * b, -BRAIT.vMax, BRAIT.vMax)]
}

export function braitRun(w: BraitWiring, k: number, eyeDeg: number, room = CLUTTER) {
  let n = 0
  const sense = heldSensor(BRAIT.every, (p) => [eyeDeg, -eyeDeg].map((d) => rangeAt(room, p, d * DEG, BRAIT.maxM) + BRAIT.noiseM * gaussAt(n++)))
  return avoidRun(
    room,
    BRAIT.start,
    (p, _t, _hit, i) => {
      const ranges = sense(p, i)
      const [vL, vR] = braitWheels(w, proximity(ranges[0]), proximity(ranges[1]), k)
      return { vL, vR, ranges, rule: 0 }
    },
    BRAIT.seconds,
  )
}

// --- Wall following: keep a right-hand wall at a set distance with two side rays and a PD on the distance. ---

export type WallCtl = 'p' | 'pd' | 'look'
export const WALL = { every: 2, backS: 0.3, turnS: 0.4, theta: 45 * DEG, lookM: 0.2, maxM: 1, v: 0.15, wMax: 3, kdPerKp: 0.3, cornerK: 1.2, spin: 2, start: { x: 0.4, y: 0.3, th: 0 } as Pose }

/** Wall line from ray b (straight right) and ray a (θ ahead of it): angle α (> 0 = closing in), distance D, and D after `L` more metres. */
export function wallFit(a: number, b: number, theta = WALL.theta, L = WALL.lookM) {
  const alpha = Math.atan2(b - a * Math.cos(theta), a * Math.sin(theta))
  const D = b * Math.cos(alpha)
  return { alpha, D, ahead: D - L * Math.sin(alpha) }
}

export function wallRun(ctl: WallCtl, setM: number, kp: number, room = CLUTTER) {
  let mem: PidMem = PID_MEM0
  const cfg = { kp, ki: 0, kd: ctl === 'p' ? 0 : kp * WALL.kdPerKp, limit: WALL.wMax, dOnMeas: true }
  const meas: number[] = []
  const sense = heldSensor(WALL.every, (p) => [-90 * DEG, -90 * DEG + WALL.theta, 0].map((d) => rangeAt(room, p, d, WALL.maxM)))
  const spinV = (WALL.spin * AVOID.track) / 2
  let backTo = -1
  const run = avoidRun(room, WALL.start, (p, t, hit, i) => {
    const ranges = sense(p, i)
    const [b, a, f] = ranges
    const fit = a >= WALL.maxM ? { D: b, ahead: b } : wallFit(a, b)
    const d = ctl === 'p' ? b : ctl === 'pd' ? fit.D : fit.ahead
    meas.push(d)
    if (hit && t > backTo + WALL.turnS) backTo = t + WALL.backS
    if (t < backTo) return { vL: -WALL.v, vR: -WALL.v, ranges, rule: 2 }
    if (t < backTo + WALL.turnS || f < setM * WALL.cornerK) return { vL: -spinV, vR: spinV, ranges, rule: 1 }
    const out = pidTick(mem, setM, d, cfg, AVOID.dt)
    mem = out.mem
    const [vL, vR] = diffInverse(WALL.v, out.terms.out, AVOID.track)
    return { vL, vR, ranges, rule: 0 }
  })
  const along = run.frames.filter((f) => f.rule === 0 && f.ranges[0] < WALL.maxM * 0.7)
  const errs = along.map((f) => clearance(room, ...toRoom(f.pose, AVOID.mount, 0)) - setM)
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / Math.max(1, errs.length))
  return { ...run, meas, rms, worst: Math.max(0, ...errs.map(Math.abs)) }
}
