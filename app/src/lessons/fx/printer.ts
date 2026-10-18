// FDM printers in printer mm × `k` (printer X → x, Y → −z, Z → y): bed slinger, CoreXY, delta, hotend cut-away, printed beads.
import * as THREE from 'three/webgpu'
import { DELTA, deltaCarriages, deltaTower, hotendZones, HotendKey } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, STEEL } from '../../models/kit'
import { B_FIELD, DATA_COLOR, GREY, HEAT, POWER, RING, glowMat, ironbow } from './colors'
import { gearBrass, leadScrew, spurGear } from './gears'
import { addRod, stretchRod } from './layout'
import { shellMat } from './shapes'
import { clamp01 } from './util'

const ALU = () => mat('#aab1bb', { metal: 0.5, rough: 0.4 })
const EXTRUSION = () => mat('#33363d', { metal: 0.4, rough: 0.5 })
export const FILAMENT_COLOR = '#ff8a3d'

/** Clones the materials under `group` so `set(f)` makes it glow (0 = off). */
export function partGlow(group: THREE.Object3D, color = RING) {
  const mats: THREE.MeshStandardMaterial[] = []
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && m.material instanceof THREE.MeshStandardMaterial && !m.material.userData.own) mats.push((m.material = m.material.clone()))
  })
  const c = new THREE.Color(color)
  return (f: number) => {
    for (const m of mats) {
      m.emissive.copy(c)
      m.emissiveIntensity = f * 0.55
    }
  }
}

/** Stepper motor block, 42 mm square, shaft along +z. */
export function stepperBlock(parent: THREE.Object3D, at: V3, k: number, len = 40) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [42 * k, 42 * k, len * k], mat('#2b2d33', { rough: 0.55 }), [0, 0, (-len * k) / 2])
  box(g, [43 * k, 43 * k, 8 * k], ALU(), [0, 0, -len * k + 4 * k])
  box(g, [43 * k, 43 * k, 6 * k], ALU(), [0, 0, -3 * k])
  cylinder(g, 2.5 * k, 20 * k, STEEL(), [0, 0, 8 * k], 'z', 12)
  return g
}

export const BED_TOP = 64
const NOZ_DROP = 60
const NOZ_Z = 30

export type PrinterPart = 'frame' | 'x' | 'y' | 'z' | 'hotend' | 'extruder' | 'bed' | 'board' | 'psu' | 'spool'

/** Bed-slinger Cartesian printer (220 mm bed): X carriage on a belt, Y moves the bed, Z lead screws lift the gantry.
 *  `set(x, y, z, turn)` nozzle at bed (x, y) mm from its centre, z mm above it, extruder gear turned `turn` rad. `bed` holds printed parts
 *  (bed-local mm: x, −y, z up from the bed top); `glow(part, f)`; `nozzle()` world tip; `pin` points for labels. */
