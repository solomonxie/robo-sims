// Robot arm: the Kinematics servo arm as a kit. Horn mounting → each servo's 180° of travel, two-point servo calibration
// with a protractor, and a pick-and-place job run by IK at 50 Hz on slew-limited servos with a friction gripper.
import { DEG, G, clamp, sweep } from '../common'
import { P3 } from '../room'
import { SERVO_SPECS } from '../actuators/servo'
import { SERVO_ARM, armFk, toolOf } from '../kinematics/chain'
import { inLimits, servoArmIk } from '../kinematics/ik'
import { timeScale } from '../kinematics/trajectory'
import { jawForceN, jawHoldN, jawTouchDeg, servoSqueezeNm } from '../kinematics/gripper'
import { originOf } from '../kinematics/transforms'
import {
  ARM_BUILD, ARM_CAL, ARM_SERVOS, ARM_SUPPLIES, ServoCal, TOOTH_DEG, actualJoints, armMasses, driveAt, handGap, holdTorques, hornShift, jointFromPulse, pcaTicks, pulseUs, ticksUs,
} from '../kinematics/armbuild'

const N_JOINTS = SERVO_ARM.rows.length
const CENTRE_US = (SERVO_SPECS.wide.minUs + SERVO_SPECS.wide.maxUs) / 2
const dist3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// --- Assemble: centre each servo, then fit the horn with the joint at the middle of the travel it needs. ---

/** Desk top below frame 0 (the base box is 5 cm tall). */
export const DESK_Z = -0.05
/** Centred servo, horn on the tooth nearest the intended pose: what is left by eye (each ≤ half a 14.4° tooth). */
export const ARM_HORN_DEG = [5, -6, 4, -3]
/** Horns pressed on unpowered: each shaft sat wherever the last test left it. */
export const HORN_LOOSE_DEG = [33, -52, 41, -24]
/** Joint angle at the centre pulse as designed: base ahead, upper arm straight up, elbow straight, wrist in line. */
export const MOUNT_CENTRES = ARM_CAL.map((c) => jointFromPulse(CENTRE_US, c) + 0)

export interface MountPlan {
  centred: boolean
  /** Horn put on this many teeth off the designed pose, per joint (+ = joint sits further positive). */
  teeth: readonly number[]
}
/** True pulse ↔ angle of every servo as mounted. */
export const mountCals = (m: MountPlan): ServoCal[] => ARM_CAL.map((c, i) => hornShift(c, (m.centred ? ARM_HORN_DEG : HORN_LOOSE_DEG)[i] + (m.teeth[i] ?? 0) * TOOTH_DEG))
/** Joint angles the servo can reach from 500 to 2500 µs, low to high. */
export function servoTravel(c: ServoCal): [number, number] {
  const [a, b] = [jointFromPulse(SERVO_SPECS.wide.minUs, c), jointFromPulse(SERVO_SPECS.wide.maxUs, c)]
  return [Math.min(a, b), Math.max(a, b)]
}
/** Servo travel ∩ the arm's own limits (brackets hitting each other). */
export function usableRange(c: ServoCal, i: number): [number, number] {
  const [lo, hi] = servoTravel(c)
  return [Math.max(lo, SERVO_ARM.limits[i][0]), Math.min(hi, SERVO_ARM.limits[i][1])]
}

/** Spots on the desk (block centres, arm frame) and one on a shelf. */
export const DESK_SPOTS: { name: string; at: P3 }[] = [
  { name: 'front', at: [0.17, 0, DESK_Z + 0.015] },
  { name: 'far', at: [0.25, 0.03, DESK_Z + 0.015] },
  { name: 'left', at: [0.08, 0.17, DESK_Z + 0.015] },
  { name: 'right', at: [0.08, -0.17, DESK_Z + 0.015] },
  { name: 'by the base', at: [0.13, -0.06, DESK_Z + 0.015] },
  { name: 'shelf', at: [-0.04, 0.17, 0.13] },
]
/** Hand pitches the controller may use to get there, steepest first. */
export const SPOT_PITCHES = [-90, -60, -30, 0, -120].map((d) => d * DEG)
/** Elbow and wrist must stay this far above the desk. */
const DESK_CLEAR = 0.008

export type SpotWhy = 'ok' | 'travel' | 'desk' | 'reach'
export interface SpotResult {
  name: string
  at: P3
  why: SpotWhy
  /** Pose it ends in: the solution, or the nearest pose the servos allow. */
  q: number[]
  miss: number
}
const aboveDesk = (q: readonly number[]) => armFk(SERVO_ARM, q).slice(2).every((f) => originOf(f)[2] >= DESK_Z + DESK_CLEAR)

