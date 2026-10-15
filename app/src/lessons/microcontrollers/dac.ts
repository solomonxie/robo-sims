import * as THREE from 'three/webgpu'
import {
  ESP32_DAC_BITS,
  GPIO_VDD,
  dacVolts,
  heldCode,
  heldThroughRc,
  imageHz,
  ledcMaxHz,
  pwmLevel,
  pwmThroughRc,
  r2rSolve,
  rcCutoff,
  rcGain,
  sqnrDb,
} from '../../core/physics'
import { amps, hertz, hexByte, secs, volts } from '../../core/units'
import { binary } from '../../core/numbers'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  CONVENTIONAL,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  ceramicAlong,
  codeBlock,
  esp32Board,
  glide,
  groundAt,
  junction,
  knifeSwitch,
  lane,
  liveLabel,
  loopBeads,
  memoBy,
  opAmpSymbol,
  partLetter,
  presence,
  resistorAlong,
  scope,
  signalWire,
  speaker,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const VDD = GPIO_VDD
const VIEW = { center: [-1, -3.6, 0] as V3, radius: 79, polar: 1.47, azimuth: 0.06 }
const AUDIO_VIEW = { ...VIEW, center: [-0.5, -4.6, 0] as V3, radius: 72 }

// --- R-2R ladder: each bit switches a 2R leg between Vref and ground; the ladder halves every bit's share on its way to the output. ---

const BITS = 4
const R = 10e3
const TOP = 2 ** BITS - 1
const COUNT_S = 1.4
const MODES = { count: 'Count up', hold: 'Hold code' }
const ladOf = (p: Params) => {
  const counting = pick(MODES, p.mode, 'count') === 'count'
  const code = Math.max(0, Math.min(TOP, Math.round(n(p, 'code'))))
  return { counting, code }
}
const XS = [-10, -4, 2, 8]
const RUNG_Y = 6
const PIVOT_Y = 0.6
const BLADE = 2.2
const TILT = 0.55
const VREF_Y = -2.9
const I_FULL = VDD / (3 * R)

