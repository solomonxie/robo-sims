// Print a robot: the Chassis design layout as one printed PLA plate (sketch, ribs, bosses), its slicing estimate and orientation,
// then inserts, screw lengths, the assembled balance and a test loop. Composes the earlier lessons' models (typical values).
import { G } from '../common'
import { PlateSketch, plateAreaMm2, sketchPoints } from '../materials/cad'
import { ChassisPart, chassisBalance, chassisLayout } from '../materials/chassis'
import { Contour } from '../materials/cutting'
import { METRIC_SCREWS, ironInstall, screwFor } from '../materials/fasteners'
import { MATERIALS, Rect } from '../materials/stress'
import { Ring, circleRing, layerStrength, scanSpans } from './design'
import { LINE_W, filamentArea } from './fdm'
import { BossOrient, INSERT_BOSS, insertBoss } from './functional'
import { PLA_G_MM3 } from './slicing'
import { shellBar } from './strength'

/** The layout built here (Chassis design defaults): battery under the plate 40 mm behind the axle, 110 mm wheelbase, IMU over the axle. */
export const ROBOT = { battX: -0.04, wheelbase: 0.11, ribH: 6, ribW: 1.8, bossWall: 2.4, holeDepth: INSERT_BOSS.len + 1.5, fillet: 12, skin: 0.8, impact: 10, pressN: 50, maxDefl: 1, speed: 60, firstSpeed: 25, layerS: 3, usdPerKg: 20 }
export const robotLayout = () => chassisLayout(ROBOT.battX, 'low', ROBOT.wheelbase, 'axle')
const PLATE = robotLayout().find((p) => p.key === 'plate')!
/** Plate outline (mm) and the robot x (mm) of the sketch origin. */
export const ROBOT_PLATE = { w: Math.round(PLATE.size[0] * 1000), h: Math.round(PLATE.size[1] * 1000), x0: PLATE.x * 1000 }

interface InsertHole {
  part: string
  x: number
  y: number
}
const at = (part: string, rx: number, ry: number): InsertHole => ({ part, x: rx * 1000 - ROBOT_PLATE.x0, y: ry * 1000 })
/** One M3 insert per screw, in sketch mm, grouped by the part it holds. */
export const INSERT_HOLES: readonly InsertHole[] = [
  ...[1, -1].flatMap((s) => [at('motors', -0.011, s * 0.043), at('motors', 0.011, s * 0.043)]),
  at('caster', -0.11, 0.011), at('caster', -0.11, -0.011),
  at('battery', ROBOT.battX - 0.031, 0), at('battery', ROBOT.battX + 0.031, 0),
  at('boards', 0.013, 0.03), at('boards', 0.027, 0.03),
  ...[1, -1].flatMap((sx) => [1, -1].map((sy) => at('boards', -0.075 + sx * 0.023, 0.025 + sy * 0.011))),
]
const WIRE_HOLE = { x: 0.03 * 1000 - ROBOT_PLATE.x0, y: 0, d: 14 }

export const RIB_SETS = { none: 'No ribs', edge: 'Two edge ribs', four: 'Edge + inner ribs' } as const
export type RibSet = keyof typeof RIB_SETS
const RIB_Y: Record<RibSet, number[]> = { none: [], edge: [-1, 1].map((s) => s * (ROBOT_PLATE.h / 2 - ROBOT.ribW / 2)), four: [-1, 1].flatMap((s) => [s * (ROBOT_PLATE.h / 2 - ROBOT.ribW / 2), s * 22]).sort((a, b) => a - b) }
export const ribYs = (r: RibSet) => RIB_Y[r]

/** The printed plate's sketch: outline, insert holes, wire hole. */
export function robotSketch(fillet = ROBOT.fillet): PlateSketch {
  const hole = (x: number, y: number, d: number): Contour => ({ shape: 'circle', cx: x, cy: y, w: d, h: d, hole: true })
  return {
    w: ROBOT_PLATE.w,
    h: ROBOT_PLATE.h,
    fillet,
    contours: [{ shape: 'rect', cx: 0, cy: 0, w: ROBOT_PLATE.w, h: ROBOT_PLATE.h, hole: false }, ...INSERT_HOLES.map((h) => hole(h.x, h.y, INSERT_BOSS.hole)), hole(WIRE_HOLE.x, WIRE_HOLE.y, WIRE_HOLE.d)],
    screw: METRIC_SCREWS.m3.name,
  }
}

/** Boss height above a `t` mm plate so the insert's blind hole is deep enough (0 when the plate already is). */
export const bossHeight = (t: number) => Math.max(0, ROBOT.holeDepth + 1 - t)
const bossOd = () => INSERT_BOSS.hole + 2 * ROBOT.bossWall

