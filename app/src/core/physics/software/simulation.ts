// Simulation: a tiny 2D rigid-body engine (boxes, penalty contacts) and a sim-vs-real differential-drive twin.
import { clamp, gaussAt } from '../common'

export type Integrator = 'euler' | 'semi'

/** Axis-aligned box: centre (x, y) m, size w × h, mass m kg; `drive` = wheel speed target (m/s) for a robot. */
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  m: number
  drive?: number
}

/** Contact between bodies `a` and `b` (−1 = ground), normal pushing `a`, forces in N. */
export interface Contact {
  a: number
  b: number
  x: number
  y: number
  nx: number
  ny: number
  depth: number
  fn: number
  ft: number
}

/** Gazebo/ODE-style soft contact: stiffness N/m, damping N·s/m, Coulomb mu, drive gain/limit. */
export const PHYS = { g: 9.81, k: 2e4, c: 60, mu: 0.6, vEps: 0.05, driveK: 40, driveMax: 15, grip: 0.8 }

/** Step 1: collision detection, AABB vs ground and vs each other, normal along the shallower overlap. */
export function findContacts(bodies: Body[]): Contact[] {
  const out: Contact[] = []
  bodies.forEach((p, a) => {
    const depth = p.h / 2 - p.y
    if (depth > 0) out.push({ a, b: -1, x: p.x, y: 0, nx: 0, ny: 1, depth, fn: 0, ft: 0 })
  })
  for (let a = 0; a < bodies.length; a++)
    for (let b = a + 1; b < bodies.length; b++) {
      const p = bodies[a]
      const q = bodies[b]
      const dx = p.x - q.x
      const dy = p.y - q.y
      const ox = (p.w + q.w) / 2 - Math.abs(dx)
      const oy = (p.h + q.h) / 2 - Math.abs(dy)
      if (ox <= 0 || oy <= 0) continue
      const cx = (Math.max(p.x - p.w / 2, q.x - q.w / 2) + Math.min(p.x + p.w / 2, q.x + q.w / 2)) / 2
      const cy = (Math.max(p.y - p.h / 2, q.y - q.h / 2) + Math.min(p.y + p.h / 2, q.y + q.h / 2)) / 2
      out.push(ox < oy ? { a, b, x: cx, y: cy, nx: Math.sign(dx) || 1, ny: 0, depth: ox, fn: 0, ft: 0 } : { a, b, x: cx, y: cy, nx: 0, ny: Math.sign(dy) || 1, depth: oy, fn: 0, ft: 0 })
    }
  return out
}

/** Step 2: contact forces (spring-damper normal, regularised Coulomb friction, wheel drive) → net force per body. */
export function contactForces(bodies: Body[], contacts: Contact[], dt: number): [number, number][] {
  const F = bodies.map((p): [number, number] => [0, -p.m * PHYS.g])
  for (const c of contacts) {
    const p = bodies[c.a]
    const q = c.b < 0 ? null : bodies[c.b]
    const rvx = p.vx - (q?.vx ?? 0)
    const rvy = p.vy - (q?.vy ?? 0)
    const vn = rvx * c.nx + rvy * c.ny
    c.fn = Math.max(0, PHYS.k * c.depth - PHYS.c * vn)
    const tx = -c.ny
    const ty = c.nx
    const vt = rvx * tx + rvy * ty
    const mRed = q ? (p.m * q.m) / (p.m + q.m) : p.m
    const lim = Math.min(PHYS.driveMax, PHYS.grip * c.fn)
    if (!q && p.drive !== undefined) c.ft = tx * clamp(PHYS.driveK * (p.drive - p.vx), -lim, lim)
    else c.ft = -Math.sign(vt) * Math.min(PHYS.mu * c.fn * Math.min(1, Math.abs(vt) / PHYS.vEps), (mRed * Math.abs(vt)) / dt)
    const fx = c.nx * c.fn + tx * c.ft
    const fy = c.ny * c.fn + ty * c.ft
    F[c.a][0] += fx
    F[c.a][1] += fy
    if (q) {
      F[c.b][0] -= fx
      F[c.b][1] -= fy
    }
  }
  return F
}

