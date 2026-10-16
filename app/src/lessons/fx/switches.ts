// Moving-contact controls, cut open: tact and toggle switches, rotary pot, E-stop, lever microswitch.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL, TIN } from '../../models/kit'
import { Helix } from '../../models/power'
import { glowHalo } from './circuit'
import { COPPER, RING, potentialColor, setGlow } from './colors'
import { partLetter } from './parts'
import { shellMat } from './shapes'
import { clamp01, lerp } from './util'

const world = (at: V3, scale: number) => (x: number, y: number, z = 0): V3 => [at[0] + x * scale, at[1] + y * scale, at[2] + z * scale]

const TW = 2.36
const DOME_Y = 0.42
const DOME_H = 0.36
const DOME_R = 0.86
const PAD_TOP = 0.3
const PLUNGE = 0.5
const LEG_Y = -0.9

/** 6 × 6 mm tact switch facing +z, real size × `scale`, front half cut away; `at` is the middle of the base's bottom, front
 *  legs at z = 0. The plunger presses a steel dome; it snaps through onto the centre pad, joining the left legs (rim) to the
 *  right legs (pad). `pins.a`/`pins.b`: left/right front leg feet. `set(press 0..1, closed)`: closed flattens the dome onto
 *  the pad and flashes it; pressed but open (a bounce) leaves it hovering just above. */
export function tactSwitch(parent: THREE.Object3D, at: V3, { scale = 2.6, cap = '#2a2b30' } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = world(at, scale)
  const zc = -TW / 2 + 0.45
  const black = mat('#1c1d22', { rough: 0.65 })
  box(group, [TW, 0.26, TW], black, [0, 0.13, zc])
  box(group, [TW, 0.95, 0.12], black, [0, 0.74, zc - TW / 2 + 0.06])
  for (const s of [-1, 1]) box(group, [0.14, 0.95, TW], black, [s * (TW / 2 - 0.07), 0.74, zc])
  add(group, mesh(new THREE.BoxGeometry(TW, 0.95, 0.05), shellMat('#6a6f7a', 0.1, 0.15)), [0, 0.74, zc + TW / 2]).castShadow = false
  box(group, [TW + 0.04, 0.07, TW + 0.04], STEEL(), [0, 1.25, zc])
  for (const s of [-1, 1]) box(group, [0.07, 0.75, 0.6], STEEL(), [s * (TW / 2 + 0.04), 0.9, zc])

  for (const s of [-1, 1])
    for (const z of [0, 2 * zc]) {
      const x = s * (TW / 2 + 0.1)
      rod(group, [s * (TW / 2 - 0.2), 0.2, z], [x, 0.2, z], 0.07, TIN())
      rod(group, [x, 0.2, z], [x, LEG_Y, z], 0.07, TIN())
    }
  const copper = mat('#c8803f', { metal: 0.35, rough: 0.35 })
  for (const s of [-1, 1]) box(group, [0.34, 0.06, 0.5], copper, [s * DOME_R, PAD_TOP - 0.02, zc])
  rod(group, [-TW / 2 + 0.2, 0.27, zc], [-DOME_R, 0.27, zc], 0.04, copper)
  rod(group, [-DOME_R, 0.27, zc], [-DOME_R, 0.27, 0], 0.04, copper)
  rod(group, [0, 0.27, zc], [TW / 2 - 0.2, 0.27, zc], 0.04, copper)
  rod(group, [TW / 2 - 0.2, 0.27, zc], [TW / 2 - 0.2, 0.27, 0], 0.04, copper)
  const pad = cylinder(group, 0.24, 0.06, copper, [0, PAD_TOP - 0.03, zc], 'y', 20)
  pad.castShadow = false

  const sphereR = (DOME_R ** 2 + DOME_H ** 2) / (2 * DOME_H)
  const domeGeo = new THREE.SphereGeometry(sphereR, 32, 8, 0, Math.PI * 2, 0, Math.asin(DOME_R / sphereR))
  domeGeo.translate(0, -(sphereR - DOME_H), 0)
  const dome = add(group, mesh(domeGeo, new THREE.MeshStandardMaterial({ color: '#d5dae2', metalness: 0.4, roughness: 0.25, side: THREE.DoubleSide })), [0, DOME_Y, zc])

  const plunger = add(group, new THREE.Group(), [0, 0, zc])
  cylinder(plunger, 0.68, 0.75, mat(cap, { rough: 0.55 }), [0, 1.62, 0], 'y', 28)
  cylinder(plunger, 0.3, 0.55, mat(cap, { rough: 0.55 }), [0, 1.0, 0], 'y', 16)
  const halo = glowHalo(group, [0, PAD_TOP + 0.05, zc + 0.9], 0.2)
  const closedFlat = (PAD_TOP + 0.02 - DOME_Y) / DOME_H
  const nearFlat = (PAD_TOP + 0.16 - DOME_Y) / DOME_H
  return {
    group,
    pins: { a: w(-(TW / 2 + 0.1), LEG_Y), b: w(TW / 2 + 0.1, LEG_Y) },
    /** Top of the plunger cap. */
    top: w(0, 2, zc),
    set(press: number, closed: boolean) {
      const p = clamp01(press)
      const s = closed ? closedFlat : p > 0.55 ? nearFlat : lerp(1, nearFlat, p / 0.55)
      dome.scale.y = s
      plunger.position.y = Math.max(-PLUNGE, DOME_H * (s - 1))
      halo.set(closed ? 0.9 : 0, RING)
    },
  }
}

