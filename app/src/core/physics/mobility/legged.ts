// Legged walking: gait phases (duty factor, stance/swing foot path), support polygon and static margin; ZMP of a cart-table biped with foot roll-over; 2-link leg IK.
import { clamp } from '../common'

const G = 9.81
type P2 = [number, number]

/** SG90 servo walker (m): coxa/femur/tibia links, body height, foot reach from the hip, hip mounts [x, y, yaw]. Leg order: left front → back, then right. */
export const HEXAPOD = {
  coxa: 0.028,
  femur: 0.055,
  tibia: 0.08,
  height: 0.06,
  reach: 0.1,
  mounts: [
    [0.07, 0.045, Math.PI / 4],
    [0, 0.06, Math.PI / 2],
    [-0.07, 0.045, (3 * Math.PI) / 4],
    [0.07, -0.045, -Math.PI / 4],
    [0, -0.06, -Math.PI / 2],
    [-0.07, -0.045, (-3 * Math.PI) / 4],
  ] as [number, number, number][],
  names: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'],
}
export const QUADRUPED = {
  ...HEXAPOD,
  reach: 0.08,
  mounts: [
    [0.06, 0.05, Math.PI / 4],
    [-0.06, 0.05, (3 * Math.PI) / 4],
    [0.06, -0.05, -Math.PI / 4],
    [-0.06, -0.05, (-3 * Math.PI) / 4],
  ] as [number, number, number][],
  names: ['LF', 'LH', 'RF', 'RH'],
}
export type Walker = typeof HEXAPOD

/** Duty factor β = stance share of the cycle; `lift[i]` = cycle fraction where leg i lifts off. */
export interface Gait {
  name: string
  body: 'hexapod' | 'quadruped'
  duty: number
  lift: number[]
  /** Body sway toward the other feet's centroid while a leg swings, 0…1 of the way (creep). */
  sway?: number
}
export const GAITS = {
  tripod: { name: 'Tripod', body: 'hexapod', duty: 1 / 2, lift: [0, 1 / 2, 0, 1 / 2, 0, 1 / 2] },
  ripple: { name: 'Ripple', body: 'hexapod', duty: 2 / 3, lift: [2 / 3, 1 / 3, 0, 1 / 6, 5 / 6, 1 / 2] },
  wave: { name: 'Wave', body: 'hexapod', duty: 5 / 6, lift: [5 / 6, 4 / 6, 3 / 6, 2 / 6, 1 / 6, 0] },
  trot: { name: 'Trot', body: 'quadruped', duty: 1 / 2, lift: [0, 1 / 2, 1 / 2, 0] },
  creep: { name: 'Creep', body: 'quadruped', duty: 0.85, lift: [1 / 4, 0, 3 / 4, 1 / 2], sway: 0.6 },
} satisfies Record<string, Gait>
export const walkerOf = (g: Gait): Walker => (g.body === 'hexapod' ? HEXAPOD : QUADRUPED)

const frac = (x: number) => x - Math.floor(x)

/** Leg i at cycle fraction s: swinging or on the ground, with progress u 0…1 through that phase. */
export function legPhase(g: Gait, i: number, s: number) {
  const rel = frac(s - g.lift[i])
  const sw = 1 - g.duty
  return rel < sw ? { swing: true, u: rel / sw } : { swing: false, u: (rel - sw) / g.duty }
}

/** Foot offset from its home [dx, dz] in the body frame: stance slides back at body speed, swing arcs forward and up. */
export function footPath(swing: boolean, u: number, stride: number, lift: number): P2 {
  if (!swing) return [stride / 2 - u * stride, 0]
  return [-stride / 2 + (stride * (1 - Math.cos(Math.PI * u))) / 2, lift * Math.sin(Math.PI * u)]
}

/** Body speed: each foot pushes one stride during its stance time β·T. */
export const gaitSpeed = (stride: number, period: number, duty: number) => stride / (duty * period)

/** Foot home under hip mount (body frame, on the ground). */
export const footHome = (w: Walker, i: number): P2 => {
  const [x, y, yaw] = w.mounts[i]
  return [x + w.reach * Math.cos(yaw), y + w.reach * Math.sin(yaw)]
}

