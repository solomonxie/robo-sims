import * as THREE from 'three/webgpu'
import { BLACK_PLASTIC, STEEL, add, box, cylinder, lathe, mat, mesh, tube } from './kit'

export class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private length: number, private turns: number) {
    super()
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2
    return target.set(t * this.length, this.r * Math.cos(a), this.r * Math.sin(a))
  }
}

export const HOLDER = { length: 30.3, width: 8.3, height: 5.2 }

/** 18650 cell in an open single-cell holder; + at +x, leads exit the − end. */
export function buildBattery18650(): THREE.Group {
  const g = new THREE.Group()
  const { length: L, width: W, height: H } = HOLDER
  const abs = BLACK_PLASTIC()
  box(g, [L, 0.6, W], abs, [0, 0.3, 0])
  for (const z of [-1, 1]) box(g, [L, H * 0.55, 0.5], abs, [0, (H * 0.55) / 2, z * (W / 2 - 0.25)])
  for (const x of [-1, 1]) box(g, [0.8, H, W], abs, [x * (L / 2 - 0.4), H / 2, 0])

  // Cell: blue wrap, printed band, + nub, − flat.
  const cy = 0.6 + 3.66
  const len = 25.6
  cylinder(g, 3.66, len, mat('#2856c8', { rough: 0.35 }), [0.3, cy, 0], 'x', 40)
  cylinder(g, 3.67, 3, mat('#e9eef8', { rough: 0.4 }), [-3, cy, 0], 'x', 40)
  lathe(g, [[0, 0], [2.6, 0], [2.6, 0.15], [1.2, 0.2], [1.2, 0.6], [0, 0.6]], STEEL(), [0.3 + len / 2, cy, 0], 'x')
  cylinder(g, 3.2, 0.05, STEEL(), [0.3 - len / 2 - 0.03, cy, 0], 'x', 32)

  // Contacts: plate at +, spring at −.
  box(g, [0.15, 4, 3], STEEL(), [L / 2 - 0.9, cy, 0])
  const springStart = -L / 2 + 0.8
  add(g, mesh(new THREE.TubeGeometry(new Helix(1.5, 1.6, 5), 120, 0.12, 6), STEEL()), [springStart, cy, 0])

  // Leads out of the − end wall: red to the + tab, black to the spring.
  const red = mat('#d4282b', { rough: 0.5 })
  const black = mat('#202020', { rough: 0.5 })
  tube(g, [[L / 2 - 0.9, 1.2, 1.5], [L / 2 - 4, 0.9, 2.6], [-L / 2 + 2, 0.9, 2.6], [-L / 2 - 1, 1.2, 2.6], [-L / 2 - 4, 0.8, 2.6]], 0.3, red)
  tube(g, [[-L / 2 + 0.8, 1.2, -1], [-L / 2 - 1, 1.2, -1.6], [-L / 2 - 4, 0.8, -1.6]], 0.3, black)
  g.userData.leads = { pos: new THREE.Vector3(-L / 2 - 4, 0.8, 2.6), neg: new THREE.Vector3(-L / 2 - 4, 0.8, -1.6) }
  return g
}
