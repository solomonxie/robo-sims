import * as THREE from 'three/webgpu'
import {
  BitRole,
  FORMAT_8N1,
  GgaParsed,
  LINE_STDS,
  RS485_CM,
  RxFrame,
  SerialStd,
  TWIST_RESIDUAL,
  UartBit,
  UartFormat,
  baudTolerance,
  frameLength,
  lineGain,
  lineTau,
  motorNoise,
  nmeaGga,
  nmeaRmc,
  parseGga,
  pickupVolts,
  sampleDrift,
  serialLink,
  uartBits,
  txBitAt,
  uartReceive,
  uartStream,
} from '../../core/physics'
import { hasGlyph } from '../../core/strokeFont'
import { hexByte, secs, volts } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  captureScreen,
  codeBlock,
  esp32Board,
  glowMat,
  litWire,
  liveLabel,
  memoBy,
  motorCan,
  scope,
  partLetter,
  potentialColor,
  setGlow,
  signalWire,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const pctText = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x * 100).toFixed(1)} %`
const charText = (b: number) => (b === 32 ? '_' : b > 32 && b < 127 && hasGlyph(String.fromCharCode(b)) ? String.fromCharCode(b) : '?')
const ROLE_COLOR: Record<BitRole | 'idle', string> = { start: LOW_V, data: LABEL, parity: DATA_COLOR, stop: HEAT, idle: GREY }
const roleTag = (role: BitRole | 'idle', k: number) => (role === 'start' ? 'ST' : role === 'data' ? `${k - 1}` : role === 'parity' ? 'P' : role === 'stop' ? 'SP' : '')

/** Two ESP32s, TX pin of one to RX pin of the other, plus a ground wire. Returns the pin tips. */
function boardPair(parent: THREE.Object3D, x: number, y: number, k: number) {
  const tx = esp32Board(parent, [-x, y, 0], k)
  const rx = esp32Board(parent, [x, y, 0], k)
  partLetter(parent, 'ESP32 A', [-x, y - 3.6 * k * 2, 0], 0.6, LABEL)
  partLetter(parent, 'ESP32 B', [x, y - 3.6 * k * 2, 0], 0.6, LABEL)
  return { tx: tx(5, true), rx: rx(-5, true), gndA: tx(-6, false), gndB: rx(6, false) }
}

// --- Framing and baud: start/data/parity/stop bits slide TX → RX; the receiver's own clock decides where it samples. ---

const TX_BAUD = 9600
const MSG = [...'Hi!'].map((c) => c.charCodeAt(0))
const GAP = 2
const BIT_REAL_S = 0.2
const FB_SLOW = BIT_REAL_S * TX_BAUD
const FORMATS: Record<string, UartFormat> = {
  '8N1': { parity: 'none', stop: 1 },
  '8E1': { parity: 'even', stop: 1 },
  '8O1': { parity: 'odd', stop: 1 },
  '8N2': { parity: 'none', stop: 2 },
}
const RX_BAUDS = { '4800': 4800, '9600': 9600, '9888': 9888, '10560': 10560, '19200': 19200 } as const
const FB = { wireY: 7.4, x0: -11, x1: 11, cell: 1.7, boardX: 15, boardY: 3.2, k: 0.45 }
const WIRE_BITS = (FB.x1 - FB.x0) / FB.cell

const fbSetup = (p: Params) => {
  const fmt = pick(FORMATS, p.fmt, '8N1')
  const f = FORMATS[fmt]
  const rxBaud = RX_BAUDS[pick(RX_BAUDS, p.rx, '9600')]
  return { fmt, f, rxBaud, n: frameLength(f), err: rxBaud / TX_BAUD - 1 }
}
const fbLink = memoBy(
  (p: Params) => `${p.fmt}|${p.rx}`,
  (p: Params) => {
    const s = fbSetup(p)
    const stream = uartStream(MSG, TX_BAUD, s.f, GAP)
    const rx = uartReceive(stream.level, s.rxBaud, s.f, stream.duration)
    const slots = rx.map((r) => {
      const home = txBitAt(stream.starts, TX_BAUD, r.start + 0.5 / TX_BAUD).frame
      return r.at.map((t, k) => {
        const at = txBitAt(stream.starts, TX_BAUD, t)
        return at.frame === home && at.bit === k
      })
    })
    const ok = rx.map((r, i) => r.framingOk && r.parityOk && r.byte === MSG[i] && rx.length === MSG.length)
    return { ...s, stream, rx, slots, ok }
  },
)

export const framingAndBaud: Lesson = {
  id: 'uart-serial-framing-and-baud',
  title: 'Framing and baud',
  tagline: 'No clock wire: both ends must agree on the speed',
  formula: (p) => {
    const s = fbSetup(p)
    const extra = s.f.parity === 'none' ? '' : ' + 1 parity'
    return `bit = 1 / ${TX_BAUD} = ${secs(1 / TX_BAUD)} · ${s.fmt} = 1 start + 8 data${extra} + ${s.f.stop} stop = ${s.n} bits = ${secs(s.n / TX_BAUD)} · RX at ${s.rxBaud} (${pctText(s.err)}): last sample ${Math.abs(sampleDrift(TX_BAUD, s.rxBaud, s.n - 1)).toFixed(2)} bit off centre (fails past 0.5 → ±${(baudTolerance(s.f) * 100).toFixed(1)} %) · slowed ${FB_SLOW}×`
  },
  legend: [
    { color: LOW_V, label: 'ST start bit (0), then data 0–7, LSB first', shape: 'dot' },
    { color: DATA_COLOR, label: 'P parity bit', shape: 'dot' },
    { color: HEAT, label: 'SP stop bit (1)', shape: 'dot' },
    { color: POWER, label: 'RX sample: green in its bit, red slipped', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'UART sends one bit at a time on a single wire, with no clock wire. The line idles high; a falling edge (the start bit) tells the receiver a byte is coming.',
    'Then 8 data bits, least significant first, an optional parity bit, and 1 or 2 stop bits back high. "8N1" = 8 data, no parity, 1 stop: 10 bits per byte, so 9600 baud carries 960 bytes/s.',
    'The receiver times everything from that start edge with its own clock, sampling the middle of each bit (it watches the line 16× per bit to find the edge).',
    'If the two clocks disagree, each sample slides a little further from its bit centre. By the stop bit the slip is 9.5 × the error; past half a bit (≈ ±5 % for 8N1) it reads the neighbouring bit and the byte comes out wrong, or the stop bit reads 0: a framing error.',
    'Parity counts the 1s (even or odd). A single flipped bit breaks the count, so the receiver can flag the byte; two flips slip through.',
    'Each start edge resynchronises the receiver, so small errors never add up across bytes. To see these frames on a scope, see Oscilloscope → Decoding a bus.',
  ],
  controls: [
    { kind: 'choice', key: 'fmt', options: Object.keys(FORMATS).map((k) => ({ value: k, label: k })), initial: '8N1' },
    {
      kind: 'choice',
      key: 'rx',
      options: [
        { value: '4800', label: 'RX 4800' },
        { value: '9600', label: 'RX 9600' },
        { value: '9888', label: 'RX +3 %' },
        { value: '10560', label: 'RX +10 %' },
        { value: '19200', label: 'RX 19200' },
      ],
      initial: '9600',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const pins = boardPair(scene, FB.boardX, FB.boardY, FB.k)
    signalWire(scene, [pins.tx, [pins.tx[0], FB.wireY, 0], [FB.x0, FB.wireY, 0]])(1)
    const rxWire = signalWire(scene, [[FB.x1, FB.wireY, 0], [pins.rx[0], FB.wireY, 0], pins.rx])
    wire(scene, [[FB.x0, FB.wireY, -0.4], [FB.x1, FB.wireY, -0.4]], 0.12)
    wire(scene, [pins.gndA, [pins.gndA[0], FB.boardY - 4.2, 0], [pins.gndB[0], FB.boardY - 4.2, 0], pins.gndB], 0.16)
    partLetter(scene, 'GND', [0, FB.boardY - 3.6, 0], 0.5, GREY)
    partLetter(scene, 'TX', [pins.tx[0] + 0.9, pins.tx[1] + 0.9, 0], 0.55, RING, 'left')
    partLetter(scene, 'RX', [pins.rx[0] - 0.9, pins.rx[1] + 0.9, 0], 0.55, RING, 'right')
    const tokenGeo = new THREE.BoxGeometry(FB.cell * 0.88, 0.7, 0.7)
    const tokens = Array.from({ length: Math.ceil(WIRE_BITS) + 2 }, () => {
      const m = glowMat(GREY, 0.8)
      const t = add(scene, mesh(tokenGeo, m))
      t.castShadow = false
      return { t, m, tag: liveLabel(scene, [0, FB.wireY - 1.7, 0], { size: 0.5 }) }
    })
    const txTag = liveLabel(scene, [-FB.boardX, FB.boardY - 5.2, 0], { size: 0.55, color: RING })
    const rxTag = liveLabel(scene, [FB.boardX, FB.boardY - 5.2, 0], { size: 0.55, color: RING })

    const regAt: V3 = [-2.6, 2.8, 0]
    partLetter(scene, 'RX samples', [regAt[0], regAt[1] + 1.2, 0], 0.5, GREY)
    const regGeo = new THREE.BoxGeometry(1, 1, 0.4)
    const reg = Array.from({ length: 12 }, (_, k) => {
      const m = mat('#1c1e24', { emissive: '#000000' }, true)
      const c = add(scene, mesh(regGeo, m), [regAt[0] - 5.8 + k * 1.15, regAt[1], 0])
      return { c, m, d: liveLabel(scene, [c.position.x, regAt[1] - 0.25, 0.3], { size: 0.45 }) }
    })
    partLetter(scene, 'monitor', [regAt[0] + 10.6, regAt[1] + 1.2, 0], 0.5, GREY)
    const monitor = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [regAt[0] + 7.8 + i * 1.1, regAt[1] - 0.35, 0], { size: 0.7 }))

    const code = codeBlock(scene, [-18.5, -3.3, 0], 0.5, 5)
    const cap = captureScreen(scene, [1.5, -11.6, 0], [{ label: 'TX', color: HIGH_V }], { width: 32, rowH: 2.6, decoder: true })
    const trace = cap.channel(0, { samples: 400 })
    const dotGeo = new THREE.SphereGeometry(0.26, 12, 8)
    const dots = Array.from({ length: 12 }, () => {
      const m = glowMat(POWER, 1.2)
      const d = add(cap.group, mesh(dotGeo, m))
      d.castShadow = false
      return { d, m }
    })
    const c = new THREE.Color()
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, -1, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const L = fbLink(p)
        if (L.fmt + L.rxBaud !== s.key) Object.assign(s, { key: L.fmt + L.rxBaud, t: 0 })
        const T = L.stream.duration
        s.t = (s.t + dt / FB_SLOW) % T
        const slotBits = L.n + GAP
        const total = MSG.length * slotBits
        const delay = WIRE_BITS / TX_BAUD
        const j0 = Math.floor((s.t - delay) * TX_BAUD) - 1
        tokens.forEach((tk, i) => {
          const j = j0 + i
          const x = FB.x0 + (s.t * TX_BAUD - (j + 0.5)) * FB.cell
          const on = x >= FB.x0 + FB.cell * 0.4 && x <= FB.x1 - FB.cell * 0.4
          tk.t.visible = on
          const jj = ((j % total) + total) % total
          const k = jj % slotBits
          const b = L.stream.frames[Math.floor(jj / slotBits)][k] as UartBit | undefined
          const role: BitRole | 'idle' = b?.role ?? 'idle'
          const bit = b?.bit ?? 1
          tk.t.position.set(x, FB.wireY + (bit ? 0.55 : -0.55), 0.2)
          tk.t.scale.y = role === 'idle' ? 0.35 : 1
          potentialColor(bit, c)
          if (role === 'idle') c.set(GREY)
          tk.m.color.copy(c)
          tk.m.emissive.copy(c)
          tk.tag.group.position.x = x
          tk.tag.set(on ? roleTag(role, k) : '', ROLE_COLOR[role])
        })
        const tr = (s.t - delay + T) % T
        rxWire(L.stream.level(tr))
        const tx = txBitAt(L.stream.starts, TX_BAUD, s.t)
        txTag.set(tx.bit >= 0 && tx.bit < L.n ? `sending '${charText(MSG[tx.frame])}'` : 'idle')

        const cur = L.rx.reduce((a, r, i) => (r.start <= tr ? i : a), -1)
        const fr: RxFrame | undefined = L.rx[cur]
        const doneAt = (r: RxFrame) => r.at[r.at.length - 1] <= tr
        rxTag.set(fr && !doneAt(fr) ? `sampling at ${L.rxBaud}` : 'waiting for start', fr && !doneAt(fr) ? RING : GREY)
        reg.forEach((r, k) => {
          const exists = k < L.n
          r.c.visible = exists
          const seen = !!fr && exists && fr.at[k] <= tr
          const good = seen && L.slots[cur][k]
          r.m.emissive.set(seen ? (good ? POWER : HIGH_V) : '#000000')
          r.m.emissiveIntensity = seen ? 0.35 : 0
          r.d.set(seen ? String(fr.bits[k]) : '', LABEL)
        })
        monitor.forEach((m, i) => {
          const r = L.rx[i]
          m.set(r && doneAt(r) ? (r.framingOk && r.parityOk ? charText(r.byte) : '×') : '', L.ok[i] ? POWER : HIGH_V)
        })

        const win0 = fr ? fr.start - 1 / TX_BAUD : tr - 1 / TX_BAUD
        const win = (L.n + 3) / TX_BAUD
        const uOf = (t: number) => (t - win0) / win
        const head = Math.min(1, uOf(tr))
        trace.draw((u) => L.stream.level(win0 + Math.min(u, head) * win), head < 1 ? head : null)
        dots.forEach((d, k) => {
          const t = fr?.at[k]
          const on = t !== undefined && t <= tr && uOf(t) <= 1
          d.d.visible = on
          if (!on) return
          d.d.position.set(cap.xAt(uOf(t)), cap.yOf(0, fr.bits[k]), 0.45)
          const col = L.slots[cur][k] ? POWER : HIGH_V
          d.m.color.set(col)
          d.m.emissive.set(col)
        })
        const segs: { u0: number; u1: number; text: string; color: string }[] = []
        const first = Math.ceil(win0 * TX_BAUD)
        for (let j = first; j / TX_BAUD < win0 + win; j++) {
          const u0 = uOf(j / TX_BAUD)
          const u1 = Math.min(1, uOf((j + 1) / TX_BAUD))
          if (u0 > head) break
          const jj = ((j % total) + total) % total
          const k = jj % slotBits
          const b = L.stream.frames[Math.floor(jj / slotBits)][k] as UartBit | undefined
          if (b) segs.push({ u0: Math.max(0, u0), u1, text: roleTag(b.role, k), color: ROLE_COLOR[b.role] })
        }
        cap.annotate(segs)
        code([
          `Serial.begin(${TX_BAUD}, SERIAL_${L.fmt});  // A`,
          'Serial.print("Hi!");',
          `Serial2.begin(${L.rxBaud}, SERIAL_${L.fmt});  // B`,
          'while (Serial2.available())',
          '  Serial.write(Serial2.read());',
        ])
      },
      readouts: (p) => {
        const L = fbLink(p)
        const tol = baudTolerance(L.f)
        const good = L.ok.filter(Boolean).length
        const hex = L.rx.slice(0, 3).map((r) => hexByte(r.byte)).join(' ') + (L.rx.length > 3 ? ' …' : '')
        return [
          { label: 'Bit time', value: secs(1 / TX_BAUD) },
          { label: 'Frame', value: `${L.n} bits · ${secs(L.n / TX_BAUD)}` },
          { label: 'RX clock', value: pctText(L.err), tone: Math.abs(L.err) < tol * 0.7 ? 'ok' : Math.abs(L.err) < tol ? 'warn' : 'bad' },
          { label: 'Received', value: good === MSG.length ? '"Hi!" intact' : `${L.rx.length} bytes, ${good} right · ${hex}`, tone: good === MSG.length ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Level and noise: the same bits as 3.3 V TTL, ±9 V RS-232 or an RS-485 pair, down a long cable past a motor. ---

const LN_BAUD = 115200
const LN_MSG = [...'UART'].map((c) => c.charCodeAt(0))
const LN_FRAME = 11
const LN_BITS = [1, 1, ...LN_MSG.flatMap((b) => [...uartBits(b).map((x) => x.bit), 1])]
const LN_PER_BIT = 32
const LN_WIN = 12
const LN_BIT_REAL_S = 0.2
const LN_SLOW = LN_BIT_REAL_S * LN_BAUD
const LN_SCALE: Record<SerialStd, [number, number]> = { ttl: [1.65, 4], rs232: [0, 14], rs485: [2, 8] }
const STD_NAME: Record<SerialStd, string> = { ttl: 'TTL 3.3 V', rs232: 'RS-232', rs485: 'RS-485' }
const XCVR: Record<SerialStd, string> = { ttl: '', rs232: 'MAX3232', rs485: 'MAX485' }
const STDS = { ttl: 'ttl', rs232: 'rs232', rs485: 'rs485' } as const
const LN = { y: 6.4, x0: -9, x1: 9, beads: 22, twist: 0.5 }

const lnLink = memoBy(
  (p: Params) => `${p.std}|${p.len}|${p.noise}`,
  (p: Params) => {
    const std = STDS[pick(STDS, p.std, 'ttl')]
    const len = n(p, 'len')
    const noiseV = n(p, 'noise')
    const link = serialLink(std, len, noiseV, LN_BITS, LN_BAUD, LN_PER_BIT)
    const got = LN_MSG.map((_, i) => link.read.slice(3 + i * LN_FRAME, 11 + i * LN_FRAME).reduce<number>((a, b, k) => a + b * 2 ** k, 0))
    return { std, len, noiseV, link, got, tau: lineTau(std, len), gain: lineGain(std, len), pick: pickupVolts(noiseV, len) }
  },
)
const lnCode: Record<SerialStd, string[]> = {
  ttl: ['Serial2.begin(115200, SERIAL_8N1, 16, 17);', '// pins straight to the cable: 0 / 3.3 V', '// fine across a PCB, not across a room', 'Serial2.print("UART");'],
  rs232: ['Serial2.begin(115200, SERIAL_8N1, 16, 17);', '// MAX3232 pumps ±9 V, inverted:', '// idle (1) = −9 V, 0 = +9 V', 'Serial2.print("UART");'],
  rs485: ['digitalWrite(DE, HIGH);  // MAX485 talks', 'Serial2.print("UART"); Serial2.flush();', 'digitalWrite(DE, LOW);   // back to listening', '// A − B = ±2.5 V, 120 Ω at each end'],
}

export const levelAndNoise: Lesson = {
  id: 'uart-serial-level-and-noise',
  title: 'Level and noise',
  tagline: 'Same bits, three ways to put them on a cable',
  formula: (p) => {
    const L = lnLink(p)
    const s = LINE_STDS[L.std]
    const sw = `${s.diff ? 'A − B' : 'line'} = ${volts(s.mark * L.gain)} / ${volts(s.space * L.gain)}`
    const nz = s.diff ? `${volts(L.pick)} hits A and B alike, ${volts(L.pick * TWIST_RESIDUAL)} survives the subtraction` : `${volts(L.pick)} noise rides on the line`
    return `${STD_NAME[L.std]}: ${sw} vs threshold ${volts(s.threshold)} ± ${volts(s.band / 2)} · ${nz} · edge τ = ${s.rOut} Ω × 100 pF/m × ${Math.round(L.len)} m = ${secs(L.tau)} (bit ${secs(1 / LN_BAUD)}) · slowed ${LN_SLOW}×`
  },
  legend: [
    { color: HIGH_V, label: 'Wire level: red high, blue low', shape: 'dot' },
    { color: RING, label: 'Receiver input; dashes = threshold band', shape: 'dot' },
    { color: GREY, label: 'RS-485: wire A alone, noise and all', shape: 'dot' },
    { color: HEAT, label: 'Motor noise coupling into the cable', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An ESP32 UART pin swings 0 to 3.3 V against ground (TTL level). The receiver splits at about half, so noise over ~1 V, or a ground that shifts between the two ends, flips bits. Keep it to a PCB or a short lead.',
    'RS-232 (old PC COM ports) adds a MAX3232 that pumps the swing to about ±9 V, inverted: idle 1 is negative. Big margins, but still one wire against ground, and its slow driver rounds the edges on a long cable: rated about 15 m.',
    'RS-485 sends each bit on a twisted pair as A − B = ±2.5 V. A motor’s noise lands on both wires almost equally, and the receiver only looks at the difference, so ±200 mV is enough to decide. Twisting keeps the pickup equal.',
    'That is why RS-485 runs 1200 m and links many devices (Modbus, DMX, robot arms). Long runs need 120 Ω at each end; copper resistance then shrinks the swing, so watch the margin.',
    'RS-485 is half duplex on one pair: drive DE high to talk, low to listen. For TTL thresholds and 3.3 V ↔ 5 V shifting, see Level shifting → Logic thresholds.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'std',
      options: [
        { value: 'ttl', label: 'TTL 3.3 V' },
        { value: 'rs232', label: 'RS-232' },
        { value: 'rs485', label: 'RS-485' },
      ],
      initial: 'ttl',
    },
    { kind: 'slider', key: 'len', label: 'Cable', min: 1, max: 1200, initial: 20, log: true, format: (v) => `${Math.round(v)} m` },
    { kind: 'slider', key: 'noise', label: 'Motor noise', min: 0, max: 8, initial: 3, step: 0.5, format: (v) => `${v} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const chip = (x: number) => {
      const g = add(scene, new THREE.Group(), [x, LN.y, 0])
      box(g, [3.4, 2.2, 0.8], mat('#1c1d22', { rough: 0.6 }))
      return { g, tag: liveLabel(g, [0, -0.25, 0.5], { size: 0.45, color: LABEL }) }
    }
    const mcu = (x: number, name: string) => {
      box(scene, [3.6, 3, 0.8], mat('#2a2d36', { rough: 0.6 }), [x, LN.y, 0])
      partLetter(scene, name, [x, LN.y - 2.4, 0], 0.5, LABEL)
      partLetter(scene, 'ESP32', [x, LN.y - 0.3, 0.5], 0.5, GREY)
    }
    mcu(-16, 'TX')
    mcu(16, 'RX')
    const xa = chip(-12)
    const xb = chip(12)
    const stub = (a: number, b: number) => signalWire(scene, [[a, LN.y, 0], [b, LN.y, 0]])
    const inWire = stub(-14.2, -13.7)
    const outWire = stub(13.7, 14.2)
    const single = add(scene, new THREE.Group())
    wire(single, [[LN.x0 - 1.3, LN.y + 0.45, 0], [LN.x1 + 1.3, LN.y + 0.45, 0]], 0.16)
    wire(single, [[LN.x0 - 1.3, LN.y - 0.45, 0], [LN.x1 + 1.3, LN.y - 0.45, 0]], 0.16)
    const helix = (ph: number): V3[] =>
      Array.from({ length: 121 }, (_, i) => {
        const x = LN.x0 - 1.3 + (i / 120) * (LN.x1 - LN.x0 + 2.6)
        const a = ph + x * 1.6
        return [x, LN.y + LN.twist * Math.cos(a), LN.twist * Math.sin(a)]
      })
    const pair = add(scene, new THREE.Group())
    wire(pair, helix(0), 0.14)
    wire(pair, helix(Math.PI), 0.14)
    const lenTag = liveLabel(scene, [0, LN.y + 1.6, 0], { size: 0.55, color: LABEL })
    const beadGeo = new THREE.SphereGeometry(0.3, 10, 8)
    const beads = Array.from({ length: LN.beads * 2 }, () => {
      const m = glowMat(HIGH_V, 1)
      const b = add(scene, mesh(beadGeo, m))
      b.castShadow = false
      return { b, m }
    })
    const motor = motorCan(scene, [0, LN.y - 4.6, 0], { r: 1.1, legs: 0.4 })
    const sparks = [-3.5, 0, 3.5].map((dx) =>
      litWire(scene, [[dx * 0.3, LN.y - 3.4, 0.6], [dx * 0.55 + 0.4, LN.y - 2.5, 0.6], [dx * 0.75 - 0.3, LN.y - 1.6, 0.6], [dx, LN.y - 0.7, 0.6]], 0.09),
    )

    const SW = 26
    const SH = 8.4
    const sc = scope(scene, SW, SH, { divs: [12, 8] })
    sc.group.position.set(1.2, -9.8, 0)
    const rxTrace = sc.trace(RING, { samples: 320, radius: 0.1 })
    const aTrace = sc.trace(GREY, { samples: 320, radius: 0.06 })
    const hi = sc.level(RING)
    const lo = sc.level(RING)
    const scopeTag = liveLabel(scene, [1.2 - SW / 2, -9.8 + SH / 2 + 1.1, 0], { size: 0.45, color: GREY, align: 'left' })
    const scaleTag = liveLabel(scene, [1.2 + SW / 2, -9.8 + SH / 2 + 1.1, 0], { size: 0.45, color: GREY, align: 'right' })
    const code = codeBlock(scene, [-18.5, 0.6, 0], 0.48, 4)
    partLetter(scene, 'sent', [8.6, 1.2, 0], 0.45, GREY, 'right')
    partLetter(scene, 'got', [8.6, -0.4, 0], 0.45, GREY, 'right')
    const sent = LN_MSG.map((b, i) => liveLabel(scene, [9.8 + i * 1.5, 0.95, 0], { size: 0.65, color: LABEL }))
    const got = LN_MSG.map((_, i) => liveLabel(scene, [9.8 + i * 1.5, -0.65, 0], { size: 0.65 }))
    const c = new THREE.Color()
    const s = { key: '', bit: 0, wall: 0 }
    return {
      scene,
      view: { center: [0, -1, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const L = lnLink(p)
        const S = LINE_STDS[L.std]
        if (L.std !== s.key) Object.assign(s, { key: L.std, bit: 0 })
        s.bit += dt / LN_BIT_REAL_S
        s.wall += dt
        const diff = S.diff
        single.visible = !diff
        pair.visible = diff
        xa.g.visible = xb.g.visible = L.std !== 'ttl'
        xa.tag.set(XCVR[L.std])
        xb.tag.set(XCVR[L.std])
        lenTag.set(`${Math.round(L.len)} m · ${diff ? 'twisted pair A / B' : 'signal + GND'}`)
        const tSim = s.bit / LN_BAUD
        const total = LN_BITS.length
        const bitAt = (b: number) => LN_BITS[((Math.floor(b) % total) + total) % total]
        inWire(bitAt(s.bit))
        outWire(bitAt(s.bit - LN.beads * 0.5))
        const nz = L.noiseV ? motorNoise(tSim) * Math.min(1, L.pick / (S.diff ? 3 : Math.abs(S.mark - S.space) / 2)) : 0
        beads.forEach((bd, i) => {
          const wireB = i >= LN.beads
          const f = ((i % LN.beads) + 0.5) / LN.beads
          const x = LN.x0 + f * (LN.x1 - LN.x0)
          const bit = bitAt(s.bit - f * LN.beads * 0.5)
          const on = diff || !wireB
          bd.b.visible = on
          if (!on) return
          const jig = nz * 0.7 * Math.sin(x * 0.9 + s.wall * 30)
          if (diff) {
            const a = (wireB ? Math.PI : 0) + x * 1.6
            bd.b.position.set(x, LN.y + LN.twist * Math.cos(a) + jig, LN.twist * Math.sin(a) + 0.15)
          } else bd.b.position.set(x, LN.y + 0.45 + jig, 0.2)
          potentialColor(wireB ? 1 - bit : bit, c)
          bd.m.color.copy(c)
          bd.m.emissive.copy(c)
        })
        motor.spin(dt, 300 * Math.min(1, L.noiseV / 4 + 0.2))
        sparks.forEach((sp, k) => sp.set(L.noiseV > 0 ? (0.4 + 0.6 * Math.abs(motorNoise(s.wall * 0.03 + k * 1e-3))) * Math.min(1, L.noiseV / 4) : 0, c.set(HEAT)))

        const frame = Math.floor(s.bit / (LN_WIN + 2)) % LN_MSG.length
        const head = Math.min(1, (s.bit % (LN_WIN + 2)) / LN_WIN)
        const b0 = 2 + frame * LN_FRAME - 1
        const [vc, vh] = LN_SCALE[L.std]
        const yOf = (v: number) => ((v - vc) / vh) * (SH / 2)
        const sample = (arr: number[], u: number) => arr[Math.min(arr.length - 1, Math.floor((b0 + Math.min(u, head) * LN_WIN) * LN_PER_BIT))]
        rxTrace.draw((u) => yOf(sample(L.link.rx, u)), head < 1 ? head : null)
        aTrace.group.visible = diff
        if (diff) aTrace.draw((u) => yOf(RS485_CM + sample(L.link.rx, u) / 2 + sample(L.link.cm, u) - RS485_CM), null)
        hi.set(yOf(S.threshold + S.band / 2))
        lo.set(yOf(S.threshold - S.band / 2))
        scopeTag.set(diff ? `RX input A − B · byte '${String.fromCharCode(LN_MSG[frame])}'` : `RX input · byte '${String.fromCharCode(LN_MSG[frame])}'`)
        scaleTag.set(`${vh / 4} V/div · ${secs(1 / LN_BAUD)} per bit`)
        sent.forEach((t, i) => t.set(String.fromCharCode(LN_MSG[i]), i === frame ? RING : LABEL))
        got.forEach((t, i) => {
          const b = L.got[i]
          t.set(i < frame || (i === frame && head >= 1) ? charText(b) : '', b === LN_MSG[i] ? POWER : HIGH_V)
        })
        code(lnCode[L.std])
      },
      readouts: (p) => {
        const L = lnLink(p)
        const wrong = L.got.filter((b, i) => b !== LN_MSG[i]).length
        return [
          { label: 'Swing at RX', value: volts(L.link.swing) },
          { label: 'Noise at RX', value: volts(L.link.noise), tone: L.link.noise > L.link.swing / 4 ? 'warn' : 'ok' },
          { label: 'Margin', value: volts(L.link.margin), tone: L.link.margin > 0.3 * L.link.swing ? 'ok' : L.link.margin > 0 ? 'warn' : 'bad' },
          { label: 'Bit errors', value: `${L.link.errors} / ${LN_BITS.length} · ${wrong} of 4 chars`, tone: L.link.errors ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- GPS and modules: a NEO-6M streams NMEA text at 9600 baud; TX goes to RX, and the sketch parses $GPGGA. ---

const GPS_BAUD = 9600
const CHARS_PER_S = 30
const GPS_SLOW = GPS_BAUD / 10 / CHARS_PER_S
const GPS_PAUSE_S = 0.8
const HOME = { lat: 37.8199, lon: -122.4783, alt: 67.3 }
const GPS_BAUDS = { '9600': 9600, '115200': 115200 } as const
const GPS = { mod: [-12, 3.6, 0] as V3, esp: [11, 3.6, 0] as V3, k: 0.5 }
const sentences = (sec: number, fixed: boolean) => {
  const g = { sec, lat: HOME.lat + 2e-5 * Math.sin(sec), lon: HOME.lon + 2e-5 * Math.cos(sec * 1.3), sats: fixed ? 8 : 2, hdop: 0.92, alt: HOME.alt, fix: fixed }
  return [nmeaGga(g), nmeaRmc(g)]
}
/** What the ESP32 reads from one sentence when its UART runs at `baud`. */
const heard = memoBy(
  (a: { line: string; baud: number }) => `${a.line}|${a.baud}`,
  ({ line, baud }: { line: string; baud: number }) => {
    if (baud === GPS_BAUD) return line
    const st = uartStream([...line].map((c) => c.charCodeAt(0)), GPS_BAUD, FORMAT_8N1)
    return uartReceive(st.level, baud, FORMAT_8N1, st.duration)
      .map((r) => charText(r.byte))
      .join('')
  },
)
const fmtDeg = (v: number | null, pos: string, neg: string) => (v === null ? '—' : `${Math.abs(v).toFixed(5)}° ${v < 0 ? neg : pos}`)

export const gpsAndModules: Lesson = {
  id: 'uart-serial-gps-and-modules',
  title: 'GPS and modules',
  tagline: 'A module that talks in lines of text',
  formula: (p) => {
    const baud = GPS_BAUDS[pick(GPS_BAUDS, p.baud, '9600')]
    const line = sentences(45319, p.sky !== 'indoor')[0]
    return `${line.length} chars × 10 bits / ${GPS_BAUD} baud = ${secs((line.length * 10) / GPS_BAUD)} per $GPGGA · lat ddmm.mmmmm → dd + mm.mmmmm / 60 · checksum = XOR of the chars between $ and * · ESP32 at ${baud} · slowed ${GPS_SLOW}×, gaps between bursts shortened`
  },
  legend: [
    { color: HIGH_V, label: 'Line level: red high (idle), blue low', shape: 'dot' },
    { color: RING, label: 'ESP32 pins: GPIO 16 = RX2, 17 = TX2', shape: 'dot' },
    { color: POWER, label: 'Parsed from $GPGGA, checksum OK', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Many modules (GPS, fingerprint readers, LiDARs, GSM modems) speak UART, often as plain text. A NEO-6M GPS powers up talking at 9600 baud 8N1 and sends a burst of NMEA sentences every second.',
    'Wire TX to RX and RX to TX: each side’s output must reach the other’s input. TX to TX connects two outputs and nobody hears anything. Share GND, and power the module from 3.3 V or 5 V as its board allows.',
    'Each sentence starts with $, a talker + type ($GP = GPS, GGA = fix data), comma-separated fields, then * and a two-digit hex checksum: the XOR of every character in between.',
    'In $GPGGA: UTC time, latitude as ddmm.mmmmm + N/S, longitude dddmm.mmmmm + E/W, fix quality (0 none, 1 GPS), satellites, HDOP, altitude. Indoors it still talks, but the position fields are empty and quality is 0.',
    'At the wrong baud the bytes arrive garbled, the checksum fails and the parser rejects every line, so a library such as TinyGPS++ just never reports a fix.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'wiring',
      options: [
        { value: 'cross', label: 'TX → RX (crossed)' },
        { value: 'straight', label: 'TX → TX' },
      ],
      initial: 'cross',
    },
    {
      kind: 'choice',
      key: 'sky',
      options: [
        { value: 'open', label: 'Open sky' },
        { value: 'indoor', label: 'Indoors' },
      ],
      initial: 'open',
    },
    {
      kind: 'choice',
      key: 'baud',
      options: [
        { value: '9600', label: 'ESP32 9600' },
        { value: '115200', label: 'ESP32 115200' },
      ],
      initial: '9600',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const [mx, my] = GPS.mod
    box(scene, [7, 7, 0.4], mat('#1f4d8f', { rough: 0.6 }), [mx, my, 0])
    box(scene, [4.4, 4.4, 1.1], mat('#d8c9a0', { rough: 0.7 }), [mx, my + 0.6, 0.6])
    box(scene, [1.4, 1.4, 0.2], mat('#c0a060', { metal: 0.4 }), [mx, my + 0.6, 1.2])
    partLetter(scene, 'NEO-6M', [mx, my + 4.4, 0], 0.6, LABEL)
    const fixLed = glowMat(POWER, 0)
    add(scene, mesh(new THREE.SphereGeometry(0.3, 12, 8), fixLed), [mx + 2.8, my - 2.4, 0.4])
    partLetter(scene, 'PPS', [mx + 2.8, my - 3.2, 0], 0.35, GREY)
    const names = ['VCC', 'RX', 'TX', 'GND']
    const gp = names.map((nm, i): V3 => {
      const at: V3 = [mx + 3.5, my + 1.8 - i * 1.2, 0.3]
      box(scene, [0.6, 0.5, 0.5], mat('#d9b24a', { metal: 0.45 }), at)
      partLetter(scene, nm, [mx + 2.9, at[1] - 0.2, 0.3], 0.35, LABEL, 'right')
      return [at[0] + 0.3, at[1], 0.3]
    })
    const esp = esp32Board(scene, GPS.esp, GPS.k)
    partLetter(scene, 'ESP32', [GPS.esp[0], GPS.esp[1] - 3.6, 0], 0.55, LABEL)
    const pin16 = esp(-5, true)
    const pin17 = esp(-3, true)
    partLetter(scene, '16 RX2', [pin16[0], pin16[1] + 0.8, 0], 0.4, RING, 'right')
    partLetter(scene, '17 TX2', [pin17[0] + 0.3, pin17[1] + 0.8, 0], 0.4, RING, 'left')
    const v3 = esp(-6, false)
    const gnd = esp(-5, false)
    wire(scene, [gp[0], [-2, gp[0][1], 0.3], [-2, v3[1] - 1.2, 0.3], [v3[0], v3[1] - 1.2, 0.3], v3], 0.13)
    wire(scene, [gp[3], [-3, gp[3][1], 0.3], [-3, gnd[1] - 1.9, 0.3], [gnd[0], gnd[1] - 1.9, 0.3], gnd], 0.13)
    const yTop = pin16[1] + 1.7
    const route = (from: V3, x: number, y: number, to: V3): V3[] => [from, [x, from[1], 0.3], [x, y, 0.3], [to[0], y, 0.3], to]
    const cross = add(scene, new THREE.Group())
    const crossTx = route(gp[2], 0, yTop, pin16)
    const crossRx = route(gp[1], 1.2, yTop + 1.1, pin17)
    const txC = signalWire(cross, crossTx)
    const rxC = signalWire(cross, crossRx)
    const straight = add(scene, new THREE.Group())
    const txS = signalWire(straight, route(gp[2], 1.2, yTop + 1.1, pin17))
    const rxS = signalWire(straight, route(gp[1], 0, yTop, pin16))
    const wireTag = liveLabel(scene, [3, my - 4.6, 0], { size: 0.45 })
    const glyphs = Array.from({ length: 14 }, () => liveLabel(scene, [0, 0, 1.2], { size: 0.7, color: LABEL }))
    const path = (t: number) => {
      const segs = crossTx.slice(1).map((b, i) => ({ a: crossTx[i], b, len: Math.hypot(b[0] - crossTx[i][0], b[1] - crossTx[i][1]) }))
      let d = t * segs.reduce((a, g) => a + g.len, 0)
      for (const g of segs) {
        if (d <= g.len) return [g.a[0] + ((g.b[0] - g.a[0]) * d) / g.len, g.a[1] + ((g.b[1] - g.a[1]) * d) / g.len]
        d -= g.len
      }
      return [pin16[0], pin16[1]]
    }

    partLetter(scene, 'Serial2 line buffer', [-18.5, -2.4, 0], 0.4, GREY, 'left')
    const buf = liveLabel(scene, [-18.5, -3.6, 0], { size: 0.5, align: 'left' })
    const fields = ['time', 'lat', 'lon', 'fix', 'sats', 'check'].map((f, i) => {
      const y = -5.6 - (i % 3) * 1.2
      const x = i < 3 ? -18.5 : 1.5
      partLetter(scene, f, [x + 2.6, y, 0], 0.42, GREY, 'right')
      return liveLabel(scene, [x + 3.2, y, 0], { size: 0.5, align: 'left' })
    })
    const code = codeBlock(scene, [-18.5, -9.6, 0], 0.48, 5)
    const s = { key: '', t: 0, sec: 45319, idx: 0, last: null as GgaParsed | null, lastOk: false, blink: 0 }
    return {
      scene,
      view: { center: [0, -0.2, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const crossed = p.wiring !== 'straight'
        const fixed = p.sky !== 'indoor'
        const baud = GPS_BAUDS[pick(GPS_BAUDS, p.baud, '9600')]
        const key = `${p.wiring}|${p.sky}|${baud}`
        if (key !== s.key) Object.assign(s, { key, t: 0, idx: 0, last: null, lastOk: false })
        const lines = sentences(s.sec, fixed)
        const line = lines[s.idx]
        const dur = line.length / CHARS_PER_S
        s.t += dt
        if (s.t > dur + GPS_PAUSE_S) {
          s.t = 0
          if (s.idx === 0 && crossed) {
            const got = heard({ line, baud })
            s.last = parseGga(got)
            s.lastOk = !!s.last
          }
          s.idx = (s.idx + 1) % lines.length
          if (s.idx === 0) s.sec++
        }
        const sent = Math.min(line.length, Math.floor(s.t * CHARS_PER_S))
        const bitNow = (() => {
          if (sent >= line.length) return 1
          const k = Math.floor((s.t * CHARS_PER_S - sent) * 10)
          return uartBits(line.charCodeAt(sent))[k]?.bit ?? 1
        })()
        cross.visible = crossed
        straight.visible = !crossed
        txC(bitNow)
        rxC(1)
        txS(bitNow)
        rxS(1)
        wireTag.set(crossed ? 'crossed: TX → 16, RX → 17' : 'TX → TX: two outputs, nobody listens', crossed ? POWER : HIGH_V)
        glyphs.forEach((g, i) => {
          const ci = sent - 1 - i
          const age = s.t * CHARS_PER_S - (ci + 1)
          const u = age / 6
          const on = crossed && ci >= 0 && u <= 1
          g.set(on ? line[ci] : '', LABEL)
          if (!on) return
          const [x, y] = path(u)
          g.group.position.set(x, y + 0.5, 1.2)
        })
        s.blink += dt
        const lit = fixed && s.blink % 1 < 0.15
        setGlow(fixLed, lit ? POWER : '#204030', lit ? 1.4 : 0)
        const received = crossed ? heard({ line, baud }) : ''
        const shown = received.slice(0, Math.floor((received.length * sent) / line.length))
        buf.set(shown.length > 40 ? '…' + shown.slice(-39) : shown || (crossed ? '' : 'Serial2.available() == 0'), baud === GPS_BAUD ? HIGH_V : HEAT)
        const L = s.last
        const ok = s.lastOk
        const vals = [
          L?.time || '—',
          fmtDeg(L?.lat ?? null, 'N', 'S'),
          fmtDeg(L?.lon ?? null, 'E', 'W'),
          L ? `${L.quality} ${L.quality ? '(GPS)' : '(none)'}` : '—',
          L ? String(L.sats) : '—',
          !crossed ? 'no data' : L ? 'OK' : s.key && baud !== GPS_BAUD ? 'FAIL' : '…',
        ]
        fields.forEach((f, i) => f.set(vals[i], i === 5 ? (ok ? POWER : HIGH_V) : ok && L?.quality ? POWER : LABEL))
        code([
          `Serial2.begin(${baud}, SERIAL_8N1, 16, 17);`,
          'while (Serial2.available())',
          '  if (gps.encode(Serial2.read()))  // TinyGPS++',
          '    if (gps.location.isValid())',
          '      show(gps.location.lat(), gps.location.lng());',
        ])
      },
      readouts: (p) => {
        const crossed = p.wiring !== 'straight'
        const baud = GPS_BAUDS[pick(GPS_BAUDS, p.baud, '9600')]
        const L = s.last
        return [
          { label: 'Wiring', value: crossed ? 'TX → RX' : 'TX → TX', tone: crossed ? 'ok' : 'bad' },
          { label: 'Baud', value: `${GPS_BAUD} → ${baud}`, tone: baud === GPS_BAUD ? 'ok' : 'bad' },
          { label: 'Checksum', value: !crossed ? 'no data' : L ? 'OK' : 'waiting / bad', tone: L ? 'ok' : 'warn' },
          { label: 'Fix', value: L ? (L.quality ? `GPS, ${L.sats} sats` : `none, ${L.sats} sats`) : '—', tone: L?.quality ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

