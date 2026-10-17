import * as THREE from 'three/webgpu'
import { CHASSIS_PLATE, Contour, FITS, FitKey, HOLES, MATERIALS, MOUNT, SHEETS, SheetKey, contourPoints, cutContour, kerfView, plateCompare } from '../../core/physics'
import { fixedText, mmHundredths, newtonsText, paText, signed, si } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  INK,
  LABEL,
  MATERIAL_TINT,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  addRod,
  cantileverBeam,
  countBars,
  flatBox,
  forceArrow,
  glowDot,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  plotY,
  shellMat,
  statusHeader,
  stressColor,
  stretchRod,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const SHEET_KEYS = Object.keys(SHEETS) as SheetKey[]
const mm2 = (mm: number) => mmHundredths(mm / 1000)
const PLOT = { x: 8.6, y: -5.9, w: 11.8, h: 7.2 }
const FIT_COLOR: Record<FitKey, string> = { loose: HEAT, slip: RING, press: POWER, tight: HIGH_V }
const CHAR = '#4a2e18'

// --- Kerf: the beam burns away a strip k wide; outlines shrink, holes grow, and an offset path puts it back. ---

const KF = { at: [-10, -0.6, 0] as V3, s: 0.12, tilt: -0.6, ex: 10, joint: { at: [-12, -9.5, 0] as V3, s: 0.7, ex: 5 }, cMax: 0.25, gLo: -0.3, gHi: 0.6, loop: 8 }
/** Holes first, outline last, as on a real laser (the part stays put until the end). */
const CUT_ORDER = [1, 2, 3, 0]
const kfRun = memoBy(
  (p: Params) => `${p.mat} ${p.power} ${p.comp}`,
  (p: Params) => {
    const sk = pick(SHEETS, p.mat, 'acrylic')
    const power = n(p, 'power')
    const comp = n(p, 'comp')
    const V = kerfView(sk, power, comp)
    const pts = (c: Contour) => contourPoints(c, 40).map(([x, y]) => [x * KF.s, y * KF.s] as const)
    const drawn = CUT_ORDER.map((i) => {
      const d = CHASSIS_PLATE[i]
      const { beam, edge } = cutContour(d, V.kerf * KF.ex, comp * KF.ex)
      return { design: pts(d), beam: pts(beam), edge: pts(edge) }
    })
    const lens = drawn.map(({ beam }) => beam.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - beam[i][0], q[1] - beam[i][1]), 0))
    return { sk, power, comp, V, drawn, lens, total: lens.reduce((a, b) => a + b, 0), gaps: Array.from({ length: 101 }, (_, i) => V.gapAt((KF.cMax * i) / 100)) }
  },
)

