import * as THREE from 'three/webgpu'
import {
  ISR_LATENCY_S,
  IsrShare,
  alarmPeriod,
  alarmTicks,
  buttonDown,
  driveToWall,
  hash01,
  isrCounter,
  isrLoad,
  pollSees,
  press,
  pulseTrain,
  serialPrintS,
  softwareEdges,
  timerAt,
  timerTickHz,
} from '../../core/physics'
import { hertz, msText, pct, secs } from '../../core/units'
import { buildHcSr04 } from '../../models/modules'
import { buildWheel } from '../../models/motion'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LED_RED,
  LOW_V,
  POWER,
  RING,
  arrow,
  codeBlock,
  glide,
  glowMat,
  ledLamp,
  liveLabel,
  memoBy,
  meterBar,
  partLetter,
  presence,
  pushButton,
  segmentDisplay,
  signalWire,
  timingDiagram,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'


/** A dark block with a title above; `set(glow, colour)` lights its face. */
function block(parent: THREE.Object3D, at: V3, [w, h]: [number, number], title: string) {
  const m = new THREE.MeshStandardMaterial({ color: '#1c1e24', emissive: RING, emissiveIntensity: 0, roughness: 0.6 })
  box(parent, [w, h, 1], m, [at[0], at[1], -0.3])
  partLetter(parent, title, [at[0], at[1] + h / 2 + 0.9, 0], 0.62, LABEL)
  return (glow: number, color = RING) => {
    m.emissive.set(color)
    m.emissiveIntensity = glow
  }
}

// --- Hardware timers: 80 MHz APB → prescaler → counter → alarm → ISR, against a delay() loop that drifts. ---

const PRESCALERS = { '2': 2, '80': 80, '8000': 8000 } as const
const TOGGLE_REAL_S = 0.8
const HT = { top: 8, sw: 0.4, led: 16 }
const timerSlow = (periodS: number) => Math.max(1, TOGGLE_REAL_S / periodS)
const timerSetup = (p: Params) => {
  const pre = PRESCALERS[pick(PRESCALERS, p.pre, '80')]
  const period = n(p, 'period') / 1000
  const alarm = alarmTicks(period, pre)
  return { pre, period, alarm, actual: alarmPeriod(alarm, pre), tick: timerTickHz(pre), work: n(p, 'work') / 1000 }
}
const swEdges = memoBy(
  (p: Params) => `${p.period}|${p.work}`,
  (p: Params) => softwareEdges(400, n(p, 'period') / 1000, n(p, 'work') / 1000),
)

