// Robo-car project: the Chassis design layout built as a 2WD car (TT motors, DRV8833, LM2596 to 5 V, ESP32 DevKit),
// then powered, wired, driven by PWM and steered from a phone over a WebSocket.
import { clamp } from '../common'
import { Pose } from '../room'
import { CHEMISTRIES, ChemistryId, openCircuitVolts } from '../power/batteries'
import { WIFI_PEAK_A, packRuntime, sagged } from '../power/budget'
import { LM2596, dcdcPoint } from '../power/converters'
import { ESP32_BOD } from '../power/brownout'
import { AMS1117_33, dropoutVolts } from '../regulators'
import { driverLoss } from '../actuators/hbridge'
import { GEARBOXES, wheelDrive } from '../actuators/dcmotor'
import { CHASSIS, chassisLayout } from '../materials/chassis'
import { diffForward, diffStep } from '../mobility/diffdrive'
import { slewStep, stickToWheels } from '../software/remote'

/** The car: Chassis design layout (battery 40 mm behind the axle, 110 mm wheelbase), DRV8833, ESP32 drawing 120 mm A on Wi-Fi. */
export const ROBOCAR = { wheelbase: 0.11, battX: -0.04, wiringOhms: 0.05, logicA: 0.12, rail: 5, soc: 0.8, driver: 'drv8833' as const }
export const robocarParts = () => chassisLayout(ROBOCAR.battX, 'low', ROBOCAR.wheelbase, 'axle')

// --- Chassis & power: pack → switch → DRV8833 (motors) and LM2596 → 5 V → ESP32 (AMS1117 → 3.3 V) ---

export type CarPack = 'aa4' | 'nimh4' | 'li1' | 'li2'
export const CAR_PACKS: Record<CarPack, { name: string; chem: ChemistryId; series: number }> = {
  aa4: { name: '4 × AA alkaline', chem: 'alkaline', series: 4 },
  nimh4: { name: '4 × AA NiMH', chem: 'nimh', series: 4 },
  li1: { name: '1 × 18650', chem: 'liion', series: 1 },
  li2: { name: '2 × 18650 (2S)', chem: 'liion', series: 2 },
}

/** Volts left for one motor and its current at pack `vpack`, cruising on the floor (driver drop and motor current agree). */
function cruiseMotor(vpack: number) {
  let amps = 0
  let motorV = vpack
  for (let k = 0; k < 8; k++) {
    amps = wheelDrive(motorV, GEARBOXES.tt48, 0).amps
    motorV = driverLoss(ROBOCAR.driver, amps, vpack).motorV
  }
  return { amps, motorV, speed: wheelDrive(motorV, GEARBOXES.tt48, 0).speed }
}
/** One stalled TT motor behind the DRV8833 (e.g. the first instant of a start). */
const stallMotorAmps = (vpack: number) => vpack / (5 + 0.36)

/** 5 V rail from the buck and the ESP32's 3.3 V after its AMS1117 at `logicA`. */
function logicRail(vpack: number, logicA: number) {
  const buck = dcdcPoint(LM2596, vpack, ROBOCAR.rail, logicA)
  const railV = buck.limit === 'off' ? 0 : buck.vout
  const mcuV = Math.max(0, Math.min(AMS1117_33.vout, railV - dropoutVolts(AMS1117_33, logicA)))
  return { buck, railV, mcuV, iin: buck.iin }
}

type PowerVerdict = 'ok' | 'noLogic' | 'resets' | 'dips' | 'slow'

