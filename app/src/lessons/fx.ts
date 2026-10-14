// Visual vocabulary shared by lessons: moving charges, wires, arrows, cells.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, rod, STEEL } from '../models/kit'
import { resistorBody } from '../models/passives'
import { Helix } from '../models/power'

export const ELECTRON = '#4da6ff'
export const CONVENTIONAL = '#ff9a2e'
export const RING = '#ffd84d'
export const HIGH_V = '#ff4d4d'
export const LOW_V = '#3d6bff'
export const COPPER = () => mat('#c8803f', { metal: 0.35, rough: 0.4 })

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

export function path(points: V3[], closed = false): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map((p) => new THREE.Vector3(...p))
  const c = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) c.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  if (closed) c.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]))
  return c
}

/** Evenly spaced dots sliding along a path; wraps at the ends. */
export class Flow {
  readonly mesh: THREE.InstancedMesh
  readonly length: number
  readonly count: number
  private offset = 0
  private paint?: (at: THREE.Vector3, out: THREE.Color) => void
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly c = new THREE.Color()

  constructor(
    private readonly curve: THREE.Curve<THREE.Vector3>,
    spacing = 1.6,
    color = ELECTRON,
    radius = 0.32,
    geometry: THREE.BufferGeometry = new THREE.SphereGeometry(radius, 12, 8),
  ) {
    this.length = curve.getLength()
    this.count = Math.max(2, Math.round(this.length / spacing))
    this.mesh = new THREE.InstancedMesh(geometry, glowMat(color), this.count)
    this.mesh.frustumCulled = false
    this.place()
  }

  /** Moves every dot `distance` along the path (negative goes backwards). */
  step(distance: number) {
    this.offset = (((this.offset + distance / this.length) % 1) + 1) % 1
    this.place()
  }

  /** Places the dots `distance` along the path from their start. */
  moveTo(distance: number) {
    this.offset = 0
    this.step(distance)
  }

  /** Colors each dot by where it is (e.g. by potential); unlit so the color reads exactly. */
  colorBy(paint: (at: THREE.Vector3, out: THREE.Color) => void) {
    this.paint = paint
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.material = new THREE.MeshBasicMaterial({ color: '#ffffff' })
    this.place()
    return this
  }