const BW = 5.1
const BH = 3.8
const BD = 3.1
const LUG = 1.85
const LUG_Y = -2
const LUG_FOOT = LUG_Y - 0.15
const PIVOT_Y = BH + 0.2
const LEVER = 4.6
const TILT = 0.38
const ROCK = 0.16
const POST = 0.95
const ROCK_Y = 0.5 + POST + 0.42

/** Miniature SPDT toggle (MTS-102) facing +z, real size × `scale`, the front of its case cut away; `at` is the middle of the
 *  case bottom. Three lugs point down: `pins.a` (left), `pins.com`, `pins.b` (right). The bat lever pivots in the threaded
 *  bushing; below the pivot it pushes a copper rocker that joins COM to the lug on the far side from the lever.
 *  `set(throw 0..1, made)`: 0 = lever right, 1 = lever left; `made` is the lug the rocker touches ('a', 'b', or null while it
 *  bounces off), flashing it. */
export function toggleSwitch(parent: THREE.Object3D, at: V3, { scale = 1 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const w = world(at, scale)
  const steel = mat('#c4c9d1', { metal: 0.45, rough: 0.3 })
  box(group, [BW, 0.5, BD], mat('#1c1d22', { rough: 0.6 }), [0, 0.25, 0])
  box(group, [BW, BH - 0.5, 0.12], mat('#2a2c32', { rough: 0.5 }), [0, (BH + 0.5) / 2, -BD / 2 + 0.06])
  add(group, mesh(new THREE.BoxGeometry(BW, BH - 0.5, BD), shellMat('#7f8794', 0.12, 0.15)), [0, (BH + 0.5) / 2, 0]).castShadow = false
  box(group, [BW + 0.1, 0.18, BD + 0.1], steel, [0, BH, 0])
  for (const s of [-1, 1]) box(group, [0.1, 1.4, 1.4], steel, [s * (BW / 2 + 0.05), BH - 0.7, 0])
  cylinder(group, 1.18, 3.2, steel, [0, BH + 1.7, 0], 'y', 28)
  for (let k = 0; k < 7; k++) {
    const ring = add(group, mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 28), steel), [0, BH + 0.4 + k * 0.42, 0])
    ring.rotation.x = Math.PI / 2
  }
  cylinder(group, 1.75, 0.55, steel, [0, BH + 0.6, 0], 'y', 6)

  const lugs = [-LUG, 0, LUG]
  const tin = TIN()
  for (const x of lugs) {
    box(group, [0.75, 2.2, 0.14], tin, [x, LUG_Y / 2 - 0.1, 0])
    box(group, [0.5, 0.06, 0.06], mat('#0b0c0f'), [x, LUG_Y + 0.55, 0.09])
    const h = x ? POST : POST + 0.3
    cylinder(group, 0.12, h, tin, [x, 0.5 + h / 2, 0], 'y', 12)
    cylinder(group, 0.22, 0.12, mat('#e9e2c8', { metal: 0.4, rough: 0.3 }), [x, 0.5 + h + 0.06, 0], 'y', 16)
  }
  const copper = mat('#d08a45', { metal: 0.35, rough: 0.35 })
  const rocker = add(group, new THREE.Group(), [0, ROCK_Y, 0])
  box(rocker, [2 * LUG + 0.5, 0.18, 0.8], copper, [0, 0.09, 0])
  box(rocker, [0.6, 0.35, 0.6], mat('#3a3d45', { rough: 0.5 }), [0, 0.35, 0])

  const lever = add(group, new THREE.Group(), [0, PIVOT_Y, 0])
  rod(lever, [0, -0.2, 0], [0, ROCK_Y + 0.5 - PIVOT_Y, 0], 0.16, steel)
  const bat = add(lever, mesh(new THREE.CylinderGeometry(0.42, 0.26, LEVER, 20), steel), [0, LEVER / 2 + 0.6, 0])
  bat.castShadow = true
  cylinder(lever, 0.3, 0.9, steel, [0, 0.2, 0], 'z', 16)
  add(lever, mesh(new THREE.SphereGeometry(0.42, 16, 12), steel), [0, LEVER + 0.6, 0])
  const halos = lugs.filter((x) => x).map((x) => glowHalo(group, [x * 0.92, ROCK_Y - 0.25, 0.8], 0.45))
  return {
    group,
    pins: { a: w(-LUG, LUG_FOOT), com: w(0, LUG_FOOT), b: w(LUG, LUG_FOOT) },
    /** Lever tip for throw 0 and 1. */
    tip: (u: number): V3 => {
      const a = lerp(-TILT, TILT, u)
      return w(-Math.sin(a) * (LEVER + 0.6), PIVOT_Y + Math.cos(a) * (LEVER + 0.6))
    },
    set(u: number, made: 'a' | 'b' | null) {
      lever.rotation.z = lerp(-TILT, TILT, clamp01(u))
      rocker.rotation.z = made === 'a' ? ROCK : made === 'b' ? -ROCK : (u < 0.5 ? 0.3 : -0.3) * ROCK
      halos[0].set(made === 'a' ? 0.9 : 0, RING)
      halos[1].set(made === 'b' ? 0.9 : 0, RING)
    },
  }
}

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

