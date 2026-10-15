import * as THREE from 'three/webgpu'
import {
  MisoState,
  SD_BUSY_S,
  SD_SPI_MAX,
  SD_WRITE_PARTS,
  SpiMode,
  TFT,
  frameRate,
  i2cByteRate,
  misoByte,
  misoLine,
  misoRead,
  sdBlockWrite,
  spiByteRate,
  spiLines,
  spiPha,
  spiPol,
  spiSamplesRising,
  spiShift,
  tftFrameBytes,
} from '../../core/physics'
import { amps, hexByte, secs, si, volts } from '../../core/units'
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
  captureScreen,
  codeBlock,
  esp32Board,
  frac,
  glowMat,
  i2cBreakout,
  junction,
  liveLabel,
  memoBy,
  partLetter,
  path,
  setGlow,
  signalWire,
  wire,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const MISO_COLOR = FORCE
const SPI_HZ = 1e6
const T = 1 / SPI_HZ
const LEAD = T / 2
const PAD = T
const bitOf = (v: number, k: number) => Math.floor(v / 2 ** (7 - k)) % 2
/** Bit cell (0…8) at time t of a one-byte spiLines frame. */
const cellAt = (t: number) => (t - LEAD) / T

type Row = { label: string; color: string }
/** Capture of SPI lines over one byte; `draw` takes a level (0…1) function per row and the head time. */
function spiScreen(parent: THREE.Object3D, at: V3, rows: Row[], width: number, rowH: number, decoder = false) {
  const cap = captureScreen(parent, at, rows, { width, rowH, decoder })
  const ch = rows.map((_, k) => cap.channel(k, { samples: 360 }))
  const win = 8 * T + 2 * LEAD + 2 * PAD
  const uOf = (t: number) => (t + PAD) / win
  return {
    cap,
    uOf,
    tOf: (u: number) => -PAD + u * win,
    draw(levels: ((t: number) => number)[], head: number) {
      const hu = Math.min(1, uOf(head))
      ch.forEach((c, k) => c.draw((u) => levels[k](-PAD + Math.min(u, hu) * win), hu < 1 ? hu : null))
    },
  }
}

// --- Clock modes: two 8-bit shift registers in a ring; each clock one bit leaves each, so after 8 they have swapped. ---

const CM_REVEAL = 8
const CM_HOLD = 2.4
const CM_PAIRS = {
  a5: [0xa5, 0x3c],
  d0: [0xd0, 0x60],
  f0: [0xf0, 0x81],
} as const
const MODES: SpiMode[] = [0, 1, 2, 3]
const modeOf = (p: Params) => (MODES.includes(Number(p.mode) as SpiMode) ? Number(p.mode) : 0) as SpiMode

const cmSetup = (p: Params) => {
  const mode = modeOf(p)
  const pairKey = pick(CM_PAIRS, p.pair, 'a5')
  const [m, s] = CM_PAIRS[pairKey]
  const rising = spiSamplesRising(mode)
  return { mode, pairKey, m, s, pol: spiPol(mode), pha: spiPha(mode), rising, edge: rising ? 'rising' : 'falling', other: rising ? 'falling' : 'rising' }
}
const cmLines = memoBy(
  (p: Params) => `${p.mode}|${p.pair}`,
  (p: Params) => {
    const S = cmSetup(p)
    return spiLines([S.m], [S.s], S.mode, SPI_HZ)
  },
)

