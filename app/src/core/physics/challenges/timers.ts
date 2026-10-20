// Timing puzzles: a 555 astable that blinks at 1 Hz, an RC + input debounce for a bouncy switch.
import { electrolyticLeakage } from '../circuits'
import { SCHMITT_HI, SCHMITT_LO, SWITCHES, bounceEdges, bouncedState, rcDebounceStep, schmittHigh } from '../electromechanical'
import { LOGIC_INPUTS, readInput, thresholds } from '../levels'
import { DIODES, diodeVolts } from '../semiconductors'
import { safeLed } from './leds'
import { puzzleVerdict, targetWindow, windowMiss } from './verdict'

// --- Blink at 1 Hz: NE555 astable ---

/** Bipolar NE555 on 5 V: trigger at ⅓, threshold at ⅔ of VCC. */
export const NE555 = {
  vcc: 5,
  lo: 1 / 3,
  hi: 2 / 3,
  /** Output HIGH sits ~1.5 V under VCC at 10–20 mA (Darlington source). */
  outDropV: 1.5,
  /** Discharge pin sinks VCC / R1 while the cap empties: keep it ≤ 5 mA. */
  minR1: 1e3,
}

export const BLINK_PUZZLE = {
  tol: 0.1,
  /** Metal-film resistors. */
  rTol: 0.01,
  /** Electrolytic leakage must stay under this share of the charge current at the threshold. */
  leakShare: 0.1,
  /** Film caps past this are bricks. */
  filmMaxF: 10e-6,
}

export const BLINK_CAPS = {
  electrolytic: { name: 'Electrolytic ±20 %', tol: 0.2 },
  film: { name: 'Film ±5 %', tol: 0.05 },
}
export type BlinkCap = keyof typeof BLINK_CAPS

export const BLINK_GOALS = {
  even: { name: '1 Hz, even blink', hz: 1, duty: [0.45, 0.6] as [number, number] },
  flash: { name: '1 Hz, short flash', hz: 1, duty: [0.1, 0.25] as [number, number] },
  beacon: { name: '1 Hz, mostly on', hz: 1, duty: [0.75, 0.9] as [number, number] },
}
export type BlinkGoal = keyof typeof BLINK_GOALS

/** 555 astable: the cap charges through R1 + R2 (or R1 + a diode bypassing R2) from ⅓ to ⅔ VCC, output HIGH; it empties
 *  through R2 into DIS from ⅔ to ⅓, output LOW. t_H = τ_c·ln((V_t − ⅓V)/(V_t − ⅔V)), t_L = R2·C·ln 2. */
export function astable555(r1: number, r2: number, farads: number, diode: boolean, vcc = NE555.vcc) {
  const vd = diode ? diodeVolts((vcc / 2 - 0.6) / r1, DIODES['1N4148']) : 0
  const vt = vcc - vd
  const tauC = (diode ? r1 : r1 + r2) * farads
  const tauD = r2 * farads
  const [vLo, vHi] = [NE555.lo * vcc, NE555.hi * vcc]
  const tH = vt > vHi ? tauC * Math.log((vt - vLo) / (vt - vHi)) : Infinity
  const tL = tauD * Math.log(vHi / vLo)
  const tFirst = vt > vHi ? tauC * Math.log(vt / (vt - vHi)) : Infinity
  const period = tH + tL
  return { vcc, vd, vt, tauC, tauD, vLo, vHi, tH, tL, tFirst, period, hz: 1 / period, duty: tH / period, chargeA: (vt - vHi) / (diode ? r1 : r1 + r2) }
}
export type Astable = ReturnType<typeof astable555>

/** Cap voltage and output at time t after power-up: the first charge starts from 0 V (so the first HIGH is longer). */
export function astableAt(a: Astable, t: number) {
  if (t < a.tFirst) return { vc: a.vt - a.vt * Math.exp(-t / a.tauC), high: true }
  const u = (t - a.tFirst) % a.period
  if (u < a.tL) return { vc: a.vHi * Math.exp(-u / a.tauD), high: false }
  return { vc: a.vt - (a.vt - a.vLo) * Math.exp(-(u - a.tL) / a.tauC), high: true }
}

