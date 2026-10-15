// Plot screens: oscilloscope (bare and benchtop), I–V plot, logic-analyser capture.
import * as THREE from 'three/webgpu'
import { hex } from '../../core/numbers'
import { I2cEvent } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { CLK_COLOR, DATA_COLOR, GREY, HIGH_V, POWER, glowMat } from './colors'
import { segmentDisplay } from './displays'
import { liveLabel, label } from './text'
import { UP } from './util'

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
export function ticks(plot: Plot, x: [number, string][], y: [number, string][], size = 0.8) {
  const tick = (text: string, at: V3) => {
    const d = segmentDisplay(text.replace('.', '').length, size, GREY, true)
    d.set(text)
    add(plot.group, d.group, at)
  }
  for (const [u, s] of x) tick(s, [plot.xAt(u), -plot.height / 2 - 0.3 - size, 0])
  for (const [v, s] of y) tick(s, [plot.width / 2 + 0.7 + size, v * plot.height - plot.height / 2, 0])
}

/** A plot screen at `at` with zero at the bottom and a glowing operating-point dot; `y(f)` maps 0..1 of full scale. */
export function ivScreen(scene: THREE.Object3D, at: V3, w: number, h: number, divs: [number, number]) {
  const plot = scope(scene, w, h, { divs, zeroAt: 0 })
  plot.group.position.set(...at)
  const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat('#ffffff', 1.4)))
  return { plot, dot, y: (f: number) => f * h - h / 2 }
}

/** Benchtop DSO facing +z, origin at the screen centre: a `scope()` screen of `w` × `h`, status line above it,
 *  VOLTS/DIV, TIME/DIV and trigger LEVEL knobs (`knobs.*.set(angle)`), a TRIG'D lamp and BNC inputs (`ch1`, `ch2`). */
export function benchScope(parent: THREE.Object3D, w = 12.5, h = 10, opts: { divs?: [number, number]; zeroAt?: number } = {}) {
  const group = add(parent, new THREE.Group())
  const x0 = -w / 2 - 1.1
  const x1 = w / 2 + 7.6
  const top = h / 2 + 2
  const bottom = -h / 2 - 1.3
  const cx = (x0 + x1) / 2
  const cy = (top + bottom) / 2
  box(group, [x1 - x0 + 0.6, top - bottom + 0.6, 5], mat('#c9cdd4', { rough: 0.6 }), [cx, cy, -3.5])
  box(group, [x1 - x0, top - bottom, 0.4], mat('#2b2e35', { rough: 0.55 }), [cx, cy, -0.75])
  for (const fx of [x0 + 1.2, x1 - 1.2]) box(group, [1.6, 0.5, 4], mat('#1c1c1f', { rough: 0.8 }), [fx, bottom - 0.5, -3])
  const screen = scope(group, w, h, opts)
  screen.group.position.z = -0.1
  const status = [
    liveLabel(group, [-w / 2, h / 2 + 0.9, 0], { size: 0.48, align: 'left' }),
    liveLabel(group, [-w / 2 + w * 0.36, h / 2 + 0.9, 0], { size: 0.48, align: 'left' }),
    liveLabel(group, [w / 2, h / 2 + 0.9, 0], { size: 0.48, align: 'right' }),
  ]
  const ka = w / 2 + 2.7
  const kb = w / 2 + 5.6
  const caption = (s: string, at: V3, color = '#d7dbe2', size = 0.38) => {
    const m = add(group, label(s, { size, color, glow: 0.4 }), at)
    m.castShadow = false
    return m
  }
  caption('DSO 1102', [(ka + kb) / 2, top - 0.6, 0], '#e8e8e8', 0.42)
  const knob = (x: number, y: number, r: number, name: string, ring?: string) => {
    const g = add(group, new THREE.Group(), [x, y, -0.5])
    if (ring) cylinder(g, r + 0.25, 0.15, glowMat(ring, 0.5), [0, 0, 0], 'z', 40)
    cylinder(g, r, 0.9, mat('#1e2024', { rough: 0.45 }), [0, 0, 0.45], 'z', 32)
    cylinder(g, r * 0.8, 0.12, mat('#3a3d45', { metal: 0.3, rough: 0.35 }), [0, 0, 0.95], 'z', 32)
    const dial = add(g, new THREE.Group(), [0, 0, 1])
    box(dial, [0.14, r * 0.6, 0.08], mat('#f4f4f4', { emissive: '#666666' }), [0, r * 0.45, 0.04])
    caption(name, [x, y - r - 0.55, 0])
    return { group: g, set: (angle: number) => (dial.rotation.z = -angle) }
  }
  const yBnc = -h / 2 + 0.3
  const yBtn = yBnc + 1.55
  const y1 = top - 2.5
  const y2 = (y1 + yBtn - 0.625) / 2
  const knobs = {
    volts: knob(ka, y1, 1.05, 'VOLTS/DIV', '#ffd84d'),
    pos: knob(kb, y1, 0.6, 'POSITION'),
    time: knob(ka, y2, 1, 'TIME/DIV'),
    level: knob(kb, y2, 0.75, 'TRIG LVL'),
  }
  const lampMat = glowMat(GREY, 0.2)
  add(group, mesh(new THREE.SphereGeometry(0.22, 12, 8), lampMat), [kb + 1.4, y2, -0.3])
  const button = (x: number, color: string, name: string) => {
    box(group, [2.3, 0.75, 0.35], mat(color, { rough: 0.5, emissive: color }), [x, yBtn, -0.4]).castShadow = false
    caption(name, [x, yBtn, -0.15], '#f2f2f2', 0.32)
  }
  button(ka, '#3c8a4c', 'RUN/STOP')
  button(kb, '#45484f', 'AUTO')
  const bnc = (x: number, color: string, name: string): V3 => {
    const y = yBnc
    cylinder(group, 0.75, 0.15, glowMat(color, 0.5), [x, y, -0.5], 'z', 32)
    cylinder(group, 0.55, 0.9, STEEL(), [x, y, -0.1], 'z', 24)
    cylinder(group, 0.25, 0.95, mat('#111'), [x, y, -0.05], 'z', 16)
    caption(name, [x, y - 1.05, 0], color)
    return [x, y, 0.4]
  }
  const ch1 = bnc(ka, '#ffd84d', 'CH1')
  const ch2 = bnc(kb, '#5ad8e6', 'CH2')
  return {
    group,
    screen,
    status,
    knobs,
    ch1,
    ch2,
    lamp(color: string, on: boolean) {
      lampMat.color.set(on ? color : GREY)
      lampMat.emissive.set(on ? color : GREY)
      lampMat.emissiveIntensity = on ? 1.3 : 0.15
    },
  }
}

