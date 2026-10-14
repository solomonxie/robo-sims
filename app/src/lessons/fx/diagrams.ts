// Logic-analyser and state-diagram screens.
import * as THREE from 'three/webgpu'
import { V3, add, mesh, tube } from '../../models/kit'
import { glowHalo } from './circuit'
import { GREY, RING, glowMat } from './colors'
import { scope } from './displays'
import { partLetter } from './parts'
import { ease } from './util'

/** Logic-analyser screen: one row per signal (label left), `window` s of history scrolling in from the right.
 *  `frame(dt, levels)` records the current levels 0..1, row order. */
export function timingDiagram(
  parent: THREE.Object3D,
  at: V3,
  rows: { label: string; color: string }[],
  { width = 30, rowH = 2.2, window = 12, samples = 160 } = {},
) {
  const sc = scope(parent, width, rows.length * rowH, { divs: [12, rows.length] })
  sc.group.position.set(...at)
  const top = (rows.length * rowH) / 2
  const slot = window / (samples - 1)
  const lines = rows.map((r, k) => {
    const mid = top - (k + 0.5) * rowH
    partLetter(sc.group, r.label, [-width / 2 - 0.9, mid, 0], 0.9, r.color, 'right')
    return { trace: sc.trace(r.color, { samples, radius: 0.11 }), y: (v: number) => mid + (v - 0.5) * rowH * 0.5, hist: Array<number>(samples).fill(0) }
  })
  const s = { t: 0, primed: false }
  return {
    group: sc.group,
    frame(dt: number, levels: number[]) {
      if (!s.primed) lines.forEach((l, k) => l.hist.fill(levels[k]))
      s.primed = true
      for (s.t += dt; s.t >= slot; s.t -= slot) {
        lines.forEach((l, k) => {
          l.hist.shift()
          l.hist.push(levels[k])
        })
      }
      lines.forEach((l, k) => {
        l.hist[samples - 1] = levels[k]
        l.trace.draw((u) => l.y(l.hist[Math.round(u * (samples - 1))]), 1)
      })
    },
  }
}

export interface DiagramNode {
  id: string
  label: string
  at: [number, number]
  color?: string
}
export interface DiagramEdge {
  from: string
  to: string
  label: string
  /** Sideways bulge, to the right of travel; A→B and B→A with the same bend pass on opposite sides. */
  bend?: number
  /** Self-loop direction, rad. */
  loop?: number
}

const EDGE_IDLE = new THREE.Color('#5a6070')
const HOT = new THREE.Color(RING)
const Z = new THREE.Vector3(0, 0, 1)

/** State diagram facing +z: a disc per state, an arrow per transition. `frame(dt, state)` lights the current state in its
 *  colour; `fire(i)` flashes edge i and runs a token along it (−1 = no transition). */