/** Step 3: integrate. Explicit Euler moves with the old velocity; semi-implicit with the new one. */
export function integrate(bodies: Body[], F: [number, number][], dt: number, how: Integrator): Body[] {
  return bodies.map((p, i) => {
    const vx = p.vx + (F[i][0] / p.m) * dt
    const vy = p.vy + (F[i][1] / p.m) * dt
    const [ux, uy] = how === 'semi' ? [vx, vy] : [p.vx, p.vy]
    return { ...p, x: p.x + ux * dt, y: p.y + uy * dt, vx, vy }
  })
}

/** One world step: detect → forces → integrate. */
export function physStep(bodies: Body[], dt: number, how: Integrator) {
  const contacts = findContacts(bodies)
  const F = contactForces(bodies, contacts, dt)
  return { bodies: integrate(bodies, F, dt, how), contacts }
}

/** Contact natural frequency (rad/s) and damping ratio for a body of mass `m` on the ground. */
export const contactOmega = (m: number) => Math.sqrt(PHYS.k / m)
export const contactZeta = (m: number) => PHYS.c / (2 * Math.sqrt(PHYS.k * m))
/** Largest stable step (s) for one contact: semi-implicit ω·dt < 2, explicit Euler ω·dt < 2ζ. */
export const stableDt = (m: number, how: Integrator) => ((how === 'semi' ? 2 : 2 * contactZeta(m)) / contactOmega(m))

/** Kinetic + potential energy, J. */
export const worldEnergy = (bodies: Body[]) => bodies.reduce((s, p) => s + 0.5 * p.m * (p.vx ** 2 + p.vy ** 2) + p.m * PHYS.g * p.y, 0)

/** Demo world: a 2 kg robot pushing a 1 kg box, and a stack of three 0.5 kg boxes dropped onto each other. */
export const PUSH_WORLD: Body[] = [
  { x: 0.3, y: 0.125, vx: 0, vy: 0, w: 0.4, h: 0.25, m: 2, drive: 0.35 },
  { x: 0.75, y: 0.15, vx: 0, vy: 0, w: 0.3, h: 0.3, m: 1 },
  { x: 2.8, y: 0.15, vx: 0, vy: 0, w: 0.3, h: 0.3, m: 0.5 },
  { x: 2.8, y: 0.55, vx: 0, vy: 0, w: 0.3, h: 0.3, m: 0.5 },
  { x: 2.82, y: 1.05, vx: 0, vy: 0, w: 0.3, h: 0.3, m: 0.5 },
]
export const PHYS_RUN = { seconds: 4, every: 0.02, refDt: 1e-4 }

/** Modelled CPU cost of one step (ms): fixed overhead + per body + per contact. */
export const stepCpuMs = (bodies: number, contacts: number) => 0.2 + 0.05 * bodies + 0.08 * contacts
/** Real-time factor with Gazebo's real_time_update_rate = 1/dt (target 1×), capped by CPU. */
export const realTimeFactor = (dt: number, cpuMs: number) => Math.min(1, (dt * 1000) / cpuMs)

export interface PhysFrame {
  t: number
  bodies: Body[]
  contacts: Contact[]
  energy: number
  blown: boolean
}

/** Run the demo world for `PHYS_RUN.seconds`, keeping a frame every `PHYS_RUN.every` s; stops when it blows up. */
export function physRun(dt: number, how: Integrator, world = PUSH_WORLD): PhysFrame[] {
  const per = Math.max(1, Math.round(PHYS_RUN.every / dt))
  const steps = Math.round(PHYS_RUN.seconds / dt)
  let bodies = world
  const out: PhysFrame[] = [{ t: 0, bodies, contacts: findContacts(bodies), energy: worldEnergy(bodies), blown: false }]
  for (let s = 1; s <= steps; s++) {
    const r = physStep(bodies, dt, how)
    bodies = r.bodies
    const blown = bodies.some((p) => !(Math.hypot(p.vx, p.vy) < 25 && Math.abs(p.y) < 6 && Math.abs(p.x) < 12))
    if (blown || s % per === 0) out.push({ t: s * dt, bodies, contacts: r.contacts, energy: worldEnergy(bodies), blown })
    if (blown) break
  }
  return out
}

