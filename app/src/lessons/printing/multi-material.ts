import * as THREE from 'three/webgpu'
import {
  AGITATION,
  Agitation,
  FILAMENTS,
  MM_COLOURS,
  MM_COVER,
  MM_LAYER_SWEEP,
  MM_METHODS,
  MM_METHOD_KEYS,
  MmColour,
  MmMethod,
  SOLUBLE,
  SUPPORT_MATS,
  SUPPORT_MAT_KEYS,
  SUPPORT_MODELS,
  SupportMat,
  SupportModel,
  WATER_SWEEP,
  mmView,
  solubleView,
} from '../../core/physics'
import { celsiusText, fixedText, hoursText, niceCeil, pct, umText } from '../../core/units'
import { add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, PRINT_PLOT, RING, Slab, WIDE_VIEW, addLabel, addRod, cursorBar, filamentSpool, liveLabel, memoBy, printBoard, setGlow, shellMat, sliceSlabs, stretchRod } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

function mmStage(plotTitle: string, lo: string, hi: string, bars: { title: string; names: readonly string[] }) {
  const scene = createStage({ span: 40 })
  const c = printBoard(scene, plotTitle, lo, hi, bars)
  const P = PRINT_PLOT
  const yTop = liveLabel(scene, [P.x - P.w / 2 + 0.15, P.y + P.h / 2 - 0.3, 0.3], { size: 0.26, color: GREY, align: 'left' })
  return { scene, ...c, yTop }
}
const minText = (s: number) => hoursText(s / 3600)

// --- Tool changers and AMS ---

const COLOUR_NAMES = Object.fromEntries(Object.entries(MM_COLOURS).map(([k, v]) => [k, v.name])) as Record<MmColour, string>
const METHOD_NAMES = Object.fromEntries(MM_METHOD_KEYS.map((k) => [k, MM_METHODS[k].name])) as Record<MmMethod, string>
const METHOD_TINT: Record<MmMethod, string> = { ams: HEAT, tool: POWER, idex: B_FIELD }
const mmParams = (p: Params) => ({
  m: pick(METHOD_NAMES, p.m, 'ams') as MmMethod,
  base: pick(COLOUR_NAMES, p.base, 'blue') as MmColour,
  logo: pick(COLOUR_NAMES, p.logo, 'yellow') as MmColour,
  per: n(p, 'per'),
  layers: n(p, 'layers'),
})
const mmKey = (p: Params) => `${p.m} ${p.base} ${p.logo} ${p.per} ${p.layers}`

type Seg = { t0: number; t1: number; layer: number; text: string; change: number; to: MmColour }
const mmRun = memoBy(mmKey, (p: Params) => {
  const q = mmParams(p)
  const V = mmView(q.m, q.base, q.logo, q.per, q.layers)
  const C = MM_COVER
  const segs: Seg[] = []
  let t = 0
  let k = 0
  let colour = q.base
  const layerS = V.cur.printS / C.layers
  for (let i = 0; i < C.layers; i++) {
    const two = i >= C.layers - q.layers
    const changes = two ? q.per : 0
    const slice = layerS / (changes + 1)
    for (let j = 0; j <= changes; j++) {
      segs.push({ t0: t, t1: t + slice, layer: i, text: `layer ${i + 1}: printing ${MM_COLOURS[colour].name.toLowerCase()}`, change: -1, to: colour })
      t += slice
      if (j === changes) break
      const to = colour === q.base ? q.logo : q.base
      const ch = to === q.logo ? V.cur.go : V.cur.back
      for (const s of ch.steps) {
        segs.push({ t0: t, t1: t + s.s, layer: i, text: `change ${k + 1}: ${s.name} (${Math.round(s.s)} s)`, change: k, to })
        t += s.s
      }
      colour = to
      k++
    }
  }
  return { q, V, segs, total: t }
})

