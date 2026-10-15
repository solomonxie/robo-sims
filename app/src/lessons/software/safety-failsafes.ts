import * as THREE from 'three/webgpu'
import {
  ESTOP,
  FAULT,
  FAULT_CAP,
  FaultScenario,
  FaultState,
  StopFault,
  StopKind,
  WDT,
  WdtFeed,
  estopRun,
  faultFsmRun,
  maxWdtTimeout,
  stopDistance,
  wallGap,
  wdtRun,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  cell,
  codeBlock,
  cursorBar,
  esp32Board,
  estopButton,
  flatBox,
  floorMat,
  floorView,
  gantt,
  glowBox,
  glowMat,
  groundAt,
  i2cBreakout,
  junction,
  lidarRobot,
  litWire,
  liveLabel,
  memoBy,
  meterBar,
  moduleBlock,
  motorCan,
  relayPart,
  scope,
  setGlow,
  simClock,
  stateDiagram,
  wire,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const opts = <R extends Record<string, string>>(rec: R) => (Object.keys(rec) as (keyof R & string)[]).map((k) => ({ value: k, label: rec[k] }))
const WALL_IDLE = '#3a3e47'
const lit = (c: string) => new THREE.Color(c)

// --- Watchdog: the loop feeds the task WDT; an I²C read that never returns stops the feeding and the WDT resets the chip. ---

const FEED = { loop: 'Feed at end of loop()', wait: 'Feed inside the wait', none: 'No watchdog' }
const WDT_TO = { t1: 'Timeout 1 s', t5: 'Timeout 5 s (IDF default)' }
const WDT_TO_S = { t1: 1, t5: 5 }
const wdtParams = (p: Params) => [pick(FEED, p.feed, 'loop') as WdtFeed, pick(WDT_TO, p.timeout, 't1')] as const
const wdtMemo = memoBy((q: readonly [WdtFeed, string]) => q.join(), ([f, to]) => wdtRun(f, WDT_TO_S[to as keyof typeof WDT_TO_S]))
const hangX = (frames: { phase: string; x: number }[]) => frames.find((f) => f.phase === 'hung')?.x ?? 0
const wdtCode = (feed: WdtFeed) =>
  feed === 'wait'
    ? ['  Wire.requestFrom(0x29, 2);', '  while (!Wire.available())', '    esp_task_wdt_reset();  // hides it', '  drive(range() > 0.3 ? 0.4 : 0); }']
    : feed === 'loop'
      ? ['void loop() {', '  d = tof.readRange();  // I²C, may hang', '  drive(d > 0.3 ? 0.4 : 0);', '  esp_task_wdt_reset(); }']
      : ['void loop() {', '  d = tof.readRange();  // I²C, may hang', '  drive(d > 0.3 ? 0.4 : 0); }', '// no watchdog: a hang lasts forever']

export const watchdog: Lesson = {
  id: 'safety-failsafes-watchdog',
  title: 'Watchdog',
  tagline: 'Reset the chip when the loop stops',
  formula: (p) => {
    const [, to] = wdtParams(p)
    const gap = wallGap(hangX(wdtMemo(wdtParams(p)).frames))
    const tMax = maxWdtTimeout(gap, WDT.v, WDT.decel)
    return `hang → reset after T; travel = v·T + v²/2a = ${WDT.v}·${WDT_TO_S[to]} + ${((WDT.v * WDT.v) / (2 * WDT.decel)).toFixed(2)} = ${stopDistance(WDT.v, WDT_TO_S[to], WDT.decel).toFixed(2)} m · gap ${gap.toFixed(2)} m → T ≤ ${tMax.toFixed(1)} s`
  },
  legend: [
    { color: RING, label: 'WDT count since the last feed', shape: 'dot' },
    { color: HEAT, label: 'Robot speed', shape: 'dot' },
    { color: HIGH_V, label: 'Hung I²C read / reset / crash', shape: 'dot' },
    { color: POWER, label: 'Loop running, I²C answering', shape: 'dot' },
  ],
  points: [
    'A watchdog timer (WDT) is a hardware counter that resets the chip unless the firmware "feeds" it in time. The ESP32 has a task watchdog (TWDT) that watches chosen tasks and interrupt watchdogs for ISRs; in Arduino, esp_task_wdt_add(NULL) puts loop() on it and esp_task_wdt_reset() feeds it.',
    'Here loop() reads a VL53L0X range sensor over I²C 20 times a second and stops before the wall. At 2 s a glitch leaves the sensor holding SDA low, and the read waits forever for bytes that never come. The motor driver keeps the last PWM, so the robot drives on blind.',
    'Fed once at the end of loop(), the count stops being reset the moment loop() hangs. After the timeout the TWDT panics and reboots (esp_reset_reason() = ESP_RST_TASK_WDT). The pins go back to inputs, the driver enable is pulled low, and the motors stop. setup() then clears the bus (9 SCL pulses) and the robot runs again.',
    'Feeding in the wrong place hides the hang. A reset call inside the wait loop, or in a timer interrupt, keeps the dog happy while the work is stuck. Feed in one place, only after the whole loop did its job; with several tasks, register each one so any single stall trips it.',
    'The timeout is a safety number. The robot moves v·T before the reset plus its braking distance, so T must fit the gap ahead: 1 s here, not the 5 s IDF default. Give I²C reads their own timeout too (Wire.setTimeOut) so the watchdog is the last line, not the first.',
  ],
  controls: [
    { kind: 'choice', key: 'feed', options: opts(FEED), initial: 'loop' },
    { kind: 'choice', key: 'timeout', options: opts(WDT_TO), initial: 't1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const pin = esp32Board(scene, [-16.5, 4.2, 0], 0.42)
    const status = liveLabel(scene, [-16.5, 7.4, 0.3], { size: 0.42 })
    const tof = i2cBreakout(scene, [-16.5, -1.6, 0], { name: 'VL53L0X', color: '#6a2a86', k: 0.3 })
    const bus = (['SCL', 'SDA'] as const).map((nm, k) => {
      const a = tof.pin(nm)
      const b = pin(k ? -2 : -3, false)
      const pts: V3[] = [a, [a[0], 1.2 + k * 0.4, 0], [b[0], 1.2 + k * 0.4, 0], [b[0], b[1], 0]]
      wire(scene, pts, 0.08)
      return litWire(scene, pts, 0.16)
    })
    const serial = liveLabel(scene, [-16.5, -4.6, 0.3], { size: 0.36 })
    const count = meterBar(scene, [-17.6, -7.6, 0], 4, 1.2, [[1, 'reset', HIGH_V]], 'WDT')

    const g = floorView(scene, [-9.2, 3, 0], 4.6, -0.35)
    floorMat(g, [-0.3, WDT.wallX], [-0.35, 0.35])
    const wallM = glowMat(WALL_IDLE, 0.2)
    box(g, [0.06, 0.7, 0.3], wallM, [WDT.wallX + 0.03, 0, 0.15])
    addLabel(g, 'wall', [WDT.wallX + 0.03, -0.5, 0.02], GREY, 0.14)
    const robot = lidarRobot(g, 1, 0.24)
    const stopMark = flatBox(g, [0.02, 0.5, 0.006], glowMat(POWER, 1), [0, 0, 0.006])
    const hangMark = flatBox(g, [0.02, 0.6, 0.006], glowMat(HIGH_V, 1), [0, 0, 0.006])
    const hangTag = liveLabel(g, [0, 0.45, 0.02], { size: 0.12 })

    const plot = scope(scene, 10, 5, { divs: [9, 4], zeroAt: 0.1 })
    plot.group.position.set(9.4, 2.8, 0)
    const yOf = (u: number) => (u * 0.75 - 0.4) * plot.height
    const tr = { count: plot.trace(RING, { samples: 900, radius: 0.06 }), v: plot.trace(HEAT, { samples: 900, radius: 0.08 }) }
    plot.level(HIGH_V).set(yOf(1))
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `WDT count, speed · 0 … ${WDT.seconds} s`, [9.4, -0.6, 0.3], GREY, 0.4)
    const code = codeBlock(scene, [3, -2.4, 0.3], 0.34, 4)
    const note = liveLabel(scene, [-9.4, -5.6, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-9.4, -6.8, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(WDT.dt, 2)
    const st = { t: 0, key: '' }
    const us: number[] = []
    const ys: number[][] = [[], []]
    return {
      scene,
      view: { center: [-3, -0.6, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = wdtParams(p)
        const [feed, to] = q
        const toS = WDT_TO_S[to]
        const key = q.join()
        const { frames, resetAt } = wdtMemo(q)
        const i = Math.floor(clock(dt, key, frames.length - 1))
        const f = frames[i]
        const now = f.t
        st.t = now
        if (key !== st.key) {
          st.key = key
          us.length = ys[0].length = ys[1].length = 0
          for (const h of frames) {
            us.push(h.t / WDT.seconds)
            ys[0].push(Number.isNaN(h.count) ? -plot.height : yOf(Math.min(1.1, h.count / toS)))
            ys[1].push(yOf(h.v / 0.5))
          }
          tr.count.points(us, ys[0])
          tr.v.points(us, ys[1])
          code(wdtCode(feed))
        }
        cur(now / WDT.seconds)

        const hung = f.phase === 'hung'
        const boot = f.phase === 'boot'
        const pulse = 0.5 + 0.5 * Math.sin(now * 60)
        bus[0].set(hung || boot ? 0 : pulse, lit(POWER))
        bus[1].set(hung ? 1 : boot ? 0 : 1 - pulse, lit(hung ? HIGH_V : POWER))
        tof.chip(hung ? HIGH_V : POWER, hung ? 1 : boot ? 0 : 0.4)
        tof.led(boot ? 0 : 1)
        status.set(boot ? 'rebooting' : hung ? 'loop() stuck in Wire wait' : 'loop() running', boot ? HEAT : hung ? HIGH_V : POWER)
        const lastReset = resetAt.filter((r) => r <= now).at(-1)
        serial.set(
          lastReset !== undefined && now - lastReset < 1.4 ? (boot ? 'task_wdt: loopTask did not reset' : 'reset: ESP_RST_TASK_WDT') : hung ? 'Wire: waiting for 2 bytes…' : `range ${f.range.toFixed(2)} m`,
          lastReset !== undefined && now - lastReset < 1.4 ? HIGH_V : hung ? HEAT : GREY,
        )
        const c = Number.isNaN(f.count) ? 0 : f.count
        count(Math.min(1.2, c / toS), Number.isNaN(f.count) ? 'off' : `${c.toFixed(2)} s`, c / toS > 0.7 ? HIGH_V : c > WDT.loopS * 1.5 ? HEAT : POWER)

        robot.group.position.set(f.x - 0.06 + 0.12, 0, 0)
        robot.head.rotation.z += dt * 30 * f.v
        setGlow(wallM, f.crashed ? HIGH_V : WALL_IDLE, f.crashed ? 1 : 0.2)
        const hx = hangX(frames)
        hangMark.visible = hangTag.group.visible = frames.some((h) => h.phase === 'hung' && h.t <= now)
        hangMark.position.x = hangTag.group.position.x = hx + WDT.halfLen
        hangTag.set('hang', HIGH_V)
        stopMark.visible = f.v === 0 && now > 1 && !f.crashed
        stopMark.position.x = f.x + WDT.halfLen + 0.01

        const fin = frames[frames.length - 1]
        note.set(boot ? 'WDT reset: pins released, motors off' : hung ? `Hung for ${(now - (frames.find((h) => h.phase === 'hung')?.t ?? now)).toFixed(2)} s, motors on last PWM` : f.resets ? 'Rebooted, bus cleared, loop running' : 'Loop reads range, drives, feeds the WDT', boot || hung ? HIGH_V : LABEL)
        result.set(
          f.crashed ? 'Crash: nothing stopped the stale motor command' : feed === 'loop' && hung ? `WDT bites in ${(toS - f.count).toFixed(2)} s` : feed === 'wait' && hung ? 'Count stays at 0: the feed is inside the stuck wait' : fin.crashed ? (feed === 'none' ? 'No watchdog: a hang lasts forever' : `WDT will bite at ${toS} s, too late`) : `Stops ${wallGap(fin.x).toFixed(2)} m short after ${fin.resets} reset`,
          f.crashed || (fin.crashed && hung) ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const q = wdtParams(p)
        const { frames } = wdtMemo(q)
        const f = frames[Math.min(frames.length - 1, Math.round(st.t / WDT.dt))]
        const fin = frames[frames.length - 1]
        const toS = WDT_TO_S[q[1]]
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (1×)` },
          { label: 'WDT count', value: Number.isNaN(f.count) ? 'off' : `${Math.round(f.count * 1000)} / ${toS * 1000} ms`, tone: Number.isNaN(f.count) ? 'warn' : f.count / toS > 0.7 ? 'bad' : 'ok' },
          { label: 'Resets', value: `${f.resets}`, tone: f.resets ? 'warn' : 'ok' },
          { label: 'Outcome', value: fin.crashed ? 'hits the wall' : `stops ${wallGap(fin.x).toFixed(2)} m short`, tone: fin.crashed ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- E-stop: an NC mushroom in the contactor coil loop cuts motor power in hardware; vs a GPIO the firmware polls. ---

const KIND = { sw: 'Software stop (GPIO)', cat0: 'Hardware cut (cat 0)', cat1: 'Brake, then cut (cat 1)' }
const SFAULT = { none: 'Firmware OK', hung: 'Firmware hung', short: 'Driver FET shorted' }
const LATCH = { on: 'Latch until reset', off: 'No latch' }
const stopParams = (p: Params) => [pick(KIND, p.kind, 'cat0') as StopKind, pick(SFAULT, p.fault, 'none') as StopFault, pick(LATCH, p.latch, 'on'), Number(p.speed)] as const
const stopMemo = memoBy((q: readonly [StopKind, StopFault, string, number]) => q.join(), ([k, f, l, v]) => estopRun(k, f, l === 'on', v))

export const eStop: Lesson = {
  id: 'safety-failsafes-e-stop',
  title: 'E-stop',
  tagline: 'Cut the power, not just the code',
  formula: (p) => {
    const [k, , , v] = stopParams(p)
    const react = k === 'cat0' ? ESTOP.releaseS : ESTOP.pollS
    const a = k === 'cat0' ? ESTOP.coast : ESTOP.brake
    return `stop = v·t_react + v²/2a = ${v.toFixed(1)}·${msText(react)} + ${v.toFixed(1)}²/(2·${a}) = ${stopDistance(v, react, a).toFixed(2)} m · crate at ${ESTOP.gapM} m`
  },
  legend: [
    { color: RING, label: 'Coil loop: rail → NC contact → K1 coil', shape: 'dot' },
    { color: HEAT, label: 'Motor power through K1', shape: 'dot' },
    { color: B_FIELD, label: 'Software path: GPIO sense, PWM', shape: 'dot' },
    { color: HIGH_V, label: 'Stop pressed / crash', shape: 'dot' },
  ],
  points: [
    'An emergency stop is a red mushroom on a yellow base with a normally-closed (NC) contact. Pressed, it opens; it stays down until you twist it out. Wire that NC contact in series with the coil of a contactor K1 (a big relay) whose contacts carry the battery to the motor driver. Press and the coil loses its current, the spring opens K1, and the motors lose power whatever the firmware is doing.',
    'A software stop is a button on a GPIO: the loop reads it and sets the PWM to 0. It brakes hard and fast, but only if the code is running and the driver obeys. Hang the firmware or weld a driver MOSFET on, and the button does nothing. A wire break on an NC loop also stops the robot (fail-safe); a broken wire to a GPIO just never reports a press.',
    `Cutting power (stop category 0) is the surest stop but the robot then coasts: ${ESTOP.coast} m/s² of friction against ${ESTOP.brake} m/s² of active braking. Category 1 brakes under control first and a time-delay relay cuts power ${msText(ESTOP.cat1S)} later anyway, so a hung controller only delays the cut.`,
    'The stop must latch. Twisting the button out must not restart anything: the contactor stays open until someone presses reset (a START button and K1\'s own hold contact), and the firmware keeps its command at 0 until a fresh start. Without a latch the robot drives off with the last command the moment the button pops up.',
    'Reset is a decision, not a cure: if the firmware is still hung or the FET still shorted, power comes back to a robot that drives off. Real machines also monitor the E-stop circuit (dual channel, a safety relay) so one stuck contact is caught.',
  ],
  controls: [
    { kind: 'choice', key: 'kind', options: opts(KIND), initial: 'cat0' },
    { kind: 'choice', key: 'fault', options: opts(SFAULT), initial: 'none' },
    { kind: 'choice', key: 'latch', options: opts(LATCH), initial: 'on' },
    { kind: 'slider', key: 'speed', label: 'Speed', min: 0.3, max: 1.5, initial: 1, step: 0.1, format: (v: number) => `${v.toFixed(1)} m/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const TOP = 5.2
    const bat = add(scene, cell(4, 1.1), [-18.5, -1.5, 0])
    bat.castShadow = false
    addLabel(scene, '12 V', [-20.3, -1.5, 0.3], LABEL, 0.42, 'right')
    const btn = estopButton(scene, [-14.6, 2.2, 0], 0.75)
    addLabel(scene, 'E-stop (NC)', [-14.6, 5.9, 0.3], LABEL, 0.4)
    const relay = relayPart(scene, [-9.5, -1, 0], { scale: 0.5 })
    addLabel(scene, 'K1', [-9.5, 2.6, 0.3], LABEL, 0.42)
    const [c1, c2] = relay.pins.coil
    const com = relay.pins.com
    const no = relay.pins.no
    const coilPts: V3[] = [[-18.5, 0.9, 0], [-18.5, TOP, 0], [-17.3, TOP, 0], [-17.3, btn.pins[0][1], 0], btn.pins[0]]
    const coilPts2: V3[] = [btn.pins[1], [-12.25, btn.pins[1][1], 0], [-12.25, -3.4, 0], [c1[0], -3.4, 0], c1]
    const coilPts3: V3[] = [c2, [c2[0], -3, 0]]
    const powerPts: V3[] = [[-17.3, TOP, 0], [-0.6, TOP, 0], [-0.6, -6, 0], [com[0], -6, 0], com]
    const hb = moduleBlock(scene, [-4.3, -3.6, 0], [3, 1.4, 0.6], 'L298N')
    const motor = motorCan(scene, [-5, -0.6, 0], { r: 0.9, legs: 0.6 })
    const drivePts: V3[] = [no, [no[0], -3.6, 0], [-5.8, -3.6, 0]]
    const motorPts = motor.pins.map((m): V3[] => [m, [m[0], -2.9, 0]])
    for (const pts of [coilPts, coilPts2, coilPts3, powerPts, drivePts, ...motorPts]) wire(scene, pts, 0.12)
    junction(scene, [-17.3, TOP, 0.1], 0.22)
    groundAt(scene, [-18.5, -3.6, 0])
    groundAt(scene, [c2[0], -3, 0])
    groundAt(scene, [-4.3, -4.3, 0])
    const coilLit = [coilPts, coilPts2, coilPts3].map((pts) => litWire(scene, pts, 0.26))
    const powerLit = [powerPts, drivePts, ...motorPts].map((pts) => litWire(scene, pts, 0.26))
    const pwmPin = esp32Board(scene, [-3.4, 2.6, 0], 0.2)
    addLabel(scene, 'ESP32', [-2.2, 1.1, 0.3], LABEL, 0.32)
    const pwmA = pwmPin(1, false)
    const pwmPts: V3[] = [[pwmA[0], pwmA[1], 0], [pwmA[0], -2.9, 0]]
    const senseB = pwmPin(-4, true)
    const sensePts: V3[] = [[-13.2, 3.5, 0], [-13.2, 4.4, 0], [senseB[0], 4.4, 0], [senseB[0], senseB[1], 0]]
    wire(scene, pwmPts, 0.07)
    wire(scene, sensePts, 0.07)
    const swLit = [pwmPts, sensePts].map((pts) => litWire(scene, pts, 0.16))
    addLabel(scene, 'GPIO sense', [-9, 4.85, 0.3], B_FIELD, 0.3)
    const jumper = add(scene, new THREE.Group())
    rod(jumper, [btn.pins[0][0], btn.pins[0][1], 1.4], [btn.pins[1][0], btn.pins[1][1], 1.4], 0.12, glowMat(RING, 0.8))
    addLabel(jumper, 'jumpered', [-14.6, 0.5, 1.5], RING, 0.32)

    const g = floorView(scene, [10.6, 2.6, 0], 4.2, -0.35)
    floorMat(g, [-2.3, 1], [-0.35, 0.35])
    const crateM = glowMat(HEAT, 0.3)
    box(g, [0.14, 0.4, 0.3], crateM, [ESTOP.gapM + 0.07, 0, 0.15])
    addLabel(g, 'crate', [ESTOP.gapM + 0.07, 0.48, 0.02], GREY, 0.12)
    flatBox(g, [0.02, 0.6, 0.006], glowMat(RING, 0.9), [0, 0, 0.006])
    addLabel(g, 'press', [0, -0.48, 0.02], RING, 0.12)
    const robot = lidarRobot(g, 1, 0.24)
    const stopMark = flatBox(g, [0.02, 0.6, 0.006], glowMat(POWER, 1), [0, 0, 0.007])

    const plot = scope(scene, 10, 4, { divs: [7, 3], zeroAt: 0.1 })
    plot.group.position.set(8.4, -4.4, 0)
    const yOf = (v: number) => (v / 1.6 - 0.4) * plot.height
    const tr = plot.trace(HEAT, { samples: 1400, radius: 0.08 })
    const cur = cursorBar(plot, LABEL)
    for (const [t, text, c] of [[ESTOP.pressAt, 'press', HIGH_V], [ESTOP.releaseAt, 'twist out', RING], [ESTOP.resetAt, 'reset', POWER]] as const) {
      glowBox(plot.group, [0.06, plot.height, 0.05], [plot.xAt(t / ESTOP.seconds), 0, 0.1], c, 0.5)
      addLabel(scene, text, [8.4 + plot.xAt(t / ESTOP.seconds), -1.7, 0.3], c, 0.32)
    }
    addLabel(scene, `speed · 0 … ${ESTOP.seconds} s`, [8.4, -7.2, 0.3], GREY, 0.4)
    const note = liveLabel(scene, [-19.5, -7.6, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-19.5, -8.8, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(ESTOP.dt, 2)
    const st = { t: 0, key: '' }
    const us: number[] = []
    const ys: number[] = []
    return {
      scene,
      view: { center: [-3, -1.6, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = stopParams(p)
        const [kind, fault, latch, v0] = q
        const key = q.join()
        const run = stopMemo(q)
        const i = Math.floor(clock(dt, key, run.frames.length - 1))
        const f = run.frames[i]
        const now = f.t
        st.t = now
        if (key !== st.key) {
          st.key = key
          us.length = ys.length = 0
          for (let j = 0; j < run.frames.length; j += 2) {
            us.push(run.frames[j].t / ESTOP.seconds)
            ys.push(yOf(run.frames[j].v))
          }
          tr.points(us, ys)
        }
        cur(now / ESTOP.seconds)

        const twisted = now >= ESTOP.releaseAt
        btn.set(f.pressed ? 1 : 0, twisted ? Math.min(1, (now - ESTOP.releaseAt) * 4) * 0.8 : 0)
        const hw = kind !== 'sw'
        jumper.visible = !hw
        const coil = hw ? f.power : true
        coilLit.forEach((w) => w.set(coil ? 0.9 : 0, lit(RING)))
        relay.set(f.power ? 1 : 0, coil ? 1 : 0)
        powerLit.forEach((w, k) => w.set(f.power ? (k < 2 ? 0.9 : f.drive || f.braking ? 0.9 : 0.2) : 0, lit(HEAT)))
        const hung = fault === 'hung'
        swLit[0].set(hung ? 0.5 : f.drive ? 0.8 : 0.15, lit(hung ? HIGH_V : B_FIELD))
        swLit[1].set(f.pressed ? (hung ? 0.3 : 0.9) : 0.15, lit(f.pressed ? HIGH_V : B_FIELD))
        hb(dt, fault === 'short' ? HIGH_V : f.braking ? RING : HEAT, f.power ? (f.drive || f.braking ? 1 : 0.3) : 0, fault === 'short' ? 'FET short' : f.braking ? 'braking' : 'L298N')
        motor.spin(dt, f.v * 120)

        robot.group.position.set(f.x - 0.06, 0, 0)
        robot.head.rotation.z += dt * 12 * f.v
        setGlow(crateM, f.crashed ? HIGH_V : HEAT, f.crashed ? 1 : 0.3)
        const stopped = now >= run.stopT
        const moving = now >= run.restartAt
        stopMark.visible = stopped
        stopMark.position.x = run.stopX

        const before = now < ESTOP.pressAt
        note.set(
          before
            ? `Driving at ${v0.toFixed(1)} m/s`
            : f.pressed
              ? hw
                ? f.power
                  ? `Pressed: ${kind === 'cat1' ? 'firmware brakes, power cut follows' : 'K1 dropping out'}`
                  : 'Pressed: K1 open, motor has no power'
                : hung
                  ? 'Pressed: firmware hung, nobody reads the GPIO'
                  : 'Pressed: firmware set PWM to 0'
              : now < ESTOP.resetAt
                ? latch === 'on'
                  ? 'Twisted out: still latched, waits for reset'
                  : 'Twisted out: no latch, back to the last command'
                : latch === 'on'
                  ? f.drive
                    ? 'Reset: power back to a fault that still drives'
                    : 'Reset: power back, waits for a new start'
                  : 'Running on',
          f.pressed ? HIGH_V : LABEL,
        )
        result.set(
          f.crashed
            ? 'Crash into the crate'
            : moving
              ? 'Moving again after the stop'
              : stopped
                ? `Stopped ${Math.round(run.stopX * 100)} cm after the press (${Math.round((ESTOP.gapM - run.stopX) * 100)} cm to spare)`
                : before
                  ? `Crate ${Math.round(ESTOP.gapM * 100)} cm past the press mark`
                  : `${f.braking ? 'Braking' : f.drive ? 'Still driving' : 'Coasting'}: ${Math.round(f.x * 100)} cm past the mark`,
          f.crashed || moving ? HIGH_V : stopped ? POWER : LABEL,
        )
      },
      readouts: (p) => {
        const q = stopParams(p)
        const run = stopMemo(q)
        const f = run.frames[Math.min(run.frames.length - 1, Math.round(st.t / ESTOP.dt))]
        const first = run.frames.find((h) => h.crashed)
        const preReset = first ? first.t < ESTOP.releaseAt : false
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (1×)` },
          { label: 'Stop distance', value: Number.isNaN(run.stopX) || preReset ? 'hits the crate' : `${Math.round(run.stopX * 100)} cm`, tone: Number.isNaN(run.stopX) || preReset ? 'bad' : run.stopX > ESTOP.gapM * 0.6 ? 'warn' : 'ok' },
          { label: 'Motor power', value: f.power ? 'on' : 'cut', tone: f.power && f.pressed ? 'warn' : 'ok' },
          { label: 'Restart', value: !Number.isNaN(run.restartAt) ? `drives off at ${run.restartAt.toFixed(1)} s` : 'stays stopped', tone: !Number.isNaN(run.restartAt) ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Fault states: battery low, motor overcurrent, sensor timeout and comms loss drive one fault state machine. ---

const SCENARIO = { battery: 'Battery draining', stall: 'Motor stalls', sensor: 'Sensor timeouts', comms: 'Comms dropouts' }
const FLATCH = { on: 'Latch overcurrent', off: 'Auto-retry' }
const faultParams = (p: Params) => [pick(SCENARIO, p.scenario, 'stall') as FaultScenario, pick(FLATCH, p.latch, 'on')] as const
const faultMemo = memoBy((q: readonly [FaultScenario, string]) => q.join(), ([s, l]) => faultFsmRun(s, l === 'on'))
const STATE_COLOR: Record<FaultState, string> = { BOOT: GREY, OK: POWER, WARN: RING, LIMP: HEAT, STOP: HIGH_V, LATCH: FORCE }
const ORDER: FaultState[] = ['BOOT', 'OK', 'WARN', 'LIMP', 'STOP', 'LATCH']
const DIA_EDGES: { from: FaultState; to: FaultState; label: string; bend: number }[] = [
  { from: 'BOOT', to: 'OK', label: 'ok', bend: -0.4 },
  { from: 'OK', to: 'WARN', label: 'warn', bend: -0.6 },
  { from: 'WARN', to: 'OK', label: 'clear', bend: -0.6 },
  { from: 'WARN', to: 'LIMP', label: 'limp', bend: -0.6 },
  { from: 'LIMP', to: 'STOP', label: 'stop', bend: -0.6 },
  { from: 'WARN', to: 'STOP', label: 'stop', bend: -3 },
  { from: 'WARN', to: 'LATCH', label: 'trip', bend: -5 },
  { from: 'LIMP', to: 'OK', label: 'clear', bend: -2.8 },
  { from: 'STOP', to: 'OK', label: 'clear', bend: -4.8 },
  { from: 'LATCH', to: 'BOOT', label: 'reset', bend: -6.8 },
]
const TICKS = 48
const MARKS: Record<FaultScenario, [number, string][]> = {
  battery: [[6.3, 'below 7 V']],
  stall: [[3, 'wheel jammed'], [7, 'freed'], [FAULT.resetAt, 'reset']],
  sensor: [[2.5, 'no data'], [6, 'sensor dead']],
  comms: [[2.5, 'blip'], [5, 'Wi-Fi down'], [7, 'back']],
}

export const faultStates: Lesson = {
  id: 'safety-failsafes-fault-states',
  title: 'Fault states',
  tagline: 'Degrade, stop, then latch',
  formula: () =>
    `warn: V < ${FAULT.warnV} or I > ${FAULT.overA} A · limp (${Math.round(FAULT_CAP.LIMP * 100)} %): V < ${FAULT.limpV}, sensor > ${msText(FAULT.sensorLimpS)} · stop: V < ${FAULT.stopV}, sensor > ${FAULT.sensorStopS} s, comms > ${msText(FAULT.commsStopS)} · trip: I > ${FAULT.overA} A for ${msText(FAULT.overS)}`,
  legend: [
    { color: POWER, label: 'OK: full speed', shape: 'dot' },
    { color: RING, label: 'WARN: log it, tell the driver', shape: 'dot' },
    { color: HEAT, label: `LIMP: ${Math.round(FAULT_CAP.LIMP * 100)} % speed, head home`, shape: 'dot' },
    { color: HIGH_V, label: 'STOP: motors off, retry when clear', shape: 'dot' },
    { color: FORCE, label: 'LATCH: off until a person resets', shape: 'dot' },
  ],
  points: [
    'A robot should not have just "working" and "broken". One state machine in the firmware collects every check (battery voltage, motor current, sensor age, command age) and picks a mode, so every part of the code agrees on what the robot may do right now.',
    `Each input has thresholds. A 2S pack under ${FAULT.warnV} V is a warning, under ${FAULT.limpV} V the robot limps at ${Math.round(FAULT_CAP.LIMP * 100)} % to get home, under ${FAULT.stopV} V it stops to save the cells. A range sensor silent for ${msText(FAULT.sensorLimpS)} means slow down (you can't see), silent for ${FAULT.sensorStopS} s means stop. Commands older than ${msText(FAULT.commsStopS)} stop it (Remote control → WebSocket control).`,
    `Recovery needs hysteresis: a state only drops back to OK after every input has been clear for ${FAULT.clearS} s, otherwise a battery that recovers when unloaded makes the robot stop, start, stop.`,
    `Some faults must latch. A motor drawing over ${FAULT.overA} A for ${msText(FAULT.overS)} is jammed or shorted; auto-retry just slams into the jam again and again, heating the motor and the driver. Latched, the robot stays off until a person looks and resets it.`,
    'Safe defaults: the machine starts in BOOT with motors off and only moves to OK after a self-test. A brownout or a watchdog reset lands here too, so a reboot never resumes the last command. Pull-down resistors keep the driver enable low while the pins float during reset.',
  ],
  controls: [
    { kind: 'choice', key: 'scenario', options: opts(SCENARIO), initial: 'stall' },
    { kind: 'choice', key: 'latch', options: opts(FLATCH), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const dia = stateDiagram(
      scene,
      [-4, 1.3, 0],
      ORDER.map((s, k) => ({ id: s, label: s, at: [(k - 2.5) * 5.5, 0] as [number, number], color: STATE_COLOR[s] })),
      DIA_EDGES,
      { r: 1.7, text: 0.4 },
    )
    dia.group.scale.setScalar(0.66)
    const edgeOf = (a: FaultState, b: FaultState) => DIA_EDGES.findIndex((e) => e.from === a && e.to === b)

    const V0 = 6
    const bar = (x: number, y: number, max: number, marks: [number, string][], cap: string) =>
      meterBar(scene, [x, y, 0], 4, max, marks.map(([v, c]): [number, string, string] => [v, '', c]), cap)
    const bars = [
      bar(-15, -11, 8.4 - V0, [[FAULT.warnV - V0, RING], [FAULT.limpV - V0, HEAT], [FAULT.stopV - V0, HIGH_V]], 'batt'),
      bar(-15, -13.4, 4, [[FAULT.overA, HIGH_V]], 'motor'),
      bar(1, -11, 1.2, [[FAULT.sensorLimpS, HEAT], [FAULT.sensorStopS, HIGH_V]], 'sensor'),
      bar(1, -13.4, 1.2, [[FAULT.commsWarnS, RING], [FAULT.commsStopS, HIGH_V]], 'comms'),
      bar(-15, -15.8, FAULT.v, [], 'speed'),
    ]

    const chart = gantt(scene, 1, { x0: -16, x1: 8, y: -6.2, rowH: 1.1, ticks: TICKS })
    chart.name(0, 'state', LABEL)
    addLabel(scene, '0 s', [-16, -7.5, 0.3], GREY, 0.34)
    addLabel(scene, `${FAULT.seconds} s`, [8, -7.5, 0.3], GREY, 0.34)
    const note = liveLabel(scene, [-19.5, -8.7, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-1.5, -8.7, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(FAULT.dt, 2)
    const st = { t: 0, key: '', last: -1 }
    return {
      scene,
      view: { center: [-3, -1.6, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = faultParams(p)
        const key = q.join()
        const { frames } = faultMemo(q)
        const i = Math.floor(clock(dt, key, frames.length - 1))
        const f = frames[i]
        st.t = f.t
        if (key !== st.key) {
          st.key = key
          st.last = -1
          const per = frames.length / TICKS
          chart.rebuild(
            (_, t) => {
              const s = frames[Math.min(frames.length - 1, Math.floor(t * per))].state
              return { color: STATE_COLOR[s], text: s }
            },
            MARKS[q[0]].map(([t, text]) => ({ t: (t / FAULT.seconds) * TICKS, row: 0, text, color: LABEL })),
          )
        }
        chart.show((f.t / FAULT.seconds) * TICKS)
        if (i !== st.last) {
          for (let k = Math.max(0, st.last + 1); k <= i; k++) {
            const h = frames[k]
            const prev = frames[k - 1]
            if (prev && prev.state !== h.state) dia.fire(edgeOf(prev.state, h.state))
          }
          st.last = i
        }
        dia.frame(dt, f.state)

        const c = (bad: boolean, warn: boolean) => (bad ? HIGH_V : warn ? HEAT : POWER)
        bars[0](f.battV - V0, `${f.battV.toFixed(2)} V`, c(f.battV < FAULT.stopV, f.battV < FAULT.warnV))
        bars[1](f.amps, `${f.amps.toFixed(1)} A`, c(f.overFor >= FAULT.overS, f.amps > FAULT.overA))
        bars[2](Math.min(1.2, f.sensorAge), msText(f.sensorAge), c(f.sensorAge >= FAULT.sensorStopS, f.sensorAge >= FAULT.sensorLimpS))
        bars[3](Math.min(1.2, f.commsAge), msText(f.commsAge), c(f.commsAge >= FAULT.commsStopS, f.commsAge >= FAULT.commsWarnS))
        bars[4](f.v, `${f.v.toFixed(2)} m/s`, STATE_COLOR[f.state])

        let k0 = i
        while (k0 > 0 && frames[k0 - 1].state === f.state) k0--
        const why = frames[k0].cause
        note.set(`${f.state}${f.state === 'BOOT' ? ': self-test, motors off' : f.state === 'OK' ? (f.cause ? `, ${f.cause}` : '') : why ? `: ${why}` : ''}`, STATE_COLOR[f.state])
        const trips = frames.filter((h, k) => k && h.t <= f.t && (h.state === 'STOP' || h.state === 'LATCH') && frames[k - 1].state !== h.state).length
        result.set(
          f.state === 'LATCH' ? `Latched: waits for a reset (at ${FAULT.resetAt} s)` : f.state === 'STOP' && q[0] === 'stall' ? 'Auto-retry: back into the jam' : trips ? `${trips} stop${trips > 1 ? 's' : ''} so far · speed cap ${Math.round(f.cap * 100)} %` : `Speed cap ${Math.round(f.cap * 100)} %`,
          f.state === 'LATCH' || (f.state === 'STOP' && q[0] === 'stall') ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const { frames } = faultMemo(faultParams(p))
        const f = frames[Math.min(frames.length - 1, Math.round(st.t / FAULT.dt))]
        const trips = frames.filter((h, k) => k && h.t <= f.t && (h.state === 'STOP' || h.state === 'LATCH') && frames[k - 1].state !== h.state).length
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (1×)` },
          { label: 'State', value: f.state, tone: f.cap === 1 ? 'ok' : f.cap > 0 ? 'warn' : 'bad' },
          { label: 'Speed cap', value: `${Math.round(f.cap * 100)} %`, tone: f.cap === 1 ? 'ok' : f.cap > 0 ? 'warn' : 'bad' },
          { label: 'Stops', value: `${trips}`, tone: trips > 1 ? 'bad' : trips ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
