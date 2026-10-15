// Circuit parts: cells, wires, resistors, nodes, sources.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, rod, STEEL, tube } from '../../models/kit'
import { buildLed, resistorBody } from '../../models/passives'
import { Helix } from '../../models/power'
import { COPPER, CONVENTIONAL, HIGH_V, LOW_V, POWER, RING, glowMat, potentialColor } from './colors'
import { plusFlow } from './flows'
import { arrow, plusGeometry } from './shapes'
import { UP, clamp01, emptyGroup, rand } from './util'

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

/** Potential fraction up a `CELL_H` cell centred at y = `cy`. */
export const cellFraction = (y: number, cy = 0) => clamp01((y - cy + CELL_H / 2) / CELL_H)
/** Points moved onto the charge lane. */
export const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])

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
  const flow = plusFlow(parent, lane([[-w, -h, 0], [-w, h, 0], [w, h, 0], [w, -h, 0]]), (at) => fraction(at.x, at.y) * level, true)
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

export const groundAt = (parent: THREE.Object3D, at: V3) => add(parent, groundSymbol(), at).scale.setScalar(0.7)

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

/** Disc ceramic capacitor along a → b: an orange disc facing +z at the middle, `scale` × the 2.54 mm part, leads to both ends. */
export function ceramicAlong(parent: THREE.Object3D, a: V3, b: V3, scale = 1.6) {
  const group = add(parent, new THREE.Group())
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const r = 0.95 * scale
  const disc = add(group, mesh(new THREE.SphereGeometry(1, 28, 18), mat('#d9912b', { rough: 0.5 })), mid)
  disc.scale.set(r, r, 0.32 * scale)
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().multiplyScalar(r * 0.8)
  rod(group, a, [mid[0] - d.x, mid[1] - d.y, mid[2] - d.z], 0.11 * scale, STEEL())
  rod(group, [mid[0] + d.x, mid[1] + d.y, mid[2] + d.z], b, 0.11 * scale, STEEL())
  return group
}

/** Black IC package facing +z, centred on the origin, `pins` legs down each side (x = ±width/2) and a notch at the top. */
export function icPackage(width: number, height: number, pins = 4): THREE.Group {
  const g = new THREE.Group()
  box(g, [width, height, 1.2], mat('#1c1d22', { rough: 0.6 }), [0, 0, 0])
  cylinder(g, 0.35, 0.1, mat('#3a3c44'), [0, height / 2 - 0.6, 0.6], 'z', 16)
  for (let i = 0; i < pins; i++) {
    const y = height / 2 - ((i + 0.5) / pins) * height
    for (const s of [-1, 1]) box(g, [0.9, 0.45, 0.25], STEEL(), [s * (width / 2 + 0.4), y, -0.2])
  }
  return g
}

/** Knife switch hinged at `pivot`: a steel blade `length` long, steel balls on the pivot and a contact at each angle in
 *  `contacts` (rad, 0 = +x). `set(angle)` swings the blade. */
export function knifeSwitch(parent: THREE.Object3D, pivot: V3, length: number, contacts: number[]) {
  const ball = new THREE.SphereGeometry(0.42, 16, 12)
  add(parent, mesh(ball, STEEL()), pivot)
  for (const a of contacts) add(parent, mesh(ball, STEEL()), [pivot[0] + length * Math.cos(a), pivot[1] + length * Math.sin(a), pivot[2]])
  const blade = add(parent, new THREE.Group(), [pivot[0], pivot[1], pivot[2] + 0.25])
  rod(blade, [0, 0, 0], [length, 0, 0], 0.26, STEEL())
  box(blade, [1.2, 0.7, 0.7], mat('#d23b3b', { rough: 0.5 }), [length * 0.55, 0, 0.4])
  return {
    blade,
    set(angle: number) {
      blade.rotation.z = angle
    },
  }
}

/** Momentary push button across a → b: two contacts, a steel bar held off them on the left of a → b, and a red cap.
 *  `set(0..1)` presses the bar onto the contacts. */