const LOGO = ['............', '..########..', '..#..##..#..', '..########..', '...#....#...', '...######...', '............', '............']
function coverSlabs(q: ReturnType<typeof mmParams>, upto: number, printed: ReadonlySet<MmColour>, thick: number): Slab[] {
  const C = MM_COVER
  const cols = LOGO[0].length
  const cw = C.w / cols
  const rd = C.d / LOGO.length
  const out: Slab[] = []
  for (let i = 0; i <= Math.min(upto, C.layers - 1); i++) {
    const two = i >= C.layers - q.layers
    const y0 = i * thick
    LOGO.forEach((row, r) => {
      const isLogo = (j: number) => two && row[j] === '#'
      let a = 0
      for (let j = 1; j <= cols; j++) {
        if (j < cols && isLogo(j) === isLogo(a)) continue
        const colour = isLogo(a) ? q.logo : q.base
        if (i < upto || printed.has(colour)) out.push({ x0: -C.w / 2 + a * cw, x1: -C.w / 2 + j * cw - 0.3, y0, y1: y0 + thick * 0.88, z0: -C.d / 2 + r * rd, z1: -C.d / 2 + (r + 1) * rd - 0.3, color: MM_COLOURS[colour].hex })
        a = j
      }
    })
  }
  return out
}

function head(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  box(g, [1.1, 1.2, 1], mat('#3a3f47', { rough: 0.5 }), [0, 0.6, 0])
  const tip = mat('#ffffff', { rough: 0.4 }, true)
  cylinder(g, 0.4, 0.5, tip, [0, -0.25, 0], 'y', 12)
  return { g, tip }
}