  private place() {
    for (let i = 0; i < this.count; i++) {
      this.curve.getPointAt((i / this.count + this.offset) % 1, this.p)
      this.mesh.setMatrixAt(i, this.m.makeTranslation(this.p))
      if (this.paint) {
        this.paint(this.p, this.c)
        this.mesh.setColorAt(i, this.c)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/** A flat "+" token, facing +z. */
export function plusGeometry(size = 0.8): THREE.BufferGeometry {
  const t = size * 0.32
  const shape = new THREE.Shape()
  const a = size / 2
  const b = t / 2
  shape.moveTo(-b, a)
  for (const [x, y] of [[b, a], [b, b], [a, b], [a, -b], [b, -b], [b, -a], [-b, -a], [-b, -b], [-a, -b], [-a, b], [-b, b]]) shape.lineTo(x, y)
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
  g.translate(0, 0, -t / 2)
  return g
}

const UP = new THREE.Vector3(0, 1, 0)

export function arrow(parent: THREE.Object3D, at: V3, dir: V3, color = CONVENTIONAL, size = 1) {
  const g = new THREE.Group()
  const material = glowMat(color, 0.5)
  add(g, mesh(new THREE.CylinderGeometry(0.18 * size, 0.18 * size, 1.4 * size, 10), material), [0, -0.5 * size, 0])
  add(g, mesh(new THREE.ConeGeometry(0.55 * size, 1.1 * size, 16), material), [0, 0.6 * size, 0])
  g.position.set(...at)
  pointArrow(g, dir)
  parent.add(g)
  return g
}

export function pointArrow(a: THREE.Object3D, dir: V3) {
  a.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize())
}

/** A cell standing on y, + on top; flip with `rotation.z = π`. */
export function cell(height = 5, r = 1.6): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, r, height * 0.7, mat('#26272c', { rough: 0.4 }), [0, -height * 0.15, 0], 'y', 32)
  cylinder(g, r, height * 0.3, mat('#c9772b', { metal: 0.3, rough: 0.35 }), [0, height * 0.35, 0], 'y', 32)
  cylinder(g, r * 0.35, 0.4, STEEL(), [0, height / 2 + 0.2, 0], 'y', 16)
  const red = mat('#ff4d4d', { emissive: '#aa1111' })
  const blue = mat('#4d8dff', { emissive: '#1133aa' })
  box(g, [0.9, 0.22, 0.1], red, [0, height * 0.35, r])
  box(g, [0.22, 0.9, 0.1], red, [0, height * 0.35, r])
  box(g, [0.9, 0.22, 0.1], blue, [0, -height * 0.3, r])
  return g
}

/** Copper wire through `points`. */
export function wire(parent: THREE.Object3D, points: V3[], r = 0.28) {
  lead(parent, points, r, COPPER())
}

/** Incandescent bulb, filament centred at the origin; screw base below. */
export function bulb(): { group: THREE.Group; setGlow: (g: number) => void } {
  const group = new THREE.Group()
  const base = mat('#b9bec6', { metal: 0.45, rough: 0.35 })
  cylinder(group, 1.1, 1.8, base, [0, -2.1, 0], 'y', 24)
  for (let i = 0; i < 4; i++) {
    const t = add(group, mesh(new THREE.TorusGeometry(1.12, 0.12, 6, 24), base), [0, -2.8 + i * 0.45, 0])
    t.rotation.x = Math.PI / 2
  }
  cylinder(group, 0.5, 0.3, mat('#222'), [0, -3.1, 0], 'y', 16)
  const glass = mesh(
    new THREE.SphereGeometry(2.7, 40, 24),
    new THREE.MeshStandardMaterial({ color: '#f4f6ff', transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }),
  )
  glass.castShadow = false
  add(group, glass, [0, 1.5, 0])
  for (const s of [-1, 1]) rod(group, [s * 0.4, -1.2, 0], [s * 1.1, 1.6, 0], 0.07, STEEL())
  const filamentMat = new THREE.MeshStandardMaterial({ color: '#6b5a4a', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.4 })
  const filament = add(group, mesh(new THREE.TubeGeometry(new Helix(0.22, 2.2, 12), 160, 0.05, 6), filamentMat), [-1.1, 1.6, 0])
  filament.castShadow = false
  const light = new THREE.PointLight('#ffcf8a', 0, 60, 2)
  add(group, light, [0, 1.6, 0])
  return {
    group,
    setGlow(g) {
      filamentMat.emissiveIntensity = g * 6
      light.intensity = g * 500
    },
  }
}

/** See-through wire along x, with copper rims at the ends. */
export function glassTube(parent: THREE.Object3D, length: number, radius: number) {
  const glass = mesh(
    new THREE.CylinderGeometry(radius, radius, length, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f0c090', transparent: true, opacity: 0.07, roughness: 0.1, side: THREE.FrontSide, depthWrite: false }),
  )
  glass.rotation.z = Math.PI / 2
  glass.castShadow = false
  parent.add(glass)
  for (const s of [-1, 1]) {
    const rim = add(parent, mesh(new THREE.TorusGeometry(radius, 0.1, 10, 64), mat('#c8803f', { metal: 0.4, rough: 0.3 })), [(s * length) / 2, 0, 0])
    rim.rotation.y = Math.PI / 2
  }
}

/** The glowing cross-section that current is counted through, at x = `x`. */
export function countingRing(parent: THREE.Object3D, radius: number, x = 0) {
  const material = glowMat(RING, 0.9)
  const ring = add(parent, mesh(new THREE.TorusGeometry(radius + 0.25, 0.12, 12, 64), material), [x, 0, 0])
  ring.rotation.y = Math.PI / 2
  const disc = mesh(
    new THREE.CircleGeometry(radius + 0.2, 64),
    new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  )
  disc.position.x = x
  disc.rotation.y = Math.PI / 2
  disc.castShadow = false
  parent.add(disc)
  return material
}

export function randomDir(len: number): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len)
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** 0 → LOW_V (blue), 1 → HIGH_V (red). */
export function potentialColor(f: number, out = new THREE.Color()): THREE.Color {
  return out.set(LOW_V).lerp(new THREE.Color(HIGH_V), clamp01(f))
}

/** Removes and disposes everything in `g`; cached `mat()` materials are shared, so they stay. */
export function emptyGroup(g: THREE.Group) {
  g.traverse((o) => {
    const { geometry, material } = o as THREE.Mesh
    geometry?.dispose()
    for (const m of [material ?? []].flat()) if (!m.userData.shared) m.dispose()
  })
  g.clear()
}

/** A resistor body laid along the segment a → b, scaled up to read at lesson size. */
export function resistorAlong(parent: THREE.Object3D, ohms: number, a: V3, b: V3, scale = 1.6) {
  const r = add(parent, resistorBody(ohms), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  r.scale.setScalar(scale)
  r.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
  return r
}

const LOOP_LANE = 1.3 // charges ride in front of the wire so they stay visible through the parts

/** Cell (+ up) on the left, resistor down the right, + charges in front coloured by potential.
 *  `set(volts, ohms)` swaps the resistor and recolours (full red at `maxVolts`); `flow.step` moves the charges. */
export function resistorLoop(parent: THREE.Object3D, { w = 11, h = 6, cellH = 5, scale = 1.8, maxVolts = 12 } = {}) {
  const rs = 1.2 * scale
  wire(parent, [[-w, -h, 0], [-w, h, 0], [w, h, 0], [w, -h, 0], [-w, -h, 0]])
  const battery = cell(cellH, 1.5)
  battery.position.set(-w, 0, 0)
  parent.add(battery)
  const holder = add(parent, new THREE.Group())
  let level = 0
  const fraction = (x: number, y: number) => {
    if (y >= h - 0.01) return 1
    if (y <= -h + 0.01) return 0
    if (x <= -w + 0.01) return clamp01((y + cellH / 2) / cellH)
    return clamp01((y + rs) / (2 * rs))
  }
  const lane: V3[] = [[-w, -h, LOOP_LANE], [-w, h, LOOP_LANE], [w, h, LOOP_LANE], [w, -h, LOOP_LANE]]
  const flow = new Flow(path(lane, true), 1.5, CONVENTIONAL, 0.3, plusGeometry(0.7))
  flow.colorBy((at, out) => potentialColor(fraction(at.x, at.y) * level, out))
  parent.add(flow.mesh)
  let shownOhms = NaN
  return {
    flow,
    battery,
    set(volts: number, ohms: number) {
      level = volts / maxVolts
      if (ohms === shownOhms) return
      emptyGroup(holder)
      resistorAlong(holder, ohms, [w, 1, 0], [w, -1, 0], scale)
      shownOhms = ohms
    },
  }
}

/** Formula triangle (top over left × right): outline, ÷ bar and × divider; parts sit in `slots`; `light` one operator. */
export function formulaTriangle(side = 12) {
  const group = new THREE.Group()
  const height = side * 0.866
  const top = (2 * height) / 3
  const base = -height / 3
  const barY = base + height * 0.42
  const halfAt = (y: number) => ((top - y) / height) * (side / 2)
  const edge = mat('#8a8f99', { emissive: '#2a2d33' })
  lead(group, [[0, top, 0], [side / 2, base, 0], [-side / 2, base, 0], [0, top, 0]], 0.14, edge)
  const bar = glowMat('#8a8f99', 0.15)
  const cross = glowMat('#8a8f99', 0.15)
  rod(group, [-halfAt(barY), barY, 0], [halfAt(barY), barY, 0], 0.16, bar)
  rod(group, [0, barY, 0], [0, base, 0], 0.16, cross)
  const lowY = (barY + base) / 2
  const slots: V3[] = [[0, (top + barY) / 2 - height * 0.06, 0], [-halfAt(lowY) / 2, lowY, 0], [halfAt(lowY) / 2, lowY, 0]]
  const light = (which: 'bar' | 'cross' | null, glow = 1.2) => {
    for (const [k, m] of [['bar', bar], ['cross', cross]] as const) {
      const on = k === which
      m.color.set(on ? '#ffffff' : '#8a8f99')
      m.emissive.set(on ? RING : '#8a8f99')
      m.emissiveIntensity = on ? glow : 0.15
    }
  }
  return { group, slots, light }
}

/** Vertical voltage ruler at x: a tick per volt, long ticks every 5 V and at 0. */
export function voltScale(parent: THREE.Object3D, x: number, fromV: number, toV: number, perVolt: number, z = 0) {
  const tickMat = mat('#8a8f99')
  const major = mat('#e8e8e8')
  rod(parent, [x, fromV * perVolt, z], [x, toV * perVolt, z], 0.08, tickMat)
  for (let v = Math.ceil(fromV); v <= toV; v++) {
    const big = v % 5 === 0
    box(parent, [big ? 1.6 : 0.9, 0.12, 0.12], big ? major : tickMat, [x, v * perVolt, z])
  }
}

/** Earth symbol: a stem down from the origin, then three shrinking bars. */
export function groundSymbol(color = '#e8e8e8'): THREE.Group {
  const g = new THREE.Group()
  const m = mat(color, { emissive: '#333333' })
  rod(g, [0, 0, 0], [0, -1, 0], 0.1, m)
  ;[1.6, 1.05, 0.5].forEach((w, i) => box(g, [w, 0.16, 0.16], m, [0, -1 - i * 0.38, 0]))
  return g
}

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
  A: 'abcefg', B: 'cdefg', C: 'adef',
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

/** Handheld multimeter facing +z, on the V⎓ range; jacks at the bottom (red V, black COM). */
export function multimeter() {
  const group = new THREE.Group()
  box(group, [8.4, 12.4, 1.6], mat('#f2c230', { rough: 0.7 }), [0, 0, 0])
  box(group, [7.2, 11.2, 0.3], mat('#2a2c32', { rough: 0.5 }), [0, 0, 0.85])
  box(group, [6.2, 2.9, 0.2], mat('#a9b89a', { emissive: '#3a4434', rough: 0.4 }), [0, 3.7, 1.05])
  const display = segmentDisplay(4, 1.9)
  display.group.position.set(0.1, 3.7, 1.2)
  group.add(display.group)
  const dial = cylinder(group, 1.9, 0.5, mat('#3a3d45', { rough: 0.5 }), [0, -0.6, 1.2], 'z', 40)
  dial.castShadow = true
  const dc = Math.PI / 4 // dial at V⎓
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

/** Metal ions on a square grid filling a wire along x; returns `vibrate(t, amplitude)`. */
export function ionLattice(
  parent: THREE.Object3D,
  length: number,
  radius: number,
  { spacing = 2, size = 0.55, colors = ['#d08a4e'] }: { spacing?: number; size?: number; colors?: string[] } = {},
) {
  const sites: THREE.Vector3[] = []
  const k = Math.floor((radius - 0.4) / spacing)
  for (let x = -length / 2 + spacing / 2; x < length / 2; x += spacing) {
    for (let y = -k; y <= k; y++) {
      for (let z = -k; z <= k; z++) if (Math.hypot(y, z) * spacing < radius - 0.4) sites.push(new THREE.Vector3(x, y * spacing, z * spacing))
    }
  }
  const ions = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 20, 14), new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.45 }), sites.length)
  const c = new THREE.Color()
  sites.forEach((_, i) => ions.setColorAt(i, c.set(colors[i % colors.length])))
  parent.add(ions)
  const phase = sites.map(() => [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)])
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const vibrate = (t: number, amplitude = 0.07) => {
    sites.forEach((s, i) => {
      const [a, b, cc] = phase[i]
      p.set(s.x + amplitude * Math.sin(t * 9 + a), s.y + amplitude * Math.sin(t * 11 + b), s.z + amplitude * Math.sin(t * 10 + cc))
      ions.setMatrixAt(i, m.makeTranslation(p))
    })
    ions.instanceMatrix.needsUpdate = true
  }
  vibrate(0)
  return { ions, vibrate }
}

