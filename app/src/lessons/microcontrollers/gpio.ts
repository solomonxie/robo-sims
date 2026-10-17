import * as THREE from 'three/webgpu'
import {
  DRIVE_CAPS,
  GPIO_VDD,
  INTERNAL_PULL_OHMS,
  LEDS,
  PIN_MAX_A,
  PIN_SAFE_A,
  PinLoad,
  PinMode,
  SCHMITT_HI,
  SCHMITT_LO,
  TT_MOTOR,
  buttonDown,
  drivenPin,
  floatingPickup,
  logicLevel,
  motorRpm,
  nextLoopRead,
  noisySensor,
  padSwitches,
  pollMissChance,
  pollSees,
  press,
  pullPad,
  pullRiseTime,
} from '../../core/physics'
import { amps, mAText, ohms, pct, secs, si, volts, watts } from '../../core/units'
import { GOLD, V3, add, box, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  arrow,
  codeBlock,
  esp32Board,
  fetSymbol,
  glide,
  glowBox,
  glowMat,
  groundAt,
  icPackage,
  junction,
  ledLoad,
  liveLabel,
  meterBar,
  motorCan,
  partLetter,
  potentialColor,
  presence,
  pushButton,
  resistorAlong,
  segmentDisplay,
  signalWire,
  timingDiagram,
  wire,
  rand01,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const VDD = GPIO_VDD
const WIRES = { color: HIGH_V, label: 'Wire colour: blue 0 V → red 3.3 V', shape: 'dot' } as const
const fixed = (v: number) => v.toFixed(2)

/** Translucent cutaway of the chip, x0…x1 × y0…y1, with the gold pad on its right edge at `pad`. */
function chipCutaway(parent: THREE.Object3D, [x0, x1]: [number, number], [y0, y1]: [number, number], pad: V3) {
  glowBox(parent, [x1 - x0, y1 - y0, 0.3], [(x0 + x1) / 2, (y0 + y1) / 2, -1.4], '#4a5060', 0.16)
  const edge = mat('#5c6270', { rough: 0.6 })
  const c: V3[] = [[x0, y0, -1.2], [x1, y0, -1.2], [x1, y1, -1.2], [x0, y1, -1.2]]
  c.forEach((p, k) => rod(parent, p, c[(k + 1) % 4], 0.08, edge))
  box(parent, [1.4, 1.4, 1], GOLD(), [pad[0], pad[1], 0])
  partLetter(parent, 'PAD', [pad[0], pad[1] + 1.5, 0], 0.7, RING)
  partLetter(parent, 'inside the ESP32 pin', [x0 + 0.6, y0 - 1, 0], 0.7, GREY, 'left')
}

/** Buffer triangle at `at` pointing along `angle`, tinted by the level it outputs. */
function bufferSymbol(parent: THREE.Object3D, at: V3, angle: number, size = 2.4) {
  const s = new THREE.Shape()
  s.moveTo(-size / 2, size / 2)
  s.lineTo(size / 2, 0)
  s.lineTo(-size / 2, -size / 2)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false })
  geo.translate(0, 0, -0.25)
  const m = new THREE.MeshStandardMaterial({ color: '#2a2d34', emissive: LOW_V, emissiveIntensity: 0.4, roughness: 0.5 })
  add(parent, mesh(geo, m), at).rotation.z = angle
  const c = new THREE.Color()
  const tip: V3 = [at[0] + (Math.cos(angle) * size) / 2, at[1] + (Math.sin(angle) * size) / 2, 0]
  return { tip, set: (level: number) => m.emissive.copy(potentialColor(level, c)) }
}

/** A one-digit register with a caption above it. */
function register(parent: THREE.Object3D, at: V3, caption: string) {
  box(parent, [2.4, 2.4, 0.8], mat('#1c1e24', { rough: 0.6 }), [at[0], at[1], -0.2])
  const d = segmentDisplay(1, 1.4, RING, true)
  add(parent, d.group, [at[0], at[1], 0.3])
  partLetter(parent, caption, [at[0], at[1] + 2, 0], 0.7, LABEL)
  return d
}

// --- Output and input modes: inside the pad, a push-pull MOSFET pair drives it; an input buffer with hysteresis reads it. ---

type IoMode = 'output' | 'input'
const OUT_CODE = { '1': 'HIGH', '0': 'LOW', blink: 'HIGH / LOW' } as const
const MD = { x: [-17, 6] as [number, number], y: [-6.2, 9.6] as [number, number], vdd: 8.6, node: 3.4, gnd: -1.6, pad: 6, tap: 3, inY: -4, reg: -11.5, ext: 9.6 }

