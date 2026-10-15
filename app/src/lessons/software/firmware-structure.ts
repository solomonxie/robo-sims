import * as THREE from 'three/webgpu'
import {
  FW_PERIOD,
  FW_TICKS,
  FwSlot,
  FwStep,
  HAL_LAYERS,
  LOOP_DT,
  LOOP_RUN_S,
  MOTOR_SPEED,
  MotorChip,
  RANGE_M,
  RangeChip,
  SPIKE_EVERY,
  STALL_EVERY,
  TELEMETRY_MS,
  TURN_GAIN,
  TURN_TARGET,
  changedLayers,
  commandError,
  controlGaps,
  dutyCounts,
  echoSeconds,
  fixedRateRun,
  heldCommand,
  loopJitter,
  motorStack,
  motorVolts,
  overshoot,
  rangeReadMs,
  rangeStack,
  rtosFirmwareRun,
  setpointAt,
  superLoopRun,
  toDeg,
} from '../../core/physics'
import { buildL298n } from '../../models/modules'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  Mark,
  POWER,
  RING,
  addLabel,
  codeBlock,
  flatBox,
  gantt,
  glide,
  glowMat,
  hcSr04,
  i2cBreakout,
  lerp,
  liveLabel,
  memoBy,
  moduleBlock,
  packetPool,
  partLetter,
  setGlow,
  shadowlessRod,
  simClock,
  stretchRod,
  trayMat,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const ms = (t: number) => `${+t.toFixed(1)} ms`

/** Grey loop-back path under a tray: from `x1` down, back to `x0`, up. */
function loopBack(parent: THREE.Object3D, x0: number, x1: number, y: number, yLow: number) {
  const g = add(parent, new THREE.Group())
  const m = glowMat(GREY, 0.35)
  const seg = (a: V3, b: V3) => stretchRod(add(g, shadowlessRod(m)), a, b, 0.09)
  seg([x1, y, 0], [x1, yLow, 0])
  seg([x1, yLow, 0], [x0, yLow, 0])
  seg([x0, yLow, 0], [x0, y, 0])
  partLetter(g, '▲', [x0, y - 0.1, 0.1], 0.5, GREY)
  return g
}

// --- Super-loop vs RTOS: the same robot firmware as one loop() or as two prioritised tasks. ---

const ARCH = { loop: 'Super-loop', rtos: 'RTOS tasks' }
const STEPS: FwStep[] = ['read', 'compute', 'drive', 'telemetry']
const STEP_COLOR: Record<FwStep, string> = { read: B_FIELD, compute: DATA_COLOR, drive: FORCE, telemetry: HEAT, stall: HIGH_V }
const STEP_NAME: Record<FwStep, string> = { read: 'read sensors', compute: 'compute', drive: 'drive motors', telemetry: 'telemetry', stall: 'Wi-Fi wait' }
const STEP_X: Record<FwStep, number> = { read: -12, compute: -5, drive: 2, telemetry: 13, stall: 13 }
const BLOCK_Y = 7.6
const CMD = { x0: -11, x1: 24, y: -8.4, h: 2.6 }
const FW_SLOW = 0.15

const fwRun = memoBy(
  (p: Params) => `${p.arch}|${p.stall}`,
  (p: Params) => {
    const arch = pick(ARCH, p.arch, 'loop')
    const stall = n(p, 'stall')
    const r = arch === 'loop' ? superLoopRun(stall) : rtosFirmwareRun(stall)
    const gaps = controlGaps(r.drives)
    const worst = Math.max(...gaps)
    const span = r.drives[r.drives.length - 1] - r.drives[0]
    return { arch, stall, r, gaps, worst, jitter: worst - Math.min(...gaps), hz: (1000 * gaps.length) / span, err: commandError(r) }
  },
)

const cellOf = (s: FwSlot) => (s === 'ready' ? { color: GREY, dim: true, text: 'ready' } : s ? { color: STEP_COLOR[s], text: s === 'stall' ? 'Wi-Fi' : s === 'telemetry' ? 'tx' : '' } : null)

