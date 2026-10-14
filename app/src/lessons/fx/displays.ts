// Readouts: seven-segment digits, multimeter, oscilloscope, phasor.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { GREY, HIGH_V, RING, glowMat } from './colors'
import { UP } from './util'

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
  A: 'abcefg', B: 'cdefg', C: 'adef', P: 'abefg', n: 'ceg', S: 'afgcd', G: 'afedc', d: 'bcdeg',
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

/** Handheld multimeter facing +z, on the V⎓ range (Ω with `ohms`); jacks at the bottom (red V, black COM). */
export function multimeter({ ohms = false } = {}) {
  const group = new THREE.Group()
  box(group, [8.4, 12.4, 1.6], mat('#f2c230', { rough: 0.7 }), [0, 0, 0])
  box(group, [7.2, 11.2, 0.3], mat('#2a2c32', { rough: 0.5 }), [0, 0, 0.85])
  box(group, [6.2, 2.9, 0.2], mat('#a9b89a', { emissive: '#3a4434', rough: 0.4 }), [0, 3.7, 1.05])
  const display = segmentDisplay(4, 1.9)
  display.group.position.set(0.1, 3.7, 1.2)
  group.add(display.group)
  const dial = cylinder(group, 1.9, 0.5, mat('#3a3d45', { rough: 0.5 }), [0, -0.6, 1.2], 'z', 40)
  dial.castShadow = true
  const dc = ((ohms ? 7 : 1) / 8) * Math.PI * 2
  box(group, [0.3, 1.6, 0.2], mat('#f4f4f4', { emissive: '#555555' }), [Math.sin(dc) * 0.8, -0.6 + Math.cos(dc) * 0.8, 1.5]).rotation.z = -dc
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    box(group, [0.12, 0.45, 0.1], mat(a === dc ? RING : '#8a8f99', { emissive: a === dc ? '#aa8800' : '#000000' }), [
      Math.sin(a) * 2.6,
      -0.6 + Math.cos(a) * 2.6,
      1.05,
    ]).rotation.z = -a
  }
  const red: V3 = [1.7, -4.3, 1.1]
  const black: V3 = [-1.7, -4.3, 1.1]
  for (const [at, color] of [[red, '#d23b3b'], [black, '#202226']] as const) {
    cylinder(group, 0.6, 0.3, mat(color, { rough: 0.4 }), at, 'z', 24)
    cylinder(group, 0.25, 0.32, mat('#111'), [at[0], at[1], at[2] + 0.02], 'z', 16)
  }
  return { group, display, red, black }
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

const SCREEN_Z = 0.25

/** Oscilloscope screen facing +z, centred on the origin: `width` × `height` with a grid of `divs` and brighter centre lines.
 *  `zeroAt` (fraction up from the bottom) picks the bright 0 line. `trace(color)` adds a line, `level(color)` a dashed marker;
 *  y is in scene units from the centre, clipped to the screen. */