export const laserCncKerf: Lesson = {
  id: 'laser-cnc-kerf',
  title: 'Kerf',
  tagline: 'The beam has a width: cut parts come out small and holes big',
  formula: (p) => {
    const { V, comp } = kfRun(p)
    return `line energy = P/v = ${fixedText(V.jmm, 1)} J/mm · kerf k = ${mm2(V.kerf)} · uncompensated: outlines −k, holes +k · offset c away from the part: outline 100 mm → 100 − k + 2c = ${mm2(V.outline)}, hole 20 mm → 20 + k − 2c = ${mm2(V.hole)} · tab-and-slot gap = 2·(k − 2c) = ${signed(V.gap, 2)} mm at c = ${mm2(comp)} · c = k/2 = ${mm2(V.ideal)} gives true size`
  },
  legend: [
    { color: GREY, label: 'Drawn line (CAD)', shape: 'dot' },
    { color: INK, label: 'Kerf: material burnt away', shape: 'dot' },
    { color: RING, label: 'Real edge of the part', shape: 'dot' },
    { color: POWER, label: 'Gap vs offset c', shape: 'dot' },
  ],
  points: [
    'A laser (or a router bit on a CNC) does not cut a line, it removes a strip: the kerf, about 0.1–0.3 mm for a laser, the bit diameter (3 mm or more) for a router. More power or a slower feed puts more energy per millimetre into the sheet, so the kerf widens; too little and the cut does not go through.',
    'If the beam follows your drawing, half the kerf comes off each side of the line. Outer outlines come out k smaller, holes and slots k bigger. A 3 mm tab in a 3 mm slot ends up with a 2k gap and rattles.',
    'Kerf compensation offsets the path by c away from the part: outward on outlines, inward on holes. c = k/2 restores the drawn size; a few hundredths more squeezes the tab into a press fit that holds without glue. Acrylic is brittle and takes very little squeeze; plywood crushes a bit, so it takes more. Cut a small test comb first: fits drift with the sheet and the lens (see 3D printing › Design for printing › Tolerances and fits).',
    'Cut holes before the outline, so the part does not drop or shift before its inside is done. Plywood edges char brown; acrylic melts to a polished edge: Acrylic vs plywood. Thickness, strength and stiffness of the plate come from Stress & strain.',
  ],
  controls: [
    { kind: 'slider', key: 'comp', label: 'Kerf offset c', min: 0, max: KF.cMax, step: 0.01, initial: 0, format: (v) => `${v.toFixed(2)} mm` },
    { kind: 'slider', key: 'power', label: 'Laser power', min: 30, max: 100, step: 5, initial: 70, format: (v) => `${v} %` },
    { kind: 'choice', key: 'mat', options: opts(namesOf(SHEETS)), initial: 'acrylic' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const plate = add(scene, new THREE.Group(), KF.at)
    plate.rotation.x = KF.tilt
    const sheetM = new THREE.MeshStandardMaterial({ roughness: 0.5, transparent: true, opacity: 0.9 })
    add(plate, new THREE.Mesh(new THREE.BoxGeometry(13.6, 9.8, 0.45), sheetM), [0, 0, -0.25])
    const segs = CUT_ORDER.map((i) => contourPoints(CHASSIS_PLATE[i], 40).length - 1)
    const pool = (m: THREE.Material) => segs.map((k) => Array.from({ length: k }, () => addRod(plate, m)))
    const designRods = pool(glowMat(GREY, 0.5))
    const charM = glowMat(CHAR, 0.1)
    const charRods = pool(charM)
    const kerfM = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.9 })
    const kerfRods = pool(kerfM)
    const edgeRods = pool(glowMat(RING, 0.9))
    const nozzle = add(plate, new THREE.Group())
    box(nozzle, [1, 1, 1.1], mat('#3a3f4a', { metal: 0.5, rough: 0.4 }), [0, 0, 2.15])
    add(nozzle, new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 16), mat('#c8a050', { metal: 0.7, rough: 0.3 })), [0, 0, 1.25]).rotation.x = -Math.PI / 2
    const beam = addRod(nozzle, glowMat(HIGH_V, 2))
    stretchRod(beam, [0, 0, 0.9], [0, 0, 0], 0.06)
    const spot = glowDot(nozzle, 0.22, HEAT, 2)
    addLabel(scene, `kerf and offset drawn ×${KF.ex}`, [KF.at[0], KF.at[1] - 4.9, 0.4], GREY, 0.26)
    const clock = lapseClock(KF.loop, 1, 1.5)

    const { at: ja, s: js, ex: jex } = KF.joint
    addLabel(scene, 'tab in slot, end view', [ja[0] + 5, ja[1] + 2.2, 0.3], LABEL, 0.28, 'left')
    addLabel(scene, `size error drawn ×${jex}`, [ja[0] + 5, ja[1] + 1.5, 0.3], GREY, 0.24, 'left')
    const jointM = new THREE.MeshStandardMaterial({ roughness: 0.5 })
    const walls = [-1, 1].map(() => add(scene, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), jointM)))
    const tab = add(scene, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), jointM))
    const clash = [-1, 1].map(() => flatBox(scene, [1, 1, 0.1], glowMat(HIGH_V, 1.2), [0, 0, 0.8]))
    const tabTag = liveLabel(scene, [ja[0] + 5, ja[1] + 0.6, 0.4], { size: 0.28, align: 'left' })
    const slotTag = liveLabel(scene, [ja[0] + 5, ja[1] - 0.1, 0.4], { size: 0.28, align: 'left' })
    const fitTag = liveLabel(scene, [ja[0] + 5, ja[1] - 0.9, 0.4], { size: 0.3, align: 'left' })

    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const plot = titledScope(scene, PLOT.y, PLOT.h, 'tab-slot gap vs offset c', LABEL, (0 - KF.gLo) / (KF.gHi - KF.gLo), PLOT.x, PLOT.w)
    const py = plotY(KF.gLo, KF.gHi, PLOT.h)
    const pressLo = plot.s.level(POWER)
    plot.s.level(RING).set(py(0.02))
    plot.s.level(HEAT).set(py(0.12))
    const curve = plot.s.trace(POWER, { samples: 101, radius: 0.08 })
    const marker = glowDot(plot.s.group, 0.28, RING)
    const idealDot = glowDot(plot.s.group, 0.16, LABEL, 0.8)
    addLabel(plot.s.group, 'loose', [PLOT.w / 2 - 0.3, py(0.12) + 0.4, 0.4], HEAT, 0.24, 'right')
    addLabel(plot.s.group, 'slip', [PLOT.w / 2 - 0.3, py(0.07), 0.4], RING, 0.24, 'right')
    const pressTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.24, color: POWER, align: 'right' })
    const tightTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.24, color: HIGH_V, align: 'right' })
    const idealTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.24, color: LABEL })
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { sk, power, comp, V, drawn, lens, total, gaps } = kfRun(p)
        const tint = MATERIAL_TINT[sk]
        sheetM.color.set(tint)
        sheetM.opacity = sk === 'acrylic' ? 0.55 : 0.95
        kerfM.color.set(V.through ? INK : '#5a5f68')
        const t = clock(dt, `${sk}|${power}|${comp}`)
        let left = (t / KF.loop) * total
        const kr = (V.kerf * KF.ex * KF.s) / 2
        const cr = kr + V.char * KF.ex * KF.s
        let tip: readonly [number, number] = drawn[0].beam[0]
        drawn.forEach((d, ci) => {
          const run = Math.min(left, lens[ci])
          left -= lens[ci]
          let acc = 0
          d.beam.slice(1).forEach((q, i) => {
            const a = d.beam[i]
            const L = Math.hypot(q[0] - a[0], q[1] - a[1])
            const f = Math.max(0, Math.min(1, (run - acc) / L))
            acc += L
            const e: [number, number] = [a[0] + (q[0] - a[0]) * f, a[1] + (q[1] - a[1]) * f]
            if (f > 0 && f < 1) tip = e
            if (f === 1 && run >= lens[ci] - 1e-9 && ci === drawn.length - 1 && i === d.beam.length - 2) tip = q
            const ok = f > 0
            stretchRod(designRods[ci][i], [d.design[i][0], d.design[i][1], 0.03], [d.design[i + 1][0], d.design[i + 1][1], 0.03], 0.03)
            kerfRods[ci][i].visible = charRods[ci][i].visible = edgeRods[ci][i].visible = ok
            if (!ok) return
            stretchRod(kerfRods[ci][i], [a[0], a[1], 0.25], [e[0], e[1], 0.25], kr)
            charRods[ci][i].visible = V.char > 0
            if (V.char > 0) stretchRod(charRods[ci][i], [a[0], a[1], -0.02], [e[0], e[1], -0.02], cr)
            const ea = d.edge[i]
            const eb = d.edge[i + 1]
            stretchRod(edgeRods[ci][i], [ea[0], ea[1], 0.5], [ea[0] + (eb[0] - ea[0]) * f, ea[1] + (eb[1] - ea[1]) * f, 0.5], 0.035)
          })
        })
        nozzle.position.set(tip[0], tip[1], 0)
        spot.visible = t < KF.loop
        beam.visible = t < KF.loop

        jointM.color.set(tint)
        const tabW = (3 + (V.tab - 3) * jex) * js
        const slotW = (3 + (V.slot - 3) * jex) * js
        const th = 3 * js
        walls.forEach((w, i) => {
          const s = i ? 1 : -1
          w.scale.set(3, th, 1)
          w.position.set(ja[0] + s * (slotW / 2 + 1.5), ja[1], 0)
        })
        tab.scale.set(tabW, 4, 1)
        tab.position.set(ja[0], ja[1] - th / 2 + 2 - 0.1, 0.02)
        const over = Math.max(0, (tabW - slotW) / 2)
        clash.forEach((c, i) => {
          c.visible = over > 0.01
          c.scale.set(over, th, 1)
          c.position.set(ja[0] + (i ? 1 : -1) * (slotW / 2 + over / 2), ja[1], 0.8)
        })
        const col = FIT_COLOR[V.fit]
        tabTag.set(`tab ${mm2(V.tab)}`, LABEL)
        slotTag.set(`slot ${mm2(V.slot)}`, LABEL)
        fitTag.set(FITS[V.fit].split(':')[0], col)

        rows[0].set(V.through ? `kerf k = ${mm2(V.kerf)} at ${power} % (${fixedText(V.jmm, 1)} J/mm)` : `${power} %: only ${Math.round(V.depth * 100)} % deep, not through`, V.through ? LABEL : HIGH_V)
        rows[1].set(`outline 100 mm cuts to ${mm2(V.outline)}`, Math.abs(V.outline - 100) < 0.015 ? POWER : GREY)
        rows[2].set(`20 mm hole cuts to ${mm2(V.hole)}`, Math.abs(V.hole - 20) < 0.015 ? POWER : GREY)
        rows[3].set(`3 mm tab in 3 mm slot: gap ${signed(V.gap, 2)} mm`, col)

        const tight = SHEETS[sk].tightMm
        pressLo.set(py(tight))
        pressTag.group.position.set(PLOT.w / 2 - 0.3, py((tight + 0.02) / 2), 0.4)
        pressTag.set('press', POWER)
        tightTag.group.position.set(PLOT.w / 2 - 0.3, py(tight) - 0.45, 0.4)
        tightTag.set('too tight', HIGH_V)
        curve.draw((u) => py(gaps[Math.round(u * 100)]), null)
        const u = comp / KF.cMax
        marker.position.set(plot.s.xAt(u), Math.max(-PLOT.h / 2, Math.min(PLOT.h / 2, py(V.gap))), 0.45)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(col)
        idealDot.position.set(plot.s.xAt(V.ideal / KF.cMax), py(0), 0.42)
        idealTag.group.position.set(plot.s.xAt(V.ideal / KF.cMax), py(0) - 0.55, 0.4)
        idealTag.set('k/2')
        plot.lo.set('c 0')
        plot.hi.set(`${KF.cMax} mm`)
        plot.right.set(`gap ${signed(V.gap, 2)} mm`, col)

        head.status.set(`Kerf · ${SHEETS[sk].name} · ${power} % · offset ${mm2(comp)}`)
        head.sub.set('40 W CO2 laser cutting a 100 × 70 mm chassis plate, holes first', GREY)
        head.event.set(V.through ? FITS[V.fit] : 'not cut through: the part stays stuck in the sheet', V.through ? col : HIGH_V)
      },
      readouts: (p) => {
        const { V } = kfRun(p)
        return [
          { label: 'Kerf width k', value: V.through ? mm2(V.kerf) : 'not through', tone: V.through ? undefined : 'bad' },
          { label: 'Outline (100 mm drawn)', value: mm2(V.outline), tone: toneOf(Math.abs(V.outline - 100) < 0.03, Math.abs(V.outline - 100) < 0.15) },
          { label: 'Hole (20 mm drawn)', value: mm2(V.hole), tone: toneOf(Math.abs(V.hole - 20) < 0.03, Math.abs(V.hole - 20) < 0.15) },
          { label: 'Tab-and-slot fit', value: `${signed(V.gap, 2)} mm, ${FITS[V.fit].split(':')[0]}`, tone: toneOf(V.fit === 'press', V.fit === 'slip') },
        ]
      },
    }
  },
}