export function fdmPrinter(parent: THREE.Object3D, at: V3, k: number) {
  const group = add(parent, new THREE.Group(), at)
  const parts = {} as Record<PrinterPart, THREE.Group>
  for (const p of ['frame', 'x', 'y', 'z', 'hotend', 'extruder', 'bed', 'board', 'psu', 'spool'] as PrinterPart[]) parts[p] = add(group, new THREE.Group())
  const K = (v: V3): V3 => [v[0] * k, v[1] * k, v[2] * k]
  const ex = EXTRUSION()
  const f = parts.frame
  for (const x of [-70, 70]) box(f, K([40, 40, 420]), ex, K([x, 20, 0]))
  box(f, K([380, 40, 40]), ex, K([0, 20, 0]))
  for (const x of [-170, 170]) box(f, K([20, 420, 40]), ex, K([x, 250, 0]))
  box(f, K([380, 20, 40]), ex, K([0, 470, 0]))

  const bedSlide = add(parts.y, new THREE.Group())
  box(bedSlide, K([240, 6, 240]), ALU(), K([0, 52, 0]))
  stepperBlock(parts.y, K([-40, 42, -232]), k).rotation.y = Math.PI
  box(parts.y, K([6, 3, 400]), mat('#2a2c31', { rough: 0.8 }), K([0, 44, 0]))
  const bedM = mat('#3a3f48', { metal: 0.3, rough: 0.35 }, true)
  box(parts.bed, K([220, 4, 220]), bedM, [0, 0, 0])
  box(parts.bed, K([214, 0.6, 214]), mat('#2b2b30', { rough: 0.8 }), K([0, 2.2, 0]))
  const bed = add(parts.bed, new THREE.Group(), K([0, 2.5, 0]))

  const gantry = add(parts.z, new THREE.Group())
  box(gantry, K([360, 40, 20]), ex, [0, 0, 0])
  const screws = [-150, 150].map((x) => {
    stepperBlock(parts.z, K([x, 60, -30]), k).rotation.x = -Math.PI / 2
    return leadScrew(parts.z, K([x, 64, -30]), 380 * k, { r: 4 * k, lead: 8 * k })
  })

  const carriage = add(parts.x, new THREE.Group())
  add(gantry, parts.x)
  box(carriage, K([64, 60, 8]), ALU(), K([0, 0, 14]))
  stepperBlock(gantry, K([-148, 0, 32]), k)
  for (const y of [-12, 12]) box(gantry, K([290, 4, 2]), mat('#2a2c31', { rough: 0.8 }), K([0, y, 12]))

  add(carriage, parts.hotend)
  const h = parts.hotend
  for (let i = 0; i < 9; i++) cylinder(h, 11 * k, 1.6 * k, ALU(), K([0, -26 - i * 3, NOZ_Z]), 'y', 20)
  cylinder(h, 3 * k, 30 * k, ALU(), K([0, -38, NOZ_Z]), 'y', 12)
  const blockM = mat('#b9bec6', { metal: 0.5, rough: 0.35 }, true)
  box(h, K([20, 10, 16]), blockM, K([2, -51, NOZ_Z]))
  add(h, mesh(new THREE.ConeGeometry(3.5 * k, 5 * k, 6), mat('#d9b24a', { metal: 0.45, rough: 0.35 })), K([0, -58.5, NOZ_Z])).rotation.x = Math.PI
  const fan = add(h, new THREE.Group(), K([0, -36, NOZ_Z + 18]))
  box(fan, K([30, 30, 8]), mat('#1c1d22', { rough: 0.6 }), [0, 0, 0])
  const blades = add(fan, new THREE.Group(), K([0, 0, 4.5]))
  for (let i = 0; i < 5; i++) box(blades, K([22, 4, 1]), mat('#3a3d46'), [0, 0, 0]).rotation.z = (i * Math.PI) / 5

  add(carriage, parts.extruder)
  const e = parts.extruder
  box(e, K([36, 26, 30]), mat('#d23b3b', { rough: 0.5 }), K([0, 18, NOZ_Z]))
  stepperBlock(e, K([0, 54, NOZ_Z + 4]), k, 26)
  const eGear = add(e, new THREE.Group(), K([0, 18, NOZ_Z + 16]))
  spurGear(eGear, 16, 1.2 * k, 3 * k, gearBrass())

  const b = parts.board
  box(b, K([12, 110, 150]), mat('#1d1e22', { rough: 0.6 }), K([226, 80, 90]))
  box(b, K([2, 90, 120]), mat('#1f6b3a', { rough: 0.6 }), K([234, 80, 90]))
  for (let i = 0; i < 4; i++) box(b, K([4, 15, 20]), mat('#7a2fb3'), K([237, 105, 50 + i * 26]))
  box(b, K([5, 20, 20]), mat('#202020'), K([237, 60, 90]))
  box(parts.psu, K([50, 110, 200]), mat('#c9ced6', { metal: 0.5, rough: 0.4 }), K([226, 75, -110]))
  for (let i = 0; i < 6; i++) box(parts.psu, K([2, 80, 6]), mat('#2a2c31'), K([252, 75, -180 + i * 22]))

  const s = parts.spool
  box(s, K([8, 60, 8]), ex, K([60, 510, 0]))
  cylinder(s, 6 * k, 90 * k, STEEL(), K([60, 540, 0]), 'x', 12)
  const spoolSpin = add(s, new THREE.Group(), K([60, 540, 0]))
  const plastic = mat('#e8e6df', { rough: 0.5 })
  for (const x of [-32, 32]) cylinder(spoolSpin, 95 * k, 3 * k, plastic, K([x, 0, 0]), 'x', 40)
  cylinder(spoolSpin, 80 * k, 60 * k, mat(FILAMENT_COLOR, { rough: 0.55 }), [0, 0, 0], 'x', 40)
  cylinder(spoolSpin, 30 * k, 61 * k, plastic, [0, 0, 0], 'x', 24)
  const feed = addRod(group, mat(FILAMENT_COLOR, { rough: 0.5 }))
  const tubeM = shellMat('#e8f2ff', 0.35)
  const ptfe = addRod(group, tubeM)

  bedM.userData.own = blockM.userData.own = true
  const order: PrinterPart[] = ['z', 'x', 'hotend', 'extruder', 'frame', 'y', 'bed', 'board', 'psu', 'spool']
  const glows = Object.fromEntries(order.map((p) => [p, partGlow(parts[p])])) as Record<PrinterPart, (f: number) => void>
  const nozzleW = new THREE.Vector3()
  const st = { x: 0, y: 0, z: 0 }
  return {
    group,
    bed,
    parts,
    fan: blades,
    glow: (p: PrinterPart, v: number) => glows[p](v),
    heat(bedF: number, blockF: number) {
      ironbow(0.2 + 0.6 * clamp01(bedF), bedM.emissive)
      bedM.emissiveIntensity = clamp01(bedF) * 0.5
      ironbow(0.3 + 0.6 * clamp01(blockF), blockM.emissive)
      blockM.emissiveIntensity = clamp01(blockF) * 0.8
    },
    set(x: number, y: number, z: number, turn = 0) {
      st.x = x
      st.y = y
      st.z = z
      gantry.position.set(0, (BED_TOP + z + NOZ_DROP) * k, 0)
      carriage.position.x = x * k
      bedSlide.position.z = (y + NOZ_Z) * k
      parts.bed.position.set(0, (BED_TOP - 4) * k, (y + NOZ_Z) * k)
      for (const sc of screws) sc.set((z + NOZ_DROP) * k)
      eGear.rotation.z = turn
      spoolSpin.rotation.x = -turn * 0.08
      const top = K([x, BED_TOP + z + NOZ_DROP + 35, NOZ_Z])
      stretchRod(feed, K([60, 470, 0]), top, 0.9 * k)
      stretchRod(ptfe, K([60, 470, 0]), top, 2.2 * k)
    },
    nozzle() {
      return group.localToWorld(nozzleW.set(st.x * k, (BED_TOP + st.z) * k, NOZ_Z * k))
    },
    /** Label anchors (printer-local scene units) per part. */
    pin(p: PrinterPart): V3 {
      const g = (BED_TOP + st.z + NOZ_DROP) * k
      const map: Record<PrinterPart, V3> = {
        frame: K([-170, 380, 0]),
        x: [-148 * k, g, 32 * k],
        y: K([0, 52, 120 + st.y + NOZ_Z]),
        z: K([150, 200, -30]),
        hotend: [st.x * k, g - 48 * k, NOZ_Z * k],
        extruder: [st.x * k, g + 30 * k, NOZ_Z * k],
        bed: K([90, BED_TOP, 90 + st.y + NOZ_Z]),
        board: K([236, 80, 90]),
        psu: K([250, 75, -110]),
        spool: K([60, 540, 0]),
      }
      return map[p]
    },
  }
}

