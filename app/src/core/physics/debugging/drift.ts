// Robot drifts: the robo-car told to drive straight curves (open-loop PWM: a slower motor, a lower PWM, a rubbing tyre,
// uneven weight), or its encoder odometry disagrees with the floor (wheel diameter, ticks per rev, track in the code).
import { G, memoize, once } from '../common'
import { DcMotor, GEARBOXES, RPM_PER_RADS, TT_CAR, TT_MOTOR, frictionNm, gearEfficiency, gearRatio, loadedSpeed, motorK, stallAmps } from '../actuators/dcmotor'
import { driverLoss } from '../actuators/hbridge'
import { diffStep } from '../mobility/diffdrive'
import { ROBOCAR, carPower } from '../projects/robocar'
import { Pose } from '../room'
import { ENCODERS, TT_TRACK_M, TT_WHEEL_MM, ticksPerWheelRev } from '../sensors/encoder'
import { MeterRead, huntOf } from './hunt'

/** Arduino's integer map(). */
export const inoMap = (x: number, inLo: number, inHi: number, outLo: number, outHi: number) => Math.trunc(((x - inLo) * (outHi - outLo)) / (inHi - inLo)) + outLo

/** The robo-car (2S, DRV8833, TT 1:48) driving drive(70, 70): map(70, 0, 100, 0, 255) on each side's LEDC channel. Faults:
 *  the right motor's back-EMF constant 10 % high (TT motors spread that much), a copy-pasted map(…, 230) on the right,
 *  the right tyre rubbing a chassis screw (`rubNm` at the wheel), the battery strapped over the right wheel (65 % of the
 *  rolling load). The test: drive for the time a matched car takes to cover `runM`, measure the offset from the tape. */
export const DRIFT_BOT = { speed: 70, top: 255, badTop: 230, slowK: 1.1, rubNm: 0.011, heavyShare: 0.65, runM: 1, samples: 60 }
const packV = once(() => carPower('li2').cruise.packV)

/** One TT wheel behind the DRV8833 at PWM `duty`: average volts at the motor, its current, wheel rpm and ground speed.
 *  `share` = this wheel's part of the car's rolling load (0 = wheels up on a block), `rubNm` = extra drag at the wheel. */
export function driftWheel(duty: number, { motor = TT_MOTOR, rubNm = 0, share = 0.5 }: { motor?: DcMotor; rubNm?: number; share?: number } = {}, vpack = packV()) {
  const g = GEARBOXES.tt48
  const n = gearRatio(g)
  const loadNm = (TT_CAR.massKg * G * TT_CAR.crr * share * TT_CAR.wheelM + rubNm) / (n * gearEfficiency(g))
  let amps = 0
  let volts = duty * vpack
  let radS = 0
  for (let k = 0; k < 12; k++) {
    volts = driverLoss(ROBOCAR.driver, amps, duty * vpack).motorV
    radS = loadedSpeed(volts, loadNm, motor)
    amps = radS > 0 ? (loadNm + frictionNm(motor)) / motorK(motor) : stallAmps(volts, motor)
  }
  return { volts, amps, rpm: (radS / n) * RPM_PER_RADS, speed: (radS / n) * TT_CAR.wheelM }
}

/** Exact poses (from the origin, heading +x) at `samples` + 1 even times over `seconds` at constant wheel speeds. */
export function driftPath(vL: number, vR: number, seconds: number, track = TT_TRACK_M, samples = DRIFT_BOT.samples): Pose[] {
  const o: Pose = { x: 0, y: 0, th: 0 }
  return Array.from({ length: samples + 1 }, (_, i) => diffStep(o, vL, vR, track, (seconds * i) / samples))
}

const mm = (value: number): MeterRead => ({ value, unit: 'mm' })
/** A floor run read by eye: start alignment and the floor spread a few cm, so only straight vs curving (and which way) counts. */
const trailRead = (offsetMm: number): MeterRead => ({ value: offsetMm, unit: 'log', label: Math.abs(offsetMm) < 10 ? 'straight' : offsetMm > 0 ? 'veers R' : 'veers L' })

