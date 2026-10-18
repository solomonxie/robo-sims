import * as THREE from 'three/webgpu'
import {
  ASSEMBLY,
  CHASSIS,
  INFILL_SWEEP_JOB,
  INSERT_BOSS,
  INSERT_HOLES,
  METRIC_SCREWS,
  MOTOR_SCREWS,
  PLATE_T_SWEEP,
  PRINT_ORIENTS,
  PrintOrient,
  RIB_SETS,
  ROBOT,
  ROBOT_PLATE,
  RibSet,
  SCREW_HEADS,
  bedBoxes,
  bossHeight,
  insertJoint,
  insertScrew,
  plateSweep,
  printedBelow,
  ribYs,
  robotBalance,
  robotBoxes,
  robotJob,
  robotLayout,
  robotParts,
  robotPlate,
  robotSketch,
  sketchPoints,
  testLoopPose,
} from '../../core/physics'
import { celsiusText, fixedText, hoursText, mmFixed, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FILAMENT_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  addRod,
  chassisModel,
  comMarker,
  cursorBar,
  ease,
  fdmPrinter,
  glowDot,
  glowMat,
  heatSetInsert,
  liveLabel,
  memoBy,
  plateGeometry,
  printPlotStage,
  screwModel,
  sketchPen,
  sliceSlabs,
  statusHeader,
  storyClock,
  storySlider,
  stretchArrow,
  stretchRod,
  textRows,
  verdictTint,
  zUp,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const CAD_TINT = '#7fb2e6'
const SUPPORT_TINT = '#9aa0a8'
const RIB_COLORS: Record<RibSet, string> = { none: GREY, edge: POWER, four: B_FIELD }
const grams = (g: number) => `${Math.round(g)} g`

/** The printed chassis in sketch mm (z up from the plate's bottom): plate, insert bosses, ribs. `set(t, ribs, fillet, extrude 0…1, grow 0…1)`. */
function chassisPart(parent: THREE.Object3D, color: string) {
  const g = add(parent, new THREE.Group())
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  const dark = mat('#14161b', { rough: 0.9 })
  let plate: THREE.Mesh | null = null
  let built = ''
  const r = INSERT_BOSS.hole / 2 + ROBOT.bossWall
  const bosses = INSERT_HOLES.map((h) => ({ outer: cylinder(g, r, 1, m, [h.x, h.y, 0], 'z', 20), inner: cylinder(g, INSERT_BOSS.hole / 2, 1, dark, [h.x, h.y, 0], 'z', 12) }))
  const ribL = ROBOT_PLATE.w - 2 * ROBOT.fillet
  const ribs = [0, 1, 2, 3].map(() => box(g, [ribL, ROBOT.ribW, 1], m))
  return {
    group: g,
    material: m,
    set(t: number, rs: RibSet, fillet: number, extrude = 1, grow = 1) {
      const key = `${t} ${Math.round(fillet)}`
      if (key !== built) {
        built = key
        plate?.geometry.dispose()
        if (plate) g.remove(plate)
        plate = add(g, new THREE.Mesh(plateGeometry(robotSketch(Math.round(fillet)), 1, t), m))
        plate.castShadow = true
      }
      plate!.scale.z = Math.max(1e-3, extrude)
      plate!.visible = extrude > 0
      const top = t * extrude
      const bh = bossHeight(t) * grow
      for (const b of bosses) {
        b.outer.visible = b.inner.visible = bh > 0.05
        b.outer.scale.y = Math.max(1e-3, bh)
        b.inner.scale.y = Math.max(1e-3, bh + 0.2)
        b.outer.position.z = top + bh / 2
        b.inner.position.z = top + bh / 2
      }
      const ys = ribYs(rs)
      ribs.forEach((rb, i) => {
        rb.visible = i < ys.length && grow > 0.02
        if (!rb.visible) return
        rb.scale.z = ROBOT.ribH * grow
        rb.position.set(0, ys[i], top + (ROBOT.ribH * grow) / 2)
      })
      return top + Math.max(bh, ys.length ? ROBOT.ribH * grow : 0)
    },
  }
}

// --- Model the chassis: sketch from the layout, holes, extrude, bosses and ribs, fillets, then flex and grams. ---

const MC = { k: 0.084, at: [-7.9, -6.9, 0] as V3, tilt: 0.85, yaw: -0.3, yMax: 3 }
const MC_STEPS = ['Sketch the outline', 'Insert holes', 'Extrude', 'Bosses and ribs', 'Fillet the corners', 'Check and export']
const MC_SECS = [3.5, 3.5, 2.5, 3, 2.5, 4.5]
const MC_ROWS = [
  'Outline from the Chassis design layout: 185 × 110 mm',
  `${INSERT_HOLES.length} holes of ${INSERT_BOSS.hole} mm for M3 inserts + a wire hole`,
  'Extrude to thickness: the plate will print flat',
  'Bosses deepen the insert holes; ribs stiffen the plate',
  `${ROBOT.fillet} mm corner fillets: nothing sharp to lift or snag`,
  'Check flex and grams, then export an STL',
]
const mcParams = (p: Params) => ({ t: n(p, 't'), ribs: pick(RIB_SETS, p.ribs, 'edge') as RibSet })
const mcRun = memoBy(
  (p: Params) => `${p.t} ${p.ribs}`,
  (p: Params) => {
    const q = mcParams(p)
    return { q, P: robotPlate(q.t, q.ribs) }
  },
)
const flexTone = (d: number) => toneOf(d <= ROBOT.maxDefl, d <= 2 * ROBOT.maxDefl)
const rectPts = (cx: number, cy: number, w: number, h: number): [number, number][] => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]]

