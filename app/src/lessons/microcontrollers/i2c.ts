import * as THREE from 'three/webgpu'
import {
  GPIO_VDD,
  I2C_CHIPS,
  I2C_MODES,
  I2C_VOL,
  MPU6050,
  SCAN_FIRST,
  SCAN_LAST,
  accelPitch,
  busAnswer,
  chipAddress,
  i2cDecode,
  i2cRegisterSteps,
  i2cRiseTime,
  i2cScan,
  i2cSteps,
  isReserved,
  lowVolts,
  mpu6050Burst,
  mpu6050Parse,
  openDrainClock,
  probeTime,
  pullupMax,
  pullupMin,
  sampleLine,
  stepLines,
  tiltAccel,
} from '../../core/physics'
import { Bit } from '../../core/logic'
import { hexByte, ohms, secs, signed, volts } from '../../core/units'
import { hex } from '../../core/numbers'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  I2C_TEXT,
  LABEL,
  LOW_V,
  POWER,
  RING,
  arrow,
  captureScreen,
  ceramicAlong,
  codeBlock,
  esp32Board,
  fetSymbol,
  frac,
  glowMat,
  groundAt,
  i2cBreakout,
  junction,
  liveLabel,
  memoBy,
  partLetter,
  resistorAlong,
  scope,
  setGlow,
  signalWire,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

type Steps = { scl: Bit; sda: Bit }[]
const PER_BIT = 20

/** Samples a step list at `perBit` samples per SCL bit, with a bit of idle either side, and decodes it. */
function sampleSteps(steps: Steps, hz: number) {
  const fs = hz * PER_BIT
  const lines = stepLines(steps, hz)
  const pad = 1.5 / hz
  const count = Math.ceil((lines.duration + 2 * pad) * fs)
  const scl = sampleLine(lines.scl, fs, count, -pad)
  const sda = sampleLine(lines.sda, fs, count, -pad)
  return { scl, sda, count, fs, pad, duration: lines.duration, ev: i2cDecode(scl, sda) }
}
type Sampled = ReturnType<typeof sampleSteps>

/** SCL/SDA capture with a decoder row; `draw` shows samples i0…i1 with the head at `head` (sample index). */
function busCapture(parent: THREE.Object3D, at: V3, width: number, rowH = 2) {
  const cap = captureScreen(
    parent,
    at,
    [
      { label: 'SCL', color: CLK_COLOR },
      { label: 'SDA', color: DATA_COLOR },
    ],
    { width, rowH, decoder: true },
  )
  const traces = [0, 1].map((k) => cap.channel(k, { samples: 420 }))
  return {
    cap,
    draw(s: Sampled, i0: number, i1: number, head: number) {
      const span = i1 - i0
      const uOf = (i: number) => (i - i0) / span
      const hu = Math.min(1, uOf(head))
      const val = (line: Bit[], u: number) => line[Math.max(0, Math.min(s.count - 1, Math.round(i0 + Math.min(u, hu) * span)))]
      traces[0].draw((u) => val(s.scl, u), hu < 1 ? hu : null)
      traces[1].draw((u) => val(s.sda, u), hu < 1 ? hu : null)
      const half = PER_BIT / 2
      cap.annotate(
        s.ev
          .filter((e) => e.to <= head && uOf(e.to) >= 0 && uOf(e.from) <= 1)
          .map((e) => {
            const [text, color] = I2C_TEXT[e.kind](e)
            const w = e.kind === 'start' || e.kind === 'stop' ? half * 0.6 : half
            return { u0: Math.max(0, uOf(e.from - w)), u1: Math.min(1, uOf(e.to + w)), text, color }
          }),
      )
    },
  }
}

/** ESP32 on the left with 4.7 kΩ pull-ups and an SCL/SDA bus running right over the breakouts. */
function busRig(scene: THREE.Object3D, esp: V3, k: number, sdaY: number, x1: number) {
  const pin = esp32Board(scene, esp, k)
  const sclY = sdaY + 1.2
  const sclPin = pin(3, true)
  const sdaPin = pin(5, true)
  partLetter(scene, 'ESP32', [esp[0], esp[1] - 5 * k - 0.9, 0], 0.55, LABEL)
  partLetter(scene, 'SCL 22', [sclPin[0] - 0.4, sclPin[1] + 0.9, 0], 0.38, CLK_COLOR, 'right')
  partLetter(scene, 'SDA 21', [sdaPin[0] + 0.4, sdaPin[1] + 0.9, 0], 0.38, DATA_COLOR, 'left')
  const scl = [signalWire(scene, [sclPin, [sclPin[0], sclY, 0], [x1, sclY, 0]])]
  const sda = [signalWire(scene, [sdaPin, [sdaPin[0], sdaY, 0], [x1, sdaY, 0]])]
  partLetter(scene, 'SCL', [x1 + 0.6, sclY, 0], 0.45, CLK_COLOR, 'left')
  partLetter(scene, 'SDA', [x1 + 0.6, sdaY, 0], 0.45, DATA_COLOR, 'left')
  const railY = sclY + 3.4
  const rx = sdaPin[0] + 3.2
  wire(scene, [[rx - 1.2, railY, 0], [rx + 2.4, railY, 0]], 0.16)
  partLetter(scene, '3V3', [rx - 1.6, railY, 0], 0.42, HIGH_V, 'right')
  resistorAlong(scene, 4700, [rx, railY, 0], [rx, sclY, 0], 0.8)
  resistorAlong(scene, 4700, [rx + 1.2, railY, 0], [rx + 1.2, sdaY, 0], 0.8)
  partLetter(scene, '4.7K', [rx + 2.2, railY - 1.6, 0], 0.38, GREY, 'left')
  junction(scene, [rx, sclY, 0], 0.18).set(1)
  junction(scene, [rx + 1.2, sdaY, 0], 0.18).set(1)
  /** Drops a breakout's SCL/SDA pins onto the bus. */
  const tap = (b: ReturnType<typeof i2cBreakout>) => {
    for (const [p, y, set] of [['SCL', sclY, scl], ['SDA', sdaY, sda]] as const) {
      const t = b.pin(p)
      set.push(signalWire(scene, [t, [t[0], y, 0]]))
      junction(scene, [t[0], y, 0], 0.16).set(1)
    }
  }
  return {
    tap,
    sclY,
    lines: (c: number, d: number) => {
      scl.forEach((w) => w(c))
      sda.forEach((w) => w(d))
    },
  }
}

