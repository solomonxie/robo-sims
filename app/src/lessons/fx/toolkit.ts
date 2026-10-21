// Tool kit bench: a pegboard with hand tools (flush cutters, strippers, ratchet crimper, safety glasses), an iron station,
// bench PSU, bench fume extractor, helping hands, and a glowing slot pad per tool (in use / missing). Face-on (xy plane).
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { GREY, LABEL, glowMat, setGlow } from './colors'
import { boxFan } from './heat'
import { flatBox, shellMat } from './shapes'
import { label, liveLabel } from './text'

/** Pegboard from x0 to x1, y0 to y1 at depth z, holes on a 1-unit grid. */
export function pegboard(parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, z = -4.5) {
  const g = add(parent, new THREE.Group())
  box(g, [x1 - x0, y1 - y0, 0.2], mat('#c9a77a', { rough: 0.85 }), [(x0 + x1) / 2, (y0 + y1) / 2, z])
  const xs = Math.floor(x1 - x0)
  const ys = Math.floor(y1 - y0)
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.09, 8), mat('#4a3a28', { rough: 1 }), xs * ys)
  const m = new THREE.Matrix4()
  for (let i = 0; i < xs; i++) for (let j = 0; j < ys; j++) holes.setMatrixAt(i * ys + j, m.makeTranslation(x0 + 0.5 + i, y0 + 0.5 + j, z + 0.11))
  add(g, holes)
  return g
}

export type HandToolKind = 'cutters' | 'strippers' | 'crimper'
const GRIP: Record<HandToolKind, string> = { cutters: '#d4282b', strippers: '#2a55c9', crimper: '#e8b021' }

/** Pliers-type hand tool hanging jaws up, face-on, pivot at `at`: two handles in a V, jaws by kind (flush blades, notched
 *  stripping jaws, crimp die block + ratchet). */
export function handTool(parent: THREE.Object3D, at: V3, kind: HandToolKind, s = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(s)
  const steel = mat('#b9bec6', { metal: 0.5, rough: 0.35 })
  const grip = mat(GRIP[kind], { rough: 0.6 })
  const len = kind === 'crimper' ? 4.4 : 3.4
  for (const side of [-1, 1]) {
    const h = add(g, new THREE.Group())
    h.rotation.z = side * 0.2
    box(h, [0.32, len * 0.25, 0.25], steel, [0, -len * 0.12, 0])
    box(h, [0.42, len * 0.75, 0.32], grip, [0, -len * 0.25 - len * 0.38, 0])
  }
  cylinder(g, 0.22, 0.34, steel, [0, 0, 0.05], 'z', 14)
  if (kind === 'cutters') {
    for (const side of [-1, 1]) add(g, mesh(new THREE.ConeGeometry(0.28, 1.1, 4), steel), [side * 0.14, 0.6, 0]).rotation.z = -side * 0.12
  } else if (kind === 'strippers') {
    box(g, [0.7, 1.3, 0.25], steel, [0, 0.75, 0])
    for (let i = 0; i < 4; i++) box(g, [0.74, 0.06, 0.27], mat('#2a2c32'), [0, 0.35 + i * 0.25, 0.02])
  } else {
    box(g, [1, 1.2, 0.4], steel, [0, 0.75, 0])
    for (let i = 0; i < 3; i++) box(g, [0.18 + i * 0.06, 0.12, 0.42], mat('#2a2c32'), [0, 0.45 + i * 0.3, 0.02])
    box(g, [0.9, 0.12, 0.2], steel, [0, -1.4, 0])
  }
  return g
}

/** Helping hands on a cast base at `at`: rod, two jointed arms with crocodile clips, a magnifier ring. */
export function helpingHands(parent: THREE.Object3D, at: V3, s = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(s)
  const steel = mat('#b9bec6', { metal: 0.5, rough: 0.35 })
  box(g, [3, 0.4, 1.6], mat('#2a2c32', { rough: 0.6 }), [0, 0.2, 0])
  cylinder(g, 0.08, 2.6, steel, [0, 1.6, 0])
  for (const side of [-1, 1]) {
    const arm = add(g, new THREE.Group(), [0, 2.4, 0])
    arm.rotation.z = side * 1.1
    cylinder(arm, 0.06, 1.6, steel, [0, 0.8, 0])
    const clip = add(arm, new THREE.Group(), [0, 1.7, 0])
    clip.rotation.z = -side * 1.4
    for (const d of [-1, 1]) box(clip, [0.12, 0.6, 0.12], mat('#c9ced6', { metal: 0.5 }), [d * 0.07, 0.3, 0]).rotation.z = d * 0.12
  }
  add(g, mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 28), mat('#2a2c32')), [0, 3.4, 0.2])
  add(g, mesh(new THREE.CircleGeometry(0.7, 28), shellMat('#cfe8ff', 0.25, 0.05)), [0, 3.4, 0.21]).castShadow = false
  return g
}

