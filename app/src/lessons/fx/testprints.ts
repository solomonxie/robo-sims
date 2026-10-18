// Test prints: a print board (sections left, rows + plot right), a banded tower (one band per setting, overhang tab each), strings across travel moves, a layer-by-layer block for failed prints, sliced-section slabs.
import * as THREE from 'three/webgpu'
import { V3, add, box, mat } from '../../models/kit'
import { GREY, LABEL, POWER } from './colors'
import { countBars } from './displays'
import { FILAMENT_COLOR } from './printer'
import { plotY, statusHeader, textRows, titledScope } from './rigs'
import { addLabel, liveLabel } from './text'

/** Tower of `bands` blocks (mm × k, bottom band 0), each with an overhang tab on +x; `set(i, color, droop 0…1, glow)`, `label(i, text, color)`. */
export function testTower(parent: THREE.Object3D, at: V3, k: number, bands: number, { w = 20, d = 20, bandH = 8, tab = 8 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const rows = Array.from({ length: bands }, (_, i) => {
    const m = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.55, emissive: FILAMENT_COLOR, emissiveIntensity: 0 })
    const y = (i + 0.5) * bandH * k
    box(group, [w * k, bandH * k * 0.94, d * k], m, [0, y, 0])
    const hinge = add(group, new THREE.Group(), [(w / 2) * k, y + bandH * k * 0.3, 0])
    if (tab > 0) box(hinge, [tab * k, bandH * k * 0.3, d * k * 0.8], m, [(tab / 2) * k, 0, 0])
    const text = liveLabel(group, [(-w / 2 - 1) * k, y, (d / 2) * k], { size: Math.min(0.32, bandH * k * 0.5), align: 'right' })
    return { m, y, hinge, text }
  })
  return {
    group,
    bandY: (i: number) => rows[i].y,
    set(i: number, color: string, droop = 0, glow = 0) {
      const r = rows[i]
      r.m.color.set(color)
      r.m.emissive.set(color)
      r.m.emissiveIntensity = glow
      r.hinge.rotation.z = -droop * 0.9
    },
    label: (i: number, text: string, color: string) => rows[i].text.set(text, color),
  }
}

export interface PrintString {
  a: V3
  b: V3
  sag: number
  r: number
}

/** Up to `max` sagging strings (8 rods each) in `parent` coordinates; `set(strings)`. */
export function stringWeb(parent: THREE.Object3D, max: number, color = FILAMENT_COLOR) {
  const S = 8
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }), max * S)
  im.frustumCulled = false
  im.castShadow = false
  parent.add(im)
  const M = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const u = new THREE.Vector3()
  const Y = new THREE.Vector3(0, 1, 0)
  const pt = (st: PrintString, f: number) => new THREE.Vector3().lerpVectors(new THREE.Vector3(...st.a), new THREE.Vector3(...st.b), f).add(new THREE.Vector3(0, -st.sag * 4 * f * (1 - f), 0))
  return {
    set(strings: readonly PrintString[]) {
      const n = Math.min(max, strings.length)
      for (let i = 0; i < n; i++) {
        const st = strings[i]
        for (let j = 0; j < S; j++) {
          const a = pt(st, j / S)
          const b = pt(st, (j + 1) / S)
          u.subVectors(b, a)
          q.setFromUnitVectors(Y, u.clone().normalize())
          M.compose(p.addVectors(a, b).multiplyScalar(0.5), q, s.set(st.r, u.length(), st.r))
          im.setMatrixAt(i * S + j, M)
        }
      }
      im.count = n * S
      im.instanceMatrix.needsUpdate = true
    },
  }
}

export interface LayerCell {
  dx: number
  dy: number
  grow: number
  color: string
}

