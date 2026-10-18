// Sumo ring and 4WD sumo robots, in metres (x forward, y left, z up) inside a `floorView`.
import * as THREE from 'three/webgpu'
import { SUMO_BOT, SUMO_EDGE, SUMO_EYES, SUMO_FRONTS, SUMO_RING, SumoFront } from '../../core/physics'
import { add, box, cylinder, mat, mesh } from '../../models/kit'
import { ringTube } from './bearings'
import { glowMat } from './colors'
import { trackedBot } from './tracked'

/** Mini-sumo ring: raised black disc, white edge, brown start lines `startGap` apart. */
export function sumoRing(parent: THREE.Object3D) {
  const { r, edge, h, startGap } = SUMO_RING
  const g = add(parent, new THREE.Group())
  const disc = cylinder(g, r, h, mat('#141518', { rough: 0.85 }), [0, 0, -h / 2], 'z', 96)
  disc.receiveShadow = true
  ringTube(g, r - edge, r, 0.001, mat('#eef0f3', { rough: 0.5 }), [0, 0, 0.0006]).receiveShadow = true
  for (const s of [1, -1]) box(g, [0.01, 0.2, 0.001], mat('#7a4a26', { rough: 0.7 }), [(s * (startGap + 0.01)) / 2, 0, 0.0006]).castShadow = false
  return g
}

/** Wedge or flat front as a side profile extruded across the width, tip at x = len/2. */
function frontModel(parent: THREE.Object3D, front: SumoFront, w: number) {
  const f = SUMO_FRONTS[front]
  const tip = SUMO_BOT.len / 2
  const g = add(parent, new THREE.Group())
  if (f.deg >= 90) {
    box(g, [0.006, w, 0.05], mat('#9aa0aa', { metal: 0.5, rough: 0.4 }), [tip - 0.003, 0, f.lipMm / 1000 + 0.025])
    return g
  }
  const hgt = 0.03
  const run = hgt / Math.tan((f.deg * Math.PI) / 180)
  const lip = f.lipMm / 1000
  const s = new THREE.Shape([new THREE.Vector2(tip, lip), new THREE.Vector2(tip - run, lip + hgt), new THREE.Vector2(tip - run, lip)])
  const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false })
  geo.translate(0, 0, -w / 2)
  geo.rotateX(Math.PI / 2)
  add(g, mesh(geo, mat(front === 'steel' ? '#6c7380' : '#d8dce4', { metal: front === 'steel' ? 0.5 : 0, rough: 0.45 })))
  if (front === 'steel') box(g, [0.012, w, 0.0012], mat('#e8ecf2', { metal: 0.9, rough: 0.15 }), [tip - 0.006, 0, lip + 0.0015])
  return g
}

/** 4WD TT sumo robot: `trackedBot` wheels, team plate, a swappable front, two ToF rangers and two edge sensors at the front corners.
 *  `set(pose, left, right)` drives it, `lift(m)` raises the nose (pivoting on the rear axle), `scuff([fl, fr, rl, rr])` lights slipping tyres. */
export function sumoBot(parent: THREE.Object3D, team: string, front: SumoFront = 'flat') {
  const bot = trackedBot(parent, { contact: SUMO_BOT.wheelbase, gauge: SUMO_BOT.track, wheels: true })
  box(bot.body, [0.09, 0.07, 0.004], glowMat(team, 0.5), [-0.01, 0, 0.085]).castShadow = false
  const chip = mat('#2a2c32', { rough: 0.6 })
  for (const s of [1, -1]) {
    box(bot.body, [0.01, 0.018, 0.012], chip, [SUMO_EYES.x - 0.012, s * SUMO_EYES.y, 0.06])
    box(bot.body, [0.012, 0.01, 0.004], mat('#1d6fd1', { rough: 0.5 }), [SUMO_EDGE.x - 0.012, s * SUMO_EDGE.y, 0.008])
  }
  let fm = frontModel(bot.body, front, SUMO_BOT.track + 0.01)
  let cur = front
  return {
    ...bot,
    front(f: SumoFront) {
      if (f === cur) return
      bot.body.remove(fm)
      fm = frontModel(bot.body, f, SUMO_BOT.track + 0.01)
      cur = f
    },
    lift(m: number) {
      const a = Math.atan2(m, SUMO_BOT.wheelbase)
      bot.body.rotation.y = -a
      bot.body.position.set(-(SUMO_BOT.wheelbase / 2) * (1 - Math.cos(a)), 0, (SUMO_BOT.wheelbase / 2) * Math.sin(a))
    },
  }
}
