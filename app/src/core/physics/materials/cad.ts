// CAD basics: a parametric motor-mount sketch (constraints, DOF, extrude), assembly mates and interference, STL tessellation and mesh checks.
import { Contour } from './cutting'
import { METRIC_SCREWS } from './fasteners'

/** Stepper faces (mm, typical NEMA): square face, bolt spacing, pilot boss Ø, screw size. */
export const MOTOR_FACES = {
  nema14: { name: 'NEMA14', face: 35.2, bolt: 26, boss: 22, screw: 'm3' },
  nema17: { name: 'NEMA17', face: 42.3, bolt: 31, boss: 22, screw: 'm3' },
  nema23: { name: 'NEMA23', face: 57.2, bolt: 47.1, boss: 38.1, screw: 'm5' },
} as const
export type MotorFaceKey = keyof typeof MOTOR_FACES

/** Bracket sketch rules: margin round the motor face, boss clearance, solid PLA density (g/cm³). */
export const SKETCH = { margin: 6, bossClear: 0.5, pla: 1.24 }

export interface PlateSketch {
  w: number
  h: number
  fillet: number
  /** [0] outline, [1] boss hole, [2..5] screw holes. */
  contours: Contour[]
  screw: string
}

/** Motor-mount plate driven by one parameter, the motor: every size follows from it. */
export function bracketSketch(mk: MotorFaceKey, fillet: number): PlateSketch {
  const m = MOTOR_FACES[mk]
  const s = Math.round(m.face + 2 * SKETCH.margin)
  const c = m.bolt / 2
  const clear = METRIC_SCREWS[m.screw].clear
  const hole = (cx: number, cy: number): Contour => ({ shape: 'circle', cx, cy, w: clear, h: clear, hole: true })
  return {
    w: s,
    h: s,
    fillet: Math.min(fillet, Math.floor(s / 2 - c - clear)),
    contours: [
      { shape: 'rect', cx: 0, cy: 0, w: s, h: s, hole: false },
      { shape: 'circle', cx: 0, cy: 0, w: m.boss + SKETCH.bossClear, h: m.boss + SKETCH.bossClear, hole: true },
      hole(c, c),
      hole(-c, c),
      hole(-c, -c),
      hole(c, -c),
    ],
    screw: METRIC_SCREWS[m.screw].name,
  }
}

/** Closed outline points: a rect with corner fillets of radius r (`n` points per arc), or a circle. */
export function sketchPoints(c: Contour, r = 0, n = 8): [number, number][] {
  if (c.shape === 'circle') return Array.from({ length: 4 * n + 1 }, (_, i) => [c.cx + (c.w / 2) * Math.cos((i / (4 * n)) * 2 * Math.PI), c.cy + (c.w / 2) * Math.sin((i / (4 * n)) * 2 * Math.PI)])
  const [x, y] = [c.w / 2 - r, c.h / 2 - r]
  const pts: [number, number][] = []
  ;[[x, y], [-x, y], [-x, -y], [x, -y]].forEach(([ax, ay], q) => {
    for (let i = 0; i <= (r > 0 ? n : 0); i++) {
      const a = ((q + i / n) * Math.PI) / 2
      pts.push([c.cx + ax + r * Math.cos(a), c.cy + ay + r * Math.sin(a)])
    }
  })
  return [...pts, pts[0]]
}

export const plateAreaMm2 = (p: PlateSketch) =>
  p.w * p.h - (4 - Math.PI) * p.fillet ** 2 - p.contours.filter((c) => c.hole).reduce((a, c) => a + (Math.PI / 4) * c.w * c.w, 0)
/** Solid mass (g) of the plate extruded `t` mm. */
export const plateMassG = (p: PlateSketch, t: number, density = SKETCH.pla) => (plateAreaMm2(p) * t * density) / 1000

export type SketchEntity = 'outline' | 'boss' | 'holes'
/** Free DOF before any constraint: rectangle 4 (the tool adds horizontal/vertical), each circle 3 (x, y, r). */
export const ENTITY_DOF: Record<SketchEntity, number> = { outline: 4, boss: 3, holes: 12 }
/** Constraints in the order a designer adds them; `dim` = a driving dimension shown on the sketch. */
export const SKETCH_STEPS: readonly { name: string; on: SketchEntity; dof: number; dim?: 'w' | 'h' | 'boss' | 'hole' | 'bolt' }[] = [
  { name: 'corner on the origin', on: 'outline', dof: 2 },
  { name: 'width', on: 'outline', dof: 1, dim: 'w' },
  { name: 'height', on: 'outline', dof: 1, dim: 'h' },
  { name: 'boss hole centred', on: 'boss', dof: 2 },
  { name: 'boss diameter', on: 'boss', dof: 1, dim: 'boss' },
  { name: 'screw holes equal', on: 'holes', dof: 3 },
  { name: 'screw hole diameter', on: 'holes', dof: 1, dim: 'hole' },
  { name: 'holes mirrored about the centre lines', on: 'holes', dof: 6 },
  { name: 'hole spacing across', on: 'holes', dof: 1, dim: 'bolt' },
  { name: 'hole spacing up', on: 'holes', dof: 1 },
]
const DEPENDS: Record<SketchEntity, SketchEntity[]> = { outline: [], boss: ['outline'], holes: ['boss'] }

