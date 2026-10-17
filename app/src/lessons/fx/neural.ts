// Neural-net visuals: layered network (neurons lit by activation, weights by sign and size) and a 2-D class field with data points.
import * as THREE from 'three/webgpu'
import { Mlp, Sample } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { DATA_COLOR, ELECTRON, HOLE, RING } from './colors'
import { ringMarks, rodPool } from './pixels'
import { pointCloud } from './rooms'
import { pixelGrid } from './sensing'

export const CLASS_COLORS = [DATA_COLOR, RING]
export const WEIGHT_COLORS = { pos: ELECTRON, neg: HOLE }
const DIM = new THREE.Color('#262a33')
const HOT = new THREE.Color('#fff2b0')
const COLD = new THREE.Color('#7fb4ff')

/** Neuron columns for layer `sizes` across `w` × `h` (centre at the origin of a group at `at`, turned a little for depth).
 *  `set(net, acts?, weightMax?)` colours weights (+ blue, − red, thickness ∝ |w|) and lights neurons by activation. */
export function netDiagram(parent: THREE.Object3D, sizes: readonly number[], at: V3, w: number, h: number, { r = 0.45, turn = 0.35 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.y = turn
  const gaps = sizes.map((n) => Math.min(1.8, h / Math.max(1, n - 1)))
  const rad = Math.min(r, Math.min(...gaps) * 0.38)
  const pos = (l: number, i: number): V3 => [-w / 2 + (l / (sizes.length - 1)) * w, ((sizes[l] - 1) / 2 - i) * gaps[l], 0]
  const total = sizes.reduce((s, n) => s + n, 0)
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffffff' }), total)
  balls.frustumCulled = false
  balls.castShadow = false
  g.add(balls)
  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  let k = 0
  sizes.forEach((n, l) => {
    for (let i = 0; i < n; i++) {
      balls.setMatrixAt(k, m4.makeScale(rad, rad, rad).setPosition(...pos(l, i)))
      balls.setColorAt(k++, DIM)
    }
  })
  const links = sizes.slice(1).reduce((s, n, l) => s + n * sizes[l], 0)
  const rods = rodPool(g, links)
  return {
    group: g,
    pos,
    set(net: Mlp, acts?: readonly (readonly number[])[], weightMax = 0) {
      const wm = weightMax || Math.max(1e-6, ...net.flatMap((L) => L.W.flat().map(Math.abs)))
      let q = 0
      net.forEach((L, l) =>
        L.W.forEach((row, j) =>
          row.forEach((v, i) => {
            const u = Math.min(1, Math.abs(v) / wm)
            rods.set(q++, pos(l, i), pos(l + 1, j), 0.012 + 0.07 * u, v >= 0 ? WEIGHT_COLORS.pos : WEIGHT_COLORS.neg)
          }),
        ),
      )
      rods.hideFrom(q)
      rods.commit()
      let b = 0
      sizes.forEach((n, l) => {
        for (let i = 0; i < n; i++) {
          const a = acts?.[l]?.[i] ?? 0
          const u = Math.min(1, Math.abs(a))
          balls.setColorAt(b++, col.copy(DIM).lerp(a >= 0 ? HOT : COLD, 0.15 + 0.85 * u))
        }
      })
      balls.instanceColor!.needsUpdate = true
    },
  }
}

/** Tile colour for a class probability p: purple (0) ↔ yellow (1), dark near 0.5, a pale seam on the boundary. */
export function classTint(p: number, out: [number, number, number] = [0, 0, 0]) {
  const c = p >= 0.5 ? [1, 0.85, 0.3] : [0.7, 0.55, 1]
  const k = 0.08 + 0.3 * Math.min(1, Math.abs(p - 0.5) * 2.4)
  const seam = Math.abs(p - 0.5) < 0.04 ? 0.3 : 0
  for (let i = 0; i < 3; i++) out[i] = 0.05 + k * c[i] + seam
  return out
}

/** n × n tile field over [lo, hi]² centred at `at`, `size` across; dots for samples, rings for held-out samples and a probe. */
export function classField(parent: THREE.Object3D, at: V3, n: number, size: number, lo: number, hi: number, maxDots = 220) {
  const grid = pixelGrid(parent, at, n, n, size / n)
  const toScene = (x: number, y: number, lift = 0.15): V3 => [at[0] + ((x - lo) / (hi - lo) - 0.5) * size, at[1] + ((y - lo) / (hi - lo) - 0.5) * size, at[2] + lift]
  const dots = pointCloud(parent, maxDots, size * 0.021)
  const rings = ringMarks(parent, maxDots, 0.35)
  const probe = ringMarks(parent, 1, 0.3)
  const tint: [number, number, number] = [0, 0, 0]
  return {
    grid,
    toScene,
    /** Row-major probabilities, row 0 at the top (as `mlpField`). */
    paint(values: ArrayLike<number>) {
      for (let i = 0; i < n * n; i++) grid.set(i, ...classTint(values[i], tint))
      grid.commit()
    },
    samples(train: readonly Sample[], held: readonly Sample[] = [], mark: (i: number) => number = () => 1) {
      train.forEach((s, i) => dots.set(i, toScene(s.x[0], s.x[1], 0.2), CLASS_COLORS[s.t[0] > 0.5 ? 1 : 0], mark(i)))
      dots.show(train.length)
      held.forEach((s, i) => rings.set(i, toScene(s.x[0], s.x[1], 0.12), size * 0.011, CLASS_COLORS[s.t[0] > 0.5 ? 1 : 0]))
      rings.hideFrom(held.length)
      rings.commit()
    },
    probe(x: readonly number[] | null, color = '#ffffff') {
      if (x) probe.set(0, toScene(x[0], x[1], 0.25), size * 0.035, color)
      else probe.hideFrom(0)
      probe.commit()
    },
  }
}
