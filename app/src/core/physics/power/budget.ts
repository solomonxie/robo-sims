// Power budget of a small robot car: loads per rail, pack-side draw with converter and driver losses, duty cycles and runtime.
import { Chemistry, deliveredWh } from './batteries'
import { DcdcModule, DcdcPoint, LM2596, dcdcPoint } from './converters'
import { TT_MOTOR } from '../electromechanical'

export type RobotState = 'cut' | 'sleep' | 'idle' | 'scan' | 'cruise' | 'stall'
export type LoadId = 'esp32' | 'sonar' | 'servo' | 'driver' | 'motors'
export type LoadAmps = Record<LoadId, number>
export type ItemId = 'esp32' | 'sonar' | 'servo' | 'motors' | 'buck' | 'l298n'

export const LOGIC_V = 5
export const LOGIC_LOADS: LoadId[] = ['esp32', 'sonar', 'servo']

/** Typical draw in each state (A). ESP32 DevKit: 8 mA asleep (LED, USB-UART, LDO; the bare chip needs 10 µA),
 *  50 mA busy with WiFi off, 120 mA average connected. SG90: 6 mA holding, 250 mA sweeping. L298N: 36 mA for its logic. */
const DRAW: Record<RobotState, Omit<LoadAmps, 'motors'>> = {
  cut: { esp32: 0.008, sonar: 0, servo: 0, driver: 0 },
  sleep: { esp32: 0.008, sonar: 0.002, servo: 0.006, driver: 0.036 },
  idle: { esp32: 0.12, sonar: 0.002, servo: 0.006, driver: 0.036 },
  scan: { esp32: 0.12, sonar: 0.015, servo: 0.25, driver: 0.036 },
  cruise: { esp32: 0.12, sonar: 0.015, servo: 0.006, driver: 0.036 },
  stall: { esp32: 0.12, sonar: 0.015, servo: 0.006, driver: 0.036 },
}

/** ESP32 transmit bursts reach ~350 mA. */
export const WIFI_PEAK_A = 0.35
/** One TT motor driving the car on the floor. */
export const TT_CRUISE_A = 0.25

/** L298N bridge (two bipolar drops per channel) at `amps` through one motor. */
export const l298nDrop = (amps: number) => (amps > 0 ? 1.4 + 0.6 * amps : 0)

/** One TT motor stalled behind an L298N: I = (V − 1.4) / (R + 0.6). */
export const ttStallAmps = (vpack: number) => Math.max(0, vpack - 1.4) / (TT_MOTOR.ohms + 0.6)

export function stateAmps(state: RobotState, vpack: number): LoadAmps {
  const motors = state === 'stall' ? 2 * ttStallAmps(vpack) : state === 'cruise' ? 2 * TT_CRUISE_A : 0
  return { ...DRAW[state], motors }
}

/** Motor current after a start at t = 0 (s). Hard start: stall current, falling as the motor spins up (τ).
 *  Soft start: PWM ramps the voltage over `rampS`, so the back-EMF keeps up and the excess stays small. */
export function startAmps(t: number, stallA: number, cruiseA: number, rampS: number, tau = 0.15) {
  if (t < 0) return 0
  const excess = stallA - cruiseA
  if (rampS <= 0) return cruiseA + excess * Math.exp(-t / tau)
  const lag = (excess / rampS) * tau
  const over = t < rampS ? lag * (1 - Math.exp(-t / tau)) : lag * (1 - Math.exp(-rampS / tau)) * Math.exp(-(t - rampS) / tau)
  return cruiseA * Math.min(1, t / rampS) + over
}

export interface BudgetItem {
  id: ItemId
  /** Power taken from the pack (W) and its share of the pack current (A). */
  watts: number
  packA: number
}

export interface Budget {
  vpack: number
  logicA: number
  motorA: number
  conv: DcdcPoint
  packA: number
  packW: number
  items: BudgetItem[]
}