/** Print of `layers` × `cols` slabs (mm × k, cols along x, bottom layer 0); `set(cell(layer, col))` offsets each slab by dx/dy mm, widens it by `grow` mm per side. */
export function layerBlock(parent: THREE.Object3D, at: V3, k: number, { w = 40, d = 20, layerH = 1, layers = 20, cols = 1 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55 }), layers * cols)
  im.frustumCulled = false
  im.castShadow = true
  group.add(im)
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const P = new THREE.Vector3()
  const S = new THREE.Vector3()
  const C = new THREE.Color()
  const cw = w / cols
  return {
    group,
    height: layers * layerH * k,
    set(cell: (layer: number, col: number) => LayerCell) {
      for (let i = 0; i < layers; i++)
        for (let j = 0; j < cols; j++) {
          const c = cell(i, j)
          const edge = cols === 1 ? 2 : j === 0 || j === cols - 1 ? 1 : 0
          const x = -w / 2 + (j + 0.5) * cw + c.dx + (cols === 1 ? 0 : j === 0 ? -c.grow / 2 : j === cols - 1 ? c.grow / 2 : 0)
          P.set(x * k, ((i + 0.5) * layerH + c.dy) * k, 0)
          S.set((cw + edge * c.grow) * k, layerH * k * 0.9, (d + 2 * c.grow) * k)
          M.compose(P, Q, S)
          im.setMatrixAt(i * cols + j, M)
          im.setColorAt(i * cols + j, C.set(c.color))
        }
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    },
  }
}

export interface Slab {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
  color: string
}

/** Up to `max` coloured boxes (mm × k) for sliced sections, supports and pins; `set(slabs)`. */
export function sliceSlabs(parent: THREE.Object3D, at: V3, k: number, max: number) {
  const group = add(parent, new THREE.Group(), at)
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55 }), max)
  im.frustumCulled = false
  im.castShadow = true
  group.add(im)
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const P = new THREE.Vector3()
  const S = new THREE.Vector3()
  const C = new THREE.Color()
  return {
    group,
    set(slabs: readonly Slab[]) {
      const n = Math.min(max, slabs.length)
      for (let i = 0; i < n; i++) {
        const b = slabs[i]
        M.compose(P.set(((b.x0 + b.x1) / 2) * k, ((b.y0 + b.y1) / 2) * k, ((b.z0 + b.z1) / 2) * k), Q, S.set(Math.max(1e-3, b.x1 - b.x0) * k, Math.max(1e-3, b.y1 - b.y0) * k, Math.max(1e-3, b.z1 - b.z0) * k))
        im.setMatrixAt(i, M)
        im.setColorAt(i, C.set(b.color))
      }
      im.count = n
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    },
  }
}

export const PRINT_PLOT = { x: 8.6, w: 12.4, y: -8.8, h: 8.2 }
/** Print board on a span-40 stage: status header, 3 rows top right, a titled plot bottom right, optional bars between;
 *  `bench` = turned bed plate + `sliceSlabs` (mm × k), `py` maps values onto the plot. */
export function printBoard(scene: THREE.Object3D, plotTitle: string, lo: string, hi: string, bars?: { title: string; names: readonly string[] }) {
  const P = PRINT_PLOT
  const head = statusHeader(scene)
  const rows = textRows(scene, 3, 2.4, 3.6, 0.28, 0.66)
  const plot = titledScope(scene, P.y, P.h, plotTitle, LABEL, 0, P.x, P.w)
  plot.lo.set(lo)
  plot.hi.set(hi)
  let tally: ReturnType<typeof countBars> | null = null
  if (bars) {
    addLabel(scene, bars.title, [2.4, 1.5, 0.3], GREY, 0.26, 'left')
    tally = countBars(scene, [10, 0.8, 0], bars.names, 3.6, { row: 0.56, size: 0.26, color: POWER })
  }
  const bench = (at: V3, k: number, w: number, d: number, max: number, turn = -0.25) => {
    const g = add(scene, new THREE.Group(), at)
    g.rotation.set(0.3, turn, 0)
    box(g, [w * k, 0.3, d * k], mat('#3a3f47', { rough: 0.6 }), [(w / 2 - 4) * k, -0.15, 0])
    return { g, slabs: sliceSlabs(g, [0, 0, 0], k, max) }
  }
  return { head, rows, plot, tally, bench, py: (min: number, max: number) => plotY(min, max, P.h) }
}
