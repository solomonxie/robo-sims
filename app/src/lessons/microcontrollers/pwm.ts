import * as THREE from 'three/webgpu'
import {
  GPIO_VDD,
  LEDS,
  PIN_GATE_EDGE_S,
  SERVO_HZ,
  TT_COIL_TAU,
  TT_MOTOR,
  TT_SPIN_TAU,
  audible,
  drivenPin,
  dutyCounts,
  FLICKER_HZ,
  ledcCount,
  ledcResolution,
  motorRpm,
  pwmAverage,
  pwmHigh,
  pwmRipple,
  rcSteadyCycle,
  rcTau,
  servoAngle,
  servoPulse,
  servoStep,
  switchingLoss,
} from '../../core/physics'
import { amps, hertz, ohms, pct, secs, si, volts, watts } from '../../core/units'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  ceramicAlong,
  codeBlock,
  esp32Board,
  fetSymbol,
  frac,
  glide,
  glowMat,
  groundAt,
  heatWaves,
  junction,
  ledLoad,
  liveLabel,
  memoBy,
  meterBar,
  motorCan,
  partLetter,
  presence,
  resistorAlong,
  scope,
  sg90Servo,
  signalWire,
  ticks,
} from '../fx'
import { Lesson, Stage, n, pick } from '../types'

const VDD = GPIO_VDD
const MOTOR_V = 5
const PIN = 18
const PIN_COLOR = '#5ad8e6'
const BOARD: V3 = [-14, 5.5, 0]
const SHOWN_PERIOD_S = 1.2
const VIEW = { center: [-1, -3.4, 0] as V3, radius: 80, polar: 1.47, azimuth: 0.06 }
const mA = (a: number) => `${(a * 1000).toFixed(a < 0.01 ? 1 : 0)} mA`
const rpm = (r: number) => `${Math.round(r)} rpm`
const slowText = (hz: number) => `${Math.round(hz * SHOWN_PERIOD_S)}×`

/** ESP32 with a lit wire from GPIO `PIN` over the top to `to` (x, y at z 0). */
function boardWithPin(scene: THREE.Object3D, route: V3[], gpio = PIN) {
  const pin = esp32Board(scene, BOARD, 0.5)
  partLetter(scene, 'ESP32', [BOARD[0], BOARD[1] - 3.8, 0], 0.9, LABEL)
  const io = pin(6)
  partLetter(scene, `GPIO ${gpio}`, [io[0] - 0.6, 10.5, 0], 0.6, PIN_COLOR, 'right')
  return signalWire(scene, [io, [io[0], 9.6, io[2]], [io[0], 9.6, 0], ...route])
}

/** TT motor from a 5 V rail, switched low-side by an N-MOSFET; `gate` is in parent coordinates. */
function motorDriver(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  const motor = motorCan(g, [0, 4.6, 0], { r: 1.8, legs: 0.5 })
  signalWire(g, [[-1.44, 2.3, 0], [-1.44, 1.2, 0], [-3.4, 1.2, 0], [-3.4, 7, 0]])(1)
  partLetter(g, '5V', [-3.4, 7.8, 0], 0.7, HIGH_V)
  const drain = signalWire(g, [[1.44, 2.3, 0], [1.44, 1.2, 0]])
  const fet = fetSymbol(g, [1.44, 1.2, 0], [1.44, -3.4, 0], 'N')
  groundAt(g, [1.44, -3.4, 0])
  const gate: V3 = [at[0] + fet.gate[0], at[1] + fet.gate[1], 0]
  return { g, motor, fet, drain, gate }
}

/** A scope with `rows` stacked half-height lanes; `lane(k, v)` maps 0..1 into lane k. */
function laneScope(parent: THREE.Object3D, at: V3, w: number, h: number, rows: { label: string; color: string }[], divs: [number, number]) {
  const sc = scope(parent, w, h, { divs })
  sc.group.position.set(...at)
  const laneH = h / rows.length
  const lane = (k: number, v: number) => h / 2 - laneH * (k + 1) + laneH * (0.12 + 0.76 * v)
  const traces = rows.map((r, k) => {
    partLetter(sc.group, r.label, [-w / 2 - 0.8, h / 2 - laneH * (k + 0.5), 0], 0.7, r.color, 'right')
    return sc.trace(r.color, { samples: 320, radius: 0.11 })
  })
  return { sc, lane, traces }
}

