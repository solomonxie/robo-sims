// Rotary potentiometer cut open: carbon track, wiper, collector ring, three pins.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL, TIN } from '../../models/kit'
import { glowHalo } from './circuit'
import { potentialColor } from './colors'
import { clamp01 } from './util'

const BODY_R = 3.15
const TRACK_R = 1.85
const TRACK_W = 0.8
const SWEEP = (270 * Math.PI) / 180
const PIN_DX = 2
const TAB_Y = -BODY_R - 0.3
const FOOT_Y = TAB_Y - 2.3
const SEGMENTS = 54

/** Clockwise angle from +y of the track point `s` (0 = pin 1 end, lower left; 1 = pin 3 end, lower right). */
const angleAt = (s: number) => -SWEEP / 2 + SWEEP * clamp01(s)
const onTrack = (s: number, r = TRACK_R): [number, number] => [Math.sin(angleAt(s)) * r, Math.cos(angleAt(s)) * r]

/** 16 mm rotary pot facing +z, real size × `scale`, front cover off; `at` is the shaft centre. The wiper sweeps 270°
 *  clockwise from pin 1 (left) to pin 3 (right); pin 2 is the wiper via the centre ring. `pins.a/w/b`: pin 1/2/3 feet.
 *  `set(turn 0..1, potential(s))` turns the wiper and tints the track (s = 0 at pin 1) and wiper tip by potential. */
export function rotaryPot(parent: THREE.Object3D, at: V3, { scale = 1.6 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]

  const steel = mat('#c4c9d1', { metal: 0.45, rough: 0.3 })
  const phenolic = mat('#7a5530', { rough: 0.7 })
  cylinder(group, BODY_R, 0.3, steel, [0, 0, -0.55], 'z', 48)
  cylinder(group, BODY_R - 0.1, 0.3, phenolic, [0, 0, -0.2], 'z', 48)
  const rim = add(group, mesh(new THREE.CylinderGeometry(BODY_R, BODY_R, 1.1, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide })), [0, 0, -0.15])
  rim.rotation.x = Math.PI / 2
  box(group, [2 * PIN_DX + 1.4, 1.6, 0.3], phenolic, [0, TAB_Y + 0.8, -0.2])

  const segs: THREE.MeshStandardMaterial[] = []
  for (let k = 0; k < SEGMENTS; k++) {
    const t1 = angleAt((k + 1) / SEGMENTS)
    const geo = new THREE.RingGeometry(TRACK_R - TRACK_W / 2, TRACK_R + TRACK_W / 2, 3, 1, Math.PI / 2 - t1, SWEEP / SEGMENTS + 0.004)
    const material = new THREE.MeshStandardMaterial({ color: '#202124', emissive: '#000000', emissiveIntensity: 0.55, roughness: 0.8 })
    add(group, mesh(geo, material), [0, 0, 0.01]).castShadow = false
    segs.push(material)
  }
  const silver = mat('#e3e6ea', { metal: 0.5, rough: 0.25 })
  add(group, mesh(new THREE.RingGeometry(0.45, 0.8, 32), silver), [0, 0, 0.02]).castShadow = false

  const tin = TIN()
  const pinX = [-PIN_DX, 0, PIN_DX]
  for (const x of pinX) {
    box(group, [0.5, 2.3, 0.12], tin, [x, TAB_Y - 1.15, -0.1])
    box(group, [0.5, 0.5, 0.14], silver, [x, TAB_Y + 0.25, 0.02])
  }
  for (const s of [0, 1]) {
    const [x, y] = onTrack(s)
    const [xi, yi] = onTrack(s, TRACK_R - TRACK_W / 2 + 0.05)
    const [xo, yo] = onTrack(s, TRACK_R + TRACK_W / 2 - 0.05)
    rod(group, [xi, yi, 0.06], [xo, yo, 0.06], 0.2, silver)
    const px = s ? PIN_DX : -PIN_DX
    rod(group, [x, y, 0.04], [px, TAB_Y + 0.4, 0.04], 0.14, silver)
  }
  rod(group, [0, -0.6, 0.04], [0, TAB_Y + 0.4, 0.04], 0.14, silver)

  const wiper = add(group, new THREE.Group(), [0, 0, 0.12])
  cylinder(wiper, 0.62, 0.16, steel, [0, 0, 0], 'z', 24)
  box(wiper, [0.34, TRACK_R, 0.05], STEEL(), [0, TRACK_R / 2, 0.02])
  for (const dx of [-0.1, 0.1]) rod(wiper, [dx, TRACK_R - 0.1, 0.04], [dx, TRACK_R + 0.12, -0.06], 0.05, STEEL())
  const tipMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#000000', emissiveIntensity: 0.9, roughness: 0.4 })
  add(wiper, mesh(new THREE.SphereGeometry(0.17, 14, 10), tipMat), [0, TRACK_R, 0.02])
  const knob = add(wiper, new THREE.Group(), [0, 0, 0.6])
  cylinder(knob, 0.55, 1.0, mat('#2a2b30', { rough: 0.55 }), [0, 0, 0], 'z', 28)
  box(knob, [0.16, 0.5, 0.06], mat('#f2f2f2', { emissive: '#777777' }), [0, 0.25, 0.52])
  const halo = glowHalo(group, [0, 0, 0.5], 0.7)

  const color = new THREE.Color()
  return {
    group,
    pins: { a: w(-PIN_DX, FOOT_Y), w: w(0, FOOT_Y), b: w(PIN_DX, FOOT_Y) },
    /** Track centreline at `s`, lifted `dz` (part units) off it. */
    track: (s: number, dz = 0): V3 => {
      const [x, y] = onTrack(s)
      return w(x, y, dz)
    },
    /** Track position under a world point, by its angle round the shaft. */
    trackAt(x: number, y: number) {
      const a = Math.atan2(x - at[0], y - at[1])
      return clamp01((a + SWEEP / 2) / SWEEP)
    },
    /** Where the pin-1 and pin-3 straps meet the pins. */
    tops: { a: w(-PIN_DX, TAB_Y + 0.4), b: w(PIN_DX, TAB_Y + 0.4) },
    set(turn: number, potential: (s: number) => number) {
      const u = clamp01(turn)
      wiper.rotation.z = -angleAt(u)
      segs.forEach((m, k) => potentialColor(potential((k + 0.5) / SEGMENTS), m.emissive))
      potentialColor(potential(u), color)
      tipMat.emissive.copy(color)
      const [x, y] = onTrack(u)
      halo.group.position.set(x, y, 0.5)
      halo.set(0.6, color)
    },
  }
}
