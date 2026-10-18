import * as THREE from 'three/webgpu'
import {
  FACES,
  Face,
  GRITS,
  PAINT,
  PAINT_COAT_SWEEP,
  PAINT_FINISHES,
  PAINT_PREPS,
  PAINT_PREP_KEYS,
  PaintFinish,
  PaintPrep,
  SAND,
  VAPOUR,
  VAPOUR_LAYERS,
  VAPOUR_MATS,
  VAPOUR_METHODS,
  VAPOUR_TIME_SWEEP,
  VapourMat,
  VapourMethod,
  FILAMENTS,
  paintView,
  ridgeProfile,
  sandAt,
  sandView,
  scratchUm,
  vapourView,
} from '../../core/physics'
import { fixedText, hoursText, mmFixed, niceCeil, pct } from '../../core/units'
import { add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, HEAT, HIGH_V, LABEL, POWER, RING, WIDE_VIEW, addLabel, cursorBar, liveLabel, memoBy, printPlotBoard, profileSlabs, shellMat, sliceSlabs } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const PLASTIC = '#ff8a3d'
const FILLER = '#9aa3ad'
const SECTION_W = 16
const umOf = (um: number, digits = 0) => `${fixedText(um, digits)} µm`
const minText = (m: number) => hoursText(m / 60)
const layerSlider = { kind: 'slider' as const, key: 'h', label: 'Layer height', min: 0.08, max: 0.32, step: 0.04, initial: 0.2, format: (v: number) => mmFixed(v, 2) }
const matNames = Object.fromEntries(VAPOUR_MATS.map((k) => [k, FILAMENTS[k].name])) as Record<VapourMat, string>

function postStage(plotTitle: string, lo: string, hi: string, bars: { title: string; names: readonly string[] }) {
  const scene = createStage({ span: 40 })
  const c = printPlotBoard(scene, plotTitle, lo, hi, bars)
  const g = add(scene, new THREE.Group(), [-17.2, -7.6, 0])
  g.rotation.set(0.32, 0.28, 0)
  const section = sliceSlabs(g, [0, 0, 0], 1, 520)
  return { scene, ...c, g, section }
}
/** Section x (scene) and y scale for a profile: 3 layers across SECTION_W. */
const sectionX = (u: readonly number[], period: number) => u.map((x) => (x / (period * SAND.periods)) * SECTION_W)

// --- Sanding and filling ---

const FACE_NAMES = Object.fromEntries(Object.entries(FACES).map(([k, v]) => [k, v.name])) as Record<Face, string>
const GRIT_NAMES = Object.fromEntries(GRITS.map((g) => [String(g), `${g} grit`])) as Record<string, string>
const sandParams = (p: Params) => ({ h: n(p, 'h'), face: pick(FACE_NAMES, p.face, 'wall') as Face, grit: Number(pick(GRIT_NAMES, p.grit, '400')), coats: n(p, 'coats') })
const sandKey = (p: Params) => `${p.h} ${p.face} ${p.grit} ${p.coats}`
const sandRunOf = memoBy(sandKey, (p: Params) => {
  const q = sandParams(p)
  return { q, V: sandView(q.h, q.face, q.grit, q.coats) }
})

