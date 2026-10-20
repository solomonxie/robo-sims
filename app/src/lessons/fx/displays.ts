// Readouts: seven-segment digits, bar meter, count bars, loss waterfall, multimeter and probes, phasor, clock face, USB logic analyser.
import * as THREE from 'three/webgpu'
import type { DmmDial } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { GREY, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { cableRun } from './layout'
import { partLetter } from './parts'
import { flatBox } from './shapes'
import { label, liveLabel } from './text'

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
  A: 'abcefg', B: 'cdefg', C: 'adef', P: 'abefg', n: 'ceg', S: 'afgcd', G: 'afedc', d: 'bcdeg', E: 'adefg', F: 'aefg', Y: 'bcdfg', o: 'cdeg',
  D: 'bcdeg', q: 'abcfg', r: 'eg', L: 'def', t: 'defg', H: 'bcefg', U: 'bcdef', c: 'deg',
  u: 'cde', '/': 'z',
}

/** Seven-segment readout of `cells` digits facing +z, centred on the origin; `set("-3.00")`. LCD-dark unless `glow`.
 *  Right-aligned, with "1" drawn narrow so numbers read without gaps. */
export function segmentDisplay(cells: number, height = 1.6, color = '#16181c', glow = false) {
  const group = new THREE.Group()
  const w = height * 0.5
  const t = height * 0.11
  const gap = height * 0.32
  const right = ((cells - 1) / 2) * (w + gap) + w / 2
  const on = glow ? glowMat(color, 0.9) : mat(color)
  const h = height / 2
  const spots: Record<string, [number, number, boolean]> = {
    a: [0, h, true], g: [0, 0, true], d: [0, -h, true],
    f: [-w / 2, h / 2, false], b: [w / 2, h / 2, false], e: [-w / 2, -h / 2, false], c: [w / 2, -h / 2, false],
  }
  const digits = Array.from({ length: cells }, () => {
    const slot = add(group, new THREE.Group())
    const seg = Object.fromEntries(
      Object.entries(spots).map(([k, [sx, sy, flat]]) => [k, box(slot, flat ? [w, t, t] : [t, h, t], on, [sx, sy, 0])]),
    )
    seg.z = box(slot, [t, Math.hypot(w, height), t], on)
    seg.z.rotation.z = -Math.atan2(w, height)
    const dot = box(group, [t * 1.2, t * 1.2, t], on, [0, -h, 0])
    return { slot, seg, dot }
  })
  const display = {
    group,
    set(text: string) {
      const chars: { ch: string; dot: boolean }[] = []
      for (const ch of text) {
        if (ch === '.' && chars.length) chars[chars.length - 1].dot = true
        else chars.push({ ch, dot: false })
      }
      while (chars.length < cells) chars.unshift({ ch: ' ', dot: false })
      const width = (ch: string) => (ch === '1' ? t : w)
      let edge = cells === 1 ? width(chars[0].ch) / 2 : right
      for (let i = cells - 1; i >= 0; i--) {
        const { slot, seg, dot } = digits[i]
        const { ch } = chars[i]
        const lit = SEGMENTS[ch] ?? ''
        for (const k in seg) seg[k].visible = lit.includes(k)
        slot.position.x = edge - width(ch) / 2 - (ch === '1' ? w / 2 : 0)
        dot.visible = chars[i].dot
        dot.position.x = edge + gap / 2
        edge -= width(ch) + gap
      }
    },
  }
  display.set('8'.repeat(cells))
  return display
}

export type DialUnit = 'V' | 'A' | 'Ω' | '°C'
/** Dial stops (of 8, clockwise from the top) per range. */
const DIAL_STOPS: Record<DialUnit, number> = { V: 1, A: 3, '°C': 5, 'Ω': 7 }
/** Full dial (`full`): stop → label, up the left side and down the right (clear of the display). */
const FULL_STOPS: Record<DmmDial, string> = { vdc: 'V', vac: 'V~', mv: 'mV', ohm: 'Ω', beep: ')))', diode: '>|', ma: 'mA', amp: 'A' }
const FULL_KEYS = Object.keys(FULL_STOPS) as DmmDial[]
/** Full meter's sockets, left to right. */
export type MeterJack = 'a10' | 'ma' | 'com' | 'v'
const JACK_X: Record<MeterJack, number> = { a10: -2.85, ma: -0.95, com: 0.95, v: 2.85 }
const JACK_TEXT: Record<MeterJack, string> = { a10: '10A', ma: 'mA', com: 'COM', v: 'VΩ' }

