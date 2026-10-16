import * as THREE from 'three/webgpu'
import { wrapPi } from '../../core/physics/common'
import { V3 } from '../../models/kit'

export function path(points: V3[], closed = false): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map((p) => new THREE.Vector3(...p))
  const c = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) c.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  if (closed) c.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]))
  return c
}

export const UP = new THREE.Vector3(0, 1, 0)

export function randomDir(len: number): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len)
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)

export { halton } from '../../core/halton'

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)

/** Fraction of the way to a target to move this frame, for frame-rate-independent easing. */
export const ease = (dt: number, rate = 6) => 1 - Math.exp(-dt * rate)

/** Removes and disposes everything in `g`; cached `mat()` materials are shared, so they stay. */
export function emptyGroup(g: THREE.Group) {
  g.traverse((o) => {
    const { geometry, material } = o as THREE.Mesh
    geometry?.dispose()
    for (const m of [material ?? []].flat()) if (!m.userData.shared) m.dispose()
  })
  g.clear()
}

/** Grows or shrinks a part in place; hidden when gone. */
export function presence(o: THREE.Object3D, p: number) {
  o.visible = p > 0.01
  o.scale.setScalar(Math.max(0.001, p))
}

/** One eased step from `from` toward `to`. */
export const glide = (dt: number, from: number, to: number, k = 14) => from + (to - from) * ease(dt, k)
/** `glide` for angles: the short way round. */
export const glideAngle = (dt: number, from: number, to: number, k = 5) => from + glide(dt, 0, wrapPi(to - from), k)
export const frac = (x: number) => x - Math.floor(x)
/** Repeatable 0…1 noise for `x` (sine hash). */
export const sineHash = (x: number) => frac(Math.sin(x * 127.1) * 43758.5453)
/** 0 → 1 with flat ends, clamped. */
export const smoothstep = (u: number) => {
  const x = clamp01(u)
  return x * x * (3 - 2 * x)
}

/** Caches `compute(p)` until `key(p)` changes. */
export function memoBy<P, T>(key: (p: P) => string, compute: (p: P) => T) {
  let last: { key: string; value: T } | null = null
  return (p: P) => {
    const k = key(p)
    if (last?.key !== k) last = { key: k, value: compute(p) }
    return last.value
  }
}
export const add3 = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
export const peakToPeak = (v: number[]) => Math.max(...v) - Math.min(...v)
