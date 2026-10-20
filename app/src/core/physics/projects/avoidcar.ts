// Obstacle-avoiding car: the Robo-car with an HC-SR04 on an SG90 at its nose. Mounting (floor echoes, low obstacles),
// a look-both-ways state machine in the cluttered room, and stop tests against hard, soft, narrow and angled targets.
import { DEG, G } from '../common'
import { dividerOut } from '../circuits'
import { ESP32_ABS_MAX } from '../levels'
import { SERVO_DEG_PER_S } from '../mcu/pwm'
import { BUMP_BOT } from '../mechanics/collision'
import { AVOID, CLUTTER, avoidRun, sonarAt } from '../navigation/avoid'
import { Pose } from '../room'
import { HCSR04, Reflector, Sonar, THRESHOLD, arduinoCm, beamGain, echoSeconds, listen, spread, targetRefl } from '../sensors/ultrasonic'
import { pwmWheelSpeed } from './robocar'

const HALF = HCSR04.halfDeg * DEG

// --- Mount the sensor: height and tilt against floor echoes and low obstacles; the 5 V ECHO pin into a 3.3 V GPIO. ---

/** Rough floor backscatter (× sin of the grazing angle); scan steps and room temperature. */
export const SONAR_MOUNT = { floorK: 0.2, fromM: 1.5, toM: 0.05, stepM: 0.01, tempC: 20, slices: 16 }

export type MountTarget = 'wall' | 'box' | 'sill'
export const MOUNT_TARGETS: Record<MountTarget, { name: string; h: number; refl: number }> = {
  wall: { name: 'Wall', h: 0.3, refl: 1 },
  box: { name: 'Shoe box (10 cm)', h: 0.1, refl: targetRefl('cardboard') },
  sill: { name: 'Door sill (2 cm)', h: 0.02, refl: 0.8 },
}

/** Echo pin straight in, or through 1 kΩ / 2 kΩ: 5 V × 2/3. */
export const echoPinVolts = (divider: boolean) => (divider ? dividerOut(5, 1000, 2000) : 5)
export const echoPinSafe = (divider: boolean) => echoPinVolts(divider) <= ESP32_ABS_MAX

interface Heard {
  /** Range of the first echo heard, m (null = nothing). */
  m: number | null
  /** Strongest echo / threshold. */
  peak: number
}

/** Floor echo for a sensor `h` up, tilted `tiltDeg` nose-down: each floor patch scatters back ∝ sin(grazing) × beam gain² × spreading. */
export function floorEcho(h: number, tiltDeg: number): Heard {
  let m: number | null = null
  let peak = 0
  for (let x = 0.01; x <= HCSR04.maxM; x += 0.005) {
    const e = Math.atan2(h, x)
    const r = Math.hypot(h, x)
    const a = (SONAR_MOUNT.floorK * Math.sin(e) * beamGain(Math.abs(e - tiltDeg * DEG)) ** 2 * spread(2 * r)) / THRESHOLD
    peak = Math.max(peak, a)
    if (a >= 1 && m === null) m = r
  }
  return { m, peak }
}

/** Echo from an obstacle face `d` ahead, `H` tall. A face up to the sensor height mirrors the level ray straight back;
 *  a lower one only scatters back the slice of the beam it catches (like a thin post, but vertically). */
function faceEcho(h: number, tiltDeg: number, d: number, H: number, refl: number): Heard {
  const tilt = tiltDeg * DEG
  if (H >= h) {
    const a = (refl * beamGain(Math.abs(tilt)) ** 2 * spread(2 * d)) / THRESHOLD
    return { m: a >= 1 ? d : null, peak: a }
  }
  let sum = 0
  const dz = H / SONAR_MOUNT.slices
  for (let i = 0; i < SONAR_MOUNT.slices; i++) {
    const z = (i + 0.5) * dz
    const e = Math.atan2(h - z, d)
    const r = Math.hypot(d, h - z)
    sum += refl * beamGain(Math.abs(e - tilt)) ** 2 * spread(2 * r) * Math.min(1, dz / (2 * r * Math.tan(HALF)))
  }
  const a = sum / THRESHOLD
  return { m: a >= 1 ? Math.hypot(d, h - H) : null, peak: a }
}

type EchoSource = 'target' | 'floor' | 'none'
interface MountFrame {
  d: number
  /** What the sketch prints, cm (0 = timed out). */
  cm: number
  src: EchoSource
  target: number
  floor: number
}

