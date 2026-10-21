// Workshop safety close-ups: a 2S LiPo pouch pack, hobby balance charger, LiPo bag, a vent fire; for soldering: a
// side-view head with optional safety glasses, a fume plume split between the air you breathe and an extractor, a
// flying clipped lead and the near-field dome.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { GREY, HEAT, HIGH_V, LABEL, glowMat, setGlow } from './colors'
import { heatTint, smoke } from './heat'
import { cableRun } from './layout'
import { flatBox, shellMat } from './shapes'
import { label, liveLabel } from './text'
import { clamp01 } from './util'
import { lcdMat } from './workshop'

/** 2S pouch pack lying on its face at `at` (bottom centre): two cells side by side under a blue wrap, label, main leads and
 *  balance lead leaving the +x end. `set(puff, heat)` swells it (0…1) and tints it hot; `cellTop(i)` = label point. */
export function lipoPack(parent: THREE.Object3D, at: V3, name = '2S 2200 mAh 7.4 V') {
  const g = add(parent, new THREE.Group(), at)
  const body = add(g, new THREE.Group())
  const L = 7.4
  const H = 1.6
  const D = 3.4
  for (const s of [-1, 1]) box(body, [L / 2 - 0.15, H, D], mat('#c9ccd2', { metal: 0.3, rough: 0.4 }), [(s * L) / 4, H / 2, 0])
  box(body, [L * 0.7, H + 0.04, D + 0.04], mat('#2856c8', { rough: 0.5 }), [-L * 0.05, H / 2, 0])
  add(body, label(name, { size: 0.36, color: '#f2f2f2', glow: 0.3 }), [-L * 0.05, H / 2, D / 2 + 0.05])
  const tint = heatTint(body)
  const ends = { main: [L / 2 + 0.2, 0.6, 0.6] as V3, balance: [L / 2 + 0.2, 1.1, -0.9] as V3 }
  return {
    group: g,
    body,
    L,
    set(puff: number, heat: number) {
      body.scale.set(1, 1 + 0.9 * clamp01(puff), 1 + 0.15 * clamp01(puff))
      tint(heat)
    },
    cellTop: (i: number): V3 => [at[0] + (i === 0 ? -L / 4 : L / 4), at[1] + H + 1, at[2] + D / 2],
    end: (k: 'main' | 'balance'): V3 => [at[0] + ends[k][0], at[1] + ends[k][1], at[2] + ends[k][2]],
  }
}

/** Hobby balance charger at `at` (bottom centre): case, LCD face toward the camera with two live lines, main and balance
 *  ports on its −x side. `screen(line1, line2, colour)`. */
export function hobbyCharger(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [5.4, 3.2, 3.4], mat('#2a2c32', { rough: 0.5 }), [0, 1.6, 0])
  flatBox(g, [4.6, 1.8, 0.06], lcdMat(), [0, 1.9, 1.72])
  const l1 = liveLabel(g, [-2.1, 2.35, 1.8], { size: 0.3, align: 'left' })
  const l2 = liveLabel(g, [-2.1, 1.5, 1.8], { size: 0.3, align: 'left' })
  for (const [x, c] of [[-1.6, '#d8322c'], [-0.8, '#202226']] as const) cylinder(g, 0.22, 0.3, mat(c), [x, 0.5, 1.75], 'z', 12)
  box(g, [1.2, 0.4, 0.2], mat('#f2f2f2', { rough: 0.5 }), [1.2, 0.5, 1.75])
  const ports = { main: [at[0] - 1.2, at[1] + 0.5, at[2] + 1.9] as V3, balance: [at[0] + 1.2, at[1] + 0.5, at[2] + 1.9] as V3 }
  return {
    group: g,
    ports,
    screen(a: string, b: string, color: string) {
      l1.set(a, color)
      l2.set(b, color)
    },
  }
}

