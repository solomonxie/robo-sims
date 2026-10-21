// Breadboard close-ups: any BreadboardSpec (rails split or not) tilted to face the camera, hole pitch = 1 inside the group.
// The metal strips under the holes light up per net (`bars`), parts and jumpers drop into named holes ('c12', 'top+3').
import * as THREE from 'three/webgpu'
import { BOARD_CLIP, BoardPart, BoardSolution, BreadboardSpec, boardXZ, busHoles, busOf, parseHole } from '../../core/physics'
import { BOARD, generateHoles } from '../../core/breadboard'
import { V3, add, box, cylinder, mat, mesh, tube } from '../../models/kit'
import { buildLed, buildResistor } from '../../models/passives'
import { buildJumper, buildLead } from '../../models/wire'
import { GREY, HEAT, HIGH_V, LOW_V, glowMat, potentialColor, setGlow } from './colors'
import { label } from './text'
import { emptyGroup } from './util'

/** Jumper colours by convention: + red, − black, signals yellow/blue/green. */
export const WIRE_COLORS = { plus: '#d4282b', minus: '#202226', signal: '#e8b021', blue: '#2a55c9', green: '#2f9e4f', white: '#e6e6e6', orange: '#f07a1a' }

/** Strip colour for a bus at `v` volts of `full`; null (floating) → grey. */
export const busTint = (v: number | null, full = 5) => (v === null ? GREY : `#${potentialColor(v / full).getHexString()}`)

/** Legend rows for strip tints. */
export const BUS_LEGEND = [
  { color: HIGH_V, label: 'Strip at + (5 V)', shape: 'dot' as const },
  { color: LOW_V, label: 'Strip at 0 V', shape: 'dot' as const },
  { color: GREY, label: 'Not joined to the supply', shape: 'dot' as const },
  { color: HEAT, label: 'Clip past its 1 A rating', shape: 'dot' as const },
]

/** Strip colours for every bus a part touches: live → by volts, floating → grey, a clip past its rating → `HEAT`. */
export function netTints(spec: BreadboardSpec, parts: BoardPart[], sol: BoardSolution, full = 5) {
  const out: Record<string, string> = {}
  parts.forEach((p, i) =>
    [p.a, p.b].forEach((h, j) => {
      const bus = busOf(spec, h)
      if (sol.clipA[i][j] > BOARD_CLIP.ratedA) out[bus] = HEAT
      else out[bus] ??= sol.live.has(bus) ? busTint(sol.busV[bus], full) : GREY
    }),
  )
  return out
}

const RAIL_LINE: [string, number, string][] = [
  ['top-', -10.3, '#2a55c9'],
  ['top+', -7.7, '#d4282b'],
  ['bottom+', 7.7, '#d4282b'],
  ['bottom-', 10.3, '#2a55c9'],
]

/** Flat label lying on the board (reads from +z, top up the board). */
function boardText(g: THREE.Object3D, s: string, at: V3, size: number, color = '#6f6a5c') {
  const m = add(g, label(s, { size, color, glow: false }), at)
  m.rotation.x = -Math.PI / 2
  m.castShadow = false
}

/** Breadboard at `at`, `k` scene units per hole pitch, tilted `tilt` rad toward the camera: body, grooves, rail lines
 *  (broken at a split), holes, column numbers every 5 and row letters. `xz(hole)` → local point; `bars({ bus: colour })`
 *  lights those metal strips (others off); `parts` is a group cleared by `clear()`; add parts with `jumper`, `wireFlat`,
 *  `led`, `resistor`, `dip`, `lead`. */
