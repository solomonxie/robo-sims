// Schematic symbols: ground, ideal sources, diode, op-amp.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { CONVENTIONAL, HIGH_V, LOW_V, RING, glowMat, potentialColor } from './colors'
import { arrow, plusGeometry } from './shapes'

/** Earth symbol: a stem down from the origin, then three shrinking bars. */
export function groundSymbol(color = '#e8e8e8'): THREE.Group {
  const g = new THREE.Group()
  const m = mat(color, { emissive: '#333333' })
  rod(g, [0, 0, 0], [0, -1, 0], 0.1, m)
  ;[1.6, 1.05, 0.5].forEach((w, i) => box(g, [w, 0.16, 0.16], m, [0, -1 - i * 0.38, 0]))
  return g
}

export const groundAt = (parent: THREE.Object3D, at: V3) => add(parent, groundSymbol(), at).scale.setScalar(0.7)

/** Ideal current source facing +z, centred on the origin: a dark disc in a steel rim with a glowing arrow
 *  pushing up (+y); flip with `rotation.z = π`. */
export function currentSource(r = 1.6, color = CONVENTIONAL): THREE.Group {
  const g = sourceDisc(r)
  arrow(g, [0, -0.15 * r, 0.6], [0, 1, 0], color, r * 0.55)
  return g
}

function sourceDisc(r: number): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, r, 0.9, mat('#26272c', { rough: 0.4 }), [0, 0, 0], 'z', 40)
  add(g, mesh(new THREE.TorusGeometry(r, 0.16, 10, 48), STEEL()), [0, 0, 0.45])
  return g
}

/** AC voltage source facing +z, centred on the origin: the same disc with a glowing sine ∿ across it. */
export function acSource(r = 1.6, color = HIGH_V): THREE.Group {
  const g = sourceDisc(r)
  const pts = Array.from({ length: 33 }, (_, k) => new THREE.Vector3((k / 32 - 0.5) * 1.3 * r, 0.32 * r * Math.sin((k / 32) * 2 * Math.PI), 0))
  add(g, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.09 * r, 8), glowMat(color, 0.8)), [0, 0, 0.5])
  return g
}

/** Diode symbol facing +z, centred on the origin: a triangle pointing +x into the cathode bar. */
export function diodeSymbol(size = 1.6, color = '#e8e8e8'): THREE.Group {
  const g = new THREE.Group()
  const m = mat(color, { emissive: '#444444' })
  const h = size / 2
  const tri = new THREE.Shape([new THREE.Vector2(-h, h), new THREE.Vector2(h, 0), new THREE.Vector2(-h, -h)])
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false })
  geo.translate(0, 0, -0.1)
  add(g, mesh(geo, m))
  box(g, [0.18, size * 1.1, 0.2], m, [h + 0.09, 0, 0])
  for (const s of [-1, 1]) rod(g, [s * (h + 0.6), 0, 0], [s * h, 0, 0], 0.08, m)
  return g
}

const INK = () => mat('#d8dbe0', { emissive: '#3a3c40' })
const GREY_RIM = new THREE.Color('#9aa0aa')
const WARN = new THREE.Color(RING)

/** Op-amp symbol facing +z: a triangle `size` tall pointing +x, inputs on the left (− on top unless `minusTop` is false),
 *  supply stubs up (V+) and down (V−). `set(out, clip)` tints the output dot by potential (0..1) and the rim by clipping;
 *  `inputs(p, n)` tints the input dots. `pins` are in the parent's frame. */
export function opAmpSymbol(parent: THREE.Object3D, at: V3, { size = 4.4, lead: stub = 1, minusTop = true } = {}) {
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
  for (const y of [h / 2, -h / 2]) rod(g, [-h - stub, y, 0], [-h, y, 0], 0.09, ink)
  rod(g, [h, 0, 0], [h + stub, 0, 0], 0.09, ink)
  for (const [s, color] of [[1, HIGH_V], [-1, LOW_V]] as const) {
    rod(g, [0, s * h / 2, 0], [0, s * (h / 2 + stub), 0], 0.09, ink)
    cylinder(g, 0.28, 0.12, glowMat(color, 0.6), [0, s * (h / 2 + stub), 0], 'y', 16)
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
      n: local(-h - stub, yN),
      p: local(-h - stub, -yN),
      out: local(h + stub, 0),
      vcc: local(0, h / 2 + stub),
      vee: local(0, -h / 2 - stub),
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