export const multiMaterialToolChangersAndAms: Lesson = {
  id: 'multi-material-tool-changers-and-ams',
  title: 'Tool changers and AMS',
  tagline: 'Two colours, one print',
  formula: (p) => {
    const { q, V } = mmRun(p)
    const c = V.cur
    const M = MM_METHODS[q.m]
    return `${M.name}: ${q.per} change${q.per > 1 ? 's' : ''}/layer × ${q.layers} layers = ${c.changes} changes · ${M.flush === 'purge' ? `purge ${Math.round(c.go.flushMm3)} mm³ going lighter, ${Math.round(c.back.flushMm3)} mm³ back` : `prime ${M.primeMm3} mm³ per swap`} → ${fixedText(c.wasteG, 1)} g waste (part ${fixedText(c.partG, 1)} g), +${minText(c.addS)} on a ${minText(c.printS)} print · hardware ~$${M.priceUsd}, typical`
  },
  legend: [
    { color: HEAT, label: 'Waste vs two-colour layers: AMS (shared nozzle)', shape: 'dot' },
    { color: POWER, label: 'Tool changer (one hotend per colour)', shape: 'dot' },
    { color: B_FIELD, label: 'IDEX (two independent heads)', shape: 'dot' },
    { color: RING, label: 'Your print', shape: 'dot' },
  ],
  points: [
    'A two-colour part is still one toolpath per layer, split by colour: a 3MF keeps each body and its colour (Slicing > STL and 3MF) and the G-code switches with T0 / T1 (G-code). What changes is how the printer gets the other filament into the melt zone.',
    'A filament changer (Bambu AMS, Prusa MMU) feeds several spools into one hotend: retract, cut, pull the old filament back, push the new one in, then purge until the old colour has washed out of the melt chamber (How FDM works > Hotend and extruder). That purge is the "poop" or the purge tower. Dark to light needs the most: black → white can take 600–700 mm³, white → black barely 150.',
    'A tool changer parks one full hotend per colour and swaps the whole tool in ~10 s: no purge, only a small prime of what oozed while parked (keep the parked tool at standby temperature, Calibration > Retraction). IDEX has two heads on one axis, faster still but only two colours. Both cost more and the head gets heavier.',
    'For a logo on a robot cover, put the logo only in the top few layers, let the slicer start each layer with the last colour (one change per layer instead of two), purge into infill or a hidden part, and order colours light before dark. Otherwise the waste can outweigh the part.',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(METHOD_NAMES), initial: 'ams' },
    { kind: 'choice', key: 'base', options: opts(COLOUR_NAMES), initial: 'blue' },
    { kind: 'choice', key: 'logo', options: opts(COLOUR_NAMES), initial: 'yellow' },
    { kind: 'slider', key: 'per', label: 'Colour changes per layer', min: 1, max: 4, step: 1, initial: 2, format: (v) => `${v}` },
    { kind: 'slider', key: 'layers', label: 'Layers with the logo', min: 1, max: MM_COVER.layers, step: 1, initial: 10, format: (v) => `${v} of ${MM_COVER.layers}` },
  ],
  build(): Stage {
    const c = mmStage('waste vs layers with the logo', '0 layers', `${MM_COVER.layers} layers`, { title: 'Added print time per method', names: MM_METHOD_KEYS.map((k) => MM_METHODS[k].short) })
    const { scene, head: hd, rows, plot, tally, yTop } = c
    const k = 0.15
    const thick = 0.6
    const g = add(scene, new THREE.Group(), [-10, -10.2, 0])
    g.rotation.set(0.4, -0.35, 0)
    box(g, [80 * k, 0.3, 56 * k], mat('#3a3f47', { rough: 0.6 }), [4 * k, -0.15, 0])
    const part = sliceSlabs(g, [-6 * k, 0, 0], k, 1600)
    const bin = add(g, new THREE.Group(), [38 * k, 0, 18 * k])
    box(bin, [14 * k, 0.15, 12 * k], mat('#23262d', { rough: 0.8 }), [0, 0.07, 0])
    const blobs = sliceSlabs(bin, [0, 0.15, 0], k, 140)
    addLabel(scene, 'waste', [-3.2, -11.6, 0.6], GREY, 0.28)
    addLabel(scene, `cover ${MM_COVER.w} × ${MM_COVER.d} mm, layers drawn 3× thick`, [-8.6, 1.6, 0.5], GREY, 0.28, 'left')
    const railY = -7.2
    box(scene, [17, 0.25, 0.3], mat('#5c6370', { rough: 0.5, metal: 0.4 }), [-10, railY + 2, -0.4])
    const heads = Array.from({ length: 4 }, () => head(scene))
    const spools = Array.from({ length: 2 }, (_, i) => filamentSpool(scene, [-15 + i * 3, 1.6, 0], 0.014))
    const tube = addRod(scene, shellMat('#e8f0ff', 0.5))
    const S = plot.s
    const trs = MM_METHOD_KEYS.map((m) => S.trace(METHOD_TINT[m], { samples: MM_LAYER_SWEEP.length, radius: 0.06 }))
    const cur = cursorBar(S, RING, 0.06)
    let t = 0
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const R = mmRun(p)
        const { q, V } = R
        if (key !== mmKey(p)) {
          key = mmKey(p)
          t = 0
        }
        const loop = 11
        t = (t + dt) % (loop + 1.5)
        const sim = Math.min(R.total, (t / loop) * R.total)
        const seg = R.segs.find((s) => sim < s.t1) ?? R.segs[R.segs.length - 1]
        const done = sim >= R.total
        const printed = new Set(R.segs.filter((s) => s.layer === seg.layer && s.change < 0 && s.t0 <= sim).map((s) => s.to))
        part.set(coverSlabs(q, done ? MM_COVER.layers : seg.layer, printed, thick))
        const nDone = done ? V.cur.changes : seg.change < 0 ? R.segs.filter((s) => s.change >= 0 && s.t1 <= sim).reduce((m, s) => Math.max(m, s.change + 1), 0) : seg.change
        const bs: Slab[] = []
        for (let i = 0; i < nDone; i++) {
          const ch = i % 2 === 0 ? V.cur.go : V.cur.back
          const e = Math.max(1.2, Math.cbrt(ch.flushMm3) * 0.6)
          const col = i % 6
          const row = Math.floor(i / 6) % 4
          const lvl = Math.floor(i / 24)
          const x = -6 + col * 2.2
          const z = -4.5 + row * 3
          const tint = i % 2 === 0 ? MM_COLOURS[q.logo].hex : MM_COLOURS[q.base].hex
          bs.push({ x0: x - e / 2, x1: x + e / 2, y0: lvl * 2.6, y1: lvl * 2.6 + e * 0.7, z0: z - e / 2, z1: z + e / 2, color: tint })
        }
        blobs.set(bs)
        const nHeads = q.m === 'ams' ? 1 : q.m === 'idex' ? 2 : 4
        const colours: MmColour[] = q.m === 'ams' ? [seg.to] : [q.base, q.logo, ...(Object.keys(MM_COLOURS) as MmColour[]).filter((x) => x !== q.base && x !== q.logo)]
        const active = q.m === 'ams' ? 0 : seg.to === q.base ? 0 : 1
        const swapping = seg.change >= 0
        const sweepX = -10.5 + 3.5 * Math.sin(sim * 0.05)
        const lift = (seg.layer + 1) * thick * k
        heads.forEach((h, i) => {
          h.g.visible = i < nHeads
          h.tip.color.set(MM_COLOURS[colours[i] ?? q.base].hex)
          const parkX = q.m === 'tool' ? -17.4 + i * 1.4 : i === 0 ? -17.4 : -2.6
          const onBed = i === active && !(swapping && q.m !== 'ams')
          h.g.position.set(onBed ? sweepX : parkX, railY + (onBed ? lift : 1.2), 0)
        })
        spools.forEach((s, i) => {
          s.set(MM_COLOURS[i === 0 ? q.base : q.logo].hex, 0.7)
          s.group.rotation.z += (seg.to === (i === 0 ? q.base : q.logo) ? (swapping ? 3 : 0.4) : 0) * dt
        })
        const sp = seg.to === q.base ? 0 : 1
        const hp = heads[q.m === 'ams' ? 0 : active].g.position
        stretchRod(tube, [-15 + sp * 3, 0.6, 0.3], [hp.x, hp.y + 1.2, 0.3], 0.07)
        const curves = V.curves
        const top = niceCeil(Math.max(1, ...curves.flat()))
        const py = c.py(0, top)
        curves.forEach((cv, i) => trs[i].points(MM_LAYER_SWEEP.map((l) => l / MM_COVER.layers), cv.map(py), null))
        cur(q.layers / MM_COVER.layers)
        yTop.set(`${top} g`)
        plot.right.set(`${q.layers} layers: ${fixedText(V.cur.wasteG, 1)} g`, RING)
        tally?.set(V.jobs.map((j) => j.addS), V.jobs.map((j) => `+${minText(j.addS)}`), MM_METHOD_KEYS.map((m) => (m === q.m ? RING : GREY)))
        const cv = V.cur
        const flushWord = MM_METHODS[q.m].flush === 'purge' ? 'purge' : 'prime'
        rows[0].set(`${COLOUR_NAMES[q.base]} → ${COLOUR_NAMES[q.logo]}: ${flushWord} ${Math.round(cv.go.flushMm3)} mm³ (${fixedText(cv.go.grams, 2)} g), ${Math.round(cv.go.seconds)} s`, cv.go.grams > 0.5 ? HEAT : POWER)
        rows[1].set(`${COLOUR_NAMES[q.logo]} → ${COLOUR_NAMES[q.base]}: ${flushWord} ${Math.round(cv.back.flushMm3)} mm³ (${fixedText(cv.back.grams, 2)} g), ${Math.round(cv.back.seconds)} s`, cv.back.grams > 0.5 ? HEAT : POWER)
        rows[2].set(`${cv.changes} changes: ${fixedText(cv.wasteG, 1)} g waste on a ${fixedText(cv.partG, 1)} g part, typical`, cv.wasteShare > 1 ? HIGH_V : cv.wasteShare > 0.3 ? RING : POWER)
        hd.status.set(`${MM_METHODS[q.m].name} · ${cv.changes} colour changes`)
        hd.sub.set(`time-lapse: ${minText(R.total)} of printing in ${loop} s, at ${minText(sim)}`, GREY)
        hd.event.set(done ? `done: +${minText(cv.addS)} for colour, ${pct(cv.slowdown - 1)} slower` : seg.text, swapping ? HEAT : LABEL)
      },
      readouts: (p) => {
        const { V } = mmRun(p)
        const cv = V.cur
        return [
          { label: 'Per change', value: `${Math.round(cv.go.seconds)} s`, tone: toneOf(cv.go.seconds < 15, cv.go.seconds < 45) },
          { label: 'Waste', value: `${fixedText(cv.wasteG, 1)} g`, tone: toneOf(cv.wasteShare < 0.2, cv.wasteShare < 1) },
          { label: 'Waste / part', value: pct(cv.wasteShare) },
          { label: 'Added time', value: minText(cv.addS), tone: toneOf(cv.slowdown < 1.2, cv.slowdown < 2) },
        ]
      },
    }
  },
}

