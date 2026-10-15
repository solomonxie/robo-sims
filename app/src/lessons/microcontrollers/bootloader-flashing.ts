import * as THREE from 'three/webgpu'
import {
  BootPhase,
  BootStart,
  BOOT2_S,
  ROM_S,
  FLASH_BLOCK,
  HEALTH_S,
  KB,
  OtaImage,
  OtaKey,
  OtaSector,
  bootScript,
  otaDowntimeS,
  otaStory,
  sampledMode,
  uploadPlan,
} from '../../core/physics'
import { bytesText, hexByte, secs } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  UNIT_ROD,
  arcAt,
  codeBlock,
  emptyGroup,
  glide,
  glowMat,
  icPackage,
  liveLabel,
  memoBy,
  packetPool,
  partLetter,
  pushButton,
  ripples,
  robotCar,
  routerModel,
  setGlow,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const INK = '#14161b'
const IDLE = '#3a3e47'
const HOLD_S = 2.5
const hex8 = (b: number) => `0x${b.toString(16).padStart(8, '0')}`
const flat = (parent: THREE.Object3D, size: V3, m: THREE.Material, at: V3) => {
  const o = add(parent, mesh(new THREE.BoxGeometry(...size), m), at)
  o.castShadow = false
  return o
}
const rodTo = (parent: THREE.Object3D, a: V3, b: V3, m: THREE.Material, r = 0.08) => {
  const o = add(parent, mesh(UNIT_ROD, m))
  o.castShadow = false
  stretchRod(o, a, b, r)
  return o
}
const tray = () => mat('#1b1d22', { rough: 0.7 })

/** On-screen seconds per phase: short ones slowed to be seen, long ones (uploads, downloads) sped up. */
const showS = (s: number) => (s < 1 ? 0.9 + 2.5 * s : Math.min(5, 1.6 + Math.log2(s)))
const speedText = (s: number) => {
  const f = showS(s) / s
  return f > 1.3 ? `slowed ${Math.round(f)}×` : f < 0.77 ? `sped up ${Math.round(1 / f)}×` : 'real time'
}

/** Plays phases of `spans` real seconds at `showS` pace, looping with a hold; → phase i, progress u, cursor x (0..1). */
function phaseClock() {
  const s = { key: '', t: 0 }
  return (dt: number, key: string, spans: number[]) => {
    const D = spans.map(showS)
    const total = D.reduce((a, b) => a + b, 0)
    if (key !== s.key) Object.assign(s, { key, t: 0 })
    s.t += dt
    if (s.t > total + HOLD_S) s.t = 0
    let acc = 0
    for (let i = 0; i < D.length; i++) {
      if (s.t < acc + D[i]) return { i, u: (s.t - acc) / D[i], x: s.t / total, done: false }
      acc += D[i]
    }
    return { i: D.length - 1, u: 1, x: 1, done: true }
  }
}

/** Glowing tile with a caption; `set(dt, on, color, text)`. */
function tile(parent: THREE.Object3D, at: V3, w: number, h: number, title: string) {
  box(parent, [w + 0.4, h + 0.4, 0.4], tray(), [at[0], at[1], -0.45])
  const m = glowMat(IDLE, 0.2)
  flat(parent, [w, h, 0.3], m, at)
  const head = liveLabel(parent, [at[0], at[1] + (h > 1.8 ? 0.35 : 0), 0.3], { size: 0.42 })
  const sub = liveLabel(parent, [at[0], at[1] - 0.45, 0.3], { size: 0.3 })
  let k = 0.2
  return (dt: number, on: boolean, color: string, note = '') => {
    k = glide(dt, k, on ? 0.9 : 0.15, 10)
    setGlow(m, on ? color : '#4a4f5a', k)
    head.set(title, on ? INK : color)
    sub.set(h > 1.8 ? note : '', on ? INK : GREY)
  }
}

// --- Boot modes: straps latched as EN rises; the USB-serial DTR/RTS dance; esptool blocks; ROM → bootloader → app. ---

const STARTS: Record<BootStart, string> = { esptool: 'esptool auto-reset', button: 'BOOT + EN buttons', reset: 'EN only', gpio12: 'GPIO12 pulled high' }
const BAUDS = { b115: 115200, b460: 460800, b921: 921600 }
const BAUD_TEXT: Record<keyof typeof BAUDS, string> = { b115: '115200', b460: '460800', b921: '921600' }
const ROWS = [
  { name: 'DTR', color: DATA_COLOR, v: (p: BootPhase) => (p.dtr ? 1 : 0) },
  { name: 'RTS', color: CLK_COLOR, v: (p: BootPhase) => (p.rts ? 1 : 0) },
  { name: 'EN', color: HEAT, v: (p: BootPhase) => p.en },
  { name: 'GPIO0', color: RING, v: (p: BootPhase) => p.io0 },
]
const STAGE_TEXT: Record<BootPhase['stage'], string> = {
  app: 'app',
  reset: 'reset',
  rom: 'ROM',
  boot2: 'boot',
  download: 'wait',
  sync: 'sync',
  stub: 'stub',
  write: 'write_flash',
  verify: 'md5',
  error: 'err',
}
const TR = { x0: -11, x1: 24, y: -1.9, h: 1.1, gap: 0.55 }
const CHAIN_Y = 7.6
const FLASH = { x0: 6, x1: 24, y: 0.6 }

const bootRun = memoBy(
  (p: Params) => `${p.start}|${p.baud}|${p.size}`,
  (p: Params) => {
    const start = pick(STARTS, p.start, 'esptool')
    const baud = BAUDS[pick(BAUD_TEXT, p.baud, 'b921')]
    const bytes = n(p, 'size') * KB
    const ph = bootScript(start, bytes, baud)
    const resets = ph.map((x, i) => (i > 0 && ph[i - 1].en === 0 && x.en === 1 ? i : -1)).filter((i) => i >= 0)
    const latched = resets.map((i) => ({ i, ...sampledMode(ph, i) }))
    return { start, baud, bytes, ph, latched, up: uploadPlan(bytes, baud), flashes: ph.some((x) => x.stage === 'write') }
  },
)