export const hardwareTimers: Lesson = {
  id: 'timers-interrupts-hardware-timers',
  title: 'Hardware timers',
  tagline: 'A counter that never gets distracted',
  formula: (p) => {
    const t = timerSetup(p)
    return `80 MHz ÷ ${t.pre} = ${hertz(t.tick)} (one tick = ${secs(1 / t.tick)}) · alarm = ${msText(t.period, 2)} × ${hertz(t.tick)} = ${t.alarm.toLocaleString('en-US')} ticks → ISR every ${secs(t.actual)} · loop(): delay(${msText(t.period, 2)}) + 0–${msText(t.work, 2)} of work per pass`
  },
  legend: [
    { color: HIGH_V, label: 'Flash = alarm match, ISR runs', shape: 'dot' },
    { color: RING, label: 'loop(): yellow = delay(), orange = other work', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A hardware timer is just a counter clocked by the chip, running beside the CPU. The ESP32 has four, fed from the 80 MHz APB clock through a 16-bit prescaler (2…65536): ÷80 makes one tick per microsecond.',
    'You set an alarm value. When the 64-bit counter reaches it, the timer fires an interrupt and (with auto-reload) starts again from 0. 500 000 ticks of 1 µs = an ISR every 500 ms, exactly, whatever loop() is busy with.',
    'The prescaler trades range for resolution: ÷2 gives 25 ns ticks; ÷8000 gives 100 µs ticks, so a 1.23 ms period rounds to 12 ticks = 1.2 ms.',
    'A delay() loop times itself: delay(500), then the rest of loop() (sensors, Serial, Wi-Fi) adds a little every pass. The error never resets, so the blink drifts further behind each time. The timer’s LED stays on the grid.',
    'Like the button interrupt in GPIO → Interrupts, the timer ISR should only set a flag or toggle a pin; loop() does the slow work.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pre',
      options: [
        { value: '2', label: '÷2 (25 ns)' },
        { value: '80', label: '÷80 (1 µs)' },
        { value: '8000', label: '÷8000 (100 µs)' },
      ],
      initial: '80',
    },
    { kind: 'slider', key: 'period', label: 'Period', min: 1, max: 1000, initial: 500, log: true, format: (v) => `${+v.toPrecision(3)} ms` },
    { kind: 'slider', key: 'work', label: 'Loop work', min: 0, max: 100, initial: 40, step: 1, format: (v) => `0–${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const apb = block(scene, [-15, HT.top, 0], [4.6, 3], 'APB clock')
    partLetter(scene, '80 MHz', [-15, HT.top, 0.3], 0.7, RING)
    const pre = block(scene, [-7.4, HT.top, 0], [4.6, 3], 'prescaler')
    const preTag = liveLabel(scene, [-7.4, HT.top, 0.3], { size: 0.8, color: RING })
    const cnt = block(scene, [2.6, HT.top, 0], [9.6, 3], 'counter')
    const digits = segmentDisplay(8, 1.3, RING, true)
    add(scene, digits.group, [2.6, HT.top, 0.3])
    const cmp = block(scene, [10.8, HT.top, 0], [3, 3], 'alarm')
    partLetter(scene, '=', [10.8, HT.top, 0.3], 1.1, HIGH_V)
    const clk = signalWire(scene, [[-12.7, HT.top, 0], [-9.7, HT.top, 0]])
    const tickW = signalWire(scene, [[-5.1, HT.top, 0], [-2.2, HT.top, 0]])
    signalWire(scene, [[7.4, HT.top, 0], [9.3, HT.top, 0]])(0.5)
    const tickTag = liveLabel(scene, [-3.65, HT.top - 2.1, 0], { size: 0.5, color: GREY })
    const bar = meterBar(scene, [-1.4, HT.top - 4.4, 0], 8, 1, [[1, 'alarm', HIGH_V]], 'count')
    const alarmTag = liveLabel(scene, [10.8, HT.top - 2.4, 0], { size: 0.55, color: HIGH_V })
    const isr = add(scene, new THREE.Group(), [12.6, HT.top, 0.4])
    arrow(isr, [0, 0, 0], [1, 0, 0], HIGH_V, 1.2)
    partLetter(isr, 'ISR', [0.6, 1.2, 0], 0.7, HIGH_V)
    const hwLed = ledLamp(scene, LED_RED, [HT.led, HT.top - 1.6, 0], { scale: 0.8 })
    partLetter(scene, 'timer LED', [HT.led, HT.top - 2.6, 0], 0.55, LABEL)
    const loop = block(scene, [-11, HT.sw, 0], [6.6, 2.6], 'loop()')
    const loopTag = liveLabel(scene, [-11, HT.sw, 0.3], { size: 0.6, color: RING })
    const pass = meterBar(scene, [-3.2, HT.sw, 0], 8, 1, [], 'pass')
    const swWire = signalWire(scene, [[-11, HT.sw - 1.3, 0], [-11, HT.sw - 2.4, 0], [HT.led - 0.4, HT.sw - 2.4, 0], [HT.led - 0.4, HT.sw - 1.6, 0]])
    const swLed = ledLamp(scene, LED_RED, [HT.led, HT.sw - 1.6, 0], { scale: 0.8 })
    partLetter(scene, 'delay() LED', [HT.led, HT.sw - 3.4, 0], 0.55, LABEL)
    const code = codeBlock(scene, [-18, -4.4, 0], 0.6, 5)
    const scope = timingDiagram(scene, [1, -15.4, 0], [
      { label: 'ISR', color: HIGH_V },
      { label: 'TIMER', color: POWER },
      { label: 'DELAY', color: RING },
    ], { width: 32, rowH: 2.2, samples: 240 })
    const s = { key: '', t: 0, fired: 0, flash: 0, sw: 0, frame: 0 }
    return {
      scene,
      view: { center: [0, -2.6, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const t = timerSetup(p)
        const key = `${p.pre}|${p.period}|${p.work}`
        if (key !== s.key) Object.assign(s, { key, t: 0, fired: 0, flash: 0, sw: 0 })
        const edges = swEdges(p)
        s.t += dt / timerSlow(t.period)
        if (s.sw >= edges.length - 1) Object.assign(s, { t: 0, fired: 0, sw: 0 })
        s.frame++
        const now = timerAt(s.t, t.pre, t.alarm)
        if (now.fired !== s.fired) s.flash = 1
        s.fired = now.fired
        s.flash = Math.max(0, s.flash - dt * 4)
        while (edges[s.sw] <= s.t) s.sw++
        const hw = s.fired % 2
        const sw = s.sw % 2
        const realTick = t.tick / timerSlow(t.period)
        apb(0)
        clk(s.frame % 2)
        tickW(realTick > 8 ? s.frame % 2 : Math.floor(s.t * t.tick) % 2)
        pre(0)
        cnt(0.5 * s.flash, s.flash > 0.1 ? HIGH_V : RING)
        cmp(0.05 + 1.2 * s.flash, HIGH_V)
        presence(isr, 0.2 + 0.8 * s.flash)
        preTag.set(`÷ ${t.pre}`)
        tickTag.set(`${secs(1 / t.tick)} ticks`)
        digits.set(String(now.count))
        bar(now.count / t.alarm, '', s.flash > 0.1 ? HIGH_V : POWER)
        alarmTag.set(t.alarm.toLocaleString('en-US'))
        hwLed.set(hw)
        hwLed.step(dt)
        const start = s.sw ? edges[s.sw - 1] : 0
        const into = s.t - start
        const working = into > t.period
        pass(Math.min(1, into / (t.period + t.work)), working ? 'work' : `delay(${Math.round(t.period * 1000)})`, working ? HEAT : RING)
        loop(working ? 0.15 : 0, working ? HEAT : RING)
        loopTag.set(working ? 'busy' : 'waiting')
        swWire(sw)
        swLed.set(sw)
        swLed.step(dt)
        code([
          `t = timerBegin(0, ${t.pre}, true);  // ${secs(1 / t.tick)}`,
          `timerAlarmWrite(t, ${t.alarm}, true);`,
          'timerAttachInterrupt(t, &onTimer, true);',
          `loop: flip(); delay(${Math.round(t.period * 1000)});`,
          `  readSensors();  // up to +${Math.round(t.work * 1000)} ms`,
        ])
        scope.frame(dt, [+(s.flash > 0.6), hw, sw])
      },
      readouts: (p) => {
        const t = timerSetup(p)
        const edges = swEdges(p)
        const k = Math.max(1, s.sw)
        const drift = edges[k - 1] - k * t.period
        const err = t.actual - t.period
        return [
          { label: 'Tick', value: secs(1 / t.tick) },
          { label: 'Timer error', value: Math.abs(err) < 1e-12 ? '0' : `${err > 0 ? '+' : '−'}${secs(Math.abs(err))}`, tone: Math.abs(err) / t.period > 0.01 ? 'warn' : 'ok' },
          { label: 'delay() drift', value: `+${secs(drift)} after ${k}`, tone: drift > t.period / 4 ? 'bad' : 'warn' },
          { label: 'Slowed', value: `${Math.round(timerSlow(t.period))}×` },
        ]
      },
    }
  },
}

