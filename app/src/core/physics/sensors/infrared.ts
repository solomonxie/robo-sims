// Infrared reflective sensors: FC-51 obstacle module, TCRT5000 line array, 38 kHz receivers under sunlight.
import { Pose } from '../room'
import { fitDiode, ledStringAmps } from '../semiconductors'

/** 940 nm IR LED: ~1.2 V at 20 mA. */
const IR_LED = fitDiode(1.2)
export const IR_NM = 940

export const irLedAmps = (vcc: number, ohms: number) => ledStringAmps(vcc, ohms, IR_LED)

/** Diffuse IR reflectance (940 nm). */
export const SURFACES = { white: 0.85, grey: 0.35, black: 0.05 }
export type Surface = keyof typeof SURFACES

/** FC-51: 5 V, 150 Ω LED resistor, photodiode into 100 kΩ, LM393 against the trim pot. */
export const FC51 = { vcc: 5, ledOhms: 150, loadOhms: 100e3, gapCm: 1, k: 13.5e-3 }

/** Photocurrent from a diffuse target `cm` away: falls as 1/(d + gap)², ∝ LED current and reflectance. */
export const reflectedAmps = (cm: number, refl: number, ledA: number) => (refl * (ledA / 0.02) * FC51.k) / (cm + FC51.gapCm) ** 2

/** Photodiode node: Iph·R, pinned just under VCC. */
export const photoVolts = (amps: number, ohms = FC51.loadOhms, vcc = FC51.vcc) => Math.min(vcc - 0.1, amps * ohms)

/** One FC-51 reading; OUT is active low (LM393 pulls it down when the signal beats the pot). */
export function obstacleReading(cm: number, surface: Surface, thresholdV: number) {
  const ledA = irLedAmps(FC51.vcc, FC51.ledOhms)
  const pdA = reflectedAmps(cm, SURFACES[surface], ledA)
  const v = photoVolts(pdA)
  const blocked = v > thresholdV
  return { ledA, pdA, v, blocked, out: blocked ? 0 : 1 }
}

/** Furthest distance (cm) at which `surface` still trips the comparator. */
export function detectRange(surface: Surface, thresholdV: number) {
  const ledA = irLedAmps(FC51.vcc, FC51.ledOhms)
  const amps = thresholdV / FC51.loadOhms
  return Math.max(0, Math.sqrt((SURFACES[surface] * (ledA / 0.02) * FC51.k) / amps) - FC51.gapCm)
}

// --- Line follower: TCRT5000 array, weighted position, P steering. ---

/** 5 sensors at 15 mm pitch, 3 mm spot, 18 mm tape; phototransistor pulls a 10 kΩ pull-up down when lit. */
export const TCRT = { count: 5, pitchM: 0.015, spotM: 0.004, lineM: 0.018, vcc: 3.3, floor: 0.85, tape: 0.05 }

/** Share of a Gaussian spot over the tape when its centre is `offM` from the line centre. */
export function tapeCover(offM: number, lineM = TCRT.lineM, spotM = TCRT.spotM) {
  const erf = (x: number) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x))
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
    return x < 0 ? -y : y
  }
  const s = spotM * Math.SQRT2
  return (erf((lineM / 2 - offM) / s) + erf((lineM / 2 + offM) / s)) / 2
}

/** Analog TCRT5000 reading (ESP32 12-bit ADC): dark tape → high. */
export function tcrtAdc(offM: number) {
  const refl = TCRT.floor + (TCRT.tape - TCRT.floor) * tapeCover(offM)
  const v = TCRT.vcc * (1 - 0.92 * (refl / TCRT.floor))
  return Math.round(Math.max(0, Math.min(4095, (v / TCRT.vcc) * 4095)))
}

/** Sensor i's lateral offset from the bar centre (m), left negative. */
export const sensorX = (i: number) => (i - (TCRT.count - 1) / 2) * TCRT.pitchM

const WHITE_ADC = tcrtAdc(1)
const BLACK_ADC = tcrtAdc(0)
export const LOST = 0.08

/** Line position under the bar (m, + = line to the right); `digital` thresholds each sensor first. Null = no line seen. */
export function linePosition(adc: number[], digital: boolean): number | null {
  const w = adc.map((a) => {
    const f = Math.max(0, Math.min(1, (a - WHITE_ADC) / (BLACK_ADC - WHITE_ADC)))
    return digital ? (f > 0.5 ? 1 : 0) : f
  })
  const sum = w.reduce((a, b) => a + b, 0)
  if (sum < LOST) return null
  return w.reduce((a, wi, i) => a + wi * sensorX(i), 0) / sum
}


/** Closed test track (m): a lobed loop ~1.7 × 1 m. */
export function trackPoint(u: number) {
  const a = 2 * Math.PI * u
  const r = 1 + 0.18 * Math.sin(3 * a)
  return { x: 0.85 * r * Math.cos(a), y: 0.48 * r * Math.sin(a) }
}

