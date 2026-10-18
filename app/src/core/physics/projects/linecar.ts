// Line-following car: the Robo-car with a 5 × TCRT5000 bar on its nose. Bar height and per-sensor calibration,
// PD tuned for lap time on the test loop (PWM speed, loop rate), and a route of turns through a tape grid.
import { clamp, gaussAt, once } from '../common'
import { CHASSIS } from '../materials/chassis'
import { adcReadable } from '../mcu/adc'
import { diffStep } from '../mobility/diffdrive'
import { Pose } from '../room'
import { CAR, LOST, TCRT, darkness, readBar, sensorX, startFollower, tapeCover, trackOffset } from '../sensors/infrared'
import { DRIVE_TASK, wheelLag } from '../control/loop'
import { PD_RUN, Tape, steerTick, sweepHalf, sweepStats, tapeDist } from '../control/linefollow'
import { PID_MEM0 } from '../control/pid'
import { DRIVE, pwmWheelSpeed } from './robocar'

// --- Sensor array: height above the floor, part-to-part spread, start-up calibration, ADC1 pins. ---

/** Nominal 5 mm up (the 4 mm spot the Sensors lessons use); TCRT5000 coupling peaks at 2.5 mm; spot grows 0.5 mm per mm;
 *  gains = this bar's five parts (±20 % is normal); ADC noise in counts; AO pins on ADC1. */
export const LINE_BAR = { h0: 0.005, peakH: 0.0025, spot0: 0.0015, spread: 0.5, gains: [1.12, 0.84, 1, 0.92, 1.18], noise: 25, pins: [36, 39, 34, 35, 32] }

/** Light coupled back (relative, 1 at the 2.5 mm peak). */
export const barCoupling = (h: number) => (h / LINE_BAR.peakH) * Math.exp(1 - h / LINE_BAR.peakH)
/** Spot size on the floor (m). */
export const barSpot = (h: number) => LINE_BAR.spot0 + LINE_BAR.spread * h

/** Raw 12-bit reading of a TCRT5000 with this `gain`, `h` above the floor, tape centre `off` away. Gain 1 at h0 = `tcrtAdc`. */
export function barRaw(off: number, h: number, gain = 1) {
  const refl = TCRT.floor + (TCRT.tape - TCRT.floor) * tapeCover(off, TCRT.lineM, barSpot(h))
  const k = (0.92 * gain * barCoupling(h)) / barCoupling(LINE_BAR.h0)
  const v = TCRT.vcc * (1 - (k * refl) / TCRT.floor)
  return Math.round(clamp((v / TCRT.vcc) * 4095, 0, 4095))
}

export type BarCal = 'none' | 'sweep'
export interface BarLimits {
  lo: number[]
  hi: number[]
}

/** Start-up calibration: the car swings the bar over the tape and keeps each sensor's lowest (white) and highest (black) reading. */
export function barCalibrate(h: number): BarLimits {
  const offs = Array.from({ length: 81 }, (_, k) => -0.06 + k * 0.0015)
  const reads = LINE_BAR.gains.map((g, i) => offs.map((o) => barRaw(o - sensorX(i), h, g)))
  return { lo: reads.map((r) => Math.min(...r)), hi: reads.map((r) => Math.max(...r)) }
}

/** Darkness 0…1 per sensor: one white/black pair for all (none) or each sensor's own limits. */
export const barDarkness = (adc: number[], cal: BarLimits | null) =>
  adc.map((a, i) => (cal ? clamp((a - cal.lo[i]) / Math.max(1, cal.hi[i] - cal.lo[i]), 0, 1) : darkness(a)))

/** Weighted line position (m, + = right) from the darkness weights; null when Σw < LOST. */
export function barPosition(adc: number[], cal: BarLimits | null): number | null {
  const w = barDarkness(adc, cal)
  const sum = w.reduce((a, b) => a + b, 0)
  if (sum < LOST) return null
  return w.reduce((a, wi, i) => a + wi * sensorX(i), 0) / sum
}

/** Noisy readings of the whole bar over tape `off` right of centre (`seed` picks the noise). */
export const barReadings = (off: number, h: number, seed: number) =>
  LINE_BAR.gains.map((g, i) => Math.round(clamp(barRaw(off - sensorX(i), h, g) + LINE_BAR.noise * gaussAt(seed * 5 + i), 0, 4095)))