/** After the first `k` constraints: DOF left per entity and in total; an entity is fully constrained (black) once its own
 *  DOF are gone and what it hangs on is fixed. */
export function sketchStatus(k: number) {
  const done = SKETCH_STEPS.slice(0, Math.max(0, k))
  const left = { ...ENTITY_DOF }
  for (const s of done) left[s.on] -= s.dof
  const fixed = {} as Record<SketchEntity, boolean>
  for (const e of ['outline', 'boss', 'holes'] as SketchEntity[]) fixed[e] = left[e] === 0 && DEPENDS[e].every((d) => fixed[d])
  const total = Object.values(left).reduce((a, b) => a + b, 0)
  return { left, fixed, total, dims: done.flatMap((s) => (s.dim ? [s.dim] : [])), last: done.at(-1)?.name ?? '' }
}

// --- Assemblies: mates remove a part's 6 DOF; screw length vs the motor's tapped holes ---

export type Dof = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
export const ALL_DOF: readonly Dof[] = ['x', 'y', 'z', 'rx', 'ry', 'rz']
export type AsmPart = 'bracket' | 'motor' | 'wheel' | 'screws'
export const ASM_PARTS: readonly AsmPart[] = ['bracket', 'motor', 'wheel', 'screws']
/** Each part's own frame has z along its axis (motor shaft, wheel hub, screw). */
export const MATES: readonly { part: AsmPart; kind: string; what: string; removes: readonly Dof[] }[] = [
  { part: 'bracket', kind: 'fixed', what: 'bracket grounded', removes: ALL_DOF },
  { part: 'motor', kind: 'coincident', what: 'motor face on bracket face', removes: ['z', 'rx', 'ry'] },
  { part: 'motor', kind: 'concentric', what: 'motor boss in the boss hole', removes: ['x', 'y'] },
  { part: 'motor', kind: 'concentric', what: 'motor tap on a screw hole', removes: ['rz'] },
  { part: 'wheel', kind: 'concentric', what: 'wheel hub on the shaft', removes: ['x', 'y', 'rx', 'ry'] },
  { part: 'wheel', kind: 'coincident', what: 'hub face at the shaft end', removes: ['z'] },
  { part: 'wheel', kind: 'parallel', what: 'set screw onto the D-flat', removes: ['rz'] },
  { part: 'screws', kind: 'concentric', what: 'screws in the holes (x4 pattern)', removes: ['x', 'y', 'rx', 'ry'] },
  { part: 'screws', kind: 'coincident', what: 'screw heads on the bracket', removes: ['z'] },
]

/** Free DOF of every part after the first `k` mates. */
export function assemblyState(k: number) {
  const free = Object.fromEntries(ASM_PARTS.map((p) => [p, [...ALL_DOF]])) as Record<AsmPart, Dof[]>
  const placed = Object.fromEntries(ASM_PARTS.map((p) => [p, 0])) as Record<AsmPart, number>
  for (const m of MATES.slice(0, Math.max(0, k))) {
    free[m.part] = free[m.part].filter((d) => !m.removes.includes(d))
    placed[m.part]++
  }
  const total = ASM_PARTS.reduce((a, p) => a + free[p].length, 0)
  return { free, placed, total, last: k > 0 ? MATES[Math.min(k, MATES.length) - 1] : null }
}

/** NEMA17 front taps (typical): M3, 4.5 mm deep; at least 1·d of thread wanted in aluminium this short. */
export const MOTOR_TAP = { depth: 4.5, minEngage: 3, d: 3 }
export type ScrewFitVerdict = 'short' | 'ok' | 'collides'
/** Screw of length L through a plate t thick into the motor tap: engagement, interference depth and volume (mm³). */
export function screwFit(L: number, t: number, tap = MOTOR_TAP) {
  const engage = L - t
  const clash = Math.max(0, engage - tap.depth)
  const verdict: ScrewFitVerdict = clash > 0 ? 'collides' : engage < tap.minEngage ? 'short' : 'ok'
  return { engage, clash, clashMm3: (Math.PI / 4) * tap.d ** 2 * clash, verdict, ideal: t + tap.depth }
}

// --- Exporting STL: a smooth wheel tessellated into triangles ---

/** A 60 mm wheel, 10 mm wide, 5 mm bore. */
export const STL_WHEEL = { R: 30, r: 2.5, h: 10 }
export const STL_BYTES = { header: 84, perTri: 50, asciiPerTri: 250 }
export const INCH_MM = 25.4

/** Segments round a circle of radius R so the chord error stays under `tol` mm and adjacent normals within `angleDeg`. */
export const segmentsFor = (R: number, tol: number, angleDeg: number) =>
  Math.max(3, Math.ceil(Math.PI / Math.acos(1 - Math.min(1, tol / R)) - 1e-9), Math.ceil(360 / angleDeg - 1e-9))
