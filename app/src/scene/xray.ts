// "Under the hood" layer: parts turn glassy, the board's hidden copper strips appear,
// and dots trace the LED loop's current (conventional, + to −) through every part.
import * as THREE from 'three/webgpu'
import { Hole, holePosition, netKeyOf, railHasColumn, RAIL_ROWS, TOP_ROWS, BOTTOM_ROWS, COLUMNS } from '../core/breadboard'
import { LedReading } from '../core/circuit'
import { HOUSING_TOP, jumperPoints, leadPoints } from '../models/wire'

const CLIP_Y = -1.2
const LED_BASE = 1.2
const DOTS = 48

export const XRAY_LEGEND = [
  { color: '#ff5a4a', label: 'Supply (+)' },
  { color: '#ffa24a', label: 'After resistor' },
  { color: '#4a8bff', label: 'Ground (−)' },
]

const hole = (row: string, col: number) => holePosition({ row, col } as Hole)
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const at = (p: { x: number; z: number }, y = CLIP_Y) => v(p.x, y, p.z)
const toVec = (pts: [number, number, number][]) => pts.map((p) => v(...p))
const smooth = (pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(pts.length * 8)

/** Path along `points`, sampled by distance. */
class Polyline {
  private lengths: number[] = [0]
  constructor(private points: THREE.Vector3[]) {
    for (let i = 1; i < points.length; i++) this.lengths.push(this.lengths[i - 1] + points[i].distanceTo(points[i - 1]))
  }
  get length() {
    return this.lengths[this.lengths.length - 1]
  }
  sample(d: number, out: THREE.Vector3): THREE.Vector3 {
    const t = ((d % this.length) + this.length) % this.length
    let i = 1
    while (this.lengths[i] < t) i++
    const k = (t - this.lengths[i - 1]) / (this.lengths[i] - this.lengths[i - 1] || 1)
    return out.lerpVectors(this.points[i - 1], this.points[i], k)
  }
}

const ghostLevel = (name: string) => (name === 'desk' ? 0.1 : name.startsWith('breadboard') ? 0.03 : 0.12)

interface Saved {
  transparent: boolean
  opacity: number
  depthWrite: boolean
}

export interface Xray {
  setOn: (on: boolean) => void
  update: (dt: number, reading: LedReading) => void
}

export function createXray(opts: { scene: THREE.Scene; targets: () => THREE.Object3D[]; batteryLeads: { pos: THREE.Vector3; neg: THREE.Vector3 } }): Xray {
  const { scene, targets, batteryLeads } = opts
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const copper = new THREE.MeshStandardMaterial({ color: '#8c6239', metalness: 0.5, roughness: 0.4 })
  const hot = (color: string) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3, roughness: 0.4 })
  const HOT = { supply: hot('#ff5a4a'), mid: hot('#ffa24a'), ground: hot('#4a8bff') }
  const ENERGIZED: Record<string, THREE.MeshStandardMaterial> = {
    'rail-top+': HOT.supply,
    'strip-top-10': HOT.supply,
    'strip-top-14': HOT.mid,
    'strip-top-15': HOT.ground,
    'rail-top-': HOT.ground,
  }

  // Copper under the plastic: one bar per column half, one per rail.
  const bars = new Map<string, THREE.Mesh>()
  const addBar = (key: string, x0: number, x1: number, z0: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.3, 0.14, z1 - z0 + 0.3), copper)
    m.position.set((x0 + x1) / 2, CLIP_Y, (z0 + z1) / 2)
    group.add(m)
    bars.set(key, m)
  }
  for (let col = 1; col <= COLUMNS; col++) {
    for (const rows of [TOP_ROWS, BOTTOM_ROWS]) {
      const a = hole(rows[0], col)
      const b = hole(rows[rows.length - 1], col)
      addBar(netKeyOf({ row: rows[0], col }), a.x, b.x, a.z, b.z)
    }
  }
  for (const row of RAIL_ROWS) {
    const cols = Array.from({ length: COLUMNS }, (_, i) => i + 1).filter(railHasColumn)
    const a = hole(row, cols[0])
    const b = hole(row, cols[cols.length - 1])
    addBar(netKeyOf({ row, col: cols[0] }), a.x, b.x, a.z, b.z)
  }

  // Current path, + terminal → rail → R1 → LED → rail → − terminal → back through the cell.
  const posHole = hole('top+', 2)
  const negHole = hole('top-', 3)
  const r1 = hole('c', 12)
  const led = { x: hole('e', 14).x + 0.5, z: hole('e', 14).z }
  const down = (p: THREE.Vector3) => v(p.x, CLIP_Y, p.z)
  const jumpA = toVec(jumperPoints(hole('top+', 10), hole('a', 10)))
  const jumpB = toVec(jumperPoints(hole('a', 15), hole('top-', 16)))
  const leadPos = toVec(leadPoints(batteryLeads.pos, posHole))
  const leadNeg = toVec(leadPoints(batteryLeads.neg, negHole)).reverse()
  const path = new Polyline([
    ...smooth(leadPos), down(leadPos[leadPos.length - 1]),
    at(hole('top+', 10)),
    ...smooth(jumpA), down(jumpA[jumpA.length - 1]),
    at(hole('c', 10)),
    v(r1.x - 2, 0.8, r1.z), v(r1.x - 1.8, 1, r1.z), v(r1.x + 1.8, 1, r1.z), v(r1.x + 2, 0.8, r1.z),
    at(hole('c', 14)),
    at(hole('e', 14)),
    v(led.x - 0.5, LED_BASE, led.z), v(led.x - 0.25, LED_BASE + 1.6, led.z), v(led.x + 0.22, LED_BASE + 1.6, led.z), v(led.x + 0.5, LED_BASE, led.z),
    at({ x: led.x + 0.5, z: hole('e', 15).z }),
    at(hole('a', 15)),
    ...smooth(jumpB), down(jumpB[jumpB.length - 1]),
    at(hole('top-', 3)),
    v(negHole.x, HOUSING_TOP, negHole.z),
    ...smooth(leadNeg),
    batteryLeads.pos.clone(),
  ])

  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe27a' }), DOTS)
  dots.frustumCulled = false
  dots.visible = false
  group.add(dots)

  // Ghosting: remember each material's look and each mesh's shadow flag.
  const saved = new Map<THREE.Material, Saved>()
  const shadows = new Map<THREE.Mesh, boolean>()
  const ghost = (on: boolean) => {
    for (const root of targets()) {
      if (root === group) continue
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        if (on && !shadows.has(m)) shadows.set(m, m.castShadow)
        m.castShadow = on ? false : shadows.get(m) ?? m.castShadow
        for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
          if (on && !saved.has(mat)) saved.set(mat, { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite })
          const s = saved.get(mat)!
          mat.transparent = on || s.transparent
          mat.opacity = on ? s.opacity * ghostLevel(root.name) : s.opacity
          mat.depthWrite = on ? false : s.depthWrite
          mat.needsUpdate = true
        }
      })
    }
  }

  let on = false
  let offset = 0
  let lastLit: boolean | null = null
  const tmp = v(0, 0, 0)
  const m4 = new THREE.Matrix4()

  const energize = (lit: boolean) => {
    if (lit === lastLit) return
    lastLit = lit
    for (const [key, bar] of bars) bar.material = (lit && ENERGIZED[key]) || copper
    dots.visible = lit
  }

  return {
    setOn(next) {
      on = next
      group.visible = next
      ghost(next)
      lastLit = null
    },
    update(dt, reading) {
      if (!on) return
      const lit = reading.currentMA > 0
      energize(lit)
      if (!lit) return
      offset += dt * (2 + reading.currentMA * 0.4)
      const gap = path.length / DOTS
      for (let i = 0; i < DOTS; i++) {
        path.sample(offset + i * gap, tmp)
        dots.setMatrixAt(i, m4.makeTranslation(tmp.x, tmp.y, tmp.z))
      }
      dots.instanceMatrix.needsUpdate = true
    },
  }
}
