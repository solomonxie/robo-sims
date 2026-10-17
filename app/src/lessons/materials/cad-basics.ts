import * as THREE from 'three/webgpu'
import {
  ASM_PARTS,
  AsmPart,
  Dof,
  MATES,
  METRIC_SCREWS,
  MOTOR_FACES,
  MOTOR_TAP,
  MeshDefect,
  SCREW_HEADS,
  SKETCH,
  SKETCH_STEPS,
  STL_WHEEL,
  ScrewFitVerdict,
  assemblyState,
  bracketSketch,
  chordError,
  meshCheck,
  plateAreaMm2,
  plateMassG,
  screwFit,
  segmentsFor,
  sketchPoints,
  sketchStatus,
  stlView,
  tessellateWheel,
  wheelTriangles,
} from '../../core/physics'
import { bytesText, fixedText, mmFixed } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SKETCH_FIXED,
  SKETCH_FREE,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  clearMeshes,
  countBars,
  frameTriad,
  glide,
  glideAngle,
  glowDot,
  glowMat,
  liveLabel,
  memoBy,
  plateGeometry,
  plotY,
  screwModel,
  shellMat,
  sketchPen,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'


// --- Sketch and extrude: a motor-mount plate sketched, constrained, then extruded; the motor size drives every dimension. ---

const SE = { sketch: [-9.4, -3.4, 0] as V3, fit: 11.4, part: [8.6, -2, 0] as V3, kp: 0.17, motorL: 40 }
const seRun = memoBy(
  (p: Params) => `${p.motor} ${p.cons} ${p.thick} ${p.fillet}`,
  (p: Params) => {
    const mk = pick(MOTOR_FACES, p.motor, 'nema17')
    const P = bracketSketch(mk, n(p, 'fillet'))
    const t = n(p, 'thick')
    return { mk, P, t, k: n(p, 'cons'), S: sketchStatus(n(p, 'cons')), area: plateAreaMm2(P), mass: plateMassG(P, t) }
  },
)