export function pushButton(parent: THREE.Object3D, a: V3, b: V3) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const group = add(parent, new THREE.Group(), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  group.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
  const ball = new THREE.SphereGeometry(0.42, 16, 12)
  for (const s of [-1, 1]) add(group, mesh(ball, STEEL()), [(s * len) / 2, 0, 0])
  const gap = 0.45 * len
  const plunger = add(group, new THREE.Group(), [0, gap, 0])
  rod(plunger, [-len / 2 - 0.3, 0.45, 0], [len / 2 + 0.3, 0.45, 0], 0.24, STEEL())
  rod(plunger, [0, 0.45, 0], [0, 2.2, 0], 0.16, STEEL())
  cylinder(plunger, 0.95, 0.7, mat('#d23b3b', { rough: 0.5 }), [0, 2.4, 0], 'y', 24)
  return {
    group,
    set(pressed: number) {
      plunger.position.y = gap * (1 - clamp01(pressed))
    },
  }
}

/** Axial diode along a → b, anode at a: `glass` is a DO-35 (1N4148, zeners: orange glass, black band), else a DO-41
 *  (1N4007: black, grey band), `scale` × the real part. `set(f)`: f > 0 glows a halo round the junction (conducting),
 *  f < 0 raises a pale wall across it (blocking). */
export function diodeAlong(parent: THREE.Object3D, a: V3, b: V3, { scale = 1.6, glass = false } = {}) {
  const group = add(parent, new THREE.Group())
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const body = add(group, new THREE.Group(), mid)
  body.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
  body.scale.setScalar(scale)
  const [len, r] = glass ? [1.38, 0.36] : [2.05, 0.53]
  if (glass) {
    const shell = new THREE.MeshStandardMaterial({ color: '#e0782a', transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false })
    cylinder(body, r, len, shell, [0, 0, 0], 'x', 24).castShadow = false
    for (const s of [-1, 1]) cylinder(body, r * 0.55, len * 0.36, STEEL(), [s * len * 0.25, 0, 0], 'x', 16)
    cylinder(body, r * 0.3, len * 0.12, mat('#4a4d55'), [0, 0, 0], 'x', 12)
    cylinder(body, r + 0.01, len * 0.14, mat('#18191d'), [len * 0.36, 0, 0], 'x', 24)
  } else {
    cylinder(body, r, len, mat('#1c1c1f', { rough: 0.5 }), [0, 0, 0], 'x', 24)
    cylinder(body, r + 0.01, len * 0.14, mat('#b9bec6', { rough: 0.5 }), [len * 0.36, 0, 0], 'x', 24)
  }
  const haloMat = glowMat(CONVENTIONAL, 1.2)
  const halo = add(body, mesh(new THREE.TorusGeometry(r * 1.35, 0.07, 8, 32), haloMat))
  halo.rotation.y = Math.PI / 2
  const wallMat = new THREE.MeshStandardMaterial({ color: '#dfe6f2', emissive: '#8fa3c0', transparent: true, opacity: 0, depthWrite: false })
  const wall = add(body, mesh(new THREE.CylinderGeometry(r * 1.9, r * 1.9, 0.08, 32), wallMat))
  wall.rotation.z = Math.PI / 2
  halo.castShadow = wall.castShadow = false
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().multiplyScalar((len / 2) * scale)
  rod(group, a, [mid[0] - d.x, mid[1] - d.y, mid[2] - d.z], 0.11 * scale, STEEL())
  rod(group, [mid[0] + d.x, mid[1] + d.y, mid[2] + d.z], b, 0.11 * scale, STEEL())
  return {
    group,
    set(f: number) {
      halo.visible = f > 0.01
      haloMat.emissiveIntensity = 0.4 + 1.6 * clamp01(f)
      halo.scale.setScalar(0.8 + 0.3 * clamp01(f))
      wall.visible = f < -0.01
      wallMat.opacity = 0.55 * clamp01(-f)
    },
  }
}

/** Diode symbol facing +z, centred on the origin: a triangle pointing +x into the cathode bar. */
export function diodeSymbol(size = 1.6, color = '#e8e8e8'): THREE.Group {
  const g = new THREE.Group()
  const m = mat(color, { emissive: '#444444' })
  const h = size / 2
  const tri = new THREE.Shape([new THREE.Vector2(-h, h), new THREE.Vector2(h, 0), new THREE.Vector2(-h, -h)])
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false })
  geo.translate(0, 0, -0.1)
  add(g, mesh(geo, m))
  box(g, [0.18, size * 1.1, 0.2], m, [h + 0.09, 0, 0])
  for (const s of [-1, 1]) rod(g, [s * (h + 0.6), 0, 0], [s * h, 0, 0], 0.08, m)
  return g
}