// --- Addresses: every chip hears every address; only the one that matches pulls SDA low in the ACK slot. ---

const AD_HZ = 100e3
const AD_OUT = 2.4
const AD_BACK = 1.2
const AD_CYCLE = AD_OUT + AD_BACK + 1.8
const AD_BOARDS = [
  { chip: I2C_CHIPS.ssd1306, name: 'OLED', color: '#1f4fae', x: -6 },
  { chip: I2C_CHIPS.mpu6050, name: 'MPU-6050', color: '#2c6e3a', x: 0.5 },
  { chip: I2C_CHIPS.bmp280, name: 'BMP280', color: '#5b2a86', x: 7 },
  { chip: I2C_CHIPS.mpu6050, name: 'MPU-6050', color: '#2c6e3a', x: 13.5 },
]
const CALLS = ['3c', '68', '69', '76', '50']
const AD0 = { gnd: 0, vcc: 1 } as const

const adSetup = (p: Params) => {
  const call = parseInt(pick(Object.fromEntries(CALLS.map((c) => [c, c])), p.call, '68'), 16)
  const ad0 = AD0[pick(AD0, p.ad0, 'gnd')]
  const addrs = AD_BOARDS.map((b, i) => chipAddress(b.chip, i === 3 ? ad0 : 0))
  return { call, ad0, addrs, ...busAnswer(addrs, call) }
}
const adCapture = memoBy(
  (p: Params) => `${p.call}|${p.ad0}`,
  (p: Params) => {
    const s = adSetup(p)
    return sampleSteps(i2cSteps({ addr: s.call, data: [], ack: s.ack }), AD_HZ)
  },
)
const boardName = (i: number) => (i === 1 ? 'MPU-6050 #1' : i === 3 ? 'MPU-6050 #2' : AD_BOARDS[i].name)

