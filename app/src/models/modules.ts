import * as THREE from 'three/webgpu'
import { BLACK_PLASTIC, GOLD, STEEL, TIN, add, box, cylinder, header, lead, mat, mesh, range } from './kit'

const PCB_T = 0.63

/** DOIT ESP32 DevKit v1 (30-pin), antenna toward −x, header rows at z = ±5. */
export function buildEsp32(): THREE.Group {
  const g = new THREE.Group()
  const pcbY = 2.6 // PCB underside, resting on the header spacers
  const top = pcbY + PCB_T
  box(g, [20.2, PCB_T, 11.1], mat('#15171c', { rough: 0.5 }), [0, pcbY + PCB_T / 2, 0])
  const xs = range(15, -7)
  for (const z of [-5, 5]) header(g, xs, z, pcbY - 0.5, top + 0.3, -1.5)

  // ESP-WROOM-32: module PCB, shield can, exposed antenna with meander trace.
  box(g, [10, 0.3, 7], mat('#1d2a3c', { rough: 0.5 }), [-4.5, top + 0.15, 0])
  box(g, [6.8, 1.1, 6.6], mat('#c9ccd1', { metal: 0.45, rough: 0.3 }), [-1.8, top + 0.85, 0])
  const trace = GOLD()
  for (const z of range(6, -2.5, 1)) box(g, [2.4, 0.05, 0.18], trace, [-7.4, top + 0.33, z])
  for (const [i, z] of range(5, -2, 1).entries()) {
    box(g, [0.18, 0.05, 1], trace, [i % 2 ? -8.6 : -6.2, top + 0.33, z])
  }

  // USB, USB-UART bridge, regulator, EN/BOOT buttons, power LED.
  box(g, [2.4, 1.1, 3], STEEL(), [9.2, top + 0.55, 0])
  box(g, [2, 0.35, 2], BLACK_PLASTIC(), [5, top + 0.18, 0])
  box(g, [1.4, 0.6, 2.6], BLACK_PLASTIC(), [2.6, top + 0.3, 3.2])
  box(g, [0.6, 0.15, 2.6], TIN(), [3.4, top + 0.1, 3.2])
  for (const z of [-3.4, 3.4]) {
    box(g, [1.5, 0.5, 1.5], STEEL(), [7.6, top + 0.25, z])
    cylinder(g, 0.4, 0.4, BLACK_PLASTIC(), [7.6, top + 0.6, z], 'y', 16)
  }
  box(g, [0.5, 0.25, 0.3], mat('#ff3030', { emissive: '#ff2020' }), [3.6, top + 0.12, -3.6])
  return g
}

