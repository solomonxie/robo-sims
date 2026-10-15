// Printed circuit boards: an explodable layer stack (copper, FR4, mask, silk) lying in the xz-plane, with traces, pads and vias.
import * as THREE from 'three/webgpu'
import { BoardLayer, LayerKind } from '../../core/physics'
import { V3, add, mat, mesh } from '../../models/kit'
import { COPPER, GREY } from './colors'
import { label } from './text'

const SHOWN: Record<LayerKind, number> = { silk: 0.04, mask: 0.08, copper: 0.14, prepreg: 0.45, core: 1.1 }
export const PCB_GREEN = '#1f6b3a'

function slabMat(kind: LayerKind) {
  if (kind === 'mask') return new THREE.MeshStandardMaterial({ color: PCB_GREEN, roughness: 0.35, transparent: true, opacity: 0.72, depthWrite: false })
  if (kind === 'copper') return COPPER()
  return mat(kind === 'core' ? '#b9a86e' : '#cbbd86', { rough: 0.75 })
}

/** Flat copper polyline of `width` on top of the parent (y = 0 is its mid-plane). */
export function flatTrace(parent: THREE.Object3D, pts: [number, number][], width: number, material: THREE.Material, thick = SHOWN.copper) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1]
    const [x1, z1] = pts[i]
    const len = Math.hypot(x1 - x0, z1 - z0)
    const seg = add(parent, mesh(new THREE.BoxGeometry(len + width, thick, width), material), [(x0 + x1) / 2, 0, (z0 + z1) / 2])
    seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
    seg.castShadow = false
  }
}

/** Flat text lying on the board, reading from +z. */
export function flatText(parent: THREE.Object3D, s: string, at: V3, size = 0.5, color = '#f2f2f2', align: 'left' | 'center' | 'right' = 'center') {
  const t = add(parent, label(s, { size, color, align, glow: 0.4 }), at)
  t.rotation.x = -Math.PI / 2
  t.castShadow = false
  return t
}

/**
 * A board's layers, top first, w × d in the xz-plane. Planes (copper named GND/POWER), FR4 and mask are slabs;
 * other copper and silk layers start empty for `layers[i].group`. `explode(k)` spreads them by `gap`·k.
 */
export function pcbStack(parent: THREE.Object3D, stack: BoardLayer[], { w = 20, d = 12, gap = 1.4, names = true, size = 0.42 } = {}) {
  const group = add(parent, new THREE.Group())
  let y = 0
  const layers = stack.map((layer) => {
    const thick = SHOWN[layer.kind]
    const base = y - thick / 2
    y -= thick
    const g = add(group, new THREE.Group(), [0, base, 0])
    const plane = layer.kind === 'copper' && /GND|POWER/.test(layer.name)
    const solid = plane || layer.kind === 'core' || layer.kind === 'prepreg' || layer.kind === 'mask'
    const material = slabMat(layer.kind)
    const slab = solid ? add(g, mesh(new THREE.BoxGeometry(w, thick, d), material)) : null
    if (slab && layer.kind === 'mask') slab.castShadow = false
    const tag = names ? add(g, label(layer.name, { size, color: GREY, align: 'right', glow: 0.5 }), [-w / 2 - 0.5, 0, d / 2]) : null
    if (tag) tag.castShadow = false
    return { layer, group: g, slab, material, thick, base, tag }
  })
  const vias: { from: number; to: number; barrel: THREE.Mesh }[] = []
  const at = (i: number) => layers[i].group.position.y
  const fitVia = (v: (typeof vias)[number]) => {
    const top = at(v.from) + layers[v.from].thick / 2
    const bot = at(v.to) - layers[v.to].thick / 2
    v.barrel.scale.y = Math.max(0.01, top - bot)
    v.barrel.position.y = (top + bot) / 2
  }
  return {
    group,
    layers,
    /** Total shown thickness when closed. */
    height: -y,
    explode(k: number) {
      layers.forEach((l, i) => (l.group.position.y = l.base - i * gap * k))
      vias.forEach(fitVia)
    },
    /** Plated hole from copper layer `from` to `to` (stack indices) with a ring pad on each copper layer between. */
    via(x: number, z: number, from: number, to: number, { r = 0.32, pad = 0.62, material = COPPER() as THREE.Material } = {}) {
      const barrel = add(group, mesh(new THREE.CylinderGeometry(r, r, 1, 20, 1, true), material), [x, 0, z])
      ;(barrel.material as THREE.Material).side = THREE.DoubleSide
      barrel.castShadow = false
      const rings: THREE.Mesh[] = []
      for (let i = from; i <= to; i++) {
        if (layers[i].layer.kind !== 'copper') continue
        const ring = add(layers[i].group, mesh(new THREE.RingGeometry(r, pad, 24), material), [x, layers[i].thick / 2 + 0.01, z])
        ring.rotation.x = -Math.PI / 2
        ;(ring.material as THREE.Material).side = THREE.DoubleSide
        ring.castShadow = false
        rings.push(ring)
      }
      const v = { from, to, barrel }
      vias.push(v)
      fitVia(v)
      return {
        barrel,
        show(on: boolean) {
          barrel.visible = on
          rings.forEach((m) => (m.visible = on))
        },
      }
    },
  }
}