/** Charge leads: red/black main pair and a three-wire balance lead, plugged in or left dangling with its JST-XH plug. */
export function chargeLeads(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  const plug = mat('#f2f2f2', { rough: 0.5 })
  return {
    set(main: [V3, V3], bal: [V3, V3], plugged: boolean, floorY: number) {
      g.clear()
      const [a, b] = main
      for (const [dz, c] of [[0.25, '#d8322c'], [-0.25, '#202226']] as const) {
        const p = (v: V3, dy = 0): V3 => [v[0], v[1] + dy, v[2] + dz]
        cableRun(g, [p(a), p([a[0] + 1.4, floorY + 0.25, a[2]]), p([b[0] - 0.6, floorY + 0.25, b[2]]), p(b)], c, 0.14)
      }
      const [s, e] = bal
      const end: V3 = plugged ? e : [s[0] + 1.8, floorY + 0.2, s[2] + 1.8]
      ;(['#202226', '#d8322c', '#f2f2f2'] as const).forEach((c, i) => {
        const dz = (i - 1) * 0.12
        cableRun(g, [[s[0], s[1], s[2] + dz], [s[0] + 1, floorY + 0.2, s[2] + dz + (plugged ? 0.8 : 1.4)], [end[0], end[1], end[2] + dz]], c, 0.06)
      })
      box(g, [0.7, 0.3, 0.6], plug, end)
    },
  }
}

/** See-through LiPo bag round a pack at `at`, `size` = [x, y, z]. */
export function lipoBag(parent: THREE.Object3D, at: V3, size: V3) {
  const g = add(parent, new THREE.Group(), at)
  const m = add(g, mesh(new THREE.BoxGeometry(...size), shellMat('#d07a2c', 0.16, 0.6)), [0, size[1] / 2, 0])
  m.castShadow = false
  for (let k = -2; k <= 2; k++) box(g, [0.06, size[1], 0.06], mat('#b05a18'), [k * (size[0] / 5), size[1] / 2, size[2] / 2])
  add(g, label('LiPo bag', { size: 0.3, color: '#f0b070', glow: 0.4 }), [-size[0] / 2 + 1.1, size[1] + 0.4, size[2] / 2])
  return g
}

/** Flames and smoke from a vented pack at `at`, `width` across; `step(dt, on)`. */
export function ventFire(parent: THREE.Object3D, at: V3, width: number) {
  const g = add(parent, new THREE.Group(), at)
  const fumes = smoke(g, width, { count: 30, rise: 9 })
  const flameMat = glowMat(HEAT, 1.4)
  flameMat.transparent = true
  flameMat.opacity = 0.75
  flameMat.depthWrite = false
  const flames = [-1, 0, 1].map((i) => add(g, mesh(new THREE.ConeGeometry(0.9, 3, 12), flameMat), [i * (width / 3), 1.5, 0.4]))
  let t = 0
  return {
    step(dt: number, on: boolean) {
      t += dt
      fumes.step(dt, on ? 1 : 0)
      flames.forEach((f, i) => {
        f.visible = on
        f.scale.set(1, 0.8 + 0.4 * Math.abs(Math.sin(t * 7 + i * 2)), 1)
      })
      setGlow(flameMat, on && Math.sin(t * 11) > 0 ? HEAT : HIGH_V, 1.4)
    },
  }
}

