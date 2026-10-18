// Calibration test prints: a banded tower (one band per setting, overhang tab each) and strings across travel moves.
import * as THREE from 'three/webgpu'
import { V3, add, box } from '../../models/kit'
import { FILAMENT_COLOR } from './printer'
import { liveLabel } from './text'

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