export const outputAndInputModes: Lesson = {
  id: 'gpio-output-and-input-modes',
  title: 'Output and input modes',
  tagline: 'Two transistors to drive, a buffer to listen',
  formula: (p) =>
    p.mode === 'output'
      ? 'OUTPUT: bit 1 → P-FET on, pad tied to 3.3 V · bit 0 → N-FET on, pad tied to 0 V · never both'
      : `INPUT: both FETs off (high impedance, ~50 nA) · Schmitt reads 1 above ${fixed(SCHMITT_HI * VDD)} V, 0 below ${fixed(SCHMITT_LO * VDD)} V, else keeps its last read`,
  legend: [
    { color: POWER, label: 'Lit channel = transistor on', shape: 'dot' },
    WIRES,
    CODE_LEGEND,
  ],
  points: [
    'Behind every GPIO pad sit two MOSFETs in a totem pole: a P-channel to 3.3 V and an N-channel to ground. That is push-pull output, the same pair as a CMOS inverter.',
    'digitalWrite(pin, HIGH) turns the P-FET on and the N-FET off, so the pad is tied to 3.3 V; LOW does the opposite. The logic always keeps one of them off, otherwise the pair would short the supply.',
    'pinMode(pin, INPUT) switches both off. The driver is now high impedance: the pad only leaks ~50 nA, and whatever outside drives it sets its voltage.',
    'The pad also feeds an input buffer, in both modes; digitalRead returns what it last saw. Its Schmitt trigger has two thresholds, so a slow, noisy signal flips it once, while a single-threshold buffer (PLAIN on the scope) chatters at every crossing.',
    'In ESP-IDF the same calls are gpio_set_direction, gpio_set_level and gpio_get_level.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'output', label: 'OUTPUT' },
        { value: 'input', label: 'INPUT' },
      ],
      initial: 'output',
    },
    {
      kind: 'choice',
      key: 'out',
      options: [
        { value: '1', label: 'Write 1' },
        { value: '0', label: 'Write 0' },
        { value: 'blink', label: 'Blink' },
      ],
      initial: 'blink',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    chipCutaway(scene, MD.x, MD.y, [MD.pad, MD.node, 0])
    const pf = fetSymbol(scene, [0, MD.vdd, 0], [0, MD.node, 0], 'P')
    const nf = fetSymbol(scene, [0, MD.node, 0], [0, MD.gnd, 0], 'N')
    signalWire(scene, [[-4, MD.vdd, 0], [0, MD.vdd, 0]])(1)
    partLetter(scene, '3V3', [-4.6, MD.vdd, 0], 0.7, HIGH_V, 'right')
    groundAt(scene, [0, MD.gnd, 0])
    const outReg = register(scene, [MD.reg, MD.node, 0], 'OUT')
    const pGate = signalWire(scene, [[MD.reg + 1.2, MD.node + 0.6, 0], [-5, MD.node + 0.6, 0], [-5, pf.gate[1], 0], pf.gate])
    const nGate = signalWire(scene, [[MD.reg + 1.2, MD.node - 0.6, 0], [-5.6, MD.node - 0.6, 0], [-5.6, nf.gate[1], 0], nf.gate])
    const node = signalWire(scene, [[0, MD.node, 0], [MD.pad, MD.node, 0]])
    const dots = [junction(scene, [0, MD.node, 0], 0.4), junction(scene, [MD.tap, MD.node, 0], 0.4)]
    const buf = bufferSymbol(scene, [-2.4, MD.inY, 0], Math.PI)
    const tap = signalWire(scene, [[MD.tap, MD.node, 0], [MD.tap, MD.inY, 0], [-1.2, MD.inY, 0]])
    const inWire = signalWire(scene, [buf.tip, [MD.reg + 1.2, MD.inY, 0]])
    partLetter(scene, 'Schmitt', [-2.4, MD.inY - 1.9, 0], 0.6, GREY)
    const inReg = register(scene, [MD.reg, MD.inY, 0], 'IN')
    const ext = signalWire(scene, [[MD.pad, MD.node, 0], [MD.ext, MD.node, 0]])
    const led = ledLoad(scene, [13.4, MD.node, 0], 13.4 - MD.ext, 220)
    partLetter(led.g, 'LED', [2.2, 1.6, 0], 0.7, LABEL)
    const sensor = add(scene, new THREE.Group(), [13.2, MD.node, 0])
    wire(sensor, [[MD.ext - 13.2, 0, 0], [-1.6, 0, 0]], 0.2)
    add(sensor, icPackage(3, 4, 2), [0, 0, 0]).castShadow = true
    partLetter(sensor, 'sensor', [0, -3, 0], 0.7, LABEL)
    const code = codeBlock(scene, [MD.x[0], -9.2, 0])
    const scope = timingDiagram(scene, [1.5, -17.4, 0], [
      { label: 'PAD', color: PIN_COLOR },
      { label: 'HYST', color: RING },
      { label: 'PLAIN', color: GREY },
    ], { width: 32, rowH: 2.2, samples: 240 })
    const s = { t: 0, v: 0, sch: false, out: 1, pres: 1, p: 0, n: 0 }
    return {
      scene,
      view: { center: [-1, -2.8, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const mode: IoMode = p.mode === 'input' ? 'input' : 'output'
        s.t += dt
        const bit = p.out === 'blink' ? (s.t % 2 < 1 ? 1 : 0) : p.out === '0' ? 0 : 1
        const sw = padSwitches(mode, bit)
        s.v = mode === 'output' ? glide(dt, s.v, bit * VDD, 20) : noisySensor(s.t)
        s.sch = s.v >= SCHMITT_HI * VDD ? true : s.v <= SCHMITT_LO * VDD ? false : s.sch
        const plain = s.v >= VDD / 2
        s.pres = glide(dt, s.pres, mode === 'output' ? 1 : 0, 8)
        presence(led.g, s.pres)
        presence(sensor, 1 - s.pres)
        s.p = glide(dt, s.p, +sw.p, 16)
        s.n = glide(dt, s.n, +sw.n, 16)
        pf.set(s.p)
        nf.set(s.n)
        pGate(sw.p ? 0 : 1)
        nGate(+sw.n)
        outReg.set(mode === 'output' ? String(bit) : '-')
        inReg.set(s.sch ? '1' : '0')
        const lv = s.v / VDD
        for (const w of [node, tap, ext]) w(lv)
        for (const d of dots) d.set(lv)
        buf.set(+s.sch)
        inWire(+s.sch)
        led.lamp.set(mode === 'output' ? lv : 0)
        led.lamp.step(dt)
        const w = OUT_CODE[pick(OUT_CODE, p.out, 'blink')]
        code(
          mode === 'output'
            ? ['pinMode(2, OUTPUT);', `digitalWrite(2, ${p.out === 'blink' ? (bit ? 'HIGH' : 'LOW') : w});`, `gpio_set_level(GPIO_NUM_2, ${bit});`]
            : ['pinMode(4, INPUT);', `int v = digitalRead(4);  // ${+s.sch}`, 'gpio_get_level(GPIO_NUM_4);'],
        )
        scope.frame(dt, [lv, +s.sch, +plain])
      },
      readouts: (p) => {
        const out = p.mode !== 'input'
        return [
          { label: 'Driver', value: out ? 'push-pull' : 'off (Hi-Z)' },
          { label: 'Pad', value: out ? (p.out === 'blink' ? '0 ↔ 3.3 V' : p.out === '0' ? '0 V' : '3.3 V') : volts(s.v) },
          { label: 'Reads', value: String(+s.sch), tone: 'ok' },
        ]
      },
    }
  },
}