// --- Acrylic vs plywood: the same 3 mm motor-mount plate; stiffness, the hole, the screw, the edge, mass and cost. ---

const AP = { root: [-15.5, 1.8, 0] as V3, len: 14, holeU: 0.12, fMax: 40, dMax: 0.02, edge: [-13, -8.9, 0] as V3, bars: [-14.2, -4.1, 0] as V3, sfMax: 6 }
const apRun = memoBy(
  (p: Params) => `${p.mat} ${p.load} ${p.hole}`,
  (p: Params) => {
    const sk = pick(SHEETS, p.mat, 'acrylic')
    const hk = pick(HOLES, p.hole, 'hole')
    const F = n(p, 'load')
    const both = plateCompare(F, hk, AP.fMax, 80)
    return { sk, hk, F, both, R: both[SHEET_KEYS.indexOf(sk)].now }
  },
)
const sfColor = (sf: number) => (sf < 1 ? HIGH_V : sf < 2 ? HEAT : POWER)

export const laserCncAcrylicVsPlywood: Lesson = {
  id: 'laser-cnc-acrylic-vs-plywood',
  title: 'Acrylic vs plywood',
  tagline: 'Same plate, same laser: glassy and brittle or woody and tough',
  formula: (p) => {
    const { R, F } = apRun(p)
    return `plate 60 × 3 mm, motor ${Math.round(MOUNT.L * 1000)} mm past the standoff · σ = 6·F·L/(b·t²) = ${paText(R.sigma)} at F = ${newtonsText(F, 1)} · at the hole σ × Kt = ${fixedText(R.kt)}${R.pre > 0 ? ` + screw ${paText(R.pre)}` : ''} = ${paText(R.peak)} · SF = ${paText(R.strength)} / ${paText(R.peak)} = ${fixedText(R.sf)} · sag δ = F·L³/(3·E·I) = ${si(R.delta, 'm')}, E ${paText(R.m.E)}`
  },
  legend: [
    { color: MATERIAL_TINT.acrylic, label: 'Acrylic 3 mm', shape: 'dot' },
    { color: MATERIAL_TINT.plywood, label: 'Plywood 3 mm', shape: 'dot' },
    { color: FORCE, label: 'Motor load F', shape: 'dot' },
    { color: HIGH_V, label: 'Crack', shape: 'dot' },
  ],
  points: [
    'Both sheets laser-cut beautifully, but they behave very differently on a robot. Birch plywood is about 3 times stiffer (E 9 vs 3.2 GPa) and over 40 % lighter, so a 3 mm plywood motor mount sags about a third as much. Acrylic needs about 4.2 mm to match its stiffness (stiffness grows with t³, Stress & strain › Hooke’s law).',
    'Acrylic is strong on paper (72 MPa) but brittle and notch-sensitive: a drilled hole concentrates the stress about 2.5 times right at its edge, and a crack starts there with no warning bend (Yield strength). Plywood’s crossed fibres bridge round the hole and barely notice it.',
    'Over-tightening a screw is the classic acrylic killer: the screw head squeezes and wedges the hole, adding stress before any load arrives, and the plate cracks on the first bump. Use washers, nylon spacers and stop at snug; plywood just dents (see Fasteners).',
    'On the laser: acrylic melts to a clear, flame-polished edge and is cheap to cut accurately, but its fumes are flammable, so never leave the cutter. Plywood chars brown and its glue layers cut slower and less evenly; the kerf is wider at the same power (Kerf). Acrylic for a showy cover or a sensor window, plywood for the load-bearing chassis; printed brackets (3D printing) for the 3D shapes.',
  ],
  controls: [
    { kind: 'slider', key: 'load', label: 'Load at motor mount F', min: 0, max: AP.fMax, step: 0.5, initial: 12, format: (v) => newtonsText(v, 1) },
    { kind: 'choice', key: 'hole', options: opts(namesOf(HOLES)), initial: 'hole' },
    { kind: 'choice', key: 'mat', options: opts(namesOf(SHEETS)), initial: 'acrylic' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const plate = cantileverBeam(scene, AP.root, AP.len, { clampH: 3, width: 3 })
    addLabel(scene, 'standoff', [AP.root[0] - 0.7, AP.root[1] - 2.2, 0.4], GREY, 0.26)
    const hx = AP.root[0] + AP.holeU * AP.len
    const screw = add(scene, new THREE.Group(), [hx, AP.root[1], 0])
    box(screw, [1.3, 0.4, 1.3], mat('#9aa3b0', { metal: 0.8, rough: 0.3 }), [0, 0.45, 0])
    box(screw, [0.35, 1.8, 0.35], mat('#9aa3b0', { metal: 0.8, rough: 0.3 }), [0, -0.3, 0])
    const crack = [0, 1, 2].map(() => addRod(scene, glowMat(HIGH_V, 1.4)))
    const motor = box(scene, [2.2, 1.8, 2.2], mat('#e3c440', { rough: 0.5 }))
    const shaft = box(scene, [0.3, 0.3, 1.6], mat('#cfd5de', { metal: 0.8 }))
    const arrow = forceArrow(scene, FORCE, { r: 0.12, size: 0.3 })
    const peakTag = liveLabel(scene, [hx + 0.9, AP.root[1] + 1.1, 0.4], { size: 0.28, align: 'left' })
    addLabel(scene, 'SF, same plate and load', [AP.bars[0], AP.bars[1] + 1, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, AP.bars, SHEET_KEYS.map((k) => MATERIALS[k].short), 6, { row: 0.85, size: 0.3 })
    const c = new THREE.Color()

    addLabel(scene, 'laser-cut edges, close up', [AP.bars[0], AP.edge[1] + 2.6, 0.3], LABEL, 0.28, 'left')
    const edgeM: Record<SheetKey, THREE.MeshStandardMaterial[]> = { acrylic: [], plywood: [] }
    SHEET_KEYS.forEach((sk, i) => {
      const g = add(scene, new THREE.Group(), [AP.edge[0] + i * 8, AP.edge[1], 0])
      g.rotation.y = -0.5
      g.scale.setScalar(1.3)
      if (sk === 'acrylic') {
        const body = shellMat(MATERIAL_TINT.acrylic, 0.45)
        add(g, new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.8, 2.4), body))
        const polish = glowMat('#ffffff', 0.6)
        flatBox(g, [0.06, 1.8, 2.4], polish, [2.26, 0, 0])
        edgeM.acrylic.push(body, polish)
      } else {
        ;[0, 1, 2].forEach((k) => {
          const m = new THREE.MeshStandardMaterial({ color: k === 1 ? '#c49a62' : MATERIAL_TINT.plywood, roughness: 0.8 })
          add(g, new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.56, 2.4), m), [0, (k - 1) * 0.6, 0])
          edgeM.plywood.push(m)
        })
        flatBox(g, [0.08, 1.8, 2.4], glowMat(CHAR, 0.1), [2.26, 0, 0])
      }
      addLabel(scene, sk === 'acrylic' ? 'acrylic: polished' : 'plywood: charred', [AP.edge[0] + i * 8, AP.edge[1] - 2.3, 0.4], MATERIAL_TINT[sk], 0.26)
    })

    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const plot = titledScope(scene, PLOT.y, PLOT.h, 'sag vs load, both sheets', LABEL, 0, PLOT.x, PLOT.w)
    const py = plotY(0, AP.dMax, PLOT.h)
    const curves = SHEET_KEYS.map((sk) => plot.s.trace(MATERIAL_TINT[sk], { samples: 81, radius: 0.07 }))
    const breaks = SHEET_KEYS.map(() => glowDot(plot.s.group, 0.24, HIGH_V))
    const markers = SHEET_KEYS.map((sk) => glowDot(plot.s.group, 0.26, MATERIAL_TINT[sk]))
    addLabel(scene, `${Math.round(AP.dMax * 1000)} mm`, [PLOT.x + PLOT.w / 2 - 0.3, PLOT.y + PLOT.h / 2 - 0.5, 0.4], GREY, 0.24, 'right')
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { sk, hk, F, both, R } = apRun(p)
        const tint = MATERIAL_TINT[sk]
        const scale = AP.len / MOUNT.L
        const sag = R.delta * scale
        const fall = 2.6
        const drop = R.cracked ? (u: number) => (u <= AP.holeU ? 0 : ((u - AP.holeU) / (1 - AP.holeU)) * fall) : (u: number) => (sag * u * u * (3 - u)) / 2
        const local = (u: number) => (Math.abs(u - AP.holeU) < 0.04 && HOLES[hk].kt ? R.peak : R.sigma * (1 - u)) / R.strength
        plate.set(0.6, drop, (u) => (R.cracked && u > AP.holeU ? c.set(HIGH_V) : stressColor(local(u), c)), 0.45)
        screw.visible = HOLES[hk].kt
        screw.position.y = AP.root[1] + (HOLES[hk].screw ? -0.15 : 0)
        crack.forEach((r, i) => {
          r.visible = R.cracked
          if (R.cracked) stretchRod(r, [hx + 0.2 + i * 0.15, AP.root[1] + 0.3 - i * 0.3, 1.55], [hx + 0.35 - i * 0.1, AP.root[1] - i * 0.3, 1.55], 0.05)
        })
        const [tx, ty] = plate.tip
        motor.position.set(tx - 1.2, ty - 1.3, 0)
        shaft.position.set(tx - 1.2, ty - 1.3, 1.8)
        arrow([tx + 0.6, ty - 0.4, 1], [tx + 0.6, ty - 0.4 - (F / AP.fMax) * 3.2, 1], `F ${newtonsText(F, 1)}`, [1.4, 0, 0])
        peakTag.set(R.cracked ? 'cracked at the hole' : HOLES[hk].kt ? `hole edge ${paText(R.peak)}` : `root ${paText(R.peak)}`, sfColor(R.sf))

        bars.set(both.map(({ now }) => Math.min(now.sf, AP.sfMax)), both.map(({ now }) => (now.cracked ? 'cracked' : fixedText(now.sf, 1))), both.map(({ sk: k, now }) => (k === sk ? sfColor(now.sf) : GREY)), AP.sfMax)
        SHEET_KEYS.forEach((k) => edgeM[k].forEach((m) => (m.emissiveIntensity = k === sk ? 0.25 : 0)))
        edgeM.acrylic.forEach((m) => m.emissive.set(MATERIAL_TINT.acrylic))
        edgeM.plywood.forEach((m) => m.emissive.set(MATERIAL_TINT.plywood))

        both.forEach(({ sk: k, now, curve }, i) => {
          curves[i].points(curve.map(([f]) => f / AP.fMax), curve.map(([, d]) => py(d)), null)
          const broke = now.breakN < AP.fMax
          breaks[i].visible = broke
          if (broke) breaks[i].position.set(plot.s.xAt(now.breakN / AP.fMax), Math.min(PLOT.h / 2, py(now.breakSag)), 0.44)
          markers[i].visible = !now.cracked
          markers[i].position.set(plot.s.xAt(F / AP.fMax), Math.min(PLOT.h / 2, py(now.delta)), 0.46)
          markers[i].scale.setScalar(k === sk ? 1.3 : 0.8)
        })
        plot.lo.set('F 0')
        plot.hi.set(newtonsText(AP.fMax, 0))
        plot.right.set(R.cracked ? 'cracked' : `δ ${si(R.delta, 'm')}`, R.cracked ? HIGH_V : tint)

        const other = both[1 - SHEET_KEYS.indexOf(sk)].now
        rows[0].set(R.cracked ? `cracks above ${newtonsText(R.breakN, 1)}` : `SF ${fixedText(R.sf, 1)} (breaks at ${newtonsText(R.breakN, 0)})`, sfColor(R.sf))
        rows[1].set(`stiffness ${fixedText(R.kPerMm)} N/mm vs ${fixedText(other.kPerMm)}`, tint)
        rows[2].set(`plate 150 × 100: ${Math.round(R.grams)} g, about $${fixedText(R.cost)}`, LABEL)
        rows[3].set(sk === 'acrylic' ? `stiff as 3 mm ply at ${mm2(R.tSameStiff * 1000)}` : 'char and glue: slower, wider kerf', GREY)

        head.status.set(`Acrylic vs plywood · ${SHEETS[sk].name} · ${HOLES[hk].name} · F ${newtonsText(F, 1)}`)
        head.sub.set('motor mount 80 mm past a standoff, plate 60 mm wide, sag to scale', GREY)
        head.event.set(R.cracked ? `${R.m.short} cracks at the hole: peak ${paText(R.peak)} over ${paText(R.strength)}` : `peak ${paText(R.peak)}, Kt ${fixedText(R.kt)}${R.pre > 0 ? `, screw adds ${paText(R.pre)}` : ''}`, sfColor(R.sf))
      },
      readouts: (p) => {
        const { R } = apRun(p)
        return [
          { label: 'Peak stress', value: paText(R.peak), tone: toneOf(R.sf >= 2, R.sf >= 1) },
          { label: 'Safety factor', value: R.cracked ? 'cracked' : fixedText(R.sf), tone: toneOf(R.sf >= 2, R.sf >= 1) },
          { label: 'Sag at motor', value: R.cracked ? '—' : si(R.delta, 'm') },
          { label: 'Plate mass', value: `${Math.round(R.grams)} g` },
        ]
      },
    }
  },
}