export const postProcessingSandingAndFilling: Lesson = {
  id: 'post-processing-sanding-and-filling',
  title: 'Sanding and filling',
  tagline: 'Flatten the layer lines',
  formula: (p) => {
    const { q, V } = sandRunOf(p)
    const c = V.cur
    return `ridges ${umOf(c.p.rz)} = bead ${SAND.bead} × ${mmFixed(q.h, 2)}${c.p.cusp > 0 ? ` + stair ${umOf(c.p.cusp)}` : ''} (Ra ${umOf(c.p.rz > 0 ? c.raw : 0, 1)}) · filler ${q.coats} × ${SAND.coatUm} µm fills to ${umOf(c.fill)} · 80 → ${q.grit} grit: each grit cuts the last one's ${SAND.scratchK} / grit µm scratches → Ra ${umOf(c.ra, 1)} in ${minText(c.minutes)}, ${umOf(c.lossUm)} off each face, typical`
  },
  legend: [
    { color: POWER, label: 'Roughness Ra over the sanding run, 80 → 400', shape: 'dot' },
    { color: RING, label: 'Where you stop', shape: 'dot' },
    { color: PLASTIC, label: 'Printed plastic', shape: 'dot' },
    { color: FILLER, label: 'Filler primer', shape: 'dot' },
  ],
  points: [
    'Every printed face is ridged: each line is a rounded bead about as tall as the layer (How FDM works > Layer by layer), and a sloped or domed face adds the stair-step cusp of Slicing > Layer height. Thinner layers make smaller ridges before you touch the part.',
    'Sand coarse to fine. The first grit cuts the ridges flat but leaves its own scratches; each finer grit only has to remove the scratches of the one before (about 30 µm for 80, 6 µm for 400). Skipping grits leaves deep scratches that show through paint. Wet-sand from 240 up to keep PLA from smearing with heat.',
    'Filler primer is a thick sandable paint: it settles into the valleys, so you cut far less plastic and sand mostly soft filler. Two or three coats, sand, repeat on the deepest lines. Support scars (Slicing > Supports) and seams get a dab of spot putty first.',
    'Sanding takes material off: a fit designed with 0.15 mm of slide clearance (Design for printing > Tolerances and fits) loosens when you sand the mating faces. Sand show faces, mask fits and holes. Wear a dust mask; plastic and filler dust is fine enough to breathe in.',
  ],
  controls: [
    layerSlider,
    { kind: 'choice', key: 'face', options: opts(FACE_NAMES), initial: 'wall' },
    { kind: 'choice', key: 'grit', options: opts(GRIT_NAMES), initial: '400' },
    { kind: 'slider', key: 'coats', label: 'Filler primer coats', min: 0, max: 4, step: 1, initial: 0, format: (v) => `${v}` },
  ],
  build(): Stage {
    const c = postStage('roughness Ra vs sanding time', '0 min', 'all grits', { title: 'Minutes per grit, 20 cm² face', names: GRITS.map((g) => `${g}`) })
    const { scene, head: hd, rows, plot, tally, yTop, g, section } = c
    const block = add(g, new THREE.Group())
    box(block, [3.2, 0.9, 3.4], mat('#3b6fb6', { rough: 0.7 }), [0, 0.65, 0])
    const paperMat = mat('#c9b48a', { rough: 1 }, true)
    box(block, [3.2, 0.2, 3.4], paperMat, [0, 0.1, 0])
    const peak = box(g, [SECTION_W, 0.05, 0.05], mat('#ffffff', { opacity: 0.6 }), [SECTION_W / 2, 0, 1.6])
    addLabel(scene, '3 layers cut through, magnified', [-17.6, 2.4, 0.5], GREY, 0.28, 'left')
    const scaleTag = liveLabel(scene, [-17.6, 1.7, 0.5], { size: 0.28, color: GREY, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: 61, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    let t = 0
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = sandRunOf(p)
        const run = V.cur
        if (key !== sandKey(p)) {
          key = sandKey(p)
          t = 0
        }
        const loop = 10
        t = (t + dt) % (loop + 2)
        const sim = Math.min(run.minutes, (t / loop) * run.minutes)
        const at = sandAt(run, sim)
        const pr = run.p
        const top = Math.max(pr.rz, run.fill)
        const sy = 6.5 / Math.max(top, 40)
        const xs = sectionX(pr.u, pr.period)
        const plastic = at.y.map((y, i) => Math.min(y, pr.y[i]) * sy)
        section.set(profileSlabs(xs, [{ top: plastic, color: PLASTIC }, { top: at.y.map((y) => y * sy), color: FILLER }], -2.4, 4))
        const before = sim <= 0 && run.fill > 0
        if (before) section.set(profileSlabs(xs, [{ top: pr.y.map((y) => y * sy), color: PLASTIC }, { top: pr.y.map((y) => Math.max(y, run.fill) * sy), color: FILLER }], -2.4, 4))
        const sanding = at.step !== null && sim < run.minutes
        const wob = Math.sin(t * 9)
        block.position.set(SECTION_W / 2 + wob * 4.5, at.level * sy + (sanding ? 0 : 1.2), 0)
        paperMat.color.set(at.step ? (at.step.grit < 180 ? '#a8885a' : at.step.grit < 320 ? '#c9b48a' : '#6e7782') : '#c9b48a')
        peak.position.y = pr.rz * sy
        scaleTag.set(`heights exaggerated ${Math.round((sy * 1000) / (SECTION_W / (pr.period * SAND.periods)))}×, white line = printed peaks`)
        const all = V.all
        const raTop = niceCeil(Math.max(...V.curve, 1))
        const py = c.py(0, raTop)
        tr.points(V.ts.map((x) => x / all.minutes), V.curve.map((r) => py(Math.min(raTop, r))), null)
        cur(run.minutes / all.minutes)
        yTop.set(umOf(raTop))
        plot.hi.set(minText(all.minutes))
        plot.right.set(`${q.grit} grit: Ra ${umOf(run.ra, 1)}`, RING)
        tally?.set(all.steps.map((s) => s.minutes), all.steps.map((s) => `${fixedText(s.minutes, 1)} min`), all.steps.map((s) => (s.grit <= q.grit ? RING : GREY)))
        rows[0].set(`Printed: ridges ${umOf(pr.rz)}, Ra ${umOf(run.raw, 1)}${q.coats ? ` · filler up to ${umOf(run.fill)}` : ''}`, LABEL)
        rows[1].set(`Sanded to ${q.grit}: Ra ${umOf(run.ra, 1)}, ${umOf(run.lossUm)} off the face in ${minText(run.minutes)}`, run.ra < 3 ? POWER : run.ra < 8 ? RING : HEAT)
        rows[2].set(`${mmFixed(SAND.clearMm, 2)} slide fit, both faces sanded: gap ${mmFixed(run.gap, 2)} → ${run.fit}`, run.fit === run.fitBefore ? POWER : HIGH_V)
        hd.status.set(`${FACE_NAMES[q.face]}, ${mmFixed(q.h, 2)} layers · 80 → ${q.grit} grit${q.coats ? `, ${q.coats} filler coats` : ''}`)
        hd.sub.set(`time-lapse: ${minText(run.minutes)} of sanding in ${loop} s, at ${fixedText(sim, 1)} min`, GREY)
        hd.event.set(before ? 'filler primer settles into the valleys' : at.step && sanding ? `${at.step.grit} grit: cutting ${at.step === run.steps[0] ? 'the ridges flat' : `the ${umOf(scratchUm(run.steps[Math.max(0, run.steps.indexOf(at.step) - 1)].grit))} scratches`}` : 'done: wipe the dust off, check under a raking light', sanding ? HEAT : POWER)
      },
      readouts: (p) => {
        const { V } = sandRunOf(p)
        const r = V.cur
        return [
          { label: 'Ra', value: umOf(r.ra, 1), tone: toneOf(r.ra < 3, r.ra < 8) },
          { label: 'Time', value: minText(r.minutes) },
          { label: 'Face loss', value: umOf(r.lossUm), tone: toneOf(r.lossUm < 60, r.lossUm < 150) },
          { label: 'Fit', value: r.fit, tone: toneOf(r.fit === r.fitBefore, false) },
        ]
      },
    }
  },
}

