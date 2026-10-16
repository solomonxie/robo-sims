// Modules and boards: TP4056 charger, DC-DC converters, SG90 servo, ESP32, ESP32-CAM, I²C breakouts, step drivers.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, GOLD, mat, mesh, STEEL, TIN } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { glowHalo } from './circuit'
import { LED_RED, glowMat } from './colors'
import { heatGlow } from './heat'
import { litEpoxy } from './parts'
import { LabelOpts, label } from './text'
import { clamp01 } from './util'

const SILK = { glow: false, color: '#eef2f6' }

/** TP4056 charger module (26 × 17 mm blue board, USB-C on the left, DW01 + 8205A protection) flat facing +z, centred on
 *  `at`, `k` units per mm. `pins` (world): IN± beside the socket, OUT+ B+ B− OUT− down the right edge, `usb` the socket
 *  mouth, `rProg` the R3 resistor. `set(chrg, stdby, heat)` lights the red / blue LEDs and heats the chip. */
export function tp4056Module(parent: THREE.Object3D, at: V3, k = 0.5) {
  const g = add(parent, new THREE.Group(), at)
  const W = 26 * k
  const H = 17 * k
  box(g, [W, H, 1.6 * k], mat('#1d4fa8', { rough: 0.55 }), [0, 0, -0.8 * k])
  const tin = TIN()
  const dark = mat('#0c0d10', { rough: 0.8 })
  const ux = -W / 2 + 3.4 * k
  box(g, [7.3 * k, 8.9 * k, 3.2 * k], STEEL(), [ux, 0, 1.6 * k])
  box(g, [0.3 * k, 7.6 * k, 2 * k], dark, [ux - 3.7 * k, 0, 1.6 * k])
  for (const s of [-1, 1]) box(g, [1.6 * k, 1.2 * k, 0.4 * k], STEEL(), [ux + 2.6 * k, s * 5 * k, 0.2 * k])

  const pad = (x: number, y: number, text: string, align: LabelOpts['align']) => {
    cylinder(g, 1.1 * k, 0.12 * k, tin, [x, y, 0.06 * k], 'z', 20)
    cylinder(g, 0.45 * k, 0.14 * k, dark, [x, y, 0.08 * k], 'z', 14)
    add(g, label(text, { ...SILK, size: 0.85 * k, align }), [x + (align === 'left' ? 1.6 : -1.6) * k, y - 0.4 * k, 0.05 * k])
    return [at[0] + x, at[1] + y, at[2] + 0.2 * k] as V3
  }
  const px = W / 2 - 1.6 * k
  const ys = [6.6, 2.2, -2.2, -6.6].map((y) => y * k)
  const right = ['OUT+', 'B+', 'B-', 'OUT-'].map((t, i) => pad(px, ys[i], t, 'right'))
  const inP = pad(-W / 2 + 1.6 * k, 6.8 * k, 'IN+', 'left')
  const inM = pad(-W / 2 + 1.6 * k, -6.8 * k, 'IN-', 'left')

  const chip = (x: number, y: number, w: number, h: number, t: number, legs: number, pitch: number, text: string, body = mat('#25272d', { rough: 0.5 })) => {
    box(g, [w, h, t], body, [x, y, t / 2])
    for (let i = 0; i < legs; i++) {
      const lx = x + (i - (legs - 1) / 2) * pitch
      for (const s of [-1, 1]) box(g, [0.4 * k, 0.9 * k, 0.3 * k], tin, [lx, y + s * (h / 2 + 0.35 * k), 0.15 * k])
    }
    add(g, label(text, { size: Math.min(0.75 * k, (w / text.length) * 1.1), color: '#9aa0aa', glow: false }), [x, y - 0.35 * k, t + 0.02 * k])
  }
  const bodyMat = mat('#25272d', { rough: 0.5 }, true)
  litEpoxy(bodyMat)
  chip(0, 1.2 * k, 5 * k, 4 * k, 1.5 * k, 4, 1.27 * k, 'TP4056', bodyMat)
  chip(7 * k, -3.6 * k, 3 * k, 1.7 * k, 1.1 * k, 3, 0.95 * k, 'DW01')
  chip(6.6 * k, 2.6 * k, 3 * k, 4.4 * k, 1 * k, 4, 0.65 * k, '8205A')

  const smd = (x: number, y: number, w: number, color: string, vertical = false) => {
    const [sx, sy] = vertical ? [0.8 * k, w] : [w, 0.8 * k]
    box(g, [sx, sy, 0.5 * k], mat(color, { rough: 0.5 }), [x, y, 0.25 * k])
    for (const s of [-1, 1]) box(g, vertical ? [0.82 * k, 0.3 * k, 0.52 * k] : [0.3 * k, 0.82 * k, 0.52 * k], tin, vertical ? [x, y + (s * w) / 2, 0.26 * k] : [x + (s * w) / 2, y, 0.26 * k])
  }
  const rx = -3.6 * k
  const ry = -4.6 * k
  smd(rx, ry, 1.6 * k, '#1b1c20')
  add(g, label('R3', { ...SILK, size: 0.75 * k }), [rx, ry - 1.5 * k, 0.05 * k])
  smd(-0.8 * k, -4.6 * k, 2 * k, '#b48a5a')
  smd(2.6 * k, -4.6 * k, 2 * k, '#b48a5a')
  smd(3.4 * k, 1.2 * k, 2 * k, '#b48a5a', true)
  smd(-W / 2 + 9 * k, 5.6 * k, 1.6 * k, '#1b1c20')

  const led = (x: number, color: string) => {
    box(g, [1.6 * k, 0.8 * k, 0.4 * k], mat('#e8e8e8', { rough: 0.6 }), [x, 6.4 * k, 0.2 * k])
    const m = glowMat(color, 0)
    add(g, mesh(new THREE.BoxGeometry(1.1 * k, 0.75 * k, 0.4 * k), m), [x, 6.4 * k, 0.55 * k])
    const halo = glowHalo(g, [x, 6.4 * k, 1.2 * k], 0.9 * k)
    return (on: boolean) => {
      m.emissiveIntensity = on ? 1.6 : 0.05
      halo.set(on ? 0.7 : 0, color)
    }
  }
  const red = led(-0.6 * k, LED_RED)
  const blue = led(2.2 * k, '#3d7bff')
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x, at[1] + y, at[2] + z]
  return {
    group: g,
    pins: { inP, inM, outP: right[0], bP: right[1], bM: right[2], outM: right[3] },
    usb: w(ux - 3.7 * k, 0, 1.6 * k),
    rProg: w(rx, ry, 0.5 * k),
    chipTop: w(0, 1.2 * k, 1.5 * k),
    set(chrg: boolean, stdby: boolean, heat = 0) {
      red(chrg)
      blue(stdby)
      heatGlow(bodyMat, heat)
    },
  }
}