/** Instanced extrusion beads in bed-local printer mm (x, y on the bed, z up). `lay(i, a, b, z, w, h, color?)`, `show(n)`. */
export function printBeads(parent: THREE.Object3D, max: number, k: number, color = FILAMENT_COLOR) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), m, max)
  im.count = 0
  im.frustumCulled = false
  parent.add(im)
  const M = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const Y = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  return {
    mesh: im,
    max,
    lay(i: number, a: readonly [number, number], b: readonly [number, number], z: number, w: number, hgt: number, col = color) {
      if (i >= max) return
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy)
      q.setFromAxisAngle(Y, Math.atan2(dy, dx))
      M.compose(p.set(((a[0] + b[0]) / 2) * k, (z + hgt / 2) * k, (-(a[1] + b[1]) / 2) * k), q, s.set((len + w * 0.6) * k, hgt * k, w * k))
      im.setMatrixAt(i, M)
      im.setColorAt(i, c.set(col))
    },
    show(n: number) {
      im.count = Math.max(0, Math.min(max, n))
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    },
  }
}

/** Thermal colour for a filament or metal temperature, 25 … 260 °C. */
export const tempColor = (c: number, out = new THREE.Color()) => ironbow(0.08 + 0.85 * clamp01((c - 25) / 235), out)

