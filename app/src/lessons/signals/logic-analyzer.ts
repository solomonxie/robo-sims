import * as THREE from 'three/webgpu'
import {
  I2cEvent,
  SpiMode,
  catchOdds,
  findPattern,
  highRuns,
  i2cDecode,
  i2cLines,
  packWords,
  patternMatch,
  sampleLine,
  spiDecode,
  spiLines,
  spiPha,
  spiPol,
  streamRate,
} from '../../core/physics'
import { Bit, bit } from '../../core/logic'
import { pct, si } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cableRun,
  captureScreen,
  frac,
  glowMat,
  label,
  lieFlat,
  liveLabel,
  usbAnalyzer,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const sec = (s: number) => si(s, 's', 3)
const hz = (f: number) => si(f, 'Hz', 3)
const hex = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`
const hx = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const pick = <R extends object>(rec: R, v: unknown, d: keyof R & string) => (String(v) in rec ? (v as keyof R & string) : d)
const text = (parent: THREE.Object3D, s: string, at: V3, color = GREY, size = 0.6) =>
  (add(parent, label(s, { size, color }), at).castShadow = false)

const SX = 5
const SY = 0.5
const SW = 18
const ESP: V3 = [-14.5, 3.4, 0]
const K = 0.5
const VIEW = { center: [-2.6, 0.3, 0] as V3, radius: 61, polar: 1.42, azimuth: 0.06 }
const espPin = (x: number): V3 => [ESP[0] + x * K, ESP[1] - 5 * K, ESP[2] + 3.8 * K]

/** ESP32 with an 8-channel analyser clipped to its pins and a USB cable to a capture window; returns the window and its status line. */
function rig(
  scene: THREE.Object3D,
  rows: { label: string; color: string }[],
  pins: number[],
  { rowH = 2.2, decoder = false, caption = '' } = {},
) {
  add(scene, lieFlat(buildEsp32(), K), ESP)
  text(scene, caption || 'ESP32', [ESP[0], ESP[1] + 3.2, 0], LABEL, 0.55)
  const usb = usbAnalyzer(
    scene,
    [ESP[0], ESP[1] - 9.2, 0.6],
    rows.map((r, k) => ({ color: r.color, to: espPin(pins[k]) })),
    espPin(-7),
  )
  const screen = captureScreen(scene, [SX, SY, 0], rows, { width: SW, rowH, decoder })
  const h = screen.height
  box(scene, [SW + 3.6, h + 3.4, 0.5], mat('#24262c', { rough: 0.6 }), [SX - 0.5, SY + 0.6, -1.1])
  box(scene, [2, 2.2, 0.5], mat('#24262c', { rough: 0.6 }), [SX, SY - h / 2 - 2.2, -1.1])
  box(scene, [9, 0.4, 3], mat('#1c1d22', { rough: 0.6 }), [SX, SY - h / 2 - 3.4, -1])
  const top = SY + h / 2 + 1.1
  const status = [
    liveLabel(scene, [SX - SW / 2, top, 0], { size: 0.5, align: 'left' }),
    liveLabel(scene, [SX + SW / 2, top, 0], { size: 0.5, align: 'right' }),
  ]
  const low = SY - h / 2 - 3.6
  cableRun(scene, [usb, [usb[0], low, usb[2] + 0.4], [SX - 6, low, 0.6], [SX - 6, SY - h / 2 - 1.2, -0.6]], '#3a3d45', 0.16)
  return { screen, status }
}

const BOARD: V3 = [ESP[0] + 6.6, ESP[1] - 8.2, 0]

/** A breakout board below-right of the ESP32 with its bus wired to `pins`. */
function breakout(scene: THREE.Object3D, rows: { color: string }[], pins: number[], name: string, color: string) {
  const g = add(scene, new THREE.Group(), BOARD)
  box(g, [3.6, 3.6, 0.3], mat(color, { rough: 0.6 }), [0, 0, 0])
  text(g, name, [0, -2.4, 0], LABEL, 0.45)
  rows.forEach((r, k) => {
    const a = espPin(pins[k])
    const x = BOARD[0] + (k - (rows.length - 1) / 2) * 0.5
    const y = ESP[1] - 4 - k * 0.4
    cableRun(scene, [a, [a[0] + 0.2, y, 2.2], [x, y, 0.8], [x, BOARD[1] + 1.6, 0.3]], r.color, 0.09)
  })
  return g
}

/** A thin vertical marker across the screen at `u`, with a tag above it. */
function marker(screen: ReturnType<typeof captureScreen>, color: string, tag: string) {
  const bar = add(screen.group, mesh(new THREE.BoxGeometry(0.08, screen.height, 0.08), glowMat(color, 0.9)), [0, 0, 0.35])
  bar.castShadow = false
  const t = liveLabel(screen.group, [0, -screen.height / 2 - 0.5, 0.3], { size: 0.5 })
  return {
    set(u: number | null) {
      bar.visible = u !== null && u >= 0 && u <= 1
      t.set(bar.visible ? tag : '', color)
      if (u === null) return
      bar.position.x = t.group.position.x = screen.xAt(Math.min(1, Math.max(0, u)))
    },
  }
}

/** Dots on a row at sample points (u, level), shown up to the sweep. */
function dots(screen: ReturnType<typeof captureScreen>, count: number, color: string, r = 0.16) {
  const m = glowMat(color, 1.2)
  const geo = new THREE.SphereGeometry(r, 10, 8)
  const pool = Array.from({ length: count }, () => {
    const d = add(screen.group, mesh(geo, m))
    d.castShadow = false
    return d
  })
  return (pts: { u: number; y: number }[], upTo = 1) =>
    pool.forEach((d, i) => {
      const p = pts[i]
      d.visible = !!p && p.u <= upTo && p.u >= 0
      if (p) d.position.set(screen.xAt(Math.min(1, Math.max(0, p.u))), p.y, 0.45)
    })
}

/** Capture loop: `arm` s waiting, `reveal` s sweeping, `hold` s showing. */
function captureClock(arm: number, reveal: number, hold: number) {
  const st = { t: arm + reveal + hold, n: 0 }
  return {
    tick(dt: number) {
      st.t += dt
      const fresh = st.t >= arm + reveal + hold
      if (fresh) {
        st.t = 0
        st.n++
      }
      return { fresh, armed: st.t < arm, prog: Math.min(1, Math.max(0, (st.t - arm) / reveal)), count: st.n }
    },
    restart() {
      st.t = arm + reveal + hold
      st.n = 0
    },
  }
}

// --- Sample rate: the analyser only sees the line at its sample instants; edges move by up to one sample, short glitches vanish. ---

const W1 = 100e-6
const GLITCH = 0.5e-6
const RATES = [250e3, 1e6, 4e6, 24e6]
const REVEAL1 = 1.4
const DATA_BITS = [1, 0, 1, 1, 0, 0, 1, 1, 1, 0]
const rateOf = (p: Params) => (RATES.includes(Number(p.fs)) ? Number(p.fs) : 1e6)
const truth = (gAt: number): ((t: number) => Bit)[] => [
  (t) => bit(frac(t * 1e5) < 0.5),
  (t) => bit(frac(t * 2e4) < 0.25),
  (t) => bit(DATA_BITS[Math.floor(((t + 5e-6) * 1e5) % 10)] === 1),
  (t) => bit(t >= gAt && t < gAt + GLITCH),
]
const SR_ROWS = [
  { label: 'D0', color: CLK_COLOR },
  { label: 'D1', color: HEAT },
  { label: 'D2', color: DATA_COLOR },
  { label: 'D3', color: HIGH_V },
]

export const sampleRate: Lesson = {
  id: 'logic-analyzer-sample-rate',
  title: 'Sample rate',
  tagline: 'It only sees the line when it samples: too slow and glitches vanish',
  formula: (p) => {
    const fs = rateOf(p)
    return `one sample every 1/fs = 1 / ${hz(fs)} = ${sec(1 / fs)} · a ${sec(GLITCH)} glitch is caught with odds width × fs = ${pct(catchOdds(GLITCH, fs))}`
  },
  legend: [
    { color: GREY, label: 'Faint: what the pins really did', shape: 'dot' },
    { color: CLK_COLOR, label: 'Bright: what the analyser captured', shape: 'dot' },
    { color: RING, label: 'Sample instants (slow rates)', shape: 'dot' },
  ],
  points: [
    'A logic analyser is a many-channel digital recorder: a cheap 8-channel USB box clips onto GPIO pins and only asks, for each pin, is it above or below the threshold, high or low?',
    'It asks at the sample rate. Between samples it knows nothing, so every edge lands up to one sample late and the picture is built from steps of 1/fs.',
    'Here the ESP32 runs a 100 kHz clock (D0), a 20 kHz PWM (D1), data (D2) and an interrupt line (D3) with a 0.5 µs glitch at a random moment.',
    'At 250 kHz the clock gets 2.5 samples per cycle and comes out lopsided; the glitch is almost never seen. At 24 MHz every sample period is 42 ns and the glitch always shows.',
    'Rule of thumb: sample at least 4× faster than the fastest signal, and faster than 1 / (shortest pulse) to be sure of catching it.',
    'Why 24 MHz? 8 channels × 24 MHz is 24 MB/s, about all USB 2.0 can stream. Faster analysers keep the capture in on-board memory instead.',
    `Slowed ${Math.round(REVEAL1 / W1).toLocaleString('en')}×: each 100 µs capture is drawn over ${REVEAL1} s.`,
  ],
  controls: [{ kind: 'choice', key: 'fs', options: RATES.map((f) => ({ value: String(f), label: hz(f).replace(' ', '') })), initial: '1000000' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const { screen, status } = rig(scene, SR_ROWS, [-5, -4, -3, -2], { caption: 'ESP32 GPIO' })
    const ghosts = SR_ROWS.map((_, k) => screen.channel(k, { color: '#4a5058', radius: 0.05 }))
    const caps = SR_ROWS.map((_, k) => screen.channel(k, { radius: 0.09 }))
    for (const g of ghosts) g.group.position.z = -0.05
    const tickGeo = new THREE.BoxGeometry(0.06, 0.5, 0.04)
    const tickMat = glowMat(RING, 0.9)
    const ticks = Array.from({ length: 101 }, () => {
      const t = add(screen.group, mesh(tickGeo, tickMat), [0, -screen.height / 2 + 0.3, 0.3])
      t.castShadow = false
      return t
    })
    const tag = liveLabel(screen.group, [0, screen.yOf(3, 0.75), 0.4], { size: 0.5, align: 'left' })
    const clock = captureClock(0, REVEAL1, 1)
    const st = { key: '', gAt: 50e-6, phase: 0, prevGAt: 50e-6, prevPhase: 0, caught: 0, prev: [] as Bit[][], cur: [] as Bit[][] }
    const capture = (fs: number, gAt: number, phase: number) => {
      const lines = truth(gAt)
      return lines.map((l) => sampleLine(l, fs, Math.ceil(W1 * fs) + 1, phase))
    }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const fs = rateOf(p)
        const key = String(fs)
        if (key !== st.key) {
          st.key = key
          clock.restart()
          st.caught = 0
          st.cur = []
        }
        const c = clock.tick(dt)
        if (c.fresh) {
          st.prev = st.cur
          st.prevGAt = st.gAt
          st.prevPhase = st.phase
          st.gAt = (15 + 70 * Math.random()) * 1e-6
          st.phase = Math.random() / fs
          st.cur = capture(fs, st.gAt, st.phase)
          if (highRuns(st.cur[3]).length) st.caught++
        }
        const level = (cap: Bit[][], phase: number, k: number, u: number) => {
          if (!cap.length) return 0
          const i = Math.floor((u * W1 - phase) * fs)
          return cap[k][Math.max(0, Math.min(cap[k].length - 1, i))]
        }
        const lines = truth(st.gAt)
        const prevLines = truth(st.prevGAt)
        SR_ROWS.forEach((_, k) => {
          ghosts[k].draw((u) => (u <= c.prog ? lines[k] : prevLines[k])(u * W1))
          caps[k].draw((u) => (u <= c.prog ? level(st.cur, st.phase, k, u) : level(st.prev, st.prevPhase, k, u)), c.prog < 1 ? c.prog : null)
        })
        const showTicks = fs <= 1e6
        ticks.forEach((t, i) => {
          const u = (st.phase + i / fs) / W1
          t.visible = showTicks && u <= Math.min(1, c.prog)
          t.position.x = screen.xAt(Math.min(1, u))
        })
        const gu = (st.gAt + GLITCH / 2) / W1
        const caught = highRuns(st.cur[3] ?? []).length > 0
        tag.group.position.x = screen.xAt(gu) + 0.4
        tag.set(c.prog >= gu ? (caught ? 'CAUGHT' : 'MISSED') : '', caught ? POWER : HIGH_V)
        status[0].set(`${hz(fs).replace(' ', '')} · ${Math.ceil(W1 * fs) + 1} SAMPLES`, LABEL)
        status[1].set(`CAUGHT ${st.caught}/${c.count}`, st.caught === c.count ? POWER : HEAT)
      },
      readouts: (p) => {
        const fs = rateOf(p)
        const odds = catchOdds(GLITCH, fs)
        return [
          { label: 'Glitch odds', value: `${pct(odds)} per capture`, tone: odds >= 1 ? 'ok' : odds > 0.3 ? 'warn' : 'bad' },
          { label: 'Edges land', value: `up to ${sec(1 / fs)} late` },
          { label: 'Samples / clock', value: `${+(fs / 1e5).toPrecision(3)} · want ≥ 4`, tone: fs >= 4e5 ? 'ok' : 'bad' },
          { label: 'USB stream', value: `${si(streamRate(fs, 8), 'B/s', 3)} for 8 ch` },
        ]
      },
    }
  },
}

// --- Pattern trigger: start the capture when the channels hold a chosen combination, not on any edge. ---

const STEP = 10e-6
const FS2 = 1e6
const W2 = 200e-6
const PRE = 50
const N2 = Math.round(W2 * FS2)
const TRIGS2 = { edge: 'Edge: D0 rises', pattern: 'Pattern' }
const CARES = { all: 'All 4 bits', x3: 'D3 = X' }
const binary = (v: number) => v.toString(2).padStart(4, '0')
const patternText = (v: number, x3: boolean) => (x3 ? 'X' : binary(v)[0]) + binary(v).slice(1)
const PT_ROWS = [0, 1, 2, 3].map((k) => ({ label: `D${k}`, color: [CLK_COLOR, HEAT, DATA_COLOR, FORCE][k] }))
const trig2Of = (p: Params) => {
  const mode = pick(TRIGS2, p.trig, 'pattern')
  const x3 = pick(CARES, p.care, 'all') === 'x3'
  const pattern = Math.min(15, Math.max(0, Math.round(n(p, 'pattern'))))
  return mode === 'edge' ? { mode, pattern: 1, mask: 1, x3: false, want: pattern } : { mode, pattern, mask: x3 ? 7 : 15, x3, want: pattern }
}

/** The state counter from `start`, sampled at 1 MHz from PRE samples before arming; returns the trigger index and words. */
function armCapture(start: number, pattern: number, mask: number) {
  const word = (t: number) => (start + Math.floor(t / STEP)) % 16
  const chans = [0, 1, 2, 3].map((k) => sampleLine((t) => bit(Math.floor(word(t) / 2 ** k) % 2), FS2, PRE + 16 * 10 + N2, 0))
  const words = packWords(chans)
  const at = findPattern(words, pattern, mask, PRE) ?? PRE
  return { at, words: words.slice(at - PRE, at - PRE + N2), waited: at - PRE }
}

export const patternTrigger: Lesson = {
  id: 'logic-analyzer-pattern-trigger',
  title: 'Pattern trigger',
  tagline: 'Wait for a combination of pins, then keep what came before it too',
  formula: (p) => {
    const s = trig2Of(p)
    return s.mode === 'edge'
      ? 'Edge trigger: fire on the first D0 rise after arming; every count has one, so each capture starts somewhere new'
      : `Pattern trigger: fire when D3 D2 D1 D0 = ${patternText(s.pattern, s.x3)} (X = don’t care) · keep ${PRE} µs before it`
  },
  legend: [
    { color: CLK_COLOR, label: 'D0 … D3: the state on four GPIOs', shape: 'dot' },
    { color: RING, label: 'T: where the trigger fired', shape: 'dot' },
    { color: POWER, label: 'Decoded state that matched', shape: 'dot' },
  ],
  points: [
    'Debug trick: the ESP32 firmware writes its state-machine state (0–15) to four spare GPIOs, and the analyser decodes the four lines as one number.',
    'An edge trigger fires on the first rising edge it sees. A busy bus has edges everywhere, so each capture starts at a different, random state.',
    'A pattern trigger waits until every channel matches: here D3 D2 D1 D0 = 1011 (state 11). Mark a bit X, don’t care, to match a family of states.',
    'The analyser records all the time into a ring buffer, so it can keep what happened before the trigger: here 50 µs of pre-trigger, the lead-up to the event.',
    'Real uses: catch the moment a fault flag and a motor-enable line are both high, or a chip-select low while a reset is asserted.',
    'Slowed: the counter steps every 10 µs; each 200 µs capture is drawn over 1.2 s.',
  ],
  controls: [
    { kind: 'choice', key: 'trig', options: Object.entries(TRIGS2).map(([value, l]) => ({ value, label: l })), initial: 'pattern' },
    { kind: 'slider', key: 'pattern', label: 'Pattern D3…D0', min: 0, max: 15, initial: 11, step: 1, format: (v) => `${binary(Math.round(v))} = ${Math.round(v)}` },
    { kind: 'choice', key: 'care', options: Object.entries(CARES).map(([value, l]) => ({ value, label: l })), initial: 'all' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const { screen, status } = rig(scene, PT_ROWS, [-5, -4, -3, -2], { decoder: true, caption: 'ESP32 STATE PINS' })
    const traces = PT_ROWS.map((_, k) => screen.channel(k, { samples: 400 }))
    const tMark = marker(screen, RING, 'T')
    const clock = captureClock(0.8, 1.2, 1.4)
    const st = { key: '', time: 0, cap: null as null | ReturnType<typeof armCapture>, prev: null as null | ReturnType<typeof armCapture>, fired: [] as number[] }
    const levelAt = (cap: ReturnType<typeof armCapture> | null, k: number, u: number) =>
      cap ? Math.floor(cap.words[Math.min(N2 - 1, Math.floor(u * N2))] / 2 ** k) % 2 : 0
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = trig2Of(p)
        const key = `${s.mode}|${s.pattern}|${s.mask}`
        if (key !== st.key) {
          st.key = key
          clock.restart()
          st.cap = st.prev = null
          st.fired = []
        }
        const c = clock.tick(dt)
        if (c.fresh) {
          st.prev = st.cap
          st.cap = armCapture(Math.floor(Math.random() * 16), s.pattern, s.mask)
          st.fired = [st.cap.words[PRE], ...st.fired].slice(0, 4)
        }
        st.time += dt
        const show = c.armed ? st.prev : st.cap
        const prog = c.armed ? 1 : c.prog
        traces.forEach((t, k) => {
          t.group.visible = !!show
          t.draw((u) => (c.armed || u > prog ? levelAt(st.prev, k, u) : levelAt(st.cap, k, u)), c.armed || prog >= 1 ? null : prog)
        })
        const segs: { u0: number; u1: number; text: string; color: string }[] = []
        if (show) {
          let i0 = 0
          for (let i = 1; i <= N2; i++) {
            if (i < N2 && show.words[i] === show.words[i0]) continue
            const u1 = i / N2
            if (!c.armed && u1 > prog + 1e-9) break
            const hit = i0 <= PRE && i > PRE
            segs.push({ u0: i0 / N2, u1, text: show.words[i0].toString(16).toUpperCase(), color: hit ? POWER : GREY })
            i0 = i
          }
        }
        screen.annotate(segs)
        tMark.set(show && (c.armed || prog >= PRE / N2) ? PRE / N2 : null)
        const blink = Math.floor(st.time * 3) % 2 === 0
        status[0].set(
          c.armed ? (blink ? `ARMED · WAITING FOR ${s.mode === 'edge' ? 'D0 RISE' : patternText(s.pattern, s.x3)}` : 'ARMED') : `TRIGGERED · 1 MHZ · ${PRE} µS PRE`,
          c.armed ? HEAT : POWER,
        )
        const fired = st.fired.slice(c.armed ? 1 : 0)
        status[1].set(fired.length ? `FIRED ON ${fired.map((v) => v.toString(16).toUpperCase()).join(' ')}` : '', LABEL)
      },
      readouts: (p) => {
        const s = trig2Of(p)
        const matches = Array.from({ length: 16 }, (_, w) => w).filter((w) => patternMatch(w, s.pattern, s.mask))
        return [
          s.mode === 'edge'
            ? { label: 'Fires on', value: 'any state · moves', tone: 'warn' }
            : { label: 'Fires on', value: matches.map((w) => `${binary(w)}`).join(' or '), tone: 'ok' },
          s.mode === 'edge' ? { label: 'D0 rises', value: `every ${sec(2 * STEP)}` } : { label: 'States that match', value: `${matches.length} of 16` },
          { label: 'Pre-trigger', value: `${PRE} µs kept` },
          { label: 'Counter', value: `1 step / ${sec(STEP)}` },
        ]
      },
    }
  },
}

// --- Capture I²C: two open-drain wires; START, 7-bit address + R/W, ACK from the device, data bytes, STOP. ---

const I2C_HZ = 100e3
const FS3 = 2e6
const OLED = 0x3c
const ADDRS = { '3c': { addr: 0x3c, label: '0x3C (OLED)' }, '3d': { addr: 0x3d, label: '0x3D (nobody)' } }
const REVEAL3 = 1.8
const solveI2c = (p: Params) => {
  const which = pick(ADDRS, p.addr, '3c')
  const addr = ADDRS[which].addr
  const value = Math.round(n(p, 'value'))
  const frame = { addr, data: [0x00, 0x81, value], ack: addr === OLED }
  const lines = i2cLines(frame, I2C_HZ)
  const pad = 2 / I2C_HZ
  const total = lines.duration + 2 * pad
  const count = Math.ceil(total * FS3)
  const scl = sampleLine(lines.scl, FS3, count, -pad)
  const sda = sampleLine(lines.sda, FS3, count, -pad)
  return { addr, value, frame, scl, sda, count, total, ev: i2cDecode(scl, sda) }
}
const I2C_TEXT: Record<I2cEvent['kind'], (e: I2cEvent) => [string, string]> = {
  start: () => ['S', POWER],
  stop: () => ['P', POWER],
  addr: (e) => [`${hx(e.value)} ${e.read ? 'R' : 'W'}`, DATA_COLOR],
  data: (e) => [hx(e.value), CLK_COLOR],
  ack: () => ['A', POWER],
  nack: () => ['N', HIGH_V],
}

export const captureI2c: Lesson = {
  id: 'logic-analyzer-capture-i2c',
  title: 'Capture I²C',
  tagline: 'Two wires, one conversation: start, address, ACK, data, stop',
  formula: (p) => {
    const s = solveI2c(p)
    return `100 kHz → 10 µs per bit · 9 bits per byte (8 + ACK) · first byte = address ${hex(s.addr)} shifted left + W(0) = ${hex(s.addr * 2)}`
  },
  legend: [
    { color: CLK_COLOR, label: 'SCL: clock from the ESP32', shape: 'dot' },
    { color: DATA_COLOR, label: 'SDA: data, read at each SCL rise', shape: 'dot' },
    { color: POWER, label: 'Decoder: S start, A ack, P stop', shape: 'dot' },
  ],
  points: [
    'I²C uses two wires, SCL (clock) and SDA (data), both pulled up to 3.3 V by resistors. Chips only ever pull them low, so many can share the bus.',
    'START: SDA falls while SCL is high. Then the 7-bit address and a R/W bit, MSB first. SDA may only change while SCL is low; it is read on each SCL rise.',
    'The 9th clock is the ACK: the ESP32 lets go of SDA and the addressed chip pulls it low, saying “I’m here”. Nobody home → SDA floats high: NACK.',
    'Here the ESP32 sets an SSD1306 OLED’s contrast: control byte 0x00, command 0x81, then the value. Each byte gets its own ACK; STOP is SDA rising while SCL is high.',
    'Try 0x3D: no chip answers, the decoder shows N and the ESP32 stops. That’s what an I²C scanner looks for, and the first thing to check when a sensor is silent.',
    `Captured at 2 MHz (20 samples per bit); slowed ${Math.round(REVEAL3 / 400e-6).toLocaleString('en')}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'addr', options: Object.entries(ADDRS).map(([value, a]) => ({ value, label: a.label })), initial: '3c' },
    { kind: 'slider', key: 'value', label: 'Contrast byte', min: 0, max: 255, initial: 127, step: 1, format: (v) => hex(Math.round(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rows = [
      { label: 'SCL', color: CLK_COLOR },
      { label: 'SDA', color: DATA_COLOR },
    ]
    const { screen, status } = rig(scene, rows, [-6, -5], { rowH: 3, decoder: true, caption: 'ESP32 I²C' })
    const oled = breakout(scene, rows, [-6, -5], 'OLED 0X3C', '#1f4fae')
    box(oled, [3, 2, 0.2], mat('#07080a', { rough: 0.25, emissive: '#081420' }), [0, -0.3, 0.25])
    const traces = rows.map((_, k) => screen.channel(k, { samples: 520 }))
    const sampled = dots(screen, 40, RING, 0.15)
    const clock = captureClock(0, REVEAL3, 1.3)
    const st = { key: '', prev: null as null | ReturnType<typeof solveI2c> }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = solveI2c(p)
        const key = `${s.addr}|${s.value}`
        if (key !== st.key) {
          st.key = key
          clock.restart()
        }
        const c = clock.tick(dt)
        const prev = st.prev ?? s
        const uOf = (i: number) => i / (s.count - 1)
        const at = (cap: typeof s, line: Bit[], u: number) => line[Math.min(cap.count - 1, Math.round(u * (cap.count - 1)))]
        traces[0].draw((u) => (u <= c.prog ? at(s, s.scl, u) : at(prev, prev.scl, u)), c.prog < 1 ? c.prog : null)
        traces[1].draw((u) => (u <= c.prog ? at(s, s.sda, u) : at(prev, prev.sda, u)), c.prog < 1 ? c.prog : null)
        if (c.prog >= 1) st.prev = s
        const bitW = FS3 / I2C_HZ
        const segs = s.ev
          .map((e) => {
            const [t, color] = I2C_TEXT[e.kind](e)
            const half = e.kind === 'start' || e.kind === 'stop' ? bitW * 0.3 : bitW * 0.5
            return { u0: uOf(e.from - half), u1: uOf(e.to + half), text: t, color }
          })
          .filter((g) => g.u1 <= c.prog)
        screen.annotate(segs)
        const rises: { u: number; y: number }[] = []
        for (let i = 1; i < s.count; i++) if (!s.scl[i - 1] && s.scl[i]) rises.push({ u: uOf(i), y: screen.yOf(1, s.sda[i]) })
        sampled(rises, c.prog)
        const acked = s.frame.ack
        status[0].set(`2 MHZ · SCL ${hz(I2C_HZ).replace(' ', '')}`, LABEL)
        status[1].set(c.prog >= 1 ? (acked ? `WRITE ${hex(s.addr)} · ACK` : `${hex(s.addr)} · NACK`) : 'CAPTURING', c.prog < 1 ? HEAT : acked ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const s = solveI2c(p)
        const data = s.ev.filter((e) => e.kind === 'data').map((e) => hx(e.value))
        return [
          { label: 'Address', value: `${hex(s.addr)} write · ${s.frame.ack ? 'ACK' : 'NACK'}`, tone: s.frame.ack ? 'ok' : 'bad' },
          { label: 'Decoded data', value: data.length ? data.join(' ') : 'none · stopped', tone: data.length ? 'ok' : 'bad' },
          { label: 'Bit time', value: `${sec(1 / I2C_HZ)} · ${FS3 / I2C_HZ} samples` },
          { label: 'Transfer', value: sec(i2cLines(s.frame, I2C_HZ).duration) },
        ]
      },
    }
  },
}