/** A jig slides the tape across the bar: position read vs truth, how far it tracks, and whether bare floor reads as "lost". */
export function arraySweep(h: number, cal: BarCal, steps = 241) {
  const lim = barCalibrate(h)
  const use = cal === 'sweep' ? lim : null
  const half = sweepHalf(TCRT.pitchM, TCRT.count)
  const points = Array.from({ length: steps }, (_, k) => {
    const off = -half + (2 * half * k) / (steps - 1)
    const adc = barReadings(off, h, 7000 + k)
    return { off, adc, pos: barPosition(adc, use) }
  })
  const white = LINE_BAR.gains.map((g) => barRaw(1, h, g))
  const whiteSum = barDarkness(white, use).reduce((a, b) => a + b, 0)
  const centre = LINE_BAR.gains.map((g, i) => barRaw(-sensorX(i), h, g))
  const seen = points.filter((p) => p.pos !== null && Math.abs(p.off) < 0.03)
  return {
    points,
    lim,
    stats: sweepStats(points, 0.003),
    contrast: Math.min(...lim.hi.map((hi, i) => hi - lim.lo[i])),
    whiteSum,
    /** Bare floor reads as "line lost" (Σw under the threshold). */
    lostWorks: whiteSum < LOST,
    /** Line dead centre: what the bar says (noise-free). */
    centreBias: barPosition(centre, use),
    rms: Math.sqrt(seen.reduce((a, p) => a + (p.pos! - p.off) ** 2, 0) / Math.max(1, seen.length)),
  }
}

/** All five AO pins on ADC1, so they still read with Wi-Fi on (ADC2 pins 25/26/27/14 already drive the DRV8833). */
export const barPinsReadable = (wifi: boolean) => LINE_BAR.pins.every((p) => adcReadable(p >= 32 ? 1 : 2, wifi))

// --- PD controller: the Robo-car on the test loop, duty = base speed, turn splits the duties, loop period holds the output. ---

/** Lost for `lostS` = ran off the track. */
export const LINE_LAP = { dt: 0.005, seconds: 30, lostS: 0.6 }

export interface LapCfg {
  duty: number
  kp: number
  kd: number
  /** Control loop period (s): read the bar and update the PD this often. */
  periodS: number
}

export interface LapFrame {
  t: number
  pose: Pose
  dL: number
  dR: number
  adc: number[]
  pos: number | null
  turn: number
  /** Laps so far (0…1). */
  lap: number
}

const loopAngle = (p: Pose) => Math.atan2(p.y / 0.48, p.x / 0.85)
const SPEEDS = once(() => Array.from({ length: 101 }, (_, k) => pwmWheelSpeed(k / 100)))
/** `pwmWheelSpeed` from a 1 % table (the power solve is too slow to run every tick); negative duty = reverse. */
export function dutySpeed(duty: number, weak = 0) {
  const x = Math.min(1, Math.abs(duty)) * 100
  const i = Math.min(99, Math.floor(x))
  const t = SPEEDS()
  return Math.sign(duty) * (t[i] + (t[i + 1] - t[i]) * (x - i)) * (1 - weak)
}

/** One lap of the Sensors › Infrared test loop: PD on the bar every `periodS`, duties duty·(1 ± turn), right motor 6 % weak. */
export function lapRun(c: LapCfg) {
  const every = Math.max(1, Math.round(c.periodS / LINE_LAP.dt))
  const f0 = startFollower()
  const s = { pose: f0.pose, vL: 0, vR: 0, dL: 0, dR: 0, mem: PID_MEM0, last: 0, turn: 0, adc: f0.adc, pos: 0 as number | null, lostFor: 0, ang: 0, prev: loopAngle(f0.pose) }
  const frames: LapFrame[] = []
  let lapS: number | null = null
  let ranOff = false
  const n = Math.round(LINE_LAP.seconds / LINE_LAP.dt)
  for (let i = 0; i <= n; i++) {
    const t = i * LINE_LAP.dt
    if (i % every === 0) {
      s.adc = readBar(s.pose, trackOffset)
      s.pos = barPosition(s.adc, null)
      const e = s.pos ?? Math.sign(s.last || 1) * 2.5 * TCRT.pitchM
      const tk = steerTick(s.mem, e, c.kp, c.kd, every * LINE_LAP.dt)
      s.mem = tk.mem
      s.turn = tk.turn
      if (s.pos !== null) s.last = s.pos
    }
    s.lostFor = s.pos === null ? s.lostFor + LINE_LAP.dt : 0
    const a = loopAngle(s.pose)
    s.ang += Math.atan2(Math.sin(a - s.prev), Math.cos(a - s.prev))
    s.prev = a
    const lap = clamp(s.ang / (2 * Math.PI), 0, 1)
    frames.push({ t, pose: s.pose, dL: s.dL, dR: s.dR, adc: s.adc, pos: s.pos, turn: s.turn, lap })
    if (lap >= 1) {
      lapS = t
      break
    }
    if (s.lostFor >= LINE_LAP.lostS) {
      ranOff = true
      break
    }
    s.vL = wheelLag(s.vL, dutySpeed(clamp(c.duty * (1 + s.turn), -1, 1)), 0, LINE_LAP.dt)
    s.vR = wheelLag(s.vR, dutySpeed(clamp(c.duty * (1 - s.turn), -1, 1), DRIVE.weak), 0, LINE_LAP.dt)
    s.pose = diffStep(s.pose, s.vL, s.vR, CHASSIS.track, LINE_LAP.dt)
    s.dL += s.vL * LINE_LAP.dt
    s.dR += s.vR * LINE_LAP.dt
  }
  const seen = frames.filter((f) => f.pos !== null).map((f) => Math.abs(f.pos!))
  return {
    frames,
    v: pwmWheelSpeed(c.duty),
    lapS,
    ranOff,
    rms: Math.sqrt(seen.reduce((a, e) => a + e * e, 0) / Math.max(1, seen.length)),
    worst: Math.max(0, ...seen),
    lostS: (frames.length - seen.length) * LINE_LAP.dt,
  }
}

