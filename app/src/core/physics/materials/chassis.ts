// Chassis design: part layout on a two-wheel + caster plate → centre of mass, wheel loads, slip and tip limits, IMU offset;
// cable runs → voltage drop, wire heat and the motor-PWM spike coupled into an I²C pair.
import { G, TAU } from '../common'
import { massCentre, tipAccels } from '../mechanics/tipping'
import { runPoint } from '../power/wiring'

/** Body frame (m): x forward from the drive axle, y left, z up from the floor. Two driven wheels on the axle, caster behind. */
export const CHASSIS = { track: 0.13, wheelR: 0.033, plateZ: 0.04, front: 0.05, rearPad: 0.025, mu: 0.8, spinHz: 1 }

export interface ChassisPart {
  key: string
  name: string
  kg: number
  x: number
  y: number
  z: number
  /** Footprint (m) along x and y, for drawing. */
  size: [number, number]
}

export type BattDeck = 'low' | 'top'
export type ImuSpot = 'axle' | 'front' | 'rear'
export const IMU_SPOTS: Record<ImuSpot, { name: string }> = { axle: { name: 'IMU over the axle' }, front: { name: 'IMU at the front' }, rear: { name: 'IMU over the caster' } }
export const DECKS: Record<BattDeck, { name: string }> = { low: { name: 'battery under the plate' }, top: { name: 'battery on a top deck' } }

/** Typical small robot: 3 mm acrylic plate, two TT gearmotors + 65 mm wheels, 2 × 18650 in a holder, DRV8833-class driver, ESP32 DevKit, IMU, ball caster. */
export function chassisLayout(battX: number, deck: BattDeck, wheelbase: number, imu: ImuSpot): ChassisPart[] {
  const { track, wheelR, plateZ, front, rearPad } = CHASSIS
  const len = front + wheelbase + rearPad
  const imuX = imu === 'axle' ? 0 : imu === 'front' ? front - 0.012 : -wheelbase
  return [
    { key: 'plate', name: 'plate', kg: 1190 * 0.003 * len * (track - 0.02), x: (front - wheelbase - rearPad) / 2, y: 0, z: plateZ, size: [len, track - 0.02] },
    { key: 'motorL', name: 'motor + wheel', kg: 0.05, x: 0, y: track / 2 - 0.022, z: wheelR, size: [0.07, 0.022] },
    { key: 'motorR', name: 'motor + wheel', kg: 0.05, x: 0, y: -(track / 2 - 0.022), z: wheelR, size: [0.07, 0.022] },
    { key: 'caster', name: 'caster', kg: 0.015, x: -wheelbase, y: 0, z: 0.012, size: [0.03, 0.03] },
    { key: 'battery', name: '2 × 18650', kg: 0.11, x: battX, y: 0, z: deck === 'low' ? plateZ - 0.014 : plateZ + 0.045, size: [0.077, 0.04] },
    { key: 'driver', name: 'motor driver', kg: 0.008, x: 0.02, y: 0.03, z: plateZ + 0.006, size: [0.02, 0.016] },
    { key: 'esp32', name: 'ESP32', kg: 0.01, x: -wheelbase + 0.035, y: 0.025, z: plateZ + 0.008, size: [0.052, 0.028] },
    { key: 'imu', name: 'IMU', kg: 0.003, x: imuX, y: imu === 'axle' ? 0 : -0.03, z: plateZ + 0.006, size: [0.02, 0.016] },
  ]
}

/** Load on the drive axle for a CoM at (x, h) with the caster `L` behind, accelerating at `a` (> 0 forward, < 0 braking). */
export const driveLoadN = (kg: number, x: number, h: number, L: number, a = 0) => (kg * (G * (x + L) - a * h)) / L

/** Perpendicular distance from (x, y) to the nearer side edge of the support triangle (wheels at ±t/2 on x = 0, caster at x = −L); < 0 outside. */
export function sideMargin(x: number, y: number, L: number, t: number) {
  const ex = L
  const ey = t / 2
  const n = Math.hypot(ex, ey)
  return (ey * (x + L) - ex * Math.abs(y)) / n
}

