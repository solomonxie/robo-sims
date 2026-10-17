import * as THREE from 'three/webgpu'
import { V3, mesh } from '../../models/kit'
import { faceFront } from './frames'
import { pointCloud } from './rooms'
import { stretchArrow } from './shapes'
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