export const clockModes: Lesson = {
  id: 'spi-clock-modes',
  title: 'Clock modes',
  tagline: 'Two shift registers in a ring, one bit each way per clock',
  formula: (p) => {
    const S = cmSetup(p)
    return `Mode ${S.mode} = CPOL ${S.pol} (SCK idles ${S.pol ? 'high' : 'low'}) + CPHA ${S.pha} (read on the ${S.pha ? 'second' : 'first'} edge) → sample on ${S.edge}, shift on ${S.other} · after 8 clocks ESP32 ${hexByte(S.m)} → ${hexByte(S.s)}, sensor ${hexByte(S.s)} → ${hexByte(S.m)} · 1 MHz, slowed ${Math.round(CM_REVEAL / (10 * T)).toLocaleString('en')}×`
  },
  legend: [
    { color: DATA_COLOR, label: 'ESP32 byte, out on MOSI', shape: 'dot' },
    { color: MISO_COLOR, label: 'Sensor byte, back on MISO', shape: 'dot' },
    { color: CLK_COLOR, label: 'SCK from the ESP32; CS low frames it', shape: 'dot' },
    { color: RING, label: 'Sampling edge: both ends latch a bit', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Inside both ends of an SPI link sits an 8-bit shift register. MOSI joins the ESP32’s top bit to the sensor’s bottom bit, MISO the sensor’s top bit to the ESP32’s bottom bit: one ring of 16 bits.',
    'Every clock rotates the ring by one: a bit leaves each side and enters the other. After 8 clocks the two bytes have swapped. That is why SPI is always full duplex: to read a byte you must send one, even a dummy 0x00.',
    'The clock has two settings. CPOL is where SCK rests between transfers (0 low, 1 high). CPHA says which edge reads: 0 the first edge after CS falls, 1 the second. Data changes on the other edge, so it is steady when read.',
    'Together they make modes 0–3. Mode 0 (idle low, read on rising) is by far the most common; SD cards and most sensors use it. Some ADCs and displays want mode 1 or 3: check the datasheet timing diagram.',
    'Both ends must agree. The wrong mode reads every bit half a clock early or late, shifting the byte by a bit; see Logic analyzer → Capture SPI for what that looks like.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: MODES.map((m) => ({ value: String(m), label: `Mode ${m}` })), initial: '0' },
    {
      kind: 'choice',
      key: 'pair',
      options: [
        { value: 'a5', label: 'A5 ⇄ 3C' },
        { value: 'd0', label: 'D0 ⇄ 60' },
        { value: 'f0', label: 'F0 ⇄ 81' },
      ],
      initial: 'a5',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const CW = 2
    const X0 = -7
    const MY = 5.5
    const SY = 0.5
    const mx = (b: number) => X0 + (7 - b) * CW
    const sx = (b: number) => X0 + b * CW
    const xl = X0 - 2.6
    const xr = X0 + 7 * CW + 2.6
    const cellGeo = new THREE.BoxGeometry(CW * 0.92, 1.8, 0.4)
    const lsb = [mx(0), sx(0)].map((x, i) => {
      const m = mat('#1c1e24', { emissive: '#000000' }, true)
      add(scene, mesh(cellGeo, m), [x, i ? SY : MY, 0])
      return m
    })
    for (let b = 1; b < 8; b++) {
      add(scene, mesh(cellGeo, mat('#1c1e24')), [mx(b), MY, 0])
      add(scene, mesh(cellGeo, mat('#1c1e24')), [sx(b), SY, 0])
    }
    for (let b = 0; b < 8; b++) {
      partLetter(scene, `b${b}`, [mx(b), MY + 1.4, 0], 0.4, GREY)
      partLetter(scene, `b${b}`, [sx(b), SY - 1.5, 0], 0.4, GREY)
    }
    partLetter(scene, 'ESP32', [xl - 0.9, MY + 0.3, 0], 0.6, LABEL, 'right')
    partLetter(scene, 'master', [xl - 0.9, MY - 0.7, 0], 0.4, GREY, 'right')
    partLetter(scene, 'BME280', [xl - 0.9, SY + 0.3, 0], 0.6, LABEL, 'right')
    partLetter(scene, 'slave', [xl - 0.9, SY - 0.7, 0], 0.4, GREY, 'right')
    const mosiPts: V3[] = [[X0 - CW / 2, MY, 0], [xl, MY, 0], [xl, SY, 0], [X0 - CW / 2, SY, 0]]
    const misoPts: V3[] = [[X0 + 7.5 * CW, SY, 0], [xr, SY, 0], [xr, MY, 0], [X0 + 7.5 * CW, MY, 0]]
    const mosiW = signalWire(scene, mosiPts)
    const misoW = signalWire(scene, misoPts)
    partLetter(scene, 'MOSI', [xl - 0.5, (MY + SY) / 2, 0], 0.48, DATA_COLOR, 'right')
    partLetter(scene, 'MISO', [xr + 0.5, (MY + SY) / 2, 0], 0.48, MISO_COLOR, 'left')
    const sckW = signalWire(scene, [[0, MY - 1.1, 0], [0, SY + 1.1, 0]])
    partLetter(scene, 'SCK', [0.5, (MY + SY) / 2, 0], 0.45, CLK_COLOR, 'left')
    const sckTag = liveLabel(scene, [-0.5, (MY + SY) / 2, 0], { size: 0.42, align: 'right' })
    const mVal = liveLabel(scene, [xr + 1.6, MY, 0], { size: 0.7, align: 'left' })
    const sVal = liveLabel(scene, [xr + 1.6, SY, 0], { size: 0.7, align: 'left' })
    const z = 0.55
    const cellPos = (c: number): V3 => (c < 8 ? [mx(c), MY, z] : [sx(c - 8), SY, z])
    const mosiPath = path([cellPos(7), ...mosiPts.slice(1, 3).map(([x, y]): V3 => [x, y, z]), cellPos(8)])
    const misoPath = path([cellPos(15), ...misoPts.slice(1, 3).map(([x, y]): V3 => [x, y, z]), cellPos(0)])
    const ringAt = (c: number, out: THREE.Vector3) => {
      const r = ((c % 16) + 16) % 16
      const i = Math.floor(r)
      const f = r - i
      if (i === 7) return mosiPath.getPointAt(f, out)
      if (i === 15) return misoPath.getPointAt(f, out)
      const a = cellPos(i)
      const b = cellPos(i + 1)
      return out.set(a[0] + (b[0] - a[0]) * f, a[1], z)
    }
    const tokGeo = new THREE.BoxGeometry(1.35, 1.35, 0.35)
    const tokens = Array.from({ length: 16 }, (_, c) => {
      const g = add(scene, new THREE.Group())
      add(g, mesh(tokGeo, glowMat(c < 8 ? DATA_COLOR : MISO_COLOR, 0.35))).castShadow = false
      return { g, d: liveLabel(g, [0, -0.22, 0.3], { size: 0.62 }) }
    })
    const scr = spiScreen(
      scene,
      [1.5, -7.6, 0],
      [
        { label: 'CS', color: HEAT },
        { label: 'SCK', color: CLK_COLOR },
        { label: 'MOSI', color: DATA_COLOR },
        { label: 'MISO', color: MISO_COLOR },
      ],
      28,
      1.3,
    )
    const markGeo = new THREE.BoxGeometry(0.12, scr.cap.height, 0.1)
    const marks = Array.from({ length: 8 }, (_, k) => {
      const m = glowMat(RING, 0.8)
      const o = add(scr.cap.group, mesh(markGeo, m), [scr.cap.xAt(scr.uOf(LEAD + (k + 0.5) * T)), 0, 0.15])
      o.castShadow = false
      return o
    })
    const edgeTag = liveLabel(scr.cap.group, [-14, scr.cap.height / 2 + 0.8, 0], { size: 0.5, align: 'left' })
    const code = codeBlock(scene, [-23, -1.6, 0], 0.4, 4)
    const v = new THREE.Vector3()
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-3, -0.5, 0], radius: 70, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = cmSetup(p)
        const L = cmLines(p)
        const key = `${S.mode}|${S.pairKey}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t = (s.t + dt) % (CM_REVEAL + CM_HOLD)
        const prog = Math.min(1, s.t / CM_REVEAL)
        const t = scr.tOf(prog)
        const cf = cellAt(t)
        const k = Math.floor(cf)
        const moved = cf < 0 ? 0 : cf >= 8 ? 8 : k + Math.min(1, frac(cf) * 2)
        const landed = Math.floor(moved + 1e-9)
        tokens.forEach((tk, c) => {
          ringAt(c + moved, v)
          tk.g.position.copy(v)
          tk.d.set(String(c < 8 ? bitOf(S.m, 7 - c) : bitOf(S.s, 15 - c)), LABEL)
        })
        const latch = cf >= 0 && cf < 8 && frac(cf) >= 0.5 && frac(cf) < 0.72
        lsb.forEach((m) => {
          m.emissive.set(latch ? RING : '#000000')
          m.emissiveIntensity = latch ? 0.6 : 0
        })
        const [rm, rs] = spiShift(S.m, S.s, landed)
        mVal.set(hexByte(rm), landed === 8 ? MISO_COLOR : LABEL)
        sVal.set(hexByte(rs), landed === 8 ? DATA_COLOR : LABEL)
        const sck = L.sck(t)
        sckW(sck)
        mosiW(L.mosi(t))
        misoW(L.miso(t))
        sckTag.set(L.cs(t) ? `idle ${sck ? 'high' : 'low'}` : `clock ${Math.min(8, k + 1)} / 8`, L.cs(t) ? GREY : CLK_COLOR)
        scr.draw([L.cs, L.sck, L.mosi, L.miso], t)
        marks.forEach((o, j) => (o.visible = t >= LEAD + (j + 0.5) * T))
        edgeTag.set(`Mode ${S.mode} · SCK idles ${S.pol ? 'high' : 'low'} · read on ${S.edge} · change on ${S.other}`, RING)
        code([
          `SPISettings s(1000000, MSBFIRST, SPI_MODE${S.mode});`,
          'SPI.beginTransaction(s);',
          `byte got = SPI.transfer(${hexByte(S.m)});`,
          `// got = ${hexByte(S.s)}`,
        ])
      },
      readouts: (p) => {
        const S = cmSetup(p)
        return [
          { label: 'Mode', value: `${S.mode}: CPOL ${S.pol} · CPHA ${S.pha}` },
          { label: 'Clock idles', value: S.pol ? 'high' : 'low' },
          { label: 'Bits read on', value: `${S.edge} edge (${S.pha ? '2nd' : '1st'})` },
          { label: 'After 8 clocks', value: `ESP32 ${hexByte(S.s)} · sensor ${hexByte(S.m)}`, tone: 'ok' },
        ]
      },
    }
  },
}