/** L298N module on standoffs; logic header (ENA..ENB) along the front at z = 6.8. */
export function buildL298n(): THREE.Group {
  const g = new THREE.Group()
  const pcbY = 1.6
  const top = pcbY + PCB_T
  box(g, [17, PCB_T, 17], mat('#b81d26', { rough: 0.5 }), [0, pcbY + PCB_T / 2, 0])
  for (const x of [-7.4, 7.4]) for (const z of [-7.4, 7.4]) cylinder(g, 0.55, pcbY, GOLD(), [x, pcbY / 2, z], 'y', 6)

  // Heatsink: back plate + fins, the L298 bolted to its front.
  const alu = mat('#232428', { metal: 0.3, rough: 0.5 })
  box(g, [9.5, 6.5, 0.6], alu, [0, top + 3.25, -2.2])
  for (const x of range(8, -4.4, 1.257)) box(g, [0.32, 6.5, 4], alu, [x, top + 3.25, -4.4])
  box(g, [7.8, 4, 1.4], BLACK_PLASTIC(), [0, top + 2.6, -1.2])
  for (const x of range(15, -3.5, 0.5)) lead(g, [[x, top + 0.6, -1.2], [x, top, -1.2]], 0.08)

  const blue = mat('#2167c9', { rough: 0.6 })
  const terminal = (positions: number, pos: [number, number, number], along: 'x' | 'z') => {
    const len = positions * 2
    const size: [number, number, number] = along === 'x' ? [len, 3.4, 3] : [3, 3.4, len]
    box(g, size, blue, [pos[0], top + 1.7, pos[2]])
    for (const i of range(positions)) {
      const off = -len / 2 + 1 + i * 2
      const p: [number, number, number] = along === 'x' ? [pos[0] + off, top + 3.45, pos[2]] : [pos[0], top + 3.45, pos[2] + off]
      cylinder(g, 0.7, 0.15, STEEL(), p, 'y', 16)
      box(g, [1.2, 0.05, 0.18], mat('#555a63'), [p[0], p[1] + 0.08, p[2]])
    }
  }
  terminal(2, [-7.2, 0, -2.5], 'z') // OUT1/OUT2
  terminal(2, [7.2, 0, -2.5], 'z') // OUT3/OUT4
  terminal(3, [-5.6, 0, 6.6], 'x') // 12V GND 5V

  const xs = range(6, -2.5)
  header(g, xs, 6.8, top + 0.5, top + 3.2, top - 0.6)
  for (const x of [-2.5, 2.5]) box(g, [0.95, 1.5, 0.95], BLACK_PLASTIC(), [x, top + 2.5, 6.8])

  // Filter caps and the 78M05 regulator.
  for (const x of [-4.4, 4.4]) {
    cylinder(g, 1.3, 4, mat('#1b1b1b', { rough: 0.4 }), [x, top + 2, 2.6], 'y', 24)
    cylinder(g, 1.22, 0.05, STEEL(), [x, top + 4.01, 2.6], 'y', 24)
  }
  box(g, [2.6, 1, 2.2], BLACK_PLASTIC(), [0.5, top + 0.5, 3.6])
  box(g, [2.6, 0.2, 1.2], TIN(), [0.5, top + 0.1, 2.1])
  box(g, [0.5, 0.25, 0.3], mat('#ff3030', { emissive: '#ff2020' }), [5.6, top + 0.12, 6.4])
  return g
}

/** HC-SR04 standing on its 4-pin header (VCC Trig Echo GND), transducers facing +z. */
export function buildHcSr04(): THREE.Group {
  const g = new THREE.Group()
  const pcbBottom = 1.8
  const pcbH = 7.9
  const cy = pcbBottom + pcbH / 2
  box(g, [17.7, pcbH, PCB_T], mat('#1d5bbd', { rough: 0.5 }), [0, cy, 0])
  const can = mat('#cdd0d4', { metal: 0.4, rough: 0.35 })
  const grille = mat('#2b2c30', { rough: 0.95 })
  for (const x of [-5.1, 5.1]) {
    cylinder(g, 3.15, 4.7, can, [x, cy, PCB_T / 2 + 2.35], 'z', 40)
    cylinder(g, 2.6, 0.06, grille, [x, cy, PCB_T / 2 + 4.72], 'z', 40)
  }
  // Crystal between the cans, driver chips on the back.
  const xtal = add(g, mesh(new THREE.CapsuleGeometry(0.45, 1.6, 4, 12), can), [0, pcbBottom + pcbH - 1.4, PCB_T / 2 + 0.45])
  xtal.rotation.z = Math.PI / 2
  for (const [x, y] of [[-4, cy + 1], [0, cy - 1.5], [4, cy + 1]]) box(g, [2, 1.6, 0.6], BLACK_PLASTIC(), [x, y, -PCB_T / 2 - 0.3])

  const xs = range(4, -1.5)
  box(g, [4, 1, 1], BLACK_PLASTIC(), [0, pcbBottom - 0.5, 0])
  for (const x of xs) lead(g, [[x, pcbBottom + 0.6, 0], [x, -1.5, 0]], 0.13, GOLD())
  return g
}

/** DHT11 in its blue grille housing, 4 legs in a row. */
export function buildDht11(): THREE.Group {
  const g = new THREE.Group()
  const bottom = 1
  const h = 6.1
  box(g, [4.7, h, 2.2], mat('#4a9ad8', { rough: 0.7 }), [0, bottom + h / 2, 0])
  const slot = mat('#163a5c', { rough: 1 })
  for (const x of range(4, -1.5)) for (const y of range(5, bottom + 1.2, 0.95)) box(g, [0.55, 0.55, 0.05], slot, [x, y, 1.11])
  for (const x of range(4, -1.5)) lead(g, [[x, bottom, 0], [x, -1.5, 0]], 0.11)
  return g
}
