// Tracks & terrain: skid-steer turning resistance, track slip (Janosi), motor current in turns; ground pressure, Bekker sinkage, soil thrust, slope climb and tip-over.
import { DRIVES, ampsAt } from '../actuators/sizing'
import { G, clamp, weightN } from '../common'
import { Pose } from '../room'
import { twistStep } from './mecanum'

/** Small tracked chassis (m, kg): contact length L, gauge B (track centres), belt width, sprocket radius, CoM height, belly clearance; the 4WD twin has 65 mm wheels. */
export const TANK = { massKg: 2, contact: 0.2, gauge: 0.17, belt: 0.04, sprocketR: 0.03, comH: 0.07, clearance: 0.035, wheelD: 0.065, wheelB: 0.026, wheelClear: 0.022, drive: DRIVES.g37 }

/** Ground: rubber μ and sideways μt, rolling coefficient, Janosi shear modulus K (m), cohesion c (kPa), friction angle φ, Bekker n, kc, kφ (kN; kφ = ∞ → rigid). */
export interface Terrain {
  name: string
  mu: number
  muT: number
  roll: number
  shearK: number
  c: number
  phiDeg: number
  n: number
  kc: number
  kphi: number
}
export const TERRAINS = {
  concrete: { name: 'Concrete', mu: 0.9, muT: 0.75, roll: 0.03, shearK: 0.001, c: 0, phiDeg: 0, n: 1, kc: 0, kphi: Infinity },
  grass: { name: 'Grass', mu: 0.6, muT: 0.55, roll: 0.06, shearK: 0.004, c: 0.6, phiDeg: 29, n: 0.7, kc: 5.27, kphi: 1515 },
  sand: { name: 'Dry sand', mu: 0.45, muT: 0.45, roll: 0.08, shearK: 0.008, c: 0.2, phiDeg: 28, n: 1.1, kc: 0.99, kphi: 1528 },
  mud: { name: 'Mud', mu: 0.3, muT: 0.35, roll: 0.1, shearK: 0.012, c: 0.8, phiDeg: 8, n: 1, kc: 0.5, kphi: 60 },
} satisfies Record<string, Terrain>
export type TerrainKind = keyof typeof TERRAINS
const rigid = (t: Terrain) => !Number.isFinite(t.kphi)

// --- Skid steer: both tracks slide sideways about a pivot; the outer one must push the turning moment through B. ---

/** Sideways friction moment of a track pair (uniform pressure over L) pivoting s0 ahead of centre: μt W (L² + 4 s0²) / 4L. */
export const turnMoment = (muT: number, weight: number, L: number, s0 = 0) => (muT * weight * (L * L + 4 * s0 * s0)) / (4 * L)
/** Longest track for its gauge that still turns: L/B ≤ 2(μ − f)/μt. */
export const steerLimit = (t: Terrain) => (2 * (t.mu - t.roll)) / t.muT
/** Pivot shift ahead of centre that balances centripetal force a·m with sideways friction: s0 = (L/2)·a/(μt g). */
export const pivotShift = (aLat: number, muT: number, L: number) => clamp(((L / 2) * Math.abs(aLat)) / (muT * G), 0, L / 2)
/** Outer and inner track thrust (N) for a steady turn, and each track's grip limit. */
export function trackForces(t: Terrain, weight: number, L: number, B: number, s0 = 0) {
  const roll = (t.roll * weight) / 2
  const d = turnMoment(t.muT, weight, L, s0) / B
  return { outer: roll + d, inner: roll - d, limit: (t.mu * weight) / 2 }
}

