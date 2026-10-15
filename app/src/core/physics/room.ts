// A room for mobile-robot lessons: floor at z = 0, axis-aligned boxes and vertical posts, ray cast in metres (x, y on the floor, z up).

export type P3 = [number, number, number]
/** Diffuse scatters back; glass lets the beam through; a mirror bounces it on. */
export type Optic = 'diffuse' | 'glass' | 'mirror'
interface SolidBase {
  name: string
  h: number
  /** Diffuse reflectance 0–1. */
  refl: number
  optic?: Optic
}
export type RoomSolid = (SolidBase & { kind: 'box'; x: [number, number]; y: [number, number] }) | (SolidBase & { kind: 'post'; at: [number, number]; r: number })
export interface Room {
  w: number
  d: number
  solids: RoomSolid[]
}
/** Robot on the floor: metres; `th` heading, rad, counter-clockwise from +x. */
export interface Pose {
  x: number
  y: number
  th: number
}
/** First hit: distance, point, unit surface normal facing the ray; `solid` null = floor. */
export interface RoomHit {
  m: number
  p: P3
  n: P3
  solid: RoomSolid | null
}

/** Four walls `t` thick just outside [0, w] × [0, d], plus what stands inside. */
export function walledRoom(w: number, d: number, h: number, inside: RoomSolid[], refl = 0.8, t = 0.1): Room {
  const wall = (name: string, x: [number, number], y: [number, number]): RoomSolid => ({ kind: 'box', name, x, y, h, refl })
  return {
    w,
    d,
    solids: [wall('wall', [-t, 0], [-t, d + t]), wall('wall', [w, w + t], [-t, d + t]), wall('wall', [0, w], [-t, 0]), wall('wall', [0, w], [d, d + t]), ...inside],
  }
}

function hitBox(o: P3, d: P3, s: Extract<RoomSolid, { kind: 'box' }>): [number, P3] | null {
  let t0 = 1e-9
  let t1 = Infinity
  let n: P3 = [0, 0, 0]
  const lo = [s.x[0], s.y[0], 0]
  const hi = [s.x[1], s.y[1], s.h]
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null
      continue
    }
    const u = (lo[a] - o[a]) / d[a]
    const v = (hi[a] - o[a]) / d[a]
    if (Math.min(u, v) > t0) {
      t0 = Math.min(u, v)
      n = [0, 0, 0]
      n[a] = d[a] > 0 ? -1 : 1
    }
    t1 = Math.min(t1, Math.max(u, v))
  }
  return t0 <= t1 && n.some((c) => c !== 0) ? [t0, n] : null
}

function hitPost(o: P3, d: P3, s: Extract<RoomSolid, { kind: 'post' }>): [number, P3] | null {
  const px = o[0] - s.at[0]
  const py = o[1] - s.at[1]
  const a = d[0] ** 2 + d[1] ** 2
  const b = 2 * (px * d[0] + py * d[1])
  const c = px ** 2 + py ** 2 - s.r ** 2
  const disc = b * b - 4 * a * c
  if (a < 1e-12 || disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  const z = o[2] + t * d[2]
  if (t <= 1e-9 || z < 0 || z > s.h) return null
  return [t, [(px + t * d[0]) / s.r, (py + t * d[1]) / s.r, 0]]
}

/** Nearest hit along unit direction `d` from `o`, ignoring `skip`; null if nothing within `maxM`. */
export function castRoom(room: Room, o: P3, d: P3, maxM = Infinity, skip?: RoomSolid): RoomHit | null {
  let best: RoomHit | null = null
  for (const s of room.solids) {
    if (s === skip) continue
    const h = s.kind === 'box' ? hitBox(o, d, s) : hitPost(o, d, s)
    if (h && h[0] <= maxM && (!best || h[0] < best.m)) best = { m: h[0], n: h[1], solid: s, p: [0, 0, 0] }
  }
  if (d[2] < 0) {
    const t = -o[2] / d[2]
    if (t <= maxM && (!best || t < best.m)) best = { m: t, n: [0, 0, 1], solid: null, p: [0, 0, 0] }
  }
  if (best) best.p = [o[0] + d[0] * best.m, o[1] + d[1] * best.m, o[2] + d[2] * best.m]
  return best
}

/** Unit direction at `heading` (rad, CCW from +x) and `elev` (rad above the floor plane). */
export const rayDir = (heading: number, elev = 0): P3 => [Math.cos(elev) * Math.cos(heading), Math.cos(elev) * Math.sin(heading), Math.sin(elev)]

/** Robot-frame point (x forward, y left) → room frame. */
export const toRoom = (pose: Pose, x: number, y: number): [number, number] => [pose.x + x * Math.cos(pose.th) - y * Math.sin(pose.th), pose.y + x * Math.sin(pose.th) + y * Math.cos(pose.th)]

/** Back and forth between `a` and `b` at `v` m/s: position at time `t` (starts at `a`). */
export function shuttle(t: number, v: number, a: number, b: number) {
  const L = Math.abs(b - a)
  if (L === 0 || v === 0) return a
  const s = (v * t) % (2 * L)
  return a + Math.sign(b - a) * (s <= L ? s : 2 * L - s)
}