/** I (mm⁴) and farthest fibre c about the centroid of rects [x, yCentre, w, h]. */
function centroidSection(rects: readonly Rect[]) {
  const area = rects.reduce((a, [, , w, h]) => a + w * h, 0)
  const yc = rects.reduce((a, [, y, w, h]) => a + w * h * y, 0) / area
  const I = rects.reduce((a, [, y, w, h]) => a + (w * h ** 3) / 12 + w * h * (y - yc) ** 2, 0)
  const c = rects.reduce((m, [, y, , h]) => Math.max(m, Math.abs(y + h / 2 - yc), Math.abs(y - h / 2 - yc)), 0)
  return { area, yc, I, c }
}

/** The plate `t` mm thick with ribs, sliced with `skin` top/bottom (Strength `shellBar`), `walls` round every edge and `infill`: grams, and a hand press (`pressN`) at mid wheelbase, simply supported on axle and caster. */
export function robotPlate(t: number, ribs: RibSet, walls = 3, infill = 0.2) {
  const sk = robotSketch()
  const area = plateAreaMm2(sk)
  const f = shellBar(ROBOT.skin / LINE_W, infill, 'grid', { W: ROBOT_PLATE.h, H: t, L: ROBOT_PLATE.w })
  const perim = 2 * (ROBOT_PLATE.w + ROBOT_PLATE.h) - (8 - 2 * Math.PI) * ROBOT.fillet + INSERT_HOLES.length * Math.PI * INSERT_BOSS.hole + Math.PI * WIRE_HOLE.d
  const wallsMm3 = perim * walls * LINE_W * Math.max(0, t - 2 * f.t) * (1 - infill)
  const ribL = ROBOT_PLATE.w - 2 * ROBOT.fillet
  const ribsMm3 = RIB_Y[ribs].length * ROBOT.ribW * ROBOT.ribH * ribL
  const bh = bossHeight(t)
  const bossMm3 = INSERT_HOLES.length * (Math.PI / 4) * (bossOd() ** 2 - INSERT_BOSS.hole ** 2) * bh
  const mm3 = area * t * f.mass + wallsMm3 + ribsMm3 + bossMm3
  const grams = mm3 * PLA_G_MM3
  const rects: Rect[] = [[0, t / 2, ROBOT_PLATE.h * f.bend, t], ...RIB_Y[ribs].map((y): Rect => [y, t + ROBOT.ribH / 2, ROBOT.ribW, ROBOT.ribH])]
  const sec = centroidSection(rects)
  const kg = robotParts(grams).reduce((a, p) => a + p.kg, 0)
  const P = ROBOT.pressN
  const L = ROBOT.wheelbase * 1000
  const E = MATERIALS.pla.E / 1e6
  const deflMm = (P * L ** 3) / (48 * E * sec.I)
  const sigma = ((P * L) / 4) * (sec.c / sec.I) * 1e6
  return { sketch: sk, area, mm3, grams, bossH: bh, I: sec.I, deflMm, sigma, sf: MATERIALS.pla.utsPa / sigma, kg, loadN: P, perGram: 1 / (deflMm * grams) }
}

export const PLATE_T_SWEEP = Array.from({ length: 17 }, (_, i) => 2 + i * 0.25)
export const plateSweep = (ribs: RibSet) => PLATE_T_SWEEP.map((t) => robotPlate(t, ribs))

/** Layout with the printed plate's mass and 12 inserts + screws (about 1.2 g each) in place of the acrylic plate. */
export function robotParts(plateG: number): ChassisPart[] {
  return robotLayout().map((p) => (p.key === 'plate' ? { ...p, kg: (plateG + INSERT_HOLES.length * 1.2) / 1000 } : p))
}

// --- Slice and print ---

export const PRINT_ORIENTS = { flat: 'Flat, ribs and bosses up', side: 'On its long edge', end: 'Standing on its end' } as const
export type PrintOrient = keyof typeof PRINT_ORIENTS
/** Build height (mm), angle of the bending stress to the layers, which way the insert axes point, share of ribs/bosses that overhang. */
const ORIENT_GEOM: Record<PrintOrient, { up: (t: number, fh: number) => number; deg: number; boss: BossOrient; hang: number }> = {
  flat: { up: (t, fh) => t + fh, deg: 0, boss: 'vertical', hang: 0 },
  side: { up: () => ROBOT_PLATE.h, deg: 0, boss: 'horizontal', hang: 1 },
  end: { up: () => ROBOT_PLATE.w, deg: 90, boss: 'horizontal', hang: 1 },
}