export const LAP_DUTIES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
/** Lap time (null = ran off or timed out) at each duty, same gains and loop period: the tuning sheet. */
export const lapSheet = (kp: number, kd: number, periodS: number) =>
  LAP_DUTIES.map((duty) => {
    const r = lapRun({ duty, kp, kd, periodS })
    return { duty, lapS: r.lapS, rms: r.rms, ranOff: r.ranOff }
  })

// --- Intersections: a 3 × 3 tape grid, a list of turns, junctions read by the outer sensors, turns ended by sensor or timer. ---

/** 40 cm cells; slow to 45 % duty through a junction; spin wheels at half speed; the timed spin is tuned at the Robo-car's 70 %. */
export const LINE_GRID = { cell: 0.4, startY: -0.35, darkAt: 0.5, slowDuty: 0.45, spinShare: 0.5, seconds: 25, lostS: 0.5, arriveM: 0.06 }
export const gridLines = (): Tape[] => {
  const c = LINE_GRID.cell
  return [
    ...[0, c, 2 * c].map((y): Tape => [[0, y], [2 * c, y]]),
    [[0, 0], [0, 2 * c]],
    [[c, LINE_GRID.startY], [c, 2 * c]],
    [[2 * c, 0], [2 * c, 2 * c]],
  ]
}
export const GRID_START: Pose = { x: LINE_GRID.cell, y: LINE_GRID.startY + 0.05, th: Math.PI / 2 }

export type GridTurn = 'L' | 'S' | 'R'
export type GridGoal = 'A' | 'B' | 'C'
export const GRID_GOALS: Record<GridGoal, { name: string; at: [number, number]; turns: GridTurn[] }> = {
  A: { name: 'A: top left', at: [0, 2 * LINE_GRID.cell], turns: ['L', 'R', 'S'] },
  B: { name: 'B: right middle', at: [2 * LINE_GRID.cell, LINE_GRID.cell], turns: ['S', 'R'] },
  C: { name: 'C: top right', at: [2 * LINE_GRID.cell, 2 * LINE_GRID.cell], turns: ['R', 'L', 'S'] },
}
export type TurnEnd = 'sensor' | 'timer'
export const GRID_STATES = ['follow', 'creep', 'brake', 'spin', 'arrived', 'lost', 'stuck'] as const
export type GridState = (typeof GRID_STATES)[number]

export interface GridJunction {
  left: boolean
  right: boolean
  straight: boolean
  action: GridTurn | 'stop'
  t: number
  at: Pose
}
export interface GridFrame {
  t: number
  pose: Pose
  dL: number
  dR: number
  adc: number[]
  state: GridState
  /** Junctions met so far. */
  k: number
}

/** Junction type as the robot names it. */
export function junctionName(j: Pick<GridJunction, 'left' | 'right' | 'straight'>) {
  const ways = [j.left && 'L', j.straight && 'S', j.right && 'R'].filter(Boolean).join('+')
  if (j.left && j.right) return j.straight ? `cross (${ways})` : `T (${ways})`
  if (j.straight) return `branch (${ways})`
  return j.left || j.right ? `corner (${ways})` : 'dead end'
}

/** Spin time (s) for 90° with the wheels at ±spinShare × the speed of `duty`, ignoring motor lag: what a sketch's delay() is tuned to. */
export const gridSpinS = (duty: number) => ((Math.PI / 2) * (CHASSIS.track / 2)) / (dutySpeed(duty) * LINE_GRID.spinShare)