export const printARobotModelTheChassis: Lesson = {
  id: 'print-a-robot-model-the-chassis',
  title: 'Model the chassis',
  tagline: 'The Chassis design layout as one printable plate',
  formula: (p) => {
    const { q, P } = mcRun(p)
    return `flex δ = F·L³ / (48·E·I) = ${ROBOT.pressN} N × ${ROBOT.wheelbase * 1000}³ mm³ / (48 × 3500 MPa × ${Math.round(P.I)} mm⁴) = ${mmFixed(P.deflMm, 2)} · σ = F·L/4 · c/I = ${fixedText(P.sigma / 1e6, 1)} MPa → SF ${fixedText(P.sf, 1)} · bosses ${mmFixed(P.bossH, 1)} = ${mmFixed(ROBOT.holeDepth, 1)} hole + 1 mm floor − ${mmFixed(q.t, 1)} plate · typical PLA`
  },
  legend: [
    { color: GREY, label: 'Flat plate, no ribs', shape: 'dot' },
    { color: POWER, label: 'Two edge ribs', shape: 'dot' },
    { color: B_FIELD, label: 'Edge + inner ribs', shape: 'dot' },
    { color: HEAT, label: `Flex limit ${ROBOT.maxDefl} mm (wheels stay aligned)`, shape: 'dot' },
  ],
  points: [
    'The capstone of 3D printing: print the robot from Materials > Chassis design. Nothing new to learn here, just every earlier lesson in order. Start from the layout (Layout and balance): the plate must carry two TT motors at the axle, the 2 × 18650 holder under the plate behind it, the caster 110 mm back, the driver and ESP32 on top.',
    'Model it the CAD basics way: one fully constrained sketch driven by the layout (185 × 110 mm here), then features. Each part gets M3 heat-set insert holes of 4.0 mm (Functional parts > Heat-set inserts), plus a hole for the motor wires. Extrude to thickness. The insert needs a 7.2 mm deep hole, so bosses lift the holes above a thin plate instead of making the whole plate thick.',
    'Fillet the corners (Design for printing > Chamfers vs fillets): a round corner lifts less on the bed and does not snag. Keep every feature pointing up from the bed face so the plate prints flat with no supports (next lesson).',
    'Check before printing: press 50 N on the middle (a firm hand) with the plate resting on axle and caster. Flex grows with 1/t³, so thickness is costly; two 6 mm ribs on the edges move plastic away from the middle and beat a thicker plate for fewer grams (the I-beam idea from Stress and strain, the walls idea from Strength > Wall count vs infill). Export an STL (CAD basics > Exporting STL) for the slicer.',
  ],
  controls: [
    storySlider(MC_STEPS),
    { kind: 'slider', key: 't', label: 'Plate thickness', min: 2, max: 6, step: 0.25, initial: 3, format: (v) => mmFixed(v, 2) },
    { kind: 'choice', key: 'ribs', options: opts(RIB_SETS), initial: 'edge' },
  ],
  build(): Stage {
        const ribKeys = Object.keys(RIB_SETS) as RibSet[]
    const { scene, head, rows, plot, yTop, tally } = printPlotStage(`Flex under a ${ROBOT.pressN} N press vs thickness`, `${PLATE_T_SWEEP[0]} mm`, `${PLATE_T_SWEEP[PLATE_T_SWEEP.length - 1]} mm`, {
      title: 'Grams at this thickness',
      names: ribKeys.map((r) => RIB_SETS[r]),
    })
    const { k } = MC
    const base = add(scene, new THREE.Group(), MC.at)
    base.rotation.set(MC.tilt, MC.yaw, 0)
    box(base, [205 * k, 0.2, 130 * k], mat('#262a31', { rough: 0.7 }), [0, -0.12, 0])
    const cad = add(base, new THREE.Group())
    cad.rotation.x = -Math.PI / 2
    cad.scale.setScalar(k)
    const part = chassisPart(cad, CAD_TINT)
    const penG = add(cad, new THREE.Group())
    const pen = sketchPen(penG, 0.75)
    const ghost = sketchPen(cad, 0.4)
    const press = stretchArrow(cad, HIGH_V, 1.4)
    const axle = addRod(cad, glowMat(RING, 0.9))
    const caster = glowDot(cad, 3, RING)
    const at = (x: number, y: number, z: number): V3 => [x * k, z * k, -y * k]
    const dimW = liveLabel(base, at(0, -ROBOT_PLATE.h / 2 - 12, 0), { size: 0.34, color: LABEL })
    const dimH = liveLabel(base, at(ROBOT_PLATE.w / 2 + 6, 0, 0), { size: 0.34, color: LABEL, align: 'left' })
    const tag = liveLabel(base, [0, 0, 0], { size: 0.36, align: 'left' })
    const footprints = robotLayout()
      .filter((q) => !['plate', 'imu'].includes(q.key))
      .map((q) => ({ pts: rectPts(q.x * 1000 - ROBOT_PLATE.x0, q.y * 1000, q.size[0] * 1000, q.size[1] * 1000), color: GREY }))
    const sketch0 = robotSketch(0)
    const holes = sketch0.contours.slice(1).map((c) => sketchPoints(c, 0, 4))

    const sweeps = ribKeys.map((r) => ({ r, pts: plateSweep(r).map((v) => v.deflMm) }))
    const S = plot.s
    const py = (v: number) => (Math.min(v, MC.yMax) / MC.yMax) * plot.h - plot.h / 2
    const us = PLATE_T_SWEEP.map((_, i) => i / (PLATE_T_SWEEP.length - 1))
    const traces = sweeps.map((s) => ({ ...s, tr: S.trace(RIB_COLORS[s.r], { samples: PLATE_T_SWEEP.length, radius: 0.06 }) }))
    traces.forEach((t) => t.tr.points(us, t.pts.map(py), null))
    const limit = S.level(HEAT)
    limit.set(py(ROBOT.maxDefl))
    const cur = cursorBar(S, RING, 0.06)
    const dot = glowDot(S.group, 0.22, RING)
    yTop.set(`${MC.yMax} mm`)
    const clock = storyClock(MC_SECS)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, P } = mcRun(p)
        clock.frame(dt, n(p, 'step'))
        const s = clock.step
        const u = clock.t
        const fillet = s < 4 ? 0 : s === 4 ? ROBOT.fillet * ease(u) : ROBOT.fillet
        const extrude = s < 2 ? 0 : s === 2 ? ease(u) : 1
        const grow = s < 3 ? 0 : s === 3 ? ease(u) : 1
        const top = part.set(q.t, q.ribs, fillet, extrude, grow)
        const outline = sketchPoints(sketch0.contours[0], fillet, 6)
        const drawn = s === 0 ? outline.slice(0, Math.max(2, Math.ceil(u * outline.length))) : outline
        const holeN = s < 1 ? 0 : s === 1 ? Math.ceil(u * holes.length) : holes.length
        const showPen = s <= 1 || s === 4
        penG.visible = showPen
        penG.position.z = s >= 2 ? q.t + 0.3 : 0
        pen.draw(showPen ? [{ pts: drawn, color: s === 0 ? '#4da3ff' : '#f2f2f2' }, ...holes.slice(0, holeN).map((h) => ({ pts: h, color: '#f2f2f2' }))] : [])
        ghost.draw(s <= 1 ? footprints : [])
        const tone = flexTone(P.deflMm)
        part.material.color.set(s === 5 ? (tone === 'ok' ? POWER : tone === 'warn' ? HEAT : HIGH_V) : CAD_TINT)
        const xm = -ROBOT.wheelbase * 500 - ROBOT_PLATE.x0
        const check = s === 5
        press(check ? [xm, 0, top + 40] : [xm, 0, -500], check ? [xm, 0, q.t + 1] : [xm, 0, -499])
        stretchRod(axle, [-ROBOT_PLATE.x0, -ROBOT_PLATE.h / 2 - 6, -1], [-ROBOT_PLATE.x0, ROBOT_PLATE.h / 2 + 6, -1], 1)
        axle.visible = caster.visible = check
        caster.position.set(-ROBOT.wheelbase * 1000 - ROBOT_PLATE.x0, 0, -2)
        dimW.set(s <= 1 ? `${ROBOT_PLATE.w} mm` : '')
        dimH.set(s <= 1 ? `${ROBOT_PLATE.h} mm` : '')
        tag.group.position.set(...at(xm - 30, -ROBOT_PLATE.h / 2 - 8, top + 26))
        tag.set(check ? `${ROBOT.pressN} N: flex ${mmFixed(P.deflMm, 2)}` : s === 2 ? `t = ${mmFixed(q.t, 2)}` : s === 3 && P.bossH > 0 ? `bosses ${mmFixed(P.bossH, 1)}` : '', check ? verdictTint(tone === 'ok', tone === 'warn') : LABEL)
        const tu = (q.t - PLATE_T_SWEEP[0]) / (PLATE_T_SWEEP[PLATE_T_SWEEP.length - 1] - PLATE_T_SWEEP[0])
        cur(tu)
        dot.position.set(S.xAt(tu), py(P.deflMm), 0.4)
        plot.right.set(`${mmFixed(q.t, 2)}: ${mmFixed(P.deflMm, 2)}`, RING)
        const gs = ribKeys.map((r) => robotPlate(q.t, r).grams)
        tally?.set(gs, gs.map(grams), ribKeys.map((r) => (r === q.ribs ? RING : RIB_COLORS[r])), 100)
        rows[0].set(`${s + 1}. ${MC_ROWS[s]}`, LABEL)
        rows[1].set(`${grams(P.grams)} · flex ${mmFixed(P.deflMm, 2)} · SF ${fixedText(P.sf, 1)} (typical)`, verdictTint(tone === 'ok' && P.sf >= 2, tone !== 'bad'))
        rows[2].set(P.bossH > 0 ? `Bosses ${mmFixed(P.bossH, 1)} tall give ${mmFixed(ROBOT.holeDepth, 1)} deep insert holes` : 'Plate deep enough for the inserts: no bosses', P.bossH > 0 ? LABEL : HEAT)
        head.status.set(`Chassis plate in CAD · ${RIB_SETS[q.ribs].toLowerCase()}`)
        head.sub.set(`Step ${s + 1} of ${MC_STEPS.length}: ${MC_STEPS[s]} · PLA, ${ROBOT.wheelbase * 1000} mm wheelbase`, GREY)
        head.event.set(check ? (tone === 'ok' ? 'Stiff enough: export the STL' : tone === 'warn' ? 'Bends a little: add ribs or thickness' : 'Floppy: wheels toe in under load') : '', verdictTint(tone === 'ok', tone === 'warn'))
      },
      readouts: (p) => {
        const { P } = mcRun(p)
        return [
          { label: 'Plate', value: grams(P.grams), tone: toneOf(P.grams < 80, P.grams < 100) },
          { label: 'Flex at 50 N', value: mmFixed(P.deflMm, 2), tone: flexTone(P.deflMm) },
          { label: 'Safety factor', value: fixedText(P.sf, 1), tone: toneOf(P.sf >= 3, P.sf >= 2) },
        ]
      },
    }
  },
}

