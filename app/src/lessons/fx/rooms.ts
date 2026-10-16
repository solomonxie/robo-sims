// Rooms for mobile-robot lessons, drawn in metres (x, y floor, z up) inside a group the caller scales and turns: solids, a robot with a lidar head, point clouds and ray fans.
import * as THREE from 'three/webgpu'
import { CostGrid, INSCRIBED, LETHAL, Pose, Room, RoomSolid } from '../../core/physics'
import { B_FIELD, GREY, HIGH_V, glowMat, potentialColor, setGlow } from './colors'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { IDLE } from './mcu'
import { flatBox } from './shapes'
import { addLabel } from './text'

const SOLID_LOOK = {
  glass: () => mat('#9fd8ff', { rough: 0.1, opacity: 0.35 }),
  mirror: () => mat('#e8edf5', { metal: 0.5, rough: 0.08 }),
}
/** Diffuse solids: brighter for higher reflectance. */
const diffuseLook = (refl: number, opacity: number) =>
  mat(`#${new THREE.Color('#1d1e22').lerp(new THREE.Color('#e9e7e0'), Math.min(1, Math.sqrt(refl))).getHexString()}`, { rough: 0.85, opacity })

function solidMesh(parent: THREE.Object3D, s: RoomSolid, hScale: number, opacity: number) {
  const m = s.optic && s.optic !== 'diffuse' ? SOLID_LOOK[s.optic]() : diffuseLook(s.refl, opacity)
  const h = s.h * hScale
  if (s.kind === 'box') return box(parent, [s.x[1] - s.x[0], s.y[1] - s.y[0], h], m, [(s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2, h / 2])
  return cylinder(parent, s.r, h, m, [s.at[0], s.at[1], h / 2], 'z', 16)
}

/** Floor + solids; call with a room to (re)draw it when it changes. `hScale` squashes heights for top views; `opacity` < 1 lets points on surfaces show. */
export function roomModel(parent: THREE.Object3D, hScale = 1, opacity = 1) {
  const g = add(parent, new THREE.Group())
  let last: Room | null = null
  return {
    group: g,
    draw(room: Room) {
      if (room === last) return
      last = room
      for (const c of [...g.children]) {
        g.remove(c)
        if (c instanceof THREE.Mesh) c.geometry.dispose()
      }
      box(g, [room.w, room.d, 0.02], mat('#3a3d45', { rough: 0.9 }), [room.w / 2, room.d / 2, -0.01]).castShadow = false
      for (const s of room.solids) solidMesh(g, s, hScale, opacity)
    },
  }
}

/** Tilted top view: a group in metres (z up) whose far edge leans back. */
export function floorView(parent: THREE.Object3D, at: V3, k: number, tilt = -0.55) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.x = tilt
  g.scale.setScalar(k)
  return g
}

/** Robot base seen in metres, x forward, with an RPLIDAR-style head on top; `k` exaggerates its size. Spin `head`. */
export function lidarRobot(parent: THREE.Object3D, k = 1, bodyM = 0.36) {
  const g = add(parent, new THREE.Group())
  const s = add(g, new THREE.Group())
  s.scale.setScalar(k)
  box(s, [bodyM, bodyM * 0.8, 0.08], mat('#d8dbe2', { rough: 0.55 }), [-bodyM * 0.25, 0, 0.08])
  for (const y of [-1, 1]) cylinder(s, 0.05, 0.03, mat('#1c1c1f', { rough: 0.8 }), [-bodyM * 0.25, y * bodyM * 0.42, 0.05], 'y', 16)
  cylinder(s, 0.05, 0.03, mat('#1c1c1f', { rough: 0.5 }), [-bodyM * 0.1, 0, 0.13], 'z', 24)
  const head = add(s, new THREE.Group(), [-bodyM * 0.1, 0, 0.16])
  cylinder(head, 0.038, 0.035, mat('#2a2c32', { rough: 0.35 }), [0, 0, 0], 'z', 24)
  box(head, [0.012, 0.03, 0.018], mat('#ff5a7a', { rough: 0.3 }), [0.036, 0, 0])
  return { group: g, head, eye: [-bodyM * 0.1 * k, 0, 0.16 * k] as V3 }
}

/** Up to `max` dots of radius `r` (one draw call); `set` then `show(count)`. */
export function pointCloud(parent: THREE.Object3D, max: number, r: number) {
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), max)
  im.frustumCulled = false
  im.castShadow = im.receiveShadow = false
  im.count = 0
  parent.add(im)
  const m4 = new THREE.Matrix4()
  const c = new THREE.Color()
  im.setColorAt(0, c)
  return {
    mesh: im,
    set(i: number, p: V3, color: THREE.Color | string, scale = 1) {
      im.setMatrixAt(i, m4.makeScale(scale, scale, scale).setPosition(...p))
      im.setColorAt(i, typeof color === 'string' ? c.set(color) : color)
    },
    show(count: number) {
      im.count = Math.min(max, count)
      im.instanceMatrix.needsUpdate = true
      im.instanceColor!.needsUpdate = true
    },
  }
}

