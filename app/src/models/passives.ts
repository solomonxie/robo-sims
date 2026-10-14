import * as THREE from 'three/webgpu'
import { Grade, resistorBands } from '../core/resistorColors'
import { BLACK_PLASTIC, add, box, cylinder, lathe, lead, mat, mesh, rod, STEEL, TIN } from './kit'

const LEAD_R = 0.11
const INSERT = -1.5 // how deep leads go into the board

/** Dog-bone resistor body with color bands (5 for a 1 % part), along x, centered on the origin. */
export function resistorBody(ohms: number, bodyColor = '#d9c08c', grade: Grade = 5): THREE.Group {
  const g = new THREE.Group()
  const half = 1.2
  lathe(
    g,
    [
      [0, -half],
      [0.36, -half],
      [0.47, -half + 0.2],
      [0.47, -half + 0.55],
      [0.4, -half + 0.75],
      [0.4, half - 0.75],
      [0.47, half - 0.55],
      [0.47, half - 0.2],
      [0.36, half],
      [0, half],
    ],
    mat(bodyColor, { rough: 0.55 }),
    [0, 0, 0],
    'x',
  )
  const bands = resistorBands(ohms, grade)
  const bandX = bands.length === 5 ? [-0.8, -0.46, -0.2, 0.06, 0.78] : [-0.78, -0.42, -0.08, 0.72]
  bands.forEach((color, i) => {
    const r = i === 0 || i === bands.length - 1 ? 0.48 : 0.41
    cylinder(g, r, 0.18, mat(color, { rough: 0.5 }), [bandX[i], 0, 0], 'x')
  })
  return g
}

/** Typical film-resistor body [length, diameter] in mm by power rating (W). */
export const RESISTOR_MM: Record<number, [number, number]> = { 0.125: [3.5, 1.8], 0.25: [6.1, 2.4], 0.5: [9, 3.2], 1: [11, 4.5], 2: [15, 5] }

/** `resistorBody` stretched to the real size of a `ratingW` part (the ¼ W body is 1×). */
export function resistorBodyFor(ohms: number, ratingW: number): THREE.Group {
  const [len, dia] = RESISTOR_MM[ratingW]
  const g = resistorBody(ohms)
  g.scale.set(len / RESISTOR_MM[0.25][0], dia / RESISTOR_MM[0.25][1], dia / RESISTOR_MM[0.25][1])
  return g
}

/** Axial resistor, leads 4 holes apart, body 1 unit above the board. */
export function buildResistor(ohms: number): THREE.Group {
  const g = new THREE.Group()
  const y = 1
  add(g, resistorBody(ohms), [0, y, 0])
  for (const s of [-1, 1]) {
    lead(g, [[s * 1.2, y, 0], [s * 1.8, y, 0], [s * 2, y - 0.2, 0], [s * 2, INSERT, 0]], LEAD_R)
  }
  return g
}

/** 5 mm LED epoxy outline, [radius, height] from the flange up. */
export const LED_DOME: [number, number][] = [
  [0, 0],
  [1.14, 0],
  [1.14, 0.4],
  [0.98, 0.4],
  [0.98, 2.4],
  ...Array.from({ length: 9 }, (_, i): [number, number] => {
    const a = ((i + 1) / 9) * (Math.PI / 2)
    return [0.98 * Math.cos(a), 2.4 + 0.98 * Math.sin(a)]
  }),
]
const LED_BASE = 1.2

/** 5 mm LED; `setGlow(0..1)` lights it. Anode at −x. */
export function buildLed(color: string): THREE.Group {
  const g = new THREE.Group()
  const base = LED_BASE
  const epoxy = mat(color, { opacity: 0.82, rough: 0.15, emissive: '#000000' }, true)
  lathe(g, LED_DOME, epoxy, [0, base, 0])
  // Anvil and post seen through the epoxy.
  box(g, [0.5, 1.2, 0.12], mat('#7c7f86', { metal: 0.3 }), [0.22, base + 1, 0])
  box(g, [0.14, 1.4, 0.12], mat('#7c7f86', { metal: 0.3 }), [-0.25, base + 1.1, 0])
  // Anode is the longer leg: a kink above the board shows the extra length.
  lead(g, [[-0.5, base, 0], [-0.5, base - 0.4, 0], [-0.75, base - 0.7, 0], [-0.5, base - 1, 0], [-0.5, INSERT, 0]], LEAD_R)
  lead(g, [[0.5, base, 0], [0.5, INSERT, 0]], LEAD_R)

  const light = new THREE.PointLight(color, 0, 20, 2)
  add(g, light, [0, base + 2, 0])
  g.userData.epoxy = epoxy
  g.userData.setGlow = (level: number) => {
    epoxy.emissive.set(color)
    epoxy.emissiveIntensity = level * 2.5
    light.intensity = level * 60
  }
  return g
}