// --- Capture SPI: CS low frames the transfer; MOSI and MISO shift a bit each clock, both ways at once. The decoder must use the right mode. ---

const SPI_HZ = 1e6
const FS4 = 24e6
const DEV_MODE: SpiMode = 0
const REGS = {
  d0: { reg: 0xd0, reply: 0x60, label: 'chip ID 0xD0' },
  f4: { reg: 0xf4, reply: 0x27, label: 'ctrl_meas 0xF4' },
  fa: { reg: 0xfa, reply: 0x80, label: 'temp MSB 0xFA' },
}
const MODES: SpiMode[] = [0, 1, 2, 3]
/** BME280 SPI read: register with the top bit set. */
const readCmd = (reg: number) => (reg >= 0x80 ? reg : reg + 0x80)
const REVEAL4 = 1.8
const solveSpi = (p: Params) => {
  const which = pick(REGS, p.reg, 'd0')
  const r = REGS[which]
  const mode = (MODES.includes(Number(p.mode) as SpiMode) ? Number(p.mode) : 0) as SpiMode
  const lines = spiLines([readCmd(r.reg), 0x00], [0xff, r.reply], DEV_MODE, SPI_HZ)
  const pad = 1.5 / SPI_HZ
  const count = Math.ceil((lines.duration + 2 * pad) * FS4)
  const [cs, sck, mosi, miso] = [lines.cs, lines.sck, lines.mosi, lines.miso].map((l) => sampleLine(l, FS4, count, -pad))
  const dec = spiDecode(cs, sck, mosi, miso, mode)
  return { which, r, mode, cs, sck, mosi, miso, count, dec, ok: dec.miso[1] === r.reply && dec.mosi[0] === readCmd(r.reg) }
}