export type BlinkFail = 'discharge' | 'slow' | 'fast' | 'duty' | 'leak' | 'bulky' | 'spread' | 'led'

/** Blink the LED at the goal ±10 %, with its duty, on any parts in tolerance; a red LED off the output through `rLed`. */
export function blinkChallenge(goal: BlinkGoal, r1: number, r2: number, farads: number, cap: BlinkCap, diode: boolean, rLed: number) {
  const g = BLINK_GOALS[goal]
  const a = astable555(r1, r2, farads, diode)
  const window = targetWindow(g.hz, BLINK_PUZZLE.tol)
  const { rTol } = BLINK_PUZZLE
  const cTol = BLINK_CAPS[cap].tol
  const corners: [number, number] = [
    astable555(r1 * (1 + rTol), r2 * (1 + rTol), farads * (1 + cTol), diode).hz,
    astable555(r1 * (1 - rTol), r2 * (1 - rTol), farads * (1 - cTol), diode).hz,
  ]
  const leakA = cap === 'electrolytic' ? electrolyticLeakage(farads, a.vcc) : 0
  const voh = a.vcc - NE555.outDropV
  const led = safeLed('red', voh, rLed)
  const f = windowMiss(a.hz, ...window)
  const d = windowMiss(a.duty, ...g.duty)
  const verdict = puzzleVerdict<BlinkFail>([
    { id: 'discharge', ok: r1 >= NE555.minR1 },
    { id: 'slow', ok: f.side >= 0, near: f.miss < 0.3 },
    { id: 'fast', ok: f.side <= 0, near: f.miss < 0.3 },
    { id: 'duty', ok: d.side === 0, near: d.miss < 0.25 },
    { id: 'leak', ok: leakA <= BLINK_PUZZLE.leakShare * a.chargeA, near: true },
    { id: 'bulky', ok: cap !== 'film' || farads <= BLINK_PUZZLE.filmMaxF * 1.001, near: true },
    { id: 'spread', ok: corners[0] >= window[0] && corners[1] <= window[1], near: true },
    { id: 'led', ok: led.verdict.pass, near: led.verdict.near },
  ])
  return { ...a, window, corners, leakA, dischargeA: a.vcc / r1, voh, led, verdict }
}

// --- Debounce time: pull-up, cap and an input that turns a bouncy press into one clean edge ---

export const DEBOUNCE_PUZZLE = {
  vdd: 3.3,
  /** Switch → cap resistor: limits the discharge spike, sets the press τ. */
  dischargeOhms: 1e3,
  /** Press at 5 ms, held 50 ms, run until 50 ms after the release. */
  pressS: 5e-3,
  holdS: 50e-3,
  tailS: 50e-3,
  dt: 2.5e-6,
  /** CMOS inputs want edges faster than this (74HC: ≤ 0.5 µs at 4.5 V); slower ones can chatter without hysteresis. */
  slowEdgeS: 1e-6,
}
const DP = DEBOUNCE_PUZZLE

export const DEBOUNCE_GOALS = {
  tact: { name: 'Tactile button, 10 ms', part: 'tact' as const, respondS: 10e-3 },
  toggle: { name: 'Toggle switch, 20 ms', part: 'toggle' as const, respondS: 20e-3 },
  worn: { name: 'Worn button, 20 ms', part: 'worn' as const, respondS: 20e-3 },
  game: { name: 'Game button, 3 ms', part: 'tact' as const, respondS: 3e-3 },
}
export type DebounceGoal = keyof typeof DEBOUNCE_GOALS

export const DEBOUNCE_INPUTS = {
  hc14: { name: '74HC14 Schmitt' },
  gpio: { name: 'ESP32 pin direct' },
}
export type DebounceInput = keyof typeof DEBOUNCE_INPUTS