/** Slicer estimate for the chassis: layers, grams, filament metres, hours, cost, supports, strength along the load, insert grip. */
export function robotJob(o: PrintOrient, t: number, ribs: RibSet, walls: number, infill: number, layerH: number) {
  const g = ORIENT_GEOM[o]
  const plate = robotPlate(t, ribs, walls, infill)
  const featureH = Math.max(RIB_Y[ribs].length ? ROBOT.ribH : 0, plate.bossH)
  const height = g.up(t, featureH)
  const layers = Math.ceil(height / layerH)
  const supportMm3 = g.hang * 0.15 * (INSERT_HOLES.length * bossOd() ** 2 * plate.bossH + RIB_Y[ribs].length * ROBOT.ribH * ROBOT.ribW * ROBOT_PLATE.w * 4)
  const mm3 = plate.mm3 + supportMm3
  const flow = ROBOT.speed * LINE_W * layerH
  const seconds = mm3 / flow + layers * ROBOT.layerS
  const grams = mm3 * PLA_G_MM3
  const strength = layerStrength(g.deg)
  const boss = insertBoss(INSERT_BOSS.hole, ROBOT.bossWall, ROBOT.holeDepth, g.boss)
  const firstLayerMm2 = o === 'flat' ? plate.area : o === 'side' ? ROBOT_PLATE.w * t : ROBOT_PLATE.h * t
  return { plate, height, layers, supportMm3, grams, metres: mm3 / filamentArea() / 1000, seconds, cost: (grams / 1000) * ROBOT.usdPerKg, strength, sf: plate.sf * strength, boss, firstLayerMm2, firstLayerS: firstLayerMm2 / (ROBOT.firstSpeed * LINE_W), flow }
}

export const INFILL_SWEEP_JOB = Array.from({ length: 13 }, (_, i) => 0.05 + i * 0.05)

/** Axis-aligned box (mm). */
interface PartBox {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
  kind: 'plate' | 'rib' | 'boss' | 'support'
}

/** The part as boxes in sketch coordinates (z up from the plate's bottom face): plate rows scanned every `row` mm, ribs, square bosses. */
export function robotBoxes(t: number, ribs: RibSet, row = 2.5): PartBox[] {
  const sk = robotSketch()
  const [outline, ...holes] = sk.contours
  const rings: Ring[] = [sketchPoints(outline, sk.fillet, 6).slice(0, -1), ...holes.map((h) => circleRing(h.cx, h.cy, h.w / 2, 16))]
  const out: PartBox[] = []
  for (let y = -ROBOT_PLATE.h / 2; y < ROBOT_PLATE.h / 2 - 1e-6; y += row)
    for (const [x0, x1] of scanSpans(rings, y + row / 2)) out.push({ x0, x1, y0: y, y1: y + row, z0: 0, z1: t, kind: 'plate' })
  const ribL = ROBOT_PLATE.w / 2 - ROBOT.fillet
  for (const y of RIB_Y[ribs]) out.push({ x0: -ribL, x1: ribL, y0: y - ROBOT.ribW / 2, y1: y + ROBOT.ribW / 2, z0: t, z1: t + ROBOT.ribH, kind: 'rib' })
  const bh = bossHeight(t)
  const r = bossOd() / 2
  const ri = INSERT_BOSS.hole / 2
  if (bh > 0)
    for (const h of INSERT_HOLES) {
      out.push({ x0: h.x - r, x1: h.x + r, y0: h.y - r, y1: h.y - ri, z0: t, z1: t + bh, kind: 'boss' })
      out.push({ x0: h.x - r, x1: h.x + r, y0: h.y + ri, y1: h.y + r, z0: t, z1: t + bh, kind: 'boss' })
      out.push({ x0: h.x - r, x1: h.x - ri, y0: h.y - ri, y1: h.y + ri, z0: t, z1: t + bh, kind: 'boss' })
      out.push({ x0: h.x + ri, x1: h.x + r, y0: h.y - ri, y1: h.y + ri, z0: t, z1: t + bh, kind: 'boss' })
    }
  return out
}

/** Boxes turned onto the bed for an orientation (bed x, y, z up from 0, centred in y), plus a support column under every rib or boss
 *  that has no plate under it. */