/** Body shift (creep): eased over the four-feet gaps toward the centroid of the other feet of whichever leg swings. */
export function swayAt(g: Gait, s: number): P2 {
  if (!g.sway) return [0, 0]
  const w = walkerOf(g)
  const sw = 1 - g.duty
  const gap = 1 / g.lift.length - sw
  const ease = (u: number) => u * u * (3 - 2 * u)
  const c: P2 = [0, 0]
  g.lift.forEach((l, i) => {
    const rel = frac(s - l + gap)
    const b = rel < gap ? ease(rel / gap) : rel < gap + sw ? 1 : rel < 2 * gap + sw ? 1 - ease((rel - gap - sw) / gap) : 0
    const [hx, hy] = footHome(w, i)
    c[0] -= (b * hx * g.sway!) / (g.lift.length - 1)
    c[1] -= (b * hy * g.sway!) / (g.lift.length - 1)
  })
  return c
}

/** All feet at cycle fraction s (body frame, z up from the ground) with their ground contact. */
export function gaitFeet(g: Gait, s: number, stride: number, lift: number) {
  const w = walkerOf(g)
  const [cx, cy] = swayAt(g, s)
  return w.mounts.map((_, i) => {
    const ph = legPhase(g, i, s)
    const [dx, dz] = footPath(ph.swing, ph.u, stride, lift)
    const [hx, hy] = footHome(w, i)
    return { at: [hx + dx - cx, hy - cy, dz] as [number, number, number], down: !ph.swing, u: ph.u }
  })
}

/** Convex hull (counter-clockwise), monotone chain. */
export function supportHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: P2[]) => {
    const h: P2[] = []
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 1e-12) h.pop()
      h.push(q)
    }
    h.pop()
    return h
  }
  return [...half(p), ...half([...p].reverse())]
}

/** Signed distance from c to the hull edge: > 0 inside; a line or point support gives ≤ 0 (no static margin). */
export function hullMargin(c: P2, hull: P2[]) {
  const segDist = (a: P2, b: P2) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const L2 = dx * dx + dy * dy
    const t = L2 ? clamp(((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2, 0, 1) : 0
    return Math.hypot(c[0] - a[0] - t * dx, c[1] - a[1] - t * dy)
  }
  if (!hull.length) return -Infinity
  if (hull.length < 3) return -segDist(hull[0], hull[hull.length - 1])
  let m = Infinity
  let inside = true
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    if (dx * (c[1] - a[1]) - dy * (c[0] - a[0]) < 0) inside = false
    m = Math.min(m, segDist(a, b))
  })
  return inside ? m : -m
}

/** Static stability over one cycle: worst CoM margin (CoM at the body origin) and fewest feet down. */
export function gaitMargin(g: Gait, stride: number, samples = 240) {
  let margin = Infinity
  let minDown = Infinity
  for (let k = 0; k < samples; k++) {
    const down = gaitFeet(g, k / samples, stride, 0).filter((f) => f.down)
    minDown = Math.min(minDown, down.length)
    margin = Math.min(margin, hullMargin([0, 0], supportHull(down.map((f) => [f.at[0], f.at[1]]))))
  }
  return { margin, minDown }
}

/** 2-link planar leg, hip at the origin, x out, z up: hip = femur angle above horizontal, knee = tibia relative to femur (< 0 = knee up). Targets past the reach are pulled onto it. */
export function legIK(x: number, z: number, femur: number, tibia: number, kneeUp = true) {
  const d0 = Math.hypot(x, z)
  const lo = Math.abs(femur - tibia) + 1e-6
  const hi = femur + tibia - 1e-6
  const d = clamp(d0, lo, hi)
  const k = d0 > 0 ? d / d0 : 0
  const [tx, tz] = d0 > 0 ? [x * k, z * k] : [lo, 0]
  const c = clamp((d * d - femur * femur - tibia * tibia) / (2 * femur * tibia), -1, 1)
  const knee = (kneeUp ? -1 : 1) * Math.acos(c)
  const hip = Math.atan2(tz, tx) - Math.atan2(tibia * Math.sin(knee), femur + tibia * Math.cos(knee))
  return { hip, knee, d: d0, ok: d0 >= lo && d0 <= hi, foot: [tx, tz] as P2, reach: [lo, hi] as P2 }
}