let glowTexture: THREE.DataTexture | null = null

/** Radial falloff, white in the middle to clear at the rim. */
function glowMap() {
  if (glowTexture) return glowTexture
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const r = Math.hypot(i - size / 2 + 0.5, j - size / 2 + 0.5) / (size / 2)
      const a = Math.max(0, Math.exp(-5 * r * r) - Math.exp(-5)) * 255
      data.set([a, a, a, 255], 4 * (j * size + i))
    }
  glowTexture = new THREE.DataTexture(data, size, size)
  glowTexture.magFilter = glowTexture.minFilter = THREE.LinearFilter
  glowTexture.needsUpdate = true
  return glowTexture
}

/** Soft additive glow facing the camera at `at`, `radius` across at f = 1; `set(f, color)` brightens and grows it. */
export function glowHalo(parent: THREE.Object3D, at: V3, radius: number) {
  const material = new THREE.SpriteMaterial({ map: glowMap(), color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const sprite = add(parent, new THREE.Sprite(material), at)
  return {
    group: sprite,
    set(f: number, color: THREE.ColorRepresentation) {
      sprite.visible = f > 0.003
      sprite.scale.setScalar(radius * 5 * (0.6 + 0.5 * Math.min(f, 2)))
      material.color.set(color).multiplyScalar(0.9 * Math.min(f, 2))
    },
  }
}

const PHOTONS = 40

/** The real 5 mm LED (`buildLed`) at `scale`, leads ending at `at` ± scale/2 on x, anode at +x (−x if `!anodeRight`),
 *  with a halo and photons flying off. `set(f)`: f = current / rated; light ∝ √f so dim currents still read, past 1
 *  it flares white. `step(dt)` moves photons; `burn(on)` chars the die. */
export function ledLamp(parent: THREE.Object3D, color: string, at: V3, { scale = 1.6, anodeRight = true } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const led = add(group, buildLed(color), [0, 1.5 * scale, 0])
  led.scale.setScalar(scale)
  if (anodeRight) led.rotation.y = Math.PI
  const dieY = 3.8 * scale
  const halo = glowHalo(group, [0, dieY + 0.4 * scale, 0], 1.1 * scale)
  const char = add(group, mesh(new THREE.SphereGeometry(0.5 * scale, 16, 12), mat('#0e0a08', { rough: 0.9 })), [0, dieY, 0])
  char.visible = false
  const photonMat = glowMat(color, 2)
  const photons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16 * scale, 8, 6), photonMat, PHOTONS)
  photons.frustumCulled = false
  photons.castShadow = false
  group.add(photons)
  const fly = Array.from({ length: PHOTONS }, () => ({ life: 1, dir: new THREE.Vector3() }))
  const white = new THREE.Color('#ffffff')
  const tint = new THREE.Color()
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3()
  const origin = new THREE.Vector3(0, dieY + 0.4 * scale, 0)
  let level = 0
  let burnt = false
  return {
    group,
    dieY: at[1] + dieY,
    set(f: number) {
      level = burnt ? 0 : Math.max(0, f)
      const g = Math.sqrt(Math.min(level, 1))
      const flare = clamp01((level - 1) / 1.5)
      led.userData.setGlow(g + 1.5 * flare)
      halo.set(g + flare, tint.set(color).lerp(white, 0.6 * flare))
    },
    burn(on: boolean) {
      burnt = on
      char.visible = on
      ;(led.userData.epoxy as THREE.MeshStandardMaterial).color.set(on ? '#3a2420' : color)
      if (on) this.set(0)
    },
    step(dt: number) {
      fly.forEach((ph, i) => {
        if (ph.life >= 1 && Math.random() < dt * 30 * Math.min(level, 2)) {
          ph.life = 0
          const a = rand(-0.15, 1.15) * Math.PI
          ph.dir.set(Math.cos(a), Math.sin(a), rand(-0.4, 0.6)).normalize()
        }
        if (ph.life < 1) ph.life = Math.min(1, ph.life + dt / 0.9)
        const s = ph.life >= 1 ? 0.001 : Math.sin(Math.PI * Math.min(1, ph.life * 1.2 + 0.1))
        p.copy(ph.dir).multiplyScalar((1.2 + 7 * ph.life) * scale * 0.6).add(origin)
        photons.setMatrixAt(i, m.compose(p, q, sc.setScalar(Math.max(0.001, s))))
      })
      photons.instanceMatrix.needsUpdate = true
    },
  }
}

