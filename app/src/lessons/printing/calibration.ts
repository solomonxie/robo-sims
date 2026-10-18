import * as THREE from 'three/webgpu'
import {
  CAL_FILAMENTS,
  EXTRUDERS,
  E_TEST,
  ExtruderKey,
  FILAMENTS,
  FLOW_CUBE,
  FilamentKey,
  PA_LINE,
  PA_SETUPS,
  PaSetup,
  RETRACT_SETUPS,
  RETRACT_TEST,
  RetractSetup,
  TEMP_TOWER,
  beadWidth,
  coreTempAt,
  eStepsView,
  flowCalView,
  hash01,
  paPattern,
  paRun,
  retractView,
  towerView,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, pct, secs, signed } from '../../core/units'
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
  beadCut,
  caliper,
  cursorBar,
  glowMat,
  hotendSection,
  liveLabel,
  memoBy,
  nozzleCone,
  plotY,
  printBeads,
  sampleFrac,
  smoothstep,
  statusHeader,
  stringWeb,
  testTower,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

// One scene for all five: test print on the left, a plot bottom right, live rows top right.
const PLOT = { x: 8.6, w: 12.4, y: -8.6, h: 9 }
function calStage(plotTitle: string, rowsN = 4) {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const plot = titledScope(scene, PLOT.y, PLOT.h, plotTitle, LABEL, 0, PLOT.x, PLOT.w)
  const rows = textRows(scene, rowsN, 2.4, 3.2, 0.28, 0.68)
  const st = { key: '', t: 0 }
  const clock = (key: string, dt: number, loop: number) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t = (st.t + dt) % loop
    return st.t
  }
  return { scene, head, plot, rows, clock }
}

// --- E-steps: mark the filament 120 mm above the extruder, feed 100 mm, measure what is left. ---

const ES = { k: 0.1, at: [-9.4, -9.3, 0] as V3, hk: 1.2, feed: 3, hold: 3.2, back: 1, top: 10 }
const esParams = (p: Params) => ({ ext: pick(EXTRUDERS, p.ext, 'mk8') as ExtruderKey, err: n(p, 'err'), feed: n(p, 'feed') })
const esKey = (p: Params) => `${p.ext} ${p.err} ${p.feed}`
const esRun = memoBy(esKey, (p: Params) => {
  const q = esParams(p)
  return { q, V: eStepsView(q.ext, q.err, q.feed) }
})

