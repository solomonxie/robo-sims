// PN junction on the flat silicon crystal: dopant layout, p/n backing, depletion-zone slab, metal end plates.
import * as THREE from 'three/webgpu'
import { box } from '../../models/kit'
import { potentialColor } from './colors'
import { ACCEPTOR, DONOR, Dopant, siliconCrystal } from './crystal'
import { partLetter } from './parts'

/** P-side sites (col, row) on a 4-row crystal, spread so every column gets one early; the n side is the mirror image. */
const P_SPOTS: [number, number][] = [[3, 1], [1, 2], [2, 0], [0, 3], [3, 3], [1, 0], [2, 2], [0, 1], [3, 2], [1, 1]]

/** Acceptors on the left half, donors on the right, interleaved so both sides ionize together. */
export function junctionDopants(cols: number, p: number, nd: number, rows = 4) {
  const half = cols / 2
  const map = new Map<number, Dopant>()
  for (let i = 0; i < Math.max(p, nd); i++) {
    const [c, r] = P_SPOTS[i]
    const col = c + half - 4
    if (i < p && col >= 0) map.set(r * cols + col, 'acceptor')
    if (i < nd && col >= 0) map.set((rows - 1 - r) * cols + (cols - 1 - col), 'donor')
  }
  return map
}

/** Tinted backing behind each half and a pale slab marking the depletion zone; `zone(from, to)` moves it. */
export function junctionBacking(parent: THREE.Object3D, width: number, height: number) {
  const glass = (color: string, opacity: number) =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity, roughness: 0.6, depthWrite: false })
  for (const [s, color] of [[-1, ACCEPTOR], [1, DONOR]] as const) box(parent, [width / 2, height, 0.2], glass(color, 0.16), [(s * width) / 4, 0, -1.4]).castShadow = false
  const slab = box(parent, [1, height + 0.6, 0.2], glass('#ffffff', 0.22), [0, 0, -1.2])
  slab.castShadow = false
  partLetter(parent, 'P', [-width / 2 + 1, -height / 2 - 1.4, 0], 1.4, ACCEPTOR)
  partLetter(parent, 'N', [width / 2 - 1, -height / 2 - 1.4, 0], 1.4, DONOR)
  return (from: number, to: number) => {
    slab.visible = to - from > 0.05
    slab.scale.x = Math.max(0.01, to - from)
    slab.position.x = (from + to) / 2
  }
}

/** Zone edges in scene units: total width on a √ scale (`k` at 1 µm), split like xp : xn. */
export function zoneEdges(d: { w: number; xp: number }, k: number, half: number, min = 0.5) {
  const w = Math.max(min, k * Math.sqrt(d.w / 1e-6))
  const f = d.w > 0 ? d.xp / d.w : 0.5
  return { from: -Math.min(half - 1, w * f), to: Math.min(half - 1, w * (1 - f)) }
}

/** Backed junction crystal between two metal plates (at ±`plateX`, `plateH` tall); `paint(left, right)` colours them by potential. */
export function junctionSlab(parent: THREE.Object3D, cols: number, pitch: number, dopants: Map<number, Dopant>, rows = 4) {
  const width = cols * pitch
  const height = rows * pitch
  const zone = junctionBacking(parent, width, height)
  const crystal = siliconCrystal(parent, { cols, rows, pitch, dopants, wrap: false, ionizeAfter: 0.2 })
  const plateX = width / 2 + 0.7
  const plateH = height + 0.6
  const plates = [-1, 1].map((s) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.4 })
    box(parent, [0.7, plateH, 2.4], material, [s * plateX, 0, 0])
    return material
  })
  const c = new THREE.Color()
  return {
    crystal,
    width,
    height,
    plateX,
    plateH,
    zone,
    paint(left: number, right: number) {
      for (const [m, f] of [[plates[0], left], [plates[1], right]] as const) {
        m.color.copy(potentialColor(f, c))
        m.emissive.copy(c).multiplyScalar(0.4)
      }
    },
  }
}
