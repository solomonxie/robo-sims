// Screws, nuts, heat-set inserts and a digital caliper, drawn `k` scene units per mm.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { Helix } from '../../models/power'
import { INK } from './colors'
import { liveLabel } from './text'

const SCREW_STEEL = () => mat('#c3c9d2', { metal: 0.35, rough: 0.35 }, true)
const BRASS = () => mat('#d4a642', { metal: 0.8, rough: 0.3 })

export interface ScrewLook {
  d: number
  pitch: number
  hex: number
  head: { dk: number; k: number; flush: boolean }
}

/** Screw hanging from its head: head above y = 0 (countersunk: sunk below it), thread down to y = −len·k. `thread` is its own material (tint it for locker). */
export function screwModel(parent: THREE.Object3D, s: ScrewLook, len: number, k: number, at: V3 = [0, 0, 0]) {
  const group = add(parent, new THREE.Group(), at)
  const steel = SCREW_STEEL()
  const thread = new THREE.MeshStandardMaterial({ color: '#c3c9d2', metalness: 0.35, roughness: 0.35 })
  const r = (s.d / 2) * k
  const depth = 0.6 * s.pitch * k
  const hk = s.head.k * s.d * k
  const rk = (s.head.dk * s.d * k) / 2
  if (s.head.flush) {
    add(group, mesh(new THREE.CylinderGeometry(rk, r, hk, 32), steel), [0, -hk / 2, 0])
  } else if (s.head.k < 0.8) {
    add(group, mesh(new THREE.SphereGeometry(rk, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel)).scale.y = hk / rk
  } else {
    cylinder(group, rk, hk, steel, [0, hk / 2, 0], 'y', 32)
  }
  const top = s.head.flush ? 0 : hk
  add(group, mesh(new THREE.CylinderGeometry((s.hex / 2) * k * 1.15, (s.hex / 2) * k * 1.15, Math.min(hk * 0.6, s.hex * k) + 0.01, 6), mat(INK, { rough: 0.9 })), [0, top - Math.min(hk * 0.3, (s.hex * k) / 2) + 0.005, 0])
  const start = s.head.flush ? hk : 0
  const shank = len * k - start
  cylinder(group, r - depth, shank, steel, [0, -start - shank / 2, 0], 'y', 20)
  const turns = Math.max(1, (shank - depth) / (s.pitch * k))
  const helix = add(group, mesh(new THREE.TubeGeometry(new Helix(r - depth / 1.6, shank - depth, turns), Math.ceil(turns * 14), depth / 1.6, 5), thread), [0, -start - depth / 2, 0])
  helix.rotation.z = -Math.PI / 2
  return { group, thread, steel, tip: -len * k }
}

/** Hex nut around the y axis, `af` across flats, `h` tall (bottom at y = 0); `nylon` adds the lock-nut collar. */
export function nutModel(parent: THREE.Object3D, af: number, h: number, k: number, at: V3 = [0, 0, 0], nylon = false) {
  const group = add(parent, new THREE.Group(), at)
  const m = SCREW_STEEL()
  const R = (af / Math.sqrt(3)) * k
  const nh = nylon ? h * 0.7 : h
  add(group, mesh(new THREE.CylinderGeometry(R, R, nh * k, 6), m), [0, (nh * k) / 2, 0]).rotation.y = Math.PI / 6
  const collar = new THREE.MeshStandardMaterial({ color: '#4f7ad8', roughness: 0.6 })
  if (nylon) {
    add(group, mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.95, h * 0.2 * k, 6), m), [0, (nh + h * 0.1) * k, 0]).rotation.y = Math.PI / 6
    cylinder(group, R * 0.8, h * 0.25 * k, collar, [0, (nh + h * 0.32) * k, 0], 'y', 24)
  }
  return { group, steel: m, collar }
}

/** Knurled brass insert around the y axis, `od` × `len` mm, top at y = 0. */
export function heatSetInsert(parent: THREE.Object3D, od: number, len: number, k: number, at: V3 = [0, 0, 0]) {
  const group = add(parent, new THREE.Group(), at)
  const brass = BRASS()
  const r = (od / 2) * k
  cylinder(group, r * 0.86, len * k, brass, [0, (-len * k) / 2, 0], 'y', 24)
  const bands = 4
  for (let i = 0; i < bands; i++) {
    const y = -((i + 0.5) / bands) * len * k
    const band = add(group, mesh(new THREE.CylinderGeometry(r, r, (len * k) / bands - 0.06 * k * 4, 12), brass), [0, y, 0])
    band.rotation.y = (i % 2 ? 1 : -1) * 0.3
  }
  cylinder(group, r * 0.5, 0.02, mat(INK, { rough: 0.9 }), [0, 0.01, 0], 'y', 20)
  return { group, brass, r }
}

/** Digital caliper, beam along +x above the jaws; outside jaws hang down from x = 0 (fixed) and x = gap (slider). `set(mm)` opens it and shows the reading. */
export function caliper(parent: THREE.Object3D, k: number, at: V3, reach = 20) {
  const group = add(parent, new THREE.Group(), at)
  const steel = mat('#c9ced6', { metal: 0.7, rough: 0.3 })
  const jawH = 4 * k
  box(group, [(reach + 30) * k, 1.6 * k, 0.4 * k], steel, [((reach + 30) / 2 - 6) * k, 0, 0])
  box(group, [2.5 * k, jawH, 0.4 * k], steel, [-1.25 * k, -jawH / 2, 0])
  const slider = add(group, new THREE.Group())
  box(slider, [2.5 * k, jawH, 0.4 * k], steel, [1.25 * k, -jawH / 2, 0])
  box(slider, [14 * k, 4 * k, 0.8 * k], mat('#2a2d34', { rough: 0.6 }), [8 * k, 1.2 * k, 0.4 * k])
  box(slider, [10 * k, 2.2 * k, 0.1 * k], mat('#9fb59a', { rough: 0.5, emissive: '#2a3a28' }), [8 * k, 1.4 * k, 0.85 * k])
  const reading = liveLabel(slider, [8 * k, 1.4 * k, 0.95 * k], { size: 1.2 * k, color: INK })
  return {
    group,
    set(mm: number, text = `${mm.toFixed(2)} mm`) {
      slider.position.x = mm * k
      reading.set(text, INK)
    },
  }
}