export type DcdcKind = 'lm2596' | 'mt3608' | 'xl6009'

type Can = [x: number, y: number, r: number, h: number]
interface DcdcLayout {
  size: [number, number]
  chip: [x: number, y: number, text: string, big: boolean]
  coils: Can[]
  toroid: boolean
  caps: Can[]
  ceramics: [number, number][]
  diode: [number, number]
  pot: [number, number]
}

const POT_CODE: Record<DcdcKind, string> = { lm2596: '103', mt3608: '104', xl6009: '503' }

/** Board layouts in mm from the centre (real modules: 43 × 21, 36 × 17, 48 × 23). */
const DCDC: Record<DcdcKind, DcdcLayout> = {
  lm2596: { size: [43, 21], chip: [-5.5, -4.6, 'LM2596S', true], coils: [[4.6, 3, 6.2, 5]], toroid: true, caps: [[-15.8, 2.6, 3.6, 10.5], [14, -5.6, 3.2, 8]], ceramics: [], diode: [-6, 6], pot: [15.2, 4.6] },
  mt3608: { size: [36, 17], chip: [-5, -3.4, 'MT3608', false], coils: [[-6, 3, 2.9, 4.5]], toroid: false, caps: [], ceramics: [[-13, 0], [13, 1]], diode: [2.6, 4.6], pot: [6, -3.6] },
  xl6009: { size: [48, 23], chip: [-8, -5.6, 'XL6009', true], coils: [[-7, 5.4, 4.6, 5.4], [6.5, 4.6, 4.6, 5.4]], toroid: false, caps: [[-18.5, 1.5, 3.2, 8], [18.5, 1.5, 3.2, 8]], ceramics: [[0, 5]], diode: [2.5, -6], pot: [11.8, -6] },
}

