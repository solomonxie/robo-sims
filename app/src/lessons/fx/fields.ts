// Fields and magnets: field lines, arrow grids, charges, compass, coil, travelling EM wave.
import * as THREE from 'three/webgpu'
import { Vec3, coilField, loopLines } from '../../core/fields'
import { V3, add, box, cylinder, mat, mesh, STEEL } from '../../models/kit'
import { B_FIELD, COPPER, HIGH_V, LOW_V, NORTH, RING, SOUTH, glowMat } from './colors'
import { rodBetween, shadowlessRod, stretchRod } from './layout'
import { plusGeometry } from './shapes'
import { UP, clamp01 } from './util'

const WHITE = new THREE.Color('#ffffff')
const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpD = new THREE.Vector3()
const tmpP = new THREE.Vector3()

/** Field lines: glowing polylines in one instanced pool, with arrowheads gliding along them `spacing` apart, so the
 *  direction reads (none within `margin` of a line's ends, where lines crowd). `set(lines, paint?)` swaps the lines (each runs along the field; `paint` tints by position, e.g. to
 *  dim far planes); `step(distance)` slides the heads. Works for any field (electric, magnetic). */
export function fieldLines(
  parent: THREE.Object3D,
  { maxSegments = 6000, maxHeads = 240, radius = 0.06, head = 0.26, spacing = 4, margin = 1, color = RING, heads: withHeads = true } = {},
) {
  const group = add(parent, new THREE.Group())
  const segs = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff' }), maxSegments)
  const heads = new THREE.InstancedMesh(new THREE.ConeGeometry(head, head * 2.6, 14), new THREE.MeshBasicMaterial({ color: '#ffffff' }), withHeads ? maxHeads : 1)
  for (const o of withHeads ? [segs, heads] : [segs]) {
    o.frustumCulled = false
    o.castShadow = false
    o.count = 0
    group.add(o)
  }
  const base = new THREE.Color(color)
  const c = new THREE.Color()
  let tracks: { pts: THREE.Vector3[]; at: number[]; tint: THREE.Color }[] = []
  let offset = 0
  const placeHeads = () => {
    if (!withHeads) return
    let k = 0
    for (const { pts, at, tint } of tracks) {
      const total = at[at.length - 1]
      let i = 1
      for (let s = offset; s < total - margin && k < maxHeads; s += spacing) {
        if (s < margin) continue
        while (at[i] < s) i++
        const a = pts[i - 1]
        const b = pts[i]
        tmpD.subVectors(b, a)
        const len = tmpD.length()
        if (len < 1e-6) continue
        tmpP.copy(a).addScaledVector(tmpD, (s - at[i - 1]) / len)
        tmpQ.setFromUnitVectors(UP, tmpD.divideScalar(len))
        heads.setMatrixAt(k, tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1)))
        heads.setColorAt(k, c.copy(tint).lerp(WHITE, 0.3))
        k++
      }
    }
    heads.count = k
    heads.instanceMatrix.needsUpdate = true
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true
  }
  return {
    group,
    set(lines: V3[][], paint?: (at: THREE.Vector3, out: THREE.Color) => void) {
      let k = 0
      tracks = []
      for (const line of lines) {
        const pts = line.map((p) => new THREE.Vector3(...p))
        const at = [0]
        const tint = new THREE.Color()
        if (paint) paint(pts[Math.floor(pts.length / 2)], tint)
        else tint.copy(base)
        for (let i = 1; i < pts.length; i++) {
          tmpD.subVectors(pts[i], pts[i - 1])
          const len = tmpD.length()
          at.push(at[i - 1] + len)
          if (k >= maxSegments || len < 1e-6) continue
          tmpQ.setFromUnitVectors(UP, tmpD.divideScalar(len))
          segs.setMatrixAt(k, tmpM.compose(tmpP.addVectors(pts[i], pts[i - 1]).multiplyScalar(0.5), tmpQ, tmpS.set(1, len, 1)))
          segs.setColorAt(k, paint ? (paint(tmpP, c), c) : base)
          k++
        }
        tracks.push({ pts, at, tint })
      }
      segs.count = k
      segs.instanceMatrix.needsUpdate = true
      if (segs.instanceColor) segs.instanceColor.needsUpdate = true
      placeHeads()
    },
    step(distance: number) {
      offset = (((offset + distance) % spacing) + spacing) % spacing
      placeHeads()
    },
  }
}

