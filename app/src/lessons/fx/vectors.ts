import * as THREE from 'three/webgpu'
import { Mat2, V2, apply2 } from '../../core/physics'
import { V3, mesh } from '../../models/kit'
import { GREY, LABEL, RING, glowMat, setGlow } from './colors'
import { AXIS_RGB, faceFront } from './frames'
import { addRod, stretchRod } from './layout'
import { pointCloud } from './rooms'
import { shellMat, stretchArrow } from './shapes'
import { liveLabel } from './text'

/** Labelled arrow a→b in any (turned) group; the name sits past the tip, turned to the viewer. */
export function vecArrow(parent: THREE.Object3D, color: string, r: number, size: number) {
  const draw = stretchArrow(parent, color, r)
  const tag = liveLabel(parent, [0, 0, 0], { size, color })
  return (a: V3, b: V3, text: string, shift: V3 = [0, 0, 0]) => {
    draw(a, b)
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const len = Math.hypot(...d)
    tag.group.visible = len > r * 7 && text !== ''
    const u = len > 0 ? (size * 1.4) / len : 0
    tag.group.position.set(b[0] + d[0] * u + shift[0], b[1] + d[1] * u + shift[1], b[2] + d[2] * u + shift[2])
    tag.set(text, color)
    faceFront(tag.group)
  }
}

/** Dotted arc of radius `radius` at `o` from direction a to direction b, with an optional name at its middle. */
export function angleArc(parent: THREE.Object3D, r: number, size: number, n = 36) {
  const dots = pointCloud(parent, n, r)
  const tag = liveLabel(parent, [0, 0, 0], { size })
  const [va, vb, ax, p] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  return (o: V3, a: V3, b: V3, radius: number, color: string, text = '') => {
    va.set(...a).normalize()
    vb.set(...b).normalize()
    const ang = va.angleTo(vb)
    ax.crossVectors(va, vb)
    if (ax.lengthSq() < 1e-12) ax.set(-va.y, va.x, va.z).cross(va)
    ax.normalize()
    const k = ang < 0.02 ? 0 : n
    for (let i = 0; i < k; i++) {
      p.copy(va).applyAxisAngle(ax, (ang * i) / (n - 1)).multiplyScalar(radius)
      dots.set(i, [o[0] + p.x, o[1] + p.y, o[2] + p.z], color)
    }
    dots.show(k)
    p.copy(va).applyAxisAngle(ax, ang / 2).multiplyScalar(radius + size * 1.3)
    tag.group.position.set(o[0] + p.x, o[1] + p.y, o[2] + p.z)
    tag.group.visible = k > 0 && text !== ''
    tag.set(text, color)
    faceFront(tag.group)
  }
}

/** Dotted straight line a→b (drop lines, projections). */
export function dotLine(parent: THREE.Object3D, r: number, n = 24) {
  const dots = pointCloud(parent, n, r)
  return (a: V3, b: V3, color: string) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const k = Math.min(n, Math.max(2, Math.round(len / (r * 5))))
    for (let i = 0; i < k; i++) {
      const u = i / (k - 1)
      dots.set(i, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], color)
    }
    dots.show(len < r ? 0 : k)
  }
}

/** See-through parallelogram on sides a and b from `o` (cross-product area, a plate from two edges); `set(o, a, b)`. */
export function parallelogram(parent: THREE.Object3D, color: string, opacity = 0.35) {
  const pos = new Float32Array(18)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
  const face = mesh(geo, m)
  face.castShadow = false
  face.frustumCulled = false
  parent.add(face)
  return {
    face,
    material: m,
    set(o: V3, a: V3, b: V3) {
      const c: V3 = [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]]
      const pa: V3 = [o[0] + a[0], o[1] + a[1], o[2] + a[2]]
      const pb: V3 = [o[0] + b[0], o[1] + b[1], o[2] + b[2]]
      ;[o, pa, c, o, c, pb].forEach((v, i) => pos.set(v, i * 3))
      geo.attributes.position.needsUpdate = true
      geo.computeVertexNormals()
    },
  }
}

