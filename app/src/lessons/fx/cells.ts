// Inside a battery cell: electrodes, separator, electrolyte, and the ions that shuttle between them.
import * as THREE from 'three/webgpu'
import { Chemistry } from '../../core/physics'
import { STEEL, V3, add, box, cylinder, mat, mesh } from '../../models/kit'
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

/** Height of a bare 18650 of radius `r` (18 × 65 mm). */
export const cell18650Height = (r: number) => (r * 65) / 9

/** Bare 18650 standing on the origin's centre, axis y: blue wrap, + cap up (or down when `flipped`). */
export function cell18650(parent: THREE.Object3D, at: V3, r = 1, flipped = false) {
  const h = cell18650Height(r)
  const g = add(parent, new THREE.Group(), at)
  if (flipped) g.rotation.z = Math.PI
  cylinder(g, r, h - 0.1, mat('#2856c8', { rough: 0.35 }), [0, 0, 0], 'y', 32)
  cylinder(g, r * 1.004, h * 0.12, mat('#e9eef8', { rough: 0.4 }), [0, h * 0.3, 0], 'y', 32)
  cylinder(g, r * 0.4, 0.12, STEEL(), [0, h / 2, 0], 'y', 20)
  cylinder(g, r * 0.85, 0.04, STEEL(), [0, -h / 2 + 0.03, 0], 'y', 24)
  return g
}

const NICKEL = '#c4c8ce'
const WELD = '#4a4e55'
const WELD_FLASH = '#bfe0ff'

/** Nickel strip `w` × `d` lying flat at `at` (y = its underside), with `dots` weld points to animate via `weld(i, f)`:
 *  0 = not welded, (0, 1) = spark, 1 = cold weld. */
function nickelStrip(parent: THREE.Object3D, at: V3, w: number, d: number, dots: [number, number][]) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [w, 0.08, d], mat(NICKEL, { metal: 0.35, rough: 0.35 }), [0, 0.04, 0])
  const welds = dots.map(([x, z]) => {
    const m = glowMat(WELD_FLASH, 0)
    const dot = add(g, mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10), m), [x, 0.1, z])
    dot.castShadow = false
    return { dot, m }
  })
  const cold = new THREE.Color(WELD)
  const hot = new THREE.Color(WELD_FLASH)
  return {
    group: g,
    count: welds.length,
    weld(i: number, f: number) {
      const it = welds[i]
      it.dot.visible = f > 0
      it.m.color.lerpColors(hot, cold, f)
      it.m.emissive.lerpColors(hot, cold, f)
      it.m.emissiveIntensity = 2 * (1 - f)
    },
  }
}

/** `series` groups of `parallel` 18650s centred on the origin, alternating + up / + down so nickel strips zig-zag the string.
 *  `chain` runs − terminal → each cell → + terminal (y at the cell ends); `potentialAt(x, y)` is the 0…1 level along it.
 *  `weld(progress)` sparks the dots in build order, one per unit of progress. */
export function cellPackModel(parent: THREE.Object3D, series: number, parallel: number, { r = 1, dx = 2.3, dz = 2.3 } = {}) {
  const group = add(parent, new THREE.Group())
  const h = cell18650Height(r)
  const e = h / 2
  const xs = Array.from({ length: series }, (_, i) => (i - (series - 1) / 2) * dx)
  const zs = Array.from({ length: parallel }, (_, j) => (j - (parallel - 1) / 2) * dz)
  const plusUp = (i: number) => i % 2 === 0
  xs.forEach((x, i) => zs.forEach((z) => cell18650(group, [x, 0, z], r, !plusUp(i))))
  const depth = (parallel - 1) * dz + 1.3 * r
  const strip = (from: number, to: number, top: boolean) => {
    const cx = (xs[from] + xs[to]) / 2
    const dots: [number, number][] = []
    for (let i = from; i <= to; i++) for (const z of zs) for (const s of [-1, 1]) dots.push([xs[i] - cx + s * 0.38 * r, z])
    const s = nickelStrip(group, [cx, top ? e : -e, 0], xs[to] - xs[from] + 1.8 * r, depth, dots)
    if (!top) s.group.rotation.x = Math.PI
    return s
  }
  const strips = [strip(0, 0, false)]
  for (let i = 0; i < series - 1; i++) strips.push(strip(i, i + 1, plusUp(i)))
  strips.push(strip(series - 1, series - 1, plusUp(series - 1)))
  const plusY = (i: number) => (plusUp(i) ? e : -e)
  const chain = xs.flatMap((x, i): V3[] => [[x, -plusY(i), 0], [x, plusY(i), 0]])
  const dotCount = strips.reduce((s, st) => s + st.count, 0)
  return {
    group,
    h,
    xs,
    chain,
    minus: [xs[0], -e - 0.1, 0] as V3,
    plus: [xs[series - 1], plusY(series - 1) + Math.sign(plusY(series - 1)) * 0.1, 0] as V3,
    front: zs[zs.length - 1] + r,
    dotCount,
    potentialAt(x: number, y: number) {
      const i = Math.min(series - 1, Math.max(0, Math.round((x - xs[0]) / dx)))
      const up = (y * Math.sign(plusY(i)) + e) / h
      return Math.abs(y) < e - 0.05 ? (i + up) / series : (i + (up > 0.5 ? 1 : 0)) / series
    },
    weld(progress: number) {
      let k = 0
      for (const st of strips) for (let d = 0; d < st.count; d++) st.weld(d, lerp(0, 1, progress - k++))
    },
  }
}
