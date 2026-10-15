import * as THREE from 'three/webgpu'
import {
  ADC_BITS,
  ADC_MAX,
  AttenKey,
  ESP32_ATTEN,
  GPIO_VDD,
  adcReadable,
  aliasFrequency,
  averagedRms,
  calibratedVolts,
  codeVolts,
  effectiveBits,
  esp32Raw,
  gaussAt,
  heldAt,
  lsb,
  naiveVolts,
  nyquist,
  quantize,
  sarSteps,
} from '../../core/physics'
import { hertz, volts } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  acSource,
  ceramicAlong,
  codeBlock,
  esp32Board,
  glide,
  glowBox,
  glowMat,
  groundAt,
  junction,
  knifeSwitch,
  liveLabel,
  memoBy,
  meterBar,
  opAmpSymbol,
  partLetter,
  rotaryPot,
  scope,
  setGlow,
  signalWire,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const VDD = GPIO_VDD
const PIN = 34
const PIN_COLOR = '#5ad8e6'
const BOARD: V3 = [-14, 5.5, 0]
const VIEW = { center: [-1, -3.4, 0] as V3, radius: 80, polar: 1.47, azimuth: 0.06 }
const mV = (v: number) => `${Math.round(v * 1000)} mV`
const ATTENS = Object.keys(ESP32_ATTEN) as AttenKey[]
const attenChoice = (initial: AttenKey) => ({
  kind: 'choice' as const,
  key: 'atten',
  options: ATTENS.map((value) => ({ value, label: `${value} dB` })),
  initial,
})

/** ESP32 with a pot (3.3 V … GND) whose wiper feeds a GPIO from below; `set(v, gpio)` turns it and lights the wire. */
function potToPin(scene: THREE.Object3D, potAt: V3 = [-3, 6.8, 0]) {
  const pin = esp32Board(scene, BOARD, 0.5)
  partLetter(scene, 'ESP32', [BOARD[0], BOARD[1] + 3.6, 0], 0.9, LABEL)
  const io = pin(-4, false)
  const gpioTag = liveLabel(scene, [io[0] - 0.6, 2.2, 0], { size: 0.6, color: PIN_COLOR, align: 'right' })
  const pot = rotaryPot(scene, potAt, { scale: 0.8 })
  const { a, w, b } = pot.pins
  const wire = signalWire(scene, [io, [io[0], 1, io[2]], [io[0], 1, 0], [w[0], 1, 0], w])
  signalWire(scene, [a, [a[0] - 1.6, a[1], 0]])(0)
  groundAt(scene, [a[0] - 1.6, a[1], 0])
  signalWire(scene, [b, [b[0] + 1.6, b[1], 0]])(1)
  partLetter(scene, '3V3', [b[0] + 2.2, b[1], 0], 0.6, HIGH_V, 'left')
  const tag = liveLabel(scene, [4.4, 6.6, 0], { size: 0.9, align: 'left' })
  return (v: number, gpio = PIN) => {
    const f = v / VDD
    gpioTag.set(`GPIO ${gpio}`)
    pot.set(f, (s) => s)
    wire(f)
    tag.set(`Vin ${volts(v)}`, PIN_COLOR)
  }
}

/** A row of up to `count` bit cells from `at`, MSB on the left; `set(code, bits)` shows `bits` cells and lights the 1s. */
function bitCells(parent: THREE.Object3D, at: V3, count: number, pitch = 1.3) {
  const cells = Array.from({ length: count }, (_, i) => {
    const x = at[0] + i * pitch
    const m = glowMat(GREY, 0.3)
    const cell = add(parent, mesh(new THREE.BoxGeometry(pitch * 0.8, pitch * 0.8, 0.5), m), [x, at[1], at[2]])
    const digit = liveLabel(parent, [x, at[1] + pitch * 0.9, at[2]], { size: pitch * 0.42 })
    return { cell, m, digit }
  })
  return (code: number, bits: number, tint = POWER, pending = -1) => {
    cells.forEach((c, i) => {
      const shown = i < bits
      c.cell.visible = shown
      c.cell.position.x = c.digit.group.position.x = at[0] + (bits - 1 - i) * pitch
      if (!shown) return c.digit.set('')
      const on = Math.floor(code / 2 ** i) % 2
      const trying = i === pending
      setGlow(c.m, trying ? RING : on ? tint : '#3a3f48', trying ? 1.1 : on ? 0.9 : 0.25)
      c.digit.set(String(on), trying ? RING : on ? tint : GREY)
    })
  }
}

// --- Resolution and range: N bits cut the range into 2ᴺ steps; attenuation sets the range. ---

