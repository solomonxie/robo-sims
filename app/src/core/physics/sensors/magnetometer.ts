// Magnetometer: Earth's field on three axes, atan2 heading, tilt compensation, declination, hard/soft-iron calibration.
import { DEG } from '../common'
import { Vec3 } from '../../fields'
import { gaussSolve } from '../../nodal'
import { MU_0 } from '../electromagnetism'
import { accelPitch } from '../mcu/i2c'
import { gaussAt } from '../mcu/adc'

const TAU = 2 * Math.PI

/** Field strength (µT), dip (°, + = field points down: northern hemisphere) and declination (°, + = magnetic north east of true). */
export const MAG_SITES = {
  london: { name: 'London', fUT: 49, dip: 66, decl: 1 },
  sf: { name: 'San Francisco', fUT: 48, dip: 61, decl: 13 },
  singapore: { name: 'Singapore', fUT: 41, dip: -17, decl: 0 },
  sydney: { name: 'Sydney', fUT: 57, dip: -64, decl: 13 },
}
export type MagSite = keyof typeof MAG_SITES

/** Earth's field in a level frame facing magnetic north: (north, west, up) in µT. */
export const earthField = (fUT: number, dipDeg: number): Vec3 => [fUT * Math.cos(dipDeg * DEG), 0, -fUT * Math.sin(dipDeg * DEG)]

/** World (north, west, up) vector seen by a body (X forward, Y left, Z up) turned to `yaw` (clockwise from north), pitched
 *  nose-up by `pitch` and rolled left-side-up by `roll` (rad), the same tilt convention as `tiltAccel`. */
export function toBody([n, w, u]: Vec3, yaw: number, pitch: number, roll = 0): Vec3 {
  const x = n * Math.cos(yaw) - w * Math.sin(yaw)
  const y = n * Math.sin(yaw) + w * Math.cos(yaw)
  const xp = x * Math.cos(pitch) + u * Math.sin(pitch)
  const zp = -x * Math.sin(pitch) + u * Math.cos(pitch)
  return [xp, y * Math.cos(roll) + zp * Math.sin(roll), -y * Math.sin(roll) + zp * Math.cos(roll)]
}
/** Undo pitch and roll: a body reading as a level sensor at the same heading would see it. */
export function toLevel([x, y, z]: Vec3, pitch: number, roll = 0): Vec3 {
  const yl = y * Math.cos(roll) - z * Math.sin(roll)
  const zp = y * Math.sin(roll) + z * Math.cos(roll)
  return [x * Math.cos(pitch) - zp * Math.sin(pitch), yl, x * Math.sin(pitch) + zp * Math.cos(pitch)]
}

export const wrap2pi = (a: number) => ((a % TAU) + TAU) % TAU
export const wrapPi = (a: number) => wrap2pi(a + Math.PI) - Math.PI
/** Heading clockwise from magnetic north for a level sensor (X forward, Y left): atan2(y, x). */
export const magHeading = ([x, y]: Vec3) => wrap2pi(Math.atan2(y, x))
/** Left-side-up roll from an accel reading. */
const accelRoll = ([, y, z]: Vec3) => Math.atan2(y, z)
/** Tilt-compensated heading: pitch and roll from the accelerometer level the magnetometer reading first. */
export const tiltCompHeading = (m: Vec3, accel: Vec3) => magHeading(toLevel(m, accelPitch(accel), accelRoll(accel)))
/** True (map) heading from a magnetic one. */
export const trueHeading = (magRad: number, declDeg: number) => wrap2pi(magRad + declDeg * DEG)

/** QMC5883L at ±2 G: 12 000 LSB per gauss = 120 LSB per µT; inputs past ±200 µT saturate. */
export const QMC5883L = { addr: 0x0d, lsbPerUT: 120, rangeUT: 200 }
const qmcClip = (v: Vec3): Vec3 => v.map((c) => Math.max(-QMC5883L.rangeUT, Math.min(QMC5883L.rangeUT, c))) as Vec3
export const qmcCounts = (v: Vec3): Vec3 => qmcClip(v).map((c) => Math.round(c * QMC5883L.lsbPerUT)) as Vec3