/** DC-DC module flat facing +z, centred on `at`, `k` units per mm: IN+/IN− pads on the left, OUT+/OUT− on the right, the
 *  controller, coil(s) (a copper toroid on the LM2596), electrolytics, SS34 diode and a blue 3296 multi-turn trim pot.
 *  `set(heat 0..1, coil 0..1)` heats the chip and lights the windings; `turn(frac)` spins the pot screw (25 turns end to end). */
export function dcdcModule(parent: THREE.Object3D, at: V3, kind: DcdcKind, k = 0.5) {
  const L = DCDC[kind]
  const g = add(parent, new THREE.Group(), at)
  const [W, H] = [L.size[0] * k, L.size[1] * k]
  box(g, [W, H, 1.6 * k], mat('#1d4fa8', { rough: 0.55 }), [0, 0, -0.8 * k])
  const tin = TIN()
  const dark = mat('#0c0d10', { rough: 0.8 })
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x * k, at[1] + y * k, at[2] + z * k]

  const pad = (x: number, y: number, text: string, align: LabelOpts['align']) => {
    cylinder(g, 1.3 * k, 0.12 * k, tin, [x * k, y * k, 0.06 * k], 'z', 20)
    cylinder(g, 0.55 * k, 0.14 * k, dark, [x * k, y * k, 0.08 * k], 'z', 14)
    add(g, label(text, { ...SILK, size: 1 * k, align }), [(x + (align === 'left' ? 2 : -2)) * k, (y - 0.5) * k, 0.05 * k])
    return w(x, y, 0.2)
  }
  const ex = L.size[0] / 2 - 1.8
  const ey = L.size[1] / 2 - 2
  const pins = { inP: pad(-ex, ey, 'IN+', 'left'), inM: pad(-ex, -ey, 'IN-', 'left'), outP: pad(ex, ey, 'OUT+', 'right'), outM: pad(ex, -ey, 'OUT-', 'right') }

  const chipMat = mat('#25272d', { rough: 0.5 }, true)
  litEpoxy(chipMat)
  const [cx, cy, text, big] = L.chip
  const [bw, bh, bt] = big ? [10, 9, 4.4] : [3, 1.6, 1.1]
  box(g, [bw * k, bh * k, bt * k], chipMat, [cx * k, cy * k, (bt / 2) * k])
  if (big) {
    box(g, [8 * k, 2 * k, 0.5 * k], tin, [cx * k, (cy + bh / 2 + 0.8) * k, 0.25 * k])
    for (let i = 0; i < 5; i++) box(g, [0.8 * k, 2.4 * k, 0.4 * k], tin, [(cx + (i - 2) * 1.7) * k, (cy - bh / 2 - 1) * k, 0.2 * k])
  } else for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(g, [0.4 * k, 0.8 * k, 0.3 * k], tin, [(cx + (i - 1) * 0.95) * k, (cy + s * 1.1) * k, 0.15 * k])
  add(g, label(text, { size: Math.min(1.1 * k, (bw / text.length) * 1.3 * k), color: '#9aa0aa', glow: false }), [cx * k, (cy - 0.4) * k, (bt + 0.03) * k])
  if (!big) add(g, label(text, { ...SILK, size: 1.1 * k }), [cx * k, (cy - 2.6) * k, 0.05 * k])

  const copper = mat('#b87333', { metal: 0.45, rough: 0.35 }, true)
  for (const [x, y, r, h] of L.coils) {
    if (L.toroid) {
      cylinder(g, r * 0.62 * k, h * 0.9 * k, mat('#3a3d3a', { rough: 0.8 }), [x * k, y * k, (h / 2) * k], 'z', 32)
      add(g, mesh(new THREE.TorusGeometry(r * 0.72 * k, r * 0.3 * k, 14, 40), copper), [x * k, y * k, (h / 2) * k])
    } else {
      cylinder(g, r * k, h * k, mat('#2a2b2e', { rough: 0.7 }), [x * k, y * k, (h / 2) * k], 'z', 32)
      cylinder(g, r * 0.78 * k, 0.2 * k, copper, [x * k, y * k, (h + 0.1) * k], 'z', 32)
      cylinder(g, r * 0.3 * k, 0.3 * k, mat('#2a2b2e', { rough: 0.7 }), [x * k, y * k, (h + 0.15) * k], 'z', 20)
    }
  }
  for (const [x, y, r, h] of L.caps) {
    cylinder(g, r * k, h * k, mat('#1f2430', { rough: 0.45 }), [x * k, y * k, (h / 2) * k], 'z', 32)
    cylinder(g, r * 0.92 * k, 0.1 * k, mat('#aab0b8', { metal: 0.4, rough: 0.35 }), [x * k, y * k, (h + 0.05) * k], 'z', 32)
    box(g, [r * 1.4 * k, 0.15 * k, 0.12 * k], dark, [x * k, y * k, (h + 0.12) * k])
    box(g, [0.15 * k, r * 1.4 * k, 0.12 * k], dark, [x * k, y * k, (h + 0.12) * k])
  }
  for (const [x, y] of L.ceramics) {
    box(g, [2 * k, 1.25 * k, 1 * k], mat('#b48a5a', { rough: 0.5 }), [x * k, y * k, 0.5 * k])
    for (const s of [-1, 1]) box(g, [0.4 * k, 1.27 * k, 1.02 * k], tin, [(x + s * 0.9) * k, y * k, 0.5 * k])
  }
  const [dx, dy] = L.diode
  box(g, [4.3 * k, 2.6 * k, 2.1 * k], mat('#1b1c20', { rough: 0.6 }), [dx * k, dy * k, 1.05 * k])
  box(g, [0.5 * k, 2.62 * k, 2.12 * k], mat('#c8ccd2', { rough: 0.5 }), [(dx - 1.6) * k, dy * k, 1.05 * k])
  add(g, label('SS34', { ...SILK, size: 0.8 * k }), [dx * k, (dy - 2.4) * k, 0.05 * k])

  const [px, py] = L.pot
  box(g, [9.5 * k, 4.8 * k, 10 * k], mat('#2c5fd6', { rough: 0.45 }), [px * k, py * k, 5 * k])
  const screw = add(g, new THREE.Group(), [(px + 3) * k, py * k, 10 * k])
  cylinder(screw, 1.1 * k, 0.6 * k, mat('#d6b25e', { metal: 0.45, rough: 0.3 }), [0, 0, 0.3 * k], 'z', 20)
  box(screw, [2 * k, 0.35 * k, 0.2 * k], dark, [0, 0, 0.62 * k])
  add(g, label(POT_CODE[kind], { size: 0.9 * k, color: '#e8eef6', glow: false }), [(px - 1.6) * k, (py - 0.4) * k, 10.05 * k])

  return {
    group: g,
    pins,
    chipTop: w(cx, cy, bt),
    coilTop: L.coils.map(([x, y, , h]) => w(x, y, h)),
    potTop: w(px + 3, py, 10.6),
    set(heat: number, coil = 0) {
      heatGlow(chipMat, heat)
      copper.emissive.set('#ff7a1a')
      copper.emissiveIntensity = 1.2 * clamp01(coil)
    },
    turn(frac: number) {
      screw.rotation.z = -frac * 25 * 2 * Math.PI
    },
  }
}

