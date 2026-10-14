import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
import { icPackage } from './circuit'
import { HIGH_V, LOW_V, RING, glowMat, potentialColor } from './colors'
import { plusGeometry } from './shapes'

const INK = () => mat('#d8dbe0', { emissive: '#3a3c40' })
const GREY_RIM = new THREE.Color('#9aa0aa')
const WARN = new THREE.Color(RING)

/** Op-amp symbol facing +z: a triangle `size` tall pointing +x, inputs on the left (− on top unless `minusTop` is false),
 *  supply stubs up (V+) and down (V−). `set(out, clip)` tints the output dot by potential (0..1) and the rim by clipping;
 *  `inputs(p, n)` tints the input dots. `pins` are in the parent's frame. */
export function opAmpSymbol(parent: THREE.Object3D, at: V3, { size = 4.4, lead = 1, minusTop = true } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const h = size / 2
  const tri = new THREE.Shape([new THREE.Vector2(-h, h), new THREE.Vector2(h, 0), new THREE.Vector2(-h, -h)])
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.5, bevelEnabled: false })
  geo.translate(0, 0, -0.25)
  add(g, mesh(geo, mat('#23262d', { rough: 0.55 })))
  const rim = glowMat('#9aa0aa', 0.35)
  const corners: V3[] = [[-h, h, 0.3], [h, 0, 0.3], [-h, -h, 0.3]]
  corners.forEach((c, i) => rod(g, c, corners[(i + 1) % 3], 0.11, rim))
  for (const c of corners) add(g, mesh(new THREE.SphereGeometry(0.11, 10, 8), rim), c)

  const ink = INK()
  const yN = minusTop ? h / 2 : -h / 2
  add(g, mesh(plusGeometry(0.75), ink), [-h + 0.75, -yN, 0.25])
  box(g, [0.75, 0.2, 0.1], ink, [-h + 0.75, yN, 0.32])
  for (const y of [h / 2, -h / 2]) rod(g, [-h - lead, y, 0], [-h, y, 0], 0.09, ink)
  rod(g, [h, 0, 0], [h + lead, 0, 0], 0.09, ink)
  for (const [s, color] of [[1, HIGH_V], [-1, LOW_V]] as const) {
    rod(g, [0, s * h / 2, 0], [0, s * (h / 2 + lead), 0], 0.09, ink)
    cylinder(g, 0.28, 0.12, glowMat(color, 0.6), [0, s * (h / 2 + lead), 0], 'y', 16)
  }
  const dot = (p: V3) => add(g, mesh(new THREE.SphereGeometry(0.26, 14, 10), glowMat('#ffffff', 0.9)), p)
  const outDot = dot([h + 0.05, 0, 0.3])
  const pDot = dot([-h - 0.1, -yN, 0])
  const nDot = dot([-h - 0.1, yN, 0])
  const tint = (o: THREE.Mesh, f: number) => {
    const m = o.material as THREE.MeshStandardMaterial
    potentialColor(f, m.color)
    m.emissive.copy(m.color)
  }
  const local = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group: g,
    pins: {
      n: local(-h - lead, yN),
      p: local(-h - lead, -yN),
      out: local(h + lead, 0),
      vcc: local(0, h / 2 + lead),
      vee: local(0, -h / 2 - lead),
    },
    set(out: number, clip = 0) {
      tint(outDot, out)
      rim.color.copy(GREY_RIM).lerp(WARN, clip)
      rim.emissive.copy(rim.color)
      rim.emissiveIntensity = 0.35 + 0.6 * clip
    },
    inputs(p: number, n: number) {
      tint(pDot, p)
      tint(nDot, n)
    },
  }
}

const DIP_W = 3.4
const DIP_H = 5.2
const DIP_PITCH = DIP_H / 4

/** Dual op-amp in a DIP-8 (TL072 pinout), top view facing +z, notch up: pins 1–4 down the left, 5–8 up the right.
 *  Two triangles are marked on the lid, A pointing at pin 1 (OUT A), B at pin 7 (OUT B). `pins[k]` is pin k's tip;
 *  `light(k, color)` glows a leg (null turns it off). */
export function dip8OpAmp(parent: THREE.Object3D, at: V3, scale = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(scale)
  add(g, icPackage(DIP_W, DIP_H, 4))
  const rowY = (i: number) => DIP_H / 2 - (i + 0.5) * DIP_PITCH
  const xy = (k: number): [number, number] => (k <= 4 ? [-1, rowY(k - 1)] : [1, rowY(8 - k)])
  const ink = glowMat('#cfd3da', 0.25)
  const mark = (cx: number, cy: number, dir: number) => {
    const s = 0.55
    const pts: V3[] = [[cx - dir * s, cy + s, 0.63], [cx + dir * s, cy, 0.63], [cx - dir * s, cy - s, 0.63]]
    pts.forEach((p, i) => rod(g, p, pts[(i + 1) % 3], 0.05, ink))
  }
  mark(-0.75, rowY(0) - 0.25, -1)
  mark(0.75, rowY(2) + 0.25, 1)
  const legs: THREE.Mesh[] = []
  const pins: V3[] = [[0, 0, 0]]
  for (let k = 1; k <= 8; k++) {
    const [s, y] = xy(k)
    const leg = add(g, mesh(new THREE.BoxGeometry(0.95, 0.5, 0.3), glowMat('#ffffff', 1)), [s * (DIP_W / 2 + 0.4), y, -0.15])
    leg.visible = false
    legs.push(leg)
    pins.push([at[0] + s * (DIP_W / 2 + 0.85) * scale, at[1] + y * scale, at[2]])
  }
  return {
    group: g,
    pins,
    light(k: number, color: string | null) {
      const leg = legs[k - 1]
      leg.visible = color !== null
      if (!color) return
      const m = leg.material as THREE.MeshStandardMaterial
      m.color.set(color)
      m.emissive.set(color)
    },
  }
}
