// Connector close-ups: an open-barrel terminal in side view (contact, see-through conductor + insulation wings, wire,
// crimper die), the barrel's cross-section (wings curling into a B, 7 strands loose, honeycombed or cut), and mated
// wire-to-board pairs at real size (mm × k, mating along +x, pins stacked along y): Dupont on a pin header, JST-PH /
// JST-XH into a keyed shroud, XT30 / XT60 with chamfered (keyed) housings.
import * as THREE from 'three/webgpu'
import { CRIMP, ConnectorId, Terminal } from '../../core/physics'
import { V3, add, box, mat, mesh, GOLD, TIN } from '../../models/kit'
import { WIRE_COLORS } from './breadboard'
import { COPPER, HIGH_V } from './colors'
import { heatTint } from './heat'
import { addRod, stretchRod } from './layout'
import { shellMat } from './shapes'
import { lerp } from './util'

const STEEL_DARK = () => mat('#4a4f58', { metal: 0.4, rough: 0.45 })
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
/** Insulation colours for wire leads. */
export const LEAD_TINT = { red: WIRE_COLORS.plus, black: '#26282d', yellow: WIRE_COLORS.signal, blue: WIRE_COLORS.blue, white: WIRE_COLORS.white, orange: WIRE_COLORS.orange, brown: '#6b3a1e' }

/** Contact length ahead of the barrel (mm) per pitch: a 2.54 Dupont socket is ~6 mm, a 2.0 PH ~4.5. */
const contactMm = (t: Terminal) => (t.condMm < 1.5 ? 4.5 : 6)

interface TerminalLook {
  terminal: Terminal
  /** Conductor and insulation diameters (mm). */
  wireMm: number
  odMm: number
  stripMm: number
  /** Die stroke 0 open … 1 closed; die lift above the barrel afterwards (mm). */
  closed: number
  lift: number
  /** Copper fill when closed, share of strands cut, wire pulled out (mm). */
  fill: number
  cut: number
  slideMm: number
  insulation: string
}

/** Side view, wire entering from +x, `k` units per mm, origin = front of the conductor barrel at the wire axis.
 *  `set(look)`; `tugAt()` = where the pull arrow starts (scene coords). */
export function crimpTerminal(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  const tin = TIN()
  const contact = add(g, new THREE.Group())
  const shell = shellMat('#dfe3e8', 0.38)
  const cond = add(g, mesh(UNIT_BOX, shell))
  const strap = add(g, mesh(UNIT_BOX, tin))
  const insul = add(g, mesh(UNIT_BOX, shell))
  const copper = COPPER()
  const strands = addRod(g, copper)
  const brush = addRod(g, copper)
  const insMat = mat(LEAD_TINT.red, { rough: 0.55 }, true)
  const jacket = addRod(g, insMat)
  const die = add(g, new THREE.Group())
  const punch = add(die, mesh(UNIT_BOX, STEEL_DARK()))
  const anvil = add(g, mesh(UNIT_BOX, STEEL_DARK()))
  const cutMat = mat(HIGH_V, {}, true)
  const nicks = [0, 1, 2].map(() => add(g, mesh(UNIT_BOX, cutMat)))
  let builtFor: Terminal | null = null
  let tugX = 0
  return {
    group: g,
    tugAt: (): V3 => [at[0] + tugX * k, at[1], at[2]],
    set(o: TerminalLook) {
      const T = o.terminal
      const cm = contactMm(T)
      if (builtFor !== T) {
        builtFor = T
        contact.clear()
        const h = T.condMm < 1.5 ? 1.6 : 2.2
        box(contact, [cm, h, h], tin, [-cm / 2 - 0.2, h / 2 - 0.55, 0])
        box(contact, [cm * 0.5, 0.15, h * 0.7], mat('#9aa0a8', { metal: 0.4 }), [-cm * 0.55, h - 0.5, 0])
        box(contact, [0.4, 0.5, h * 0.6], tin, [-0.2, 0.0, 0])
      }
      const r = o.wireMm / 2
      const ro = o.odMm / 2
      const floor = -Math.max(r, ro) - 0.12
      const enc = Math.sqrt((Math.PI * r * r) / Math.max(0.3, o.fill) / Math.PI)
      const condH = lerp(o.wireMm * 2.8, 2 * enc + 0.2, o.closed)
      const insH = lerp(o.odMm * 2.2, Math.max(o.odMm + 0.25, 0.5), o.closed)
      const x1 = T.condMm
      const x2 = x1 + T.gapMm
      const x3 = x2 + T.insulMm
      const place = (m: THREE.Object3D, x0: number, x1b: number, h: number, w: number) => {
        m.position.set((x0 + x1b) / 2, floor + h / 2, 0)
        m.scale.set(x1b - x0, h, w)
      }
      place(cond, 0, x1, condH, Math.max(o.wireMm, 2 * enc) + 0.5)
      place(strap, x1, x2, 0.15, 1)
      place(insul, x2, x3, insH, o.odMm + 0.5)
      const s = o.slideMm
      const tip = -CRIMP.brushMm + s
      const edge = tip + o.stripMm
      stretchRod(brush, [tip, 0, 0], [Math.min(edge, Math.max(tip, 0)), 0, 0], r * 0.85)
      stretchRod(strands, [Math.max(tip, 0), 0, 0], [edge, 0, 0], r * (1 - 0.35 * o.cut * o.closed))
      tugX = x3 + 3 + s
      stretchRod(jacket, [edge, 0, 0], [x3 + 3 + s, 0, 0], ro)
      insMat.color.set(o.insulation)
      const top = floor + condH
      punch.position.set(x3 / 2, top + 0.4 + o.lift, 0)
      punch.scale.set(x3 + 0.6, 0.8, 1.6)
      anvil.position.set(x3 / 2, floor - 0.4, 0)
      anvil.scale.set(x3 + 0.6, 0.8, 1.6)
      nicks.forEach((m, i) => {
        m.visible = o.cut > i / 3 && o.closed > 0.9
        m.position.set(x1 * (0.25 + 0.25 * i), top - 0.05, enc * 0.5)
        m.scale.set(0.12, 0.5, 0.12)
      })
    },
  }
}

