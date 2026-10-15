import * as THREE from 'three/webgpu'
import {
  BEACON_AWAKE_S,
  BEACON_S,
  CPU_80_A,
  CellId,
  DEVKIT_EXTRA_A,
  Domain,
  DomainState,
  NODE_CELLS,
  NODE_PEAK_A,
  NODE_SLEEP_A,
  NodeRadio,
  POWER_MODES,
  Step,
  PowerMode,
  RADIO_RX_A,
  SENSOR_READ,
  WAKE_SLEEP_A,
  WakeSource,
  YEAR_H,
  averageAmps,
  bootPhases,
  hash01,
  lifeYears,
  lightBreakEvenS,
  nodeCycle,
  stepAt,
  phaseCharge,
  phaseTime,
} from '../../core/physics'
import { amps as ampText, msText, pct, secs, si, spanText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cell18650,
  codeBlock,
  emptyGroup,
  esp32Board,
  glide,
  glowMat,
  i2cBreakout,
  liveLabel,
  meterBar,
  partLetter,
  presence,
  ripples,
  scope,
  setGlow,
  shadowlessRod,
  stretchRod,
  trayMat,
  wire,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const PERIPH = '#7fa8ff'
const OFF = '#23262d'
const coulombs = (c: number) => si(c, 'C')
const logU = (a: number) => Math.min(1, Math.max(0, (Math.log10(a) + 6) / 6))
const ampColor = (a: number) => (a < 1e-4 ? POWER : a < 5e-3 ? RING : HEAT)
const lifeText = (cell: CellId, a: number) => spanText(lifeYears(cell, a) * YEAR_H)

/** Log current meter, 1 µA … 1 A. */
function ampMeter(parent: THREE.Object3D, at: V3, w: number, caption: string) {
  const set = meterBar(parent, at, w, 6, [[1, '10 µA', POWER], [3, '1 mA', RING], [5, '100 mA', HEAT]], caption)
  return (a: number) => set(logU(a) * 6, ampText(a), ampColor(a))
}

// --- The chip seen from inside: one block per power domain, lit when clocked, amber when held, dark when unpowered. ---

interface Block {
  dom: Domain
  name: string
  x: number
  y: number
  w: number
  h: number
  color: string
}
const BLOCKS: Block[] = [
  { dom: 'cpu', name: 'CPU 0', x: -8.4, y: 3.6, w: 5, h: 4, color: CLK_COLOR },
  { dom: 'cpu', name: 'CPU 1', x: -3, y: 3.6, w: 5, h: 4, color: CLK_COLOR },
  { dom: 'ram', name: 'SRAM 520 KB', x: -5.7, y: -1.1, w: 10.4, h: 3.6, color: RING },
  { dom: 'periph', name: 'UART SPI I²C ADC', x: -5.7, y: -4.9, w: 10.4, h: 2.6, color: PERIPH },
  { dom: 'radio', name: 'Wi-Fi/BT radio', x: 7.2, y: 3.6, w: 8, h: 4, color: DATA_COLOR },
  { dom: 'rtc', name: 'RTC timer', x: 7.2, y: -0.6, w: 8, h: 1.7, color: POWER },
  { dom: 'rtcMem', name: 'RTC RAM', x: 7.2, y: -2.85, w: 8, h: 1.9, color: POWER },
  { dom: 'ulp', name: 'ULP', x: 7.2, y: -5.1, w: 8, h: 1.7, color: POWER },
]
const LEVEL: Record<DomainState, number> = { on: 1, held: 0.35, off: 0 }

function chipView(parent: THREE.Object3D, at: V3, scale = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(scale)
  box(g, [28, 17.4, 1], trayMat(), [0.5, -0.3, -0.7])
  box(g, [26, 15.4, 0.2], mat('#2b303a', { rough: 0.45, metal: 0.2 }), [0.5, -0.3, -0.15])
  const tin = mat('#b8bcc4', { metal: 0.4, rough: 0.35 })
  for (let k = 0; k < 12; k++) {
    for (const s of [-1, 1]) {
      box(g, [0.9, 0.7, 0.3], tin, [0.5 + (k - 5.5) * 2.1, -0.3 + s * 9, -0.3])
      box(g, [0.7, 0.8, 0.3], tin, [0.5 + s * 14.3, -0.3 + (k - 5.5) * 1.3, -0.3])
    }
  }
  const frame = glowMat(POWER, 0.35)
  const fr: [number, number][] = [[2.8, 0.55], [11.6, 0.55], [11.6, -6.3], [2.8, -6.3]]
  fr.forEach((a, i) => stretchRod(add(g, shadowlessRod(frame)), [a[0], a[1], 0.15], [fr[(i + 1) % 4][0], fr[(i + 1) % 4][1], 0.15], 0.07))
  partLetter(g, 'RTC domain · stays powered', [7.2, -6.95, 0.2], 0.4, POWER)
  const antMat = glowMat(DATA_COLOR, 0)
  for (let k = 0; k < 4; k++) {
    stretchRod(add(g, shadowlessRod(antMat)), [15.2 + k * 0.5, 2.6, 0], [15.2 + k * 0.5, 4.6, 0], 0.08)
    if (k < 3) stretchRod(add(g, shadowlessRod(antMat)), [15.2 + k * 0.5, k % 2 ? 2.6 : 4.6, 0], [15.7 + k * 0.5, k % 2 ? 2.6 : 4.6, 0], 0.08)
  }
  stretchRod(add(g, shadowlessRod(antMat)), [11.2, 3.6, 0.3], [15.2, 3.6, 0], 0.06)
  const dark = mat('#1a1c21')
  const tint = new THREE.Color()
  const blocks = BLOCKS.map((b) => {
    box(g, [b.w, b.h, 0.35], mat('#353b47', { rough: 0.5 }), [b.x, b.y, 0.1])
    const plate = glowMat(OFF, 0)
    const pm = add(g, mesh(new THREE.BoxGeometry(b.w - 0.3, b.h - 0.3, 0.08), plate), [b.x, b.y, 0.32])
    pm.castShadow = false
    partLetter(g, b.name, [b.x - b.w / 2 + 0.35, b.y + b.h / 2 - 0.6, 0.45], 0.48, LABEL, 'left')
    const big = b.h >= 3
    const value = liveLabel(g, big ? [b.x, b.y + 0.1, 0.45] : [b.x + b.w / 2 - 0.35, b.y + b.h / 2 - 0.6, 0.45], { size: big ? 0.6 : 0.42, align: big ? 'center' : 'right' })
    const n = Math.max(4, Math.floor((b.w - 0.6) / 0.9))
    const on = glowMat(b.color, 1)
    const held = glowMat(HEAT, 0.7)
    const bits = Array.from({ length: n }, (_, k) => add(g, mesh(new THREE.BoxGeometry(0.55, 0.3, 0.1), dark), [b.x - b.w / 2 + 0.65 + k * 0.9, b.y - b.h / 2 + 0.5, 0.42]))
    return { b, plate, value, bits, on, held, pattern: bits.map(() => false), lvl: 0, tick: -1 }
  })
  return {
    group: g,
    antenna: [at[0] + 16 * scale, at[1] + 3.6 * scale, at[2] + 0.3] as V3,
    antMat,
    /** Left package edge at die height `y`, world space. */
    edge: (y: number): V3 => [at[0] - 13.8 * scale, at[1] + y * scale, at[2]],
    /** `store` pins a block's bits to a number (binary) instead of random activity. */
    set(dm: Record<Domain, DomainState>, t: number, dt: number, store: Partial<Record<Domain, number>> = {}) {
      blocks.forEach((B, i) => {
        const st = dm[B.b.dom]
        B.lvl = glide(dt, B.lvl, LEVEL[st], 8)
        const col = st === 'held' ? HEAT : B.b.color
        B.plate.color.set(OFF).lerp(tint.set(col), 0.6 * B.lvl)
        B.plate.emissive.set(col)
        B.plate.emissiveIntensity = 0.25 * B.lvl
        const tick = Math.floor(t * 6)
        const n = store[B.b.dom]
        if (st === 'off') B.pattern.fill(false)
        else if (n !== undefined) B.pattern.forEach((_, k) => (B.pattern[k] = Math.floor(n / 2 ** (B.pattern.length - 1 - k)) % 2 === 1))
        else if (st === 'on' && tick !== B.tick) B.pattern.forEach((_, k) => (B.pattern[k] = hash01(tick * 31 + k * 7 + i * 101) > 0.5))
        B.tick = tick
        B.bits.forEach((o, k) => (o.material = B.pattern[k] ? (st === 'held' ? B.held : B.on) : dark))
      })
    },
    value(dom: Domain, text: string, color = LABEL) {
      blocks.find((B) => B.b.dom === dom)!.value.set(text, color)
    },
  }
}

// --- Deep sleep: four modes, each switching more of the chip off. ---

const MODES: Record<PowerMode, string> = { active: 'Active', modem: 'Modem sleep', light: 'Light sleep', deep: 'Deep sleep' }
const DTIM = 3
const MODEM_SLOW = 5
const KEPT: Record<PowerMode, string> = {
  active: 'everything, running',
  modem: 'everything; radio naps',
  light: 'RAM, clocks stopped',
  deep: 'RTC memory only (8 KB)',
}
const WAKE: Record<PowerMode, string> = {
  active: 'already awake',
  modem: 'instant',
  light: `${msText(POWER_MODES.light.wakeS)}, resumes`,
  deep: `${msText(POWER_MODES.deep.wakeS)} reboot`,
}
const MODE_CODE: Record<PowerMode, string[]> = {
  active: ['WiFi.begin("home", "secret");', 'WiFi.setSleep(false);  // radio listens nonstop', 'setCpuFrequencyMhz(240);', '// connected and fast: ~120 mA'],
  modem: ['WiFi.begin("home", "secret");', 'WiFi.setSleep(true);  // default: radio naps between beacons', 'setCpuFrequencyMhz(80);', '// still connected, loop() still runs'],
  light: ['esp_sleep_enable_timer_wakeup(5 * 1000000ULL);', 'esp_light_sleep_start();  // CPU pauses on this line', '// 5 s later it returns: RAM, variables intact', 'Serial.println(count);  // carries on'],
  deep: ['RTC_DATA_ATTR int count;  // RTC memory survives', 'esp_sleep_enable_timer_wakeup(5 * 1000000ULL);', 'esp_deep_sleep_start();  // never returns', '// wakes as a reset: setup() runs again'],
}

export const deepSleep: Lesson = {
  id: 'power-modes-deep-sleep',
  title: 'Deep sleep',
  tagline: 'Switch off most of the chip, keep a clock ticking',
  formula: (p) => {
    const mode = pick(MODES, p.mode, 'deep')
    const a = POWER_MODES[mode].amps
    const how =
      mode === 'modem'
        ? `${ampText(CPU_80_A)} CPU at 80 MHz + ${ampText(RADIO_RX_A)} radio × ${msText(BEACON_AWAKE_S)} every ${DTIM}rd beacon (${msText(BEACON_S * DTIM)}) = ${ampText(a)}`
        : `${MODES[mode]}: ${ampText(a)}`
    return `${how} · 18650 (3000 mAh) lasts ${lifeText('li18650', a)} on the bare chip, ${lifeText('li18650', a + DEVKIT_EXTRA_A)} on a DevKit (+${ampText(DEVKIT_EXTRA_A)})${mode === 'modem' ? ` · beacons slowed ${MODEM_SLOW}×` : ''}`
  },
  legend: [
    { color: CLK_COLOR, label: 'Clocked and running', shape: 'dot' },
    { color: HEAT, label: 'Held: clock stopped, contents kept', shape: 'dot' },
    { color: '#4a4f5a', label: 'Dark = unpowered: contents lost', shape: 'dot' },
    { color: POWER, label: 'RTC domain: never switched off', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The ESP32 is split into power domains: two CPU cores, 520 KB of SRAM, the peripherals, the Wi-Fi/Bluetooth radio, and a small RTC domain (a slow 150 kHz timer, RTC GPIO, 8 KB of RTC memory and the ULP co-processor). Sleep modes are just which domains stay on.',
    'Active with Wi-Fi connected: everything clocked, the radio listening nonstop, ~120 mA with 350 mA spikes when it transmits.',
    `Modem sleep (the Arduino default once Wi-Fi is up): the CPU keeps running, but the radio sleeps between access-point beacons and wakes only for every ${DTIM}rd one to stay connected. Drop the CPU to 80 MHz and it is ~${Math.round(POWER_MODES.modem.amps * 1000)} mA.`,
    'Light sleep: the clocks to the CPU, RAM and peripherals stop, but they stay powered, so nothing is lost. ~0.8 mA, and the program continues on the next line about a millisecond after the wake.',
    'Deep sleep: everything outside the RTC domain is switched off: ~10 µA. RAM is gone, so waking is a reset: setup() runs again. Only variables marked RTC_DATA_ATTR survive.',
    'Those µA are the chip alone. A DevKit’s USB-UART bridge, AMS1117 regulator and power LED add ~8 mA, which swamps deep sleep: battery projects use a bare module and a low-quiescent regulator.',
  ],
  controls: [{ kind: 'choice', key: 'mode', options: (Object.keys(MODES) as PowerMode[]).map((k) => ({ value: k, label: MODES[k] })), initial: 'deep' }],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const chip = chipView(scene, [3.5, 0, 0])
    const rip = ripples(scene, chip.antenna, { reach: 2.4 })
    const chipM = ampMeter(scene, [-25, -2.5, 0], 8, 'chip')
    const kitM = ampMeter(scene, [-25, -6.5, 0], 8, 'DevKit')
    const code = codeBlock(scene, [-29.5, 6.5, 0], 0.4, 4)
    const s = { t: 0 }
    return {
      scene,
      view: { center: [-4.5, -0.5, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const mode = pick(MODES, p.mode, 'deep')
        const M = POWER_MODES[mode]
        s.t += dt
        const dm = { ...M.domains }
        const beacon = mode === 'modem' && (s.t / MODEM_SLOW) % (BEACON_S * DTIM) < 0.05
        if (beacon) dm.radio = 'on'
        chip.set(dm, s.t, dt)
        const radio = mode === 'active' ? 0.8 : beacon ? 0.9 : 0
        rip(s.t, DATA_COLOR, radio)
        setGlow(chip.antMat, DATA_COLOR, radio)
        chipM(M.amps)
        kitM(M.amps + DEVKIT_EXTRA_A)
        chip.value('cpu', mode === 'active' ? '240 MHz' : mode === 'modem' ? '80 MHz' : mode === 'light' ? 'paused' : 'off', dm.cpu === 'on' ? LABEL : dm.cpu === 'held' ? HEAT : GREY)
        chip.value('ram', dm.ram === 'off' ? 'lost' : dm.ram === 'held' ? 'kept' : 'in use', dm.ram === 'off' ? HIGH_V : dm.ram === 'held' ? HEAT : LABEL)
        chip.value('radio', mode === 'active' ? 'listening' : mode === 'modem' ? (beacon ? 'beacon!' : 'napping') : 'off', dm.radio === 'on' ? DATA_COLOR : GREY)
        code(MODE_CODE[mode])
      },
      readouts: (p) => {
        const mode = pick(MODES, p.mode, 'deep')
        const a = POWER_MODES[mode].amps
        return [
          { label: 'Chip on an 18650', value: `${ampText(a)} · ${lifeText('li18650', a)}`, tone: a < 1e-3 ? 'ok' : a < 0.05 ? 'warn' : 'bad' },
          { label: 'DevKit', value: `${ampText(a + DEVKIT_EXTRA_A)} · ${lifeText('li18650', a + DEVKIT_EXTRA_A)}`, tone: 'warn' },
          { label: 'Kept', value: KEPT[mode], tone: mode === 'deep' ? 'warn' : undefined },
          { label: 'Wake-up', value: WAKE[mode] },
        ]
      },
    }
  },
}

// --- Wake sources: what pulls the chip out of deep sleep, and what the reboot costs. ---

const SOURCES: Record<WakeSource, string> = { timer: 'Timer', ext0: 'ext0', ext1: 'ext1', touch: 'Touch', ulp: 'ULP' }
const BOOTS = { full: 'Full boot', fast: 'Fast boot' }
const WAKE_SLOW = 10
const SLEEP_SHOW = 3
const TIMER_S = 10
const TRIG_SHOW = 0.9
const SETUP_SHOW = 1
const ULP_LUX = 400
const BAR_W = 21
const BAR_X = 0
const BAR_SPAN_S = 0.21
const ARMED: Record<WakeSource, string> = {
  timer: 'RTC timer only',
  ext0: 'RTC IO kept on',
  ext1: 'pins via RTC',
  touch: 'touch pads scanned',
  ulp: 'ULP runs ~1 %',
}
const SOURCE_CODE: Record<WakeSource, string> = {
  timer: `esp_sleep_enable_timer_wakeup(${TIMER_S} * 1000000ULL);`,
  ext0: 'esp_sleep_enable_ext0_wakeup(GPIO_NUM_33, 1);  // one pin, high',
  ext1: 'esp_sleep_enable_ext1_wakeup(BIT64(32) | BIT64(34), ESP_EXT1_WAKEUP_ANY_HIGH);',
  touch: 'touchSleepWakeUpEnable(T0, 40);  // reading < 40 = finger',
  ulp: 'ulp_run(&ulp_entry - RTC_SLOW_MEM); esp_sleep_enable_ulp_wakeup();',
}
const BOOT_COLORS = [GREY, HEAT, CLK_COLOR]

const wakeSetup = (p: Params) => {
  const src = pick(SOURCES, p.src, 'timer')
  const bk = pick(BOOTS, p.boot, 'full')
  const boot = bootPhases(bk === 'fast')
  const sleepA = WAKE_SLEEP_A[src]
  const bootS = phaseTime(boot)
  const bootC = phaseCharge(boot)
  const show: Step[] = [
    { name: 'asleep', s: SLEEP_SHOW, amps: sleepA },
    { name: 'wake', s: TRIG_SHOW, amps: sleepA },
    ...boot.map((b) => ({ ...b, s: b.s * WAKE_SLOW })),
    { name: 'setup()', s: SETUP_SHOW, amps: SENSOR_READ.amps },
  ]
  return { src, bk, boot, sleepA, bootS, bootC, show, sleepMin: bootC / sleepA / 60, even: lightBreakEvenS(bootC) }
}

function pushButton(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [2.4, 2.4, 1], mat('#2b2d33', { rough: 0.6 }), [0, 0, 0])
  const capMat = glowMat(HIGH_V, 0)
  const cap = cylinder(g, 0.8, 0.8, capMat, [0, 0, 0.8], 'z')
  return (down: number, glow: number) => {
    cap.position.z = 0.8 - 0.45 * down
    setGlow(capMat, HIGH_V, glow)
    capMat.color.set(glow > 0.1 ? HIGH_V : '#c33a35')
  }
}

export const wakeSources: Lesson = {
  id: 'power-modes-wake-sources',
  title: 'Wake sources',
  tagline: 'Timer, pin, touch or ULP, then a full reboot',
  formula: (p) => {
    const S = wakeSetup(p)
    return `wake = reset: ${S.boot.map((b) => `${b.name} ${msText(b.s)}`).join(' + ')} = ${msText(S.bootS)} at ~40 mA = ${coulombs(S.bootC)} = ${Math.round(S.sleepMin)} min of sleep at ${ampText(S.sleepA)} · light sleep (0.8 mA, no reboot) is cheaper when waking more often than every ${secs(S.even)} · wake slowed ${WAKE_SLOW}×, sleep sped up`
  },
  legend: [
    { color: POWER, label: 'RTC domain: watches for the wake', shape: 'dot' },
    { color: HIGH_V, label: 'The wake event', shape: 'dot' },
    { color: HEAT, label: 'Bootloader: checks the app image', shape: 'dot' },
    { color: RING, label: 'setup(): your code, RAM fresh', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'In deep sleep only the RTC domain is awake, so only it can wake the chip. Arm one or more sources before esp_deep_sleep_start().',
    `Timer: the RTC timer counts down (here ${TIMER_S} s). The cheapest and most common: log a reading every few minutes.`,
    'ext0: one RTC-capable pin (GPIO 0, 2, 4, 12–15, 25–27, 32–39) at a chosen level. It keeps the RTC peripherals powered, a few µA more. ext1: several RTC pins, wake when any is high (or all are low), and esp_sleep_get_ext1_wakeup_status() says which.',
    'Touch: the touch controller keeps scanning a pad; a finger lowers the reading below the threshold. ULP: a tiny co-processor runs your own program from RTC memory while the main cores sleep, reads a sensor, and wakes them only when the value matters.',
    'Waking from deep sleep is a reboot: ROM loader, the 2nd-stage bootloader checking the app image in flash, start-up, then setup(). SRAM starts blank; only RTC_DATA_ATTR variables (like a boot counter) keep their value.',
    'That boot costs as much charge as many minutes of sleep. Skipping the image check after deep sleep and turning off boot logs (Fast boot) cuts it ~3×; waking every few seconds is cheaper in light sleep.',
  ],
  controls: [
    { kind: 'choice', key: 'src', options: (Object.keys(SOURCES) as WakeSource[]).map((k) => ({ value: k, label: SOURCES[k] })), initial: 'timer' },
    { kind: 'choice', key: 'boot', options: (Object.keys(BOOTS) as (keyof typeof BOOTS)[]).map((k) => ({ value: k, label: BOOTS[k] })), initial: 'full' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const chip = chipView(scene, [10, 2, 0], 0.85)
    const bx = -11
    const parts = {
      ext0: add(scene, new THREE.Group()),
      ext1: add(scene, new THREE.Group()),
      touch: add(scene, new THREE.Group()),
      ulp: add(scene, new THREE.Group()),
    }
    const wires = (g: THREE.Group, ys: [number, number][]) =>
      ys.map(([py, dy]) => {
        const m = glowMat(GREY, 0.2)
        stretchRod(add(g, shadowlessRod(m)), [bx + 1.3, py, 0], chip.edge(dy), 0.09)
        return m
      })
    const ext0Btn = pushButton(parts.ext0, [bx, 4, 0])
    partLetter(parts.ext0, 'GPIO33', [bx, 6, 0.3], 0.42, LABEL)
    const ext0W = wires(parts.ext0, [[4, 2]])
    const ext1Btns = [pushButton(parts.ext1, [bx, 5, 0]), pushButton(parts.ext1, [bx, -1, 0])]
    partLetter(parts.ext1, 'GPIO32', [bx, 7, 0.3], 0.42, LABEL)
    partLetter(parts.ext1, 'GPIO34', [bx, -3, 0.3], 0.42, LABEL)
    const ext1W = wires(parts.ext1, [[5, 2.6], [-1, 1.4]])
    const padMat = glowMat('#c8803f', 0)
    box(parts.touch, [3, 3, 0.3], padMat, [bx, 2, 0])
    partLetter(parts.touch, 'touch pad T0', [bx, -0.2, 0.3], 0.42, LABEL)
    const finger = add(parts.touch, mesh(new THREE.CapsuleGeometry(0.75, 3, 6, 12), mat('#e0b49a', { rough: 0.7 })), [bx, 6, 2])
    finger.rotation.x = 0.6
    const touchW = wires(parts.touch, [[2, 2]])
    const sensor = i2cBreakout(parts.ulp, [bx, 1.5, 0], { name: 'light', k: 0.4 })
    const ulpW = wires(parts.ulp, [[1.5, 2]])
    const trigLabel = liveLabel(scene, [bx, -4.6, 0.3], { size: 0.45 })
    const phaseLabel = liveLabel(scene, [bx, -6.6, 0.3], { size: 0.55 })
    const meter = ampMeter(scene, [-22, -10, 0], 8, 'current')
    const bar = add(scene, new THREE.Group(), [BAR_X, -10, 0])
    const head = add(scene, shadowlessRod(glowMat(LABEL, 1)))
    const code = codeBlock(scene, [-29.5, 10, 0], 0.34, 4)
    const s = { key: '', t: 0, boots: 1, counted: false }
    return {
      scene,
      view: { center: [-4, -0.5, 0], radius: 92, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = wakeSetup(p)
        const key = `${S.src}|${S.bk}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0, boots: 1, counted: true })
          emptyGroup(bar)
          const segs = [...S.boot, SENSOR_READ]
          let x = 0
          segs.forEach((b, i) => {
            const w = (b.s / BAR_SPAN_S) * BAR_W
            box(bar, [Math.max(0.05, w - 0.08), 0.9, 0.4], glowMat(i < 3 ? BOOT_COLORS[i] : RING, 0.6), [x + w / 2, 0, 0])
            partLetter(bar, i < 3 ? b.name : 'setup', [x + w / 2, 1.1 + (w < 3 ? (i % 2) * 0.8 : 0), 0], 0.36, LABEL)
            partLetter(bar, msText(b.s), [x + w / 2, -1.2 - (w < 3 ? (i % 2) * 0.7 : 0), 0], 0.34, GREY)
            x += w
          })
        }
        s.t += dt
        const { i, into } = stepAt(S.show, s.t)
        const ph = S.show[i]
        const asleep = i <= 1
        const trig = i === 1 ? into / TRIG_SHOW : 0
        if (i === S.show.length - 1 && !s.counted) Object.assign(s, { boots: s.boots + 1, counted: true })
        if (i === 0) s.counted = false
        const dm: Record<Domain, DomainState> = asleep
          ? { ...POWER_MODES.deep.domains, ulp: S.src === 'ulp' ? 'on' : 'off' }
          : { cpu: 'on', radio: 'off', ram: 'on', periph: i >= 4 ? 'on' : 'off', rtc: 'on', rtcMem: 'on', ulp: 'off' }
        chip.set(dm, s.t, dt, { rtcMem: s.boots, ...(asleep ? {} : { ram: i === S.show.length - 1 ? 1 : 0 }) })
        setGlow(chip.antMat, DATA_COLOR, 0)
        meter(ph.amps)
        const sleepU = i === 0 ? into / SLEEP_SHOW : 1
        Object.entries(parts).forEach(([k, g]) => presence(g, k === S.src ? 1 : 0))
        const hot = trig > 0 ? 1 : 0
        const ulpLux = Math.round(120 + (ULP_LUX + 60 - 120) * (i === 0 ? sleepU : i === 1 ? 1 : 0))
        ext0Btn(S.src === 'ext0' ? Math.min(1, trig * 3) : 0, S.src === 'ext0' ? hot : 0)
        ext1Btns.forEach((b, k) => b(k === 1 ? Math.min(1, trig * 3) : 0, k === 1 ? hot : 0))
        ext0W.forEach((m) => setGlow(m, hot ? HIGH_V : GREY, hot ? 1 : 0.2))
        ext1W.forEach((m, k) => setGlow(m, k === 1 && hot ? HIGH_V : GREY, k === 1 && hot ? 1 : 0.2))
        touchW.forEach((m) => setGlow(m, hot ? HIGH_V : GREY, hot ? 1 : 0.2))
        ulpW.forEach((m) => setGlow(m, asleep && Math.floor(s.t * 3) % 2 === 0 ? POWER : GREY, 0.5))
        finger.position.set(bx, 6 - 3 * Math.min(1, trig * 2.5), 2 - 1.2 * Math.min(1, trig * 2.5))
        setGlow(padMat, HIGH_V, hot * 0.8)
        sensor.chip(POWER, S.src === 'ulp' && asleep && Math.floor(s.t * 3) % 2 === 0 ? 0.8 : 0)
        sensor.led(0)
        const touchRaw = Math.round(62 - 31 * Math.min(1, trig * 2.5))
        trigLabel.set(
          S.src === 'timer'
            ? ''
            : S.src === 'ulp'
              ? `light ${ulpLux} lx${ulpLux > ULP_LUX ? ` > ${ULP_LUX}: wake!` : ''}`
              : S.src === 'touch'
                ? `reading ${touchRaw}${touchRaw < 40 ? ' < 40: touched' : ''}`
                : hot
                  ? 'pressed: pin HIGH'
                  : 'waiting',
          hot || ulpLux > ULP_LUX ? HIGH_V : GREY,
        )
        chip.value('rtc', S.src === 'timer' ? (asleep ? `wake in ${(TIMER_S * (1 - sleepU)).toFixed(1)} s` : 'fired') : S.src === 'touch' ? 'touch scan' : S.src === 'ulp' ? '' : 'watching pin', asleep ? POWER : GREY)
        chip.value('rtcMem', `boots = ${s.boots}`, POWER)
        chip.value('ram', asleep ? 'off' : i === S.show.length - 1 ? 'int plain = 1' : 'blank', asleep ? GREY : LABEL)
        chip.value('ulp', S.src === 'ulp' ? (asleep ? `reads every 1 s` : 'stopped') : '', POWER)
        chip.value('cpu', asleep ? 'off' : ph.name, asleep ? GREY : LABEL)
        chip.value('radio', '', GREY)
        const shown = i === S.show.length - 1 ? S.bootS + (SENSOR_READ.s * into) / SETUP_SHOW : asleep ? 0 : phaseTime(S.boot.slice(0, i - 2)) + into / WAKE_SLOW
        head.visible = !asleep
        stretchRod(head, [BAR_X + (shown / BAR_SPAN_S) * BAR_W, -10.8, 0.4], [BAR_X + (shown / BAR_SPAN_S) * BAR_W, -9.2, 0.4], 0.09)
        phaseLabel.set(asleep ? (i === 0 ? `deep sleep · ${ampText(S.sleepA)}` : 'wake event!') : i === S.show.length - 1 ? `setup() · boot #${s.boots}` : `${ph.name} · ${msText(ph.s / WAKE_SLOW)}`, asleep ? (i === 0 ? POWER : HIGH_V) : LABEL)
        code(['RTC_DATA_ATTR int boots = 0;  // RTC memory: kept', 'int plain = 0;  // SRAM: blank after every wake', SOURCE_CODE[S.src], 'boots++; esp_deep_sleep_start();  // never returns'])
      },
      readouts: (p) => {
        const S = wakeSetup(p)
        return [
          { label: 'Asleep', value: `${ampText(S.sleepA)} · ${ARMED[S.src]}`, tone: S.sleepA < 5e-5 ? 'ok' : 'warn' },
          { label: 'Each wake', value: `${msText(S.bootS)} · ${coulombs(S.bootC)}` },
          { label: 'Equals', value: `${Math.round(S.sleepMin)} min of sleep`, tone: S.sleepMin > 30 ? 'warn' : undefined },
          { label: 'Light sleep wins', value: `waking < every ${secs(S.even)}` },
        ]
      },
    }
  },
}

// --- Battery budget: a sensor node waking, reading, sending and sleeping, year after year. ---

const EVERY = { '10': 10, '60': 60, '600': 600, '3600': 3600 }
const EVERY_TEXT: Record<keyof typeof EVERY, string> = { '10': '10 s', '60': '1 min', '600': '10 min', '3600': '1 h' }
const RADIOS: Record<NodeRadio, string> = { wifi: 'Wi-Fi + DHCP', static: 'Static IP', espnow: 'ESP-NOW' }
const CELLS: Record<CellId, string> = { cr2032: 'CR2032', aa2: '2 × AA', li18650: '18650' }
const LIFE_SHOW = 12
const LIFE_HOLD = 2
const CYCLE_SHOW = 5
const AWAKE_U = 0.45
const PLOT_W = 22
const PLOT_H = 9
const phaseColor = (ph: Step) => (ph.name === 'deep sleep' ? POWER : ph.name === SENSOR_READ.name ? RING : ph.amps >= 0.1 ? DATA_COLOR : CLK_COLOR)
const RADIO_CODE: Record<NodeRadio, string> = {
  wifi: 'WiFi.begin(ssid, pass);  // scan, join, DHCP: ~1.6 s',
  static: 'WiFi.config(ip, gw, mask); WiFi.begin(ssid, pass, ch, bssid);',
  espnow: 'esp_now_send(gateway, (uint8_t *)&reading, sizeof reading);',
}

const budgetSetup = (p: Params) => {
  const ek = pick(EVERY, p.every, '600')
  const radio = pick(RADIOS, p.radio, 'wifi')
  const cell = pick(CELLS, p.cell, 'li18650')
  const every = EVERY[ek]
  const ps = nodeCycle(every, radio)
  const awake = ps.slice(0, -1)
  const sleep = ps[ps.length - 1]
  const avg = averageAmps(ps)
  const years = lifeYears(cell, avg)
  const C = NODE_CELLS[cell]
  const shares = [awake.slice(0, 3), [SENSOR_READ], [awake[awake.length - 1]], [sleep]].map((g) => ({ color: phaseColor(g[0]), c: phaseCharge(g) }))
  const total = phaseCharge(ps)
  return { ek, radio, cell, every, ps, awake, sleep, avg, years, C, shares, total, awakeS: phaseTime(awake), awakeC: phaseCharge(awake), peakOk: C.maxA >= NODE_PEAK_A }
}
type Budget = ReturnType<typeof budgetSetup>
const tOfU = (B: Budget, u: number) => (u < AWAKE_U ? (u / AWAKE_U) * B.awakeS : B.awakeS + ((u - AWAKE_U) / (1 - AWAKE_U)) * B.sleep.s)
const ampsAtU = (B: Budget, u: number) => B.ps[stepAt(B.ps, Math.min(tOfU(B, u), B.every - 1e-9)).i].amps
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : `${Math.round(n)}`)

export const batteryBudget: Lesson = {
  id: 'power-modes-battery-budget',
  title: 'Battery budget',
  tagline: 'Average current decides the years',
  formula: (p) => {
    const B = budgetSetup(p)
    return `avg I = Σ I·t / T = (${coulombs(B.awakeC)} awake + ${ampText(NODE_SLEEP_A)} × ${secs(B.sleep.s)}) / ${secs(B.every)} = ${ampText(B.avg)} · life = ${B.C.mAh} mAh / (avg + ${pct(B.C.selfPerYear)}/yr self-discharge) = ${spanText(B.years * YEAR_H)} · whole life time-lapsed into ${LIFE_SHOW} s`
  },
  legend: [
    { color: CLK_COLOR, label: 'Boot after deep sleep', shape: 'dot' },
    { color: RING, label: 'Read the sensor', shape: 'dot' },
    { color: DATA_COLOR, label: 'Radio: join and send', shape: 'dot' },
    { color: POWER, label: 'Deep sleep: chip + LDO + sensor', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A weather or soil sensor node spends almost all its life asleep: wake, boot, read a BME280, send the reading, deep sleep again. Unlike the robot car in Power budget → Runtime estimate, the average current here is tiny and set by how often and how long it wakes.',
    'Average current = total charge per cycle ÷ cycle time. The plot shows one cycle on a log scale: the awake part (left) is stretched, the long sleep (right) squeezed.',
    'Wi-Fi is the budget killer: scanning, joining and getting an IP by DHCP keeps the radio at ~120 mA for over a second. A static IP with the saved channel and BSSID cuts it ~5×; ESP-NOW sends one frame in a few ms with no join at all.',
    'Wake less often and the sleep floor (15 µA for a bare module with a low-Iq LDO) takes over; a DevKit’s 8 mA would drain any battery in weeks.',
    'Cells lose charge by themselves: Li-ion ~2 % a month, so even a sleeping node can’t get past ~4 years on an 18650; alkaline AAs keep 97 % a year.',
    'A CR2032 coin cell holds 220 mAh but can only give ~15 mA before its voltage collapses. The ESP32 radio needs 350 mA peaks, so it browns out: coin-cell sensors use BLE chips (nRF52) that peak at ~10 mA.',
  ],
  controls: [
    { kind: 'choice', key: 'every', options: (Object.keys(EVERY) as (keyof typeof EVERY)[]).map((k) => ({ value: k, label: EVERY_TEXT[k] })), initial: '600' },
    { kind: 'choice', key: 'radio', options: (Object.keys(RADIOS) as NodeRadio[]).map((k) => ({ value: k, label: RADIOS[k] })), initial: 'wifi' },
    { kind: 'choice', key: 'cell', options: (Object.keys(CELLS) as CellId[]).map((k) => ({ value: k, label: CELLS[k] })), initial: 'li18650' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const nx = -20
    const k = 0.45
    esp32Board(scene, [nx, 2, 0], k)
    const antenna: V3 = [nx - 7.4 * k, 2, 3.5 * k]
    const rip = ripples(scene, antenna, { reach: 2.2 })
    const sensor = i2cBreakout(scene, [nx + 8.8, 2.5, 0], { name: 'BME280', k: 0.3 })
    wire(scene, [sensor.pin('VCC'), [nx + 7.6, 6, 1.5], [nx + 4, 6, 1.5]], 0.12)
    wire(scene, [sensor.pin('SDA'), [nx + 10, 6.6, 1.5], [nx + 4.5, 6.6, 1.5]], 0.12)
    partLetter(scene, 'sensor node', [nx + 3, -1.4, 0], 0.45, LABEL)
    const cells = {
      cr2032: add(scene, new THREE.Group(), [nx, -4.2, 0]),
      aa2: add(scene, new THREE.Group(), [nx, -4.2, 0]),
      li18650: add(scene, new THREE.Group(), [nx, -4.2, 0]),
    }
    cylinder(cells.cr2032, 1.6, 0.5, mat('#c9ccd1', { metal: 0.45, rough: 0.3 }), [0, 0, 0.3], 'z', 32)
    partLetter(cells.cr2032, 'CR2032', [0, 0, 0.7], 0.4, '#3a3f4a')
    for (const y of [-0.6, 0.6]) {
      cylinder(cells.aa2, 0.55, 4.4, mat('#4a4f5a', { rough: 0.5 }), [0, y, 0.6], 'x', 24)
      cylinder(cells.aa2, 0.56, 1.1, mat('#d7a83a', { rough: 0.4 }), [1.7, y, 0.6], 'x', 24)
    }
    cell18650(cells.li18650, [0, 0, 0.8], 0.8).rotation.z = Math.PI / 2
    const gauge = meterBar(scene, [nx - 2.5, -7.6, 0], 7, 1, [], 'battery')
    const wakes = liveLabel(scene, [nx + 1, -9.4, 0], { size: 0.4 })
    const plotAt: V3 = [6, 2.5, 0]
    const plot = scope(scene, PLOT_W, PLOT_H, { divs: [10, 6], zeroAt: 0 })
    plot.group.position.set(...plotAt)
    const trace = plot.trace(LABEL, { samples: 200, radius: 0.09 })
    const avgLine = plot.level(POWER)
    for (const [d, t] of [[1, '10 µA'], [3, '1 mA'], [5, '100 mA']] as [number, string][]) partLetter(scene, t, [plotAt[0] + PLOT_W / 2 + 0.8, plotAt[1] - PLOT_H / 2 + (d / 6) * PLOT_H, 0], 0.4, GREY, 'left')
    const brk = glowMat(GREY, 0.5)
    stretchRod(add(scene, shadowlessRod(brk)), [plotAt[0] - PLOT_W / 2 + AWAKE_U * PLOT_W, plotAt[1] - PLOT_H / 2, 0.2], [plotAt[0] - PLOT_W / 2 + AWAKE_U * PLOT_W, plotAt[1] + PLOT_H / 2, 0.2], 0.05)
    const awakeTag = liveLabel(scene, [plotAt[0] - PLOT_W / 2 + (AWAKE_U / 2) * PLOT_W, plotAt[1] + PLOT_H / 2 + 0.9, 0], { size: 0.42 })
    const sleepTag = liveLabel(scene, [plotAt[0] - PLOT_W / 2 + ((1 + AWAKE_U) / 2) * PLOT_W, plotAt[1] + PLOT_H / 2 + 0.9, 0], { size: 0.42 })
    const avgTag = liveLabel(scene, [plotAt[0] + PLOT_W / 2 - 0.3, 0, 0.4], { size: 0.4, align: 'right' })
    const strip = add(scene, new THREE.Group(), [plotAt[0] - PLOT_W / 2, plotAt[1] - PLOT_H / 2 - 0.6, 0])
    const shareBar = add(scene, new THREE.Group(), [plotAt[0] - PLOT_W / 2, -5.4, 0])
    partLetter(scene, 'charge per cycle', [plotAt[0] - PLOT_W / 2 - 0.6, -5.4, 0], 0.42, LABEL, 'right')
    const code = codeBlock(scene, [-29, -11.3, 0], 0.34, 4)
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-4, -1.5, 0], radius: 88, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const B = budgetSetup(p)
        const key = `${B.ek}|${B.radio}|${B.cell}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0 })
          emptyGroup(strip)
          emptyGroup(shareBar)
          let t0 = 0
          B.ps.forEach((ph) => {
            const u0 = t0 < B.awakeS ? (t0 / B.awakeS) * AWAKE_U : AWAKE_U
            const u1 = ph.name === 'deep sleep' ? 1 : ((t0 + ph.s) / B.awakeS) * AWAKE_U
            t0 += ph.s
            box(strip, [Math.max(0.04, (u1 - u0) * PLOT_W - 0.04), 0.35, 0.3], glowMat(phaseColor(ph), 0.8), [((u0 + u1) / 2) * PLOT_W, 0, 0])
          })
          let x = 0
          B.shares.forEach((sh) => {
            const w = (sh.c / B.total) * PLOT_W
            if (w > 0.01) box(shareBar, [Math.max(0.04, w - 0.06), 1, 0.4], glowMat(sh.color, 0.7), [x + w / 2, 0, 0])
            if (sh.c / B.total > 0.07) partLetter(shareBar, pct(sh.c / B.total), [x + w / 2, -1.2, 0], 0.4, sh.color)
            x += w
          })
          Object.entries(cells).forEach(([c, g]) => presence(g, c === B.cell ? 1 : 0))
        }
        s.t += dt
        const u = (s.t % CYCLE_SHOW) / CYCLE_SHOW
        trace.draw((v) => -PLOT_H / 2 + logU(ampsAtU(B, v)) * PLOT_H, u)
        const ay = -PLOT_H / 2 + logU(B.avg) * PLOT_H
        avgLine.set(ay)
        avgTag.group.position.y = plotAt[1] + ay + 0.6
        avgTag.set(`average ${ampText(B.avg)}`, POWER)
        awakeTag.set(`awake ${secs(B.awakeS)}`, LABEL)
        sleepTag.set(`asleep ${secs(B.sleep.s)}`, POWER)
        const ph = B.ps[stepAt(B.ps, Math.min(tOfU(B, u), B.every - 1e-9)).i]
        const radio = ph === B.awake[B.awake.length - 1]
        rip(s.t, DATA_COLOR, radio ? 0.9 : 0)
        sensor.chip(RING, ph === SENSOR_READ ? 1 : 0)
        sensor.led(ph.name === 'deep sleep' ? 0 : 0.6)
        const lt = s.t % (LIFE_SHOW + LIFE_HOLD)
        const f = Math.min(1, lt / LIFE_SHOW)
        const left = 1 - f
        const hours = f * B.years * YEAR_H
        gauge(left, `${spanText(hours)} · ${pct(left)}`, left > 0.3 ? POWER : left > 0.1 ? RING : HIGH_V)
        wakes.set(`${compact((hours * 3600) / B.every)} wakes so far`, GREY)
        code([
          'RTC_DATA_ATTR uint32_t seq;  // survives the sleeps',
          RADIO_CODE[B.radio],
          'seq++;  // reading + seq sent, then:',
          `esp_deep_sleep(${B.every}ULL * 1000000);  // wake = reboot`,
        ])
      },
      readouts: (p) => {
        const B = budgetSetup(p)
        const sleepShare = phaseCharge([B.sleep]) / B.total
        return [
          { label: 'Awake per wake', value: `${secs(B.awakeS)} · ${coulombs(B.awakeC)}` },
          { label: 'Average', value: `${ampText(B.avg)} · ${pct(sleepShare)} spent asleep` },
          { label: 'Battery life', value: spanText(B.years * YEAR_H), tone: B.years > 2 ? 'ok' : B.years > 0.5 ? 'warn' : 'bad' },
          { label: 'Radio peak', value: B.peakOk ? `${ampText(NODE_PEAK_A)}: fine` : `${ampText(NODE_PEAK_A)} > ${ampText(B.C.maxA)}: browns out`, tone: B.peakOk ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