/** The whole power tree for a pack at state of charge `soc`: cruising (Wi-Fi average) and a hard start (both motors stalled, Wi-Fi burst). */
export function carPower(pack: CarPack, soc = ROBOCAR.soc) {
  const P = CAR_PACKS[pack]
  const c = CHEMISTRIES[P.chem]
  const ocv = P.series * openCircuitVolts(c, soc)
  const ohms = P.series * c.cell.ohms + ROBOCAR.wiringOhms
  const cruiseV = sagged(ocv, ohms, (v) => 2 * cruiseMotor(v).amps + logicRail(v, ROBOCAR.logicA).iin)
  const m = cruiseMotor(cruiseV)
  const lc = logicRail(cruiseV, ROBOCAR.logicA)
  const cruise = { packV: cruiseV, ...m, railV: lc.railV, mcuV: lc.mcuV, packA: 2 * m.amps + lc.iin, watts: cruiseV * (2 * m.amps + lc.iin) }
  const stallV = sagged(ocv, ohms, (v) => 2 * stallMotorAmps(v) + logicRail(v, WIFI_PEAK_A).iin)
  const ls = logicRail(stallV, WIFI_PEAK_A)
  const stall = { packV: stallV, motorA: stallMotorAmps(stallV), railV: ls.railV, mcuV: ls.mcuV, resets: ls.mcuV < ESP32_BOD[0] }
  const hours = packRuntime(c, P.series, 1, cruise.watts).hours
  const verdict: PowerVerdict = lc.mcuV < AMS1117_33.vout - 0.05 ? 'noLogic' : stall.resets ? 'resets' : stall.mcuV < AMS1117_33.vout - 0.05 ? 'dips' : m.speed < 0.3 ? 'slow' : 'ok'
  return { pack, ocv, ohms, grams: P.series * c.cell.grams, cruise, stall, hours, verdict }
}

// --- Wire the motor driver: ESP32 GPIOs → DRV8833 IN pins → motor modes, and the classic wiring faults ---

export type DrvMode = 'coast' | 'forward' | 'reverse' | 'brake'
/** DRV8833 per channel: IN1 IN2 = 10 forward, 01 reverse, 11 brake (both low sides on), 00 coast (outputs off). */
export const drvMode = (in1: boolean, in2: boolean): DrvMode => (in1 ? (in2 ? 'brake' : 'forward') : in2 ? 'reverse' : 'coast')
const MODE_DIR: Record<DrvMode, number> = { forward: 1, reverse: -1, brake: 0, coast: 0 }

export type CarCmd = 'forward' | 'reverse' | 'left' | 'spin' | 'brake' | 'coast'
/** [AIN1, AIN2, BIN1, BIN2] for each command. */
export const CAR_CMDS: Record<CarCmd, { name: string; ins: [boolean, boolean, boolean, boolean] }> = {
  forward: { name: 'Forward', ins: [true, false, true, false] },
  reverse: { name: 'Reverse', ins: [false, true, false, true] },
  left: { name: 'Turn left (right wheel only)', ins: [false, false, true, false] },
  spin: { name: 'Spin right on the spot', ins: [true, false, false, true] },
  brake: { name: 'Brake (11)', ins: [true, true, true, true] },
  coast: { name: 'Coast (00)', ins: [false, false, false, false] },
}

export type WireFault = 'ok' | 'noGround' | 'swapped' | 'inputOnly'
export const WIRE_FAULTS: Record<WireFault, { name: string }> = {
  ok: { name: 'Wired right' },
  noGround: { name: 'No common ground' },
  swapped: { name: 'Right motor leads swapped' },
  inputOnly: { name: 'BIN1 on GPIO 34' },
}

/** What the driver sees and what the wheels do for a command under a wiring fault. Without a shared ground the IN pins
 *  have no reference and the DRV8833's pull-downs hold them low; GPIO 34 can't drive, so BIN1 stays low. */
