// Firmware structure: super-loop vs RTOS tasks, layered drivers, a fixed-rate control loop.
import { clamp } from '../common'
import { l298nDrop } from '../power/budget'
import { echoSeconds } from '../sensors/ultrasonic'
import { TOF_MODES } from '../sensors/tof'
import { dutyCounts } from './pwm'
import { SimSpec, simulate } from './rtos'

// --- Super-loop vs RTOS: read → compute → drive every 10 ms, telemetry sometimes blocks on Wi-Fi. ---

export type FwStep = 'read' | 'compute' | 'drive' | 'telemetry' | 'stall'
/** Per-tick slot of one lane: a step, `ready` (preempted / waiting for the CPU) or idle (null). */
export type FwSlot = FwStep | 'ready' | null
export const FW_PERIOD = 10
export const FW_TICKS = 80
export const TELEMETRY_MS = 2
/** Every 3rd telemetry send finds the Wi-Fi buffer full and waits `stall` ms. */
export const STALL_EVERY = 3

export interface FwRun {
  lanes: FwSlot[][]
  /** Tick at which each motor command went out. */
  drives: number[]
}

const stallsOn = (k: number) => k % STALL_EVERY === STALL_EVERY - 1

/** One loop(): read, compute, drive, then telemetry, paced to start every 10 ms but never before the last pass ends. */
export function superLoopRun(stall: number, ticks = FW_TICKS): FwRun {
  const lane: FwSlot[] = Array(ticks).fill(null)
  const drives: number[] = []
  let start = 0
  for (let k = 0; start < ticks; k++) {
    const steps: FwStep[] = ['read', 'compute', 'drive', ...Array<FwStep>(TELEMETRY_MS).fill('telemetry'), ...Array<FwStep>(stallsOn(k) ? stall : 0).fill('stall')]
    steps.forEach((s, i) => start + i < ticks && (lane[start + i] = s))
    if (start + 3 <= ticks) drives.push(start + 3)
    start = Math.max(start + FW_PERIOD, start + steps.length)
  }
  return { lanes: [lane], drives }
}

/** Same work as two FreeRTOS tasks on one core: control (prio 5, vTaskDelayUntil 10 ms) and telemetry (prio 1). */
export function firmwareTasksScene(stall: number, ticks = FW_TICKS): SimSpec {
  const tel = (k: number) => [
    { op: 'run' as const, ticks: TELEMETRY_MS + (stallsOn(k) ? stall : 0) },
    { op: 'until' as const, period: FW_PERIOD },
  ]
  return {
    ticks,
    tasks: [
      { name: 'control', prio: 5, core: 1, ops: [{ op: 'run', ticks: 3 }, { op: 'until', period: FW_PERIOD }] },
      { name: 'telemetry', prio: 1, core: 1, start: 3, ops: [0, 1, 2].flatMap(tel) },
    ],
  }
}

export function rtosFirmwareRun(stall: number, ticks = FW_TICKS): FwRun {
  const r = simulate(firmwareTasksScene(stall, ticks))
  const ctl: FwSlot[] = []
  const tel: FwSlot[] = []
  const drives: number[] = []
  let c = 0
  let job = 0
  let s = 0
  r.state.forEach((st, t) => {
    if (st[0] === 'run') {
      ctl.push((['read', 'compute', 'drive'] as const)[c % 3])
      if (++c % 3 === 0) drives.push(t + 1)
    } else ctl.push(st[0] === 'ready' ? 'ready' : null)
    if (st[1] === 'run') {
      tel.push(s++ < TELEMETRY_MS ? 'telemetry' : 'stall')
      if (s >= TELEMETRY_MS + (stallsOn(job) ? stall : 0)) [job, s] = [job + 1, 0]
    } else tel.push(st[1] === 'ready' ? 'ready' : null)
  })
  return { lanes: [ctl, tel], drives }
}

/** Gaps between motor commands, ms. */
export const controlGaps = (drives: number[]) => drives.slice(1).map((t, i) => t - drives[i])

/** Speed setpoint the control step wants at tick `t` (one 80 ms weave). */
export const FW_WAVE = 80
export const setpointAt = (t: number) => Math.sin((2 * Math.PI * t) / FW_WAVE)

/** What the motors actually get at tick `t`: the setpoint computed at the last command, held until the next. */
export function heldCommand(drives: number[], t: number) {
  const last = drives.filter((d) => d <= t).pop()
  return last === undefined ? 0 : setpointAt(last - 1)
}

/** Worst |held − wanted| over the run. */
export function commandError(r: FwRun, ticks = FW_TICKS) {
  let worst = 0
  for (let t = r.drives[0]; t < ticks; t++) worst = Math.max(worst, Math.abs(heldCommand(r.drives, t) - setpointAt(t)))
  return worst
}

// --- Hardware abstraction: app → interface → driver → HAL → registers. ---

export type MotorChip = 'l298n' | 'tb6612' | 'mock'
export type RangeChip = 'vl53' | 'hcsr04' | 'mock'
export const HAL_LAYERS = ['app', 'interface', 'driver', 'hal', 'registers'] as const
export type HalLayer = (typeof HAL_LAYERS)[number]
export const MOTOR_SPEED = 0.6
export const PACK_V = 7.4
export const RANGE_M = 0.42

/** TB6612FNG: MOSFET bridge, ≈ 0.5 Ω high + low side per channel. */
export const tb6612Drop = (amps: number) => 0.5 * amps

/** Volts across the motor at `duty` from the pack, after the bridge drop. */
export function motorVolts(chip: MotorChip, duty: number, amps = 0.25) {
  if (chip === 'mock') return 0
  const drop = chip === 'l298n' ? l298nDrop(amps) : tb6612Drop(amps)
  return clamp(duty, 0, 1) * Math.max(0, PACK_V - drop)
}