export function scope(
  parent: THREE.Object3D,
  width: number,
  height: number,
  { divs = [10, 8], zeroAt = 0.5 }: { divs?: [number, number]; zeroAt?: number } = {},
) {
  const group = add(parent, new THREE.Group())
  box(group, [width + 1.2, height + 1.2, 0.8], mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.55])
  box(group, [width, height, 0.1], mat('#0b1013', { emissive: '#050a0a', rough: 0.3 }), [0, 0, -0.1])
  const grid = mat('#22302c', { emissive: '#0c1612' })
  const axis = mat('#46645a', { emissive: '#1a2a24' })
  const [nx, ny] = divs
  for (let k = 0; k <= nx; k++) {
    const x = -width / 2 + (k / nx) * width
    rod(group, [x, -height / 2, 0], [x, height / 2, 0], k === nx / 2 ? 0.06 : 0.035, k === nx / 2 ? axis : grid)
  }
  for (let k = 0; k <= ny; k++) {
    const y = -height / 2 + (k / ny) * height
    const zero = Math.abs(k / ny - zeroAt) < 1e-6
    rod(group, [-width / 2, y, zero ? 0.02 : 0], [width / 2, y, zero ? 0.02 : 0], zero ? 0.06 : 0.035, zero ? axis : grid)
  }
  const clip = (y: number) => Math.min(height / 2, Math.max(-height / 2, y))
  const xAt = (u: number) => -width / 2 + u * width

  const trace = (color: string, { samples = 160, radius = 0.13 } = {}) => {
    const material = glowMat(color, 0.9)
    const segs = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 8), material, samples - 1)
    const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 8, 6), material, samples)
    const head = mesh(new THREE.SphereGeometry(radius * 2.6, 16, 12), glowMat(color, 1.2))
    const line = add(group, new THREE.Group())
    for (const o of [segs, joints, head]) {
      o.frustumCulled = false
      o.castShadow = false
      line.add(o)
    }
    const pts = Array.from({ length: samples }, () => new THREE.Vector3())
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const d = new THREE.Vector3()
    const mid = new THREE.Vector3()
    const sc = new THREE.Vector3()
    /** Draws y(u) for u = 0 (left) … 1 (right); the head dot sits at `headU` (null hides it). */
    const draw = (y: (u: number) => number, headU: number | null = 1) => {
      pts.forEach((p, i) => p.set(xAt(i / (samples - 1)), clip(y(i / (samples - 1))), SCREEN_Z))
      for (let i = 0; i < samples - 1; i++) {
        d.subVectors(pts[i + 1], pts[i])
        const len = d.length()
        q.setFromUnitVectors(UP, d.divideScalar(len || 1))
        segs.setMatrixAt(i, m.compose(mid.addVectors(pts[i], pts[i + 1]).multiplyScalar(0.5), q, sc.set(1, len, 1)))
      }
      pts.forEach((p, i) => joints.setMatrixAt(i, m.makeTranslation(p)))
      segs.instanceMatrix.needsUpdate = joints.instanceMatrix.needsUpdate = true
      head.visible = headU !== null
      if (headU !== null) head.position.set(xAt(headU), clip(y(headU)), SCREEN_Z)
    }
    return {
      group: line,
      material,
      draw,
      /** The last `window` seconds of `signal(t)` up to `now`, newest at the right (or left) edge, so it scrolls. */
      scroll(signal: (t: number) => number, now: number, window: number, newest: 'right' | 'left' = 'right') {
        const r = newest === 'right'
        draw((u) => signal(now - (r ? 1 - u : u) * window), r ? 1 : 0)
      },
    }
  }

  const level = (color: string, dash = 0.55) => {
    const g = add(group, new THREE.Group())
    const material = glowMat(color, 0.7)
    const geo = new THREE.BoxGeometry(dash, 0.09, 0.09)
    for (let x = -width / 2 + dash / 2; x < width / 2; x += dash * 2) add(g, mesh(geo, material), [x, 0, SCREEN_Z - 0.05]).castShadow = false
    return {
      group: g,
      set(y: number) {
        g.visible = Math.abs(y) <= height / 2
        g.position.y = y
      },
    }
  }

  return { group, width, height, xAt, trace, level }
}

type Plot = ReturnType<typeof scope>

/** Grey tick numbers: under the screen at x fractions, right of it at y fractions. */
export function ticks(plot: Plot, x: [number, string][], y: [number, string][]) {
  const label = (text: string, at: V3) => {
    const d = segmentDisplay(text.replace('.', '').length, 0.8, GREY, true)
    d.set(text)
    add(plot.group, d.group, at)
  }
  for (const [u, s] of x) label(s, [plot.xAt(u), -plot.height / 2 - 1.1, 0])
  for (const [v, s] of y) label(s, [plot.width / 2 + 1.5, v * plot.height - plot.height / 2, 0])
}

/** A plot screen at `at` with zero at the bottom and a glowing operating-point dot; `y(f)` maps 0..1 of full scale. */
export function ivScreen(scene: THREE.Object3D, at: V3, w: number, h: number, divs: [number, number]) {
  const plot = scope(scene, w, h, { divs, zeroAt: 0 })
  plot.group.position.set(...at)
  const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat('#ffffff', 1.4)))
  return { plot, dot, y: (f: number) => f * h - h / 2 }
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