// --- Slice and print: orientation, walls, infill, layer height → time, grams, cost, strength; the plate printing layer by layer. ---

const PRINT_T = 3
const PRINT_RIBS: RibSet = 'edge'
const LAYERS = { '0.12': 'Layer 0.12 mm (fine)', '0.2': 'Layer 0.2 mm (standard)', '0.28': 'Layer 0.28 mm (draft)' }
const ORIENT_SHORT: Record<PrintOrient, string> = { flat: 'flat', side: 'on its edge', end: 'standing' }
const SP = { k: 0.036, at: [-10.2, -10.9, 0] as V3, loop: 14, rest: 2.5 }
const spParams = (p: Params) => ({ o: pick(PRINT_ORIENTS, p.o, 'flat') as PrintOrient, walls: n(p, 'walls'), infill: n(p, 'infill') / 100, h: Number(pick(LAYERS, p.layer, '0.2')) })
const spKey = (p: Params) => `${p.o} ${p.walls} ${p.infill} ${p.layer}`
const spRun = memoBy(spKey, (p: Params) => {
  const q = spParams(p)
  const job = robotJob(q.o, PRINT_T, PRINT_RIBS, q.walls, q.infill, q.h)
  const curve = INFILL_SWEEP_JOB.map((d) => robotJob(q.o, PRINT_T, PRINT_RIBS, q.walls, d, q.h).seconds / 3600)
  return { q, job, curve, boxes: bedBoxes(robotBoxes(PRINT_T, PRINT_RIBS), q.o) }
})
const orientRow = (o: PrintOrient, job: ReturnType<typeof robotJob>): [string, string] =>
  o === 'flat'
    ? ['Flat: no supports, inserts along Z, load along the layers', POWER]
    : o === 'side'
      ? [`On edge: ${grams(job.supportMm3 * 1.24e-3)} of supports, inserts across the layers`, HEAT]
      : [`Standing: load across the layers, ${pct(job.strength)} strength`, HIGH_V]

