// Ranging sensors seen from above: an HC-SR04 aimed in the screen plane, its beam cone, and wavefronts as arcs of dots.
import * as THREE from 'three/webgpu'
import { V3, add, mesh } from '../../models/kit'
import { buildHcSr04 } from '../../models/modules'
import { glowMat, setGlow } from './colors'

/** HC-SR04 lying with its transducers pointing along `heading` (rad, screen plane), `k` units per pitch; → the T and R grille centres. */
export function hcSr04(parent: THREE.Object3D, at: V3, k: number, heading = 0) {
  const g = add(parent, buildHcSr04(), at)
  g.scale.setScalar(k)
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, c, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(c, s, 0)))
  g.position.z -= 5.75 * k
  const face = 5.05 * k
  const can = (side: number): V3 => [at[0] + c * face - s * side * 5.1 * k, at[1] + s * face + c * side * 5.1 * k, at[2]]
  return { group: g, tx: can(-1), rx: can(1) }
}

/** Flat translucent sector from `at` along `heading`, ±`half` rad, `range` long. */
export function beamCone(parent: THREE.Object3D, color: string) {
  const m = glowMat(color, 0.4)
  m.transparent = true
  m.depthWrite = false
  const o = add(parent, mesh(new THREE.CircleGeometry(1, 48, -1, 2), m))
  o.castShadow = o.receiveShadow = false
  let key = ''
  return (at: V3, heading: number, half: number, range: number, opacity = 0.14, tint = color) => {
    const k = `${heading.toFixed(3)}|${half.toFixed(3)}|${range.toFixed(2)}`
    if (k !== key) {
      o.geometry.dispose()
      o.geometry = new THREE.CircleGeometry(range, 48, heading - half, 2 * half)
      key = k
    }
    o.position.set(at[0], at[1], at[2] - 0.2)
    m.opacity = opacity
    setGlow(m, tint, 0.4)
  }
}

/** Pool of wavefront arcs, each `dots` glowing beads; per frame `begin()`, `put(…)` per arc, `end()`. `keep(x, y)` hides beads (walls). */
export function wavePool(parent: THREE.Object3D, arcs: number, dots = 40, bead = 0.14) {
  const geo = new THREE.SphereGeometry(bead, 8, 6)
  const m4 = new THREE.Matrix4()
  const pool = Array.from({ length: arcs }, () => {
    const material = glowMat('#ffffff', 0)
    const im = new THREE.InstancedMesh(geo, material, dots)
    im.frustumCulled = false
    im.castShadow = false
    parent.add(im)
    return { im, material }
  })
  let used = 0
  return {
    begin() {
      used = 0
    },
    put(c: V3, r: number, heading: number, half: number, color: string, f: number, keep?: (x: number, y: number) => boolean) {
      if (used >= arcs || r <= 0 || f < 0.02) return
      const { im, material } = pool[used++]
      im.visible = true
      setGlow(material, color, f)
      for (let i = 0; i < dots; i++) {
        const a = heading - half + (2 * half * i) / (dots - 1)
        const x = c[0] + r * Math.cos(a)
        const y = c[1] + r * Math.sin(a)
        const on = !keep || keep(x, y)
        im.setMatrixAt(i, on ? m4.makeTranslation(x, y, c[2]) : m4.makeScale(0, 0, 0))
      }
      im.instanceMatrix.needsUpdate = true
    },
    end() {
      for (let i = used; i < arcs; i++) pool[i].im.visible = false
    },
  }
}
