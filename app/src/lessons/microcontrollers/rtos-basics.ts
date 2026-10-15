import * as THREE from 'three/webgpu'
import {
  IMU_LINE,
  Bus,
  Locking,
  MOTOR_LINE,
  MOTOR_PERIOD,
  MOTOR_WORK,
  PrioMode,
  Producer,
  QUEUE_LEN,
  TELEMETRY_WORK,
  blockedOn,
  collides,
  cpuShare,
  drops,
  intactShare,
  jobs,
  latencies,
  longestReady,
  mutexScene,
  peakFill,
  priorityScene,
  queueFillMs,
  queueScene,
  serialText,
  simulate,
  taskIndex,
  waits,
} from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  INK,
  LABEL,
  Mark,
  POWER,
  RING,
  codeBlock,
  flatBox,
  gantt,
  glide,
  glowMat,
  liveLabel,
  memoBy,
  partLetter,
  setGlow,
  shadowlessRod,
  simClock,
  stretchRod,
  trayMat,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const SLOW_S = 0.15
const SLOWDOWN = Math.round(SLOW_S / 1e-3)
const ms = (t: number) => (Number.isFinite(t) ? `${+t.toFixed(1)} ms` : '∞')

/** Task card: box that glows with its state, plus a live caption. */
function taskCard(root: THREE.Object3D, at: V3, w = 7, h = 1.8) {
  const parent = add(root, new THREE.Group())
  box(parent, [w + 0.4, h + 0.4, 0.4], trayMat(), [at[0], at[1], -0.45])
  const m = glowMat(GREY, 0.2)
  flatBox(parent, [w, h, 0.3], m, at)
  const title = liveLabel(parent, [at[0], at[1] + 0.3, 0.3], { size: 0.42 })
  const sub = liveLabel(parent, [at[0], at[1] - 0.45, 0.3], { size: 0.32 })
  let k = 0.2
  return (dt: number, name: string, color: string, on: boolean, note: string, noteColor = INK) => {
    parent.visible = !!name
    k = glide(dt, k, on ? 0.9 : 0.15, 10)
    setGlow(m, on ? color : '#4a4f5a', k)
    title.set(name, on ? INK : color)
    sub.set(note, on ? noteColor : GREY)
  }
}

/** ESP32 package with a tile per core, aligned to the chart rows. */
function coreChip(parent: THREE.Object3D, x: number, ys: number[]) {
  const top = Math.max(...ys) + 2.2
  const bot = Math.min(...ys) - 1.6
  box(parent, [8, top - bot, 0.6], mat('#2a2d34', { rough: 0.5 }), [x, (top + bot) / 2, -0.5])
  partLetter(parent, 'ESP32 · FreeRTOS', [x - 3.8, top + 0.7, 0], 0.42, LABEL, 'left')
  const tickMat = glowMat(RING, 0.2)
  add(parent, mesh(new THREE.SphereGeometry(0.25, 12, 8), tickMat), [x + 3.4, top + 0.85, 0.1])
  partLetter(parent, 'tick', [x + 2.9, top + 0.7, 0], 0.32, GREY, 'right')
  const tiles = ys.map((y, k) => {
    const m = glowMat(IDLE, 0.2)
    flatBox(parent, [6.6, 2, 0.3], m, [x, y - 0.25, 0])
    partLetter(parent, k === 0 ? 'Core 0 · PRO' : 'Core 1 · APP', [x - 3.3, y + 1.2, 0], 0.3, GREY, 'left')
    return { m, text: liveLabel(parent, [x, y - 0.25, 0.3], { size: 0.45 }) }
  })
  return (now: number, running: (string | null)[], colors: string[]) => {
    setGlow(tickMat, RING, 1.6 * (1 - (now % 1)) ** 3)
    tiles.forEach((tile, k) => {
      const name = running[k]
      setGlow(tile.m, name ? colors[k] : IDLE, name ? 0.85 : 0.2)
      tile.text.set(name ?? 'IDLE', name ? INK : GREY)
    })
  }
}

// --- Tasks and priorities: a 1 ms tick scheduler on two cores; motor control preempts telemetry. ---

const MODES: Record<PrioMode, string> = { preempt: 'Priorities', equal: 'Equal priority', starve: 'Never blocks' }
const CORES = { one: 'Same core', two: 'Two cores' }
const PRIO_COLORS = [FORCE, DATA_COLOR]
const DEADLINE = MOTOR_WORK + 2

const prioRun = memoBy(
  (p: Params) => `${p.mode}|${p.cores}`,
  (p: Params) => {
    const mode = pick(MODES, p.mode, 'preempt')
    const split = pick(CORES, p.cores, 'one') === 'two'
    const r = simulate(priorityScene(mode, split))
    const motor = taskIndex(r, 'motor')
    const tele = taskIndex(r, 'telemetry')
    const js = jobs(r, motor)
    const worst = js.length ? Math.max(...js.map((j) => j.end - j.wake)) : Infinity
    return { mode, split, r, motor, tele, js, worst, starve: longestReady(r, tele), idle1: r.cores[1].filter((x) => x < 0).length / r.cores[1].length }
  },
)