export const bootModes: Lesson = {
  id: 'bootloader-flashing-boot-modes',
  title: 'Boot modes',
  tagline: 'GPIO0 at reset decides: run the app, or wait for new firmware',
  formula: (p) => {
    const B = bootRun(p)
    const L = B.latched[0]
    const straps = `EN rises → ROM latches GPIO0 = ${L.straps.io0}, GPIO2 = 0, GPIO12 = ${L.straps.io12} → boot:${hexByte(L.byte)} ${L.mode === 'download' ? 'DOWNLOAD_BOOT' : 'SPI_FAST_FLASH_BOOT'}`
    const tail = B.flashes
      ? `${bytesText(B.bytes)} → ${bytesText(B.up.compressed)} zlib = ${B.up.blocks} × 16 KB blocks at ${B.baud} baud (10 bits/byte): ${secs(B.up.writeS)} (effective ${Math.round(B.up.kbitps)} kbit/s)`
      : L.volts < 3.3
        ? `flash powered at ${L.volts} V instead of 3.3 V → reads garbage`
        : 'ROM → 2nd-stage bootloader (0x1000) → app (0x10000)'
    return `${straps} · ${tail} · short steps slowed, upload sped up`
  },
  legend: [
    { color: DATA_COLOR, label: 'DTR · RTS (cyan): USB-serial lines, high = asserted', shape: 'dot' },
    { color: HEAT, label: 'EN: low holds the chip in reset', shape: 'dot' },
    { color: RING, label: 'GPIO0: latched as EN rises', shape: 'dot' },
    { color: POWER, label: 'UART0 traffic · ROM → bootloader → app', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The ESP32 can’t tell “run my sketch” from “take new firmware” by itself. At reset (EN going high) the ROM reads a few strapping pins once and latches them: GPIO0 high (its default pull-up) boots from flash, GPIO0 low (with GPIO2 low) enters UART download mode.',
    'Normal boot is a chain: the mask ROM starts, loads the 2nd-stage bootloader from flash at 0x1000, which reads the partition table at 0x8000 and otadata and starts the app (see Memory & storage → Flash layout). The ROM prints rst:0x1 … boot:0x13 on UART0 at 115200 every time.',
    'By hand: hold BOOT (GPIO0 to GND), tap EN, let go: the ROM says “waiting for download”. DevKits save you that with two transistors on the USB-serial chip’s DTR and RTS: RTS alone pulls EN low, DTR alone pulls GPIO0 low, both together do nothing, so opening the Serial Monitor doesn’t reset the board.',
    'esptool’s dance: RTS on (reset), then DTR on and RTS off together, so EN rises while GPIO0 is still low, then both off. If that fails (“Failed to connect: wrong boot mode”), a weak USB cable or a missing capacitor on EN is the usual culprit; hold BOOT yourself.',
    'Then it syncs at 115200, uploads a small flasher stub into RAM, switches to the fast baud and sends the zlib-compressed image in 16 KB blocks, each acknowledged after it’s written, and checks an MD5 at the end. “Hard resetting via RTS pin” starts the new app.',
    'Strapping pins are a wiring trap: a sensor that pulls GPIO12 high at reset selects 1.8 V flash (“flash read err, 1000”, endless resets); GPIO0, 2, 15 and 5 also matter. Keep pull-ups and loads off them, or only use them as outputs.',
  ],
  controls: [
    { kind: 'choice', key: 'start', options: (Object.keys(STARTS) as BootStart[]).map((k) => ({ value: k, label: STARTS[k] })), initial: 'esptool' },
    { kind: 'choice', key: 'baud', options: (Object.keys(BAUDS) as (keyof typeof BAUDS)[]).map((k) => ({ value: k, label: BAUD_TEXT[k] })), initial: 'b921' },
    { kind: 'slider', key: 'size', label: 'Sketch size', min: 200, max: 1280, step: 20, initial: 900, format: (v) => `${v} KB` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    // USB-serial bridge, auto-reset transistors, buttons, ESP32 pins.
    const usb = add(scene, icPackage(3.6, 6.2, 4), [-21.5, 3.6, 0])
    partLetter(scene, 'CP2102', [usb.position.x, 7.4, 0], 0.4, LABEL)
    partLetter(scene, 'USB-serial', [usb.position.x, -0.2, 0], 0.32, GREY)
    const pinY = { dtr: 6.2, rts: 4.6, en: 6.2, io0: 3.4, tx: 1.2 }
    const lineMat = { dtr: glowMat(DATA_COLOR, 0.2), rts: glowMat(CLK_COLOR, 0.2), en: glowMat(HEAT, 0.2), io0: glowMat(RING, 0.2), tx: glowMat(POWER, 0.2) }
    partLetter(scene, 'DTR', [-19.1, pinY.dtr + 0.45, 0], 0.3, DATA_COLOR, 'left')
    partLetter(scene, 'RTS', [-19.1, pinY.rts + 0.45, 0], 0.3, CLK_COLOR, 'left')
    partLetter(scene, 'TX RX', [-19.1, pinY.tx + 0.45, 0], 0.3, POWER, 'left')
    rodTo(scene, [-19.3, pinY.dtr, 0], [-15.2, pinY.dtr, 0], lineMat.dtr)
    rodTo(scene, [-19.3, pinY.rts, 0], [-15.2, pinY.rts, 0], lineMat.rts)
    box(scene, [3.6, 4.6, 0.4], tray(), [-13.4, 4.9, -0.45])
    partLetter(scene, 'auto-reset', [-13.4, 7.8, 0], 0.32, GREY)
    const q1 = tile(scene, [-13.4, 6.1, 0], 2.6, 1.3, 'Q1')
    const q2 = tile(scene, [-13.4, 3.7, 0], 2.6, 1.3, 'Q2')
    rodTo(scene, [-14.6, 5.4, 0.3], [-12.2, 4.4, 0.3], glowMat(GREY, 0.3), 0.05)
    rodTo(scene, [-14.6, 4.4, 0.3], [-12.2, 5.4, 0.3], glowMat(GREY, 0.3), 0.05)
    rodTo(scene, [-11.6, pinY.en, 0], [-3.6, pinY.en, 0], lineMat.en)
    rodTo(scene, [-11.6, pinY.io0, 0], [-3.6, pinY.io0, 0], lineMat.io0)
    rodTo(scene, [-19.3, pinY.tx, 0], [-3.6, pinY.tx, 0], lineMat.tx)
    const enBtn = pushButton(scene, [-8.6, pinY.en + 0.5, 0], [-6.6, pinY.en + 0.5, 0])
    const bootBtn = pushButton(scene, [-8.6, pinY.io0 + 0.5, 0], [-6.6, pinY.io0 + 0.5, 0])
    enBtn.group.scale.setScalar(0.55)
    bootBtn.group.scale.setScalar(0.55)
    partLetter(scene, 'EN', [-10, pinY.en + 0.9, 0], 0.32, HEAT, 'right')
    partLetter(scene, 'BOOT', [-10, pinY.io0 + 0.9, 0], 0.32, RING, 'right')
    const nets = { en: liveLabel(scene, [-5.1, pinY.en + 0.5, 0.2], { size: 0.32 }), io0: liveLabel(scene, [-5.1, pinY.io0 + 0.5, 0.2], { size: 0.32 }) }
    const packets = packetPool(scene, 6, 0.4)
    const chip = add(scene, icPackage(5.4, 7.6, 5), [-0.4, 3.9, 0])
    partLetter(scene, 'ESP32', [chip.position.x, 6.6, 0.7], 0.5, LABEL)
    partLetter(scene, 'EN', [-2.6, pinY.en, 0.7], 0.28, HEAT, 'left')
    partLetter(scene, 'GPIO0', [-2.6, pinY.io0, 0.7], 0.28, RING, 'left')
    partLetter(scene, 'U0RXD', [-2.6, pinY.tx, 0.7], 0.28, POWER, 'left')
    partLetter(scene, 'straps latched', [chip.position.x, 5.4, 0.7], 0.26, GREY)
    const bits = ['0', '2', '12'].map((name, k) => {
      const m = glowMat(GREY, 0.2)
      const x = chip.position.x - 1.5 + k * 1.5
      flat(scene, [1.2, 1.1, 0.2], m, [x, 4.3, 0.65])
      partLetter(scene, name, [x, 3.35, 0.7], 0.22, GREY)
      return { m, t: liveLabel(scene, [x, 4.3, 0.8], { size: 0.36 }) }
    })
    const strapText = liveLabel(scene, [chip.position.x, 2.4, 0.7], { size: 0.3 })
    const io12Text = liveLabel(scene, [chip.position.x, -0.6, 0.3], { size: 0.3 })
    // Boot chain and the flash it reads from.
    const rom = tile(scene, [8.2, CHAIN_Y, 0], 4.6, 2.2, 'ROM')
    const boot2 = tile(scene, [14.3, CHAIN_Y, 0], 4.6, 2.2, 'bootloader')
    const app = tile(scene, [20.4, CHAIN_Y, 0], 4.6, 2.2, 'app')
    const dl = tile(scene, [11.2, 4, 0], 6.2, 2, 'download mode')
    const arrowMat = glowMat(GREY, 0.3)
    rodTo(scene, [10.6, CHAIN_Y, 0], [11.9, CHAIN_Y, 0], arrowMat)
    rodTo(scene, [16.7, CHAIN_Y, 0], [18, CHAIN_Y, 0], arrowMat)
    const dlArrow = glowMat(GREY, 0.3)
    rodTo(scene, [8.2, CHAIN_Y - 1.3, 0], [8.2, 4, 0], dlArrow)
    rodTo(scene, [8.2, 4, 0], [8, 4, 0], dlArrow)
    const fw = FLASH.x1 - FLASH.x0
    box(scene, [fw + 0.4, 1.8, 0.4], tray(), [FLASH.x0 + fw / 2, FLASH.y, -0.45])
    const seg = (x0: number, x1: number, color: string, name: string, addr: string) => {
      const m = glowMat(color, 0.25)
      flat(scene, [x1 - x0 - 0.15, 1.4, 0.2], m, [(x0 + x1) / 2, FLASH.y, -0.1])
      partLetter(scene, name, [(x0 + x1) / 2, FLASH.y + 1.35, 0], 0.3, LABEL)
      partLetter(scene, addr, [x0 + 0.1, FLASH.y - 1.3, 0], 0.26, GREY, 'left')
      return m
    }
    const segBoot = seg(FLASH.x0, FLASH.x0 + 3, HEAT, 'bootloader', '0x1000')
    const segTable = seg(FLASH.x0 + 3, FLASH.x0 + 5.2, RING, 'table', '0x8000')
    const appX0 = FLASH.x0 + 5.2
    const segApp = seg(appX0, FLASH.x1, CLK_COLOR, 'app0 (not to scale)', '0x10000')
    const fillMat = glowMat(POWER, 0.9)
    const fill = flat(scene, [1, 1.1, 0.3], fillMat, [appX0, FLASH.y, 0.05])
    const fillText = liveLabel(scene, [appX0 + (FLASH.x1 - appX0) / 2, FLASH.y, 0.35], { size: 0.34 })
    // Traces.
    const rowY = (k: number) => TR.y - k * (TR.h + TR.gap)
    const nRows = ROWS.length + 1
    box(scene, [TR.x1 - TR.x0 + 0.6, nRows * (TR.h + TR.gap) + 0.2, 0.4], tray(), [(TR.x0 + TR.x1) / 2, rowY((nRows - 1) / 2), -0.45])
    ROWS.forEach((r, k) => partLetter(scene, r.name, [TR.x0 - 0.6, rowY(k), 0], 0.36, r.color, 'right'))
    partLetter(scene, 'UART0', [TR.x0 - 0.6, rowY(ROWS.length), 0], 0.36, POWER, 'right')
    const g = add(scene, new THREE.Group())
    const cursor = rodTo(scene, [0, 0, 0], [0, 1, 0], glowMat(LABEL, 1), 0.06)
    let segs: { x0: number; x1: number; o: THREE.Object3D; text?: THREE.Object3D }[] = []
    const status = liveLabel(scene, [-24, -10.6, 0.3], { size: 0.44, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.6, 0], 0.36, 4)
    const clock = phaseClock()
    const s = { key: '', fill: 0, pkt: 0 }
    return {
      scene,
      view: { center: [0, 1.2, 0], radius: 88, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const B = bootRun(p)
        const { ph } = B
        const key = `${B.start}|${B.baud}|${B.bytes}`
        const D = ph.map((x) => showS(x.s))
        const total = D.reduce((a, b) => a + b, 0)
        const xs = D.map((_, i) => TR.x0 + (D.slice(0, i).reduce((a, b) => a + b, 0) / total) * (TR.x1 - TR.x0))
        const xe = (i: number) => (i + 1 < ph.length ? xs[i + 1] : TR.x1)
        if (key !== s.key) {
          emptyGroup(g)
          segs = []
          ROWS.forEach((r, k) => {
            const m = glowMat(r.color, 0.9)
            ph.forEach((x, i) => {
              const v = r.v(x)
              const y = rowY(k) + (v - 0.5) * TR.h * 0.8
              segs.push({ x0: xs[i], x1: xe(i), o: flat(g, [1, 0.14, 0.15], m, [0, y, 0]) })
              if (i > 0 && r.v(ph[i - 1]) !== v) segs.push({ x0: xs[i], x1: xs[i] + 0.12, o: flat(g, [1, TR.h * 0.8, 0.15], m, [0, rowY(k), 0]) })
            })
          })
          ph.forEach((x, i) => {
            const w = xe(i) - xs[i]
            const color = x.stage === 'error' ? HIGH_V : x.uart ? POWER : IDLE
            const o = flat(g, [1, TR.h * 0.8, 0.2], glowMat(color, x.uart ? 0.7 : 0.25), [0, rowY(ROWS.length), 0])
            const label = STAGE_TEXT[x.stage]
            const text = w > label.length * 0.3 + 0.2 ? partLetter(g, label, [xs[i] + w / 2, rowY(ROWS.length), 0.3], 0.3, x.uart ? INK : GREY) : undefined
            segs.push({ x0: xs[i], x1: xe(i), o, text })
          })
          s.key = key
        }
        const c = clock(dt, key, ph.map((x) => x.s))
        const P = ph[c.i]
        const cx = TR.x0 + c.x * (TR.x1 - TR.x0)
        for (const sg of segs) {
          const w = Math.min(Math.max(cx - sg.x0, 0), sg.x1 - sg.x0)
          sg.o.visible = w > 0.01
          sg.o.scale.x = Math.max(0.01, w)
          sg.o.position.x = sg.x0 + w / 2
          if (sg.text) sg.text.visible = cx >= sg.x0 + (sg.x1 - sg.x0) * 0.6
        }
        stretchRod(cursor, [cx, rowY(nRows - 1) - TR.h / 2, 0.35], [cx, TR.y + TR.h / 2 + 0.2, 0.35], 0.06)
        // Pins and buttons.
        const enLow = P.en === 0
        const io0Low = P.io0 === 0
        setGlow(lineMat.dtr, DATA_COLOR, P.dtr ? 1.2 : 0.15)
        setGlow(lineMat.rts, CLK_COLOR, P.rts ? 1.2 : 0.15)
        setGlow(lineMat.en, HEAT, enLow ? 0.15 : 0.9)
        setGlow(lineMat.io0, RING, io0Low ? 0.15 : 0.9)
        setGlow(lineMat.tx, POWER, P.uart ? 0.9 : 0.15)
        q1(dt, P.rts && !P.dtr, HEAT)
        q2(dt, P.dtr && !P.rts, RING)
        const manual = B.start !== 'esptool'
        enBtn.set(manual && enLow ? 1 : 0)
        bootBtn.set(B.start === 'button' && io0Low ? 1 : 0)
        nets.en.set(enLow ? 'EN = 0' : 'EN = 1', enLow ? HIGH_V : HEAT)
        nets.io0.set(io0Low ? 'GPIO0 = 0' : 'GPIO0 = 1', io0Low ? HIGH_V : RING)
        let latch = B.latched.filter((l) => l.i <= c.i).at(-1)
        if (!latch) latch = { i: -1, straps: { io0: 1, io2: 0, io12: 0 }, mode: 'flash', byte: 0x13, volts: 3.3 }
        const st = latch.straps
        ;[st.io0, st.io2, st.io12].forEach((v, k) => {
          setGlow(bits[k].m, v ? (k === 2 ? HIGH_V : RING) : GREY, v ? 0.8 : 0.2)
          bits[k].t.set(`${v}`, v ? INK : LABEL)
        })
        strapText.set(`boot:${hexByte(latch.byte)} · ${latch.mode === 'download' ? 'download' : latch.volts < 3.3 ? '1.8 V' : 'flash'}`, latch.mode === 'download' ? RING : latch.volts < 3.3 ? HIGH_V : LABEL)
        io12Text.set(B.start === 'gpio12' ? 'a sensor pulls GPIO12 high at reset' : '', HIGH_V)
        // Boot chain.
        const isDl = ['download', 'sync', 'stub', 'write', 'verify'].includes(P.stage)
        rom(dt, P.stage === 'rom' || P.stage === 'error' || isDl, P.stage === 'error' ? HIGH_V : HEAT, P.stage === 'error' ? 'flash read err' : 'mask ROM')
        boot2(dt, P.stage === 'boot2', POWER, '0x1000 → RAM')
        app(dt, P.stage === 'app', CLK_COLOR, c.i === 0 ? 'old sketch' : B.flashes ? 'new sketch' : 'setup(), loop()')
        dl(dt, isDl, RING, isDl ? `UART0 · ${P.stage === 'write' || P.stage === 'verify' ? B.baud : 115200} baud` : '')
        setGlow(dlArrow, RING, isDl ? 1 : 0.15)
        setGlow(arrowMat, POWER, P.stage === 'boot2' || P.stage === 'app' ? 0.8 : 0.15)
        setGlow(segBoot, HEAT, P.stage === 'rom' || P.stage === 'error' ? 1 : 0.25)
        setGlow(segTable, RING, P.stage === 'boot2' ? 1 : 0.25)
        setGlow(segApp, CLK_COLOR, (P.stage === 'boot2' && c.u > 0.5) || P.stage === 'app' ? 0.8 : 0.25)
        const wi = ph.findIndex((x) => x.stage === 'write')
        const prog = wi < 0 ? 0 : c.i > wi ? 1 : c.i === wi ? c.u : 0
        const block = Math.min(B.up.blocks, Math.floor(prog * B.up.blocks + (prog > 0 ? 1 : 0)))
        s.fill = glide(dt, s.fill, block / Math.max(1, B.up.blocks), 12)
        const aw = (FLASH.x1 - appX0 - 0.2) * s.fill
        fill.visible = B.flashes && aw > 0.02
        fill.scale.x = Math.max(0.01, aw)
        fill.position.x = appX0 + 0.1 + aw / 2
        setGlow(fillMat, P.stage === 'write' ? POWER : CLK_COLOR, P.stage === 'write' ? 1 : 0.5)
        fillText.set(B.flashes && wi <= c.i ? `${block} / ${B.up.blocks} blocks · ${Math.round(prog * 100)} %` : P.stage === 'app' && c.i > 0 && !B.flashes ? 'mapped into the CPU' : P.stage === 'app' && B.flashes && c.i > 0 ? 'new sketch, mapped into the CPU' : '', LABEL)
        // UART packets between the bridge and the chip.
        packets.begin()
        if (P.uart) {
          s.pkt += dt
          for (let k = 0; k < 4; k++) {
            const u = (s.pkt * 0.8 + k / 4) % 1
            const toChip = P.stage === 'write' || P.stage === 'stub' || (P.stage === 'sync' && k % 2 === 0)
            const at = arcAt([-18.6, pinY.tx + 0.6, 0.3], [-4.4, pinY.tx + 0.6, 0.3], toChip ? u : 1 - u, 0)
            packets.put(at, P.stage === 'error' ? HIGH_V : POWER, { w: 1.1, payload: 0.7 })
          }
        }
        packets.end()
        // Status and terminal.
        const pct = Math.round(prog * 100)
        const addr = 0x10000 + Math.min(B.up.compressed, block * FLASH_BLOCK) * (B.bytes / B.up.compressed)
        const say: Record<BootPhase['stage'], string> = {
          app: c.i === 0 ? (io0Low ? 'BOOT held: GPIO0 is low, but the app ignores it until the next reset' : 'the old sketch runs') : 'app_main → setup() → loop(): the sketch runs',
          reset: B.start === 'esptool' ? 'RTS on, DTR off → Q1 pulls EN low: chip held in reset' : io0Low ? 'tap EN while BOOT is held: chip in reset' : 'EN low: chip held in reset',
          download: P.dtr ? 'DTR on, RTS off → EN rises while Q2 still holds GPIO0 low: straps latched → download mode' : 'ROM: boot:0x03 (DOWNLOAD_BOOT) · waiting for download',
          sync: 'esptool sends SYNC frames at 115200 until the ROM answers',
          stub: `uploading the ${bytesText(13 * KB)} flasher stub into RAM, then switching to ${B.baud} baud`,
          write: `block ${block} / ${B.up.blocks}: 16 KB zlib, written to flash, acknowledged · ${pct} %`,
          verify: 'MD5 of the written flash matches: Hash of data verified',
          rom: latch.volts < 3.3 ? 'ROM: boot:0x33, GPIO12 high → flash supplied at 1.8 V' : `ROM: boot:${hexByte(latch.byte)} (SPI_FAST_FLASH_BOOT) → loads the bootloader from 0x1000`,
          boot2: '2nd-stage bootloader: partition table at 0x8000, otadata → loads app0 from 0x10000 and checks it',
          error: 'flash read err, 1000 → RTC watchdog resets the chip, again and again',
        }
        status.set(`t = ${secs(ph.slice(0, c.i).reduce((a, x) => a + x.s, 0) + c.u * P.s)} · ${say[P.stage]} · ${speedText(P.s)}`, P.stage === 'error' ? HIGH_V : LABEL)
        const log: string[] = []
        const seen = (stage: BootPhase['stage']) => ph.some((x) => x.stage === stage) && ph.findIndex((x) => x.stage === stage) <= c.i
        if (B.flashes) {
          log.push(`$ esptool.py --baud ${B.baud} write_flash 0x10000 sketch.bin${B.start === 'button' ? ' --before no_reset' : ''}`)
          if (seen('download')) log.push(seen('stub') ? `Connected · Stub running${B.baud > 115200 ? ` · Changing baud rate to ${B.baud}` : ''}` : 'Connecting....')
          if (seen('write')) log.push(seen('verify') ? `Wrote ${B.bytes} bytes (${B.up.compressed} compressed) at 0x00010000 in ${B.up.writeS.toFixed(1)} s` : `Writing at ${hex8(Math.round(addr))}... (${pct} %)`)
          if (seen('verify')) log.push(c.i > ph.findIndex((x) => x.stage === 'verify') ? (B.start === 'esptool' ? 'Hash of data verified. Hard resetting via RTS pin...' : '// Hash of data verified. Press EN to run the new sketch') : 'Hash of data verified.')
        } else {
          log.push('// Serial Monitor, 115200 baud:')
          if (c.i >= 2) log.push(`rst:0x1 (POWERON_RESET),boot:${hexByte(latch.byte)} (SPI_FAST_FLASH_BOOT)`)
          if (seen('boot2')) log.push('load:0x3fff0030,len:1184 · entry 0x400805e4')
          if (seen('error')) log.push('flash read err, 1000 · ets_main.c 371')
        }
        code(log.slice(-4))
      },
      readouts: (p) => {
        const B = bootRun(p)
        const L = B.latched[0]
        return [
          { label: 'Straps at reset', value: `GPIO0 ${L.straps.io0} · GPIO12 ${L.straps.io12}`, tone: L.volts < 3.3 ? 'bad' : 'ok' },
          { label: 'Boot mode', value: `${hexByte(L.byte)} ${L.mode === 'download' ? 'download' : L.volts < 3.3 ? 'flash @ 1.8 V' : 'flash'}`, tone: L.volts < 3.3 ? 'bad' : 'ok' },
          B.flashes ? { label: 'Upload', value: `${secs(B.up.writeS)} · ${B.up.blocks} blocks`, tone: B.up.writeS > 30 ? 'warn' : 'ok' } : { label: 'Upload', value: 'none' },
          B.flashes ? { label: 'Effective rate', value: `${Math.round(B.up.kbitps)} kbit/s` } : { label: 'Boot to app', value: L.volts < 3.3 ? 'never: reset loop' : secs(ROM_S + BOOT2_S), tone: L.volts < 3.3 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- OTA updates: download into the idle slot while the robot runs, check, flip otadata, reboot, health check / rollback. ---

const IMAGES: Record<OtaImage, string> = { good: 'Good image', crash: 'Crashes at boot', corrupt: 'Corrupt download' }
const ROLLBACK = { on: 'Rollback on', off: 'Rollback off' }
const PIPE: [OtaKey[], string][] = [
  [['download'], 'download'],
  [['verify', 'reject'], 'SHA-256'],
  [['switch'], 'otadata'],
  [['reboot', 'boot'], 'reboot'],
  [['health', 'panic'], 'health check'],
  [['valid', 'rollback'], 'valid / rollback'],
]
const ROUTER: V3 = [-20, 0.4, 0]
const CAR: V3 = [-6.5, -0.2, 0]
const MAP = { x0: 2, y: 6.2 }
const SLOT_W = 6
const STATE_COLOR: Record<OtaSector['state'], string> = { empty: GREY, new: RING, pending: HEAT, valid: POWER, aborted: HIGH_V, unset: LABEL }

const otaRun = memoBy(
  (p: Params) => `${p.image}|${p.rollback}|${p.rate}`,
  (p: Params) => {
    const image = pick(IMAGES, p.image, 'good')
    const rollback = pick(ROLLBACK, p.rollback, 'on') === 'on'
    const rate = n(p, 'rate') * KB
    const story = otaStory(image, rollback, rate)
    const last = story.at(-1)!
    return { image, rollback, rate, story, last, down: otaDowntimeS(story), dlS: story[1].s, loop: !rollback && image === 'crash' }
  },
)

export const otaUpdates: Lesson = {
  id: 'bootloader-flashing-ota-updates',
  title: 'OTA updates',
  tagline: 'New firmware over Wi-Fi into the idle slot, with a way back',
  formula: (p) => {
    const O = otaRun(p)
    const dl = `${bytesText(1000 * KB)} at ${n(p, 'rate')} KB/s = ${secs(O.dlS)} download into app1 while app0 keeps driving`
    const end =
      O.image === 'corrupt'
        ? 'SHA-256 mismatch → Update.end() fails, otadata untouched, v1.0 keeps running'
        : O.loop
          ? 'no rollback: otadata points at a crashing image → boot loop until reflashed over USB'
          : O.image === 'crash'
            ? 'new image never marks itself valid → bootloader sets it ABORTED and boots app0 again'
            : `otadata seq 2 → app1 · health check passes within ${HEALTH_S} s → VALID`
    return `${dl} · ${end} · downtime ${secs(O.down)}`
  },
  legend: [
    { color: DATA_COLOR, label: 'Firmware packets over Wi-Fi', shape: 'dot' },
    { color: CLK_COLOR, label: 'App slot: lit = running', shape: 'dot' },
    { color: RING, label: 'otadata NEW · PENDING (orange) · VALID (green)', shape: 'dot' },
    { color: HIGH_V, label: 'Rejected / crashed / ABORTED', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A robot in the field has no USB cable. OTA (over the air) uses the two app slots of the partition table (Memory & storage → Flash layout): while app0 runs, the new firmware streams over Wi-Fi into app1. The robot keeps driving the whole time.',
    'Update.begin() erases the idle slot, Update.write() stores each received chunk, Update.end() checks the image header and its SHA-256. If anything is wrong (cut connection, wrong file, bad hash) it fails and nothing changes: otadata still points at the old app.',
    'Only then is otadata written: two flash sectors holding a sequence number; the one with the highest number wins, and (seq − 1) mod 2 is the slot. Writing them alternately means a power cut mid-write leaves the other intact.',
    'After ESP.restart() the 2nd-stage bootloader reads otadata and boots app1. Downtime is just the reboot, a fraction of a second.',
    'A new image can still be broken: crash on boot, lose Wi-Fi, misread a sensor. With rollback enabled the bootloader marks it PENDING_VERIFY; the app must call esp_ota_mark_app_valid_cancel_rollback() after a health check. If it resets before that, the bootloader marks it ABORTED and boots the old slot.',
    'Without rollback a crashing image is booted again and again: a boot loop that needs a USB cable. Sign or at least serve images over HTTPS, and never mark valid before the robot has proved it can still be updated.',
  ],
  controls: [
    { kind: 'choice', key: 'image', options: (Object.keys(IMAGES) as OtaImage[]).map((k) => ({ value: k, label: IMAGES[k] })), initial: 'good' },
    { kind: 'choice', key: 'rollback', options: (Object.keys(ROLLBACK) as (keyof typeof ROLLBACK)[]).map((k) => ({ value: k, label: ROLLBACK[k] })), initial: 'on' },
    { kind: 'slider', key: 'rate', label: 'Download rate', min: 50, max: 800, step: 50, initial: 250, format: (v) => `${v} KB/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const router = routerModel(scene, ROUTER, 1.1)
    partLetter(scene, 'Wi-Fi router · update server', [ROUTER[0], ROUTER[1] - 1.8, 0], 0.36, GREY)
    const waves = ripples(scene, router.top, { count: 3, reach: 3 })
    const carG = add(scene, new THREE.Group())
    const car = robotCar(carG, CAR, 1.1)
    const carText = liveLabel(scene, [CAR[0], CAR[1] - 3.4, 0.3], { size: 0.42 })
    const packets = packetPool(scene, 8, 0.5)
    // Flash map: small partitions, two app slots, otadata sectors.
    const smalls: [string, string][] = [['boot', HEAT], ['table', RING], ['nvs', POWER]]
    box(scene, [7.2 + 2 * SLOT_W, 3, 0.4], tray(), [MAP.x0 + 3.5 + SLOT_W, MAP.y, -0.45])
    smalls.forEach(([name, color], k) => {
      const x = MAP.x0 + 0.8 + k * 1.6
      flat(scene, [1.4, 2.4, 0.2], glowMat(color, 0.3), [x, MAP.y, -0.1])
      partLetter(scene, name, [x, MAP.y + 1.75, 0], 0.26, GREY)
    })
    const otaMats = [0, 1].map((k) => {
      const m = glowMat(GREY, 0.3)
      flat(scene, [0.7, 2.4, 0.2], m, [MAP.x0 + 5.4 + k * 0.8, MAP.y, -0.1])
      return m
    })
    partLetter(scene, 'otadata', [MAP.x0 + 5.8, MAP.y + 1.75, 0], 0.26, FORCE)
    const slots = [0, 1].map((k) => {
      const x = MAP.x0 + 6.6 + k * (SLOT_W + 0.2) + SLOT_W / 2
      const m = glowMat(CLK_COLOR, 0.2)
      flat(scene, [SLOT_W, 2.4, 0.2], m, [x, MAP.y, -0.1])
      partLetter(scene, `app${k}`, [x, MAP.y + 1.75, 0], 0.32, LABEL)
      const fm = glowMat(DATA_COLOR, 0.8)
      const fill = flat(scene, [1, 1.6, 0.25], fm, [x, MAP.y, 0.05])
      return { x, m, fm, fill, text: liveLabel(scene, [x, MAP.y, 0.4], { size: 0.38 }), run: liveLabel(scene, [x, MAP.y - 1.9, 0.3], { size: 0.34 }) }
    })
    // otadata zoom: the two sectors.
    const secs2 = [0, 1].map((k) => {
      const at: V3 = [MAP.x0 + 3.2 + k * 7, 1.6, 0]
      box(scene, [6.4, 2.6, 0.4], tray(), [at[0], at[1], -0.45])
      const m = glowMat(GREY, 0.2)
      flat(scene, [6, 2.2, 0.2], m, at)
      partLetter(scene, `otadata[${k}]`, [at[0], at[1] + 1.75, 0], 0.3, FORCE)
      return { m, t: liveLabel(scene, [at[0], at[1] + 0.35, 0.3], { size: 0.38 }), s: liveLabel(scene, [at[0], at[1] - 0.45, 0.3], { size: 0.32 }) }
    })
    const pick2 = liveLabel(scene, [MAP.x0 + 18, 1.6, 0.3], { size: 0.34 })
    rodTo(scene, [MAP.x0 + 5.8, MAP.y - 1.3, -0.1], [MAP.x0 + 6.7, 2.9, -0.1], glowMat(FORCE, 0.3), 0.05)
    // Pipeline chips.
    const chips = PIPE.map(([, name], k) => tile(scene, [-17 + k * 7.6, -5.4, 0], 6.8, 1.5, name))
    const status = liveLabel(scene, [-24, -8.4, 0.3], { size: 0.44, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.6, 0], 0.36, 5)
    const clock = phaseClock()
    const s = { fill: [1, 0], drive: 0, pk: 0 }
    return {
      scene,
      view: { center: [0, 2.2, 0], radius: 84, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const O = otaRun(p)
        const { story } = O
        const c = clock(dt, `${O.image}|${O.rollback}|${O.rate}`, story.map((x) => x.s))
        const S = story[c.i]
        const k = S.key
        const running = S.slot >= 0 && k !== 'panic'
        // Robot: drives on while any healthy app runs.
        s.drive += dt * (running ? 1 : 0)
        if (running) carG.position.x = Math.sin(s.drive * 1.3) * 1.2
        carText.set(k === 'panic' ? `${S.version} panics: Guru Meditation` : S.slot < 0 ? 'rebooting: motors off' : `driving · ${S.version} on app${S.slot}`, k === 'panic' ? HIGH_V : S.slot < 0 ? HEAT : POWER)
        // Packets router → robot during the download.
        const dl = k === 'download'
        waves(c.u * story[c.i].s + c.i, DATA_COLOR, dl ? 0.8 : 0)
        router.led(0, POWER, 1)
        router.led(1, DATA_COLOR, dl && c.u * 20 % 1 < 0.5 ? 1 : 0.1)
        packets.begin()
        if (dl) {
          s.pk += dt
          for (let j = 0; j < 4; j++) {
            const u = (s.pk * 0.7 + j / 4) % 1
            const to: V3 = [car.antenna[0] + carG.position.x, car.antenna[1], car.antenna[2]]
            packets.put(arcAt(router.top, to, u, 2.5), DATA_COLOR, { w: 1.3, payload: 0.8, text: j === 0 ? '4 KB' : '' })
          }
        }
        packets.end()
        // Slots: fill of the new image, running marker.
        const written = k === 'download' ? c.u : k === 'run' ? 0 : 1
        s.fill[1] = glide(dt, s.fill[1], written, 10)
        slots.forEach((sl, j) => {
          const f = j === 0 ? 1 : s.fill[1]
          const w = (SLOT_W - 0.4) * f
          sl.fill.visible = w > 0.02
          sl.fill.scale.x = Math.max(0.01, w)
          sl.fill.position.x = sl.x - (SLOT_W - 0.4) / 2 + w / 2
          const bad = j === 1 && c.i >= story.findIndex((x) => x.key === (O.image === 'corrupt' ? 'reject' : 'panic')) && O.image !== 'good'
          setGlow(sl.fm, bad ? HIGH_V : j === 0 ? CLK_COLOR : DATA_COLOR, bad ? 0.6 : j === 0 ? 0.35 : 0.6)
          const on = S.slot === j && running
          setGlow(sl.m, j === S.slot ? (k === 'panic' ? HIGH_V : CLK_COLOR) : GREY, on ? 0.9 : 0.15)
          sl.text.set(j === 0 ? 'v1.0' : f > 0.995 ? 'v1.1' : f > 0.02 ? `v1.1 · ${Math.round(f * 100)} %` : 'empty', on ? INK : LABEL)
          sl.run.set(j === S.slot ? (k === 'panic' ? '✗ crashed' : 'running') : j === 1 && dl ? '← Update.write()' : '', k === 'panic' ? HIGH_V : j === S.slot ? POWER : DATA_COLOR)
        })
        // otadata sectors.
        const top = Math.max(...S.otadata.map((x) => x.seq))
        S.otadata.forEach((x, j) => {
          const color = STATE_COLOR[x.state]
          setGlow(otaMats[j], x.seq ? color : GREY, x.seq ? 0.9 : 0.15)
          setGlow(secs2[j].m, x.seq ? color : GREY, x.seq ? (x.seq === top ? 0.8 : 0.3) : 0.1)
          secs2[j].t.set(x.seq ? `seq ${x.seq} → app${(x.seq - 1) % 2}` : 'erased', x.seq ? INK : GREY)
          secs2[j].s.set(x.seq ? (x.state === 'unset' ? 'UNDEFINED' : x.state.toUpperCase().replace('PENDING', 'PENDING_VERIFY')) : '', INK)
        })
        const live = Math.max(0, ...S.otadata.filter((x) => x.state !== 'aborted').map((x) => x.seq))
        pick2.set(live ? `highest seq wins → app${(live - 1) % 2}` : top ? 'only ABORTED → app0' : 'empty → app0', LABEL)
        // Pipeline.
        const cur = PIPE.findIndex(([keys]) => keys.includes(k))
        chips.forEach((ch, j) => {
          const bad = j === cur && (k === 'reject' || k === 'panic' || k === 'rollback')
          ch(dt, j === cur, bad ? HIGH_V : j === 5 && k === 'valid' ? POWER : [DATA_COLOR, RING, FORCE, HEAT, CLK_COLOR, POWER][j])
        })
        const say: Record<OtaKey, string> = {
          run: 'v1.0 runs from app0; a new build is waiting on the server',
          download: `download: ${Math.round(c.u * 1000)} KB of ${bytesText(1000 * KB)} into app1 · the robot keeps driving`,
          verify: 'Update.end(): check the image header and its SHA-256',
          reject: 'SHA-256 mismatch: update rejected, otadata untouched · still v1.0',
          switch: `otadata[${S.otadata.findIndex((x) => x.seq === top)}] ← seq ${top}${O.rollback ? ' · NEW' : ''}: next boot runs app1`,
          reboot: 'ESP.restart(): motors stop for a moment',
          boot: O.rollback && S.otadata.some((x) => x.state === 'aborted') ? 'bootloader: app1 still PENDING_VERIFY → it never confirmed → ABORTED' : `bootloader reads otadata → boots app1${O.rollback ? ' as PENDING_VERIFY' : ''}`,
          health: 'v1.1 checks itself: Wi-Fi up, IMU answers, motors respond…',
          panic: O.rollback ? 'v1.1 crashes before marking itself valid' : 'v1.1 crashes; nothing marks it bad, so the bootloader picks it again',
          valid: 'healthy → esp_ota_mark_app_valid_cancel_rollback(): v1.1 is VALID',
          rollback: 'rolled back: v1.0 runs again from app0, the bad image is ignored',
        }
        const loopEnd = O.loop && c.i === story.length - 1
        status.set(`${loopEnd ? 'boot loop: crash → reboot → same image → crash … reflash over USB' : say[k]} · ${speedText(S.s)}`, loopEnd || k === 'reject' || k === 'panic' ? HIGH_V : LABEL)
        code(
          S.slot === 1 || k === 'boot' || k === 'rollback'
            ? O.rollback
              ? ['bool verifyRollbackLater() { return true; }  // the app confirms itself', 'void setup() { ... if (healthy())', '    esp_ota_mark_app_valid_cancel_rollback();  // PENDING_VERIFY → VALID', '  else esp_ota_mark_app_invalid_rollback_and_reboot(); }', '']
              : ['// rollback off: every image the bootloader starts counts as good', 'void setup() { initMotors(); connectWifi(); readImu(); ... }', O.image === 'crash' ? '// a crash in setup() → reset → same slot → crash again' : '', '', '']
            : [
                'HTTPClient http; http.begin("http://192.168.1.10/robot-v1.1.bin"); http.GET();',
                'Update.begin(http.getSize());  // picks the idle slot (app1) and erases it',
                'while (n = stream->readBytes(buf, 4096)) Update.write(buf, n);  // robot task keeps running',
                'if (Update.end()) ESP.restart();  // SHA-256 ok → otadata now points at app1',
                k === 'reject' ? '// Update.end() == false: Update.errorString() → "MD5 / SHA-256 Check Failed"' : '',
              ],
        )
      },
      readouts: (p) => {
        const O = otaRun(p)
        const L = O.last
        return [
          { label: 'Download', value: `${secs(O.dlS)} while driving`, tone: O.dlS > 15 ? 'warn' : 'ok' },
          { label: 'Robot downtime', value: O.loop ? 'until USB reflash' : secs(O.down), tone: O.loop ? 'bad' : 'ok' },
          { label: 'Ends on', value: O.loop ? 'boot loop' : `${L.version} · app${L.slot}`, tone: O.loop ? 'bad' : L.version === 'v1.1' ? 'ok' : 'warn' },
          { label: 'otadata', value: L.otadata.filter((x) => x.seq).map((x) => `seq ${x.seq} ${x.state === 'unset' ? 'no state' : x.state}`).join(' · ') || 'erased (app0)' },
        ]
      },
    }
  },
}
