// Logic-gate symbols, glowing signal paths, LED bit rows, state diagrams.
import * as THREE from 'three/webgpu'
import { GateName, Net, Src } from '../../core/logic'
import { V3, add, box, lead, mat, mesh, rod, tube } from '../../models/kit'
import { glowHalo, groundSymbol, junction, ledLamp, wire } from './circuit'
import { GREY, LED_RED, RING, glowMat, potentialColor } from './colors'
import { pulseLabel, scope, segmentDisplay } from './displays'
import { partLetter } from './parts'
import { ease } from './util'

/** Labelled input ball at `at`; returns its level driver. */
export const inBall = (parent: THREE.Object3D, label: string, at: V3) => {
  partLetter(parent, label, [at[0] - 1, at[1], 0], 0.9, RING, 'right')
  return junction(parent, at, 0.55)
}

/** LED on a signal ending at `at`, cathode to ground; returns its driver. */
export function ledOut(parent: THREE.Object3D, from: V3, at: V3, label: string) {
  const feed = signalWire(parent, [from, [at[0] - 0.35, at[1], 0]])
  const lamp = ledLamp(parent, LED_RED, at, { scale: 0.7, anodeRight: false })
  signalWire(parent, [[at[0] + 0.35, at[1], 0], [at[0] + 0.35, at[1] - 3.4, 0]])(0)
  add(parent, groundSymbol(), [at[0] + 0.35, at[1] - 3.4, 0]).scale.setScalar(0.5)
  partLetter(parent, label, [at[0] - 2.4, at[1] + 1.4, 0], 0.9, RING)
  return (dt: number, level: number) => {
    feed(level)
    lamp.set(level)
    lamp.step(dt)
  }
}

const INVERTED: GateName[] = ['NOT', 'NAND', 'NOR', 'XNOR']

/** Gate symbol facing +z, `size` tall, pointing +x; inputs on the left (one for NOT). `set(out)` tints the body and output
 *  stub by potential (0..1), `inputs(a, b)` the input stubs. `pins` are in the parent's frame. */
export function gateSymbol(parent: THREE.Object3D, at: V3, gate: GateName, { size = 4.4, stub = 1.2 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const h = size / 2
  const v = (x: number, y: number) => new THREE.Vector2(x, y)
  const shape = new THREE.Shape()
  let tip = h
  let back = -h
  if (gate === 'NOT') {
    tip = h * 0.8
    shape.setFromPoints([v(-h, h), v(tip, 0), v(-h, -h)])
  } else if (gate === 'AND' || gate === 'NAND') {
    shape.moveTo(-h, -h)
    shape.lineTo(0, -h)
    shape.absarc(0, 0, h, -Math.PI / 2, Math.PI / 2, false)
    shape.lineTo(-h, h)
  } else {
    shape.moveTo(-h, -h)
    shape.quadraticCurveTo(0.35 * h, -h, h, 0)
    shape.quadraticCurveTo(0.35 * h, h, -h, h)
    shape.quadraticCurveTo(-0.5 * h, 0, -h, -h)
    back = -0.81 * h
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 })
  geo.translate(0, 0, -0.3)
  const body = new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.5, emissive: '#000000' })
  add(g, mesh(geo, body))
  const ink = mat('#d8dbe0', { emissive: '#3a3c40' })
  if (gate === 'XOR' || gate === 'XNOR') {
    const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-h - 0.5, h, 0), new THREE.Vector3(-0.5 * h - 0.5, 0, 0), new THREE.Vector3(-h - 0.5, -h, 0))
    add(g, mesh(new THREE.TubeGeometry(arc, 24, 0.14, 8), ink))
  }
  const wireMat = () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.4 })
  const bubble = INVERTED.includes(gate) ? 0.32 * h : 0
  if (bubble) add(g, mesh(new THREE.TorusGeometry(bubble * 0.75, bubble * 0.28, 10, 24), ink), [tip + bubble * 0.75, 0, 0])
  const outMat = wireMat()
  const outX = tip + 2 * bubble * 0.75
  rod(g, [outX, 0, 0], [outX + stub, 0, 0], 0.16, outMat)
  const ys = gate === 'NOT' ? [0] : [h / 2, -h / 2]
  const inMats = ys.map((y) => {
    const m = wireMat()
    rod(g, [-h - stub - 0.4, y, 0], [back + 0.1, y, 0], 0.16, m)
    return m
  })
  const tint = (m: THREE.MeshStandardMaterial, f: number) => m.emissive.copy(potentialColor(f, m.color))
  const local = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group: g,
    pins: { a: local(-h - stub - 0.4, ys[0]), b: local(-h - stub - 0.4, ys.at(-1)!), out: local(outX + stub, 0) },
    set(out: number) {
      tint(outMat, out)
      potentialColor(out, body.emissive).multiplyScalar(0.18)
    },
    inputs(a: number, b: number) {
      tint(inMats[0], a)
      if (inMats[1]) tint(inMats[1], b)
    },
  }
}

