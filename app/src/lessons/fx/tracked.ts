// Tracked (or 4WD skid-steer) chassis on a floor, in metres (x forward, y left, z up).
import * as THREE from 'three/webgpu'
import { Pose, TANK } from '../../core/physics'
import { add, box, cylinder, mat } from '../../models/kit'
import { POWER, glowMat } from './colors'
import { placeAt } from './drive'
import { gearPlastic, spurGear } from './gears'
import { lightPatches, slipPatch } from './wheeled'

const LINK_T = 0.004
/** Point and tangent on a track loop at distance u: bottom run rearward, round the sprocket (rear), top run forward, round the idler (front). */
function loopAt(u: number, L: number, r: number, hc: number): [number, number, number, number] {
  const arc = Math.PI * r
  if (u < L) return [L / 2 - u, LINK_T / 2, -1, 0]
  if (u < L + arc) {
    const a = -Math.PI / 2 - (u - L) / r
    return [-L / 2 + r * Math.cos(a), hc + r * Math.sin(a), Math.sin(a), -Math.cos(a)]
  }
  if (u < 2 * L + arc) return [-L / 2 + (u - L - arc), hc + r, 1, 0]
  const a = Math.PI / 2 - (u - 2 * L - arc) / r
  return [L / 2 + r * Math.cos(a), hc + r * Math.sin(a), Math.sin(a), -Math.cos(a)]
}

/** Small tracked chassis (contact L, gauge B, m): rear drive sprockets, front idlers, road wheels and moving links with grousers; `wheels` swaps the tracks for four 65 mm wheels.
 *  `set(pose, left m, right m)` drives it, `body` takes sinkage/pitch, `scuff([fl, fr, rl, rr])` lights the track ends, `spin(l, r)` the whole belt. */