/** Up to `max` arrows (shaft + cone) showing a vector field at sample points. `set(points, vec)` puts one arrow centred
 *  on each point along `vec(p, out)` (scene units, capped at `maxLen`), brighter the longer it is; short ones hide. */
export function arrowGrid(parent: THREE.Object3D, max: number, { color = RING, radius = 0.08, head = 0.26, maxLen = 2, dim = '#3a3e48' } = {}) {
  const group = add(parent, new THREE.Group())
  const shaftGeo = new THREE.CylinderGeometry(radius, radius, 1, 8)
  shaftGeo.translate(0, 0.5, 0)
  const coneGeo = new THREE.ConeGeometry(head, head * 2.4, 12)
  coneGeo.translate(0, head * 1.2, 0)
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const shafts = new THREE.InstancedMesh(shaftGeo, material, max)
  const cones = new THREE.InstancedMesh(coneGeo, material, max)
  for (const o of [shafts, cones]) {
    o.frustumCulled = false
    o.castShadow = false
    o.count = 0
    group.add(o)
  }
  const low = new THREE.Color(dim)
  const high = new THREE.Color(color)
  const c = new THREE.Color()
  const p = new THREE.Vector3()
  const v = new THREE.Vector3()
  const coneLen = head * 2.4
  return {
    group,
    set(points: V3[], vec: (p: THREE.Vector3, out: THREE.Vector3) => void) {
      let k = 0
      for (const at of points) {
        if (k >= max) break
        vec(p.set(...at), v.set(0, 0, 0))
        const len = Math.min(maxLen, v.length())
        if (len < 0.15) continue
        v.normalize()
        tmpQ.setFromUnitVectors(UP, v)
        const s = Math.min(1, len / (coneLen * 1.6))
        const shaft = Math.max(0.001, len - coneLen * s)
        tmpP.copy(p).addScaledVector(v, -len / 2)
        shafts.setMatrixAt(k, tmpM.compose(tmpP, tmpQ, tmpS.set(1, shaft, 1)))
        tmpP.addScaledVector(v, shaft)
        cones.setMatrixAt(k, tmpM.compose(tmpP, tmpQ, tmpS.setScalar(s)))
        c.copy(low).lerp(high, 0.35 + 0.65 * (len / maxLen))
        shafts.setColorAt(k, c)
        cones.setColorAt(k, c)
        k++
      }
      shafts.count = cones.count = k
      for (const o of [shafts, cones]) {
        o.instanceMatrix.needsUpdate = true
        if (o.instanceColor) o.instanceColor.needsUpdate = true
      }
    },
  }
}

/** Charged ball facing +z: red with a "+" when positive, blue with a "−" when negative, grey at 0. `set(q, maxQ)`
 *  sizes it from `r0` (q = 0) up to `r1` (|q| = maxQ). */