/** Side-view head facing +x at `at`: skin, nose, eye, hair; `glasses(on)` shows safety glasses; `hit(f)` flashes the eye. */
export function benchHead(parent: THREE.Object3D, at: V3, r = 1.8) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.z = -0.35
  add(g, mesh(new THREE.SphereGeometry(r, 28, 20), mat('#e0b08a', { rough: 0.7 })), [0, 0, 0])
  add(g, mesh(new THREE.SphereGeometry(r * 1.02, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), mat('#3a2a20', { rough: 0.9 })), [-0.15, 0.1, 0]).rotation.z = 0.5
  const nose = add(g, mesh(new THREE.ConeGeometry(0.32, 0.8, 12), mat('#d9a47c', { rough: 0.7 })), [r * 0.98, -0.15, 0.2])
  nose.rotation.z = -Math.PI / 2
  const eyeMat = glowMat('#20242a', 0.2)
  add(g, mesh(new THREE.SphereGeometry(0.2, 12, 10), eyeMat), [r * 0.8, 0.35, r * 0.55])
  const specs = add(g, new THREE.Group())
  add(specs, mesh(new THREE.BoxGeometry(0.12, 0.9, 1.3), shellMat('#bfe3ff', 0.45, 0.05)), [r * 1.08, 0.35, r * 0.45]).castShadow = false
  box(specs, [0.12, 0.14, 1.3], mat('#2a2c32'), [r * 1.08, 0.82, r * 0.45])
  box(specs, [r * 1.1, 0.1, 0.1], mat('#2a2c32'), [r * 0.5, 0.75, r * 0.9])
  const eyeAt = new THREE.Vector3(r * 0.8, 0.35, r * 0.55)
  return {
    group: g,
    glasses(on: boolean) {
      specs.visible = on
    },
    hit(f: number) {
      setGlow(eyeMat, f > 0 ? HIGH_V : '#20242a', 0.2 + 1.2 * clamp01(f))
    },
    /** Eye and lens in scene coordinates. */
    eye: (): V3 => {
      const v = g.localToWorld(eyeAt.clone())
      return [v.x, v.y, v.z]
    },
    lens: (): V3 => {
      const v = g.localToWorld(new THREE.Vector3(r * 1.08, 0.35, r * 0.45))
      return [v.x, v.y, v.z]
    },
  }
}

/** Fume plume from `at`: a share rising into the breathing zone (tilted `upTilt` rad toward −x) and a share bent toward an
 *  extractor along +x; `step(dt, amount, captured)`, `reach(units)` = how far the captured stream runs. */
export function fumePlume(parent: THREE.Object3D, at: V3, upTilt = 0.35) {
  const up = add(parent, new THREE.Group(), at)
  up.rotation.z = upTilt
  const side = add(parent, new THREE.Group(), at)
  side.rotation.z = -1.25
  const rising = smoke(up, 0.6, { count: 26, rise: 6 })
  const pulled = smoke(side, 0.4, { count: 20, rise: 3 })
  return {
    step(dt: number, amount: number, captured: number) {
      rising.step(dt, amount * (1 - captured))
      pulled.step(dt, amount * captured)
    },
    reach(units: number) {
      side.scale.set(0.7, units / 3, 0.7)
    },
  }
}

/** Clipped lead snippet: `fly(from, to, u, bounce)` puts it u (0…1) along its path, bouncing back off at the end. */
export function leadSnippet(parent: THREE.Object3D) {
  const m = add(parent, mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), mat('#cfd3d8', { metal: 0.5, rough: 0.3 })))
  m.castShadow = false
  return {
    fly(from: V3, to: V3, u: number, bounce: boolean) {
      m.visible = u > 0 && u < 1
      const back = bounce && u > 0.7 ? (u - 0.7) / 0.3 : 0
      const f = Math.min(u, 0.7) / 0.7
      m.position.set(from[0] + (to[0] - from[0]) * f - back * 1.5, from[1] + (to[1] - from[1]) * f - back * back * 3, from[2] + (to[2] - from[2]) * f)
      m.rotation.z = u * 30
    },
  }
}

/** Translucent near-field dome over a source at `at`, radius `r`; `set(colour, opacity)`. */
export function nearDome(parent: THREE.Object3D, at: V3, r: number) {
  const m = shellMat(GREY, 0.12, 0.6)
  const d = add(parent, mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), m), at)
  d.castShadow = false
  const tag = liveLabel(parent, [at[0] + r * 0.72, at[1] + r * 0.72, 0.3], { size: 0.26, align: 'left' })
  return {
    set(color: string, opacity: number, text: string) {
      m.color.set(color)
      m.opacity = opacity
      tag.set(text, LABEL)
    },
  }
}
