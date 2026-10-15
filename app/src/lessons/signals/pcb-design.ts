import * as THREE from 'three/webgpu'
import {
  CAPS,
  STACKUPS,
  annularRing,
  boardsPerPanel,
  copperOhms,
  crossings,
  ipcAmps,
  ipcRise,
  ipcWidthMm,
  loopInductance,
  mstEdges,
  returnWithin,
  segmentsCross,
  stackMm,
  traceAreaMil2,
  viaAreaMil2,
} from '../../core/physics'
import { si } from '../../core/units'
import { STEEL, TIN, V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  COPPER,
  GREY,
  HIGH_V,
  LABEL,
  LOW_V,
  PCB_GREEN,
  POWER,
  RING,
  ease,
  emptyGroup,
  flatText,
  glowMat,
  flatTrace,
  glide,
  heatGlow,
  heatWaves,
  label,
  liveLabel,
  loopBeads,
  pcbStack,
  presence,
  storyClock,
  storySlider,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

type P2 = [number, number]
const pick = <R extends object>(rec: R, v: unknown, d: keyof R & string) => (String(v) in rec ? (v as keyof R & string) : d)
const text = (parent: THREE.Object3D, s: string, at: V3, color = GREY, size = 0.6, align: 'left' | 'center' | 'right' = 'center') =>
  (add(parent, label(s, { size, color, align }), at).castShadow = false)
const fade = (color: string, opacity = 1, emissive = 0) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, transparent: true, opacity, depthWrite: false, roughness: 0.5 })
const nH = (h: number) => `${+(h * 1e9).toFixed(1)} nH`
const mm = (v: number, d = 2) => `${+v.toFixed(d)} mm`
const opts = <R extends Record<string, string>>(rec: R) => Object.keys(rec).map((k) => ({ value: k, label: rec[k] }))

// --- Schematic capture: symbols → footprints → ratsnest → copper; placement decides how tangled the ratsnest is. ---

type Sym = 'conn' | 'res' | 'cap' | 'led' | 'npn'
interface Pin {
  net: string
  sch: P2
  pad: P2
}
interface Part {
  ref: string
  value: string
  sym: Sym
  turn: boolean
  sch: P2
  tidy: P2
  mess: P2
  tag: P2
  pins: Pin[]
}

const pin = (net: string, sch: P2, pad: P2): Pin => ({ net, sch, pad })
const PARTS: Part[] = [
  { ref: 'J1', value: '', sym: 'conn', turn: false, sch: [-10, 2], tidy: [-10, 1.5], mess: [9, -2.5], tag: [-0.7, -2.7], pins: [pin('VCC', [1.2, -1.2], [0, -1.6]), pin('IN', [1.2, 0], [0, 0]), pin('GND', [1.2, 1.2], [0, 1.6])] },
  { ref: 'R1', value: '1k', sym: 'res', turn: false, sch: [-5, 2], tidy: [-5, 1.5], mess: [-8, 4], tag: [-1, -1], pins: [pin('IN', [-1.6, 0], [-1, 0]), pin('BASE', [1.6, 0], [1, 0])] },
  { ref: 'Q1', value: 'NPN', sym: 'npn', turn: false, sch: [0, 2], tidy: [0, 2], mess: [5, 3.5], tag: [-2.2, 1.6], pins: [pin('BASE', [-1.4, 0], [-1, 0]), pin('COLL', [0.8, -1.3], [1, -0.6]), pin('GND', [0.8, 1.3], [1, 0.6])] },
  { ref: 'D1', value: 'LED', sym: 'led', turn: true, sch: [0.8, -1], tidy: [1, -0.8], mess: [-6, -2.5], tag: [1.2, 0], pins: [pin('LED', [0, -1], [0, -0.9]), pin('COLL', [0, 1], [0, 0.9])] },
  { ref: 'R2', value: '330', sym: 'res', turn: true, sch: [0.8, -3.3], tidy: [1, -3.8], mess: [-1, 3.8], tag: [1.2, 0], pins: [pin('VCC', [0, -1.2], [0, -0.9]), pin('LED', [0, 1.2], [0, 0.9])] },
  { ref: 'C1', value: '100n', sym: 'cap', turn: true, sch: [6, 2], tidy: [8, 1.5], mess: [-2, -3.5], tag: [1.2, 0], pins: [pin('VCC', [0, -1.4], [0, -0.9]), pin('GND', [0, 1.4], [0, 0.9])] },
]
const NETS = [...new Set(PARTS.flatMap((p) => p.pins.map((q) => q.net)))]
const PADS = PARTS.reduce((s, p) => s + p.pins.length, 0)
const VIEWS = { sch: 'Schematic', foot: 'Footprints', rats: 'Ratsnest', route: 'Routed' }
const VIEW_KEYS = Object.keys(VIEWS)
const PLACES = { tidy: 'Tidy placement', mess: 'Scattered' }
const MM_PER_UNIT = 2
const BOARD: P2 = [24, 12]

const at2 = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]]
const netEdges = (where: (p: Part, q: Pin) => P2) =>
  NETS.flatMap((net) => {
    const pts = PARTS.flatMap((p) => p.pins.filter((q) => q.net === net).map((q) => where(p, q)))
    return mstEdges(pts).map(([i, j]): [P2, P2] => [pts[i], pts[j]])
  })
const dogleg = ([a, b]: [P2, P2]): P2[] => {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const mid: P2 = Math.abs(dx) > Math.abs(dz) ? [b[0] - Math.sign(dx) * Math.abs(dz), a[1]] : [a[0], b[1] - Math.sign(dz) * Math.abs(dx)]
  return [a, mid, b]
}
const legs = (pts: P2[]) => pts.slice(1).map((b, i): [P2, P2] => [pts[i], b])

const ratsOf = (place: 'tidy' | 'mess') => {
  const edges = netEdges((p, q) => at2(p[place], q.pad))
  const length = edges.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) * MM_PER_UNIT
  const top: [P2, P2][] = []
  const routes = edges.map((e) => {
    const path = dogleg(e)
    const bottom = legs(path).some((l) => top.some((t) => segmentsCross(l, t)))
    if (!bottom) top.push(...legs(path))
    return { path, bottom }
  })
  return { edges, length, cross: crossings(edges), routes, vias: 2 * routes.filter((r) => r.bottom).length }
}
const RATS = { tidy: ratsOf('tidy'), mess: ratsOf('mess') }

function stroke(g: THREE.Object3D, pts: P2[], m: THREE.Material, r = 0.07, y = 0.12) {
  for (let i = 1; i < pts.length; i++) rod(g, [pts[i - 1][0], y, pts[i - 1][1]], [pts[i][0], y, pts[i][1]], r, m, 6).castShadow = false
}

