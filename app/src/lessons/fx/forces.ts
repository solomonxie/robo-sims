// Mechanics side views: a TT car with payload blocks, labelled force arrows, a scrolling floor tape, a coil spring.
import * as THREE from 'three/webgpu'
import { TT_CAR } from '../../core/physics'
import { STEEL, V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { Helix } from '../../models/power'
import { GREY, glowMat } from './colors'
import { flatBox, stretchArrow } from './shapes'
import { liveLabel } from './text'

const BLOCK_KG = 0.5

/** Side-on TT car facing +x, `k` units per metre, origin on the ground under its centre.
 *  `set(travel, loadKg, [rear, front])` spins the wheels by `travel` m (or each by its own) and stacks one brass block per 0.5 kg. */
export function sideCar(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  const wr = TT_CAR.wheelM * k
  const body: V3 = [0.2 * k, 0.045 * k, 0.13 * k]
  const top = wr + 0.25 + body[1]
  box(g, body, mat('#d8dbe2', { rough: 0.5 }), [0, top - body[1] / 2, 0])
  box(g, [0.07 * k, 0.022 * k, 0.03 * k], mat('#f2c12e', { rough: 0.55 }), [-0.035 * k, wr, body[2] / 2 - 0.3])
  const tyre = mat('#1c1c1f', { rough: 0.8 })
  const spokeM = glowMat(GREY, 0.6)
  const wheels = [-0.065, 0.065].map((x) => {
    const w = add(g, new THREE.Group(), [x * k, wr, body[2] / 2 + 0.2])
    cylinder(w, wr, 0.45, tyre, [0, 0, 0], 'z', 24)
    box(w, [wr * 1.6, 0.14, 0.08], spokeM, [0, 0, 0.27]).castShadow = false
    return w
  })
  const brass = mat('#b8923a', { metal: 0.4, rough: 0.4 })
  const bh = 0.022 * k
  const blocks = Array.from({ length: 6 }, (_, i) => box(g, [0.06 * k, bh, 0.06 * k], brass, [((i % 2) - 0.5) * 0.07 * k, top + bh * (Math.floor(i / 2) + 0.5) + 0.02, 0]))
  return {
    group: g,
    top,
    set(travel: number, loadKg: number, each: readonly number[] = [travel, travel]) {
      wheels.forEach((w, i) => (w.rotation.z = -each[i] / TT_CAR.wheelM))
      const nb = Math.round(loadKg / BLOCK_KG)
      blocks.forEach((b, i) => (b.visible = i < nb))
    },
  }
}

/** Arrow a→b with a text label just past the tip; hidden with its label when shorter than `min`. */
export function forceArrow(parent: THREE.Object3D, color: string, { r = 0.1, size = 0.3, min = 0.15 } = {}) {
  const draw = stretchArrow(parent, color, r)
  const tag = liveLabel(parent, [0, 0, 0], { size, color })
  return (a: V3, b: V3, text: string, labelShift: V3 = [0, 0, 0]) => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const len = Math.hypot(...d)
    const show = len >= min
    tag.group.visible = show
    draw(a, show ? b : a)
    if (!show) return
    const u = 0.55 / len
    tag.group.position.set(b[0] + d[0] * u + labelShift[0], b[1] + d[1] * u + labelShift[1], b[2] + 0.3 + labelShift[2])
    tag.set(text, color)
  }
}

/** Floor strip `len` wide at `at` with a tape mark every `step` units that scrolls left as `roll(x)` grows. */
export function scrollTape(parent: THREE.Object3D, at: V3, len: number, step: number) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [len, 0.3, 3], mat('#3a3f4a', { rough: 0.8 }), [0, -0.15, 0])
  const tapeM = glowMat(GREY, 0.4)
  const n = Math.floor(len / step)
  const marks = Array.from({ length: n }, () => flatBox(g, [0.08, 0.04, 2.6], tapeM, [0, 0.01, 0]))
  return (x: number) => marks.forEach((m, i) => (m.position.x = ((((i * step - x) % (n * step)) + n * step) % (n * step)) - len / 2 + step / 2))
}

/** Coil spring of radius `r` drawn from a to b in the screen plane. */
export function coilSpring(parent: THREE.Object3D, r: number, turns: number, thickness = 0.06) {
  const g = add(parent, new THREE.Group())
  add(g, mesh(new THREE.TubeGeometry(new Helix(r, 1, turns), turns * 16, thickness, 6), STEEL())).castShadow = false
  return (a: V3, b: V3) => {
    g.position.set(...a)
    g.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
    g.scale.x = Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
}
