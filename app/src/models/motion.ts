import * as THREE from 'three/webgpu'
import { BLACK_PLASTIC, GOLD, STEEL, add, box, cylinder, lathe, lead, mat, mesh, range, tube } from './kit'

/** Yellow 1:48 gearbox + flat motor can; D-shaft along z through x = −4. */
export function buildTtMotor(): THREE.Group {
  const g = new THREE.Group()
  const yellow = mat('#f2c12e', { rough: 0.55 })
  box(g, [14.6, 7.4, 8.9], yellow, [-1.4, 3.7, 0])
  box(g, [3, 1, 8.9], yellow, [-9.9, 0.5, 0]) // mounting tab
  cylinder(g, 0.6, 1.2, BLACK_PLASTIC(), [-9.9, 1.0, 0], 'y', 12)
  cylinder(g, 1.5, 1.6, yellow, [-1, 8.2, 0], 'y', 20) // round stub

  const shaft = mat('#f4f1e8', { rough: 0.5 })
  const shaftGeo = new THREE.CylinderGeometry(1.06, 1.06, 15, 24)
  const s = add(g, mesh(shaftGeo, shaft), [-4, 3.7, 0])
  s.rotation.x = Math.PI / 2
  for (const z of [-1, 1]) box(g, [2.12, 0.4, 3], shaft, [-4, 4.62, z * 6.2]) // D flats

  // Motor can, squashed cylinder, then the end cap with solder tabs.
  const can = cylinder(g, 3.6, 9.8, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [10.8, 3.7, 0], 'x', 32)
  can.scale.set(1, 1, 0.82)
  cylinder(g, 3.1, 1.4, mat('#2c2c2c', { rough: 0.6 }), [16.4, 3.7, 0], 'x', 32).scale.set(1, 1, 0.82)
  for (const z of [-1.4, 1.4]) box(g, [1.2, 0.6, 0.12], GOLD(), [17.4, 5, z])
  tube(g, [[17.8, 5, 1.4], [19.5, 5.5, 2], [21, 3, 3]], 0.25, mat('#d4282b', { rough: 0.5 }))
  tube(g, [[17.8, 5, -1.4], [19.5, 5.5, -2], [21, 3, -3]], 0.25, mat('#202020', { rough: 0.5 }))
  // White strap clamping the can to the gearbox.
  const strap = add(g, mesh(new THREE.TorusGeometry(3.75, 0.25, 8, 32), mat('#f0f0f0')), [8, 3.7, 0])
  strap.rotation.y = Math.PI / 2
  strap.scale.set(1, 1, 0.82)
  return g
}

/** 65 mm TT wheel, axis along z, centered on the origin. */
export function buildWheel(): THREE.Group {
  const g = new THREE.Group()
  const R = 12.8
  const W = 10.2
  const tire = mat('#1e1e1e', { rough: 0.9 })
  const hw = W / 2
  lathe(g, [[R - 2.2, -hw], [R - 0.4, -hw], [R, -hw + 0.8], [R, hw - 0.8], [R - 0.4, hw], [R - 2.2, hw]], tire, [0, 0, 0], 'z', 64)
  // Tread lugs, alternating halves.
  const lug = new THREE.BoxGeometry(0.7, 0.35, W * 0.42)
  range(40).forEach((i) => {
    const a = (i / 40) * Math.PI * 2
    const m = add(g, mesh(lug, tire), [Math.cos(a) * R, Math.sin(a) * R, (i % 2 ? 1 : -1) * W * 0.22])
    m.rotation.z = a
  })
  const rim = mat('#f2c12e', { rough: 0.5 })
  lathe(g, [[R - 2.2, -hw + 0.4], [R - 2.2, hw - 0.4]], rim, [0, 0, 0], 'z', 48)
  cylinder(g, R - 2.2, 0.8, rim, [0, 0, hw - 1.2], 'z', 48)
  range(6).forEach((i) => {
    const a = (i / 6) * Math.PI * 2
    const spoke = box(g, [R - 4, 1.4, 1.2], rim, [Math.cos(a) * (R / 2 - 0.8), Math.sin(a) * (R / 2 - 0.8), hw - 2])
    spoke.rotation.z = a
  })
  cylinder(g, 2.2, W - 2, rim, [0, 0, 0], 'z', 24)
  cylinder(g, 1.06, W - 1.9, mat('#3a3a3a'), [0, 0, 0], 'z', 16)
  return g
}

/** 60 mm mecanum wheel: 9 barrel rollers at 45° between two hub plates, axis along z. */
export function buildMecanum(): THREE.Group {
  const g = new THREE.Group()
  const R = 11.8
  const rollerR = 1.7
  const hub = mat('#aeb3bb', { metal: 0.4, rough: 0.35 })
  const rubber = mat('#2a2a2c', { rough: 0.85 })
  for (const z of [-4.6, 4.6]) cylinder(g, 8.6, 0.8, hub, [0, 0, z], 'z', 9)
  cylinder(g, 2.6, 8.4, hub, [0, 0, 0], 'z', 24)
  cylinder(g, 1.1, 8.6, mat('#3a3a3a'), [0, 0, 0], 'z', 16)

  const len = 8.6
  const profile = range(9).map((i): [number, number] => {
    const t = i / 8
    const y = -len / 2 + t * len
    return [rollerR * (0.62 + 0.38 * Math.sin(t * Math.PI)), y]
  })
  const geo = new THREE.LatheGeometry(
    [new THREE.Vector2(0, -len / 2), ...profile.map(([r, y]) => new THREE.Vector2(r, y)), new THREE.Vector2(0, len / 2)],
    20,
  )
  const n = 9
  const up = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const c = R - rollerR
    const tangent = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0)
    const axis = tangent.multiplyScalar(Math.SQRT1_2).add(zAxis.clone().multiplyScalar(Math.SQRT1_2)).normalize()
    const roller = add(g, mesh(geo, rubber), [Math.cos(a) * c, Math.sin(a) * c, 0])
    roller.quaternion.setFromUnitVectors(up, axis)
    // Roller axle ends, held by brackets folded from each hub plate.
    for (const s of [-1, 1]) {
      const end = roller.position.clone().add(axis.clone().multiplyScalar((s * len) / 2))
      const toHub = new THREE.Vector3(Math.cos(a) * 7.8, Math.sin(a) * 7.8, s * 4.6)
      lead(g, [end.toArray(), toHub.toArray()], 0.35, STEEL())
    }
  }
  return g
}