/** Largest body position error (m) of a run against a reference run at the same frame times. */
export const runError = (run: PhysFrame[], ref: PhysFrame[], i: number) =>
  run[i].blown ? Infinity : Math.max(...run[i].bodies.map((p, k) => Math.hypot(p.x - ref[i].bodies[k].x, p.y - ref[i].bodies[k].y)))

// --- Sim-to-real: one path-following controller on an ideal twin and on a "real" robot. ---

/** Plant: wheel speed gain (friction/load), motor lag s, deadband m/s, latency s, turn slip 0..1, pose noise m / rad. */
export interface Plant {
  gain: number
  tau: number
  deadband: number
  latency: number
  slip: number
  noise: number
  noiseTh: number
}
/** Pure pursuit: steer at a carrot `look` m ahead along the route with gain `kp` (rad/s per rad). */
export interface Ctrl {
  kp: number
  look: number
}
export interface TwinFrame {
  t: number
  x: number
  y: number
  th: number
  mx: number
  my: number
  s: number
}

export const TWIN = { dt: 0.02, v: 0.5, track: 0.16, wMax: 4, timeout: 40, kps: [2, 4, 8, 12], looks: [0.15, 0.3, 0.5, 0.8] }
export const ROUTE: [number, number][] = [
  [0, 0],
  [1.5, 0.7],
  [3, -0.7],
  [4.5, 0.7],
  [6, 0],
]
export const IDEAL: Plant = { gain: 1, tau: 0.05, deadband: 0, latency: 0, slip: 0, noise: 0, noiseTh: 0 }
const REAL: Plant = { gain: 0.8, tau: 0.15, deadband: 0.06, latency: 0.2, slip: 0.25, noise: 0.03, noiseTh: 0.05 }
export const GAPS = {
  none: {},
  friction: { gain: REAL.gain, tau: REAL.tau },
  motors: { deadband: REAL.deadband, latency: REAL.latency },
  sensing: { slip: REAL.slip, noise: REAL.noise, noiseTh: REAL.noiseTh },
  all: REAL,
}
export type Gap = keyof typeof GAPS
export const realPlant = (gap: Gap): Plant => ({ ...IDEAL, ...GAPS[gap] })

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const SEG = ROUTE.slice(1).map((b, i) => {
  const a = ROUTE[i]
  return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }
})
export const ROUTE_LEN = SEG.reduce((s, g) => s + g.len, 0)