/** SG90 micro servo seen from above (horn up, +z); returns the horn group to rotate about z. */
export function sg90Servo(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [3.2, 1.6, 2.2], mat('#2a5bd7', { rough: 0.5 }), [0, 0, 0])
  box(g, [4.4, 0.25, 2.2], mat('#2a5bd7', { rough: 0.5 }), [0, 0, 0])
  const shaftAt: V3 = [-0.75, 0, 1.4]
  add(g, mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 20), mat('#f2f2f2')), shaftAt).rotation.x = Math.PI / 2
  const horn = add(g, new THREE.Group(), [shaftAt[0], 0, 1.75])
  box(horn, [0.5, 2.6, 0.2], mat('#f2f2f2'), [0, 0.9, 0])
  return horn
}

/** ESP32 DevKit face-on, centre `at`; `pin(i, top)` is header pin i (−7…7) on the top or bottom row, at its tip. */
export function esp32Board(parent: THREE.Object3D, at: V3, scale: number) {
  const board = add(parent, buildEsp32(), at)
  board.scale.setScalar(scale)
  board.rotation.x = Math.PI / 2
  return (i: number, top = true): V3 => [at[0] + i * scale, at[1] + (top ? 5 : -5) * scale, 3.5 * scale]
}

/** I²C sensor breakout face-on, `k` units per mm (20 × 16 mm PCB): a chip, the name in silk and a VCC GND SCL SDA header
 *  along the top edge. `pin(name)` is a header pin tip in `parent` space (while `group` isn't moved); `led(on)` lights
 *  the power LED, `chip(color, f)` glows the chip. */