/** The input's thresholds in volts: Schmitt rising / falling points, or a plain pin's VIL / VIH (between = undefined). */
export function debounceLevels(input: DebounceInput, vdd = DP.vdd) {
  if (input === 'hc14') return { lo: SCHMITT_LO * vdd, hi: SCHMITT_HI * vdd }
  const t = thresholds(LOGIC_INPUTS.esp32, vdd)
  return { lo: t.vil, hi: t.vih }
}

/** One press and release of the goal's switch through pull-up `pullOhms`, `farads` on the node, read by `input`.
 *  `vc`/`made`/`pressed` per dt step (pressed = the input reads the node LOW); the plain pin holds its last level inside
 *  the undefined band, and `dwellS` is the longest stretch spent there. */
export function debounceRun(goal: DebounceGoal, input: DebounceInput, pullOhms: number, farads: number) {
  const part = SWITCHES[DEBOUNCE_GOALS[goal].part]
  const releaseS = DP.pressS + DP.holdS
  const make = bounceEdges(part.makeS, part.bounces, 3).map((e) => e + DP.pressS)
  const brk = bounceEdges(part.breakS, Math.max(1, Math.round(part.bounces / 3)), 10).map((e) => e + releaseS)
  const n = Math.round((releaseS + DP.tailS) / DP.dt)
  const vc = new Float32Array(n)
  const made = new Uint8Array(n)
  const pressed = new Uint8Array(n)
  let v = DP.vdd
  let high = true
  let presses = 0
  let pressLag = NaN
  let releaseLag = NaN
  let dwell = 0
  let dwellS = 0
  for (let k = 0; k < n; k++) {
    const t = k * DP.dt
    const closed = t < releaseS ? bouncedState(t, make, false) : bouncedState(t, brk, true)
    v = rcDebounceStep(v, closed, DP.vdd, pullOhms, DP.dischargeOhms, farads, DP.dt)
    if (input === 'hc14') high = schmittHigh(high, v, DP.vdd)
    else {
      const r = readInput(v, LOGIC_INPUTS.esp32, DP.vdd)
      dwell = r === null ? dwell + DP.dt : 0
      dwellS = Math.max(dwellS, dwell)
      if (r !== null) high = r === 1
    }
    vc[k] = v
    made[k] = closed ? 1 : 0
    pressed[k] = high ? 0 : 1
    if (k && pressed[k] && !pressed[k - 1]) {
      presses++
      if (Number.isNaN(pressLag)) pressLag = t - DP.pressS
    }
    if (k && !pressed[k] && pressed[k - 1] && t >= releaseS) releaseLag = t - releaseS
  }
  return { part, make, brk, releaseS, n, vc, made, pressed, presses, pressLag, releaseLag, dwellS }
}

export type DebounceFail = 'level' | 'missed' | 'bounce' | 'slow' | 'chatter'

/** One clean press per press, read within the goal's response time; a plain pin also needs fast edges. */
export function debounceChallenge(goal: DebounceGoal, input: DebounceInput, pullOhms: number, farads: number) {
  const g = DEBOUNCE_GOALS[goal]
  const run = debounceRun(goal, input, pullOhms, farads)
  const levels = debounceLevels(input)
  const pressedV = (DP.vdd * DP.dischargeOhms) / (pullOhms + DP.dischargeOhms)
  const lagS = Math.max(run.pressLag, Number.isNaN(run.releaseLag) ? Infinity : run.releaseLag)
  const tauRelease = pullOhms * farads
  const verdict = puzzleVerdict<DebounceFail>([
    { id: 'level', ok: pressedV < levels.lo },
    { id: 'missed', ok: run.presses > 0 },
    { id: 'bounce', ok: run.presses === 1, near: run.presses === 2 },
    { id: 'slow', ok: lagS <= g.respondS, near: lagS <= 2 * g.respondS },
    { id: 'chatter', ok: input === 'hc14' || run.dwellS <= DP.slowEdgeS, near: true },
  ])
  return { ...run, levels, pressedV, lagS, tauRelease, tauPress: ((pullOhms * DP.dischargeOhms) / (pullOhms + DP.dischargeOhms)) * farads, respondS: g.respondS, verdict }
}
