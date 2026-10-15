// Safety: a task watchdog against a hung loop, a hardware E-stop vs a software one, and a fault state machine.
import { Machine, fsmStep } from '../../fsm'

/** Longest WDT timeout that still stops within `gapM`; < 0 = no timeout is short enough. */
export const maxWdtTimeout = (gapM: number, v: number, decel: number) => (gapM - (v * v) / (2 * decel)) / v

/** v moves toward `target` at most `accel` m/s² for one step. */
const rampTo = (v: number, target: number, accel: number, dt: number) => (target > v ? Math.min(target, v + accel * dt) : Math.max(target, v - accel * dt))

// --- Watchdog: a ToF read over I²C that never returns; where the firmware feeds the WDT decides whether it resets. ---

export type WdtFeed = 'loop' | 'wait' | 'none'
export type WdtPhase = 'run' | 'hung' | 'boot'
export const WDT = { dt: 0.01, seconds: 9, loopS: 0.05, v: 0.4, accel: 2, decel: 2, wallX: 2.2, halfLen: 0.12, stopRange: 0.3, hangAt: 2, bootS: 0.6 }
export interface WdtFrame {
  t: number
  x: number
  v: number
  /** Time since the last feed, s; NaN = no watchdog running. */
  count: number
  phase: WdtPhase
  resets: number
  crashed: boolean
  /** Range the firmware last read, m. */
  range: number
}

export const wallGap = (x: number) => WDT.wallX - WDT.halfLen - x

export function wdtRun(feed: WdtFeed, timeoutS: number) {
  const frames: WdtFrame[] = []
  const resetAt: number[] = []
  let phase: WdtPhase = 'run'
  let x = 0
  let v = 0
  let target = 0
  let fed = 0
  let nextLoop = 0
  let bootUntil = 0
  let hung = false
  let resets = 0
  let crashed = false
  let range = wallGap(0)
  for (let i = 0; i <= Math.round(WDT.seconds / WDT.dt); i++) {
    const t = i * WDT.dt
    if (phase === 'run' && t >= nextLoop - 1e-9) {
      nextLoop += WDT.loopS
      if (!hung && resets === 0 && t >= WDT.hangAt) {
        phase = 'hung'
        hung = true
      } else {
        range = wallGap(x)
        target = range > WDT.stopRange ? WDT.v : 0
        fed = t
      }
    }
    if (phase === 'hung' && feed === 'wait') fed = t
    if (phase === 'boot' && t >= bootUntil - 1e-9) {
      phase = 'run'
      fed = t
      nextLoop = t
    }
    if (feed !== 'none' && phase === 'hung' && t - fed >= timeoutS - 1e-9) {
      phase = 'boot'
      resets++
      resetAt.push(t)
      bootUntil = t + WDT.bootS
      target = 0
    }
    if (!crashed) {
      v = rampTo(v, target, target > v ? WDT.accel : WDT.decel, WDT.dt)
      x += v * WDT.dt
      if (wallGap(x) <= 0) {
        crashed = true
        x = WDT.wallX - WDT.halfLen
      }
    }
    if (crashed) v = 0
    frames.push({ t, x, v, count: feed === 'none' ? NaN : phase === 'boot' ? 0 : t - fed, phase, resets, crashed, range })
  }
  return { frames, resetAt }
}

// --- E-stop: a mushroom button that drops a contactor in hardware vs a GPIO the firmware polls; latched until reset. ---

export type StopKind = 'sw' | 'cat0' | 'cat1'
export type StopFault = 'none' | 'hung' | 'short'
export const ESTOP = {
  dt: 0.005,
  seconds: 7,
  pressAt: 1.5,
  releaseAt: 3.5,
  resetAt: 5,
  pollS: 0.02,
  releaseS: 0.015,
  brake: 4,
  coast: 1.2,
  cat1S: 0.3,
  gapM: 0.6,
}
export interface StopFrame {
  t: number
  x: number
  v: number
  pressed: boolean
  /** Contactor closed: battery reaches the motor driver. */
  power: boolean
  /** The driver is pushing the motors (power on and a non-zero command). */
  drive: boolean
  braking: boolean
  crashed: boolean
}

/** Drive at `v0`, press the E-stop with the obstacle `ESTOP.gapM` ahead (x = 0 at the press), twist it out, press reset.
 *  The firmware sees the button (GPIO or a monitor contact) one poll later unless it is hung; a latched trip keeps the
 *  command at 0 for good (a reset restores power but never restarts). `short` = a driver MOSFET welded on. */
