// Building the 4-DOF servo arm: servo per joint, gravity holding torque, current and rail sag, pulse calibration, play and droop at the hand.
import { RAIL, SERVO_BAND_DEG, SERVO_SPECS } from '../actuators/servo'
import { DRIVES, Drive, outputKt, stallA } from '../actuators/sizing'
import { DEG, G, clamp } from '../common'
import { minInputVolts } from '../power/brownout'
import { AMS1117_33 } from '../regulators'
import { P3 } from '../room'
import { SERVO_ARM, SerialArm, armFk, toolOf } from './chain'
import { axisOf, originOf } from './transforms'

/** Hobby servos as drives at their rated volts. */
export const ARM_SERVOS = {
  sg90: { name: 'SG90', kind: 'servo', volts: 4.8, stallNm: 0.18, freeRpm: 83, ohms: 6.9, noLoadA: 0.1, kPerW: 60, tauS: 30, maxC: 70, massG: 9 },
  mg90s: { name: 'MG90S', kind: 'servo', volts: 4.8, stallNm: 0.22, freeRpm: 83, ohms: 4.8, noLoadA: 0.12, kPerW: 50, tauS: 35, maxC: 75, massG: 14 },
  mg996r: DRIVES.servo,
} satisfies Record<string, Drive>
export type ArmServo = keyof typeof ARM_SERVOS

/** Same motor at another supply: stall torque, free speed and stall current all scale with volts. */
export const driveAt = (d: Drive, volts: number): Drive => ({ ...d, volts, stallNm: (d.stallNm * volts) / d.volts, freeRpm: (d.freeRpm * volts) / d.volts })

export interface ArmBuild {
  /** Servo on joints 1…4 and in the gripper. */
  servos: ArmServo[]
  gripper: ArmServo
  /** Bracket mass of links 1…4, kg (link 4 = wrist to tool). */
  linkKg: number[]
  /** Gripper structure without its servo, kg. */
  gripKg: number
}
export const ARM_BUILD: ArmBuild = { servos: ['mg996r', 'mg996r', 'mg996r', 'sg90'], gripper: 'sg90', linkKg: [0.02, 0.03, 0.025, 0.015], gripKg: 0.025 }

/** A point mass riding on link `link` (0 = base): joints 1…link carry it. */
export interface ArmMass {
  at: P3
  kg: number
  link: number
  what: string
}

const servoKg = (s: ArmServo) => ARM_SERVOS[s].massG / 1000

/** Brackets at mid-link, each joint's servo on the link before it (servo i+1 at frame i), gripper + payload at the tool. */
export function armMasses(q: readonly number[], payloadKg: number, b: ArmBuild = ARM_BUILD, arm: SerialArm = SERVO_ARM): ArmMass[] {
  const o = armFk(arm, q).map(originOf)
  const n = arm.rows.length
  const out: ArmMass[] = []
  b.servos.forEach((s, i) => out.push({ at: o[i], kg: servoKg(s), link: i, what: `servo ${i + 1}` }))
  b.linkKg.forEach((kg, i) => out.push({ at: o[i].map((v, k) => (v + o[i + 1][k]) / 2) as P3, kg, link: i + 1, what: `link ${i + 1}` }))
  out.push({ at: o[n], kg: b.gripKg + servoKg(b.gripper), link: n, what: 'gripper' })
  if (payloadKg > 0) out.push({ at: o[n], kg: payloadKg, link: n, what: 'payload' })
  return out
}

/** Torque each revolute joint must supply to hold still: τi = −z(i−1)·Σ (p − o(i−1)) × (0, 0, −m·g) over the masses it carries (= Jᵀ·m·g per mass). Positive = pushing q up. */
export function holdTorques(masses: readonly ArmMass[], q: readonly number[], arm: SerialArm = SERVO_ARM): number[] {
  const f = armFk(arm, q)
  return arm.rows.map((_, i) => {
    const z = axisOf(f[i], 2)
    const o = originOf(f[i])
    return masses
      .filter((m) => m.link > i)
      .reduce((s, m) => {
        const [rx, ry] = [m.at[0] - o[0], m.at[1] - o[1]]
        const w = m.kg * G
        return s + z[0] * ry * w - z[1] * rx * w
      }, 0)
  })
}

/** Holding current: a trickle for the electronics plus torque over the output torque constant, capped at stall. */
export const servoHoldAmps = (d: Drive, torqueNm: number, idleA = 0.01) => Math.min(stallA(d), idleA + Math.abs(torqueNm) / outputKt(d))

export type ArmSupply = keyof typeof ARM_SUPPLIES
/** USB: servos share the ESP32's 5 V through breadboard rails. Pack: 6 V 2S pack on its own leads, ESP32 on USB. */
export const ARM_SUPPLIES = {
  usb: { name: 'USB 5 V, shared', ...RAIL.shared, sharedLogic: true },
  pack: { name: '6 V pack, separate', ...RAIL.separate, sharedLogic: false },
}

/** Rail under a steady load. */
export const railVolts = (volts: number, rSrc: number, amps: number) => volts - amps * rSrc

