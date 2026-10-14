// Logic-gate symbols and glowing signal paths.
import * as THREE from 'three/webgpu'
import { GateName } from '../../core/logic'
import { V3, add, lead, mat, mesh, rod } from '../../models/kit'
import { potentialColor } from './colors'

const INVERTED: GateName[] = ['NOT', 'NAND', 'NOR', 'XNOR']

/** Gate symbol facing +z, `size` tall, pointing +x; inputs on the left (one for NOT). `set(out)` tints the body and output
 *  stub by potential (0..1), `inputs(a, b)` the input stubs. `pins` are in the parent's frame. */
export function gateSymbol(parent: THREE.Object3D, at: V3, gate: GateName, { size = 4.4, stub = 1.2 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const h = size / 2
  const v = (x: number, y: number) => new THREE.Vector2(x, y)
  const shape = new THREE.Shape()
  let tip = h
  let back = -h
  if (gate === 'NOT') {
    tip = h * 0.8
    shape.setFromPoints([v(-h, h), v(tip, 0), v(-h, -h)])
  } else if (gate === 'AND' || gate === 'NAND') {
    shape.moveTo(-h, -h)
    shape.lineTo(0, -h)
    shape.absarc(0, 0, h, -Math.PI / 2, Math.PI / 2, false)
    shape.lineTo(-h, h)
  } else {
    shape.moveTo(-h, -h)
    shape.quadraticCurveTo(0.35 * h, -h, h, 0)
    shape.quadraticCurveTo(0.35 * h, h, -h, h)
    shape.quadraticCurveTo(-0.5 * h, 0, -h, -h)
    back = -0.81 * h
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 })
  geo.translate(0, 0, -0.3)
  const body = new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.5, emissive: '#000000' })
  add(g, mesh(geo, body))
  const ink = mat('#d8dbe0', { emissive: '#3a3c40' })
  if (gate === 'XOR' || gate === 'XNOR') {
    const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-h - 0.5, h, 0), new THREE.Vector3(-0.5 * h - 0.5, 0, 0), new THREE.Vector3(-h - 0.5, -h, 0))
    add(g, mesh(new THREE.TubeGeometry(arc, 24, 0.14, 8), ink))
  }
  const wireMat = () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.4 })
  const bubble = INVERTED.includes(gate) ? 0.32 * h : 0
  if (bubble) add(g, mesh(new THREE.TorusGeometry(bubble * 0.75, bubble * 0.28, 10, 24), ink), [tip + bubble * 0.75, 0, 0])
  const outMat = wireMat()
  const outX = tip + 2 * bubble * 0.75
  rod(g, [outX, 0, 0], [outX + stub, 0, 0], 0.16, outMat)
  const ys = gate === 'NOT' ? [0] : [h / 2, -h / 2]
  const inMats = ys.map((y) => {
    const m = wireMat()
    rod(g, [-h - stub - 0.4, y, 0], [back + 0.1, y, 0], 0.16, m)
    return m
  })
  const tint = (m: THREE.MeshStandardMaterial, f: number) => m.emissive.copy(potentialColor(f, m.color))
  const local = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group: g,
    pins: { a: local(-h - stub - 0.4, ys[0]), b: local(-h - stub - 0.4, ys.at(-1)!), out: local(outX + stub, 0) },
    set(out: number) {
      tint(outMat, out)
      potentialColor(out, body.emissive).multiplyScalar(0.18)
    },
    inputs(a: number, b: number) {
      tint(inMats[0], a)
      if (inMats[1]) tint(inMats[1], b)
    },
  }
}

/** A glowing sleeve over a wire through `points`; `set(f, color)` fades it in (0..1) in that color. */
export function litWire(parent: THREE.Object3D, points: V3[], r = 0.45) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
  const group = add(parent, new THREE.Group())
  lead(group, points, r, m)
  group.traverse((o) => (o.castShadow = false))
  return {
    set(f: number, color: THREE.Color) {
      m.color.copy(color)
      m.emissive.copy(color)
      m.opacity = 0.55 * f
      group.visible = f > 0.01
    },
  }
}
