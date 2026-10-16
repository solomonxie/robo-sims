// Line following: the error a TCRT5000 bar reads, PD steering round a course, counting and turning at intersections.
import { clamp } from '../common'
import { diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { TT_TRACK_M } from '../sensors/encoder'
import { CAR, TCRT, darkness, linePosition, readBar, sensorX, tcrtAdc } from '../sensors/infrared'
import { DRIVE_TASK, wheelLag, wheelSpeedSs } from './loop'
import { PID_MEM0, PidMem, pidTick } from './pid'

// --- Error from sensors: a jig sweeps the tape under the bar. ---

interface SweepPoint {
  off: number
  adc: number[]
  pos: number | null
}

/** Readings and line position for the tape `off` metres right of the bar centre. */
export function barAt(off: number, pitchM: number, count: number, digital: boolean): SweepPoint {
  const adc = Array.from({ length: count }, (_, i) => tcrtAdc(off - sensorX(i, pitchM, count)))
  return { off, adc, pos: linePosition(adc, digital, pitchM) }
}

/** Half-span (m) of a sweep: the bar plus 25 mm each side. */
export const sweepHalf = (pitchM: number, count: number) => ((count - 1) / 2) * pitchM + 0.025

export function errorSweep(pitchM: number, count: number, digital: boolean, steps = 241) {
  const half = sweepHalf(pitchM, count)
  return Array.from({ length: steps }, (_, k) => barAt(-half + (2 * half * k) / (steps - 1), pitchM, count, digital))
}

/** Tracking range (within `tol` of the truth, out from the centre), where the line is lost past the ends, total width of blind gaps between sensors, distinct readings. */
export function sweepStats(sw: SweepPoint[], tol = 0.003) {
  const mid = (sw.length - 1) / 2
  let range = 0
  for (let k = 0; k <= mid; k++) {
    const pair = [sw[mid + k], sw[mid - k]]
    if (pair.some((p) => p.pos === null || Math.abs(p.pos - p.off) > tol)) break
    range = Math.abs(sw[mid + k].off)
  }
  const first = sw.findIndex((p) => p.pos !== null)
  const last = sw.length - 1 - [...sw].reverse().findIndex((p) => p.pos !== null)
  const outside = sw.filter((p, k) => p.pos === null && (k < first || k > last)).map((p) => Math.abs(p.off))
  const blind = sw.filter((p, k) => p.pos === null && k > first && k < last).length
  const levels = new Set(sw.filter((p) => p.pos !== null).map((p) => Math.round(p.pos! * 1e4))).size
  const step = sw.length > 1 ? sw[1].off - sw[0].off : 0
  return { range, lostAt: outside.length ? Math.min(...outside) : null, blindM: blind * step, levels }
}

// --- Courses: tape strips as polylines. ---

export type Tape = [number, number][]

const segDist = (x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const dx = bx - ax
  const dy = by - ay
  const u = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(x - ax - u * dx, y - ay - u * dy)
}

/** Distance (m) from (x, y) to the nearest tape centreline. */
export const tapeDist = (tapes: Tape[], x: number, y: number) =>
  Math.min(...tapes.map((t) => t.slice(1).reduce((d, b, i) => Math.min(d, segDist(x, y, t[i], b)), Infinity)))

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 16): Tape =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  })

/** PD course: straight, a 90° left bend of radius `r`, short straight, 90° right bend, straight. */
export function sCourse(r = 0.12): Tape[] {
  const x1 = 0.55
  const y2 = r + 0.12
  return [[[-0.15, 0], [x1, 0], ...arc(x1, r, r, -Math.PI / 2, 0).slice(1), [x1 + r, y2], ...arc(x1 + 2 * r, y2, r, Math.PI, Math.PI / 2).slice(1), [x1 + 2 * r + 0.6, y2 + r]]]
}

// --- PD steering: the bar 9 cm ahead feeds a PD; turn splits the wheel speeds; TT motors lag. ---

export const PD_RUN = { dt: 0.005, startY: 0.025, maxTurn: 1.5, dTau: 0.01, seconds: 10, bendX: 0.5 }

export interface SteerCfg {
  v: number
  kp: number
  kd: number
  r: number
}

export interface SteerFrame {
  t: number
  pose: Pose
  dL: number
  dR: number
  adc: number[]
  /** Line position under the bar (m, + = right); null = lost. */
  pos: number | null
  e: number
  p: number
  d: number
  turn: number
  /** Past the end of the tape: stopping. */
  done: boolean
}

