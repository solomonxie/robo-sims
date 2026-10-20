// Motor driver puzzles: pin levels → H-bridge mode on four drivers; PWM duty and frequency for a target wheel speed under load.
import { BridgeMode, Closed, DRIVERS, DriverChip, HBRIDGE, bridgeAmps, bridgeMode, bridgeRun, closed, decayCurrent, shortedLegs, stopTime } from '../actuators/hbridge'
import { GEARBOXES, RPM_PER_RADS, TT_CAR, TT_GEAR, TT_MOTOR, backEmf, freeSpeed, frictionNm, gearEfficiency, gearRatio, motorK } from '../actuators/dcmotor'
import { audible, ledcResolution } from '../mcu/pwm'
import { ROLL_FLOORS, wheelSpeedSs } from '../control/loop'
import { drvMode } from '../projects/robocar'
import { G, bisectEdge, clamp01 } from '../common'
import { puzzleVerdict, targetWindow, windowMiss } from './verdict'

// --- Truth table challenge ---

export type BridgeChip = DriverChip | 'fets'
/** Pins 1–4 per chip (null = not on this chip). */
export const BRIDGE_PINS: Record<BridgeChip, { name: string; pins: (string | null)[] }> = {
  l298n: { name: 'L298N', pins: ['IN1', 'IN2', 'ENA', null] },
  tb6612: { name: 'TB6612FNG', pins: ['AIN1', 'AIN2', 'PWMA', 'STBY'] },
  drv8833: { name: 'DRV8833', pins: ['IN1', 'IN2', 'nSLEEP', null] },
  fets: { name: '4-FET bridge (pin per gate)', pins: ['Q1', 'Q2', 'Q3', 'Q4'] },
}
export type BridgeGoal = Exclude<BridgeMode, 'shoot'>
export const BRIDGE_GOALS: Record<BridgeGoal, { name: string }> = {
  forward: { name: 'Forward' },
  reverse: { name: 'Reverse' },
  brake: { name: 'Brake (fast stop)' },
  coast: { name: 'Coast (free stop)' },
}
export type Pins = [boolean, boolean, boolean, boolean]

/** What the chip's bridge does with these pin levels: closed switches, mode, and whether the channel is switched off. */
export function pinBridge(chip: BridgeChip, p: Pins): { c: Closed; mode: BridgeMode; off: boolean } {
  const [a, b, x, y] = p
  if (chip === 'fets') {
    const c = closed(...(['q1', 'q2', 'q3', 'q4'] as const).filter((_, k) => p[k]))
    return { c, mode: bridgeMode(c), off: false }
  }
  const off = chip === 'tb6612' ? !y : !x
  let mode: BridgeGoal
  if (off) mode = 'coast'
  else if (chip === 'drv8833') mode = drvMode(a, b)
  else if (chip === 'l298n') mode = a === b ? 'brake' : a ? 'forward' : 'reverse'
  else mode = a && b ? 'brake' : !a && !b ? 'coast' : !x ? 'brake' : a ? 'forward' : 'reverse'
  const highBrake = chip === 'l298n' && a && b
  const c = mode === 'forward' ? closed('q1', 'q4') : mode === 'reverse' ? closed('q3', 'q2') : mode === 'brake' ? (highBrake ? closed('q1', 'q3') : closed('q2', 'q4')) : closed()
  return { c, mode, off }
}

/** Pack behind the bridge less the chip's drop at the motor's no-load current. */
const bridgeVolts = (chip: BridgeChip) => HBRIDGE.vs - (chip === 'fets' ? 0 : DRIVERS[chip].drop(TT_MOTOR.noLoadA))

const STOPS = new Map<number, { brakeS: number; coastS: number }>()
/** From free speed at `vs`: time to stop shorted (brake) vs open (coast); cached per voltage. */
function stopTimes(vs: number) {
  let s = STOPS.get(vs)
  if (!s) STOPS.set(vs, (s = { brakeS: stopTime(bridgeRun(closed('q2', 'q4'), 0.6, 0.002, vs), vs), coastS: stopTime(bridgeRun(closed(), 0.6, 0.002, vs), vs) }))
  return s
}

type TruthFail = 'shoot' | 'off' | 'mode'
const isStop = (m: BridgeMode) => m === 'brake' || m === 'coast'

/** Set the pins for `goal`: short through a leg fails first, then a switched-off channel, then the wrong mode. */
export function truthChallenge(chip: BridgeChip, goal: BridgeGoal, pins: Pins) {
  const { c, mode, off } = pinBridge(chip, pins)
  const vs = bridgeVolts(chip)
  const amps = bridgeAmps(c, 0, vs)
  const run = bridgeRun(c, 0.6, 0.002, vs)
  const peakA = Math.max(...run.map((f) => Math.abs(f.motorA)))
  const { brakeS, coastS } = stopTimes(vs)
  const verdict = puzzleVerdict<TruthFail>([
    { id: 'shoot', ok: shortedLegs(c) === 0 },
    { id: 'off', ok: !off || goal === 'coast', near: goal === 'brake' },
    { id: 'mode', ok: mode === goal, near: isStop(mode) && isStop(goal) },
  ])
  return { c, mode, off, vs, freeRadS: freeSpeed(vs), shootA: amps.shootA, fetW: amps.fetW, run, peakA, stopS: isStop(mode) ? stopTime(run, vs) : Infinity, brakeS, coastS, verdict }
}