/** Drive the sensor from 1.5 m up to 5 cm from `target`: the first echo heard wins (floor or target). */
export function mountScan(h: number, tiltDeg: number, target: MountTarget) {
  const T = MOUNT_TARGETS[target]
  const fl = floorEcho(h, tiltDeg)
  const frames: MountFrame[] = []
  const n = Math.round((SONAR_MOUNT.fromM - SONAR_MOUNT.toM) / SONAR_MOUNT.stepM)
  for (let i = 0; i <= n; i++) {
    const d = SONAR_MOUNT.fromM - i * SONAR_MOUNT.stepM
    const f = faceEcho(h, tiltDeg, d, T.h, T.refl)
    const src: EchoSource = f.m !== null && (fl.m === null || f.m <= fl.m) ? 'target' : fl.m !== null ? 'floor' : 'none'
    const m = src === 'target' ? f.m! : src === 'floor' ? fl.m! : null
    frames.push({ d, cm: m === null ? 0 : arduinoCm(echoSeconds(m, SONAR_MOUNT.tempC)), src, target: f.peak, floor: fl.peak })
  }
  const seen = frames.filter((f) => f.src === 'target')
  return { frames, floorM: fl.m, floorPeak: fl.peak, seenFromM: seen.length ? seen[0].d : null, lostAtM: seen.length ? seen[seen.length - 1].d : null }
}

// --- Reactive logic: drive, brake, swing the servo left and right, turn toward the clearer side (or always left). ---

export type LookPlan = 'left' | 'look'
export const LOOK_STATES = ['DRIVE', 'BRAKE', 'LOOK LEFT', 'LOOK RIGHT', 'BACK UP', 'TURN'] as const
type LookState = (typeof LOOK_STATES)[number]
/** Ping every 60 ms (HC-SR04 datasheet), servo ±70°, wait 0.1 s after a swing for the horn and echoes to settle. */
export const LOOK = { pingS: 0.06, lookDeg: 70, settleS: 0.1, brakeS: 0.2, backS: 0.4, clearK: 1.3, maxTurnS: 1.5, maxM: 2, duty: 0.6, seconds: 60, start: { x: 0.4, y: 1.0, th: 0.35 } as Pose }

/** Swing time of the SG90 at 5 V plus the settle wait. */
export const servoWaitS = (fromDeg: number, toDeg: number) => Math.abs(toDeg - fromDeg) / SERVO_DEG_PER_S + LOOK.settleS

interface LookFrame {
  state: LookState
  servo: number
  /** Last front, left and right readings, m. */
  front: number
  left: number
  right: number
  dir: number
}

/** The sketch as a state machine in the Navigation › Obstacle avoidance room, wheels at `duty` (Robo-car PWM speed). */
export function lookRun(plan: LookPlan, stopM: number, duty = LOOK.duty, room = CLUTTER) {
  const v = pwmWheelSpeed(duty)
  const every = Math.round(LOOK.pingS / AVOID.dt)
  const m = { state: 'DRIVE' as LookState, since: 0, servo: 0, aim: 0, front: LOOK.maxM, left: LOOK.maxM, right: LOOK.maxM, dir: 1, ready: 0 }
  const look: LookFrame[] = []
  const go = (s: LookState, t: number) => Object.assign(m, { state: s, since: t })
  const swing = (deg: number, t: number) => {
    m.ready = t + servoWaitS(m.servo, deg)
    m.servo = deg
  }
  const run = avoidRun(
    room,
    LOOK.start,
    (p, t, hit, i) => {
      const ping = i % every === 0 && t >= m.ready - 1e-9
      const read = () => sonarAt(room, p, m.servo * DEG, LOOK.maxM)
      if (hit && m.state === 'DRIVE') go('BRAKE', t)
      if (m.state === 'DRIVE' && ping) {
        m.front = read()
        if (m.front < stopM) go('BRAKE', t)
      } else if (m.state === 'BRAKE' && t - m.since >= LOOK.brakeS) {
        if (plan === 'left') {
          m.dir = 1
          go('TURN', t)
        } else {
          swing(LOOK.lookDeg, t)
          go('LOOK LEFT', t)
        }
      } else if (m.state === 'LOOK LEFT' && t >= m.ready - 1e-9) {
        m.left = read()
        swing(-LOOK.lookDeg, t)
        go('LOOK RIGHT', t)
      } else if (m.state === 'LOOK RIGHT' && t >= m.ready - 1e-9) {
        m.right = read()
        m.dir = m.left >= m.right ? 1 : -1
        swing(0, t)
        go(Math.max(m.left, m.right) < stopM ? 'BACK UP' : 'TURN', t)
      } else if (m.state === 'BACK UP' && t - m.since >= LOOK.backS) go('TURN', t)
      else if (m.state === 'TURN' && ping) {
        m.front = read()
        if (m.front > stopM * LOOK.clearK || t - m.since >= LOOK.maxTurnS) go('DRIVE', t)
      }
      look.push({ state: m.state, servo: m.servo, front: m.front, left: m.left, right: m.right, dir: m.dir })
      const s = m.state
      const [vL, vR] = s === 'DRIVE' ? [v, v] : s === 'BACK UP' ? [-v, -v] : s === 'TURN' ? [-m.dir * v, m.dir * v] : [0, 0]
      return { vL, vR, ranges: [m.front, m.left, m.right], rule: LOOK_STATES.indexOf(s) }
    },
    LOOK.seconds,
  )
  const turns = look.filter((f, k) => f.state === 'TURN' && look[k - 1]?.state !== 'TURN').length
  return { ...run, look, v, turns }
}