export function chargeBall(parent: THREE.Object3D, at: V3, { r0 = 0.5, r1 = 1.3 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const material = glowMat(HIGH_V, 0.55)
  const ball = add(group, mesh(new THREE.SphereGeometry(1, 32, 20), material))
  const sign = mat('#ffffff', { emissive: '#bbbbbb' })
  const plus = add(group, mesh(plusGeometry(1.1), sign), [0, 0, 1])
  const minus = box(group, [1.1, 0.35, 0.35], sign, [0, 0, 1])
  const neutral = new THREE.Color('#8a8f99')
  return {
    group,
    set(q: number, maxQ: number) {
      const r = r0 + (r1 - r0) * clamp01(Math.abs(q) / maxQ)
      ball.scale.setScalar(r)
      plus.visible = q > 0
      minus.visible = q < 0
      for (const g of [plus, minus]) {
        g.scale.setScalar(r * 0.75)
        g.position.z = r * 0.95
      }
      const col = q > 0 ? HIGH_V : q < 0 ? LOW_V : neutral
      material.color.set(col)
      material.emissive.set(col)
      return r
    },
  }
}

/** Compass facing +z, centred on the origin: a dial with a needle, red end north. `set(angle)` points the north end
 *  (0 = +x, counter-clockwise); `swing(target, dt)` turns it there like a real needle, overshooting and settling. */
export function compass(parent: THREE.Object3D, at: V3, r = 1) {
  const group = add(parent, new THREE.Group(), at)
  cylinder(group, r, 0.25, mat('#e9e6dc', { rough: 0.5 }), [0, 0, -0.1], 'z', 32)
  add(group, mesh(new THREE.TorusGeometry(r, 0.1 * r, 8, 32), STEEL()), [0, 0, 0])
  const ticks = mat('#55585f')
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2
    box(group, [0.22 * r, 0.06 * r, 0.04], ticks, [Math.cos(a) * 0.82 * r, Math.sin(a) * 0.82 * r, 0.05]).rotation.z = a
  }
  const needle = add(group, new THREE.Group(), [0, 0, 0.18])
  const half = (color: string, dir: 1 | -1, glow: number) => {
    const m = mesh(new THREE.ConeGeometry(0.17 * r, 0.82 * r, 4), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.4 }))
    m.scale.z = 0.35
    m.rotation.z = -dir * (Math.PI / 2)
    m.position.x = dir * 0.41 * r
    needle.add(m)
  }
  half(NORTH, 1, 0.5)
  half('#e8e8ee', -1, 0.15)
  cylinder(group, 0.07 * r, 0.3, STEEL(), [0, 0, 0.25], 'z', 12)
  let angle = 0
  let spin = 0
  return {
    group,
    set(a: number) {
      angle = a
      spin = 0
      needle.rotation.z = a
    },
    swing(target: number, dt: number) {
      for (let left = Math.min(dt, 0.25); left > 0; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120)
        spin += (70 * Math.sin(target - angle) - 5.5 * spin) * h
        angle += spin * h
      }
      needle.rotation.z = angle
    },
  }
}

/** Helix along x centred on the origin, starting and (for whole turns) ending at (±length/2, r, 0); running along it
 *  turns right-handed about +x. */
class CoilPath extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private length: number, private turns: number) {
    super()
    this.arcLengthDivisions = Math.max(200, Math.ceil(turns * 32))
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2
    return target.set((t - 0.5) * this.length, this.r * Math.cos(a), this.r * Math.sin(a))
  }
}

/** Copper coil of whole `turns` along x, centred on the origin, its ends at (±length/2, radius, 0). `lane(offset)` is the
 *  helix `offset` outside the wire, for a `Flow` of charges: + charges running −x → +x make B point +x inside. */
export function coil(parent: THREE.Object3D, { radius = 2, length = 8, turns = 10, thickness = 0.18 } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, mesh(new THREE.TubeGeometry(new CoilPath(radius, length, turns), Math.ceil(turns * 28), thickness, 8), COPPER()))
  body.castShadow = false
  return { group, lane: (offset = thickness * 2) => new CoilPath(radius + offset, length, turns) }
}

/** `coil` round a grey core (rod radius `core`, 0 = air) that glows with the field: `set(f 0..1)`. */
export function inductorCoil(parent: THREE.Object3D, { radius = 1.1, length = 6.4, turns = 9, thickness = 0.18, core = 0.65 } = {}) {
  const c = coil(parent, { radius, length, turns, thickness })
  const coreMat = new THREE.MeshStandardMaterial({ color: '#6d7480', emissive: B_FIELD, emissiveIntensity: 0, roughness: 0.5 })
  if (core > 0) add(c.group, mesh(new THREE.CylinderGeometry(core, core, length + 0.8, 24), coreMat)).rotation.z = Math.PI / 2
  return { ...c, set: (f: number) => (coreMat.emissiveIntensity = 1.4 * clamp01(f)) }
}

const DIM_FIELD = new THREE.Color(B_FIELD).lerp(new THREE.Color('#14161b'), 0.68)
/** `fieldLines` paint for dim depth copies. */
export const dimField = (_: THREE.Vector3, out: THREE.Color) => out.copy(DIM_FIELD)

/** The same planar lines turned about the x axis, for dim depth copies of an axially symmetric field. */
export const turnAboutX = (lines: Vec3[][], angles: number[]): V3[][] =>
  angles.flatMap((a) => lines.map((l) => l.map(([x, y]): V3 => [x, y * Math.cos(a), y * Math.sin(a)])))