// --- Soluble supports ---

const SUP_NAMES = Object.fromEntries(SUPPORT_MAT_KEYS.map((k) => [k, SUPPORT_MATS[k].name])) as Record<SupportMat, string>
const MODEL_NAMES = Object.fromEntries(SUPPORT_MODELS.map((k) => [k, FILAMENTS[k].name])) as Record<SupportModel, string>
const AGIT_NAMES = Object.fromEntries(Object.entries(AGITATION).map(([k, v]) => [k, v.name])) as Record<Agitation, string>
const SUP_TINT: Record<SupportMat, string> = { same: '#c7d7ee', breakaway: '#cfd6dc', pva: '#efe3a8', bvoh: '#bfe8cf', hips: '#f4f4f0' }
const MODEL_TINT = '#ff8a3d'
const solParams = (p: Params) => ({
  model: pick(MODEL_NAMES, p.model, 'pla') as SupportModel,
  s: pick(SUP_NAMES, p.s, 'pva') as SupportMat,
  c: n(p, 'water'),
  a: pick(AGIT_NAMES, p.a, 'still') as Agitation,
  depth: n(p, 'depth'),
})
const solKey = (p: Params) => `${p.model} ${p.s} ${p.water} ${p.a} ${p.depth}`
const solRun = memoBy(solKey, (p: Params) => {
  const q = solParams(p)
  return { q, V: solubleView(q.model, q.s, q.c, q.a, q.depth) }
})
const LOG_LO = -2
const LOG_HI = 2
const freeText = (h: number, hand: boolean) => (hand ? `${Math.max(1, Math.round(h * 60))} min by hand` : hoursText(h))