// --- Motor mismatch: open-loop drive(70, 70), the car curves right ---

export const MISMATCH_FAULTS = {
  motor: { name: 'Right motor slower' },
  pwm: { name: 'Right PWM mapped lower' },
  rub: { name: 'Right tyre rubbing' },
  weight: { name: 'Battery off-centre' },
}
export type MismatchFault = keyof typeof MISMATCH_FAULTS
export type MismatchProbe = 'trail' | 'up' | 'volts' | 'amps'
export const MISMATCH_PROBES: Record<MismatchProbe, { name: string }> = {
  trail: { name: 'Tape run' },
  up: { name: 'Wheels up, R' },
  volts: { name: 'R motor V' },
  amps: { name: 'R motor A' },
}

/** Both sides' PWM, the right wheel on the floor and wheels up (left is always healthy), the timed run and the readings:
 *  straight or curving (by eye), right wheel rpm on a block, average volts across and current through the right motor. */
export const motorMismatch = memoize((f: MismatchFault | 'ok') => {
  const B = DRIFT_BOT
  const pwm = [inoMap(B.speed, 0, 100, 0, B.top), inoMap(B.speed, 0, 100, 0, f === 'pwm' ? B.badTop : B.top)] as const
  const duty = [pwm[0] / 255, pwm[1] / 255] as const
  const right = { motor: f === 'motor' ? { ...TT_MOTOR, voltsPerRpm: TT_MOTOR.voltsPerRpm * B.slowK } : TT_MOTOR, rubNm: f === 'rub' ? B.rubNm : 0 }
  const share = f === 'weight' ? [1 - B.heavyShare, B.heavyShare] : [0.5, 0.5]
  const floor = [driftWheel(duty[0], { share: share[0] }), driftWheel(duty[1], { ...right, share: share[1] })] as const
  const up = [driftWheel(duty[0], { share: 0 }), driftWheel(duty[1], { ...right, share: 0 })] as const
  const seconds = B.runM / driftWheel(inoMap(B.speed, 0, 100, 0, B.top) / 255).speed
  const path = driftPath(floor[0].speed, floor[1].speed, seconds)
  const end = path[path.length - 1]
  const reads: Record<MismatchProbe, MeterRead> = {
    trail: trailRead(-end.y * 1000),
    up: { value: up[1].rpm, unit: 'rpm' },
    volts: { value: up[1].volts, unit: 'V' },
    amps: { value: up[1].amps, unit: 'A' },
  }
  return { pwm, duty, floor, up, seconds, path, end, reads }
})

export const MISMATCH_HUNT = huntOf(MISMATCH_FAULTS, MISMATCH_PROBES, (f, p) => motorMismatch(f).reads[p])

// --- Wheel size error: drive 1 m and spin 360° by encoder odometry, measure what really happened ---

/** 65 mm TT wheels, Hall encoders (11 PPR × 4 on the motor, 1:48 → 2112 ticks per wheel turn), 130 mm track. Faults: the
 *  right tyre worn / a different wheel (63 mm), 70 mm in the code, 1:120 motors with 1:48's ticks in the code, 150 mm
 *  track in the code. Driving straight, a loop keeps the two encoders' ticks equal and stops at `runM` by odometry. */
export const ODO_BOT = { smallMm: 63, codeMm: 70, codeTrackM: 0.15, runM: 1, samples: 60 }
export const tprOf = (gear: number) => ticksPerWheelRev(ENCODERS.hall.ppr, 4, gear)

interface OdoSetup {
  /** Real tyre diameters (mm) and ticks per wheel turn; real track (m). */
  leftMm: number
  rightMm: number
  tpr: number
  trackM: number
  /** What the code assumes. */
  codeMm: number
  codeTpr: number
  codeTrackM: number
}

