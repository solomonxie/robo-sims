import * as THREE from 'three/webgpu'
import {
  BRACKET_L,
  BRIDGE_TEST,
  CLEAR_SWEEP,
  EDGE_PART,
  EDGE_KINDS,
  EDGE_SWEEP,
  EdgeKind,
  FIT,
  FIT_CLASSES,
  FOOT,
  FOOT_FIXES,
  FootFix,
  HOLE,
  HOLE_SHAPES,
  HOLE_SWEEP,
  HoleShape,
  LINE_W,
  LOAD_SWEEP,
  MATERIALS,
  ORIENTS,
  OVERHANG,
  OVERHANG_SWEEP,
  OrientKey,
  SliceLayer,
  bracketMoment,
  bracketPoint,
  edgeView,
  fitView,
  holeView,
  orientView,
  overhangView,
} from '../../core/physics'
import { degText, fixedText, mmFixed, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import {
  FIT_TINT,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  PRINT_TINT,
  RING,
  Slab,
  WIDE_VIEW,
  addLabel,
  cursorBar,
  glowMat,
  liveLabel,
  memoBy,
  printStage,
  sliceSlabs,
  stressColor,
  stretchArrow,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

// One scene for all five: a printed section on the left (sliced at the real layer height), live rows top right, a plot bottom right.
const SUPPORT = '#a4a9b2'
const EX = 3
const droopTint = (d: number) => (d < 0.1 ? PRINT_TINT : d < 0.5 ? RING : HIGH_V)
/** Layers → slabs, `every` n-th layer drawn n thick; hanging segments drop by EX × droop, bridges sag in a parabola. */
function layerSlabs(L: readonly SliceLayer[], z0: number, z1: number, every = 1, tint: (x: number, y: number) => string = () => PRINT_TINT, ex = EX, minW = 0): Slab[] {
  const out: Slab[] = []
  L.forEach((l, i) => {
    if (i % every) return
    const th = l.h * every * 0.82
    for (const s of l.segs) {
      if (s.kind === 'bridge' && s.droop > 0.02) {
        for (let j = 0; j < 8; j++) {
          const u = (j + 0.5) / 8
          const dy = ex * s.droop * 4 * u * (1 - u)
          const x = s.x0 + ((s.x1 - s.x0) * j) / 8
          out.push({ x0: x, x1: x + (s.x1 - s.x0) / 8, y0: l.y0 - dy, y1: l.y0 + th, z0, z1, color: droopTint(s.droop) })
        }
        continue
      }
      const dy = s.kind === 'hang' ? ex * s.droop : 0
      const color = s.kind === 'solid' || s.droop < 0.1 ? tint((s.x0 + s.x1) / 2, l.y0) : droopTint(s.droop)
      const wide = s.kind === 'hang' && s.droop >= 0.1 && s.x1 - s.x0 < minW
      out.push({ x0: wide ? s.x1 - minW : s.x0, x1: s.x1, y0: Math.max(0, l.y0 - dy), y1: l.y0 + th, z0, z1, color })
    }
  })
  return out
}
const LAYER_HS = { '0.12': '0.12 mm layers', '0.2': '0.2 mm layers', '0.28': '0.28 mm layers' }
const layerH = (p: Params) => Number(pick(LAYER_HS, p.h, '0.2'))

// --- Overhangs and bridges ---

const ohParams = (p: Params) => ({ deg: n(p, 'deg'), L: n(p, 'len'), fan: n(p, 'fan'), h: layerH(p) })
const ohKey = (p: Params) => `${p.deg} ${p.len} ${p.fan} ${p.h}`
const ohRun = memoBy(ohKey, (p: Params) => {
  const q = ohParams(p)
  return { q, V: overhangView(q.deg, q.h, q.fan, q.L, 30) }
})
const OH = { k: 0.3, kb: 0.22, depth: 20 }

export const designForPrintingOverhangsAndBridges: Lesson = {
  id: 'design-for-printing-overhangs-and-bridges',
  title: 'Overhangs and bridges',
  tagline: 'How far each layer may hang, and how far a strand may span',
  formula: (p) => {
    const { q, V } = ohRun(p)
    return `hang per layer = h × tan θ = ${fixedText(q.h, 2)} × tan ${q.deg}° = ${mmFixed(V.hangMm, 2)} = ${pct(V.share)} of the ${LINE_W} mm line · clean while ≤ ${pct(0.35 + 0.4 * q.fan)} (fan) → up to ${degText(V.clean, 0)} · bridge sag ∝ L² = ${mmFixed(V.sag, 2)}, typical`
  },
  legend: [
    { color: PRINT_TINT, label: 'Printed layers (sliced at your layer height)', shape: 'dot' },
    { color: RING, label: 'Droop 0.1 to 0.5 mm (drawn 3×)', shape: 'dot' },
    { color: HIGH_V, label: 'Droop over 0.5 mm: needs support', shape: 'dot' },
    { color: GREY, label: 'Steepest clean angle here', shape: 'dot' },
  ],
  points: [
    'Each layer can only sit partly on the one below. Lean a wall θ from vertical and every layer steps out h × tan θ. While that is under about half the line width the bead still rests on its neighbour; past it the outer edge has nothing under it and curls down, and the next layer lands on the curl.',
    'That is where the 45° rule comes from (Slicing > Supports): at 0.2 mm layers 45° hangs 44 % of a 0.45 mm line. Thin layers and a strong part fan (Temperature & cooling > Part cooling fan) push the limit towards 60–70°; no fan pulls it under 45°.',
    'A bridge is different: both ends are held, so the strand is pulled straight across the gap and only sags in the middle, roughly with the square of its length. Slicers print bridges slower with full fan; 10–30 mm is easy, 50 mm and more wants testing (the overhang tabs on a tower test print show the same thing: Calibration > Temperature tower).',
    'Design it away first: lean faces at 45° or less, turn a ledge into a chamfer, split the part, or turn it over (Orientation and strength). Holes are the classic case (Holes and teardrops).',
  ],
  controls: [
    { kind: 'slider', key: 'deg', label: 'Overhang from vertical', min: 0, max: 75, step: 5, initial: 60, format: (v) => `${v}°` },
    { kind: 'slider', key: 'len', label: 'Bridge length', min: 5, max: 60, step: 5, initial: 30, format: (v) => mmFixed(v, 0) },
    { kind: 'slider', key: 'fan', label: 'Part cooling fan', min: 0, max: 1, step: 0.1, initial: 1, format: pct },
    { kind: 'choice', key: 'h', options: opts(LAYER_HS), initial: '0.2' },
  ],
  build(): Stage {
    const c = printStage('edge droop vs overhang angle', '0°', `${OVERHANG_SWEEP[OVERHANG_SWEEP.length - 1]}°`)
    const { scene, head, rows, plot } = c
    const { k, kb, depth } = OH
    const wedge = c.bench([-13.6, 0.4, 0], k, 50, depth + 6, 400)
    const deck = c.bench([-15.4, -11.2, 0], kb, 74, depth + 6, 700)
    const wLabel = liveLabel(wedge.g, [0, 0, 0], { size: 0.34, align: 'left' })
    const dLabel = liveLabel(deck.g, [0, 0, 0], { size: 0.34 })
    const S = plot.s
    const tr = S.trace(HEAT, { samples: OVERHANG_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const clean = cursorBar(S, GREY, 0.04)
    const fail = S.level(HIGH_V)
    const top = OVERHANG_SWEEP[OVERHANG_SWEEP.length - 1]
    const py = c.py(0, 2.5)
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = ohRun(p)
        if (key !== ohKey(p)) {
          key = ohKey(p)
          wedge.slabs.set(layerSlabs(V.wedge, -depth / 2, depth / 2))
          deck.slabs.set(layerSlabs(V.deck, -depth / 2, depth / 2))
          const lean = OVERHANG.heightMm * Math.tan((q.deg * Math.PI) / 180)
          wLabel.group.position.set((OVERHANG.baseMm + lean + 1.5) * k, OVERHANG.heightMm * k, (depth / 2) * k)
          dLabel.group.position.set((BRIDGE_TEST.postMm + q.L / 2) * kb, (BRIDGE_TEST.heightMm + BRIDGE_TEST.deckMm + 2.5) * kb, (depth / 2) * kb)
        }
        wLabel.set(`${q.deg}°: ${mmFixed(V.droop, 2)}`, droopTint(V.droop) === PRINT_TINT ? POWER : droopTint(V.droop))
        dLabel.set(`bridge ${mmFixed(q.L, 0)}: sag ${mmFixed(V.sag, 2)}`, droopTint(V.sag) === PRINT_TINT ? POWER : droopTint(V.sag))
        tr.points(OVERHANG_SWEEP.map((a) => a / top), V.curve.map((d) => py(Math.min(2.5, d))), null)
        cur(q.deg / top)
        clean(Math.min(1, V.clean / top))
        fail.set(py(0.5))
        plot.right.set(`${q.deg}°: ${mmFixed(V.droop, 2)}`, RING)
        const ok = V.droop < 0.1
        rows[0].set(`Each layer hangs ${mmFixed(V.hangMm, 2)} = ${pct(V.share)} of the line`, ok ? POWER : HEAT)
        rows[1].set(`Clean up to about ${degText(V.clean, 0)} with fan ${pct(q.fan)} at ${q.h} mm`, LABEL)
        rows[2].set(`Bridge ${mmFixed(q.L, 0)} at 30 mm/s: sag ${mmFixed(V.sag, 2)}, typical`, V.sag < 0.5 ? POWER : HIGH_V)
        head.status.set(`Overhang ${q.deg}° · bridge ${mmFixed(q.L, 0)}`)
        head.sub.set(`sections ${depth} mm deep, droop drawn ${EX}×`, GREY)
        head.event.set(V.droop > 0.5 ? 'overhang needs support or a redesign' : V.droop > 0.1 ? 'rough underside' : 'prints clean', V.droop > 0.5 ? HIGH_V : V.droop > 0.1 ? RING : POWER)
      },
      readouts: (p) => {
        const { q, V } = ohRun(p)
        return [
          { label: 'Hang / line', value: pct(V.share), tone: toneOf(V.share <= 0.35 + 0.4 * q.fan, V.share < 1) },
          { label: 'Clean up to', value: degText(V.clean, 0) },
          { label: 'Droop', value: mmFixed(V.droop, 2), tone: toneOf(V.droop < 0.1, V.droop < 0.5) },
          { label: 'Bridge sag', value: mmFixed(V.sag, 2), tone: toneOf(V.sag < 0.2, V.sag < 0.5) },
        ]
      },
    }
  },
}

// --- Orientation and strength ---

const OR_NAMES = namesOf(ORIENTS)
const orParams = (p: Params) => ({ o: pick(ORIENTS, p.o, 'flat') as OrientKey, F: n(p, 'load') })
const orKey = (p: Params) => `${p.o} ${p.load}`
const orRun = memoBy(orKey, (p: Params) => {
  const q = orParams(p)
  return { q, V: orientView(q.o, q.F) }
})
const OR = { k: 0.27, every: 5 }
const ORDER = Object.keys(ORIENTS) as OrientKey[]

export const designForPrintingOrientationAndStrength: Lesson = {
  id: 'design-for-printing-orientation-and-strength',
  title: 'Orientation and strength',
  tagline: 'Turn the part so the load runs along the layers',
  formula: (p) => {
    const { V } = orRun(p)
    const a = V.cur
    return `σ = 6 F L / (b t²) = ${fixedText(a.sigma / 1e6, 1)} MPa · strength = ${fixedText(MATERIALS.pla.utsPa / 1e6, 0)} MPa × ${BRACKET_L.zFrac} / (${BRACKET_L.zFrac} cos² + sin²) at ${a.loadDeg}° to the layers = ${fixedText(a.strength / 1e6, 1)} MPa → SF ${fixedText(a.sf, 2)} · score = strength, support, finish, time, typical`
  },
  legend: [
    { color: POWER, label: 'Strength vs load angle to the layers', shape: 'dot' },
    { color: HIGH_V, label: 'Stress this load needs', shape: 'dot' },
    { color: RING, label: 'This orientation', shape: 'dot' },
    { color: SUPPORT, label: 'Support', shape: 'dot' },
  ],
  points: [
    'Layers bond to each other less well than a line bonds along itself, so a print pulled straight across its layers breaks at roughly half the strength (why, and how to raise it, is in Strength > Layer adhesion). Design and orientation decide which way the load runs.',
    'Here a PLA L bracket carries a load at the tip of its upright. Bending puts the inside face in tension, most at the corner. Printed flat as it is used, that tension pulls straight across the layers of the upright; on its side the same tension runs along the lines.',
    'Strength is not the only score: standing it on its end puts the base in the air and needs support, a 45° corner avoids support but leaves stair steps on every face, and tall prints take longer (more layer changes). The bars weigh all four; on its side wins here, with its screw holes now horizontal, so make them teardrops (Holes and teardrops).',
    'When no orientation suits every load, split the part and bolt it, or add a fillet and more walls at the corner (Chamfers vs fillets, Strength > Wall count vs infill). Loads from Materials > Stress & strain.',
  ],
  controls: [
    { kind: 'choice', key: 'o', options: opts(OR_NAMES), initial: 'flat' },
    { kind: 'slider', key: 'load', label: 'Load at the upright tip', min: 5, max: 60, step: 5, initial: 30, format: (v) => `${v} N` },
  ],
  build(): Stage {
    const c = printStage('PLA strength vs load angle to the layers', '0° (along)', '90° (across)', { title: 'Score per orientation (strength, support, finish, time)', names: ORDER.map((o) => ORIENTS[o].name) })
    const { scene, head, rows, plot, tally } = c
    const { k, every } = OR
    const B = BRACKET_L
    const bench = c.bench([-12.4, -11.6, 0], k, 46, 34, 600, -0.55)
    const load = stretchArrow(bench.g, HIGH_V, 0.09)
    const tag = liveLabel(bench.g, [0, 0, 0], { size: 0.34, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: LOAD_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const need = S.level(HIGH_V)
    const py = c.py(0, 1.2)
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = orRun(p)
        const a = V.cur
        const ratio = a.sigma / a.strength
        if (key !== orKey(p)) {
          key = orKey(p)
          const O = ORIENTS[q.o]
          let slabs: Slab[]
          if (q.o === 'side') {
            slabs = []
            for (let y = 0; y < B.b; y += every * 0.2) {
              const th = every * 0.2 * 0.82
              for (let v = 0; v < B.up; v += 2) {
                const share = v > B.t ? (B.up - v) / (B.up - B.t) : 1
                slabs.push({ x0: 0, x1: B.t, y0: y, y1: y + th, z0: -v - 2, z1: -v, color: `#${stressColor(ratio * share).getHexString()}` })
              }
              for (let u = B.t; u < B.base; u += 2) slabs.push({ x0: u, x1: u + 2, y0: y, y1: y + th, z0: -B.t, z1: 0, color: `#${stressColor(ratio * Math.max(0, 1 - (u - B.t) / (B.base - B.t - 5))).getHexString()}` })
            }
            const tip: V3 = [B.t / 2, B.b / 2, -B.up + 1]
            load([(tip[0] + 14) * k, tip[1] * k, tip[2] * k], [(tip[0] + 2) * k, tip[1] * k, tip[2] * k])
            tag.group.position.set((B.base + 2) * k, (B.b + 3) * k, 0)
          } else {
            slabs = layerSlabs(a.sl, -B.b / 2, B.b / 2, every, (x, y) => `#${stressColor(ratio * bracketMoment(O.deg, [x, y])).getHexString()}`)
            for (const l of a.sl) for (const s of l.segs) if (s.kind === 'hang' && s.droop > 0.5) for (let x = s.x0 + 1; x < s.x1; x += 3) slabs.push({ x0: x, x1: x + 0.6, y0: 0, y1: l.y0, z0: -B.b / 2 + 1, z1: B.b / 2 - 1, color: SUPPORT })
            const tip = bracketPoint(O.deg, [0, B.up - 1])
            const from = bracketPoint(O.deg, [-12, B.up - 1])
            load([from[0] * k, from[1] * k, (B.b / 2) * k], [tip[0] * k, tip[1] * k, (B.b / 2) * k])
            tag.group.position.set((tip[0] + 3) * k, (tip[1] + 4) * k, (B.b / 2) * k)
          }
          bench.slabs.set(slabs)
        }
        tag.set(`SF ${fixedText(a.sf, 2)}`, a.sf >= 2 ? POWER : a.sf >= 1 ? RING : HIGH_V)
        tr.points(LOAD_SWEEP.map((d) => d / 90), V.curve.map(py), null)
        cur(a.loadDeg / 90)
        need.set(py(Math.min(1.2, a.sigma / MATERIALS.pla.utsPa)))
        plot.right.set(`${a.loadDeg}°: ${fixedText(a.strength / 1e6, 0)} MPa`, RING)
        tally?.set(V.scores, V.scores.map((s) => pct(s)), ORDER.map((o) => (o === V.best ? POWER : o === q.o ? RING : GREY)), 1)
        rows[0].set(`Tension at ${a.loadDeg}° to the layers: ${fixedText(a.sigma / 1e6, 1)} of ${fixedText(a.strength / 1e6, 1)} MPa`, a.sf >= 2 ? POWER : a.sf >= 1 ? RING : HIGH_V)
        rows[1].set(`Support ${fixedText(a.supportMm3 / 1000, 1)} cm³ · ${Math.round(a.timeMin)} min · ${Math.round(a.height)} mm tall, typical`, a.supportMm3 > 0 ? HEAT : LABEL)
        rows[2].set(q.o === V.best ? 'Best score of the four' : `Best here: ${ORIENTS[V.best].name.toLowerCase()}`, q.o === V.best ? POWER : RING)
        head.status.set(`L bracket · ${ORIENTS[q.o].name.toLowerCase()}`)
        head.sub.set(`PLA, ${B.t} mm walls, ${q.F} N at the tip; layers drawn ${every}× thick`, GREY)
        head.event.set(a.sf < 1 ? 'snaps between layers' : a.sf < 2 ? 'holds, little margin' : 'strong enough', a.sf < 1 ? HIGH_V : a.sf < 2 ? RING : POWER)
      },
      readouts: (p) => {
        const { q, V } = orRun(p)
        const a = V.cur
        return [
          { label: 'Safety factor', value: fixedText(a.sf, 2), tone: toneOf(a.sf >= 2, a.sf >= 1) },
          { label: 'Support', value: `${fixedText(a.supportMm3 / 1000, 1)} cm³`, tone: toneOf(a.supportMm3 === 0, false) },
          { label: 'Print time', value: `${Math.round(a.timeMin)} min` },
          { label: 'Score', value: pct(V.scores[ORDER.indexOf(q.o)]), tone: toneOf(q.o === V.best, true) },
        ]
      },
    }
  },
}

// --- Tolerances and fits ---

const fitParams = (p: Params) => ({ clear: n(p, 'clear'), shrink: n(p, 'shrink'), fix: pick(FOOT_FIXES, p.fix, 'none') as FootFix })
const fitKey = (p: Params) => `${p.clear} ${p.shrink} ${p.fix}`
const fitRun = memoBy(fitKey, (p: Params) => {
  const q = fitParams(p)
  return { q, V: fitView(q.clear, q.shrink, q.fix) }
})
const TF = { kg: 0.24, ks: 0.5, exg: 20, wall: 5, H: 10, layer: 0.5 }

export const designForPrintingTolerancesAndFits: Lesson = {
  id: 'design-for-printing-tolerances-and-fits',
  title: 'Tolerances and fits',
  tagline: 'Holes print small: draw the gap you need',
  formula: (p) => {
    const { q, V } = fitRun(p)
    return `printed gap = CAD clearance − hole shrink − pin growth = ${mmFixed(q.clear, 2)} − ${mmFixed(q.shrink, 2)} − ${mmFixed(FIT.pinGrowMm, 2)} = ${mmFixed(V.gap, 2)} · mouth = gap − 2 × foot ${mmFixed(V.foot, 2)} = ${mmFixed(V.mouth, 2)} · slide fit: draw ${mmFixed(V.slideCad, 2)}, typical`
  },
  legend: [
    { color: FIT_TINT.press, label: 'Press', shape: 'dot' },
    { color: FIT_TINT.snug, label: 'Snug', shape: 'dot' },
    { color: FIT_TINT.slide, label: 'Slide', shape: 'dot' },
    { color: FIT_TINT.loose, label: 'Loose (red: will not go in)', shape: 'dot' },
  ],
  points: [
    'Draw an 8 mm pin and an 8 mm hole and they will not go together. A printed hole comes out smaller than drawn: the mesh cuts corners (CAD basics > Exporting STL), the inner wall bead squashes inwards, and the plastic shrinks towards the middle as it cools. Outside faces grow a little the other way.',
    'So the CAD clearance (hole minus pin diameter) has to cover the shrink first. On a typical tuned printer: 0 to 0.1 mm printed gap is snug, about 0.2 mm slides and turns, over 0.3 mm wobbles; below zero is a press fit. Press fits for bearings are in Bearings; laser-cut tabs follow the same classes (Laser & CNC > Kerf).',
    'The first layers are squashed wider (Print problems > Elephant foot), so a hole that starts on the bed is tightest at its mouth: the pin jams at the entry even when the rest would slide. A 0.5 mm chamfer at the mouth or the slicer\'s elephant-foot compensation fixes that.',
    'Every printer and filament shrinks differently, so print a fit gauge (a row of holes 0.1 mm apart, like the one shown) once and read off which clearance gives the fit you want. Screw clearance and tap holes are in Fasteners.',
  ],
  controls: [
    { kind: 'slider', key: 'clear', label: 'Clearance in CAD (diameter)', min: 0, max: 0.6, step: 0.05, initial: 0.2, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'shrink', label: 'Holes print undersize by', min: 0, max: 0.3, step: 0.05, initial: 0.1, format: (v) => mmFixed(v, 2) },
    { kind: 'choice', key: 'fix', options: opts(FOOT_FIXES), initial: 'none' },
  ],
  build(): Stage {
    const c = printStage('gap, mouth (red) vs clearance', '0 mm', `${CLEAR_SWEEP[CLEAR_SWEEP.length - 1]} mm`)
    const { scene, head, rows, plot } = c
    const { kg, ks, exg, wall, H, layer } = TF
    const R = FIT.pinMm / 2
    const gauge = add(scene, new THREE.Group(), [-9.4, -1.6, 0])
    gauge.rotation.set(0.12, -0.2, 0)
    const pitch = 11
    const W = pitch * FIT.gauge.length
    const shape = new THREE.Shape()
    shape.moveTo((-W / 2) * kg, -8 * kg)
    shape.lineTo((W / 2) * kg, -8 * kg)
    shape.lineTo((W / 2) * kg, 8 * kg)
    shape.lineTo((-W / 2) * kg, 8 * kg)
    const holeX = (i: number) => (-W / 2 + pitch * (i + 0.5)) * kg
    FIT.gauge.forEach((cad, i) => {
      const h = new THREE.Path()
      h.absarc(holeX(i), 0, ((FIT.pinMm + cad) / 2) * kg, 0, Math.PI * 2, true)
      shape.holes.push(h)
    })
    add(gauge, new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 5 * kg, bevelEnabled: false }), mat(PRINT_TINT, { rough: 0.55 })), [0, 0, -5 * kg])
    const rings = FIT.gauge.map((cad, i) => {
      const m = glowMat(GREY, 0.8)
      const t = add(gauge, new THREE.Mesh(new THREE.TorusGeometry(((FIT.pinMm + cad) / 2 + 0.6) * kg, 0.05, 8, 32), m), [holeX(i), 0, 0.05])
      t.castShadow = false
      addLabel(gauge, fixedText(cad, 1), [holeX(i), 10 * kg, 0.1], GREY, 0.3)
      return { m, name: liveLabel(gauge, [holeX(i), -10.5 * kg, 0.1], { size: 0.28 }) }
    })
    addLabel(gauge, 'fit gauge: CAD clearance, mm', [(-W / 2) * kg, 13.5 * kg, 0.1], LABEL, 0.3, 'left')
    const pin = cylinder(gauge, R * kg, 12 * kg, mat('#c9ced8', { rough: 0.4 }), [0, 0, 1 * kg], 'z', 24)
    const sec = add(scene, new THREE.Group(), [-11.4, -13, 0])
    sec.rotation.set(0.2, -0.3, 0)
    box(sec, [(2 * (R + wall) + 6) * ks, 0.3, 10 * ks], mat('#3a3f47', { rough: 0.6 }), [0, -0.15, 0])
    const slabs = sliceSlabs(sec, [0, 0, 0], ks, 200)
    addLabel(sec, `section, gap drawn ${exg}×`, [(-R - wall) * ks, (H + 5.4) * ks, 0], GREY, 0.28, 'left')
    const mouthTag = liveLabel(sec, [(R + wall + 0.8) * ks, 0.6 * ks, 0], { size: 0.28, align: 'left' })
    const bodyTag = liveLabel(sec, [(R + wall + 0.8) * ks, (H * 0.6) * ks, 0], { size: 0.28, align: 'left' })
    const S = plot.s
    const gapTr = S.trace(POWER, { samples: CLEAR_SWEEP.length, radius: 0.06 })
    const mouthTr = S.trace(HIGH_V, { samples: CLEAR_SWEEP.length, radius: 0.05 })
    const cur = cursorBar(S, RING, 0.06)
    const lv = [S.level(GREY), S.level(GREY), S.level(GREY)]
    const top = CLEAR_SWEEP[CLEAR_SWEEP.length - 1]
    const py = c.py(-0.6, 0.6)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = fitRun(p)
        V.gauge.forEach((g, i) => {
          rings[i].m.color.set(FIT_TINT[g.fit])
          rings[i].m.emissive.set(FIT_TINT[g.fit])
          rings[i].name.set(g.fit, FIT_TINT[g.fit])
        })
        const near = V.gauge.reduce((b, g, i) => (Math.abs(g.cad - q.clear) < Math.abs(V.gauge[b].cad - q.clear) ? i : b), 0)
        pin.position.x = holeX(near)
        const out: Slab[] = [{ x0: -R, x1: R, y0: FOOT.layers * 0.2, y1: H + 1.5, z0: -4, z1: 4, color: '#c9ced8' }]
        const mouthTop = FOOT.layers * 0.2
        for (let y = 0; y < H; y += layer) {
          const g = y < mouthTop ? V.mouth : V.gap
          const r = R + (exg * g) / 2
          const color = FIT_TINT[y < mouthTop ? V.entry : V.fit]
          out.push({ x0: -R - wall, x1: -r, y0: y, y1: y + layer * 0.82, z0: -4, z1: 4, color }, { x0: r, x1: R + wall, y0: y, y1: y + layer * 0.82, z0: -4, z1: 4, color })
        }
        slabs.set(out)
        mouthTag.set(`mouth ${mmFixed(V.mouth, 2)}`, FIT_TINT[V.entry])
        bodyTag.set(`gap ${mmFixed(V.gap, 2)}`, FIT_TINT[V.fit])
        gapTr.points(CLEAR_SWEEP.map((x) => x / top), V.curve.map(py), null)
        mouthTr.points(CLEAR_SWEEP.map((x) => x / top), V.curve.map((g) => py(Math.max(-0.6, g - 2 * V.foot))), null)
        cur(q.clear / top)
        lv[0].set(py(0))
        lv[1].set(py(0.1))
        lv[2].set(py(0.3))
        plot.right.set(`${mmFixed(q.clear, 2)}: ${mmFixed(V.gap, 2)}`, RING)
        rows[0].set(`Printed gap ${mmFixed(V.gap, 2)}: ${FIT_CLASSES[V.fit]}`, FIT_TINT[V.fit])
        rows[1].set(`At the mouth ${mmFixed(V.mouth, 2)}: ${FIT_CLASSES[V.entry]}`, FIT_TINT[V.entry])
        rows[2].set(`For a slide fit on this printer draw ${mmFixed(V.slideCad, 2)} clearance`, LABEL)
        head.status.set(`${FIT.pinMm} mm pin in a printed hole`)
        head.sub.set(`holes ${mmFixed(q.shrink, 2)} undersize, pins ${mmFixed(FIT.pinGrowMm, 2)} over, typical`, GREY)
        head.event.set(V.entry === 'stuck' && V.fit !== 'stuck' ? 'jams at the mouth: elephant foot' : FIT_CLASSES[V.fit], V.entry === 'stuck' ? HIGH_V : FIT_TINT[V.fit])
      },
      readouts: (p) => {
        const { V } = fitRun(p)
        return [
          { label: 'Printed gap', value: mmFixed(V.gap, 2), tone: toneOf(V.fit === 'slide' || V.fit === 'snug', V.fit !== 'stuck') },
          { label: 'Fit', value: V.fit },
          { label: 'Mouth', value: mmFixed(V.mouth, 2), tone: toneOf(V.entry === V.fit, V.entry !== 'stuck') },
          { label: 'Slide fit: draw', value: mmFixed(V.slideCad, 2) },
        ]
      },
    }
  },
}