// --- PWM speed target ---

export const PWM_PUZZLE = { tol: 0.05, maxDuty: 0.9 }
export const PWM_PACKS = {
  nimh4: { name: '4 × NiMH 4.8 V', volts: 4.8 },
  aa4: { name: '4 × AA 6.0 V', volts: 6 },
  li2: { name: '2S Li-ion 7.4 V', volts: 7.4 },
}
export type PwmPack = keyof typeof PWM_PACKS
export const PWM_LOADS = {
  tile: { name: 'Empty car on tile', payloadKg: 0, crr: ROLL_FLOORS.tile.crr },
  wood: { name: '+0.5 kg on wood', payloadKg: 0.5, crr: ROLL_FLOORS.wood.crr },
  carpet: { name: 'Empty car on carpet', payloadKg: 0, crr: ROLL_FLOORS.carpet.crr },
}
export type PwmLoad = keyof typeof PWM_LOADS
export const PWM_TARGETS = { crawl: { name: 'Crawl 40 rpm', rpm: 40 }, cruise: { name: 'Cruise 110 rpm', rpm: 110 }, fast: { name: 'Fast 160 rpm', rpm: 160 } }
export type PwmTarget = keyof typeof PWM_TARGETS

/** Motor current while rolling: friction plus the load reflected through 1:48 (the same at any speed). */
function rollingAmps(load: PwmLoad) {
  const l = PWM_LOADS[load]
  const g = GEARBOXES.tt48
  const loadNm = ((TT_CAR.massKg + l.payloadKg) * G * l.crr * TT_CAR.wheelM) / TT_CAR.driven / (gearRatio(g) * gearEfficiency(g))
  return (loadNm + frictionNm()) / motorK()
}

/** Wheel rpm at `duty`: the motor sees duty × (pack − driver drop at the rolling current); 0 inside the deadband. */
export function pwmRpm(chip: DriverChip, pack: PwmPack, load: PwmLoad, duty: number) {
  const l = PWM_LOADS[load]
  const drop = DRIVERS[chip].drop(rollingAmps(load))
  const motorV = clamp01(duty) * Math.max(0, PWM_PACKS[pack].volts - drop)
  return { drop, motorV, rpm: (wheelSpeedSs(motorV, l.payloadKg, l.crr) / TT_CAR.wheelM) * RPM_PER_RADS }
}

/** Smallest duty whose speed passes `rpm` (bisection; 1 if it never does). */
function dutyFor(chip: DriverChip, pack: PwmPack, load: PwmLoad, rpm: number) {
  if (pwmRpm(chip, pack, load, 1).rpm <= rpm) return 1
  return bisectEdge((d) => pwmRpm(chip, pack, load, d).rpm > rpm, 1, 0, 30)
}

/** One PWM period of motor current (slow decay) at wheel `rpm`: samples from the on-edge, mean and peak-to-peak ripple. */
function pwmWave(volts: number, duty: number, hz: number, rpm: number) {
  const w = decayCurrent('slow', duty, hz, backEmf((rpm / RPM_PER_RADS) * TT_GEAR), volts, 60)
  return { wave: w.amps, meanA: w.mean, rippleA: w.ripple }
}

type PwmFail = 'reach' | 'stall' | 'slow' | 'fast' | 'headroom' | 'whine'

/** Hit the target ±5 % open loop, leave headroom (≤ 90 %) for sag and slopes, and switch above hearing. */
export function pwmTarget(chip: DriverChip, pack: PwmPack, load: PwmLoad, target: PwmTarget, duty: number, hz: number) {
  const want = PWM_TARGETS[target].rpm
  const [lo, hi] = targetWindow(want, PWM_PUZZLE.tol)
  const now = pwmRpm(chip, pack, load, duty)
  const maxRpm = pwmRpm(chip, pack, load, 1).rpm
  const amps = now.rpm > 0 ? rollingAmps(load) : now.motorV / TT_MOTOR.ohms
  const side = windowMiss(now.rpm, lo, hi)
  const verdict = puzzleVerdict<PwmFail>([
    { id: 'reach', ok: maxRpm >= lo, near: maxRpm >= 0.85 * lo },
    { id: 'stall', ok: now.rpm > 0 },
    { id: 'slow', ok: side.side >= 0, near: side.miss < 0.15 },
    { id: 'fast', ok: side.side <= 0, near: side.miss < 0.15 },
    { id: 'headroom', ok: duty <= PWM_PUZZLE.maxDuty + 1e-9, near: true },
    { id: 'whine', ok: !audible(hz), near: true },
  ])
  return {
    ...now,
    amps,
    want,
    window: [lo, hi] as [number, number],
    maxRpm,
    startDuty: dutyFor(chip, pack, load, 0),
    needDuty: dutyFor(chip, pack, load, want),
    ...pwmWave(PWM_PACKS[pack].volts - now.drop, duty, hz, now.rpm),
    bits: ledcResolution(hz),
    audible: audible(hz),
    verdict,
  }
}