/** Hotend cut open along its axis (path s mm down from the drive gears → y = −s·k): drive + idler gears, finned cold zone,
 *  heat break, heater block (cartridge left, thermistor right) and nozzle. `set(travel, coreAt(s), blockC, gearAngle)`. */
export function hotendSection(parent: THREE.Object3D, at: V3, k: number, hotend: HotendKey) {
  const group = add(parent, new THREE.Group(), at)
  const z = hotendZones(hotend)
  const Y = (s: number) => -s * k
  const R = 0.875
  const gears = [-1, 1].map((sx) => {
    const g = add(group, new THREE.Group(), [sx * (5.5 + R) * k, Y(3), 0])
    spurGear(g, 22, 0.5 * k, 4 * k, sx < 0 ? gearBrass() : STEEL())
    return g
  })
  const sinkM = shellMat('#aab1bb', 0.28, 0.4)
  for (let s = z.cold[0] + 1; s < z.cold[1]; s += 2.5) cylinder(group, 11 * k, 1.2 * k, sinkM, [0, Y(s), 0], 'y', 32)
  cylinder(group, 3.2 * k, (z.cold[1] - z.cold[0]) * k, shellMat('#aab1bb', 0.35, 0.4), [0, Y((z.cold[0] + z.cold[1]) / 2), 0], 'y', 16)
  cylinder(group, 2.4 * k, (z.brk[1] - z.brk[0]) * k, shellMat('#c9ced6', 0.55, 0.3), [0, Y((z.brk[0] + z.brk[1]) / 2), 0], 'y', 16)
  const blockLen = z.hot[1] - z.hot[0] - 4
  const blockM = new THREE.MeshPhysicalMaterial({ color: '#b9bec6', transparent: true, opacity: 0.3, roughness: 0.3, metalness: 0.3, depthWrite: false })
  box(group, [22 * k, blockLen * k, 14 * k], blockM, [2 * k, Y(z.hot[0] + blockLen / 2), 0])
  const cart = cylinder(group, 3 * k, 14 * k, mat('#8a8f99', { metal: 0.5, rough: 0.4 }, true), [-6 * k, Y(z.hot[0] + blockLen / 2), 0], 'z', 16)
  cylinder(group, 1.2 * k, 6 * k, mat('#e8e6df', { rough: 0.5 }), [6 * k, Y(z.hot[0] + blockLen / 2), 4 * k], 'z', 10)
  const nozzle = add(group, mesh(new THREE.CylinderGeometry(0.6 * k, 4 * k, 4 * k, 6, 1, true), new THREE.MeshPhysicalMaterial({ color: '#d9b24a', transparent: true, opacity: 0.45, metalness: 0.4, roughness: 0.35, depthWrite: false, side: THREE.DoubleSide })), [0, Y(z.tip - 2), 0])
  nozzle.castShadow = false

  const N = 90
  const top = -10
  const step = (z.tip - top) / N
  const segs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshStandardMaterial({ roughness: 0.5 }), N)
  segs.frustumCulled = false
  group.add(segs)
  const M = new THREE.Matrix4()
  const c = new THREE.Color()
  const Q = new THREE.Quaternion()
  const rAt = (s: number) => (s < z.tip - 4 ? R : R - ((s - (z.tip - 4)) / 4) * (R - 0.25))
  for (let i = 0; i < N; i++) {
    const s = top + (i + 0.5) * step
    M.compose(new THREE.Vector3(0, Y(s), 0), Q, new THREE.Vector3(rAt(s) * k, step * k * 1.02, rAt(s) * k))
    segs.setMatrixAt(i, M)
  }
  const marks = Array.from({ length: 6 }, () => add(group, mesh(new THREE.TorusGeometry(R * k * 1.02, 0.12 * k, 6, 16), glowMat('#ffffff', 0.4))))
  for (const m of marks) m.rotation.x = Math.PI / 2
  return {
    group,
    gears,
    cartridge: cart,
    blockMat: blockM,
    tipY: Y(z.tip),
    y: Y,
    set(travel: number, coreAt: (s: number) => number, blockC: number, gearAngle: number) {
      for (let i = 0; i < N; i++) segs.setColorAt(i, tempColor(coreAt(top + (i + 0.5) * step), c))
      if (segs.instanceColor) segs.instanceColor.needsUpdate = true
      gears[0].rotation.z = gearAngle
      gears[1].rotation.z = -gearAngle
      const spacing = 4
      marks.forEach((m, i) => {
        const s = top + ((((travel + i * spacing) % (spacing * marks.length)) + spacing * marks.length) % (spacing * marks.length))
        m.position.y = Y(s)
        m.visible = s < z.hot[0]
      })
      const hot = clamp01((blockC - 25) / 235)
      tempColor(blockC, blockM.emissive)
      blockM.emissiveIntensity = hot * 0.5
      const cm = cart.material as THREE.MeshStandardMaterial
      tempColor(blockC + 40, cm.emissive)
      cm.emissiveIntensity = hot
    },
  }
}