function symbol(part: Part, m: THREE.Material, accent: THREE.Material) {
  const outer = new THREE.Group()
  const g = add(outer, new THREE.Group())
  if (part.turn) g.rotation.y = -Math.PI / 2
  const L = Math.abs(part.pins[0].sch[part.turn ? 1 : 0])
  if (part.sym === 'res') {
    stroke(g, [[-0.75, -0.3], [0.75, -0.3], [0.75, 0.3], [-0.75, 0.3], [-0.75, -0.3]], m)
    stroke(g, [[-L, 0], [-0.75, 0]], m)
    stroke(g, [[0.75, 0], [L, 0]], m)
  } else if (part.sym === 'cap') {
    stroke(g, [[-L, 0], [-0.2, 0]], m)
    stroke(g, [[0.2, 0], [L, 0]], m)
    stroke(g, [[-0.2, -0.7], [-0.2, 0.7]], m, 0.1)
    stroke(g, [[0.2, -0.7], [0.2, 0.7]], m, 0.1)
  } else if (part.sym === 'led') {
    stroke(g, [[-0.45, -0.6], [-0.45, 0.6], [0.45, 0], [-0.45, -0.6]], m)
    stroke(g, [[0.45, -0.6], [0.45, 0.6]], m)
    stroke(g, [[-L, 0], [-0.45, 0]], m)
    stroke(g, [[0.45, 0], [L, 0]], m)
    for (const s of [0, 0.45]) stroke(g, [[-0.1 + s, -0.75], [0.35 + s, -1.25]], accent, 0.05)
  } else if (part.sym === 'npn') {
    const ring = add(g, mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), m), [0.2, 0.12, 0])
    ring.rotation.x = Math.PI / 2
    stroke(g, [[-0.35, -0.6], [-0.35, 0.6]], m, 0.1)
    stroke(g, [[-1.4, 0], [-0.35, 0]], m)
    stroke(g, [[-0.35, -0.3], [0.8, -0.85], [0.8, -1.3]], m)
    stroke(g, [[-0.35, 0.3], [0.8, 0.85], [0.8, 1.3]], m)
    stroke(g, [[0.35, 0.85], [0.75, 0.85], [0.6, 0.5]], m)
  } else {
    stroke(g, [[-0.6, -1.9], [0.4, -1.9], [0.4, 1.9], [-0.6, 1.9], [-0.6, -1.9]], m)
    for (const q of part.pins) stroke(g, [[0.4, q.sch[1]], [1.2, q.sch[1]]], m)
  }
  for (const [x, z] of part.pins.map((q) => q.sch)) add(outer, mesh(new THREE.SphereGeometry(0.13, 8, 6), accent), [x, 0.12, z])
  flatText(outer, `${part.ref} ${part.value}`.trim(), [part.tag[0], 0.15, part.tag[1]], 0.5, '#5a2a2e', 'left')
  return outer
}

function footprint(part: Part, silk: THREE.Material) {
  const g = new THREE.Group()
  const xs = part.pins.map((q) => q.pad[0])
  const zs = part.pins.map((q) => q.pad[1])
  for (const q of part.pins) {
    const [x, z] = q.pad
    if (part.sym === 'conn') {
      cylinder(g, 0.55, 0.08, TIN(), [x, 0.05, z], 'y', 20)
      cylinder(g, 0.28, 0.1, mat('#101214'), [x, 0.06, z], 'y', 14)
    } else {
      const long = part.turn || part.sym === 'npn'
      box(g, long ? [0.9, 0.08, 0.6] : [0.6, 0.08, 0.9], TIN(), [x, 0.05, z])
    }
  }
  const pad = 0.55
  const [x0, x1, z0, z1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad]
  flatTrace(g, [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], 0.08, silk, 0.02)
  return g
}