/** Every servo starting at once looks like its winding resistance: V = Vs / (1 + Rs·Σ1/R). */
export function kickRail(volts: number, rSrc: number, ds: readonly Drive[]) {
  const g = ds.reduce((s, d) => s + 1 / d.ohms, 0)
  const v = volts / (1 + rSrc * g)
  return { volts: v, amps: v * g }
}

/** Lowest 5 V rail that keeps the ESP32's AMS1117 in regulation. */
export const logicMinVolts = minInputVolts(AMS1117_33, RAIL.logicA)

export type HoldVerdict = 'ok' | 'thin' | 'weak'
/** ≤ ½ stall holds cool; up to stall holds but heats and droops; past stall it cannot hold. */
export const holdVerdict = (share: number): HoldVerdict => (share <= 0.5 ? 'ok' : share <= 1 ? 'thin' : 'weak')

/** Per joint and gripper at the supply: hold torque share of stall, current; plus rail volts at rest and when all start at once. */
export function armBudget(q: readonly number[], payloadKg: number, supply: ArmSupply, b: ArmBuild = ARM_BUILD) {
  const s = ARM_SUPPLIES[supply]
  const drives = [...b.servos, b.gripper].map((k) => driveAt(ARM_SERVOS[k], s.volts))
  const tau = holdTorques(armMasses(q, payloadKg, b), q)
  const joints = tau.map((t, i) => {
    const share = Math.abs(t) / drives[i].stallNm
    return { tau: t, share, amps: servoHoldAmps(drives[i], t), verdict: holdVerdict(share) }
  })
  const amps = joints.reduce((a, j) => a + j.amps, 0) + servoHoldAmps(drives[4], 0) + (s.sharedLogic ? RAIL.logicA : 0)
  const kick = kickRail(s.volts, s.rSrc, drives)
  const restVolts = railVolts(s.volts, s.rSrc, amps)
  return { drives, joints, amps, restVolts, kick, resets: s.sharedLogic && Math.min(kick.volts, restVolts) < logicMinVolts }
}

// --- Calibration: joint angle ↔ pulse, per servo. ---

export interface ServoCal {
  /** Pulse at joint angle 0, µs. */
  zeroUs: number
  /** Signed: a servo mounted mirror-image turns the joint the other way. */
  usPerRad: number
}
export const US_PER_RAD = (SERVO_SPECS.wide.maxUs - SERVO_SPECS.wide.minUs) / Math.PI
/** Base centred straight ahead, shoulder 0° = arm flat forward, elbow mounted mirrored, wrist centred. */
export const ARM_CAL: ServoCal[] = [
  { zeroUs: 1500, usPerRad: US_PER_RAD },
  { zeroUs: 500, usPerRad: US_PER_RAD },
  { zeroUs: 1500, usPerRad: -US_PER_RAD },
  { zeroUs: 1500, usPerRad: US_PER_RAD },
]
export const pulseUs = (q: number, c: ServoCal) => clamp(c.zeroUs + c.usPerRad * q, SERVO_SPECS.wide.minUs, SERVO_SPECS.wide.maxUs)
export const jointFromPulse = (us: number, c: ServoCal) => (us - c.zeroUs) / c.usPerRad

/** 25-tooth output spline: a horn can only go on in 14.4° steps. */
export const HORN_TEETH = 25
export const TOOTH_DEG = 360 / HORN_TEETH
/** Horn pressed on `deg` past where the code assumes: zero pulse moves the other way. */
export const hornShift = (c: ServoCal, deg: number): ServoCal => ({ ...c, zeroUs: c.zeroUs - c.usPerRad * deg * DEG })
export const reversed = (c: ServoCal): ServoCal => ({ ...c, usPerRad: -c.usPerRad })

/** PCA9685: 12-bit counter per PWM period. */
export const pcaTicks = (us: number, hz = 50) => Math.round((us * hz * 4096) / 1e6)
export const ticksUs = (ticks: number, hz = 50) => (ticks * 1e6) / (hz * 4096)

/** Joint angles the real servos settle at: the code's pulse (rounded to PCA9685 ticks) read through each servo's true calibration. */
export const actualJoints = (q: readonly number[], code: readonly ServoCal[], truth: readonly ServoCal[], hz = 50) =>
  q.map((v, i) => jointFromPulse(ticksUs(pcaTicks(pulseUs(v, code[i]), hz), hz), truth[i]))

// --- Play and droop under load ---

/** P-loop stiffness: full stall torque at the edge of the servo's proportional band. */
export const servoStiffness = (d: Drive) => d.stallNm / (SERVO_BAND_DEG * DEG)

/** Gravity pushes each joint to one side of its gear play (half the gap) and winds the P-loop back by τ/k. */
export const sagJoints = (tau: readonly number[], drives: readonly Drive[], playRad: number) =>
  tau.map((t, i) => (Math.abs(t) < 1e-9 ? 0 : -Math.sign(t) * (playRad / 2 + Math.abs(t) / servoStiffness(drives[i]))))

/** Distance between the tool points of two poses. */
export function handGap(qa: readonly number[], qb: readonly number[], arm: SerialArm = SERVO_ARM) {
  const [a, b] = [toolOf(armFk(arm, qa)), toolOf(armFk(arm, qb))]
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