export const r2rLadder: Lesson = {
  id: 'dac-r-2r-ladder',
  title: 'R-2R ladder',
  tagline: 'Two resistor values, any number of bits',
  formula: (p) => {
    const { code } = ladOf(p)
    const r = r2rSolve(code, BITS, VDD, R)
    return `Vout = Vref × code / 2ᴺ = ${volts(VDD)} × ${code} / ${2 ** BITS} = ${volts(r.out)} · bit k weighs 2ᵏ / 2ᴺ: b3 → ½, b2 → ¼, b1 → ⅛, b0 → 1/16`
  },
  legend: [
    { color: HIGH_V, label: 'Bit = 1: leg switched to Vref (3.3 V)', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current; speed ∝ amps (nodal solve)', shape: 'dot' },
    { color: PIN_COLOR, label: 'Output staircase: Vout vs code', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A DAC turns a number back into a voltage. The R-2R ladder does it with just two resistor values: R along the rungs and 2R down each leg.',
    'Each bit drives one leg: 1 switches it to Vref, 0 to ground. Looking left from any node the ladder is always R, so each node halves what comes from the left: the MSB counts ½ of Vref, the next ¼, then ⅛, then 1/16.',
    'Watch the currents: they split at every node, part down the 0-legs to ground and part on toward the output. The sum lands as Vout = Vref × code / 2ᴺ, one step (LSB) per count: here 3.3 V / 16 ≈ 0.21 V.',
    'Why not one resistor per bit (R, 2R, 4R, 8R …)? At 12 bits the biggest is 2048 R, and matching such a spread is hard. R-2R needs only matched pairs, so it is cheap to trim on a chip; the ESP32’s 8-bit DAC and many audio DACs work this way.',
    'The output is not a stiff source: it looks like R back into the ladder, so buffer it (Op-amp lesson) before a load. Any 4 GPIOs and 12 resistors make a working DAC.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: Object.entries(MODES).map(([value, label]) => ({ value, label })), initial: 'count' },
    { kind: 'slider', key: 'code', label: 'Code', min: 0, max: TOP, initial: 11, step: 1, format: (v) => `${v} = 0b${binary(Math.round(v), BITS)}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const lit = (pts: V3[]) => signalWire(scene, pts)
    const termX = -14
    const rungWires = XS.slice(1).map((x, k) => {
      const a: V3 = [XS[k], RUNG_Y, 0]
      const b: V3 = [x, RUNG_Y, 0]
      resistorAlong(scene, R, [XS[k] + 1.4, RUNG_Y, 0], [x - 1.4, RUNG_Y, 0], 1.3)
      return [lit([a, [XS[k] + 1.3, RUNG_Y, 0]]), lit([[x - 1.3, RUNG_Y, 0], b])]
    })
    partLetter(scene, 'R', [(XS[0] + XS[1]) / 2, RUNG_Y + 1.3, 0], 0.6, LABEL)
    const termWire = lit([[XS[0], RUNG_Y, 0], [termX, RUNG_Y, 0], [termX, RUNG_Y - 1.3, 0]])
    resistorAlong(scene, 2 * R, [termX, RUNG_Y - 1.4, 0], [termX, PIVOT_Y + 0.4, 0], 1.3)
    signalWire(scene, [[termX, PIVOT_Y + 0.6, 0], [termX, PIVOT_Y - 0.6, 0]])(0)
    groundAt(scene, [termX, PIVOT_Y - 0.6, 0])
    partLetter(scene, '2R', [termX - 1.1, (RUNG_Y + PIVOT_Y) / 2, 0], 0.6, LABEL, 'right')
    const nodes = XS.map((x) => junction(scene, [x, RUNG_Y, 0], 0.42))
    const legs = XS.map((x, k) => {
      const top = lit([[x, RUNG_Y, 0], [x, RUNG_Y - 1.3, 0]])
      resistorAlong(scene, 2 * R, [x, RUNG_Y - 1.4, 0], [x, PIVOT_Y + 1.6, 0], 1.3)
      const low = lit([[x, PIVOT_Y + 1.5, 0], [x, PIVOT_Y, 0]])
      const sw = knifeSwitch(scene, [x, PIVOT_Y, 0], BLADE, [-Math.PI / 2 - TILT, -Math.PI / 2 + TILT])
      const hi: V3 = [x - BLADE * Math.sin(TILT), PIVOT_Y - BLADE * Math.cos(TILT), 0]
      const lo: V3 = [x + BLADE * Math.sin(TILT), PIVOT_Y - BLADE * Math.cos(TILT), 0]
      signalWire(scene, [hi, [hi[0], VREF_Y, 0]])(1)
      groundAt(scene, lo)
      const tag = liveLabel(scene, [x - 0.7, (RUNG_Y + PIVOT_Y) / 2 + 0.6, 0], { size: 0.5, align: 'right' })
      const bit = liveLabel(scene, [x + 0.4, VREF_Y - 1.4, 0], { size: 0.65 })
      const beads = loopBeads(scene, 5, CONVENTIONAL, { r: 0.2, closed: false })
      beads.setPath(lane([[x, PIVOT_Y - 0.2, 0], [x, RUNG_Y, 0]], 0.9))
      return { top, low, sw, tag, bit, beads, angle: 0, k }
    })
    signalWire(scene, [[XS[0] - BLADE * Math.sin(TILT) - 3.6, VREF_Y, 0], [XS[3] - BLADE * Math.sin(TILT), VREF_Y, 0]])(1)
    partLetter(scene, 'Vref 3.3 V', [termX - 1.6, VREF_Y, 0], 0.6, HIGH_V, 'right')
    const rungBeads = XS.slice(1).map((x, k) => {
      const b = loopBeads(scene, 4, CONVENTIONAL, { r: 0.2, closed: false })
      b.setPath(lane([[XS[k], RUNG_Y, 0], [x, RUNG_Y, 0]], 0.9))
      return b
    })
    const termBeads = loopBeads(scene, 5, CONVENTIONAL, { r: 0.2, closed: false })
    termBeads.setPath(lane([[XS[0], RUNG_Y, 0], [termX, RUNG_Y, 0], [termX, PIVOT_Y, 0]], 0.9))
    const OUT_X = 12.5
    const outWire = lit([[XS[3], RUNG_Y, 0], [OUT_X, RUNG_Y, 0]])
    const outDot = junction(scene, [OUT_X, RUNG_Y, 0], 0.6)
    const outTag = liveLabel(scene, [OUT_X, RUNG_Y - 1.6, 0], { size: 0.8 })
    partLetter(scene, 'MSB', [XS[3], RUNG_Y + 1.3, 0], 0.55, GREY)
    partLetter(scene, 'LSB', [XS[0], RUNG_Y + 1.3, 0], 0.55, GREY)
    const W = 22
    const H = 8
    const sc = scope(scene, W, H, { divs: [16, 4], zeroAt: 0 })
    sc.group.position.set(-3, -9.8, 0)
    ticks(sc, [[0, '0'], [0.5, '8'], [1, '16']], [[0, '0'], [0.5, '1.65'], [1, '3.3']], 0.55)
    partLetter(scene, 'code', [-3 + W / 2 + 1.3, -9.8 - H / 2 - 0.9, 0], 0.55, GREY, 'left')
    const yV = (v: number) => -H / 2 + (H * v) / VDD
    const ideal = sc.trace(GREY, { samples: 2, radius: 0.05 })
    const stair = sc.trace(PIN_COLOR, { samples: 320, radius: 0.1 })
    const level = sc.level(RING)
    const code = codeBlock(scene, [-19, -16.4, 0], 0.68)
    const s = { t: 0, shown: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const l = ladOf(p)
        s.t += dt
        const c = l.counting ? Math.floor(s.t / COUNT_S) % (TOP + 1) : l.code
        const r = r2rSolve(c, BITS, VDD, R)
        const f = (v: number) => v / VDD
        nodes.forEach((nd, k) => nd.set(f(r.nodes[k])))
        const speed = (i: number) => (6 * i * dt) / I_FULL
        for (const leg of legs) {
          const on = Math.floor(c / 2 ** leg.k) % 2
          leg.angle = glide(dt, leg.angle, on ? 0 : 2 * TILT, 12)
          leg.sw.set(-Math.PI / 2 - TILT + leg.angle)
          leg.top(f(r.nodes[leg.k]))
          leg.low(on)
          const i = r.legs[leg.k]
          leg.beads.show(Math.abs(i) > 1e-9)
          leg.beads.step(speed(i) / 6)
          leg.tag.set(amps(Math.abs(i)), Math.abs(i) > 1e-9 ? CONVENTIONAL : GREY)
          leg.bit.set(`b${leg.k} = ${on}`, on ? HIGH_V : GREY)
        }
        rungWires.forEach(([a, b], k) => {
          a(f(r.nodes[k]))
          b(f(r.nodes[k + 1]))
        })
        rungBeads.forEach((b, k) => {
          b.show(Math.abs(r.rungs[k]) > 1e-9)
          b.step(speed(r.rungs[k]) / 6)
        })
        termWire(f(r.nodes[0]))
        termBeads.show(r.term > 1e-9)
        termBeads.step(speed(r.term) / 12)
        outWire(f(r.out))
        outDot.set(f(r.out))
        outTag.set(`Vout ${volts(r.out)}`, PIN_COLOR)
        s.shown = glide(dt, s.shown, c, 10)
        stair.draw((u) => yV(dacVolts(Math.min(TOP, Math.floor(u * (TOP + 1))), BITS, VDD)), (s.shown + 0.5) / (TOP + 1))
        ideal.draw((u) => yV(u * VDD), null)
        level.set(yV(r.out))
        code([`int code = ${c};  // 0b${binary(c, BITS)}`, `for (int b = 0; b < ${BITS}; b++)`, `  digitalWrite(PIN[b], (code >> b) & 1);`])
      },
      readouts: (p) => {
        const l = ladOf(p)
        const c = l.counting ? Math.floor(s.t / COUNT_S) % (TOP + 1) : l.code
        const r = r2rSolve(c, BITS, VDD, R)
        return [
          { label: 'Code', value: `${c} = 0b${binary(c, BITS)}` },
          { label: 'Vout', value: volts(r.out), tone: 'ok' },
          { label: 'Step (LSB)', value: volts(dacVolts(1, BITS, VDD)) },
          { label: 'From Vref', value: amps(r.supply) },
        ]
      },
    }
  },
}

// --- Audio out: GPIO25 plays a 1 kHz tone; sample rate and bit depth shape the steps, an RC smooths them; PWM is the alternative. ---

const TONE = 1000
const RC_R = 1e3
const RC_C = 47e-9
const TAU = RC_R * RC_C
const FC = rcCutoff(RC_R, RC_C)
const WINDOW = 2 / TONE
const SLOW = 2000
const DAC_PIN = 25
const OUTS = { dac: 'DAC raw', rc: 'DAC + RC', pwm: 'PWM + RC' }
const DEPTHS = ['3', '4', '6', '8']
const audOf = (p: Params) => {
  const out = pick(OUTS, p.out, 'dac')
  const bits = Number(DEPTHS.includes(String(p.bits)) ? p.bits : '4')
  const fs = Math.round(n(p, 'rate'))
  const carrier = ledcMaxHz(bits)
  const image = imageHz(TONE, fs)
  return { out, bits, fs, carrier, image, filtered: out !== 'dac', pwm: out === 'pwm', imageGain: out === 'dac' ? 1 : rcGain('low', image, FC) }
}
const db = (g: number) => `${(20 * Math.log10(g)).toFixed(0)} dB`
const levelOf = (fs: number, bits: number) => (t: number) => dacVolts(heldCode(t, TONE, fs, bits), bits, VDD)
const dutyOf = (fs: number, bits: number) => (t: number) => heldCode(t, TONE, fs, bits) / 2 ** bits
const smooth = memoBy(
  (a: ReturnType<typeof audOf>) => `${a.out}|${a.bits}|${a.fs}`,
  (a: ReturnType<typeof audOf>) =>
    a.pwm ? pwmThroughRc(dutyOf(a.fs, a.bits), a.carrier, VDD, TAU, 0, WINDOW, 480) : heldThroughRc(levelOf(a.fs, a.bits), a.fs, TAU, 0, WINDOW, 480),
)

export const audioOut: Lesson = {
  id: 'dac-audio-out',
  title: 'Audio out',
  tagline: 'Stairs in, a tone out',
  formula: (p) => {
    const a = audOf(p)
    return `${hertz(a.fs)} ÷ ${hertz(TONE)} = ${(a.fs / TONE).toFixed(1)} steps per cycle · ${a.bits} bits: ${2 ** a.bits} levels, SNR ≈ 6.02 × ${a.bits} + 1.76 = ${sqnrDb(a.bits).toFixed(0)} dB · image at fs − f = ${hertz(a.image)}${a.filtered ? `, RC (fc ${hertz(FC)}) → ${db(a.imageGain)}` : ''}`
  },
  legend: [
    { color: GREY, label: 'Ideal 1 kHz sine', shape: 'dot' },
    { color: PIN_COLOR, label: 'GPIO25 pin: held steps (or PWM pulses)', shape: 'dot' },
    { color: POWER, label: 'After the RC filter: what the speaker gets', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The original ESP32 has two 8-bit DACs, on GPIO25 and GPIO26: dacWrite(25, v) sets 0 … 255 → 0 … ~3.3 V. To play sound, a timer writes the next sample at a fixed rate, and the pin holds each value until the next one: a staircase.',
    'Sample rate sets the step width. Nyquist says you need more than 2 samples per cycle, but at 4 per cycle the stairs are coarse; 8 kHz is phone quality, 44.1 kHz is CD.',
    'Bit depth sets the step height. Each bit adds ~6 dB of signal-to-noise: 8 bits give ~50 dB, fine for voices and beeps, short of CD’s 16 bits (96 dB). Try 3 bits: the error is audible as a buzz.',
    'The steps add copies of the tone (images) near fs − f, fs + f … A low-pass reconstruction filter removes them: here a 1 kΩ / 47 nF RC (≈ 3.4 kHz). The higher the sample rate, the further the images sit from the tone and the easier they are to filter.',
    'No DAC pin (S3, C3)? Use PWM: ledcWrite sets the duty per sample, the RC averages the pulses. The carrier must be far above hearing: 8 bits run at 80 MHz / 256 = 312.5 kHz. Either way, a pin cannot drive an 8 Ω speaker: add an amplifier such as a PAM8302.',
    `Time is slowed ${SLOW}×: the scope shows ${secs(WINDOW)}; the right panel zooms in.`,
  ],
  controls: [
    { kind: 'choice', key: 'out', options: Object.entries(OUTS).map(([value, label]) => ({ value, label })), initial: 'dac' },
    { kind: 'slider', key: 'rate', label: 'Sample rate', min: 4000, max: 48000, initial: 8000, log: true, format: (v) => hertz(Math.round(v)) },
    { kind: 'choice', key: 'bits', options: DEPTHS.map((b) => ({ value: b, label: `${b} bits` })), initial: '4' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const board: V3 = [-14, 5.5, 0]
    const pin = esp32Board(scene, board, 0.5)
    partLetter(scene, 'ESP32', [board[0], board[1] + 3.6, 0], 0.9, LABEL)
    const io = pin(0, false)
    partLetter(scene, `GPIO ${DAC_PIN}`, [io[0] - 0.6, 2.2, 0], 0.6, PIN_COLOR, 'right')
    const Y = 1
    const pinWire = signalWire(scene, [io, [io[0], Y, io[2]], [io[0], Y, 0], [-8.2, Y, 0]])
    const rc = add(scene, new THREE.Group())
    rc.position.set(-6, Y, 0)
    resistorAlong(rc, RC_R, [-1.4, 0, 0], [1.4, 0, 0], 1.2)
    ceramicAlong(rc, [2.2, 0, 0], [2.2, -3, 0], 1.1)
    groundAt(rc, [2.2, -3, 0])
    partLetter(rc, '1 kΩ', [0, 1.1, 0], 0.5, LABEL)
    partLetter(rc, '47 nF', [1.2, -1.7, 0], 0.5, LABEL, 'right')
    const bypass = add(scene, new THREE.Group())
    const through = signalWire(bypass, [[-8.2, Y, 0], [-3.8, Y, 0]])
    const rcWire = signalWire(rc, [[-2.2, 0, 0], [-1.4, 0, 0]])
    const rcOut = signalWire(rc, [[1.4, 0, 0], [2.2, 0, 0]])
    const amp = opAmpSymbol(scene, [2.4, Y - 1.1, 0], { size: 3.6, minusTop: false })
    const ampIn = signalWire(scene, [[-3.8, Y, 0], amp.pins.p])
    signalWire(scene, [amp.pins.n, [amp.pins.n[0] - 0.6, amp.pins.n[1], 0], [amp.pins.n[0] - 0.6, amp.pins.n[1] - 0.8, 0]])(0)
    groundAt(scene, [amp.pins.n[0] - 0.6, amp.pins.n[1] - 0.8, 0])
    partLetter(scene, 'PAM8302 amp', [2.4, Y + 2.6, 0], 0.55, LABEL)
    const spk = speaker(scene, [11.5, Y + 1.4, 0], 2.4)
    const ampOut = signalWire(scene, [amp.pins.out, [spk.plus[0], amp.pins.out[1], 0], spk.plus])
    signalWire(scene, [spk.minus, [spk.minus[0], spk.minus[1] - 1, 0]])(0)
    groundAt(scene, [spk.minus[0], spk.minus[1] - 1, 0])
    partLetter(scene, '8 Ω', [spk.plus[0] + 1, Y - 0.9, 0], 0.55, LABEL, 'left')
    const modeTag = liveLabel(scene, [-0.5, Y + 4.6, 0], { size: 0.6 })
    const W = 22
    const H = 8
    const sc = scope(scene, W, H, { divs: [10, 4], zeroAt: 0 })
    sc.group.position.set(-6.4, -8.2, 0)
    ticks(sc, [[0, '0'], [0.5, '1'], [1, '2']], [], 0.55)
    partLetter(scene, 'ms', [-6.4 + W / 2 + 1.2, -8.2 - H / 2 - 0.9, 0], 0.55, GREY, 'left')
    const yV = (v: number) => -H / 2 + (H * v) / VDD
    const ideal = sc.trace(GREY, { samples: 160, radius: 0.06 })
    const raw = sc.trace(PIN_COLOR, { samples: 720, radius: 0.09 })
    const out = sc.trace(POWER, { samples: 480, radius: 0.13 })
    const ZW = 8
    const zoom = scope(scene, ZW, H, { divs: [4, 4], zeroAt: 0 })
    zoom.group.position.set(12.6, -8.2, 0)
    const zRaw = zoom.trace(PIN_COLOR, { samples: 400, radius: 0.09 })
    const zOut = zoom.trace(POWER, { samples: 120, radius: 0.12 })
    const zTag = liveLabel(scene, [12.6, -8.2 - H / 2 - 1, 0], { size: 0.5, color: GREY })
    const code = codeBlock(scene, [-19, -15.4, 0], 0.68)
    const s = { t: 0, key: '', rc: 0 }
    return {
      scene,
      view: AUDIO_VIEW,
      frame(dt, p) {
        const a = audOf(p)
        const key = `${a.out}|${a.bits}|${a.fs}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const now = ((s.t / SLOW) % WINDOW) / WINDOW
        const lv = levelOf(a.fs, a.bits)
        const duty = dutyOf(a.fs, a.bits)
        const sm = smooth(a)
        const at = (u: number) => sm[Math.min(sm.length - 1, Math.floor(u * sm.length))]
        ideal.draw((u) => yV(VDD * (0.5 + 0.5 * Math.sin(2 * Math.PI * TONE * u * WINDOW))), null)
        raw.group.visible = !a.pwm
        raw.draw((u) => yV(lv(u * WINDOW)), now)
        out.group.visible = a.filtered
        out.draw((u) => yV(at(u)), now)
        s.rc = glide(dt, s.rc, a.filtered ? 1 : 0, 8)
        presence(rc, s.rc)
        bypass.visible = s.rc < 0.5
        const pinV = a.pwm ? pwmLevel(now * WINDOW, duty, a.carrier, VDD) : lv(now * WINDOW)
        const spkV = a.filtered ? at(now) : pinV
        pinWire(a.pwm ? dacVolts(heldCode(now * WINDOW, TONE, a.fs, a.bits), a.bits, VDD) / VDD : pinV / VDD)
        through(pinV / VDD)
        rcWire(pinV / VDD)
        rcOut(spkV / VDD)
        ampIn(spkV / VDD)
        ampOut(spkV / VDD)
        amp.inputs(spkV / VDD, 0)
        amp.set(spkV / VDD)
        spk.set((spkV - VDD / 2) / (VDD / 2), 0.6, dt)
        modeTag.set(a.pwm ? `PWM ${hertz(a.carrier)} carrier` : a.filtered ? `RC filter, fc ≈ ${hertz(FC)}` : 'straight from the pin', a.pwm ? HEAT : a.filtered ? POWER : PIN_COLOR)
        const t0 = now * WINDOW
        const zSpan = a.pwm ? 4 / a.carrier : 2 / a.fs
        const zFrom = Math.max(0, t0 - zSpan / 2)
        const zs = a.pwm ? pwmThroughRc(duty, a.carrier, VDD, TAU, zFrom, zSpan, 120) : heldThroughRc(lv, a.fs, TAU, zFrom, zSpan, 120)
        const zLo = Math.min(...zs, a.pwm ? 0 : lv(zFrom), a.pwm ? 0 : lv(zFrom + zSpan))
        const zHi = Math.max(...zs, a.pwm ? VDD : lv(zFrom), a.pwm ? VDD : lv(zFrom + zSpan))
        const zMid = (zLo + zHi) / 2
        const zRange = Math.max(a.pwm ? VDD : 4 * dacVolts(1, a.bits, VDD), (zHi - zLo) * 1.2)
        const zy = (v: number) => (H * (v - zMid)) / zRange
        zRaw.draw((u) => zy(a.pwm ? pwmLevel(zFrom + u * zSpan, duty, a.carrier, VDD) : lv(zFrom + u * zSpan)), null)
        zOut.group.visible = a.filtered
        zOut.draw((u) => zy(zs[Math.min(zs.length - 1, Math.floor(u * zs.length))]), null)
        zTag.set(`zoom ${secs(zSpan)}`)
        const shift = ESP32_DAC_BITS - a.bits
        const sample = `sample${shift ? ` & ${hexByte(256 - 2 ** shift)}` : ''}`
        code(
          a.pwm
            ? [`ledcAttach(${DAC_PIN}, ${Math.round(a.carrier)}, ${a.bits});`, `ledcWrite(${DAC_PIN}, ${shift ? `sample >> ${shift}` : 'sample'});  // ${a.fs} Hz ISR`, `ledc_set_duty(LEDC_LOW_SPEED_MODE, ch, duty);`]
            : [`timerAlarm(t, 1000000 / ${a.fs}, true, 0);`, `dacWrite(${DAC_PIN}, ${sample});  // in the ISR`, `dac_continuous_write(dac, buf, len, &n, -1);`],
        )
      },
      readouts: (p) => {
        const a = audOf(p)
        const per = a.fs / TONE
        return [
          { label: 'Per cycle', value: per.toFixed(1), tone: per >= 8 ? 'ok' : 'warn' },
          { label: 'SNR', value: `${sqnrDb(a.bits).toFixed(0)} dB`, tone: a.bits >= 6 ? 'ok' : 'warn' },
          { label: `Image ${hertz(a.image)}`, value: a.filtered ? db(a.imageGain) : '0 dB', tone: a.filtered && a.imageGain < 0.3 ? 'ok' : 'warn' },
          a.pwm ? { label: 'Carrier', value: hertz(a.carrier) } : { label: 'Filter', value: a.filtered ? hertz(FC) : 'none', tone: a.filtered ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
