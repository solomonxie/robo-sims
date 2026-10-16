// Hobby servos: pulse ranges and end stops, continuous rotation, the P-loop inside (pot, H-bridge, deadband), jitter and supply sag.
import { clamp, clamp01, gaussAt } from './common'
import { SERVO_DEG_PER_S, SERVO_HZ } from './mcu/pwm'
import { ESP32_BOD } from './power/brownout'
import { AMS1117_33, dropoutVolts } from './regulators'

// --- Pulse to angle: each servo maps its own pulse range onto 0–180°, then a mechanical stop. ---

export interface ServoSpec {
  minUs: number
  maxUs: number
  /** Mechanical end stops, degrees (a little past the rated travel). */
  stops: [number, number]
  stallA: number
}
export const SERVO_SPECS = {
  wide: { minUs: 500, maxUs: 2500, stops: [-6, 186], stallA: 0.7 },
  narrow: { minUs: 1000, maxUs: 2000, stops: [-12, 192], stallA: 0.7 },
} satisfies Record<string, ServoSpec>
/** Error that makes the servo's amplifier go full on (its proportional band). */
export const SERVO_BAND_DEG = 10

/** Firmware side: `write(deg)` → pulse µs for the range the code assumes. */
export const pulseForDeg = (deg: number, [minUs, maxUs]: readonly [number, number]) => minUs + clamp01(deg / 180) * (maxUs - minUs)
/** The angle the servo's electronics aim for; may lie past the end stops. */
export const servoAim = (us: number, s: ServoSpec) => ((us - s.minUs) / (s.maxUs - s.minUs)) * 180

/** Where the horn rests, how far the aim lies past a stop, and the current while it pushes there (end-stop buzz). */
export function servoRest(us: number, s: ServoSpec) {
  const aim = servoAim(us, s)
  const deg = clamp(aim, s.stops[0], s.stops[1])
  const overDeg = Math.abs(aim - deg)
  return { aim, deg, overDeg, amps: s.stallA * clamp01(overDeg / SERVO_BAND_DEG) }
}

/** 360° servo: the pot is replaced by a fixed divider, so pulse = speed. `neutralUs` is where this unit actually stops. */
export const CR_SERVO = { neutralUs: 1520, deadUs: 10, spanUs: 500, maxRpm: 55 }
export function crRpm(us: number, c = CR_SERVO) {
  const d = us - c.neutralUs
  return Math.sign(d) * c.maxRpm * clamp01((Math.abs(d) - c.deadUs) / (c.spanUs - c.deadUs))
}

// --- Inside a hobby servo: pot vs pulse → P-controller → H-bridge duty → motor → gears → output. ---

/** SG90 at 5 V: output speed limit, motor+gear lag, stall and idle current, pot noise (deg RMS). */
export const SG90_LOOP = { degPerS: SERVO_DEG_PER_S, tauS: 0.02, stallA: 0.7, idleA: 0.006, potNoiseDeg: 0.35, gear: 288 }
/** Pulse µs → output degrees on a 500–2500 µs servo. */
export const usToDeg = (us: number) => (us * 180) / (SERVO_SPECS.wide.maxUs - SERVO_SPECS.wide.minUs)

/** P-controller with a deadband: no drive inside ±dead, else (error beyond the band edge) / band, clipped to ±1. */
export function servoDuty(errDeg: number, bandDeg: number, deadDeg: number) {
  if (Math.abs(errDeg) <= deadDeg) return 0
  return clamp((errDeg - Math.sign(errDeg) * deadDeg) / bandDeg, -1, 1)
}

export interface LoopFrame {
  t: number
  target: number
  deg: number
  duty: number
  amps: number
}

/** Step response of the servo loop: pot read once per 20 ms frame (with noise), the bridge drives the motor at that duty. */
export function servoLoopRun(target: (t: number) => number, bandDeg: number, deadUs: number, seconds = 1, dt = 0.001, l = SG90_LOOP) {
  const deadDeg = usToDeg(deadUs)
  const out: LoopFrame[] = []
  let deg = target(0)
  let w = 0
  let duty = 0
  let frame = -1
  for (let k = 0; k * dt <= seconds + 1e-9; k++) {
    const t = k * dt
    const f = Math.floor(t * SERVO_HZ)
    if (f !== frame) {
      frame = f
      duty = servoDuty(target(t) - (deg + l.potNoiseDeg * gaussAt(f)), bandDeg, deadDeg)
    }
    out.push({ t, target: target(t), deg, duty, amps: l.idleA + l.stallA * Math.min(1, Math.abs(duty - w / l.degPerS)) })
    w += ((duty * l.degPerS - w) / l.tauS) * dt
    deg += w * dt
  }
  return out
}

