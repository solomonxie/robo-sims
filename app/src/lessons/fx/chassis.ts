// Robot chassis seen from above: a see-through plate, two TT motors + wheels, ball caster, 2 × 18650 holder, motor driver,
// ESP32 and IMU from a `ChassisPart[]` layout (metres, x forward, y left, z up), `k` scene units per metre.
import * as THREE from 'three/webgpu'
import { CAR_PACKS, CHASSIS, CarPack, ChassisPart } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { cell18650 } from './cells'
import { esp32Board, i2cBreakout } from './modules'
import { shellMat } from './shapes'

export const ACRYLIC_TINT = '#bcd7f0'

/** `place(parts)` moves the battery (with its top deck when z is above the plate) and the IMU; `at(key)` is a part centre;
 *  `driverPin`/`imuPin(name)` are header pin tips in `group` space; `part(key)` is the group holding one part (to lift or hide it);
 *  `plate: false` leaves the acrylic plate out. */
export function chassisModel(parent: THREE.Object3D, parts: readonly ChassisPart[], k: number, { plate: withPlate = true } = {}) {
  const group = add(parent, new THREE.Group())
  const holders = new Map<string, THREE.Group>()
  const part = (key: string) => holders.get(key) ?? holders.set(key, add(group, new THREE.Group())).get(key)!
  const P = (key: string) => parts.find((p) => p.key === key)!
  const km = k / 1000
  const plate = P('plate')
  const plateT = 0.003 * k
  if (withPlate) box(part('plate'), [plate.size[0] * k, plate.size[1] * k, plateT], shellMat(ACRYLIC_TINT, 0.38, 0.2), [plate.x * k, 0, plate.z * k - plateT / 2])
  const yellow = mat('#f2c12e', { rough: 0.55 })
  const tyre = mat('#2b2d33', { rough: 0.9 })
  const hub = mat('#e0e3e8', { rough: 0.4 })
  for (const key of ['motorL', 'motorR']) {
    const m = P(key)
    const s = Math.sign(m.y)
    const g = part(key)
    box(g, [m.size[0] * k, m.size[1] * k, 0.019 * k], yellow, [m.x * k, m.y * k, m.z * k])
    const wy = s * (CHASSIS.track / 2 + 0.002) * k
    cylinder(g, CHASSIS.wheelR * k, 0.026 * k, tyre, [0, wy, CHASSIS.wheelR * k], 'y', 32)
    cylinder(g, CHASSIS.wheelR * 0.6 * k, 0.027 * k, hub, [0, wy, CHASSIS.wheelR * k], 'y', 6)
  }
  const c = P('caster')
  add(part('caster'), mesh(new THREE.SphereGeometry(0.008 * k, 16, 12), mat('#c9ccd1', { metal: 0.4, rough: 0.3 })), [c.x * k, 0, 0.008 * k])
  box(part('caster'), [0.03 * k, 0.03 * k, 0.004 * k], mat('#3a3d44'), [c.x * k, 0, (CHASSIS.plateZ - 0.005) * k])

  const batt = add(part('battery'), new THREE.Group())
  const b = P('battery')
  box(batt, [b.size[0] * k, b.size[1] * k, 0.004 * k], mat('#1c1c1f', { rough: 0.7 }), [0, 0, -0.01 * k])
  for (const s of [-1, 1]) cell18650(batt, [0, s * 0.0095 * k, 0], 0.009 * k).rotation.z = -Math.PI / 2
  const deck = add(batt, new THREE.Group())
  box(deck, [0.09 * k, 0.06 * k, plateT], shellMat(ACRYLIC_TINT, 0.4, 0.2), [0, 0, -0.0135 * k])
  const post = mat('#c9a13a', { metal: 0.4, rough: 0.4 })
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) cylinder(deck, 0.0025 * k, 0.04 * k, post, [sx * 0.04 * k, sy * 0.026 * k, -0.034 * k], 'z', 8)

  const d = P('driver')
  const driver = i2cBreakout(part('driver'), [d.x * k, d.y * k, d.z * k], { name: 'DRV8833', color: '#b8322a', k: km, pins: ['VM', 'GND', 'A', 'B'] })
  driver.group.rotation.z = -Math.PI / 2
  const e = P('esp32')
  esp32Board(part('esp32'), [e.x * k, e.y * k, e.z * k], 2.54 * km)
  const i = P('imu')
  const imu = i2cBreakout(part('imu'), [0, 0, i.z * k], { name: 'MPU6050', color: '#2a5bd7', k: km })
  imu.group.rotation.z = Math.PI / 2

  const place = (ps: readonly ChassisPart[]) => {
    const bp = ps.find((p) => p.key === 'battery')!
    batt.position.set(bp.x * k, bp.y * k, bp.z * k)
    deck.visible = bp.z > CHASSIS.plateZ
    const ip = ps.find((p) => p.key === 'imu')!
    imu.group.position.set(ip.x * k, ip.y * k, ip.z * k)
  }
  place(parts)
  const turned = (pin: V3, from: V3, at: THREE.Vector3, s: number): V3 => [at.x - s * (pin[1] - from[1]), at.y + s * (pin[0] - from[0]), pin[2]]
  return {
    group,
    place,
    part,
    driverPin: (name: string) => turned(driver.pin(name), [d.x * k, d.y * k, d.z * k], driver.group.position, -1),
    imuPin: (name: string) => turned(imu.pin(name), [0, 0, i.z * k], imu.group.position, 1),
    at: (key: string): V3 => {
      const p = P(key)
      return [p.x * k, p.y * k, p.z * k]
    },
  }
}

/** Battery holder under the plate: n cells side by side along y (18650 or AA). */
export function packHolder(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  let built = ''
  return (pack: CarPack) => {
    if (built === pack) return
    built = pack
    g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    g.clear()
    const P = CAR_PACKS[pack]
    const li = P.chem === 'liion'
    const r = (li ? 0.009 : 0.007) * k
    const pitch = 2.1 * r
    box(g, [(li ? 0.077 : 0.058) * k, P.series * pitch + 0.004 * k, 0.004 * k], mat('#1c1c1f', { rough: 0.7 }), [0, 0, -r - 0.002 * k])
    for (let i = 0; i < P.series; i++) {
      const y = (i - (P.series - 1) / 2) * pitch
      if (li) cell18650(g, [0, y, 0], r).rotation.z = -Math.PI / 2
      else {
        cylinder(g, r, 0.05 * k, mat(P.chem === 'nimh' ? '#2c7a4b' : '#c2552a', { rough: 0.45 }), [0, y, 0], 'x', 20)
        cylinder(g, r * 0.35, 0.053 * k, mat('#d6d8dc', { metal: 0.6, rough: 0.3 }), [0, y, 0], 'x', 12)
      }
    }
  }
}
