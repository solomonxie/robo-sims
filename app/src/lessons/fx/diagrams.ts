// Logic-analyser and state-diagram screens.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, mesh, tube } from '../../models/kit'
import { glowHalo } from './circuit'
import { GREY, LABEL, RING, glowMat } from './colors'
import { scope } from './displays'
import { cableRun } from './layout'
import { label, liveLabel } from './text'
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

/** Logic-analyser capture window facing +z: one row per channel (name on the left), plus an optional decoder strip at the bottom.
 *  `channel(k)` adds a trace for row k: `draw(level(u) 0..1, headU)`; `annotate(segs)` fills the strip with labelled boxes. */
export function captureScreen(
  parent: THREE.Object3D,
  at: V3,
  rows: { label: string; color: string }[],
  { width = 18, rowH = 2.2, decoder = false } = {},
) {
  const n = rows.length + (decoder ? 1 : 0)
  const height = n * rowH
  const sc = scope(parent, width, height, { divs: [10, n] })
  sc.group.position.set(...at)
  const mid = (k: number) => height / 2 - (k + 0.5) * rowH
  const yOf = (k: number, v: number) => mid(k) + (v - 0.5) * rowH * 0.55
  rows.forEach((r, k) => {
    add(sc.group, label(r.label, { size: 0.6, color: r.color, align: 'right' }), [-width / 2 - 0.8, mid(k), 0]).castShadow = false
  })
  const boxGeo = new THREE.BoxGeometry(1, rowH * 0.62, 0.12)
  const fills = new Map<string, THREE.Material>()
  const fill = (c: string) => {
    const dark = `#${new THREE.Color(c).multiplyScalar(0.04).getHexString()}`
    return fills.get(c) ?? fills.set(c, mat(dark, { emissive: dark })).get(c)!
  }
  const slots = Array.from({ length: decoder ? 24 : 0 }, () => {
    const m = add(sc.group, mesh(boxGeo, fill(GREY)), [0, mid(n - 1), 0.2])
    m.castShadow = false
    return { box: m, text: liveLabel(sc.group, [0, mid(n - 1), 0.4], { size: 0.5 }) }
  })
  return {
    group: sc.group,
    width,
    height,
    xAt: sc.xAt,
    yOf,
    channel(k: number, { color = rows[k].color, samples = 480, radius = 0.09 } = {}) {
      const tr = sc.trace(color, { samples, radius })
      return { ...tr, draw: (level: (u: number) => number, headU: number | null = null) => tr.draw((u) => yOf(k, level(u)), headU) }
    },
    /** Decoder boxes from u0 to u1 (0..1 across the window); boxes past the list are hidden. */
    annotate(segs: { u0: number; u1: number; text: string; color: string }[]) {
      slots.forEach((s, i) => {
        const g = segs[i]
        s.box.visible = !!g
        s.text.set(g ? g.text : '', g?.color)
        if (!g) return
        const w = Math.max(0.2, (g.u1 - g.u0) * width - 0.12)
        s.box.scale.x = w
        s.box.material = fill(g.color)
        s.box.position.x = sc.xAt((g.u0 + g.u1) / 2)
        s.text.group.position.x = s.box.position.x
      })
    },
  }
}

/** Cheap 8-channel USB logic analyser (24 MHz class) at `at`, header up: GND lead to `ground`, one lead per `leads` entry,
 *  each ending in a grabber clip. Returns the USB socket point. */
export function usbAnalyzer(parent: THREE.Object3D, at: V3, leads: { color: string; to: V3 }[], ground: V3): V3 {
  const g = add(parent, new THREE.Group(), at)
  box(g, [6, 3.2, 1.4], mat('#2f3440', { metal: 0.3, rough: 0.45 }), [0, 0, 0])
  box(g, [5.6, 2.8, 0.05], mat('#1d2027', { rough: 0.6 }), [0, 0, 0.72])
  for (const [s, y, size] of [['LOGIC', 0.55, 0.55], ['24MHZ 8CH', -0.45, 0.4]] as const) {
    add(g, label(s, { size, color: LABEL, glow: 0.4 }), [0, y, 0.78]).castShadow = false
  }
  box(g, [5.4, 0.6, 0.9], mat('#141416', { rough: 0.8 }), [0, 1.9, 0])
  box(g, [1.3, 0.5, 0.7], mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, -1.85, 0])
  const all = [{ color: '#1c1c1f', to: ground }, ...leads]
  all.forEach((l, i) => {
    const x = at[0] - 2.25 + i * 0.5
    const from: V3 = [x, at[1] + 2.2, at[2]]
    const [tx, ty, tz] = l.to
    cableRun(parent, [from, [x, from[1] + 0.8, from[2] + 0.4 + i * 0.12], [tx, ty - 1.4, tz + 0.5], [tx, ty - 0.5, tz]], l.color, 0.09)
    cylinder(parent, 0.16, 0.9, mat(l.color, { rough: 0.5 }), [tx, ty - 0.45, tz], 'y', 12)
  })
  return [at[0], at[1] - 2.1, at[2]]
}