// --- Pull-ups: the pin's own ~45 kΩ pull resistors, switched on by INPUT_PULLUP / PULLDOWN, and open-drain lines. ---

const PULL_MODES = { input: 'INPUT', pullup: 'INPUT_PULLUP', pulldown: 'INPUT_PULLDOWN', opendrain: 'OPEN_DRAIN' } as const
type PullMode = keyof typeof PULL_MODES
const PU = { x: [-16, 6] as [number, number], y: [-6.6, 10.2] as [number, number], vdd: 9.4, bus: 2, col: -6, od: 0.8, pad: 6, tap: 3.6, btn: 10.4 }
const BUS_PF = 100e-12
const PU_PERIOD = 3
/** Button held over [1.4, 2.4) s of each period; in open-drain mode our own pin pulls low over [0.3, 0.9). */
const btnHeld = (t: number) => t % PU_PERIOD >= 1.4 && t % PU_PERIOD < 2.4
const odBit = (t: number): 0 | 1 => (t % PU_PERIOD >= 0.3 && t % PU_PERIOD < 0.9 ? 0 : 1)
const PULL_CODE: Record<PullMode, string[]> = {
  input: ['pinMode(0, INPUT);', 'gpio_set_pull_mode(GPIO_NUM_0,', '  GPIO_FLOATING);'],
  pullup: ['pinMode(0, INPUT_PULLUP);', 'gpio_pullup_en(GPIO_NUM_0);'],
  pulldown: ['pinMode(0, INPUT_PULLDOWN);', 'gpio_pulldown_en(GPIO_NUM_0);'],
  opendrain: ['pinMode(21, OUTPUT_OPEN_DRAIN);', 'gpio_set_direction(GPIO_NUM_21,', '  GPIO_MODE_INPUT_OUTPUT_OD);'],
}