export const tasksAndPriorities: Lesson = {
  id: 'rtos-basics-tasks-and-priorities',
  title: 'Tasks and priorities',
  tagline: 'Every tick, each core runs the highest-priority ready task',
  formula: (p) => {
    const P = prioRun(p)
    const head = `tick = 1 ms: each tick, and whenever a task blocks, every core switches to its highest-priority ready task · motor (prio ${P.r.spec.tasks[P.motor].prio}) needs ${MOTOR_WORK} ms every ${MOTOR_PERIOD} ms, telemetry (prio 1) ${TELEMETRY_WORK} ms jobs`
    const tail = P.mode === 'starve' ? `motor never blocks → telemetry waits ${P.starve ? ms(P.starve) : 'never (other core)'}` : `worst motor response ${ms(P.worst)} (deadline ${ms(DEADLINE)})`
    return `${head} · ${tail} · slowed ${SLOWDOWN}×`
  },
  legend: [
    { color: FORCE, label: 'motor task (control loop)', shape: 'dot' },
    { color: DATA_COLOR, label: 'telemetry task · dim = ready, waiting', shape: 'dot' },
    { color: RING, label: '1 ms tick interrupt · ⚡ preempted · ↑ wakes', shape: 'dot' },
    { color: HIGH_V, label: 'Missed deadline / starved', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Arduino on the ESP32 already runs FreeRTOS: setup() and loop() live in loopTask (priority 1, core 1), while Wi-Fi and Bluetooth tasks run on core 0. xTaskCreatePinnedToCore() adds your own task with its own stack, priority and core.',
    'A task is running, ready (wants the CPU) or blocked (waiting for a delay, a queue or a lock). Each core runs the highest-priority ready task; a 1 ms tick interrupt and every block or wake are when the scheduler decides again.',
    'So a priority-5 motor task that wakes up preempts telemetry at once: its 3 ms of PID work always finishes 3 ms after it wakes, and telemetry just resumes where it was cut off.',
    'Tasks with equal priority take turns, one tick each (time slicing). Fair, but the motor job now stretches over twice as long and its timing jitters.',
    'A high-priority task must block: vTaskDelay, vTaskDelayUntil (a fixed period without drift), or waiting on a queue. A busy loop never yields, so every lower task on that core starves, IDLE too, and the task watchdog resets the chip after 5 s.',
    'The second core is a separate CPU running its own ready list: pin telemetry to core 0 and both run truly in parallel. Unlike a millis() scheduler (Timers & interrupts → Millis without delay), a slow job can’t hold up the urgent one.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'preempt' },
    { kind: 'choice', key: 'cores', options: opts(CORES), initial: 'one' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const cores = gantt(scene, 2, { x0: -11, x1: 24, y: 5.4, rowH: 2.8, ticks: 60 })
    const tasks = gantt(scene, 2, { x0: -11, x1: 24, y: -1.6, rowH: 1.5, ticks: 60, axis: true })
    cores.name(0, 'Core 0', GREY)
    cores.name(1, 'Core 1', GREY)
    const chip = coreChip(scene, -20, [cores.rowY(0), cores.rowY(1)])
    const status = liveLabel(scene, [-24, -7.2, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.4, 0], 0.38, 4)
    const clock = simClock(SLOW_S)
    let key = ''
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = prioRun(p)
        const { r, motor, tele } = P
        const k = `${P.mode}|${P.split}`
        if (k !== key) {
          key = k
          const color = (i: number) => PRIO_COLORS[i]
          const name = (i: number) => r.spec.tasks[i].name
          cores.rebuild(
            (row, t) => {
              const i = r.cores[row][t]
              return i < 0 ? { color: IDLE, dim: true, text: 'IDLE' } : { color: color(i), text: name(i) }
            },
            [],
          )
          const marks: Mark[] = []
          for (const i of [motor, tele])
            r.state.forEach((s, t) => {
              if (t > 0 && r.state[t - 1][i] === 'run' && s[i] === 'ready') marks.push({ t, row: i, text: '⚡', color: HEAT })
            })
          r.events.forEach((e) => e.kind === 'wake' && !e.name && e.task === motor && marks.push({ t: e.t, row: motor, text: '↑', color: FORCE }))
          P.js.forEach((j) => marks.push({ t: j.end, row: motor, text: j.end - j.wake <= DEADLINE ? '✓' : '✗', color: j.end - j.wake <= DEADLINE ? POWER : HIGH_V }))
          tasks.rebuild((row, t) => {
            const s = r.state[t][row]
            return s === 'run' ? { color: color(row) } : s === 'ready' ? { color: color(row), dim: true, text: 'ready' } : null
          }, marks)
          const spec = r.spec.tasks
          tasks.name(motor, `motor · prio ${spec[motor].prio} · core ${spec[motor].core}`, FORCE)
          tasks.name(tele, `telemetry · prio 1 · core ${spec[tele].core}`, DATA_COLOR)
        }
        const now = clock(dt, key, r.state.length)
        const t = Math.min(r.state.length - 1, Math.floor(now))
        cores.show(now)
        tasks.show(now)
        const run = r.cores.map((row) => row[t])
        chip(now, run.map((i) => (i < 0 ? null : r.spec.tasks[i].name)), run.map((i) => PRIO_COLORS[i] ?? IDLE))
        const waiting = [motor, tele].filter((i) => r.state[t][i] === 'ready').map((i) => r.spec.tasks[i].name)
        const lead = `t = ${t} ms · core 1 runs ${run[1] < 0 ? 'IDLE' : r.spec.tasks[run[1]].name}${P.split ? ` · core 0 runs ${run[0] < 0 ? 'IDLE' : r.spec.tasks[run[0]].name}` : ''}`
        status.set(
          now >= r.state.length && P.mode === 'starve' && P.starve
            ? `telemetry starved for ${ms(P.starve)}: motor never blocks, IDLE never runs → watchdog reset after 5 s`
            : waiting.length
              ? `${lead} · ready but waiting: ${waiting.join(', ')}`
              : lead,
          P.mode === 'starve' && waiting.length ? HIGH_V : LABEL,
        )
        const tCore = P.split ? 0 : 1
        code([
          'xTaskCreatePinnedToCore(motorTask, "motor", 4096, NULL, ' + r.spec.tasks[motor].prio + ', NULL, 1);',
          `xTaskCreatePinnedToCore(telemetryTask, "telemetry", 4096, NULL, 1, NULL, ${tCore});`,
          P.mode === 'starve' ? 'void motorTask(void *) { for (;;) { if (newData()) updatePid(); } }  // spins' : 'void motorTask(void *) { for (;;) { updatePid(); vTaskDelayUntil(&last, 10); } }',
          'void telemetryTask(void *) { for (;;) { sendStats(); vTaskDelay(3); } }',
        ])
      },
      readouts: (p) => {
        const P = prioRun(p)
        return [
          { label: 'Motor response', value: P.js.length ? `${ms(P.worst)} worst` : 'never finishes a cycle', tone: P.worst <= DEADLINE ? 'ok' : 'bad' },
          { label: 'Telemetry CPU', value: pct(cpuShare(P.r, P.tele)), tone: cpuShare(P.r, P.tele) < 0.05 ? 'bad' : 'ok' },
          { label: 'Telemetry longest wait', value: ms(P.starve), tone: P.starve > 20 ? 'bad' : P.starve > 3 ? 'warn' : 'ok' },
          { label: 'Core 1 idle', value: pct(P.idle1), tone: P.idle1 === 0 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Queues: an ISR or sensor task feeds readings through a 4-slot queue to the control task. ---

const PRODUCERS: Record<Producer, string> = { isr: 'Timer ISR', task: 'Sensor task' }
const POOL = 32
const SLOT_W = 2.8
const QX = { x0: -6, y: 4.6 }
const PROD_X = -17
const CONS_X = 14

const queueRun = memoBy(
  (p: Params) => `${p.producer}|${p.period}|${p.work}`,
  (p: Params) => {
    const producer = pick(PRODUCERS, p.producer, 'isr')
    const period = n(p, 'period')
    const work = n(p, 'work')
    const r = simulate(queueScene(producer, period, work))
    const ctl = taskIndex(r, 'control')
    const prod = 0
    const sent = new Map<number, number>()
    const recv = new Map<number, number>()
    const dropped = new Map<number, number>()
    for (const e of r.events) {
      if (e.kind === 'send') sent.set(e.item!, e.t)
      if (e.kind === 'recv') recv.set(e.item!, e.t)
      if (e.kind === 'drop') dropped.set(e.item!, e.t)
    }
    const lat = latencies(r, 'readings')
    const sensorWait = producer === 'task' ? r.state.filter((_, t) => blockedOn(r, prod, t) === 'readings').length : 0
    return { producer, period, work, r, ctl, prod, sent, recv, dropped, lat, sensorWait, fill: queueFillMs(QUEUE_LEN, period, work), peak: peakFill(r, 'readings'), lost: drops(r, 'readings') }
  },
)

export const queues: Lesson = {
  id: 'rtos-basics-queues',
  title: 'Queues',
  tagline: 'A thread-safe FIFO between a producer and a consumer',
  formula: (p) => {
    const Q = queueRun(p)
    const net = Q.work > Q.period ? `in 1 / ${Q.period} ms − out 1 / ${Q.work} ms → ${QUEUE_LEN} slots full after ${ms(Q.fill)}, then ${Q.producer === 'isr' ? 'readings are dropped' : 'the sensor task blocks'}` : `out (1 / ${Q.work} ms) keeps up with in (1 / ${Q.period} ms) → queue stays empty, control blocks between readings`
    return `${net} · worst latency ${ms(Math.max(0, ...Q.lat))} · slowed ${SLOWDOWN}×`
  },
  legend: [
    { color: HEAT, label: 'Timer ISR ⚡ / sensor task (core 0)', shape: 'dot' },
    { color: RING, label: 'Readings in the queue', shape: 'dot' },
    { color: FORCE, label: 'control task (core 1)', shape: 'dot' },
    { color: HIGH_V, label: 'Queue full: dropped / blocked', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Tasks shouldn’t share a plain global: one could read it while another is half-way through writing it. A FreeRTOS queue is a fixed-size FIFO that copies each item in and out safely, between tasks, cores and interrupts.',
    'xQueueCreate(4, sizeof(Reading)) reserves four slots up front. xQueueSend copies a reading in at the back; xQueueReceive takes the oldest out at the front.',
    'Receiving from an empty queue blocks: the control task sleeps (using no CPU) until a reading arrives, then wakes at once. No polling, no delay() guessing.',
    'If the consumer is slower than the producer, the queue fills at the difference of the two rates. Then a task sender blocks until a slot frees up (back-pressure), so the readings get older and older.',
    'An ISR may never block, so xQueueSendFromISR on a full queue fails and the reading is lost. Keep ISRs short (Timers & interrupts → ISR rules) and let the queue carry the work to a task.',
    'A queue only absorbs bursts: on average the consumer must keep up. A queue of length 1 overwritten each time (xQueueOverwrite) is the “latest value only” mailbox, good for sensor readings where old data is useless.',
  ],
  controls: [
    { kind: 'choice', key: 'producer', options: opts(PRODUCERS), initial: 'isr' },
    { kind: 'slider', key: 'period', label: 'Reading every', min: 2, max: 10, step: 1, initial: 4, format: (v) => `${v} ms` },
    { kind: 'slider', key: 'work', label: 'Control work', min: 1, max: 10, step: 1, initial: 3, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const chart = gantt(scene, 3, { x0: -11, x1: 24, y: -0.4, rowH: 1.9, ticks: 60, axis: true })
    chart.name(0, 'Core 0', GREY)
    chart.name(1, 'Core 1', GREY)
    chart.name(2, 'queue fill', RING)
    const prod = taskCard(scene, [PROD_X, QX.y, 0], 8)
    const cons = taskCard(scene, [CONS_X, QX.y, 0], 8)
    const qx = (k: number) => QX.x0 + (QUEUE_LEN - k - 0.5) * SLOT_W
    box(scene, [QUEUE_LEN * SLOT_W + 0.6, 2.6, 0.4], trayMat(), [QX.x0 + (QUEUE_LEN * SLOT_W) / 2, QX.y, -0.45])
    const slotMats = Array.from({ length: QUEUE_LEN }, (_, k) => {
      const m = glowMat(GREY, 0.1)
      flatBox(scene, [SLOT_W - 0.3, 2.2, 0.1], m, [qx(k), QX.y, -0.2])
      return m
    })
    partLetter(scene, 'xQueue: 4 slots · back ← → front', [QX.x0 + (QUEUE_LEN * SLOT_W) / 2, QX.y + 2, 0], 0.38, LABEL)
    const pipe = glowMat(GREY, 0.3)
    stretchRod(add(scene, shadowlessRod(pipe)), [PROD_X + 4.2, QX.y, -0.1], [QX.x0 - 0.3, QX.y, -0.1], 0.08)
    stretchRod(add(scene, shadowlessRod(pipe)), [QX.x0 + QUEUE_LEN * SLOT_W + 0.3, QX.y, -0.1], [CONS_X - 4.2, QX.y, -0.1], 0.08)
    const qLabel = liveLabel(scene, [QX.x0 + (QUEUE_LEN * SLOT_W) / 2, QX.y - 1.9, 0], { size: 0.38 })
    const items = Array.from({ length: POOL }, () => {
      const m = glowMat(RING, 0.9)
      const o = flatBox(scene, [1.5, 1.5, 0.6], m, [0, 0, 0.3])
      const text = liveLabel(o, [0, 0, 0.35], { size: 0.36 })
      return { o, m, text, id: -1, x: 0, y: 0 }
    })
    const status = liveLabel(scene, [-24, -8.8, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.4, 0], 0.38, 5)
    const clock = simClock(SLOW_S)
    let key = ''
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const Q = queueRun(p)
        const { r, ctl, prod: pi } = Q
        const k = `${Q.producer}|${Q.period}|${Q.work}`
        const prodColor = HEAT
        if (k !== key) {
          key = k
          chart.rebuild(
            (row, t) => {
              if (row === 2) {
                const f = r.queues.readings[t].length
                return f ? { color: f >= QUEUE_LEN ? HIGH_V : RING, dim: f < QUEUE_LEN, text: `${f}` } : null
              }
              const i = r.cores[row][t]
              if (i < 0) return row === 0 && Q.producer === 'isr' ? null : { color: IDLE, dim: true, text: 'IDLE' }
              return { color: i === ctl ? FORCE : prodColor, text: r.spec.tasks[i].name }
            },
            [
              ...r.events.filter((e) => e.task === pi && (e.kind === 'send' || e.kind === 'drop') && Q.producer === 'isr').map((e) => ({ t: e.t, row: 0, text: e.kind === 'drop' ? '✗' : '⚡', color: e.kind === 'drop' ? HIGH_V : HEAT })),
              ...r.events.filter((e) => e.task === pi && e.kind === 'block' && e.name === 'readings').map((e) => ({ t: e.t, row: 0, text: '✗', color: HIGH_V })),
            ],
          )
        }
        const now = clock(dt, key, r.state.length)
        const t = Math.min(r.state.length - 1, Math.floor(now))
        chart.show(now)
        const q = r.queues.readings[t]
        slotMats.forEach((m, j) => setGlow(m, j < q.length ? (q.length >= QUEUE_LEN ? HIGH_V : RING) : GREY, j < q.length ? 0.12 : 0.05))
        qLabel.set(`${q.length} / ${QUEUE_LEN}${q.length >= QUEUE_LEN ? ' full' : q.length ? '' : ' empty'}`, q.length >= QUEUE_LEN ? HIGH_V : GREY)
        const working = r.state[t][ctl] === 'run'
        let doing = -1
        for (const [id, tr] of Q.recv) if (tr <= t && tr > (Q.recv.get(doing) ?? -1)) doing = id
        const full = blockedOn(r, pi, t) === 'readings'
        const dropNow = [...Q.dropped.values()].some((td) => td <= now && now < td + 1.5)
        if (Q.producer === 'isr')
          prod(dt, 'onTimer() ISR · core 0', prodColor, Q.sent.size > 0 && [...Q.sent.values(), ...Q.dropped.values()].some((ts) => ts <= now && now < ts + 0.6), dropNow ? 'queue full → reading lost' : `every ${Q.period} ms`, dropNow ? HIGH_V : INK)
        else prod(dt, 'sensor · prio 3 · core 0', prodColor, r.state[t][pi] === 'run' || full, full ? 'blocked: queue full' : r.state[t][pi] === 'run' ? 'reading I²C' : 'sleeping', full ? HIGH_V : INK)
        cons(dt, 'control · prio 4 · core 1', FORCE, working, working ? `drive(#${doing}): ${Q.work} ms` : 'blocked: queue empty')
        items.forEach((it, j) => {
          let id = -1
          for (const cand of [...Q.sent.keys(), ...Q.dropped.keys()]) {
            if (cand % POOL !== j) continue
            const t0 = Q.sent.get(cand) ?? Q.dropped.get(cand)!
            const end = Q.dropped.has(cand) ? t0 + 1.5 : (Q.recv.get(cand) ?? Infinity) + (cand === doing && working ? Q.work + 1 : 0.4)
            if (t0 <= now && now < end) id = cand
          }
          it.o.visible = id >= 0
          if (id < 0) return
          if (id !== it.id) Object.assign(it, { id, x: PROD_X + 3, y: QX.y })
          let tx = PROD_X + 3
          let ty = QX.y
          let color = RING
          if (Q.dropped.has(id)) {
            tx = QX.x0 - 1
            ty = QX.y - 3 - (now - Q.dropped.get(id)!) * 2
            color = HIGH_V
          } else if ((Q.recv.get(id) ?? Infinity) <= now) {
            tx = CONS_X
            ty = QX.y + 2.7
            color = FORCE
          } else {
            const slot = q.findIndex((x) => x.id === id)
            tx = qx(slot < 0 ? 0 : slot)
          }
          it.x = glide(dt, it.x, tx, 9)
          it.y = glide(dt, it.y, ty, 9)
          it.o.position.set(it.x, it.y, 0.6)
          setGlow(it.m, color, 0.9)
          it.text.set(`#${id}`, INK)
        })
        const lat = Q.recv.get(doing) !== undefined ? Q.recv.get(doing)! - Q.sent.get(doing)! : 0
        status.set(
          `t = ${t} ms · ${dropNow ? 'ISR finds the queue full: reading dropped' : full ? 'sensor task blocked on a full queue' : working ? `control works on #${doing} (waited ${ms(lat)} in the queue)` : 'control blocked on an empty queue: 0 % CPU'}`,
          dropNow || full ? HIGH_V : LABEL,
        )
        code(
          Q.producer === 'isr'
            ? [
                'QueueHandle_t q = xQueueCreate(4, sizeof(Reading));',
                `void IRAM_ATTR onTimer() { Reading r = sample(); xQueueSendFromISR(q, &r, NULL); }`,
                '// an ISR never waits: on a full queue the reading is lost',
                'void controlTask(void *) { Reading r; for (;;) { xQueueReceive(q, &r, portMAX_DELAY);',
                `    drive(r); } }  // ${Q.work} ms per reading`,
              ]
            : [
                'QueueHandle_t q = xQueueCreate(4, sizeof(Reading));',
                'void sensorTask(void *) { for (;;) { Reading r = readSensor();',
                `    xQueueSend(q, &r, portMAX_DELAY); vTaskDelayUntil(&last, ${Q.period}); } }`,
                'void controlTask(void *) { Reading r; for (;;) { xQueueReceive(q, &r, portMAX_DELAY);',
                `    drive(r); } }  // ${Q.work} ms per reading`,
              ],
        )
      },
      readouts: (p) => {
        const Q = queueRun(p)
        return [
          { label: 'Queue peak', value: `${Q.peak} / ${QUEUE_LEN}`, tone: Q.peak >= QUEUE_LEN ? 'warn' : 'ok' },
          Q.producer === 'isr'
            ? { label: 'Readings lost', value: `${Q.lost} of ${Q.lost + Q.sent.size}`, tone: Q.lost ? 'bad' : 'ok' }
            : { label: 'Sensor blocked', value: ms(Q.sensorWait), tone: Q.sensorWait ? 'warn' : 'ok' },
          { label: 'Worst latency', value: ms(Math.max(0, ...Q.lat)), tone: Math.max(0, ...Q.lat) > 10 ? 'bad' : 'ok' },
          { label: 'Control busy', value: pct(cpuShare(Q.r, Q.ctl)), tone: cpuShare(Q.r, Q.ctl) > 0.95 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Mutexes: shared Serial garbles without a lock; on I²C a semaphore lets priority inversion happen, a mutex inherits. ---

const BUSES: Record<Bus, string> = { serial: 'Serial', i2c: 'I²C bus' }
const LOCKS: Record<Locking, string> = { none: 'No lock', semaphore: 'Semaphore', mutex: 'Mutex' }
const MUTEX_COLORS: Record<string, string> = { imu: POWER, motor: FORCE, logger: RING, wifi: DATA_COLOR }
const LINES = [IMU_LINE.join('').trim(), MOTOR_LINE.join('').trim()]
const BUS_X = -4
const RES = { x: 15, y: 4.4 }

const mutexRun = memoBy(
  (p: Params) => `${p.bus}|${p.lock}`,
  (p: Params) => {
    const bus = pick(BUSES, p.bus, 'serial')
    const lock = pick(LOCKS, p.lock, 'none')
    const r = simulate(mutexScene(bus, lock))
    const imu = taskIndex(r, 'imu')
    const logger = taskIndex(r, 'logger')
    const text = serialText(r)
    const wait = Math.max(0, ...waits(r, imu, bus))
    const order = r.spec.tasks.map((_, i) => i).sort((a, b) => r.spec.tasks[b].prio - r.spec.tasks[a].prio)
    return { bus, lock, r, order, imu, logger, text, wait, clash: collides(r, bus), intact: intactShare(text, LINES), boost: logger < 0 ? 0 : Math.max(...r.prio.map((x) => x[logger])) }
  },
)

export const mutexes: Lesson = {
  id: 'rtos-basics-mutexes',
  title: 'Mutexes',
  tagline: 'One task at a time on a shared bus, and priority inheritance',
  formula: (p) => {
    const M = mutexRun(p)
    if (M.bus === 'serial')
      return M.lock === 'none'
        ? `two tasks, two cores, one UART: their print() pieces interleave → “${M.text.split('\n')[0]}” · ${pct(M.intact)} of lines intact · slowed ${SLOWDOWN}×`
        : `take → print the whole line → give: the other task blocks until the lock is free · ${pct(M.intact)} of lines intact, worst wait ${ms(Math.max(0, ...waits(M.r, M.imu, 'serial')))} · slowed ${SLOWDOWN}×`
    return M.lock === 'none'
      ? `imu (prio 5) preempts logger mid-transaction and drives SDA itself → both reads corrupt · slowed ${SLOWDOWN}×`
      : M.lock === 'semaphore'
        ? `priority inversion: imu waits = logger’s rest + all of Wi-Fi’s 14 ms = ${ms(M.wait)} · slowed ${SLOWDOWN}×`
        : `inheritance: logger runs at prio ${M.boost} while imu waits → imu waits only ${ms(M.wait)}, Wi-Fi goes after · slowed ${SLOWDOWN}×`
  },
  legend: [
    { color: POWER, label: 'imu task · motor task (pink)', shape: 'dot' },
    { color: RING, label: 'logger (prio 1) · the lock', shape: 'dot' },
    { color: DATA_COLOR, label: 'Wi-Fi task (prio 3)', shape: 'dot' },
    { color: HIGH_V, label: 'Collision / waiting on the lock', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Two tasks on two cores can use the same peripheral at the same moment. Each Serial.print() call is sent whole, but a line built from several calls interleaves with the other task’s: “ax=L=0.12180”.',
    'A mutex (mutual exclusion) is a token: xSemaphoreTake gets it, or blocks until it’s free; xSemaphoreGive returns it. Wrap the whole line, or the whole I²C transaction (write register, read 6 bytes), between the two.',
    'On I²C it’s worse than ugly text: a second task starting a transfer in the middle of another one corrupts both, and the sensor answers with the wrong register or NACKs.',
    'Priority inversion: the low-priority logger holds the bus, the high-priority IMU task blocks on it, and a medium task (Wi-Fi) that needs no bus preempts the logger. Now the IMU waits for Wi-Fi, a task less important than itself.',
    'A plain binary semaphore can’t fix that. A mutex has an owner, so FreeRTOS uses priority inheritance: while the IMU waits, the logger runs at the IMU’s priority, finishes its transfer, gives the mutex back and drops to 1 again.',
    'Keep the locked part short, take locks in the same order everywhere (or two tasks can wait on each other forever: a deadlock), never take a mutex in an ISR, and use a timeout instead of portMAX_DELAY when a stuck bus must not hang the robot.',
  ],
  controls: [
    { kind: 'choice', key: 'bus', options: opts(BUSES), initial: 'serial' },
    { kind: 'choice', key: 'lock', options: opts(LOCKS), initial: 'none' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const serialG = add(scene, new THREE.Group())
    const i2cG = add(scene, new THREE.Group())
    const sChart = gantt(serialG, 2, { x0: -11, x1: 24, y: -0.9, rowH: 2.4, ticks: 40, axis: true })
    sChart.name(0, 'Core 0', GREY)
    sChart.name(1, 'Core 1', GREY)
    const iChart = gantt(i2cG, 3, { x0: -11, x1: 24, y: -0.6, rowH: 1.7, ticks: 32, axis: true })
    const cardYs = [6.6, 4.4, 2.2]
    const cards = cardYs.map((y) => taskCard(scene, [-19, y, 0], 9, 1.7))
    const wireMats = cardYs.map(() => glowMat(GREY, 0.2))
    const wires = cardYs.map((y, k) => {
      const o = add(scene, shadowlessRod(wireMats[k]))
      stretchRod(o, [-14.3, y, -0.1], [BUS_X - 1.6, RES.y, -0.1], 0.07)
      return o
    })
    box(scene, [3.6, 3.6, 0.4], trayMat(), [BUS_X, RES.y, -0.45])
    const lockMat = glowMat(RING, 0.8)
    const lockG = add(scene, new THREE.Group())
    flatBox(lockG, [1.2, 1, 0.5], lockMat, [0, -0.2, 0])
    const shackle = add(lockG, mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 20, Math.PI), lockMat), [0, 0.3, 0])
    shackle.castShadow = false
    const portLabel = liveLabel(scene, [BUS_X, RES.y - 2.4, 0], { size: 0.36 })
    const busMat = glowMat(GREY, 0.3)
    stretchRod(add(scene, shadowlessRod(busMat)), [BUS_X + 1.9, RES.y, -0.1], [RES.x - 9.3, RES.y, -0.1], 0.1)
    const busLabel = liveLabel(scene, [(BUS_X + RES.x - 7.4) / 2, RES.y + 0.6, 0], { size: 0.36 })
    box(serialG, [18, 6.4, 0.4], trayMat(), [RES.x, RES.y, -0.45])
    flatBox(serialG, [17.4, 5.8, 0.1], glowMat('#0c0e12', 0.05), [RES.x, RES.y, -0.2])
    partLetter(serialG, 'Serial Monitor · 115200 baud', [RES.x - 8.5, RES.y + 3.8, 0], 0.36, GREY, 'left')
    const screen = Array.from({ length: 5 }, (_, k) => liveLabel(serialG, [RES.x - 8.3, RES.y + 2.2 - k * 1.05, 0.1], { size: 0.42, align: 'left' }))
    box(i2cG, [9, 4.4, 0.6], mat('#1d5a3a', { rough: 0.6 }), [RES.x, RES.y, -0.45])
    const chipMat = glowMat(GREY, 0.2)
    flatBox(i2cG, [3, 3, 0.4], chipMat, [RES.x, RES.y, 0])
    partLetter(i2cG, 'MPU-6050 · 0x68', [RES.x, RES.y + 2.7, 0], 0.38, LABEL)
    const sensorLabel = liveLabel(i2cG, [RES.x, RES.y - 2.8, 0], { size: 0.38 })
    const status = liveLabel(scene, [-24, -8.6, 0.3], { size: 0.46, align: 'left' })
    const resName = liveLabel(scene, [BUS_X, RES.y + 2.3, 0], { size: 0.4 })
    const code = codeBlock(scene, [-24.5, 12.4, 0], 0.38, 4)
    const clock = simClock(SLOW_S)
    const s = { key: '', lx: BUS_X, ly: RES.y }
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const M = mutexRun(p)
        const { r } = M
        const names = r.spec.tasks.map((d) => d.name)
        const serial = M.bus === 'serial'
        serialG.visible = serial
        i2cG.visible = !serial
        const chart = serial ? sChart : iChart
        const runKey = `${M.bus}|${M.lock}`
        if (runKey !== s.key) {
          s.key = runKey
          const marks: Mark[] = []
          if (serial) {
            for (const o of r.out) if (o.task === 0 && r.out.some((x) => x.t === o.t && x.task !== o.task)) marks.push({ t: o.t, row: 0, text: '✗', color: HIGH_V })
            sChart.rebuild((row, t) => {
              const i = r.cores[row][t]
              if (i >= 0) return { color: MUTEX_COLORS[names[i]], text: `print ${names[i]}` }
              return blockedOn(r, row, t) === M.bus ? { color: HIGH_V, dim: true, text: 'waits' } : { color: IDLE, dim: true }
            }, marks)
          } else {
            const rowOf = (i: number) => M.order.indexOf(i)
            r.state.forEach((st, t) => st.forEach((x, i) => {
              if (t > 0 && r.state[t - 1][i] === 'run' && x === 'ready') marks.push({ t, row: rowOf(i), text: '⚡', color: HEAT })
            }))
            for (const e of r.events) if (e.kind === 'wake' && !e.name) marks.push({ t: e.t, row: rowOf(e.task), text: '↑', color: MUTEX_COLORS[names[e.task]] })
            let imuEnd = 0
            r.state.forEach((st, t) => {
              if (st[M.imu] === 'run') imuEnd = t + 1
            })
            if (imuEnd > 0) marks.push({ t: imuEnd, row: rowOf(M.imu), text: M.clash ? '✗' : imuEnd - 2 <= 6 ? '✓' : '✗', color: M.clash || imuEnd - 2 > 6 ? HIGH_V : POWER })
            iChart.rebuild((k, t) => {
              const row = M.order[k]
              const st = r.state[t][row]
              if (st === 'run') return { color: MUTEX_COLORS[names[row]], text: r.spec.tasks[row].ops.some((o) => o.op === 'run' && o.res) ? 'bus' : 'run' }
              if (st === 'ready') return { color: MUTEX_COLORS[names[row]], dim: true, text: 'ready' }
              return blockedOn(r, row, t) === M.bus ? { color: HIGH_V, dim: true, text: 'waits for the bus' } : null
            }, marks)
          }
        }
        const now = clock(dt, s.key, r.state.length)
        const t = Math.min(r.state.length - 1, Math.floor(now))
        chart.show(now)
        const holder = M.lock === 'none' ? -1 : r.holders[M.bus][t]
        const users = r.spans.filter((x) => x.t0 <= t && t < x.t1 && r.state[t][x.task] === 'run').map((x) => x.task)
        const active = r.spans.filter((x) => x.t0 <= t && t < x.t1).map((x) => x.task)
        const clashNow = new Set(active).size > 1
        cardYs.forEach((_, k) => {
          const i = k < names.length ? M.order[k] : -1
          const card = cards[k]
          wires[k].visible = i >= 0
          if (i < 0) return card(dt, '', GREY, false, '')
          const d = r.spec.tasks[i]
          const eff = r.prio[t][i]
          const st = r.state[t][i]
          const waitsLock = blockedOn(r, i, t) === M.bus
          const note = waitsLock ? 'blocked on the lock' : st === 'run' ? (users.includes(i) ? `using ${BUSES[M.bus]}` : 'running') : st === 'ready' ? 'ready: waiting' : st === 'done' ? 'done' : 'blocked'
          card(dt, `${d.name} · prio ${d.prio}${eff > d.prio ? ` → ${eff} ↑` : ` · core ${d.core}`}`, MUTEX_COLORS[d.name], st === 'run', note, eff > d.prio ? HIGH_V : INK)
          setGlow(wireMats[k], users.includes(i) ? (clashNow ? HIGH_V : MUTEX_COLORS[d.name]) : GREY, users.includes(i) ? 1 : 0.15)
          if (!serial) iChart.name(k, `${d.name} · prio ${eff > d.prio ? `${d.prio} → ${eff}` : d.prio}`, eff > d.prio ? HIGH_V : MUTEX_COLORS[d.name])
        })
        lockG.visible = M.lock !== 'none'
        const lx = holder >= 0 ? -13.6 : BUS_X
        const ly = holder >= 0 ? cardYs[M.order.indexOf(holder)] + 0.2 : RES.y + 0.2
        s.lx = glide(dt, s.lx, lx, 8)
        s.ly = glide(dt, s.ly, ly, 8)
        lockG.position.set(s.lx, s.ly, 0.6)
        setGlow(lockMat, RING, holder >= 0 ? 1.2 : 0.6)
        portLabel.set(M.lock === 'none' ? 'no lock' : holder >= 0 ? `${LOCKS[M.lock].toLowerCase()} held by ${names[holder]}` : `${LOCKS[M.lock].toLowerCase()}: free`, holder >= 0 ? RING : GREY)
        const busColor = clashNow ? HIGH_V : users.length ? MUTEX_COLORS[names[users[0]]] : GREY
        setGlow(busMat, busColor, users.length ? 1 : 0.2)
        busLabel.set(serial ? 'UART0 TX' : 'SDA / SCL', busColor)
        resName.set(serial ? 'Serial' : 'Wire', LABEL)
        if (serial) {
          const lines = serialText(r, t + 1).split('\n')
          const shown = lines.slice(-5)
          screen.forEach((l, j) => {
            const line = shown[j] ?? ''
            const bad = line && j < shown.length - 1 && !LINES.includes(line)
            l.set(line + (j === shown.length - 1 && now % 0.6 < 0.3 ? '_' : ''), bad ? HIGH_V : LABEL)
          })
        } else {
          setGlow(chipMat, busColor, users.length ? 0.8 : 0.2)
          sensorLabel.set(clashNow ? '✗ two masters at once: garbage' : users.length ? `${names[users[0]]} reads registers` : 'idle', clashNow ? HIGH_V : LABEL)
        }
        const waiter = names.findIndex((_, i) => blockedOn(r, i, t) === M.bus)
        const run1 = r.cores[1][t]
        const boosted = holder >= 0 && r.prio[t][holder] > r.spec.tasks[holder].prio
        status.set(
          clashNow
            ? `t = ${t} ms · ${serial ? 'both cores print at once: the line is cut into pieces' : 'imu starts a transfer while logger is mid-transaction: bus collision'}`
            : waiter >= 0 && boosted
              ? `t = ${t} ms · priority inheritance: ${names[holder]} runs at prio ${r.prio[t][holder]} until it gives the mutex`
              : waiter >= 0 && holder >= 0 && run1 >= 0 && run1 !== holder && !serial
                ? `t = ${t} ms · priority inversion: ${names[run1]} (prio ${r.spec.tasks[run1].prio}) runs, ${names[holder]} holds the bus, ${names[waiter]} (prio ${r.spec.tasks[waiter].prio}) waits`
                : waiter >= 0
                  ? `t = ${t} ms · ${names[waiter]} blocks until ${holder >= 0 ? names[holder] : 'the holder'} gives the lock`
                  : `t = ${t} ms · ${r.cores.map((row, c) => (row[t] >= 0 ? `core ${c}: ${names[row[t]]}` : '')).filter(Boolean).join(' · ') || 'all tasks blocked'}`,
          clashNow || (waiter >= 0 && !boosted && !serial) ? HIGH_V : LABEL,
        )
        const take = M.lock === 'none' ? '' : ` xSemaphoreTake(${M.bus}Lock, portMAX_DELAY);`
        const give = M.lock === 'none' ? '' : ` xSemaphoreGive(${M.bus}Lock);`
        const create = M.lock === 'mutex' ? `SemaphoreHandle_t ${M.bus}Lock = xSemaphoreCreateMutex();  // owner + inheritance` : M.lock === 'semaphore' ? `SemaphoreHandle_t ${M.bus}Lock = xSemaphoreCreateBinary();  // no owner` : '// no lock: both tasks touch the bus whenever they run'
        code(
          serial
            ? [create, `void imuTask(void *) { for (;;) {${take}`, `    Serial.print("ax="); Serial.print(ax); Serial.print(" ay="); Serial.println(ay);${give} } }`, '// motorTask on core 1 prints "L=180 R=176" the same way']
            : [create, `void imuTask(void *) {${take}`, `    Wire.beginTransmission(0x68); Wire.write(0x3B); Wire.requestFrom(0x68, 6);${give} }`, '// logger (prio 1) holds the bus 6 ms; wifi (prio 3) never uses it'],
        )
      },
      readouts: (p) => {
        const M = mutexRun(p)
        if (M.bus === 'serial')
          return [
            { label: 'Output', value: M.clash ? 'garbled' : 'clean lines', tone: M.clash ? 'bad' : 'ok' },
            { label: 'Lines intact', value: pct(M.intact), tone: M.intact < 1 ? 'bad' : 'ok' },
            { label: 'imu waits for lock', value: M.lock === 'none' ? 'no lock' : ms(M.wait) },
          ]
        return [
          { label: 'Bus', value: M.clash ? 'collision: corrupt reads' : 'one transfer at a time', tone: M.clash ? 'bad' : 'ok' },
          { label: 'imu waited', value: ms(M.wait), tone: M.wait > 6 ? 'bad' : 'ok' },
          M.boost > 1 ? { label: 'logger priority', value: `1 → ${M.boost} (inherited)`, tone: 'ok' as const } : { label: 'logger priority', value: '1' },
        ]
      },
    }
  },
}