// --- Vapour smoothing ---

const METHOD_NAMES = Object.fromEntries(Object.entries(VAPOUR_METHODS).map(([k, v]) => [k, v.name])) as Record<VapourMethod, string>
const vapParams = (p: Params) => ({ m: pick(matNames, p.m, 'asa') as VapourMat, method: pick(METHOD_NAMES, p.method, 'cold') as VapourMethod, min: n(p, 'min'), h: n(p, 'h') })
const vapKey = (p: Params) => `${p.m} ${p.method} ${p.min} ${p.h}`
const vapRun = memoBy(vapKey, (p: Params) => {
  const q = vapParams(p)
  return { q, V: vapourView(q.m, q.method, q.min, q.h) }
})

export const postProcessingVapourSmoothing: Lesson = {
  id: 'post-processing-vapour-smoothing',
  title: 'Vapour smoothing',
  tagline: 'Melt the surface glossy',
  formula: (p) => {
    const { q, V } = vapRun(p)
    if (!V.works) return `${V.name}: acetone does not dissolve it, nothing happens (ridges stay ${umOf(V.a0)}) · smooth ABS / ASA this way, sand or fill the rest`
    return `skin d = √(D t) = ${umOf(V.skin)} after ${q.min} min · ridge A = A0 e^(−σ q⁴ ∫d³ dt / 3η), q = 2π / ${mmFixed(q.h, 2)} → ${umOf(V.a0)} → ${umOf(V.ridge, 1)} · edges round to r ≈ ${VAPOUR.edgeK} d = ${umOf(V.edgeUm)}, typical`
  },
  legend: [
    { color: POWER, label: 'Layer ridge left vs time in the vapour', shape: 'dot' },
    { color: HEAT, label: 'Edge rounding radius', shape: 'dot' },
    { color: RING, label: 'Your exposure', shape: 'dot' },
  ],
  points: [
    'ABS and ASA dissolve in acetone. In a closed jar the vapour soaks a thin skin of the part until it is soft enough to flow, and surface tension pulls the ridges flat, like paint levelling. The part comes out glossy and the layers fuse a little more at the surface.',
    'The pull scales with 1 / wavelength⁴: fine layer lines vanish in minutes, coarse ones take far longer, and big dents or support scars never level. Print the layers you want to hide fine and the part dense (Slicing > Layer height).',
    'The skin keeps growing, so so do the side effects: sharp edges round over, small text and fine holes fill in, and a soaked thin wall softens, sags and warps. Pull the part as soon as it is glossy and let it harden a day before handling; tolerances shift too (Design for printing > Tolerances and fits).',
    'Only some plastics: PLA and PETG shrug off acetone (Filaments > Material properties), so sand and paint those instead. Acetone vapour is highly flammable and heavier than air: no flames or heaters near the jar, work outside or with ventilation, and never heat acetone on a hot plate.',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(matNames), initial: 'asa' },
    { kind: 'choice', key: 'method', options: opts(METHOD_NAMES), initial: 'cold' },
    { kind: 'slider', key: 'min', label: 'Time in the vapour', min: 0, max: VAPOUR.maxMin, step: 1, initial: 15, format: (v) => `${v} min` },
    layerSlider,
  ],
  build(): Stage {
    const c = postStage('ridge and edge radius vs time', '0 min', `${VAPOUR.maxMin} min`, { title: 'Ridge left by layer height', names: VAPOUR_LAYERS.map((h) => mmFixed(h, 2)) })
    const { scene, head: hd, rows, plot, tally, yTop, g, section } = c
    const vap = shellMat('#c6e3ff', 0.12)
    const jar = box(g, [SECTION_W, 9, 0.05], vap, [SECTION_W / 2, 1, -2.6])
    jar.castShadow = false
    addLabel(scene, 'edge and 6 layers cut through, magnified (edge drawn true shape)', [-17.6, 2.4, 0.5], GREY, 0.28, 'left')
    const tag = liveLabel(scene, [-17.6, 1.7, 0.5], { size: 0.28, align: 'left' })
    const S = plot.s
    const trR = S.trace(POWER, { samples: VAPOUR_TIME_SWEEP.length, radius: 0.06 })
    const trE = S.trace(HEAT, { samples: VAPOUR_TIME_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    let t = 0
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = vapRun(p)
        if (key !== vapKey(p)) {
          key = vapKey(p)
          t = 0
        }
        const loop = 7
        t = (t + dt) % (loop + 2)
        const simMin = q.min * Math.min(1, t / loop)
        const now = vapourView(q.m, q.method, simMin, q.h)
        const pr = ridgeProfile(q.h, 'wall')
        const L1 = pr.period * SAND.periods
        const us = [...pr.u, ...pr.u.map((u) => u + L1)]
        const ys = [...pr.y, ...pr.y]
        const L = 2 * L1
        const sx = SECTION_W / L
        const xs = us.map((u) => u * sx)
        const sy = 5.5 / Math.max(pr.rz, 40)
        const mean = pr.y.reduce((s, v) => s + v, 0) / pr.y.length
        const r = Math.min(0.9 * L, now.edgeUm / 1000)
        const tops = ys.map((y, i) => {
          const lev = mean + (y - mean) * now.left
          const into = us[i] - (L - r)
          const drop = r > 0 && into > 0 ? (r - Math.sqrt(Math.max(0, r * r - into * into))) * sx : 0
          return lev * sy - drop - (now.slumps ? 0.8 * Math.sin((us[i] / L) * Math.PI) : 0)
        })
        section.set(profileSlabs(xs, [{ top: tops, color: now.slumps ? HIGH_V : PLASTIC }], -2.4, 4))
        vap.opacity = V.works ? 0.25 + 0.1 * Math.sin(t * 2) : 0.08
        const top = niceCeil(Math.max(V.a0 * 1.5, V.edgeUm))
        const py = c.py(0, top)
        const xsPlot = VAPOUR_TIME_SWEEP.map((m) => m / VAPOUR.maxMin)
        trR.points(xsPlot, V.ridgeCurve.map((a) => py(Math.min(top, a))), null)
        trE.points(xsPlot, V.edgeCurve.map((e) => py(Math.min(top, e))), null)
        cur(q.min / VAPOUR.maxMin)
        yTop.set(umOf(top))
        plot.right.set(`${q.min} min: ridge ${umOf(V.ridge)}`, RING)
        tally?.set(V.byLayer, V.byLayer.map((a) => umOf(a)), VAPOUR_LAYERS.map((h) => (Math.abs(h - q.h) < 0.03 ? RING : GREY)))
        tag.set(!V.works ? `${V.name}: acetone does nothing` : now.slumps ? 'over-exposed: wall softens and sags' : now.left < 0.1 ? 'glossy: layer lines gone' : simMin > 0 ? 'skin softening, ridges levelling' : 'into the jar', !V.works || now.slumps ? HIGH_V : now.left < 0.1 ? POWER : LABEL)
        rows[0].set(V.works ? `Ridges ${umOf(V.a0)} → ${umOf(V.ridge, 1)} (${pct(1 - V.left)} levelled), soft skin ${umOf(V.skin)}` : `${V.name} does not dissolve in acetone: ridges stay ${umOf(V.a0)}`, !V.works ? HIGH_V : V.left < 0.1 ? POWER : RING)
        rows[1].set(`Edges round to ${mmFixed(V.edgeUm / 1000, 2)} · ${mmFixed(VAPOUR.strokeMm, 1)} text ${V.textLost ? 'blurred away' : 'still crisp'}`, V.textLost ? HIGH_V : V.edgeUm > 100 ? RING : POWER)
        rows[2].set(V.slumps ? `Skin past ${umOf(VAPOUR.slumpUm)}: thin walls soften and warp` : 'Flammable vapour: no flames, ventilate, never heat acetone', V.slumps ? HIGH_V : GREY)
        hd.status.set(`${V.name} · ${METHOD_NAMES[q.method].toLowerCase()} · ${mmFixed(q.h, 2)} layers`)
        hd.sub.set(`time-lapse: ${q.min} min in ${loop} s, at ${Math.round(simMin)} min`, GREY)
        const good = V.works && V.left < 0.1 && !V.slumps && !V.textLost
        hd.event.set(!V.works ? 'nothing to dissolve: sand or fill instead' : good ? 'pull it out now: glossy, edges still crisp' : V.slumps || V.textLost ? 'too long: edges and small text rounded off' : 'not smooth yet', good ? POWER : HEAT)
      },
      readouts: (p) => {
        const { V } = vapRun(p)
        return [
          { label: 'Ridge', value: umOf(V.ridge, 1), tone: toneOf(V.ridge < 5, V.ridge < 20) },
          { label: 'Levelled', value: pct(1 - V.left) },
          { label: 'Edge radius', value: umOf(V.edgeUm), tone: toneOf(V.edgeUm < 100, !V.textLost) },
          { label: 'Walls', value: V.slumps ? 'sagging' : 'firm', tone: toneOf(!V.slumps, false) },
        ]
      },
    }
  },
}