export const printARobotSliceAndPrint: Lesson = {
  id: 'print-a-robot-slice-and-print',
  title: 'Slice and print',
  tagline: 'Orientation, walls and infill for this part, then a time-lapse',
  formula: (p) => {
    const { q, job } = spRun(p)
    return `time ≈ volume / flow + layers × ${ROBOT.layerS} s = ${Math.round(job.grams / 1.24e-3 / 1000)} cm³ / (${ROBOT.speed} mm/s × ${0.45} × ${q.h} mm = ${fixedText(job.flow, 1)} mm³/s) + ${job.layers} × ${ROBOT.layerS} s = ${hoursText(job.seconds / 3600)} · ${grams(job.grams)} × $${ROBOT.usdPerKg}/kg = $${fixedText(job.cost, 2)} · SF ${fixedText(job.plate.sf, 1)} × layers ${fixedText(job.strength, 2)} · typical`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Printed so far (the chassis plate)', shape: 'dot' },
    { color: SUPPORT_TINT, label: 'Support under ribs and bosses', shape: 'dot' },
    { color: POWER, label: 'Print time vs infill, this setup', shape: 'dot' },
    { color: RING, label: 'Your infill', shape: 'dot' },
  ],
  points: [
    'The STL from the last lesson goes into the slicer (Slicing). First the orientation (Design for printing > Orientation and strength): flat on the bed with ribs and bosses up gives the fewest layers, a big first layer that sticks, no supports, inserts pressed along Z into bosses whose layers hug them, and the bending load running along the layers.',
    'Turn it on its edge and it needs supports under every rib and boss, prints hundreds of thin layers, and the inserts go in across the layers, where a boss splits. Standing on its end also puts the bending across the layer welds (Strength > Layer adhesion): about half the strength.',
    'Settings for this part: 3 to 4 walls, because the bending stress sits in the skin and the walls round the holes hold the inserts (Wall count vs infill); 15 to 25 % infill is plenty for a plate. A 0.2 mm layer is the usual trade; 0.28 mm saves time on a part nobody looks at closely. The slicer then estimates time, grams and cost.',
    'Watch the first layer (Bed adhesion > Z offset): lines squished flat and touching, corners stuck. Then let it run; with PLA on a clean bed the plate comes off flat. Next: press in the inserts and build the car.',
  ],
  controls: [
    { kind: 'choice', key: 'o', options: opts(PRINT_ORIENTS), initial: 'flat' },
    { kind: 'slider', key: 'walls', label: 'Walls', min: 2, max: 6, step: 1, initial: 3, format: (v) => `${v} walls` },
    { kind: 'slider', key: 'infill', label: 'Infill', min: 5, max: 60, step: 5, initial: 20, format: (v) => `${v} %` },
    { kind: 'choice', key: 'layer', options: opts(LAYERS), initial: '0.2' },
  ],
  build(): Stage {
        const lo = INFILL_SWEEP_JOB[0]
    const hi = INFILL_SWEEP_JOB[INFILL_SWEEP_JOB.length - 1]
    const { scene, head, rows, plot, yTop } = printPlotStage('Print time vs infill (typical)', pct(lo), pct(hi))
    const holder = add(scene, new THREE.Group(), SP.at)
    holder.rotation.set(0.62, 0.45, 0)
    const pr = fdmPrinter(holder, [0, 0, 0], SP.k)
    pr.parts.spool.visible = false
    const slabs = sliceSlabs(pr.bed, [0, 0, 0], SP.k, 400)
    const S = plot.s
    const tr = S.trace(POWER, { samples: INFILL_SWEEP_JOB.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const dot = glowDot(S.group, 0.22, RING)
    const us = INFILL_SWEEP_JOB.map((_, i) => i / (INFILL_SWEEP_JOB.length - 1))
    const st = { key: '', t: 0, e: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, job, curve, boxes } = spRun(p)
        if (st.key !== spKey(p)) Object.assign(st, { key: spKey(p), t: 0 })
        st.t = (st.t + dt) % (SP.loop + SP.rest)
        const f = Math.min(1, st.t / SP.loop)
        const hNow = f * job.height
        const done = printedBelow(boxes, hNow)
        slabs.set(done.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.z0, y1: b.z1, z0: -b.y1, z1: -b.y0, color: b.kind === 'support' ? SUPPORT_TINT : FILAMENT_COLOR })))
        const xs = boxes.map((b) => [b.x0, b.x1]).flat()
        const ys = boxes.map((b) => [b.y0, b.y1]).flat()
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const lap = (f * Math.min(job.layers, 40)) % 1
        const per = 2 * (x1 - x0 + y1 - y0)
        let d = lap * per
        let nx = x0
        let ny = y0
        if (d < x1 - x0) nx = x0 + d
        else if ((d -= x1 - x0) < y1 - y0) [nx, ny] = [x1, y0 + d]
        else if ((d -= y1 - y0) < x1 - x0) [nx, ny] = [x1 - d, y1]
        else [nx, ny] = [x0, y1 - (d - (x1 - x0))]
        if (f < 1) st.e += dt * 3
        pr.set(f < 1 ? nx : 0, f < 1 ? ny : 0, f < 1 ? hNow : job.height + 30, st.e)
        pr.heat(0.7, f < 1 ? 0.9 : 0.3)
        const maxH = Math.max(...curve) * 1.15
        const py = (v: number) => (v / maxH) * plot.h - plot.h / 2
        tr.points(us, curve.map(py), null)
        const iu = (q.infill - lo) / (hi - lo)
        cur(iu)
        dot.position.set(S.xAt(iu), py(job.seconds / 3600), 0.4)
        yTop.set(hoursText(maxH))
        plot.right.set(`${pct(q.infill)}: ${hoursText(job.seconds / 3600)}`, RING)
        const [ot, oc] = orientRow(q.o, job)
        rows[0].set(ot, oc)
        rows[1].set(`${job.layers} layers of ${q.h} mm · ${grams(job.grams)} · ${fixedText(job.metres, 1)} m of filament`, LABEL)
        rows[2].set(`First layer: ${Math.round(job.firstLayerMm2 / 100)} cm² on the bed, ${hoursText(job.firstLayerS / 3600)}: check the squish`, f * job.height < q.h * 2 ? RING : GREY)
        head.status.set(`Printing the chassis · ${ORIENT_SHORT[q.o]}`)
        head.sub.set(`${hoursText((f * job.seconds) / 3600)} of ${hoursText(job.seconds / 3600)} · shown ${Math.round(job.seconds / SP.loop)}× faster`, GREY)
        head.event.set(f >= 1 ? 'Done: let the bed cool, the plate pops off flat' : hNow < q.h * 2 ? 'First layer: watch it squish and stick' : `Layer ${Math.ceil(hNow / q.h)} of ${job.layers}`, f >= 1 ? POWER : hNow < q.h * 2 ? RING : LABEL)
      },
      readouts: (p) => {
        const { job } = spRun(p)
        return [
          { label: 'Print time', value: hoursText(job.seconds / 3600), tone: toneOf(job.seconds < 4 * 3600, job.seconds < 7 * 3600) },
          { label: 'Filament', value: grams(job.grams), tone: 'ok' },
          { label: 'Cost', value: `$${fixedText(job.cost, 2)}`, tone: 'ok' },
          { label: 'Safety factor', value: fixedText(job.sf, 1), tone: toneOf(job.sf >= 3, job.sf >= 2) },
        ]
      },
    }
  },
}