/** Every IK branch at every pitch; ok if one fits the usable ranges and stays above the desk, else the clamped pose that misses least. */
export function spotReach(at: P3, cals: readonly ServoCal[], name = ''): SpotResult {
  const ranges = cals.map(usableRange)
  const fits = (q: readonly number[]) => q.every((v, i) => v >= ranges[i][0] - 1e-9 && v <= ranges[i][1] + 1e-9)
  let best: SpotResult | null = null
  let reached = false
  for (const pitch of SPOT_PITCHES) {
    const s = servoArmIk(at, pitch)
    if (!s.reachable) continue
    reached = true
    for (const sol of s.solutions) {
      if (fits(sol.q)) {
        if (aboveDesk(sol.q)) return { name, at, why: 'ok', q: sol.q, miss: 0 }
        if (!best || best.why !== 'desk') best = { name, at, why: 'desk', q: sol.q, miss: 0 }
        continue
      }
      const q = sol.q.map((v, i) => clamp(v, ranges[i][0], ranges[i][1]))
      const miss = dist3(toolOf(armFk(SERVO_ARM, q)), at)
      if (!best || (best.why === 'travel' && miss < best.miss)) best = { name, at, why: 'travel', q, miss }
    }
  }
  if (best) return best
  return { name, at, why: reached ? 'travel' : 'reach', q: [...MOUNT_CENTRES], miss: dist3(toolOf(armFk(SERVO_ARM, MOUNT_CENTRES)), at) }
}

/** Assembly check: each servo's travel, the spots it reaches, and the offset left for calibration to trim. */
export function mountCheck(m: MountPlan) {
  const cals = mountCals(m)
  const spots = DESK_SPOTS.map((s) => spotReach(s.at, cals, s.name))
  const trims = cals.map((c, i) => jointFromPulse(ARM_CAL[i].zeroUs, c))
  return { cals, travel: cals.map(servoTravel), usable: cals.map(usableRange), spots, reached: spots.filter((s) => s.why === 'ok').length, trims }
}

// --- Calibrate servos: send known pulses, read the joint on a protractor, fit zero and µs per degree. ---

/** Each servo's real µs per degree ÷ the nominal 11.1 (hobby servos spread ±5 %). */
export const SERVO_SPREAD = [0.97, 1.05, 0.94, 1.06]
/** The arm as built: horn offsets by eye, real scales; `flipElbow` = elbow servo mounted the wrong way round. */
export const servoTruths = (flipElbow = false): ServoCal[] =>
  ARM_CAL.map((c, i) => ({ zeroUs: hornShift(c, ARM_HORN_DEG[i]).zeroUs, usPerRad: c.usPerRad * SERVO_SPREAD[i] * (flipElbow && i === 2 ? -1 : 1) }))

export type CalMethod = 'none' | 'centre' | 'twoPoint'
/** Test pulses ± this far from centre (≈ ±54°). */
export const CAL_SPAN_US = 600
/** What a protractor with `resDeg` marks reads for the joint at `rad`. */
export const protractorDeg = (rad: number, resDeg: number) => (resDeg > 0 ? Math.round(rad / DEG / resDeg) * resDeg : rad / DEG)
/** The pulse the servo actually gets after PCA9685 tick rounding. */
const sent = (us: number) => ticksUs(pcaTicks(us))
/** Protractor reading (degrees) with the servo at pulse `us`. */
export const readAt = (us: number, truth: ServoCal, resDeg: number) => protractorDeg(jointFromPulse(sent(us), truth), resDeg)
export const calPulses = (m: CalMethod) => (m === 'twoPoint' ? [CENTRE_US - CAL_SPAN_US, CENTRE_US + CAL_SPAN_US] : m === 'centre' ? [CENTRE_US] : [])

/** none: the nominal table; centre: read the angle at 1500 µs and move the zero; two-point: two readings give zero and slope (sign included). */
export function calibrateServo(m: CalMethod, code: ServoCal, truth: ServoCal, resDeg: number): ServoCal {
  if (m === 'none') return code
  if (m === 'centre') return { ...code, zeroUs: CENTRE_US - code.usPerRad * readAt(CENTRE_US, truth, resDeg) * DEG }
  const [u1, u2] = calPulses(m)
  const [a1, a2] = [readAt(u1, truth, resDeg) * DEG, readAt(u2, truth, resDeg) * DEG]
  const k = (u2 - u1) / (a2 - a1)
  return { zeroUs: u1 - k * a1, usPerRad: k }
}
export const calibrateArm = (m: CalMethod, truths: readonly ServoCal[], resDeg: number) => truths.map((t, i) => calibrateServo(m, ARM_CAL[i], t, resDeg))

