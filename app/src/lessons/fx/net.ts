// Networked devices face-on: phone, Wi-Fi router, robot car with an ESP32, radio ripples and packets in flight.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
import { GREY, LABEL, glowMat, setGlow } from './colors'
import { esp32Board } from './modules'
import { liveLabel } from './text'

/** Phone standing face-on, `k` = height / 3.2; `screen(color, f)` lights the display, `lines` are text rows on it. */
export function phoneModel(parent: THREE.Object3D, at: V3, k = 1, rows = 3) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [1.7, 3.2, 0.3], mat('#1b1d22', { rough: 0.4 }), [0, 0, -0.15])
  const scr = glowMat('#0b1013', 0)
  const s = add(g, mesh(new THREE.BoxGeometry(1.5, 2.85, 0.05), scr), [0, 0, 0.02])
  s.castShadow = false
  const lines = Array.from({ length: rows }, (_, i) => liveLabel(g, [0, 0.95 - i * 0.6, 0.1], { size: 0.24 }))
  return {
    group: g,
    lines,
    screen: (color: string, f: number) => setGlow(scr, color, f),
  }
}

/** Home Wi-Fi router: a box with three antennas and front LEDs; `led(i, color, f)`. */
export function routerModel(parent: THREE.Object3D, at: V3, k = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [5, 1.2, 2.6], mat('#e9ebef', { rough: 0.5 }), [0, 0, -1.3])
  const dark = mat('#2a2d36', { rough: 0.6 })
  for (const x of [-1.9, 0, 1.9]) rod(g, [x, 0.5, -1.8], [x * 1.15, 3.6, -1.8], 0.15, dark)
  const leds = [0, 1, 2, 3].map((i) => {
    const m = glowMat(GREY, 0)
    add(g, mesh(new THREE.SphereGeometry(0.12, 10, 8), m), [-1.2 + i * 0.8, 0, 0.02]).castShadow = false
    return m
  })
  return { group: g, top: [at[0], at[1] + 3.6 * k, at[2]] as V3, led: (i: number, color: string, f: number) => setGlow(leds[i], color, f) }
}

/** Robot car side-on with a face-on ESP32 on its flank; `antenna` = where radio leaves the board. */
export function robotCar(parent: THREE.Object3D, at: V3, k = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [8, 1.4, 4], mat('#d8dbe2', { rough: 0.55 }), [0, 0.2, -2])
  const tyre = mat('#1c1c1f', { rough: 0.8 })
  const hub = mat('#f2c230', { rough: 0.5 })
  for (const x of [-2.6, 2.6]) {
    cylinder(g, 1.4, 0.9, tyre, [x, -0.9, 0.1], 'z', 24)
    cylinder(g, 0.5, 1, hub, [x, -0.9, 0.2], 'z', 16)
  }
  const s = 0.26 * k
  const board: V3 = [at[0], at[1] + 2.4 * k, at[2] + 0.2 * k]
  esp32Board(parent, board, s)
  return { group: g, antenna: [board[0] - 7.4 * s, board[1], board[2] + 0.6 * k] as V3 }
}

/** Point `u` of the way from `a` to `b`, lifted into an arc of height `lift`. */
export const arcAt = (a: V3, b: V3, u: number, lift: number): V3 => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u + Math.sin(Math.PI * u) * lift,
  a[2] + (b[2] - a[2]) * u,
]

/** Expanding radio rings around `at` (in the screen plane); `set(t, color, f)` with `t` in seconds. */
export function ripples(parent: THREE.Object3D, at: V3, { count = 3, reach = 4, period = 1.2 } = {}) {
  const rings = Array.from({ length: count }, () => {
    const m = glowMat(GREY, 0)
    m.transparent = true
    const o = add(parent, mesh(new THREE.TorusGeometry(1, 0.05, 6, 48), m), at)
    o.castShadow = false
    return { o, m }
  })
  return (t: number, color: string, f: number) =>
    rings.forEach((r, i) => {
      const u = (t / period + i / count) % 1
      r.o.scale.setScalar(0.3 + u * reach)
      setGlow(r.m, color, f * (1 - u))
      r.m.opacity = f * (1 - u)
      r.o.visible = f > 0
    })
}

/** A pool of packets in flight: header (grey) + payload (colour) blocks, `w` long, with a tag above.
 *  Each frame: `begin()`, `put(…)` per packet, `end()` hides the rest. Keep put order stable so tags rarely rebuild. */
export function packetPool(parent: THREE.Object3D, n: number, h = 0.55) {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const items = Array.from({ length: n }, () => {
    const g = add(parent, new THREE.Group())
    const hm = glowMat(GREY, 0.5)
    const pm = glowMat(GREY, 1)
    const hdr = add(g, mesh(geo, hm))
    const pay = add(g, mesh(geo, pm))
    hdr.castShadow = pay.castShadow = false
    const tag = liveLabel(g, [0, h * 1.3, 0], { size: h * 0.75 })
    return { g, hm, pm, hdr, pay, tag }
  })
  let used = 0
  return {
    begin: () => (used = 0),
    put(at: V3, color: string, { w = 1, payload = 1, text = '', fade = 1 } = {}) {
      const it = items[used++]
      if (!it) return
      it.g.visible = true
      it.g.position.set(...at)
      const wh = Math.max(0.01, w * (1 - payload))
      const wp = Math.max(0.01, w * payload)
      it.hdr.scale.set(wh, h, h)
      it.pay.scale.set(wp, h, h)
      it.hdr.position.x = -w / 2 + wh / 2
      it.pay.position.x = w / 2 - wp / 2
      it.hdr.visible = payload < 1
      it.pay.visible = payload > 0
      setGlow(it.hm, GREY, 0.5 * fade)
      setGlow(it.pm, color, 1.2 * fade)
      it.tag.set(text, fade < 0.5 ? GREY : text ? color : LABEL)
    },
    end() {
      for (let i = used; i < n; i++) items[i].g.visible = false
    },
  }
}