// --- ISR rules: a long ISR starves loop() and loses edges; shared counters need volatile and a critical section. ---

const BODIES = {
  flag: { label: 'count++ only', s: 1e-6, line: '{ count++; }' },
  serial: { label: 'Serial.print', s: serialPrintS(20), line: '{ count++; Serial.println(count); }' },
  delay: { label: 'delay(5)', s: 5e-3, line: '{ count++; delay(5); }' },
} as const
const SHARES: Record<IsrShare, string> = { plain: 'plain int', volatile: 'volatile', critical: 'critical' }
const EDGE_S = 1e-3
const LOOP_S = 4e-3
const GAP_S = serialPrintS(12)
const ISR_SLOW = 500
const HORIZON = 0.06
const IS = { disc: -15, latch: -6.6, cpu: 4, ring: 8.4, top: 6.4, cnt: 15.6 }
const SLOTS = 8
const isrRun = memoBy(
  (p: Params) => `${p.body}|${p.share}`,
  (p: Params) => {
    const edges = pulseTrain(Math.ceil(HORIZON / EDGE_S), EDGE_S)
    const r = isrCounter(edges, BODIES[pick(BODIES, p.body, 'flag')].s, LOOP_S, GAP_S, pick(SHARES, p.share, 'volatile'), HORIZON)
    return { edges, ...r, lost: r.starts.filter((x) => x === null).length, load: isrLoad(r.runs, HORIZON) }
  },
)
const ISR_LOOP: Record<IsrShare, string[]> = {
  plain: ['int n = count;  // kept in a register', 'Serial.println(n);  // 0, forever', 'count = 0;'],
  volatile: ['int n = count;', 'Serial.println(n);  // ISR here: wiped', 'count = 0;'],
  critical: ['portENTER_CRITICAL(&mux);', '  n = count; count = 0;', 'portEXIT_CRITICAL(&mux); print(n);'],
}