/** Handheld multimeter facing +z, on the V⎓ range (Ω with `ohms`); `dial(unit)` turns it to V / A / Ω / °C. Jacks at the
 *  bottom (red V, black COM). `full`: eight stops (`dial` also takes a `DmmDial`: V⎓ V~ mV Ω ))) diode mA A) and four
 *  sockets 10A / mA / COM / VΩ (`jacks`). */
export function multimeter({ ohms = false, full = false } = {}) {
  const group = new THREE.Group()
  box(group, [8.4, 12.4, 1.6], mat('#f2c230', { rough: 0.7 }), [0, 0, 0])
  box(group, [7.2, 11.2, 0.3], mat('#2a2c32', { rough: 0.5 }), [0, 0, 0.85])
  box(group, [6.2, 2.9, 0.2], mat('#a9b89a', { emissive: '#3a4434', rough: 0.4 }), [0, 3.7, 1.05])
  const display = segmentDisplay(4, 1.9)
  display.group.position.set(0.1, 3.7, 1.2)
  group.add(display.group)
  const knobBase = cylinder(group, 1.9, 0.5, mat('#3a3d45', { rough: 0.5 }), [0, -0.6, 1.2], 'z', 40)
  knobBase.castShadow = true
  const knob = add(group, new THREE.Group(), [0, -0.6, 1.5])
  box(knob, [0.3, 1.6, 0.2], mat('#f4f4f4', { emissive: '#555555' }), [0, 0.8, 0])
  const angles = full ? [-140, -110, -80, -50, 50, 80, 110, 140].map((d) => (d * Math.PI) / 180) : Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2)
  const ticks = angles.map((a) => {
    const m = new THREE.MeshStandardMaterial({ color: '#8a8f99', emissive: '#000000' })
    box(group, [0.12, 0.45, 0.1], m, [Math.sin(a) * 2.6, -0.6 + Math.cos(a) * 2.6, 1.05]).rotation.z = -a
    return m
  })
  const labels: [string, number][] = full ? FULL_KEYS.map((k, i) => [FULL_STOPS[k], angles[i]]) : Object.entries(DIAL_STOPS).map(([u, i]) => [u, angles[i]])
  const lr = full ? 3.05 : 3.25
  for (const [text, a] of labels) add(group, label(text, { size: full ? 0.46 : 0.55, color: '#c9ced8' }), [Math.sin(a) * lr, -0.6 + Math.cos(a) * lr, 1.05])
  let stop = -1
  const dial = (unit: DialUnit | DmmDial) => {
    const i = full ? FULL_KEYS.indexOf(unit === 'V' ? 'vdc' : unit === 'A' ? 'amp' : unit === 'Ω' ? 'ohm' : (unit as DmmDial)) : DIAL_STOPS[unit as DialUnit] ?? 1
    if (i === stop || i < 0) return
    stop = i
    knob.rotation.z = -angles[i]
    ticks.forEach((m, k) => {
      m.color.set(k === i ? RING : '#8a8f99')
      m.emissive.set(k === i ? '#aa8800' : '#000000')
    })
  }
  dial(ohms ? 'Ω' : 'V')
  const red: V3 = full ? [JACK_X.v, -4.6, 1.1] : [1.7, -4.3, 1.1]
  const black: V3 = full ? [JACK_X.com, -4.6, 1.1] : [-1.7, -4.3, 1.1]
  const jacks = Object.fromEntries((Object.keys(JACK_X) as MeterJack[]).map((j) => [j, [JACK_X[j], -4.6, 1.1] as V3])) as Record<MeterJack, V3>
  const sockets: [V3, string][] = full ? (Object.keys(JACK_X) as MeterJack[]).map((j) => [jacks[j], j === 'com' ? '#202226' : '#d23b3b']) : [[red, '#d23b3b'], [black, '#202226']]
  for (const [at, color] of sockets) {
    cylinder(group, full ? 0.55 : 0.6, 0.3, mat(color, { rough: 0.4 }), at, 'z', 24)
    cylinder(group, 0.25, 0.32, mat('#111'), [at[0], at[1], at[2] + 0.02], 'z', 16)
  }
  if (full) for (const j of Object.keys(JACK_X) as MeterJack[]) add(group, label(JACK_TEXT[j], { size: 0.38, color: '#c9ced8' }), [JACK_X[j], -5.55, 1.05])
  return { group, display, red, black, jacks, dial }
}