// --- Chip select: SCK/MOSI/MISO are shared, each device gets its own CS; only the selected one may drive MISO. ---

const CS_REVEAL = 5
const CS_HOLD = 2.4
const CS_DEVS = [
  { name: 'SD card', short: 'SD', color: '#1d3d8f', cmd: 0xff, reply: 0x01 },
  { name: 'ST7735', short: 'TFT', color: '#8a1c1c', cmd: 0xda, reply: 0x7c },
  { name: 'BME280', short: 'BME', color: '#5b2a86', cmd: 0xd0, reply: 0x60 },
]
const CS_SEL = {
  sd: [true, false, false],
  tft: [false, true, false],
  bme: [false, false, true],
  none: [false, false, false],
  two: [true, false, true],
}
const csSetup = (p: Params) => {
  const which = pick(CS_SEL, p.cs, 'bme')
  const sel = CS_SEL[which]
  const target = which === 'sd' ? 0 : which === 'tft' ? 1 : 2
  const bits = misoRead(
    CS_DEVS.map((d) => d.reply),
    sel,
  )
  const states = bits.map((b) => b.state)
  const fight = bits.find((b) => b.state === 'clash') ?? misoLine([1, 0])
  return { which, sel, target, dev: CS_DEVS[target], bits, states, got: misoByte(states), clash: states.includes('clash'), fight }
}
const BIT_TEXT: Record<string, [string, string]> = { 0: ['0', MISO_COLOR], 1: ['1', MISO_COLOR], z: ['Z', GREY], clash: ['X', HIGH_V] }
const misoLevel = (st: MisoState | undefined, t: number) =>
  st === undefined ? 1 : st === 'z' ? 0.5 + 0.22 * Math.sin(t * 2.3e6) * Math.cos(t * 0.9e6) : st === 'clash' ? 0.5 : st