/** Drive the route to `goal`: follow; at a junction slow down and creep the bar length while the outer sensors look left and right,
 *  check the centre for straight, brake, then turn until the centre finds the new line (sensor) or for a tuned time (timer). */
export function gridRun(goal: GridGoal, duty: number, end: TurnEnd, tunedDuty = DRIVE.tunedDuty) {
  const G = GRID_GOALS[goal]
  const tapes = gridLines()
  const off = (x: number, y: number) => tapeDist(tapes, x, y)
  const v = dutySpeed(duty)
  const slow = Math.min(v, dutySpeed(LINE_GRID.slowDuty))
  const dt = PD_RUN.dt
  const timedS = gridSpinS(tunedDuty)
  const spinW = (end === 'timer' ? v : slow) * LINE_GRID.spinShare
  const s = { pose: GRID_START, vL: 0, vR: 0, dL: 0, dR: 0, mem: PID_MEM0, last: 0, state: 'follow' as GridState, was: false, mark: 0, since: 0, left: false, seenL: false, seenR: false, dir: 1, lostFor: 0, next: 'S' as GridTurn | 'stop' }
  const log: GridJunction[] = []
  const frames: GridFrame[] = []
  const dark = (a: number) => darkness(a) > LINE_GRID.darkAt
  const n = Math.round(LINE_GRID.seconds / dt)
  for (let i = 0; i <= n; i++) {
    const t = i * dt
    const adc = readBar(s.pose, off)
    const outer = dark(adc[0]) || dark(adc[TCRT.count - 1])
    const centre = dark(adc[(TCRT.count - 1) / 2])
    const travel = (s.dL + s.dR) / 2
    let target: [number, number] = [0, 0]
    if (s.state === 'follow') {
      if (outer && !s.was) Object.assign(s, { state: 'creep', mark: travel, seenL: false, seenR: false })
      else {
        const pos = barPosition(adc, null)
        s.lostFor = pos === null ? s.lostFor + dt : 0
        if (s.lostFor >= LINE_GRID.lostS) s.state = 'lost'
        else {
          const tk = steerTick(s.mem, pos ?? Math.sign(s.last || 1) * 2.5 * TCRT.pitchM, 40, 0.6, dt)
          s.mem = tk.mem
          if (pos !== null) s.last = pos
          target = [v * (1 + tk.turn), v * (1 - tk.turn)]
        }
      }
    }
    if (s.state === 'creep') {
      s.seenL ||= dark(adc[0])
      s.seenR ||= dark(adc[TCRT.count - 1])
      target = [slow, slow]
      if (travel - s.mark >= CAR.barM - ((s.vL + s.vR) / 2) * DRIVE_TASK.tau) {
        const action = log.length < G.turns.length ? G.turns[log.length] : 'stop'
        const j: GridJunction = { left: s.seenL, right: s.seenR, straight: centre, action, t, at: s.pose }
        log.push(j)
        const ok = action === 'stop' || (action === 'L' ? j.left : action === 'R' ? j.right : j.straight)
        s.next = action
        s.state = !ok ? 'stuck' : action === 'S' ? 'follow' : 'brake'
      }
    }
    if (s.state === 'brake' && Math.abs(s.vL) + Math.abs(s.vR) < 0.01) {
      if (s.next === 'stop') s.state = 'arrived'
      else Object.assign(s, { state: 'spin', dir: s.next === 'L' ? 1 : -1, since: t, left: false })
    }
    if (s.state === 'spin') {
      target = [-spinW * s.dir, spinW * s.dir]
      const done = end === 'timer' ? t - s.since >= timedS : centre && s.left
      if (!centre) s.left = true
      if (done) {
        Object.assign(s, { state: 'follow', mem: PID_MEM0, last: -s.dir * TCRT.pitchM, lostFor: 0 })
        target = [0, 0]
      }
    }
    s.was = outer
    frames.push({ t, pose: s.pose, dL: s.dL, dR: s.dR, adc, state: s.state, k: log.length })
    if ((s.state === 'arrived' || s.state === 'lost' || s.state === 'stuck') && Math.abs(s.vL) + Math.abs(s.vR) < 1e-3) break
    s.vL = wheelLag(s.vL, target[0], 0, dt)
    s.vR = wheelLag(s.vR, target[1], 0, dt)
    s.pose = diffStep(s.pose, s.vL, s.vR, CHASSIS.track, dt)
    s.dL += s.vL * dt
    s.dR += s.vR * dt
  }
  const last = frames.at(-1)!
  const missM = Math.hypot(last.pose.x - G.at[0], last.pose.y - G.at[1])
  return { frames, log, v, timedS, state: last.state, missM, arrived: last.state === 'arrived' && missM < LINE_GRID.arriveM, seconds: last.t }
}