/** E-stop side-on, cut open, `k` × lesson size: yellow housing, red mushroom on a plunger, and an NC contact (a bridge
 *  pushed up onto two fixed contacts). `pins` are the side terminals; `set(press 0..1, twist rad)` drops the plunger,
 *  which pulls the bridge off the contacts, and turns the cap (twist-to-release). */
export function estopButton(parent: THREE.Object3D, at: V3, k = 1) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(k)
  const yellow = mat('#f2c230', { rough: 0.5 })
  box(group, [4.4, 3.4, 0.4], yellow, [0, 0, -0.8])
  box(group, [4.4, 0.35, 1.6], yellow, [0, 1.55, -0.2])
  for (const s of [-1, 1]) box(group, [0.35, 3.4, 1.6], yellow, [s * 2.05, 0, -0.2])
  for (const s of [-1, 1]) {
    add(group, mesh(new THREE.SphereGeometry(0.3, 16, 12), STEEL()), [s * 1.1, 0.35, 0])
    rod(group, [s * 1.1, 0.35, 0], [s * 1.1, 0.9, 0], 0.1, COPPER())
    rod(group, [s * 1.1, 0.9, 0], [s * 2.5, 0.9, 0], 0.1, COPPER())
    cylinder(group, 0.28, 0.5, TIN(), [s * 2.6, 0.9, 0], 'x', 16)
  }
  const plunger = add(group, new THREE.Group())
  box(plunger, [3, 0.22, 0.5], STEEL(), [0, -0.06, 0])
  rod(plunger, [0, 0, 0], [0, 2.5, 0], 0.22, mat('#2b2e36', { rough: 0.6 }))
  const cap = add(plunger, new THREE.Group(), [0, 2.6, 0])
  const red = mat('#d8322c', { rough: 0.45 })
  cylinder(cap, 1.7, 0.45, red, [0, 0, 0], 'y', 40)
  const dome = add(cap, mesh(new THREE.SphereGeometry(1.7, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), red), [0, 0.2, 0])
  dome.scale.y = 0.35
  box(cap, [2.2, 0.1, 0.2], mat('#f2f2f2', { rough: 0.5 }), [0, 0.82, 0])
  cylinder(group, 0.65, 0.4, mat('#2b2e36', { rough: 0.6 }), [0, 1.9, 0], 'y', 24)
  const spring = new Helix(0.32, 1.3, 5)
  add(group, mesh(new THREE.TubeGeometry(spring, 60, 0.05, 6), STEEL()), [0, -1.5, 0]).rotation.z = Math.PI / 2
  return {
    group,
    pins: [-1, 1].map((s): V3 => [at[0] + s * 2.85 * k, at[1] + 0.9 * k, at[2]]) as [V3, V3],
    set(press: number, twist = 0) {
      plunger.position.y = -0.7 * clamp01(press)
      cap.rotation.y = twist
    },
  }
}

const MSW = { w: 20, h: 10, d: 6.4, lever: 18, hinge: [-8.5, 10.6] as const, rest: 14, full: 3, roller: 2.4 }

const mswAngle = (press: number) => lerp(MSW.rest, MSW.full, clamp01(press)) * (Math.PI / 180)
const mswTip = (press: number) => {
  const a = mswAngle(press)
  return [MSW.hinge[0] + MSW.lever * Math.cos(a) - MSW.roller * Math.sin(a), MSW.hinge[1] + MSW.lever * Math.sin(a) + MSW.roller * Math.cos(a)] as const
}
/** Unpressed roller's right and top edges from a microswitch's `at`, at `k` units per mm. */
export const microSwitchReach = (k: number): [number, number] => [(mswTip(0)[0] + MSW.roller) * k, (mswTip(0)[1] + MSW.roller) * k]

