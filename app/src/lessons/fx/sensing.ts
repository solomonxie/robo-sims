// Ranging sensors seen from above: an HC-SR04 aimed in the screen plane, its beam cone, wavefronts as arcs of dots, light rays, and an image sensor pixel grid.
import * as THREE from 'three/webgpu'
import { Intrinsics, Mat4, apply4 } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildHcSr04 } from '../../models/modules'
import { glowMat, setGlow } from './colors'
import type { Rods } from './pixels'

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

/** Invisible IR drawn as a visible tint. */
export const IR_TINT = '#ff5c9d'
/** Sunlight / ambient light. */
export const SUN_TINT = '#ffc04d'

/** Light streaming along a polyline as `beads` glowing dots; `set(points, t, f, color)`: `t` in s, `f` brightness (≤ 0 hides). */
export function lightRay(parent: THREE.Object3D, beads = 16, bead = 0.13, speed = 0.8) {
  const material = glowMat(IR_TINT, 0)
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(bead, 8, 6), material, beads)
  im.frustumCulled = false
  im.castShadow = false
  parent.add(im)
  const m4 = new THREE.Matrix4()
  return (pts: V3[], t: number, f: number, color = IR_TINT) => {
    im.visible = f > 0.01 && pts.length > 1
    if (!im.visible) return
    setGlow(material, color, f)
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]))
    const total = lens.reduce((a, b) => a + b, 0) || 1
    for (let k = 0; k < beads; k++) {
      let d = (((k / beads + t * speed) % 1) + 1) % 1 * total
      let i = 0
      while (i < lens.length - 1 && d > lens[i]) d -= lens[i++]
      const u = Math.min(1, d / (lens[i] || 1))
      const a = pts[i]
      const b = pts[i + 1]
      im.setMatrixAt(k, m4.makeTranslation(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u))
    }
    im.instanceMatrix.needsUpdate = true
  }
}

/** Image sensor as `cols × rows` unlit square pixels facing +z on a black plate, centred on `at`. `set(i, r, g, b)` takes
 *  sRGB 0…1 (index = row × cols + col, row 0 on top), `commit()` uploads; `cell(c, r)` = a pixel centre in `parent` space. */
export function pixelGrid(parent: THREE.Object3D, at: V3, cols: number, rows: number, pitch: number) {
  const plate = add(parent, mesh(new THREE.BoxGeometry(cols * pitch + pitch, rows * pitch + pitch, 0.2), new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.8 })), [at[0], at[1], at[2] - 0.1])
  plate.castShadow = false
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(pitch * 0.9, pitch * 0.9), new THREE.MeshBasicMaterial({ color: '#ffffff' }), cols * rows)
  im.castShadow = false
  im.frustumCulled = false
  const cell = (c: number, r: number): V3 => [at[0] + (c - (cols - 1) / 2) * pitch, at[1] + ((rows - 1) / 2 - r) * pitch, at[2] + 0.02]
  const m4 = new THREE.Matrix4()
  const color = new THREE.Color()
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) im.setMatrixAt(r * cols + c, m4.makeTranslation(...cell(c, r)))
  im.setColorAt(0, color.setRGB(0, 0, 0))
  parent.add(im)
  return {
    mesh: im,
    cell,
    set: (i: number, r: number, g: number, b: number) => im.setColorAt(i, color.setRGB(r, g, b, THREE.SRGBColorSpace)),
    commit: () => (im.instanceColor!.needsUpdate = true),
  }
}

/** Camera body in camera axes (x right, y down, z forward), metres; lens at the origin. */
export function camBody(parent: THREE.Object3D, size = 0.03, color = '#2a2c32') {
  const g = add(parent, new THREE.Group())
  box(g, [size, size, size * 0.6], mat(color, { rough: 0.4 }), [0, 0, -size * 0.45])
  cylinder(g, size * 0.3, size * 0.3, mat('#14161b', { rough: 0.2 }), [0, 0, size * 0.02], 'z', 20)
  add(g, mesh(new THREE.CircleGeometry(size * 0.22, 24), glowMat('#5a7dff', 0.5)), [0, 0, size * 0.18]).castShadow = false
  return g
}

/** World point where pixel (u, v) sits on the image plane at depth `s` in front of camera `Twc`. */
export const imagePlanePoint = (k: Intrinsics, Twc: Mat4, s: number, u: number, v: number) => apply4(Twc, [((u - k.cx) / k.fx) * s, ((v - k.cy) / k.fy) * s, s]) as V3

/** Frustum rods: optical centre → the 4 image corners at depth `s`, plus the image rectangle; uses rods i…i+7. */
export function frustum(pool: Rods, i: number, k: Intrinsics, Twc: Mat4, s: number, r: number, color: string) {
  const o: V3 = [Twc[3], Twc[7], Twc[11]]
  const c = [[-0.5, -0.5], [k.w - 0.5, -0.5], [k.w - 0.5, k.h - 0.5], [-0.5, k.h - 0.5]].map(([u, v]) => imagePlanePoint(k, Twc, s, u, v))
  c.forEach((p, j) => {
    pool.set(i + j, o, p, r * 0.6, color)
    pool.set(i + 4 + j, p, c[(j + 1) % 4], r, color)
  })
}
