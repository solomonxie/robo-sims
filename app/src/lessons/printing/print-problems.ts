import * as THREE from 'three/webgpu'
import {
  BELT_TENSION,
  BeltTension,
  CLOG,
  CLOG_FILAMENTS,
  COOL_FILAMENTS,
  CoolFilament,
  FILAMENTS,
  FOOT,
  FilamentKey,
  PROBE_Z,
  SHIFT,
  SHIFT_SPEEDS,
  STRING_FILAMENTS,
  STRING_TEST,
  UNDER,
  UNDER_FAULTS,
  UNDER_SPEEDS,
  UnderFault,
  WARP,
  clogView,
  dryHours,
  footView,
  hash01,
  shiftView,
  stringingView,
  underView,
  warpView,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, pct, signed } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
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
  beadCut,
  countBars,
  cursorBar,
  hotendSection,
  layerBlock,
  liveLabel,
  memoBy,
  nozzleCone,
  plotY,
  statusHeader,
  stringWeb,
  testTower,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

// One diagnosis scene for all six: the failed print on the left, symptom / cause / fix top right, causes ranked, a plot bottom right.
const PLOT = { x: 8.6, w: 12.4, y: -8.8, h: 8.2 }
interface Rank {
  now: number
  floor: number
  list: { key: string; name: string; gain: number }[]
  top: { key: string } | null
}
function diagStage(plotTitle: string, causes: readonly string[], barsTitle = 'Fix one cause alone: share of the problem it removes') {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const rows = textRows(scene, 3, 2.4, 3.6, 0.28, 0.66)
  addLabel(scene, barsTitle, [2.4, 1.5, 0.3], GREY, 0.24, 'left')
  const bars = countBars(scene, [10, 0.8, 0], causes, 3.6, { row: 0.56, size: 0.25, color: HEAT })
  const plot = titledScope(scene, PLOT.y, PLOT.h, plotTitle, LABEL, 0, PLOT.x, PLOT.w)
  const st = { key: '', t: 0 }
  return {
    scene,
    head,
    plot,
    clock(key: string, dt: number, loop: number) {
      if (key !== st.key) [st.key, st.t] = [key, 0]
      st.t = (st.t + dt) % loop
      return st.t
    },
    say(symptom: string, cause: string, fix: string, bad: boolean) {
      rows[0].set(`Symptom: ${symptom}`, bad ? HIGH_V : POWER)
      rows[1].set(`Cause: ${cause}`, bad ? HEAT : LABEL)
      rows[2].set(`Fix: ${fix}`, bad ? RING : GREY)
    },
    shares(values: readonly number[], top: number) {
      bars.set(values, values.map((v) => (v > 0.005 ? pct(v) : '–')), values.map((v, i) => (i === top ? HEAT : v > 0.005 ? LABEL : GREY)), 1)
    },
    rank(r: Rank) {
      const span = r.now - r.floor
      const vals = r.list.map((c) => (span > 0 ? c.gain / span : 0))
      this.shares(vals, r.top ? r.list.findIndex((c) => c.key === r.top!.key) : -1)
    },
  }
}
const bedPlate = (g: THREE.Object3D, w: number, d: number) => box(g, [w, 0.4, d], mat('#3a3f47', { rough: 0.6 }), [0, -0.2, 0])

// --- Stringing ---

const STR_NAMES = Object.fromEntries(STRING_FILAMENTS.map((f) => [f, FILAMENTS[f].name])) as Record<FilamentKey, string>
const strParams = (p: Params) => ({ fil: pick(STR_NAMES, p.fil, 'pla') as FilamentKey, dc: n(p, 'dc'), retractMm: n(p, 'retract'), wetDays: n(p, 'wet'), travelMmS: n(p, 'travel') })
const strKey = (p: Params) => `${p.fil} ${p.dc} ${p.retract} ${p.wet} ${p.travel}`
const strRun = memoBy(strKey, (p: Params) => {
  const q = strParams(p)
  return { q, V: stringingView(q) }
})
const ST = { k: 0.2, at: [-8.4, -11.6, 0] as V3, span: 40, tower: 10, bands: 5, bandH: 9, loop: 2.4 }

