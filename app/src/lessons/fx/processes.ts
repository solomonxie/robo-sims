// Other printing processes in printer mm × `k` (X → x, Y → −z, Z → y): MSLA resin printer, SLS powder bed, printed robot parts.
import * as THREE from 'three/webgpu'
import { PickPart, RESIN, SLS } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { glowMat } from './colors'
import { addRod, stretchRod } from './layout'
import { pixelGrid } from './sensing'
import { glowDot, shellMat } from './shapes'

export const UV_COLOR = '#8a5cff'
export const RESIN_COLOR = '#dfe3ea'
export const NYLON_COLOR = '#e6e2d8'
const ALU = () => mat('#aab1bb', { metal: 0.5, rough: 0.4 })
const HOUSING = () => mat('#2b2e35', { rough: 0.6 })

/** Instanced boxes in parent mm × k: `set(i, cx, cy, w, d, y, h, color?)` puts a w × d box (printer x, y) between heights y and y + h. */
function slabs(parent: THREE.Object3D, max: number, k: number, material: THREE.Material) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max)
  im.count = 0
  im.frustumCulled = false
  parent.add(im)
  const M = new THREE.Matrix4()
  const c = new THREE.Color()
  return {
    set(i: number, cx: number, cy: number, w: number, d: number, y: number, h: number, color = '#ffffff') {
      if (i >= max) return
      im.setMatrixAt(i, M.makeScale(w * k, h * k, d * k).setPosition(cx * k, (y + h / 2) * k, -cy * k))
      im.setColorAt(i, c.set(color))
    },
    show(n: number) {
      im.count = Math.max(0, Math.min(max, n))
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    },
  }
}

/** Desktop MSLA printer, vat open at the front: LCD (`lcd`, `cols` × `rows` cells over the plate area) under a resin vat, build plate on a Z column.
 *  `set(plateMm)` plate underside height above the vat floor; `layers` slabs hang from the plate (y down from its underside, mm);
 *  `mask(lit, uv)` lights cells where `lit(x, y)` (plate mm) with UV strength `uv`. */
export function resinPrinter(parent: THREE.Object3D, at: V3, k: number, cols = 64, rows = 40) {
  const g = add(parent, new THREE.Group(), at)
  const [PW, PD] = RESIN.plate
  box(g, [PW + 24, 30, PD + 24].map((v) => v * k) as V3, HOUSING(), [0, -16 * k, 0])
  const lcdHolder = add(g, new THREE.Group(), [0, 0, 0])
  lcdHolder.rotation.x = -Math.PI / 2
  lcdHolder.scale.setScalar(k)
  const pitch = PW / cols
  const lcd = pixelGrid(lcdHolder, [0, 0, 0], cols, rows, pitch)
  const floor = 3
  const vatH = 28
  const vat = shellMat('#c9d2dc', 0.18)
  for (const [w, d, x, z] of [[PW + 14, 3, 0, -PD / 2 - 7], [3, PD + 14, PW / 2 + 7, 0], [3, PD + 14, -PW / 2 - 7, 0]])
    box(g, [w * k, vatH * k, d * k], vat, [x * k, (floor + vatH / 2) * k, z * k])
  box(g, [(PW + 12) * k, 0.6 * k, (PD + 12) * k], shellMat('#dfe6ee', 0.25), [0, (floor - 0.3) * k, 0])
  const resin = box(g, [(PW + 12) * k, 16 * k, (PD + 12) * k], shellMat('#3cae94', 0.14), [0, (floor + 8) * k, 0])
  resin.castShadow = false
  const colX = -(PW / 2 + 20)
  box(g, [16 * k, 56 * k, 16 * k], ALU(), [colX * k, 28 * k, -(PD / 2 + 10) * k])
  const plate = add(g, new THREE.Group())
  box(plate, [(PW - 6) * k, 6 * k, (PD - 4) * k], mat('#5d636e', { metal: 0.5, rough: 0.45 }), [0, 3 * k, 0])
  box(plate, [16 * k, 10 * k, 16 * k], ALU(), [0, 11 * k, 0])
  box(plate, [(Math.abs(colX) + 4) * k, 8 * k, 12 * k], ALU(), [(colX / 2) * k, 12 * k, -(PD / 2 + 10) * k])
  const layers = slabs(plate, 900, k, mat(RESIN_COLOR, { rough: 0.35 }, true))
  const c = new THREE.Color()
  const uv = new THREE.Color(UV_COLOR)
  return {
    group: g,
    plate,
    layers,
    lcd,
    floor,
    set(plateMm: number) {
      plate.position.y = (floor + plateMm) * k
    },
    mask(lit: (x: number, y: number) => boolean, strength: number) {
      for (let r = 0; r < rows; r++)
        for (let cI = 0; cI < cols; cI++) {
          const on = lit((cI - (cols - 1) / 2) * pitch, ((rows - 1) / 2 - r) * pitch)
          c.copy(uv).multiplyScalar(on ? 0.25 + 0.75 * strength : 0.03)
          lcd.set(r * cols + cI, c.r, c.g, c.b)
        }
      lcd.commit()
    },
  }
}

/** Toothed disc, d mm across, 1 mm thick along y (scale y for height). */
function gearGeometry(d: number, teeth = 12) {
  const s = new THREE.Shape()
  const ro = d / 2
  const ri = ro - 2.2
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2
    const r = i % 4 < 2 ? ro : ri
    if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a))
    else s.lineTo(r * Math.cos(a), r * Math.sin(a))
  }
  s.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, d * 0.12, 0, Math.PI * 2, true)
  s.holes.push(hole)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 6 })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** SLS build chamber cut open at the front: a powder bed (see-through) that rises layer by layer, sintered parts inside,
 *  a recoater roller and a galvo-steered laser. `set(powderMm, rollerX | null, spot | null)`; `gears.place(i, x, y, z0, h, color)`. */