export const calibrationESteps: Lesson = {
  id: 'calibration-e-steps',
  title: 'E-steps',
  tagline: 'Steps per mm for the extruder: mark, feed 100 mm, measure',
  formula: (p) => {
    const { V } = esRun(p)
    return `new E-steps = old × 100 / fed = ${fixedText(V.fwSpm, 1)} × 100 / ${fixedText(V.fedMm, 1)} = ${fixedText(V.fixedSpm, 1)} · fed = ${E_TEST.markMm} − ${fixedText(V.leftMm, 1)} mm left · true ${fixedText(V.trueSpm, 1)}`
  },
  legend: [
    { color: RING, label: 'Mark on the filament', shape: 'dot' },
    { color: POWER, label: '20 mm left = 100 mm fed', shape: 'dot' },
    { color: HIGH_V, label: 'Melt limit at 210 °C, typical', shape: 'dot' },
  ],
  points: [
    'The extruder has a steps/mm like any axis (Printer motion > Steps per mm): 200 steps × 16 microsteps × gear ratio / (π × drive-gear diameter). The effective diameter is where the teeth bite into the filament, never quite the catalogue value, so measure: a stock single-gear extruder lands near 93, a 3:1 dual-gear one near 415.',
    'Heat the nozzle, mark the filament 120 mm above the extruder inlet, send M83 then G1 E100 F60 and measure from the inlet to the mark. 20 mm left means exactly 100 mm went in. Same fix as the axes: new = old × 100 / fed (M92 E…, then M500 to save).',
    'Feed slowly. Push faster than the hotend can melt (How FDM works > Hotend and extruder) and the back pressure beats the gear grip: the gear slips or the motor skips, less goes in, and the fix comes out too high. That over-extrudes every print afterwards. Dual gears grip longer; TPU slips first (Filaments > Flexible TPU).',
    'E-steps only make the motor push the commanded length; how wide the line comes out also depends on the filament diameter and die swell. That is Flow rate, calibrated after this.',
  ],
  controls: [
    { kind: 'choice', key: 'ext', options: opts(namesOf(EXTRUDERS)), initial: 'mk8' },
    { kind: 'slider', key: 'err', label: 'Firmware E-steps off by', min: -10, max: 10, step: 0.5, initial: 5, format: (v) => `${signed(v, 1)} %` },
    { kind: 'slider', key: 'feed', label: 'Test feed speed', min: 1, max: 8, step: 0.5, initial: 1.5, format: (v) => `${fixedText(v, 1)} mm/s (F${Math.round(v * 60)})` },
  ],
  build(): Stage {
    const c = calStage('mm fed by G1 E100 vs feed speed')
    const { scene, head, plot, rows } = c
    const { k, top } = ES
    const g = add(scene, new THREE.Group(), ES.at)
    g.rotation.y = -0.35
    const hot = hotendSection(g, [0, 0, 0], k * ES.hk, 'v6')
    const inlet = top * k * ES.hk
    const filLen = E_TEST.markMm + 4
    cylinder(g, 0.875 * k * ES.hk, filLen * k, mat(FILAMENT_COLOR, { rough: 0.5 }), [0, inlet + (filLen / 2) * k, 0], 'y', 16)
    const mark = add(g, new THREE.Mesh(new THREE.TorusGeometry(1.4 * k * ES.hk, 0.35 * k * ES.hk, 8, 20), glowMat(RING, 1.2)))
    mark.rotation.x = Math.PI / 2
    const tick = (mm: number, color: string, text: string) => {
      box(g, [3, 0.05, 0.05], glowMat(color, 0.8), [1.6, inlet + mm * k, 0])
      addLabel(g, text, [3.3, inlet + mm * k, 0], color, 0.28, 'left')
    }
    tick(E_TEST.markMm, GREY, 'mark at 120 mm')
    tick(E_TEST.markMm - E_TEST.feedMm, POWER, '20 mm: 100 mm fed')
    const cal = caliper(g, k, [-1.4, inlet, 0], 75)
    cal.group.rotation.z = Math.PI / 2
    const reading = liveLabel(g, [-1.8, inlet + 3, 0], { size: 0.34, align: 'right' })
    addLabel(g, 'extruder inlet', [-1.8, inlet - 0.5, 0], GREY, 0.26, 'right')
    const S = plot.s
    const curve = S.trace(RING, { samples: 40, radius: 0.06 })
    const lvl = S.level(POWER)
    const cur = cursorBar(S, RING, 0.06)
    const melt = cursorBar(S, HIGH_V, 0.04)
    plot.lo.set('0.5 mm/s')
    plot.hi.set('10 mm/s')
    const py = plotY(40, 115, PLOT.h)
    const fu = (f: number) => (f - 0.5) / 9.5
    const { feed: tF, hold: tH, back: tB } = ES
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = esRun(p)
        const t = c.clock(esKey(p), dt, tF + tH + tB)
        const u = t < tF ? smoothstep(t / tF) : t < tF + tH ? 1 : 1 - smoothstep((t - tF - tH) / tB)
        const fed = u * V.fedMm
        const feeding = t < tF
        hot.set(fed, (s) => coreTempAt('v6', E_TEST.blockC, feeding ? q.feed : 0, s), E_TEST.blockC, (u * V.gearMm) / (EXTRUDERS[q.ext].gearMm / 2))
        const left = E_TEST.markMm - fed
        mark.position.set(0, inlet + left * k, 0)
        cal.set(left, mmFixed(left, 1))
        const done = t >= tF && t < tF + tH
        reading.set(mmFixed(left, 1), done ? (Math.abs(V.fedMm - 100) < 0.3 ? POWER : HEAT) : LABEL)
        curve.points(V.curve.map((s) => fu(s.feed)), V.curve.map((s) => py(s.fed)), null)
        lvl.set(py(100))
        cur(fu(q.feed))
        melt(fu(V.meltFeed))
        plot.right.set(`${mmFixed(V.fedMm, 1)} at ${fixedText(q.feed, 1)} mm/s`, RING)
        const ex = EXTRUDERS[q.ext]
        rows[0].set(`3200 × ${ex.ratio} / (π × ${ex.gearMm} mm) = ${fixedText(V.trueSpm, 1)} steps/mm · firmware ${fixedText(V.fwSpm, 1)}`, LABEL)
        rows[1].set(`G1 E100: gear turns ${mmFixed(V.gearMm, 1)}${V.slip > 0 ? ` but slips ${pct(V.slip)}` : ', no slip'}`, V.slip > 0 ? HIGH_V : LABEL)
        rows[2].set(`${E_TEST.markMm} − ${fixedText(V.leftMm, 1)} = ${mmFixed(V.fedMm, 1)} fed → ${fixedText(V.fwSpm, 1)} × 100 / ${fixedText(V.fedMm, 1)} = ${fixedText(V.fixedSpm, 1)}`, RING)
        rows[3].set(V.slip > 0 ? `fix ${pct(V.fixErr)} too high: feed slower and redo` : 'fix matches the true E-steps (M92, M500)', V.slip > 0 ? HIGH_V : POWER)
        head.status.set(`E-steps · ${ex.name}`)
        head.sub.set('nozzle hot, filament marked 120 mm above the inlet', GREY)
        head.event.set(feeding ? `G1 E100 F${Math.round(q.feed * 60)}: feeding` : done ? `mark ${mmFixed(V.leftMm, 1)} above the inlet` : 'next try', done ? RING : LABEL)
      },
      readouts: (p) => {
        const { V } = esRun(p)
        return [
          { label: 'Left above inlet', value: mmFixed(V.leftMm, 1), tone: toneOf(Math.abs(V.fedMm - 100) < 0.5, Math.abs(V.fedMm - 100) < 3) },
          { label: 'New E-steps', value: fixedText(V.fixedSpm, 1) },
          { label: 'Gear slip', value: pct(V.slip), tone: toneOf(V.slip === 0, V.slip < 0.05) },
        ]
      },
    }
  },
}