const FLASH_S = 0.4

/** Free electrons in a wire along x: random thermal motion plus a shared drift (+drift moves them −x).
 *  `scatter` is collisions per second; with `ring`, they flash yellow crossing x = 0. Show fewer with `mesh.count`. */
export function electronGas(parent: THREE.Object3D, length: number, radius: number, { count = 70, thermal = 5, ring = false } = {}) {
  const wall = Math.max(0.1, radius - 0.3)
  const pos = Array.from({ length: count }, () => {
    const a = rand(0, Math.PI * 2)
    const r = Math.sqrt(Math.random()) * wall
    return new THREE.Vector3(rand(-length / 2, length / 2), Math.cos(a) * r, Math.sin(a) * r)
  })
  const vel = pos.map(() => randomDir(thermal))
  const flash = pos.map(() => 0)
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.27, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), count)
  dots.frustumCulled = false
  parent.add(dots)

  const base = new THREE.Color(ELECTRON)
  const hit = new THREE.Color(RING)
  const color = new THREE.Color()
  const m = new THREE.Matrix4()

  const step = (dt: number, drift: number, scatter = 4) => {
    for (let i = 0; i < count; i++) {
      const p = pos[i]
      const v = vel[i]
      if (Math.random() < dt * scatter) v.copy(randomDir(thermal))
      const before = p.x
      p.x += (v.x - drift) * dt
      p.y += v.y * dt
      p.z += v.z * dt
      if (ring && Math.sign(before) !== Math.sign(p.x) && Math.abs(p.x) < 1) flash[i] = FLASH_S
      if (p.x < -length / 2) p.x += length
      if (p.x > length / 2) p.x -= length
      const r = Math.hypot(p.y, p.z)
      if (r > wall) {
        p.y *= wall / r
        p.z *= wall / r
        v.y = -v.y
        v.z = -v.z
      }
      flash[i] = Math.max(0, flash[i] - dt)
      dots.setMatrixAt(i, m.makeTranslation(p))
      dots.setColorAt(i, color.copy(base).lerp(hit, flash[i] / FLASH_S))
    }
    dots.instanceMatrix.needsUpdate = true
    dots.instanceColor!.needsUpdate = true
  }
  step(0, 0)
  return { mesh: dots, step }
}