export const chipSelect: Lesson = {
  id: 'spi-chip-select',
  title: 'Chip select',
  tagline: 'Three wires shared, one CS each, one talker on MISO',
  formula: (p) => {
    const S = csSetup(p)
    return `n devices = 3 shared wires (SCK, MOSI, MISO) + n CS pins · CS high → MISO off (high-Z) · two on MISO: ${volts(S.fight.volts ?? 0)} = 3.3 V × 33 Ω / (33 + 33 Ω), I = 3.3 V / 66 Ω = ${amps(S.fight.amps)} · slowed ${Math.round(CS_REVEAL / (10 * T)).toLocaleString('en')}×`
  },
  legend: [
    { color: HEAT, label: 'CS: one per device, low = selected', shape: 'dot' },
    { color: CLK_COLOR, label: 'SCK and MOSI: every device hears them', shape: 'dot' },
    { color: MISO_COLOR, label: 'MISO: only the selected device drives it', shape: 'dot' },
    { color: HIGH_V, label: 'X: two outputs fighting', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'SCK, MOSI and MISO go to every device; each device also gets its own chip-select line from a separate GPIO. Three devices cost 3 + 3 = 6 pins, where I²C would need 2.',
    'A device only listens while its CS is low. With CS high it ignores the clock and lets go of MISO: its output goes high-impedance (Z), as if unplugged, so the others can use the wire.',
    'Pull exactly one CS low at a time. If two are low, both chips answer on MISO; where one drives 1 and the other 0, the two output stages short 3.3 V to ground through ~66 Ω: ~50 mA, 1.65 V, a level neither high nor low.',
    'The classic cause is a CS pin left floating or low at boot: pinMode(CS, OUTPUT) starts LOW. Write each CS HIGH first, and fit 10 kΩ pull-ups so chips stay deselected while the ESP32 resets.',
    'With nobody selected MISO floats and you read noise, often 0xFF or 0x00. Some cheap SD modules never release MISO at all; that breaks any other device on the bus.',
    'Each chip here answers one byte; for a real register read, frame by frame, see Logic analyzer → Capture SPI.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'cs',
      options: [
        { value: 'sd', label: 'CS SD' },
        { value: 'tft', label: 'CS TFT' },
        { value: 'bme', label: 'CS BME' },
        { value: 'none', label: 'None' },
        { value: 'two', label: 'SD + BME' },
      ],
      initial: 'bme',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const k = 0.45
    const espAt: V3 = [-19.5, -2.5, 0]
    const pin = esp32Board(scene, espAt, k)
    partLetter(scene, 'ESP32', [espAt[0], espAt[1] - 5 * k - 0.9, 0], 0.55, LABEL)
    const x1 = 14
    const ys = { SCK: 2, MOSI: 2.9, MISO: 3.8 }
    const csY = [4.9, 5.8, 6.7]
    const busPins: [keyof typeof ys, number, string][] = [
      ['SCK', 1, CLK_COLOR],
      ['MOSI', 0, DATA_COLOR],
      ['MISO', -1, MISO_COLOR],
    ]
    const lines: Record<string, ((v: number) => void)[]> = { SCK: [], MOSI: [], MISO: [] }
    for (const [nm, i, color] of busPins) {
      const pt = pin(i, true)
      lines[nm].push(signalWire(scene, [pt, [pt[0], ys[nm], 0], [x1, ys[nm], 0]]))
      partLetter(scene, nm, [x1 + 0.6, ys[nm], 0], 0.42, color, 'left')
    }
    const csLines = CS_DEVS.map((d, j) => {
      const pt = pin(-3 - j, true)
      partLetter(scene, `CS ${d.short}`, [x1 + 0.6, csY[j], 0], 0.42, HEAT, 'left')
      return [signalWire(scene, [pt, [pt[0], csY[j], 0], [x1, csY[j], 0]])]
    })
    const devs = CS_DEVS.map((d, j) => {
      const x = -6 + j * 7.5
      const bk = i2cBreakout(scene, [x, -2.5, 0], { name: d.name, color: d.color, k: 0.3, pins: ['CS', 'SCK', 'MOSI', 'MISO'] })
      bk.led(1)
      for (const nm of ['SCK', 'MOSI', 'MISO'] as const) {
        const t = bk.pin(nm)
        lines[nm].push(signalWire(scene, [t, [t[0], ys[nm], 0]]))
        junction(scene, [t[0], ys[nm], 0], 0.16).set(1)
      }
      const c = bk.pin('CS')
      csLines[j].push(signalWire(scene, [c, [c[0], csY[j], 0]]))
      junction(scene, [c[0], csY[j], 0], 0.16).set(1)
      return { bk, tag: liveLabel(scene, [x, -5.8, 0], { size: 0.48 }), sub: liveLabel(scene, [x, -6.8, 0], { size: 0.4 }) }
    })
    const fightTag = liveLabel(scene, [8.5, ys.MISO + 0.5, 0.6], { size: 0.45 })
    const readTag = liveLabel(scene, [espAt[0], espAt[1] - 5 * k - 2, 0], { size: 0.5 })
    const scr = spiScreen(
      scene,
      [2.5, -11.6, 0],
      [
        { label: 'SCK', color: CLK_COLOR },
        { label: 'MOSI', color: DATA_COLOR },
        { label: 'MISO', color: MISO_COLOR },
      ],
      24,
      1.3,
      true,
    )
    const code = codeBlock(scene, [-25.5, -9.6, 0], 0.38, 4)
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-4.5, -2, 0], radius: 74, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = csSetup(p)
        if (S.which !== s.key) Object.assign(s, { key: S.which, t: 0 })
        s.t = (s.t + dt) % (CS_REVEAL + CS_HOLD)
        const t = scr.tOf(Math.min(1, s.t / CS_REVEAL))
        const L = spiLines([S.dev.cmd], [0xff], 0, SPI_HZ)
        const active = !L.cs(t)
        const cf = cellAt(t)
        const bitNow = cf >= 0 && cf < 8 ? Math.floor(cf) : -1
        const any = S.sel.some(Boolean)
        const misoAt = (tt: number) => {
          const c = cellAt(tt)
          if (!any || L.cs(tt)) return misoLevel(any ? undefined : 'z', tt)
          return misoLevel(c >= 0 && c < 8 ? S.states[Math.floor(c)] : undefined, tt)
        }
        lines.SCK.forEach((w) => w(L.sck(t)))
        lines.MOSI.forEach((w) => w(L.mosi(t)))
        const mNow = active ? (bitNow >= 0 ? S.states[bitNow] : any ? 1 : 'z') : 'z'
        lines.MISO.forEach((w) => w(mNow === 'z' || mNow === 'clash' ? 0.5 : mNow))
        csLines.forEach((ws, j) => ws.forEach((w) => w(active && S.sel[j] ? 0 : 1)))
        devs.forEach((d, j) => {
          const on = S.sel[j]
          const col = on ? (S.clash ? HIGH_V : POWER) : GREY
          d.bk.chip(col, on && active ? 0.85 : 0)
          d.tag.set(on && active ? 'CS low · selected' : 'CS high', on && active ? HEAT : GREY)
          d.sub.set(on && active ? `drives MISO: ${hexByte(CS_DEVS[j].reply)}` : 'MISO off (Z)', on && active ? col : GREY)
        })
        fightTag.set(mNow === 'clash' ? `FIGHT · ${volts(S.fight.volts ?? 0)} · ${amps(S.fight.amps)}` : mNow === 'z' && active ? 'floating' : '', mNow === 'clash' ? HIGH_V : GREY)
        const done = t >= LEAD + 8 * T
        readTag.set(
          !done ? (active ? 'reading…' : '') : S.got === null ? (S.clash ? 'read: garbage' : 'read: noise') : `read ${hexByte(S.got)}`,
          !done ? GREY : S.got === null ? HIGH_V : POWER,
        )
        scr.draw([L.sck, L.mosi, misoAt], t)
        scr.cap.annotate(
          S.states
            .map((st, j) => ({ st, j, u0: scr.uOf(LEAD + (j + 0.08) * T), u1: scr.uOf(LEAD + (j + 0.92) * T) }))
            .filter((b) => b.j < bitNow || done)
            .map((b) => {
              const [text, color] = BIT_TEXT[String(b.st)]
              return { u0: b.u0, u1: b.u1, text, color }
            }),
        )
        const cs = `CS_${S.dev.short}`
        code(
          S.which === 'none'
            ? ['// CS never pulled low', `byte v = SPI.transfer(${hexByte(S.dev.cmd)});`, '// MISO floats: v is noise', '']
            : [
                S.which === 'two' ? 'pinMode(CS_SD, OUTPUT);  // starts LOW!' : `digitalWrite(${cs}, LOW);`,
                ...(S.which === 'two' ? [`digitalWrite(${cs}, LOW);`] : []),
                `byte v = SPI.transfer(${hexByte(S.dev.cmd)});`,
                `digitalWrite(${cs}, HIGH);`,
              ],
        )
      },
      readouts: (p) => {
        const S = csSetup(p)
        const on = CS_DEVS.filter((_, j) => S.sel[j]).map((d) => d.short)
        return [
          { label: 'Selected', value: on.length ? on.join(' + ') : 'nobody', tone: on.length === 1 ? 'ok' : 'bad' },
          { label: 'MISO bits', value: S.states.map((b) => BIT_TEXT[String(b)][0]).join('') },
          { label: 'ESP32 reads', value: S.got === null ? (S.clash ? 'garbage' : 'noise') : hexByte(S.got), tone: S.got === null ? 'bad' : 'ok' },
          { label: 'Fight current', value: S.clash ? `${amps(S.fight.amps)} at ${volts(S.fight.volts ?? 0)}` : 'none', tone: S.clash ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- SD cards and displays: SPI's clock runs 100× faster than I²C; a TFT frame or an SD block shows what that buys. ---

const SD_REVEAL = 4.5
const SD_HOLD = 2
const CLOCKS = { '1': 1e6, '10': 10e6, '20': 20e6, '40': 40e6, '80': 80e6 } as const
const JOBS = { tft: 'tft', sd: 'sd' } as const
const GX = 32
const GY = 40
const BLK = TFT.w / GX
const decades = [3, 4, 5, 6, 7]

const sdSetup = (p: Params) => {
  const job = JOBS[pick(JOBS, p.job, 'tft')]
  const clkKey = pick(CLOCKS, p.clk, '40')
  const hz = CLOCKS[clkKey]
  const frame = tftFrameBytes()
  const spiRate = spiByteRate(hz)
  const block = sdBlockWrite(hz)
  const rates = [
    { name: 'I²C 100 kHz', rate: i2cByteRate(100e3) },
    { name: 'I²C 400 kHz', rate: i2cByteRate(400e3) },
    { name: `SPI ${clkKey} MHz`, rate: spiRate },
    { name: `SD write ${block.clk / 1e6} MHz`, rate: block.rate },
  ]
  const dur = job === 'tft' ? (frame * 8) / hz : block.total
  return { job, clkKey, hz, frame, spiRate, fps: frameRate(spiRate, frame), block, rates, dur }
}
const bps = (r: number) => si(r, 'B/s', 3)
const fpsText = (f: number) => f.toFixed(f < 2 ? 2 : f < 20 ? 1 : 0)

export const sdCardsAndDisplays: Lesson = {
  id: 'spi-sd-cards-and-displays',
  title: 'SD cards and displays',
  tagline: 'Where megabytes per second matter',
  formula: (p) => {
    const S = sdSetup(p)
    return S.job === 'tft'
      ? `${TFT.w} × ${TFT.h} px × 2 B (RGB565) + 11 B = ${S.frame.toLocaleString('en')} B · SPI ${S.clkKey} MHz / 8 = ${bps(S.spiRate)} → ${S.fps.toFixed(1)} fps · I²C 400 kHz / 9 = ${bps(i2cByteRate(400e3))} → ${frameRate(i2cByteRate(400e3), S.frame).toFixed(2)} fps · slowed ${Math.round(SD_REVEAL / S.dur).toLocaleString('en')}×`
      : `CMD24 block write: ${S.block.bytes} B × 8 / ${S.block.clk / 1e6} MHz = ${secs(S.block.bus)} + card busy ${secs(S.block.busy)} = ${secs(S.block.total)} → 512 B / ${secs(S.block.total)} = ${bps(S.block.rate)} · slowed ${Math.round(SD_REVEAL / S.dur).toLocaleString('en')}×`
  },
  legend: [
    { color: DATA_COLOR, label: 'Bytes sent on MOSI', shape: 'dot' },
    { color: HEAT, label: 'SD card busy: holds MISO low', shape: 'dot' },
    { color: POWER, label: 'Bar: bytes/s, log scale', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'I²C at 400 kHz moves about 44 kB/s: 9 clocks per byte with the ACK. SPI has no address or ACK and clocks far faster: the ESP32 runs it at up to 80 MHz on its native pins (≈ 26 MHz through the GPIO matrix): 10 MB/s.',
    `A 1.8" ST7735 TFT is 128 × 160 pixels at 2 bytes each: ${tftFrameBytes().toLocaleString('en')} bytes a frame. Over I²C that is about one frame a second; over SPI at 40 MHz it is over 100 fps, enough to animate.`,
    'Displays are written, not read: set the window (CASET, RASET), send RAMWR, then stream pixels. A DC pin tells command bytes from data, so MISO often isn’t even wired.',
    'SD cards speak SPI too: start at 400 kHz, then up to 25 MHz. A write is CMD24, a 0xFE token, 512 data bytes and a CRC; then the card holds MISO low while it programs flash.',
    `That busy time (typically ~${secs(SD_BUSY_S)}, sometimes 100s of ms) dwarfs the transfer, so a faster clock barely helps one block. Buffer data and write big chunks (CMD25, multi-block) to get MB/s.`,
    'Wiring for both: keep SPI wires short at 40 MHz+, share SCK/MOSI/MISO, one CS each. See Chip select.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'job',
      options: [
        { value: 'tft', label: 'TFT frame' },
        { value: 'sd', label: 'SD block' },
      ],
      initial: 'tft',
    },
    { kind: 'choice', key: 'clk', options: Object.keys(CLOCKS).map((c) => ({ value: c, label: `${c} MHz` })), initial: '40' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const espAt: V3 = [-20, 4, 0]
    const k = 0.42
    const pin = esp32Board(scene, espAt, k)
    partLetter(scene, 'ESP32', [espAt[0], espAt[1] - 5 * k - 0.9, 0], 0.5, LABEL)
    const px = 0.22
    const tx = -6
    const ty = 4
    box(scene, [GX * px + 1.6, GY * px + 3.2, 0.5], mat('#8a1c1c', { rough: 0.55 }), [tx, ty + 0.4, -0.5])
    box(scene, [GX * px + 0.4, GY * px + 0.4, 0.2], mat('#0a0b0e', { rough: 0.3 }), [tx, ty, -0.15])
    partLetter(scene, 'ST7735 128x160', [tx, ty - (GY * px) / 2 - 1.4, 0], 0.4, LABEL)
    const pixels = new THREE.InstancedMesh(new THREE.BoxGeometry(px * 0.9, px * 0.9, 0.08), new THREE.MeshBasicMaterial({ color: '#ffffff' }), GX * GY)
    add(scene, pixels)
    pixels.castShadow = false
    const dummy = new THREE.Object3D()
    const img = new THREE.Color()
    const black = new THREE.Color('#050506')
    const colors = Array.from({ length: GX * GY }, (_, i) => {
      const x = i % GX
      const y = Math.floor(i / GX)
      dummy.position.set(tx + (x - (GX - 1) / 2) * px, ty + ((GY - 1) / 2 - y) * px, 0)
      dummy.updateMatrix()
      pixels.setMatrixAt(i, dummy.matrix)
      const r = Math.hypot(x - 16, y - 17)
      return new THREE.Color().setHSL(r < 9 ? 0.12 : (0.55 + y / 120) % 1, r < 9 ? 0.9 : 0.6, r < 9 ? 0.55 : 0.25 + (y / GY) * 0.25)
    })
    const tftHead = [tx - 1.8, ty + (GY * px) / 2 + 1.6, 0] as V3
    const sdx = 10
    const sdy = 6.6
    box(scene, [3.6, 4.6, 0.3], mat('#1d3d8f', { rough: 0.5 }), [sdx - 7.5, sdy - 0.6, -0.3])
    for (let i = 0; i < 6; i++) box(scene, [0.34, 0.9, 0.1], mat('#c9a43a', { metal: 0.3, rough: 0.4 }), [sdx - 8.9 + i * 0.55, sdy + 1.1, -0.1])
    partLetter(scene, 'SD', [sdx - 7.5, sdy - 1.2, 0], 0.7, LABEL)
    const cw = 0.36
    const sdCols = 32
    const sdRows = 16
    const sx0 = sdx - 4.6
    const cells = new THREE.InstancedMesh(new THREE.BoxGeometry(cw * 0.86, cw * 0.86, 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), sdCols * sdRows)
    add(scene, cells)
    cells.castShadow = false
    for (let i = 0; i < sdCols * sdRows; i++) {
      dummy.position.set(sx0 + (i % sdCols) * cw, sdy + 1.6 - Math.floor(i / sdCols) * cw, 0)
      dummy.updateMatrix()
      cells.setMatrixAt(i, dummy.matrix)
    }
    partLetter(scene, 'one 512-byte block', [sx0, sdy + 2.7, 0], 0.42, GREY, 'left')
    const partTag = liveLabel(scene, [sx0, sdy + 1.6 - sdRows * cw - 0.6, 0], { size: 0.48, align: 'left' })
    const busyBar = add(scene, mesh(new THREE.BoxGeometry(1, 0.5, 0.2), glowMat(HEAT, 0.7)))
    busyBar.castShadow = false
    const barX = sx0
    const barW = sdCols * cw
    const barY = sdy + 1.6 - sdRows * cw - 1.6
    const sdHead = [sdx - 7.5, sdy + 1.7, 0] as V3
    const sck = pin(1, true)
    const mosi = pin(0, true)
    const toTft = signalWire(scene, [mosi, [mosi[0], 10.6, 0], [tftHead[0], 10.6, 0], tftHead])
    const toSd = signalWire(scene, [sck, [sck[0], 11.6, 0], [sdHead[0], 11.6, 0], sdHead])
    wire(scene, [[tftHead[0] + 0.6, 10.6, 0], [tftHead[0] + 0.6, 11.6, 0]], 0.12)
    partLetter(scene, 'SCK MOSI MISO CS', [-12, 12.4, 0], 0.4, GREY)
    const progTag = liveLabel(scene, [tx, ty - (GY * px) / 2 - 2.4, 0], { size: 0.48 })

    const cx0 = -10
    const cwid = 22
    const cy0 = -7
    const xOf = (r: number) => cx0 + ((Math.log10(r) - 3) / 4) * cwid
    const bars = [0, 1, 2, 3].map((i) => {
      const y = cy0 - i * 1.5
      const m = glowMat(POWER, 0.5)
      const b = add(scene, mesh(new THREE.BoxGeometry(1, 0.9, 0.3), m), [cx0, y, 0])
      b.castShadow = false
      return { b, m, y, name: liveLabel(scene, [cx0 - 0.6, y - 0.2, 0], { size: 0.42, align: 'right' }), val: liveLabel(scene, [0, y - 0.2, 0], { size: 0.42, align: 'left' }) }
    })
    wire(scene, [[cx0, cy0 + 0.9, 0], [cx0, cy0 - 5.4, 0]], 0.06)
    for (const d of decades) partLetter(scene, ['1k', '10k', '100k', '1M', '10M'][d - 3], [xOf(10 ** d), cy0 - 6, 0], 0.38, GREY)
    partLetter(scene, 'bytes / s', [cx0 - 0.8, cy0 - 6, 0], 0.38, GREY, 'right')
    const code = codeBlock(scene, [-25, -1.8, 0], 0.42, 3)
    const s = { key: '', t: 0, hot: 0 }
    return {
      scene,
      view: { center: [-4, 1.5, 0], radius: 80, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = sdSetup(p)
        const key = `${S.job}|${S.clkKey}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t = (s.t + dt) % (SD_REVEAL + SD_HOLD)
        const prog = Math.min(1, s.t / SD_REVEAL)
        const tSim = prog * S.dur
        const sending = prog < 1
        const tft = S.job === 'tft'
        const lit = tft ? Math.max(0, (prog * S.frame - TFT.setup) / 2) : 0
        const rowsDone = lit / TFT.w
        for (let i = 0; i < GX * GY; i++) pixels.setColorAt(i, (Math.floor(i / GX) + 1) * BLK <= rowsDone ? colors[i] : black)
        pixels.instanceColor!.needsUpdate = true
        const sent = tft ? 0 : (tSim * S.block.clk) / 8
        const data = Math.max(0, Math.min(512, sent - 9))
        for (let i = 0; i < sdCols * sdRows; i++) cells.setColorAt(i, img.set(i < data ? DATA_COLOR : '#1c1e24'))
        cells.instanceColor!.needsUpdate = true
        let acc = 0
        const part = SD_WRITE_PARTS.find((q) => (acc += q.bytes) > sent)
        const busy = !tft && tSim >= S.block.bus
        const busyF = busy ? Math.min(1, (tSim - S.block.bus) / S.block.busy) : 0
        busyBar.visible = busy
        busyBar.scale.x = Math.max(0.01, barW * busyF)
        busyBar.position.set(barX + (barW * busyF) / 2 - cw / 2, barY, 0)
        partTag.set(
          tft ? '' : busy ? `busy ${secs(S.block.busy)}: MISO low` : part?.part === 'data' ? `data ${Math.floor(data)} / 512` : (part?.part ?? ''),
          busy ? HEAT : DATA_COLOR,
        )
        progTag.set(tft ? `${secs(tSim)} · ${Math.round(Math.min(TFT.h, rowsDone))} / ${TFT.h} rows` : '', tft ? DATA_COLOR : GREY)
        s.hot = (s.hot + dt * 6) % 1
        const flick = sending && !busy ? (s.hot < 0.5 ? 1 : 0) : 0
        toTft(tft ? flick : 0)
        toSd(tft ? 0 : busy ? 0 : flick)
        bars.forEach((b, i) => {
          const r = S.rates[i]
          const len = Math.max(0.05, xOf(r.rate) - cx0)
          b.b.scale.x = len
          b.b.position.x = cx0 + len / 2
          const hot = i === 2 || (i === 3 && !tft)
          setGlow(b.m, i < 2 ? GREY : i === 3 ? HEAT : POWER, hot ? 0.8 : 0.3)
          b.name.set(r.name, hot ? LABEL : GREY)
          b.val.group.position.x = cx0 + len + 0.5
          b.val.set(i === 3 ? bps(r.rate) : `${bps(r.rate)} · ${fpsText(frameRate(r.rate, S.frame))} fps`, hot ? LABEL : GREY)
        })
        code(
          tft
            ? ['tft.initR(INITR_BLACKTAB);', `tft.setSPISpeed(${S.hz});`, 'tft.drawRGBBitmap(0, 0, img, 128, 160);']
            : [`SD.begin(5, SPI, ${S.block.clk});`, 'File f = SD.open("/log.bin", FILE_APPEND);', 'f.write(buf, 512);  f.flush();'],
        )
      },
      readouts: (p) => {
        const S = sdSetup(p)
        const over = S.job === 'sd' && S.hz > SD_SPI_MAX
        return S.job === 'tft'
          ? [
              { label: 'Frame', value: `${S.frame.toLocaleString('en')} B in ${secs(S.dur)}` },
              { label: 'Frame rate', value: `${S.fps.toFixed(1)} fps`, tone: S.fps >= 30 ? 'ok' : S.fps >= 10 ? 'warn' : 'bad' },
              { label: 'Same on I²C 400k', value: secs(S.frame / i2cByteRate(400e3)), tone: 'bad' },
            ]
          : [
              { label: 'Clock', value: over ? `${S.block.clk / 1e6} MHz (SD max)` : `${S.block.clk / 1e6} MHz`, tone: over ? 'warn' : 'ok' },
              { label: 'Block on the bus', value: secs(S.block.bus) },
              { label: 'Card busy', value: `${secs(S.block.busy)} (${Math.round((S.block.busy / S.block.total) * 100)} %)`, tone: 'warn' },
              { label: 'Write speed', value: bps(S.block.rate) },
            ]
      },
    }
  },
}