export function legFK(hip: number, knee: number, femur: number, tibia: number) {
  const kneeAt: P2 = [femur * Math.cos(hip), femur * Math.sin(hip)]
  return { knee: kneeAt, foot: [kneeAt[0] + tibia * Math.cos(hip + knee), kneeAt[1] + tibia * Math.sin(hip + knee)] as P2 }
}

/** 3-servo leg: coxa yaw about the mount, then the femur/tibia plane; foot relative to the mount (body frame, z up). */
export function legAngles(w: Walker, i: number, foot: [number, number, number]) {
  const [mx, my, yaw0] = w.mounts[i]
  const [dx, dy] = [foot[0] - mx, foot[1] - my]
  const yaw = Math.atan2(dy, dx) - yaw0
  const s = legIK(Math.hypot(dx, dy) - w.coxa, foot[2] - w.height, w.femur, w.tibia)
  return { yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), hip: s.hip, knee: s.knee, ok: s.ok }
}

/** Servo horn angle for a joint angle; `offsetDeg` = horn at joint 0 (hip 90; knee 180, so a tibia square to the femur is mid-travel). */
export const servoDegOf = (rad: number, offsetDeg = 90) => offsetDeg + (rad * 180) / Math.PI

/** Small servo biped (m): ankle → CoM height, foot from heel to toe around the ankle. */
export const BIPED = { h: 0.25, heel: 0.03, toe: 0.07, footW: 0.045, massKg: 0.9 }

/** Cart-table model: ZMP = CoM projection shifted against the horizontal acceleration. */
export const zmpX = (x: number, h: number, ax: number, g = G) => x - (h / g) * ax

/** Static lean: CoM eased over to h·sin(lean) in `rampS`. */
export const leanPath = (lean: number, h: number, rampS = 3) => (t: number) => h * Math.sin(lean) * (t < rampS ? (1 - Math.cos((Math.PI * t) / rampS)) / 2 : 1)
/** Dynamic sway: CoM swings ±amp with the period. */
export const swayPath = (amp: number, period: number) => (t: number) => amp * Math.sin((2 * Math.PI * t) / period)
/** Static tip-over lean: CoM over the toe. */
export const tipLean = (h: number, toe: number) => Math.atan2(toe, h)

export interface ZmpFrame {
  t: number
  x: number
  a: number
  zmp: number
  free: number
  tip: number
  state: 'ok' | 'rocking' | 'fallen'
}
/** Biped following a CoM path x(t) on a rigid foot; when the needed ZMP leaves the foot, the foot rolls about that edge:
 *  φ'' = g·(outward CoM lever − (h/g)·a) / ρ², landing back if it returns, fallen past 60°, flat at 90°. */
export function zmpRun(path: (t: number) => number, h: number, seconds = 8, b = BIPED, dt = 1 / 500, every = 5): ZmpFrame[] {
  const out: ZmpFrame[] = []
  let phi = 0
  let w = 0
  let side = 0
  let fallen = false
  let xFall = 0
  const n = Math.round(seconds / dt)
  for (let k = 0; k <= n; k++) {
    const t = k * dt
    const x = path(t)
    const a = k ? (path(t + dt) - 2 * x + path(t - dt)) / (dt * dt) : 0
    const free = zmpX(x, h, a)
    if (side === 0 && (free > b.toe || free < -b.heel)) side = free > b.toe ? 1 : -1
    if (side !== 0 && phi < Math.PI / 2) {
      const edge = side > 0 ? b.toe : -b.heel
      const xo = side * ((fallen ? xFall : x) - edge)
      const lever = xo * Math.cos(phi) + h * Math.sin(phi) - (fallen ? 0 : side * (h / G) * a * Math.cos(phi))
      w += ((G * lever) / (xo * xo + h * h)) * dt
      phi += w * dt
      if (phi <= 0) [phi, w, side] = [0, 0, 0]
      if (phi > Math.PI / 3 && !fallen) [fallen, xFall] = [true, x]
      if (phi >= Math.PI / 2) [phi, w] = [Math.PI / 2, 0]
    }
    if (k % every === 0) {
      const edge = side > 0 ? b.toe : side < 0 ? -b.heel : 0
      out.push({ t, x: fallen ? xFall : x, a: fallen ? 0 : a, zmp: side ? edge : free, free: fallen ? xFall : free, tip: side * phi, state: fallen ? 'fallen' : side ? 'rocking' : 'ok' })
    }
  }
  return out
}