export const cadBasicsSketchAndExtrude: Lesson = {
  id: 'cad-basics-sketch-and-extrude',
  title: 'Sketch and extrude',
  tagline: 'Draw a 2D profile, pin it down with dimensions and constraints, then pull it into a solid',
  formula: (p) => {
    const { P, t, S, area, mass } = seRun(p)
    return `sketch DOF: rectangle 4 + 5 circles × 3 = 19 · each constraint removes some · ${S.total} left · area = ${P.w}² − fillets − holes = ${fixedText(area, 0)} mm² · volume = area × ${mmFixed(t, 0)} = ${fixedText((area * t) / 1000, 1)} cm³ · mass = ${SKETCH.pla} g/cm³ × V = ${fixedText(mass, 1)} g (solid PLA, typical)`
  },
  legend: [
    { color: SKETCH_FREE, label: 'Under-constrained: can still move', shape: 'dot' },
    { color: SKETCH_FIXED, label: 'Fully constrained (black in most CAD)', shape: 'dot' },
    { color: RING, label: 'Driving dimension', shape: 'dot' },
    { color: '#e0864a', label: 'Extruded plate', shape: 'dot' },
  ],
  points: [
    'Most CAD parts start as a 2D sketch on a plane: lines, arcs and circles. Here a motor-mount plate: a square, a big hole for the motor’s centring boss and four screw clearance holes (sizes from Fasteners › Metric sizes).',
    'Each sketch entity can move: a rectangle has 4 degrees of freedom (where it sits, how wide, how tall), a circle 3. Constraints (coincident, equal, symmetric, centred) and dimensions remove them. Blue lines can still be dragged; once nothing can move they turn black, fully constrained. An under-constrained sketch changes shape when you edit something else, which is how parts go wrong later.',
    'Extrude pulls the closed profile into a solid of a given thickness; a cut (pocket) extrude removes material, a fillet rounds a corner (3D printing › Design for printing › Chamfers vs fillets). The same 2D profile is what a laser or CNC cuts (Laser & CNC › Kerf).',
    'Parametric: the dimensions are linked to one value, the motor. Switch NEMA17 to NEMA23 and the plate, hole pattern and screws follow, no redrawing. Bearing seats work the same way, a press-fit hole is a dimension (Bearings › Ball bearings). Next: put parts together (Assemblies), then export for printing (Exporting STL).',
  ],
  controls: [
    { kind: 'choice', key: 'motor', options: opts(namesOf(MOTOR_FACES)), initial: 'nema17' },
    { kind: 'slider', key: 'cons', label: 'Constraints added', min: 0, max: SKETCH_STEPS.length, step: 1, initial: 4, format: (v) => `${v} of ${SKETCH_STEPS.length}` },
    { kind: 'slider', key: 'thick', label: 'Extrude', min: 2, max: 10, step: 0.5, initial: 4, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'fillet', label: 'Corner fillet', min: 0, max: 10, step: 1, initial: 4, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const sk = add(scene, new THREE.Group(), SE.sketch)
    addLabel(scene, 'sketch (zoomed to fit)', [SE.sketch[0] - 6.4, SE.sketch[1] + 7.6, 0.3], LABEL, 0.32, 'left')
    const pen = sketchPen(sk, 0.06)
    const dimPen = sketchPen(sk, 0.025)
    const origin = frameTriad(sk, 1.4, '', GREY, 0.04, { planar: true })
    const dimTags = ['w', 'h', 'boss', 'hole', 'bolt'].map(() => liveLabel(sk, [0, 0, 0.2], { size: 0.3, color: RING }))

    const part = add(scene, new THREE.Group(), SE.part)
    part.rotation.set(-0.55, -0.62, 0)
    addLabel(scene, 'extruded part', [SE.part[0] - 4, SE.sketch[1] + 7.6, 0.3], LABEL, 0.32, 'left')
    const plate = add(part, new THREE.Mesh(undefined, mat('#e0864a', { rough: 0.55 })))
    plate.castShadow = true
    const motor = add(part, new THREE.Group())
    const motorBody = box(motor, [1, 1, 1], shellMat('#5a6070', 0.35, 0.5))
    const boss = cylinder(motor, 1, 1, mat('#9aa1ab', { metal: 0.4, rough: 0.4 }), [0, 0, 0], 'z', 32)
    const shaft = cylinder(motor, 1, 1, mat('#c3c9d2', { metal: 0.4, rough: 0.35 }), [0, 0, 0], 'z', 16)
    const motorTag = liveLabel(scene, [SE.part[0] + 1.5, SE.part[1] - 8.4, 0.3], { size: 0.28, color: GREY })
    const rows = textRows(scene, 3, -16.4, -11.9, 0.32, 0.75)
    const rowsR = textRows(scene, 3, 2.4, -11.6, 0.32, 0.75)
    let built = ''
    const st = { t: 0, z: 4 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { mk, P, t, S, area, mass } = seRun(p)
        st.t += dt
        const tt = st.t
        const k = SE.fit / P.w
        const L = S.left
        const wob = (on: boolean, a: number, ph: number) => (on ? a * Math.sin(tt * 1.3 + ph) : 0)
        const [o, bossC, ...holes] = P.contours
        const ow = o.w * (1 + wob(L.outline >= 2, 0.08, 0))
        const oh = o.h * (1 + wob(L.outline >= 1, 0.08, 1.7))
        const ox = L.outline >= 3 ? wob(true, 4, 0.5) + ow / 2 - o.w / 2 : ow / 2 - o.w / 2
        const oy = L.outline >= 3 ? wob(true, 3, 2.1) + oh / 2 - o.h / 2 : oh / 2 - o.h / 2
        const outline = { ...o, cx: ox, cy: oy, w: ow, h: oh }
        const bossFree = L.boss > 0
        const bossD = { ...bossC, cx: ox + (L.boss >= 2 ? wob(true, 5, 0.9) : 0), cy: oy + (L.boss >= 2 ? wob(true, 4, 2.6) : 0), w: bossC.w * (1 + wob(L.boss >= 1, 0.1, 1.1)) }
        const hf = L.holes / 12
        const holeD = holes.map((h, i) => ({ ...h, cx: ox + h.cx * (ow / o.w) + wob(L.holes > 2, 6 * hf, i * 1.9), cy: oy + h.cy * (oh / o.h) + wob(L.holes > 2, 6 * hf, i * 2.7 + 1), w: h.w * (1 + wob(L.holes > 3, 0.25, i)) }))
        const color = (fixed: boolean) => (fixed ? SKETCH_FIXED : SKETCH_FREE)
        const sc = (pts: [number, number][]) => pts.map(([x, y]) => [x * k, y * k] as const)
        pen.draw([
          { pts: sc(sketchPoints(outline, P.fillet, 6)), color: color(S.fixed.outline) },
          { pts: sc(sketchPoints(bossD, 0, 10)), color: color(S.fixed.boss && !bossFree) },
          ...holeD.map((h) => ({ pts: sc(sketchPoints(h, 0, 4)), color: color(S.fixed.holes) })),
        ])
        origin.group.position.set((-o.w / 2) * k, (-o.h / 2) * k, 0.05)
        const has = (d: string) => S.dims.includes(d as never)
        const half = (o.w / 2) * k
        const dims: { pts: (readonly [number, number])[]; color: string }[] = []
        const gap = 1.2
        if (has('w')) dims.push({ pts: [[-half, -half - gap], [half, -half - gap]], color: RING })
        if (has('h')) dims.push({ pts: [[-half - gap, -half], [-half - gap, half]], color: RING })
        if (has('bolt')) dims.push({ pts: [[holes[1].cx * k, half + 0.7], [holes[0].cx * k, half + 0.7]], color: RING })
        dimPen.draw(dims)
        const tagAt: V3[] = [
          [0, -half - gap - 0.5, 0.2],
          [-half - gap - 1.1, 0, 0.2],
          [0, (bossC.w / 2) * k + 0.45, 0.2],
          [holes[3].cx * k + 0.4, holes[3].cy * k - 0.75, 0.2],
          [0, half + 1.2, 0.2],
        ]
        const tagText = [`${o.w}`, `${o.h}`, `Ø${fixedText(bossC.w, 1)}`, `Ø${holes[0].w}`, `${fixedText(MOTOR_FACES[mk].bolt, 1)}`]
        ;['w', 'h', 'boss', 'hole', 'bolt'].forEach((d, i) => {
          dimTags[i].group.position.set(...tagAt[i])
          dimTags[i].set(has(d) ? tagText[i] : '', RING)
        })

        const key = `${mk}|${P.fillet}`
        if (key !== built) {
          built = key
          plate.geometry?.dispose()
          plate.geometry = plateGeometry(P, SE.kp, 1)
          const f = MOTOR_FACES[mk]
          motorBody.scale.set(f.face * SE.kp, f.face * SE.kp, SE.motorL * SE.kp)
          motorBody.position.z = (-SE.motorL / 2) * SE.kp
          boss.scale.set((f.boss / 2) * SE.kp, 2 * SE.kp, (f.boss / 2) * SE.kp)
          shaft.scale.set((mk === 'nema23' ? 3.2 : 2.5) * SE.kp, 24 * SE.kp, (mk === 'nema23' ? 3.2 : 2.5) * SE.kp)
          shaft.position.z = 12 * SE.kp
        }
        st.z = glide(dt, st.z, t, 4)
        plate.scale.z = st.z
        boss.position.z = SE.kp
        part.rotation.y = -0.62 + 0.18 * Math.sin(tt * 0.4)
        motorTag.set(`${MOTOR_FACES[mk].name} behind the plate`, GREY)

        rows[0].set(`DOF left: outline ${L.outline}, boss ${L.boss}, holes ${L.holes}`, S.total ? SKETCH_FREE : SKETCH_FIXED)
        rows[1].set(S.last ? `last: ${S.last}` : 'no constraints yet: everything floats', GREY)
        rows[2].set(S.total ? `next: ${SKETCH_STEPS[seRun(p).k].name}` : 'fully constrained: safe to edit', S.total ? GREY : POWER)
        rowsR[0].set(`plate ${P.w} × ${P.h} × ${mmFixed(t, 1)}, fillet R${P.fillet}`, LABEL)
        rowsR[1].set(`area ${fixedText(area, 0)} mm² → ${fixedText(mass, 1)} g solid PLA (typical)`, GREY)
        rowsR[2].set(`${P.screw} clearance Ø${holes[0].w} on a ${fixedText(MOTOR_FACES[mk].bolt, 1)} mm square`, GREY)
        head.status.set(`Sketch and extrude · ${MOTOR_FACES[mk].name} mount · ${S.total} of 19 DOF free`)
        head.sub.set('sizes follow the motor: change it and the whole part updates', GREY)
        head.event.set(...((S.total ? [`under-constrained: ${S.total} DOF can still move (blue)`, HEAT] : ['fully constrained: every line black, nothing can drift', POWER]) as [string, string]))
      },
      readouts: (p) => {
        const { P, S, mass, t } = seRun(p)
        return [
          { label: 'DOF left', value: `${S.total}`, tone: toneOf(S.total === 0, S.total <= 4) },
          { label: 'Plate', value: `${P.w} × ${P.h} × ${fixedText(t, 1)}` },
          { label: 'Mass (typical)', value: `${fixedText(mass, 1)} g` },
          { label: 'Screws', value: P.screw },
        ]
      },
    }
  },
}