/** Field lines of a `coil` (radius, length, loops) out to `box` (half-sizes): `set(pairs, sign)` shows `pairs` lines
 *  above and below the axis, pointing +x inside for sign > 0, plus dim copies turned about x; traces are cached. */
export function coilLines(
  parent: THREE.Object3D,
  { radius, length, loops, box: bounds, spacing = 3.4, tilts = [Math.PI / 3, -Math.PI / 3] }: { radius: number; length: number; loops: number; box: [number, number]; spacing?: number; tilts?: number[] },
) {
  const group = add(parent, new THREE.Group())
  const lines = fieldLines(group, { maxSegments: 4000, spacing, color: B_FIELD })
  const depth = fieldLines(group, { maxSegments: 8000, radius: 0.045, heads: false })
  const field = (p: Vec3) => coilField(radius, length, loops, p)
  const cache = new Map<number, Vec3[][]>()
  const traceFor = (pairs: number) => {
    if (!cache.has(pairs)) {
      const seeds: Vec3[] = Array.from({ length: pairs }, (_, k) => [0, (radius * 0.86 * (k + 0.5)) / pairs, 0])
      const upper = loopLines(field, seeds, { step: 0.12, box: bounds, maxSteps: 900 })
      cache.set(pairs, [...upper, ...upper.map((l) => l.map(([x, y, z]): Vec3 => [x, -y, z]))])
    }
    return cache.get(pairs)!
  }
  let shown = ''
  return {
    group,
    field,
    set(pairs: number, sign = 1) {
      const key = `${pairs},${Math.sign(sign)}`
      if (key === shown) return
      shown = key
      const flat = pairs ? traceFor(pairs) : []
      const directed = sign < 0 ? flat.map((l) => [...l].reverse()) : flat
      lines.set(directed)
      depth.set(turnAboutX(directed, tilts), dimField)
    },
    step: (distance: number) => lines.step(distance),
  }
}

/** Bar magnet along x centred on the origin, `size` = [length, height, depth]: north half (+x) red, south half blue. */
export function barMagnet(parent: THREE.Object3D, size: V3) {
  const group = add(parent, new THREE.Group())
  const [l, h, d] = size
  const north = mat(NORTH, { rough: 0.45, emissive: '#3a0d0a' })
  const south = mat(SOUTH, { rough: 0.45, emissive: '#0c1a40' })
  box(group, [l / 2, h, d], north, [l / 4, 0, 0])
  box(group, [l / 2, h, d], south, [-l / 4, 0, 0])
  return group
}

/** Travelling plane EM wave along x from `x0` to `x1` at height `y`: E arrows up the screen, B arrows into depth.
 *  `set(lambda, phase, amp)`: wavelength in scene units, phase in cycles; fades in over `fadeIn` units. */
export function emWave(parent: THREE.Object3D, x0: number, x1: number, { y = 0, arrows = 120, fadeIn = 2.5, axis = '#46645a' } = {}) {
  rodBetween(parent, [x0, y, 0], [x1, y, 0], mat(axis, { emissive: '#1a2a24' }), 0.05)
  const e = Array.from({ length: arrows }, () => add(parent, shadowlessRod(glowMat(HIGH_V, 0.9))))
  const b = Array.from({ length: arrows }, () => add(parent, shadowlessRod(glowMat(B_FIELD, 0.8))))
  const tipGeo = new THREE.SphereGeometry(0.12, 8, 6)
  const tipM = glowMat(HIGH_V, 1.2)
  const tips = Array.from({ length: arrows }, () => add(parent, mesh(tipGeo, tipM)))
  return {
    set(lambda: number, phase: number, amp: number) {
      for (let i = 0; i < arrows; i++) {
        const x = x0 + ((i + 0.5) / arrows) * (x1 - x0)
        const v = amp * Math.min(1, (x - x0) / fadeIn) * Math.sin(2 * Math.PI * ((x - x0) / lambda - phase))
        stretchRod(e[i], [x, y, 0], [x, y + v, 0], 0.05)
        stretchRod(b[i], [x, y, 0], [x, y, v * 0.8], 0.045)
        tips[i].position.set(x, y + v, 0)
        tips[i].visible = Math.abs(v) > 0.15
      }
    },
  }
}
