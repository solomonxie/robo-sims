// Underwater ROV: buoyancy and trim, metacentric righting, depth pressure; vectored thruster allocation, v² drag, T200 asymmetry.
import { gaussSolve } from '../../nodal'
import { weightN } from '../actuators/linear'
import { clamp } from '../common'

const G = 9.81
export const P_ATM = 101_325
/** Water density (kg/m³). */
export const WATERS = { fresh: 1000, salt: 1025 }
export type WaterKind = keyof typeof WATERS

/** BlueROV2-style vehicle (z up, from the main tube's centre): hull mass (kg), displaced volume (m³) and centres (m);
 *  subsea foam blocks and lead weights (kg, m³, height on top / on the skids); roll inertia with added mass (kg·m²) and damping (N·m·s);
 *  heave added mass (kg) and drag area Cd·A (m²); 4" end cap (m²) and depth rating (m). */
export const ROV = {
  mass: 10, volume: 0.00883, zG: -0.01, zB: 0,
  foam: { mass: 0.3, volume: 0.001, z: 0.1 },
  lead: { mass: 0.2, volume: 0.2 / 11_340, z: -0.11 },
  rollI: 0.3, rollC: 0.5, heaveAdded: 8, heaveCdA: 0.25,
  capArea: Math.PI * 0.05 ** 2, rating: 100,
}

export interface Trim { foam: number; lead: number; foamLow?: boolean }

/** Buoyant force: the weight of the displaced water, ρ·V·g (N). */
export const buoyancyN = (rho: number, volume: number) => rho * volume * G
/** Absolute and gauge pressure at `depth` m (Pa). */
export const pressureAt = (rho: number, depth: number) => P_ATM + rho * G * depth
export const gaugeAt = (rho: number, depth: number) => rho * G * depth

/** Mass, volume, buoyancy, net lift (N, > 0 rises) and the heights of G and B for a trim; foamLow swaps foam and lead (foam under, lead on top). */
export function rovTrim(t: Trim, rho: number, r = ROV) {
  const zf = t.foamLow ? -r.foam.z : r.foam.z
  const zl = t.foamLow ? -r.lead.z : r.lead.z
  const mass = r.mass + t.foam * r.foam.mass + t.lead * r.lead.mass
  const volume = r.volume + t.foam * r.foam.volume + t.lead * r.lead.volume
  const zG = (r.mass * r.zG + t.foam * r.foam.mass * zf + t.lead * r.lead.mass * zl) / mass
  const zB = (r.volume * r.zB + t.foam * r.foam.volume * zf + t.lead * r.lead.volume * zl) / volume
  const buoyancy = buoyancyN(rho, volume)
  const weight = weightN(mass)
  return { mass, volume, buoyancy, weight, net: buoyancy - weight, zG, zB, bg: zB - zG }
}
export type TrimResult = ReturnType<typeof rovTrim>

/** Net lift as an equivalent mass (kg): what a scale would read, negative = sinks. */
export const netKg = (net: number) => net / G
/** Lead weights that bring the net lift closest to zero while staying ≥ 0 (slightly positive floats up on power loss). */
export function leadForTrim(foam: number, rho: number, r = ROV) {
  for (let n = 0; n <= 40; n++) if (rovTrim({ foam, lead: n + 1 }, rho, r).net < 0) return n
  return 40
}
/** Righting moment about G when rolled `phi`: buoyancy at B, BG above G, gives B·BG·sin φ (N·m; > 0 pushes back to level). */
export const rightingMoment = (t: TrimResult, phi: number) => t.buoyancy * t.bg * Math.sin(phi)
/** Small-angle roll period (s) of a fully submerged body: B sits at the metacentre, so the stiffness is B·BG. */
export const rollPeriod = (t: TrimResult, r = ROV) => (t.bg > 0 ? 2 * Math.PI * Math.sqrt(r.rollI / (t.buoyancy * t.bg)) : Infinity)
/** Force on a flat end cap at `depth` m (N, gauge). */
export const capForce = (rho: number, depth: number, r = ROV) => gaugeAt(rho, depth) * r.capArea