export function breadboardModel(parent: THREE.Object3D, spec: BreadboardSpec, at: V3, k: number, tilt = 1.15) {
  const g = add(parent, new THREE.Group(), at)
  g.rotation.x = tilt
  g.scale.setScalar(k)
  const w = spec.columns + 3
  box(g, [w, BOARD.height, BOARD.depth], mat('#f2efe6', { rough: 0.85 }), [0, -BOARD.height / 2, 0])
  const groove = mat('#d6d2c6', { rough: 0.9 })
  box(g, [w, 0.02, 1.4], groove, [0, 0.005, 0])
  for (const z of [-7.05, 7.05]) box(g, [w, 0.02, 0.35], groove, [0, 0.005, z])
  const half = (spec.columns + 1) / 2
  const segs: [number, number][] = spec.railBreak === null ? [[1, spec.columns]] : [[1, spec.railBreak - 1], [spec.railBreak + 1, spec.columns]]
  for (const [, z, color] of RAIL_LINE)
    for (const [c0, c1] of segs) box(g, [c1 - c0 + 0.6, 0.02, 0.14], mat(color), [(c0 + c1) / 2 - half, 0.008, z])

  const holes = generateHoles(spec.columns)
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), mat('#34343a', { rough: 1 }), holes.length)
  const m4 = new THREE.Matrix4()
  holes.forEach((h, i) => {
    const p = boardXZ(spec, h)
    inst.setMatrixAt(i, m4.makeTranslation(p.x, 0.02, p.z))
  })
  inst.receiveShadow = true
  g.add(inst)
  for (let c = 1; c <= spec.columns; c++) {
    if (c !== 1 && c % 5) continue
    for (const z of [-6.4, 6.4]) boardText(g, String(c), [c - half, 0.02, z], 0.6)
  }
  for (const r of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    const z = boardXZ(spec, { row: r, col: 1 }).z
    boardText(g, r, [-half - 0.9, 0.02, z], 0.6)
    boardText(g, r, [half + 0.9, 0.02, z], 0.6)
  }

  const xz = (hole: string) => boardXZ(spec, parseHole(hole))
  const point = (hole: string, y = 0): V3 => {
    const p = xz(hole)
    return [p.x, y, p.z]
  }
  const barMap = new Map<string, { mesh: THREE.Mesh; m: THREE.MeshStandardMaterial }>()
  const bar = (bus: string) => {
    if (!barMap.has(bus)) {
      const ps = busHoles(spec, bus).map((h) => boardXZ(spec, h))
      const [x0, x1] = [Math.min(...ps.map((p) => p.x)), Math.max(...ps.map((p) => p.x))]
      const [z0, z1] = [Math.min(...ps.map((p) => p.z)), Math.max(...ps.map((p) => p.z))]
      const m = glowMat(GREY, 0.6)
      const b = add(g, mesh(new THREE.BoxGeometry(x1 - x0 + 0.8, 0.02, z1 - z0 + 0.8), m), [(x0 + x1) / 2, 0.012, (z0 + z1) / 2])
      b.castShadow = false
      barMap.set(bus, { mesh: b, m })
    }
    return barMap.get(bus)!
  }

  const parts = add(g, new THREE.Group())
  const along = (o: THREE.Object3D, a: string, b: string) => {
    const [pa, pb] = [xz(a), xz(b)]
    add(parts, o, [(pa.x + pb.x) / 2, 0, (pa.z + pb.z) / 2])
    o.rotation.y = Math.atan2(-(pb.z - pa.z), pb.x - pa.x)
    return o
  }
  return {
    group: g,
    parts,
    xz,
    point,
    /** Light the strips under `colors` (bus → colour, glow ×`k`); every other strip goes dark. */
    bars(colors: Record<string, string>, glow = 0.6) {
      for (const [bus, b] of barMap) b.mesh.visible = bus in colors
      for (const [bus, c] of Object.entries(colors)) {
        const b = bar(bus)
        b.mesh.visible = true
        setGlow(b.m, c, glow)
      }
    },
    clear: () => emptyGroup(parts),
    /** Dupont jumper; `lift` raises the arc (pitches). */
    jumper: (a: string, b: string, color: string, lift = 0) => add(parts, buildJumper(xz(a), xz(b), color, lift)),
    /** Solid wire cut to length, lying on the board; `bulge` swings it sideways (pitches, +z). */
    wireFlat(a: string, b: string, color: string, bulge = 0) {
      const [pa, pb] = [xz(a), xz(b)]
      const y = 0.35
      const mid: V3 = [(pa.x + pb.x) / 2, y, (pa.z + pb.z) / 2 + bulge]
      const pts: V3[] = [[pa.x, -1.2, pa.z], [pa.x, y, pa.z], [pa.x + (mid[0] - pa.x) * 0.25, y, pa.z + bulge * 0.7], mid, [pb.x - (pb.x - mid[0]) * 0.25, y, pb.z + bulge * 0.7], [pb.x, y, pb.z], [pb.x, -1.2, pb.z]]
      const run = add(parts, new THREE.Group())
      tube(run, pts, 0.28, mat(color, { rough: 0.45 }))
      return run
    },
    /** 5 mm LED, anode in `a`; `setGlow(0…1)` on the returned group's userData. */
    led: (a: string, b: string, color: string) => along(buildLed(color), a, b),
    /** ¼ W resistor, legs four holes apart. */
    resistor: (a: string, b: string, ohms: number) => along(buildResistor(ohms), a, b),
    /** DIP-8 over its 8 pin holes (1–4, then 5–8 back); `glow(f)` lights the lid text. */
    dip(pins: string[], text: string) {
      const ps = pins.map(xz)
      const cx = ps.reduce((s, p) => s + p.x, 0) / 8
      const cz = ps.reduce((s, p) => s + p.z, 0) / 8
      const d = Math.abs(ps[0].z - ps[7].z)
      const chip = add(parts, new THREE.Group(), [cx, 0, cz])
      box(chip, [4, 0.9, d - 0.6], mat('#26272b', { rough: 0.6 }), [0, 0.9, 0])
      cylinder(chip, 0.35, 0.05, mat('#141518'), [-2, 1.36, 0], 'y', 14)
      for (const p of ps) {
        const legZ = p.z - cz
        box(chip, [0.3, 0.12, Math.abs(legZ) - (d - 0.6) / 2 + 0.2], mat('#c9ccd2', { metal: 0.4, rough: 0.35 }), [p.x - cx, 0.7, (Math.sign(legZ) * (Math.abs(legZ) + (d - 0.6) / 2)) / 2])
        box(chip, [0.3, 2.1, 0.12], mat('#c9ccd2', { metal: 0.4, rough: 0.35 }), [p.x - cx, -0.35, legZ])
      }
      const ink = glowMat('#cfd3da', 0.2)
      const t = add(chip, label(text, { size: 0.55, color: '#cfd3da' }), [0, 1.37, 0])
      t.rotation.x = -Math.PI / 2
      t.material = ink
      return { group: chip, glow: (f: number) => setGlow(ink, f > 0.5 ? '#5ce1a0' : '#cfd3da', 0.2 + f) }
    },
    /** Loose lead from a local point down into a hole. */
    lead: (from: V3, hole: string, color: string) => add(parts, buildLead(new THREE.Vector3(...from), xz(hole), color)),
  }
}
export type BreadboardModel = ReturnType<typeof breadboardModel>

/** Power module off the left end (USB by default): a box with a socket and red/black leads to `plus`/`minus`. */
export function usbModule(bb: BreadboardModel, plus: string, minus: string, at: V3, text = '5V USB') {
  const g = add(bb.parts, new THREE.Group(), at)
  box(g, [4.4, 1.6, 6], mat('#1d4fa0', { rough: 0.5 }), [0, 0.8, 0])
  box(g, [1.6, 1.1, 2.8], mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [-2.6, 1, 0])
  const t = add(g, label(text, { size: 0.7, color: '#e6e6e6' }), [0.4, 1.62, 0])
  t.rotation.x = -Math.PI / 2
  bb.lead([at[0] + 1.6, 1.8, at[2] - 1.5], plus, WIRE_COLORS.plus)
  bb.lead([at[0] + 1.6, 1.8, at[2] + 1.5], minus, WIRE_COLORS.minus)
  return g
}

/** Visible arc for a jumper `lengthPitch` long over a straight span `spanPitch`: L ≈ d + 8h²/(3d) → h, capped. */
export const arcFor = (lengthPitch: number, spanPitch: number, cap = 12) => Math.min(cap, Math.sqrt((3 * spanPitch * Math.max(0, lengthPitch - spanPitch)) / 8))