export function wiredDrive(cmd: CarCmd, fault: WireFault, speed = carPower('li2').cruise.speed) {
  const ins = CAR_CMDS[cmd].ins
  const seen: [boolean, boolean, boolean, boolean] = fault === 'noGround' ? [false, false, false, false] : fault === 'inputOnly' ? [ins[0], ins[1], false, ins[3]] : [...ins]
  const modes: [DrvMode, DrvMode] = [drvMode(seen[0], seen[1]), drvMode(seen[2], seen[3])]
  const dirs: [number, number] = [MODE_DIR[modes[0]], MODE_DIR[modes[1]] * (fault === 'swapped' ? -1 : 1)]
  const want: [number, number] = [MODE_DIR[drvMode(ins[0], ins[1])], MODE_DIR[drvMode(ins[2], ins[3])]]
  const tw = diffForward(dirs[0] * speed, dirs[1] * speed, CHASSIS.track)
  return { ins, seen, modes, dirs, ok: dirs[0] === want[0] && dirs[1] === want[1], v: tw.v, w: tw.w }
}

// --- Drive with ESP32: LEDC PWM on the IN pins, a timed square, a weaker right motor and a trim ---

/** Right TT motor 6 % slower than the left at the same volts (typical spread); the spin time in the sketch is tuned at 70 %. */
export const DRIVE = { weak: 0.06, fwdS: 1.5, legs: 4, tunedDuty: 0.7, dt: 0.01, rest: 0.4 }
const PACK_V = () => carPower('li2').cruise.packV

/** Ground speed of a wheel at PWM `duty` (average volts = duty × pack, minus the driver drop); 0 below the start threshold. */
export function pwmWheelSpeed(duty: number, weak = 0, vpack = PACK_V()) {
  const d = clamp(duty, 0, 1)
  return cruiseMotor(d * vpack).speed * (1 - weak)
}
/** Lowest duty (1 % steps) that moves the car. */
export function startDuty(vpack = PACK_V()) {
  for (let d = 0; d <= 100; d++) if (pwmWheelSpeed(d / 100, 0, vpack) > 0) return d / 100
  return 1
}
/** Spin delay (ms, 10 ms steps) that turns 90° at the tuned duty with matched motors. */
export const spinMs = () => Math.round(((Math.PI / 2) * (CHASSIS.track / 2)) / pwmWheelSpeed(DRIVE.tunedDuty) / 0.01) * 10

interface PwmSquareFrame extends Pose {
  t: number
  leg: number
  spinning: boolean
  l: number
  r: number
  dL: number
  dR: number
}
/** The sketch: drive(duty, duty × (1 + trim)) for 1.5 s, spin left for `spinMs`, four times. */
export function pwmSquareRun(duty: number, trim: number) {
  const spinS = spinMs() / 1000
  const l = clamp(duty, 0, 1)
  const r = clamp(duty * (1 + trim), 0, 1)
  const vL = pwmWheelSpeed(l)
  const vR = pwmWheelSpeed(r, DRIVE.weak)
  const legS = DRIVE.fwdS + spinS
  const seconds = DRIVE.legs * legS
  const frames: PwmSquareFrame[] = []
  let p: Pose = { x: 0, y: 0, th: 0 }
  let dL = 0
  let dR = 0
  const n = Math.round(seconds / DRIVE.dt)
  for (let i = 0; i <= n; i++) {
    const t = i * DRIVE.dt
    const leg = Math.min(DRIVE.legs - 1, Math.floor(t / legS + 1e-9))
    const spinning = t - leg * legS >= DRIVE.fwdS - 1e-9 && i < n
    const [a, b] = spinning ? [-vL, vR] : [vL, vR]
    frames.push({ t, leg, spinning, l: spinning ? -l : l, r, dL, dR, ...p })
    if (i === n) break
    p = diffStep(p, a, b, CHASSIS.track, DRIVE.dt)
    dL += a * DRIVE.dt
    dR += b * DRIVE.dt
  }
  const firstLeg = frames[Math.round(DRIVE.fwdS / DRIVE.dt)]
  const end = frames[frames.length - 1]
  return {
    frames,
    seconds,
    spinS,
    vL,
    vR,
    side: firstLeg.x,
    driftM: firstLeg.y,
    turnDeg: (frames[Math.round(legS / DRIVE.dt)].th * 180) / Math.PI,
    missM: Math.hypot(end.x, end.y),
  }
}