export const addresses: Lesson = {
  id: 'i2c-addresses',
  title: 'Addresses',
  tagline: 'Everyone hears the call, only one chip answers',
  formula: (p) => {
    const s = adSetup(p)
    return `address byte = ${hexByte(s.call)} << 1 | W(0) = ${hexByte(s.call * 2)} · MPU-6050 = 0x68 + AD0 · BMP280 = 0x76 + SDO · OLED = 0x3C + SA0 · 7 bits, 0x08–0x77 usable · ${hexByte(s.call)}: ${s.ackers.length} chip${s.ackers.length === 1 ? '' : 's'} answer · slowed ${Math.round((AD_OUT + AD_BACK) / adCapture(p).duration).toLocaleString('en')}×`
  },
  legend: [
    { color: CLK_COLOR, label: 'SCL: clock, always from the ESP32', shape: 'dot' },
    { color: DATA_COLOR, label: 'SDA: address out, ACK back', shape: 'dot' },
    { color: POWER, label: 'Chip answers: ACK (pulls SDA low)', shape: 'dot' },
    { color: HIGH_V, label: 'Nobody, or two at once', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'I²C hangs many chips on the same two wires. Each has a 7-bit address; the ESP32 starts every transfer by sending one, plus a R/W bit.',
    'Every chip on the bus hears it and compares. The one that matches pulls SDA low in the 9th clock (ACK); the others stay quiet until the next START.',
    'The address is set at the factory: an MPU-6050 is 0x68, a BMP280 0x76, an SSD1306 OLED 0x3C. Nobody at 0x50 → SDA stays high: NACK, and Wire reports error 2.',
    'Two of the same chip collide: both ACK, then both drive their data at once and the bytes come out garbled. No error tells you; the readings are just wrong.',
    'That is what the address-select pin is for. Tie the second MPU-6050’s AD0 to 3.3 V and it moves to 0x69. Chips with three pins (PCF8574: A0–A2) give 8 addresses; past that, use an I²C multiplexer (TCA9548A).',
    'To see the frame bit by bit, see Logic analyzer → Capture I²C.',
  ],
  controls: [
    { kind: 'choice', key: 'call', options: CALLS.map((c) => ({ value: c, label: `Call 0x${c.toUpperCase()}` })), initial: '68' },
    {
      kind: 'choice',
      key: 'ad0',
      options: [
        { value: 'gnd', label: '#2 AD0 → GND' },
        { value: 'vcc', label: '#2 AD0 → 3V3' },
      ],
      initial: 'gnd',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const sdaY = 3.6
    const rig = busRig(scene, [-18.5, -1.2, 0], 0.45, sdaY, 17)
    const boards = AD_BOARDS.map((b) => {
      const at: V3 = [b.x, -2, 0]
      const bk = i2cBreakout(scene, at, { name: b.chip.name, color: b.color, k: 0.29 })
      rig.tap(bk)
      return {
        bk,
        at,
        addr: liveLabel(scene, [b.x, -5.2, 0], { size: 0.7 }),
        sel: liveLabel(scene, [b.x, -6.3, 0], { size: 0.4 }),
        tag: liveLabel(scene, [b.x, -7.4, 0], { size: 0.48 }),
      }
    })
    const bitGeo = new THREE.BoxGeometry(1.15, 1.15, 0.35)
    const bitX = (j: number) => -4.6 + j * 1.35 + (j > 6 ? 0.4 : 0) + (j > 7 ? 0.4 : 0)
    const bitY = -9.6
    const bits = Array.from({ length: 9 }, (_, j) => {
      const m = mat('#1c1e24', { emissive: '#000000' }, true)
      add(scene, mesh(bitGeo, m), [bitX(j), bitY, 0]).castShadow = false
      partLetter(scene, j < 7 ? `A${6 - j}` : j === 7 ? 'W' : 'ACK', [bitX(j), bitY - 1.2, 0], 0.36, GREY)
      return { m, d: liveLabel(scene, [bitX(j), bitY - 0.2, 0.3], { size: 0.5 }) }
    })
    partLetter(scene, 'on SDA', [bitX(0) - 1.2, bitY, 0], 0.42, DATA_COLOR, 'right')
    const tokGeo = new THREE.CapsuleGeometry(0.5, 2.6, 6, 12).rotateZ(Math.PI / 2)
    const callMat = glowMat(DATA_COLOR, 1)
    const call = add(scene, mesh(tokGeo, callMat))
    call.castShadow = false
    const callTag = liveLabel(scene, [0, 0, 0], { size: 0.5 })
    const acks = AD_BOARDS.map(() => {
      const m = glowMat(POWER, 1)
      const t = add(scene, mesh(new THREE.SphereGeometry(0.45, 14, 10), m))
      t.castShadow = false
      return { t, m }
    })
    const espTag = liveLabel(scene, [-18.5, -5.4, 0], { size: 0.48 })
    const code = codeBlock(scene, [-24, -7, 0], 0.4, 4)
    const x0 = -16
    const x1 = 16.5
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-3.5, -3, 0], radius: 80, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = adSetup(p)
        const C = adCapture(p)
        const key = `${S.call}|${S.ad0}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t = (s.t + dt) % AD_CYCLE
        const t = s.t
        const out = Math.min(1, t / AD_OUT)
        const cx = x0 + out * (x1 - x0)
        call.visible = t < AD_OUT
        call.position.set(cx, sdaY - 1, 0.6)
        callTag.group.position.set(cx, sdaY - 2.3, 0.6)
        callTag.set(call.visible ? `${hexByte(S.call)} W` : '', DATA_COLOR)
        const back = Math.min(1, Math.max(0, (t - AD_OUT) / AD_BACK))
        const done = t >= AD_OUT + AD_BACK
        boards.forEach((b, i) => {
          b.addr.set(hexByte(S.addrs[i]), S.addrs[i] === S.call ? (S.conflict ? HIGH_V : POWER) : LABEL)
          const num = i === 1 ? '#1 ' : i === 3 ? '#2 ' : ''
          b.sel.set(`${num}${AD_BOARDS[i].chip.pin} → ${i === 3 && S.ad0 ? '3V3' : 'GND'}`, i === 3 ? RING : GREY)
          const heard = cx >= b.at[0]
          const mine = S.ackers.includes(i)
          b.bk.led(1)
          b.bk.chip(mine ? (S.conflict ? HIGH_V : POWER) : GREY, heard ? (mine ? 0.9 : 0.12) : 0)
          b.tag.set(heard ? (mine ? (S.conflict ? 'ACK · CLASH' : 'ACK') : 'not me') : '', mine ? (S.conflict ? HIGH_V : POWER) : GREY)
          const a = acks[i]
          a.t.visible = mine && t >= AD_OUT && !done
          a.t.position.set(b.at[0] + (x0 - b.at[0]) * back, sdaY - 1, 0.6)
          setGlow(a.m, S.conflict ? HIGH_V : POWER, 1.2)
        })
        espTag.set(
          !done ? `calling ${hexByte(S.call)}…` : S.conflict ? 'ACK, but 2 chips' : S.ack ? 'ACK → endTransmission 0' : 'NACK → error 2',
          !done ? RING : S.conflict || !S.ack ? HIGH_V : POWER,
        )
        const prog = Math.min(1, t / (AD_OUT + AD_BACK))
        const head = Math.round(prog * (C.count - 1))
        const byte = S.call * 2
        bits.forEach((b, j) => {
          const shown = j < 8 ? t >= ((j + 0.5) / 8) * AD_OUT : t >= AD_OUT
          const v = j < 8 ? Math.floor(byte / 2 ** (7 - j)) % 2 : S.ack ? 0 : 1
          const col = j < 8 ? DATA_COLOR : S.conflict || !S.ack ? HIGH_V : POWER
          b.m.emissive.set(shown ? col : '#000000')
          b.m.emissiveIntensity = shown ? 0.3 : 0
          b.d.set(shown ? String(v) : '', LABEL)
        })
        const lvl = (line: Bit[]) => line[Math.min(C.count - 1, head)]
        rig.lines(lvl(C.scl), lvl(C.sda))
        code([
          `Wire.beginTransmission(${hexByte(S.call)});`,
          `byte err = Wire.endTransmission();`,
          `// err = ${S.ack ? '0: ACK' : '2: NACK on address'}`,
          S.conflict ? '// two chips answered: data will clash' : '',
        ])
      },
      readouts: (p) => {
        const S = adSetup(p)
        const names = S.ackers.map(boardName).join(' + ')
        return [
          { label: 'Call', value: `${hexByte(S.call)} write → byte ${hexByte(S.call * 2)}` },
          { label: 'Answer', value: S.conflict ? `${names}: conflict` : S.ack ? `ACK from ${names}` : 'NACK: nobody there', tone: S.conflict || !S.ack ? 'bad' : 'ok' },
          { label: 'Bus map', value: [...new Set(S.addrs)].sort((a, b) => a - b).map(hexByte).join(' '), tone: new Set(S.addrs).size < S.addrs.length ? 'warn' : 'ok' },
          { label: 'Address phase', value: secs(adCapture(p).duration) },
        ]
      },
    }
  },
}

// --- Pull-up resistors: chips only pull low; the resistor charges the bus capacitance back up, an RC rise. ---

const PU_R = { '1000': 1000, '2200': 2200, '4700': 4700, '10000': 10e3, '45000': 45e3 } as const
const PU_C = { '50': 50e-12, '100': 100e-12, '200': 200e-12, '400': 400e-12 } as const
const PU_MODE = { standard: I2C_MODES.standard, fast: I2C_MODES.fast } as const
const PU_PERIOD_S = 2.4
const PU_CYCLES = 2