/** Encoder-matched straight drive until odometry reads `distM`: ticks per wheel, real wheel travels, the path, the end. */
function odoDrive(s: OdoSetup, distM: number, samples = ODO_BOT.samples) {
  const tickM = (Math.PI * s.codeMm) / 1000 / s.codeTpr
  const ticks = Math.ceil(distM / tickM - 1e-9)
  const revs = ticks / s.tpr
  const dL = (revs * Math.PI * s.leftMm) / 1000
  const dR = (revs * Math.PI * s.rightMm) / 1000
  const path = driftPath(dL, dR, 1, s.trackM, samples)
  const end = path[path.length - 1]
  return { ticks, odoM: ticks * tickM, dL, dR, path, end, offsetMm: -end.y * 1000, tapeMm: Math.hypot(end.x, end.y) * 1000 }
}

/** Spin in place (equal and opposite ticks) until odometry reads `turns` × 360°: the real heading change (°) and its
 *  run from start to stop (`samples` + 1 values, real vs odometry). */
function odoSpin(s: OdoSetup, turns = 1, samples = ODO_BOT.samples) {
  const tickM = (Math.PI * s.codeMm) / 1000 / s.codeTpr
  const ticks = Math.ceil((turns * Math.PI * s.codeTrackM) / tickM - 1e-9)
  const revs = ticks / s.tpr
  const realDeg = ((revs * Math.PI * (s.leftMm + s.rightMm)) / 1000 / s.trackM) * (180 / Math.PI)
  const odoDeg = ((2 * ticks * tickM) / s.codeTrackM) * (180 / Math.PI)
  const at = (k: number) => k / samples
  return { ticks, realDeg, odoDeg, real: Array.from({ length: samples + 1 }, (_, i) => realDeg * at(i)), odo: Array.from({ length: samples + 1 }, (_, i) => odoDeg * at(i)) }
}

export const WHEELSIZE_FAULTS = {
  tyre: { name: 'Right tyre smaller' },
  dia: { name: 'Wrong Ø in code' },
  gear: { name: 'Wrong ticks per rev' },
  track: { name: 'Wrong track in code' },
}
export type WheelSizeFault = keyof typeof WHEELSIZE_FAULTS
export type WheelSizeProbe = 'trail' | 'tape' | 'tyre' | 'ticks' | 'spin'
export const WHEELSIZE_PROBES: Record<WheelSizeProbe, { name: string }> = {
  trail: { name: 'Tape run' },
  tape: { name: 'Distance' },
  tyre: { name: 'R tyre Ø' },
  ticks: { name: 'Ticks / turn' },
  spin: { name: '360° spin' },
}

export function odoSetup(f: WheelSizeFault | 'ok'): OdoSetup {
  const tpr = tprOf(gearRatio(GEARBOXES.tt48))
  return {
    leftMm: TT_WHEEL_MM,
    rightMm: f === 'tyre' ? ODO_BOT.smallMm : TT_WHEEL_MM,
    tpr: f === 'gear' ? tprOf(gearRatio(GEARBOXES.tt120)) : tpr,
    trackM: TT_TRACK_M,
    codeMm: f === 'dia' ? ODO_BOT.codeMm : TT_WHEEL_MM,
    codeTpr: tpr,
    codeTrackM: f === 'track' ? ODO_BOT.codeTrackM : TT_TRACK_M,
  }
}

/** The 1 m drive and the 360° spin by odometry, the right wheel's ticks per metre, and the readings (`ticks` = the right
 *  wheel turned once by hand, counted on the serial monitor). */
export const wheelSizeError = memoize((f: WheelSizeFault | 'ok') => {
  const s = odoSetup(f)
  const drive = odoDrive(s, ODO_BOT.runM)
  const spin = odoSpin(s)
  const ticksPerM = s.tpr / ((Math.PI * s.rightMm) / 1000)
  const reads: Record<WheelSizeProbe, MeterRead> = {
    trail: trailRead(drive.offsetMm),
    tape: mm(drive.tapeMm),
    tyre: mm(s.rightMm),
    ticks: { value: s.tpr, unit: 'cnt', label: '' },
    spin: { value: spin.realDeg, unit: '°' },
  }
  return { setup: s, drive, spin, ticksPerM, reads }
})

export const WHEELSIZE_HUNT = huntOf(WHEELSIZE_FAULTS, WHEELSIZE_PROBES, (f, p) => wheelSizeError(f).reads[p])