export function estopRun(kind: StopKind, fault: StopFault, latch: boolean, v0: number) {
  const frames: StopFrame[] = []
  const cutDelay = kind === 'cat0' ? ESTOP.releaseS : ESTOP.cat1S
  let x = -v0 * ESTOP.pressAt
  let v = v0
  let crashed = false
  let stopX = NaN
  let stopT = Infinity
  let restartAt = NaN
  for (let i = 0; i <= Math.round(ESTOP.seconds / ESTOP.dt); i++) {
    const t = i * ESTOP.dt
    const pressed = t >= ESTOP.pressAt && t < ESTOP.releaseAt
    const reset = t >= ESTOP.resetAt
    const cmdZero = fault !== 'hung' && t >= ESTOP.pressAt + ESTOP.pollS && (latch || pressed)
    const tripped = latch ? t >= ESTOP.pressAt && !reset : pressed
    const power = kind === 'sw' || !(tripped && t >= ESTOP.pressAt + cutDelay)
    const drive = power && (!cmdZero || fault === 'short')
    const braking = power && cmdZero && fault !== 'short'
    if (!crashed) {
      v = drive ? Math.min(v0, v + ESTOP.brake * ESTOP.dt) : Math.max(0, v - (braking ? ESTOP.brake : ESTOP.coast) * ESTOP.dt)
      x += v * ESTOP.dt
      if (x >= ESTOP.gapM) {
        crashed = true
        x = ESTOP.gapM
      }
    }
    if (crashed) v = 0
    if (Number.isNaN(stopX) && t > ESTOP.pressAt && v === 0) {
      stopX = x
      stopT = t
    }
    if (Number.isNaN(restartAt) && !Number.isNaN(stopX) && !crashed && v > 0) restartAt = t
    frames.push({ t, x, v, pressed, power, drive, braking, crashed })
  }
  return { frames, travelled: Number.isNaN(stopX) ? frames[frames.length - 1].x : stopX, crashed, restartAt, stopX, stopT }
}

// --- Fault states: battery low, motor overcurrent, sensor timeout and comms loss drive a fault FSM. ---

export type FaultState = 'BOOT' | 'OK' | 'WARN' | 'LIMP' | 'STOP' | 'LATCH'
export type FaultScenario = 'battery' | 'stall' | 'sensor' | 'comms'
export interface FaultIn {
  battV: number
  amps: number
  /** How long the motor current has been over `FAULT.overA`, s. */
  overFor: number
  sensorAge: number
  commsAge: number
  /** How long every input has been clear, s. */
  clearFor: number
  reset: boolean
}
export const FAULT = {
  dt: 0.05,
  seconds: 12,
  warnV: 7.0,
  limpV: 6.7,
  stopV: 6.4,
  overA: 2.5,
  overS: 0.3,
  sensorLimpS: 0.15,
  sensorStopS: 1,
  commsWarnS: 0.15,
  commsStopS: 0.5,
  clearS: 1,
  bootS: 1,
  resetAt: 10,
  v: 0.5,
}
/** Speed cap per state, fraction of full. */
export const FAULT_CAP: Record<FaultState, number> = { BOOT: 0, OK: 1, WARN: 1, LIMP: 0.3, STOP: 0, LATCH: 0 }

/** Worst condition in the inputs, and why. */
export function faultLevel(i: FaultIn): { level: 'OK' | 'WARN' | 'LIMP' | 'STOP'; cause: string } {
  if (i.battV < FAULT.stopV) return { level: 'STOP', cause: 'battery empty' }
  if (i.sensorAge >= FAULT.sensorStopS) return { level: 'STOP', cause: 'sensor dead' }
  if (i.commsAge >= FAULT.commsStopS) return { level: 'STOP', cause: 'comms lost' }
  if (i.battV < FAULT.limpV) return { level: 'LIMP', cause: 'battery low' }
  if (i.sensorAge >= FAULT.sensorLimpS) return { level: 'LIMP', cause: 'sensor timeout' }
  if (i.battV < FAULT.warnV) return { level: 'WARN', cause: 'battery getting low' }
  if (i.commsAge >= FAULT.commsWarnS) return { level: 'WARN', cause: 'comms late' }
  if (i.amps > FAULT.overA) return { level: 'WARN', cause: 'motor current high' }
  return { level: 'OK', cause: '' }
}

