// Inside a battery cell: electrodes, separator, electrolyte, and the ions that shuttle between them.
import * as THREE from 'three/webgpu'
import { Chemistry } from '../../core/physics'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { LABEL, glowMat } from './colors'
import { label } from './text'
import { emptyGroup, lerp } from './util'

export const ION_LI = '#c58cff'
export const ION_OH = '#5ad8e6'

const ANODE_MAT: Record<string, string> = { 'C₆': '#3a3d44', Zn: '#8f98a3', MH: '#5d6470' }
const CATHODE_MAT: Record<string, string> = { NMC: '#2c3a5c', 'FePO₄': '#3c5a3a', 'MnO₂': '#3d2f29', NiOOH: '#2c4a40' }
const ROWS = 4
const COLS = 6

/** Plain-text name for the stroke font (no sub/superscripts). */
export const plainChem = (s: string) => s.replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080))

/** Cutaway cell facing +z, `w` × `h`, anode on the left. `setChemistry(c)` rebuilds the electrodes;
 *  `step(dt, soc)` moves ions toward where that state of charge puts them. Collector tops are wire hooks. */
export function cellCutaway(parent: THREE.Object3D, at: V3, w = 13, h = 7) {
  const group = add(parent, new THREE.Group(), at)
  const ew = w * 0.3
  const shell = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false })
  add(group, mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 3), shell), [0, 0, 0]).castShadow = false
  const capMat = mat('#2a2c32', { rough: 0.5 })
  for (const s of [-1, 1]) box(group, [w + 0.8, 0.3, 3.2], capMat, [0, (s * (h + 0.6)) / 2, 0])
  const sepMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.45, roughness: 0.6, depthWrite: false })
  for (let y = -h / 2 + 0.2; y < h / 2; y += 0.7) box(group, [0.16, 0.5, 2.4], sepMat, [0, y + 0.25, 0])
  add(group, label('SEPARATOR', { size: 0.55, color: LABEL }), [0, h / 2 + 1, 0])

  const xA = -w / 2 + 0.35
  const xC = w / 2 - 0.35
  const hooks = { anode: [xA, h / 2 + 0.3, 0] as V3, cathode: [xC, h / 2 + 0.3, 0] as V3 }
  const electrodes = add(group, new THREE.Group())
  const electrolyte = add(group, mesh(new THREE.BoxGeometry(w - 0.4, h - 0.2, 2.2), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.12, depthWrite: false })))
  electrolyte.castShadow = false

  const n = ROWS * COLS
  const slot = (side: -1 | 1, k: number): V3 => {
    const col = Math.floor(k / ROWS)
    const row = k % ROWS
    const x = side * (w / 2 - 0.1 - ew + (col / (COLS - 1)) * (ew - 0.8))
    return [x, -h / 2 + ((row + 0.5) / ROWS) * h, 0.4]
  }
  const ionMesh = add(group, new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 8), glowMat(ION_LI), n))
  ionMesh.frustumCulled = false
  const pos = new Float32Array(n).fill(0)
  let chargedSide: -1 | 1 = -1
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()

  const place = (t: number) => {
    for (let k = 0; k < n; k++) {
      const a = slot(chargedSide, k)
      const b = slot((-chargedSide) as -1 | 1, k)
      const u = pos[k]
      const wob = 0.5 * Math.sin(Math.PI * u) * Math.sin(3 * t + k)
      p.set(lerp(a[0], b[0], u), lerp(a[1], b[1], u) + wob, a[2] + 0.3 * Math.sin(Math.PI * u))
      ionMesh.setMatrixAt(k, m.makeTranslation(p))
    }
    ionMesh.instanceMatrix.needsUpdate = true
  }

  let time = 0
  return {
    group,
    hooks,
    setChemistry(c: Chemistry) {
      emptyGroup(electrodes)
      const li = c.ion === 'Li+'
      chargedSide = li ? -1 : 1
      box(electrodes, [0.3, h, 2.4], li ? mat('#c8803f', { metal: 0.35, rough: 0.4 }) : mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [xA, 0, 0])
      box(electrodes, [0.3, h, 2.4], mat('#c9ccd2', { metal: 0.4, rough: 0.35 }), [xC, 0, 0])
      const plates = (x0: number, color: string) => {
        const plate = mat(color, { rough: 0.6 })
        for (let r = 0; r <= ROWS; r++) box(electrodes, [ew, 0.32, 2.2], plate, [x0, -h / 2 + (r / ROWS) * h + (r === 0 ? 0.16 : r === ROWS ? -0.16 : 0), 0])
        box(electrodes, [ew, h, 0.2], plate, [x0, 0, -1.1])
      }
      plates(-w / 2 + 0.5 + ew / 2, ANODE_MAT[c.anode])
      plates(w / 2 - 0.5 - ew / 2, CATHODE_MAT[c.cathode])
      const name = (text: string, sub: string, x: number, color: string) => {
        add(electrodes, label(text, { size: 0.6, color }), [x, -h / 2 - 1.1, 0.6])
        add(electrodes, label(plainChem(sub), { size: 0.75, color: '#e8e8e8' }), [x, -h / 2 - 2.2, 0.6])
      }
      name('ANODE −', c.anode, -w / 2 + 0.5 + ew / 2, '#7da0ff')
      name('CATHODE +', c.cathode, w / 2 - 0.5 - ew / 2, '#ff8080')
      ;(electrolyte.material as THREE.MeshStandardMaterial).color.set(li ? '#c9a8ff' : '#9ae6f0')
      ;(ionMesh.material as THREE.Material).dispose()
      ionMesh.material = glowMat(li ? ION_LI : ION_OH, 0.9)
    },
    /** `soc` 0..1; `snap` jumps there (on reset). Returns how many ions are mid-flight. */
    step(dt: number, soc: number, snap = false) {
      time += dt
      const out = Math.round((1 - soc) * n)
      let moving = 0
      for (let k = 0; k < n; k++) {
        const target = k < out ? 1 : 0
        pos[k] = snap ? target : pos[k] + Math.sign(target - pos[k]) * Math.min(Math.abs(target - pos[k]), dt * 0.9)
        if (pos[k] > 0 && pos[k] < 1) moving++
      }
      place(time)
      return moving
    },
  }
}