const RGB_DIES = ['#ff2a1a', '#2bff5a', '#2a6bff']

/** 5 mm common-cathode RGB LED, diffused. Legs at x = −1.5, −0.5, 0.5, 1.5: red, cathode (longest), green, blue.
 *  `setMix(r, g, b)` lights each die 0..1. */
export function buildRgbLed(): THREE.Group {
  const g = new THREE.Group()
  const base = LED_BASE
  const epoxy = mat('#eef0f4', { opacity: 0.72, rough: 0.6, emissive: '#000000' }, true)
  lathe(g, LED_DOME, epoxy, [0, base, 0])
  const dies = RGB_DIES.map((c, i) => {
    const m = mat(c, { emissive: '#000000' }, true)
    box(g, [0.24, 0.24, 0.24], m, [(i - 1) * 0.3, base + 1.6, 0])
    return m
  })
  const legs = [-1.5, -0.5, 0.5, 1.5]
  legs.forEach((x, i) => {
    const top = (i - 1.5) * 0.4
    const kink: [number, number, number][] = i === 1 ? [[x, base - 0.6, 0], [x - 0.25, base - 0.9, 0], [x, base - 1.2, 0]] : []
    lead(g, [[top, base, 0], [top, base - 0.2, 0], [x, base - 0.5, 0], ...kink, [x, INSERT, 0]], LEAD_R)
  })
  const light = new THREE.PointLight('#ffffff', 0, 20, 2)
  add(g, light, [0, base + 2, 0])
  const mix = new THREE.Color()
  const tmp = new THREE.Color()
  g.userData.setMix = (...levels: number[]) => {
    mix.setRGB(0, 0, 0)
    levels.forEach((f, i) => {
      dies[i].emissive.set(RGB_DIES[i])
      dies[i].emissiveIntensity = 3 * f
      mix.add(tmp.set(RGB_DIES[i]).multiplyScalar(f))
    })
    const peak = Math.max(mix.r, mix.g, mix.b)
    epoxy.emissive.copy(mix).multiplyScalar(peak > 0 ? 1 / peak : 0)
    epoxy.emissiveIntensity = 1.6 * peak
    light.color.copy(epoxy.emissive)
    light.intensity = 60 * peak
  }
  return g
}

/** TO-92 body [width, height, depth] and how far its flat face sits in front of the round back's centre. */
export const TO92 = { w: 1.8, h: 1.8, r: 0.9, flat: 0.5, base: 1.4 }

/** TO-92 transistor, flat face toward +z, legs at x = −1, 0, 1 (E B C on a 2N2222). The epoxy is `userData.body`. */
export function buildTo92(): THREE.Group {
  const g = new THREE.Group()
  const { r, flat, h, base } = TO92
  const a = Math.acos(flat / r)
  const shape = new THREE.Shape()
  shape.absarc(0, 0, r, a - Math.PI / 2, (3 * Math.PI) / 2 - a, false)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 32 })
  geo.rotateX(-Math.PI / 2)
  const body = mat('#2a2b30', { rough: 0.45 }, true)
  add(g, mesh(geo, body), [0, base, 0])
  box(g, [1.1, 0.5, 0.02], mat('#5a5d66', { rough: 0.6 }), [0, base + h * 0.62, flat + 0.06])
  ;[-1, 0, 1].forEach((x) => lead(g, [[x * 0.5, base, 0], [x * 0.5, base - 0.4, 0], [x, base - 0.9, 0], [x, INSERT, 0]], LEAD_R))
  g.userData.body = body
  return g
}