// --- Painting ---

const PREP_NAMES = Object.fromEntries(PAINT_PREP_KEYS.map((k) => [k, PAINT_PREPS[k].name])) as Record<PaintPrep, string>
const FINISH_NAMES = Object.fromEntries(Object.entries(PAINT_FINISHES).map(([k, v]) => [k, v.name])) as Record<PaintFinish, string>
const PAINT_COLOUR = '#e8622c'
const PAINT_H = 0.2
const paintParams = (p: Params) => ({ m: pick(matNames, p.m, 'pla') as VapourMat, prep: pick(PREP_NAMES, p.prep, 'primer') as PaintPrep, coats: n(p, 'coats'), cm: n(p, 'cm'), finish: pick(FINISH_NAMES, p.finish, 'satin') as PaintFinish })
const paintKey = (p: Params) => `${p.m} ${p.prep} ${p.coats} ${p.cm} ${p.finish}`
const paintRun = memoBy(paintKey, (p: Params) => {
  const q = paintParams(p)
  return { q, V: paintView(q.m, q.prep, q.coats, q.cm, q.finish, PAINT_H) }
})

function robotShell(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  const paint = new THREE.MeshStandardMaterial({ color: PAINT_COLOUR, roughness: 0.5 })
  box(g, [4.6, 3.4, 3], paint, [0, 1.9, 0])
  box(g, [2.6, 1.6, 2.2], paint, [0, 4.4, 0])
  const eye = mat('#20242b', { rough: 0.3 })
  for (const x of [-0.6, 0.6]) cylinder(g, 0.28, 0.1, eye, [x, 4.5, 1.12], 'z', 14)
  for (const x of [-2.5, 2.5]) cylinder(g, 0.9, 0.5, mat('#2a2e35', { rough: 0.8 }), [x, 0.9, 0.3], 'x', 18)
  const lineMat = new THREE.MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false })
  const lines: THREE.Mesh[] = []
  for (let i = 0; i < 16; i++) lines.push(box(g, [4.64, 0.035, 3.04], lineMat, [0, 0.3 + i * 0.2, 0]))
  const drips = Array.from({ length: 4 }, (_, i) => box(g, [0.18, 0.9, 0.1], paint, [-1.6 + i * 1.1, 1.1 - (i % 2) * 0.3, 1.52]))
  const chips = Array.from({ length: 5 }, (_, i) => box(g, [0.5, 0.35, 0.04], mat('#c9ccd1', { rough: 0.7 }), [-1.8 + i * 0.85, 2.8 - (i % 3) * 0.7, 1.52]))
  return { g, paint, lineMat, lines, drips, chips }
}