const BIT_OPTIONS = ['3', '4', '6', '8', '12']
const resOf = (p: Params) => {
  const bits = Number(BIT_OPTIONS.includes(String(p.bits)) ? p.bits : '3')
  const atten = pick(ESP32_ATTEN, p.atten, '11') as AttenKey
  const full = ESP32_ATTEN[atten].full
  const v = n(p, 'vin')
  const code = quantize(v, full, bits)
  return { bits, atten, full, v, code, step: lsb(full, bits), clip: v >= full }
}
const ZOOM_LSB = 3

export const resolutionAndRange: Lesson = {
  id: 'adc-resolution-and-range',
  title: 'Resolution and range',
  tagline: 'Bits slice the range into steps',
  formula: (p) => {
    const r = resOf(p)
    return `LSB = range / 2ᴺ = ${volts(r.full)} / ${2 ** r.bits} = ${mV(r.step)} · code = ⌊${volts(r.v)} / ${mV(r.step)}⌋ = ${r.code}${r.clip ? ' (clipped)' : ''} → ${volts(codeVolts(r.code, r.full, r.bits))} ± ½ LSB`
  },
  legend: [
    { color: PIN_COLOR, label: 'Staircase: code vs input voltage', shape: 'dot' },
    { color: RING, label: 'Your input → its code', shape: 'dot' },
    { color: HIGH_V, label: 'Above the range: stuck at the top code', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An ADC turns a voltage into a whole number. With N bits there are 2ᴺ codes, so the range is cut into 2ᴺ equal steps; one step is the LSB.',
    'The ESP32 reads 12 bits: 4096 codes. Over a 3.1 V range one step is 0.76 mV. Anything inside a step reads the same code, so the reading is off by up to ½ LSB. That is quantisation error.',
    'Fewer bits, coarser steps: at 3 bits the whole range has 8 codes and a turn of the pot jumps between them. analogReadResolution() only drops bits; it cannot add any.',
    'The range is set by the input attenuator, not the 3.3 V supply: 0 dB covers ~1.1 V, 11 dB ~3.1 V. A smaller range means finer steps but clips sooner: above it every voltage reads the top code.',
    'Pick the smallest range that still holds your signal. The Voltage divider lesson (Divider as a sensor input) scales a bigger signal down into it.',
  ],
  controls: [
    { kind: 'slider', key: 'vin', label: 'Input', min: 0, max: VDD, initial: 1.2, step: 0.01, format: (v) => volts(v) },
    { kind: 'choice', key: 'bits', options: BIT_OPTIONS.map((b) => ({ value: b, label: `${b} bits` })), initial: '3' },
    attenChoice('11'),
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const input = potToPin(scene)
    const cells = bitCells(scene, [5.4, 2.4, 0], ADC_BITS, 1.1)
    partLetter(scene, 'code bits, MSB first', [11.5, 4.7, 0], 0.55, GREY)
    const W = 24
    const H = 11
    const sc = scope(scene, W, H, { divs: [11, 8], zeroAt: 0 })
    sc.group.position.set(-5, -5.6, 0)
    ticks(sc, [[0, '0'], [1 / 3.3, '1'], [2 / 3.3, '2'], [3 / 3.3, '3']], [], 0.6)
    partLetter(scene, 'V', [-5 + W / 2 + 1.2, -5.6 - H / 2 - 0.9, 0], 0.6, GREY, 'left')
    const ideal = sc.trace(GREY, { samples: 60, radius: 0.06 })
    const stair = sc.trace(PIN_COLOR, { samples: 480, radius: 0.1 })
    const level = sc.level(RING)
    const clipZone = glowBox(sc.group, [1, H, 0.2], [0, 0, 0.1], HIGH_V, 0.18)
    const yOf = (code: number, bits: number) => -H / 2 + (H * (code + 0.5)) / 2 ** bits
    const ZW = 8
    const zoom = scope(scene, ZW, H, { divs: [6, 6], zeroAt: 0 })
    zoom.group.position.set(14.4, -5.6, 0)
    partLetter(scene, `zoom: ${2 * ZOOM_LSB} LSB wide`, [14.4, -5.6 - H / 2 - 1, 0], 0.55, GREY)
    const zStair = zoom.trace(PIN_COLOR, { samples: 200, radius: 0.1 })
    const zIdeal = zoom.trace(GREY, { samples: 2, radius: 0.06 })
    const codeTag = liveLabel(scene, [-16.4, -1.6, 0.3], { size: 0.7, align: 'left' })
    const code = codeBlock(scene, [-19, -14.4, 0], 0.7)
    const s = { v: 1.2 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const r = resOf(p)
        s.v = glide(dt, s.v, r.v, 6)
        input(s.v)
        const c = quantize(s.v, r.full, r.bits)
        const toU = (v: number) => v / VDD
        stair.draw((u) => yOf(quantize(u * VDD, r.full, r.bits), r.bits), toU(s.v))
        ideal.draw((u) => -H / 2 + (H * u * VDD) / r.full, null)
        level.set(yOf(c, r.bits))
        const fu = Math.min(1, r.full / VDD)
        clipZone.mesh.visible = fu < 1
        clipZone.mesh.scale.x = (1 - fu) * W
        clipZone.mesh.position.x = sc.xAt((1 + fu) / 2)
        const zc = Math.min(s.v, r.full - r.step)
        const zLo = zc - ZOOM_LSB * r.step
        const zv = (u: number) => zLo + u * 2 * ZOOM_LSB * r.step
        const zy = (v: number) => (H * (v - zc)) / (2 * ZOOM_LSB * r.step)
        zStair.draw((u) => zy(codeVolts(quantize(zv(u), r.full, r.bits), r.full, r.bits)), 0.5)
        zIdeal.draw((u) => zy(zv(u)), null)
        cells(c, r.bits, r.clip ? HIGH_V : POWER)
        codeTag.set(`${c} of ${2 ** r.bits - 1}${r.clip ? ', clipped' : ''}`, r.clip ? HIGH_V : RING)
        code([`analogReadResolution(${r.bits});`, `analogSetAttenuation(${ESP32_ATTEN[r.atten].arduino});`, `int code = analogRead(${PIN});  // ${c}`])
      },
      readouts: (p) => {
        const r = resOf(p)
        return [
          { label: 'Code', value: `${r.code} / ${2 ** r.bits - 1}`, tone: r.clip ? 'bad' : 'ok' },
          { label: 'Step (LSB)', value: mV(r.step) },
          { label: 'Range', value: `0 … ${volts(r.full)}`, tone: r.clip ? 'bad' : 'ok' },
          { label: 'Error', value: r.clip ? 'clipped' : `${mV(r.v - codeVolts(r.code, r.full, r.bits))}` },
        ]
      },
    }
  },
}