export const isrRules: Lesson = {
  id: 'timers-interrupts-isr-rules',
  title: 'ISR rules',
  tagline: 'Get in, set a flag, get out',
  formula: (p) => {
    const b = BODIES[pick(BODIES, p.body, 'flag')]
    const r = isrRun(p)
    const share = pick(SHARES, p.share, 'volatile')
    const tail =
      share === 'plain'
        ? 'count not volatile → loop() reads a stale register copy'
        : share === 'volatile'
          ? `copy … ${msText(GAP_S, 2)} print … clear → counts in that gap are wiped`
          : 'copy + clear with interrupts held off: nothing wiped'
    return `ISR ${secs(b.s + ISR_LATENCY_S)} vs an edge every ${msText(EDGE_S, 2)} → ${pct(r.load)} of the CPU in ISRs, ${pct(r.lost / r.edges.length)} of edges lost · ${tail}`
  },
  legend: [
    { color: HIGH_V, label: 'Red = ISR running (loop() frozen)', shape: 'dot' },
    { color: HEAT, label: 'Orange = edge lost (one already pending)', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An interrupt stops loop() wherever it is, runs the ISR, then resumes. While one ISR runs, a second edge can only set a pending bit; a third edge before it is served is simply lost.',
    'So an ISR must be short: bump a counter or set a flag, then return. Serial.print waits on the UART (20 characters at 115200 baud ≈ 1.7 ms) and delay() waits on purpose, so edges arriving every 1 ms pile up, get dropped, and loop() barely runs.',
    'Variables shared with an ISR must be volatile. Otherwise the compiler may load the value into a register once and never read memory again: loop() sees 0 forever.',
    'volatile is not enough for read-then-clear: if the ISR fires between n = count and count = 0, its count is wiped. Wrap the pair in a critical section (portENTER_CRITICAL on the ESP32, noInterrupts() on AVR), keep it tiny, and print outside it.',
    `On the ESP32, put ISRs in IRAM (IRAM_ATTR). Edges here come from an encoder at 1 kHz; time is slowed ${ISR_SLOW}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'body', options: Object.entries(BODIES).map(([value, b]) => ({ value, label: b.label })), initial: 'flag' },
    { kind: 'choice', key: 'share', options: Object.entries(SHARES).map(([value, label]) => ({ value, label })), initial: 'volatile' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const disc = add(scene, new THREE.Group(), [IS.disc, IS.top, 0])
    cylinder(disc, 2.8, 0.3, mat('#3a3e48', { rough: 0.5 }), [0, 0, 0], 'z', 48)
    for (let k = 0; k < SLOTS; k++) {
      const a = (2 * Math.PI * k) / SLOTS
      box(disc, [0.5, 0.8, 0.4], mat('#101216'), [2.3 * Math.cos(a), 2.3 * Math.sin(a), 0]).rotation.z = a + Math.PI / 2
    }
    const gateM = glowMat(POWER, 0.2)
    box(scene, [0.8, 1.4, 1.2], gateM, [IS.disc, IS.top + 2.6, 0])
    partLetter(scene, 'encoder', [IS.disc, IS.top - 3.8, 0], 0.62, LABEL)
    const line = signalWire(scene, [[IS.disc + 0.5, IS.top + 2.6, 0], [IS.latch - 2.8, IS.top + 2.6, 0], [IS.latch - 2.8, IS.top, 0], [IS.latch - 1.3, IS.top, 0]])
    const latch = block(scene, [IS.latch, IS.top, 0], [2.6, 2.4], 'pending')
    const lostTag = liveLabel(scene, [IS.latch, IS.top - 2.2, 0], { size: 0.62, color: HEAT })
    const toCpu = signalWire(scene, [[IS.latch + 1.3, IS.top, 0], [IS.cpu - 2.2, IS.top, 0]])
    box(scene, [10.4, 7.4, 0.4], mat('#24272f', { rough: 0.7 }), [IS.cpu + 2.2, IS.top - 0.6, -1])
    partLetter(scene, 'CPU core', [IS.cpu + 2.2, IS.top - 5, 0], 0.62, GREY)
    const isrB = block(scene, [IS.cpu, IS.top, 0], [3.8, 2.4], 'ISR')
    const isrTag = liveLabel(scene, [IS.cpu, IS.top - 2, 0], { size: 0.5, color: HIGH_V })
    add(scene, new THREE.Mesh(new THREE.TorusGeometry(2, 0.12, 10, 64), mat('#5c6270', { rough: 0.5 })), [IS.ring, IS.top - 0.6, 0])
    const beadM = glowMat(RING, 1)
    const bead = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), beadM), [IS.ring, IS.top + 1.4, 0])
    partLetter(scene, 'loop()', [IS.ring, IS.top - 0.6, 0], 0.62, LABEL)
    const counts = (['edges', 'ISR ran', 'loop got'] as const).map((caption, k) => {
      const d = segmentDisplay(3, 1.2, [POWER, HIGH_V, RING][k], true)
      add(scene, d.group, [IS.cnt, IS.top + 1.6 - k * 3.4, 0.3])
      partLetter(scene, caption, [IS.cnt, IS.top + 2.9 - k * 3.4, 0], 0.5, LABEL)
      return d
    })
    const code = codeBlock(scene, [-18, -1.2, 0], 0.6, 5)
    const scope = timingDiagram(scene, [1, -13.6, 0], [
      { label: 'EDGE', color: POWER },
      { label: 'ISR', color: HIGH_V },
      { label: 'LOOP', color: RING },
    ], { width: 32, rowH: 2.2, samples: 300 })
    const s = { key: '', t: 0, lostFlash: 0 }
    return {
      scene,
      view: { center: [0, -2.4, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const r = isrRun(p)
        const b = BODIES[pick(BODIES, p.body, 'flag')]
        const share = pick(SHARES, p.share, 'volatile')
        const key = `${p.body}|${p.share}`
        if (key !== s.key) Object.assign(s, { key, t: 0, lostFlash: 0 })
        let t0 = s.t
        s.t += dt / ISR_SLOW
        if (s.t >= HORIZON) s.t = t0 = 0
        const seen = r.edges.filter((e) => e <= s.t).length
        const fresh = r.edges.some((e, i) => e > t0 && e <= s.t && r.starts[i] === null)
        if (fresh) s.lostFlash = 1
        s.lostFlash = Math.max(0, s.lostFlash - dt * 1.5)
        const edgeHigh = r.edges.some((e) => s.t >= e && s.t < e + 0.15 * EDGE_S)
        const running = r.runs.some(([a, z]) => s.t >= a && s.t < z)
        const ran = r.runs.filter(([a]) => a <= s.t).length
        const pending = r.edges.some((e, i) => e <= s.t && (r.starts[i] ?? -1) > s.t)
        const lost = r.starts.filter((x, i) => x === null && r.edges[i] <= s.t).length
        const got = r.reads.filter((x) => x.copy <= s.t).reduce((a, x) => a + x.got, 0)
        disc.rotation.z = (-s.t / EDGE_S) * ((2 * Math.PI) / SLOTS)
        gateM.emissiveIntensity = edgeHigh ? 1.6 : 0.2
        line(+edgeHigh)
        latch(pending ? 1 : 0.1, pending ? RING : GREY)
        toCpu(+(running || pending))
        lostTag.set(lost ? `${lost} lost` : '', HEAT)
        if (s.lostFlash > 0) latch(0.6 + s.lostFlash, HEAT)
        isrB(running ? 1.2 : 0.08, HIGH_V)
        isrTag.set(b.label)
        const cpu = s.t * (1 - isrLoad(r.runs, Math.max(s.t, 1e-9)))
        const a = (2 * Math.PI * cpu) / LOOP_S
        bead.position.set(IS.ring + 2 * Math.sin(a), IS.top - 0.6 + 2 * Math.cos(a), 0)
        beadM.emissiveIntensity = running ? 0.15 : 1
        counts[0].set(String(seen))
        counts[1].set(String(ran))
        counts[2].set(String(got))
        code([`volatile int count;`.replace('volatile ', share === 'plain' ? '' : 'volatile '), `void IRAM_ATTR onEdge() ${b.line}`, ...ISR_LOOP[share]])
        scope.frame(dt, [+edgeHigh, +running, +!running])
      },
      readouts: (p) => {
        const r = isrRun(p)
        const b = BODIES[pick(BODIES, p.body, 'flag')]
        const ran = r.runs.filter(([a]) => a <= s.t).length
        const got = r.reads.filter((x) => x.copy <= s.t).reduce((a, x) => a + x.got, 0)
        const lostShare = r.lost / r.edges.length
        return [
          { label: 'ISR time', value: secs(b.s + ISR_LATENCY_S), tone: b.s > EDGE_S / 10 ? 'bad' : 'ok' },
          { label: 'Edges lost', value: pct(lostShare), tone: lostShare > 0 ? 'bad' : 'ok' },
          { label: 'CPU in ISRs', value: pct(r.load), tone: r.load > 0.5 ? 'bad' : 'ok' },
          { label: 'Loop got', value: `${got} / ${ran}`, tone: got + 1 >= ran ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Millis without delay: delay() freezes the robot between sensor reads; a millis() scheduler checks every task each pass. ---

const MODES = { delay: 'delay()', millis: 'millis()' } as const
const D0 = 60
const SPEED = 30
const STOP_CM = 15
const PING_S = 0.05
const BTN_S = 0.01
const HOLD_S = 1.2
const MD_SLOW = 2
const K = 0.4
const WALL_X = 15
const FLOOR = 4
const readPeriod = (p: Params) => (p.how === 'millis' ? PING_S : (2 * n(p, 'blink')) / 1000)
const runAt = (p: Params, r: number) => {
  const T = readPeriod(p)
  return driveToWall(D0, SPEED, STOP_CM, T, hash01(r + 3) * T)
}
const MD_CODE = {
  delay: (b: number) => [`digitalWrite(LED, HIGH); delay(${b});`, `digitalWrite(LED, LOW);  delay(${b});`, 'if (readCm() < 15) stop();', 'if (!digitalRead(BTN)) honk();', '// each line waits for the one above'],
  millis: (b: number) => [
    'uint32_t now = millis();',
    `if (now - tLed >= ${b}) { tLed = now; flip(); }`,
    'if (now - tPing >= 50) { tPing = now; check(); }',
    'if (!digitalRead(BTN)) honk();',
    '// loop() never waits, about 1 ms a pass',
  ],
}

export const millisWithoutDelay: Lesson = {
  id: 'timers-interrupts-millis-without-delay',
  title: 'Millis without delay',
  tagline: 'Never stop to wait',
  formula: (p) => {
    const T = readPeriod(p)
    return p.how === 'millis'
      ? `if (millis() − last ≥ interval): each task runs when due, loop() never waits · sensor every ${msText(T, 2)} → at ${SPEED} cm/s at most ${+(SPEED * T).toFixed(1)} cm past the ${STOP_CM} cm line · unsigned maths survives the 49.7-day millis() rollover`
      : `delay() blocks: one pass = 2 × ${msText(T / 2, 2)} → sensor and button read every ${msText(T, 2)} · at ${SPEED} cm/s the robot moves up to ${+(SPEED * T).toFixed(0)} cm between reads (stop line ${STOP_CM} cm)`
  },
  legend: [
    { color: RING, label: 'Flash = ultrasonic ping (sensor read)', shape: 'dot' },
    { color: HIGH_V, label: 'Red wall = crash', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'delay(500) does nothing for half a second: no sensor reads, no button checks, no motor updates. A blink written with two delays means the rest of loop() runs once a second.',
    'A robot driving at 30 cm/s covers 30 cm in that second. If the obstacle crosses the 15 cm line just after a read, the next one comes too late and it hits the wall. A press shorter than a pass is missed too.',
    'The fix: never wait. Each pass, compare millis() with when each task last ran; if its interval has passed, run it and note the time. loop() spins in about a millisecond, so every task is checked hundreds of times a second.',
    'Write it as now − last ≥ interval with uint32_t. millis() wraps to 0 after 49.7 days, and unsigned subtraction still gives the right gap across the wrap; now ≥ last + interval does not.',
    `For exact timing use a hardware timer; for many tasks an RTOS. Time here is slowed ${MD_SLOW}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'how', options: Object.entries(MODES).map(([value, label]) => ({ value, label })), initial: 'delay' },
    { kind: 'slider', key: 'blink', label: 'Blink half-period', min: 100, max: 1000, initial: 500, step: 50, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    box(scene, [36, 0.3, 4], mat('#2a2d34', { rough: 0.8 }), [-1, FLOOR - 0.15, 0])
    const wallM = new THREE.MeshStandardMaterial({ color: '#6b6f78', emissive: HIGH_V, emissiveIntensity: 0, roughness: 0.8 })
    box(scene, [1, 4.6, 4], wallM, [WALL_X + 0.5, FLOOR + 2.3, 0])
    const lineX = WALL_X - STOP_CM * K
    box(scene, [0.14, 3, 0.14], glowMat(POWER, 0.8), [lineX, FLOOR + 1.5, 2])
    partLetter(scene, `${STOP_CM} cm`, [lineX, FLOOR - 1, 0], 0.55, POWER)
    const robot = add(scene, new THREE.Group(), [0, FLOOR, 0])
    const len = 16 * K
    box(robot, [len, 1.2, 3.4], mat('#2f6f4e', { rough: 0.6 }), [-len / 2, 1.5, 0])
    box(robot, [2, 0.5, 1.6], mat('#1a1c20'), [-len / 2 - 1, 2.35, 0])
    const sonar = add(robot, buildHcSr04(), [0.25, 1.2, 0])
    sonar.scale.setScalar(0.14)
    sonar.rotation.y = Math.PI / 2
    const wheels = [-len + 1.2, -1.4].map((x) => {
      const w = add(robot, buildWheel(), [x, 1.05, 1.9])
      w.scale.setScalar(0.08)
      return w
    })
    const beamM = glowMat(RING, 1)
    const beam = add(scene, new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.5), beamM), [0, FLOOR + 2.2, 0])
    const dist = liveLabel(scene, [0, FLOOR + 4.6, 0], { size: 0.7 })
    const led = ledLamp(scene, LED_RED, [-15, -2.8, 0], { scale: 0.8 })
    partLetter(scene, 'LED', [-15, -3.8, 0], 0.55, LABEL)
    const btn = pushButton(scene, [-11.5, -3.4, 0], [-8.5, -3.4, 0])
    partLetter(scene, 'button', [-10, -4.6, 0], 0.55, LABEL)
    const caught = [segmentDisplay(3, 1.1, POWER, true), segmentDisplay(3, 1.1, RING, true)]
    caught.forEach((d, k) => {
      add(scene, d.group, [-1 + k * 6, -2.7, 0.3])
      partLetter(scene, k ? 'seen' : 'presses', [-1 + k * 6, -1.1, 0], 0.5, LABEL)
    })
    const passTag = liveLabel(scene, [9, -2.7, 0], { size: 0.6, color: GREY, align: 'left' })
    const code = codeBlock(scene, [-18, -6.4, 0], 0.58, 5)
    const scope = timingDiagram(scene, [1, -17.2, 0], [
      { label: 'LED', color: LED_RED },
      { label: 'PING', color: RING },
      { label: 'BTN', color: POWER },
      { label: 'SEEN', color: LOW_V },
    ], { width: 32, rowH: 1.8, samples: 300 })
    const s = { key: '', t: 0, rt: 0, run: 0, x: 0, ping: 0, next: 0, presses: 0, seen: 0, held: 0, pressed: 0, crash: 0 }
    return {
      scene,
      view: { center: [-1, -3.4, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const T = readPeriod(p)
        const half = n(p, 'blink') / 1000
        const key = `${p.how}|${p.blink}`
        if (key !== s.key) Object.assign(s, { key, t: 0, rt: 0, run: 0, ping: 0, next: 0, presses: 0, seen: 0, crash: 0 })
        const sdt = dt / MD_SLOW
        s.t += sdt
        s.rt += sdt
        let run = runAt(p, s.run)
        if (s.rt > run.stopT + HOLD_S) {
          s.rt = 0
          run = runAt(p, ++s.run)
        }
        const phase = hash01(s.run + 3) * T
        const tt = Math.min(s.rt, run.stopT)
        const d = D0 - SPEED * tt
        const k0 = Math.floor((s.rt - sdt - phase) / T)
        const k1 = Math.floor((s.rt - phase) / T)
        if (k1 !== k0 && s.rt - phase <= run.stopT + 1e-6) s.ping = 1
        s.ping = Math.max(0, s.ping - dt * 8)
        const front = WALL_X - d * K
        robot.position.x = front - 0.6
        for (const w of wheels) w.rotation.z = -(front / 1.05)
        beam.visible = s.ping > 0.05
        beam.scale.x = Math.max(0.1, d * K - 1.2)
        beam.position.x = front + 0.6 + (d * K - 1.2) / 2
        beamM.emissiveIntensity = 2 * s.ping
        dist.group.position.x = front - len / 2
        const done = s.rt >= run.stopT
        s.crash = glide(dt, s.crash, done && run.crashed ? 1 : 0, 10)
        wallM.emissiveIntensity = 1.4 * s.crash
        if (done) dist.set(run.crashed ? 'CRASH' : `stopped at ${run.stopD.toFixed(0)} cm`, run.crashed ? HIGH_V : POWER)
        else dist.set(`${d.toFixed(0)} cm`, d < STOP_CM ? HEAT : LABEL)
        for (let i = s.next; press(i).start <= s.t; i = ++s.next) {
          const pr = press(i)
          s.presses++
          if (pollSees(pr.start, pr.len, p.how === 'millis' ? BTN_S : T)) s.seen++
        }
        const down = buttonDown(s.t)
        s.pressed = glide(dt, s.pressed, +down, 20)
        btn.set(s.pressed)
        const ledOn = Math.floor(s.t / half) % 2 === 0
        led.set(+ledOn)
        led.step(dt)
        caught[0].set(String(s.presses % 1000))
        caught[1].set(String(s.seen % 1000))
        const blocked = p.how !== 'millis'
        passTag.set(blocked ? `pass: ${msText(T, 2)}` : 'pass: ≈ 1 ms', blocked ? HEAT : POWER)
        code(MD_CODE[pick(MODES, p.how, 'delay')](Math.round(half * 1000)))
        const btnRead = blocked ? Math.floor(s.t / T) * T : s.t
        scope.frame(dt, [+ledOn, +(s.ping > 0.5), +down, +(blocked ? buttonDown(btnRead) : down)])
      },
      readouts: (p) => {
        const T = readPeriod(p)
        const run = runAt(p, s.run)
        const done = s.rt >= run.stopT
        return [
          { label: 'Sensor every', value: msText(T, 2), tone: T > 0.1 ? 'bad' : 'ok' },
          { label: 'Last stop', value: !done ? 'driving' : run.crashed ? 'CRASH' : `${run.stopD.toFixed(0)} cm`, tone: !done ? undefined : run.crashed ? 'bad' : 'ok' },
          { label: 'Presses seen', value: `${s.seen} / ${s.presses}`, tone: s.seen < s.presses ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
