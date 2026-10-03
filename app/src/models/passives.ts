import * as THREE from 'three/webgpu'
import { resistorColorBands } from '../core/resistorColors'
import { BLACK_PLASTIC, add, box, cylinder, lathe, lead, mat, mesh, rod, STEEL } from './kit'

const LEAD_R = 0.11
const INSERT = -1.5 // how deep leads go into the board

/** Dog-bone resistor body with color bands, along x, centered on the origin. */
export function resistorBody(ohms: number, bodyColor = '#d9c08c'): THREE.Group {
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
  const bandX = [-0.78, -0.42, -0.08, 0.72]
  resistorColorBands(ohms).forEach((color, i) => {
    const r = i === 0 || i === 3 ? 0.48 : 0.41
    cylinder(g, r, 0.18, mat(color, { rough: 0.5 }), [bandX[i], 0, 0], 'x')
  })
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

/** 5 mm LED; `setGlow(0..1)` lights it. Anode at −x. */
export function buildLed(color: string): THREE.Group {
  const g = new THREE.Group()
  const base = 1.2
  const epoxy = mat(color, { opacity: 0.82, rough: 0.15, emissive: '#000000' }, true)
  lathe(
    g,
    [
      [0, 0],
      [1.14, 0],
      [1.14, 0.4],
      [0.98, 0.4],
      [0.98, 2.4],
      ...Array.from({ length: 9 }, (_, i): [number, number] => {
        const a = ((i + 1) / 9) * (Math.PI / 2)
        return [0.98 * Math.cos(a), 2.4 + 0.98 * Math.sin(a)]
      }),
    ],
    epoxy,
    [0, base, 0],
  )
  // Anvil and post seen through the epoxy.
  box(g, [0.5, 1.2, 0.12], mat('#7c7f86', { metal: 0.3 }), [0.22, base + 1, 0])
  box(g, [0.14, 1.4, 0.12], mat('#7c7f86', { metal: 0.3 }), [-0.25, base + 1.1, 0])
  // Anode is the longer leg: a kink above the board shows the extra length.
  lead(g, [[-0.5, base, 0], [-0.5, base - 0.4, 0], [-0.75, base - 0.7, 0], [-0.5, base - 1, 0], [-0.5, INSERT, 0]], LEAD_R)
  lead(g, [[0.5, base, 0], [0.5, INSERT, 0]], LEAD_R)

  const light = new THREE.PointLight(color, 0, 20, 2)
  add(g, light, [0, base + 2, 0])
  g.userData.setGlow = (level: number) => {
    epoxy.emissive.set(color)
    epoxy.emissiveIntensity = level * 2.5
    light.intensity = level * 60
  }
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
