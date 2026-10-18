import * as THREE from 'three/webgpu'
import {
  AREA_SWEEP,
  PICK_PARTS,
  PROCESSES,
  PROCESS_KEYS,
  PickPart,
  ProcessKey,
  RESIN,
  RESIN_MAX_PARTS,
  RESIN_PART,
  SLS,
  SLS_GEAR,
  SLS_PARTS_MAX,
  SLS_SWEEP,
  pickProcess,
  plateSlots,
  resinView,
  slabSection,
  slsView,
} from '../../core/physics'
import { durationText, fixedText, hoursText, newtonsText, pct } from '../../core/units'
import { V3, add, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FILAMENT_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  NYLON_COLOR,
  POWER,
  RESIN_COLOR,
  RING,
  UV_COLOR,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  countBars,
  cursorBar,
  emptyGroup,
  glowDot,
  liveLabel,
  memoBy,
  partGlow,
  plotY,
  powderBed,
  printedPart,
  resinPrinter,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const perMmText = (s: number) => `${fixedText(s / 60, 1)} min/mm`
const cm2 = (mm2: number) => `${fixedText(mm2 / 100, 1)} cm²`

// --- SLA and MSLA resin: an upside-down printer; the LCD mask cures a whole layer at once. ---

const RS = { k: 0.115, at: [-7.1, -4.6, 0] as V3, lapse: 24, hold: 2, cycle: 0.9, lift: 8, slabs: 70 }
const rsParams = (p: Params) => ({ parts: n(p, 'parts'), tiltDeg: n(p, 'tilt'), layerH: n(p, 'layer') })
const rsRun = memoBy((p: Params) => `${p.parts} ${p.tilt} ${p.layer}`, (p: Params) => {
  const q = rsParams(p)
  return { q, V: resinView(q) }
})

export const otherProcessesSlaAndMslaResin: Lesson = {
  id: 'other-processes-sla-and-msla-resin',
  title: 'SLA and MSLA resin',
  tagline: 'UV light cures liquid resin a whole layer at a time',
  formula: (p) => {
    const { q, V } = rsRun(p)
    return `layer time = expose ${RESIN.exposeS} s + lift ${RESIN.liftS} s = ${fixedText(V.layerS, 1)} s, whatever the area · layers = ${fixedText(V.H, 1)} mm / ${fixedText(q.layerH, 3)} mm = ${V.layers} · time = ${V.layers} × ${fixedText(V.layerS, 1)} s = ${durationText(V.total)} · peel ≈ ${RESIN.suctionNmm2} N/mm² × ${Math.round(V.peakA)} mm² = ${newtonsText(V.peelN, 1)} (typical)`
  },
  legend: [
    { color: UV_COLOR, label: 'MSLA: 405 nm UV through the LCD mask', shape: 'dot' },
    { color: B_FIELD, label: 'Laser SLA: a spot traces the layer', shape: 'dot' },
    { color: FILAMENT_COLOR, label: 'FDM, 0.2 mm layers, 20 % infill', shape: 'dot' },
  ],
  points: [
    'A resin printer works upside down. The build plate dips into a vat of liquid photopolymer with a clear FEP film for a floor. UV light from below hardens the thin film of resin between the film and the plate (or the last layer); the plate then lifts one layer and the next layer cures onto the bottom of the part. 405 nm sits just past violet: see Waves › EM spectrum and Light & optics.',
    'MSLA puts an LCD between the UV lamp and the vat. The screen is a mask: each pixel either lets the light through or blocks it, so the whole layer cures at once. One layer takes the same 2–3 s exposure plus the lift whatever its area, so six parts print as fast as one. Laser SLA traces the layer with a spot instead, so its time grows with area, like FDM.',
    'The plot compares time per mm of height. One small part is quicker on FDM (its layers are 4× thicker); fill the plate and the flat MSLA line wins. XY detail is the LCD pixel, about 50 µm on a typical 4K–8K screen, and layers are 25–100 µm, so tiny features and no visible layer lines (an FDM nozzle is 0.4 mm).',
    'Each cured layer sticks to the film, and lifting it off needs a peel force that grows with the cross-section area (suction). A big flat part tugs hard on its supports and the plate. Tilting the part 30–45° on supports turns every layer into a thin sliver: peel force drops a lot, but the part gets taller and takes longer. Hollow parts need drain holes or they form suction cups.',
    'After printing, wash off the liquid resin in alcohol and post-cure under UV. Standard resin is stiff but brittle (Materials › Stress and strain); tough or ABS-like resins suit robot parts better. Wear gloves and ventilate: uncured resin irritates skin.',
  ],
  controls: [
    { kind: 'slider', key: 'parts', label: 'Parts on the plate', min: 1, max: RESIN_MAX_PARTS, step: 1, initial: 4, format: (v) => `${v}` },
    { kind: 'slider', key: 'tilt', label: 'Tilt from flat', min: 0, max: 90, step: 5, initial: 30, format: (v) => `${v}°` },
    { kind: 'slider', key: 'layer', label: 'Layer height', min: 0.025, max: 0.1, step: 0.025, initial: 0.05, format: (v) => `${Math.round(v * 1000)} µm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const holder = add(scene, new THREE.Group(), RS.at)
    holder.rotation.set(0.05, -0.26, 0)
    const pr = resinPrinter(holder, [0, 0, 0], RS.k)
    const P = WIDE_RIGHT
    const plot = titledScope(scene, -6.8, 5.4, 'time per mm of height', LABEL, 0, P.x, P.w)
    const COL = { msla: UV_COLOR, laser: B_FIELD, fdm: FILAMENT_COLOR } as const
    const keys = Object.keys(COL) as (keyof typeof COL)[]
    const curves = keys.map((c) => plot.s.trace(COL[c], { samples: AREA_SWEEP.length, radius: 0.06 }))
    const marks = keys.map((c) => glowDot(plot.s.group, 0.22, COL[c]))
    const cursor = cursorBar(plot.s, RING, 0.05)
    plot.lo.set('0 cm²')
    plot.hi.set(cm2(AREA_SWEEP[AREA_SWEEP.length - 1]))
    const tMaxTag = liveLabel(plot.s.group, [-P.w / 2 + 0.2, 2.25, 0.4], { size: 0.22, color: GREY, align: 'left' })
    const rows = textRows(scene, 4, 2.4, 3.4, 0.3, 0.72)
    const { L, W, t } = RESIN_PART
    const st = { t: 0, key: '', shown: -1, maskAt: -1 }
    let slots: [number, number][] = []
    let secs: ([number, number] | null)[] = []
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = rsRun(p)
        const key = `${q.parts} ${q.tiltDeg} ${q.layerH}`
        const D = Math.min(V.layers, RS.slabs)
        const dz = V.H / D
        const c0 = (L * Math.cos((q.tiltDeg * Math.PI) / 180) - t * Math.sin((q.tiltDeg * Math.PI) / 180)) / 2
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.shown = st.maskAt = -1
          slots = plateSlots(q.parts)
          secs = Array.from({ length: D }, (_, j) => slabSection(q.tiltDeg, L, t, (j + 0.5) * dz))
          secs.forEach((s, j) =>
            slots.forEach(([sx, sy], i) => {
              const w = s ? s[1] - s[0] : 0
              const cx = s ? sx + (s[0] + s[1]) / 2 - c0 : sx
              pr.layers.set(j * q.parts + i, cx, sy, Math.max(0.01, w), W, -(j + 1) * dz, dz * 1.02, j % 2 ? '#b5bcc8' : RESIN_COLOR)
            }),
          )
        }
        st.t = (st.t + dt / RS.lapse) % (1 + RS.hold / RS.lapse)
        const u = Math.min(1, st.t)
        const built = Math.min(D, Math.floor(u * D))
        const done = st.t >= 1
        if (built !== st.shown) {
          st.shown = built
          pr.layers.show(built * q.parts)
        }
        const ph = (st.t * RS.lapse) / RS.cycle % 1
        const exposing = !done && ph < 0.45
        const lift = done ? 30 : ph < 0.45 ? 0 : ph < 0.75 ? ((ph - 0.45) / 0.3) * RS.lift : (1 - (ph - 0.75) / 0.25) * RS.lift
        pr.set(built * dz + lift)
        const zNow = Math.min(V.H - 1e-6, (built + 0.5) * dz)
        const maskKey = done ? -2 : built * 2 + (exposing ? 1 : 0)
        if (maskKey !== st.maskAt) {
          st.maskAt = maskKey
          const s = done ? null : slabSection(q.tiltDeg, L, t, zNow)
          pr.mask((x, y) => !!s && slots.some(([sx, sy]) => Math.abs(y - sy) <= W / 2 && x >= sx + s[0] - c0 && x <= sx + s[1] - c0), exposing ? 1 : 0)
        }

        const xMax = AREA_SWEEP[AREA_SWEEP.length - 1]
        const us = AREA_SWEEP.map((a) => a / xMax)
        const yMax = Math.max(...V.sweep.map((s) => Math.max(s.msla, s.laser, s.fdm))) * 1.05
        const py = plotY(0, yMax, 5.4)
        const ux = Math.min(1, V.peakA / xMax)
        keys.forEach((c, i) => {
          curves[i].points(us, V.sweep.map((s) => py(s[c])), null)
          marks[i].position.set(plot.s.xAt(ux), py(V.perMm[c]), 0.46)
        })
        cursor(ux)
        plot.right.set(`at ${cm2(V.peakA)}`, RING)
        tMaxTag.set(perMmText(yMax), GREY)

        const peelTone = V.peelN < 15 ? POWER : V.peelN < 40 ? HEAT : HIGH_V
        rows[0].set(`${V.layers} layers of ${Math.round(q.layerH * 1000)} µm, ${fixedText(V.layerS, 1)} s each at any area`, LABEL)
        rows[1].set(`print ${durationText(V.total)} · ${durationText(V.perPart)} per part · laser SLA ${durationText(V.laserTotal)}`, RING)
        rows[2].set(`peel force up to ${newtonsText(V.peelN, 1)} on ${cm2(V.peakA)}`, peelTone)
        rows[3].set(`per mm: MSLA ${perMmText(V.perMm.msla)} · FDM ${perMmText(V.perMm.fdm)}`, GREY)
        head.status.set(`SLA and MSLA resin · ${q.parts} part${q.parts > 1 ? 's' : ''} · tilted ${q.tiltDeg}°`)
        head.sub.set(`time-lapse: the whole print in ${RS.lapse} s; each blink stands for many layers, typical`, GREY)
        head.event.set(
          done ? 'done: lifted out of the vat, ready to wash and cure' : exposing ? `layer ${Math.min(V.layers, Math.round(u * V.layers) + 1)} of ${V.layers}: UV through the LCD mask` : `lift: peeling the layer off the film, ${newtonsText(V.peelN, 1)}`,
          done ? POWER : exposing ? UV_COLOR : peelTone,
        )
      },
      readouts: (p) => {
        const { V } = rsRun(p)
        return [
          { label: 'Print time', value: durationText(V.total) },
          { label: 'Per part', value: durationText(V.perPart) },
          { label: 'Peel force', value: newtonsText(V.peelN, 1), tone: toneOf(V.peelN < 15, V.peelN < 40) },
        ]
      },
    }
  },
}

// --- SLS nylon powder: a laser sinters each cross-section into a powder bed; loose powder supports everything. ---

const SL = { k: 0.085, at: [-7.2, -6.6, 0] as V3, lapse: 24, hold: 2, cycle: 1.1, wallH: 70 }
const slParams = (p: Params) => ({ parts: n(p, 'parts'), layerH: n(p, 'layer') })
const slRun = memoBy((p: Params) => `${p.parts} ${p.layer}`, (p: Params) => {
  const q = slParams(p)
  return { q, V: slsView(q.parts, q.layerH) }
})
const DONE_NYLON = '#aeb5c0'

export const otherProcessesSlsNylonPowder: Lesson = {
  id: 'other-processes-sls-nylon-powder',
  title: 'SLS nylon powder',
  tagline: 'A laser fuses powder; the loose powder holds the part up',
  formula: (p) => {
    const { q, V } = slRun(p)
    return `build = ${V.layers} layers × ${SLS.recoatS} s recoat + ${q.parts} × ${fixedText(SLS_GEAR.vol / 1000, 1)} cm³ / ${fixedText(q.layerH, 2)} mm / ${SLS.laserMm2s} mm²/s laser = ${durationText(V.build)} · + cool-down ≈ build = ${durationText(V.total)} · per gear ${durationText(V.perPart)} (typical)`
  },
  legend: [
    { color: HEAT, label: 'Being sintered by the laser', shape: 'dot' },
    { color: DONE_NYLON, label: 'Finished nylon parts in the powder', shape: 'dot' },
    { color: RING, label: 'Build time steps up with each new level', shape: 'dot' },
  ],
  points: [
    'SLS (selective laser sintering) spreads a layer of nylon powder about 0.1 mm thick, heats the bed to just below melting, and lets a laser steered by two galvo mirrors fuse the grains wherever the part is. The bed drops one layer, a roller or blade spreads fresh powder, and it repeats. Laser & CNC covers lasers that cut; here the laser only melts.',
    'The loose powder holds up every overhang, so SLS needs no supports at all. That lets you nest parts anywhere in the volume: side by side and stacked in levels. Each layer costs a fixed recoat time plus laser time that grows with the fused area.',
    'Filling a level is almost free: more gears add a little laser time but no extra layers. One more gear than fits starts a new level and adds a whole level of recoats: that is the staircase in the plot, and why time per gear drops so fast. Even full, the parts fill only a fraction of the bed, so most of the powder is left over and gets reused, mixed with some fresh powder.',
    'After the last layer the hot powder cake cools slowly in the machine, often as long as the print took, or the parts warp. Then the parts are dug out, blown clean and bead-blasted. The surface is matte and slightly grainy, and features under about 0.5 mm do not survive.',
    'SLS nylon (PA12) is strong, a little flexible and almost the same in every direction: across the layers it keeps about 90 % of its strength, against about half for FDM (Strength › Layer adhesion). Good for gears, hinges and snap fits. The machines are expensive, so most people order SLS parts from a print service.',
  ],
  controls: [
    { kind: 'slider', key: 'parts', label: 'Gears in the build', min: 1, max: SLS_PARTS_MAX, step: 1, initial: 12, format: (v) => `${v}` },
    { kind: 'slider', key: 'layer', label: 'Layer height', min: 0.06, max: 0.18, step: 0.02, initial: 0.1, format: (v) => `${fixedText(v, 2)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const holder = add(scene, new THREE.Group(), SL.at)
    holder.rotation.set(0.2, -0.42, 0)
    const bed = powderBed(holder, [0, 0, 0], SL.k, SL.wallH, SLS_GEAR.d, SLS_PARTS_MAX)
    const P = WIDE_RIGHT
    const plot = titledScope(scene, -6.8, 5.4, 'build + cool-down vs gears', RING, 0, P.x, P.w)
    const curve = plot.s.trace(RING, { samples: SLS_SWEEP.length, radius: 0.06 })
    const marker = glowDot(plot.s.group, 0.26, RING)
    const cursor = cursorBar(plot.s, RING, 0.05)
    plot.lo.set('1 gear')
    plot.hi.set(`${SLS_PARTS_MAX} gears`)
    const tMaxTag = liveLabel(plot.s.group, [-P.w / 2 + 0.2, 2.25, 0.4], { size: 0.22, color: GREY, align: 'left' })
    const rows = textRows(scene, 4, 2.4, 3.4, 0.3, 0.72)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = slRun(p)
        const key = `${q.parts} ${q.layerH}`
        if (key !== st.key) [st.key, st.t] = [key, 0]
        st.t = (st.t + dt / SL.lapse) % (1 + SL.hold / SL.lapse)
        const done = st.t >= 1
        const { perRow, perLevel, height } = V.nest
        const hgt = Math.min(1, st.t) * height
        const pitch = SLS.bed / perRow
        const sintering: [number, number][] = []
        for (let i = 0; i < q.parts; i++) {
          const lev = Math.floor(i / perLevel)
          const j = i % perLevel
          const x = ((j % perRow) - (perRow - 1) / 2) * pitch
          const y = (Math.floor(j / perRow) - (perRow - 1) / 2) * pitch
          const z0 = SLS.gapMm + lev * (SLS_GEAR.h + SLS.gapMm)
          const h = Math.min(SLS_GEAR.h, hgt - z0)
          const partial = !done && h > 0 && h < SLS_GEAR.h
          if (partial) sintering.push([x, y])
          bed.gears.place(i, x, y, z0, h > 0 ? h : 0, partial ? HEAT : DONE_NYLON)
        }
        bed.gears.show(q.parts)
        const ph = (st.t * SL.lapse) / SL.cycle % 1
        const roll = !done && ph < 0.35
        const B = SLS.bed / 2 + 10
        const spotAt: [number, number] | null = !done && !roll && sintering.length ? (() => {
          const v = (ph - 0.35) / 0.65
          const [cx, cy] = sintering[Math.min(sintering.length - 1, Math.floor(v * sintering.length))]
          const a = v * sintering.length * Math.PI * 6
          const r = (SLS_GEAR.d / 2 - 2) * ((v * sintering.length) % 1)
          return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
        })() : null
        bed.set(done ? height + 4 : hgt, roll ? -B + (ph / 0.35) * 2 * B : null, spotAt)

        const us = SLS_SWEEP.map((_, i) => i / (SLS_SWEEP.length - 1))
        const yMax = Math.max(...V.sweep) * 1.05
        const py = plotY(0, yMax, 5.4)
        curve.points(us, V.sweep.map(py), null)
        const u = (q.parts - 1) / (SLS_PARTS_MAX - 1)
        marker.position.set(plot.s.xAt(u), py(V.total), 0.46)
        cursor(u)
        plot.right.set(`${durationText(V.total)} for ${q.parts}`, RING)
        tMaxTag.set(durationText(yMax), GREY)

        rows[0].set(`${perLevel} gears per level · ${V.nest.levels} level${V.nest.levels > 1 ? 's' : ''} · ${Math.round(height)} mm tall`, LABEL)
        rows[1].set(`${V.layers} layers: recoat ${durationText(V.recoat)} + laser ${durationText(V.scan)}`, LABEL)
        rows[2].set(`+ cool-down = ${durationText(V.total)} · ${durationText(V.perPart)} per gear`, RING)
        rows[3].set(`parts fill ${pct(V.packing)} of the bed · no supports`, POWER)
        head.status.set(`SLS nylon powder · ${q.parts} gear${q.parts > 1 ? 's' : ''} · ${fixedText(q.layerH, 2)} mm layers`)
        head.sub.set(`time-lapse: the whole build in ${SL.lapse} s, typical small SLS printer`, GREY)
        head.event.set(
          done ? 'done: cool down, then dig the gears out of the cake' : roll ? 'recoat: the roller spreads a fresh layer of powder' : sintering.length ? 'the laser fuses this layer of every gear' : 'gap between levels: recoating only, still costs time',
          done ? POWER : roll ? LABEL : HEAT,
        )
      },
      readouts: (p) => {
        const { V } = slRun(p)
        return [
          { label: 'Build + cool', value: durationText(V.total) },
          { label: 'Per gear', value: durationText(V.perPart) },
          { label: 'Bed filled', value: pct(V.packing) },
        ]
      },
    }
  },
}

// --- Choosing a process: FDM, MSLA or SLS for a robot part and a batch size. ---

const PROC_LOOK: Record<ProcessKey, { color: string; rough: number; metal: number }> = {
  fdm: { color: FILAMENT_COLOR, rough: 0.6, metal: 0 },
  msla: { color: RESIN_COLOR, rough: 0.2, metal: 0.1 },
  sls: { color: NYLON_COLOR, rough: 1, metal: 0 },
}
const BAR_COLOR: Record<ProcessKey, string> = { fdm: FILAMENT_COLOR, msla: UV_COLOR, sls: NYLON_COLOR }
const WHY: Record<ProcessKey, string> = {
  fdm: 'cheap, quick and on your desk',
  msla: 'the finest detail and smoothest surface',
  sls: 'strong every way, no supports, cheap in batches',
}
const NAMES = PROCESS_KEYS.map((k) => PROCESSES[k].name)
const cpRun = memoBy((p: Params) => `${p.part} ${p.qty}`, (p: Params) => {
  const part = pick(PICK_PARTS, p.part, 'gear') as PickPart
  return { part, qty: n(p, 'qty'), R: pickProcess(part, n(p, 'qty')) }
})
const money = (v: number) => `$${fixedText(v, 2)}`

export const otherProcessesChoosingAProcess: Lesson = {
  id: 'other-processes-choosing-a-process',
  title: 'Choosing a process',
  tagline: 'FDM, resin or powder: match the process to the part',
  formula: (p) => {
    const { R } = cpRun(p)
    return `score = cost + 0.6 × time + 1.5 × load × toughness + looks × smoothness − supports − missed detail, each relative to the best · ${R.rows.map((r) => `${PROCESSES[r.key].name} ${fixedText(r.score, 2)}`).join(' · ')} → ${PROCESSES[R.pick].name} (typical prices and times)`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'FDM (PLA)', shape: 'dot' },
    { color: UV_COLOR, label: 'MSLA (resin)', shape: 'dot' },
    { color: NYLON_COLOR, label: 'SLS (nylon)', shape: 'dot' },
  ],
  points: [
    'No process wins everything. FDM is cheap and probably already on your desk. MSLA resin gives the finest detail and smoothest surface. SLS nylon gives strong, support-free parts and gets cheap when the build is full. Start from what the part has to do.',
    'Detail: the smallest feature is about the nozzle width for FDM (0.4 mm), about two LCD pixels for MSLA (0.1 mm) and about the laser spot plus the powder grain for SLS (0.5 mm). A tiny figure is a resin job; a bracket is not.',
    'Strength: FDM parts are weakest across the layers (about half; orient the part so the layers run along the load). Standard resin is strong but brittle and chips on impact. SLS nylon is tough and nearly the same every way. See Strength and Materials › Stress and strain.',
    'Batch size changes the answer. FDM time grows with every extra part. MSLA prints a full plate in the time of one part, and SLS spreads its slow recoats and cool-down over everything nested in the build. One SLS gear costs a lot; forty do not.',
    'Flat plates are often better cut than printed: see Laser & CNC for acrylic, plywood and aluminium. Supports cost material and leave marks: FDM needs them under overhangs, resin almost always, SLS never.',
  ],
  controls: [
    { kind: 'choice', key: 'part', options: opts(namesOf(PICK_PARTS)), initial: 'gear' },
    { kind: 'slider', key: 'qty', label: 'How many', min: 1, max: 50, step: 1, initial: 1, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const XS = [-11.5, -0.5, 10.5]
    const stands = PROCESS_KEYS.map((key, i) => {
      const base = add(scene, new THREE.Group(), [XS[i], -1.9, 0])
      base.rotation.x = 0.32
      cylinder(base, 4, 0.6, mat('#2e323a', { rough: 0.6 }), [0, -0.3, 0], 'y', 40)
      const ring = cylinder(base, 4.15, 0.12, mat(RING, { emissive: RING }, true), [0, -0.02, 0], 'y', 40)
      const turn = add(base, new THREE.Group())
      const name = liveLabel(scene, [XS[i], -4.7, 0.4], { size: 0.44 })
      const note = liveLabel(scene, [XS[i], -5.5, 0.4], { size: 0.3 })
      return { key, turn, ring, name, note, glow: (_f: number) => {} }
    })
    const BX = [-13.4, -2.6, 8.2]
    const blocks = ['cost per part', 'time for the batch', 'tensile, weak way'].map((title, i) => {
      addLabel(scene, title, [BX[i] - 1.6, -7.3, 0.3], LABEL, 0.34, 'left')
      return countBars(scene, [BX[i], -8.3, 0], NAMES, 4.6, { row: 0.78, size: 0.32 })
    })
    const st = { part: '', spin: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { part, qty, R } = cpRun(p)
        const P = PICK_PARTS[part]
        if (part !== st.part) {
          st.part = part
          const k = Math.min(7 / P.size, 5.6 / P.h)
          for (const s of stands) {
            emptyGroup(s.turn)
            const L = PROC_LOOK[s.key]
            printedPart(s.turn, part, k, mat(L.color, { rough: L.rough, metal: L.metal }, true))
            s.glow = partGlow(s.turn, RING)
          }
        }
        st.spin += dt * 0.5
        R.rows.forEach((r, i) => {
          const s = stands[i]
          const best = r.key === R.pick
          s.turn.rotation.y = st.spin
          s.glow(best ? 0.35 + 0.15 * Math.sin(st.spin * 4) : 0)
          s.ring.visible = best
          const Pr = PROCESSES[r.key]
          s.name.set(`${Pr.name} · ${Pr.material}`, best ? RING : LABEL)
          s.note.set(`${r.detailOk ? `${Pr.featureMm} mm detail` : `${Pr.featureMm} mm: too coarse`} · ${r.supports ? 'supports' : 'no supports'}${r.key === 'msla' ? ' · brittle' : ''}`, r.detailOk ? (r.supports ? GREY : POWER) : HIGH_V)
        })
        const colors = R.rows.map((r) => BAR_COLOR[r.key])
        blocks[0].set(R.rows.map((r) => r.cost), R.rows.map((r) => money(r.cost)), colors)
        blocks[1].set(R.rows.map((r) => r.hours), R.rows.map((r) => hoursText(r.hours)), colors)
        blocks[2].set(R.rows.map((r) => r.strength), R.rows.map((r) => `${Math.round(r.strength)} MPa`), colors)
        const best = PROCESSES[R.pick]
        head.status.set(`Choosing a process · ${P.name} × ${qty}`)
        head.sub.set(`typical prices, times and strengths; ${best.where} for ${best.name}`, GREY)
        head.event.set(`pick ${best.name}: ${WHY[R.pick]}`, RING)
      },
      readouts: (p) => {
        const { R } = cpRun(p)
        const row = R.rows.find((r) => r.key === R.pick)!
        return [
          { label: 'Best pick', value: PROCESSES[R.pick].name },
          { label: 'Cost per part', value: money(row.cost) },
          { label: 'Batch time', value: hoursText(row.hours) },
        ]
      },
    }
  },
}