export const captureSpi: Lesson = {
  id: 'logic-analyzer-capture-spi',
  title: 'Capture SPI',
  tagline: 'Chip select, clock, and a byte each way per eight clocks',
  formula: (p) => {
    const s = solveSpi(p)
    return `Mode ${s.mode} = CPOL ${spiPol(s.mode)} (clock idles ${spiPol(s.mode) ? 'high' : 'low'}), CPHA ${spiPha(s.mode)} → read on the ${spiPol(s.mode) === spiPha(s.mode) ? 'rising' : 'falling'} edge · the BME280 talks mode 0`
  },
  legend: [
    { color: HEAT, label: 'CS: low = this chip is selected', shape: 'dot' },
    { color: DATA_COLOR, label: 'MOSI out of the ESP32, MISO back', shape: 'dot' },
    { color: RING, label: 'Where the decoder reads the bits', shape: 'dot' },
  ],
  points: [
    'SPI uses four wires: CS (chip select, active low), SCK (clock), MOSI (ESP32 → chip) and MISO (chip → ESP32). Every clock moves one bit each way at once.',
    'To read a BME280 register the ESP32 pulls CS low and sends the register with the top bit set (read), then a dummy byte; the sensor answers during that second byte.',
    'Chip ID register 0xD0 must read back 0x60: the classic first check that the wiring works.',
    'The SPI mode says which clock edge to read on. Mode 0 and 3 both read on the rising edge, so a mode-3 decoder still reads this mode-0 bus correctly.',
    'Modes 1 and 2 read on the falling edge, half a clock late, when the next bit is already out: everything shifts by one bit. Wrong mode is the usual cause of “almost right” SPI bytes.',
    `Captured at 24 MHz, 24 samples per clock; slowed ${Math.round(REVEAL4 / 20e-6).toLocaleString('en')}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'reg', options: Object.entries(REGS).map(([value, r]) => ({ value, label: r.label })), initial: 'd0' },
    { kind: 'choice', key: 'mode', options: MODES.map((m) => ({ value: String(m), label: `Decode mode ${m}` })), initial: '0' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rows = [
      { label: 'CS', color: HEAT },
      { label: 'SCK', color: CLK_COLOR },
      { label: 'MOSI', color: DATA_COLOR },
      { label: 'MISO', color: POWER },
    ]
    const { screen, status } = rig(scene, rows, [-6, -5, -4, -3], { decoder: true, caption: 'ESP32 SPI' })
    const sensor = breakout(scene, rows, [-6, -5, -4, -3], 'BME280', '#6a2c8c')
    box(sensor, [0.9, 0.9, 0.5], mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, -0.2, 0.3])
    const traces = rows.map((_, k) => screen.channel(k, { samples: 520 }))
    const outDots = dots(screen, 16, RING, 0.15)
    const inDots = dots(screen, 16, RING, 0.15)
    const clock = captureClock(0, REVEAL4, 1.3)
    const st = { key: '' }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = solveSpi(p)
        const key = `${s.which}|${s.mode}`
        if (key !== st.key) {
          st.key = key
          clock.restart()
        }
        const c = clock.tick(dt)
        const uOf = (i: number) => i / (s.count - 1)
        const lines = [s.cs, s.sck, s.mosi, s.miso]
        traces.forEach((t, k) => t.draw((u) => lines[k][Math.round(u * (s.count - 1))], c.prog < 1 ? c.prog : null))
        outDots(s.dec.at.map((i) => ({ u: uOf(i), y: screen.yOf(2, s.mosi[i]) })), c.prog)
        inDots(s.dec.at.map((i) => ({ u: uOf(i), y: screen.yOf(3, s.miso[i]) })), c.prog)
        const segs = s.dec.mosi
          .map((m, b) => {
            const i0 = s.dec.at[b * 8]
            const i1 = s.dec.at[b * 8 + 7]
            const half = (i1 - i0) / 14
            return { u0: uOf(i0 - half), u1: uOf(i1 + half), text: `OUT ${hx(m)}  IN ${hx(s.dec.miso[b])}`, color: s.ok ? POWER : HIGH_V }
          })
          .filter((g) => g.u1 <= c.prog)
        screen.annotate(segs)
        status[0].set(`24 MHZ · DECODE MODE ${s.mode}`, LABEL)
        status[1].set(c.prog >= 1 ? `READ ${hex(s.dec.miso[1] ?? 0)} ${s.ok ? 'OK' : 'BAD'}` : 'CAPTURING', c.prog < 1 ? HEAT : s.ok ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const s = solveSpi(p)
        return [
          { label: 'Sent', value: `${hex(readCmd(s.r.reg))} 0x00 (read ${hex(s.r.reg)})` },
          { label: 'Sensor replied', value: hex(s.r.reply) },
          { label: 'Decoded', value: `${hex(s.dec.mosi[0] ?? 0)} / ${hex(s.dec.miso[1] ?? 0)}`, tone: s.ok ? 'ok' : 'bad' },
          { label: 'Mode', value: s.mode === DEV_MODE ? 'matches device' : s.ok ? 'other mode, same edge' : 'wrong edge · shifted', tone: s.mode === DEV_MODE ? 'ok' : s.ok ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