export const superLoopVsRtos: Lesson = {
  id: 'firmware-structure-super-loop-vs-rtos',
  title: 'Super-loop vs RTOS',
  tagline: 'One loop waits for its slowest step; tasks don’t',
  formula: (p) => {
    const P = fwRun(p)
    const head = `work per cycle: read 1 ms + compute 1 ms + drive 1 ms, telemetry ${TELEMETRY_MS} ms, every ${STALL_EVERY}rd send waits ${P.stall} ms for Wi-Fi`
    const tail =
      P.arch === 'loop'
        ? `super-loop period = max(${FW_PERIOD} ms, sum of all steps) → motor commands up to ${ms(P.worst)} apart`
        : `control task (prio 5) preempts telemetry (prio 1) → motor commands every ${ms(P.worst)}`
    return `${head} · ${tail} · slowed ${Math.round(FW_SLOW / 1e-3)}×`
  },
  legend: [
    { color: B_FIELD, label: 'read sensors · compute · drive motors', shape: 'dot' },
    { color: HEAT, label: 'telemetry · red = blocked on Wi-Fi', shape: 'dot' },
    { color: POWER, label: 'Gap between motor commands, ms', shape: 'dot' },
    { color: FORCE, label: 'Motor command held · grey = wanted', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Most robot firmware does the same four jobs: read the sensors, compute (filter, PID), drive the motors, and send telemetry home. The question is how they share one CPU.',
    'A super-loop runs them in order inside loop(), then waits for the next 10 ms slot. Simple, no RTOS, easy to reason about while every step is short.',
    'But the loop is only as fast as its slowest pass. When a WiFiClient write finds the TX buffer full it waits, and the motors keep the old command until the loop comes round again: the control period jumps from 10 ms to 10 + the stall.',
    'With an RTOS each job is a task: control at priority 5 wakes every 10 ms with vTaskDelayUntil, telemetry at priority 1 fills the gaps. When control wakes it preempts telemetry at the next tick, so the motor rate holds whatever the network does.',
    'The price: shared data now needs a queue or a mutex (RTOS basics → Queues, Mutexes), every task needs its own stack, and timing bugs get subtler. A millis() scheduler (Timers & interrupts → Millis without delay) is the middle ground, but one blocking call still stalls it.',
    'Rule of thumb: a super-loop for one job with short, non-blocking steps; tasks once anything can block (Wi-Fi, SD card, a slow I²C sensor) or needs a guaranteed rate.',
  ],
  controls: [
    { kind: 'choice', key: 'arch', options: opts(ARCH), initial: 'loop' },
    { kind: 'slider', key: 'stall', label: 'Wi-Fi stall', min: 0, max: 30, initial: 15, step: 5, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const loopTray = add(scene, new THREE.Group())
    box(loopTray, [32, 5, 0.4], trayMat(), [0.5, BLOCK_Y, -1])
    addLabel(loopTray, 'void loop() — one thread, steps in order', [-15.3, BLOCK_Y + 3, 0], LABEL, 0.45, 'left')
    loopBack(loopTray, -12, 13, BLOCK_Y - 1.5, BLOCK_Y - 3.1)
    const taskTray = add(scene, new THREE.Group())
    box(taskTray, [20.6, 5, 0.4], trayMat(), [-5, BLOCK_Y, -1])
    box(taskTray, [8.6, 5, 0.4], trayMat(), [13, BLOCK_Y, -1])
    addLabel(taskTray, 'controlTask · prio 5 · every 10 ms', [-15.3, BLOCK_Y + 3, 0], FORCE, 0.45, 'left')
    addLabel(taskTray, 'telemetryTask · prio 1', [8.9, BLOCK_Y + 3, 0], HEAT, 0.45, 'left')
    loopBack(taskTray, -12, 2, BLOCK_Y - 1.5, BLOCK_Y - 3.1)
    loopBack(taskTray, 11, 15, BLOCK_Y - 1.5, BLOCK_Y - 3.1)
    const blocks = Object.fromEntries(STEPS.map((s) => [s, moduleBlock(scene, [STEP_X[s], BLOCK_Y, 0], [5.6, 2.8, 1.4], STEP_NAME[s])])) as Record<string, ReturnType<typeof moduleBlock>>
    const arrowM = glowMat(GREY, 0.4)
    for (const [a, b] of [
      [-9.2, -7.8],
      [-2.2, -0.8],
    ])
      stretchRod(add(scene, shadowlessRod(arrowM)), [a, BLOCK_Y, 0], [b, BLOCK_Y, 0], 0.09)
    const chainArrow = add(scene, shadowlessRod(arrowM))
    stretchRod(chainArrow, [4.8, BLOCK_Y, 0], [10.2, BLOCK_Y, 0], 0.09)
    const tokens = packetPool(scene, 2, 0.8)
    const tokX = [-12, 13]
    const chartGroups = { loop: add(scene, new THREE.Group()), rtos: add(scene, new THREE.Group()) }
    const charts = {
      loop: gantt(chartGroups.loop, 1, { x0: -11, x1: 24, y: 1, rowH: 3, ticks: FW_TICKS, axis: true }),
      rtos: gantt(chartGroups.rtos, 2, { x0: -11, x1: 24, y: 2.4, rowH: 2.2, ticks: FW_TICKS, axis: true }),
    }
    charts.loop.name(0, 'loop()', LABEL)
    charts.rtos.name(0, 'control', FORCE)
    charts.rtos.name(1, 'telemetry', HEAT)
    box(scene, [CMD.x1 - CMD.x0 + 0.6, 2 * CMD.h + 1, 0.4], trayMat(), [(CMD.x0 + CMD.x1) / 2, CMD.y, -0.45])
    addLabel(scene, 'motor command', [CMD.x0 - 0.6, CMD.y + 0.4, 0], LABEL, 0.42, 'right')
    addLabel(scene, 'held vs wanted', [CMD.x0 - 0.6, CMD.y - 0.5, 0], GREY, 0.34, 'right')
    const cx = (t: number) => CMD.x0 + (t / FW_TICKS) * (CMD.x1 - CMD.x0)
    const cy = (v: number) => CMD.y + v * CMD.h
    const wantM = glowMat(GREY, 0.5)
    const want = Array.from({ length: FW_TICKS }, (_, t) => {
      const o = add(scene, shadowlessRod(wantM))
      stretchRod(o, [cx(t), cy(setpointAt(t)), 0], [cx(t + 1), cy(setpointAt(t + 1)), 0], 0.05)
      return o
    })
    const heldM = glowMat(FORCE, 1)
    const staleM = glowMat(HIGH_V, 1)
    const held = Array.from({ length: FW_TICKS }, () => ({ h: add(scene, shadowlessRod(heldM)), v: add(scene, shadowlessRod(heldM)), jump: false }))
    const status = liveLabel(scene, [-24, -13.6, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-24.5, 14.6, 0], 0.46, 4)
    const clock = simClock(FW_SLOW)
    let key = ''
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = fwRun(p)
        const { r } = P
        const loop = P.arch === 'loop'
        const k = `${P.arch}|${P.stall}`
        if (k !== key) {
          key = k
          loopTray.visible = loop
          taskTray.visible = !loop
          chainArrow.visible = loop
          chartGroups.loop.visible = loop
          chartGroups.rtos.visible = !loop
          const marks: Mark[] = P.gaps.map((g, i) => ({ t: r.drives[i + 1] - 1, row: 0, text: `${g}`, color: g > FW_PERIOD ? HIGH_V : POWER }))
          charts[P.arch].rebuild((row, t) => cellOf(r.lanes[row][t]), marks)
          held.forEach((o, t) => {
            const v = heldCommand(r.drives, t)
            const stale = Math.abs(v - setpointAt(t)) > 0.6
            ;(o.h as THREE.Mesh).material = stale ? staleM : heldM
            stretchRod(o.h, [cx(t), cy(v), 0.1], [cx(t + 1), cy(v), 0.1], 0.1)
            stretchRod(o.v, [cx(t), cy(t ? heldCommand(r.drives, t - 1) : 0), 0.1], [cx(t), cy(v), 0.1], 0.1)
            o.jump = o.v.visible
          })
        }
        const now = clock(dt, key, FW_TICKS)
        const t = Math.min(FW_TICKS - 1, Math.floor(now))
        charts[P.arch].show(now)
        want.forEach((o, i) => (o.visible = i < now))
        held.forEach((o, i) => {
          o.h.visible = i < now
          o.v.visible = o.jump && i < now
        })
        const slots = r.lanes.map((l) => l[t])
        for (const s of STEPS) {
          const on = slots.some((x) => x === s || (s === 'telemetry' && x === 'stall'))
          const stalled = slots.includes('stall') && s === 'telemetry'
          const waiting = s === 'telemetry' && slots[1] === 'ready'
          blocks[s](dt, stalled ? HIGH_V : STEP_COLOR[s], on ? 1 : waiting ? 0.35 : 0, stalled ? 'Wi-Fi wait…' : waiting ? 'preempted' : STEP_NAME[s])
        }
        tokens.begin()
        r.lanes.forEach((lane, i) => {
          const s = lane[t]
          const home = loop ? -15 : i === 0 ? -15 : 9.6
          const target = s && s !== 'ready' ? STEP_X[s] : s === 'ready' ? STEP_X.telemetry : home
          tokX[i] = Math.abs(tokX[i] - target) > 20 ? target : glide(dt, tokX[i], target, 16)
          const color = s && s !== 'ready' ? STEP_COLOR[s] : GREY
          tokens.put([tokX[i], BLOCK_Y + 1.75, 0.4], color, { w: 1.4, payload: 0.7, fade: s && s !== 'ready' ? 1 : 0.4 })
        })
        tokens.end()
        const prev = [...r.drives].reverse().find((d) => d <= now)
        const since = prev === undefined ? 0 : now - prev
        const stuck = slots.includes('stall')
        status.set(
          stuck && loop
            ? `t = ${t} ms · loop() is stuck in client.write() · motors hold their last command for ${Math.floor(since)} ms`
            : stuck
              ? `t = ${t} ms · telemetry waits on Wi-Fi, control still runs every ${FW_PERIOD} ms`
              : `t = ${t} ms · last motor command ${Math.floor(since)} ms ago`,
          stuck && loop ? HIGH_V : LABEL,
        )
        code(
          loop
            ? [
                'void loop() {',
                '  readSensors(); compute(); driveMotors();   // 3 ms',
                `  sendTelemetry();   // ${TELEMETRY_MS} ms, every ${STALL_EVERY}rd call waits ${P.stall} ms for Wi-Fi`,
                `  while (millis() - last < ${FW_PERIOD}) {}  last = millis(); }`,
              ]
            : [
                'void controlTask(void *) { for (;;) {   // prio 5',
                `  readSensors(); compute(); driveMotors(); vTaskDelayUntil(&last, ${FW_PERIOD}); } }`,
                'void telemetryTask(void *) { for (;;) {   // prio 1',
                `  sendTelemetry(); vTaskDelayUntil(&last, ${FW_PERIOD}); } }`,
              ],
        )
      },
      readouts: (p) => {
        const P = fwRun(p)
        return [
          { label: 'Control rate', value: `${P.hz.toFixed(0)} Hz`, tone: P.hz > 95 ? 'ok' : P.hz > 70 ? 'warn' : 'bad' },
          { label: 'Worst gap', value: ms(P.worst), tone: P.worst <= FW_PERIOD ? 'ok' : 'bad' },
          { label: 'Jitter', value: ms(P.jitter), tone: P.jitter === 0 ? 'ok' : 'bad' },
          { label: 'Worst error', value: `${Math.round(P.err * 100)} %`, tone: P.err < 0.9 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Hardware abstraction: app → interface → driver → HAL → registers; swap a chip, rewrite one layer. ---

const MOTORS: Record<MotorChip, string> = { l298n: 'L298N', tb6612: 'TB6612', mock: 'Mock' }
const RANGES: Record<RangeChip, string> = { vl53: 'VL53L0X', hcsr04: 'HC-SR04', mock: 'Mock' }
const LAYER_NAME = ['App', 'Interface', 'Driver', 'HAL', 'Registers']
const LAYER_Y = [10.2, 7.6, 5, 2.4, -0.2]
const HW_Y = -4.6
const STACK_X = [-4, 14]
const HAL_CYCLE = 3.2

function motorTags(chip: MotorChip) {
  const duty = dutyCounts(MOTOR_SPEED, 8)
  return [`set(${MOTOR_SPEED})`, `Motor::set`, chip === 'mock' ? 'recorded ✓' : `duty ${duty}`, 'ledcWrite', `DUTY = ${duty}`, `${motorVolts(chip, MOTOR_SPEED).toFixed(1)} V`]
}
function rangeTags(chip: RangeChip) {
  const mm = Math.round(RANGE_M * 1000)
  const hw = chip === 'vl53' ? 'I²C 0x29' : `echo ${Math.round(echoSeconds(RANGE_M, 20) * 1e6)} µs`
  return { down: ['read()', 'Range::read', chip === 'mock' ? `script → ${mm}` : chip === 'vl53' ? 'requestFrom' : 'TRIG 10 µs', chip === 'vl53' ? 'Wire' : 'pulseIn', chip === 'vl53' ? 'I2C_FIFO' : 'GPIO_IN', hw], up: `${mm} mm` }
}

/** Packet y along the stack: stop `u` ∈ [0, stops] (layer k at k, hardware at 5). */
const stackY = (u: number) => {
  const ys = [...LAYER_Y, HW_Y]
  const k = Math.min(ys.length - 2, Math.floor(u))
  return lerp(ys[k], ys[k + 1], u - k)
}

export const hardwareAbstraction: Lesson = {
  id: 'firmware-structure-hardware-abstraction',
  title: 'Hardware abstraction',
  tagline: 'Swap the chip, rewrite one layer',
  formula: (p) => {
    const m = pick(MOTORS, p.motor, 'l298n')
    const r = pick(RANGES, p.range, 'vl53')
    const ch = changedLayers(motorStack('l298n'), motorStack(m))
    return `app → interface → driver → HAL → registers: each layer only calls the one below · ${MOTORS[m]} vs L298N changes ${ch.length ? ch.join(', ') : 'nothing'} · ${RANGES[r]} read ${r === 'mock' ? 'from a script' : `takes ${ms(rangeReadMs(r))}`} · app and interface untouched`
  },
  legend: [
    { color: FORCE, label: 'motor.set() call going down', shape: 'dot' },
    { color: B_FIELD, label: 'range.read() call · reply coming up', shape: 'dot' },
    { color: RING, label: 'The one layer the swap rewrote', shape: 'dot' },
    { color: POWER, label: 'Mock driver: unit test on a PC', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Layers keep hardware details from leaking upward. The app says left.set(0.6) and front.read(); it never sees a pin number or a register.',
    'The interface is a small abstract class (Motor, Range). The driver implements it for one chip, using the HAL: Arduino’s digitalWrite, ledcWrite, Wire and pulseIn, or ESP-IDF’s gpio_ and i2c_ calls. The HAL writes the chip’s registers.',
    'Swap an L298N for a TB6612: the TB6612 has a STBY pin and MOSFETs instead of bipolar transistors (≈ 0.1 V drop at 0.25 A instead of ≈ 1.6 V), so only its driver is new. The app and the PID tuning code don’t change.',
    'Same for range sensors: a VL53L0X answers over I²C after a 33 ms timing budget; an HC-SR04 needs a 10 µs trigger and a timed echo. Both return millimetres through Range::read().',
    'Mock drivers implement the same interface with no hardware: MockMotor records every call, MockRange plays back a script. The app logic then runs as a unit test on a PC in milliseconds, without flashing or a robot on the desk.',
    'Keep the interface narrow and in the robot’s units (speed −1…1, millimetres), not the chip’s (duty counts, echo µs).',
  ],
  controls: [
    { kind: 'choice', key: 'motor', options: opts(MOTORS), initial: 'l298n' },
    { kind: 'choice', key: 'range', options: opts(RANGES), initial: 'vl53' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    LAYER_NAME.forEach((name, k) => partLetter(scene, name, [-12.2, LAYER_Y[k], 0], 0.55, LABEL, 'right'))
    partLetter(scene, 'Hardware', [-12.2, HW_Y, 0], 0.55, GREY, 'right')
    const stacks = STACK_X.map((x, s) => {
      partLetter(scene, s === 0 ? 'Motor' : 'Range sensor', [x, LAYER_Y[0] + 1.9, 0], 0.5, s === 0 ? FORCE : B_FIELD)
      const slabs = HAL_LAYERS.map((_, k) => moduleBlock(scene, [x, LAYER_Y[k], 0], [15, 1.9, 1.6], ''))
      const rod = glowMat(GREY, 0.3)
      for (let k = 0; k < 5; k++) {
        const y0 = LAYER_Y[k] - 0.95
        const y1 = k < 4 ? LAYER_Y[k + 1] + 0.95 : HW_Y + 2.2
        stretchRod(add(scene, shadowlessRod(rod)), [x, y0, 0], [x, y1, 0], 0.08)
      }
      const flagM = glowMat(RING, 0)
      const flag = flatBox(scene, [15.6, 2.4, 0.2], flagM, [x, LAYER_Y[2], -0.75])
      const flagText = liveLabel(scene, [x + 7.9, LAYER_Y[2] + 1.35, 0.4], { size: 0.38, align: 'right' })
      return { slabs, flagM, flag, flagText, prev: '', flash: 0 }
    })
    const hw = add(scene, new THREE.Group())
    const l298 = add(hw, buildL298n(), [STACK_X[0], HW_Y, 0])
    l298.scale.setScalar(0.24)
    l298.rotation.x = Math.PI / 2
    const tb = i2cBreakout(hw, [STACK_X[0], HW_Y, 0], { name: 'TB6612FNG', color: '#b3262e', k: 0.24, pins: ['PWMA', 'AIN1', 'AIN2', 'STBY'] })
    const vl = i2cBreakout(hw, [STACK_X[1], HW_Y, 0], { name: 'VL53L0X', color: '#5b2a86', k: 0.24 })
    const sonar = hcSr04(hw, [STACK_X[1], HW_Y - 0.4, 0], 0.22, Math.PI / 2)
    const pcs = STACK_X.map((x) => {
      const g = add(hw, new THREE.Group(), [x, HW_Y, 0])
      box(g, [8, 4.4, 0.4], mat('#2a2d34', { rough: 0.5 }), [0, 0, -0.2])
      flatBox(g, [7.2, 3.6, 0.1], glowMat(POWER, 0.15), [0, 0, 0.05])
      partLetter(g, 'unit test · PC', [0, 0.6, 0.2], 0.42, POWER)
      return { g, text: liveLabel(g, [0, -0.6, 0.2], { size: 0.36 }) }
    })
    const packets = packetPool(scene, 2, 0.7)
    const code = codeBlock(scene, [-24.5, -8.2, 0], 0.5, 4)
    let tm = 0
    return {
      scene,
      view: { center: [0, 4.2, 0], radius: 84, polar: 1.38, azimuth: 0.14 },
      frame(dt, p) {
        const m = pick(MOTORS, p.motor, 'l298n')
        const r = pick(RANGES, p.range, 'vl53')
        const stackText = [motorStack(m), rangeStack(r)]
        tm = (tm + dt) % HAL_CYCLE
        const u = tm / HAL_CYCLE
        stacks.forEach((S, s) => {
          const chip = s === 0 ? m : r
          if (S.prev && S.prev !== chip) S.flash = 1
          S.prev = chip
          S.flash = Math.max(0, S.flash - dt / 3)
          setGlow(S.flagM, RING, 1.4 * S.flash)
          S.flag.visible = S.flash > 0.01
          S.flagText.set(S.flash > 0.01 ? 'only this layer changed' : '', RING)
          const mock = chip === 'mock'
          const depth = mock ? 3 : 6
          const reach = s === 0 ? Math.min(u / 0.55, 1) * depth : (u < 0.45 ? u / 0.45 : u < 0.5 ? 1 : Math.max(0, 1 - (u - 0.5) / 0.45)) * depth
          const names = [
            s === 0 ? 'App · drive()' : 'App · avoid()',
            s === 0 ? 'Motor (interface)' : 'Range (interface)',
            `${s === 0 ? MOTORS[m] : RANGES[r]} driver`,
            s === 0 ? 'HAL · gpio, ledc PWM' : r === 'vl53' ? 'HAL · I²C (Wire)' : 'HAL · gpio, pulseIn',
            s === 0 ? 'LEDC, GPIO registers' : r === 'vl53' ? 'I²C registers' : 'GPIO, timer registers',
          ]
          S.slabs.forEach((slab, k) => {
            const live = !(mock && k > 2)
            const near = Math.max(0, 1 - Math.abs(reach - k) * 1.5)
            const base = s === 0 ? FORCE : B_FIELD
            const color = k === 2 && S.flash > 0.3 ? RING : k === 2 && mock ? POWER : base
            slab(dt, live ? color : '#30333a', live ? Math.max(0.15 + 0.85 * near, k === 2 ? S.flash : 0) : 0, live ? names[k] : `${names[k]} · not linked`)
          })
          pcs[s].g.visible = mock
          if (mock) pcs[s].text.set(s === 0 ? 'calls == {0.6} ✓' : `script: ${Math.round(RANGE_M * 1000)} mm`, LABEL)
        })
        l298.visible = m === 'l298n'
        tb.group.visible = m === 'tb6612'
        vl.group.visible = r === 'vl53'
        sonar.group.visible = r === 'hcsr04'
        tb.led(m === 'tb6612' ? 1 : 0)
        vl.led(r === 'vl53' ? 1 : 0)
        vl.chip(B_FIELD, r === 'vl53' && u > 0.4 && u < 0.55 ? 1.2 : 0)
        packets.begin()
        const mt = motorTags(m)
        const mDepth = m === 'mock' ? 3 : 6
        const mu = Math.min(u / 0.55, 1) * (mDepth - 0.001)
        packets.put([STACK_X[0] - 5.9, stackY(Math.min(mu, 5)), 1.2], FORCE, { w: 1.6, payload: 0.6, text: mt[Math.min(5, Math.floor(mu))], fade: u < 0.8 ? 1 : 0 })
        const rt = rangeTags(r)
        const rDepth = r === 'mock' ? 3 : 6
        const down = u < 0.45
        const ru = (down ? u / 0.45 : u < 0.5 ? 1 : Math.max(0, 1 - (u - 0.5) / 0.45)) * (rDepth - 0.001)
        packets.put([STACK_X[1] - 5.9, stackY(Math.min(ru, 5)), 1.2], B_FIELD, { w: 1.6, payload: down ? 0.6 : 1, text: down ? rt.down[Math.min(5, Math.floor(ru))] : rt.up, fade: u < 0.97 ? 1 : 0 })
        packets.end()
        code([stackText[0].interface, stackText[0].driver, stackText[1].interface, stackText[1].driver])
      },
      readouts: (p) => {
        const m = pick(MOTORS, p.motor, 'l298n')
        const r = pick(RANGES, p.range, 'vl53')
        const changed = new Set([...changedLayers(motorStack('l298n'), motorStack(m)), ...changedLayers(rangeStack('vl53'), rangeStack(r))])
        return [
          { label: `Rewritten (of ${HAL_LAYERS.length})`, value: changed.size ? [...changed].join(', ') : 'none', tone: 'ok' },
          { label: 'Motor 60 %', value: m === 'mock' ? 'no motor' : `${motorVolts(m, MOTOR_SPEED).toFixed(1)} V`, tone: m === 'l298n' ? 'warn' : 'ok' },
          { label: 'Range read', value: r === 'mock' ? 'instant' : ms(rangeReadMs(r)) },
          { label: 'Runs on', value: m === 'mock' || r === 'mock' ? 'PC test' : 'ESP32' },
        ]
      },
    }
  },
}

// --- Fixed-rate control loop: 100 Hz timer, measured dt, overruns. ---

const DT_MODES = { measured: 'Measured dt', fixed: 'Assumed 10 ms' }
const LOOP_SLOW = 0.025
const RUN_MS = Math.round(LOOP_RUN_S * 1000)
const WIN_MS = 100
const TL = { x0: -11, x1: 24, y: 6.2 }
const PLOT = { x0: -11, x1: 24, y0: -10.6, h: 8 }
const ROBOT: V3 = [-18.5, -4.6, 0]
const POOL = 14

const loopRun = memoBy(
  (p: Params) => `${p.spike}|${p.dt}`,
  (p: Params) => {
    const spike = n(p, 'spike')
    const mode = pick(DT_MODES, p.dt, 'measured')
    const r = fixedRateRun(spike, mode === 'measured')
    const late = r.steps.filter((s) => s.late > 1e-9).length
    const dropped = r.steps.reduce((a, s) => a + s.dropped, 0)
    return { spike, mode, r, late, dropped, jitter: loopJitter(r.steps), over: overshoot(r.th), err: r.th[r.th.length - 1] - TURN_TARGET, hz: r.steps.length / LOOP_RUN_S }
  },
)

const plotX = (tMs: number) => PLOT.x0 + (tMs / RUN_MS) * (PLOT.x1 - PLOT.x0)
const plotY = (th: number) => PLOT.y0 + (th / TURN_TARGET) * PLOT.h * 0.5

export const fixedRateControlLoop: Lesson = {
  id: 'firmware-structure-fixed-rate-control-loop',
  title: 'Fixed-rate control loop',
  tagline: 'Same rate every step, or at least the true dt',
  formula: (p) => {
    const P = loopRun(p)
    return `100 Hz timer → step: dt = now − last; θ̂ += ω·dt; ω = K·(90° − θ̂), K = ${TURN_GAIN}/s · each step 2–3.5 ms, every ${SPIKE_EVERY}th + ${P.spike} ms SD log · ${P.late} late, ${P.dropped} dropped ticks · ${P.mode === 'fixed' ? 'dt assumed 10 ms → θ̂ lags the real turn' : 'measured dt keeps θ̂ honest'} · slowed ${Math.round(LOOP_SLOW / 1e-3)}×`
  },
  legend: [
    { color: RING, label: '10 ms timer tick · late tick · ✗ dropped', shape: 'dot' },
    { color: B_FIELD, label: 'Control step (sense → compute → act)', shape: 'dot' },
    { color: HIGH_V, label: 'Overrun: step outlives its slot', shape: 'dot' },
    { color: FORCE, label: 'True heading · target 90°', shape: 'dot' },
    { color: DATA_COLOR, label: 'Estimated heading (gyro × dt)', shape: 'dot' },
  ],
  points: [
    'A controller assumes it runs at a steady rate: the PID gains, filters and integrators are all tuned for one dt. So a hardware timer (or vTaskDelayUntil) wakes the loop every 10 ms, 100 Hz, instead of running it whenever loop() comes round.',
    'Here the robot turns to 90°: each step integrates the gyro rate into a heading estimate θ̂ += ω·dt, then commands ω = K·(90° − θ̂).',
    'Jitter is how much the start of each step wanders. A few µs from interrupts is harmless; milliseconds from a slow step are not.',
    'When a step overruns (an SD card write here), the next tick finds the loop busy: it starts late, and ticks that pass entirely are dropped. Count both; they are the health check of a control loop.',
    'Integrate with the measured dt (esp_timer_get_time() between steps), never the nominal 10 ms: with an assumed dt the late steps are under-counted, θ̂ lags and the robot over-turns.',
    'Even with the right dt, long gaps between corrections act like delay: with gain K the loop goes unstable once K·dt nears 2, so it overshoots and rings. Keep slow work (logging, Wi-Fi) out of the control task.',
  ],
  controls: [
    { kind: 'slider', key: 'spike', label: 'SD log write', min: 0, max: 50, initial: 20, step: 5, format: (v) => `${v} ms` },
    { kind: 'choice', key: 'dt', options: opts(DT_MODES), initial: 'measured' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const px = (TL.x1 - TL.x0) / WIN_MS
    box(scene, [TL.x1 - TL.x0 + 0.6, 3.6, 0.4], trayMat(), [(TL.x0 + TL.x1) / 2, TL.y, -0.45])
    partLetter(scene, `last ${WIN_MS} ms`, [TL.x0 - 0.6, TL.y + 0.6, 0], 0.4, LABEL, 'right')
    partLetter(scene, 'now', [TL.x1, TL.y + 2.5, 0], 0.4, LABEL)
    const steps = Array.from({ length: POOL }, () => {
      const m = glowMat(B_FIELD, 0.7)
      return { o: flatBox(scene, [1, 1.3, 0.3], m, [0, TL.y - 0.4, 0]), m, text: liveLabel(scene, [0, TL.y - 1.5, 0.3], { size: 0.32 }) }
    })
    const ticks = Array.from({ length: POOL }, () => {
      const m = glowMat(RING, 0.8)
      return { o: flatBox(scene, [0.14, 0.9, 0.25], m, [0, TL.y + 1.1, 0.05]), m, text: liveLabel(scene, [0, TL.y + 2, 0.3], { size: 0.34 }) }
    })
    box(scene, [PLOT.x1 - PLOT.x0 + 0.6, PLOT.h + 0.8, 0.4], trayMat(), [(PLOT.x0 + PLOT.x1) / 2, PLOT.y0 + PLOT.h / 2, -0.45])
    stretchRod(add(scene, shadowlessRod(glowMat(POWER, 0.6))), [PLOT.x0, plotY(TURN_TARGET), 0], [PLOT.x1, plotY(TURN_TARGET), 0], 0.05)
    partLetter(scene, '90°', [PLOT.x0 - 0.5, plotY(TURN_TARGET), 0], 0.38, POWER, 'right')
    partLetter(scene, '0°', [PLOT.x0 - 0.5, plotY(0), 0], 0.38, GREY, 'right')
    for (let t = 0; t <= RUN_MS; t += 100) partLetter(scene, `${t}`, [plotX(t), PLOT.y0 - 0.9, 0], 0.32, GREY)
    partLetter(scene, 'ms', [PLOT.x1 + 0.9, PLOT.y0 - 0.9, 0], 0.32, GREY, 'left')
    const SEG = 120
    const traces = [FORCE, DATA_COLOR].map((c) => {
      const m = glowMat(c, 0.9)
      return Array.from({ length: SEG }, () => add(scene, shadowlessRod(m)))
    })
    const cursor = add(scene, shadowlessRod(glowMat(LABEL, 1)))
    const robot = add(scene, new THREE.Group(), ROBOT)
    box(robot, [4.2, 3, 0.8], mat('#d8dbe2', { rough: 0.55 }), [0, 0, 0])
    for (const y of [-1.85, 1.85]) box(robot, [2, 0.6, 1.2], mat('#1c1c1f', { rough: 0.8 }), [-0.6, y, 0])
    const nose = add(robot, shadowlessRod(glowMat(FORCE, 1)))
    stretchRod(nose, [0, 0, 0.8], [4, 0, 0.8], 0.16)
    partLetter(robot, '▶', [4.2, 0, 0.8], 0.8, FORCE)
    const estRod = add(scene, shadowlessRod(glowMat(DATA_COLOR, 1)))
    stretchRod(add(scene, shadowlessRod(glowMat(POWER, 0.5))), ROBOT, [ROBOT[0], ROBOT[1] + 6, 0], 0.06)
    partLetter(scene, '90°', [ROBOT[0], ROBOT[1] + 6.7, 0], 0.4, POWER)
    const headText = liveLabel(scene, [ROBOT[0], ROBOT[1] - 4.2, 0.3], { size: 0.42 })
    const code = codeBlock(scene, [-24.5, 14.2, 0], 0.44, 4)
    const clock = simClock(LOOP_SLOW)
    let key = ''
    return {
      scene,
      view: { center: [0, 3.4, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = loopRun(p)
        const { r } = P
        const k = `${P.spike}|${P.mode}`
        if (k !== key) {
          key = k
          traces.forEach((tr, j) => {
            const v = j === 0 ? r.th : r.est
            tr.forEach((o, i) => {
              const a = Math.floor((i * RUN_MS) / SEG)
              const b = Math.floor(((i + 1) * RUN_MS) / SEG)
              stretchRod(o, [plotX(a), plotY(v[a]), 0.1 * j], [plotX(b), plotY(v[b]), 0.1 * j], 0.07)
            })
          })
        }
        const now = clock(dt, key, RUN_MS)
        traces.forEach((tr) => tr.forEach((o, i) => (o.visible = (i * RUN_MS) / SEG < now)))
        stretchRod(cursor, [plotX(now), PLOT.y0 - 0.3, 0.3], [plotX(now), PLOT.y0 + PLOT.h + 0.3, 0.3], 0.05)
        const i = Math.min(RUN_MS, Math.floor(now))
        robot.rotation.z = r.th[i]
        const e = r.est[i]
        stretchRod(estRod, [ROBOT[0], ROBOT[1], 1.4], [ROBOT[0] + 5 * Math.cos(e), ROBOT[1] + 5 * Math.sin(e), 1.4], 0.1)
        headText.set(`true ${toDeg(r.th[i]).toFixed(0)}° · est ${toDeg(e).toFixed(0)}°`, Math.abs(r.th[i] - TURN_TARGET) > 0.1 && now > 300 ? HIGH_V : LABEL)
        const tx = (tMs: number) => TL.x1 - (now - tMs) * px
        const inWin = (tMs: number) => tMs <= now && tMs >= now - WIN_MS
        let s = 0
        for (const st of r.steps) {
          const t0 = st.start * 1000
          const t1 = Math.min(now, st.end * 1000)
          if (t0 > now || st.end * 1000 < now - WIN_MS || s >= POOL) continue
          const a = Math.max(t0, now - WIN_MS)
          const it = steps[s++]
          it.o.visible = true
          it.o.scale.x = Math.max(0.01, (t1 - a) * px)
          it.o.position.x = (tx(a) + tx(t1)) / 2
          const over = st.end - st.tick * LOOP_DT > LOOP_DT + 1e-9
          setGlow(it.m, over ? HIGH_V : B_FIELD, 0.8)
          it.text.group.position.x = tx(t0) + 1.2
          it.text.set(st.dt > 0 && inWin(t0) ? `dt ${+(st.dt * 1000).toFixed(1)}` : '', over ? HIGH_V : LABEL)
        }
        for (; s < POOL; s++) {
          steps[s].o.visible = false
          steps[s].text.set('')
        }
        let q = 0
        const first = Math.ceil((now - WIN_MS) / 10)
        for (let tk = Math.max(0, first); tk * 10 <= now && q < POOL; tk++) {
          const st = r.steps.find((x) => x.tick === tk)
          const it = ticks[q++]
          it.o.visible = true
          it.o.position.x = tx(tk * 10)
          const late = st ? st.late * 1000 : 0
          const color = !st ? HIGH_V : late > 1e-6 ? HEAT : RING
          setGlow(it.m, color, 1)
          it.text.group.position.x = tx(tk * 10)
          it.text.set(!st ? '✗' : late > 1e-6 ? `+${late.toFixed(0)}` : '', color)
        }
        for (; q < POOL; q++) {
          ticks[q].o.visible = false
          ticks[q].text.set('')
        }
        code([
          'void controlTask(void *) { for (;;) {',
          '  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   // 100 Hz esp_timer gives the notify',
          P.mode === 'measured' ? '  int64_t now = esp_timer_get_time(); float dt = (now - last) * 1e-6f; last = now;' : '  const float dt = 0.010f;   // assumes every step is on time',
          `  heading += gyroZ() * dt; setTurnRate(${TURN_GAIN} * (target - heading)); if (++n % ${SPIKE_EVERY} == 0) logToSd(); } }`,
        ])
      },
      readouts: (p) => {
        const P = loopRun(p)
        return [
          { label: 'Loop rate', value: `${P.hz.toFixed(0)} Hz`, tone: P.hz > 99 ? 'ok' : P.hz > 80 ? 'warn' : 'bad' },
          { label: 'Jitter', value: ms(P.jitter * 1000), tone: P.jitter < 1e-3 ? 'ok' : P.jitter < 0.01 ? 'warn' : 'bad' },
          { label: 'Late / dropped', value: `${P.late} / ${P.dropped}`, tone: P.dropped ? 'bad' : P.late ? 'warn' : 'ok' },
          { label: 'Overshoot', value: `${toDeg(P.over).toFixed(0)}°`, tone: P.over < 0.035 ? 'ok' : P.over < 0.1 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