/** Up to `max` thin rods, one draw call; pass segments each frame they change. */
export function rayFan(parent: THREE.Object3D, max: number, material: THREE.Material, width = 0.03) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max)
  im.frustumCulled = false
  im.castShadow = im.receiveShadow = false
  im.count = 0
  parent.add(im)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const X = new THREE.Vector3(1, 0, 0)
  return (segs: [V3, V3][], w = width) => {
    im.count = Math.min(max, segs.length)
    for (let i = 0; i < im.count; i++) {
      a.set(...segs[i][0])
      b.set(...segs[i][1]).sub(a)
      const L = b.length()
      q.setFromUnitVectors(X, L > 1e-9 ? b.divideScalar(L) : X)
      m4.compose(a.addScaledVector(b, L / 2), q, new THREE.Vector3(L, w, w))
      im.setMatrixAt(i, m4)
    }
    im.instanceMatrix.needsUpdate = true
  }
}

export const LETHAL_C = '#eef0f4'

/** Costmap as instanced bars (metres, z up): height ∝ cost, lethal white, inscribed cyan, inflation red → blue. `draw` skips a grid it just drew. */
export function costField(parent: THREE.Object3D, g: CostGrid, maxH = 0.5) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.7 }), g.nx * g.ny)
  im.castShadow = im.receiveShadow = false
  parent.add(im)
  const m4 = new THREE.Matrix4()
  const c = new THREE.Color()
  const s = g.res * 0.9
  let last: Uint8Array | null = null
  return {
    mesh: im,
    draw(grid: CostGrid) {
      if (grid.cost === last) return
      last = grid.cost
      for (let k = 0; k < grid.cost.length; k++) {
        const v = grid.cost[k]
        const h = Math.max(0.004, (maxH * v) / LETHAL)
        m4.makeScale(s, s, h).setPosition(grid.ox + ((k % grid.nx) + 0.5) * grid.res, grid.oy + (Math.floor(k / grid.nx) + 0.5) * grid.res, h / 2)
        im.setMatrixAt(k, m4)
        im.setColorAt(k, v >= LETHAL ? c.set(LETHAL_C) : v >= INSCRIBED ? c.set(B_FIELD) : v > 0 ? potentialColor(v / (INSCRIBED - 1), c) : c.set('#2e3138'))
      }
      im.instanceMatrix.needsUpdate = true
      im.instanceColor!.needsUpdate = true
    },
  }
}

/** Floor mat in metres with 0.5 m tape lines. */
export function floorMat(g: THREE.Object3D, x: [number, number], y: [number, number]) {
  flatBox(g, [x[1] - x[0], y[1] - y[0], 0.01], mat('#23262d', { rough: 0.85 }), [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, -0.005])
  const tape = mat('#353a44', { rough: 0.8 })
  for (let v = Math.ceil(x[0] * 2) / 2; v <= x[1]; v += 0.5) flatBox(g, [0.01, y[1] - y[0], 0.004], tape, [v, (y[0] + y[1]) / 2, 0.002])
  for (let v = Math.ceil(y[0] * 2) / 2; v <= y[1]; v += 0.5) flatBox(g, [x[1] - x[0], 0.01, 0.004], tape, [(x[0] + x[1]) / 2, v, 0.002])
}

/** Wall across the floor at `x`; `hit(crashed)` lights it red. */
export function crashWall(g: THREE.Object3D, x: number, size = 0.12) {
  const m = glowMat(IDLE, 0.2)
  box(g, [0.06, 0.7, 0.3], m, [x + 0.03, 0, 0.15])
  addLabel(g, 'wall', [x + 0.03, -0.5, 0.02], GREY, size)
  return (crashed: boolean) => setGlow(m, crashed ? HIGH_V : IDLE, crashed ? 1 : 0.2)
}

/** Trail of dots behind a robot on the floor, one every `step` metres. */
export function floorTrail(g: THREE.Object3D, max: number, step: number, color = GREY) {
  const dots = pointCloud(g, max, 0.005 * (step / 0.008))
  const s = { n: 0, acc: 0 }
  return {
    clear() {
      Object.assign(s, { n: 0, acc: 0 })
      dots.show(0)
    },
    add(prev: Pose, p: Pose) {
      s.acc += Math.hypot(p.x - prev.x, p.y - prev.y)
      if (s.acc < step) return
      s.acc = 0
      dots.set(s.n % max, [p.x, p.y, 0.004], color)
      s.n++
      dots.show(Math.min(max, s.n))
    },
  }
}