export const pullUps: Lesson = {
  id: 'gpio-pull-ups',
  title: 'Pull-ups',
  tagline: 'The resistors already inside the pin',
  formula: (p) => {
    const m = pick(PULL_MODES, p.mode, 'pullup')
    if (m === 'input') return 'INPUT: no pull · released, nothing drives the pad and it reads noise · pressed: 0 V'
    if (m === 'opendrain')
      return `Line = 0 if anyone pulls it low, else 45 kΩ lifts it · 0 → VIH on ${si(BUS_PF, 'F')}: 45 kΩ × 100 pF × ln 4 = ${secs(pullRiseTime(INTERNAL_PULL_OHMS, BUS_PF))} (4.7 kΩ: ${secs(pullRiseTime(4.7e3, BUS_PF))})`
    const r = pullPad(m, false)
    return `Released: ${volts(r.volts ?? 0)} through ~45 kΩ · Pressed: I = 3.3 V / 45 kΩ = ${amps(VDD / INTERNAL_PULL_OHMS)}`
  },
  legend: [
    { color: POWER, label: 'Lit switch = pull or FET enabled', shape: 'dot' },
    WIRES,
    CODE_LEGEND,
  ],
  points: [
    'An input with nothing driving it floats: it picks up hum from your hand and reads random bits. A pull resistor gives it a default.',
    'You often do not need to add one. Each ESP32 pad has a ~45 kΩ pull-up and pull-down built in, each behind a little switch: INPUT_PULLUP closes the top one, INPUT_PULLDOWN the bottom one. A button then only needs a wire to the other rail.',
    'Internal pulls are weak on purpose: pressed, a pull-up wastes just 3.3 V / 45 kΩ = 73 µA. The price is speed and noise immunity, so long wires or fast buses still want a stronger external resistor. (GPIO 34–39 have no internal pulls at all.)',
    'Open-drain mode keeps only the N-FET. Writing 0 pulls the line low; writing 1 just lets go, and the pull-up brings it high. Any chip on the line can pull it low without a fight: that is how I²C and shared interrupt lines work.',
    'The catch is the rising edge: the pull-up has to charge the wire’s capacitance. 45 kΩ into 100 pF takes about 6 µs to reach a valid HIGH, too slow for 400 kHz I²C, which is why I²C boards carry 4.7 kΩ pull-ups.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'mode',
      options: Object.entries(PULL_MODES).map(([value, label]) => ({ value, label: label.replace('INPUT_', '').replace('OPEN_DRAIN', 'OPEN-DRAIN') })),
      initial: 'pullup',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    chipCutaway(scene, PU.x, PU.y, [PU.pad, PU.bus, 0])
    signalWire(scene, [[PU.col - 4, PU.vdd, 0], [PU.col, PU.vdd, 0]])(1)
    partLetter(scene, '3V3', [PU.col - 4.6, PU.vdd, 0], 0.7, HIGH_V, 'right')
    const up = fetSymbol(scene, [PU.col, PU.vdd, 0], [PU.col, 6.6, 0], 'N', 'PU')
    const down = fetSymbol(scene, [PU.col, -2.6, 0], [PU.col, -5.4, 0], 'N', 'PD')
    groundAt(scene, [PU.col, -5.4, 0])
    resistorAlong(scene, 47e3, [PU.col, 6.2, 0], [PU.col, 3, 0], 1.2)
    resistorAlong(scene, 47e3, [PU.col, 1.4, 0], [PU.col, -1.8, 0], 1.2)
    partLetter(scene, '45k', [PU.col - 1.4, 4.6, 0], 0.6, GREY, 'right')
    partLetter(scene, '45k', [PU.col - 1.4, -0.2, 0], 0.6, GREY, 'right')
    const upTop = signalWire(scene, [[PU.col, 6.6, 0], [PU.col, 4.6, 0]])
    const upBot = signalWire(scene, [[PU.col, 4.6, 0], [PU.col, PU.bus, 0]])
    const dnTop = signalWire(scene, [[PU.col, PU.bus, 0], [PU.col, -0.2, 0]])
    const dnBot = signalWire(scene, [[PU.col, -0.2, 0], [PU.col, -2.6, 0]])
    const upGate = signalWire(scene, [[up.gate[0] - 2, up.gate[1], 0], up.gate])
    const dnGate = signalWire(scene, [[down.gate[0] - 2, down.gate[1], 0], down.gate])
    const od = fetSymbol(scene, [PU.od, PU.bus, 0], [PU.od, -3.4, 0], 'N')
    groundAt(scene, [PU.od, -3.4, 0])
    const odGate = signalWire(scene, [[od.gate[0] - 1, od.gate[1], 0], od.gate])
    const outReg = segmentDisplay(1, 1.1, RING, true)
    add(scene, outReg.group, [od.gate[0] - 1.6, od.gate[1], 0.3])
    partLetter(scene, 'OUT', [od.gate[0] - 1.6, od.gate[1] - 1.4, 0], 0.55, LABEL)
    const bus = signalWire(scene, [[PU.col, PU.bus, 0], [PU.pad, PU.bus, 0]])
    const dots = [PU.col, PU.od, PU.tap].map((x) => junction(scene, [x, PU.bus, 0], 0.4))
    const tap = signalWire(scene, [[PU.tap, PU.bus, 0], [PU.tap, 4.3, 0]])
    const buf = bufferSymbol(scene, [PU.tap, 5.3, 0], Math.PI / 2, 2)
    const inWire = signalWire(scene, [buf.tip, [PU.tap, 7.2, 0]])
    const inReg = segmentDisplay(1, 1.1, RING, true)
    add(scene, inReg.group, [PU.tap, 8.2, 0.3])
    partLetter(scene, 'IN', [PU.tap + 1.1, 8.2, 0], 0.55, LABEL, 'left')
    const ext = signalWire(scene, [[PU.pad, PU.bus, 0], [PU.btn, PU.bus, 0], [PU.btn, 0.8, 0]])
    const btn = pushButton(scene, [PU.btn, 0.8, 0], [PU.btn, -2.6, 0])
    const far = signalWire(scene, [[PU.btn, -2.6, 0], [PU.btn, -3.8, 0]])
    const gnd = add(scene, new THREE.Group(), [PU.btn, -3.8, 0])
    groundAt(gnd, [0, 0, 0])
    const rail = liveLabel(scene, [PU.btn + 0.8, -3.8, 0], { size: 0.7, color: HIGH_V, align: 'left' })
    const who = liveLabel(scene, [PU.btn, -5.6, 0], { size: 0.7 })
    const code = codeBlock(scene, [PU.x[0], -9.6, 0])
    const scope = timingDiagram(scene, [1, -17.6, 0], [
      { label: 'BTN', color: POWER },
      { label: 'PAD', color: PIN_COLOR },
      { label: 'READ', color: RING },
    ], { width: 32, rowH: 2.2, samples: 240 })
    const s = { t: 0, v: NaN, read: 1, flick: 0, press: 0, up: 0, dn: 0, od: 0 }
    return {
      scene,
      view: { center: [-1, -2.8, 0], radius: 80, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const m = pick(PULL_MODES, p.mode, 'pullup')
        s.t += dt
        const held = btnHeld(s.t)
        const bit = m === 'opendrain' ? odBit(s.t) : 1
        const sw = padSwitches(m as PinMode, bit)
        const r = pullPad(m as PinMode, held, bit)
        const target = r.volts ?? floatingPickup(s.t / 40, VDD)
        s.v = r.volts === null || Number.isNaN(s.v) ? target : glide(dt, s.v, target, m === 'opendrain' && target > s.v ? 9 : 24)
        const lvl = logicLevel(s.v, VDD)
        s.flick -= dt
        if (lvl === null && s.flick <= 0) {
          s.read = rand01() < 0.5 ? 0 : 1
          s.flick = 0.15
        }
        if (lvl !== null) s.read = lvl
        s.press = glide(dt, s.press, +held, 16)
        s.up = glide(dt, s.up, +sw.up, 10)
        s.dn = glide(dt, s.dn, +sw.down, 10)
        s.od = glide(dt, s.od, +sw.n, 16)
        up.set(s.up)
        down.set(s.dn)
        od.set(s.od)
        upGate(+sw.up)
        dnGate(+sw.down)
        odGate(+sw.n)
        outReg.set(m === 'opendrain' ? String(bit) : '-')
        inReg.set(String(s.read))
        const lv = s.v / VDD
        upTop(sw.up ? 1 : lv)
        dnBot(sw.down ? 0 : lv)
        for (const w of [upBot, dnTop, bus, tap, ext]) w(lv)
        for (const d of dots) d.set(lv)
        buf.set(s.read)
        inWire(s.read)
        btn.set(s.press)
        const toVdd = m === 'pulldown'
        far(held ? lv : toVdd ? 1 : 0)
        presence(gnd, toVdd ? 0 : 1)
        rail.set(toVdd ? '3V3' : '')
        who.set(m === 'opendrain' ? 'other chip' : 'button')
        code(PULL_CODE[m])
        scope.frame(dt, [+held, lv, s.read])
      },
      readouts: (p) => {
        const m = pick(PULL_MODES, p.mode, 'pullup')
        const rel = pullPad(m as PinMode, false)
        const pressed = pullPad(m as PinMode, true)
        const reads = rel.volts === null ? 'random' : String(logicLevel(rel.volts, VDD))
        const rows: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[] = [
          { label: 'Released', value: rel.volts === null ? 'floating' : volts(rel.volts), tone: rel.volts === null ? 'bad' : 'ok' },
          { label: 'Reads', value: reads, tone: rel.volts === null ? 'bad' : 'ok' },
          { label: 'Pressed draws', value: pressed.amps ? amps(pressed.amps) : '0 A' },
        ]
        if (m === 'opendrain') rows.push({ label: 'Rise, 100 pF', value: secs(pullRiseTime(INTERNAL_PULL_OHMS, BUS_PF)), tone: 'warn' })
        return rows
      },
    }
  },
}

