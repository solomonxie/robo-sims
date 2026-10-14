import * as THREE from 'three/webgpu'
import { V3, add, cylinder, mat, mesh, rod } from '../../models/kit'
import { heatGlow } from './heat'
import { clamp01 } from './util'

const FUSE_L = 7.87
const FUSE_R = 0.985
const CAP_L = 2

/** 5×20 mm glass fuse centred at `at` along x, `scale` × the real part. `slow`: slow-blow, the element coiled round a core
 *  (more mass, more time); else a bare straight wire. `set(heat, melt)`: heat 0..1 glows the element, melt 0..1 parts it in
 *  the middle, pulls the halves back into beads and smokes the glass with metal vapour. `ends` are the cap tips. */
export function glassFuse(parent: THREE.Object3D, at: V3, { scale = 1, slow = false } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const half = FUSE_L / 2
  const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })
  cylinder(group, FUSE_R * 0.96, FUSE_L - 0.3, glass, [0, 0, 0], 'x', 32).castShadow = false
  const cap = mat('#c4c8cf', { metal: 0.45, rough: 0.3 })
  for (const s of [-1, 1]) {
    cylinder(group, FUSE_R + 0.04, CAP_L, cap, [s * (half - CAP_L / 2), 0, 0], 'x', 32)
    cylinder(group, FUSE_R * 0.7, 0.12, cap, [s * (half + 0.06), 0, 0], 'x', 24)
  }
  const span = half - CAP_L + 0.2
  if (slow) cylinder(group, 0.17, 2 * span, mat('#e6dcc2', { rough: 0.8 }), [0, 0, 0], 'x', 12)
  const metal = new THREE.MeshStandardMaterial({ color: '#d0d3d9', metalness: 0.4, roughness: 0.35 })
  const turns = 9
  const halves = [-1, 1].map((s) => {
    const anchor = add(group, new THREE.Group(), [s * (half - CAP_L + 0.2), 0, 0])
    if (slow) {
      const pts = Array.from({ length: 120 }, (_, i) => {
        const u = i / 119
        const a = 2 * Math.PI * turns * u
        return new THREE.Vector3(-s * span * u, 0.27 * Math.cos(a), 0.27 * Math.sin(a))
      })
      add(anchor, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.055, 6), metal))
    } else rod(anchor, [0, 0, 0], [-s * span, 0, 0], 0.07, metal, 8)
    const bead = add(anchor, mesh(new THREE.SphereGeometry(0.2, 12, 10), metal), [-s * span, slow ? 0.27 : 0, 0])
    return { anchor, bead, s }
  })
  const soot = new THREE.MeshStandardMaterial({ color: '#4a4a50', metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false })
  cylinder(group, FUSE_R * 0.9, 3.2, soot, [0, 0, 0], 'x', 32).castShadow = false
  const ends: [V3, V3] = [
    [at[0] - (half + 0.12) * scale, at[1], at[2]],
    [at[0] + (half + 0.12) * scale, at[1], at[2]],
  ]
  return {
    group,
    ends,
    set(heat: number, melt: number) {
      const m = clamp01(melt)
      heatGlow(metal, Math.max(clamp01(heat), m > 0 && m < 1 ? 1 - m : 0))
      for (const h of halves) {
        h.anchor.scale.x = 1 - 0.45 * m
        h.bead.visible = m > 0.01
        h.bead.scale.set(1 / (1 - 0.45 * m), 1, 1).multiplyScalar(0.4 + 0.8 * m)
      }
      soot.opacity = 0.45 * m
    },
  }
}