/** Janosi–Hanamoto: share of peak thrust a track of length L builds at slip i (shear modulus K). */
export const shearShare = (i: number, L: number, K: number) => (i <= 0 ? 0 : 1 - (K / (i * L)) * (1 - Math.exp(-(i * L) / K)))
/** Slip a track needs for a thrust share; 1 = spinning. */
export function slipFor(share: number, L: number, K: number) {
  if (share <= 0) return 0
  if (share >= shearShare(1, L, K)) return 1
  let [lo, hi] = [0, 1]
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (shearShare(mid, L, K) < share) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
/** Ground speed under a belt: driving tracks lag (1 − i), braking ones are dragged ahead (÷ (1 − i)). */
export function groundSpeed(belt: number, force: number, limit: number, L: number, K: number) {
  const i = slipFor(Math.abs(force) / limit, L, K)
  return force * belt >= 0 ? belt * (1 - i) : belt / (1 - Math.min(i, 0.5))
}

export const SKID = { v: 0.25, straight: 0.4, dt: 0.005, every: 4, seconds: 16, stuckAfter: 1.2 }
export interface SkidFrame {
  t: number
  pose: Pose
  belt: [number, number]
  ground: [number, number]
  force: [number, number]
  amps: [number, number]
  w: number
  s0: number
  turning: boolean
  stuck: boolean
  /** Sideways slide speed of the track ends (m/s). */
  scuff: number
}

/** Stadium laps (straight, 180° left turn about the commanded centre radius R): left/right belt, ground speed, thrust, motor current. */
export function skidRun(t: Terrain, ratio: number, radius: number): SkidFrame[] {
  const B = TANK.gauge
  const L = ratio * B
  const W = weightN(TANK.massKg)
  const { v, dt, every, seconds } = SKID
  const amps = (f: number) => ampsAt(TANK.drive, Math.abs(f) * TANK.sprocketR)
  const frames: SkidFrame[] = []
  let pose: Pose = { x: 0, y: 0, th: 0 }
  let [turning, dist, turned, w, vc, stuck] = [false, 0, 0, 0, 0, false]
  for (let k = 0; k * dt <= seconds; k++) {
    let belt: [number, number] = [v, v]
    let force: [number, number] = [(t.roll * W) / 2, (t.roll * W) / 2]
    let ground: [number, number]
    let s0 = 0
    const lim = (t.mu * W) / 2
    if (turning) {
      belt = [(v * (radius - B / 2)) / (radius + B / 2), v]
      s0 = pivotShift(vc * w, t.muT, L)
      const f = trackForces(t, W, L, B, s0)
      stuck = f.outer > f.limit
      force = stuck ? [-f.limit, f.limit] : [f.inner, f.outer]
      ground = stuck ? [0, 0] : [groundSpeed(belt[0], force[0], lim, L, t.shearK), groundSpeed(belt[1], force[1], lim, L, t.shearK)]
    } else ground = belt.map((b, i) => groundSpeed(b, force[i], lim, L, t.shearK)) as [number, number]
    vc = (ground[0] + ground[1]) / 2
    w = (ground[1] - ground[0]) / B
    if (k % every === 0)
      frames.push({ t: k * dt, pose, belt, ground, force, amps: [amps(force[0]), amps(force[1])], w, s0, turning, stuck, scuff: turning ? Math.abs(w) * (L / 2 + s0) : 0 })
    pose = twistStep(pose, vc, -s0 * w, w, dt)
    if (turning) {
      turned += w * dt
      if (turned >= Math.PI) [turning, dist] = [false, 0]
    } else {
      dist += vc * dt
      if (dist >= SKID.straight) [turning, turned] = [true, 0]
    }
  }
  return frames
}

// --- Traction: thrust capped by μN or by soil shear, weight spread over the contact patch, Bekker sinkage and rut drag, slopes and tip-over. ---

/** Bekker plate sinkage (m) under pressure p (kPa) on a strip b wide: p = (kc/b + kφ) zⁿ. */
export const plateSink = (t: Terrain, pKpa: number, b: number) => (rigid(t) ? 0 : (pKpa / (t.kc / b + t.kphi)) ** (1 / t.n))
/** Rigid wheel sinkage (Bekker): z = [3W / ((3 − n)(kc + b kφ)√D)]^(2/(2n+1)), W in kN. */
export const wheelSink = (t: Terrain, wheelN: number, b: number, D: number) =>
  rigid(t) ? 0 : ((3 * wheelN) / 1000 / ((3 - t.n) * (t.kc + b * t.kphi) * Math.sqrt(D))) ** (2 / (2 * t.n + 1))
/** Compaction drag of one rut (N): b (kc/b + kφ) z^(n+1) / (n+1). */
const rutDrag = (t: Terrain, b: number, z: number) => (rigid(t) ? 0 : (1000 * b * (t.kc / b + t.kphi) * z ** (t.n + 1)) / (t.n + 1))
/** Peak thrust (N) on a normal load: grousers shear the soil (A·c + N tan φ); smooth pads slide on top (μN, never above the soil's shear). */
export function peakThrust(t: Terrain, normalN: number, areaM2: number, grousers: boolean) {
  const rub = t.mu * normalN
  if (rigid(t)) return rub
  const soil = areaM2 * t.c * 1000 + normalN * Math.tan((t.phiDeg * Math.PI) / 180)
  return grousers ? soil : Math.min(rub, soil)
}

export type RunGear = 'track' | 'wheels'
export interface SoftPull {
  areaM2: number
  pressureKpa: number
  sink: number
  drag: number
  thrust: number
  pull: number
  slip: number
  bellied: boolean
  stuck: boolean
}
/** Same 2 kg robot on tracks or four wheels driving through ground: contact patch, pressure, sinkage, drag, thrust left over (drawbar pull), slip. */
export function softPull(t: Terrain, gear: RunGear, grousers: boolean): SoftPull {
  const W = weightN(TANK.massKg)
  const { contact: L, belt, wheelD: D, wheelB: b } = TANK
  let areaM2: number
  let sink: number
  let drag: number
  if (gear === 'track') {
    areaM2 = 2 * belt * L
    sink = plateSink(t, W / areaM2 / 1000, belt)
    drag = 2 * rutDrag(t, belt, sink) + 0.03 * W
  } else {
    sink = wheelSink(t, W / 4, b, D)
    areaM2 = 4 * b * Math.max(0.01, Math.sqrt(D * sink))
    drag = 2 * rutDrag(t, b, sink) + t.roll * W * (rigid(t) ? 1 : 0.3)
  }
  const bellied = sink > (gear === 'track' ? TANK.clearance : TANK.wheelClear)
  const thrust = peakThrust(t, W, areaM2, grousers)
  const pull = thrust - drag
  const stuck = bellied || pull <= 0
  const L2 = gear === 'track' ? L : Math.max(0.01, Math.sqrt(D * sink))
  return { areaM2, pressureKpa: W / areaM2 / 1000, sink, drag, thrust, pull, slip: stuck ? 1 : slipFor(drag / thrust, L2, t.shearK), bellied, stuck }
}

/** Backward tip-over when the CoM passes behind the rear contact edge: θ = atan((L/2) / h). */
export const tipAngle = (L: number, h: number) => Math.atan2(L / 2, h)
/** Thrust needed and available on a slope θ (tracks): W sin θ + f W cos θ against the peak thrust on W cos θ. */
export function slopeForces(t: Terrain, theta: number, grousers: boolean, L = TANK.contact) {
  const W = weightN(TANK.massKg)
  const need = W * Math.sin(theta) + t.roll * W * Math.cos(theta)
  const have = peakThrust(t, W * Math.cos(theta), 2 * TANK.belt * L, grousers)
  return { need, have, holds: have >= need }
}
/** Steepest slope traction holds (rad). */
export function climbLimit(t: Terrain, grousers: boolean, L = TANK.contact) {
  let [lo, hi] = [0, (80 * Math.PI) / 180]
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (slopeForces(t, mid, grousers, L).holds) lo = mid
    else hi = mid
  }
  return lo
}
