import * as THREE from 'three/webgpu'
import { toBits } from '../../core/logic'
import { addWrap, binary, countSteps, hex, nibbles, placeValues, signedRange, toSigned, wrap } from '../../core/numbers'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, HIGH_V, LABEL, LED_RED, RING, bitRow, ease, glowBox, glowMat, pulseLabel, segmentDisplay } from '../fx'
import { Lesson, Params, Stage, n } from '../types'

// --- Binary counting: each LED is a power of two; the lit ones add up to the number. ---

const W8 = 8
const P8 = 3.2
const X8 = (i: number) => 7 - i * P8
const TICK_S = 0.55

const sumOf = (v: number) =>
  placeValues(W8)
    .filter((_, i) => toBits(v, W8)[i])
    .reverse()
    .join(' + ') || '0'

export const binaryCounting: Lesson = {
  id: 'binary-hex-binary-counting',
  title: 'Binary counting',
  tagline: 'Eight switches, 256 numbers',
  formula: (p) => {
    const v = n(p, 'value')
    return `${binary(v, W8)} = ${sumOf(v)} = ${v}`
  },
  legend: [
    { color: LED_RED, label: 'LED on = bit is 1', shape: 'dot' },
    { color: RING, label: 'Place value of each lit bit; total', shape: 'dot' },
    { color: '#ff4d4d', label: 'Bit lines: red = 1 (high), blue = 0', shape: 'dot' },
  ],
  points: [
    'A wire is either high or low, so a digital circuit counts with two digits: 0 and 1. One such digit is a bit.',
    'Like decimal, binary is positional, but each place is worth twice the one to its right: 1, 2, 4, 8 … 128. Add up the places that hold a 1 to read the number.',
    'Counting up flips the lowest bit every step; when a bit goes 1 → 0 it carries into the next, exactly like 9 → 10 in decimal. Watch the LEDs in Count mode.',
    'n bits give 2ⁿ patterns: 8 bits (a byte) count 0 to 255. One more step and the byte rolls over to 0, with the carry lost.',
    'A microcontroller port is 8 pins wide: writing the number 173 to it lights exactly these LEDs.',
  ],
  controls: [
    { kind: 'slider', key: 'value', label: 'Value', min: 0, max: 255, initial: 173, step: 1, format: (v) => `${v} = ${binary(v, W8)}` },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'hold', label: 'Hold' },
        { value: 'count', label: 'Count up' },
      ],
      initial: 'hold',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const row = bitRow(
      scene,
      Array.from({ length: W8 }, (_, i) => X8(i)),
      0,
      placeValues(W8).map(String),
      { scale: 1.3 },
    )
    const total = pulseLabel(scene, 3, RING, [X8(0) + 5.4, 4.6, 0], 2.4)
    const sim = { key: '', value: 0, t: 0, levels: Array<number>(W8).fill(0) }
    return {
      scene,
      view: { center: [-0.4, 3, 0], radius: 59, polar: 1.45, azimuth: 0.08 },
      frame(dt, p) {
        const key = `${p.value}|${p.mode}`
        if (key !== sim.key) Object.assign(sim, { key, value: n(p, 'value'), t: 0 })
        if (p.mode === 'count') {
          sim.t += dt
          if (sim.t >= TICK_S) {
            sim.t -= TICK_S
            sim.value = (sim.value + 1) % 2 ** W8
          }
        }
        const bits = toBits(sim.value, W8)
        sim.levels = sim.levels.map((l, i) => l + (bits[i] - l) * ease(dt, 12))
        row.frame(dt, sim.levels)
        total.show(String(sim.value))
        total.frame(dt)
      },
      readouts: (p) => {
        const v = n(p, 'value')
        return [
          { label: 'Decimal', value: p.mode === 'count' ? `from ${v}` : String(v), tone: 'ok' },
          { label: 'Bits set', value: `${toBits(v, W8).filter(Boolean).length} of ${W8}` },
          { label: '8 bits hold', value: `0 – ${2 ** W8 - 1}` },
        ]
      },
    }
  },
}