const over = (i: FaultIn) => i.overFor >= FAULT.overS
const lvl = (i: FaultIn) => faultLevel(i).level
const clear = (i: FaultIn) => lvl(i) === 'OK' && i.clearFor >= FAULT.clearS
const sev = { OK: 0, WARN: 1, LIMP: 2, STOP: 3 }

/** Edges in priority order (first match wins). OK only ever escalates to WARN (one tick later on up); an overcurrent trips
 *  straight to LATCH when `latch` (wait for a reset), else to STOP (which retries once clear). */
export function faultMachine(latch: boolean): Machine<FaultState, FaultIn> {
  const trip: FaultState = latch ? 'LATCH' : 'STOP'
  return {
    states: ['BOOT', 'OK', 'WARN', 'LIMP', 'STOP', 'LATCH'],
    start: 'BOOT',
    edges: [
      { from: 'BOOT', to: 'OK', when: (i) => clear(i) && i.clearFor >= FAULT.bootS, label: 'self-test' },
      { from: 'OK', to: 'WARN', when: (i) => lvl(i) !== 'OK' || i.amps > FAULT.overA, label: 'warn' },
      { from: 'WARN', to: trip, when: over, label: 'overcurrent' },
      { from: 'LIMP', to: trip, when: over, label: 'overcurrent' },
      { from: 'WARN', to: 'STOP', when: (i) => lvl(i) === 'STOP', label: 'fault' },
      { from: 'LIMP', to: 'STOP', when: (i) => lvl(i) === 'STOP', label: 'fault' },
      { from: 'WARN', to: 'LIMP', when: (i) => sev[lvl(i)] >= sev.LIMP, label: 'degrade' },
      { from: 'WARN', to: 'OK', when: clear, label: 'clear' },
      { from: 'LIMP', to: 'OK', when: clear, label: 'clear' },
      { from: 'STOP', to: 'OK', when: clear, label: 'clear' },
      { from: 'LATCH', to: 'BOOT', when: (i) => i.reset, label: 'reset' },
    ],
  }
}

/** Battery sags under load: ~0.3 V at full current. */
const sag = (amps: number) => 0.12 * amps

/** Scripted inputs for a scenario at time t (motor current from the speed the robot is allowed). */
function faultInputs(sc: FaultScenario, t: number, cap: number) {
  const run = cap * FAULT.v
  let amps = 0.3 + 1.6 * run
  let rest = 8.2
  let sensorAge = 0.02
  let commsAge = 0.03
  if (sc === 'battery') rest = 8.2 - 0.17 * t
  if (sc === 'stall' && t >= 3 && t < 7) amps = cap > 0 ? 3.6 : 0.3
  if (sc === 'sensor') sensorAge = t >= 2.5 && t < 3.5 ? t - 2.5 : t >= 6 && t < 8.5 ? t - 6 : 0.02
  if (sc === 'comms') commsAge = t >= 2.5 && t < 2.8 ? t - 2.5 : t >= 5 && t < 7 ? t - 5 : 0.03
  return { battV: rest - sag(amps), amps, sensorAge, commsAge }
}

export interface FaultFrame extends FaultIn {
  t: number
  state: FaultState
  edge: number
  cause: string
  cap: number
  v: number
}

export function faultFsmRun(sc: FaultScenario, latch: boolean) {
  const m = faultMachine(latch)
  const frames: FaultFrame[] = []
  let state: FaultState = m.start
  let overFor = 0
  let clearFor = 0
  let v = 0
  for (let k = 0; k <= Math.round(FAULT.seconds / FAULT.dt); k++) {
    const t = k * FAULT.dt
    const raw = faultInputs(sc, t, FAULT_CAP[state])
    overFor = raw.amps > FAULT.overA ? overFor + FAULT.dt : 0
    const probe: FaultIn = { ...raw, overFor, clearFor, reset: t >= FAULT.resetAt && t < FAULT.resetAt + FAULT.dt * 1.5 }
    const f = faultLevel(probe)
    clearFor = f.level === 'OK' ? clearFor + FAULT.dt : 0
    const input = { ...probe, clearFor }
    const r = fsmStep(m, state, input)
    state = r.state
    const cap = FAULT_CAP[state]
    v = rampTo(v, cap * FAULT.v * (raw.amps > FAULT.overA ? 0 : 1), 2, FAULT.dt)
    frames.push({ ...input, t, state, edge: r.edge, cause: over(input) ? 'motor stalled' : f.cause, cap, v })
  }
  return { machine: m, frames }
}