export const postProcessingPainting: Lesson = {
  id: 'post-processing-painting',
  title: 'Painting',
  tagline: 'Primer, colour, clear',
  formula: (p) => {
    const { q, V } = paintRun(p)
    const c = V.cur
    const F = PAINT_FINISHES[q.finish]
    return `${q.cm} cm: wet ${umOf(c.wet)} → dry ${umOf(c.dry, 1)} per pass${c.runs ? ' (runs)' : c.drySpray ? ' (dry spray)' : ''} · ridge ${umOf(c.start)} after prep − ${q.coats + F.clear} × ${umOf(c.dry * c.level * PAINT.flow, 1)} levelled = ${umOf(c.ridge)} (shows above ${umOf(F.seeUm)} in ${F.name.toLowerCase()}) · adhesion ${c.adhesion}B · ${mmFixed(PAINT_H, 1)} layers, typical`
  },
  legend: [
    { color: POWER, label: 'Layer ridge left vs coats of colour', shape: 'dot' },
    { color: GREY, label: 'Ridge you can see in this finish', shape: 'dot' },
    { color: RING, label: 'Your coats', shape: 'dot' },
  ],
  points: [
    'Paint is thin: one pass dries to ~15 µm, and it follows the surface it lands on. Five coats of colour still show 0.2 mm layer lines, worse in gloss, which catches every ridge. Hide the lines first: sand and fill (Sanding and filling) or vapour-smooth ABS / ASA (Vapour smoothing).',
    'Adhesion: PLA and PETG are smooth and slippery to paint, which peels off in sheets on a tape test. Scuff with 320 grit, wipe with isopropyl alcohol, then a plastic primer. ASA / ABS take paint more readily. Wash off finger grease; it shows as fish-eyes.',
    'Spray from ~25 cm in light passes, starting and stopping off the part. Too close lays a wet film that runs and sags; too far and the paint half-dries in the air into a rough, dusty coat. Mask fits, threads and holes with tape so the film does not change your tolerances (Design for printing > Tolerances and fits).',
    'Let each coat flash ~10 minutes, recoat within the window on the can, and leave the final coat a day to cure (a clear coat longer) before handling or fitting. A 2K or UV clear coat protects robot shells from scuffs and sun.',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(matNames), initial: 'pla' },
    { kind: 'choice', key: 'prep', options: opts(PREP_NAMES), initial: 'primer' },
    { kind: 'slider', key: 'coats', label: 'Coats of colour', min: 1, max: 6, step: 1, initial: 3, format: (v) => `${v}` },
    { kind: 'slider', key: 'cm', label: 'Spray distance', min: 10, max: 45, step: 5, initial: 25, format: (v) => `${v} cm` },
    { kind: 'choice', key: 'finish', options: opts(FINISH_NAMES), initial: 'satin' },
  ],
  build(): Stage {
    const c = postStage('ridge left vs coats', '1 coat', `${PAINT_COAT_SWEEP.length} coats`, { title: 'Tape test by prep (5B = best)', names: PAINT_PREP_KEYS.map((k) => PAINT_PREPS[k].short) })
    const { scene, head: hd, rows, plot, tally, yTop, g, section } = c
    g.position.set(-17.2, -2.6, 0)
    g.scale.setScalar(0.55)
    addLabel(scene, 'coats on 3 layer lines, magnified', [-17.6, 2.4, 0.5], GREY, 0.28, 'left')
    const pr = ridgeProfile(PAINT_H, 'wall')
    const xs = sectionX(pr.u, pr.period)
    const mean0 = pr.y.reduce((a, v) => a + v, 0) / pr.y.length
    const shell = robotShell(scene)
    shell.g.position.set(-13, -13.2, 0)
    shell.g.rotation.set(0.25, 0.5, 0)
    shell.g.scale.setScalar(1.7)
    const can = add(scene, new THREE.Group())
    cylinder(can, 0.55, 2.4, mat('#d9dde3', { rough: 0.35, metal: 0.6 }), [0, 0, 0], 'y', 18)
    cylinder(can, 0.56, 0.9, mat(PAINT_COLOUR, { rough: 0.5 }), [0, 0.5, 0], 'y', 18)
    box(can, [0.3, 0.25, 0.3], mat('#20242b'), [0, 1.35, 0])
    const tag = liveLabel(scene, [-17.6, 1.7, 0.5], { size: 0.28, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: PAINT_COAT_SWEEP.length, radius: 0.06 })
    const see = S.trace(GREY, { samples: 2, radius: 0.04 })
    const cur = cursorBar(S, RING, 0.06)
    let t = 0
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = paintRun(p)
        const cj = V.cur
        const F = PAINT_FINISHES[q.finish]
        if (key !== paintKey(p)) {
          key = paintKey(p)
          t = 0
        }
        const loop = 8
        t = (t + dt) % (loop + 2)
        const total = q.coats + F.clear
        const k = Math.min(total, Math.floor((t / loop) * total + 1e-6))
        const spraying = t < loop
        const ridgeNow = Math.max(0, cj.start - k * cj.dry * cj.level * PAINT.flow)
        const sy = 5.5 / (pr.rz + 60)
        const amp = cj.start / pr.rz
        const prim = q.prep === 'primer' || q.prep === 'filler' ? PAINT.primerUm : 0
        const coatsOf = [{ top: pr.y.map((y) => (mean0 + (y - mean0) * amp - prim) * sy), color: q.m === 'asa' ? '#e9e4d8' : '#cfd3d8' }]
        if (prim) coatsOf.push({ top: pr.y.map((y) => (mean0 + (y - mean0) * amp) * sy), color: FILLER })
        for (let i = 1; i <= k; i++) {
          const a = Math.max(0, cj.start - i * cj.dry * cj.level * PAINT.flow) / pr.rz
          coatsOf.push({ top: pr.y.map((y) => (mean0 + i * cj.dry + (y - mean0) * a) * sy), color: i > q.coats ? '#f3d6c8' : i % 2 ? PAINT_COLOUR : '#c95424' })
        }
        section.set(profileSlabs(xs, coatsOf, -2.4, 4))
        const show = Math.min(1, ridgeNow / (F.seeUm * 3))
        shell.lineMat.opacity = 0.05 + 0.5 * show
        shell.paint.color.set(k === 0 ? (q.prep === 'primer' || q.prep === 'filler' ? '#9aa3ad' : '#cfd3d8') : PAINT_COLOUR)
        shell.paint.roughness = q.finish === 'matte' ? 0.9 : q.finish === 'satin' ? 0.55 : 0.18
        shell.drips.forEach((d) => (d.visible = cj.runs && k > 0))
        shell.chips.forEach((ch, i) => (ch.visible = k >= total && !spraying && i < 5 - cj.adhesion))
        const reach = q.cm * 0.2
        const sweepY = -10.4 + 3.2 * Math.sin(t * 3)
        can.position.set(-8.6 + reach, sweepY, 1)
        const top = niceCeil(Math.max(cj.start, F.seeUm * 1.5, ...V.curve))
        const py = c.py(0, top)
        tr.points(PAINT_COAT_SWEEP.map((x) => (x - 1) / (PAINT_COAT_SWEEP.length - 1)), V.curve.map(py), null)
        see.points([0, 1], [py(F.seeUm), py(F.seeUm)], null)
        cur((q.coats - 1) / (PAINT_COAT_SWEEP.length - 1))
        yTop.set(umOf(top))
        plot.right.set(`${q.coats} coats: ${umOf(cj.ridge)}`, RING)
        tally?.set(V.preps, V.preps.map((a) => `${a}B`), PAINT_PREP_KEYS.map((k2) => (k2 === q.prep ? RING : GREY)))
        tag.set(k === 0 ? (q.prep === 'none' ? 'bare print' : 'prepped shell') : spraying ? `coat ${k} of ${total}${k > q.coats ? ' (clear)' : ''}` : cj.visible ? 'layer lines still show' : 'lines hidden', cj.visible && !spraying ? HEAT : LABEL)
        rows[0].set(`${q.cm} cm: ${umOf(cj.wet)} wet → ${umOf(cj.dry, 1)} dry per coat${cj.runs ? ': runs and sags' : cj.drySpray ? ': dry spray, rough' : ''}`, cj.runs || cj.drySpray ? HIGH_V : POWER)
        rows[1].set(`Ridge ${umOf(cj.start)} after prep → ${umOf(cj.ridge)}: ${cj.visible ? `shows in ${F.name.toLowerCase()}` : 'hidden'}`, cj.visible ? HEAT : POWER)
        rows[2].set(`${FILAMENTS[q.m].name}, ${PREP_NAMES[q.prep].toLowerCase()}: tape test ${cj.adhesion}B${cj.adhesion <= 2 ? ', peels' : ''}`, cj.adhesion >= 4 ? POWER : cj.adhesion >= 3 ? RING : HIGH_V)
        hd.status.set(`${FILAMENTS[q.m].name} robot shell · ${q.coats} coats ${F.name.toLowerCase()}`)
        hd.sub.set(`time-lapse: ${minText(cj.minutes)} of spraying and flashing in ${loop} s · cure ${Math.round(cj.cureH)} h`, GREY)
        hd.event.set(spraying ? `light passes from ${q.cm} cm, ${PAINT.flashMin} min flash between coats` : `touch dry after ${PAINT.touchMin} min, handle after ${Math.round(cj.cureH)} h`, spraying ? LABEL : POWER)
      },
      readouts: (p) => {
        const { V } = paintRun(p)
        const cj = V.cur
        return [
          { label: 'Ridge', value: umOf(cj.ridge), tone: toneOf(!cj.visible, cj.ridge < 2 * PAINT_FINISHES.satin.seeUm) },
          { label: 'Per coat', value: umOf(cj.dry, 1), tone: toneOf(!cj.runs && !cj.drySpray, false) },
          { label: 'Adhesion', value: `${cj.adhesion}B`, tone: toneOf(cj.adhesion >= 4, cj.adhesion >= 3) },
          { label: 'Cure', value: `${Math.round(cj.cureH)} h` },
        ]
      },
    }
  },
}