/** Pack-side view: logic loads on a buck-made 5 V rail, motors and the L298N straight off the pack.
 *  Losses get their own items, so the items sum to the pack power. */
export function budgetOf(a: LoadAmps, vpack: number, m: DcdcModule = LM2596): Budget {
  const logicA = LOGIC_LOADS.reduce((s, id) => s + a[id], 0)
  const conv = dcdcPoint(m, vpack, LOGIC_V, logicA)
  const drop = l298nDrop(a.motors / 2)
  const motorA = a.motors + a.driver
  const watts: Record<ItemId, number> = {
    esp32: conv.vout * a.esp32,
    sonar: conv.vout * a.sonar,
    servo: conv.vout * a.servo,
    motors: Math.max(0, vpack - drop) * a.motors,
    buck: conv.loss,
    l298n: drop * a.motors + vpack * a.driver,
  }
  const packA = conv.iin + motorA
  const items = (Object.keys(watts) as ItemId[]).map((id) => ({ id, watts: watts[id], packA: watts[id] / vpack }))
  return { vpack, logicA, motorA, conv, packA, packW: vpack * packA, items }
}

/** Terminal voltage when the load's draw depends on it: V = OCV − I(V)·R, iterated to a fixed point. */
export function sagged(ocv: number, ohms: number, draw: (v: number) => number, rounds = 30) {
  let v = ocv
  for (let k = 0; k < rounds; k++) v = 0.5 * v + 0.5 * (ocv - ohms * draw(v))
  return v
}

/** Budget at a pack with internal resistance: sag and draw agree. */
export function budgetAt(ocv: number, ohms: number, amps: (v: number) => LoadAmps, m: DcdcModule = LM2596): Budget {
  const v = sagged(ocv, ohms, (x) => budgetOf(amps(x), x, m).packA)
  return budgetOf(amps(v), v, m)
}

/** Time-weighted mix of budgets, e.g. [[0.2, driving], [0.8, asleep]]. */
export function averageBudget(parts: [number, Budget][]): { packW: number; items: BudgetItem[] } {
  const total = parts.reduce((s, [f]) => s + f, 0)
  const items = parts[0][1].items.map((it, k) => {
    const watts = parts.reduce((s, [f, b]) => s + f * b.items[k].watts, 0) / total
    const packA = parts.reduce((s, [f, b]) => s + f * b.items[k].packA, 0) / total
    return { id: it.id, watts, packA }
  })
  return { packW: items.reduce((s, it) => s + it.watts, 0), items }
}

/** Runtime of a series × parallel pack at a steady `watts`: usable Wh at that per-cell current, over the power. */
export function packRuntime(c: Chemistry, series: number, parallel: number, watts: number) {
  const cellA = watts / (series * c.nominal) / parallel
  const wh = series * parallel * deliveredWh(c, cellA)
  return { wh, hours: watts > 0 ? wh / watts : Infinity }
}

/** A looping 8 s errand: park, drive, stop and scan, drive on. WiFi publishes a burst once a second. */
export const MISSION_S = 8
const LEGS: [number, RobotState][] = [[0, 'idle'], [1, 'cruise'], [4, 'scan'], [5.5, 'cruise'], [7.5, 'idle']]
export function missionState(t: number): { state: RobotState; since: number } {
  const u = ((t % MISSION_S) + MISSION_S) % MISSION_S
  let leg = LEGS[0]
  for (const l of LEGS) if (l[0] <= u) leg = l
  return { state: leg[1], since: u - leg[0] }
}

/** Load currents at time `t` of the errand with motor starts ramped over `rampS` (0 = hard). */
export function missionAmps(t: number, vpack: number, rampS: number): LoadAmps {
  const { state, since } = missionState(t)
  const a = stateAmps(state, vpack)
  const u = ((t % 1) + 1) % 1
  if (u < 0.06) a.esp32 = WIFI_PEAK_A
  if (state === 'cruise') a.motors = 2 * startAmps(since, ttStallAmps(vpack), TT_CRUISE_A, rampS)
  return a
}
