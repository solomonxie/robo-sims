// Timing and state diagrams.
import * as THREE from 'three/webgpu'
import { V3, add, box, mesh, tube } from '../../models/kit'
import { glowHalo } from './circuit'
import { GREY, INK, LABEL, RING, glowMat } from './colors'
import { shadowlessRod, stretchRod } from './layout'
import { partLetter } from './parts'
import { scope } from './screens'
import { flatBox, trayMat } from './shapes'
import { liveLabel } from './text'
import { ease, emptyGroup } from './util'

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

/** Sim clock: `tick(dt, key, ticks)` → current sim time in ticks (`slowS` real s each), looping with a hold at the end. */
export function simClock(slowS = 0.15, holdS = 2.5) {
  const s = { key: '', t: 0 }
  return (dt: number, key: string, ticks: number) => {
    if (key !== s.key) Object.assign(s, { key, t: 0 })
    s.t += dt
    if (s.t > ticks * slowS + holdS) s.t = 0
    return Math.min(ticks, s.t / slowS)
  }
}

export interface Cell {
  color: string
  dim?: boolean
  text?: string
}
export interface Mark {
  t: number
  row: number
  text: string
  color: string
}

/** Time chart: one row per core or task, revealed up to `now`; `rebuild` once per run, `show(now)` per frame. */
export function gantt(parent: THREE.Object3D, rows: number, G: { x0: number; x1: number; y: number; rowH: number; ticks: number; axis?: boolean }) {
  const px = (G.x1 - G.x0) / G.ticks
  const tx = (t: number) => G.x0 + t * px
  const rowY = (k: number) => G.y - k * (G.rowH + 0.4)
  const bottom = rowY(rows - 1) - G.rowH / 2
  const top = G.y + G.rowH / 2
  for (let k = 0; k < rows; k++) box(parent, [G.x1 - G.x0 + 0.4, G.rowH + 0.2, 0.4], trayMat(), [(G.x0 + G.x1) / 2, rowY(k), -0.45])
  const names = Array.from({ length: rows }, (_, k) => liveLabel(parent, [G.x0 - 0.6, rowY(k), 0], { size: Math.min(0.42, G.rowH * 0.38), align: 'right' }))
  if (G.axis) {
    for (let t = 0; t <= G.ticks; t += 10) partLetter(parent, `${t}`, [tx(t), bottom - 0.7, 0], 0.34, GREY)
    partLetter(parent, 'ms', [G.x1 + 0.9, bottom - 0.7, 0], 0.34, GREY, 'left')
  }
  const tickMat = glowMat(GREY, 0.2)
  for (let t = 0; t < G.ticks; t++) flatBox(parent, [0.06, 0.35, 0.2], tickMat, [tx(t), top + 0.3, 0])
  const flash = flatBox(parent, [0.14, 0.6, 0.25], glowMat(RING, 1.2), [0, top + 0.4, 0.05])
  const cursor = add(parent, shadowlessRod(glowMat(LABEL, 1)))
  const g = add(parent, new THREE.Group())
  let segs: { t0: number; t1: number; o: THREE.Object3D; text?: THREE.Object3D }[] = []
  let marks: { t: number; o: THREE.Object3D }[] = []
  return {
    rowY,
    name: (k: number, text: string, color = LABEL) => names[k].set(text, color),
    rebuild(cell: (row: number, t: number) => Cell | null, markList: Mark[]) {
      emptyGroup(g)
      segs = []
      for (let k = 0; k < rows; k++) {
        let t0 = 0
        for (let t = 1; t <= G.ticks; t++) {
          const a = cell(k, t0)
          const b = t < G.ticks ? cell(k, t) : null
          if (t < G.ticks && JSON.stringify(a) === JSON.stringify(b)) continue
          if (a) {
            const o = flatBox(g, [1, G.rowH * (a.dim ? 0.45 : 0.8), 0.3], glowMat(a.color, a.dim ? 0.15 : 0.7), [0, rowY(k), 0])
            const w = (t - t0) * px
            const size = Math.min(0.4, G.rowH * 0.36)
            const text = a.text && w > a.text.length * size * 0.85 + 0.3 ? partLetter(g, a.text, [tx(t0) + w / 2, rowY(k), 0.3], size, a.dim ? a.color : INK) : undefined
            segs.push({ t0, t1: t, o, text })
          }
          t0 = t
        }
      }
      marks = markList.map((m) => ({ t: m.t, o: partLetter(g, m.text, [tx(m.t) + 0.3, rowY(m.row) + G.rowH / 2 + 0.55, 0.3], 0.5, m.color) }))
    },
    show(now: number) {
      for (const s of segs) {
        const w = Math.min(Math.max(now - s.t0, 0), s.t1 - s.t0)
        s.o.visible = w > 0.01
        s.o.scale.x = Math.max(0.01, w * px - 0.05)
        s.o.position.x = tx(s.t0) + (w * px) / 2
        if (s.text) s.text.visible = now >= s.t0 + (s.t1 - s.t0) * 0.7
      }
      for (const m of marks) m.o.visible = now >= m.t
      const x = tx(now)
      stretchRod(cursor, [x, bottom - 0.2, 0.35], [x, top + 0.2, 0.35], 0.06)
      flash.position.x = tx(Math.floor(now))
      flash.scale.y = 1 - (now % 1) * 0.8
    },
  }
}