export const schematicCapture: Lesson = {
  id: 'pcb-design-schematic-capture',
  title: 'Schematic capture',
  tagline: 'The schematic says what connects; the board decides where. Placement makes routing easy or hard',
  formula: (p) => {
    const r = RATS[pick(PLACES, p.place, 'tidy')]
    return `${NETS.length} nets, ${PADS} pads → ratsnest = shortest tree per net = ${Math.round(r.length)} mm, ${r.cross} crossings`
  },
  legend: [
    { color: '#a8323a', label: 'Schematic symbol', shape: 'dot' },
    { color: RING, label: 'Ratsnest: pads that must join', shape: 'dot' },
    { color: '#c8803f', label: 'Top copper trace', shape: 'dot' },
    { color: LOW_V, label: 'Bottom trace (crosses, needs 2 vias)', shape: 'dot' },
  ],
  points: [
    'A schematic is connectivity, not geometry: symbols with a reference (R1, Q1) and a value, joined by nets. Where a symbol sits on the sheet means nothing physically.',
    'Electrical rules check (ERC) catches unconnected pins, two outputs tied together, a power pin with no source. Then every symbol gets a footprint: R1 → 0805 pads, Q1 → SOT-23, J1 → 2.54 mm header.',
    'The netlist carries over to the board as a ratsnest: thin air-wires between pads that must be joined, drawn as the shortest tree in each net (a minimum spanning tree).',
    'Placement comes before routing. Follow the signal flow, keep each part near the pins it serves, minimise ratsnest length and crossings: every crossing costs a detour or a pair of vias.',
    `LED driver: J1 brings 5 V and the input; R1 drives Q1, which sinks the LED current through R2. Board ${BOARD[0] * MM_PER_UNIT} × ${BOARD[1] * MM_PER_UNIT} mm.`,
  ],
  controls: [
    { kind: 'choice', key: 'view', options: opts(VIEWS), initial: 'sch' },
    { kind: 'choice', key: 'place', options: opts(PLACES), initial: 'tidy' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    box(scene, [BOARD[0], 0.6, BOARD[1]], mat(PCB_GREEN, { rough: 0.45 }), [0, -0.3, 0])
    const paperMat = fade('#f4f1e6')
    paperMat.depthWrite = true
    const paper = box(scene, [BOARD[0] + 0.6, 0.06, BOARD[1] + 0.6], paperMat, [0, 0.04, 0])
    paper.castShadow = false
    paper.renderOrder = -1
    const symMat = fade('#a8323a', 1, 0.3)
    const pinMat = fade('#2e8b57', 1, 0.3)
    symMat.depthWrite = pinMat.depthWrite = true
    const silk = mat('#f2f2f2', { rough: 0.6 })

    const wires = add(scene, new THREE.Group())
    for (const [a, b] of netEdges((p, q) => at2(p.sch, q.sch))) stroke(wires, [a, [b[0], a[1]], b], pinMat, 0.06, 0.1)

    const parts = PARTS.map((part) => {
      const g = add(scene, new THREE.Group(), [part.sch[0], 0, part.sch[1]])
      const sym = add(g, symbol(part, symMat, pinMat))
      const foot = add(g, footprint(part, silk))
      flatText(foot, part.ref, [part.tag[0], 0.06, part.tag[1]], 0.5, '#f2f2f2', 'left')
      return { part, g, sym, foot }
    })
    const ratsHolder = add(scene, new THREE.Group())
    const routeHolder = add(scene, new THREE.Group())
    const ratsMat = fade(RING, 0, 1)
    const topMat = fade('#c8803f', 0, 0.15)
    const botMat = fade(LOW_V, 0, 0.5)
    const viewTag = liveLabel(scene, [0, 0.2, -BOARD[1] / 2 - 1.2], { size: 0.7 })

    const st = { place: '', sym: 1, rats: 0, route: 0 }
    return {
      scene,
      view: { center: [0, 0, 0.8], radius: 40, polar: 0.72, azimuth: 0 },
      frame(dt, p) {
        const place = pick(PLACES, p.place, 'tidy')
        const v = VIEW_KEYS.indexOf(pick(VIEWS, p.view, 'sch'))
        if (place !== st.place) {
          st.place = place
          emptyGroup(ratsHolder)
          emptyGroup(routeHolder)
          const r = RATS[place]
          for (const [a, b] of r.edges) rod(ratsHolder, [a[0], 0.35, a[1]], [b[0], 0.35, b[1]], 0.05, ratsMat, 6).castShadow = false
          for (const { path, bottom } of r.routes) {
            const g = add(routeHolder, new THREE.Group(), [0, bottom ? 0.03 : 0.06, 0])
            flatTrace(g, path, 0.32, bottom ? botMat : topMat, 0.05)
            if (bottom) for (const e of [path[0], path[2]]) cylinder(g, 0.3, 0.1, mat('#c9cdd4', { metal: 0.4 }), [e[0], 0.06, e[1]], 'y', 12)
          }
        }
        const k = ease(dt, 4)
        st.sym += ((v === 0 ? 1 : 0) - st.sym) * k
        let away = 0
        for (const { part, g, sym, foot } of parts) {
          const to = v === 0 ? part.sch : part[place]
          g.position.x += (to[0] - g.position.x) * k
          g.position.z += (to[1] - g.position.z) * k
          away = Math.max(away, Math.hypot(to[0] - g.position.x, to[1] - g.position.z))
          presence(sym, st.sym)
          presence(foot, 1 - st.sym)
        }
        const arrived = Math.max(0, 1 - away / 2)
        st.rats = glide(dt, st.rats, v === 2 ? arrived : v === 3 ? 0.18 * arrived : 0, 5)
        st.route = glide(dt, st.route, v === 3 ? arrived : 0, 5)
        paperMat.opacity = st.sym
        paperMat.visible = st.sym > 0.01
        symMat.opacity = pinMat.opacity = st.sym
        wires.visible = st.sym > 0.01
        ratsMat.opacity = st.rats
        ratsHolder.visible = st.rats > 0.01
        topMat.opacity = botMat.opacity = st.route
        routeHolder.visible = st.route > 0.01
        viewTag.set(v === 0 ? 'SCHEMATIC SHEET' : `PCB · ${BOARD[0] * MM_PER_UNIT} × ${BOARD[1] * MM_PER_UNIT} mm`, v === 0 ? LABEL : POWER)
      },
      readouts: (p) => {
        const r = RATS[pick(PLACES, p.place, 'tidy')]
        const v = pick(VIEWS, p.view, 'sch')
        return [
          { label: 'Netlist', value: `${NETS.length} nets · ${PADS} pads · ${PARTS.length} parts` },
          { label: 'Ratsnest length', value: `${Math.round(r.length)} mm` },
          { label: 'Crossings', value: r.cross ? `${r.cross} · ${r.vias} vias to route` : 'none', tone: r.cross === 0 ? 'ok' : r.cross < 4 ? 'warn' : 'bad' },
          {
            label: 'Stage',
            value: v === 'sch' ? 'connectivity only' : v === 'foot' ? 'footprints placed' : v === 'rats' ? 'air-wires to route' : 'copper routed',
          },
        ]
      },
    }
  },
}

// --- Layout rules: return current hugs the plane under its trace; a slot forces a detour. Decoupling loops must be tiny. ---

const SIG_MM = 30
const PREPREG_MM = 0.2
const EDGE_A = 0.1
const EDGE_S = 2e-9
const PLANES = { solid: 'Solid ground plane', slot: 'Slot under trace' }
const DECAPS = { near: 'Cap at the pin', far: 'Cap 25 mm away' }
const CAP_MM = { near: 2, far: 25 }
const CAP_X = { near: -7.6, far: 5.8 }
const SIG_Z = -1
const SLOT_X = 2
const SLOT_END = 2.4
const DETOUR_MM = (SLOT_END + 0.7 - SIG_Z) * 2

const layoutOf = (p: Params) => {
  const slot = pick(PLANES, p.plane, 'solid') === 'slot'
  const ck = pick(DECAPS, p.cap, 'near')
  const h = slot ? DETOUR_MM : PREPREG_MM
  const sigL = loopInductance(SIG_MM / 1000, h / 1000, 0.05e-3)
  const area = SIG_MM * h
  const capL = loopInductance(CAP_MM[ck] / 1000, PREPREG_MM / 1000, 0.1e-3) + CAPS.ceramic100n.esl
  return { slot, ck, sigL, area, ratio: area / (SIG_MM * PREPREG_MM), capL, dip: (capL * EDGE_A) / EDGE_S }
}

export const layoutRules: Lesson = {
  id: 'pcb-design-layout-rules',
  title: 'Layout rules',
  tagline: 'Fast current returns right under its trace; keep that path unbroken and decoupling loops tiny',
  formula: (p) => {
    const s = layoutOf(p)
    return `signal loop ${SIG_MM} mm × ${s.slot ? DETOUR_MM : PREPREG_MM} mm → ${nH(s.sigL)} · VDD dip = (L_loop + ESL)·di/dt = ${nH(s.capL)} · ${EDGE_A * 1000} mA / ${EDGE_S * 1e9} ns = ${Math.round(s.dip * 1000)} mV`
  },
  legend: [
    { color: RING, label: 'Signal current out', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Its return in the ground plane', shape: 'dot' },
    { color: POWER, label: 'Decoupling cap feeding VDD', shape: 'dot' },
  ],
  points: [
    `Every signal current comes back. Above ~100 kHz it takes the path of least inductance: straight under its own trace in the plane below, ${Math.round(returnWithin(1) * 100)} % within one prepreg height (${PREPREG_MM} mm) of the centreline, ${Math.round(returnWithin(3) * 100)} % within three.`,
    `A slot or split in the plane forces the return around it. The loop grows from ${SIG_MM * PREPREG_MM} mm² to ${Math.round(SIG_MM * DETOUR_MM)} mm²: more inductance, more ringing, and a loop antenna that radiates and picks up in proportion to its area.`,
    'Rules that follow: a solid ground plane on the layer next to signals; never route across a split; when a signal changes layer, put a ground via beside its via so the return can change too.',
    `Decoupling caps deliver the fast current edges of the chip. What counts is the loop: cap → VDD pin → GND pin → via → plane → cap. 100 nF right at the pin with its own via; ${CAP_MM.far} mm away adds trace inductance and the rail dips on every edge.`,
    `Layers spread apart and 2 mm per grid unit; inductance from a rectangular-loop model plus the cap’s ${CAPS.ceramic100n.esl * 1e9} nH ESL. Edge: ${EDGE_A * 1000} mA in ${EDGE_S * 1e9} ns.`,
  ],
  controls: [
    { kind: 'choice', key: 'plane', options: opts(PLANES), initial: 'solid' },
    { kind: 'choice', key: 'cap', options: opts(DECAPS), initial: 'near' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const stack = pcbStack(scene, STACKUPS.four.slice(2, 5), { w: 26, d: 12, gap: 3.2, size: 0.5 })
    stack.explode(1)
    const [top, pre, gnd] = stack.layers
    if (pre.slab) pre.slab.material = fade('#cbbd86', 0.18)
    if (gnd.slab) gnd.slab.visible = false
    const yT = top.group.position.y + top.thick / 2 + 0.05
    const yP = gnd.group.position.y + gnd.thick / 2 + 0.05
    const T = top.group
    const lift = top.thick / 2

    const chip = add(T, new THREE.Group(), [-8, lift, 0])
    box(chip, [5, 0.7, 5], mat('#1c1c1f', { rough: 0.6 }), [0, 0.35, 0])
    for (let i = 0; i < 7; i++)
      for (const [x, z, sx, sz] of [[-1.8 + i * 0.6, -2.75, 0.22, 0.5], [-1.8 + i * 0.6, 2.75, 0.22, 0.5], [-2.75, -1.8 + i * 0.6, 0.5, 0.22], [2.75, -1.8 + i * 0.6, 0.5, 0.22]])
        box(chip, [sx, 0.12, sz], TIN(), [x, 0.06, z])
    flatText(chip, 'MCU', [0, 0.75, 0], 0.9, LABEL)

    const sigMat = mat('#c8803f', { metal: 0.45, rough: 0.35, emissive: RING }, true)
    sigMat.emissiveIntensity = 0.25
    const cu = COPPER()
    const flat = add(T, new THREE.Group(), [0, lift + 0.04, 0])
    flatTrace(flat, [[-5.4, SIG_Z], [9.8, SIG_Z]], 0.4, sigMat)
    flatTrace(flat, [[-9.2, 2.7], [-9.2, 3.6]], 0.4, cu)
    flatTrace(flat, [[-5.2, -2.2], [-4.8, -2.2]], 0.4, cu)
    flatText(T, 'SIGNAL · 25 MHz CLOCK', [2.5, lift + 0.1, SIG_Z - 0.9], 0.5, RING)
    const out = add(T, new THREE.Group(), [11.2, lift, SIG_Z])
    box(out, [1.4, 1.6, 2.4], mat('#2a2b30', { rough: 0.5 }), [0, 0.8, 0])
    cylinder(out, 0.45, 0.6, mat('#d9b24a', { metal: 0.45, rough: 0.35 }), [0, 0.8, 1.4], 'z', 18)
    flatText(T, 'OUT', [11.2, 1.8, SIG_Z - 2], 0.5, LABEL)
    for (const [x, z] of [[9.8, SIG_Z], [-4.8, -2.2], [-9.2, 3.6]] as P2[]) stack.via(x, z, 0, 2)

    const capHolder = add(T, new THREE.Group(), [0, lift + 0.04, 0])
    const capVias = { near: stack.via(CAP_X.near - 0.6, 5.4, 0, 2), far: stack.via(CAP_X.far + 0.6, 5.4, 0, 2) }
    const planeHolder = add(gnd.group, new THREE.Group())
    const retFaint = new THREE.MeshBasicMaterial({ color: CONVENTIONAL, transparent: true, opacity: 0.3, depthWrite: false })
    const retCore = new THREE.MeshBasicMaterial({ color: '#ffc27a', transparent: true, opacity: 0.85, depthWrite: false })
    const sigBeads = loopBeads(scene, 30, RING, { r: 0.18 })
    const capBeads = loopBeads(scene, 16, POWER, { r: 0.18 })

    const st = { key: '' }
    return {
      scene,
      view: { center: [-4, -3, 0.5], radius: 56, polar: 0.86, azimuth: 0 },
      frame(dt, p) {
        const s = layoutOf(p)
        const key = `${s.slot}|${s.ck}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(planeHolder)
          const t = gnd.thick
          const pm = mat('#6e4a2c', { metal: 0.35, rough: 0.55 })
          if (!s.slot) box(planeHolder, [26, t, 12], pm)
          else {
            const g = 0.6
            box(planeHolder, [13 + SLOT_X - g, t, 12], pm, [(-13 + SLOT_X - g) / 2, 0, 0])
            box(planeHolder, [13 - SLOT_X - g, t, 12], pm, [(13 + SLOT_X + g) / 2, 0, 0])
            box(planeHolder, [2 * g, t, 6 - SLOT_END], pm, [SLOT_X, 0, (6 + SLOT_END) / 2])
            const edge = glowMat(HIGH_V, 1)
            const ey = t / 2 + 0.04
            for (const x of [SLOT_X - g, SLOT_X + g]) rod(planeHolder, [x, ey, -6], [x, ey, SLOT_END], 0.06, edge, 6)
            rod(planeHolder, [SLOT_X - g, ey, SLOT_END], [SLOT_X + g, ey, SLOT_END], 0.06, edge, 6)
            flatText(planeHolder, 'SLOT', [SLOT_X + 0.8, t / 2 + 0.05, -3.5], 0.6, HIGH_V, 'left')
          }
          const back: P2[] = s.slot
            ? [[9.8, SIG_Z], [SLOT_X + 0.7, SIG_Z], [SLOT_X + 0.7, SLOT_END + 0.7], [SLOT_X - 0.7, SLOT_END + 0.7], [SLOT_X - 0.7, SIG_Z], [-4.8, SIG_Z], [-4.8, -2.2]]
            : [[9.8, SIG_Z], [-4.8, SIG_Z], [-4.8, -2.2]]
          const glow = add(planeHolder, new THREE.Group(), [0, t / 2 + 0.03, 0])
          flatTrace(glow, back, 2.4, retFaint, 0.02)
          flatTrace(add(glow, new THREE.Group(), [0, 0.02, 0]), back, 0.7, retCore, 0.02)
          sigBeads.setPath([[-5.4, yT, SIG_Z], [9.8, yT, SIG_Z], [9.8, yP, SIG_Z], ...back.slice(1).map(([x, z]): V3 => [x, yP, z]), [-4.8, yT, -2.2], [-5.4, yT, -1.6]])

          emptyGroup(capHolder)
          const far = s.ck === 'far'
          const cx = CAP_X[s.ck]
          const vdd = far ? cx - 0.6 : cx + 0.6
          const gx = far ? cx + 0.6 : cx - 0.6
          flatTrace(capHolder, [[-6.5, 2.7], [-6.5, 4.4], [vdd, 4.4]], 0.5, cu)
          flatTrace(capHolder, [[gx, 4.4], [gx, 5.4]], 0.5, cu)
          const cap = add(capHolder, new THREE.Group(), [cx, 0, 4.4])
          box(cap, [0.8, 0.6, 0.7], mat('#c9b28a', { rough: 0.6 }), [0, 0.3, 0])
          for (const x of [-0.5, 0.5]) box(cap, [0.25, 0.62, 0.72], TIN(), [x, 0.31, 0])
          flatText(cap, '100 nF', [0, 0.05, 1.2], 0.5, POWER)
          capVias.near.show(!far)
          capVias.far.show(far)
          capBeads.setPath([
            [vdd, yT, 4.4], [-6.5, yT, 4.4], [-6.5, yT, 2.7], [-9.2, yT, 2.7], [-9.2, yT, 3.6],
            [-9.2, yP, 3.6], [-9.2, yP, 5.4], [gx, yP, 5.4], [gx, yT, 5.4], [gx, yT, 4.4],
          ])
        }
        sigBeads.step(dt * 0.1)
        capBeads.step(dt * 0.12)
      },
      readouts: (p) => {
        const s = layoutOf(p)
        return [
          { label: 'Signal loop', value: `${Math.round(s.area)} mm² · ${nH(s.sigL)}`, tone: s.slot ? 'bad' : 'ok' },
          { label: 'Radiates / picks up', value: s.slot ? `${Math.round(s.ratio)}× a solid plane` : 'baseline', tone: s.slot ? 'bad' : 'ok' },
          { label: 'Decoupling loop', value: `${nH(s.capL)} with ESL` },
          { label: `VDD dip, ${EDGE_A * 1000} mA edge`, value: `${Math.round(s.dip * 1000)} mV on 3.3 V`, tone: s.dip < 0.1 ? 'ok' : s.dip < 0.2 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Traces and vias: IPC-2221 heating sets how wide a trace and how many vias a current needs. ---

const OZ = 1
const RUN_MM = 100
const DRILL = 0.3
const WIDTHS = { '0.25': '0.25 mm', '0.5': '0.5 mm', '1': '1 mm', '3': '3 mm' }
const VIA_COUNTS = { '1': '1 via', '2': '2 vias', '4': '4 vias', '8': '8 vias' }
const VIA_SETS: Record<keyof typeof VIA_COUNTS, P2[]> = {
  '1': [[0, 0]],
  '2': [[0, -0.5], [0, 0.5]],
  '4': [[-0.5, -0.5], [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5]],
  '8': [-1.35, -0.45, 0.45, 1.35].flatMap((z): P2[] => [[-0.5, z], [0.5, z]]),
}
const TX = 13

const traceOf = (p: Params) => {
  const wk = pick(WIDTHS, p.width, '0.5')
  const vk = pick(VIA_COUNTS, p.vias, '1')
  const amps = Number(p.amps) || 1
  const w = Number(wk)
  const vias = Number(vk)
  const area = traceAreaMil2(w, OZ)
  const rise = ipcRise(amps, area)
  const viaRise = ipcRise(amps / vias, viaAreaMil2(DRILL), true)
  const ohms = copperOhms(RUN_MM, area, 25 + Math.min(rise, 300))
  return { wk, vk, amps, w, vias, area, rise, viaRise, ohms, drop: amps * ohms, need: ipcWidthMm(amps, 10, OZ) }
}
const riseText = (r: number) => (r > 250 ? '> 250 °C · fuses' : `+${Math.round(r)} °C → ${Math.round(25 + r)} °C`)
const riseTone = (r: number) => (r < 10 ? 'ok' : r < 40 ? 'warn' : 'bad')

export const tracesAndVias: Lesson = {
  id: 'pcb-design-traces-and-vias',
  title: 'Traces and vias',
  tagline: 'Copper on a board is 35 µm thin: current heats it, so width and via count follow the amps',
  formula: (p) => {
    const s = traceOf(p)
    return `IPC-2221: ΔT = (I / (0.048·A^0.725))^(1/0.44), A = ${s.w} mm × 35 µm = ${Math.round(s.area)} mil² → ${s.rise > 250 ? '> 250' : Math.round(s.rise)} °C`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current, speed ∝ amps', shape: 'dot' },
    { color: HIGH_V, label: 'Hot copper', shape: 'dot' },
  ],
  points: [
    `PCB copper is foil: 1 oz/ft² = 35 µm. A trace’s limit is how hot it gets. IPC-2221: I = k·ΔT^0.44·A^0.725, A in mil², k = 0.048 on outer layers, 0.024 inside where no air cools it.`,
    `1 oz outer layer at 10 °C rise: 0.25 mm carries ${ipcAmps(traceAreaMil2(0.25, 1), 10).toFixed(1)} A, 1 mm ${ipcAmps(traceAreaMil2(1, 1), 10).toFixed(1)} A, 3 mm ${ipcAmps(traceAreaMil2(3, 1), 10).toFixed(1)} A. Doubling current needs about 2.6× the width.`,
    `A via is a plated tube: ${DRILL} mm drill, 25 µm wall ≈ ${Math.round(viaAreaMil2(DRILL))} mil², like a 0.6 mm trace but buried in the board, so rate it as inner copper. Power paths change layer through several vias in parallel.`,
    `Heat also costs volts: copper resistance climbs 0.39 % per °C, so a hot motor or LED feed loses more. Beyond ~5 A, use 2 oz copper, a pour, or solder a wire along the trace.`,
    `${RUN_MM / 2} mm on top, through the vias, ${RUN_MM / 2} mm on the bottom; widths drawn ×1.4, layers spread apart.`,
  ],
  controls: [
    { kind: 'slider', key: 'amps', label: 'Current', min: 0.1, max: 10, initial: 1, log: true, format: (v) => si(v, 'A', 2) },
    { kind: 'choice', key: 'width', options: opts(WIDTHS), initial: '0.5' },
    { kind: 'choice', key: 'vias', options: opts(VIA_COUNTS), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const stack = pcbStack(scene, STACKUPS.two.slice(2, 5), { w: 2 * TX + 4, d: 10, gap: 2.4, size: 0.5 })
    stack.explode(1)
    const [top, core, bot] = stack.layers
    if (core.slab) core.slab.material = fade('#b9a86e', 0.35)
    const yT = top.group.position.y + top.thick / 2
    const yB = bot.group.position.y + bot.thick / 2
    const topMat = mat('#c8803f', { metal: 0.45, rough: 0.35 }, true)
    const botMat = mat('#c8803f', { metal: 0.45, rough: 0.35 }, true)
    const viaMat = mat('#c8803f', { metal: 0.45, rough: 0.35 }, true)
    const viaSets = Object.fromEntries(
      Object.entries(VIA_SETS).map(([k, pts]) => [k, pts.map(([x, z]) => stack.via(x, z, 0, 2, { r: 0.24, pad: 0.42, material: viaMat }))]),
    ) as Record<string, ReturnType<typeof stack.via>[]>
    stack.via(TX - 0.6, 0, 0, 2, { r: 0.4, pad: 0.8, material: botMat })
    const holdTop = add(top.group, new THREE.Group(), [0, top.thick / 2 + 0.02, 0])
    const holdBot = add(bot.group, new THREE.Group(), [0, bot.thick / 2 + 0.02, 0])

    const supply = add(top.group, new THREE.Group(), [-TX - 0.6, top.thick / 2, 0])
    box(supply, [2.2, 1.8, 3.2], mat('#2e8b57', { rough: 0.5 }), [0, 0.9, 0])
    for (const z of [-0.7, 0.7]) cylinder(supply, 0.45, 0.2, STEEL(), [0, 1.85, z], 'y', 16)
    const load = add(top.group, new THREE.Group(), [TX + 0.6, top.thick / 2, 0])
    box(load, [2.2, 1.8, 3.2], mat('#2a2b30', { rough: 0.5 }), [0, 0.9, 0])
    text(scene, 'SUPPLY', [-TX - 0.6, yT + 3, 0], LABEL, 0.55)
    text(scene, 'LOAD', [TX + 0.6, yT + 3, 0], LABEL, 0.55)
    const waves = heatWaves(scene, 2 * TX - 4, { count: 7, rise: 3.5 })
    waves.group.position.set(-TX / 2 - 0.5, yT, 0)
    const beads = loopBeads(scene, 22, CONVENTIONAL, { r: 0.2, closed: false })
    beads.setPath([[-TX, yT + 0.15, 0], [0, yT + 0.15, 0], [0, yB + 0.15, 0], [TX - 0.6, yB + 0.15, 0]])
    const tag = liveLabel(scene, [-TX / 2, yT + 1.4, -2.6], { size: 0.5 })

    const st = { key: '', heat: 0, via: 0 }
    return {
      scene,
      view: { center: [-3, -2.4, 0], radius: 62, polar: 0.92, azimuth: 0.1 },
      frame(dt, p) {
        const s = traceOf(p)
        const key = `${s.wk}|${s.vk}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(holdTop)
          emptyGroup(holdBot)
          const wv = Math.max(0.35, s.w * 1.4)
          const padW = Math.max(wv, s.vias === 8 ? 3.6 : s.vias === 1 ? 1 : 2)
          flatTrace(holdTop, [[-TX, 0], [-0.8, 0]], wv, topMat)
          flatTrace(holdTop, [[-0.4, 0], [0.4, 0]], padW, topMat)
          flatTrace(holdBot, [[0.8, 0], [TX - 0.6, 0]], wv, botMat)
          flatTrace(holdBot, [[-0.4, 0], [0.4, 0]], padW, botMat)
          Object.entries(viaSets).forEach(([k, vs]) => vs.forEach((v) => v.show(k === s.vk)))
          tag.set(`${s.w} mm · 1 oz`, LABEL)
        }
        st.heat = glide(dt, st.heat, Math.min(s.rise, 300), 2)
        st.via = glide(dt, st.via, Math.min(s.viaRise, 300), 2)
        heatGlow(topMat, st.heat / 150)
        heatGlow(botMat, st.heat / 150)
        heatGlow(viaMat, st.via / 150)
        waves.step(dt, st.heat / 80)
        beads.step(dt * 0.03 * s.amps)
      },
      readouts: (p) => {
        const s = traceOf(p)
        return [
          { label: 'Trace', value: riseText(s.rise), tone: riseTone(s.rise) },
          { label: `Each via · ${si(s.amps / s.vias, 'A', 2)}`, value: riseText(s.viaRise), tone: riseTone(s.viaRise) },
          { label: `Loss over ${RUN_MM} mm`, value: s.rise > 250 ? 'trace gone' : `${si(s.drop, 'V', 2)} · ${si(s.drop * s.amps, 'W', 2)}` },
          { label: 'Width for +10 °C', value: mm(s.need, s.need < 1 ? 2 : 1), tone: s.need <= s.w ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Manufacturing: inner layers etched, laminated, drilled, plated, etched, masked, printed, finished and tested. ---

const STEPS = ['Core and foil', 'Etch inner layers', 'Laminate', 'Drill', 'Plate the holes', 'Etch outer layers', 'Solder mask', 'Silkscreen', 'Finish and test']
const STEP_S = [3, 3.5, 3, 4.5, 3, 3.5, 2.5, 2.5, 4]
const LAYER_STEP = [7, 6, 2, 2, 0, 0, 0, 2, 2, 6, 7]
const PAD_MM = 0.6
const WANDER = { '0': 'On target', '0.1': 'Drill wander 0.1 mm', '0.2': '0.2 mm' }
const U_PER_MM = 2
const MW = 22
const MD = 12
const PANEL: P2 = [457, 610]
const BOARD_MM: P2 = [MW / U_PER_MM * 2, MD / U_PER_MM * 2]
const HOLES: P2[] = [[-8.5, -3.5], [-8.5, 3.5], [3, -3.2], [5, 1.2], [7.5, 4], [8.5, -2.5]]
const SOIC: P2[] = [-7.6, -5.1, -2.6, -0.1].flatMap((x): P2[] => [[x + 4, -2], [x + 4, 2]])
const ROUTES: P2[][] = [
  [[-3.6, -2], [-3.6, -3.5], [-8.5, -3.5]],
  [[-3.6, 2], [-3.6, 3.5], [-8.5, 3.5]],
  [[3.9, -2], [3.9, -3.2], [3, -3.2]],
  [[3.9, 2], [5, 1.2]],
  [[1.4, 2], [1.4, 4], [7.5, 4]],
  [[1.4, -2], [1.4, -1], [6.5, -1], [8.5, -2.5]],
]
const thicknessAt = (step: number) => stackMm(STACKUPS.four.filter((_, i) => LAYER_STEP[i] <= step))

export const manufacturing: Lesson = {
  id: 'pcb-design-manufacturing',
  title: 'Manufacturing',
  tagline: 'A multilayer board is built up: etch, laminate, drill, plate, mask, print, test',
  formula: (p) => {
    const w = Number(pick(WANDER, p.wander, '0'))
    return `annular ring = (pad − drill)/2 − wander = (${PAD_MM} − ${DRILL})/2 − ${w} = ${+annularRing(PAD_MM, DRILL, w).toFixed(2)} mm · ${boardsPerPanel(PANEL, BOARD_MM, 2, 10)} boards per 18×24 in panel`
  },
  legend: [
    { color: '#c8803f', label: 'Copper', shape: 'dot' },
    { color: '#b9a86e', label: 'FR4 glass-epoxy', shape: 'dot' },
    { color: PCB_GREEN, label: 'Solder mask', shape: 'dot' },
    { color: HIGH_V, label: 'Hole broke out of its pad', shape: 'dot' },
  ],
  points: [
    'Inner layers first: an FR4 core clad with copper both sides gets photoresist, UV through the artwork, then etching removes the copper that is not circuit (here, clearance holes in the GND and power planes).',
    'Lamination stacks prepreg (glass cloth with uncured resin) and outer copper foil around the core and presses it hot (~180 °C); the resin flows and cures into one 1.6 mm board.',
    `CNC drills put every hole through all layers. Any wander eats the annular ring, the copper left round the hole: with a ${PAD_MM} mm pad and ${DRILL} mm drill a 0.15 mm slip and the drill breaks out of the pad. Design pads at least drill + 0.3 mm.`,
    'Holes are seeded with electroless copper and electroplated to ~25 µm, joining the layers. The outer layers are then imaged and etched like the inner ones.',
    'Solder mask (the green epoxy) covers copper except pads; silkscreen prints references; a finish (HASL tin or ENIG gold) protects the pads; a flying-probe test checks every net against the netlist.',
    `You send Gerber files (one per layer) plus a drill file. Boards ride on a panel: ${boardsPerPanel(PANEL, BOARD_MM, 2, 10)} of these ${BOARD_MM[0]} × ${BOARD_MM[1]} mm boards per 18×24 in panel. Layer thicknesses not to scale.`,
  ],
  controls: [storySlider(STEPS), { kind: 'choice', key: 'wander', options: opts(WANDER), initial: '0' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const stack = pcbStack(scene, STACKUPS.four, { w: MW, d: MD, gap: 1.1, size: 0.4 })
    const L = stack.layers
    const padMat = mat('#c8803f', { metal: 0.45, rough: 0.35 }, true)
    const traceMat = fade('#c8803f', 0, 0.05)
    const sheetMats = [2, 8].map(() => fade('#c8803f', 1, 0.05))
    const holeMat = mat('#0d0e10', { rough: 0.9 })
    const plateMat = fade('#c8803f', 0, 0.1)
    plateMat.side = THREE.DoubleSide
    const breakMat = new THREE.MeshBasicMaterial({ color: HIGH_V, transparent: true, opacity: 0, depthWrite: false })

    const outer = [2, 8].map((i, k) => {
      const g = L[i].group
      const sheet = add(g, mesh(new THREE.BoxGeometry(MW, L[i].thick, MD), sheetMats[k]))
      sheet.castShadow = false
      const art = add(g, new THREE.Group(), [0, (k ? -1 : 1) * (L[i].thick / 2 + 0.01), 0])
      for (const r of ROUTES) flatTrace(art, r, 0.35, traceMat, 0.04)
      for (const [x, z] of HOLES) cylinder(art, PAD_MM, 0.06, padMat, [x, 0.02, z], 'y', 24)
      if (!k) for (const [x, z] of SOIC) box(art, [0.9, 0.06, 1.6], padMat, [x, 0.02, z])
      return { sheet, art }
    })
    const antipads = [4, 6].map((i) => {
      const g = add(L[i].group, new THREE.Group(), [0, L[i].thick / 2 + 0.01, 0])
      return HOLES.map(([x, z], j) => (j % 3 === 0 ? null : cylinder(g, 0.75, 0.02, mat('#2a2018', { rough: 0.9 }), [x, 0, z], 'y', 20))).filter((m) => m !== null)
    })
    const maskPads = [1, 9].map((i, k) => {
      const g = add(L[i].group, new THREE.Group(), [0, (k ? -1 : 1) * (L[i].thick / 2 + 0.01), 0])
      for (const [x, z] of HOLES) cylinder(g, PAD_MM, 0.03, padMat, [x, 0, z], 'y', 24)
      if (!k) for (const [x, z] of SOIC) box(g, [0.9, 0.03, 1.6], padMat, [x, 0, z])
      return g
    })
    const silk = add(L[0].group, new THREE.Group(), [0, L[0].thick / 2 + 0.01, 0])
    const ink = mat('#f2f2f2', { rough: 0.6 })
    flatTrace(silk, [[-6, -1.1], [1.6, -1.1], [1.6, 1.1], [-6, 1.1], [-6, -1.1]], 0.1, ink, 0.02)
    flatText(silk, 'U1', [-2.2, 0.03, 0], 0.7)
    flatText(silk, 'ROBO-SIMS v1', [5.5, 0.03, 5.2], 0.6)
    flatText(silk, 'J1', [-10, 0.03, 0], 0.6)

    const holes = add(stack.group, new THREE.Group())
    const plating = add(stack.group, new THREE.Group())
    const breaks = add(stack.group, new THREE.Group())
    const drill = add(scene, new THREE.Group())
    cylinder(drill, DRILL, 10, mat('#b9bec6', { metal: 0.5, rough: 0.3 }), [0, 5, 0], 'y', 12)
    cylinder(drill, 0.9, 2.2, mat('#3a3d45', { rough: 0.5 }), [0, 11, 0], 'y', 20)
    const probes = [0, 1].map(() => {
      const g = add(scene, new THREE.Group())
      rod(g, [0, 0, 0], [0, 4, 0], 0.07, mat('#d9b24a', { metal: 0.5, rough: 0.3 }), 8)
      cylinder(g, 0.3, 1.2, mat('#3a3d45', { rough: 0.5 }), [0, 4.6, 0], 'y', 12)
      return g
    })
    const uv = add(scene, mesh(new THREE.BoxGeometry(0.5, 0.2, MD + 1), new THREE.MeshBasicMaterial({ color: '#9f7bff', transparent: true, opacity: 0.8 })))
    const press = [0, 1].map(() => add(scene, mesh(new THREE.BoxGeometry(MW + 2, 0.6, MD + 1), mat('#6c7079', { metal: 0.3, rough: 0.4 })), [0, 0, 0]))
    const testTag = liveLabel(scene, [0, 0, 0], { size: 0.8 })

    const clock = storyClock(STEP_S)
    const st = { wander: '', k: 1.6 }
    const yOf = (i: number) => stack.group.position.y + L[i].group.position.y
    return {
      scene,
      view: { center: [-2, -0.5, 0], radius: 60, polar: 1.12, azimuth: 0.3 },
      frame(dt, p) {
        clock.frame(dt, n(p, 'step'))
        const step = clock.step
        const t = clock.t
        const done = clock.done
        const wk = pick(WANDER, p.wander, '0')
        const off = Number(wk) * U_PER_MM
        const ring = annularRing(PAD_MM, DRILL, Number(wk))
        const k = step < 2 ? 1.6 : step === 2 ? 1.6 - Math.min(1, t * 1.4) : 0.6
        st.k = glide(dt, st.k, k, 10)
        stack.explode(st.k)
        stack.group.position.y = 5 * 1.1 * st.k - 1
        L.forEach((l, i) => {
          const a = done(LAYER_STEP[i])
          l.group.visible = a > 0.02
          l.group.position.y += (1 - Math.min(1, a * 2)) * (i < 5 ? 7 : -7)
        })
        const top = yOf(2) + L[2].thick / 2 + 0.05
        const bottom = yOf(8) - L[8].thick / 2 - 0.05
        if (wk !== st.wander) {
          st.wander = wk
          emptyGroup(holes)
          emptyGroup(plating)
          emptyGroup(breaks)
          for (const [x, z] of HOLES) {
            add(holes, mesh(new THREE.CylinderGeometry(DRILL, DRILL, 1, 16), holeMat), [x + off, 0, z]).castShadow = false
            add(plating, mesh(new THREE.CylinderGeometry(DRILL + 0.02, DRILL + 0.02, 1, 16, 1, true), plateMat), [x + off, 0, z]).castShadow = false
            if (ring < 0) {
              const b = add(breaks, mesh(new THREE.TorusGeometry(DRILL + 0.12, 0.1, 6, 20), breakMat), [x + off, 0, z])
              b.rotation.x = Math.PI / 2
            }
          }
        }
        const [hy, hh] = [(top + bottom) / 2 - stack.group.position.y, top - bottom]
        const drilled = step > 3 ? HOLES.length : step === 3 ? Math.floor(t * HOLES.length) : 0
        holes.children.forEach((h, j) => {
          h.visible = j < drilled
          h.position.y = hy
          h.scale.y = hh
        })
        plating.children.forEach((h) => {
          h.position.y = hy
          h.scale.y = hh
        })
        plateMat.opacity = done(4)
        plating.visible = step >= 4
        breaks.children.forEach((b) => (b.position.y = yOf(2) - stack.group.position.y + 0.25))
        breakMat.opacity = step >= 3 && step <= 5 ? 0.9 : 0

        const etched = done(5)
        outer.forEach((o, j) => {
          sheetMats[j].opacity = 1 - etched
          o.sheet.visible = etched < 0.99
        })
        traceMat.opacity = etched
        padMat.color.set('#c8803f').lerp(new THREE.Color('#e6c35a'), done(8))
        maskPads.forEach((g) => (g.visible = step >= 6))
        silk.visible = step >= 7
        antipads.forEach((a) => a.forEach((m, j) => (m.visible = step > 1 || (step === 1 && t > (j + 1) / (a.length + 1)))))

        uv.visible = step === 1 || step === 5
        uv.position.set(-MW / 2 + MW * t, (step === 1 ? yOf(4) : top) + 1, 0)
        press.forEach((m, j) => {
          m.visible = step === 2
          const gap = (1 - Math.min(1, t * 1.4)) * 4
          m.position.y = j === 0 ? top + 0.5 + gap : bottom - 0.5 - gap
        })
        drill.visible = step === 3
        if (step === 3) {
          const u = t * HOLES.length
          const j = Math.min(HOLES.length - 1, Math.floor(u))
          const dive = Math.sin(Math.PI * (u - j))
          drill.position.set(HOLES[j][0] + off, top + 0.3 - dive * (top - bottom + 0.3), HOLES[j][1])
        }
        probes.forEach((g, j) => {
          g.visible = step === 8
          const h = HOLES[(Math.floor(t * 4) * 2 + j) % HOLES.length]
          g.position.set(h[0], top + 0.1 + 0.8 * Math.abs(Math.sin(Math.PI * t * 4)), h[1])
        })
        testTag.group.position.y = yOf(0) + 2
        testTag.set(step === 8 && t > 0.8 ? (ring < 0 ? 'E-TEST: OPEN ON BROKEN-OUT VIAS' : 'E-TEST: PASS') : '', ring < 0 ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const s = n(p, 'step')
        const w = Number(pick(WANDER, p.wander, '0'))
        const ring = annularRing(PAD_MM, DRILL, w)
        return [
          { label: 'Step', value: s ? `${s}/${STEPS.length} · ${STEPS[s - 1]}` : `all ${STEPS.length} in turn` },
          { label: 'Board thickness', value: mm(thicknessAt(s ? s - 1 : STEPS.length - 1), 3) },
          { label: 'Annular ring', value: ring < 0 ? `${mm(ring)} · breakout` : mm(ring), tone: ring >= 0.1 ? 'ok' : ring >= 0 ? 'warn' : 'bad' },
          { label: 'Per 18×24 in panel', value: `${boardsPerPanel(PANEL, BOARD_MM, 2, 10)} boards` },
        ]
      },
    }
  },
}
