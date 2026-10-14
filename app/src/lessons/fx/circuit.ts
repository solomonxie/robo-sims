// Circuit parts: cells, wires, resistors, nodes, sources.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, rod, STEEL } from '../../models/kit'
import { resistorBody } from '../../models/passives'
import { Helix } from '../../models/power'
import { COPPER, CONVENTIONAL, HIGH_V, POWER, glowMat, potentialColor } from './colors'
import { plusFlow } from './flows'
import { arrow, plusGeometry } from './shapes'
import { clamp01, emptyGroup } from './util'

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
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false })
  add(group, mesh(new THREE.SphereGeometry(1.9, 24, 16), haloMat), [0, 1.5, 0]).castShadow = false
  return {
    group,
    setGlow(g) {
      filamentMat.emissiveIntensity = g * 6
      haloMat.opacity = 0.3 * g
      light.intensity = g * 500
    },
  }
}

/** A resistor body laid along the segment a → b, scaled up to read at lesson size. */
export function resistorAlong(parent: THREE.Object3D, ohms: number, a: V3, b: V3, scale = 1.6) {
  const r = add(parent, resistorBody(ohms), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  r.scale.setScalar(scale)
  r.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
  return r
}

/** Charges ride this far in front of the wire so they stay visible through the parts. */
export const LANE = 1.3
/** Circuit-lesson resistor scale, its half-length, and cell height. */
export const R_SCALE = 1.8
export const RS = 1.2 * R_SCALE
export const CELL_H = 4.4

/** Potential fraction up a `CELL_H` cell centred at y = 0. */
export const cellFraction = (y: number) => clamp01((y + CELL_H / 2) / CELL_H)

/** Empties `holder` and lays a fresh resistor a → b in it. */
export function swapResistor(holder: THREE.Group, ohms: number, a: V3, b: V3, scale = R_SCALE) {
  emptyGroup(holder)
  resistorAlong(holder, ohms, a, b, scale)
}

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
  const lane: V3[] = [[-w, -h, LANE], [-w, h, LANE], [w, h, LANE], [w, -h, LANE]]
  const flow = plusFlow(parent, lane, (at) => fraction(at.x, at.y) * level, true)
  let shownOhms = NaN
  return {
    flow,
    battery,
    set(volts: number, ohms: number) {
      level = volts / maxVolts
      if (ohms === shownOhms) return
      swapResistor(holder, ohms, [w, 1, 0], [w, -1, 0], scale)
      shownOhms = ohms
    },
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

/** See-through battery, + on top, standing on its centre: a cylinder (or a box when `square`) with a glowing charge fill;
 *  `set(level 0..1)`. */
export function chargeTank(height: number, r: number, { square = false, color = POWER } = {}) {
  const group = new THREE.Group()
  const shellMat = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false })
  const shellGeo = square ? new THREE.BoxGeometry(2 * r, height, 1.3 * r) : new THREE.CylinderGeometry(r, r, height, 40, 1, true)
  add(group, mesh(shellGeo, shellMat)).castShadow = false
  const capMat = mat('#2a2c32', { rough: 0.5 })
  for (const s of [-1, 1]) {
    if (square) box(group, [2 * r + 0.1, 0.25, 1.3 * r + 0.1], capMat, [0, (s * height) / 2, 0])
    else cylinder(group, r + 0.05, 0.25, capMat, [0, (s * height) / 2, 0], 'y', 40)
  }
  if (square) {
    cylinder(group, 0.35 * r, 0.5, STEEL(), [-0.45 * r, height / 2 + 0.3, 0], 'y', 16)
    box(group, [0.7 * r, 0.5, 0.7 * r], STEEL(), [0.45 * r, height / 2 + 0.3, 0])
  } else cylinder(group, r * 0.35, 0.4, STEEL(), [0, height / 2 + 0.3, 0], 'y', 16)
  const fillMat = glowMat(color, 0.6)
  const inner = height - 0.5
  const fillGeo = square ? new THREE.BoxGeometry(2 * r - 0.3, 1, 1.3 * r - 0.3) : new THREE.CylinderGeometry(r - 0.15, r - 0.15, 1, 40)
  const fill = add(group, mesh(fillGeo, fillMat))
  const plus = add(group, mesh(plusGeometry(0.7 * r), mat('#ff4d4d', { emissive: '#aa1111' })), [0, height / 2 - 0.6 * r, square ? 0.66 * r : r])
  plus.castShadow = false
  return {
    group,
    set(level: number) {
      const h = Math.max(0.001, clamp01(level) * inner)
      fill.scale.y = h
      fill.position.y = -inner / 2 + h / 2
      fill.visible = level > 0.002
      fillMat.emissiveIntensity = 0.25 + 0.5 * clamp01(level)
    },
  }
}