// --- Assemble with inserts: press inserts, bolt on motors, caster, battery and boards, check balance, drive a loop. ---

const AS = { k: 72, at: [-6.6, -7.4, 0] as V3, tilt: 0.72, yaw: -0.5, drop: 0.07, zoom: 0.42 }
const BOARD_LIFT = (PRINT_T + bossHeight(PRINT_T)) / 1000
const AS_STEPS = ASSEMBLY.map((a) => a.name)
const AS_SECS = [5, 3, 2.5, 2.5, 3, 3.5, 8]
const SC = { k: 0.19, x: 8.6, top: -1.8 }
const MOTOR_STACK = ASSEMBLY[1].stack
const SCREW_OPTS = Object.fromEntries(MOTOR_SCREWS.map((l) => [`${l}`, `Motor screws M3 × ${l}`])) as Record<string, string>
const asParams = (p: Params) => ({ temp: n(p, 'temp'), len: Number(pick(SCREW_OPTS, p.screw, '25')) })
const PLATE_G = robotPlate(PRINT_T, PRINT_RIBS).grams
const asRun = memoBy(
  (p: Params) => `${p.temp} ${p.screw}`,
  (p: Params) => {
    const q = asParams(p)
    const joint = insertJoint(q.temp, 'vertical', PLATE_G)
    const motor = insertScrew(MOTOR_STACK, q.len)
    const others = ASSEMBLY.slice(2, 5).map((a) => ({ a, s: insertScrew(a.stack, insertScrew(a.stack, 0).best) }))
    return { q, joint, motor, others, B: robotBalance(PLATE_G) }
  },
)
const screwTone = (v: 'short' | 'bottoms' | 'ok') => (v === 'ok' ? POWER : HIGH_V)
const SCREW_WORD = { ok: 'ok', short: 'too short: strips the insert', bottoms: 'bottoms out: lifts the part' }