export function bedBoxes(boxes: readonly PartBox[], o: PrintOrient): PartBox[] {
  const turn = (b: PartBox): PartBox =>
    o === 'flat' ? b : o === 'side' ? { ...b, y0: -b.z1, y1: -b.z0, z0: b.y0 + ROBOT_PLATE.h / 2, z1: b.y1 + ROBOT_PLATE.h / 2 } : { ...b, x0: b.y0, x1: b.y1, y0: -b.z1, y1: -b.z0, z0: b.x0 + ROBOT_PLATE.w / 2, z1: b.x1 + ROBOT_PLATE.w / 2 }
  const turned = boxes.map(turn)
  const yMid = (Math.min(...turned.map((b) => b.y0)) + Math.max(...turned.map((b) => b.y1))) / 2
  const out = turned.map((b) => ({ ...b, y0: b.y0 - yMid, y1: b.y1 - yMid }))
  const plate = out.filter((b) => b.kind === 'plate')
  const under = (b: PartBox) => plate.some((q) => q.x0 < b.x1 && q.x1 > b.x0 && q.y0 < b.y1 && q.y1 > b.y0 && q.z1 <= b.z0 + 1e-6)
  const supports = out.filter((b) => b.kind !== 'plate' && b.z0 > 0.3 && !under(b)).map((b): PartBox => ({ ...b, z0: 0, z1: b.z0 - 0.2, kind: 'support' }))
  return [...out, ...supports]
}

/** What is printed once the nozzle has reached height `upTo`. */
export const printedBelow = (boxes: readonly PartBox[], upTo: number) => boxes.filter((b) => b.z0 < upTo).map((b) => ({ ...b, z1: Math.min(b.z1, upTo) }))

// --- Assemble with inserts ---

/** Parts in assembly order: screws, what the screw passes through (mm), the layout keys that drop in. */
export const ASSEMBLY = [
  { key: 'inserts', name: 'Press in the inserts', stack: 0, screws: 0, parts: [] as string[] },
  { key: 'motors', name: 'Motors and wheels', stack: 18.5, screws: 4, parts: ['motorL', 'motorR'] },
  { key: 'caster', name: 'Ball caster', stack: 2.5, screws: 2, parts: ['caster'] },
  { key: 'battery', name: 'Battery holder', stack: 1.5, screws: 2, parts: ['battery'] },
  { key: 'boards', name: 'Driver, ESP32, IMU', stack: 1.6, screws: 6, parts: ['driver', 'esp32', 'imu'] },
  { key: 'check', name: 'Balance check', stack: 0, screws: 0, parts: [] },
  { key: 'drive', name: 'Drive a loop', stack: 0, screws: 0, parts: [] },
] as const
export const MOTOR_SCREWS = [16, 20, 25, 30, 35] as const

/** An M3 screw `len` mm through `stack` mm into an insert in a blind hole: thread engaged, verdict, the stock length to use. */
export function insertScrew(stack: number, len: number, depth = ROBOT.holeDepth) {
  const engaged = len - stack
  const s = METRIC_SCREWS.m3
  const verdict = engaged < 1.5 * s.d ? 'short' : engaged > depth - 0.3 ? 'bottoms' : 'ok'
  return { engaged, verdict: verdict as 'short' | 'bottoms' | 'ok', best: screwFor('m3', 'cap', 'aluminium', stack).length ?? 0 }
}

/** Insert pull-out with the iron at `tempC` (Functional parts boss × Fasteners install fill) vs the load per motor insert. */
export function insertJoint(tempC: number, orient: BossOrient = 'vertical', plateG = 50) {
  const boss = insertBoss(INSERT_BOSS.hole, ROBOT.bossWall, ROBOT.holeDepth, orient)
  const iron = ironInstall(tempC)
  const force = (boss.force * iron.fill) / ironInstall(220).fill
  const kg = robotParts(plateG).reduce((a, p) => a + p.kg, 0)
  const perInsert = (ROBOT.impact * kg * G) / 4
  return { force, iron, perInsert, sf: force / perInsert }
}

/** Balance of the finished printed robot (Chassis design model). */
export const robotBalance = (plateG: number) => chassisBalance(robotParts(plateG), ROBOT.wheelbase)

/** Test loop: a stadium (m) with straights `straight` and turns of radius `r`, driven at `v`; pose at time `t`. */
export function testLoopPose(t: number, straight = 0.5, r = 0.18, v = 0.25) {
  const len = 2 * straight + 2 * Math.PI * r
  let s = (((t * v) % len) + len) % len
  const legs = [straight, Math.PI * r, straight, Math.PI * r]
  let i = 0
  while (s > legs[i] && i < 3) s -= legs[i++]
  const h = straight / 2
  if (i === 0) return { x: -h + s, y: -r, th: 0 }
  if (i === 2) return { x: h - s, y: r, th: Math.PI }
  const a = s / r
  const cx = i === 1 ? h : -h
  const base = i === 1 ? -Math.PI / 2 : Math.PI / 2
  return { x: cx + r * Math.cos(base + a), y: r * Math.sin(base + a), th: base + a + Math.PI / 2 }
}