// --- Sampling: freeze the input on a capacitor, then a comparator and a DAC binary-search the code, MSB first. ---

const SIG_HZ = 50
const SIG = (t: number) => 1.65 + 1.2 * Math.sin(2 * Math.PI * SIG_HZ * t)
const SLOW = 200
const WINDOW = 2 / SIG_HZ
const TRACK_S = 0.8
const CONVERT_S = 2.6
const SAMPLE_BITS = ['4', '8', '12']
const sampOf = (p: Params) => ({
  fs: Math.round(n(p, 'rate')),
  bits: Number(SAMPLE_BITS.includes(String(p.bits)) ? p.bits : '8'),
})
const aliasOf = (fs: number) => Math.abs(aliasFrequency(SIG_HZ, fs))

export const sampling: Lesson = {
  id: 'adc-sampling',
  title: 'Sampling',
  tagline: 'Hold still, then guess bit by bit',
  formula: (p) => {
    const { fs, bits } = sampOf(p)
    const al = aliasOf(fs)
    return `one sample every 1 / ${hertz(fs)} = ${(1000 / fs).toFixed(1)} ms · ${bits} compare steps per sample · 50 Hz in, Nyquist ${hertz(nyquist(fs))}${al !== SIG_HZ ? ` → aliases to ${hertz(al)}` : ''}`
  },
  legend: [
    { color: PIN_COLOR, label: 'Input: 50 Hz sine', shape: 'dot' },
    { color: POWER, label: 'Held on the capacitor (sample-and-hold)', shape: 'dot' },
    { color: RING, label: 'DAC trial voltage, MSB first', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The input keeps moving, but a conversion takes several steps. So a switch first connects a tiny capacitor to the pin (track), then opens: the capacitor holds the voltage still (hold).',
    'A SAR (successive approximation) ADC then plays twenty questions. It sets the top bit, an internal DAC makes that trial voltage, and a comparator answers: is the held voltage at least that? Yes keeps the bit, no clears it.',
    'Each answer halves the remaining range, so N bits take N comparisons: 12 for the ESP32. The steps below are the same binary search as guessing a number between 0 and 4095.',
    `Between samples the ADC sees nothing, so the sample rate must be more than twice the fastest signal (Nyquist). Slide below 100 Hz and the 50 Hz sine comes out as a slow fake wave: aliasing, covered in the Fourier lessons.`,
    `Time is slowed ${SLOW}×; the conversion panel replays one sample in slow motion. A high-impedance source charges the hold capacitor slowly: keep it under ~10 kΩ or add 100 nF at the pin.`,
  ],
  controls: [
    { kind: 'slider', key: 'rate', label: 'Sample rate', min: 20, max: 2000, initial: 400, log: true, format: (v) => hertz(Math.round(v)) },
    { kind: 'choice', key: 'bits', options: SAMPLE_BITS.map((b) => ({ value: b, label: `${b} bits` })), initial: '8' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const Y = 5.6
    add(scene, acSource(1.5, PIN_COLOR), [-17, 2.1, 0])
    partLetter(scene, 'Vin', [-18.9, 2.1, 0], 0.6, PIN_COLOR, 'right')
    const inWire = signalWire(scene, [[-17, 3.6, 0], [-17, Y, 0], [-13, Y, 0]])
    groundAt(scene, [-17, 0.6, 0])
    const sw = knifeSwitch(scene, [-13, Y, 0], 3, [0])
    partLetter(scene, 'track / hold', [-11.5, Y + 1.6, 0], 0.55, GREY)
    const op = opAmpSymbol(scene, [0.4, Y - 1.1, 0], { size: 4.4, minusTop: false })
    const holdWire = signalWire(scene, [[-10, Y, 0], op.pins.p])
    const hold = junction(scene, [-6.6, Y, 0], 0.4)
    ceramicAlong(scene, [-6.6, Y, 0], [-6.6, 1.3, 0], 1.1)
    groundAt(scene, [-6.6, 1.3, 0])
    const holdTag = liveLabel(scene, [-8.2, 3.2, 0], { size: 0.65, align: 'right' })
    const dacAt: V3 = [0.4, -1.1, 0]
    box(scene, [4.4, 2.2, 0.8], mat('#23262d', { rough: 0.55 }), dacAt)
    partLetter(scene, 'DAC', [dacAt[0], dacAt[1], 0.5], 0.7, LABEL)
    const dacWire = signalWire(scene, [[dacAt[0] - 2.2, dacAt[1], 0], [-4, dacAt[1], 0], [-4, op.pins.n[1], 0], op.pins.n])
    const dacTag = liveLabel(scene, [-4.6, dacAt[1] - 1.2, 0], { size: 0.6, align: 'right' })
    const cmpWire = signalWire(scene, [op.pins.out, [5.6, Y - 1.1, 0]])
    const answer = liveLabel(scene, [4.4, Y - 3.4, 0], { size: 0.6 })
    const cells = bitCells(scene, [6.6, Y - 1.1, 0], ADC_BITS, 1.05)
    partLetter(scene, 'SAR register', [12.4, Y + 1.4, 0], 0.6, LABEL)
    signalWire(scene, [[12.4, Y - 1.9, 0], [12.4, dacAt[1], 0], [dacAt[0] + 2.2, dacAt[1], 0]])(0.5)
    const H = 7
    const sc = scope(scene, 19, H, { divs: [8, 4], zeroAt: 0 })
    sc.group.position.set(-7.4, -8.4, 0)
    const yV = (v: number) => -H / 2 + (H * v) / VDD
    const inTrace = sc.trace(PIN_COLOR, { samples: 320, radius: 0.08 })
    const heldTrace = sc.trace(POWER, { samples: 480, radius: 0.12 })
    partLetter(scene, 'last 40 ms', [-7.4, -12.6, 0], 0.55, GREY)
    const sar = scope(scene, 11, H, { divs: [6, 4], zeroAt: 0 })
    sar.group.position.set(10.6, -8.4, 0)
    const trial = sar.trace(RING, { samples: 240, radius: 0.11 })
    const target = sar.level(POWER)
    partLetter(scene, 'compare steps', [10.6, -12.6, 0], 0.55, GREY)
    const code = codeBlock(scene, [-19, -15.4, 0], 0.7, 2)
    const s = { t: 0, held: 1.65, key: '', angle: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const { fs, bits } = sampOf(p)
        const key = `${fs}|${bits}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const now = s.t / SLOW + WINDOW
        inTrace.scroll(SIG, now, WINDOW)
        heldTrace.scroll((t) => heldAt(SIG, t, fs), now, WINDOW)
        const period = TRACK_S + CONVERT_S
        const cycle = Math.floor(s.t / period)
        const phase = s.t - cycle * period
        const tracking = phase < TRACK_S
        if (tracking) s.held = heldAt(SIG, now, fs)
        const steps = sarSteps(s.held, VDD, bits)
        const k = tracking ? -1 : Math.min(bits - 1, Math.floor(((phase - TRACK_S) / CONVERT_S) * bits))
        const step = k >= 0 ? steps[k] : null
        s.angle = glide(dt, s.angle, tracking ? 0 : 0.45, 10)
        sw.set(s.angle)
        inWire(SIG(now) / VDD)
        hold.set(s.held / VDD)
        holdWire(s.held / VDD)
        holdTag.set(`hold ${volts(s.held)}`, POWER)
        const done = k > 0 ? steps[k - 1].code : 0
        cells(step ? done + 2 ** step.bit : 0, bits, POWER, step ? step.bit : -1)
        dacWire(step ? step.dac / VDD : 0)
        dacTag.set(step ? `DAC ${volts(step.dac)}` : 'DAC idle', step ? RING : GREY)
        op.inputs(s.held / VDD, step ? step.dac / VDD : 0)
        op.set(step?.keep ? 1 : 0)
        cmpWire(step?.keep ? 1 : 0)
        answer.set(step ? (step.keep ? 'hold >= DAC: keep 1' : 'hold < DAC: clear') : 'tracking...', step ? (step.keep ? POWER : HEAT) : GREY)
        const shown = k
        trial.draw((u) => {
          const j = Math.min(Math.floor(u * bits), Math.max(0, shown))
          return -H / 2 + (H * (shown < 0 ? 0 : steps[j].dac)) / VDD
        }, shown < 0 ? null : Math.min(1, (shown + 0.5) / bits))
        target.set(yV(s.held))
        const result = steps[bits - 1].code
        code([`int raw = analogRead(${PIN});  // ${k === bits - 1 ? result : '...'}`, `adc_oneshot_read(adc1, ADC_CHANNEL_6, &raw);`])
      },
      readouts: (p) => {
        const { fs, bits } = sampOf(p)
        const al = aliasOf(fs)
        const ok = fs > 2 * SIG_HZ
        return [
          { label: 'Sample rate', value: hertz(fs), tone: ok ? 'ok' : 'bad' },
          { label: 'Per 50 Hz cycle', value: `${(fs / SIG_HZ).toFixed(1)} samples`, tone: ok ? 'ok' : 'bad' },
          { label: 'Looks like', value: ok ? '50 Hz' : `${hertz(al)} (alias)`, tone: ok ? 'ok' : 'bad' },
          { label: 'Steps', value: `${bits} compares` },
        ]
      },
    }
  },
}

// --- Noise and averaging: noise makes the last bits flicker; the mean of n readings is √n times steadier. ---

const NZ_V = 1.234
const NZ_FULL = ESP32_ATTEN['11'].full
const NZ_LSB = lsb(NZ_FULL, ADC_BITS)
const AVG_OPTIONS = ['1', '4', '16', '64', '256']
const RAW_LEN = 6000
const nzOf = (p: Params) => {
  const sigma = n(p, 'noise') / 1000
  const count = Number(AVG_OPTIONS.includes(String(p.avg)) ? p.avg : '1')
  const raw1 = averagedRms(sigma, NZ_LSB, 1)
  const rms = averagedRms(sigma, NZ_LSB, count)
  return { sigma, count, rms, bits: effectiveBits(NZ_FULL, rms), bits1: effectiveBits(NZ_FULL, raw1) }
}
const rawStream = memoBy(
  (sigma: number) => String(sigma),
  (sigma: number) => {
    const raw = Array.from({ length: RAW_LEN }, (_, k) => quantize(NZ_V + sigma * gaussAt(k), NZ_FULL, ADC_BITS))
    const sum = [0]
    raw.forEach((r, i) => sum.push(sum[i] + r))
    return { raw, sum }
  },
)
const PER_S = 12
const SHOWN = 72

export const noiseAndAveraging: Lesson = {
  id: 'adc-noise-and-averaging',
  title: 'Noise and averaging',
  tagline: 'Four times the samples, one more bit',
  formula: (p) => {
    const z = nzOf(p)
    return `σ_avg = σ / √n = ${(z.sigma / NZ_LSB).toFixed(1)} LSB / √${z.count} · effective bits = log₂(range / (σ × √12)) = ${z.bits.toFixed(1)} (raw ${z.bits1.toFixed(1)}, +½ bit per doubling)`
  },
  legend: [
    { color: PIN_COLOR, label: 'Raw readings (1 LSB = 0.76 mV)', shape: 'dot' },
    { color: POWER, label: 'Mean of the last n readings', shape: 'dot' },
    { color: RING, label: `Dashed = the true ${volts(NZ_V)}`, shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Hold the pot still and the reading still flickers. Supply ripple, the Wi-Fi radio and the ADC’s own circuits add a few mV of noise, and on the ESP32 that is several LSB: the last bits are just noise.',
    'Averaging helps because noise is random: the errors partly cancel. The mean of n readings wanders √n times less. 4 readings halve the noise (one more effective bit), 16 quarter it (two bits), 256 give four bits.',
    'The price is time: 64 readings at ~10 µs each take ~0.6 ms, and the average lags fast changes. It is a low-pass filter (see the Filters lesson); a running average or a 100 nF capacitor at the pin does the same job.',
    'Noise is actually needed: with zero noise every reading lands on the same code and averaging gains nothing. Some noise (≈ ½ LSB or more) dithers the input across steps, so the mean can land between codes.',
    'Averaging cannot fix offset or gain errors; every reading shares them. That is calibration, in ESP32 ADC quirks.',
  ],
  controls: [
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 15, initial: 4, step: 0.5, format: (v) => `${v.toFixed(1)} mV rms` },
    { kind: 'choice', key: 'avg', options: AVG_OPTIONS.map((a) => ({ value: a, label: `n = ${a}` })), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const input = potToPin(scene)
    const W = 21
    const H = 9
    const sc = scope(scene, W, H, { divs: [12, 6], zeroAt: 0.5 })
    sc.group.position.set(-6, -5, 0)
    const raw = sc.trace(PIN_COLOR, { samples: 2 * SHOWN, radius: 0.07 })
    const avg = sc.trace(POWER, { samples: SHOWN, radius: 0.14 })
    const truth = sc.level(RING)
    partLetter(scene, `last ${SHOWN} readings, ${PER_S} per s shown`, [-6, -10.4, 0], 0.55, GREY)
    const BINS = 21
    const hist = Array.from({ length: BINS }, (_, i) => {
      const y = -5 - H / 2 + ((i + 0.5) / BINS) * H
      const rawBar = add(scene, mesh(new THREE.BoxGeometry(1, (H / BINS) * 0.8, 0.3), glowMat(PIN_COLOR, 0.5)), [7, y, -0.2])
      const avgBar = add(scene, mesh(new THREE.BoxGeometry(1, (H / BINS) * 0.45, 0.4), glowMat(POWER, 0.9)), [7, y, 0.2])
      return { rawBar, avgBar }
    })
    partLetter(scene, 'spread', [10, -10.4, 0], 0.55, GREY)
    const reading = liveLabel(scene, [10, 0.9, 0], { size: 0.8 })
    const code = codeBlock(scene, [-19, -12, 0], 0.7, 3)
    const meter = meterBar(scene, [-6, -17.2, 0], 20, 16, [[ADC_BITS, '12 bits', GREY]], 'effective')
    const s = { t: 0, scale: 6 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const z = nzOf(p)
        s.t += dt
        input(NZ_V)
        const st = rawStream(z.sigma)
        const head = z.count + SHOWN + Math.floor(s.t * PER_S) % (RAW_LEN - z.count - SHOWN)
        const mean = (i: number) => (st.sum[i + 1] - st.sum[i + 1 - z.count]) / z.count
        const trueCode = NZ_V / NZ_LSB - 0.5
        s.scale = glide(dt, s.scale, Math.max(4, (4 * z.sigma) / NZ_LSB), 4)
        const yOf = (c: number) => ((c - trueCode) / s.scale) * (H / 2)
        const at = (u: number) => head - SHOWN + 1 + Math.min(SHOWN - 1, Math.floor(u * SHOWN))
        raw.draw((u) => yOf(st.raw[at(u)]))
        avg.draw((u) => yOf(mean(at(u))))
        truth.set(0)
        const counts = (vals: number[]) => {
          const c = new Array<number>(BINS).fill(0)
          for (const v of vals) {
            const b = Math.floor(((yOf(v) + H / 2) / H) * BINS)
            if (b >= 0 && b < BINS) c[b]++
          }
          return c
        }
        const idx = Array.from({ length: 240 }, (_, k) => head - k)
        const rc = counts(idx.map((i) => st.raw[i]))
        const ac = counts(idx.map(mean))
        const peak = Math.max(1, ...rc, ...ac)
        hist.forEach((h, i) => {
          for (const [bar, c] of [[h.rawBar, rc[i]], [h.avgBar, ac[i]]] as const) {
            const w = 0.02 + (7 * c) / peak
            bar.scale.x = w
            bar.position.x = 6 + w / 2
          }
        })
        const m = mean(head)
        reading.set(`${z.count === 1 ? 'raw' : 'mean'} ${m.toFixed(z.count === 1 ? 0 : 1)} = ${mV(codeVolts(m, NZ_FULL, ADC_BITS))}`, z.count === 1 ? PIN_COLOR : POWER)
        meter(z.bits, `${z.bits.toFixed(1)} bits`, z.bits >= 11 ? POWER : z.bits >= 9 ? RING : HEAT)
        code(
          z.count === 1
            ? [`int raw = analogRead(${PIN});`, '// one reading: noise and all', '']
            : [`for (int i = 0; i < ${z.count}; i++)`, `  sum += analogRead(${PIN});`, `float avg = sum / ${z.count}.0;  // +${Math.log2(Math.sqrt(z.count)).toFixed(0)} bits`],
        )
      },
      readouts: (p) => {
        const z = nzOf(p)
        return [
          { label: 'Noise', value: `${(z.sigma / NZ_LSB).toFixed(1)} LSB rms`, tone: z.sigma > 4 * NZ_LSB ? 'warn' : 'ok' },
          { label: 'After n', value: `${(z.rms / NZ_LSB).toFixed(2)} LSB rms` },
          { label: 'Effective', value: `${z.bits.toFixed(1)} bits`, tone: z.bits >= 11 ? 'ok' : 'warn' },
          { label: 'Time', value: `${z.count * 10} µs` },
        ]
      },
    }
  },
}

// --- ESP32 ADC quirks: bent ends, attenuation ranges, per-chip gain (calibration), ADC2 lost to Wi-Fi. ---

const CHIP_VREF = 1.14
const SWEEP_S = 12
const UNITS_IO = {
  adc1: { label: 'GPIO 34 (ADC1)', unit: 1 as const, gpio: 34, ch: 'ADC_CHANNEL_6' },
  adc2: { label: 'GPIO 4 (ADC2) + Wi-Fi', unit: 2 as const, gpio: 4, ch: 'ADC_CHANNEL_0' },
}
const READS = { raw: 'raw × 3.3 / 4095', cal: 'Calibrated' }
const quirkOf = (p: Params) => {
  const atten = pick(ESP32_ATTEN, p.atten, '11') as AttenKey
  const io = UNITS_IO[pick(UNITS_IO, p.unit, 'adc1')]
  const cal = pick(READS, p.read, 'raw') === 'cal'
  const ok = adcReadable(io.unit, true)
  const report = (v: number) => {
    const r = esp32Raw(v, atten, CHIP_VREF)
    return cal ? calibratedVolts(r, atten, CHIP_VREF) : naiveVolts(r)
  }
  return { atten, a: ESP32_ATTEN[atten], io, cal, ok, report }
}
const sweepV = (t: number) => VDD * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / SWEEP_S))