export const printARobotAssembleWithInserts: Lesson = {
  id: 'print-a-robot-assemble-with-inserts',
  title: 'Assemble with inserts',
  tagline: 'Inserts, screws, parts, a balance check and a test drive',
  formula: (p) => {
    const { q, joint, motor } = asRun(p)
    return `screw = stack + thread in the insert: ${MOTOR_STACK} + ${fixedText(motor.engaged, 1)} = ${q.len} mm (needs ≥ 1.5·d = 4.5 mm and < ${fixedText(ROBOT.holeDepth, 1)} mm hole) → use M3 × ${motor.best} · insert ${Math.round(joint.force)} N (boss × iron fill ${pct(joint.iron.fill)}) vs ${fixedText(joint.perInsert, 1)} N per motor insert in a ${ROBOT.impact} g drop: SF ${fixedText(joint.sf, 0)} · typical`
  },
  legend: [
    { color: HEAT, label: 'Iron pressing an insert', shape: 'dot' },
    { color: RING, label: 'Support triangle: wheels + caster', shape: 'dot' },
    { color: POWER, label: 'Screw length ok', shape: 'dot' },
    { color: HIGH_V, label: 'Too short or bottoms out', shape: 'dot' },
  ],
  points: [
    'The printed plate becomes a robot. First the inserts (Materials > Fasteners > Heat-set inserts): the iron at about 220 °C, press each one straight down into its boss until flush. Too cold and the plastic never flows into the knurls; too hot and it oozes and the insert tilts.',
    'Then bolt the parts on, heavy first: TT motors and wheels, the caster, the battery holder, then the driver, ESP32 and IMU. Brass threads take the screws over and over, which plain plastic threads would not (Functional parts).',
    'Screw length = what it passes through + thread in the insert (Fasteners > Choosing a screw). Through an 18.5 mm motor body an M3 × 20 grabs one turn and strips; an M3 × 30 hits the bottom of the 7.2 mm hole and lifts the motor off the plate. M3 × 25 is right.',
    'Final checks from Chassis design: the centre of mass sits inside the wheel-caster triangle with most of the weight on the drive wheels, the screws are tight, the wheels spin free. Then drive a loop. Wiring and code are the Practice > Robo-car project: Wire the motor driver, Drive with ESP32.',
  ],
  controls: [
    storySlider(AS_STEPS),
    { kind: 'slider', key: 'temp', label: 'Iron temperature', min: 150, max: 280, step: 10, initial: 220, format: (v) => celsiusText(v) },
    { kind: 'choice', key: 'screw', options: opts(SCREW_OPTS), initial: '25' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rows = textRows(scene, 4, 2.4, 3.6, 0.28, 0.62)
    const world = zUp(scene, AS.at, AS.k, AS.tilt, AS.yaw)
    box(world, [1.6, 1, 0.004], mat('#22252c', { rough: 0.9 }), [0, 0, -0.002])
    const robot = add(world, new THREE.Group())
    const model = chassisModel(robot, robotParts(PLATE_G), 1, { plate: false })
    const plateG = add(robot, new THREE.Group(), [ROBOT_PLATE.x0 / 1000, 0, CHASSIS.plateZ + 0.003])
    plateG.scale.setScalar(0.001)
    const part = chassisPart(plateG, FILAMENT_COLOR)
    const partTop = part.set(PRINT_T, PRINT_RIBS, ROBOT.fillet)
    const bossTop = PRINT_T + bossHeight(PRINT_T)
    const inserts = INSERT_HOLES.map((h) => {
      const ins = heatSetInsert(plateG, INSERT_BOSS.od, INSERT_BOSS.len, 1, [h.x, h.y, bossTop])
      ins.group.rotation.x = Math.PI / 2
      return ins
    })
    const iron = addRod(plateG, glowMat(HEAT, 1))
    const tri = [0, 1, 2].map(() => addRod(robot, glowMat(RING, 0.9)))
    const com = comMarker(robot, 0.012)
    const track = Array.from({ length: 48 }, () => addRod(world, glowMat(B_FIELD, 0.5)))
    const loopPts = Array.from({ length: 49 }, (_, i) => testLoopPose((i / 48) * ((2 * 0.5 + 2 * Math.PI * 0.18) / 0.25)))
    track.forEach((r, i) => stretchRod(r, [loopPts[i].x, loopPts[i].y, 0.002], [loopPts[i + 1].x, loopPts[i + 1].y, 0.002], 0.004))

    addLabel(scene, 'Motor screw, cut through', [SC.x - 3.4, SC.top + 2.6, 0.3], LABEL, 0.28, 'left')
    const sec = add(scene, new THREE.Group(), [SC.x, SC.top, 0])
    const kk = SC.k
    const motorH = MOTOR_STACK * kk
    const lift = add(sec, new THREE.Group())
    box(lift, [14 * kk, motorH, 2], mat('#f2c12e', { rough: 0.55 }), [0, -motorH / 2, 0])
    const bossH = ROBOT.holeDepth + 1
    const pla = mat(FILAMENT_COLOR, { rough: 0.55 })
    const holeR = (INSERT_BOSS.hole / 2) * kk
    const bw = ROBOT.bossWall * kk
    for (const s of [-1, 1]) box(sec, [bw, bossH * kk, 4], pla, [s * (holeR + bw / 2), -motorH - (bossH * kk) / 2, 0])
    box(sec, [2 * (holeR + bw) + 30 * kk, PRINT_T * kk, 4], pla, [0, -motorH - bossH * kk - (PRINT_T * kk) / 2, 0])
    box(sec, [2 * holeR, kk, 4], pla, [0, -motorH - bossH * kk + kk / 2, 0])
    heatSetInsert(sec, INSERT_BOSS.od, INSERT_BOSS.len, kk, [0, -motorH, 0.5])
    const look = { ...METRIC_SCREWS.m3, head: SCREW_HEADS.cap, hex: METRIC_SCREWS.m3.hex.cap }
    const screws = new Map(MOTOR_SCREWS.map((l) => [l, screwModel(lift, look, l, kk, [0, 0, 2.2])]))
    addLabel(sec, `motor ${MOTOR_STACK} mm`, [-7 * kk - 0.6, -motorH / 2, 0.3], GREY, 0.26, 'right')
    addLabel(sec, `insert hole ${fixedText(ROBOT.holeDepth, 1)} mm`, [-holeR - bw - 0.3, -motorH - (ROBOT.holeDepth * kk) / 2, 2.3], GREY, 0.26, 'right')
    const screwTag = liveLabel(sec, [0, -motorH - (bossH + PRINT_T) * kk - 0.8, 2.3], { size: 0.3 })

    const clock = storyClock(AS_SECS)
    const st = { drive: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, joint, motor, others, B } = asRun(p)
        clock.frame(dt, n(p, 'step'))
        const s = clock.step
        const u = clock.t
        const hot = ASSEMBLY[s].key === 'inserts'
        const per = 1 / inserts.length
        inserts.forEach((ins, i) => {
          const f = hot ? Math.min(1, Math.max(0, (u - i * per) / per)) : 1
          ins.group.position.z = bossTop + (1 - (joint.iron.ok ? ease(f) : 0)) * INSERT_BOSS.len
        })
        const cur = INSERT_HOLES[Math.min(inserts.length - 1, Math.floor(u * inserts.length))]
        const tipZ = inserts[Math.min(inserts.length - 1, Math.floor(u * inserts.length))].group.position.z
        stretchRod(iron, [cur.x, cur.y, tipZ + 0.5], [cur.x + 10, cur.y + 6, tipZ + 70], 1.6)
        iron.visible = hot
        ASSEMBLY.forEach((a, i) =>
          a.parts.forEach((key) => {
            const g = model.part(key)
            g.visible = s >= i
            g.position.z = (a.key === 'boards' ? BOARD_LIFT : 0) + (s === i ? (1 - ease(Math.min(1, u * 1.4))) * AS.drop : 0)
          }),
        )
        const checking = s >= 5
        const L = ROBOT.wheelbase
        const t2 = CHASSIS.track / 2
        const zc = CHASSIS.plateZ + 0.004 + PRINT_T / 1000
        stretchRod(tri[0], [0, t2, zc], [0, -t2, zc], 0.0025)
        stretchRod(tri[1], [0, t2, zc], [-L, 0, zc], 0.0025)
        stretchRod(tri[2], [0, -t2, zc], [-L, 0, zc], 0.0025)
        tri.forEach((r) => (r.visible = s === 5))
        com.visible = s === 5
        com.position.set(B.x, B.y, partTop / 1000 + CHASSIS.plateZ + 0.03)
        track.forEach((r) => (r.visible = s === 6))
        const driving = s === 6
        st.drive = driving ? st.drive + dt : 0
        const pose = driving ? testLoopPose(st.drive) : { x: 0, y: 0, th: 0 }
        robot.position.set(pose.x, pose.y, 0)
        robot.rotation.z = pose.th
        const zoom = driving ? AS.zoom + (1 - AS.zoom) * (1 - ease(Math.min(1, u * 8))) : 1
        world.scale.setScalar(AS.k * zoom)
        MOTOR_SCREWS.forEach((l) => (screws.get(l)!.group.visible = l === q.len))
        lift.position.y = Math.max(0, motor.engaged - ROBOT.holeDepth) * kk
        screwTag.set(`M3 × ${q.len}: ${fixedText(motor.engaged, 1)} mm in the insert`, screwTone(motor.verdict))
        rows[0].set(`Inserts: ${joint.iron.note}`, verdictTint(joint.iron.ok && joint.iron.fill >= 0.9 && q.temp <= 240, joint.iron.ok))
        rows[1].set(`Motors: 4 × M3 × ${q.len}, ${SCREW_WORD[motor.verdict]}`, screwTone(motor.verdict))
        rows[2].set(others.map(({ a, s: sc }) => `${a.name.split(' ')[0]} M3 × ${sc.best}`).join(' · '), POWER)
        rows[3].set(`CoM ${pct(B.share)} on the drive wheels, ${Math.round(B.kg * 1000)} g in all`, verdictTint(B.stable && B.share > 0.5, B.stable))
        head.status.set(`Assembling the printed robot · step ${s + 1} of ${AS_STEPS.length}`)
        head.sub.set(`${AS_STEPS[s]}${ASSEMBLY[s].screws ? ` · ${ASSEMBLY[s].screws} × M3 into inserts` : ''}`, GREY)
        head.event.set(
          hot ? `Iron ${celsiusText(q.temp)}: ${joint.iron.ok ? `about ${Math.round(joint.iron.secs)} s per insert` : 'will not go in'}` : checking ? (s === 5 ? (B.stable ? 'CoM inside the triangle: stable' : 'CoM outside: tips') : 'Test drive: next, wire it up in Practice > Robo-car') : `${ASSEMBLY[s].parts.length} part${ASSEMBLY[s].parts.length > 1 ? 's' : ''} drop in`,
          hot ? verdictTint(joint.iron.ok && joint.iron.fill >= 0.9 && q.temp <= 240, joint.iron.ok) : POWER,
        )
      },
      readouts: (p) => {
        const { joint, motor, B, q } = asRun(p)
        return [
          { label: 'Insert pull-out', value: `${Math.round(joint.force)} N`, tone: toneOf(joint.iron.fill >= 0.9 && q.temp <= 240, joint.iron.ok) },
          { label: 'Motor screw', value: `M3 × ${q.len}`, tone: motor.verdict === 'ok' ? 'ok' : 'bad' },
          { label: 'Drive share', value: pct(B.share), tone: toneOf(B.share > 0.5 && B.share < 0.9, B.stable) },
          { label: 'Robot', value: `${Math.round(B.kg * 1000)} g`, tone: 'ok' },
        ]
      },
    }
  },
}

