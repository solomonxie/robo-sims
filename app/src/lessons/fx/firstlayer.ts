// First layer: a bed height map of tiles, and first-layer beads cut across under the nozzle.
import * as THREE from 'three/webgpu'
import { V3, add } from '../../models/kit'
import { FILAMENT_COLOR } from './printer'

/** n × n tiles, `size` wide, in a `holder` you can tilt; `set(h, color)` per cell (i, j) with h in scene units; `local(u, v, y)` for 0…1 bed coords. */
export function bedRelief(parent: THREE.Object3D, at: V3, size: number, n: number) {
  const holder = add(parent, new THREE.Group(), at)
  const cell = size / n
  const tiles = Array.from({ length: n * n }, (_, k) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 })
    const t = add(holder, new THREE.Mesh(new THREE.BoxGeometry(cell * 0.96, 1, cell * 0.96), m))
    const i = k % n
    const j = Math.floor(k / n)
    t.position.set((i + 0.5) * cell - size / 2, 0, size / 2 - (j + 0.5) * cell)
    return { t, m, i, j }
  })
  const local = (u: number, v: number, y = 0): V3 => [u * size - size / 2, y, size / 2 - v * size]
  return {
    holder,
    local,
    set(h: (i: number, j: number) => number, color: (i: number, j: number, out: THREE.Color) => void) {
      for (const { t, m, i, j } of tiles) {
        const y = h(i, j)
        t.scale.y = 0.25
        t.position.y = y - 0.125
        color(i, j, m.color)
        m.emissive.copy(m.color)
        m.emissiveIntensity = 0.3
      }
    },
  }
}

/** `count` first-layer lines cut across (stadiums, extruded into the screen) on a bed slab, nozzle above;
 *  `set(beadH, beadW, spacing, gap, color)` in mm, drawn at `k` scene units per mm. */
export function beadCut(parent: THREE.Object3D, at: V3, k: number, count: number, depth = 2) {
  const g = add(parent, new THREE.Group(), at)
  const bedM = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.6 })
  add(g, new THREE.Mesh(new THREE.BoxGeometry(count * 0.6 * k + 1.5, 0.4, depth * 1.2), bedM), [0, -0.2, 0])
  const m = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5, emissive: FILAMENT_COLOR, emissiveIntensity: 0.2 })
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, depth, 20)
  cyl.rotateX(Math.PI / 2)
  const box = new THREE.BoxGeometry(1, 1, depth)
  const beads = Array.from({ length: count }, () => ({ l: add(g, new THREE.Mesh(cyl, m)), r: add(g, new THREE.Mesh(cyl, m)), mid: add(g, new THREE.Mesh(box, m)) }))
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.6, roughness: 0.35, emissive: '#5a4210' })
  const nozzle = add(g, new THREE.Group())
  const cone = add(nozzle, new THREE.Mesh(new THREE.CylinderGeometry(0.8 * k, 0.45 * k, 0.8 * k, 24), brass))
  cone.position.y = 0.4 * k
  return {
    group: g,
    nozzle,
    set(h: number, w: number, spacing: number, gap: number, color: string) {
      m.color.set(color)
      m.emissive.set(color)
      beads.forEach((b, i) => {
        const x = (i - (count - 1) / 2) * spacing * k
        const r = h * k
        const flat = Math.max(0, w - h) * k
        b.l.scale.set(r, r, 1)
        b.r.scale.set(r, r, 1)
        b.l.position.set(x - flat / 2, r / 2, 0)
        b.r.position.set(x + flat / 2, r / 2, 0)
        b.mid.visible = flat > 1e-3
        b.mid.scale.set(Math.max(1e-3, flat), r, 1)
        b.mid.position.set(x, r / 2, 0)
      })
      nozzle.position.set(((count - 1) / 2) * spacing * k, Math.max(0, gap) * k, 0)
    },
  }
}