/** A glowing sleeve over a wire through `points`; `set(f, color)` fades it in (0..1) in that color. */
export function litWire(parent: THREE.Object3D, points: V3[], r = 0.45) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
  const group = add(parent, new THREE.Group())
  lead(group, points, r, m)
  group.traverse((o) => (o.castShadow = false))
  return {
    set(f: number, color: THREE.Color) {
      m.color.copy(color)
      m.emissive.copy(color)
      m.opacity = 0.55 * f
      group.visible = f > 0.01
    },
  }
}

/** A copper wire with a glowing sleeve; the returned fn shows its level 0..1. */
export function signalWire(parent: THREE.Object3D, pts: V3[]) {
  wire(parent, pts, 0.2)
  const glow = litWire(parent, pts, 0.3)
  const c = new THREE.Color()
  return (level: number) => glow.set(1, potentialColor(level, c))
}

/** LEDs at (xs[i], y), index 0 = least significant bit. Each anode is fed from a bit ball below, cathodes share a ground
 *  rail; `places` label the columns under the rail, bright while that bit is 1, and the bit digit sits above each LED.
 *  `frame(dt, levels)` takes eased bit levels 0..1. */
export function bitRow(parent: THREE.Object3D, xs: number[], y: number, places: string[], { scale = 1.2, color = LED_RED } = {}) {
  const h = scale / 2
  const rail = y - 3.4
  const right = Math.max(...xs) + h + 1.6
  wire(parent, [[Math.min(...xs) + h, rail, 0], [right, rail, 0], [right, rail - 0.8, 0]])
  add(parent, groundSymbol(), [right, rail - 0.8, 0]).scale.setScalar(0.7)
  const cols = xs.map((x, i) => {
    const lamp = ledLamp(parent, color, [x, y, 0], { scale, anodeRight: false })
    wire(parent, [[x - h, y - 2.2, 0], [x - h, y, 0]])
    wire(parent, [[x + h, y, 0], [x + h, rail, 0]])
    const ball = junction(parent, [x - h, y - 2.2, 0], 0.45)
    const label = (c: string) => {
      const d = segmentDisplay(places[i].length, 0.8, c, true)
      d.set(places[i])
      return add(parent, d.group, [x, rail - 1.7, 0])
    }
    const place = [label('#3a3f48'), label(RING)]
    const digit = pulseLabel(parent, 1, GREY, [x, y + 9 * scale, 0], 0.9)
    return { lamp, ball, place, digit }
  })
  return {
    frame(dt: number, levels: number[]) {
      cols.forEach((c, i) => {
        const v = levels[i]
        c.lamp.set(v)
        c.lamp.step(dt)
        c.ball.set(v)
        c.place[0].visible = v < 0.5
        c.place[1].visible = v >= 0.5
        c.digit.show(v >= 0.5 ? '1' : '0')
        c.digit.frame(dt)
      })
    },
  }
}

export interface NetLayout {
  /** Input balls by name, labelled to their left. */
  inputs: Record<string, V3>
  /** Gate centres, same order as the net. */
  gates: V3[]
  /** x of the vertical bus each source fans out on (inputs by name, gates by index); default: just before the pin. */
  bus?: Record<string, number>
  /** Corner points for gate input `"<gate>.<pin>"`, e.g. a feedback loop around the gates; a last leg drops to the pin. */
  via?: Record<string, V3[]>
  /** LEDs fed by gate `src`, legs at `at`; cathodes share a ground rail on the right. */
  outputs: { src: number; at: V3; label: string }[]
  size?: number
  ledScale?: number
}

/** A gate-level schematic: inputs → gates → LEDs, every wire glowing by its level. `frame(dt, ins, gates)` takes eased
 *  levels 0..1; `wires` lists each gate input's path, `outs` each output's, for extra highlights. */