export function i2cBreakout(parent: THREE.Object3D, at: V3, { name = '', color = '#5b2a86', k = 0.25, pins = ['VCC', 'GND', 'SCL', 'SDA'] } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const W = 20 * k
  const H = 16 * k
  box(g, [W, H, 1.6 * k], mat(color, { rough: 0.55 }), [0, 0, -0.8 * k])
  const chipMat = new THREE.MeshStandardMaterial({ color: '#16171b', roughness: 0.5, emissive: '#000000' })
  box(g, [5 * k, 5 * k, 1.2 * k], chipMat, [0, -1 * k, 0.6 * k])
  if (name) add(g, label(name, { ...SILK, size: 1.7 * k }), [0, -H / 2 + 2 * k, 0.05 * k])
  const tips = pins.map((p, i) => {
    const x = (i - (pins.length - 1) / 2) * 2.54 * k * 1.6
    box(g, [2.4 * k, 2.4 * k, 2.4 * k], mat('#141416', { rough: 0.7 }), [x, H / 2 - 1.6 * k, 1.2 * k])
    box(g, [0.6 * k, 0.6 * k, 6 * k], GOLD(), [x, H / 2 - 1.6 * k, 4 * k])
    add(g, label(p, { ...SILK, size: 1 * k }), [x, H / 2 - 4.2 * k, 0.05 * k])
    return [p, [at[0] + x, at[1] + H / 2 - 1.6 * k, at[2] + 7 * k] as V3] as const
  })
  const ledMat = glowMat(LED_RED, 0)
  add(g, mesh(new THREE.SphereGeometry(0.8 * k, 10, 8), ledMat), [W / 2 - 2 * k, -H / 2 + 2 * k, 0.4 * k])
  return {
    group: g,
    pin: (p: string) => tips.find(([q]) => q === p)![1],
    led: (on: number) => (ledMat.emissiveIntensity = 1.4 * on),
    chip(c: string, f: number) {
      chipMat.emissive.set(c)
      chipMat.emissiveIntensity = f
    },
  }
}

/** ESP32-CAM (AI-Thinker, 27 × 40 mm) face-on with the OV2640 lens toward +z, `k` units per mm. `lens()` = lens centre in
 *  world space (after the caller turns `group`); `glass` glows; `iris(f)` sets the aperture opening (1 = full lens). */
