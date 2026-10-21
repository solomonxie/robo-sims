// Mated wire-to-board connectors at real size (mm × k), mating along +x: Dupont on a pin header, JST-PH / JST-XH into a
// keyed shroud, XT30 / XT60 yellow with chamfered (keyed) housings. Pins stack along y.
import * as THREE from 'three/webgpu'
import { ConnectorId } from '../../core/physics'
import { V3, add, box, mat, mesh, GOLD } from '../../models/kit'
import { heatTint } from './heat'

interface PlugShape {
  pitch: number
  /** Board half (header / shroud / female XT) and cable half lengths along x, their thickness (z). */
  baseLen: number
  plugLen: number
  baseT: number
  plugT: number
  color: string
  keyed: boolean
  maxPins: number
}

/** Housing sizes (mm). */
export const PLUG_SHAPES: Record<ConnectorId, PlugShape> = {
  dupont: { pitch: 2.54, baseLen: 2.5, plugLen: 14, baseT: 2.54, plugT: 2.54, color: '#1c1d21', keyed: false, maxPins: 40 },
  jstph: { pitch: 2, baseLen: 6, plugLen: 6, baseT: 4.5, plugT: 3.2, color: '#efe6d0', keyed: true, maxPins: 16 },
  jstxh: { pitch: 2.5, baseLen: 7, plugLen: 6.8, baseT: 5.75, plugT: 4.4, color: '#f1ead8', keyed: true, maxPins: 16 },
  xt30: { pitch: 5, baseLen: 10, plugLen: 10, baseT: 5.6, plugT: 5.6, color: '#f2c200', keyed: true, maxPins: 2 },
  xt60: { pitch: 7.2, baseLen: 15.5, plugLen: 15.5, baseT: 8, plugT: 8, color: '#f2c200', keyed: true, maxPins: 2 },
}

/** Box along x from x0 (len long), h tall (y), t thick (z), two top corners chamfered by `ch` (an XT-style key). */
function chamferBox(len: number, h: number, t: number, ch: number) {
  const s = new THREE.Shape()
  s.moveTo(-t / 2, -h / 2)
  s.lineTo(t / 2, -h / 2)
  s.lineTo(t / 2, h / 2 - ch)
  s.lineTo(t / 2 - ch, h / 2)
  s.lineTo(-t / 2 + ch, h / 2)
  s.lineTo(-t / 2, h / 2 - ch)
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }).rotateY(Math.PI / 2)
}

/** A mated pair at `at`, `k` units per mm, turned a little to show the key. `build(kind, pins)` rebuilds;
 *  `set(gapMm, flipped, heat 0…1, melted)`; `ends(side)` = lead ends (parent coords), board side −1 / cable side +1. */
export function plugPair(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  g.rotation.set(0.25, -0.4, 0)
  const base = add(g, new THREE.Group())
  const plug = add(g, new THREE.Group())
  let shape = PLUG_SHAPES.dupont
  let pins = 2
  let tint = (_: number) => {}
  const ys = () => Array.from({ length: Math.min(pins, shape.maxPins) }, (_, i) => (i - (Math.min(pins, shape.maxPins) - 1) / 2) * shape.pitch)
  return {
    group: g,
    build(kind: ConnectorId, n: number) {
      shape = PLUG_SHAPES[kind]
      pins = n
      base.clear()
      plug.clear()
      const S = shape
      const rows = Math.min(n, S.maxPins)
      const h = rows * S.pitch + S.pitch * (kind === 'dupont' ? 0 : kind === 'xt30' || kind === 'xt60' ? 0.15 : 0.6)
      const body = mat(S.color, { rough: 0.55 }, true)
      const gold = GOLD()
      if (kind === 'xt30' || kind === 'xt60') {
        add(base, mesh(chamferBox(S.baseLen, h, S.baseT, S.baseT * 0.28), body), [-S.baseLen, 0, 0])
        add(plug, mesh(chamferBox(S.plugLen, h, S.plugT, S.plugT * 0.28), body), [0, 0, 0])
        for (const y of ys()) box(plug, [S.plugLen * 0.4, S.pitch * 0.35, S.pitch * 0.35], gold, [-S.plugLen * 0.15, y, 0])
      } else {
        box(base, [S.baseLen, h, S.baseT], kind === 'dupont' ? body : mat(S.color, { rough: 0.5 }, true), [-S.baseLen / 2, 0, 0])
        for (const y of ys()) box(base, [S.baseLen + 7, 0.64, 0.64], gold, [kind === 'dupont' ? 1.5 : -S.baseLen / 2 - 1.5, y, 0])
        box(plug, [S.plugLen, h * (S.plugT / S.baseT) + (kind === 'dupont' ? 0 : 0.4), S.plugT], body, [S.plugLen / 2, 0, 0])
        if (S.keyed) box(plug, [S.plugLen * 0.8, 0.7, S.plugT * 0.5], body, [S.plugLen * 0.45, h / 2 + 0.2, 0])
        if (S.keyed) box(base, [0.6, 0.9, S.baseT * 0.55], mat('#2a2b30'), [-0.3, h / 2 - 0.2, 0])
      }
      tint = heatTint(g)
    },
    set(gapMm: number, flipped: boolean, heat: number, melted: boolean) {
      plug.position.x = gapMm
      plug.rotation.x = flipped ? Math.PI : 0
      plug.scale.set(1, melted ? 0.82 : 1, melted ? 1.15 : 1)
      plug.rotation.z = melted ? -0.08 : 0
      tint(Math.min(0.75, heat))
    },
    /** Lead exits: board side at the header's back, cable side at the plug's back, one per pin. */
    ends(side: -1 | 1): V3[] {
      g.updateMatrixWorld(true)
      const x = side < 0 ? -shape.baseLen - 3 : plug.position.x + shape.plugLen
      return Array.from({ length: pins }, (_, i) => {
        const y = (i - (pins - 1) / 2) * shape.pitch
        const w = g.localToWorld(new THREE.Vector3(x, y, 0))
        return parent.worldToLocal(w).toArray() as V3
      })
    },
  }
}
