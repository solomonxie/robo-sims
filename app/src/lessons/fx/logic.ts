// Logic-gate symbols, glowing signal paths, LED bit rows.
import * as THREE from 'three/webgpu'
import { GateName, Net, Src } from '../../core/logic'
import { V3, add, lead, mat, mesh, rod } from '../../models/kit'
import { groundSymbol, junction, ledLamp, wire } from './circuit'
import { GREY, LED_RED, RING, potentialColor } from './colors'
import { pulseLabel, segmentDisplay } from './displays'
import { partLetter } from './parts'

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
      return { gate: i, pin: j, ...glowing(route([a, [x, a[1], 0], [x, b[1], 0], b]), s) }
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
    partLetter(parent, k, [at[0] - 1.1 - 0.5 * k.length, at[1], 0], 0.9, RING)
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