/** Balance of a layout: CoM, static drive-wheel share, traction and tip limits (m/s²), turn tip, IMU spin error. */
export function chassisBalance(parts: readonly ChassisPart[], wheelbase: number, mu = CHASSIS.mu) {
  const L = wheelbase
  const com = massCentre(parts)
  const y = massCentre(parts.map((p) => ({ kg: p.kg, x: p.y, z: 0 }))).x
  const { kg, x, z: h } = com
  const share = (x + L) / L
  const tip = tipAccels(x, h, -L, 0, 0)
  const accelSlip = (mu * G * (x + L)) / (L + mu * h)
  const brakeSlip = L > mu * h ? (mu * G * (x + L)) / (L - mu * h) : Infinity
  const noseOver = Math.max(0, -tip.nose)
  const side = sideMargin(x, y, L, CHASSIS.track)
  const turnTip = Math.max(0, (G * side) / h)
  const imu = parts.find((p) => p.key === 'imu')
  const imuR = imu ? Math.hypot(imu.x, imu.y) : 0
  const imuAccel = (TAU * CHASSIS.spinHz) ** 2 * imuR
  const stable = share > 0 && share < 1 && side > 0
  return {
    kg,
    x,
    y,
    h,
    share,
    stable,
    accel: Math.min(accelSlip, tip.wheelie),
    brake: Math.min(brakeSlip, noseOver),
    brakeBy: noseOver < brakeSlip ? ('tips' as const) : ('slips' as const),
    turnTip,
    turnSlip: mu * G,
    imuR,
    imuAccel,
    imuTiltDeg: (Math.atan2(imuAccel, G) * 180) / Math.PI,
  }
}

/** Accel and brake limits as the battery slides from `x0` to `x1` (n samples), the rest of the layout held. */
export function balanceSweep(deck: BattDeck, wheelbase: number, imu: ImuSpot, x0: number, x1: number, n = 41) {
  return Array.from({ length: n }, (_, i) => {
    const bx = x0 + ((x1 - x0) * i) / (n - 1)
    const b = chassisBalance(chassisLayout(bx, deck, wheelbase, imu), wheelbase)
    return { bx, accel: b.stable ? b.accel : 0, brake: b.stable ? b.brake : 0, share: b.share }
  })
}

// --- Cable routing ---

/** Motor lead: 2S pack, peak (stall) current, PWM edge time and frequency; I²C victim pair (SDA–GND) and glitch margin. Typical values. */
export const MOTOR_LEAD = { packV: 7.4, amps: 2.5, edgeS: 50e-9, pwmHz: 20e3, victimGap: 0.005, marginV: 0.4, besideFrac: 0.5, sclHz: 100e3, vdd: 3.3 }
export const HARNESS = {
  loose: { name: 'loose wires', gap: 0.012, pitch: 0 },
  paired: { name: 'side by side', gap: 0.0025, pitch: 0 },
  twisted: { name: 'twisted pair', gap: 0.0025, pitch: 0.02 },
}
export type Harness = keyof typeof HARNESS

const MU0_2PI = 2e-7

/** Mutual inductance per metre between a go/return pair `s` apart and a victim pair `g` apart, all in one plane, nearest wires `d` apart. */
export const flatMutual = (s: number, g: number, d: number) => MU0_2PI * (Math.log((d + g) / d) - Math.log((d + g + s) / (d + s)))

/** Fraction of the field left round a twisted pair at distance `r`, plus the leftover of the last half-twist over `len`. Estimate. */
export const twistResidual = (pitch: number, r: number, len: number) => (pitch > 0 ? Math.min(1, Math.exp((-TAU * r) / pitch) + pitch / (Math.PI * len)) : 1)

/** Spike coupled into the I²C pair at each PWM edge: v = M·len·dI/dt. */
export function couplingSpike(harness: Harness, sep: number, besideM: number) {
  const h = HARNESS[harness]
  const m = flatMutual(h.gap, MOTOR_LEAD.victimGap, sep) * besideM * twistResidual(h.pitch, sep + h.gap / 2, besideM)
  return { henries: m, volts: (m * MOTOR_LEAD.amps) / MOTOR_LEAD.edgeS }
}

export type RouteVerdict = 'ok' | 'glitch' | 'sag' | 'hot'

/** A motor lead of `gauge` AWG and `lengthM`, half of it running `sep` m beside the I²C wires. */
export function cableRoute(harness: Harness, sep: number, gauge: number, lengthM: number) {
  const run = runPoint(MOTOR_LEAD.packV, gauge, lengthM, MOTOR_LEAD.amps)
  const beside = lengthM * MOTOR_LEAD.besideFrac
  const spike = couplingSpike(harness, sep, beside)
  const dropFrac = run.drop / MOTOR_LEAD.packV
  const verdict: RouteVerdict = run.fused || run.tempC > 70 ? 'hot' : spike.volts > MOTOR_LEAD.marginV ? 'glitch' : dropFrac > 0.08 ? 'sag' : 'ok'
  return { run, beside, spike: spike.volts, henries: spike.henries, dropFrac, verdict }
}

/** SCL as the scope sees it at time `t`: a 3.3 V square wave plus a spike (`w` s wide, drawn) at each PWM edge, + on rising, − on falling. */
export function sclTrace(t: number, spikeV: number, w = 1e-6) {
  const { sclHz, pwmHz, vdd } = MOTOR_LEAD
  const base = (t * sclHz) % 1 < 0.5 ? vdd : 0
  const per = 1 / pwmHz
  const ph = ((t % per) + per) % per
  const near = (e: number) => Math.max(0, 1 - Math.abs(ph - e) / w)
  return base + spikeV * (near(0) + near(per) - near(per * 0.3))
}