export function trackedBot(parent: THREE.Object3D, { contact: L = TANK.contact, gauge: B = TANK.gauge, wheels = false } = {}) {
  const group = add(parent, new THREE.Group())
  const body = add(group, new THREE.Group())
  const bw = TANK.belt
  const r = 0.022
  const hc = r + LINK_T
  const rw = TANK.wheelD / 2
  const deckZ = wheels ? rw + 0.01 : hc + 0.012
  const hullW = B - (wheels ? TANK.wheelB : bw) - 0.012
  box(body, [L + 0.03, hullW, 0.04], mat('#4a5a3a', { rough: 0.6 }), [0, 0, deckZ + 0.02])
  box(body, [L * 0.45, hullW * 0.6, 0.018], mat('#1f2126', { rough: 0.6 }), [-L * 0.1, 0, deckZ + 0.049])
  box(body, [0.012, hullW * 0.5, 0.006], glowMat(POWER, 0.8), [L / 2 + 0.012, 0, deckZ + 0.03]).castShadow = false
  const steel = mat('#b8bcc4', { metal: 0.5, rough: 0.35 })
  const rubber = mat('#2b2d33', { rough: 0.9 })
  const sides = [1, -1]
  const rollers: { g: THREE.Object3D; r: number; side: number }[] = []
  const spinM: THREE.MeshStandardMaterial[] = []
  let ends: THREE.MeshStandardMaterial[]
  let links: { im: THREE.InstancedMesh; gr: THREE.InstancedMesh; n: number; P: number } | undefined
  if (wheels) {
    const rim = mat('#e0e3e8', { metal: 0.5, rough: 0.3 })
    const xs = [L / 2, -L / 2]
    xs.forEach((x) =>
      sides.forEach((s) => {
        const roll = add(body, new THREE.Group(), [x, (s * B) / 2, rw])
        cylinder(roll, rw, TANK.wheelB, rubber, [0, 0, 0], 'y', 28)
        cylinder(roll, rw * 0.6, TANK.wheelB + 0.002, rim, [0, 0, 0], 'y', 6)
        box(roll, [rw * 1.3, TANK.wheelB + 0.004, 0.008], glowMat('#ff8c2e', 0.6), [0, 0, 0])
        rollers.push({ g: roll, r: rw, side: s })
      }),
    )
    ends = xs.flatMap((x) => sides.map((s) => slipPatch(group, [0.03, TANK.wheelB + 0.006, 0.002], [x, (s * B) / 2, 0.002])))
    sides.forEach((s) => spinM.push(slipPatch(group, [L + 0.04, 0.008, 0.002], [0, (s * B) / 2, 0.003])))
  } else {
    const P = 2 * L + 2 * Math.PI * (r + LINK_T / 2)
    const n = Math.round(P / 0.011)
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry((P / n) * 0.82, bw, LINK_T), rubber, 2 * n)
    const gr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0025, bw, 0.004), mat('#3d4048', { rough: 0.8 }), 2 * n)
    for (const m of [im, gr]) {
      m.castShadow = true
      m.frustumCulled = false
      body.add(m)
    }
    links = { im, gr, n, P }
    sides.forEach((s) => {
      const y = (s * B) / 2
      const sp = add(body, new THREE.Group(), [-L / 2, y, hc])
      const gear = spurGear(sp, 10, (2 * r) / 10, bw * 0.7, steel)
      gear.rotation.x = Math.PI / 2
      cylinder(sp, 0.007, bw + 0.012, mat('#e0b040', { metal: 0.4, rough: 0.4 }), [0, 0, 0], 'y', 12)
      rollers.push({ g: sp, r, side: s })
      const idl = add(body, new THREE.Group(), [L / 2, y, hc])
      cylinder(idl, r * 0.92, bw * 0.8, steel, [0, 0, 0], 'y', 24)
      box(idl, [r * 1.4, bw * 0.84, 0.005], gearPlastic(), [0, 0, 0])
      rollers.push({ g: idl, r, side: s })
      const k = Math.max(3, Math.round(L / 0.05))
      for (let i = 0; i < k; i++) {
        const rr = 0.011
        const wl = add(body, new THREE.Group(), [-L / 2 + r + ((L - 2 * r) * (i + 0.5)) / k, y, LINK_T + rr])
        cylinder(wl, rr, bw * 0.8, steel, [0, 0, 0], 'y', 16)
        box(wl, [rr * 1.5, bw * 0.84, 0.003], gearPlastic(), [0, 0, 0])
        rollers.push({ g: wl, r: rr, side: s })
      }
    })
    ends = [L / 2, -L / 2].flatMap((x) => sides.map((s) => slipPatch(group, [0.035, bw + 0.01, 0.002], [x, (s * B) / 2, 0.002])))
    sides.forEach((s) => spinM.push(slipPatch(group, [L, bw + 0.012, 0.002], [0, (s * B) / 2, 0.0025])))
  }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
  const v = new THREE.Vector3()
  const place = (travel: [number, number]) => {
    if (!links) return
    const { im, gr, n, P } = links
    sides.forEach((s, k) => {
      for (let i = 0; i < n; i++) {
        const u = ((((i * P) / n + travel[1 - k]) % P) + P) % P
        const [x, z, tx, tz] = loopAt(u, L, r + LINK_T / 2, hc)
        q.setFromAxisAngle(yAxis, Math.atan2(-tz, tx))
        im.setMatrixAt(k * n + i, m4.compose(v.set(x, (s * B) / 2, z), q, one))
        gr.setMatrixAt(k * n + i, m4.compose(v.set(x - tz * 0.003, (s * B) / 2, z + tx * 0.003), q, one))
      }
    })
    im.instanceMatrix.needsUpdate = gr.instanceMatrix.needsUpdate = true
  }
  place([0, 0])
  return {
    group,
    body,
    set(p: Pose, left: number, right: number) {
      placeAt(group, p, group.position.z)
      rollers.forEach((w) => (w.g.rotation.y = (w.side > 0 ? left : right) / w.r))
      place([left, right])
    },
    scuff(u: number[]) {
      lightPatches(ends, u)
    },
    spin(left: number, right: number) {
      lightPatches(spinM, [left, right])
    },
  }
}