/** Test probe touching `tip`, handle pointing along `dir`; returns where its cable leaves. */
export function probe(parent: THREE.Object3D, tip: V3, dir: V3, color: string): V3 {
  const d = new THREE.Vector3(...dir).normalize()
  const at = (k: number): V3 => [tip[0] + d.x * k, tip[1] + d.y * k, tip[2] + d.z * k]
  rod(parent, tip, at(1.2), 0.07, STEEL())
  rod(parent, at(1.2), at(1.6), 0.4, mat(color, { rough: 0.5 }), 16)
  rod(parent, at(1.6), at(4.6), 0.28, mat(color, { rough: 0.5 }), 16)
  return at(4.6)
}

/** A glowing segment number at `at` that swells briefly whenever its text changes. */
export function pulseLabel(parent: THREE.Object3D, cells: number, color: string, at: V3, height = 1.6) {
  const d = segmentDisplay(cells, height, color, true)
  d.group.position.set(...at)
  parent.add(d.group)
  let text = ''
  let pulse = 0
  return {
    display: d,
    show(next: string) {
      if (next === text) return
      if (text) pulse = 1
      text = next
      d.set(next)
    },
    frame(dt: number) {
      pulse = Math.max(0, pulse - dt * 3)
      d.group.scale.setScalar(1 + 0.3 * pulse * pulse)
    },
  }
}

/** Rotating phasor facing +z: a faint ring of `radius` with cross-hairs and an arm to a glowing tip; `set(angle)` turns it
 *  (0 = +x, counter-clockwise). Returns where the tip is. */
export function phasor(parent: THREE.Object3D, radius: number, color = HIGH_V) {
  const group = add(parent, new THREE.Group())
  const faint = mat('#5a606c', { emissive: '#22252b' })
  add(group, mesh(new THREE.TorusGeometry(radius, 0.07, 8, 96), faint))
  rod(group, [-radius - 0.6, 0, 0], [radius + 0.6, 0, 0], 0.04, faint)
  rod(group, [0, -radius - 0.6, 0], [0, radius + 0.6, 0], 0.04, faint)
  const arm = add(group, new THREE.Group())
  rod(arm, [0, 0, 0.1], [radius, 0, 0.1], 0.13, glowMat(color, 0.6))
  add(arm, mesh(new THREE.SphereGeometry(0.3, 16, 12), STEEL()), [0, 0, 0.1])
  add(arm, mesh(new THREE.SphereGeometry(0.45, 20, 14), glowMat(color, 1.2)), [radius, 0, 0.1])
  return {
    group,
    set(angle: number): V3 {
      arm.rotation.z = angle
      return [radius * Math.cos(angle), radius * Math.sin(angle), 0.1]
    },
  }
}

/** Clock face facing +z at `at`: 12 ticks, bright hands in `color` and grey ghost hands for the true time.
 *  `set(shown, truth)` takes seconds after 12:00:00 for each. */