/** Spark jumping between contacts: a jagged bolt a → b with a halo and a flash light at `at`.
 *  `set(a, b, strength 0..1)` every frame; 0 hides it. */
export function arcSpark(parent: THREE.Object3D, at: V3) {
  const sparkMat = glowMat('#cfe3ff', 3)
  const bolt = Array.from({ length: 5 }, () => {
    const m = add(parent, mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 6), sparkMat))
    m.castShadow = false
    return m
  })
  const flash = add(parent, new THREE.PointLight('#bcd8ff', 0, 30, 2), [at[0] + 0.1, at[1] + 0.1, at[2] + 0.7])
  const glowBall = new THREE.MeshBasicMaterial({ color: '#9cc4ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const halo = add(parent, mesh(new THREE.SphereGeometry(1, 20, 14), glowBall), at)
  halo.castShadow = false
  const from = new THREE.Vector3()
  const d = new THREE.Vector3()
  return {
    set(a: V3, b: V3, strength: number) {
      const on = strength > 0.02
      let prev: V3 = a
      bolt.forEach((m, i) => {
        const u = (i + 1) / bolt.length
        const jag = i === bolt.length - 1 ? 0 : rand(-0.35, 0.35)
        const next: V3 = [a[0] + (b[0] - a[0]) * u + jag, a[1] + (b[1] - a[1]) * u + jag * 0.5, a[2] + (b[2] - a[2]) * u]
        from.set(...prev)
        d.set(...next).sub(from)
        m.position.copy(from).addScaledVector(d, 0.5)
        m.scale.set(1, Math.max(0.001, d.length()), 1)
        m.quaternion.setFromUnitVectors(UP, d.normalize())
        m.visible = on
        prev = next
      })
      sparkMat.emissiveIntensity = 1 + 4 * strength * rand(0.6, 1)
      flash.intensity = 400 * strength * rand(0.5, 1)
      halo.visible = on
      halo.scale.setScalar(0.4 + 0.8 * strength * rand(0.8, 1))
      glowBall.opacity = 0.6 * strength
    },
  }
}

/** Small DC motor facing +z on legs: a steel can (radius `r`) centred at `at`, a red two-blade flag on the shaft, and
 *  terminals running down to `at` − (±0.8r, r + `legs`). `spin(dt, rpm)` turns the flag at the real speed. */
export function motorCan(parent: THREE.Object3D, at: V3, { r = 1.8, legs = 0.8 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const can = add(group, new THREE.Group())
  cylinder(can, r, 1.6 * r, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [0, 0, -0.3 * r], 'z', 40)
  cylinder(can, r * 0.94, 0.12, mat('#8d939c', { metal: 0.3, rough: 0.45 }), [0, 0, 0.5 * r + 0.06], 'z', 40)
  cylinder(can, r * 0.3, 0.3, mat('#5a4a3a', { rough: 0.5 }), [0, 0, 0.5 * r + 0.2], 'z', 16)
  rod(can, [0, 0, 0.5 * r], [0, 0, 0.5 * r + 1.1], 0.09 * r, STEEL())
  const flag = add(can, new THREE.Group(), [0, 0, 0.5 * r + 1])
  box(flag, [1.7 * r, 0.32 * r, 0.12], mat('#d23b3b', { rough: 0.5 }), [0, 0, 0])
  box(flag, [0.3 * r, 0.3 * r, 0.14], mat('#f4f1e8', { rough: 0.5 }), [0.7 * r, 0, 0.02])
  const pins = [-1, 1].map((s): V3 => [at[0] + s * 0.8 * r, at[1] - r - legs, at[2]])
  for (const s of [-1, 1]) lead(group, [[s * 0.8 * r, -0.55 * r, 0], [s * 0.8 * r, -r - legs, 0]], 0.13, STEEL())
  return {
    group,
    /** The can, flag and shaft: tilt it to show the can's side. */
    can,
    /** Left and right terminal ends. */
    pins,
    spin(dt: number, rpm: number) {
      flag.rotation.z -= (dt * rpm * 2 * Math.PI) / 60
    },
  }
}

const INK = () => mat('#d8dbe0', { emissive: '#3a3c40' })
const GREY_RIM = new THREE.Color('#9aa0aa')
const WARN = new THREE.Color(RING)

/** Op-amp symbol facing +z: a triangle `size` tall pointing +x, inputs on the left (− on top unless `minusTop` is false),
 *  supply stubs up (V+) and down (V−). `set(out, clip)` tints the output dot by potential (0..1) and the rim by clipping;
 *  `inputs(p, n)` tints the input dots. `pins` are in the parent's frame. */
export function opAmpSymbol(parent: THREE.Object3D, at: V3, { size = 4.4, lead: stub = 1, minusTop = true } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const h = size / 2
  const tri = new THREE.Shape([new THREE.Vector2(-h, h), new THREE.Vector2(h, 0), new THREE.Vector2(-h, -h)])
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.5, bevelEnabled: false })
  geo.translate(0, 0, -0.25)
  add(g, mesh(geo, mat('#23262d', { rough: 0.55 })))
  const rim = glowMat('#9aa0aa', 0.35)
  const corners: V3[] = [[-h, h, 0.3], [h, 0, 0.3], [-h, -h, 0.3]]
  corners.forEach((c, i) => rod(g, c, corners[(i + 1) % 3], 0.11, rim))
  for (const c of corners) add(g, mesh(new THREE.SphereGeometry(0.11, 10, 8), rim), c)

  const ink = INK()
  const yN = minusTop ? h / 2 : -h / 2
  add(g, mesh(plusGeometry(0.75), ink), [-h + 0.75, -yN, 0.25])
  box(g, [0.75, 0.2, 0.1], ink, [-h + 0.75, yN, 0.32])
  for (const y of [h / 2, -h / 2]) rod(g, [-h - stub, y, 0], [-h, y, 0], 0.09, ink)
  rod(g, [h, 0, 0], [h + stub, 0, 0], 0.09, ink)
  for (const [s, color] of [[1, HIGH_V], [-1, LOW_V]] as const) {
    rod(g, [0, s * h / 2, 0], [0, s * (h / 2 + stub), 0], 0.09, ink)
    cylinder(g, 0.28, 0.12, glowMat(color, 0.6), [0, s * (h / 2 + stub), 0], 'y', 16)
  }
  const dot = (p: V3) => add(g, mesh(new THREE.SphereGeometry(0.26, 14, 10), glowMat('#ffffff', 0.9)), p)
  const outDot = dot([h + 0.05, 0, 0.3])
  const pDot = dot([-h - 0.1, -yN, 0])
  const nDot = dot([-h - 0.1, yN, 0])
  const tint = (o: THREE.Mesh, f: number) => {
    const m = o.material as THREE.MeshStandardMaterial
    potentialColor(f, m.color)
    m.emissive.copy(m.color)
  }
  const local = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group: g,
    pins: {
      n: local(-h - stub, yN),
      p: local(-h - stub, -yN),
      out: local(h + stub, 0),
      vcc: local(0, h / 2 + stub),
      vee: local(0, -h / 2 - stub),
    },
    set(out: number, clip = 0) {
      tint(outDot, out)
      rim.color.copy(GREY_RIM).lerp(WARN, clip)
      rim.emissive.copy(rim.color)
      rim.emissiveIntensity = 0.35 + 0.6 * clip
    },
    inputs(p: number, n: number) {
      tint(pDot, p)
      tint(nDot, n)
    },
  }
}

/** Insulated hookup wire through `points`, rounded at the bends. */
export function cableRun(parent: THREE.Object3D, points: V3[], color = '#d8322c', r = 0.16) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  for (let i = 0; i < points.length - 1; i++) tube(parent, [points[i], points[i + 1]], r, m, 4)
  for (let i = 1; i < points.length - 1; i++) add(parent, mesh(new THREE.SphereGeometry(r, 12, 8), m), points[i])
}

/** A board model laid face-up toward the camera at `k` × real. */
export const lieFlat = (o: THREE.Object3D, k = 0.22) => {
  o.scale.setScalar(k)
  o.rotation.x = Math.PI / 2
  return o
}

/** A part model standing on (or hanging from) a horizontal wire at `at`, `k` × real. */
export function standUp(parent: THREE.Object3D, part: THREE.Group, at: V3, k: number, hang = false) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.z = hang ? Math.PI : 0
  add(g, part, [0, 1.5 * k, 0]).scale.setScalar(k)
  return g
}