export function powderBed(parent: THREE.Object3D, at: V3, k: number, wallH: number, gearD: number, max = 64) {
  const g = add(parent, new THREE.Group(), at)
  const B = SLS.bed
  const wall = mat('#3a3f48', { metal: 0.3, rough: 0.5 })
  box(g, [(B + 16) * k, 6 * k, (B + 16) * k], wall, [0, -3 * k, 0])
  box(g, [(B + 16) * k, wallH * k, 8 * k], wall, [0, (wallH / 2) * k, -(B / 2 + 4) * k])
  for (const s of [-1, 1]) box(g, [8 * k, wallH * k, (B + 16) * k], wall, [s * (B / 2 + 4) * k, (wallH / 2) * k, 0])
  const powder = box(g, [B * k, 1, B * k], shellMat(NYLON_COLOR, 0.32, 0.9), [0, 0, 0])
  powder.castShadow = false
  const top = add(g, mesh(new THREE.PlaneGeometry(B * k, B * k), shellMat('#f4f1ea', 0.22, 1)))
  top.rotation.x = -Math.PI / 2
  const roller = cylinder(g, 5 * k, (B + 10) * k, mat('#b9bec6', { metal: 0.6, rough: 0.3 }), [0, 0, 0], 'z', 16)
  const galvoY = wallH + 35
  box(g, [24 * k, 16 * k, 24 * k], HOUSING(), [0, galvoY * k, 0]).castShadow = false
  const beam = addRod(g, glowMat('#ff4d4d', 1.4))
  const spot = glowDot(g, 2.4 * k, '#ffd84d')
  const im = new THREE.InstancedMesh(gearGeometry(gearD), mat('#ffffff', { rough: 0.85 }, true), max)
  im.count = 0
  im.frustumCulled = false
  g.add(im)
  const M = new THREE.Matrix4()
  const c = new THREE.Color()
  return {
    group: g,
    gears: {
      place(i: number, x: number, y: number, z0: number, h: number, color: string) {
        im.setMatrixAt(i, M.makeScale(k, Math.max(0.01, h) * k, k).setPosition(x * k, z0 * k, -y * k))
        im.setColorAt(i, c.set(color))
      },
      show(n: number) {
        im.count = Math.min(max, n)
        im.instanceMatrix.needsUpdate = true
        if (im.instanceColor) im.instanceColor.needsUpdate = true
      },
    },
    set(powderMm: number, rollerX: number | null, spotAt: [number, number] | null) {
      const h = Math.max(0.5, powderMm)
      powder.scale.y = h * k
      powder.position.y = (h / 2) * k
      top.position.y = h * k + 0.01
      roller.visible = rollerX !== null
      if (rollerX !== null) roller.position.set(rollerX * k, (h + 5) * k, 0)
      beam.visible = spot.visible = spotAt !== null
      if (spotAt) {
        const p: V3 = [spotAt[0] * k, h * k + 0.02, -spotAt[1] * k]
        stretchRod(beam, [0, (galvoY - 8) * k, 0], p, 0.6 * k)
        spot.position.set(...p)
      }
    },
  }
}

/** A robot part in mm × `k`, sitting on y = 0. */
export function printedPart(parent: THREE.Object3D, kind: PickPart, k: number, m: THREE.Material) {
  const g = add(parent, new THREE.Group())
  const b = (w: number, h: number, d: number, x: number, y: number, z: number) => box(g, [w * k, h * k, d * k], m, [x * k, y * k, z * k])
  if (kind === 'gear') {
    const o = add(g, mesh(gearGeometry(30, 14), m))
    o.scale.set(k, 10 * k, k)
  } else if (kind === 'bracket') {
    b(40, 4, 30, 0, 2, 0)
    b(4, 30, 30, -18, 15, 0)
    for (const z of [-11, 11]) b(12, 12, 2, -10, 10, z)
  } else if (kind === 'enclosure') {
    b(80, 2, 60, 0, 1, 0)
    b(80, 40, 2, 0, 20, -29)
    b(80, 40, 2, 0, 20, 29)
    b(2, 40, 60, -39, 20, 0)
    b(2, 40, 60, 39, 20, 0)
    cylinder(g, 3 * k, 6 * k, m, [-30 * k, 5 * k, -20 * k])
    cylinder(g, 3 * k, 6 * k, m, [30 * k, 5 * k, 20 * k])
  } else if (kind === 'finger') {
    b(15, 40, 12, 0, 20, 0)
    b(11, 20, 9, 0, 50, -1.5)
    for (let i = 0; i < 6; i++) b(15.5, 1.6, 2, 0, 16 + i * 7, 6.2)
    cylinder(g, 4 * k, 13 * k, m, [0, 6 * k, 0], 'z', 16)
  } else {
    b(8, 6, 6, 0, 3, 0)
    b(12, 11, 8, 0, 12, 0)
    add(g, mesh(new THREE.SphereGeometry(5 * k, 20, 14), m), [0, 22.5 * k, 0])
    for (const s of [-1, 1]) {
      b(2.5, 9, 2.5, s * 7.5, 13, 0)
      b(1.5, 1.5, 1.5, s * 2, 23, 4.6)
    }
    cylinder(g, 0.5 * k, 5 * k, m, [0, 29 * k, 0], 'y', 6)
  }
  return g
}