// --- Flow rate: print a single-wall cube, caliper the wall, scale the flow multiplier. ---

const FR = { k: 0.27, at: [-10.2, -3.2, 0] as V3, beadK: 4.2 }
const FLOW_TONE = { under: B_FIELD, good: POWER, over: HEAT }
const frParams = (p: Params) => ({ flow: n(p, 'flow'), d: n(p, 'd') })
const frRun = memoBy((p: Params) => `${p.flow} ${p.d}`, (p: Params) => {
  const q = frParams(p)
  return { q, V: flowCalView(q.flow, q.d) }
})

export const calibrationFlowRate: Lesson = {
  id: 'calibration-flow-rate',
  title: 'Flow rate',
  tagline: 'Caliper a single wall and scale the flow multiplier',
  formula: (p) => {
    const { q, V } = frRun(p)
    return `new flow = old × line width / wall = ${pct(q.flow)} × ${FLOW_CUBE.lineW} / ${fixedText(V.wallMm, 3)} = ${pct(V.fixed)} · extruded = flow × (${q.d} / 1.75)² = ${pct(V.factor)}`
  },
  legend: [
    { color: POWER, label: 'Lines just touch', shape: 'dot' },
    { color: B_FIELD, label: 'Under-extruded: gaps', shape: 'dot' },
    { color: HEAT, label: 'Over-extruded: ridges', shape: 'dot' },
    { color: RING, label: 'Wall width at this flow', shape: 'dot' },
  ],
  points: [
    'With E-steps right, the motor pushes the commanded length, but the volume still depends on the real filament diameter (1.75 mm ± 0.03 is common, and area goes with d²) and how the melt swells at the nozzle. The flow multiplier (extrusion multiplier) in the slicer scales every E value to fix that, per filament.',
    'Print a 20 mm cube in vase mode or with one wall, no top, no infill, line width 0.45 mm. Caliper the wall at several places and average. The bead is a stadium (Bed adhesion > Z offset): its area is fixed by the flow, so a thinner wall means too little plastic. Scale: new = old × 0.45 / measured, the same measure-and-correct as E-steps.',
    'The section underneath shows a top surface laid at the slicer spacing (line width − h·(1 − π/4)). Too little flow leaves gaps between lines; too much piles ridges and rough, shiny tops, and dimensions grow. Spotting these on real prints belongs to Print problems > Under-extrusion.',
    'Calibrate per filament and colour: pigments and fillers change both diameter and swell. Typical results land between 90 and 105 %.',
  ],
  controls: [
    { kind: 'slider', key: 'flow', label: 'Flow multiplier', min: 0.85, max: 1.15, step: 0.01, initial: 1, format: pct },
    { kind: 'slider', key: 'd', label: 'Real filament diameter', min: 1.68, max: 1.82, step: 0.01, initial: 1.72, format: (v) => mmFixed(v, 2) },
  ],
  build(): Stage {
    const c = calStage('wall width vs flow multiplier')
    const { scene, head, plot, rows } = c
    const { k } = FR
    const side = FLOW_CUBE.sideMm
    const g = add(scene, new THREE.Group(), FR.at)
    g.rotation.set(0.45, -0.6, 0)
    const wallM = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5, emissive: FILAMENT_COLOR, emissiveIntensity: 0.15 })
    const walls = Array.from({ length: 4 }, () => box(g, [side * k, side * k, 0.45 * k], wallM, [0, 0, 0]))
    box(g, [side * 1.6 * k, 0.6 * k, side * 1.6 * k], mat('#3a3f47', { rough: 0.6 }), [0, -(side / 2 + 0.3) * k, 0])
    const cal = caliper(g, k, [-1.4 * k, (side / 2 + 3) * k, (side / 2) * k], 4)
    cal.group.rotation.y = Math.PI / 2
    const cut = beadCut(scene, [-8.4, -11.6, 0], FR.beadK, 5)
    addLabel(scene, 'top surface lines, cut across (zoomed)', [-8.4, -12.6, 0.3], GREY, 0.28)
    const S = plot.s
    const curve = S.trace(RING, { samples: 41, radius: 0.06 })
    const lvl = S.level(POWER)
    const cur = cursorBar(S, RING, 0.06)
    plot.lo.set('85 %')
    plot.hi.set('115 %')
    const py = plotY(0.36, 0.56, PLOT.h)
    const fu = (f: number) => (f - 0.85) / 0.3
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = frRun(p)
        const t = Math.max(0.2, V.wallMm) * k
        walls.forEach((w, i) => {
          const a = (i * Math.PI) / 2
          w.scale.set(1, 1, t / (0.45 * k))
          w.position.set(Math.sin(a) * (side / 2) * k, 0, Math.cos(a) * (side / 2) * k)
          w.rotation.y = a
        })
        cal.set(V.wallMm, mmFixed(V.wallMm, 2))
        const tone = FLOW_TONE[V.state]
        setWallTone(wallM, tone)
        cut.set(FLOW_CUBE.h, beadWidth(V.area * V.factor, FLOW_CUBE.h), V.spacing, FLOW_CUBE.h, tone)
        cut.nozzle.visible = false
        curve.points(V.curve.map((_, i) => i / (V.curve.length - 1)), V.curve.map(py), null)
        lvl.set(py(FLOW_CUBE.lineW))
        cur(fu(q.flow))
        plot.right.set(`wall ${mmFixed(V.wallMm, 3)}`, RING)
        rows[0].set(`slicer line ${FLOW_CUBE.lineW} × ${FLOW_CUBE.h} mm · filament ${mmFixed(q.d, 2)}`, LABEL)
        rows[1].set(`extruded ${pct(V.factor)} of plan → caliper reads ${mmFixed(V.wallMm, 3)}`, tone)
        rows[2].set(`fix: ${pct(q.flow)} × ${FLOW_CUBE.lineW} / ${fixedText(V.wallMm, 3)} = ${pct(V.fixed)}`, RING)
        rows[3].set(V.state === 'under' ? 'gaps between top lines: weak, porous' : V.state === 'over' ? 'ridges on top, walls too thick' : 'lines just touch', tone)
        head.status.set('Flow rate · single-wall cube')
        head.sub.set(`${side} mm cube, one ${FLOW_CUBE.lineW} mm wall, measured with calipers`, GREY)
        head.event.set(`${V.state === 'good' ? 'on target' : V.state === 'under' ? 'under-extruding' : 'over-extruding'}: set flow ${pct(V.fixed)}`, tone)
      },
      readouts: (p) => {
        const { V } = frRun(p)
        const off = Math.abs(V.wallMm - FLOW_CUBE.lineW)
        return [
          { label: 'Wall measured', value: mmFixed(V.wallMm, 2), tone: toneOf(off < 0.01, off < 0.03) },
          { label: 'New flow multiplier', value: pct(V.fixed) },
        ]
      },
    }
  },
}
function setWallTone(m: THREE.MeshStandardMaterial, tone: string) {
  m.color.set(FILAMENT_COLOR).lerp(new THREE.Color(tone), 0.45)
}