// --- Hex shorthand: every 4 bits (a nibble) is exactly one hex digit, 0–9 then A–F. ---

const W16 = 16
const P16 = 2.3
const NIB_GAP = 1.5
const X16 = (i: number) => 17.6 - i * P16 - Math.floor(i / 4) * NIB_GAP
const NIB_X = (k: number) => (X16(4 * (3 - k)) + X16(4 * (3 - k) + 3)) / 2
const SCAN_S = 1.4

const word = (p: Params) => n(p, 'hi') * 256 + n(p, 'lo')
const grouped = (v: number) => binary(v, W16).replace(/(.{4})(?=.)/g, '$1 ')
const byteSlider = (key: string, label: string, initial: number) =>
  ({ kind: 'slider', key, label, min: 0, max: 255, initial, step: 1, format: (v: number) => `${hex(v, 2)} = ${binary(v, 8)}` }) as const

export const hexShorthand: Lesson = {
  id: 'binary-hex-hex-shorthand',
  title: 'Hex shorthand',
  tagline: 'Four bits, one digit',
  formula: (p) => {
    const v = word(p)
    return `${grouped(v)} → ${nibbles(v, 4)
      .map((d) => hex(d, 1))
      .join(' ')} = 0x${hex(v, 4)} = ${v}`
  },
  legend: [
    { color: RING, label: 'Nibble being read: 8 4 2 1 → one hex digit', shape: 'arrow-right' },
    { color: LED_RED, label: 'LED on = bit is 1', shape: 'dot' },
    { color: GREY, label: 'Nibble in decimal, then hex', shape: 'dot' },
  ],
  points: [
    'Sixteen bits are hard to read: 1011111011101111. Split them into groups of four from the right; each group is a nibble.',
    'A nibble has place values 8, 4, 2, 1, so it holds 0 to 15. Hexadecimal (base 16) has exactly one digit per nibble: 0–9, then A = 10 … F = 15.',
    'So 1011 1110 1110 1111 is B E E F: write it 0xBEEF. Converting is a lookup per nibble, no arithmetic on the whole number.',
    'Two hex digits make a byte (00–FF = 0–255). Datasheets, register maps, colours (#FF8800) and memory addresses are all written in hex.',
    'The decimal value still works the same way, just in powers of 16: 0xBEEF = 11·4096 + 14·256 + 14·16 + 15 = 48879.',
  ],
  controls: [byteSlider('hi', 'High byte', 0xbe), byteSlider('lo', 'Low byte', 0xef)],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const row = bitRow(
      scene,
      Array.from({ length: W16 }, (_, i) => X16(i)),
      1,
      Array.from({ length: W16 }, (_, i) => String(2 ** (i % 4))),
      { scale: 0.95 },
    )
    const groups = [0, 1, 2, 3].map((k) => {
      const x = NIB_X(k)
      const w = 4 * P16 - 0.4
      const box = glowBox(scene, [w, 21, 0.2], [x, 0.2, -1.2], RING)
      add(scene, new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: GREY })), [x, -5.5, 0])
      return {
        box,
        dec: pulseLabel(scene, 2, GREY, [x, -6.9, 0], 1),
        digit: pulseLabel(scene, 1, RING, [x, -9.4, 0], 2.4),
        glow: 0,
      }
    })
    const sim = { t: 0, levels: Array<number>(W16).fill(0) }
    return {
      scene,
      view: { center: [-0.2, -0.4, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const v = word(p)
        const bits = toBits(v, W16)
        sim.levels = sim.levels.map((l, i) => l + (bits[i] - l) * ease(dt, 12))
        row.frame(dt, sim.levels)
        sim.t = (sim.t + dt) % (4 * SCAN_S)
        const on = Math.floor(sim.t / SCAN_S)
        const ds = nibbles(v, 4)
        groups.forEach((g, k) => {
          g.glow += ((k === on ? 1 : 0) - g.glow) * ease(dt, 8)
          g.box.m.opacity = 0.16 * g.glow
          g.box.mesh.visible = g.glow > 0.01
          g.dec.show(String(ds[k]))
          g.digit.show(hex(ds[k], 1))
          g.dec.frame(dt)
          g.digit.frame(dt)
        })
      },
      readouts: (p) => {
        const v = word(p)
        return [
          { label: 'Hex', value: `0x${hex(v, 4)}`, tone: 'ok' },
          { label: 'Decimal', value: String(v) },
          { label: 'Binary', value: grouped(v) },
        ]
      },
    }
  },
}