// --- Assemblies: bracket, motor, wheel and screws placed by mates; each mate removes DOF; interference check on screw length. ---

const AS = { at: [-5.4, -2.2, 0] as V3, k: 0.165, t: 4, bars: [8.4, -8.2, 0] as V3 }
const LENGTHS = [6, 8, 10, 12, 14, 16]
const VERDICT_AS: Record<ScrewFitVerdict, [string, string]> = {
  ok: ['screws fit: enough thread, tips clear the bottom of the taps', POWER],
  short: ['screws too short: under 3 mm of thread in the motor, they strip', HEAT],
  collides: ['interference: the screw tips hit the bottom of the motor taps, the plate stays loose', HIGH_V],
}
/** Exploded offsets in each part's own frame (z = its axis), mm and rad. */
const EXPLODE: Record<AsmPart, Record<Dof, number>> = {
  bracket: { x: 0, y: -8, z: -6, rx: 0.15, ry: 0.1, rz: 0.1 },
  motor: { x: 14, y: -2, z: -36, rx: 0.3, ry: -0.25, rz: 0.6 },
  wheel: { x: -10, y: 18, z: 42, rx: 0.35, ry: 0.25, rz: 0.9 },
  screws: { x: 10, y: -14, z: 30, rx: 0.2, ry: 0.3, rz: 0 },
}
const asRun = memoBy(
  (p: Params) => `${p.mates} ${p.len}`,
  (p: Params) => {
    const len = LENGTHS[Math.round(n(p, 'len'))]
    return { k: n(p, 'mates'), len, A: assemblyState(n(p, 'mates')), F: screwFit(len, AS.t) }
  },
)
const dofText = (d: readonly Dof[]) => (d.length ? d.join(' ') : 'fixed')