/** Working sweep of each joint: ±60° about its designed centre. */
export const CAL_SWEEP = { halfDeg: 60, n: 25 }
/** Real minus commanded angle across each joint's working sweep, and the worst. */
export function calErrors(code: readonly ServoCal[], truths: readonly ServoCal[]) {
  const joints = code.map((c, i) => {
    const q = sweep(MOUNT_CENTRES[i] - CAL_SWEEP.halfDeg * DEG, MOUNT_CENTRES[i] + CAL_SWEEP.halfDeg * DEG, CAL_SWEEP.n)
    const err = q.map((v) => jointFromPulse(sent(pulseUs(v, c)), truths[i]) - v)
    return { q, err, worst: Math.max(...err.map(Math.abs)) }
  })
  return { joints, worst: Math.max(...joints.map((j) => j.worst)) }
}
/** Spot poses the controller would use (ideal mount), computed once. */
let SPOT_POSES: number[][] | null = null
const spotPoses = () => (SPOT_POSES ??= DESK_SPOTS.map((s) => spotReach(s.at, ARM_CAL).q))
/** Hand miss at every desk spot when the code drives the real servos. */
export const spotErrors = (code: readonly ServoCal[], truths: readonly ServoCal[]) => spotPoses().map((q) => handGap(q, actualJoints(q, code, truths)))

// --- IK control: a pick-and-place job, target → IK every 20 ms → pulses; the servos follow at their own speed. ---

export const ARM_JOB = {
  pick: [0.15, -0.14, DESK_Z + 0.015] as P3,
  place: [0.15, 0.14, DESK_Z + 0.015] as P3,
  home: [0.13, 0, 0.09] as P3,
  hover: 0.07,
  pitch: -90 * DEG,
  /** 100 g printed block, 30 mm wide, PLA on PLA pads. */
  blockKg: 0.1,
  blockMm: 30,
  mu: 0.35,
  /** Trapezoid ramp time: a_max = v_max / ramp. */
  rampS: 0.2,
  gripS: 0.4,
  dt: 0.02,
  /** Servo's own lag behind its command (P-loop + gear backlash take-up). */
  lagS: 0.06,
  /** Placed within this of the target counts as on target. */
  placeTol: 0.01,
}
export type JobInterp = 'cartesian' | 'joint'
export interface JobSeg {
  kind: 'move' | 'close' | 'open'
  a: P3
  b: P3
  T: number
  label: string
}
const up = (p: P3, h: number): P3 => [p[0], p[1], p[2] + h]

/** Home → over the pick → down → close → up → over the place → down → open → up → home, each move a trapezoid in time. */
export function jobPath(speed: number, j = ARM_JOB): JobSeg[] {
  const [pa, qa] = [up(j.pick, j.hover), up(j.place, j.hover)]
  const pts: [P3, P3, string][] = [
    [j.home, pa, 'to the pick'],
    [pa, j.pick, 'down'],
    [j.pick, j.pick, 'close'],
    [j.pick, pa, 'lift'],
    [pa, qa, 'carry'],
    [qa, j.place, 'down'],
    [j.place, j.place, 'open'],
    [j.place, qa, 'up'],
    [qa, j.home, 'home'],
  ]
  return pts.map(([a, b, label]) => {
    if (label === 'close' || label === 'open') return { kind: label, a, b, T: j.gripS, label }
    const L = dist3(a, b)
    return { kind: 'move', a, b, T: timeScale('trapezoid', speed / L, speed / j.rampS / L).T, label }
  })
}

/** Squeeze and hold of the rack gripper on the block: SG90 at the pack voltage pushing `squeezeDeg` past contact. */
export function gripHold(squeezeDeg: number, j = ARM_JOB) {
  const drive = driveAt(ARM_SERVOS[ARM_BUILD.gripper], ARM_SUPPLIES.pack.volts)
  const touch = jawTouchDeg('rack', j.blockMm / 2)
  const normalN = jawForceN('rack', servoSqueezeNm(touch + squeezeDeg, touch, drive.stallNm), touch + squeezeDeg, j.blockMm / 2)
  return { touch, normalN, holdN: jawHoldN(normalN, j.mu), weightN: j.blockKg * G }
}

export interface JobFrame {
  t: number
  seg: number
  /** Where the plan wants the hand, where it is, and the straight line's point. */
  plan: P3
  hand: P3
  cmd: number[]
  q: number[]
  /** 0 open … 1 closed on the block. */
  jaw: number
  held: boolean
  block: P3
  needN: number
}

const pickBranch = (target: P3, pitch: number, prev: readonly number[]) => {
  const s = servoArmIk(target, pitch)
  const ok = s.solutions.filter((x) => inLimits(SERVO_ARM, x.q))
  const pool = ok.length ? ok : s.solutions
  return pool.reduce((a, b) => (b.q.reduce((t, v, i) => t + Math.abs(v - prev[i]), 0) < a.q.reduce((t, v, i) => t + Math.abs(v - prev[i]), 0) ? b : a)).q
}
/** Distance from p to segment a–b. */
export function segmentGap(p: readonly number[], a: readonly number[], b: readonly number[]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  const u = L2 < 1e-12 ? 0 : clamp(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2, 0, 1)
  return dist3(p, [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u])
}