// --- Pressure advance: the melt lags like a spring + damper; K pushes extra filament ahead of each speed change. ---

const PA = { k: 0.14, at: [-12.6, -7.3, 0] as V3, gap: 5, wide: 4, slow: 4, rest: 1.6 }
const PA_LEN = PA_LINE.legs.reduce((a, b) => a + b, 0)
const paParams = (p: Params) => {
  const setup = pick(PA_SETUPS, p.setup, 'direct') as PaSetup
  return { setup, K: n(p, 'kf') * PA_SETUPS[setup].kMax }
}
const paKey = (p: Params) => `${p.setup} ${p.kf}`
const patternOf = memoBy((s: PaSetup) => s, paPattern)
const paCalc = memoBy(paKey, (p: Params) => {
  const q = paParams(p)
  return { q, run: paRun(q.setup, q.K), none: paRun(q.setup, 0), pat: patternOf(q.setup) }
})
const paVerdict = (K: number, tau: number) => (Math.abs(K - tau) < 0.15 * tau ? 'matched' : K < tau ? 'low' : 'high')

export const calibrationPressureAdvance: Lesson = {
  id: 'calibration-pressure-advance',
  title: 'Pressure advance',
  tagline: 'Push the melt ahead of every speed change',
  formula: (p) => {
    const { q, run } = paCalc(p)
    return `τ·dQ/dt = E-rate − Q (melt lag τ ≈ ${run.tau} s, typical) · PA: E-rate = v + K·dv/dt, K = ${fixedText(q.K, 3)} s · K = τ cancels the lag`
  },
  legend: [
    { color: GREY, label: 'Commanded flow (speed)', shape: 'dot' },
    { color: HEAT, label: 'Nozzle flow, no PA', shape: 'dot' },
    { color: RING, label: 'Nozzle flow at your K', shape: 'dot' },
    { color: POWER, label: 'Best line in the test', shape: 'dot' },
  ],
  points: [
    'Molten plastic in the nozzle and the filament behind it act like a spring with a damper: to push more out, pressure has to build first, and when the head slows the pressure keeps pushing. With a fixed E per mm, a line starts thin after each speed-up and swells into a blob where the head brakes for a corner or stops.',
    'Pressure advance (Klipper) or linear advance (Marlin M900 K) adds K × the extruder acceleration to the E rate: an extra push while speeding up, a small pull-back while braking. For a first-order lag τ, K = τ cancels it exactly. Bowden tubes add a long spring, so K is ten times larger than on a direct drive.',
    'Tune with a test pattern: lines that go slow, fast, slow, each printed with a larger K. Pick the line with even width and sharp ends, here measured as the most uniform. Too high a K starves the fast section and leaves gaps at corners. Input shaping fixes ringing, not this (Printer motion > Input shaping).',
    'The lag depends on the melt, so retune per filament: flexible TPU compresses (Filaments > Flexible TPU) and needs far more K. Set flow first (Flow rate), since PA only moves plastic in time, not in amount.',
  ],
  controls: [
    { kind: 'choice', key: 'setup', options: opts(namesOf(PA_SETUPS)), initial: 'direct' },
    { kind: 'slider', key: 'kf', label: 'K, share of the test range', min: 0, max: 1, step: 0.05, initial: 0.2, format: (v) => `${Math.round(v * 100)} % of the test range` },
  ],
  build(): Stage {
    const c = calStage('flow vs time over one test line')
    const { scene, head, plot, rows } = c
    const { k, gap, wide } = PA
    const n0 = PA_LINE.lines
    const g = add(scene, new THREE.Group(), PA.at)
    g.rotation.set(0.85, -0.12, 0)
    const depth = (n0 + 1.5) * gap
    box(g, [(PA_LEN + 30) * k, 0.4, (depth + 8) * k], mat('#3a3f47', { rough: 0.6 }), [(PA_LEN / 2 - 8) * k, -0.2, (-depth / 2 + 4) * k])
    const lay = add(g, new THREE.Group())
    const beads = printBeads(lay, (n0 + 1) * PA_LEN, k)
    const blobM = mat(FILAMENT_COLOR, { rough: 0.5 })
    const blobs = Array.from({ length: n0 + 1 }, () => add(g, new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), blobM)))
    const yOf = (i: number) => (i + 1.5) * gap
    const tags = Array.from({ length: n0 }, (_, i) => liveLabel(g, [-3 * k, 0.3, -yOf(i) * k], { size: 0.32, align: 'right' }))
    addLabel(g, 'your K', [-3 * k, 0.3, 0], RING, 0.32, 'right')
    const nozzle = nozzleCone(g)
    const S = plot.s
    const tT = S.trace(GREY, { samples: 200, radius: 0.05 })
    const tN = S.trace(HEAT, { samples: 200, radius: 0.05 })
    const tK = S.trace(RING, { samples: 200, radius: 0.06 })
    const cur = cursorBar(S, LABEL, 0.04)
    plot.lo.set('0 s')
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, run, none, pat } = paCalc(p)
        const T = run.t[run.t.length - 1]
        const t = c.clock(paKey(p), dt, T * PA.slow + PA.rest)
        const tu = Math.min(1, t / (T * PA.slow))
        const xNow = sampleFrac(run.xs, tu)
        let m = 0
        const line = (i: number, width: readonly number[], color: string, upto = PA_LEN) => {
          const y = i < 0 ? 0 : yOf(i)
          for (let j = 0; j < Math.min(PA_LEN, Math.ceil(upto)); j++) beads.lay(m++, [j, y], [j + 1, y], 0, FLOW_CUBE.lineW * wide * width[j], 0.6, color)
        }
        pat.lines.forEach((l, i) => {
          const near = Math.abs(l.K - q.K) < PA_SETUPS[q.setup].kMax / 20
          line(i, l.width, i === pat.best ? POWER : near ? RING : FILAMENT_COLOR)
          tags[i].set(fixedText(l.K, q.setup === 'direct' ? 2 : 1), i === pat.best ? POWER : near ? RING : GREY)
          const r = Math.cbrt(Math.max(0, l.blob)) * 0.9
          blobs[i].visible = r > 0.05
          blobs[i].scale.setScalar(Math.max(0.01, r * k * 2.2))
          blobs[i].position.set(PA_LEN * k, 0.1, -yOf(i) * k)
        })
        line(-1, run.width, RING, xNow)
        beads.show(m)
        const rb = Math.cbrt(Math.max(0, run.blob)) * 0.9
        blobs[n0].visible = tu >= 1 && rb > 0.05
        blobs[n0].scale.setScalar(Math.max(0.01, rb * k * 2.2))
        blobs[n0].position.set(PA_LEN * k, 0.1, 0)
        nozzle.position.set(xNow * k, 1.1, 0)
        const hi = Math.max(PA_LINE.fast * 1.15, ...run.qo, ...none.qo)
        const py = plotY(Math.min(0, ...run.qo), hi, PLOT.h)
        const tr = (arr: readonly number[]) => (u: number) => py(sampleFrac(arr, u))
        tT.draw(tr(run.v), null)
        tN.draw(tr(none.qo), null)
        tK.draw(tr(run.qo), tu)
        cur(tu)
        plot.hi.set(secs(T))
        plot.right.set(`K ${fixedText(q.K, 3)} s`, RING)
        const v = paVerdict(q.K, run.tau)
        const tone = v === 'matched' ? POWER : HEAT
        rows[0].set(`melt lag τ ≈ ${run.tau} s (typical for ${PA_SETUPS[q.setup].name.toLowerCase()})`, LABEL)
        rows[1].set(v === 'matched' ? 'K ≈ τ: nozzle flow follows the speed, even width' : v === 'low' ? 'K too low: thin after speed-ups, blob at the stop' : 'K too high: starved speed-ups, gaps at corners', tone)
        rows[2].set(`test pattern best: K = ${fixedText(pat.bestK, 2)} s (line ${pat.best + 1} of ${n0})`, POWER)
        rows[3].set(`Marlin M900 K${fixedText(q.K, 3)} · Klipper pressure_advance: ${fixedText(q.K, 3)}`, GREY)
        head.status.set(`Pressure advance · ${PA_SETUPS[q.setup].name}`)
        head.sub.set(`line: ${PA_LINE.slow}, ${PA_LINE.fast}, ${PA_LINE.slow} mm/s · widths × ${wide} · ${PA.slow}× slower`, GREY)
        head.event.set(tu < 1 ? `printing your line: ${mmFixed(xNow, 0)}` : `end blob ${fixedText(Math.max(0, run.blob), 2)} mm of line`, tu < 1 ? LABEL : tone)
      },
      readouts: (p) => {
        const { q, run, pat } = paCalc(p)
        return [
          { label: 'Width error', value: pct(run.err), tone: toneOf(run.err < 0.03, run.err < 0.1) },
          { label: 'Best K in the test', value: `${fixedText(pat.bestK, 2)} s` },
          { label: 'Your K', value: `${fixedText(q.K, 3)} s` },
        ]
      },
    }
  },
}

