// Structural parts: a bending cantilever link, a cross-section sketch, a tensile test specimen.
import * as THREE from 'three/webgpu'
import { MaterialKey, Rect } from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
import { GREY, HIGH_V, LOW_V, POWER, RING, glowMat, lit, setGlow } from './colors'
import { flatBox } from './shapes'
import { addLabel } from './text'

export const MATERIAL_TINT: Record<MaterialKey, string> = { al6061: '#c8d0dc', steel: '#8f98a6', petg: '#4fb3ff', pla: '#ff9a4d', acrylic: '#bfe9ff', plywood: '#d9b27a' }

const STRESS_STOPS = [[0, lit(LOW_V)], [1 / 3, lit(POWER)], [1 / 2, lit(RING)], [1, lit(HIGH_V)]] as const
/** Stress map colour for f = σ / strength: blue (idle), green at SF 3, yellow at SF 2, red at yield. */
export function stressColor(f: number, out = new THREE.Color()) {
  const x = Math.max(0, Math.min(1, f))
  const i = STRESS_STOPS.findIndex(([at]) => at >= x)
  if (i <= 0) return out.copy(STRESS_STOPS[0][1])
  const [a, ca] = STRESS_STOPS[i - 1]
  const [b, cb] = STRESS_STOPS[i]
  return out.copy(ca).lerp(cb, (x - a) / (b - a))
}
export const stressHex = (f: number) => `#${stressColor(f).getHexString()}`

/** Horizontal `stressColor` key `w` wide from `at` (left), ticked at SF 3, 2, 1. */
export function stressScale(parent: THREE.Object3D, at: V3, w: number, steps = 30) {
  for (let i = 0; i < steps; i++) flatBox(parent, [w / steps, 0.45, 0.05], glowMat(`#${stressColor((i + 0.5) / steps).getHexString()}`, 0.7), [at[0] + ((i + 0.5) / steps) * w, at[1], at[2]])
  ;[[0, 'σ 0'], [1 / 3, 'SF 3'], [1 / 2, 'SF 2'], [1, 'SF 1']].forEach(([f, t]) => addLabel(parent, t as string, [at[0] + (f as number) * w, at[1] - 0.6, at[2] + 0.2], GREY, 0.24))
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

/** Link from `root` along +x, `len` long, clamped in a block; `set(depth, drop, color)`: drop(u) = sag at u = 0…1 (+ down), color(u) per slice. */
export function cantileverBeam(parent: THREE.Object3D, root: V3, len: number, { segs = 36, width = 1.4, clampH = 6 } = {}) {
  const g = add(parent, new THREE.Group(), root)
  box(g, [1.4, clampH, 3], mat('#3a3f4a', { rough: 0.8 }), [-0.7, 0, 0])
  const slices = Array.from({ length: segs }, () => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.5 })
    const s = add(g, new THREE.Mesh(UNIT_BOX, m))
    s.castShadow = true
    return { s, m }
  })
  const tip: V3 = [...root]
  const set = (depth: number, drop: (u: number) => number, color: (u: number) => string | THREE.Color, glow = 0.3) => {
    const step = len / segs
    slices.forEach(({ s, m }, i) => {
      const [u0, u1] = [i / segs, (i + 1) / segs]
      const [y0, y1] = [-drop(u0), -drop(u1)]
      s.position.set(((u0 + u1) / 2) * len, (y0 + y1) / 2, 0)
      s.rotation.z = Math.atan2(y1 - y0, step)
      s.scale.set(Math.hypot(step, y1 - y0) * 1.04, depth, width)
      const c = color((u0 + u1) / 2)
      m.color.set(c)
      m.emissive.set(c)
      m.emissiveIntensity = glow
    })
    tip[0] = root[0] + len
    tip[1] = root[1] - drop(1)
  }
  return { group: g, set, tip }
}

/** Face-on cross-section at `at`, `k` scene units per metre, with its neutral axis; `set(rects, color)`. */
export function sectionSketch(parent: THREE.Object3D, at: V3, k: number, axis = 4, max = 4) {
  const g = add(parent, new THREE.Group(), at)
  flatBox(g, [axis, 0.05, 0.05], glowMat(GREY, 0.5), [0, 0, 0.12])
  const m = glowMat(GREY, 0.6)
  const boxes = Array.from({ length: max }, () => flatBox(g, [1, 1, 0.1], m, [0, 0, 0]))
  return {
    group: g,
    set(rects: readonly Rect[], color: string) {
      boxes.forEach((b, i) => {
        const r = rects[i]
        b.visible = !!r
        if (!r) return
        b.position.set(r[0] * k, r[1] * k, 0)
        b.scale.set(r[2] * k, r[3] * k, 1)
      })
      setGlow(m, color, 0.6)
    },
  }
}

/** Vertical dog-bone specimen between two grips, gauge from `at` up `gauge` long; the top grip rides up.
 *  `set(stretch, neck 0…1, gap, color)`: gap > 0 splits it in the middle. */
export function tensileSpecimen(parent: THREE.Object3D, at: V3, gauge: number, width: number, { slices = 30, depth = 0.6 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const gripM = mat('#2e323a', { rough: 0.7 })
  const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 })
  const end = (parentG: THREE.Object3D, sign: number) => {
    add(parentG, new THREE.Mesh(UNIT_BOX, m), [0, sign * 0.6, 0]).scale.set(width * 1.9, 1.2, depth)
    box(parentG, [width * 3, 1.8, 2.2], gripM, [0, sign * 2.1, 0])
  }
  end(g, -1)
  const top = add(g, new THREE.Group())
  end(top, 1)
  const parts = Array.from({ length: slices }, () => add(g, new THREE.Mesh(UNIT_BOX, m)))
  const set = (stretch: number, neck: number, gap: number, color: string) => {
    const L = gauge + stretch
    const h = L / slices
    parts.forEach((s, i) => {
      const uc = (i + 0.5) / slices
      const waist = 1 - neck * 0.55 * Math.exp(-(((uc - 0.5) / 0.1) ** 2))
      s.position.set(0, (i + 0.5) * h + (uc > 0.5 ? gap : 0), 0)
      s.scale.set(width * waist, h * (gap > 0 && Math.abs(uc - 0.5) < 0.5 / slices + 1e-9 ? 0.5 : 1.02), depth * waist)
    })
    top.position.y = L + gap
    m.color.set(color)
  }
  return { group: g, set, topY: () => at[1] + top.position.y + 3 }
}