const puSetup = (p: Params) => {
  const r = PU_R[pick(PU_R, p.r, '2200')]
  const cb = PU_C[pick(PU_C, p.cb, '100')]
  const modeKey = pick(PU_MODE, p.mode, 'fast')
  const mode = PU_MODE[modeKey]
  const clk = openDrainClock(mode.hz, r, cb)
  const tr = i2cRiseTime(r, cb)
  return { r, cb, modeKey, mode, clk, tr, rMin: pullupMin(), rMax: pullupMax(cb, mode), vol: lowVolts(r) }
}
const pf = (c: number) => `${Math.round(c * 1e12)} pF`

export const pullUpResistors: Lesson = {
  id: 'i2c-pull-up-resistors',
  title: 'Pull-up resistors',
  tagline: 'Chips only pull low; a resistor brings the line back',
  formula: (p) => {
    const s = puSetup(p)
    return `tr (30→70 %) = ln(7/3)·R·C = 0.85 × ${ohms(s.r)} × ${pf(s.cb)} = ${secs(s.tr)} (limit ${secs(s.mode.trMax)} at ${s.mode.hz / 1e3} kHz) · R ≥ (3.3 − 0.4 V) / 3 mA = ${ohms(s.rMin)} · R ≤ tr max / (0.85 C) = ${ohms(s.rMax)} · slowed ${Math.round(PU_PERIOD_S * s.mode.hz).toLocaleString('en')}×`
  },
  legend: [
    { color: HIGH_V, label: 'Line voltage: red 3.3 V, blue 0 V', shape: 'dot' },
    { color: CLK_COLOR, label: 'SCL as the bus sees it', shape: 'dot' },
    { color: GREY, label: 'The square clock the ESP32 meant', shape: 'dot' },
    { color: RING, label: 'VIH ≈ 2.5 V / VIL 0.8 V (ESP32)', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'I²C pins are open-drain: a FET can pull the line to ground, but nothing drives it high. That is why any chip can talk, or hold the clock, without a short.',
    'A pull-up resistor to 3.3 V brings the line back when everyone lets go. Every wire, pin and chip on the bus adds capacitance (≈ 10 pF each); the resistor has to charge it, so the rise is an RC curve, while the fall through the FET is fast.',
    'The spec limits the rise (30 → 70 %): 1000 ns at 100 kHz, 300 ns at 400 kHz, with up to 400 pF of bus. Too big a resistor and the clock never reaches a valid HIGH in time.',
    'Too small and the FET can’t pull low enough: at 3 mA it must reach 0.4 V, so R ≥ 967 Ω on 3.3 V. 2.2 k–4.7 kΩ is the usual pick; short buses on breakouts often come with 10 kΩ already fitted.',
    'Every breakout’s pull-ups add in parallel. Five boards with 10 kΩ each is 2 kΩ: still fine, but more can overload the drivers.',
    'The ESP32’s internal ~45 kΩ pulls are far too weak for 400 kHz; they only just work at 100 kHz on a very short bus. For the open-drain pin itself, see GPIO → Open-drain.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'r',
      options: [
        { value: '1000', label: '1 kΩ' },
        { value: '2200', label: '2.2 kΩ' },
        { value: '4700', label: '4.7 kΩ' },
        { value: '10000', label: '10 kΩ' },
        { value: '45000', label: '45 kΩ internal' },
      ],
      initial: '2200',
    },
    { kind: 'choice', key: 'cb', options: Object.keys(PU_C).map((c) => ({ value: c, label: `${c} pF` })), initial: '100' },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'standard', label: '100 kHz' },
        { value: 'fast', label: '400 kHz' },
      ],
      initial: 'fast',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const lineY = 3
    const railY = 7.5
    const gndY = -1.5
    const rx = -8
    const esp = esp32Board(scene, [-20, -0.2, 0], 0.42)
    partLetter(scene, 'ESP32', [-20, -3.1, 0], 0.5, LABEL)
    const pinT = esp(4, true)
    partLetter(scene, 'SCL 22', [pinT[0] - 0.4, lineY + 0.8, 0], 0.4, CLK_COLOR, 'right')
    const line = signalWire(scene, [pinT, [pinT[0], lineY, 0], [16, lineY, 0]])
    const fet = fetSymbol(scene, [-12, lineY, 0], [-12, gndY, 0], 'N')
    junction(scene, [-12, lineY, 0], 0.22).set(1)
    groundAt(scene, [-12, gndY - 0.4, 0])
    wire(scene, [[rx - 2.4, railY, 0], [rx + 2.4, railY, 0]], 0.18)
    partLetter(scene, '3V3', [rx - 3, railY, 0], 0.55, HIGH_V, 'right')
    const rHolder = add(scene, new THREE.Group())
    const rLabel = liveLabel(scene, [rx + 1.3, (railY + lineY) / 2, 0], { size: 0.55, align: 'left' })
    junction(scene, [rx, lineY, 0], 0.22).set(1)
    ceramicAlong(scene, [3, lineY, 0], [3, gndY, 0], 1.1)
    groundAt(scene, [3, gndY - 0.4, 0])
    junction(scene, [3, lineY, 0], 0.22).set(1)
    const cLabel = liveLabel(scene, [4.6, (lineY + gndY) / 2 + 0.4, 0], { size: 0.55, align: 'left' })
    partLetter(scene, 'wires + pins', [4.6, (lineY + gndY) / 2 - 0.6, 0], 0.4, GREY, 'left')
    const sensor = i2cBreakout(scene, [13, -0.6, 0], { name: 'MPU-6050', color: '#2c6e3a', k: 0.3 })
    sensor.led(1)
    const sp = sensor.pin('SCL')
    wire(scene, [sp, [sp[0], lineY, 0]], 0.2)
    const vTag = liveLabel(scene, [-12, lineY + 1, 0], { size: 0.5 })

    const W = 26
    const H = 5.5
    const sc = scope(scene, W, H, { divs: [8, 4], zeroAt: 0 })
    sc.group.position.set(4, -8.6, 0)
    const yOf = (v: number) => -H / 2 + (v / GPIO_VDD) * H * 0.88
    const ideal = sc.trace(GREY, { samples: 200, radius: 0.06 })
    const real = sc.trace(CLK_COLOR, { samples: 360, radius: 0.11 })
    const vih = sc.level(RING)
    const vil = sc.level(RING, 0.3)
    const vihTag = add(sc.group, new THREE.Group())
    partLetter(vihTag, 'VIH', [W / 2 + 0.8, 0, 0], 0.45, RING, 'left')
    partLetter(sc.group, 'VIL', [W / 2 + 0.8, yOf(0.8), 0], 0.45, RING, 'left')
    partLetter(sc.group, '3.3 V', [-W / 2 - 0.8, yOf(GPIO_VDD), 0], 0.42, GREY, 'right')
    partLetter(sc.group, '0 V', [-W / 2 - 0.8, yOf(0), 0], 0.42, GREY, 'right')
    const scTag = liveLabel(sc.group, [-W / 2, H / 2 + 0.9, 0], { size: 0.5, align: 'left' })
    const okTag = liveLabel(sc.group, [W / 2, H / 2 + 0.9, 0], { size: 0.5, align: 'right' })
    const code = codeBlock(scene, [-24, -4.6, 0], 0.4, 3)
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -2, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = puSetup(p)
        const key = `${S.r}|${S.cb}|${S.modeKey}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0 })
          rHolder.clear()
          resistorAlong(rHolder, S.r, [rx, railY, 0], [rx, lineY, 0], 1.1)
          rLabel.set(S.r === 45e3 ? '45 kΩ (internal)' : ohms(S.r), S.r > S.rMax || S.r < S.rMin ? HIGH_V : LABEL)
          cLabel.set(`Cb ${pf(S.cb)}`, LABEL)
          vih.set(yOf(S.clk.vih))
          vihTag.position.y = yOf(S.clk.vih)
          vil.set(yOf(0.8))
        }
        const period = 1 / S.mode.hz
        s.t = (s.t + dt / PU_PERIOD_S) % PU_CYCLES
        const win = PU_CYCLES * period
        // the window starts where SCL is released
        const tOf = (u: number) => u * win
        ideal.draw((u) => yOf((frac(tOf(u) / period) < 0.5 ? 1 : 0) * GPIO_VDD), null)
        const head = s.t / PU_CYCLES
        real.draw((u) => yOf(S.clk.level(tOf(Math.min(u, head)))), head)
        const v = S.clk.level(tOf(head))
        const released = frac(tOf(head) / period) < 0.5
        line(v / GPIO_VDD)
        fet.set(released ? 0 : 1)
        vTag.set(`${volts(v)} · ${released ? 'released' : 'pulled low'}`, released ? (v >= S.clk.vih ? POWER : HEAT) : LOW_V)
        scTag.set(`SCL · ${S.mode.hz / 1e3} kHz · ${secs(win)} across`, LABEL)
        okTag.set(
          S.clk.toHigh === Infinity ? 'NEVER REACHES HIGH' : S.clk.ok ? `HIGH after ${secs(S.clk.toHigh)}` : `LATE: HIGH after ${secs(S.clk.toHigh)}`,
          S.clk.toHigh === Infinity ? HIGH_V : S.clk.ok ? POWER : HEAT,
        )
        code([
          'Wire.begin(21, 22);  // SDA, SCL',
          `Wire.setClock(${S.mode.hz});`,
          S.r === 45e3 ? '// no resistors: internal pull-ups only' : `// ${ohms(S.r)} from SDA and SCL to 3.3 V`,
        ])
      },
      readouts: (p) => {
        const S = puSetup(p)
        const trOk = S.tr <= S.mode.trMax
        return [
          { label: 'Rise time', value: `${secs(S.tr)} / ${secs(S.mode.trMax)} max`, tone: trOk ? 'ok' : S.clk.ok ? 'warn' : 'bad' },
          { label: 'Pull-up window', value: S.rMax < S.rMin ? `none at ${pf(S.cb)}` : `${ohms(S.rMin)} – ${ohms(S.rMax)}`, tone: S.r >= S.rMin && S.r <= S.rMax ? 'ok' : 'bad' },
          { label: 'LOW level', value: `${volts(S.vol)} at ${ohms(S.r)}`, tone: S.vol <= I2C_VOL ? 'ok' : 'bad' },
          { label: 'Top of HIGH', value: `${volts(S.clk.top)} (VIH ${volts(S.clk.vih)})`, tone: S.clk.toHigh === Infinity ? 'bad' : S.clk.ok ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Reading an IMU: write the register pointer, repeated START, then 14 bytes come back in one burst. ---

const IMU_REVEAL = 6
const IMU_HOLD = 1.6
const IMU_ROCK_S = 5
const IMU_HZ = { '100': 100e3, '400': 400e3 } as const
const REG_NAMES = ['AX', 'AY', 'AZ', 'T', 'GX', 'GY', 'GZ']
const IMU_TEMP = 26.5

const imuPitch = (amp: number, t: number) => amp * Math.sin((2 * Math.PI * t) / IMU_ROCK_S)
const imuRate = (amp: number, t: number) => ((amp * 2 * Math.PI) / IMU_ROCK_S) * Math.cos((2 * Math.PI * t) / IMU_ROCK_S)
function imuReadAt(amp: number, t: number, hz: number) {
  const pitch = imuPitch(amp, t)
  const bytes = mpu6050Burst(tiltAccel(pitch, 0), [0, (imuRate(amp, t) * 180) / Math.PI, 0], IMU_TEMP)
  const s = sampleSteps(i2cRegisterSteps(MPU6050.addr, MPU6050.accelOut, bytes), hz)
  const data = s.ev.filter((e) => e.kind === 'data').slice(1)
  return { pitch, bytes, s, parsed: mpu6050Parse(bytes), arrive: data.map((e) => e.to) }
}
const imuFrameRead = memoBy(
  (a: { amp: number; t: number; hz: number }) => `${a.amp}|${a.t}|${a.hz}`,
  (a: { amp: number; t: number; hz: number }) => imuReadAt(a.amp, a.t, a.hz),
)
const imuSetup = (p: Params) => {
  const amp = (Math.max(0, Math.min(80, n(p, 'tilt'))) * Math.PI) / 180
  const hzKey = pick(IMU_HZ, p.hz, '400')
  return { amp, hz: IMU_HZ[hzKey], hzKey }
}
const imuReadout = memoBy(
  (p: Params) => `${p.tilt}|${p.hz}`,
  (p: Params) => {
    const S = imuSetup(p)
    return imuReadAt(S.amp, 0.6, S.hz)
  },
)
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(1)}°`

export const readingAnImu: Lesson = {
  id: 'i2c-reading-an-imu',
  title: 'Reading an IMU',
  tagline: 'Point at a register, then read 14 bytes in one go',
  formula: (p) => {
    const S = imuSetup(p)
    const r = imuReadout(p)
    return `ax = (AX_H << 8 | AX_L) as int16 / 16384 LSB/g · gyro / 131 LSB per °/s · pitch = atan2(ax, √(ay² + az²)) · 2 + 1 + 14 bytes + ACKs = ${secs(r.s.duration)} at ${S.hzKey} kHz · bus slowed ${Math.round(IMU_REVEAL / r.s.duration).toLocaleString('en')}×, the rocking is not`
  },
  legend: [
    { color: DATA_COLOR, label: 'ESP32 sends: address, register 0x3B', shape: 'dot' },
    { color: CLK_COLOR, label: 'MPU-6050 sends: 14 data bytes', shape: 'dot' },
    { color: POWER, label: 'S start / Sr repeated start, A ack, N nack', shape: 'dot' },
    { color: HIGH_V, label: 'Gravity, and X as the chip sees it', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Sensor chips are a row of numbered registers. To read one you first write its number (the register pointer), then read; the chip steps the pointer on by itself after each byte.',
    'The MPU-6050 keeps accel X/Y/Z, temperature and gyro X/Y/Z at 0x3B–0x48: 14 bytes, high byte first. One burst gets all of them from the same instant.',
    'Between the write and the read the ESP32 sends a repeated START (Sr) instead of STOP, so no other master can grab the bus. In Arduino that is endTransmission(false).',
    'The master ACKs every byte it wants more of and NACKs the last one, then STOP. Each pair joins into a signed 16-bit number: ±2 g = ±32768, so 1 g = 16384.',
    'Tilt the board and gravity leaks from Z into X: ax = sin(pitch), nose up = positive. The gyro reads how fast it turns (°/s), not where it is.',
    'Before the first read, write 0 to PWR_MGMT_1 (0x6B) to wake the chip; it powers up asleep and returns zeros.',
  ],
  controls: [
    { kind: 'slider', key: 'tilt', label: 'Rock ±', min: 0, max: 80, initial: 40, step: 5, format: (v) => `${Math.round(v)}°` },
    {
      kind: 'choice',
      key: 'hz',
      options: [
        { value: '100', label: '100 kHz' },
        { value: '400', label: '400 kHz' },
      ],
      initial: '400',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const sdaY = 6
    const rig = busRig(scene, [-20, 2.2, 0], 0.45, sdaY, 17)
    const px = 14
    const py = 2
    box(scene, [7, 0.8, 3], mat('#2a2c32', { rough: 0.6 }), [px, -1.8, 0])
    box(scene, [0.6, 3.4, 0.6], mat('#4a4e58', { rough: 0.5 }), [px, -0.1, 0])
    const plug = i2cBreakout(scene, [px - 5.5, 0, 0], { k: 0.16, color: '#2a2c32' })
    rig.tap(plug)
    wire(scene, [[px - 5.5, -0.8, 0.3], [px - 0.6, -0.8, 0.3], [px, py, 0.3]], 0.12)
    const pivot = add(scene, new THREE.Group(), [px, py, 0])
    const tilt = add(pivot, new THREE.Group())
    tilt.rotation.x = -1.05
    const imu = i2cBreakout(tilt, [0, 0, 0.3], { name: 'MPU-6050', color: '#2c6e3a', k: 0.32 })
    imu.led(1)
    const xAxis = arrow(tilt, [3.9, -1, 0.6], [1, 0, 0], HIGH_V, 0.7)
    partLetter(tilt, 'X', [5.4, -1, 0.6], 0.5, HIGH_V)
    xAxis.castShadow = false
    arrow(scene, [px + 6.2, py + 0.6, 0], [0, -1, 0], HIGH_V, 0.9)
    partLetter(scene, 'g', [px + 7.2, py + 0.4, 0], 0.6, HIGH_V, 'left')
    const pitchTag = liveLabel(scene, [px + 4.2, -1.8, 0], { size: 0.5, align: 'left' })

    const cellW = 2.1
    const rowY = -4.6
    const x0 = -13.6
    const cellGeo = new THREE.BoxGeometry(cellW * 0.9, 1.2, 0.4)
    const cells = Array.from({ length: 14 }, (_, k) => {
      const m = mat('#1c1e24', { emissive: '#000000' }, true)
      const x = x0 + k * cellW
      add(scene, mesh(cellGeo, m), [x, rowY, 0])
      if (k % 2 === 0) partLetter(scene, `${REG_NAMES[k / 2]}`, [x + cellW / 2, rowY + 1.3, 0], 0.42, GREY)
      return { m, d: liveLabel(scene, [x, rowY - 0.22, 0.3], { size: 0.42 }) }
    })
    partLetter(scene, '0x3B', [x0 - 1.4, rowY + 1.3, 0], 0.4, DATA_COLOR, 'right')
    const vals = REG_NAMES.map((_, k) => liveLabel(scene, [x0 + (2 * k + 0.5) * cellW, rowY - 1.6, 0], { size: 0.45 }))
    const code = codeBlock(scene, [-12, 3.4, 0], 0.4, 5)
    const bus = busCapture(scene, [2.4, -10, 0], 31, 1.5)
    const s = { key: '', t: 0, read: 0, rock: IMU_ROCK_S / 8 }
    const winBits = 30
    return {
      scene,
      view: { center: [0, -2, 0], radius: 86, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = imuSetup(p)
        const key = `${S.amp}|${S.hzKey}`
        if (key !== s.key) Object.assign(s, { key, t: 0, read: s.rock })
        s.rock += dt
        s.t += dt
        if (s.t >= IMU_REVEAL + IMU_HOLD) Object.assign(s, { t: 0, read: s.rock })
        const R = imuFrameRead({ amp: S.amp, t: Math.round(s.read * 20) / 20, hz: S.hz })
        pivot.rotation.z = imuPitch(S.amp, s.rock)
        pitchTag.set(`pitch ${deg(imuPitch(S.amp, s.rock))}`, LABEL)
        const C = R.s
        const prog = Math.min(1, s.t / IMU_REVEAL)
        const head = Math.round(prog * (C.count - 1))
        const span = winBits * PER_BIT
        const i0 = Math.max(0, Math.min(C.count - 1 - span, head - span * 0.75))
        bus.draw(C, i0, i0 + span, head)
        rig.lines(C.scl[head], C.sda[head])
        const reading = R.arrive.some((a) => a > head) && head > R.arrive[0] - 9 * PER_BIT
        imu.chip(CLK_COLOR, reading ? 0.6 : 0)
        cells.forEach((c, k) => {
          const got = R.arrive[k] <= head
          c.m.emissive.set(got ? CLK_COLOR : '#000000')
          c.m.emissiveIntensity = got ? 0.25 : 0
          c.d.set(got ? hex(R.bytes[k], 2) : '', LABEL)
        })
        const P = R.parsed
        const txt = [
          `${signed(P.accel[0], 2)} g`,
          `${signed(P.accel[1], 2)} g`,
          `${signed(P.accel[2], 2)} g`,
          `${P.tempC.toFixed(1)} °C`,
          `${signed(P.gyro[0], 0)} °/s`,
          `${signed(P.gyro[1], 0)} °/s`,
          `${signed(P.gyro[2], 0)} °/s`,
        ]
        vals.forEach((v, k) => v.set(R.arrive[2 * k + 1] <= head ? txt[k] : '', k === 0 ? HIGH_V : LABEL))
        code([
          'Wire.beginTransmission(0x68);',
          'Wire.write(0x3B);  // ACCEL_XOUT_H',
          'Wire.endTransmission(false);  // Sr',
          'Wire.requestFrom(0x68, 14);',
          'int16_t ax = Wire.read() << 8 | Wire.read();',
        ])
      },
      readouts: (p) => {
        const R = imuReadout(p)
        const ax = R.parsed.raw[0]
        return [
          { label: 'AX bytes', value: `${hex(R.bytes[0], 2)} ${hex(R.bytes[1], 2)} = ${signed(ax, 0)}` },
          { label: 'Pitch from accel', value: deg(accelPitch(R.parsed.accel)), tone: Math.abs(accelPitch(R.parsed.accel) - R.pitch) < 1e-3 ? 'ok' : 'warn' },
          { label: 'Gyro Y', value: `${signed(R.parsed.gyro[1], 1)} °/s` },
          { label: 'Burst read', value: secs(R.s.duration) },
        ]
      },
    }
  },
}

// --- Bus scan: probe every address 0x08–0x77 with an empty write and list who ACKs. ---

const SC_HZ = 100e3
const SC_STEP_S = 0.12
const SC_HOLD = 3
const SC_BUSES = {
  two: [0x3c, 0x68],
  four: [0x3c, 0x68, 0x69, 0x76],
  empty: [] as number[],
}
const SC_BOARDS = [
  { addr: 0x3c, name: 'SSD1306', color: '#1f4fae' },
  { addr: 0x68, name: 'MPU-6050', color: '#2c6e3a' },
  { addr: 0x69, name: 'MPU-6050', color: '#2c6e3a' },
  { addr: 0x76, name: 'BMP280', color: '#5b2a86' },
]
const SC_FIRST_OF = (k: number) => SCAN_FIRST + k
const scSetup = (p: Params) => {
  const which = pick(SC_BUSES, p.bus, 'four')
  const present = SC_BUSES[which]
  return { which, present, ...i2cScan(present) }
}

export const busScan: Lesson = {
  id: 'i2c-bus-scan',
  title: 'Bus scan',
  tagline: 'Knock on every address and see who answers',
  formula: (p) => {
    const s = scSetup(p)
    return `${s.probes.length} addresses (0x08–0x77) × ${secs(probeTime(SC_HZ))} (START + 8 bits + ACK + STOP at 100 kHz) = ${secs(s.probes.length * probeTime(SC_HZ))} of bus time · found ${s.found.length} · slowed ${Math.round(SC_STEP_S / probeTime(SC_HZ)).toLocaleString('en')}×`
  },
  legend: [
    { color: RING, label: 'Address being probed', shape: 'dot' },
    { color: POWER, label: 'ACK: a device is there', shape: 'dot' },
    { color: GREY, label: '-- NACK, blank = reserved', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A scanner sends each address with an empty write: START, address + W, then STOP. If something pulls SDA low in the ACK slot, a device lives there.',
    'Only 0x08–0x77 are probed. 0x00–0x07 and 0x78–0x7F are reserved (general call, 10-bit addressing, high-speed mode), so 112 tries cover the bus in about 13 ms.',
    'The grid is the classic i2cdetect layout: rows of 16, the row gives the high digit, the column the low one. Two MPU-6050s show up at 0x68 and 0x69 only because one has AD0 tied high.',
    'An empty scan means wiring: SDA and SCL swapped, no pull-ups, no power or no common ground, before you blame the code. A device at every address usually means a line stuck low.',
    'Some chips ignore an empty write or need waking first, so a scan proves the bus works, not that every sensor is ready. For the addresses themselves, see Addresses.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'bus',
      options: [
        { value: 'two', label: 'OLED + IMU' },
        { value: 'four', label: '4 boards' },
        { value: 'empty', label: 'SDA/SCL swapped' },
      ],
      initial: 'four',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const sdaY = 7.5
    const rig = busRig(scene, [-21, 4, 0], 0.42, sdaY, 17)
    const boards = SC_BOARDS.map((b, i) => {
      const x = -8 + i * 6.4
      const bk = i2cBreakout(scene, [x, 4, 0], { name: b.name, color: b.color, k: 0.24 })
      rig.tap(bk)
      return { bk, tag: liveLabel(scene, [x, 1.3, 0], { size: 0.45 }) }
    })
    const cw = 1.55
    const ch = 1.3
    const gx = -9.4
    const gy = -1.8
    const cellGeo = new THREE.BoxGeometry(cw * 0.9, ch * 0.86, 0.35)
    const cells = Array.from({ length: 128 }, (_, a) => {
      const m = mat('#1a1c22', { emissive: '#000000' }, true)
      const at: V3 = [gx + (a % 16) * cw, gy - Math.floor(a / 16) * ch, 0]
      const c = add(scene, mesh(cellGeo, m), at)
      c.castShadow = false
      return { m, d: liveLabel(scene, [at[0], at[1] - 0.18, 0.3], { size: 0.38 }) }
    })
    for (let c = 0; c < 16; c++) partLetter(scene, c.toString(16).toUpperCase(), [gx + c * cw, gy + 1.2, 0], 0.42, GREY)
    for (let r = 0; r < 8; r++) partLetter(scene, `${r}0:`, [gx - 1.1, gy - r * ch, 0], 0.42, GREY, 'right')
    const cursorMat = glowMat(RING, 0.9)
    const cursor = add(scene, mesh(new THREE.BoxGeometry(cw, ch, 0.2), cursorMat))
    cursor.castShadow = false
    partLetter(scene, 'Serial monitor', [16.5, gy + 1.2, 0], 0.45, GREY, 'left')
    const monitor = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [16.5, gy - 0.4 - i * 1.1, 0], { size: 0.48, align: 'left' }))
    const code = codeBlock(scene, [-25, -0.8, 0], 0.38, 5)
    const status = liveLabel(scene, [0, gy - 8 * ch - 0.3, 0], { size: 0.5 })
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -1.5, 0], radius: 86, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = scSetup(p)
        if (S.which !== s.key) Object.assign(s, { key: S.which, t: 0 })
        const total = S.probes.length * SC_STEP_S + SC_HOLD
        s.t = (s.t + dt) % total
        const k = Math.min(S.probes.length, Math.floor(s.t / SC_STEP_S))
        const scanning = k < S.probes.length
        const cur = scanning ? S.probes[k].addr : -1
        const phase = (s.t / SC_STEP_S) % 1
        cells.forEach((c, a) => {
          const res = isReserved(a)
          const done = !res && a < SC_FIRST_OF(k)
          const hit = S.present.includes(a)
          c.m.emissive.set(done && hit ? POWER : '#000000')
          c.m.emissiveIntensity = done && hit ? 0.4 : 0
          c.d.set(res ? '' : done || a === cur ? (hit && (done || phase > 0.5) ? hex(a, 2) : '--') : '', hit && (done || phase > 0.5) ? LABEL : GREY)
        })
        cursor.visible = scanning
        if (scanning) cursor.position.set(gx + (cur % 16) * cw, gy - Math.floor(cur / 16) * ch, -0.15)
        const ack = scanning && S.present.includes(cur) && phase > 0.5
        setGlow(cursorMat, ack ? POWER : RING, 0.9)
        rig.lines(1, scanning && phase > 0.15 && phase < 0.85 ? (ack ? 0 : 1) : 1)
        boards.forEach((b, i) => {
          const a = SC_BOARDS[i].addr
          const on = S.present.includes(a)
          b.bk.group.visible = on || S.which === 'empty'
          b.bk.led(1)
          b.bk.chip(POWER, on && cur === a && phase > 0.5 ? 0.9 : 0)
          b.tag.set(on ? hexByte(a) : S.which === 'empty' ? 'not reached' : 'unplugged', on ? (S.found.includes(a) && a < SC_FIRST_OF(k) ? POWER : LABEL) : GREY)
        })
        const shown = S.found.filter((a) => a < SC_FIRST_OF(k) || (a === cur && phase > 0.5))
        const lines = ['Scanning…', ...shown.map((a) => `found ${hexByte(a)}`)]
        if (!scanning) lines.push(S.found.length ? `${S.found.length} devices` : 'no devices found')
        monitor.forEach((m, i) => m.set(lines[i] ?? '', i === 0 ? GREY : lines[i]?.startsWith('found') ? POWER : S.found.length ? LABEL : HIGH_V))
        status.set(scanning ? `probing ${hexByte(cur)} · ${k + 1} / ${S.probes.length}` : 'scan done', scanning ? RING : LABEL)
        code([
          `for (byte a = ${hexByte(SCAN_FIRST)}; a <= ${hexByte(SCAN_LAST)}; a++) {`,
          '  Wire.beginTransmission(a);',
          '  if (Wire.endTransmission() == 0)',
          '    Serial.printf("found 0x%02X\\n", a);',
          '}',
        ])
      },
      readouts: (p) => {
        const S = scSetup(p)
        return [
          { label: 'Probes', value: `${S.probes.length} × ${secs(probeTime(SC_HZ))}` },
          { label: 'Found', value: S.found.length ? S.found.map(hexByte).join(' ') : 'nothing: check wiring', tone: S.found.length ? 'ok' : 'bad' },
          { label: 'Scan time', value: `${secs(S.probes.length * probeTime(SC_HZ))} on the bus` },
        ]
      },
    }
  },
}