const box2 = (x0: number, x1: number, y0: number, y1: number): V2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
/** Top-view robot outline in metres, x forward: body with a nose, two wheels. */
export const ROBOT_OUTLINE: V2[][] = [
  [[-0.3, -0.18], [0.18, -0.18], [0.34, 0], [0.18, 0.18], [-0.3, 0.18], [-0.3, -0.18]],
  box2(-0.14, 0.1, 0.2, 0.28),
  box2(-0.14, 0.1, -0.28, -0.2),
]

/** A plane carried by a 2×2 row-major matrix M (z = 0 of `parent`): faint fixed grid, warped grid (x axis red, y axis green) and outlines; `set(M, gridColor, outlineColor)`. */
export function warpGrid(parent: THREE.Object3D, { half = 1, step = 0.25, r = 0.006, outline = ROBOT_OUTLINE } = {}) {
  const ticks = Array.from({ length: Math.round((2 * half) / step) + 1 }, (_, i) => -half + i * step)
  const ghostM = glowMat('#3c414b', 0.1)
  for (const t of ticks) {
    stretchRod(addRod(parent, ghostM), [t, -half, 0], [t, half, 0], r * 0.6)
    stretchRod(addRod(parent, ghostM), [-half, t, 0], [half, t, 0], r * 0.6)
  }
  const lineM = glowMat(LABEL, 0.5)
  const axisM = AXIS_RGB.slice(0, 2).map((c) => glowMat(c, 0.9))
  const lines = ticks.flatMap((t) => {
    const axis = Math.abs(t) < 1e-9
    return [
      { a: [-half, t] as V2, b: [half, t] as V2, rod: addRod(parent, axis ? axisM[0] : lineM), w: axis ? 1.6 : 1 },
      { a: [t, -half] as V2, b: [t, half] as V2, rod: addRod(parent, axis ? axisM[1] : lineM), w: axis ? 1.6 : 1 },
    ]
  })
  const outM = glowMat(RING, 0.9)
  const segs = outline.flatMap((poly) => poly.slice(1).map((b, i) => ({ a: poly[i], b, rod: addRod(parent, outM) })))
  const at = (M: Mat2, p: V2, z: number): V3 => [...apply2(M, p), z]
  return {
    set(M: Mat2, gridColor = LABEL, outlineColor = RING) {
      setGlow(lineM, gridColor, 0.5)
      setGlow(outM, outlineColor, 0.9)
      for (const l of lines) stretchRod(l.rod, at(M, l.a, 0.004 * l.w), at(M, l.b, 0.004 * l.w), r * l.w)
      for (const s of segs) stretchRod(s.rod, at(M, s.a, 0.01), at(M, s.b, 0.01), r * 1.8)
    },
  }
}

/** See-through sphere of radius `r` (directions) with equator and meridian rings; `trail(k)` makes a dotted path on it, `set(unitPoints, color)`. */
export function dirSphere(parent: THREE.Object3D, r: number) {
  const ball = mesh(new THREE.SphereGeometry(r, 36, 24), shellMat('#9aa6b8', 0.07))
  ball.castShadow = false
  parent.add(ball)
  const ringM = glowMat(GREY, 0.25)
  for (const turn of [0, 1, 2]) {
    const t = mesh(new THREE.TorusGeometry(r, r * 0.006, 6, 96), ringM)
    t.castShadow = false
    if (turn === 1) t.rotation.x = Math.PI / 2
    if (turn === 2) t.rotation.y = Math.PI / 2
    parent.add(t)
  }
  return {
    trail(k: number, dot = r * 0.025) {
      const dots = pointCloud(parent, k, dot)
      return (pts: readonly (readonly number[])[], color: string) => {
        pts.slice(0, k).forEach((p, i) => dots.set(i, [p[0] * r, p[1] * r, p[2] * r], color))
        dots.show(Math.min(k, pts.length))
      }
    },
  }
}