export const printProblemsStringing: Lesson = {
  id: 'print-problems-stringing',
  title: 'Stringing',
  tagline: 'Hairs between parts: melt oozing on the travel',
  formula: (p) => {
    const { q, V } = strRun(p)
    return `strings ≈ (0.25 + leak (retraction)) × (0.15 + 1.5 × runny (temperature)) × ooze time + steam (moisture) = ${fixedText(0.25 + V.leak, 2)} × ${fixedText(0.15 + 1.5 * V.hot, 2)} × ${fixedText(0.4 + 0.6 * V.ooze, 2)} + ${fixedText(0.7 * V.steam, 2)} → ${V.count} of ${STRING_TEST.travels} travels · travel ${STRING_TEST.travelMm} mm at ${q.travelMmS} mm/s, typical`
  },
  legend: [
    { color: HEAT, label: 'Strings vs nozzle temperature', shape: 'dot' },
    { color: RING, label: 'Your temperature', shape: 'dot' },
    { color: GREY, label: 'Temperature tower value', shape: 'dot' },
    { color: POWER, label: 'Acceptable (2 of 12)', shape: 'dot' },
  ],
  points: [
    'Fine hairs or a cobweb between two parts, or between towers on the same plate. They come from melt that leaves the nozzle while the head travels without printing, then stretches and cools into a thread.',
    'Four causes, in the usual order to check: the nozzle is too hot, so the melt stays runny (Calibration > Temperature tower); retraction is too short to drop the nozzle pressure (Calibration > Retraction); the filament is wet, so steam keeps pushing melt out even after a retraction, with popping and a rough surface (Filaments > Drying wet filament); and slow travel gives the ooze time to stretch.',
    'The bars rank them for the current setup by fixing each one alone. PETG and TPU string more than PLA at their right temperature; nylon is the thirstiest.',
    'Slicer helpers: "avoid crossing perimeters" (travel inside the part), wipe and coasting. A quick pass with a heat gun removes light strings from a finished print.',
  ],
  controls: [
    { kind: 'choice', key: 'fil', options: opts(STR_NAMES), initial: 'pla' },
    { kind: 'slider', key: 'dc', label: 'Nozzle vs the tower value', min: -20, max: 25, step: 5, initial: 15, format: (v) => `${signed(v, 0)} °C` },
    { kind: 'slider', key: 'retract', label: 'Retraction (direct drive)', min: 0, max: 3, step: 0.1, initial: 0.8, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'wet', label: 'Days open in 50 % RH', min: 0, max: 30, step: 1, initial: 0, format: (v) => `${v} d` },
    { kind: 'slider', key: 'travel', label: 'Travel speed', min: 30, max: 300, step: 10, initial: 120, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const c = diagStage('strings vs nozzle temperature', ['Nozzle too hot', 'Retraction too short', 'Wet filament', 'Slow travel'])
    const { scene, head, plot } = c
    const { k, span, tower, bands, bandH } = ST
    const g = add(scene, new THREE.Group(), ST.at)
    g.rotation.set(0.28, -0.35, 0)
    g.scale.setScalar(1.15)
    bedPlate(g, (span + 30) * k, 30 * k)
    const towers = [-1, 1].map((sx) => testTower(g, [((sx * span) / 2) * k, 0, 0], k, bands, { w: tower, d: tower, bandH, tab: 0 }))
    const web = stringWeb(g, STRING_TEST.travels)
    const H = bands * bandH * k
    const nozzle = nozzleCone(g)
    const S = plot.s
    const tr = S.trace(HEAT, { samples: 41, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const tower0 = cursorBar(S, GREY, 0.04)
    const ok = S.level(POWER)
    plot.lo.set('−20 °C')
    plot.hi.set('+20 °C')
    const py = plotY(0, 1.05, PLOT.h)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = strRun(p)
        const f = FILAMENTS[q.fil]
        const t = c.clock(strKey(p), dt, ST.loop)
        nozzle.position.set(Math.sin((t / ST.loop) * Math.PI * 2) * (span / 2) * k, H + 0.7, 0)
        towers.forEach((tw) => {
          for (let i = 0; i < bands; i++) tw.set(i, FILAMENT_COLOR, 0, V.steam * 0.3)
        })
        const a = (span / 2 - tower / 2) * k
        web.set(Array.from({ length: V.count }, (_, i) => {
          const y = (0.08 + 0.9 * hash01(i * 7.3 + 1)) * H
          return { a: [-a, y, (hash01(i * 3.1) - 0.5) * tower * k] as V3, b: [a, y - hash01(i * 5.7) * 0.3, (hash01(i * 9.7) - 0.5) * tower * k] as V3, sag: 0.2 + 0.5 * hash01(i * 2.9), r: 0.02 + 0.03 * hash01(i * 4.3) }
        }))
        tr.points(V.dcs.map((d) => (d + 20) / 40), V.curve.map(py), null)
        cur(Math.min(1, (q.dc + 20) / 40))
        tower0(0.5)
        ok.set(py(STRING_TEST.okShare))
        plot.right.set(`${celsiusText(f.nozzleC + q.dc)}: ${pct(V.share)}`, RING)
        c.rank(V.rank)
        const top = V.rank.top?.key
        const bad = top !== undefined
        const wetH = dryHours(q.fil, V.wetPct, f.dryC)
        const cause =
          top === 'temp' ? `${celsiusText(f.nozzleC + q.dc)} melt stays runny through the travel`
          : top === 'retract' ? `${mmFixed(q.retractMm, 1)} retraction leaves the nozzle under pressure`
          : top === 'wet' ? `${fixedText(V.wetPct, 2)} % water: steam pushes melt out`
          : top === 'travel' ? `${fixedText(STRING_TEST.travelMm / q.travelMmS, 2)} s over the gap: time to ooze`
          : 'pressure relieved, melt stiff enough to snap off'
        const fix =
          top === 'temp' ? `print at ${celsiusText(f.nozzleC)} (Temperature tower)`
          : top === 'retract' ? `retract ${mmFixed(STRING_TEST.goodRetract, 1)} (Calibration > Retraction)`
          : top === 'wet' ? `dry at ${celsiusText(f.dryC)} for ${Number.isFinite(wetH) ? `${Math.ceil(wetH)} h` : 'long'}, typical`
          : top === 'travel' ? 'travel 200 mm/s or more, avoid crossing perimeters'
          : 'nothing to do'
        c.say(bad ? `strings on ${V.count} of ${STRING_TEST.travels} travels` : `clean travels (${V.count} of ${STRING_TEST.travels})`, cause, fix, bad)
        head.status.set(`Stringing · ${f.name}`)
        head.sub.set(`two towers ${span} mm apart, ${STRING_TEST.travels} travels shown`, GREY)
        head.event.set(bad ? 'diagnose: biggest bar first' : 'clean', bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { q, V } = strRun(p)
        return [
          { label: 'Strings', value: `${V.count} / ${STRING_TEST.travels}`, tone: toneOf(V.share <= STRING_TEST.okShare, V.share < 0.5) },
          { label: 'Nozzle', value: celsiusText(FILAMENTS[q.fil].nozzleC + q.dc), tone: toneOf(q.dc <= 0, q.dc <= 10) },
          { label: 'Moisture', value: `${fixedText(V.wetPct, 2)} %`, tone: toneOf(V.steam === 0, V.steam < 0.5) },
          { label: 'Travel time', value: `${fixedText(STRING_TEST.travelMm / q.travelMmS, 2)} s` },
        ]
      },
    }
  },
}

// --- Warping ---

const ENCLOSURE = { open: 'Open frame', closed: 'Enclosure' }
const wpParams = (p: Params) => ({ mat: pick(COOL_FILAMENTS, p.mat, 'asa') as CoolFilament, bedC: n(p, 'bed'), enclosed: p.enc === 'closed', draft: n(p, 'draft'), brimMm: n(p, 'brim') })
const wpKey = (p: Params) => `${p.mat} ${p.bed} ${p.enc} ${p.draft} ${p.brim}`
const wpRun = memoBy(wpKey, (p: Params) => {
  const q = wpParams(p)
  return { q, V: warpView(q) }
})
const WP = { k: 0.21, at: [-9.2, -8.4, 0] as V3, w: 60, d: 22, layers: 14, cols: 15, layerH: 1.6, loop: 6 }

export const printProblemsWarping: Lesson = {
  id: 'print-problems-warping',
  title: 'Warping',
  tagline: 'Corners curling up as the layers shrink',
  formula: (p) => {
    const { V } = wpRun(p)
    return `lift ≈ (1 − hold / pull) × ${WARP.liftMm} mm · hold = corner grip ${fixedText(V.hold, 1)} N (Bed adhesion > Brim and raft) · pull = shrink below Tg × air × draft = ${fixedText(V.pull, 1)} N → ${mmFixed(V.lift, 1)}, typical`
  },
  legend: [
    { color: POWER, label: 'Corner hold vs brim width', shape: 'dot' },
    { color: HIGH_V, label: 'Shrink pull', shape: 'dot' },
    { color: RING, label: 'Your brim', shape: 'dot' },
  ],
  points: [
    'The ends or corners of a long part curl up off the bed, often a few layers in, and the bottom edges come out rounded. Every layer shrinks as it cools below Tg on top of a layer that has already shrunk, so the stack bends like a bimetal strip and pulls hardest at the corners (Temperature & cooling > Part cooling fan).',
    'It is a contest: shrink pull against the first layer\'s grip at the corner. ASA and ABS shrink about twice as much as PLA and need a warm bed and warm air; PLA warps on a cold bed or in a draft. A hot bed keeps the bottom near Tg, so less shrink is locked in (Bed adhesion > Build surfaces).',
    'Fixes, from cheapest: bed at the material\'s temperature, no fans or open windows blowing on the part, a brim or mouse ears (Bed adhesion > Brim and raft), an enclosure (about 45 °C air) for ASA and ABS, rounded corners in the model (Design for printing). Do not enclose PLA: the warm air causes heat creep (Clogged nozzle).',
  ],
  controls: [
    { kind: 'choice', key: 'mat', options: opts(COOL_FILAMENTS), initial: 'asa' },
    { kind: 'slider', key: 'bed', label: 'Bed temperature', min: 25, max: 110, step: 5, initial: 100, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'enc', options: opts(ENCLOSURE), initial: 'open' },
    { kind: 'slider', key: 'draft', label: 'Draft across the part', min: 0, max: 1, step: 0.1, initial: 0.4, format: pct },
    { kind: 'slider', key: 'brim', label: 'Brim width', min: 0, max: 12, step: 1, initial: 0, format: (v) => mmFixed(v, 0) },
  ],
  build(): Stage {
    const c = diagStage('corner force vs brim width', ['Bed too cool', 'Draft on the part', 'No enclosure', 'No brim'])
    const { scene, head, plot } = c
    const { k, w, d, layers, cols, layerH } = WP
    const g = add(scene, new THREE.Group(), WP.at)
    g.rotation.set(0.32, -0.42, 0)
    bedPlate(g, (w + 28) * k, (d + 22) * k)
    const brimM = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.6 })
    const brim = box(g, [1, 0.06, 1], brimM, [0, 0.03, 0])
    const part = layerBlock(g, [0, 0, 0], k, { w, d, layers, cols, layerH })
    const liftText = liveLabel(scene, [-9.2, 0.6, 0.3], { size: 0.36 })
    const S = plot.s
    const tHold = S.trace(POWER, { samples: 25, radius: 0.06 })
    const tPull = S.trace(HIGH_V, { samples: 25, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    plot.lo.set('0 mm')
    plot.hi.set('12 mm')
    const st = { lift: 0, grow: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = wpRun(p)
        const f = FILAMENTS[q.mat]
        const t = c.clock(wpKey(p), dt, WP.loop)
        st.grow = Math.min(1, t / (WP.loop * 0.6))
        const lift = V.lift * st.grow
        st.lift = lift
        const shown = Math.max(1, Math.ceil(st.grow * layers))
        const tone = V.lift > 0.05 ? HIGH_V : FILAMENT_COLOR
        part.set((i, j) => {
          const u = Math.abs((j + 0.5) / cols - 0.5) * 2
          const up = lift * 5 * u ** 2.4
          return { dx: 0, dy: i < shown ? up : -999, grow: 0, color: u > 0.7 && V.lift > 0.05 ? tone : FILAMENT_COLOR }
        })
        brim.visible = q.brimMm > 0
        brim.scale.set((w + 2 * q.brimMm) * k, 1, (d + 2 * q.brimMm) * k)
        liftText.set(V.lift > 0.05 ? `corner lifts ${mmFixed(lift, 1)}` : 'corners flat', V.lift > 0.05 ? HIGH_V : POWER)
        const max = Math.max(...V.pulls, ...V.holds) * 1.15
        const py = plotY(0, max, PLOT.h)
        const xs = V.brims.map((b) => b / 12)
        tHold.points(xs, V.holds.map(py), null)
        tPull.points(xs, V.pulls.map(py), null)
        cur(q.brimMm / 12)
        plot.right.set(`hold ${fixedText(V.hold, 1)} N vs pull ${fixedText(V.pull, 1)} N`, RING)
        c.rank(V.rank)
        const top = V.rank.top?.key
        const bad = V.lift > 0.05
        const cause =
          top === 'bed' ? `bed at ${celsiusText(q.bedC)}: weak grip, more shrink locked in`
          : top === 'draft' ? `draft cools one side fast: pull ×${fixedText(1 + WARP.draftGain * q.draft, 1)}`
          : top === 'open' ? `room air: ${f.name} shrinks ×${fixedText(V.pull / Math.max(0.1, V.hold), 1)} what the corner holds`
          : top === 'brim' ? 'only the corner\'s own first layer holds it down'
          : bad ? 'shrink pull beats the corner grip' : 'corner grip beats the shrink pull'
        const fix =
          top === 'bed' ? `bed to ${celsiusText(f.bedC)}`
          : top === 'draft' ? 'shield the part from fans, doors and windows'
          : top === 'open' ? `enclosure, about ${celsiusText(WARP.chamberC)} air (typical)`
          : top === 'brim' ? `${mmFixed(WARP.goodBrim, 0)} brim (Bed adhesion > Brim and raft)`
          : bad ? 'more grip or less shrink' : 'nothing to do'
        c.say(bad ? `corners lift ${mmFixed(V.lift, 1)}` : 'corners stay down', cause, fix, bad)
        head.status.set(`Warping · ${f.name}`)
        head.sub.set(`${w} × ${d} mm box on textured PEI, lift drawn ×5`, GREY)
        head.event.set(bad ? 'diagnose: biggest bar first' : `margin ×${fixedText(V.margin, 1)}`, bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { V } = wpRun(p)
        return [
          { label: 'Corner lift', value: mmFixed(V.lift, 1), tone: toneOf(V.lift < 0.05, V.lift < 1) },
          { label: 'Hold', value: `${fixedText(V.hold, 1)} N` },
          { label: 'Pull', value: `${fixedText(V.pull, 1)} N` },
          { label: 'Margin', value: `×${fixedText(V.margin, 2)}`, tone: toneOf(V.margin > 1.3, V.margin > 1) },
        ]
      },
    }
  },
}

// --- Layer shift ---

const CURL = { no: 'Flat top', yes: 'Curled overhang' }
const lsParams = (p: Params) => ({ speed: n(p, 'speed'), accel: n(p, 'accel'), amps: n(p, 'amps'), belt: pick(BELT_TENSION, p.belt, 'tight') as BeltTension, curl: p.curl === 'yes' })
const lsKey = (p: Params) => `${p.speed} ${p.accel} ${p.amps} ${p.belt} ${p.curl}`
const lsRun = memoBy(lsKey, (p: Params) => {
  const q = lsParams(p)
  return { q, V: shiftView(q) }
})
const LS = { k: 0.3, at: [-8.6, -10.2, 0] as V3, w: 24, d: 16, layers: 30, layerH: 1.2, shiftAt: 17, loop: 7 }

export const printProblemsLayerShift: Lesson = {
  id: 'print-problems-layer-shift',
  title: 'Layer shift',
  tagline: 'Everything above one layer is offset',
  formula: (p) => {
    const { q, V } = lsRun(p)
    return `need = m·a + friction + strike = ${SHIFT.kg} kg × ${q.accel} mm/s² + ${SHIFT.frictionN} N${q.curl ? ` + ${SHIFT.curlN} N` : ''} = ${fixedText(V.need, 1)} N vs motor ${fixedText(V.motor, 1)} N at ${q.speed} mm/s, ${fixedText(q.amps, 1)} A, belt ${V.belt} N → ${V.mm > 0 ? `shift ${mmFixed(V.mm, 1)}` : 'holds'}, typical`
  },
  legend: [
    { color: POWER, label: 'Motor force vs speed (pull-out)', shape: 'dot' },
    { color: HIGH_V, label: 'Force the move needs', shape: 'dot' },
    { color: B_FIELD, label: 'Belt tooth-jump force', shape: 'dot' },
    { color: RING, label: 'Your travel speed', shape: 'dot' },
  ],
  points: [
    'From one height up the whole print sits sideways, as if someone pushed it. The motor is open loop: when a move needs more force than the stepper gives at that speed, the rotor slips out of step and the firmware never knows (Actuators > Stepper motors, Printer motion > Steps per mm).',
    'Stepper slips come in groups of four full steps (0.8 mm on a 20-tooth GT2 pulley); a slack belt jumps whole teeth (2 mm). The force needed is the moving mass times the acceleration plus friction, and a big spike when the nozzle hits a part that curled up (Warping, Part cooling fan).',
    'The force available falls off at high speed (back-EMF eats the supply voltage) and scales with the driver current. Fix in that order: find what the nozzle hits, tension the belts, lower acceleration or top speed, then raise the driver current (watch the motor and driver temperature: an overheated driver cuts out and shifts too).',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Travel speed', min: 50, max: 600, step: 10, initial: 200, format: (v) => `${v} mm/s` },
    { kind: 'slider', key: 'accel', label: 'Acceleration', min: 500, max: 20000, step: 500, initial: 8000, format: (v) => `${v} mm/s²` },
    { kind: 'slider', key: 'amps', label: 'Driver current', min: 0.3, max: 1.5, step: 0.1, initial: 0.8, format: (v) => `${fixedText(v, 1)} A` },
    { kind: 'choice', key: 'belt', options: opts(namesOf(BELT_TENSION)), initial: 'slack' },
    { kind: 'choice', key: 'curl', options: opts(CURL), initial: 'yes' },
  ],
  build(): Stage {
    const c = diagStage('force vs travel speed', ['Acceleration too high', 'Travel too fast', 'Driver current too low', 'Loose belt', 'Nozzle hits a curled edge'])
    const { scene, head, plot } = c
    const { k, w, d, layers, layerH, shiftAt } = LS
    const g = add(scene, new THREE.Group(), LS.at)
    g.rotation.set(0.14, -0.5, 0)
    bedPlate(g, (w + 24) * k, (d + 20) * k)
    const part = layerBlock(g, [0, 0, 0], k, { w, d, layers, layerH })
    const nozzle = nozzleCone(g, 0.5, 1.3)
    const mark = liveLabel(g, [(-w / 2 - 2) * k, (shiftAt + 0.5) * layerH * k, (d / 2) * k], { size: 0.34, align: 'right' })
    const S = plot.s
    const tMotor = S.trace(POWER, { samples: SHIFT_SPEEDS.length, radius: 0.06 })
    const need = S.level(HIGH_V)
    const belt = S.level(B_FIELD)
    const cur = cursorBar(S, RING, 0.06)
    plot.lo.set('0 mm/s')
    plot.hi.set('600 mm/s')
    const xs = SHIFT_SPEEDS.map((v) => v / 600)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = lsRun(p)
        const t = c.clock(lsKey(p), dt, LS.loop)
        const now = Math.min(layers, (t / (LS.loop * 0.55)) * layers)
        const off = V.mm * 2
        part.set((i) => ({ dx: i >= shiftAt && i < now ? off : 0, dy: i < now ? 0 : -999, grow: 0, color: i >= shiftAt && V.mm > 0 ? HEAT : FILAMENT_COLOR }))
        const top = Math.max(1, Math.floor(now))
        nozzle.position.set(((now >= shiftAt ? off : 0) + Math.sin(t * 9) * w * 0.4) * k, top * layerH * k + 0.65, 0)
        mark.set(V.mm > 0 && now >= shiftAt ? `skipped here: ${mmFixed(V.mm, 1)}` : '', HIGH_V)
        const py = plotY(0, Math.max(V.need, V.belt, ...V.motors) * 1.25, PLOT.h)
        tMotor.points(xs, V.motors.map(py), null)
        need.set(py(V.need))
        belt.set(py(V.belt))
        cur(q.speed / 600)
        plot.right.set(`need ${fixedText(V.need, 0)} N · limit ${fixedText(V.limit, 0)} N`, RING)
        c.rank(V.rank)
        const key = V.rank.top?.key
        const bad = V.mm > 0
        const cause =
          key === 'accel' ? `${SHIFT.kg} kg bed at ${q.accel} mm/s² needs ${fixedText((SHIFT.kg * q.accel) / 1000, 0)} N`
          : key === 'speed' ? `at ${q.speed} mm/s back-EMF leaves ${fixedText(V.motor, 0)} N`
          : key === 'amps' ? `${fixedText(q.amps, 1)} A gives only ${fixedText(V.motor, 0)} N`
          : key === 'belt' ? `${BELT_TENSION[q.belt].name.toLowerCase()}: jumps a tooth at ${V.belt} N`
          : key === 'curl' ? `nozzle strikes a curled edge: +${SHIFT.curlN} N spike`
          : `need ${fixedText(V.need, 0)} N, limit ${fixedText(V.limit, 0)} N`
        const fix =
          key === 'accel' ? 'acceleration to 3000 mm/s² or input shaping'
          : key === 'speed' ? 'travel at 250 mm/s or less'
          : key === 'amps' ? 'raise driver current to about 1.1 A (watch heat)'
          : key === 'belt' ? 'tension the belt (Printer motion)'
          : key === 'curl' ? 'more part cooling, Z-hop on travel'
          : 'nothing to do'
        c.say(bad ? `layers ${shiftAt + 1}+ offset ${mmFixed(V.mm, 1)} (${V.byBelt ? 'belt jumped' : 'motor skipped'})` : 'layers line up', cause, fix, bad)
        head.status.set('Layer shift · bed-slinger Y axis')
        head.sub.set(`${w} × ${d} mm part, offset drawn ×2`, GREY)
        head.event.set(bad ? 'diagnose: biggest bar first' : `margin ×${fixedText(V.limit / V.need, 1)}`, bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { V } = lsRun(p)
        return [
          { label: 'Offset', value: mmFixed(V.mm, 1), tone: toneOf(V.mm === 0, false) },
          { label: 'Needed', value: `${fixedText(V.need, 0)} N` },
          { label: 'Motor', value: `${fixedText(V.motor, 0)} N`, tone: toneOf(V.motor > V.need * 1.3, V.motor >= V.need) },
          { label: 'Belt', value: `${V.belt} N`, tone: toneOf(V.belt > V.need * 1.3, V.belt >= V.need) },
        ]
      },
    }
  },
}

// --- Under-extrusion ---

const ueParams = (p: Params) => ({ fault: pick(UNDER_FAULTS, p.fault, 'clog') as UnderFault, speed: n(p, 'speed'), blockC: n(p, 'temp') })
const ueKey = (p: Params) => `${p.fault} ${p.speed} ${p.temp}`
const ueRun = memoBy(ueKey, (p: Params) => {
  const q = ueParams(p)
  return { q, V: underView(q.fault, q.speed, q.blockC) }
})
const LOSS_KEYS = ['melt', 'clog', 'gear', 'diameter'] as const
const UE = { k: 5.6, at: [-9.4, -5.4, 0] as V3, lines: 6 }

export const printProblemsUnderExtrusion: Lesson = {
  id: 'print-problems-under-extrusion',
  title: 'Under-extrusion',
  tagline: 'Gaps and thin walls: less plastic than asked',
  formula: (p) => {
    const { V } = ueRun(p)
    return `asked = line × layer × speed = ${fixedText(V.want, 1)} mm³/s · delivered = min(asked × (d / 1.75)² × (1 − gear slip), melt limit ${fixedText(V.cap, 1)}) = ${fixedText(V.got, 1)} mm³/s → ${pct(V.ratio)}, wall ${mmFixed(V.wallMm, 2)}, typical`
  },
  legend: [
    { color: GREY, label: 'Flow the slicer asks for', shape: 'dot' },
    { color: HEAT, label: 'Flow delivered', shape: 'dot' },
    { color: RING, label: 'Your speed', shape: 'dot' },
  ],
  points: [
    'Gaps between lines, thin or missing top layers, walls you can see through, a weak spongy part. The slicer asked for a flow (line width × layer height × speed) and less arrived.',
    'Four common causes, one after the other from the gear to the tip: the filament is thinner than the slicer thinks (measure it with calipers); the drive gear slips (worn teeth, loose idler: it clicks and leaves a ground groove); a partial clog chokes the nozzle; or the speed asks more than the hotend can melt (How FDM works > Hotend and extruder, max volumetric flow).',
    'Read the plot: when delivered falls away from asked only above a speed, it is the melt limit (slow down or print hotter); a fixed share short at every speed is the diameter or the flow multiplier (Calibration > Flow rate, E-steps); a low ceiling far below the hotend\'s rating is a clog (Clogged nozzle).',
  ],
  controls: [
    { kind: 'choice', key: 'fault', options: opts(UNDER_FAULTS), initial: 'clog' },
    { kind: 'slider', key: 'speed', label: 'Print speed', min: 10, max: 200, step: 5, initial: 80, format: (v) => `${v} mm/s` },
    { kind: 'slider', key: 'temp', label: 'Nozzle temperature (PLA)', min: 190, max: 240, step: 5, initial: 210, format: (v) => `${v} °C` },
  ],
  build(): Stage {
    const c = diagStage('flow vs speed', ['Too fast for the melt', 'Partial clog', 'Gear slipping', 'Thin filament'], 'Where the missing flow went (share of the shortfall)')
    const { scene, head, plot } = c
    const g = add(scene, new THREE.Group(), UE.at)
    g.rotation.set(0.22, -0.3, 0)
    const cut = beadCut(g, [0, 0, 0], UE.k, UE.lines, 6)
    cut.nozzle.visible = false
    const note = liveLabel(g, [0, -1.2, 3.4], { size: 0.32 })
    const S = plot.s
    const tWant = S.trace(GREY, { samples: UNDER_SPEEDS.length, radius: 0.05 })
    const tGot = S.trace(HEAT, { samples: UNDER_SPEEDS.length, radius: 0.07 })
    const cur = cursorBar(S, RING, 0.06)
    plot.lo.set('10 mm/s')
    plot.hi.set('200 mm/s')
    const py = plotY(0, 20, PLOT.h)
    const xs = UNDER_SPEEDS.map((v) => (v - 10) / 190)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = ueRun(p)
        const h = UNDER.layerH * Math.min(1, 0.6 + 0.4 * V.ratio)
        cut.set(h, Math.max(h, V.wallMm), V.spacing, 0.25 + h, V.ratio > 0.95 ? FILAMENT_COLOR : HEAT)
        note.set(`wall line ${mmFixed(V.wallMm, 2)} · gap ${mmFixed(V.gapMm, 2)}`, V.gapMm > 0.01 ? HIGH_V : POWER)
        tWant.points(xs, V.wants.map(py), null)
        tGot.points(xs, V.gots.map(py), null)
        cur((q.speed - 10) / 190)
        plot.right.set(`${fixedText(V.got, 1)} of ${fixedText(V.want, 1)} mm³/s`, RING)
        const short = V.want - V.got
        const vals = LOSS_KEYS.map((key) => (short > 1e-6 ? V.lost[key] / short : 0))
        const top = vals.reduce((b, v, i) => (v > vals[b] ? i : b), 0)
        c.shares(vals, short > 1e-6 ? top : -1)
        const bad = V.ratio < 0.95
        const key = bad ? LOSS_KEYS[top] : null
        const cause =
          key === 'melt' ? `${fixedText(V.want, 1)} mm³/s is past what ${celsiusText(q.blockC)} can melt (${fixedText(V.capClean, 1)})`
          : key === 'clog' ? `partial clog: ceiling ${fixedText(V.cap, 1)} mm³/s`
          : key === 'gear' ? `worn gear slips ${pct(V.slip)} of its travel`
          : key === 'diameter' ? `${mmFixed(UNDER.thinMm, 2)} filament carries ${pct(V.diam)} of the plastic`
          : 'delivered matches what the slicer asks'
        const fix =
          key === 'melt' ? `slow to ${Math.floor(V.maxSpeed / 5) * 5} mm/s or print hotter`
          : key === 'clog' ? 'clear the nozzle (Clogged nozzle: cold pull)'
          : key === 'gear' ? 'clean or replace the gear, set idler tension'
          : key === 'diameter' ? 'measure it, enter 1.65 mm in the slicer'
          : 'nothing to do'
        c.say(bad ? `${pct(V.ratio)} of the flow: gaps between lines` : 'lines touch, walls solid', cause, fix, bad)
        head.status.set(`Under-extrusion · ${UNDER_FAULTS[q.fault]}`)
        head.sub.set('wall lines cut across, PLA, 0.4 mm nozzle', GREY)
        head.event.set(bad ? 'diagnose: biggest bar first' : 'flow OK', bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { V } = ueRun(p)
        return [
          { label: 'Delivered', value: pct(V.ratio), tone: toneOf(V.ratio > 0.95, V.ratio > 0.85) },
          { label: 'Asked', value: `${fixedText(V.want, 1)} mm³/s` },
          { label: 'Melt limit', value: `${fixedText(V.cap, 1)} mm³/s` },
          { label: 'Gap', value: mmFixed(V.gapMm, 2), tone: toneOf(V.gapMm < 0.01, V.gapMm < 0.05) },
        ]
      },
    }
  },
}