export const cadBasicsAssemblies: Lesson = {
  id: 'cad-basics-assemblies',
  title: 'Assemblies',
  tagline: 'Parts placed by mates: each one removes degrees of freedom until nothing can move',
  formula: (p) => {
    const { A, F, len } = asRun(p)
    return `4 parts × 6 DOF = 24 · fixed −6, coincident face −3, concentric −2 (round boss) or −4 (shaft in a hub), parallel −1 · ${A.total} left · screw M3×${len}: thread in motor = ${len} − ${AS.t} plate = ${mmFixed(F.engage, 0)}, tap ${MOTOR_TAP.depth} mm deep (typical) → overlap ${mmFixed(F.clash, 1)} = ${fixedText(F.clashMm3, 1)} mm³ each`
  },
  legend: [
    { color: '#ff5a5a', label: 'Part frame: x red, y green, z blue', shape: 'dot' },
    { color: RING, label: 'Part just mated', shape: 'dot' },
    { color: POWER, label: 'Fully placed (0 DOF)', shape: 'dot' },
    { color: HIGH_V, label: 'Interference', shape: 'dot' },
  ],
  points: [
    'An assembly brings separate part files together. Each part keeps its own coordinate frame; placing it is a transform, a rotation plus a translation, exactly as in Kinematics › Frames (and the 4×4 matrices of Maths › Matrices).',
    'A free part has 6 degrees of freedom: 3 slides and 3 turns. You ground one part (the bracket), then add mates. Coincident face on face removes 3 (one slide, two tilts). Concentric removes 2 for a short boss in a hole, 4 for a long shaft in a hub. A parallel or angle mate removes the last turn.',
    'Leaving a DOF free can be right: a round screw may spin in its hole and nothing changes. A wheel left free to turn about its shaft shows the joint moves the way the real one will. But the motor must not spin on the bracket, so it gets the screw-hole mate.',
    'Run an interference check before printing. Here a screw longer than plate + tap depth bottoms out in the motor and the plate never clamps; too short and there is not enough thread (Fasteners › Metric sizes). Then send each part to Exporting STL.',
  ],
  controls: [
    { kind: 'slider', key: 'mates', label: 'Mates added', min: 0, max: MATES.length, step: 1, initial: 4, format: (v) => `${v} of ${MATES.length}` },
    { kind: 'slider', key: 'len', label: 'Screw length', min: 0, max: LENGTHS.length - 1, step: 1, initial: 1, format: (v) => `M3 × ${LENGTHS[Math.round(v)]}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const asm = add(scene, new THREE.Group(), AS.at)
    asm.scale.setScalar(AS.k)
    asm.rotation.set(0.38, -0.36, 0)
    const holders = {} as Record<AsmPart, THREE.Group>
    const frames = {} as Record<AsmPart, ReturnType<typeof frameTriad>>
    for (const pk of ASM_PARTS) {
      const outer = add(asm, new THREE.Group())
      outer.rotation.y = Math.PI / 2
      holders[pk] = add(outer, new THREE.Group())
      frames[pk] = frameTriad(holders[pk], 12, '', '#e8e8e8', 0.8)
    }
    const P = bracketSketch('nema17', 4)
    const plate = add(holders.bracket, new THREE.Mesh(plateGeometry(P, 1, AS.t), mat('#e0864a', { rough: 0.55 })))
    plate.castShadow = true
    box(holders.bracket, [P.w, AS.t, 48], mat('#e0864a', { rough: 0.55 }), [0, -P.h / 2 + AS.t / 2, -24 + AS.t])
    const f = MOTOR_FACES.nema17
    const motor = holders.motor
    box(motor, [f.face, f.face, 40], shellMat('#8a90a0', 0.28, 0.5), [0, 0, -20])
    cylinder(motor, f.boss / 2, 2, mat('#9aa1ab', { metal: 0.4, rough: 0.4 }), [0, 0, 1], 'z', 32)
    cylinder(motor, 2.5, 24, mat('#c3c9d2', { metal: 0.4, rough: 0.35 }), [0, 0, 12], 'z', 16)
    const tapM = mat('#111318', { rough: 0.9 })
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) cylinder(motor, 1.6, MOTOR_TAP.depth, tapM, [sx * f.bolt / 2, sy * f.bolt / 2, -MOTOR_TAP.depth / 2], 'z', 12)
    const wheel = add(holders.wheel, new THREE.Group(), [0, 0, 24 - 5])
    cylinder(wheel, 30, 10, shellMat('#4a4e58', 0.55, 0.8), [0, 0, 0], 'z', 48)
    cylinder(wheel, 22, 10.6, shellMat('#d6c24a', 0.5, 0.5), [0, 0, 0], 'z', 48)
    cylinder(wheel, 7, 14, mat('#d6c24a', { rough: 0.5 }), [0, 0, -2], 'z', 24)
    box(wheel, [2, 4, 3], mat('#c3c9d2', { metal: 0.4 }), [0, 8, -6])
    const screwG = add(holders.screws, new THREE.Group())
    const clashM = glowMat(HIGH_V, 1.4)
    const clashes = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => cylinder(holders.screws, 1.9, 1, clashM, [(sx * f.bolt) / 2, (sy * f.bolt) / 2, 0], 'z', 12))
    let builtLen = 0
    let threads: THREE.MeshStandardMaterial[] = []
    let spinners: THREE.Group[] = []
    const st = { t: 0, pose: Object.fromEntries(ASM_PARTS.map((pk) => [pk, { ...EXPLODE[pk] }])) as Record<AsmPart, Record<Dof, number>> }
    const nameTags = ASM_PARTS.map(() => liveLabel(scene, [0, 0, 1], { size: 0.3 }))
    const tagAt: V3[] = [[0, P.h / 2 + 7, 4], [0, f.face / 2 + 8, -30], [0, 38, 19], [f.bolt / 2, f.bolt / 2 + 9, 14]]
    ;([[-P.w / 2, -P.h / 2, AS.t], [0, 0, -40], [0, 0, 24], [f.bolt / 2, f.bolt / 2, AS.t + 3]] as V3[]).forEach((at, i) => frames[ASM_PARTS[i]].group.position.set(...at))

    addLabel(scene, 'DOF left per part', [AS.bars[0] - 4.2, AS.bars[1] + 0.9, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, AS.bars, ASM_PARTS, 2.6, { row: 0.8, size: 0.28 })
    const total = liveLabel(scene, [AS.bars[0] - 4.2, AS.bars[1] - 3.7, 0.3], { size: 0.36, align: 'left' })
    const rows = textRows(scene, 4, -16.4, -10, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { k, len, A, F } = asRun(p)
        st.t += dt
        if (len !== builtLen) {
          builtLen = len
          clearMeshes(screwG)
          const s = METRIC_SCREWS.m3
          spinners = []
          threads = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => {
            const spin = add(screwG, new THREE.Group(), [(sx * f.bolt) / 2, (sy * f.bolt) / 2, AS.t])
            spinners.push(spin)
            const g = add(spin, new THREE.Group())
            g.rotation.x = -Math.PI / 2
            const sm = screwModel(g, { d: s.d, pitch: s.pitch, hex: s.hex.cap, head: SCREW_HEADS.cap }, len, 1)
            return sm.thread
          })
        }
        const lastPart = A.last?.part
        ASM_PARTS.forEach((pk, i) => {
          const free = A.free[pk]
          const pose = st.pose[pk]
          for (const d of ['x', 'y', 'z', 'rx', 'ry'] as Dof[]) {
            const target = free.includes(d) ? EXPLODE[pk][d] * (A.placed[pk] ? 0.45 : 1) + (d[0] === 'r' ? 0.08 : 2.5) * Math.sin(st.t * 1.1 + i * 1.7 + d.length) : 0
            pose[d] = glide(dt, pose[d], target, 3)
          }
          pose.rz = free.includes('rz') ? pose.rz + dt * (pk === 'screws' ? 2 : 0.7) : glideAngle(dt, pose.rz, 0, 3)
          const h = holders[pk]
          h.position.set(pose.x, pose.y, pose.z)
          h.rotation.set(pose.rx, pose.ry, pk === 'screws' ? 0 : pose.rz)
          if (pk === 'screws') spinners.forEach((sp) => (sp.rotation.z = pose.rz))
          frames[pk].group.visible = free.length > 0 || pk === lastPart
          const c = free.length === 0 ? POWER : pk === lastPart ? RING : LABEL
          frames[pk].label.set('', c)
          h.updateWorldMatrix(true, false)
          const w0 = h.localToWorld(new THREE.Vector3(...tagAt[i]))
          nameTags[i].group.position.set(w0.x, w0.y, w0.z + 1)
          nameTags[i].set(pk, c)
        })
        const collide = F.verdict === 'collides'
        threads.forEach((m) => m.color.set(collide ? HIGH_V : F.verdict === 'short' ? HEAT : '#c3c9d2'))
        clashes.forEach((c) => {
          c.visible = collide
          c.scale.y = Math.max(0.01, F.clash)
          c.position.z = AS.t - len + F.clash / 2
        })

        bars.set(
          ASM_PARTS.map((pk) => A.free[pk].length),
          ASM_PARTS.map((pk) => `${A.free[pk].length}  ${dofText(A.free[pk])}`),
          ASM_PARTS.map((pk) => (A.free[pk].length === 0 ? POWER : pk === lastPart ? RING : SKETCH_FREE)),
          6,
        )
        total.set(`total ${A.total} of 24 DOF free`, A.total <= 1 ? POWER : LABEL)
        rows[0].set(A.last ? `last mate: ${A.last.kind}, ${A.last.what}` : 'no mates: every part floats', A.last ? RING : GREY)
        rows[1].set(k < MATES.length ? `next: ${MATES[k].kind}, ${MATES[k].what}` : 'screw spin left free: harmless', GREY)
        rows[2].set(`M3 × ${len}: ${mmFixed(F.engage, 0)} of thread in a ${MOTOR_TAP.depth} mm tap, longest ${mmFixed(F.ideal, 1)}`, VERDICT_AS[F.verdict][1])
        rows[3].set(collide ? `interference ${fixedText(F.clashMm3, 1)} mm³ per screw (red)` : 'interference check: no overlaps', collide ? HIGH_V : POWER)
        head.status.set(`Assemblies · ${k} of ${MATES.length} mates · ${A.total} DOF free · M3 × ${len}`)
        head.sub.set('bracket, NEMA17, 60 mm wheel, 4 screws; motor drawn see-through', GREY)
        head.event.set(...VERDICT_AS[F.verdict])
      },
      readouts: (p) => {
        const { A, F } = asRun(p)
        return [
          { label: 'DOF free', value: `${A.total} of 24`, tone: toneOf(A.total <= 1, A.total <= 6) },
          { label: 'Motor DOF', value: `${A.free.motor.length}`, tone: toneOf(A.free.motor.length === 0, false) },
          { label: 'Thread', value: mmFixed(F.engage, 0), tone: toneOf(F.verdict === 'ok', false) },
          { label: 'Clash', value: F.clash ? `${fixedText(F.clashMm3, 1)} mm³` : 'none', tone: toneOf(!F.clash, false) },
        ]
      },
    }
  },
}

// --- Exporting STL: the smooth wheel becomes triangles; tolerance vs triangle count, file size, faceted bore, units and mesh checks. ---

const ST = { at: [-8.6, -1.3, 0] as V3, k: 0.19, zoom: [-13.2, -9.9, 0] as V3, zr: 2.6, tLo: 0.001, tHi: 0.5, triHi: 4 }
const STL_UNITS = { mm: { name: 'Exported in mm' }, inch: { name: 'Exported in inches' } }
const DEFECTS = { none: { name: 'Clean mesh' }, gap: { name: 'Missing triangle' }, flipped: { name: 'Flipped triangle' } }
const stRun = memoBy(
  (p: Params) => `${p.tol} ${p.angle} ${p.units} ${p.defect}`,
  (p: Params) => {
    const units = pick(STL_UNITS, p.units, 'mm')
    const defect = pick(DEFECTS, p.defect, 'none') as MeshDefect
    const V = stlView(n(p, 'tol'), n(p, 'angle'), units, defect)
    const M = tessellateWheel(V.nOut, V.nIn, defect)
    return { tol: n(p, 'tol'), angle: n(p, 'angle'), units, V, M, C: meshCheck(M.verts, M.tris) }
  },
)
const lg = (v: number) => Math.log10(v)

export const cadBasicsExportingStl: Lesson = {
  id: 'cad-basics-exporting-stl',
  title: 'Exporting STL',
  tagline: 'The smooth CAD surface becomes a mesh of flat triangles: how fine, how big, and is it closed',
  formula: (p) => {
    const { tol, V } = stRun(p)
    return `segments n ≥ π / acos(1 − tol/R) and ≥ 360°/angle · rim R ${STL_WHEEL.R}: n = ${V.nOut}, error R(1 − cos(π/n)) = ${fixedText(V.errOut * 1000, 1)} µm · bore R ${STL_WHEEL.r}: n = ${V.nIn} · triangles = 4·(${V.nOut} + ${V.nIn}) = ${V.tris} · binary STL = 84 + 50 × ${V.tris} = ${bytesText(V.bytes)} · tol ${fixedText(tol, 3)} mm`
  },
  legend: [
    { color: RING, label: 'True CAD circle', shape: 'dot' },
    { color: '#6fb8ff', label: 'Exported triangles', shape: 'dot' },
    { color: POWER, label: 'This export on the chart', shape: 'dot' },
    { color: HIGH_V, label: 'Undersize bore / mesh error', shape: 'dot' },
  ],
  points: [
    'CAD stores exact curves; an STL file stores only flat triangles, each three corners and a normal pointing out. Exporting cuts every curve into straight chords. The chord (deviation) tolerance limits the gap between chord and true arc; the angle tolerance limits the turn between neighbouring facets, which matters on small holes.',
    'Halve the tolerance and you get about 1.4× the segments; each triangle costs 50 bytes in binary STL (ASCII is about 5× bigger). Around 0.01 mm is plenty: a printer lays 0.4 mm lines, so finer only makes slow, huge files (3D printing › Slicing › STL and 3MF).',
    'Corners of the facets sit on the circle, so a faceted hole is narrowest across its flats: a coarse 5 mm bore prints too small for a 5 mm shaft, before the printer shrinks it further (3D printing › Design for printing › Holes and teardrops). Small holes need the angle limit.',
    'STL has no units. Slicers assume millimetres: a part exported in inches arrives 25.4× too small. A good mesh is watertight (every edge shared by two triangles) with all normals outward; a gap or a flipped triangle confuses the slicer. Most slicers repair small faults, but check the export.',
  ],
  controls: [
    { kind: 'slider', key: 'tol', label: 'Chord tolerance', min: ST.tLo, max: ST.tHi, log: true, initial: 0.05, format: (v) => `${fixedText(v, v < 0.01 ? 3 : 2)} mm` },
    { kind: 'slider', key: 'angle', label: 'Angle tolerance', min: 5, max: 60, step: 5, initial: 15, format: (v) => `${v}°` },
    { kind: 'choice', key: 'units', options: opts(namesOf(STL_UNITS)), initial: 'mm' },
    { kind: 'choice', key: 'defect', options: opts(namesOf(DEFECTS)), initial: 'none' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = add(scene, new THREE.Group(), ST.at)
    g.rotation.set(-0.75, 0.35, 0)
    g.scale.setScalar(ST.k)
    const wheelM = new THREE.MeshStandardMaterial({ color: '#3d7fc4', roughness: 0.45, flatShading: true })
    const wheel = add(g, new THREE.Mesh(new THREE.BufferGeometry(), wheelM))
    const edgeM = new THREE.LineBasicMaterial({ color: '#d8ecff', transparent: true, opacity: 0.6 })
    const edges = add(g, new THREE.LineSegments(new THREE.BufferGeometry(), edgeM))
    const bad = add(g, new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: HIGH_V, emissive: HIGH_V, emissiveIntensity: 1, side: THREE.DoubleSide })))
    const ring = add(g, mesh(new THREE.TorusGeometry(STL_WHEEL.R + 0.25, 0.25, 6, 128), glowMat(RING, 0.9)), [0, 0, STL_WHEEL.h / 2])
    ring.castShadow = false
    const tiny = add(scene, new THREE.Group(), [ST.at[0] + 7.6, ST.at[1] - 6.4, 0])
    cylinder(tiny, (STL_WHEEL.R / 25.4) * ST.k, (STL_WHEEL.h / 25.4) * ST.k, mat('#6fb8ff'), [0, 0, 0], 'z', 16)
    const tinyTag = liveLabel(scene, [ST.at[0] + 7.6, ST.at[1] - 7.2, 0.3], { size: 0.26, color: HIGH_V })

    const zoom = add(scene, new THREE.Group(), ST.zoom)
    const zPen = sketchPen(zoom, 0.05)
    addLabel(scene, 'bore close-up', [ST.zoom[0] + 3, ST.zoom[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const boreTag = liveLabel(scene, [ST.zoom[0] + 3, ST.zoom[1] - 0.1, 0.3], { size: 0.26, align: 'left' })

    const PL = WIDE_RIGHT
    const plot = titledScope(scene, PL.y, PL.h, 'triangles vs tolerance', LABEL, 0, PL.x, PL.w)
    const py = plotY(1, ST.triHi, PL.h)
    const curve = plot.s.trace(GREY, { samples: 61, radius: 0.06 })
    const marker = glowDot(plot.s.group, 0.26, POWER)
    addLabel(plot.s.group, '10 000', [-PL.w / 2 + 0.2, py(4) - 0.35, 0.4], GREY, 0.22, 'left')
    addLabel(plot.s.group, '100', [-PL.w / 2 + 0.2, py(2) + 0.35, 0.4], GREY, 0.22, 'left')
    const us = Array.from({ length: 61 }, (_, i) => i / 60)
    const rows = textRows(scene, 5, 2.4, 3.2, 0.3, 0.75)
    let built = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { tol, angle, units, V, M, C } = stRun(p)
        const key = `${V.nOut}|${V.nIn}|${V.defect}`
        if (key !== built) {
          built = key
          const pos = new Float32Array(M.tris.length * 9)
          M.tris.forEach((t, i) => t.forEach((v, j) => pos.set(M.verts[v], i * 9 + j * 3)))
          wheel.geometry.dispose()
          wheel.geometry = new THREE.BufferGeometry()
          wheel.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
          wheel.geometry.computeVertexNormals()
          edges.geometry.dispose()
          edges.geometry = new THREE.WireframeGeometry(wheel.geometry)
          bad.geometry.dispose()
          bad.geometry = new THREE.BufferGeometry()
          if (M.bad >= 0) {
            const T = V.defect === 'gap' ? tessellateWheel(V.nOut, V.nIn).tris[M.bad] : M.tris[M.bad]
            const b = new Float32Array(9)
            T.forEach((v, j) => b.set([M.verts[v][0], M.verts[v][1], M.verts[v][2] + 0.15], j * 3))
            bad.geometry.setAttribute('position', new THREE.BufferAttribute(b, 3))
            bad.geometry.computeVertexNormals()
          }
          const r = ST.zr
          const poly = Array.from({ length: V.nIn + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / V.nIn), r * Math.sin((2 * Math.PI * i) / V.nIn)] as const)
          const circ = Array.from({ length: 65 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / 64), r * Math.sin((2 * Math.PI * i) / 64)] as const)
          zPen.draw([{ pts: circ, color: RING }, { pts: poly, color: V.bore < 2 * STL_WHEEL.r - 0.05 ? HIGH_V : '#6fb8ff' }])
        }
        bad.visible = M.bad >= 0
        wheel.rotation.z += dt * 0.25
        edges.rotation.z = bad.rotation.z = wheel.rotation.z
        const inch = units === 'inch'
        tiny.visible = inch
        tinyTag.set(inch ? `slicer sees ${mmFixed(V.seenMm, 2)}` : '', HIGH_V)
        boreTag.set(`Ø5 shaft, hole Ø${fixedText(V.bore, 2)} across flats`, V.bore < 2 * STL_WHEEL.r - 0.05 ? HIGH_V : POWER)

        curve.points(us, us.map((u) => {
          const tu = 10 ** (lg(ST.tLo) + u * (lg(ST.tHi) - lg(ST.tLo)))
          return py(lg(wheelTriangles(segmentsFor(STL_WHEEL.R, tu, angle), segmentsFor(STL_WHEEL.r, tu, angle))))
        }), null)
        marker.position.set(plot.s.xAt((lg(tol) - lg(ST.tLo)) / (lg(ST.tHi) - lg(ST.tLo))), py(lg(V.tris)), 0.46)
        plot.lo.set(`${ST.tLo} mm`)
        plot.hi.set(`${ST.tHi} mm (log)`)
        plot.right.set(`${V.tris} triangles`, POWER)

        rows[0].set(`rim ${V.nOut} segments, error ${fixedText(V.errOut * 1000, 1)} µm · bore ${V.nIn}, error ${fixedText(chordError(STL_WHEEL.r, V.nIn) * 1000, 1)} µm`, LABEL)
        rows[1].set(`${V.tris} triangles → ${bytesText(V.bytes)} binary, ~${bytesText(V.ascii)} ASCII (typical)`, LABEL)
        rows[2].set(`STL has no units: slicer reads ${mmFixed(V.seenMm, inch ? 2 : 0)} across`, inch ? HIGH_V : GREY)
        rows[3].set(C.watertight ? `watertight: every edge in 2 triangles` : `not watertight: ${C.open} open edges`, C.watertight ? POWER : HIGH_V)
        rows[4].set(C.consistent ? `normals all outward · volume ${fixedText(C.volume / 1000, 1)} cm³` : `${C.flippedEdges} edges with clashing normals: 1 flipped triangle`, C.consistent ? GREY : HIGH_V)
        head.status.set(`Exporting STL · 60 mm wheel · tolerance ${fixedText(tol, 3)} mm, ${angle}°`)
        head.sub.set('flat facets drawn as exported; red triangle = the faulty one', GREY)
        const ev: [string, string] = inch
          ? ['units mismatch: exported in inches, the slicer reads mm, 25.4× too small', HIGH_V]
          : !C.watertight || !C.consistent
            ? ['mesh fault: the slicer may fill it wrongly or refuse it', HIGH_V]
            : V.bore < 2 * STL_WHEEL.r - 0.05
              ? ['coarse bore: the 5 mm shaft will not go in, raise the facet count', HEAT]
              : V.tris > 4000
                ? ['very fine: big file, no better print', HEAT]
                : ['good export: smooth enough, small file, closed mesh', POWER]
        head.event.set(...ev)
      },
      readouts: (p) => {
        const { V, C } = stRun(p)
        return [
          { label: 'Triangles', value: `${V.tris}` },
          { label: 'File', value: bytesText(V.bytes) },
          { label: 'Bore', value: mmFixed(V.bore, 2), tone: toneOf(V.bore >= 4.95, V.bore >= 4.9) },
          { label: 'Mesh', value: C.watertight && C.consistent ? 'closed' : 'faulty', tone: toneOf(C.watertight && C.consistent, false) },
        ]
      },
    }
  },
}