const WING_N = 18
const HEX = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2)
const ROUND = new THREE.CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2)

/** Points along one wing (side ±1), bottom → tip: open = half-circle of `r0` then straight up; closed = around `re` to
 *  the top, then curling down toward the centre (a B crimp). Same length both ways. */
function wingPath(side: number, r0: number, re: number, closed: number): [number, number][] {
  const len = Math.PI * r0 * 0.5 + 2.4 * r0
  const pts: [number, number][] = []
  for (let i = 0; i <= WING_N; i++) {
    const l = (i / WING_N) * len
    const arc0 = Math.PI * r0 * 0.5
    const open: [number, number] = l < arc0 ? [side * r0 * Math.sin(l / r0), -r0 * Math.cos(l / r0)] : [side * r0, l - arc0]
    const arc1 = Math.PI * re
    const shut: [number, number] =
      l < arc1
        ? [side * re * Math.sin(l / re), -re * Math.cos(l / re)]
        : [side * (re * 0.15 + 0.35 * re * Math.sin(Math.min(Math.PI, ((l - arc1) / (len - arc1 + 1e-9)) * Math.PI))), re - (l - arc1) * 0.8]
    pts.push([lerp(open[0], shut[0], closed), lerp(open[1], shut[1], closed)])
  }
  return pts
}

interface SectionLook {
  wireMm: number
  /** Copper fill when closed; stroke 0…1; share of strands cut; insulation in the section (strip too short). */
  fill: number
  closed: number
  cut: number
  onInsulation: string | null
}

/** Barrel cross-section at `at`, `k` units per mm, facing the camera: two wings, 7 strands, optional insulation ring. */
export function crimpSection(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  const tin = TIN()
  const wings = [-1, 1].map(() => Array.from({ length: WING_N }, () => addRod(g, tin)))
  const copper = COPPER()
  const cutM = mat(HIGH_V, { rough: 0.5 }, true)
  const round = Array.from({ length: CRIMP.strands }, () => add(g, mesh(ROUND, copper)))
  const hex = Array.from({ length: CRIMP.strands }, () => add(g, mesh(HEX, copper)))
  const insMat = mat(LEAD_TINT.red, { rough: 0.55 }, true)
  const ring = add(g, mesh(new THREE.RingGeometry(1, 1.35, 32), insMat))
  ring.position.z = 0.05
  const back = add(g, mesh(new THREE.CircleGeometry(1, 32), mat('#0b0c0f', { rough: 0.9 })))
  back.position.z = -0.25
  return {
    group: g,
    set(o: SectionLook) {
      const area = (Math.PI * o.wireMm * o.wireMm) / 4
      const ds = Math.sqrt((4 * area) / (CRIMP.strands * Math.PI))
      const r0 = o.wireMm * 0.75
      const reFull = Math.sqrt(area / (Math.max(0.3, o.fill) * Math.PI))
      const re = lerp(r0, reFull, o.closed)
      const wall = 0.11
      ;[-1, 1].forEach((side, w) => {
        const p = wingPath(side, r0 + wall, reFull + wall, o.closed)
        wings[w].forEach((m, i) => stretchRod(m, [p[i][0], p[i][1], 0], [p[i + 1][0], p[i + 1][1], 0], wall))
      })
      back.scale.setScalar(re)
      const squeezed = o.closed > 0.95 && o.fill >= CRIMP.gasLo
      const rho = squeezed ? Math.min(ds, (re * 2) / 3) : ds
      /** Loose bundles sag to the bottom of the barrel. */
      const sag = Math.max(0, re - 1.5 * ds)
      const nCut = Math.round(o.cut * CRIMP.strands * Math.min(1, o.closed))
      for (let i = 0; i < CRIMP.strands; i++) {
        const a = ((i - 1) * Math.PI) / 3
        const [x, y] = i === 0 ? [0, 0] : [rho * Math.cos(a), rho * Math.sin(a)]
        const cutHere = i >= CRIMP.strands - nCut
        const m = squeezed ? hex[i] : round[i]
        ;(squeezed ? round[i] : hex[i]).visible = false
        m.visible = true
        m.material = cutHere ? cutM : copper
        const rad = squeezed ? (rho / Math.sqrt(3)) * 1.03 : ds / 2
        m.scale.set(rad, cutHere ? rad * 0.45 : rad, 0.3)
        m.position.set(x, y - (squeezed ? 0 : sag), 0)
      }
      ring.visible = !!o.onInsulation
      if (o.onInsulation) {
        insMat.color.set(o.onInsulation)
        ring.scale.setScalar(Math.min(re, (o.wireMm / 2) * 1.6))
      }
    },
  }
}

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
const PLUG_SHAPES: Record<ConnectorId, PlugShape> = {
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