// --- Holes and teardrops ---

const hoParams = (p: Params) => ({ shape: pick(HOLE_SHAPES, p.shape, 'round') as HoleShape, d: n(p, 'd'), h: layerH(p) })
const hoKey = (p: Params) => `${p.shape} ${p.d} ${p.h}`
const hoRun = memoBy(hoKey, (p: Params) => {
  const q = hoParams(p)
  return { q, V: holeView(q.shape, q.d, q.h) }
})
const HO = { k: 0.56, depth: 6 }

export const designForPrintingHolesAndTeardrops: Lesson = {
  id: 'design-for-printing-holes-and-teardrops',
  title: 'Holes and teardrops',
  tagline: 'Give a sideways hole a pointed roof',
  formula: (p) => {
    const { q, V } = hoRun(p)
    return `round roof: overhang → 90° at the top, last layers bridge the gap → droop ${mmFixed(V.roof, 2)} · teardrop/diamond roof at 45° · vertical hole ≈ d cos(180°/n) − 2 × squish = ${q.d} × cos(180°/${V.n}) − ${fixedText(2 * HOLE.squishMm, 1)} = ${mmFixed(V.vertical, 2)}, typical`
  },
  legend: [
    { color: PRINT_TINT, label: 'Printed layers', shape: 'dot' },
    { color: RING, label: 'Roof droop 0.1 to 0.5 mm (drawn 3×)', shape: 'dot' },
    { color: HIGH_V, label: 'Roof droop over 0.5 mm', shape: 'dot' },
    { color: GREY, label: 'Hole as drawn', shape: 'dot' },
  ],
  points: [
    'A hole through a wall that stands on the bed is a sideways hole. Its lower half prints fine, but towards the top the wall leans past 45°, reaching flat at the very top, and the last layers have to bridge the gap (Overhangs and bridges). The roof droops into the hole and a screw or shaft no longer fits.',
    'Teardrop: replace the top of the circle with two 45° lines meeting in a point. Every layer stays within the overhang limit and the round part still centres a screw. A flat-topped teardrop saves height with a short bridge; a diamond is all 45° and fine for clearance holes. Supports inside a small hole are hard to get out.',
    'Vertical holes (axis up) have no roof but come out small: the STL turns the circle into a polygon whose flats sit inside it (CAD basics > Exporting STL), and the inner wall squashes inwards. Draw them bigger (Tolerances and fits) or drill or ream them to size, which also gives a cleaner bore for a bearing or shaft.',
  ],
  controls: [
    { kind: 'choice', key: 'shape', options: opts(HOLE_SHAPES), initial: 'round' },
    { kind: 'slider', key: 'd', label: 'Hole diameter', min: 3, max: 16, step: 1, initial: 10, format: (v) => mmFixed(v, 0) },
    { kind: 'choice', key: 'h', options: opts(LAYER_HS), initial: '0.2' },
  ],
  build(): Stage {
    const c = printStage('roof droop vs hole diameter', `${HOLE_SWEEP[0]} mm`, `${HOLE_SWEEP[HOLE_SWEEP.length - 1]} mm`)
    const { scene, head, rows, plot } = c
    const { k, depth } = HO
    const b = c.bench([-15.4, -12.6, 0], k, HOLE.plateW + 8, depth + 8, 1200, -0.15)
    const nominal = add(b.g, new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 48), glowMat(GREY, 0.8)))
    nominal.castShadow = false
    const tag = liveLabel(b.g, [(HOLE.plateW + 1.5) * k, 0, (depth / 2) * k], { size: 0.32, align: 'left' })
    const S = plot.s
    const tr = S.trace(HEAT, { samples: HOLE_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const fail = S.level(HIGH_V)
    const [lo, hi] = [HOLE_SWEEP[0], HOLE_SWEEP[HOLE_SWEEP.length - 1]]
    const py = c.py(0, 1.2)
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = hoRun(p)
        if (key !== hoKey(p)) {
          key = hoKey(p)
          b.slabs.set(layerSlabs(V.layers, -depth / 2, depth / 2))
          nominal.position.set((HOLE.plateW / 2) * k, V.cy * k, (depth / 2 + 0.2) * k)
          nominal.scale.set((q.d / 2) * k, (q.d / 2) * k, 1)
          tag.group.position.y = (V.cy + q.d / 2) * k
        }
        tag.set(`roof ${mmFixed(V.roof, 2)}`, droopTint(V.roof) === PRINT_TINT ? POWER : droopTint(V.roof))
        tr.points(HOLE_SWEEP.map((d) => (d - lo) / (hi - lo)), V.curve.map((d) => py(Math.min(1.2, d))), null)
        cur((q.d - lo) / (hi - lo))
        fail.set(py(0.3))
        plot.right.set(`${mmFixed(q.d, 0)}: ${mmFixed(V.roof, 2)}`, RING)
        const bad = V.roof > 0.3
        rows[0].set(`${HOLE_SHAPES[q.shape]} ${mmFixed(q.d, 0)} sideways: roof droops ${mmFixed(V.roof, 2)}`, bad ? HIGH_V : V.roof > 0.1 ? RING : POWER)
        rows[1].set(`Clear height ${mmFixed(V.heightMm, 2)} (a ${mmFixed(q.d, 0)} screw needs ${mmFixed(q.d, 0)})`, V.heightMm < q.d ? HEAT : LABEL)
        rows[2].set(`Same hole upright: ${V.n}-gon, prints ${mmFixed(V.vertical, 2)}: drill to size`, LABEL)
        head.status.set(`Sideways hole · ${HOLE_SHAPES[q.shape].toLowerCase()}`)
        head.sub.set(`plate ${HOLE.plateW} mm wide, ${q.h} mm layers, droop drawn ${EX}×`, GREY)
        head.event.set(bad ? 'roof sags into the hole' : 'self-supporting roof', bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { q, V } = hoRun(p)
        return [
          { label: 'Roof droop', value: mmFixed(V.roof, 2), tone: toneOf(V.roof < 0.1, V.roof < 0.3) },
          { label: 'Clear height', value: mmFixed(V.heightMm, 2), tone: toneOf(V.heightMm >= q.d, V.heightMm >= q.d - 0.2) },
          { label: 'Upright hole', value: mmFixed(V.vertical, 2) },
          { label: 'STL facets', value: `${V.n}` },
        ]
      },
    }
  },
}