export function stateDiagram(parent: THREE.Object3D, at: V3, nodes: DiagramNode[], edges: DiagramEdge[], { r = 2.6, text = 0.85 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const pos = Object.fromEntries(nodes.map((n) => [n.id, new THREE.Vector3(n.at[0], n.at[1], 0)]))
  const ns = nodes.map((n) => {
    const color = new THREE.Color(n.color ?? RING)
    const grp = add(g, new THREE.Group(), [n.at[0], n.at[1], 0])
    const body = new THREE.MeshStandardMaterial({ color: '#23262d', emissive: '#000000', roughness: 0.5 })
    add(grp, mesh(new THREE.CylinderGeometry(r, r, 0.5, 48), body), [0, 0, -0.3]).rotation.x = Math.PI / 2
    const rim = new THREE.MeshStandardMaterial({ color: '#8a93a6', emissive: '#000000', roughness: 0.4 })
    add(grp, mesh(new THREE.TorusGeometry(r, 0.18, 10, 64), rim))
    const halo = glowHalo(g, [n.at[0], n.at[1], -0.8], r * 0.8)
    partLetter(grp, n.label, [0, 0, 0.1], text, '#eef0f4')
    return { id: n.id, color, grp, body, rim, halo, lit: 0, pop: 0 }
  })
  const head = 1.1
  const es = edges.map((e) => {
    const a = pos[e.from]
    const b = pos[e.to]
    let curve: THREE.Curve<THREE.Vector3>
    let labelAt: THREE.Vector3
    if (e.from === e.to) {
      const dir = new THREE.Vector3(Math.cos(e.loop ?? Math.PI / 2), Math.sin(e.loop ?? Math.PI / 2), 0)
      const rim = (k: number, s: number) => a.clone().addScaledVector(dir.clone().applyAxisAngle(Z, s), k * r)
      curve = new THREE.CubicBezierCurve3(rim(1, 0.6), rim(2.9, 0.75), rim(2.9, -0.75), rim(1, -0.6))
      labelAt = a.clone().addScaledVector(dir, 2.5 * r)
    } else {
      const d = b.clone().sub(a)
      const right = new THREE.Vector3(d.y, -d.x, 0).normalize()
      const bend = e.bend ?? 0
      curve = new THREE.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(0.5).addScaledVector(right, 2 * bend), b)
      labelAt = curve.getPoint(0.5).addScaledVector(right, (bend < 0 ? -1 : 1) * 1.3)
    }
    const pts = curve.getPoints(48)
    const i0 = pts.findIndex((p) => p.distanceTo(a) >= r)
    let i1 = pts.length - 1
    while (i1 > i0 + 1 && pts[i1].distanceTo(b) < r + head) i1--
    const line = pts.slice(i0, i1 + 1)
    const m = new THREE.MeshStandardMaterial({ color: EDGE_IDLE, emissive: '#000000', roughness: 0.5 })
    tube(g, line.map((p): V3 => [p.x, p.y, 0]), 0.16, m, 48)
    const end = line.at(-1)!
    const dir = end.clone().sub(line.at(-2)!).normalize()
    const cone = add(g, mesh(new THREE.ConeGeometry(0.55, head, 16), m), [end.x + (dir.x * head) / 2, end.y + (dir.y * head) / 2, 0])
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    const lbl = (c: string) => partLetter(g, e.label, [labelAt.x, labelAt.y, 0], 0.75, c)
    const tags = [lbl(GREY), lbl(RING)]
    const token = add(g, mesh(new THREE.SphereGeometry(0.45, 16, 12), glowMat(RING, 1.4)))
    token.visible = false
    return { m, tags, token, path: new THREE.CatmullRomCurve3(line), hot: 0, u: 1 }
  })
  g.traverse((o) => (o.castShadow = false))
  let current = ''
  return {
    group: g,
    fire(i: number) {
      if (i < 0) return
      es[i].hot = 1
      es[i].u = 0
    },
    frame(dt: number, state: string) {
      ns.forEach((n) => {
        if (n.id === state && current !== state) n.pop = 1
        n.lit += ((n.id === state ? 1 : 0) - n.lit) * ease(dt, 8)
        n.pop = Math.max(0, n.pop - dt * 2.5)
        n.body.emissive.copy(n.color).multiplyScalar(0.45 * n.lit)
        n.rim.color.copy(EDGE_IDLE).lerp(n.color, n.lit)
        n.rim.emissive.copy(n.color).multiplyScalar(0.8 * n.lit)
        n.halo.set(0.55 * n.lit, n.color)
        n.grp.scale.setScalar(1 + 0.14 * n.pop * n.pop)
      })
      current = state
      es.forEach((e) => {
        e.hot = Math.max(0, e.hot - dt * 0.9)
        e.m.color.copy(EDGE_IDLE).lerp(HOT, e.hot)
        e.m.emissive.copy(HOT).multiplyScalar(0.9 * e.hot)
        e.tags[0].visible = e.hot < 0.3
        e.tags[1].visible = e.hot >= 0.3
        e.u = Math.min(1, e.u + dt / 0.5)
        e.token.visible = e.u < 1
        if (e.u < 1) e.token.position.copy(e.path.getPointAt(e.u))
      })
    },
  }
}