// --- Drive strength: the pad's driver has an on-resistance and a current limit; an LED is fine, a motor is not. ---

const LOADS = {
  led: { label: 'LED + 330 Ω', load: { ohms: 330, led: LEDS.red } },
  bare: { label: 'Bare LED', load: { ohms: 0, led: LEDS.red } },
  motor: { label: 'TT motor', load: { ohms: TT_MOTOR.ohms } },
} satisfies Record<string, { label: string; load: PinLoad }>
type LoadKey = keyof typeof LOADS
const DS = { x: [-13, 6] as [number, number], y: [-5, 10.4] as [number, number], vdd: 9, top: 7.8, bot: 5.4, node: 4.4, gnd: -0.8, pad: 6, padY: 2, feed: 9.2, load: 13.4 }
const FINGERS = 8
const ON_S = 2
const DS_PERIOD = 3
const MA_TOP = 0.06
const solveLoad = (p: Params) => drivenPin(n(p, 'cap'), LOADS[pick(LOADS, p.load, 'led')].load)
const tone = (a: number) => (a >= PIN_MAX_A ? 'bad' : a > PIN_SAFE_A ? 'warn' : 'ok') as 'ok' | 'warn' | 'bad'

export const driveStrength: Lesson = {
  id: 'gpio-drive-strength',
  title: 'Drive strength',
  tagline: 'An LED yes, a motor never',
  formula: (p) => {
    const k = pick(LOADS, p.load, 'led')
    const r = solveLoad(p)
    if (k === 'motor') return `I = 3.3 V / (R_on + 5 Ω) = 3.3 / (${ohms(r.rOn)} + 5 Ω) = ${mAText(r.amps)} · pin sags to ${volts(r.pinV)} · driver heat I²R_on = ${watts(r.heatW)}`
    const vled = r.pinV - r.amps * LOADS[k].load.ohms
    return `I = (3.3 V − V_LED) / (R_on + R) = (3.3 − ${fixed(vled)}) / (${ohms(r.rOn)} + ${ohms(LOADS[k].load.ohms)}) = ${mAText(r.amps)} · limit 40 mA`
  },
  legend: [
    { color: POWER, label: 'Lit fingers = driver transistors enabled', shape: 'dot' },
    { color: HEAT, label: 'Orange = driver heating up', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An output pin is not a power supply. Its P-FET has an on-resistance, so the pad sags as current flows, and the chip’s datasheet caps each pin at 40 mA absolute maximum; about 20 mA is a comfortable limit.',
    'Drive strength is literally how many transistor fingers the driver enables. GPIO_DRIVE_CAP_0…3 give roughly 5, 10, 20 and 40 mA before the pad drops below 0.8 × VDD; 2 is the default.',
    'An LED with a 330 Ω resistor draws ~4 mA: easy at any strength. A bare LED is limited only by R_on, so at cap 3 it pulls past 40 mA and the pin and LED both suffer.',
    'A TT motor is ~5 Ω and needs ~150 mA just to run. The pin collapses to under a volt, the motor barely twitches and the driver heats up. Motors, relays and LED strips get a transistor or a driver board; the pin only drives its gate.',
    'Pin currents add up, too: the whole chip has a total budget, so ten LEDs at 20 mA each is already too much.',
  ],
  controls: [
    { kind: 'choice', key: 'load', options: Object.entries(LOADS).map(([value, l]) => ({ value, label: l.label })), initial: 'led' },
    { kind: 'slider', key: 'cap', label: 'Drive cap', min: 0, max: 3, initial: 2, step: 1, format: (v) => `${v} (${DRIVE_CAPS[v] * 1000} mA)` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    chipCutaway(scene, DS.x, DS.y, [DS.pad, DS.padY, 0])
    const xs = Array.from({ length: FINGERS }, (_, k) => -4.2 + k * 1.1)
    signalWire(scene, [[xs[0] - 1.6, DS.vdd, 0], [xs[FINGERS - 1], DS.vdd, 0]])(1)
    partLetter(scene, '3V3', [xs[0] - 2.2, DS.vdd, 0], 0.7, HIGH_V, 'right')
    const fingerMat = xs.map((x) => {
      const m = new THREE.MeshStandardMaterial({ color: '#4a505c', emissive: POWER, emissiveIntensity: 0, roughness: 0.5 })
      wire(scene, [[x, DS.vdd, 0], [x, DS.top, 0]], 0.14)
      wire(scene, [[x, DS.bot, 0], [x, DS.node, 0]], 0.14)
      add(scene, new THREE.Mesh(new THREE.BoxGeometry(0.5, DS.top - DS.bot, 0.7), m), [x, (DS.top + DS.bot) / 2, 0])
      return m
    })
    box(scene, [xs[FINGERS - 1] - xs[0] + 0.6, 0.18, 0.7], mat('#7f8590', { rough: 0.4 }), [(xs[0] + xs[FINGERS - 1]) / 2, DS.bot - 0.35, 0.6])
    partLetter(scene, 'P-FET fingers', [xs[0] - 0.6, (DS.top + DS.bot) / 2, 0], 0.6, LABEL, 'right')
    const capTag = liveLabel(scene, [xs[0] - 0.6, (DS.top + DS.bot) / 2 - 1.2, 0], { size: 0.55, color: GREY, align: 'right' })
    const node = signalWire(scene, [[xs[0], DS.node, 0], [xs[FINGERS - 1], DS.node, 0], [DS.pad - 1, DS.node, 0], [DS.pad - 1, DS.padY, 0], [DS.pad, DS.padY, 0]])
    const nf = fetSymbol(scene, [xs[1], DS.node, 0], [xs[1], DS.gnd, 0], 'N')
    groundAt(scene, [xs[1], DS.gnd, 0])
    nf.set(0)
    const rOn = liveLabel(scene, [-1.4, -2.6, 0], { size: 0.65, color: LABEL, align: 'left' })
    const feed = signalWire(scene, [[DS.pad, DS.padY, 0], [DS.feed, DS.padY, 0]])
    const leds = (['led', 'bare'] as const).map((k) => ledLoad(scene, [DS.load, DS.padY, 0], DS.load - DS.feed, LOADS[k].load.ohms))
    const motorG = add(scene, new THREE.Group(), [DS.load, DS.padY, 0])
    wire(motorG, [[DS.feed - DS.load, 0, 0], [-1.44, 0, 0], [-1.44, -0.6, 0]], 0.2)
    const motor = motorCan(motorG, [0, 1.9, 0], { r: 1.8, legs: 0.5 })
    wire(motorG, [[1.44, -0.6, 0], [1.44, -3.4, 0]], 0.2)
    groundAt(motorG, [1.44, -3.4, 0])
    const groups: Record<LoadKey, THREE.Group> = { led: leds[0].g, bare: leds[1].g, motor: motorG }
    const ma = meterBar(scene, [-8, -14.4, 0], 22, MA_TOP, [[PIN_SAFE_A, '20 mA', RING], [PIN_MAX_A, '40 mA max', HIGH_V]], 'I')
    const pv = meterBar(scene, [-8, -18.6, 0], 22, VDD, [[0.75 * VDD, 'VIH', RING]], 'pin V')
    const code = codeBlock(scene, [DS.x[0], -8, 0])
    const s = { t: 0, a: 0, v: 0, pres: { led: 1, bare: 0, motor: 0 } as Record<LoadKey, number> }
    return {
      scene,
      view: { center: [3.6, -3.2, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const k = pick(LOADS, p.load, 'led')
        const cap = n(p, 'cap')
        const r = solveLoad(p)
        s.t += dt
        const on = s.t % DS_PERIOD < ON_S
        s.a = glide(dt, s.a, on ? r.amps : 0, 12)
        s.v = glide(dt, s.v, on ? r.pinV : 0, 12)
        const heat = Math.min(1, (s.a * s.a * r.rOn) / 0.15)
        const lit = 2 ** cap
        fingerMat.forEach((m, i) => {
          m.emissive.set(i < lit ? (heat > 0.3 ? HEAT : POWER) : '#000')
          m.emissiveIntensity = i < lit ? 0.4 + 1.2 * Math.min(1, s.a / (DRIVE_CAPS[cap] * 1.2)) : 0
        })
        capTag.set(`${lit} of ${FINGERS} on`)
        rOn.set(`R_on = ${ohms(r.rOn)}`)
        const lv = s.v / VDD
        node(lv)
        feed(lv)
        for (const key of Object.keys(groups) as LoadKey[]) {
          s.pres[key] = glide(dt, s.pres[key], +(key === k), 8)
          presence(groups[key], s.pres[key])
        }
        for (const l of leds) {
          l.lamp.set(s.a / 0.02)
          l.lamp.step(dt)
        }
        motor.spin(dt, motorRpm(s.a * TT_MOTOR.ohms))
        ma(s.a, mAText(s.a), s.a >= PIN_MAX_A ? HIGH_V : s.a > PIN_SAFE_A ? RING : POWER)
        pv(s.v, `${fixed(s.v)} V`, s.v >= 0.75 * VDD ? POWER : HIGH_V)
        code([`gpio_set_drive_capability(GPIO_NUM_2,`, `  GPIO_DRIVE_CAP_${cap});`, 'digitalWrite(2, HIGH);'])
      },
      readouts: (p) => {
        const r = solveLoad(p)
        const k = pick(LOADS, p.load, 'led')
        const verdict = r.amps >= PIN_MAX_A ? 'over 40 mA!' : k === 'motor' ? 'motor stalls' : r.amps > PIN_SAFE_A ? 'hot pin' : 'fine'
        return [
          { label: 'Current', value: mAText(r.amps), tone: tone(r.amps) },
          { label: 'Pin HIGH', value: volts(r.pinV), tone: r.pinV >= 0.75 * VDD ? 'ok' : 'warn' },
          { label: 'Driver heat', value: watts(r.heatW) },
          { label: 'Verdict', value: verdict, tone: verdict === 'fine' ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Interrupts: an edge fires an ISR at once; a polling loop only sees presses that last until its next read. ---

const SLOW = 3
const IR = { board: -15, ring: 4, ringY: 1.6, r: 4, btn: -6, cnt: 14 }
const POLL_CODE = (ms: number) => ['bool now = digitalRead(0);', 'if (!now && was) count++;  was = now;', `delay(${ms});  // rest of loop`]
const ISR_CODE = ['attachInterrupt(0, onPress, FALLING);', 'void IRAM_ATTR onPress() { count++; }', 'gpio_isr_handler_add(GPIO_NUM_0, on_press, 0);']
const PRESS_LENS = Array.from({ length: 6 }, (_, i) => press(i).len)
const missShare = (periodS: number) => PRESS_LENS.reduce((a, len) => a + pollMissChance(len, periodS), 0) / PRESS_LENS.length

export const interrupts: Lesson = {
  id: 'gpio-interrupts',
  title: 'Interrupts',
  tagline: 'Don’t keep asking, get told',
  formula: (p) => {
    const T = n(p, 'period') / 1000
    return p.how === 'isr'
      ? `FALLING edge → ISR runs within ~2 µs, count++ · nothing missed, whatever the loop is doing (${secs(T)} per loop)`
      : `Polling: a press of length L is missed if no read lands in it · P(miss) = 1 − L / T, T = ${secs(T)} · presses 30–250 ms → ${pct(missShare(T))} missed`
  },
  legend: [
    { color: RING, label: 'Bead = loop() going round; flash = a read', shape: 'dot' },
    { color: HIGH_V, label: 'ISR: the edge itself counts', shape: 'arrow-right' },
    CODE_LEGEND,
  ],
  points: [
    'Polling means loop() reads the pin, does its other work, and reads it again. A press shorter than the gap between two reads happens entirely while the CPU is looking elsewhere, and is lost.',
    'The slower the loop (a delay, a sensor read, a Wi-Fi call), the more presses go missing. A 200 ms loop misses most 50 ms taps.',
    'An interrupt hands the job to hardware: the GPIO block watches for an edge (FALLING with a pull-up button) and the CPU jumps to your ISR within microseconds, mid-loop, then returns.',
    'Keep ISRs tiny: set a flag or bump a counter (volatile), nothing slow like Serial or delay. On the ESP32 mark them IRAM_ATTR so they run even while flash is busy. loop() then acts on the flag at its own pace.',
    `A real button also bounces, firing several edges per press; debounce in the ISR or after it. Time here is slowed ${SLOW}×.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'how',
      options: [
        { value: 'poll', label: 'Polling' },
        { value: 'isr', label: 'Interrupt' },
      ],
      initial: 'poll',
    },
    { kind: 'slider', key: 'period', label: 'Loop time', min: 10, max: 1000, initial: 200, log: true, format: (v) => `${Math.round(v)} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const pin = esp32Board(scene, [IR.board, IR.ringY - 2.5, 0], 0.5)
    partLetter(scene, 'ESP32', [IR.board, IR.ringY - 6, 0], 0.9, LABEL)
    const io = pin(3)
    const line = signalWire(scene, [io, [io[0], 7, io[2]], [io[0], 7, 0], [IR.btn, 7, 0], [IR.btn, 6, 0]])
    const btn = pushButton(scene, [IR.btn, 6, 0], [IR.btn, 2.8, 0])
    signalWire(scene, [[IR.btn, 2.8, 0], [IR.btn, 1.8, 0]])(0)
    groundAt(scene, [IR.btn, 1.8, 0])
    partLetter(scene, 'GPIO 0', [io[0] + 0.6, 7.9, 0], 0.6, RING, 'left')
    add(scene, new THREE.Mesh(new THREE.TorusGeometry(IR.r, 0.16, 10, 72), mat('#5c6270', { rough: 0.5 })), [IR.ring, IR.ringY, 0])
    const blur = add(scene, new THREE.Mesh(new THREE.TorusGeometry(IR.r, 0.3, 10, 72), glowMat(RING, 0.6)), [IR.ring, IR.ringY, 0])
    const bead = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), glowMat(RING, 1)), [IR.ring, IR.ringY + IR.r, 0])
    const readM = glowMat(GREY, 0.2)
    add(scene, new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.8), readM), [IR.ring, IR.ringY + IR.r + 0.9, 0])
    partLetter(scene, 'read', [IR.ring + 1.2, IR.ringY + IR.r + 1.2, 0], 0.55, GREY, 'left')
    partLetter(scene, 'loop()', [IR.ring, IR.ringY + 0.6, 0], 0.9, LABEL)
    const loopMs = liveLabel(scene, [IR.ring, IR.ringY - 1, 0], { size: 0.6, color: GREY })
    const zap = add(scene, new THREE.Group(), [-2.6, IR.ringY, 0.4])
    arrow(zap, [0, 0, 0], [1, 0, 0], HIGH_V, 1.4)
    partLetter(zap, 'ISR', [0.6, 1.3, 0], 0.8, HIGH_V)
    const counts = [segmentDisplay(3, 1.4, POWER, true), segmentDisplay(3, 1.4, RING, true)]
    counts.forEach((d, k) => {
      add(scene, d.group, [IR.cnt, 4.6 - k * 4, 0.3])
      partLetter(scene, k ? 'counted' : 'presses', [IR.cnt, 6.2 - k * 4, 0], 0.6, LABEL)
    })
    const code = codeBlock(scene, [-19, -7.8, 0], 0.66)
    const scope = timingDiagram(scene, [0, -16.2, 0], [
      { label: 'BTN', color: POWER },
      { label: 'SEEN', color: RING },
    ], { width: 34, rowH: 2.6, samples: 300 })
    const s = { key: '', t: 0, next: 0, presses: 0, counted: 0, queue: [] as number[], flash: 0, zap: 0, press: 0, read: 0 }
    return {
      scene,
      view: { center: [-1.5, -3.6, 0], radius: 74, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const T = n(p, 'period') / 1000
        const isr = p.how === 'isr'
        const key = `${p.how}|${p.period}`
        if (key !== s.key) Object.assign(s, { key, t: 0, next: 0, presses: 0, counted: 0, queue: [], flash: 0, zap: 0 })
        const t0 = s.t
        s.t += dt / SLOW
        for (let i = s.next; press(i).start <= s.t; i = ++s.next) {
          const { start, len } = press(i)
          s.presses++
          if (isr) s.queue.push(start)
          else if (pollSees(start, len, T)) s.queue.push(nextLoopRead(start, T))
        }
        s.queue = s.queue.filter((at) => {
          if (at > s.t) return true
          s.counted++
          if (isr) s.zap = 1
          return false
        })
        const down = buttonDown(s.t)
        const lastRead = Math.floor(s.t / T) * T
        if (Math.floor(s.t / T) !== Math.floor(t0 / T)) s.flash = 1
        s.flash = Math.max(0, s.flash - dt * 6)
        s.zap = Math.max(0, s.zap - dt * 1.6)
        s.press = glide(dt, s.press, +down, 20)
        btn.set(s.press)
        line(down ? 0 : 1)
        const fast = T * SLOW < 0.3
        const a = 2 * Math.PI * ((s.t / T) % 1)
        bead.visible = !fast
        bead.position.set(IR.ring + IR.r * Math.sin(a), IR.ringY + IR.r * Math.cos(a), 0)
        blur.visible = fast
        const seen = isr ? +(s.zap > 0.75) : +buttonDown(lastRead)
        s.read = seen
        readM.emissive.set(isr ? GREY : buttonDown(lastRead) ? HIGH_V : LOW_V)
        readM.emissiveIntensity = isr ? 0.1 : fast ? 0.8 : 0.2 + 1.2 * s.flash
        presence(zap, s.zap)
        loopMs.set(`${Math.round(T * 1000)} ms`)
        counts[0].set(String(s.presses % 1000))
        counts[1].set(String(s.counted % 1000))
        code(isr ? ISR_CODE : POLL_CODE(Math.round(T * 1000)))
        scope.frame(dt, [+down, seen])
      },
      readouts: (p) => {
        const T = n(p, 'period') / 1000
        const isr = p.how === 'isr'
        const missed = s.presses - s.counted - s.queue.length
        return [
          { label: 'Caught', value: `${s.counted} / ${s.presses}`, tone: missed > 0 ? 'bad' : 'ok' },
          { label: 'Miss chance', value: isr ? '0 %' : pct(missShare(T)), tone: isr || missShare(T) === 0 ? 'ok' : 'warn' },
          { label: 'Reaction', value: isr ? '~2 µs' : `≤ ${secs(T)}` },
        ]
      },
    }
  },
}