// --- Chamfers vs fillets ---

const edParams = (p: Params) => ({ bottom: pick(EDGE_KINDS, p.bottom, 'fillet') as EdgeKind, top: pick(EDGE_KINDS, p.top, 'fillet') as EdgeKind, inside: pick(EDGE_KINDS, p.inside, 'fillet') as EdgeKind, s: n(p, 's') })
const edKey = (p: Params) => `${p.bottom} ${p.top} ${p.inside} ${p.s}`
const edRun = memoBy(edKey, (p: Params) => {
  const q = edParams(p)
  return { q, V: edgeView(q.bottom, q.top, q.inside, q.s, 0.2) }
})
const ED = { k: 0.46, depth: 12, footEx: 5, ex: 8 }
const edgeName = (e: EdgeKind) => EDGE_KINDS[e].toLowerCase()

export const designForPrintingChamfersVsFillets: Lesson = {
  id: 'design-for-printing-chamfers-vs-fillets',
  title: 'Chamfers vs fillets',
  tagline: 'Chamfer the bed edges, fillet the rest',
  formula: (p) => {
    const { V } = edRun(p)
    return `bed edge droop ${mmFixed(V.droop, 2)} (overhang model) · foot left = bulge − chamfer = ${mmFixed(V.foot, 2)} · top stair step ${mmFixed(V.cusp, 2)} · inside corner Kt ≈ 1 + 0.6 √(t/r) = ${fixedText(V.kt, 2)} (max ${EDGE_PART.ktMax}), typical`
  },
  legend: [
    { color: HEAT, label: 'Bed-edge droop vs fillet size', shape: 'dot' },
    { color: POWER, label: 'Bed-edge droop vs chamfer size', shape: 'dot' },
    { color: RING, label: 'Your size', shape: 'dot' },
    { color: HIGH_V, label: 'Droop (drawn 8×), elephant foot (5×)', shape: 'dot' },
  ],
  points: [
    'On the edge that sits on the bed, a fillet starts nearly flat: its first layers step out far past each other, an overhang approaching 90°, so they curl down and the edge comes out ragged (Overhangs and bridges). A 45° chamfer steps out the same small amount every layer and prints clean.',
    'The chamfer also hides elephant foot: the squashed first layers bulge out into the space the chamfer took away, so the edge ends up straight (Print problems > Elephant foot). 0.5 mm is often enough; bigger looks deliberate.',
    'On top edges either works. A fillet there is an upward-facing curve; its shallow part shows stair steps like the top of a dome (Slicing > Layer height), a chamfer slightly less.',
    'Inside corners are about strength, not printing: a sharp corner concentrates stress about three times, a fillet spreads it, a chamfer only partly (Materials > Stress & strain). Fillet inside corners that carry load, like the root of a bracket (Orientation and strength).',
  ],
  controls: [
    { kind: 'choice', key: 'bottom', options: opts(EDGE_KINDS), initial: 'fillet' },
    { kind: 'choice', key: 'top', options: opts(EDGE_KINDS), initial: 'fillet' },
    { kind: 'choice', key: 'inside', options: opts(EDGE_KINDS), initial: 'fillet' },
    { kind: 'slider', key: 's', label: 'Edge size', min: 0, max: 4, step: 0.5, initial: 3, format: (v) => mmFixed(v, 1) },
  ],
  build(): Stage {
    const c = printStage('bed-edge droop vs edge size', '0 mm', `${EDGE_SWEEP[EDGE_SWEEP.length - 1]} mm`)
    const { scene, head, rows, plot } = c
    const { k, depth, footEx, ex } = ED
    const b = c.bench([-14.2, -10.4, 0], k, EDGE_PART.W + 10, depth + 6, 600, 0.45)
    const tagIn = liveLabel(b.g, [(EDGE_PART.W - EDGE_PART.t - 1.5) * k, (EDGE_PART.base + 7) * k, (depth / 2) * k], { size: 0.32, align: 'right' })
    const S = plot.s
    const fil = S.trace(HEAT, { samples: EDGE_SWEEP.length, radius: 0.06 })
    const ch = S.trace(POWER, { samples: EDGE_SWEEP.length, radius: 0.05 })
    const cur = cursorBar(S, RING, 0.06)
    const fail = S.level(HIGH_V)
    const top = EDGE_SWEEP[EDGE_SWEEP.length - 1]
    const py = c.py(0, 0.6)
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = edRun(p)
        if (key !== edKey(p)) {
          key = edKey(p)
          const slabs = layerSlabs(V.layers, -depth / 2, depth / 2, 1, undefined, ex, 3)
          if (V.foot > 0.02) {
            const first = V.layers[0].segs[0]
            slabs.push({ x0: first.x0 - footEx * V.foot, x1: first.x0 + 0.5, y0: 0, y1: 0.2, z0: -depth / 2 - footEx * V.foot, z1: depth / 2 + footEx * V.foot, color: HIGH_V })
          }
          b.slabs.set(slabs)
        }
        tagIn.set(`inside: Kt ${fixedText(V.kt, 1)}`, V.kt > 2.5 ? HIGH_V : V.kt > 2 ? RING : POWER)
        fil.points(EDGE_SWEEP.map((s) => s / top), V.curves.fillet.map((d) => py(Math.min(0.6, d))), null)
        ch.points(EDGE_SWEEP.map((s) => s / top), V.curves.chamfer.map((d) => py(Math.min(0.6, d))), null)
        cur(q.s / top)
        fail.set(py(0.1))
        plot.right.set(`${mmFixed(q.s, 1)}: ${mmFixed(V.droop, 2)}`, RING)
        rows[0].set(`Bed edge ${edgeName(q.bottom)}: droop ${mmFixed(V.droop, 2)}, foot ${mmFixed(V.foot, 2)}`, V.droop > 0.1 || V.foot > 0.05 ? HEAT : POWER)
        rows[1].set(`Top edge ${edgeName(q.top)}: stair steps up to ${mmFixed(V.cusp, 2)}`, LABEL)
        rows[2].set(`Inside corner ${edgeName(q.inside)}: stress × ${fixedText(V.kt, 1)}`, V.kt > 2.5 ? HIGH_V : V.kt > 2 ? RING : POWER)
        head.status.set(`Edges of a printed L · ${mmFixed(q.s, 1)}`)
        head.sub.set(`0.2 mm layers, droop drawn ${ex}×, foot ${footEx}×`, GREY)
        const good = V.droop <= 0.1 && V.foot <= 0.05
        head.event.set(good ? 'bed edge prints clean' : V.droop > 0.1 ? 'bed-edge fillet curls: chamfer it' : 'elephant foot shows: chamfer it', good ? POWER : HEAT)
      },
      readouts: (p) => {
        const { V } = edRun(p)
        return [
          { label: 'Droop', value: mmFixed(V.droop, 2), tone: toneOf(V.droop <= 0.1, V.droop < 0.3) },
          { label: 'Foot', value: mmFixed(V.foot, 2), tone: toneOf(V.foot <= 0.05, V.foot < 0.15) },
          { label: 'Top steps', value: mmFixed(V.cusp, 2) },
          { label: 'Inside Kt', value: fixedText(V.kt, 1), tone: toneOf(V.kt <= 2, V.kt <= 2.5) },
        ]
      },
    }
  },
}