// --- Retraction: pull back at each travel to drop the nozzle pressure; strings vs jams and grinding. ---

const RT = { k: 0.2, at: [-8.6, -10.4, 0] as V3, span: 40, tower: 10, bands: 5, bandH: 9, loop: 2.4 }
const rtParams = (p: Params) => ({ setup: pick(RETRACT_SETUPS, p.setup, 'direct') as RetractSetup, dist: n(p, 'dist'), speed: n(p, 'speed') })
const rtKey = (p: Params) => `${p.setup} ${p.dist} ${p.speed}`
const rtRun = memoBy(rtKey, (p: Params) => {
  const q = rtParams(p)
  return { q, V: retractView(q.setup, q.dist, q.speed) }
})

export const calibrationRetraction: Lesson = {
  id: 'calibration-retraction',
  title: 'Retraction',
  tagline: 'Pull back just enough to stop strings',
  formula: (p) => {
    const { q, V } = rtRun(p)
    return `strings ≈ (1 − d / ${V.needMm} mm)^1.5 + slow-pull ooze · ${mmFixed(q.dist, 1)} at ${q.speed} mm/s → ${pct(V.string)} of travels · time ≈ ${RETRACT_TEST.perPrint} × 2d / speed = ${secs(V.addS)} per print, typical`
  },
  legend: [
    { color: HEAT, label: 'Strings vs distance', shape: 'dot' },
    { color: HIGH_V, label: 'Jam risk: melt pulled into the heat break', shape: 'dot' },
    { color: RING, label: 'Your distance', shape: 'dot' },
    { color: GREY, label: 'Pressure to relieve, typical', shape: 'dot' },
  ],
  points: [
    'When the head travels without printing, the pressure in the nozzle keeps pushing melt out, which stretches into strings between parts (the ooze from G-code > Temperatures and fans). Retraction reverses the extruder a little before each travel (G10 or a negative E move) and feeds it back after.',
    'The distance has to take up the stored pressure: on a direct drive that is the melt alone, about 0.5 to 1 mm; through a Bowden tube the filament also slides and compresses in the tube, so 4 to 6 mm. Too little leaves strings; more than that buys nothing.',
    'Too far drags molten plastic up into the cold heat break, where it sets and jams (How FDM works > Hotend and extruder). Too fast and the drive gear chews a groove in the filament, which then stops feeding. 25 to 50 mm/s is the usual window; too slow lets it ooze while retracting.',
    'Calibrate with a stringing test: two thin towers far apart, stepping the distance per band. Temperature matters as much, so do the Temperature tower first. Wet filament strings regardless (Filaments > Drying wet filament); diagnosis lives in Print problems.',
  ],
  controls: [
    { kind: 'choice', key: 'setup', options: opts(namesOf(RETRACT_SETUPS)), initial: 'direct' },
    { kind: 'slider', key: 'dist', label: 'Retraction distance', min: 0, max: 10, step: 0.1, initial: 0.3, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'speed', label: 'Retraction speed', min: 10, max: 100, step: 5, initial: 40, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const c = calStage('vs retraction distance')
    const { scene, head, plot, rows } = c
    const { k, span, tower, bands, bandH } = RT
    const g = add(scene, new THREE.Group(), RT.at)
    g.rotation.set(0.28, -0.35, 0)
    box(g, [(span + 30) * k, 0.4, 30 * k], mat('#3a3f47', { rough: 0.6 }), [0, -0.2, 0])
    const look = { w: tower, d: tower, bandH, tab: 0 }
    const towers = [-1, 1].map((sx) => testTower(g, [(sx * span) / 2 * k, 0, 0], k, bands, look))
    const web = stringWeb(g, RETRACT_TEST.travels)
    const H = bands * bandH * k
    const nozzle = nozzleCone(g)
    const S = plot.s
    const tS = S.trace(HEAT, { samples: 41, radius: 0.06 })
    const tJ = S.trace(HIGH_V, { samples: 41, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const need = cursorBar(S, GREY, 0.04)
    plot.lo.set('0 mm')
    const py = plotY(0, 1.05, PLOT.h)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = rtRun(p)
        const t = c.clock(rtKey(p), dt, RT.loop)
        const x = Math.sin((t / RT.loop) * Math.PI * 2) * (span / 2) * k
        nozzle.position.set(x, H + 0.7, 0)
        const tone = V.string < 0.2 ? POWER : HEAT
        towers.forEach((tw) => {
          for (let i = 0; i < bands; i++) tw.set(i, V.jam > 0.5 ? HIGH_V : FILAMENT_COLOR)
        })
        const a = (span / 2 - tower / 2) * k
        web.set(Array.from({ length: V.count }, (_, i) => {
          const y = (0.08 + 0.9 * hash01(i * 7.3 + 1)) * H
          return { a: [-a, y, (hash01(i * 3.1) - 0.5) * tower * k] as V3, b: [a, y - hash01(i * 5.7) * 0.3, (hash01(i * 9.7) - 0.5) * tower * k] as V3, sag: 0.2 + 0.5 * hash01(i * 2.9), r: 0.02 + 0.03 * hash01(i * 4.3) }
        }))
        const xs = V.curve.map((s) => s.d / V.maxMm)
        tS.points(xs, V.curve.map((s) => py(s.string)), null)
        tJ.points(xs, V.curve.map((s) => py(s.jam)), null)
        cur(Math.min(1, q.dist / V.maxMm))
        need(V.needMm / V.maxMm)
        plot.hi.set(mmFixed(V.maxMm, 0))
        plot.right.set(`strings ${pct(V.string)} · jam ${pct(V.jam)}`, RING)
        rows[0].set(`${V.name}: about ${mmFixed(V.needMm, 1)} relieves the nozzle (typical)`, LABEL)
        rows[1].set(`${mmFixed(q.dist, 1)} → strings on ${V.count} of ${RETRACT_TEST.travels} travels`, tone)
        rows[2].set(V.jam > 0 ? `past ${mmFixed(V.safeMm, 0)}: melt reaches the heat break, jam risk ${pct(V.jam)}` : `below ${mmFixed(V.safeMm, 0)}: heat break stays clean`, V.jam > 0 ? HIGH_V : POWER)
        rows[3].set(V.grind > 0 ? `${q.speed} mm/s: gear grinding risk ${pct(V.grind)}` : q.speed < 25 ? `${q.speed} mm/s: slow pull, oozes while retracting` : `${q.speed} mm/s: in the usual window`, V.grind > 0 ? HIGH_V : q.speed < 25 ? HEAT : POWER)
        head.status.set(`Retraction · ${V.name}`)
        head.sub.set(`stringing test: two towers ${span} mm apart, ${RETRACT_TEST.travels} travels shown`, GREY)
        head.event.set(V.jam > 0.5 ? 'too far: expect a clog' : V.string < 0.2 ? 'clean travels' : 'strings between the towers', V.jam > 0.5 ? HIGH_V : tone)
      },
      readouts: (p) => {
        const { V } = rtRun(p)
        return [
          { label: 'Strings', value: `${V.count} / ${RETRACT_TEST.travels}`, tone: toneOf(V.string < 0.2, V.string < 0.5) },
          { label: 'Jam risk', value: pct(V.jam), tone: toneOf(V.jam === 0, V.jam < 0.3) },
          { label: 'Grind risk', value: pct(V.grind), tone: toneOf(V.grind === 0, V.grind < 0.3) },
          { label: 'Added per print', value: secs(V.addS) },
        ]
      },
    }
  },
}

// --- Temperature tower: one band per temperature; read adhesion, stringing and overhangs off it. ---

const TT = { k: 0.19, at: [-10, -12.6, 0] as V3, pin: 34 }
const TT_NAMES = Object.fromEntries(CAL_FILAMENTS.map((f) => [f, FILAMENTS[f].name])) as Record<FilamentKey, string>
const ttParams = (p: Params) => ({ f: pick(TT_NAMES, p.fil, 'pla') as FilamentKey, dc: n(p, 'dc') })
const ttRun = memoBy((p: Params) => `${p.fil} ${p.dc}`, (p: Params) => {
  const q = ttParams(p)
  const V = towerView(q.f)
  const i = Math.round((20 - q.dc) / TEMP_TOWER.step)
  return { q, V, i, b: V.bands[i] }
})
const bandTone = (s: number, best: number) => (s > 0.85 * best ? POWER : s > 0.6 * best ? HEAT : HIGH_V)

export const calibrationTemperatureTower: Lesson = {
  id: 'calibration-temperature-tower',
  title: 'Temperature tower',
  tagline: 'One print, one band per temperature: pick the best',
  formula: (p) => {
    const { V, b } = ttRun(p)
    return `score = adhesion × (1 − 0.7 strings) × (1 − 0.6 droop), typical trends · ${celsiusText(b.c)}: ${pct(b.adhesion)} × ${pct(1 - 0.7 * b.string)} × ${pct(1 - 0.6 * b.droop)} = ${pct(b.score)} · best ${celsiusText(V.bestC)}`
  },
  legend: [
    { color: POWER, label: 'Layer adhesion', shape: 'dot' },
    { color: HEAT, label: 'Stringing', shape: 'dot' },
    { color: B_FIELD, label: 'Overhang droop', shape: 'dot' },
    { color: RING, label: 'Overall, typical', shape: 'dot' },
  ],
  points: [
    'Every spool prints best in a narrower band than the label range. A temperature tower prints one part with the nozzle stepped down every few mm (the slicer inserts M104 at each band height, see G-code > Temperatures and fans), so all temperatures come out of one print under the same cooling.',
    'Read it band by band. Hot bands string between the tower and the pin and their overhang tabs droop; cold bands look crisp but split along layers when you snap the tower (weak bonding, Filaments > Glass transition temp) and may under-extrude at speed, since cooler melt flows less (How FDM works > Hotend and extruder).',
    'Pick the coolest band that still bonds well, then print at it. Nozzle thermistors differ by several degrees between printers, so a value from someone else\'s profile is only a starting point (Temperature & cooling > Hotend PID tuning keeps it steady).',
    'Do it before Retraction and per brand and colour. Faster printing needs hotter bands to keep up the melt, so tune at the speed you print.',
  ],
  controls: [
    { kind: 'choice', key: 'fil', options: opts(TT_NAMES), initial: 'pla' },
    { kind: 'slider', key: 'dc', label: 'Inspect band', min: -20, max: 20, step: 5, initial: 0, format: (v) => `${signed(v, 0)} °C from the label` },
  ],
  build(): Stage {
    const c = calStage('band quality, hot to cold')
    const { scene, head, plot, rows } = c
    const { k } = TT
    const nb = TEMP_TOWER.bands
    const g = add(scene, new THREE.Group(), TT.at)
    g.rotation.set(0.12, -0.45, 0)
    const look = { w: 20, d: 12, bandH: 8, tab: 10 }
    box(g, [70 * k, 0.4, 30 * k], mat('#3a3f47', { rough: 0.6 }), [12 * k, -0.2, 0])
    const tower = testTower(g, [0, 0, 0], k, nb, look)
    const H = nb * look.bandH * k
    box(g, [3 * k, H, 3 * k], mat(FILAMENT_COLOR, { rough: 0.5 }), [TT.pin * k, H / 2, 0])
    const web = stringWeb(g, nb * 3)
    const S = plot.s
    const tr = [POWER, HEAT, B_FIELD, RING].map((col) => S.trace(col, { samples: nb, radius: 0.06 }))
    const cur = cursorBar(S, LABEL, 0.05)
    const py = plotY(0, 1.05, PLOT.h)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V, i: sel, b } = ttRun(p)
        const best = V.bands[V.best].score
        const strings: { a: V3; b: V3; sag: number; r: number }[] = []
        V.bands.forEach((band, i) => {
          tower.set(i, i === sel ? RING : FILAMENT_COLOR, band.droop, i === sel ? 0.35 : i === V.best ? 0.15 : 0)
          tower.label(i, `${celsiusText(band.c)}${i === V.best ? ' best' : ''}`, i === sel ? RING : i === V.best ? POWER : GREY)
          const m = Math.round(band.string * 3)
          for (let j = 0; j < m; j++) {
            const y = tower.bandY(i) + (j - 1) * 0.25
            strings.push({ a: [(look.w / 2) * k, y, ((j - 1) * look.d * k) / 3], b: [TT.pin * k, y - 0.1, ((j - 1) * k * 2) / 3], sag: 0.15 + 0.1 * j, r: 0.015 + 0.02 * band.string })
          }
        })
        web.set(strings)
        const u = (j: number) => j / (nb - 1)
        const keys = ['adhesion', 'string', 'droop', 'score'] as const
        keys.forEach((key, j) => tr[j].points(V.bands.map((_, i) => u(i)), V.bands.map((s) => py(key === 'score' ? s.score / best : s[key])), sel))
        cur(u(sel))
        plot.lo.set(celsiusText(V.bands[0].c))
        plot.hi.set(celsiusText(V.bands[nb - 1].c))
        plot.right.set(`${pct(b.score / best)} of best`, bandTone(b.score, best))
        rows[0].set(`${FILAMENTS[q.f].name}: label ${celsiusText(FILAMENTS[q.f].nozzleC)}, bands ${celsiusText(V.bands[0].c)} down to ${celsiusText(V.bands[nb - 1].c)}`, LABEL)
        rows[1].set(`${celsiusText(b.c)}: adhesion ${pct(b.adhesion)} · strings ${pct(b.string)} · droop ${pct(b.droop)}`, bandTone(b.score, best))
        rows[2].set(`melt flow up to ${fixedText(b.flowQ, 1)} mm³/s (V6-style, typical)`, GREY)
        rows[3].set(`print at ${celsiusText(V.bestC)} · usable ${V.good.map((x) => celsiusText(x)).join(', ')}`, POWER)
        head.status.set(`Temperature tower · ${FILAMENTS[q.f].name}`)
        head.sub.set(`${nb} bands of ${look.bandH} mm, ${TEMP_TOWER.step} °C apart, hottest at the bottom`, GREY)
        head.event.set(b.adhesion < 0.6 ? 'too cold: layers split apart' : b.string > 0.4 ? 'too hot: strings and drooping tabs' : 'clean band', bandTone(b.score, best))
      },
      readouts: (p) => {
        const { V, b } = ttRun(p)
        const best = V.bands[V.best].score
        return [
          { label: 'Band quality', value: pct(b.score / best), tone: toneOf(b.score > 0.85 * best, b.score > 0.6 * best) },
          { label: 'Best band', value: celsiusText(V.bestC) },
        ]
      },
    }
  },
}