export function gateNet(parent: THREE.Object3D, net: Net, layout: NetLayout) {
  const { size = 3.6, bus = {} } = layout
  const syms = net.map((g, i) => gateSymbol(parent, layout.gates[i], g.gate, { size }))
  const from = (s: Src) => (typeof s === 'number' ? syms[s].pins.out : layout.inputs[s])
  const route = (pts: V3[]) => pts.filter((q, i) => !i || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1])
  const glowing = (pts: V3[], src: Src) => {
    wire(parent, pts, 0.2)
    return { src, pts, glow: litWire(parent, pts, 0.3), c: new THREE.Color() }
  }
  const wires = net.flatMap((g, i) =>
    g.in.map((s, j) => {
      const a = from(s)
      const b = j ? syms[i].pins.b : syms[i].pins.a
      const x = bus[String(s)] ?? b[0] - 0.8
      const via = layout.via?.[`${i}.${j}`]
      const pts: V3[] = via ? [a, ...via, [via.at(-1)![0], b[1], 0], b] : [a, [x, a[1], 0], [x, b[1], 0], b]
      return { gate: i, pin: j, ...glowing(route(pts), s) }
    }),
  )
  const forks = Object.entries(bus).flatMap(([k, x]) => {
    const src: Src = k in layout.inputs ? k : Number(k)
    const y = from(src)[1]
    const taps = wires.filter((w) => w.src === src).map((w) => w.pts.at(-1)![1])
    const lo = Math.min(y, ...taps)
    const hi = Math.max(y, ...taps)
    const inside = (v: number) => v > lo + 0.01 && v < hi - 0.01
    const at = [...new Set([y, ...taps])].filter((v) => inside(v) || (v === y && hi > lo && taps.some((t) => Math.abs(t - y) < 0.01)))
    return at.map((v) => ({ src, dot: junction(parent, [x, v, 0], 0.5) }))
  })
  const scale = layout.ledScale ?? size / 4
  const h = scale / 2
  const rail = Math.max(...layout.outputs.map((o) => o.at[0])) + h + 1.6
  const low = Math.min(...layout.outputs.map((o) => o.at[1])) - 2
  wire(parent, [[rail, Math.max(...layout.outputs.map((o) => o.at[1])), 0], [rail, low, 0]])
  add(parent, groundSymbol(), [rail, low, 0]).scale.setScalar(0.6)
  const outs = layout.outputs.map((o) => {
    const a = syms[o.src].pins.out
    const [x, y] = o.at
    const lamp = ledLamp(parent, LED_RED, o.at, { scale, anodeRight: false })
    wire(parent, [[x + h, y, 0], [rail, y, 0]])
    partLetter(parent, o.label, [x - h - 1 - 0.4 * o.label.length, y + 1.2, 0], 0.9, RING)
    return { lamp, gate: o.src, ...glowing(route([a, [x - h, a[1], 0], [x - h, y, 0]]), o.src) }
  })
  const balls = Object.entries(layout.inputs).map(([k, at]) => {
    partLetter(parent, k, [at[0] - 1, at[1], 0], 0.9, RING, 'right')
    return { k, ball: junction(parent, at, 0.55) }
  })
  return {
    syms,
    wires,
    outs,
    frame(dt: number, ins: Record<string, number>, gates: number[]) {
      const level = (s: Src) => (typeof s === 'number' ? gates[s] : ins[s])
      for (const w of [...wires, ...outs]) w.glow.set(1, potentialColor(level(w.src), w.c))
      net.forEach((g, i) => {
        syms[i].inputs(level(g.in[0]), level(g.in.at(-1)!))
        syms[i].set(gates[i])
      })
      for (const o of outs) {
        o.lamp.set(gates[o.gate])
        o.lamp.step(dt)
      }
      for (const b of balls) b.ball.set(ins[b.k])
      for (const f of forks) f.dot.set(level(f.src))
    },
  }
}

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

/** D flip-flop block facing +z: D in at top left, clock (triangle) at bottom left, optional EN under it, Q out at top
 *  right. `set(q, clk)` lights the Q stub and the clock mark by level 0..1. */
export function flipFlopBlock(parent: THREE.Object3D, at: V3, { w = 4.4, h = 5.6, enable = false } = {}) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [w, h, 0.8], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.5 }), [0, 0, -0.1])
  const pinY = { d: h / 2 - 1.2, clk: enable ? -0.4 : -h / 2 + 1.2, en: -h / 2 + 1.1 }
  const label = (t: string, x: number, y: number) => partLetter(g, t, [x, y, 0.35], 0.8, '#d8dbe0')
  label('D', -w / 2 + 0.8, pinY.d)
  label('Q', w / 2 - 0.8, pinY.d)
  if (enable) label('EN', -w / 2 + 1.3, pinY.en)
  const tri = new THREE.Shape([new THREE.Vector2(0, 0.55), new THREE.Vector2(0.8, 0), new THREE.Vector2(0, -0.55)])
  const clkMat = new THREE.MeshStandardMaterial({ color: '#d8dbe0', emissive: '#000000', roughness: 0.4 })
  add(g, mesh(new THREE.ShapeGeometry(tri), clkMat), [-w / 2 + 0.1, pinY.clk, 0.32])
  const stub = (x0: number, x1: number, y: number) => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.4 })
    rod(g, [x0, y, 0], [x1, y, 0], 0.16, m)
    return m
  }
  const qMat = stub(w / 2, w / 2 + 0.9, pinY.d)
  ;[pinY.d, pinY.clk, ...(enable ? [pinY.en] : [])].forEach((y) => stub(-w / 2 - 0.9, -w / 2, y))
  const local = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group: g,
    pins: { d: local(-w / 2 - 0.9, pinY.d), clk: local(-w / 2 - 0.9, pinY.clk), en: local(-w / 2 - 0.9, pinY.en), q: local(w / 2 + 0.9, pinY.d) },
    set(q: number, clk: number) {
      qMat.emissive.copy(potentialColor(q, qMat.color))
      potentialColor(clk, clkMat.emissive).multiplyScalar(0.6)
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