/** Safety glasses seen from the front, centre at `at`. */
export function safetyGlasses(parent: THREE.Object3D, at: V3, s = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(s)
  const frame = mat('#2a2c32', { rough: 0.5 })
  for (const side of [-1, 1]) {
    add(g, mesh(new THREE.BoxGeometry(1.3, 0.9, 0.08), shellMat('#bfe3ff', 0.45, 0.05)), [side * 0.72, 0, 0]).castShadow = false
    box(g, [1.3, 0.12, 0.12], frame, [side * 0.72, 0.45, 0])
    box(g, [0.1, 0.12, 1.2], frame, [side * 1.38, 0.4, -0.6])
  }
  box(g, [0.3, 0.12, 0.12], frame, [0, 0.3, 0])
  return g
}

/** Soldering station base at `at` (bottom centre): case, LCD with a live temperature line, knob. `screen(text, colour)`. */
export function ironStation(parent: THREE.Object3D, at: V3, s = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(s)
  box(g, [3.2, 2.2, 2.4], mat('#2a2c32', { rough: 0.5 }), [0, 1.1, 0])
  flatBox(g, [2.4, 0.9, 0.06], mat('#0d1a14', { emissive: '#06120c', rough: 0.3 }), [0, 1.5, 1.22])
  const lcd = liveLabel(g, [0, 1.5, 1.3], { size: 0.42 })
  cylinder(g, 0.35, 0.3, mat('#c9ced6', { metal: 0.4 }), [0, 0.55, 1.3], 'z', 18)
  return {
    group: g,
    screen(text: string, color: string) {
      lcd.set(text, color)
    },
  }
}

/** Bench power supply at `at` (bottom centre): two LCDs (volts, amps), knobs, red/black posts, CC lamp.
 *  `set(volts, amps, cc)`. */
export function benchSupply(parent: THREE.Object3D, at: V3, s = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(s)
  box(g, [3.6, 2.8, 3], mat('#3a3d44', { rough: 0.5 }), [0, 1.4, 0])
  const screen = (y: number) => {
    flatBox(g, [1.8, 0.7, 0.06], mat('#160a06', { emissive: '#1a0a04', rough: 0.3 }), [-0.6, y, 1.52])
    return liveLabel(g, [-0.6, y, 1.6], { size: 0.36 })
  }
  const vText = screen(2.2)
  const aText = screen(1.3)
  for (const y of [2.2, 1.3]) cylinder(g, 0.28, 0.3, mat('#1c1c1f'), [1.1, y, 1.6], 'z', 16)
  for (const [x, c] of [[-1, '#d4282b'], [0, '#202226']] as const) cylinder(g, 0.18, 0.4, mat(c), [x, 0.45, 1.6], 'z', 12)
  const ccMat = glowMat(GREY, 0.3)
  add(g, mesh(new THREE.SphereGeometry(0.12, 10, 8), ccMat), [1.1, 0.45, 1.55])
  add(g, label('CC', { size: 0.2, color: GREY, glow: 0.3 }), [1.1, 0.75, 1.55])
  return {
    group: g,
    set(volts: string, amps: string, cc: boolean, color: string) {
      vText.set(volts, color)
      aText.set(amps, color)
      setGlow(ccMat, cc ? '#ff4a3a' : GREY, cc ? 1.2 : 0.3)
    },
  }
}

/** Bench fume extractor: carbon-filter box with a fan on its −x face, centre at `at`. `spin(dt, rate)`. */
export function benchExtractor(parent: THREE.Object3D, at: V3, size = 3) {
  const g = add(parent, new THREE.Group(), at)
  const fan = boxFan(g, [0, 0, 0], size)
  fan.group.rotation.y = -Math.PI / 2
  box(g, [size * 0.53, size * 1.13, size * 1.13], mat('#3a3d44', { rough: 0.7 }), [size * 0.37, 0, 0])
  add(g, label('extractor', { size: 0.28, color: LABEL, glow: 0.5 }), [size * 0.17, size * 0.77, size * 0.6])
  return { group: g, spin: fan.spin }
}

/** Glowing pad behind / under a tool slot: `set(colour, level)`; level 0 hides it. `flat` lays it on the bench. */
export function slotPad(parent: THREE.Object3D, at: V3, size: [number, number], flat = false) {
  const m = glowMat(GREY, 0)
  m.transparent = true
  const p = flatBox(parent, [size[0], flat ? 0.04 : size[1], flat ? size[1] : 0.04], m, at)
  return {
    mesh: p,
    set(color: string, level: number) {
      p.visible = level > 0
      setGlow(m, color, 0.25 + 0.9 * level)
      m.opacity = 0.2 + 0.6 * level
    },
  }
}