/** KW12 lever microswitch (20 × 10 mm) facing +z, `k` units per mm, see-through front; `at` = middle of the body's bottom.
 *  Lugs COM, NC, NO point down (`pins`). The lever is hinged top left with a roller on its right tip; pressing it pushes
 *  the plunger, which snaps the COM leaf from NC (top contact) down to NO. `set(press 0..1, made)`: `made` is the contact
 *  the leaf touches ('nc', 'no', or null mid-bounce), lit. */
export function microSwitch(parent: THREE.Object3D, at: V3, k = 0.2) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(k)
  const w = world(at, k)
  const { w: W, h: H, d: D } = MSW
  const black = mat('#1c1d22', { rough: 0.6 })
  box(group, [W, H, 0.8], black, [0, H / 2, -D / 2 + 0.4])
  box(group, [W, 0.8, D], black, [0, 0.4, 0])
  box(group, [W, 0.8, D], black, [0, H - 0.4, 0])
  for (const s of [-1, 1]) box(group, [0.8, H, D], black, [s * (W / 2 - 0.4), H / 2, 0])
  add(group, mesh(new THREE.BoxGeometry(W, H, 0.2), shellMat('#6a6f7a', 0.12, 0.15)), [0, H / 2, D / 2]).castShadow = false
  const lugX = { com: -7, nc: 0, no: 7 }
  for (const x of Object.values(lugX)) box(group, [2.4, 4.2, 0.5], TIN(), [x, -2.1, 0])
  Object.entries(lugX).forEach(([name, x]) => partLetter(group, name.toUpperCase(), [x, 2, D / 2 + 0.2], 1.2, '#ffffff'))

  const copper = mat('#c8803f', { metal: 0.35, rough: 0.35 })
  const z = D / 2 - 1.4
  box(group, [1, 4, 0.6], copper, [lugX.com, 2.6, z])
  const contact = () => new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.35 })
  const ncMat = contact()
  const noMat = contact()
  box(group, [0.6, 3.4, 0.6], copper, [5.6, 7.5, z])
  box(group, [5.6, 0.6, 0.6], copper, [2.8, 9.2, z])
  box(group, [0.6, 7.4, 0.6], copper, [lugX.nc, 5.4, z])
  box(group, [1.6, 0.8, 0.8], ncMat, [5.6, 6.2, z])
  box(group, [1.6, 0.8, 0.8], noMat, [5.6, 2, z])
  box(group, [0.6, 1.6, 0.6], copper, [lugX.no - 0.6, 1.4, z])
  box(group, [1.6, 0.6, 0.6], copper, [6.2, 1.6, z])
  const leaf = add(group, new THREE.Group(), [lugX.com, 4.6, z])
  box(leaf, [12.6, 0.35, 0.5], mat('#d5dae2', { metal: 0.4, rough: 0.25 }), [6.3, 0, 0])
  const plunger = add(group, new THREE.Group(), [0.5, 0, 0])
  box(plunger, [1.6, 3, 1.6], mat('#c23a2e', { rough: 0.5 }), [0, 0, 0])

  const lever = add(group, new THREE.Group(), [MSW.hinge[0], MSW.hinge[1], 0])
  const steel = STEEL()
  box(lever, [MSW.lever, 0.5, 3.6], steel, [MSW.lever / 2, 0, 0])
  cylinder(lever, MSW.roller, 2.8, mat('#2f3238', { rough: 0.5 }), [MSW.lever, MSW.roller, 0], 'z', 20)
  cylinder(lever, 0.7, 4, steel, [0, 0, 0], 'z', 12)
  return {
    group,
    pins: { com: w(lugX.com, -4.2), nc: w(lugX.nc, -4.2), no: w(lugX.no, -4.2) },
    set(press: number, made: 'nc' | 'no' | null) {
      lever.rotation.z = mswAngle(press)
      const top = MSW.hinge[1] + (plunger.position.x - MSW.hinge[0]) * Math.tan(mswAngle(press))
      plunger.position.y = Math.min(H + 1.2, top - 0.25) - 1.5
      leaf.rotation.z = made === 'no' ? -0.17 : made === 'nc' ? 0.09 : -0.04
      setGlow(ncMat, made === 'nc' ? RING : '#c8803f', made === 'nc' ? 0.9 : 0)
      setGlow(noMat, made === 'no' ? RING : '#c8803f', made === 'no' ? 0.9 : 0)
    },
  }
}