// --- Hard and soft iron: magnets and steel riding on the robot. ---

/** On-axis field (µT) of a magnet of moment `m` (A·m²) at `r` m: B = μ₀ m / 2π r³. */
export const dipoleAxisB = (m: number, r: number) => ((MU_0 * m) / (TAU * r ** 3)) * 1e6

/** Body-frame reading (µT): Earth turned into the body, X stretched by `soft` (steel), plus the `hard` offset (magnets that
 *  turn with the robot), noise `noiseUT` rms (sample `k`), clipped to the chip's range. */
export function ironReading(earth: Vec3, yaw: number, pitch: number, hard: Vec3, soft = 0, k = 0, noiseUT = 0): Vec3 {
  const b = toBody(earth, yaw, pitch)
  return qmcClip([b[0] * (1 + soft) + hard[0], b[1] + hard[1], b[2] + hard[2]].map((c, i) => c + noiseUT * gaussAt(3 * k + i)) as Vec3)
}

export type CalMotion = 'flat' | 'tumble'
/** Attitude `u` (0–1) through a calibration run: one flat turn, or five turns while pitching −75° → +75° (a tumble). */
export function calAttitude(motion: CalMotion, u: number) {
  if (motion === 'flat') return { yaw: TAU * u, pitch: 0 }
  return { yaw: 5 * TAU * u, pitch: 75 * DEG * (2 * u - 1) }
}

/** Least-squares circle through (x, y) points: x² + y² = 2ax + 2by + c. */
export function circleFit(pts: Vec3[]) {
  const rows = pts.map(([x, y]) => [2 * x, 2 * y, 1])
  const s = lsq(rows, pts.map(([x, y]) => x * x + y * y))
  const [a, b, c] = s ?? [0, 0, 0]
  return { centre: [a, b, 0] as Vec3, r: Math.sqrt(Math.max(0, c + a * a + b * b)) }
}
/** Least-squares sphere through 3D points: |p|² = 2 c·p + d. */
export function sphereFit(pts: Vec3[]) {
  const s = lsq(pts.map(([x, y, z]) => [2 * x, 2 * y, 2 * z, 1]), pts.map(([x, y, z]) => x * x + y * y + z * z))
  const [a, b, c, d] = s ?? [0, 0, 0, 0]
  return { centre: [a, b, c] as Vec3, r: Math.sqrt(Math.max(0, d + a * a + b * b + c * c)) }
}
function lsq(rows: number[][], rhs: number[]) {
  const m = rows[0].length
  const a = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)))
  return gaussSolve(a, Array.from({ length: m }, (_, i) => rows.reduce((s, r, k) => s + r[i] * rhs[k], 0)))
}
/** Per-axis (max + min) / 2: the quick centre most Arduino sketches use. */
export const minMaxCentre = (pts: Vec3[]): Vec3 =>
  [0, 1, 2].map((i) => (Math.max(...pts.map((p) => p[i])) + Math.min(...pts.map((p) => p[i]))) / 2) as Vec3

/** Worst heading error (rad) over a flat turn with `hard`/`soft` iron, after subtracting `fix`. */
export function worstHeadingError(earth: Vec3, hard: Vec3, soft: number, fix: Vec3 = [0, 0, 0], steps = 72) {
  let worst = 0
  for (let k = 0; k < steps; k++) {
    const yaw = (k * TAU) / steps
    const m = ironReading(earth, yaw, 0, hard, soft)
    worst = Math.max(worst, Math.abs(wrapPi(magHeading([m[0] - fix[0], m[1] - fix[1], 0]) - yaw)))
  }
  return worst
}