/** One line of code per layer for `motor.set(speed)`. */
export function motorStack(chip: MotorChip, speed = MOTOR_SPEED): Record<HalLayer, string> {
  const duty = dutyCounts(speed, 8)
  const driver = {
    l298n: `L298N::set(): digitalWrite(IN1, 1); digitalWrite(IN2, 0); ledcWrite(ENA, ${duty})`,
    tb6612: `TB6612::set(): digitalWrite(STBY, 1); digitalWrite(AIN1, 1); digitalWrite(AIN2, 0); ledcWrite(PWMA, ${duty})`,
    mock: `MockMotor::set(): calls.push_back(${speed})  // no hardware`,
  }[chip]
  return {
    app: `left.set(${speed});`,
    interface: 'struct Motor { virtual void set(float speed) = 0; };',
    driver,
    hal: 'digitalWrite(pin, level) · ledcWrite(channel, duty)',
    registers: `GPIO_OUT_W1TS = 1 << pin · LEDC_CH0_DUTY = ${duty} << 4`,
  }
}

/** One line of code per layer for `range.read()`. */
export function rangeStack(chip: RangeChip, m = RANGE_M): Record<HalLayer, string> {
  const mm = Math.round(m * 1000)
  const us = Math.round(echoSeconds(m, 20) * 1e6)
  const driver = {
    vl53: `VL53L0X::read(): Wire.requestFrom(0x29, 2) → ${mm} mm`,
    hcsr04: `HcSr04::read(): pulse TRIG 10 µs; pulseIn(ECHO) = ${us} µs → ${mm} mm`,
    mock: `MockRange::read(): return script[i++];  // ${mm} mm`,
  }[chip]
  return {
    app: 'if (front.read() < 200) stop();',
    interface: 'struct Range { virtual int read() = 0; };  // mm',
    driver,
    hal: 'Wire.requestFrom(addr, n) · digitalWrite · pulseIn(pin)',
    registers: 'I2C_FIFO_DATA · GPIO_IN_REG · TIMG0 counter',
  }
}

/** Layers whose code differs between two stacks. */
export const changedLayers = (a: Record<HalLayer, string>, b: Record<HalLayer, string>) => HAL_LAYERS.filter((l) => a[l] !== b[l])

/** How long one read takes, ms: VL53L0X timing budget or the HC-SR04 echo (+ 10 µs trigger). */
export const rangeReadMs = (chip: RangeChip, m = RANGE_M) => (chip === 'vl53' ? TOF_MODES.default.budgetMs : chip === 'hcsr04' ? (echoSeconds(m, 20) + 10e-6) * 1e3 : 0)

// --- Fixed-rate control loop: turn to 90° at 100 Hz, gyro heading integrated with dt. ---

export const LOOP_DT = 0.01
export const TURN_GAIN = 60
export const TURN_MAX = 6
export const TURN_TARGET = Math.PI / 2
export const LOOP_RUN_S = 0.6
/** Every 4th step also writes a log line to the SD card, taking `spike` ms. */
export const SPIKE_EVERY = 4

export interface LoopStep {
  tick: number
  start: number
  end: number
  dt: number
  late: number
  dropped: number
  est: number
  u: number
}
export interface LoopRun {
  steps: LoopStep[]
  /** Heading every 1 ms: true, estimated. */
  th: number[]
  est: number[]
}

const workMs = (k: number, spike: number) => 2 + 1.5 * ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 + (k % SPIKE_EVERY === SPIKE_EVERY - 1 ? spike : 0)

/** A 100 Hz timer wakes the loop; a tick that comes while a step still runs makes the next one late, extra ones are dropped.
 *  Each step integrates the gyro (rate = last command) with measured or assumed dt, then commands rate = K·error after its work. */
export function fixedRateRun(spike: number, measured: boolean, T = LOOP_RUN_S): LoopRun {
  const steps: LoopStep[] = []
  const outs: { t: number; u: number }[] = [{ t: 0, u: 0 }]
  let est = 0
  let u = 0
  let last = 0
  let free = 0
  for (let k = 0, tick = 0; tick * LOOP_DT < T; k++) {
    const due = tick * LOOP_DT
    const start = Math.max(due, free)
    const dt = k === 0 ? 0 : measured ? start - last : LOOP_DT
    est += u * dt
    last = start
    const end = start + workMs(k, spike) / 1e3
    u = clamp(TURN_GAIN * (TURN_TARGET - est), -TURN_MAX, TURN_MAX)
    outs.push({ t: end, u })
    const next = Math.max(tick + 1, Math.floor(end / LOOP_DT + 1e-9))
    steps.push({ tick, start, end, dt, late: start - due, dropped: next - tick - 1, est, u })
    free = end
    tick = next
  }
  const n = Math.round(T * 1000)
  const th: number[] = []
  const es: number[] = []
  let h = 0
  let j = 0
  let s = 0
  for (let i = 0; i <= n; i++) {
    const t = i / 1000
    while (s + 1 < steps.length && steps[s + 1].start <= t) s++
    while (j + 1 < outs.length && outs[j + 1].t <= t) j++
    th.push(h)
    es.push(steps[s].start <= t ? steps[s].est : 0)
    h += outs[j].u / 1000
  }
  return { steps, th, est: es }
}

/** Spread of the loop period (max − min start gap), s. */
export function loopJitter(steps: LoopStep[]) {
  const gaps = steps.slice(1).map((s, i) => s.start - steps[i].start)
  return gaps.length ? Math.max(...gaps) - Math.min(...gaps) : 0
}

/** Largest swing of the true heading past the target, rad (0 when it never crosses). */
export function overshoot(th: number[], target = TURN_TARGET) {
  return Math.max(0, ...th.map((h) => h - target))
}