/** Lost: steer toward the side the line was last seen, as if it sat just past the outer sensor. */
const lostError = (last: number) => Math.sign(last || 1) * 2.5 * TCRT.pitchM

/** One PD step of the line position; returns the new memory and the turn (−1.5…1.5, + = right). */
function steerTick(m: PidMem, e: number, kp: number, kd: number, dt: number) {
  const { mem, terms } = pidTick(m, e, 0, { kp, ki: 0, kd, limit: PD_RUN.maxTurn, dTau: PD_RUN.dTau }, dt)
  return { mem, p: terms.p, d: terms.d, turn: terms.out }
}

/** TT wheel top speed on a full pack (m/s). */
export const WHEEL_TOP = wheelSpeedSs(DRIVE_TASK.fullV, 0, DRIVE_TASK.crr)

/** Left/right wheel targets for a turn command at base speed v, capped at the motors' top speed. */
export const turnWheels = (v: number, turn: number): [number, number] => [clamp(v * (1 + turn), -WHEEL_TOP, WHEEL_TOP), clamp(v * (1 - turn), -WHEEL_TOP, WHEEL_TOP)]

const tapeLength = (t: Tape) => t.slice(1).reduce((a, b, i) => a + Math.hypot(b[0] - t[i][0], b[1] - t[i][1]), 0)
/** Run time: the course at base speed plus a second to stop. */
export const steerSeconds = (c: SteerCfg) => Math.min(PD_RUN.seconds, tapeLength(sCourse(c.r)[0]) / c.v + 1)

export function steerRun(c: SteerCfg, seconds = steerSeconds(c), dt = PD_RUN.dt): SteerFrame[] {
  const tapes = sCourse(c.r)
  const end = tapes[0].at(-1)!
  const off = (x: number, y: number) => tapeDist(tapes, x, y)
  const s = { pose: { x: 0, y: PD_RUN.startY, th: 0 } as Pose, vL: c.v, vR: c.v, dL: 0, dR: 0, mem: PID_MEM0, last: 0, done: false }
  const out: SteerFrame[] = []
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const adc = readBar(s.pose, off)
    const pos = linePosition(adc, false)
    const e = pos ?? lostError(s.last)
    const tk = steerTick(s.mem, e, c.kp, c.kd, dt)
    s.mem = tk.mem
    if (pos !== null) s.last = pos
    s.done ||= s.pose.x > end[0] - 0.1 && pos === null
    out.push({ t: i * dt, pose: s.pose, dL: s.dL, dR: s.dR, adc, pos, e, p: tk.p, d: tk.d, turn: tk.turn, done: s.done })
    const [tl, tr] = s.done ? [0, 0] : turnWheels(c.v, tk.turn)
    s.vL = wheelLag(s.vL, tl, 0, dt)
    s.vR = wheelLag(s.vR, tr, 0, dt)
    s.pose = diffStep(s.pose, s.vL, s.vR, TT_TRACK_M, dt)
    s.dL += s.vL * dt
    s.dR += s.vR * dt
  }
  return out
}

/** Sensor error while on the course: RMS, worst from the first bend on, swings (sign changes beyond ±`band`), and time with the line lost. */
export function steerStats(run: SteerFrame[], dt = PD_RUN.dt, band = 0.003) {
  const on = run.filter((f) => !f.done)
  const seen = on.filter((f) => f.pos !== null).map((f) => f.pos!)
  let side = 0
  let swings = 0
  for (const e of seen) {
    const now = e > band ? 1 : e < -band ? -1 : 0
    if (now && side && now !== side) swings++
    if (now) side = now
  }
  return {
    rms: Math.sqrt(seen.reduce((a, e) => a + e * e, 0) / Math.max(1, seen.length)),
    worst: Math.max(0, ...on.filter((f) => f.pos !== null && f.pose.x >= PD_RUN.bendX).map((f) => Math.abs(f.pos!))),
    swings,
    lostS: (on.length - seen.length) * dt,
  }
}

// --- Intersections: count crossings on the main line, creep the wheels over the target one, spin onto the branch. ---

export const GRID = { crossX: [0.35, 0.7, 1.05], arm: 0.3, endX: 1.4, startX: -0.15, spinShare: 0.5, seconds: 8, darkAt: 0.5, junctionAt: 4 }
export const gridTapes = (): Tape[] => [
  [[GRID.startX, 0], [GRID.endX, 0]],
  ...GRID.crossX.map((x): Tape => [[x, -GRID.arm], [x, GRID.arm]]),
]