export const esp32AdcQuirks: Lesson = {
  id: 'adc-esp32-adc-quirks',
  title: 'ESP32 ADC quirks',
  tagline: 'Bent ends, set the range, calibrate, avoid ADC2',
  formula: (p) => {
    const q = quirkOf(p)
    if (!q.ok) return 'ADC2 is shared with the Wi-Fi radio: while Wi-Fi runs, adc_oneshot_read() returns ESP_ERR_TIMEOUT'
    const v = 1
    const r = esp32Raw(v, q.atten, CHIP_VREF)
    return `${q.a.db} dB: linear ${volts(q.a.lo)} … ${volts(q.a.hi)} · 1 V reads ${r} → ${q.cal ? `calibrated ${mV(calibratedVolts(r, q.atten, CHIP_VREF))}` : `${r} / 4095 × 3.3 = ${mV(naiveVolts(r))}`}`
  },
  legend: [
    { color: GREY, label: 'Ideal: reading = input', shape: 'dot' },
    { color: PIN_COLOR, label: 'What this ESP32 reports', shape: 'dot' },
    { color: POWER, label: 'Band = recommended linear range', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The original ESP32’s ADC is usable but quirky. It never reads 0 near 0 V: below ~0.1 V it is stuck at 0, and near the top of each range the curve bends flat, so the ends read wrong.',
    'Attenuation picks the range: 0, 2.5, 6 or 11 dB, roughly 1.1, 1.5, 2.2 and 3.1 V full scale. Espressif only promises the middle (e.g. 0.15 … 2.45 V at 11 dB); keep your signal inside that band.',
    'raw / 4095 × 3.3 is the common shortcut, and it is wrong twice: the range is not 3.3 V, and each chip’s internal reference differs (1.0 … 1.2 V). Calibration reads the reference burned into eFuse and fixes gain and offset: analogReadMilliVolts() or adc_cali_raw_to_voltage().',
    'ADC2 pins are shared with the Wi-Fi radio. Once Wi-Fi starts, ADC2 reads fail. Wire analog sensors to ADC1 (GPIO 32–39); 34–39 are input-only, which suits them.',
    `Here the pot sweeps 0 … 3.3 V over ${SWEEP_S} s, into a chip whose reference is ${volts(CHIP_VREF)}. Newer chips (S3, C3) are more linear but keep the same rules.`,
  ],
  controls: [
    attenChoice('11'),
    { kind: 'choice', key: 'read', options: Object.entries(READS).map(([value, label]) => ({ value, label })), initial: 'raw' },
    { kind: 'choice', key: 'unit', options: Object.entries(UNITS_IO).map(([value, u]) => ({ value, label: u.label })), initial: 'adc1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const input = potToPin(scene)
    const radio = Array.from({ length: 3 }, (_, i) => {
      const m = new THREE.MeshBasicMaterial({ color: HEAT, transparent: true, opacity: 0, depthWrite: false })
      const ring = add(scene, mesh(new THREE.TorusGeometry(1, 0.06, 6, 40, Math.PI), m), [BOARD[0] - 3, BOARD[1] + 4.4, 0])
      return { ring, m, phase: i / 3 }
    })
    const W = 22
    const H = 11
    const sc = scope(scene, W, H, { divs: [11, 11], zeroAt: 0 })
    sc.group.position.set(-4, -5.6, 0)
    const t3 = [0, 1, 2, 3].map((v) => [v / VDD, String(v)] as [number, string])
    ticks(sc, t3, t3, 0.6)
    partLetter(scene, 'Vin', [-4 + W / 2 + 1.3, -5.6 - H / 2 - 0.9, 0], 0.6, GREY, 'left')
    partLetter(scene, 'reads', [-4 + W / 2 + 1.8, -5.6 + H / 2 + 0.9, 0], 0.6, GREY)
    const yOf = (v: number) => -H / 2 + (H * v) / VDD
    const band = glowBox(sc.group, [1, H, 0.2], [0, 0, 0.1], POWER, 0.07)
    const ideal = sc.trace(GREY, { samples: 2, radius: 0.06 })
    const curve = sc.trace(PIN_COLOR, { samples: 330, radius: 0.11 })
    const fail = liveLabel(scene, [-4, -5.6, 0.6], { size: 1.1, color: HIGH_V })
    const big = liveLabel(scene, [13.4, -1.8, 0], { size: 0.9 })
    const err = liveLabel(scene, [13.4, -4, 0], { size: 0.75 })
    const rawTag = liveLabel(scene, [13.4, -6, 0], { size: 0.65, color: GREY })
    const code = codeBlock(scene, [-19, -14.4, 0], 0.7)
    const s = { t: 0, ring: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = quirkOf(p)
        s.t += dt
        const v = sweepV(s.t)
        input(v, q.io.gpio)
        band.mesh.scale.x = ((q.a.hi - q.a.lo) / VDD) * W
        band.mesh.position.x = sc.xAt((q.a.lo + q.a.hi) / 2 / VDD)
        ideal.draw((u) => -H / 2 + H * u, null)
        curve.group.visible = q.ok
        curve.draw((u) => yOf(q.report(u * VDD)), v / VDD)
        s.ring = (s.ring + dt * 1.2) % 1
        for (const r of radio) {
          const ph = (s.ring + r.phase) % 1
          r.ring.scale.setScalar(1 + 2.4 * ph)
          r.m.opacity = 0.7 * (1 - ph) * (q.io.unit === 2 ? 1 : 0.25)
        }
        fail.set(q.ok ? '' : 'ESP_ERR_TIMEOUT')
        const raw = esp32Raw(v, q.atten, CHIP_VREF)
        const rep = q.report(v)
        const e = rep - v
        big.set(q.ok ? `reads ${volts(rep)}` : 'no reading', q.ok ? PIN_COLOR : HIGH_V)
        err.set(q.ok ? `error ${e >= 0 ? '+' : ''}${mV(e)}` : 'Wi-Fi owns ADC2', !q.ok || Math.abs(e) > 0.05 ? HEAT : POWER)
        rawTag.set(q.ok ? `raw ${raw} / ${ADC_MAX}` : '')
        const g = q.io.gpio
        code(
          q.cal
            ? [`analogSetPinAttenuation(${g}, ${q.a.arduino});`, `int mv = analogReadMilliVolts(${g});`, `adc_cali_raw_to_voltage(cali, raw, &mv);`]
            : [`analogSetPinAttenuation(${g}, ${q.a.arduino});`, `float v = analogRead(${g}) * 3.3 / 4095;`, `adc_oneshot_read(adc${q.io.unit}, ${q.io.ch}, &raw);`],
        )
      },
      readouts: (p) => {
        const q = quirkOf(p)
        const v = sweepV(s.t)
        const e = q.report(v) - v
        const inBand = v >= q.a.lo && v <= q.a.hi
        return [
          { label: 'Input', value: volts(v), tone: inBand ? 'ok' : 'warn' },
          q.ok ? { label: 'Reads', value: volts(q.report(v)), tone: Math.abs(e) < 0.03 ? 'ok' : 'warn' } : { label: 'Reads', value: 'ESP_ERR_TIMEOUT', tone: 'bad' },
          { label: 'Error', value: q.ok ? mV(e) : '—', tone: q.ok && Math.abs(e) < 0.03 ? 'ok' : 'bad' },
          { label: 'Range', value: `${q.a.db} dB: ${volts(q.a.lo)} … ${volts(q.a.hi)}` },
        ]
      },
    }
  },
}