// --- Tune and test: drive at a target, ping, brake when the reading drops under the stop distance. ---

export type StopTarget = 'wall' | 'angled' | 'steep' | 'foam' | 'leg'
export const STOP_TARGETS: Record<StopTarget, { name: string; deg: number; refl: number; leg?: number }> = {
  wall: { name: 'Wall, head on', deg: 0, refl: 1 },
  angled: { name: 'Wall at 25°', deg: 25, refl: 1 },
  steep: { name: 'Wall at 45°', deg: 45, refl: 1 },
  foam: { name: 'Foam sofa', deg: 0, refl: targetRefl('foam') },
  leg: { name: 'Chair leg (25 mm)', deg: 0, refl: 1, leg: 0.025 },
}
/** Target 1.2 m ahead of the sensor; transducers 26 mm apart; tyres lock under brake (11) and skid at μg; bumper 1 cm ahead of the sensor, corners 8 cm either side. */
export const STOP_TEST = { startM: 1.2, canM: 0.013, dt: 0.002, seconds: 6, tempC: 20, bumperM: 0.01, halfW: 0.08 }

export const stopDecel = () => BUMP_BOT.mu * G

/** The target as reflectors: a wall through (x, 0) turned `deg` from square-on, or a post. */
function stopReflectors(target: StopTarget, x: number): Reflector[] {
  const T = STOP_TARGETS[target]
  if (T.leg) return [{ kind: 'post', at: { x, y: 0 }, width: T.leg, refl: T.refl, name: 'leg' }]
  const s = Math.sin(T.deg * DEG)
  const c = Math.cos(T.deg * DEG)
  return [{ kind: 'wall', a: { x: x - 2 * s, y: -2 * c }, b: { x: x + 2 * s, y: 2 * c }, refl: T.refl, name: 'wall' }]
}

/** One ping from a sensor at (sx, 0) facing +x: cm as `pulseIn / 58` (0 = no echo heard). */
export function stopPing(target: StopTarget, sx: number) {
  const tx: Sonar = { x: sx, y: STOP_TEST.canM, heading: 0 }
  const rx: Sonar = { x: sx, y: -STOP_TEST.canM, heading: 0 }
  const e = listen(tx, rx, stopReflectors(target, STOP_TEST.startM)).first
  return e ? arduinoCm(echoSeconds(e.path / 2, STOP_TEST.tempC)) : 0
}

interface ApproachFrame {
  t: number
  /** Sensor position, m from the start. */
  x: number
  v: number
  cm: number
  braking: boolean
}

/** `if (cm > 0 && cm < STOP) brake();` pinging every `pingS`. A missed echo reads 0 and is ignored. */
export function stopRun(target: StopTarget, duty: number, stopM: number, pingS: number) {
  const v0 = pwmWheelSpeed(duty)
  const a = stopDecel()
  const T = STOP_TARGETS[target]
  const hitX = STOP_TEST.startM - STOP_TEST.bumperM - (T.leg ? T.leg / 2 : STOP_TEST.halfW * Math.tan(T.deg * DEG))
  const frames: ApproachFrame[] = []
  let [x, v, cm, braking, crashed, nextPing] = [0, v0, 0, false, false, 0]
  let seenM: number | null = null
  let brakeX: number | null = null
  const n = Math.round(STOP_TEST.seconds / STOP_TEST.dt)
  for (let i = 0; i <= n; i++) {
    const t = i * STOP_TEST.dt
    if (!braking && !crashed && t >= nextPing - 1e-9) {
      nextPing += pingS
      cm = stopPing(target, x)
      if (cm > 0 && seenM === null) seenM = STOP_TEST.startM - x
      if (cm > 0 && cm < stopM * 100) {
        braking = true
        brakeX = x
      }
    }
    frames.push({ t, x, v, cm, braking })
    if (crashed || (braking && v === 0)) continue
    v = braking ? Math.max(0, v - a * STOP_TEST.dt) : v
    x += v * STOP_TEST.dt
    if (x >= hitX) {
      crashed = true
      x = hitX
    }
  }
  const impact = crashed ? frames.find((f) => f.x >= hitX)!.v : 0
  return { frames, v0, crashed, impact, gapM: hitX - x, seenM, brakeX, hitX }
}

/** Every target at one setting: the test sheet. */
export const stopSheet = (duty: number, stopM: number, pingS: number) =>
  (Object.keys(STOP_TARGETS) as StopTarget[]).map((k) => {
    const r = stopRun(k, duty, stopM, pingS)
    return { target: k, crashed: r.crashed, gapM: r.gapM, impact: r.impact, seenM: r.seenM }
  })