/** CoreXY gantry (frame half-size `W` mm): motors A (back right) and B (back left), two crossed belt loops, gantry + carriage.
 *  `set(x, y)` nozzle mm; `glowMotor(i, f)`. Belt A = X + Y, B = X − Y. */
export function coreXYPrinter(parent: THREE.Object3D, at: V3, k: number, W = 120) {
  const group = add(parent, new THREE.Group(), at)
  const ex = EXTRUSION()
  const K = (x: number, y: number, h = 0): V3 => [x * k, h * k, -y * k]
  for (const s of [-1, 1]) {
    box(group, [(2 * W + 40) * k, 20 * k, 20 * k], ex, K(0, s * (W + 10), -10))
    box(group, [20 * k, 20 * k, (2 * W + 40) * k], ex, K(s * (W + 10), 0, -10))
  }
  box(group, [2 * W * 0.85 * k, 4 * k, 2 * W * 0.85 * k], mat('#3a3f48', { metal: 0.3, rough: 0.4 }), K(0, 0, -60))
  const motors = [1, -1].map((sx) => {
    const m = add(group, new THREE.Group(), K(sx * W, W, 0))
    stepperBlock(m, [0, 0, 0], k).rotation.x = Math.PI / 2
    return partGlow(m)
  })
  const gantry = add(group, new THREE.Group())
  box(gantry, [2 * W * k, 14 * k, 20 * k], ex, [0, 0, 0])
  const carriage = add(gantry, new THREE.Group())
  box(carriage, [44 * k, 24 * k, 44 * k], mat('#d23b3b', { rough: 0.5 }), [0, 4 * k, 0])
  add(carriage, mesh(new THREE.ConeGeometry(4 * k, 12 * k, 6), mat('#d9b24a', { metal: 0.45 })), [0, -14 * k, 0]).rotation.x = Math.PI
  const beltA = mat('#2a5bd7', { rough: 0.6 })
  const beltB = mat('#2fa84f', { rough: 0.6 })
  const rods = [beltA, beltB].map((m) => Array.from({ length: 6 }, () => addRod(group, m)))
  return {
    group,
    glowMotor: (i: number, f: number) => motors[i](f),
    set(x: number, y: number) {
      gantry.position.set(0, 4 * k, -y * k)
      carriage.position.x = x * k
      const i = W - 8
      const j = W - 14
      const loops: [number, number, number][][] = [
        [[x + 22, y, 6], [W, y + 6, 6], [W, W, 6], [-W, W, 6], [-W, -W, 6], [-i, y - 6, 6], [x - 22, y, 6]],
        [[x - 22, y, 12], [-j, y + 6, 12], [-j, j, 12], [j, j, 12], [j, -j, 12], [j - 8, y - 6, 12], [x + 22, y, 12]],
      ]
      loops.forEach((pts, b) => pts.slice(0, -1).forEach((p, s) => stretchRod(rods[b][s], K(p[0], p[1], p[2]), K(pts[s + 1][0], pts[s + 1][1], pts[s + 1][2]), 2.2 * k)))
    },
  }
}