// --- Duty cycle: the LEDC timer counts up every period; the pin is high while the count is below the duty value. ---

const D_HZ = 5000
const D_BITS = 8
const LED_R = 220
const LED_PEAK_A = drivenPin(2, { ohms: LED_R, led: LEDS.red }).amps
const DUTY_LOADS = { led: 'LED', motor: 'Motor' } as const

export const dutyCycle: Lesson = {
  id: 'pwm-duty-cycle',
  title: 'Duty cycle',
  tagline: 'How much of each period the pin is on',
  formula: (p) => {
    const d = n(p, 'duty') / 100
    const c = dutyCounts(d, D_BITS)
    const head = `duty = ${c} / 256 = ${pct(c / 256)}`
    return p.load === 'motor'
      ? `${head} · V_avg = ${pct(c / 256)} × 5 V = ${volts(pwmAverage(MOTOR_V, c / 256))} → ${rpm(motorRpm(pwmAverage(MOTOR_V, c / 256)))}`
      : `${head} · V_avg = ${volts(pwmAverage(VDD, c / 256))} · LED current ${mA(LED_PEAK_A)} × ${pct(c / 256)} = ${mA(LED_PEAK_A * (c / 256))} average`
  },
  legend: [
    { color: RING, label: 'Timer count; dashed = duty value', shape: 'dot' },
    { color: PIN_COLOR, label: `Pin: high while count < duty, slowed ${slowText(D_HZ)}`, shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'PWM switches a pin fully on and off, fast. The duty cycle is the share of each period it spends on: 25 % duty means on for a quarter of the time.',
    'On the ESP32 the LEDC peripheral does it in hardware. A timer counts 0 … 255 (8 bits) every period, and a channel compares it with your duty value: while count < duty the pin is high. The CPU is free the whole time.',
    'ledcAttach(pin, frequency, bits) sets up a timer and channel; ledcWrite(pin, value) sets the duty, 0 … 256 at 8 bits. In ESP-IDF that is ledc_timer_config, ledc_channel_config and ledc_set_duty.',
    'An LED switched at 5 kHz looks steady: the eye averages, so brightness follows the duty. A motor’s inertia averages too, so speed follows duty × supply, through a MOSFET, never straight from the pin.',
    'Below about 15 % the motor stalls: the average voltage no longer beats its friction. Same pin, same code; the RGB LED lesson mixes colours this way.',
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Duty', min: 0, max: 100, initial: 30, step: 1, format: (v) => `${Math.round(v)} %` },
    { kind: 'choice', key: 'load', options: Object.entries(DUTY_LOADS).map(([value, label]) => ({ value, label })), initial: 'led' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const pinWire = boardWithPin(scene, [[3, 9.6, 0], [3, 4, 0]])
    const tee = junction(scene, [3, 4, 0], 0.4)
    const led = ledLoad(scene, [10, 4, 0], 7, LED_R)
    partLetter(led.g, 'LED', [2.2, 1.8, 0], 0.7, LABEL)
    const drv = motorDriver(scene, [11, 1.2, 0])
    const gateWire = signalWire(drv.g, [[3 - 11, 4 - 1.2, 0], [3 - 11, drv.gate[1] - 1.2, 0], [drv.gate[0] - 11, drv.gate[1] - 1.2, 0]])
    const { sc, lane, traces } = laneScope(scene, [0, -6.8, 0], 26, 8, [
      { label: 'timer', color: RING },
      { label: 'pin', color: PIN_COLOR },
    ], [12, 4])
    const duty = sc.level(RING)
    const cmp = liveLabel(scene, [0, -12, 0], { size: 0.75 })
    const code = codeBlock(scene, [-19, -14, 0], 0.7)
    const avg = meterBar(scene, [-6, -20.2, 0], 20, 1, [[0.5, '50 %', GREY]], 'avg')
    const s = { t: 0, led: 1, motor: 0, rpm: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = dutyCounts(n(p, 'duty') / 100, D_BITS)
        const d = c / 2 ** D_BITS
        const motorOn = p.load === 'motor'
        s.t += dt
        const t = s.t / (D_HZ * SHOWN_PERIOD_S)
        const win = 3 / D_HZ
        const at = (u: number) => t - (1 - u) * win
        traces[0].draw((u) => lane(0, ledcCount(at(u), D_HZ, D_BITS) / 2 ** D_BITS))
        traces[1].draw((u) => lane(1, +pwmHigh(at(u), D_HZ, d)))
        duty.set(lane(0, d))
        const count = ledcCount(t, D_HZ, D_BITS)
        const high = pwmHigh(t, D_HZ, d)
        cmp.set(`count ${count} ${count < c ? '<' : '>='} duty ${c}: pin ${high ? 'HIGH' : 'LOW'}`, high ? PIN_COLOR : GREY)
        pinWire(+high)
        tee.set(+high)
        s.led = glide(dt, s.led, +!motorOn, 8)
        s.motor = 1 - s.led
        presence(led.g, s.led)
        presence(drv.g, s.motor)
        led.lamp.set(d)
        led.lamp.step(dt)
        gateWire(+high)
        drv.fet.set(+high)
        drv.drain(high ? 0 : 1)
        s.rpm = glide(dt, s.rpm, motorRpm(pwmAverage(MOTOR_V, d)), 3)
        drv.motor.spin(dt, s.rpm)
        const supply = motorOn ? MOTOR_V : VDD
        avg(d, volts(pwmAverage(supply, d)), d > 0 ? POWER : GREY)
        code([`ledcAttach(${PIN}, ${D_HZ}, ${D_BITS});  // pin, Hz, bits`, `ledcWrite(${PIN}, ${c});  // ${c} / 256`, `ledc_set_duty(mode, LEDC_CHANNEL_0, ${c});`])
      },
      readouts: (p) => {
        const c = dutyCounts(n(p, 'duty') / 100, D_BITS)
        const d = c / 256
        const motorOn = p.load === 'motor'
        const r = motorRpm(pwmAverage(MOTOR_V, d))
        return [
          { label: 'Duty', value: `${c} / 256` },
          { label: 'Average', value: volts(pwmAverage(motorOn ? MOTOR_V : VDD, d)) },
          motorOn
            ? { label: 'Motor', value: r > 0 ? rpm(r) : 'stalled', tone: r > 0 ? 'ok' : 'bad' }
            : { label: 'LED avg', value: mA(LED_PEAK_A * d), tone: 'ok' },
        ]
      },
    }
  },
}

// --- Frequency choice: too slow and a motor whines (and LEDs flicker); too fast and the switch heats up and resolution drops. ---

const F_DUTY = 0.5
const F_AMPS = (MOTOR_V / TT_MOTOR.ohms) * F_DUTY
const coilCycle = memoBy((hz: number) => String(hz), (hz: number) => rcSteadyCycle('low', (c) => (frac(c) < F_DUTY ? 1 : 0), hz, TT_COIL_TAU, 128).output)
const fOf = (p: Record<string, number | string>) => Math.round(n(p, 'hz'))
const fLoss = (hz: number) => switchingLoss(MOTOR_V, F_AMPS, PIN_GATE_EDGE_S, hz)
const fRipple = (hz: number) => pwmRipple(MOTOR_V / TT_MOTOR.ohms, F_DUTY, hz, TT_COIL_TAU)

export const frequencyChoice: Lesson = {
  id: 'pwm-frequency-choice',
  title: 'Frequency choice',
  tagline: 'Above hearing, below heating',
  formula: (p) => {
    const f = fOf(p)
    const bits = ledcResolution(f)
    return `80 MHz / ${hertz(f)} → ${bits} bits · switching loss = V × I × t_edge × f = 5 V × ${amps(F_AMPS)} × 100 ns × ${hertz(f)} = ${watts(fLoss(f))} · coil ripple ${amps(fRipple(f))} p-p`
  },
  legend: [
    { color: POWER, label: 'Motor current at 50 % duty (coil L/R 0.2 ms)', shape: 'dot' },
    { color: HEAT, label: 'Rings = audible whine; waves = switch heat', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Duty sets the average; frequency is how often the pin repeats it. Every choice is a trade.',
    'Too low and the motor current rises and collapses each period: the windings vibrate, and between 20 Hz and 20 kHz you hear it as a whine. Below ~100 Hz an LED visibly flickers (and strobes on camera).',
    'Too high and every edge costs energy: the MOSFET spends ~100 ns half on, half off, at full voltage and current. Loss = V × I × t_edge × f grows with f, so at 1 MHz the switch runs hot for nothing.',
    'The ESP32 adds its own limit: the LEDC timer counts an 80 MHz clock, so one period holds 80 MHz / f ticks. 5 kHz leaves 13 bits; 1 MHz only 6 (64 duty steps).',
    'Rules of thumb: LEDs 1–5 kHz, motors 20–25 kHz (silent, 11 bits, a few mW of switching loss), servos exactly 50 Hz. The buck converter lesson makes the same trade for its inductor.',
  ],
  controls: [{ kind: 'slider', key: 'hz', label: 'Frequency', min: 20, max: 1e6, initial: 1000, log: true, format: (v) => hertz(Math.round(v)) }],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const drv = motorDriver(scene, [1, 1.2, 0])
    const pinWire = boardWithPin(scene, [[-4.4, 9.6, 0], [-4.4, drv.gate[1], 0], drv.gate])
    const canAt: V3 = [1, 5.8, -1.2]
    const rings = Array.from({ length: 3 }, (_, i) => {
      const m = new THREE.MeshBasicMaterial({ color: HEAT, transparent: true, opacity: 0, depthWrite: false })
      const ring = add(scene, mesh(new THREE.TorusGeometry(1, 0.03, 6, 48), m), canAt)
      return { ring, m, phase: i / 3 }
    })
    const heat = heatWaves(scene, 1.2, { count: 3, rise: 1.8 })
    heat.group.position.set(5.4, -1.8, 0.4)
    const big = liveLabel(scene, [14, 7.2, 0], { size: 1.4 })
    const verdict = liveLabel(scene, [14, 4.8, 0], { size: 0.75 })
    const bitsTag = liveLabel(scene, [14, 3, 0], { size: 0.7, color: GREY })
    const { lane, traces } = laneScope(scene, [0, -6.6, 0], 28, 6, [
      { label: 'pin', color: PIN_COLOR },
      { label: 'I', color: POWER },
    ], [12, 2])
    const code = codeBlock(scene, [-19, -11.4, 0], 0.7, 2)
    const loss = meterBar(scene, [-6, -15.8, 0], 20, 0.3, [[0.05, '50 mW', RING]], 'loss')
    const ripple = meterBar(scene, [-6, -19.4, 0], 20, MOTOR_V / TT_MOTOR.ohms, [], 'ripple')
    const s = { t: 0, key: 0, rpm: 0, sound: 0, ring: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const f = fOf(p)
        if (f !== s.key) Object.assign(s, { key: f, t: 0 })
        s.t += dt
        const t = s.t / (f * SHOWN_PERIOD_S)
        const cycle = coilCycle(f)
        const win = 3 / f
        const at = (u: number) => t - (1 - u) * win
        traces[0].draw((u) => lane(0, +pwmHigh(at(u), f, F_DUTY)))
        traces[1].draw((u) => lane(1, cycle[Math.floor(frac(at(u) * f) * cycle.length) % cycle.length]))
        const high = pwmHigh(t, f, F_DUTY)
        pinWire(+high)
        drv.drain(high ? 0 : 1)
        const w = fLoss(f)
        drv.fet.set(+high, Math.min(1, w / 0.1))
        heat.step(dt, w / 0.1)
        s.rpm = glide(dt, s.rpm, motorRpm(pwmAverage(MOTOR_V, F_DUTY)), 3)
        drv.motor.spin(dt, s.rpm)
        const rip = fRipple(f)
        const loud = audible(f) ? Math.min(1, rip / 0.3 + 0.25) : 0
        s.sound = glide(dt, s.sound, loud, 6)
        s.ring = (s.ring + dt * 1.4) % 1
        for (const r of rings) {
          const ph = (s.ring + r.phase) % 1
          r.ring.scale.setScalar(2.4 + 2.6 * ph)
          r.m.opacity = 0.6 * s.sound * (1 - ph)
        }
        const hot = w > 0.05
        const tint = audible(f) ? HEAT : hot ? HIGH_V : POWER
        big.set(hertz(f), tint)
        verdict.set(f < FLICKER_HZ ? 'whine + LED flicker' : audible(f) ? 'audible whine' : hot ? 'silent, switch runs hot' : 'silent, cool switch', tint)
        const bits = ledcResolution(f)
        bitsTag.set(`LEDC: ${bits} bits, ${2 ** bits} steps`)
        loss(w, watts(w), w > 0.05 ? HIGH_V : POWER)
        ripple(rip, `${amps(rip)} p-p`, rip > 0.3 ? HEAT : POWER)
        code([`ledcAttach(${PIN}, ${f}, ${bits});  // max ${bits} bits`, `ledcWrite(${PIN}, ${dutyCounts(F_DUTY, bits)});  // 50 %`])
      },
      readouts: (p) => {
        const f = fOf(p)
        const bits = ledcResolution(f)
        return [
          { label: 'Sound', value: audible(f) ? 'whine' : 'silent', tone: audible(f) ? 'warn' : 'ok' },
          { label: 'Ripple', value: amps(fRipple(f)), tone: fRipple(f) > 0.3 ? 'warn' : 'ok' },
          { label: 'Switch loss', value: watts(fLoss(f)), tone: fLoss(f) > 0.05 ? 'bad' : 'ok' },
          { label: 'Resolution', value: `${bits} bits`, tone: bits < 8 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Servo pulses: a 50 Hz frame whose 1–2 ms pulse sets the horn angle. ---

const SERVO_PIN = 13
const SERVO_BITS = 16
const SV = { at: [7, 2.2, 0] as V3, k: 2.6 }
const SHAFT: V3 = [SV.at[0] - 0.75 * SV.k, SV.at[1], SV.at[2] + 1.75 * SV.k]
const ARC_R = 7.4
const SV_SLOW = 25
const sweepPulse = (t: number) => servoPulse(90 - 90 * Math.cos(t * 0.9))
const pulseOf = (p: Record<string, number | string>, t: number) => (p.mode === 'sweep' ? sweepPulse(t) : n(p, 'pulse') / 1000)
const ms = (s: number) => (s * 1000).toFixed(2)
const servoCounts = (pulse: number) => dutyCounts(pulse * SERVO_HZ, SERVO_BITS)

export const servoPulses: Lesson = {
  id: 'pwm-servo-pulses',
  title: 'Servo pulses',
  tagline: 'Pulse width is position',
  formula: (p) => {
    const pulse = p.mode === 'sweep' ? servoPulse(90) : n(p, 'pulse') / 1000
    return `angle = (pulse − 1 ms) / 1 ms × 180° = (${ms(pulse)} − 1) × 180° = ${Math.round(servoAngle(pulse))}° · duty = ${ms(pulse)} ms / 20 ms = ${(pulse * SERVO_HZ * 100).toFixed(1)} % = ${servoCounts(pulse)} / 65536`
  },
  legend: [
    { color: PIN_COLOR, label: `Signal: one pulse every 20 ms, slowed ${SV_SLOW}×`, shape: 'dot' },
    { color: RING, label: 'Dot = commanded angle', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A hobby servo is not driven by the average. It reads the width of one pulse in each 20 ms frame (50 Hz): 1 ms means 0°, 1.5 ms 90°, 2 ms 180°.',
    'Inside, a pot on the output shaft measures the angle and a small controller drives the motor until it matches the pulse. That is a closed loop: the horn holds its angle against a push.',
    'The horn moves at a finite speed: an SG90 takes about 0.1 s per 60°, so a big jump takes a third of a second.',
    'On the ESP32, set LEDC to 50 Hz with 16 bits: one count is 20 ms / 65536 ≈ 0.3 µs, so 1.5 ms is ledcWrite(pin, 4915). Many SG90s actually reach their ends near 0.5 and 2.5 ms: check before forcing them.',
    'Power the servo from 5 V, not the 3.3 V pin; the signal can still come from a 3.3 V GPIO. Share the grounds.',
  ],
  controls: [
    { kind: 'slider', key: 'pulse', label: 'Pulse', min: 1, max: 2, initial: 1.5, step: 0.05, format: (v) => `${v.toFixed(2)} ms` },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'set', label: 'Hold' },
        { value: 'sweep', label: 'Sweep' },
      ],
      initial: 'set',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const holder = add(scene, new THREE.Group(), SV.at)
    holder.scale.setScalar(SV.k)
    const horn = sg90Servo(holder, [0, 0, 0])
    partLetter(scene, 'SG90', [SV.at[0] + 3.4, SV.at[1] - 3.2, 0], 0.8, LABEL, 'left')
    const foot = SV.at[1] - 0.8 * SV.k
    const sig = boardWithPin(scene, [[-6, 9.6, 0], [-6, -2, 0], [3.6, -2, 0], [3.6, foot, 0]], SERVO_PIN)
    signalWire(scene, [[-3.4, -2.8, 0], [4.4, -2.8, 0], [4.4, foot, 0]])(1)
    signalWire(scene, [[-3.4, -3.6, 0], [5.2, -3.6, 0], [5.2, foot, 0]])(0)
    partLetter(scene, '5V', [-4, -2.8, 0], 0.55, HIGH_V, 'right')
    partLetter(scene, 'GND', [-4, -3.7, 0], 0.55, LOW_V, 'right')
    const arcZ = SHAFT[2] - 0.4
    add(scene, mesh(new THREE.TorusGeometry(ARC_R, 0.07, 8, 64, Math.PI), mat('#5c6270', { rough: 0.5 })), [SHAFT[0], SHAFT[1], arcZ])
    for (const deg of [0, 45, 90, 135, 180]) {
      const a = (deg * Math.PI) / 180
      add(scene, mesh(new THREE.BoxGeometry(0.6, 0.12, 0.12), glowMat(GREY, 0.4)), [SHAFT[0] + ARC_R * Math.cos(a), SHAFT[1] + ARC_R * Math.sin(a), arcZ]).rotation.z = a
      const end = deg % 180 === 0
      partLetter(scene, `${deg}°`, [SHAFT[0] + (ARC_R + (end ? 0 : 1.2)) * Math.cos(a), SHAFT[1] + (ARC_R + 1.2) * Math.sin(a) - (end ? 1.3 : 0.3), 0], 0.55, GREY)
    }
    const target = add(scene, mesh(new THREE.SphereGeometry(0.4, 16, 12), glowMat(RING, 1.2)), [0, 0, arcZ])
    const frameScope = laneScope(scene, [-6, -9, 0], 20, 4, [{ label: 'pin', color: PIN_COLOR }], [8, 2])
    ticks(frameScope.sc, [[0, '0'], [0.25, '10'], [0.5, '20'], [0.75, '30'], [1, '40']], [], 0.6)
    partLetter(scene, 'ms', [5.4, -12.1, 0], 0.55, GREY, 'left')
    const zoomW = 10
    const zoom = scope(scene, zoomW, 4, { divs: [5, 2] })
    zoom.group.position.set(12.6, -9, 0)
    const zoomTrace = zoom.trace(PIN_COLOR, { samples: 200, radius: 0.11 })
    ticks(zoom, [[0, '0'], [0.4, '1'], [0.8, '2']], [], 0.6)
    partLetter(scene, 'zoom, ms', [12.6, -13, 0], 0.55, GREY)
    const width = liveLabel(scene, [12.6, -5.8, 0], { size: 0.75, color: PIN_COLOR })
    const code = codeBlock(scene, [-19, -14.8, 0], 0.7)
    const s = { t: 0, deg: 90 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        s.t += dt
        const pulse = pulseOf(p, s.t)
        const goal = servoAngle(pulse)
        s.deg = servoStep(s.deg, goal, dt)
        horn.rotation.z = ((s.deg - 90) * Math.PI) / 180
        const a = (goal * Math.PI) / 180
        target.position.set(SHAFT[0] + ARC_R * Math.cos(a), SHAFT[1] + ARC_R * Math.sin(a), arcZ)
        const t = s.t / SV_SLOW
        const frame = 1 / SERVO_HZ
        const high = (tt: number) => frac(tt / frame) * frame < pulse
        frameScope.traces[0].draw((u) => frameScope.lane(0, +high(t - (1 - u) * 2 * frame)))
        zoomTrace.draw((u) => (u * 2.5e-3 < pulse ? 1.2 : -1.2), null)
        sig(+high(t))
        width.set(`${ms(pulse)} ms`)
        const c = servoCounts(pulse)
        code([`ledcAttach(${SERVO_PIN}, 50, ${SERVO_BITS});  // 20 ms frame`, `ledcWrite(${SERVO_PIN}, ${c});  // ${ms(pulse)} ms`, `ledc_set_duty(mode, LEDC_CHANNEL_1, ${c});`])
      },
      readouts: (p) => {
        const pulse = pulseOf(p, s.t)
        return [
          { label: 'Pulse', value: `${ms(pulse)} ms` },
          { label: 'Angle', value: `${Math.round(s.deg)}° → ${Math.round(servoAngle(pulse))}°`, tone: Math.abs(s.deg - servoAngle(pulse)) < 1 ? 'ok' : 'warn' },
          { label: 'Duty', value: `${servoCounts(pulse)} = ${(pulse * SERVO_HZ * 100).toFixed(1)} %` },
        ]
      },
    }
  },
}

// --- Average voltage: an RC or a motor's inertia smooths PWM into its mean; ripple shrinks as the period drops below τ. ---

const AV_R = 10e3
const AV_C = 1e-6
const SMOOTHERS = {
  rc: { label: 'RC 10 kΩ · 1 µF', tau: rcTau(AV_R, AV_C), supply: VDD },
  motor: { label: 'Motor inertia', tau: TT_SPIN_TAU, supply: MOTOR_V },
} as const
const avOf = (p: Record<string, number | string>) => {
  const k = pick(SMOOTHERS, p.via, 'rc')
  const d = dutyCounts(n(p, 'duty') / 100, D_BITS) / 2 ** D_BITS
  const hz = Math.round(n(p, 'hz'))
  const { tau, supply } = SMOOTHERS[k]
  return { k, d, hz, tau, supply, avg: pwmAverage(supply, d), ripple: pwmRipple(supply, d, hz, tau) }
}
const avCycle = memoBy(
  (a: ReturnType<typeof avOf>) => `${a.k}|${a.d}|${a.hz}`,
  (a: ReturnType<typeof avOf>) => rcSteadyCycle('low', (c) => (frac(c) < a.d ? a.supply : 0), a.hz, a.tau, 256).output,
)
const speedRipple = (avg: number, ripple: number) => motorRpm(avg + ripple / 2) - motorRpm(avg - ripple / 2)

export const averageVoltage: Lesson = {
  id: 'pwm-average-voltage',
  title: 'Average voltage',
  tagline: 'Something slow does the averaging',
  formula: (p) => {
    const a = avOf(p)
    return `V_avg = D × V = ${pct(a.d)} × ${volts(a.supply)} = ${volts(a.avg)} · ripple = ${volts(a.ripple)} p-p, period ${secs(1 / a.hz)} vs τ = ${secs(a.tau)}`
  },
  legend: [
    { color: PIN_COLOR, label: 'Pin (or motor terminal): full on / off', shape: 'dot' },
    { color: POWER, label: 'Averaged: capacitor voltage or motor speed', shape: 'dot' },
    { color: RING, label: 'Dashed = D × V', shape: 'dot' },
  ],
  points: [
    'A PWM pin is never at 1 V: it is at 3.3 V or 0 V. "Average voltage" only appears once something slower than the switching averages it.',
    'An RC low-pass is the electrical version: the capacitor charges while the pin is high and discharges while it is low, settling around D × V. The Filters lesson (PWM to analog) picks its corner frequency.',
    'A motor does it mechanically: its rotor and gearbox have inertia, so the speed cannot follow each pulse and settles where the average voltage puts it.',
    'What is left is ripple. With a period much shorter than the time constant τ, ripple ≈ V × D × (1 − D) × T / τ: double the frequency, half the ripple. It is worst at 50 % duty.',
    `The averaging object sets how fast PWM must be. Time is slowed so one period lasts ${SHOWN_PERIOD_S} s.`,
  ],
  controls: [
    { kind: 'choice', key: 'via', options: Object.entries(SMOOTHERS).map(([value, s]) => ({ value, label: s.label })), initial: 'rc' },
    { kind: 'slider', key: 'duty', label: 'Duty', min: 0, max: 100, initial: 30, step: 1, format: (v) => `${Math.round(v)} %` },
    { kind: 'slider', key: 'hz', label: 'Frequency', min: 20, max: 5000, initial: 100, log: true, format: (v) => hertz(Math.round(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const pinWire = boardWithPin(scene, [[-4.4, 9.6, 0], [-4.4, 4, 0]])
    const tee = junction(scene, [-4.4, 4, 0], 0.4)
    const rc = add(scene, new THREE.Group())
    const stub = signalWire(rc, [[-4.4, 4, 0], [-3.4, 4, 0]])
    resistorAlong(rc, AV_R, [-3.4, 4, 0], [1.2, 4, 0], 1.4)
    partLetter(rc, ohms(AV_R), [-1.1, 5.6, 0], 0.6, GREY)
    const out = signalWire(rc, [[1.2, 4, 0], [8, 4, 0]])
    const node = junction(rc, [4, 4, 0], 0.4)
    ceramicAlong(rc, [4, 4, 0], [4, -0.6, 0], 1.1)
    groundAt(rc, [4, -0.6, 0])
    partLetter(rc, si(AV_C, 'F'), [5.6, 1.7, 0], 0.6, GREY, 'left')
    const vOut = liveLabel(rc, [8.6, 4, 0], { size: 0.9, align: 'left' })
    const drv = motorDriver(scene, [3, 1.2, 0])
    const gateWire = signalWire(drv.g, [[-4.4 - 3, 4 - 1.2, 0], [-4.4 - 3, drv.gate[1] - 1.2, 0], [drv.gate[0] - 3, drv.gate[1] - 1.2, 0]])
    const speed = liveLabel(drv.g, [5, 4.6, 0], { size: 0.9, align: 'left' })
    const H = 8
    const sc = scope(scene, 26, H, { divs: [12, 4], zeroAt: 0 })
    sc.group.position.set(0, -7.2, 0)
    const yOf = (v: number, vmax: number) => -H / 2 + 0.4 + (H - 1) * (v / vmax)
    const inTrace = sc.trace(PIN_COLOR, { samples: 320, radius: 0.09 })
    const outTrace = sc.trace(POWER, { samples: 320, radius: 0.13 })
    const mean = sc.level(RING)
    const code = codeBlock(scene, [-19, -12.8, 0], 0.7, 2)
    const meter = meterBar(scene, [-6, -17, 0], 20, MOTOR_V, [[VDD, '3.3 V', GREY]], 'avg')
    const rippleBar = meterBar(scene, [-6, -20.2, 0], 20, MOTOR_V, [], 'ripple')
    const s = { t: 0, key: '', rc: 1, rpm: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const a = avOf(p)
        const key = `${a.k}|${a.hz}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const t = s.t / (a.hz * SHOWN_PERIOD_S)
        const cycle = avCycle(a)
        const sample = (tt: number) => cycle[Math.floor(frac(tt * a.hz) * cycle.length) % cycle.length]
        const win = 3 / a.hz
        const at = (u: number) => t - (1 - u) * win
        inTrace.draw((u) => yOf(pwmHigh(at(u), a.hz, a.d) ? a.supply : 0, a.supply))
        outTrace.draw((u) => yOf(sample(at(u)), a.supply))
        mean.set(yOf(a.avg, a.supply))
        const high = pwmHigh(t, a.hz, a.d)
        const v = sample(t)
        pinWire(+high)
        tee.set(+high)
        stub(+high)
        s.rc = glide(dt, s.rc, a.k === 'rc' ? 1 : 0, 8)
        presence(rc, s.rc)
        presence(drv.g, 1 - s.rc)
        out(v / VDD)
        node.set(v / VDD)
        vOut.set(volts(v), POWER)
        gateWire(+high)
        drv.fet.set(+high)
        drv.drain(high ? 0 : 1)
        s.rpm = motorRpm(v)
        drv.motor.spin(dt, s.rpm)
        speed.set(rpm(s.rpm), POWER)
        meter(a.avg, volts(a.avg), POWER)
        rippleBar(a.ripple, `${volts(a.ripple)} p-p`, a.ripple > 0.1 * a.supply ? HEAT : POWER)
        const c = dutyCounts(a.d, D_BITS)
        code([`ledcAttach(${PIN}, ${a.hz}, ${D_BITS});`, `ledcWrite(${PIN}, ${c});  // ${pct(a.d)} of ${volts(a.supply)}`])
      },
      readouts: (p) => {
        const a = avOf(p)
        const motorOn = a.k === 'motor'
        const big = a.ripple > 0.1 * a.supply
        return [
          { label: 'Average', value: motorOn ? `${volts(a.avg)}, ${rpm(motorRpm(a.avg))}` : volts(a.avg), tone: 'ok' },
          { label: 'Ripple', value: motorOn ? `${rpm(speedRipple(a.avg, a.ripple))} p-p` : `${volts(a.ripple)} p-p`, tone: big ? 'warn' : 'ok' },
          { label: 'Period / τ', value: `${secs(1 / a.hz)} / ${secs(a.tau)}` },
        ]
      },
    }
  },
}