// --- Elephant foot ---

const efParams = (p: Params) => ({ mat: pick(COOL_FILAMENTS, p.mat, 'pla') as CoolFilament, zOffset: n(p, 'z'), bedC: n(p, 'bed'), chamfer: n(p, 'chamfer') })
const efKey = (p: Params) => `${p.mat} ${p.z} ${p.bed} ${p.chamfer}`
const efRun = memoBy(efKey, (p: Params) => {
  const q = efParams(p)
  return { q, V: footView(q) }
})
const EF = { k: 0.36, at: [-8, -10, 0] as V3, w: 30, d: 20, layers: 16, layerH: 0.9, draw: 10 }

export const printProblemsElephantFoot: Lesson = {
  id: 'print-problems-elephant-foot',
  title: 'Elephant foot',
  tagline: 'The bottom layers bulge outward',
  formula: (p) => {
    const { V } = efRun(p)
    return `bulge = squish (Z offset) + soft bottom (bed vs Tg) = ${mmFixed(V.squish, 2)} + ${mmFixed(V.soft, 2)} = ${mmFixed(V.bulge, 2)} · after the chamfer ${mmFixed(V.left, 2)} vs fit tolerance ${mmFixed(FOOT.fitMm, 2)}, typical`
  },
  legend: [
    { color: HEAT, label: 'Bulge vs Z offset', shape: 'dot' },
    { color: RING, label: 'Your Z offset', shape: 'dot' },
    { color: GREY, label: 'Right Z offset', shape: 'dot' },
    { color: POWER, label: 'Fit tolerance', shape: 'dot' },
  ],
  points: [
    'The first few layers stick out past the walls above, so a box measures wider at the bottom and a press-fit hole is tight at its base. Two causes add up: the nozzle squashes the first layer too flat (Bed adhesion > Z offset), and a hot bed keeps the bottom layers soft while the weight of the part and each new hot layer push them out.',
    'Check the first layer first: a glossy, wide, ridged first layer means the nozzle is too close; raise the Z offset until the lines are just flat. Then try the bed 5–10 °C cooler, as long as the part still sticks (Warping).',
    'For parts that must fit, model a 0.4–0.6 mm 45° chamfer on the bottom edge: the bulge fills it instead of sticking out (Design for printing > Chamfers vs fillets). Many slicers also have an "elephant foot compensation" that shrinks the first layer outline.',
  ],
  controls: [
    { kind: 'choice', key: 'mat', options: opts(COOL_FILAMENTS), initial: 'pla' },
    { kind: 'slider', key: 'z', label: 'Z offset (M851)', min: -2.05, max: -1.7, step: 0.01, initial: -1.95, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'bed', label: 'Bed temperature', min: 40, max: 110, step: 5, initial: 70, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'chamfer', label: 'Bottom chamfer', min: 0, max: 1, step: 0.1, initial: 0, format: (v) => mmFixed(v, 1) },
  ],
  build(): Stage {
    const c = diagStage('bulge vs Z offset', ['Nozzle too close', 'Bed too hot', 'No chamfer'])
    const { scene, head, plot } = c
    const { k, w, d, layers, layerH, draw } = EF
    const g = add(scene, new THREE.Group(), EF.at)
    g.rotation.set(0.12, -0.55, 0)
    bedPlate(g, (w + 18) * k, (d + 16) * k)
    const part = layerBlock(g, [0, 0, 0], k, { w, d, layers, layerH })
    const note = liveLabel(g, [(w / 2 + 2) * k, 0.4, (d / 2) * k], { size: 0.34, align: 'left' })
    const S = plot.s
    const tr = S.trace(HEAT, { samples: 26, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const right = cursorBar(S, GREY, 0.04)
    const fit = S.level(POWER)
    const zs = [PROBE_Z.trueMm - 0.15, PROBE_Z.trueMm + 0.1]
    plot.lo.set(mmFixed(zs[0], 2))
    plot.hi.set(mmFixed(zs[1], 2))
    const py = plotY(0, 0.6, PLOT.h)
    const ux = (z: number) => (z - zs[0]) / (zs[1] - zs[0])
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = efRun(p)
        part.set((i) => {
          const zMm = (i + 0.5) * V.firstH
          const out = V.bulge * Math.exp(-i / (FOOT.layers / 2.5)) - Math.max(0, q.chamfer - zMm)
          return { dx: 0, dy: 0, grow: out * draw * (layerH / EF.layerH), color: out > FOOT.fitMm ? HIGH_V : out > 0.03 ? HEAT : FILAMENT_COLOR }
        })
        note.set(V.left > 0 ? `+${mmFixed(V.left, 2)} per side` : 'flush', V.fits ? POWER : HIGH_V)
        tr.points(V.zs.map(ux), V.curve.map(py), null)
        cur(ux(q.zOffset))
        right(ux(PROBE_Z.trueMm))
        fit.set(py(FOOT.fitMm))
        plot.right.set(`bulge ${mmFixed(V.bulge, 2)} · gap ${mmFixed(V.gap, 2)}`, RING)
        c.rank(V.rank)
        const key = V.rank.top?.key
        const bad = !V.fits
        const f = FILAMENTS[q.mat]
        const cause =
          key === 'z' ? `first layer squashed into a ${mmFixed(V.gap, 2)} gap: +${mmFixed(V.squish, 2)}`
          : key === 'bed' ? `bed ${celsiusText(q.bedC)} near Tg ${celsiusText(f.tgC)}: bottom stays soft, +${mmFixed(V.soft, 2)}`
          : key === 'chamfer' ? `square bottom edge shows the whole ${mmFixed(V.bulge, 2)}`
          : `${mmFixed(V.left, 2)} is inside the fit tolerance`
        const fix =
          key === 'z' ? `Z offset back to ${mmFixed(PROBE_Z.trueMm, 2)} (Bed adhesion > Z offset)`
          : key === 'bed' ? `bed to ${celsiusText(f.bedC - 5)}`
          : key === 'chamfer' ? `${mmFixed(FOOT.goodChamfer, 1)} chamfer (Design for printing)`
          : 'nothing to do'
        c.say(bad ? `bottom ${mmFixed(V.left, 2)} wider per side` : 'bottom edge flush enough', cause, fix, bad)
        head.status.set(`Elephant foot · ${f.name}`)
        head.sub.set(`${w} × ${d} mm block, bulge drawn ×${draw}, layers drawn thick`, GREY)
        head.event.set(bad ? 'diagnose: biggest bar first' : 'fits', bad ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { V } = efRun(p)
        return [
          { label: 'Bulge left', value: mmFixed(V.left, 2), tone: toneOf(V.fits, V.left < 0.3) },
          { label: 'Squish', value: mmFixed(V.squish, 2) },
          { label: 'Soft bottom', value: mmFixed(V.soft, 2) },
          { label: 'First-layer gap', value: mmFixed(V.gap, 2) },
        ]
      },
    }
  },
}

// --- Clogged nozzle ---

const CLOG_NAMES = Object.fromEntries(CLOG_FILAMENTS.map((f) => [f, FILAMENTS[f].name])) as Record<CoolFilament, string>
const cnParams = (p: Params) => ({ mat: pick(CLOG_NAMES, p.mat, 'pla') as CoolFilament, fan: n(p, 'fan'), airC: n(p, 'air'), retractMm: n(p, 'retract') })
const cnKey = (p: Params) => `${p.mat} ${p.fan} ${p.air} ${p.retract}`
const cnRun = memoBy(cnKey, (p: Params) => {
  const q = cnParams(p)
  return { q, V: clogView(q) }
})
const CN = { k: 0.32, at: [-8.4, 0.6, 0] as V3, minPerS: 6 }

export const printProblemsCloggedNozzle: Lesson = {
  id: 'print-problems-clogged-nozzle',
  title: 'Clogged nozzle',
  tagline: 'The push grows until nothing comes out',
  formula: (p) => {
    const { V } = cnRun(p)
    return `heatsink = air + ${CLOG.sinkRiseC} °C / fan share = ${celsiusText(V.sink)} vs Tg ${celsiusText(V.tg)} · push = ${CLOG.cleanN} N + ${fixedText(V.perMin, 1)} N/min × t; stops at the ${V.grip} N gear grip → ${Number.isFinite(V.stopMin) ? `${Math.round(V.stopMin)} min` : 'never'}, typical`
  },
  legend: [
    { color: HEAT, label: 'Push needed over the print', shape: 'dot' },
    { color: HIGH_V, label: 'Drive gear grip', shape: 'dot' },
    { color: RING, label: 'Now', shape: 'dot' },
  ],
  points: [
    'Extrusion fades or stops mid-print, the extruder clicks, and the nozzle may drool nothing at all. Usually the jam is not in the nozzle tip but in the heat break: heat creeps up, filament softens above it, swells and sticks to the walls, and the push needed grows until the drive gear slips (How FDM works > Hotend and extruder).',
    'Heat creep comes from a weak or dead heat-break fan, a hot enclosure with PLA (Tg 60 °C), or retracting so far that melt is pulled up into the cold zone where it sets (Calibration > Retraction). Debris, burnt residue and a nozzle worn by carbon fibre (Filaments > Carbon-fibre blends) also choke the bore.',
    'Clearing it: a cold pull (heat, push nylon or PLA through, cool to about 90 °C, pull hard; the plug comes out with the debris) or an "atomic pull" from higher up; a needle from below; swap the nozzle if it is worn. Then fix the cause, or it comes back.',
  ],
  controls: [
    { kind: 'choice', key: 'mat', options: opts(CLOG_NAMES), initial: 'pla' },
    { kind: 'slider', key: 'fan', label: 'Heat-break fan', min: 0, max: 1, step: 0.1, initial: 1, format: pct },
    { kind: 'slider', key: 'air', label: 'Air around the hotend', min: 20, max: 60, step: 5, initial: 45, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'retract', label: 'Retraction (direct drive)', min: 0, max: 4, step: 0.1, initial: 0.8, format: (v) => mmFixed(v, 1) },
  ],
  build(): Stage {
    const c = diagStage('push needed over the print', ['Heat-break fan weak', 'Hot enclosure', 'Retraction too long'])
    const { scene, head, plot } = c
    const g = add(scene, new THREE.Group(), CN.at)
    g.rotation.set(0.1, -0.25, 0)
    const hot = hotendSection(g, [0, 0, 0], CN.k * 1.0, 'v6')
    const creepText = liveLabel(g, [4.4, 0, 0.5], { size: 0.32, align: 'left' })
    const zoneText = liveLabel(g, [-2.4, 0, 0.5], { size: 0.3, align: 'right' })
    const S = plot.s
    const tPush = S.trace(HEAT, { samples: 61, radius: 0.07 })
    const grip = S.level(HIGH_V)
    const cur = cursorBar(S, RING, 0.06)
    plot.lo.set('0 min')
    plot.hi.set(`${CLOG.minutes} min`)
    const st = { travel: 0, gear: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = cnRun(p)
        const f = FILAMENTS[q.mat]
        const loopS = CLOG.minutes / CN.minPerS + 1.5
        const tMin = Math.min(CLOG.minutes, c.clock(cnKey(p), dt, loopS) * CN.minPerS)
        const i = Math.round((tMin / CLOG.minutes) * 60)
        const flow = V.flow[i]
        st.travel += dt * 3 * flow
        st.gear += dt * 2 * (flow > 0 ? flow : Math.sin(tMin * 20) * 0.3)
        const z = V.zones
        const grown = Math.min(1, tMin / Math.max(1e-6, Math.min(V.stopMin, CLOG.minutes)))
        const plugTop = z.brk[0] - grown * V.rate * 10
        const coreAt = (s: number) =>
          s < z.cold[0] ? q.airC
          : s < z.brk[0] ? Math.max(V.sink - 10 + (10 * (s - z.cold[0])) / (z.cold[1] - z.cold[0]), s > plugTop && V.rate > 0 ? f.tgC + 15 : 0)
          : s < z.brk[1] ? V.sink + ((s - z.brk[0]) / (z.brk[1] - z.brk[0])) * (f.nozzleC - V.sink)
          : f.nozzleC
        hot.set(st.travel, coreAt, f.nozzleC, st.gear)
        creepText.group.position.y = hot.y(Math.min(z.brk[0], plugTop))
        creepText.set(V.rate > 0 ? `soft plug: ${f.name} above Tg ${celsiusText(f.tgC)}` : 'cold zone below Tg', V.rate > 0 ? HIGH_V : POWER)
        zoneText.group.position.y = hot.y((z.cold[0] + z.cold[1]) / 2)
        zoneText.set(`heatsink ${celsiusText(V.sink)}`, V.sink > f.tgC ? HEAT : LABEL)
        const py = plotY(0, V.grip * 1.3, PLOT.h)
        tPush.points(V.ts.map((t) => t / CLOG.minutes), V.push.map(py), i)
        grip.set(py(V.grip))
        cur(tMin / CLOG.minutes)
        plot.right.set(`${Math.round(tMin)} min · push ${fixedText(V.push[i], 0)} N`, RING)
        c.rank(V.rank)
        const key = V.rank.top?.key
        const bad = Number.isFinite(V.stopMin)
        const cause =
          key === 'fan' ? `fan at ${pct(q.fan)}: heatsink ${celsiusText(V.sink)}, above Tg`
          : key === 'air' ? `${celsiusText(q.airC)} air: heatsink ${celsiusText(V.sink)}, above Tg`
          : key === 'retract' ? `${mmFixed(q.retractMm, 1)} retraction pulls melt into the cold zone`
          : `heatsink ${celsiusText(V.sink)} stays below Tg ${celsiusText(f.tgC)}`
        const fix =
          key === 'fan' ? 'replace the heat-break fan, then a cold pull'
          : key === 'air' ? (f.enclosure ? 'cooler chamber' : 'open the enclosure door for PLA, then a cold pull')
          : key === 'retract' ? 'retract 2 mm or less (Calibration > Retraction)'
          : 'nothing to do'
        c.say(bad ? `extrusion stops after ${Math.round(V.stopMin)} min` : `flows the whole ${CLOG.minutes} min`, cause, fix, bad)
        head.status.set(`Clogged nozzle · ${f.name}`)
        head.sub.set(`V6-style hotend cut open, time ×${CN.minPerS * 60}`, GREY)
        head.event.set(flow <= 0 ? 'jammed: the gear clicks' : bad ? 'push rising' : 'flowing', flow <= 0 ? HIGH_V : bad ? HEAT : POWER)
      },
      readouts: (p) => {
        const { q, V } = cnRun(p)
        return [
          { label: 'Heatsink', value: celsiusText(V.sink), tone: toneOf(V.sink < FILAMENTS[q.mat].tgC - 5, V.sink < FILAMENTS[q.mat].tgC) },
          { label: 'Clogs after', value: Number.isFinite(V.stopMin) ? `${Math.round(V.stopMin)} min` : 'never', tone: toneOf(!Number.isFinite(V.stopMin), V.stopMin > 120) },
          { label: 'Plug growth', value: `${fixedText(V.perMin, 1)} N/min` },
          { label: 'Gear grip', value: `${V.grip} N` },
        ]
      },
    }
  },
}