/** Bracket section (mm): floor, roof, back wall; a cavity `depth` long, open on the left, filled with support columns. */
function bracketSlabs(depth: number, model: string): Slab[] {
  const L = depth + 8
  return [
    { x0: 0, x1: L, y0: 0, y1: 4, z0: -12, z1: 12, color: model },
    { x0: 0, x1: L, y0: 16, y1: 22, z0: -12, z1: 12, color: model },
    { x0: depth, x1: L, y0: 4, y1: 16, z0: -12, z1: 12, color: model },
    { x0: 0, x1: depth, y0: 4, y1: 16, z0: -12, z1: -10, color: model },
  ]
}

export const multiMaterialSolubleSupports: Lesson = {
  id: 'multi-material-soluble-supports',
  title: 'Soluble supports',
  tagline: 'Supports that wash away',
  formula: (p) => {
    const { q, V } = solRun(p)
    const S = SUPPORT_MATS[q.s]
    const how = V.hand
      ? `by hand: ${SOLUBLE.handMinPerMm} min/mm up to ${SOLUBLE.reachMm} mm deep${V.stuckMm > 0 ? `, ${q.depth - SOLUBLE.reachMm} mm out of reach` : ''}`
      : `rate = ${S.rate20} mm/h × 2^((${celsiusText(Math.min(q.c, V.capped ? SOLUBLE.limoneneMaxC : q.c))} − 20) / ${SOLUBLE.doubleC}) × ${AGITATION[q.a].k} = ${fixedText(V.rate, 1)} mm/h → ${q.depth} mm in ${hoursText(V.hours)}`
    return `${FILAMENTS[q.model].name} + ${S.name}: bond ${pct(V.bond)} (needs ${pct(SOLUBLE.minBond)}) · ${how} · underside ~${S.scarUm} µm · ${SOLUBLE.supportG} g support = $${fixedText(V.costUsd, 2)}, typical`
  },
  legend: [
    { color: POWER, label: 'Time to free the part vs water temperature', shape: 'dot' },
    { color: RING, label: 'Your bath', shape: 'dot' },
    { color: HIGH_V, label: 'Support out of reach / loose', shape: 'dot' },
  ],
  points: [
    'Ordinary supports are the part material with a small air gap so they snap off (Slicing > Supports): the gap leaves a droopy, scarred underside and anything deep inside a cavity cannot be reached at all (Design for printing > Overhangs and bridges).',
    'A second material that dissolves can touch the part with no gap: the underside comes out almost like a top surface and enclosed channels, cable ducts and print-in-place joints clear themselves. It needs a second nozzle or a filament changer, so every support layer pays the purge and time of Tool changers and AMS; print it only as the interface layers to save both.',
    'The pairs must bond: PVA or BVOH (water) with PLA, BVOH with PETG, HIPS (limonene) with ABS / ASA. Dissolving speeds up roughly 2× per 10 °C and with stirring or ultrasound, but keep the water ~10 °C under the part\'s glass transition (Filaments > Glass transition temp) and never heat limonene.',
    'PVA costs 4× PLA and soaks up air moisture within a day; wet PVA bubbles and jams. Keep it in a dry box and dry it before printing (Filaments > Drying wet filament). Breakaway filament is a cheaper middle ground: a smaller gap and cleaner release, but still by hand.',
  ],
  controls: [
    { kind: 'choice', key: 'model', options: opts(MODEL_NAMES), initial: 'pla' },
    { kind: 'choice', key: 's', options: opts(SUP_NAMES), initial: 'pva' },
    { kind: 'slider', key: 'water', label: 'Bath temperature', min: 20, max: 70, step: 5, initial: 20, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'a', options: opts(AGIT_NAMES), initial: 'still' },
    { kind: 'slider', key: 'depth', label: 'Cavity depth', min: 2, max: 30, step: 2, initial: 14, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const c = mmStage('time to free vs bath', `${WATER_SWEEP[0]} °C`, `${WATER_SWEEP[WATER_SWEEP.length - 1]} °C`, { title: 'Time to free the part', names: SUPPORT_MAT_KEYS.map((k) => SUPPORT_MATS[k].name) })
    const { scene, head: hd, rows, plot, tally, yTop } = c
    const k = 0.37
    const g = add(scene, new THREE.Group(), [-14, -11.6, 0])
    g.rotation.set(0.3, 0.5, 0)
    const part = sliceSlabs(g, [0, 0, 0], k, 8)
    const sup = sliceSlabs(g, [0, 0, 0], k, 80)
    const water = new THREE.MeshStandardMaterial({ color: '#4aa3df', transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false })
    const tank = box(g, [1, 1, 1], water)
    addLabel(scene, 'cut away: bracket with a closed cavity', [-17, 3.2, 0.5], GREY, 0.28, 'left')
    const tag = liveLabel(scene, [-17, 4, 0.5], { size: 0.32, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: WATER_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const py = c.py(LOG_LO, LOG_HI)
    for (let d = LOG_LO + 1; d < LOG_HI; d++) addLabel(scene, `${10 ** d} h`, [PRINT_PLOT.x - PRINT_PLOT.w / 2 + 0.15, PRINT_PLOT.y - PRINT_PLOT.h / 2 + ((d - LOG_LO) / (LOG_HI - LOG_LO)) * PRINT_PLOT.h + 0.25, 0.3], GREY, 0.26, 'left')
    const lg = (h: number) => py(Math.max(LOG_LO, Math.min(LOG_HI, Math.log10(Math.max(1e-6, h)))))
    const t0 = WATER_SWEEP[0]
    const span = WATER_SWEEP[WATER_SWEEP.length - 1] - t0
    let t = 0
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = solRun(p)
        const M = SUPPORT_MATS[q.s]
        if (key !== solKey(p)) {
          key = solKey(p)
          t = 0
          part.set(bracketSlabs(q.depth, MODEL_TINT))
          const L = q.depth + 8
          tank.scale.set((L + 8) * k, 26 * k, 30 * k)
          tank.position.set((L / 2) * k, 12 * k, 0)
        }
        const loop = 8
        t = (t + dt) % (loop + 2)
        const f = Math.min(1, t / loop)
        const front = V.hand ? Math.min(q.depth, SOLUBLE.reachMm) * f : q.depth * f
        const gap = M.gapMm * 5
        const slabs: Slab[] = []
        const step = 2
        for (let x = 0; x < q.depth - 1e-6; x += step) {
          const x1 = Math.min(q.depth, x + step)
          if (x1 <= front + 1e-6) continue
          const stuck = V.hand && x >= SOLUBLE.reachMm
          const loose = !V.holds
          const color = stuck || loose ? HIGH_V : SUP_TINT[q.s]
          const eaten = Math.max(0, front - x)
          const dy = loose ? -1.5 * ((x / step) % 2) : 0
          slabs.push({ x0: x + eaten + 0.2, x1: x1 - 0.5, y0: 4 + dy, y1: 14.6 - gap + dy, z0: -10, z1: 12, color })
          slabs.push({ x0: x + eaten, x1, y0: 14.6 - gap + dy, y1: 16 - gap + dy, z0: -10, z1: 12, color })
        }
        if (f >= 1 && !V.holds) slabs.push({ x0: 0, x1: q.depth, y0: 15.2, y1: 16, z0: -10, z1: 12, color: HIGH_V })
        sup.set(slabs)
        tank.visible = !V.hand
        setGlow(water, q.c > 45 ? '#d96b4a' : '#4aa3df', 0.05)
        const simH = V.hours * f
        tag.set(!V.holds ? 'support came loose mid-print' : V.stuckMm > 0 && f >= 1 ? `${V.stuckMm} mm of support stuck out of reach` : f >= 1 ? 'free' : V.hand ? 'snapping supports off...' : 'dissolving...', !V.holds || (V.stuckMm > 0 && f >= 1) ? HIGH_V : f >= 1 ? POWER : LABEL)
        tr.points(WATER_SWEEP.map((w) => (w - t0) / span), V.curve.map(lg), null)
        cur((q.c - t0) / span)
        yTop.set('100 h')
        plot.right.set(V.hand ? `by hand: ${freeText(V.hours, false)}` : `${q.c} °C: ${hoursText(V.hours)}`, RING)
        tally?.set(V.mats.map((m) => Math.min(100, m.hours)), V.mats.map((m) => (m.hand ? (m.stuckMm > 0 ? 'stuck' : 'hand') : hoursText(m.hours))), SUPPORT_MAT_KEYS.map((s) => (s === q.s ? RING : GREY)))
        rows[0].set(`${FILAMENTS[q.model].name} + ${M.name}: ${V.holds ? 'bonds' : 'does not stick'} (bond ${pct(V.bond)})`, V.holds ? POWER : HIGH_V)
        rows[1].set(V.hand ? `By hand: ${SOLUBLE.reachMm} mm reach, gap ${M.gapMm} mm, scars ~${umText(M.scarUm / 1000)}` : `${M.solvent} ${celsiusText(V.capped ? SOLUBLE.limoneneMaxC : q.c)}${V.capped ? ' (never heated)' : ''}: ${fixedText(V.rate, 1)} mm/h, free in ${hoursText(V.hours)}`, V.softens ? HIGH_V : V.hand && V.stuckMm > 0 ? HIGH_V : LABEL)
        rows[2].set(V.softens ? `${q.c} °C softens ${FILAMENTS[q.model].name} (Tg ${FILAMENTS[q.model].tgC} °C): part warps` : `$${fixedText(V.costUsd, 2)} of support; open air max ${M.openDays} day${M.openDays > 1 ? 's' : ''}, typical`, V.softens ? HIGH_V : M.openDays <= 1 ? RING : LABEL)
        hd.status.set(`${FILAMENTS[q.model].name} part, ${M.name} support · cavity ${q.depth} mm deep`)
        hd.sub.set(V.hand ? `time-lapse: ${freeText(V.hours, true)} in ${loop} s` : `time-lapse: ${hoursText(V.hours)} in ${loop} s, ${AGITATION[q.a].name.toLowerCase()}, at ${hoursText(simH)}`, GREY)
        hd.event.set(M.gapMm > 0 ? `${M.gapMm} mm air gap under the roof (drawn 5× tall)` : 'no gap: support touches the roof', M.gapMm > 0 ? RING : POWER)
      },
      readouts: (p) => {
        const { V, q } = solRun(p)
        const M = SUPPORT_MATS[q.s]
        return [
          { label: 'To free', value: V.hand ? `${Math.max(1, Math.round(V.hours * 60))} min` : hoursText(V.hours), tone: toneOf(V.stuckMm === 0 && V.hours < 4, V.stuckMm === 0 && V.hours < 24) },
          { label: 'Underside', value: `${M.scarUm} µm`, tone: toneOf(M.scarUm < 30, M.scarUm < 100) },
          { label: 'Bond', value: pct(V.bond), tone: toneOf(V.holds && V.bond > 0.6, V.holds) },
          { label: 'Support cost', value: `$${fixedText(V.costUsd, 2)}` },
        ]
      },
    }
  },
}