// --- Phone remote: browser joystick → WebSocket JSON at 20 Hz → arcade mix → drive(); the phone locks mid-drive ---

export const PHONE_CAR = { dt: 0.01, seconds: 8, hz: 20, oneWayS: 0.02, dz: 0.08, lockAt: 4.4, wallX: 1.6, halfLen: 0.08, slewPerS: 3, brakeS: 0.15 }

/** Driver's thumb [x right, y forward]: ease off, a nudge left, then hold forward as the phone screen locks. */
function phoneThumb(t: number): [number, number] {
  if (t < 0.4) return [0.04, 0.05]
  if (t < 1.8) return [0, 0.7]
  if (t < 2.4) return [0.04, 0.05]
  if (t < 3) return [-0.16, 0.55]
  if (t < 3.6) return [0.16, 0.55]
  return [0, 0.6]
}
export const phoneJson = (x: number, y: number) => `{"x":${x.toFixed(2)},"y":${y.toFixed(2)}}`

interface PhoneFrame extends Pose {
  t: number
  sx: number
  sy: number
  wl: number
  wr: number
  age: number
  sending: boolean
  failsafe: boolean
  crashed: boolean
}

/** Robot keeps the newest command; with `timeoutS` > 0 it stops when none arrived for that long. `cap` scales full stick. */
export function phoneCarRun(timeoutS: number, cap: number) {
  const vMax = carPower('li2').cruise.speed
  const period = 1 / PHONE_CAR.hz
  const frames: PhoneFrame[] = []
  const sent: { t: number; x: number; y: number }[] = []
  let p: Pose = { x: 0, y: 0, th: 0 }
  let w = [0, 0]
  let target = [0, 0]
  let lastRx = 0
  let nextSend = 0
  let crashed = false
  let stoppedAt = Infinity
  for (let i = 0; i <= Math.round(PHONE_CAR.seconds / PHONE_CAR.dt); i++) {
    const t = i * PHONE_CAR.dt
    const [sx, sy] = phoneThumb(t)
    const sending = t < PHONE_CAR.lockAt
    if (sending && t >= nextSend - 1e-9) {
      sent.push({ t, x: sx, y: sy })
      nextSend += period
    }
    for (const m of sent) if (m.t + PHONE_CAR.oneWayS <= t + 1e-9 && m.t + PHONE_CAR.oneWayS > t - PHONE_CAR.dt + 1e-9) {
      target = stickToWheels(m.x, m.y, { dz: PHONE_CAR.dz, expo: 0 }).map((v) => v * cap)
      lastRx = t
    }
    const age = t - lastRx
    const failsafe = timeoutS > 0 && age > timeoutS
    const goal = failsafe || crashed ? [0, 0] : target
    w = w.map((v, k) => slewStep(v, goal[k], (failsafe ? 1 / PHONE_CAR.brakeS : PHONE_CAR.slewPerS) * PHONE_CAR.dt))
    if (failsafe && stoppedAt === Infinity && w[0] === 0 && w[1] === 0) stoppedAt = t
    frames.push({ t, sx, sy, wl: w[0], wr: w[1], age, sending, failsafe, crashed, ...p })
    p = diffStep(p, w[0] * vMax, w[1] * vMax, CHASSIS.track, PHONE_CAR.dt)
    if (!crashed && p.x + PHONE_CAR.halfLen >= PHONE_CAR.wallX) {
      p = { ...p, x: PHONE_CAR.wallX - PHONE_CAR.halfLen }
      crashed = true
      w = [0, 0]
    }
  }
  const lock = frames[Math.round(PHONE_CAR.lockAt / PHONE_CAR.dt)]
  const end = frames[frames.length - 1]
  return { frames, sent, vMax, crashed, blindM: Math.hypot(end.x - lock.x, end.y - lock.y), stoppedAt, gapM: PHONE_CAR.wallX - PHONE_CAR.halfLen - end.x }
}