/** Sagitta: largest gap between a chord and its arc. */
export const chordError = (R: number, n: number) => R * (1 - Math.cos(Math.PI / n))
/** A faceted hole (vertices on the circle) is narrowest across its flats. */
export const facetedHoleMm = (d: number, n: number) => d * Math.cos(Math.PI / n)
export const wheelTriangles = (nOut: number, nIn: number) => 4 * (nOut + nIn)
export const stlBytes = (tris: number) => STL_BYTES.header + STL_BYTES.perTri * tris

export type MeshDefect = 'none' | 'gap' | 'flipped'
type Tri = [number, number, number]

/** Wheel as a closed triangle mesh (outward winding): outer and bore walls plus annulus caps; `defect` drops or flips one cap triangle. */
export function tessellateWheel(nOut: number, nIn: number, defect: MeshDefect = 'none', { R, r, h } = STL_WHEEL) {
  const verts: [number, number, number][] = []
  const ring = (rad: number, n: number, z: number) => Array.from({ length: n }, (_, i) => verts.push([rad * Math.cos((2 * Math.PI * i) / n), rad * Math.sin((2 * Math.PI * i) / n), z]) - 1)
  const oT = ring(R, nOut, h / 2)
  const oB = ring(R, nOut, -h / 2)
  const iT = ring(r, nIn, h / 2)
  const iB = ring(r, nIn, -h / 2)
  const tris: Tri[] = []
  const wall = (top: number[], bot: number[], out: boolean) =>
    top.forEach((_, i) => {
      const j = (i + 1) % top.length
      if (out) tris.push([bot[i], bot[j], top[j]], [bot[i], top[j], top[i]])
      else tris.push([bot[i], top[j], bot[j]], [bot[i], top[i], top[j]])
    })
  wall(oT, oB, true)
  wall(iT, iB, false)
  const cap = (o: number[], inn: number[], up: boolean) => {
    let [i, j] = [0, 0]
    while (i < o.length || j < inn.length) {
      const ao = (i + 1) / o.length
      const ai = (j + 1) / inn.length
      const t: Tri = j >= inn.length || (i < o.length && ao <= ai) ? [o[i], o[++i % o.length], inn[j % inn.length]] : [o[i % o.length], inn[(j + 1) % inn.length], inn[j++ % inn.length]]
      tris.push(up ? t : [t[0], t[2], t[1]])
    }
  }
  cap(oT, iT, true)
  cap(oB, iB, false)
  const k = 2 * (nOut + nIn)
  if (defect === 'gap') tris.splice(k, 1)
  if (defect === 'flipped') tris[k] = [tris[k][0], tris[k][2], tris[k][1]]
  return { verts, tris, bad: defect === 'none' ? -1 : k }
}

/** Watertight = every edge shared by exactly two triangles; consistent normals = each shared edge run in opposite directions. */
export function meshCheck(verts: readonly (readonly number[])[], tris: readonly Tri[]) {
  const undirected = new Map<string, number>()
  const directed = new Set<string>()
  let flippedEdges = 0
  for (const t of tris)
    for (let e = 0; e < 3; e++) {
      const [a, b] = [t[e], t[(e + 1) % 3]]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      undirected.set(key, (undirected.get(key) ?? 0) + 1)
      if (directed.has(`${a},${b}`)) flippedEdges++
      directed.add(`${a},${b}`)
    }
  let open = 0
  let nonManifold = 0
  for (const c of undirected.values()) {
    if (c === 1) open++
    if (c > 2) nonManifold++
  }
  let vol = 0
  for (const [a, b, c] of tris) {
    const [p, q, s] = [verts[a], verts[b], verts[c]]
    vol += (p[0] * (q[1] * s[2] - q[2] * s[1]) - p[1] * (q[0] * s[2] - q[2] * s[0]) + p[2] * (q[0] * s[1] - q[1] * s[0])) / 6
  }
  const used = new Set(tris.flat()).size
  return { open, nonManifold, flippedEdges, watertight: open === 0 && nonManifold === 0, consistent: flippedEdges === 0, volume: vol, euler: used - undirected.size + tris.length }
}

/** Export lesson: segments, triangles, errors, file size, undersize bore and the size the slicer sees. */
export function stlView(tol: number, angleDeg: number, units: 'mm' | 'inch', defect: MeshDefect, w = STL_WHEEL) {
  const nOut = segmentsFor(w.R, tol, angleDeg)
  const nIn = segmentsFor(w.r, tol, angleDeg)
  const tris = wheelTriangles(nOut, nIn)
  const scale = units === 'inch' ? 1 / INCH_MM : 1
  return {
    nOut,
    nIn,
    tris,
    errOut: chordError(w.R, nOut),
    errIn: chordError(w.r, nIn),
    bore: facetedHoleMm(2 * w.r, nIn),
    bytes: stlBytes(tris),
    ascii: STL_BYTES.header + STL_BYTES.asciiPerTri * tris,
    seenMm: 2 * w.R * scale,
    scale,
    defect,
  }
}