/** Closest route point: arc length `s` (m) and distance `d` (m). */
export function projectRoute(x: number, y: number) {
  let best = { s: 0, d: Infinity }
  let s0 = 0
  for (const { a, b, len } of SEG) {
    const u = clamp(((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / len ** 2, 0, 1)
    const d = Math.hypot(x - a[0] - u * (b[0] - a[0]), y - a[1] - u * (b[1] - a[1]))
    if (d < best.d) best = { s: s0 + u * len, d }
    s0 += len
  }
  return best
}

/** Route point at arc length `s`. */
export function routeAt(s: number): [number, number] {
  for (const { a, b, len } of SEG) {
    if (s <= len) return [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len]
    s -= len
  }
  return ROUTE[ROUTE.length - 1]
}

/** Wheel command after the motor deadband: nothing below it, then the excess. */
export const deadbandOut = (u: number, db: number) => (Math.abs(u) <= db ? 0 : Math.sign(u) * (Math.abs(u) - db))

/** Follow the route on the measured pose → wheel commands → latency, deadband, motor lag, turn slip. */
export function twinRun(plant: Plant, ctrl: Ctrl, seed = 0): TwinFrame[] {
  const { dt, v, track } = TWIN
  const delay = Math.round(plant.latency / dt)
  const queue: [number, number][] = []
  let x = 0
  let y = 0
  let th = Math.atan2(ROUTE[1][1], ROUTE[1][0])
  let wl = 0
  let wr = 0
  let s = 0
  const out: TwinFrame[] = []
  for (let k = 0; k * dt <= TWIN.timeout; k++) {
    const mx = x + plant.noise * gaussAt(seed * 1e5 + 3 * k)
    const my = y + plant.noise * gaussAt(seed * 1e5 + 3 * k + 1)
    const mth = th + plant.noiseTh * gaussAt(seed * 1e5 + 3 * k + 2)
    s = Math.max(s, projectRoute(mx, my).s)
    out.push({ t: k * dt, x, y, th, mx, my, s })
    const [ex, ey] = ROUTE[ROUTE.length - 1]
    if (s >= ROUTE_LEN - 0.05 && Math.hypot(ex - x, ey - y) < 0.15) break
    const [gx, gy] = routeAt(s + ctrl.look)
    const e = wrap(Math.atan2(gy - my, gx - mx) - mth)
    const w = clamp(ctrl.kp * e, -TWIN.wMax, TWIN.wMax)
    const fwd = v * Math.max(0.2, Math.cos(e)) * Math.min(1, (ROUTE_LEN - s) / 0.3 + 0.2)
    queue.push([fwd - (w * track) / 2, fwd + (w * track) / 2])
    const [ul, ur] = queue.length > delay ? queue.shift()! : [0, 0]
    const a = Math.min(1, dt / plant.tau)
    wl += (plant.gain * deadbandOut(ul, plant.deadband) - wl) * a
    wr += (plant.gain * deadbandOut(ur, plant.deadband) - wr) * a
    const ds = ((wl + wr) / 2) * dt
    const dth = ((wr - wl) / track) * dt * (1 - plant.slip)
    x += ds * Math.cos(th + dth / 2)
    y += ds * Math.sin(th + dth / 2)
    th += dth
  }
  return out
}

/** Mean distance (m) from the route over the first `upto` frames. */
export const offRoute = (run: TwinFrame[], upto = run.length) => run.slice(0, upto).reduce((s, f) => s + projectRoute(f.x, f.y).d, 0) / Math.max(1, Math.min(upto, run.length))

/** Score a run: mean distance from the route (m) + 0.005 per second taken + 1 if it never finished. */
export function twinCost(run: TwinFrame[]) {
  const end = run[run.length - 1]
  return offRoute(run) + 0.005 * end.t + (end.t >= TWIN.timeout - TWIN.dt ? 1 : 0)
}

const uni = (k: number) => {
  const x = Math.sin(k * 91.345 + 47.853) * 43758.5453
  return x - Math.floor(x)
}
/** Randomised plant `i`: every parameter drawn uniformly around the real range. */
export function randomPlant(i: number): Plant {
  const r = (j: number, lo: number, hi: number) => lo + (hi - lo) * uni(i * 7 + j)
  return { gain: r(0, 0.7, 1.1), tau: r(1, 0.05, 0.2), deadband: r(2, 0, 0.09), latency: r(3, 0, 0.25), slip: r(4, 0, 0.3), noise: r(5, 0, 0.04), noiseTh: r(6, 0, 0.07) }
}
export const DR_SIMS = 8

/** Grid-search the controller: on the nominal sim only, or averaged over `DR_SIMS` randomised sims. */
export function tuneTwin(randomised: boolean): Ctrl & { cost: number } {
  let best = { kp: 0, look: 0, cost: Infinity }
  for (const kp of TWIN.kps)
    for (const look of TWIN.looks) {
      const ctrl = { kp, look }
      const cost = randomised ? Array.from({ length: DR_SIMS }, (_, i) => twinCost(twinRun(randomPlant(i), ctrl, i + 1))).reduce((s, c) => s + c, 0) / DR_SIMS : twinCost(twinRun(IDEAL, ctrl))
      if (cost < best.cost - 1e-9) best = { kp, look, cost }
    }
  return best
}

/** Distance (m) between two runs at frame `i` (the shorter one holds its last pose). */
export const twinGap = (a: TwinFrame[], b: TwinFrame[], i: number) => {
  const p = a[Math.min(i, a.length - 1)]
  const q = b[Math.min(i, b.length - 1)]
  return Math.hypot(p.x - q.x, p.y - q.y)
}