/** Runs the job: plan (straight line through IK, or joint lerp between IK end poses) → servos that lag and slow under load
 *  (ω = ω_free·(1 − τ/τ_stall)) → hand. The block slips when m·|a − g| beats the jaws' friction. */
export function jobRun(interp: JobInterp, speed: number, squeezeDeg: number, j = ARM_JOB) {
  const segs = jobPath(speed, j)
  const drives = ARM_BUILD.servos.map((s) => driveAt(ARM_SERVOS[s], ARM_SUPPLIES.pack.volts))
  const wFree = drives.map((d) => (d.freeRpm * 2 * Math.PI) / 60)
  const grip = gripHold(squeezeDeg, j)
  const homeQ = pickBranch(j.home, j.pitch, MOUNT_CENTRES)
  let q = [...homeQ]
  let cmd = [...homeQ]
  let held = false
  let block: P3 = [...j.pick]
  let slipAt: number | null = null
  let gripped = false
  const hands: P3[] = []
  const frames: JobFrame[] = []
  const peakRate = Array(N_JOINTS).fill(0)
  let [lagMax, devMax, minMargin] = [0, 0, Infinity]
  let t = 0
  segs.forEach((s, k) => {
    const n = Math.max(1, Math.round(s.T / j.dt))
    const qa = pickBranch(s.a, j.pitch, cmd)
    const qb = pickBranch(s.b, j.pitch, qa)
    const scale = s.kind === 'move' ? timeScale('trapezoid', speed / dist3(s.a, s.b), speed / j.rampS / dist3(s.a, s.b)) : null
    for (let i = 1; i <= n; i++) {
      const u = scale ? scale.at((i / n) * scale.T).s : i / n
      const prev = cmd
      if (s.kind === 'move') cmd = interp === 'cartesian' ? pickBranch([0, 1, 2].map((d) => s.a[d] + (s.b[d] - s.a[d]) * u) as P3, j.pitch, cmd) : qa.map((v, d) => v + (qb[d] - v) * u)
      cmd.forEach((v, d) => (peakRate[d] = Math.max(peakRate[d], Math.abs(v - prev[d]) / j.dt)))
      const tau = holdTorques(armMasses(q, held ? j.blockKg : 0), q)
      q = q.map((v, d) => {
        const w = wFree[d] * Math.max(0.2, 1 - Math.abs(tau[d]) / drives[d].stallNm)
        return v + clamp((cmd[d] - v) / j.lagS, -w, w) * j.dt
      })
      t += j.dt
      const hand = toolOf(armFk(SERVO_ARM, q))
      const plan = toolOf(armFk(SERVO_ARM, cmd))
      hands.push(hand)
      const m = hands.length
      let needN = 0
      if (held && m >= 5) {
        const h = 2 * j.dt
        const a = [0, 1, 2].map((d) => (hands[m - 1][d] - 2 * hands[m - 3][d] + hands[m - 5][d]) / (h * h))
        needN = j.blockKg * Math.hypot(a[0], a[1], a[2] + G)
        minMargin = Math.min(minMargin, grip.holdN / needN)
        if (needN > grip.holdN) {
          held = false
          slipAt = t
          block = [hand[0], hand[1], DESK_Z + j.blockMm / 2000]
        }
      }
      if (s.kind === 'close' && i === n && slipAt === null) held = gripped = grip.holdN >= grip.weightN
      if (s.kind === 'open' && i === 1 && held) {
        held = false
        block = [hand[0], hand[1], DESK_Z + j.blockMm / 2000]
      }
      if (held) block = hand
      if (s.kind === 'move') {
        lagMax = Math.max(lagMax, dist3(plan, hand))
        devMax = Math.max(devMax, segmentGap(hand, s.a, s.b))
      }
      const jaw = s.kind === 'close' ? i / n : s.kind === 'open' ? 1 - i / n : held || (k > 2 && k < 6) ? 1 : 0
      frames.push({ t, seg: k, plan, hand, cmd: [...cmd], q: [...q], jaw, held, block: [...block], needN })
    }
  })
  const placeErr = Math.hypot(block[0] - j.place[0], block[1] - j.place[1])
  const result = !gripped ? 'not gripped' : slipAt !== null ? 'dropped' : placeErr <= j.placeTol ? 'placed' : 'off target'
  return { segs, frames, T: t, grip, lagMax, devMax, minMargin, slipAt, placeErr, result, peakRate, wFree }
}