export type TurnDir = 'left' | 'right' | 'straight'
export type Detector = 'edge' | 'level'
export type JunctionState = 'follow' | 'creep' | 'spin' | 'done'

export interface JunctionCfg {
  v: number
  target: number
  dir: TurnDir
  detector: Detector
  creep: boolean
}

export interface JunctionFrame {
  t: number
  pose: Pose
  dL: number
  dR: number
  adc: number[]
  dark: number
  junction: boolean
  count: number
  state: JunctionState
}

/** Sensors over tape (calibrated darkness past `darkAt`). */
const darkCount = (adc: number[]) => adc.filter((a) => darkness(a) > GRID.darkAt).length

export function junctionRun(c: JunctionCfg, kp = 40, kd = 0.6, seconds = GRID.seconds, dt = PD_RUN.dt): JunctionFrame[] {
  const tapes = gridTapes()
  const off = (x: number, y: number) => tapeDist(tapes, x, y)
  const mid = (TCRT.count - 1) / 2
  const s = {
    pose: { x: 0, y: 0, th: 0 } as Pose,
    vL: c.v,
    vR: c.v,
    dL: 0,
    dR: 0,
    mem: PID_MEM0,
    last: 0,
    count: 0,
    was: false,
    turned: false,
    state: 'follow' as JunctionState,
    mark: 0,
    left: false,
  }
  const out: JunctionFrame[] = []
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const adc = readBar(s.pose, off)
    const dark = darkCount(adc)
    const junction = dark >= GRID.junctionAt
    const centre = darkness(adc[mid]) > GRID.darkAt
    if (s.state === 'follow' && junction && (c.detector === 'level' || !s.was)) s.count++
    s.was = junction
    const travel = (s.dL + s.dR) / 2
    let target: [number, number] = [0, 0]
    if (s.state === 'follow') {
      const pos = linePosition(adc, false)
      if (!s.turned && c.dir !== 'straight' && s.count >= c.target) {
        s.turned = true
        s.state = c.creep ? 'creep' : 'spin'
        s.mark = travel
        s.left = false
      } else if (pos === null && !junction) s.state = 'done'
      else {
        const tk = steerTick(s.mem, pos ?? 0, kp, kd, dt)
        s.mem = tk.mem
        if (pos !== null) s.last = pos
        target = turnWheels(c.v, tk.turn)
      }
    }
    if (s.state === 'creep') {
      target = [c.v, c.v]
      if (travel - s.mark >= CAR.barM) s.state = 'spin'
    }
    if (s.state === 'spin') {
      const w = c.v * GRID.spinShare * (c.dir === 'left' ? 1 : -1)
      target = [-w, w]
      if (!centre) s.left = true
      else if (s.left) {
        s.state = 'follow'
        s.mem = PID_MEM0
      }
    }
    out.push({ t: i * dt, pose: s.pose, dL: s.dL, dR: s.dR, adc, dark, junction, count: s.count, state: s.state })
    s.vL = wheelLag(s.vL, target[0], 0, dt)
    s.vR = wheelLag(s.vR, target[1], 0, dt)
    s.pose = diffStep(s.pose, s.vL, s.vR, TT_TRACK_M, dt)
    s.dL += s.vL * dt
    s.dR += s.vR * dt
  }
  return out
}

/** Where the robot ended: which crossing it turned at (1-based, null = never turned), counts, and whether it came back onto the line it left. */
export function junctionOutcome(run: JunctionFrame[]) {
  const k = run.findIndex((f, i) => i > 0 && f.state !== 'follow' && run[i - 1].state === 'follow' && f.state !== 'done')
  const at = k < 0 ? null : run[k].pose.x + CAR.barM
  const turnedAt = at === null ? null : GRID.crossX.reduce((b, x, i) => (Math.abs(x - at) < Math.abs(GRID.crossX[b] - at) ? i : b), 0) + 1
  const last = run.at(-1)!
  const head = Math.atan2(Math.sin(last.pose.th), Math.cos(last.pose.th))
  const heading: TurnDir | 'back' = Math.abs(head) < Math.PI / 4 ? 'straight' : Math.abs(head) > (3 * Math.PI) / 4 ? 'back' : head > 0 ? 'left' : 'right'
  return { turnedAt, count: last.count, heading, end: last.pose }
}