export function clockFace(parent: THREE.Object3D, at: V3, r: number, color: string) {
  const group = add(parent, new THREE.Group(), at)
  cylinder(group, r + 0.35, 0.5, mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.3], 'z', 64)
  cylinder(group, r, 0.1, mat('#e9e6dc', { rough: 0.7 }), [0, 0, 0], 'z', 64)
  const ink = mat('#2b2d33')
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * 2 * Math.PI
    const big = k % 5 === 0
    const tick = box(group, [big ? 0.16 : 0.06, big ? 0.7 : 0.3, 0.05], ink, [Math.sin(a) * (r - (big ? 0.5 : 0.3)), Math.cos(a) * (r - (big ? 0.5 : 0.3)), 0.08])
    tick.rotation.z = -a
  }
  const hand = (len: number, width: number, material: THREE.Material, z: number) => {
    const g = add(group, new THREE.Group(), [0, 0, z])
    box(g, [width, len + 0.4, 0.06], material, [0, len / 2 - 0.2, 0]).castShadow = false
    return g
  }
  const ghost = new THREE.MeshStandardMaterial({ color: GREY, transparent: true, opacity: 0.55, depthWrite: false })
  const bright = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 })
  const dark = mat('#1d1f24')
  const sets = [
    [hand(0.5 * r, 0.32, ghost, 0.14), hand(0.78 * r, 0.22, ghost, 0.18), hand(0.9 * r, 0.1, ghost, 0.22)],
    [hand(0.5 * r, 0.3, dark, 0.26), hand(0.78 * r, 0.2, dark, 0.3), hand(0.9 * r, 0.09, bright, 0.34)],
  ]
  cylinder(group, 0.22, 0.5, bright, [0, 0, 0.3], 'z', 20)
  const turn = (hands: THREE.Group[], s: number) => {
    const [h, m, sec] = hands
    h.rotation.z = (-2 * Math.PI * s) / 43200
    m.rotation.z = (-2 * Math.PI * s) / 3600
    sec.rotation.z = (-2 * Math.PI * s) / 60
  }
  return {
    group,
    set(shown: number, truth: number) {
      turn(sets[1], shown)
      turn(sets[0], truth)
    },
  }
}

/** Cheap 8-channel USB logic analyser (24 MHz class) at `at`, header up: GND lead to `ground`, one lead per `leads` entry,
 *  each ending in a grabber clip. Returns the USB socket point. */
export function usbAnalyzer(parent: THREE.Object3D, at: V3, leads: { color: string; to: V3 }[], ground: V3): V3 {
  const g = add(parent, new THREE.Group(), at)
  box(g, [6, 3.2, 1.4], mat('#2f3440', { metal: 0.3, rough: 0.45 }), [0, 0, 0])
  box(g, [5.6, 2.8, 0.05], mat('#1d2027', { rough: 0.6 }), [0, 0, 0.72])
  for (const [s, y, size] of [['LOGIC', 0.55, 0.55], ['24MHZ 8CH', -0.45, 0.4]] as const) {
    add(g, label(s, { size, color: LABEL, glow: 0.4 }), [0, y, 0.78]).castShadow = false
  }
  box(g, [5.4, 0.6, 0.9], mat('#141416', { rough: 0.8 }), [0, 1.9, 0])
  box(g, [1.3, 0.5, 0.7], mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, -1.85, 0])
  const all = [{ color: '#1c1c1f', to: ground }, ...leads]
  all.forEach((l, i) => {
    const x = at[0] - 2.25 + i * 0.5
    const from: V3 = [x, at[1] + 2.2, at[2]]
    const [tx, ty, tz] = l.to
    cableRun(parent, [from, [x, from[1] + 0.8, from[2] + 0.4 + i * 0.12], [tx, ty - 1.4, tz + 0.5], [tx, ty - 0.5, tz]], l.color, 0.09)
    cylinder(parent, 0.16, 0.9, mat(l.color, { rough: 0.5 }), [tx, ty - 0.45, tz], 'y', 12)
  })
  return [at[0], at[1] - 2.1, at[2]]
}

/** Horizontal bar meter from `at` (left end), `w` long for 0…`max`; `marks` are [value, text, colour]. `set(v, text, colour)`. */
export function meterBar(parent: THREE.Object3D, at: V3, w: number, max: number, marks: [number, string, string][], caption: string) {
  box(parent, [w + 0.4, 1.6, 0.6], mat('#1c1e24', { rough: 0.6 }), [at[0] + w / 2, at[1], -0.4])
  const fill = add(parent, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.5), glowMat(POWER, 0.8)), at)
  for (const [v, text, color] of marks) {
    const x = at[0] + (v / max) * w
    box(parent, [0.14, 2.2, 0.7], glowMat(color, 0.6), [x, at[1], 0])
    partLetter(parent, text, [x, at[1] + 1.7, 0], 0.55, color)
  }
  partLetter(parent, caption, [at[0] - 1, at[1], 0], 0.7, LABEL, 'right')
  const value = liveLabel(parent, [at[0] + w + 1, at[1], 0], { size: 0.8, align: 'left' })
  const m = fill.material as THREE.MeshStandardMaterial
  return (v: number, text: string, color: string) => {
    const k = Math.max(0.002, Math.min(1.02, v / max))
    fill.scale.set(k * w, 1, 1)
    fill.position.x = at[0] + (k * w) / 2
    m.color.set(color)
    m.emissive.set(color)
    value.set(text, color)
  }
}

