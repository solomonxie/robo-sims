// Microcontroller views: firmware code lines, in-pin MOSFET symbol, LED load, memory bar map.
import * as THREE from 'three/webgpu'
import { V3, add, box, mat } from '../../models/kit'
import { GREY, HEAT, HIGH_V, LABEL, LED_RED, POWER, glowMat, setGlow } from './colors'
import { flatBox, glowBox } from './shapes'
import { ledLamp, resistorAlong } from './circuit'
import { wire } from './layout'
import { partLetter } from './parts'
import { groundAt } from './symbols'
import { liveLabel } from './text'

export const PIN_COLOR = '#5ad8e6'
export const IDLE = '#3a3e47'
export const ARDUINO = '#9fe0a0'
export const IDF = '#8ab8ff'
export const CODE_LEGEND = { color: ARDUINO, label: 'Code: Arduino green, ESP-IDF blue', shape: 'dot' } as const
/** `codeListing` tints: `//` comments grey, the rest Arduino green (`sketchTint`) or plain (`commentTint`). */
export const sketchTint = (l: string) => (l.trim().startsWith('//') ? GREY : ARDUINO)
export const commentTint = (l: string) => (l.startsWith('//') ? GREY : LABEL)

const isIdf = (l: string) => /\b[a-z][a-z0-9]*_[a-z0-9_]*\(|\b(?!u?int\d+_t\b|size_t\b)[a-z][a-z0-9_]*_t\b|\b(esp|twai|gpio|wifi|ble)_\w+/.test(l)

/** Left-aligned code lines: snake_case calls are ESP-IDF (blue), `//` comments grey, the rest Arduino; indented lines continue the one above. */
export function codeBlock(parent: THREE.Object3D, at: V3, size = 0.72, rows = 3, tint: (l: string) => string = (l) => (l.startsWith('//') ? GREY : isIdf(l) ? IDF : ARDUINO)) {
  const lines = Array.from({ length: rows }, (_, k) => liveLabel(parent, [at[0], at[1] - k * size * 2, at[2]], { size, align: 'left', glow: 0.7 }))
  return (text: string[]) => {
    let color = ARDUINO
    lines.forEach((r, k) => {
      const l = text[k] ?? ''
      if (!l.startsWith(' ')) color = tint(l)
      r.set(l, color)
    })
  }
}

/** Code listing of `rows` lines from `at` down, `gap` apart, with a glowing bar `width` wide behind the current line.
 *  `set(lines, current, tint)`; lines past the end are blank. */
export function codeListing(parent: THREE.Object3D, at: V3, rows: number, width: number, size = 0.32, gap = size * 2.1, barColor = '#ffd56b') {
  const bar = glowBox(parent, [width, gap * 0.92, 0.08], [at[0] + width / 2 - size, at[1], at[2] - 0.2], barColor, 0.22)
  const lines = Array.from({ length: rows }, (_, k) => liveLabel(parent, [at[0], at[1] - k * gap, at[2]], { size, align: 'left', glow: 0.7 }))
  return {
    lines,
    set(text: readonly string[], current: number, tint: (line: string, i: number) => string = () => LABEL) {
      lines.forEach((r, i) => r.set(text[i] ?? '', tint(text[i] ?? '', i)))
      bar.mesh.visible = current >= 0 && current < rows
      bar.mesh.position.y = at[1] - current * gap
    },
  }
}

const PYTHON = '#ffd56b'
const SHELL = '#5ce1a0'
export const ROS_CODE_LEGEND = { color: PYTHON, label: 'Code: rclpy yellow, rclcpp blue, $ ros2 CLI green', shape: 'dot' } as const
/** `codeBlock` tint for ROS 2: `$ ` shell, `#`/`//` comments, `::`/`;`/`->` C++, else Python. */
export const rosTint = (l: string) => (l.startsWith('$') ? SHELL : /^(#|\/\/)/.test(l) ? GREY : /::|;|->/.test(l) ? IDF : PYTHON)

/** MOSFET as a 3D symbol from drain `a` down to `b` (vertical), gate plate and lead on its left, bubble on a P-FET.
 *  `set(on, heat)` lights the channel, tinting it from green to orange with heat 0..1. */
export function fetSymbol(parent: THREE.Object3D, a: V3, b: V3, kind: 'P' | 'N', name: string = kind) {
  const x = a[0]
  const mid = (a[1] + b[1]) / 2
  const ch = 0.55 * Math.abs(a[1] - b[1])
  const m = new THREE.MeshStandardMaterial({ color: '#4a505c', emissive: POWER, emissiveIntensity: 0, roughness: 0.5 })
  wire(parent, [a, [x, mid + ch / 2, 0]], 0.2)
  wire(parent, [[x, mid - ch / 2, 0], b], 0.2)
  add(parent, new THREE.Mesh(new THREE.BoxGeometry(0.5, ch, 0.7), m), [x, mid, 0])
  box(parent, [0.22, ch, 0.7], mat('#7f8590', { rough: 0.4 }), [x - 0.75, mid, 0])
  const gate: V3 = [x - 2.4, mid, 0]
  if (kind === 'P') add(parent, new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.08, 8, 20), mat('#c9ced8')), [x - 1.2, mid, 0])
  wire(parent, [[kind === 'P' ? x - 1.45 : x - 0.86, mid, 0], gate], 0.14)
  partLetter(parent, name, [x + 0.8, mid, 0], 0.75, LABEL, 'left')
  const power = new THREE.Color(POWER)
  const hot = new THREE.Color(HEAT)
  return {
    gate,
    set(on: number, heat = 0) {
      m.emissive.copy(power).lerp(hot, Math.min(1, heat))
      m.emissiveIntensity = 1.3 * on
    },
  }
}

/** LED + series resistor to ground in a group at `at`, fed from local x = −from. */
export function ledLoad(parent: THREE.Object3D, at: V3, from: number, r: number, color = LED_RED) {
  const g = add(parent, new THREE.Group(), at)
  wire(g, [[-from, 0, 0], [-0.35, 0, 0]], 0.2)
  if (r > 0) resistorAlong(g, r, [-from + 0.4, 0, 0], [-1.1, 0, 0], 1.2)
  const lamp = ledLamp(g, color, [0, 0, 0], { scale: 0.8, anodeRight: false })
  wire(g, [[0.4, 0, 0], [0.4, -3.4, 0]], 0.2)
  groundAt(g, [0.4, -3.4, 0])
  return { g, lamp }
}

/** Memory bar rows from `at` (left edge), `w` = a row's capacity; `set(row, capacity, segments [bytes, colour][], text)`
 *  stacks the segments; past capacity the bar is cut and the end glows red. */
export function memoryMap(parent: THREE.Object3D, at: V3, w: number, rows: readonly string[], { row = 0.7, size = 0.28, segs = 3 } = {}) {
  const items = rows.map((name, j) => {
    const y = at[1] - j * row
    flatBox(parent, [w, row * 0.6, 0.05], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [at[0] + w / 2, y, 0])
    liveLabel(parent, [at[0] - 0.2, y, 0.2], { size, align: 'right' }).set(name, GREY)
    const parts = Array.from({ length: segs }, () => {
      const m = glowMat(POWER, 0.8)
      return { m, box: flatBox(parent, [1, row * 0.46, 0.08], m, [at[0], y, 0.06]) }
    })
    const over = flatBox(parent, [0.12, row * 0.7, 0.1], glowMat(HIGH_V, 1.4), [at[0] + w, y, 0.08])
    const value = liveLabel(parent, [at[0] + w + 0.25, y, 0.2], { size: size * 0.95, align: 'left' })
    return { parts, over, value }
  })
  return {
    set(j: number, capacity: number, segments: readonly [number, string][], text: string, color = LABEL) {
      const R = items[j]
      let x = 0
      R.parts.forEach((p, i) => {
        const [bytes, c] = segments[i] ?? [0, POWER]
        const len = Math.max(0, Math.min(w - x, (bytes / capacity) * w))
        p.box.visible = len > 1e-3
        p.box.scale.x = Math.max(1e-3, len - (len > 0.06 ? 0.04 : 0))
        p.box.position.x = at[0] + x + len / 2
        setGlow(p.m, c, 0.8)
        x += len
      })
      R.over.visible = segments.reduce((s, [b]) => s + b, 0) > capacity
      R.value.set(text, color)
    },
  }
}