/** NTC thermistor laid along a → b: an epoxy bead on two leads, `scale` like `resistorAlong`.
 *  `set(warmth 0..1)` tints it cold blue → hot orange. */
export function thermistorAlong(parent: THREE.Object3D, a: V3, b: V3, scale = 1.6) {
  const group = add(parent, new THREE.Group(), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  group.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
  group.scale.setScalar(scale)
  const epoxy = new THREE.MeshStandardMaterial({ color: '#2a2d35', roughness: 0.25, emissive: '#000000' })
  add(group, mesh(new THREE.SphereGeometry(0.72, 28, 18), epoxy)).scale.set(1, 0.85, 0.85)
  for (const s of [-1, 1]) rod(group, [s * 0.55, 0, 0], [s * 1.2, 0, 0], 0.09, STEEL())
  const cold = new THREE.Color('#2f6bff')
  const hot = new THREE.Color('#ff7a1e')
  return {
    group,
    set(warmth: number) {
      const f = clamp01(warmth)
      epoxy.emissive.copy(f < 0.5 ? cold : hot)
      epoxy.emissiveIntensity = Math.abs(f - 0.5)
    },
  }
}

/** Output terminal: a short post with a ball on top at the origin; `set(f)` paints the ball by `potentialColor`. */
export function terminal(parent: THREE.Object3D, at: V3, r = 0.7) {
  const group = add(parent, new THREE.Group(), at)
  cylinder(group, r * 0.45, r * 1.6, STEEL(), [0, -r * 0.8, 0], 'y', 16)
  return { ...junction(group, [0, 0, 0], r), group }
}

/** Glowing node ball at `at`; `set(f)` paints it by `potentialColor`. */
export function junction(parent: THREE.Object3D, at: V3, r = 0.7) {
  const ball = glowMat(HIGH_V, 0.8)
  const group = add(parent, mesh(new THREE.SphereGeometry(r, 24, 16), ball), at)
  const c = new THREE.Color()
  return {
    group,
    set(f: number) {
      potentialColor(f, c)
      ball.color.copy(c)
      ball.emissive.copy(c)
    },
  }
}

const along = new THREE.Vector3()
const seg = new THREE.Vector3()

/** Potential fraction at `at` on a straight wire a → b with a resistor of half-length `rs` at its middle:
 *  `fa` before it, `fb` after, a linear drop across it. */
export function dropAlong(at: THREE.Vector3, a: V3, b: V3, fa: number, fb: number, rs: number) {
  seg.set(b[0] - a[0], b[1] - a[1], 0)
  const len = seg.length()
  const s = along.set(at.x - a[0], at.y - a[1], 0).dot(seg) / len
  return fa + (fb - fa) * clamp01((s - len / 2 + rs) / (2 * rs))
}

/** Ideal current source facing +z, centred on the origin: a dark disc in a steel rim with a glowing arrow
 *  pushing up (+y); flip with `rotation.z = π`. */
export function currentSource(r = 1.6, color = CONVENTIONAL): THREE.Group {
  const g = sourceDisc(r)
  arrow(g, [0, -0.15 * r, 0.6], [0, 1, 0], color, r * 0.55)
  return g
}

function sourceDisc(r: number): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, r, 0.9, mat('#26272c', { rough: 0.4 }), [0, 0, 0], 'z', 40)
  add(g, mesh(new THREE.TorusGeometry(r, 0.16, 10, 48), STEEL()), [0, 0, 0.45])
  return g
}

/** AC voltage source facing +z, centred on the origin: the same disc with a glowing sine ∿ across it. */
export function acSource(r = 1.6, color = HIGH_V): THREE.Group {
  const g = sourceDisc(r)
  const pts = Array.from({ length: 33 }, (_, k) => new THREE.Vector3((k / 32 - 0.5) * 1.3 * r, 0.32 * r * Math.sin((k / 32) * 2 * Math.PI), 0))
  add(g, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.09 * r, 8), glowMat(color, 0.8)), [0, 0, 0.5])
  return g
}