/** Linear delta: three towers with carriages, parallel arm pairs to the effector, round bed. `set(x, y, z)`; `glowMotor(i, f)`. */
export function deltaPrinter(parent: THREE.Object3D, at: V3, k: number, height = 360) {
  const group = add(parent, new THREE.Group(), at)
  const ex = EXTRUSION()
  const off = 30
  const K = (x: number, y: number, h: number): V3 => [x * k, h * k, -y * k]
  cylinder(group, 110 * k, 4 * k, mat('#3a3f48', { metal: 0.3, rough: 0.4 }), [0, -2 * k, 0], 'y', 48)
  const towers = [0, 1, 2].map((i) => {
    const [tx, ty] = deltaTower(i)
    const u = Math.hypot(tx, ty)
    const ux = tx / u
    const uy = ty / u
    const base: [number, number] = [tx + ux * off, ty + uy * off]
    box(group, [20 * k, height * k, 20 * k], ex, K(base[0] + ux * 14, base[1] + uy * 14, height / 2 - 20))
    const car = add(group, new THREE.Group())
    box(car, [36 * k, 30 * k, 14 * k], mat('#d23b3b', { rough: 0.5 }), [0, 0, 0])
    car.rotation.y = Math.atan2(ux, -uy) + Math.PI / 2
    const motor = add(group, new THREE.Group(), K(base[0] + ux * 14, base[1] + uy * 14, -40))
    box(motor, [42 * k, 42 * k, 42 * k], mat('#2b2d33', { rough: 0.55 }), [0, 0, 0])
    const arms = [addRod(group, STEEL()), addRod(group, STEEL())]
    return { ux, uy, base, car, arms, glow: partGlow(motor) }
  })
  const eff = add(group, new THREE.Group())
  cylinder(eff, 34 * k, 8 * k, mat('#c9ced6', { metal: 0.5 }), [0, 0, 0], 'y', 6)
  add(eff, mesh(new THREE.ConeGeometry(4 * k, 12 * k, 6), mat('#d9b24a', { metal: 0.45 })), [0, -10 * k, 0]).rotation.x = Math.PI
  const NZ = 16
  return {
    group,
    glowMotor: (i: number, f: number) => towers[i].glow(f),
    set(x: number, y: number, z: number) {
      const c = deltaCarriages(x, y, z)
      eff.position.set(...K(x, y, z + NZ))
      towers.forEach((t, i) => {
        t.car.position.set(...K(t.base[0], t.base[1], c[i] + NZ))
        const px = -t.uy * 22
        const py = t.ux * 22
        t.arms.forEach((a, j) => {
          const s = j ? 1 : -1
          stretchRod(a, K(t.base[0] + s * px, t.base[1] + s * py, c[i] + NZ), K(x + t.ux * off + s * px, y + t.uy * off + s * py, z + NZ), 2.4 * k)
        })
      })
    },
    reach: DELTA.L,
  }
}

/** G-code line colours: moves blue, heaters orange, fan cyan, modes violet, home/motors green, comments and folds grey. */
export const GCODE_TINT = { move: '#8ab8ff', heat: HEAT, fan: B_FIELD, mode: DATA_COLOR, machine: POWER, note: GREY }
export const GCODE_LEGEND = [
  { color: GCODE_TINT.move, label: 'G0/G1 moves', shape: 'dot' },
  { color: GCODE_TINT.heat, label: 'M104/M109 nozzle, M140/M190 bed', shape: 'dot' },
  { color: GCODE_TINT.fan, label: 'M106/M107 part fan', shape: 'dot' },
] as const
export const gcodeTint = (l: string) => {
  const c = l.trim().split(/\s/)[0].toUpperCase()
  if (!c || c.startsWith(';')) return GCODE_TINT.note
  if (/^G[01]$/.test(c)) return GCODE_TINT.move
  if (/^M(104|109|140|190)$/.test(c)) return GCODE_TINT.heat
  if (/^M10[67]$/.test(c)) return GCODE_TINT.fan
  if (/^(G9[012]|M8[23])$/.test(c)) return GCODE_TINT.mode
  return GCODE_TINT.machine
}