const TRACK = Array.from({ length: 480 }, (_, i) => trackPoint(i / 480))

/** Signed distance from the track centreline (m, + = left of travel direction). */
export function trackOffset(x: number, y: number) {
  const N = TRACK.length
  let near = 0
  for (let i = 0, nd = Infinity; i < N; i += 8) {
    const d = (TRACK[i].x - x) ** 2 + (TRACK[i].y - y) ** 2
    if (d < nd) [nd, near] = [d, i]
  }
  let best = Infinity
  let sign = 1
  for (let k = -12; k <= 12; k++) {
    const a = TRACK[(near + k + N) % N]
    const b = TRACK[(near + k + 1 + N) % N]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
    const d = Math.hypot(x - a.x - u * dx, y - a.y - u * dy)
    if (d < best) {
      best = d
      sign = dx * (y - a.y) - dy * (x - a.x) >= 0 ? 1 : -1
    }
  }
  return sign * best
}

export const CAR = { trackM: 0.13, barM: 0.09 }
/** TT gear motors take ~80 ms to reach a new speed. */
const MOTOR_TAU = 0.08

/** Where sensor i sits on the floor. */
export function sensorAt(p: Pose, i: number) {
  const c = Math.cos(p.th)
  const s = Math.sin(p.th)
  const lat = -sensorX(i)
  return { x: p.x + c * CAR.barM - s * lat, y: p.y + s * CAR.barM + c * lat }
}

const readBar = (p: Pose) => Array.from({ length: TCRT.count }, (_, i) => {
  const s = sensorAt(p, i)
  return tcrtAdc(trackOffset(s.x, s.y))
})

export interface Follower {
  pose: Pose
  last: number
  err: number | null
  adc: number[]
  left: number
  right: number
}

export function startFollower(): Follower {
  const a = trackPoint(0)
  const b = trackPoint(0.002)
  const pose = { x: a.x, y: a.y, th: Math.atan2(b.y - a.y, b.x - a.x) }
  return { pose, last: 0, err: 0, adc: readBar(pose), left: 0, right: 0 }
}

/** One control tick: read the bar, P on the position error (m), wheels lag toward base ± turn. Lost → steer hard toward the last side. */
export function followStep(f: Follower, dt: number, speed: number, kp: number, digital: boolean): Follower {
  const adc = readBar(f.pose)
  const pos = linePosition(adc, digital)
  const e = pos ?? Math.sign(f.last || 1) * 2.5 * TCRT.pitchM
  const turn = Math.max(-1.5, Math.min(1.5, kp * e))
  const lag = Math.min(1, dt / MOTOR_TAU)
  const left = f.left + (speed * (1 + turn) - f.left) * lag
  const right = f.right + (speed * (1 - turn) - f.right) * lag
  const w = (left - right) / CAR.trackM
  const v = (left + right) / 2
  const h = f.pose.th - w * dt
  const pose = { x: f.pose.x + v * Math.cos(h) * dt, y: f.pose.y + v * Math.sin(h) * dt, th: h }
  return { pose, last: pos ?? f.last, err: pos, adc, left, right }
}

// --- Sunlight: DC photodiode vs a 38 kHz receiver (VS1838). ---

/** Photodiode: µA per klux of sunlight (IR share, filtered window) and signal at 1 m from a 100 mA remote LED. */
export const SUN = { uaPerKlux: 0.6, signalUaAt1m: 0.3, darkUa: 0.02, carrierHz: 38e3, pdOhms: 100e3, vcc: 3.3, thresholdV: 0.5 }

export const ambientAmps = (klux: number) => (SUN.darkUa + SUN.uaPerKlux * klux) * 1e-6
export const remoteAmps = (m: number) => (SUN.signalUaAt1m * 1e-6) / Math.max(0.05, m) ** 2

/** Plain photodiode + comparator: ambient adds straight to the signal. */
export function plainReceiver(klux: number, m: number) {
  const idle = photoVolts(ambientAmps(klux), SUN.pdOhms, SUN.vcc)
  const lit = photoVolts(ambientAmps(klux) + remoteAmps(m), SUN.pdOhms, SUN.vcc)
  const sees = lit > SUN.thresholdV
  const falseHit = idle > SUN.thresholdV
  return { idle, lit, swing: lit - idle, works: sees && !falseHit, falseHit }
}

/** VS1838: a 38 kHz band-pass drops the DC; AGC lifts the floor with the sunlight's shot noise (∝ √I). */
export const vs1838Floor = (klux: number) => 2e-9 * Math.sqrt(1 + ambientAmps(klux) / 0.1e-6)

export function modulatedReceiver(klux: number, m: number) {
  const floor = vs1838Floor(klux)
  const sig = remoteAmps(m)
  return { floor, sig, margin: sig / floor, works: sig > floor, rangeM: Math.sqrt((SUN.signalUaAt1m * 1e-6) / floor) }
}