// --- Two's complement: the top bit weighs −8, so the 4-bit patterns form a wheel from −8 to 7. ---

const W4 = 4
const R = 7.2
const WX = -9.5
const STEP_S = 0.6
const HOLD_S = 2.2
/** Angle of pattern u on the wheel: 0000 just right of the top, 1000 just left of the bottom. */
const angleOf = (u: number) => Math.PI / 2 - ((u + 0.5) * 2 * Math.PI) / 2 ** W4
const RANGE4 = signedRange(W4)
const signedSlider = (key: string, label: string, initial: number) =>
  ({ kind: 'slider', key, label, min: RANGE4.min, max: RANGE4.max, initial, step: 1, format: (v: number) => `${v} = ${binary(wrap(v, W4), W4)}` }) as const

const sum3 = (p: Params) => {
  const a = n(p, 'a')
  const b = n(p, 'b')
  return { a, b, ...addWrap(a, b, W4) }
}

export const twosComplement: Lesson = {
  id: 'binary-hex-two-s-complement',
  title: 'Two’s complement',
  tagline: 'Negative numbers and the overflow seam',
  formula: (p) => {
    const f = sum3(p)
    const out = `${binary(wrap(f.a, W4), W4)} + ${binary(wrap(f.b, W4), W4)} = ${binary(f.pattern, W4)} = ${f.value}`
    return `−x = NOT x + 1 · ${f.a} + ${f.b}: ${out}${f.overflow ? ` ≠ ${f.a + f.b}, overflow` : ''}`
  },
  legend: [
    { color: RING, label: 'Pointer: count from A, B steps (− = back)', shape: 'arrow-right' },
    { color: HIGH_V, label: 'Bottom seam 0111 | 1000: signed overflow', shape: 'dot' },
    { color: GREY, label: 'Top seam 1111 | 0000: unsigned wrap', shape: 'dot' },
    { color: LED_RED, label: 'LEDs = pattern; top bit weighs −8', shape: 'dot' },
  ],
  points: [
    'Hardware has no minus sign, only bits. Two’s complement gives the top bit a negative weight: in 4 bits the places are −8, 4, 2, 1, so 1011 = −8 + 2 + 1 = −5.',
    'Patterns starting with 0 are 0 to 7, patterns starting with 1 are −8 to −1. The top bit doubles as the sign bit. 8 bits cover −128 to 127.',
    'To negate: invert every bit and add 1. 5 = 0101 → 1010 → 1011 = −5. Adding 0101 + 1011 gives 1 0000: the carry falls off and 0 is left, as it should.',
    'So the same adder does plus and minus. On the wheel, adding B just walks B steps; crossing the top seam (1111 → 0000) is normal for negative numbers.',
    'Crossing the bottom seam is overflow: 5 + 4 should be 9 but 4 bits stop at 7, so it reads 1001 = −7. Two same-sign inputs with an opposite-sign result is the tell; CPUs set a V flag.',
  ],
  controls: [signedSlider('a', 'A', 5), signedSlider('b', 'B', 4)],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const wheel = add(scene, new THREE.Group(), [WX, 0, 0])
    const ring = add(wheel, new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 96), new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.6 })))
    ring.castShadow = false
    const dots = Array.from({ length: 2 ** W4 }, (_, u) => {
      const a = angleOf(u)
      const at = (r: number): V3 => [Math.cos(a) * r, Math.sin(a) * r, 0]
      const v = toSigned(u, W4)
      const pat = segmentDisplay(W4, 0.5, u >= 8 ? '#ff8a80' : LABEL, true)
      pat.set(binary(u, W4))
      add(wheel, pat.group, at(R - 2.5))
      const val = segmentDisplay(2, 1, v < 0 ? '#ff8a80' : LABEL, true)
      val.set(String(v))
      add(wheel, val.group, at(R + 1.9))
      return add(wheel, new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshStandardMaterial({ color: LABEL })), at(R))
    })
    const seam = (u: number, color: string) => {
      const a = angleOf(u) - Math.PI / 2 ** W4
      const g = add(wheel, new THREE.Group())
      g.rotation.z = a
      return glowBox(g, [3.6, 0.32, 0.3], [R, 0, 0], color)
    }
    const wrapSeam = seam(0, GREY)
    const ofSeam = seam(8, HIGH_V)
    const hand = add(wheel, new THREE.Group())
    const handMat = glowMat(RING, 0.8)
    add(hand, new THREE.Mesh(new THREE.BoxGeometry(R - 3.6, 0.22, 0.22), handMat), [(R - 3.6) / 2, 0, 0.3])
    add(hand, new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), handMat), [R, 0, 0.3])
    add(wheel, new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), handMat), [0, 0, 0.3])

    const xs = Array.from({ length: W4 }, (_, i) => 14.2 - i * 3.2)
    const row = bitRow(scene, xs, -3, placeValues(W4, true).map(String), { scale: 1.3 })
    const value = pulseLabel(scene, 2, RING, [(xs[0] + xs[3]) / 2, -11.6, 0], 2.4)

    const sim = { key: '', t: 0, steps: [0], angle: angleOf(0), levels: Array<number>(W4).fill(0), wrap: 0, of: 0, last: 0 }
    return {
      scene,
      view: { center: [-1.5, 1.4, 0], radius: 67, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const f = sum3(p)
        const key = `${f.a}|${f.b}`
        if (key !== sim.key) Object.assign(sim, { key, t: 0, steps: countSteps(f.a, f.b, W4), last: wrap(f.a, W4) })
        const n1 = sim.steps.length - 1
        sim.t = (sim.t + dt) % (n1 * STEP_S + HOLD_S)
        const k = Math.min(n1, Math.floor(sim.t / STEP_S))
        const u = sim.steps[k]
        if (u !== sim.last) {
          const pair = [u, sim.last].sort((x, y) => x - y).join()
          if (pair === '0,15') sim.wrap = 1
          if (pair === '7,8') sim.of = 1
          sim.last = u
        }
        const holding = k === n1 && n1 > 0
        sim.wrap += -sim.wrap * ease(dt, 1.2)
        sim.of += ((holding && f.overflow ? 1 : 0) - sim.of) * ease(dt, holding ? 6 : 1.2)
        wrapSeam.m.opacity = 0.25 + 0.6 * sim.wrap
        ofSeam.m.opacity = 0.25 + 0.65 * sim.of
        const target = angleOf(wrap(f.a, W4)) - (Math.sign(f.b) * k * 2 * Math.PI) / 2 ** W4
        if (sim.t < dt * 1.5) sim.angle = angleOf(wrap(f.a, W4))
        sim.angle += (target - sim.angle) * ease(dt, 10)
        hand.rotation.z = sim.angle
        dots.forEach((d, i) => d.scale.setScalar(i === u ? 1.6 : 1))
        const bits = toBits(u, W4)
        sim.levels = sim.levels.map((l, i) => l + (bits[i] - l) * ease(dt, 12))
        row.frame(dt, sim.levels)
        value.show(String(toSigned(u, W4)))
        value.frame(dt)
      },
      readouts: (p) => {
        const f = sum3(p)
        return [
          { label: 'A + B', value: `${f.a} + ${f.b < 0 ? `(${f.b})` : f.b} = ${f.value}`, tone: f.overflow ? 'bad' : 'ok' },
          { label: 'Overflow', value: f.overflow ? (f.a + f.b > 0 ? `yes, ${f.a + f.b} > ${RANGE4.max}` : `yes, ${f.a + f.b} < ${RANGE4.min}`) : 'no', tone: f.overflow ? 'warn' : undefined },
          { label: '4-bit range', value: `${RANGE4.min} … ${RANGE4.max}` },
        ]
      },
    }
  },
}