export interface BuoyFrame { t: number; depth: number; vz: number; roll: number; rate: number; floating: boolean; grounded: boolean }
export interface BuoySetup { trim: Trim; rho: number; seconds: number; depth0: number; roll0: number; tank: number; dt?: number }
/** Released at `depth0` m with `roll0` rad: heave under net lift and v² drag (stops at the surface / floor), roll under B·BG·sin φ and damping. */
export function buoyRun(c: BuoySetup, r = ROV): BuoyFrame[] {
  const dt = c.dt ?? 0.01
  const tr = rovTrim(c.trim, c.rho, r)
  const top = 0.13
  let s = { depth: c.depth0, vz: 0, roll: c.roll0, rate: 0 }
  const out: BuoyFrame[] = []
  for (let n = 0; n * dt <= c.seconds + 1e-9; n++) {
    const floating = s.depth <= top + 1e-9 && tr.net > 0
    const grounded = s.depth >= c.tank - top - 1e-9 && tr.net < 0
    out.push({ t: n * dt, ...s, floating, grounded })
    const drag = 0.5 * c.rho * r.heaveCdA * s.vz * Math.abs(s.vz)
    const vz = s.vz + ((-tr.net - drag) / (tr.mass + r.heaveAdded)) * dt
    const depth = clamp(s.depth + vz * dt, top, c.tank - top)
    const rate = s.rate + ((-rightingMoment(tr, s.roll) - r.rollC * s.rate) / r.rollI) * dt
    s = { depth, vz: depth === s.depth + vz * dt ? vz : 0, roll: s.roll + rate * dt, rate }
  }
  return out
}

/** Blue Robotics T200 at 16 V: full forward / reverse thrust (N). Reverse is weaker: the blades are shaped for forward. */
export const T200 = { fwd: 51.5, rev: 40.2 }
const C45 = Math.SQRT1_2

/** BlueROV2 vectored frame (x forward, y left, z up, m): four horizontal thrusters at 45° and two vertical; dir = push on the vehicle at +command. */
export const THRUSTERS = [
  { name: 'T1 front right', x: 0.15, y: -0.11, z: 0, dir: [C45, C45, 0] },
  { name: 'T2 front left', x: 0.15, y: 0.11, z: 0, dir: [C45, -C45, 0] },
  { name: 'T3 rear right', x: -0.15, y: -0.11, z: 0, dir: [C45, -C45, 0] },
  { name: 'T4 rear left', x: -0.15, y: 0.11, z: 0, dir: [C45, C45, 0] },
  { name: 'T5 vertical right', x: 0, y: -0.11, z: 0.05, dir: [0, 0, 1] },
  { name: 'T6 vertical left', x: 0, y: 0.11, z: 0.05, dir: [0, 0, 1] },
] as const

/** Commanded motion: surge > 0 forward, sway > 0 right, heave > 0 up, yaw > 0 clockwise from above. */
export interface Wrench { surge: number; sway: number; heave: number; yaw: number }
export const AXES = ['surge', 'sway', 'heave', 'yaw'] as const

/** Thruster geometry matrix (rows surge, sway, heave, yaw; one column per thruster): a thruster's force direction and its yaw lever. */
export const GEOMETRY = AXES.map((_, row) =>
  THRUSTERS.map((t) => [t.dir[0], -t.dir[1], t.dir[2], -(t.x * t.dir[1] - t.y * t.dir[0])][row]),
)

/** Moore–Penrose pseudo-inverse of a wide matrix, Bᵀ(B·Bᵀ)⁻¹: the least-effort thrusts for a wrench. */
export function pseudoInverse(b: number[][]) {
  const rows = b.length
  const bbt = b.map((r) => b.map((s) => r.reduce((a, v, k) => a + v * s[k], 0)))
  const unit = (j: number) => Array.from({ length: rows }, (_, i) => (i === j ? 1 : 0))
  const inv = unit(0).map((_, j) => gaussSolve(bbt.map((r) => [...r]), unit(j))!)
  const cols = b[0].map((_, k) => k)
  return cols.map((k) => inv.map((col) => b.reduce((a, r, i) => a + r[k] * col[i], 0)))
}

/** Allocation matrix (one row per thruster, columns surge/sway/heave/yaw): the pseudo-inverse, each column scaled so a full stick drives the busiest thruster to 100 %. */
export const ALLOC = (() => {
  const p = pseudoInverse(GEOMETRY)
  const peak = AXES.map((_, j) => Math.max(...p.map((r) => Math.abs(r[j]))))
  return p.map((r) => r.map((v, j) => Math.round((v / peak[j]) * 1e9) / 1e9))
})()