/** TO-220: body [width, height, thickness], metal tab [thickness, height above the body], mounting hole radius and its
 *  centre below the tab top, and the body bottom above the board. */
export const TO220 = { w: 3.94, h: 3.54, t: 1.77, tab: 0.5, tabUp: 2.5, hole: 0.74, holeDown: 1.1, base: 1.6 }

/** TO-220 power package standing upright, label face +z, metal tab (= the middle leg) behind; legs at x = −1, 0, 1
 *  (G D S on a MOSFET). `legs` is the lead length below the body (default: into the board). */
export function buildTo220({ legs = TO220.base - INSERT } = {}): THREE.Group {
  const g = new THREE.Group()
  const { w, h, t, tab, tabUp, hole, holeDown, base } = TO220
  const plate = new THREE.Shape()
  plate.moveTo(-w / 2, 0)
  plate.lineTo(w / 2, 0)
  plate.lineTo(w / 2, h + tabUp)
  plate.lineTo(-w / 2, h + tabUp)
  plate.closePath()
  const bore = new THREE.Path()
  bore.absarc(0, h + tabUp - holeDown, hole, 0, Math.PI * 2, true)
  plate.holes.push(bore)
  const tabGeo = new THREE.ExtrudeGeometry(plate, { depth: tab, bevelEnabled: false, curveSegments: 24 })
  add(g, mesh(tabGeo, mat('#c9ccd2', { metal: 0.45, rough: 0.3 })), [0, base, -t / 2])
  const body = mat('#2a2b30', { rough: 0.45 }, true)
  box(g, [w, h, t - tab], body, [0, base + h / 2, tab / 2])
  box(g, [w * 0.62, h * 0.3, 0.02], mat('#5a5d66', { rough: 0.6 }), [0, base + h * 0.6, t / 2 + 0.01])
  const legMat = TIN()
  ;[-1, 0, 1].forEach((x) => {
    box(g, [0.5, 0.5, 0.2], legMat, [x, base - 0.25, -0.1])
    lead(g, [[x, base - 0.4, -0.1], [x, base - legs, -0.1]], LEAD_R, legMat)
  })
  g.userData.body = body
  return g
}

/** Disc ceramic capacitor, leads 2 holes apart. */
export function buildCeramicCap(): THREE.Group {
  const g = new THREE.Group()
  const disc = add(g, mesh(new THREE.SphereGeometry(1, 24, 16), mat('#d9912b', { rough: 0.5 })), [0, 2.2, 0])
  disc.scale.set(0.95, 0.95, 0.32)
  for (const s of [-1, 1]) lead(g, [[s * 0.35, 1.4, 0], [s * 1, 0.6, 0], [s * 1, INSERT, 0]], LEAD_R)
  return g
}

/** Radial electrolytic: sleeve stripe marks the (−) leg at +x. */
export function buildElectrolyticCap(): THREE.Group {
  const g = new THREE.Group()
  const r = 1.24
  const h = 4.3
  const y0 = 0.4
  cylinder(g, r, h, mat('#1e2f6e', { rough: 0.35 }), [0, y0 + h / 2, 0], 'y', 32)
  const stripe = mesh(new THREE.CylinderGeometry(r + 0.01, r + 0.01, h - 0.2, 16, 1, true, Math.PI / 2 - 0.5, 1), mat('#c6cde0'))
  add(g, stripe, [0, y0 + h / 2, 0])
  cylinder(g, r - 0.08, 0.05, STEEL(), [0, y0 + h + 0.01, 0], 'y', 32)
  const score = mat('#6d7480')
  box(g, [1.6, 0.04, 0.08], score, [0, y0 + h + 0.04, 0])
  box(g, [0.08, 0.04, 1.6], score, [0, y0 + h + 0.04, 0])
  cylinder(g, r - 0.1, 0.25, BLACK_PLASTIC(), [0, y0 + 0.1, 0], 'y', 24)
  for (const s of [-1, 1]) rod(g, [s * 0.5, y0, 0], [s * 0.5, INSERT, 0], 0.1, STEEL())
  return g
}