/** Labelled horizontal count bars from `at` (left edge), length ∝ value / max; `set(values, texts?, colors?)`. */
export function countBars(parent: THREE.Object3D, at: V3, labels: readonly string[], w = 5, { row = 0.62, size = 0.28, color = POWER } = {}) {
  const bars = labels.map((text, j) => {
    const y = at[1] - j * row
    flatBox(parent, [w, row * 0.55, 0.05], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [at[0] + w / 2, y, 0])
    const name = liveLabel(parent, [at[0] - 0.2, y, 0.2], { size, align: 'right' })
    name.set(text, GREY)
    const m = glowMat(color, 0.9)
    const fill = flatBox(parent, [1, row * 0.42, 0.08], m, [at[0], y, 0.06])
    const value = liveLabel(parent, [at[0] + w + 0.2, y, 0.2], { size: size * 0.95, align: 'left' })
    return { name, m, fill, value }
  })
  return {
    /** Bars ∝ value ÷ `full` (default: the largest value). */
    set(values: readonly number[], texts?: readonly string[], colors?: readonly string[], full?: number) {
      const max = full ?? Math.max(1e-9, ...values.filter(Number.isFinite))
      bars.forEach((b, j) => {
        const v = Number.isFinite(values[j]) ? values[j] : 0
        const len = Math.max(1e-3, (v / max) * w)
        b.fill.scale.x = len
        b.fill.position.x = at[0] + len / 2
        const c = colors?.[j] ?? color
        setGlow(b.m, c, 0.9)
        b.value.set(texts?.[j] ?? `${Math.round(v)}`, c)
      })
    },
    rename: (j: number, text: string, c = GREY) => bars[j].name.set(text, c),
  }
}

/** Waterfall of `labels.length` columns from `at` (bottom left), `w` wide, `h` tall: each column a kept part with a
 *  lost part stacked on top, heights ÷ `full`; `set(kept, lost, texts, full, colors?)`, text above each column. */
export function lossWaterfall(parent: THREE.Object3D, at: V3, labels: readonly string[], w: number, h: number, { size = 0.28, keep = POWER, lose = HIGH_V } = {}) {
  const col = w / labels.length
  flatBox(parent, [w, 0.06, 0.05], new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.8 }), [at[0] + w / 2, at[1] - 0.03, 0])
  const cols = labels.map((text, j) => {
    const x = at[0] + col * (j + 0.5)
    const name = liveLabel(parent, [x, at[1] - 0.5, 0.2], { size })
    name.set(text, GREY)
    const parts = [keep, lose].map((c) => {
      const m = glowMat(c, 0.9)
      return { m, box: flatBox(parent, [col * 0.62, 1, 0.08], m, [x, at[1], 0.06]) }
    })
    return { x, name, parts, value: liveLabel(parent, [x, at[1], 0.2], { size: size * 0.95 }) }
  })
  return {
    set(kept: readonly number[], lost: readonly number[], texts: readonly string[], full: number, colors?: readonly (readonly [string, string])[]) {
      cols.forEach((c, j) => {
        const hs = [kept[j], lost[j]].map((v) => Math.max(1e-3, (Math.max(0, v) / full) * h))
        let y = at[1]
        c.parts.forEach((p, i) => {
          p.box.scale.y = hs[i]
          p.box.position.y = y + hs[i] / 2
          y += hs[i]
          setGlow(p.m, colors?.[j]?.[i] ?? (i ? lose : keep), 0.9)
        })
        c.value.group.position.y = y + 0.45
        c.value.set(texts[j], colors?.[j]?.[1] ?? LABEL)
      })
    },
    rename: (j: number, text: string, c = GREY) => cols[j].name.set(text, c),
  }
}