/** Thrust (N) for a command −1…1: forward and reverse maxima differ. */
export const thrusterForce = (u: number, t = T200) => (u >= 0 ? u * t.fwd : u * t.rev)

/** Wrench sticks (−1…1) → thruster commands: allocation, optional reverse compensation (reverse commands × fwd/rev so forces match),
 *  then one common scale-down if any command passes 100 % (keeps the direction of the wrench). */
export function allocate(w: Wrench, compensate = false, t = T200) {
  const stick = AXES.map((a) => w[a])
  const raw = ALLOC.map((row) => row.reduce((a, v, j) => a + v * stick[j], 0)).map((u) => (compensate && u < 0 ? (u * t.fwd) / t.rev : u))
  const peak = Math.max(1, ...raw.map(Math.abs))
  const cmd = raw.map((u) => u / peak)
  const force = cmd.map((u) => thrusterForce(u, t))
  return { raw, cmd, force, scale: 1 / peak, saturated: peak > 1 + 1e-9 }
}

/** Net wrench (N, N; N; N·m clockwise) from thruster forces. */
export function thrustWrench(force: readonly number[]): Wrench {
  const [surge, sway, heave, yaw] = GEOMETRY.map((r) => r.reduce((a, v, k) => a + v * force[k], 0))
  return { surge, sway, heave, yaw }
}

/** Hydrodynamics for the thruster lesson: mass + added mass per axis (kg, kg·m²) and quadratic drag (Cd·A m², yaw N·m·s²). */
export const ROV_DYN = { mass: [11.5 + 5.5, 11.5 + 12.7, 11.5 + 14.6], yawI: 0.26 + 0.12, cdA: [0.13, 0.2, 0.25], yawDrag: 8 }

/** Speed where drag ½ρ·CdA·v² equals thrust F (m/s). */
export const topSpeed = (force: number, cdA: number, rho = WATERS.fresh) => Math.sqrt((2 * Math.abs(force)) / (rho * cdA))
/** Yaw rate where v² drag torque equals the yaw moment (rad/s). */
export const topYawRate = (moment: number, d = ROV_DYN) => Math.sqrt(Math.abs(moment) / d.yawDrag)
export const dragN = (v: number, cdA: number, rho = WATERS.fresh) => 0.5 * rho * cdA * v * Math.abs(v)

export interface RovState { x: number; y: number; heading: number; depth: number; u: number; v: number; w: number; r: number }
export const ROV0: RovState = { x: 0, y: 0, heading: 0, depth: 0, u: 0, v: 0, w: 0, r: 0 }
/** One step (body velocities u forward, v right, w up, r clockwise): thrust minus v² drag; pose in the pool (x north, y east, heading clockwise from north). */
export function rovStep(s: RovState, f: Wrench, dt: number, rho = WATERS.fresh, d = ROV_DYN): RovState {
  const [cu, cv, cw] = d.cdA
  const u = s.u + ((f.surge - dragN(s.u, cu, rho)) / d.mass[0]) * dt
  const v = s.v + ((f.sway - dragN(s.v, cv, rho)) / d.mass[1]) * dt
  const w = s.w + ((f.heave - dragN(s.w, cw, rho)) / d.mass[2]) * dt
  const r = s.r + ((f.yaw - d.yawDrag * s.r * Math.abs(s.r)) / d.yawI) * dt
  const heading = s.heading + r * dt
  const c = Math.cos(heading)
  const sn = Math.sin(heading)
  return { x: s.x + (u * c - v * sn) * dt, y: s.y + (u * sn + v * c) * dt, heading, depth: s.depth - w * dt, u, v, w, r }
}
export interface RovFrame extends RovState { t: number }
/** Constant sticks for `seconds` from rest. */
export function rovRun(w: Wrench, compensate: boolean, seconds: number, dt = 0.01): RovFrame[] {
  const f = thrustWrench(allocate(w, compensate).force)
  let s = ROV0
  const out: RovFrame[] = []
  for (let n = 0; n * dt <= seconds + 1e-9; n++) {
    out.push({ t: n * dt, ...s })
    s = rovStep(s, f, dt)
  }
  return out
}
