// Microcontroller views: firmware code lines, in-pin MOSFET symbol, LED load.
import * as THREE from 'three/webgpu'
import { V3, add, box, mat } from '../../models/kit'
import { GREY, HEAT, LABEL, LED_RED, POWER } from './colors'
import { ledLamp, resistorAlong } from './circuit'
import { wire } from './layout'
import { partLetter } from './parts'
import { groundAt } from './symbols'
import { liveLabel } from './text'

export const ARDUINO = '#9fe0a0'
export const IDF = '#8ab8ff'
export const CODE_LEGEND = { color: ARDUINO, label: 'Code: Arduino green, ESP-IDF blue', shape: 'dot' } as const

const isIdf = (l: string) => /\b[a-z][a-z0-9]*_[a-z0-9_]*\(/.test(l)

/** Left-aligned code lines: snake_case calls are ESP-IDF (blue), `//` comments grey, the rest Arduino; indented lines continue the one above. */
export function codeBlock(parent: THREE.Object3D, at: V3, size = 0.72, rows = 3) {
  const lines = Array.from({ length: rows }, (_, k) => liveLabel(parent, [at[0], at[1] - k * size * 2, at[2]], { size, align: 'left', glow: 0.7 }))
  const tint = (l: string) => (l.startsWith('//') ? GREY : isIdf(l) ? IDF : ARDUINO)
  return (text: string[]) => {
    let color = ARDUINO
    lines.forEach((r, k) => {
      const l = text[k] ?? ''
      if (!l.startsWith(' ')) color = tint(l)
      r.set(l, color)
    })
  }
}

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