/** Red-hot glow for a material: 0 = off, 1 = bright orange. */
export function heatGlow(material: THREE.MeshStandardMaterial, f: number) {
  const t = clamp01(f)
  material.emissive.set('#b01800').lerp(new THREE.Color('#ff8a1e'), t)
  material.emissiveIntensity = t * t * 1.6
}

/** Glass thermometer standing on the origin, bulb at the bottom; `set(0..1)` fills it. */
export function thermometer(height = 10) {
  const group = new THREE.Group()
  const red = glowMat(HIGH_V, 0.6)
  const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false })
  add(group, mesh(new THREE.SphereGeometry(0.9, 24, 16), red), [0, 0.9, 0])
  const column = add(group, mesh(new THREE.CylinderGeometry(0.55, 0.55, height, 24, 1, true), glass), [0, 0.9 + height / 2, 0])
  column.castShadow = false
  add(group, mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass), [0, 0.9 + height, 0]).castShadow = false
  const fill = add(group, mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 16), red), [0, 0.9, 0])
  const tickMat = mat('#8a8f99')
  for (let i = 1; i < 10; i++) box(group, [i % 5 === 0 ? 0.9 : 0.5, 0.08, 0.08], tickMat, [-0.85, 0.9 + (i / 10) * height, 0])
  return {
    group,
    set(f: number) {
      const h = Math.max(0.05, clamp01(f) * height)
      fill.scale.y = h
      fill.position.y = 0.9 + h / 2
    },
  }
}