export function esp32Cam(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [27, 40, 1.6], mat('#1d2b25', { rough: 0.6 }), [0, 0, -0.8])
  box(g, [16, 17, 2.4], STEEL(), [0, -10, 1.2])
  add(g, label('ESP32-S', { ...SILK, color: '#3a3d44', size: 2.2 }), [0, -10, 2.45])
  add(g, label('ESP32-CAM', { ...SILK, size: 2 }), [0, -1, 0.05])
  for (const x of [-12.2, 12.2]) for (let i = 0; i < 8; i++) box(g, [1.6, 1.6, 2.4], mat('#141416', { rough: 0.7 }), [x, -17 + i * 2.54, 1.2])
  box(g, [10, 10, 3], mat('#141416', { rough: 0.6 }), [0, 9, 1.5])
  cylinder(g, 4.2, 5, mat('#1c1c1f', { rough: 0.5 }), [0, 9, 5.5], 'z', 28)
  const glass = glowMat('#5a7dff', 0.35)
  const iris = add(g, mesh(new THREE.CircleGeometry(3.4, 32), glass), [0, 9, 8.05])
  iris.castShadow = false
  box(g, [3, 3, 1.4], mat('#f5f2e6', { rough: 0.4 }), [9, 15, 0.7])
  const lensLocal = new THREE.Vector3(0, 9, 8.1)
  return {
    group: g,
    glass,
    iris: (f: number) => iris.scale.setScalar(Math.max(0.05, Math.min(1, f))),
    lens(): V3 {
      g.updateWorldMatrix(true, false)
      const v = g.localToWorld(lensLocal.clone())
      return [v.x, v.y, v.z]
    },
  }
}

const DRIVER_PINS = [
  ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR'],
  ['VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND'],
]

/** Pololu-footprint step driver (15 × 20 mm) face-on, `k` units per mm: A4988 (green, bare chip) or TMC2209 (dark, finned
 *  heatsink), the Vref trimmer, two rows of 8 pins. `pin(name, side)` = pin tip (world, `group` unmoved; side 0 = logic
 *  row on the left, 1 = power row); `chip(color, f)` glows the chip or heatsink; `trim(turn)` turns the pot (0…1). */
export function stepDriver(parent: THREE.Object3D, at: V3, kind: 'a4988' | 'tmc2209', k = 0.3) {
  const g = add(parent, new THREE.Group(), at)
  const W = 15.2 * k
  const H = 20.3 * k
  const tmc = kind === 'tmc2209'
  box(g, [W, H, 1.6 * k], mat(tmc ? '#1f2a44' : '#1d6b3a', { rough: 0.55 }), [0, 0, -0.8 * k])
  const chipMat = new THREE.MeshStandardMaterial({ color: tmc ? '#7d8590' : '#16171b', roughness: 0.5, metalness: tmc ? 0.4 : 0, emissive: '#000000' })
  if (tmc) for (let i = 0; i < 6; i++) box(g, [4.4 * k, 0.9 * k, 4 * k], chipMat, [0, (i - 2.5) * 1.5 * k - 1 * k, 2 * k])
  else box(g, [5 * k, 5 * k, 0.9 * k], chipMat, [0, -1 * k, 0.45 * k])
  const pot = add(g, new THREE.Group(), [0, H / 2 - 3.6 * k, 0.8 * k])
  cylinder(pot, 1.6 * k, 1.4 * k, mat('#e8e2d6', { rough: 0.5 }), [0, 0, 0], 'z', 20)
  box(pot, [2.4 * k, 0.4 * k, 0.4 * k], STEEL(), [0, 0, 0.8 * k])
  add(g, label(tmc ? 'TMC2209' : 'A4988', { ...SILK, size: 1.3 * k }), [0, -H / 2 - 1.6 * k, 0.05 * k])
  const tips = DRIVER_PINS.flatMap((row, side) =>
    row.map((name, i) => {
      const x = (side ? 1 : -1) * (W / 2 - 1.3 * k)
      const y = H / 2 - 1.5 * k - i * 2.54 * k
      box(g, [0.6 * k, 0.6 * k, 4 * k], GOLD(), [x, y, 2 * k])
      add(g, label(name, { ...SILK, size: 0.8 * k }), [x + (side ? -2.3 : 2.3) * k, y, 0.05 * k])
      return { name, side, at: [at[0] + x, at[1] + y, at[2] + 4 * k] as V3 }
    }),
  )
  return {
    group: g,
    pin: (name: string, side = 0) => tips.find((t) => t.name === name && t.side === side)!.at,
    trim: (turn: number) => (pot.rotation.z = -clamp01(turn) * 1.5 * Math.PI),
    chip(c: string, f: number) {
      chipMat.emissive.set(c)
      chipMat.emissiveIntensity = f
    },
  }
}