/** Time to stay within `tolDeg` of the final target for good, or null. */
export function servoSettleS(run: LoopFrame[], tolDeg = 2) {
  const goal = run[run.length - 1].target
  let last = -1
  run.forEach((f, i) => Math.abs(f.deg - goal) > tolDeg && (last = i))
  return last < run.length - 1 ? run[last + 1].t : null
}
export const overshootDeg = (run: LoopFrame[]) => {
  const start = run[0].deg
  const goal = run[run.length - 1].target
  const s = Math.sign(goal - start)
  return Math.max(0, ...run.map((f) => s * (f.deg - goal)))
}

// --- Jitter and power: several servos starting at once sag a shared 5 V rail; ground bounce and PWM jitter twitch them. ---

export type Wiring = 'shared' | 'separate'
export type PwmSource = 'ledc' | 'soft'
/** Shared: servos on the ESP32's USB 5 V through breadboard rails. Separate: 6 V pack, star ground. */
export const RAIL = {
  shared: { volts: 5, rSrc: 0.6, rGnd: 0.6 },
  separate: { volts: 6, rSrc: 0.12, rGnd: 0.02 },
  logicA: 0.12,
  usbVolts: 5,
  vih: 2.5,
  runA: 0.3,
  count: 4,
  holdA: 0.01,
  tauMotorS: 0.002,
  kickA: 0.35,
  kickS: 0.004,
  deadUs: 5,
  jitterUs: { ledc: 0.1, soft: 4 },
  /** Holding servos judge each pulse at its falling edge (1.5 ms pulse); movers start after a 1 ms pulse. */
  edgeS: 0.0015,
  startDelayS: 0.001,
}

export interface RailFrame {
  t: number
  amps: number
  railV: number
  logicV: number
  /** Servo ground above the ESP32's: wire current × R_gnd. A pulse is lost when 3V3 − gndV < V_IH. */
  gndV: number
  reset: boolean
}

/** Pulse-width error for frame `f` and servo `i`: PWM timing jitter (± µs RMS). */
export const pulseJitterUs = (src: PwmSource, f: number, i: number) => RAIL.jitterUs[src] * gaussAt(f * 7 + i)

/** `RAIL.count` servos on one rail, `n` of them told to move at `startS`; every 20 ms frame each holding servo may twitch
 *  (jitter past the deadband, or a pulse lost to ground bounce). After a brownout reset no pulses come: all go limp. */
export function servoRailRun(n: number, wiring: Wiring, capF: number, src: PwmSource, seconds = 0.4, dt = 0.0002, startS = 0.06 + RAIL.startDelayS, moveS = 0.15) {
  const r = RAIL[wiring]
  const kicks = Array<number>(RAIL.count).fill(-1)
  const moving = (i: number, t: number) => i < n && t >= startS && t < startS + moveS
  const twitches: { t: number; servo: number; lost: boolean }[] = []
  const out: RailFrame[] = []
  let v = r.volts - ((wiring === 'shared' ? RAIL.logicA : 0) + RAIL.count * RAIL.holdA) * r.rSrc
  let frame = -1
  let reset = false
  let amps = 0
  let gndV = 0
  const logicA = wiring === 'shared' ? RAIL.logicA : 0
  for (let k = 0; k * dt <= seconds + 1e-9; k++) {
    const t = k * dt
    const f = Math.floor((t - RAIL.edgeS) * SERVO_HZ)
    const logicV = wiring === 'shared' ? Math.min(3.3, v - dropoutVolts(AMS1117_33, RAIL.logicA)) : 3.3
    if (f !== frame && f >= 0) {
      frame = f
      const lost = logicV - gndV < RAIL.vih
      for (let i = 0; i < RAIL.count; i++) {
        if (!reset && !moving(i, t) && (lost || Math.abs(pulseJitterUs(src, f, i)) > RAIL.deadUs)) {
          kicks[i] = t
          twitches.push({ t, servo: i, lost })
        }
      }
    }
    amps = 0
    for (let i = 0; i < RAIL.count; i++) {
      const s = t - startS
      if (reset) amps += RAIL.holdA
      else if (moving(i, t)) amps += RAIL.runA + (SG90_LOOP.stallA - RAIL.runA) * Math.exp(-s / RAIL.tauMotorS)
      else amps += kicks[i] >= 0 && t - kicks[i] < RAIL.kickS ? RAIL.kickA : RAIL.holdA
    }
    const vInf = r.volts - (amps + logicA) * r.rSrc
    v = capF > 0 ? vInf + (v - vInf) * Math.exp(-dt / (r.rSrc * capF)) : vInf
    gndV = Math.max(0, (r.volts - v) / r.rSrc - logicA) * r.rGnd
    if (logicV < ESP32_BOD[0]) reset = true
    out.push({ t, amps, railV: v, logicV, gndV, reset })
  }
  return { frames: out, twitches }
}

export function railSummary(run: ReturnType<typeof servoRailRun>) {
  const f = run.frames
  return {
    minRail: Math.min(...f.map((x) => x.railV)),
    minLogic: Math.min(...f.map((x) => x.logicV)),
    peakA: Math.max(...f.map((x) => x.amps)),
    resetAt: f.find((x) => x.reset)?.t ?? null,
    twitches: run.twitches.length,
  }
}