/** Logic-analyser capture window facing +z: one row per channel (name on the left), plus an optional decoder strip at the bottom.
 *  `channel(k)` adds a trace for row k: `draw(level(u) 0..1, headU)`; `annotate(segs)` fills the strip with labelled boxes. */
export function captureScreen(
  parent: THREE.Object3D,
  at: V3,
  rows: { label: string; color: string }[],
  { width = 18, rowH = 2.2, decoder = false } = {},
) {
  const n = rows.length + (decoder ? 1 : 0)
  const height = n * rowH
  const sc = scope(parent, width, height, { divs: [10, n] })
  sc.group.position.set(...at)
  const mid = (k: number) => height / 2 - (k + 0.5) * rowH
  const yOf = (k: number, v: number) => mid(k) + (v - 0.5) * rowH * 0.55
  rows.forEach((r, k) => {
    add(sc.group, label(r.label, { size: 0.6, color: r.color, align: 'right' }), [-width / 2 - 0.8, mid(k), 0]).castShadow = false
  })
  const boxGeo = new THREE.BoxGeometry(1, rowH * 0.62, 0.12)
  const fills = new Map<string, THREE.Material>()
  const fill = (c: string) => {
    const dark = `#${new THREE.Color(c).multiplyScalar(0.04).getHexString()}`
    return fills.get(c) ?? fills.set(c, mat(dark, { emissive: dark })).get(c)!
  }
  const slots = Array.from({ length: decoder ? 24 : 0 }, () => {
    const m = add(sc.group, mesh(boxGeo, fill(GREY)), [0, mid(n - 1), 0.2])
    m.castShadow = false
    return { box: m, text: liveLabel(sc.group, [0, mid(n - 1), 0.4], { size: 0.5 }) }
  })
  return {
    group: sc.group,
    width,
    height,
    xAt: sc.xAt,
    yOf,
    channel(k: number, { color = rows[k].color, samples = 480, radius = 0.09 } = {}) {
      const tr = sc.trace(color, { samples, radius })
      return { ...tr, draw: (level: (u: number) => number, headU: number | null = null) => tr.draw((u) => yOf(k, level(u)), headU) }
    },
    /** Decoder boxes from u0 to u1 (0..1 across the window); boxes past the list are hidden. */
    annotate(segs: { u0: number; u1: number; text: string; color: string }[]) {
      slots.forEach((s, i) => {
        const g = segs[i]
        s.box.visible = !!g
        s.text.set(g ? g.text : '', g?.color)
        if (!g) return
        const w = Math.max(0.2, (g.u1 - g.u0) * width - 0.12)
        s.box.scale.x = w
        s.box.material = fill(g.color)
        s.box.position.x = sc.xAt((g.u0 + g.u1) / 2)
        s.text.group.position.x = s.box.position.x
      })
    },
  }
}

/** Decoder text + colour per I²C event, for `captureScreen`. */
export const I2C_TEXT: Record<I2cEvent['kind'], (e: I2cEvent) => [string, string]> = {
  start: () => ['S', POWER],
  stop: () => ['P', POWER],
  addr: (e) => [`${hex(e.value, 2)} ${e.read ? 'R' : 'W'}`, DATA_COLOR],
  data: (e) => [hex(e.value, 2), CLK_COLOR],
  ack: () => ['A', POWER],
  nack: () => ['N', HIGH_V],
}
