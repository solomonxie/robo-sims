import * as THREE from 'three/webgpu'
import {
  BALL_BEARINGS,
  BENCH_C,
  CALIPERS,
  CALIPER_LAPSE_S,
  CaliperCfg,
  CaliperKind,
  DEG,
  FOOT_FIXES,
  FootFix,
  HOLE_SHRINK_MM,
  MEASURE_PARTS,
  MEASURE_TOL,
  METRIC_SCREWS,
  MeasurePartKey,
  SCREW_HEADS,
  TOL_BATCH,
  TOL_JOBS,
  TolCfg,
  TolJobKey,
  VERNIER_LC,
  caliperAt,
  caliperRun,
  tolRun,
} from '../../core/physics'
import { degText, fixedText, mmFixed, pct, signed } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import {
  BENCH_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PART_STEEL,
  PLA_TINT,
  POWER,
  RING,
  ballBearing,
  batchStrip,
  columnGauge,
  dialFace,
  fitSection,
  heatTint,
  lapseClock,
  liveLabel,
  memoBy,
  puzzleStage,
  stretchRod,
  addRod,
  scaleZoom,
  screwModel,
  stackSection,
  verdictLegend,
  verdictTint,
  vernierCaliper,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

/** Signed mm to 2 places, 0.00 when it rounds to nothing. */
const pm = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : signed(v, 2))
const mm2 = (v: number) => mmFixed(v, 2)

// --- Reading a caliper: read the scale right, then keep zero, heat, tilt, squeeze and parallax out of the reading. ---

const PART_NAMES = namesOf(MEASURE_PARTS)
const KIND_NAMES = namesOf(CALIPERS)
const PREP_OPTS = { good: 'Zeroed, part at room temperature', nozero: 'Skipped zeroing (grit on the jaws)', hot: 'Measured straight off the printer bed' }
const calCfg = (p: Params): CaliperCfg => ({
  part: pick(PART_NAMES, p.part, 'tyre') as MeasurePartKey,
  kind: pick(KIND_NAMES, p.kind, 'vernier') as CaliperKind,
  tiltDeg: n(p, 'tilt'),
  forceN: n(p, 'force'),
  eyeDeg: n(p, 'eye'),
  zeroed: p.prep !== 'nozero',
  hot: p.prep === 'hot',
})
const calKey = (c: CaliperCfg) => `${c.part}|${c.kind}|${c.tiltDeg}|${c.forceN}|${c.eyeDeg}|${c.zeroed}|${c.hot}`
const calSolve = memoBy(calKey, caliperRun)
type CalRun = ReturnType<typeof caliperRun>

/** How the reading is put together on each caliper. */
function readText(r: CalRun) {
  if (r.cfg.kind === 'vernier') return `${r.vernier.main} + ${r.vernier.line} × ${fixedText(VERNIER_LC, 2)} = ${mm2(r.reading)}`
  if (r.cfg.kind === 'dial') return `bar ${r.dial.barMm} + needle ${fixedText(r.dial.needle * CALIPERS.dial.mmPerTurn, 2)} = ${mm2(r.reading)}`
  return `display ${mm2(r.reading)}`
}

function calWhy(r: CalRun): string {
  const P = r.part
  const e = r.errs
  const what = P.name.split(',')[0]
  switch (r.verdict.fail) {
    case 'zero':
      return `Not zeroed: it reads ${pm(e.zero)} mm before it touches anything`
    case 'hot':
      return `${what} at ${Math.round(r.hotC)} °C is ${pm(e.hot)} mm bigger than at ${BENCH_C} °C: let it cool`
    case 'tilt':
      return `Jaws ${degText(r.cfg.tiltDeg)} off square: ${pm(e.tilt)} mm (${P.mode === 'inside' ? 'a chord, short' : 'a slant, long'}); keep under ${degText(r.tiltMax)} here`
    case 'squeeze':
      return `${fixedText(r.cfg.forceN, 1)} N squeezes the ${what.replace(/^[A-Z](?=[a-z])/, (ch) => ch.toLowerCase())} ${pm(e.squeeze)} mm: light touch, under ${fixedText(r.forceMax, 1)} N`
    case 'parallax':
      return `Eye ${degText(r.cfg.eyeDeg, 0)} off square: the line reads ${pm(e.parallax)} mm off. Look straight on`
    case 'total':
      return `No single slip is big, but they add up: ${pm(r.error)} mm off`
    default:
      return `${mm2(r.reading)}, ${pm(r.error)} from ${mm2(P.trueMm)}: within ±${fixedText(MEASURE_TOL, 2)}`
  }
}

const K = 0.13
const FIXED: V3 = [-15.5, 0.4, 0]
/** Inside jaws point up: drop the caliper so the part clears the header. */
const INSIDE_DROP = -3.8
/** Visual exaggeration of the squeeze. */
const SQUASH = 15
/** Where the part sits in caliper-local units (fixed jaw face at x = 0, beam bottom at y = 0). */
function partCentre(part: MeasurePartKey, cal: { knifeY: number; endX: number; rodY: number }): [number, number] {
  const P = MEASURE_PARTS[part]
  if (P.mode === 'inside') return [(P.trueMm / 2) * K, cal.knifeY]
  if (P.mode === 'depth') return [cal.endX, cal.rodY]
  return [(P.trueMm / 2) * K, -Math.min(36, Math.max(20, P.trueMm / 2 + 3)) * K]
}

/** One model per part, centred on the measuring point, in its own group. */
function partModel(parent: THREE.Object3D, part: MeasurePartKey) {
  const g = add(parent, new THREE.Group())
  if (part === 'tyre') {
    const w = add(g, buildWheel())
    w.scale.setScalar(((MEASURE_PARTS.tyre.trueMm / 2) * K) / 12.8)
  } else if (part === 'cell') {
    const r = (MEASURE_PARTS.cell.trueMm / 2) * K
    cylinder(g, r, 65 * K, mat('#2856c8', { rough: 0.35 }), [0, 0, -32.5 * K], 'z', 40)
    cylinder(g, r * 0.4, 0.06, mat(PART_STEEL, { metal: 0.4 }), [0, 0, 0.03], 'z', 20)
  } else if (part === 'screw') {
    const s = METRIC_SCREWS.m3
    screwModel(g, { d: s.d, pitch: s.pitch, hex: s.hex.cap, head: SCREW_HEADS.cap }, 12, K, [0, 6 * K, 0])
  } else if (part === 'bore') {
    ballBearing(g, BALL_BEARINGS.b608, K)
  } else if (part === 'bracket') {
    box(g, [42 * K, 30 * K, 12 * K], mat(PLA_TINT, { rough: 0.7 }), [0, -5 * K, -6 * K])
  } else {
    const pla = mat(PLA_TINT, { rough: 0.7 })
    const d = MEASURE_PARTS.depth.trueMm
    box(g, [18 * K, 6 * K, 12 * K], pla, [9 * K, 14 * K, -6 * K])
    box(g, [18 * K, 6 * K, 12 * K], pla, [9 * K, -14 * K, -6 * K])
    box(g, [(18 - d) * K, 22 * K, 12 * K], pla, [(d + (18 - d) / 2) * K, 0, -6 * K])
  }
  return g
}

export const measuringReadingACaliper: Lesson = {
  id: 'measuring-reading-a-caliper',
  title: 'Reading a caliper',
  tagline: 'Read a vernier, dial or digital caliper on real robot parts, and keep zero, heat, tilt, squeeze and parallax out of the reading',
  formula: (p) => {
    const r = calSolve(calCfg(p))
    return `reading = ${readText(r)} · error = reading − true = ${mm2(r.reading)} − ${mm2(r.part.trueMm)} = ${pm(r.error)} mm (target ±${fixedText(MEASURE_TOL, 2)}) · tilt: ${r.part.mode === 'inside' ? 'D·cos θ' : 'D / cos θ'}`
  },
  legend: verdictLegend('Off by more than 0.05 mm', 'Within ±0.05 mm', 'Within ±0.10 mm'),
  points: [
    'Vernier: the main scale gives whole millimetres left of the vernier’s 0; then find the one vernier line that lines up exactly with a main-scale line. The vernier has 50 lines over 49 mm, so each is 0.02 mm short of a millimetre, and the line number × 0.02 is the fraction. Dial: whole mm on the bar plus the needle (2 mm a turn). Digital: read it, but zero it first.',
    'Zero first: close the clean jaws and press ZERO (or note the vernier’s zero error). Grit on a jaw or zeroing while open shifts every reading by the same amount.',
    'Square to the part: tilted jaws read a slant, D / cos θ (an inside reading gives a short chord, so rock it to find the largest). The same tilt that costs 0.004 mm on an M3 screw costs 0.09 mm on a 65 mm tyre: big parts need more care.',
    'Light, even force: the thumb wheel, not a squeeze. A rubber tyre gives 0.025 mm per newton, so the Robot drifts hunt (Debug it › Robot drifts › Wheel size error) needs a light touch. Look straight at a vernier (its plate sits 0.3 mm above the scale), and measure prints at room temperature: PLA grows 68 µm per metre per °C.',
    'Calipers do lengths. Volts, amps and continuity are the multimeter’s job (Electricity › Voltage › Measuring with a multimeter, Debug it › Using a multimeter); screw sizes from a caliper are in Materials › Fasteners › Metric sizes.',
  ],
  controls: [
    { kind: 'choice', key: 'part', options: opts(PART_NAMES), initial: 'tyre' },
    { kind: 'choice', key: 'kind', options: opts(KIND_NAMES), initial: 'vernier' },
    { kind: 'slider', key: 'tilt', label: 'Jaws off square', min: 0, max: 8, step: 0.5, initial: 2, format: (v) => degText(v) },
    { kind: 'slider', key: 'force', label: 'Jaw force', min: 0.5, max: 10, step: 0.5, initial: 6, format: (v) => `${fixedText(v, 1)} N` },
    { kind: 'slider', key: 'eye', label: 'Eye off square', min: 0, max: 30, step: 2, initial: 10, format: (v) => degText(v, 0) },
    { kind: 'choice', key: 'prep', options: opts(PREP_OPTS), initial: 'good' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const pivot = add(scene, new THREE.Group())
    const cal = vernierCaliper(pivot, K, [0, 0, 0], 125)
    const partRoot = add(scene, new THREE.Group())
    let model: THREE.Group | null = null
    let squashable: THREE.Object3D | null = null
    let warm: ((f: number) => void) | null = null
    const eye = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), mat('#f2f2f2', { rough: 0.4 })))
    const sight = addRod(scene, mat(GREY))
    const partTag = liveLabel(scene, [-15.5, -9.6, 0.3], { size: 0.3, align: 'left' })
    const errG = columnGauge(scene, 0, {
      min: -0.2,
      max: 0.2,
      window: [-MEASURE_TOL, MEASURE_TOL],
      caption: 'Reading − true size',
      ticks: [[-0.2, '−0.2'], [-0.1, '−0.1'], [0, '0'], [0.1, '+0.1'], [0.2, '+0.2 mm']],
    })
    const zoomA = scaleZoom(scene, [8, -3.0, 0], 7.6, 1.1)
    const zoomB = scaleZoom(scene, [8, -7.6, 0], 7.6, 1.1)
    const dial = dialFace(scene, [8, -7.6, 0.1], 1.8)
    const lcd = liveLabel(scene, [8, -7.6, 0.3], { size: 1.1 })
    const rows = [0, 1, 2].map((i) => liveLabel(scene, [4.2, -10 - i * 0.75, 0.3], { size: 0.24, align: 'left' }))
    const clock = lapseClock(CALIPER_LAPSE_S, 0.6, 1.2)
    let built = ''
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = calCfg(p)
        const r = calSolve(c)
        const P = r.part
        const [cx, cy] = partCentre(c.part, cal)
        if (built !== c.part) {
          built = c.part
          model?.removeFromParent()
          model = partModel(partRoot, c.part)
          squashable = c.part === 'tyre' ? model.children[0] : null
          warm = P.alpha > 0 ? heatTint(model) : null
        }
        pivot.position.set(FIXED[0] + cx, FIXED[1] + (P.mode === 'inside' ? INSIDE_DROP : 0) + cy, 0)
        cal.group.position.set(-cx, -cy, 0)
        pivot.rotation.z = (P.mode === 'inside' ? -1 : 1) * c.tiltDeg * DEG
        partRoot.position.copy(pivot.position)
        cal.setKind(c.kind)
        const now = clock(dt, calKey(c))
        const f = caliperAt(r, now)
        const shownDial = f.shown - Math.floor(f.shown / CALIPERS.dial.mmPerTurn + 1e-9) * CALIPERS.dial.mmPerTurn
        cal.set(f.gapMm, fixedText(f.shown, 2), shownDial / CALIPERS.dial.mmPerTurn, P.mode === 'depth')
        const hard = f.forceN / r.forceMax
        cal.tint(hard > 1 ? HIGH_V : HEAT, f.touching ? Math.min(1, hard) * 0.8 : 0)
        if (squashable) squashable.scale.x = squashable.scale.y * (1 + (SQUASH * r.errs.squeeze * Math.min(1, f.forceN / Math.max(0.01, c.forceN))) / P.trueMm)
        warm?.((r.hotC - BENCH_C) / 60)
        // Sight line to the reading point, leaning by the eye angle.
        const readX = FIXED[0] + f.gapMm * K
        const readY = FIXED[1] + (P.mode === 'inside' ? INSIDE_DROP : 0) + 8 * K
        const a = c.eyeDeg * DEG
        const top: V3 = [readX - Math.sin(a) * 1.7, readY + Math.cos(a) * 1.7, 0.6]
        stretchRod(sight, [readX, readY, 0.5], top, 0.03)
        sight.visible = eye.visible = c.kind !== 'digital'
        eye.position.set(...top)
        partTag.set(`${P.name} · true ${mm2(P.trueMm)}${r.hotC > BENCH_C ? ` · ${Math.round(r.hotC)} °C` : ''}`, LABEL)
        const tint = verdictTint(r.verdict.pass, r.verdict.near)
        errG.set(Math.max(-0.2, Math.min(0.2, r.error)), `${pm(r.error)} mm`, tint)
        const settled = f.settled
        const v = r.vernier
        if (c.kind === 'vernier') {
          zoomA.title.set(`vernier 0 sits past ${v.main} mm`, LABEL)
          zoomA.set('vernier', r.reading, r.reading, null)
          zoomB.title.set(settled ? `line ${v.line} lines up: + ${fixedText(v.line * VERNIER_LC, 2)} mm` : 'closing…', settled ? POWER : GREY)
          zoomB.set('vernier', r.reading, r.reading + v.line * (49 / 50), settled ? v.line : null)
        } else {
          zoomA.title.set(c.kind === 'dial' ? `bar: ${r.dial.barMm} mm (2 mm a turn)` : 'beam: slider edge', LABEL)
          zoomA.set('edge', f.shown, f.shown, null)
          zoomB.title.set(c.kind === 'dial' ? `needle: + ${fixedText(shownDial, 2)} mm` : 'display', LABEL)
        }
        zoomB.group.visible = c.kind === 'vernier'
        dial.group.visible = c.kind === 'dial'
        dial.set(shownDial / CALIPERS.dial.mmPerTurn)
        lcd.group.visible = c.kind === 'digital'
        lcd.set(`${fixedText(f.shown, 2)} mm`, LABEL)
        const e = r.errs
        rows[0].set(`zero ${pm(e.zero)} · heat ${pm(e.hot)} · tilt ${pm(e.tilt)}`, GREY)
        rows[1].set(`squeeze ${pm(e.squeeze)} · parallax ${pm(e.parallax)} mm`, GREY)
        rows[2].set(`this part: tilt ≤ ${degText(r.tiltMax)}, ${r.forceMax > 20 ? 'any light force' : `force ≤ ${fixedText(r.forceMax, 1)} N`}`, LABEL)
        header.set(`read the ${P.name.split(',')[0].replace(/^[A-Z](?=[a-z])/, (ch) => ch.toLowerCase())} within ±${fixedText(MEASURE_TOL, 2)} mm`, r.verdict, calWhy(r), 'Hint: zero it, square on, light touch, eye straight, part at room temperature')
      },
      readouts: (p) => {
        const r = calSolve(calCfg(p))
        return [
          { label: 'Reading', value: mm2(r.reading), tone: toneOf(r.verdict.pass, r.verdict.near) },
          { label: 'True', value: mm2(r.part.trueMm), tone: 'ok' },
          { label: 'Error', value: `${pm(r.error)} mm`, tone: toneOf(Math.abs(r.error) <= MEASURE_TOL, Math.abs(r.error) <= 2 * MEASURE_TOL) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

// --- Tolerances: hole vs part limits, stack-up worst case vs RSS, and how much of a printed batch assembles. ---

const JOB_NAMES = namesOf(TOL_JOBS)
const tolCfg = (p: Params): TolCfg => ({
  job: pick(JOB_NAMES, p.job, 'axle') as TolJobKey,
  cadMm: n(p, 'cad'),
  printTol: n(p, 'ptol'),
  foot: pick(FOOT_FIXES, p.foot, 'none') as FootFix,
})
const tolKey = (c: TolCfg) => `${c.job}|${c.cadMm}|${c.printTol}|${c.foot}`
const tolSolve = memoBy(tolKey, tolRun)
type TlRun = ReturnType<typeof tolRun>

function tolWhy(r: TlRun): string {
  const [lo, hi] = r.J.want
  switch (r.verdict.fail) {
    case 'tight':
      return `Average ${pm(r.mean)} mm, wanted ${pm(lo)} to ${pm(hi)}: too tight. The ${r.J.hole} prints ${fixedText(HOLE_SHRINK_MM, 1)} mm small; draw it bigger`
    case 'loose':
      return `Average ${pm(r.mean)} mm, wanted ${pm(lo)} to ${pm(hi)}: too loose, it wobbles. Draw it smaller`
    case 'mouth':
      return `Elephant foot: ${mm2(r.foot)} a side narrows the mouth to ${pm(r.mouth)} mm: it ${r.mouth < 0 ? 'jams' : 'cracks'} at the entry. Chamfer it`
    case 'spread':
      return `Centred, but ±${mm2(r.rss)} (RSS) spills out of a ${mm2(hi - lo)} window: ${pct(r.good)} fit. Tighter printer, or a wider window`
    default:
      return `${pct(r.good)} of the batch fit: ${pm(r.mean)} ± ${fixedText(r.rss, 2)} mm sits inside ${pm(lo)} to ${pm(hi)}`
  }
}

/** Display widths for the fit section (scene units per mm of clearance, and the part's drawn width). */
const GAP_K = 8
const FIT_LOOK: Record<Exclude<TolJobKey, 'stack'>, { shaft: number; itemH: number; depth: number; kind: 'bearing' | 'screw' | 'pin' }> = {
  bearing: { shaft: 7, itemH: (7 * BALL_BEARINGS.b608.B) / BALL_BEARINGS.b608.D, depth: 3, kind: 'bearing' },
  screw: { shaft: 1.8, itemH: 3.6, depth: 3, kind: 'screw' },
  axle: { shaft: 4, itemH: 4.2, depth: 3, kind: 'pin' },
}
const STACK_K = 0.45
const STACK_LOOK = { heights: [5, 3, 4, 5], colors: [PART_STEEL, PLA_TINT, PLA_TINT, PART_STEEL], H: 6.4 }

export const measuringTolerances: Lesson = {
  id: 'measuring-tolerances',
  title: 'Tolerances',
  tagline: 'Set the hole size and your printer’s spread: see the fit, worst case vs RSS stack-up, and how much of a batch goes together',
  formula: (p) => {
    const r = tolSolve(tolCfg(p))
    return `gap = (CAD ${mm2(r.holeCad)} − shrink ${fixedText(HOLE_SHRINK_MM, 2)}) − parts = ${pm(r.mean)} mm · worst case ±Σt = ±${fixedText(r.wc, 2)} · RSS ±√Σt² = ±${fixedText(r.rss, 2)} (σ ${fixedText(r.sigma, 3)}) · ${r.limits.kind} fit`
  },
  legend: [
    { color: POWER, label: 'Fits the wanted window', shape: 'dot' },
    { color: HIGH_V, label: 'Too tight / jams at the mouth', shape: 'dot' },
    { color: RING, label: 'Too loose', shape: 'dot' },
    { color: HEAT, label: 'Elephant foot / press', shape: 'dot' },
  ],
  points: [
    'Nothing is made exactly to size: every dimension is a nominal ± a tolerance. Bought parts come with catalogue limits (608 bearing OD 22 0/−0.009 mm, width 7 0/−0.12; M3 thread 2.874–2.980 mm); a printed part with your printer’s spread.',
    'A fit compares the hole’s limits with the part’s: clearance (always a gap: an M3 through 3.2 / 3.4 / 3.6 mm holes, ISO 273), interference (always a press: a bearing pocket), transition (could be either; avoid it unless you sort parts). Fit classes and gauges for prints: 3D printing › Design for printing › Tolerances and fits.',
    'Stack-up: a gap at the end of a chain collects every part’s error. Worst case adds the tolerances (Σt: guaranteed, but it grows with every part); RSS adds them as √Σt², the spread independent random errors really give (Maths › Probability › Gaussian noise). With tolerances taken as ±3σ, RSS predicts 99.7 % inside.',
    'Printers are biased as well as spread: holes and slots print about 0.1 mm small, outsides a little big, and the first layers squash out (3D printing › Print problems › Elephant foot). Fix the mean in CAD, chamfer the bed-side mouth, then the spread is what’s left.',
    'Check it: measure a few parts with calipers (Workshop skills › Measuring › Reading a caliper) and print a fit gauge before the real part. Bearing loads and bushings: Materials › Bearings.',
  ],
  controls: [
    { kind: 'choice', key: 'job', options: opts(JOB_NAMES), initial: 'axle' },
    { kind: 'slider', key: 'cad', label: 'CAD clearance (hole − parts)', min: -0.3, max: 0.9, step: 0.025, initial: 0.2, format: (v) => `${pm(v)} mm` },
    { kind: 'slider', key: 'ptol', label: 'Printer spread ± (3σ)', min: 0.02, max: 0.3, step: 0.01, initial: 0.15, format: (v) => `±${mm2(v)}` },
    { kind: 'choice', key: 'foot', options: opts(FOOT_FIXES), initial: 'none' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const fit = fitSection(scene, [-9.5, -3.4, 0], 13)
    const stack = stackSection(scene, [-15.5, -2, 0], 4)
    const stackTags = [0, 1, 2, 3].map(() => liveLabel(scene, [0, -5.6, 0.3], { size: 0.24 }))
    const bedTag = liveLabel(scene, [-2.6, -3.3, 0.3], { size: 0.26, align: 'left' })
    const batch = batchStrip(scene, [-16.6, -8.3, 0], TOL_BATCH.n, 20, 0.62)
    const batchTag = liveLabel(scene, [-16.8, -7.5, 0.3], { size: 0.28, align: 'left' })
    const rows = [0, 1].map((i) => liveLabel(scene, [-16.8, -10.3 - i * 0.8, 0.3], { size: 0.26, align: 'left' }))
    const gapG = columnGauge(scene, 0, { min: -0.4, max: 1, window: [0.1, 0.3], caption: 'Gap: batch average, ±3σ bar (RSS)', ticks: [[-0.4, '−0.4'], [0, '0'], [0.4, '0.4'], [1, '1 mm']] })
    const wcG = columnGauge(scene, 1, { min: -0.4, max: 1, window: [0.1, 0.3], caption: 'Worst case: every part at its limit', ticks: [[-0.4, '−0.4'], [0, '0'], [0.4, '0.4'], [1, '1 mm']] })
    const yieldG = columnGauge(scene, 2, { min: 0, max: 1, window: [TOL_BATCH.yieldGoal, 1], caption: 'Share of the batch that fits', ticks: [[0, '0'], [0.5, '50'], [1, '100 %']] })
    const clock = lapseClock(1.6, 0.8, 1.4)
    let wob = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = tolCfg(p)
        const r = tolSolve(c)
        const [lo, hi] = r.J.want
        const now = clock(dt, tolKey(c)) / 1.6
        const isStack = c.job === 'stack'
        fit.group.visible = !isStack
        stack.group.visible = isStack
        stackTags.forEach((t) => (t.group.visible = isStack))
        if (!isStack) {
          const L = FIT_LOOK[c.job as Exclude<TolJobKey, 'stack'>]
          const hole = Math.max(L.shaft * 0.6, L.shaft + r.mean * GAP_K)
          const mouth = Math.max(L.shaft * 0.5, hole - 2 * r.foot * GAP_K)
          const stuck = r.mouth < r.J.mouthMin
          const loose = r.mean > hi
          fit.set({ kind: L.kind, hole, mouth, shaft: L.shaft, depth: L.depth, itemH: L.itemH, drop: now, stuck, press: r.mean < 0, wobble: loose && now >= 1 ? Math.sin((wob += dt * 6)) * Math.min(0.12, (r.mean - hi) * 0.4) : 0 })
          bedTag.set(r.foot > 0 ? 'bed face up: elephant foot' : 'bed face up', r.foot > 0 ? HEAT : GREY)
        } else {
          const J = r.J
          const parts = [J.bought[0], J.printed[0], J.printed[1], J.bought[1]]
          const widths = parts.map((d) => d.nom * STACK_K)
          const sum = widths.reduce((s, w) => s + w, 0)
          stack.set(widths, STACK_LOOK.colors, STACK_LOOK.heights, sum + r.mean * GAP_K, r.foot * GAP_K, STACK_LOOK.H)
          let x = -15.5
          parts.forEach((d, i) => {
            stackTags[i].group.position.set(x + widths[i] / 2, i % 2 ? -5.9 : -5.3, 0.3)
            stackTags[i].set(`${d.name} ${d.nom}`, GREY)
            x += widths[i]
          })
          bedTag.set('')
        }
        const col = r.batch.map((b) => (b.fits ? POWER : b.stuck || b.clearance < lo ? HIGH_V : RING))
        batch.set(col)
        const fits = r.batch.filter((b) => b.fits).length
        batchTag.set(`a batch of ${TOL_BATCH.n}: ${fits} fit · want ${r.J.wantText}`, verdictTint(fits === TOL_BATCH.n, fits >= 0.9 * TOL_BATCH.n))
        const hole = r.dims[0]
        rows[0].set(`${r.J.hole}: CAD ${mm2(r.holeCad)} → prints ${mm2(hole.mean)} ± ${fixedText(hole.tol, 2)}`, LABEL)
        rows[1].set(`${r.limits.kind} fit: gap ${pm(r.limits.minC)} to ${pm(r.limits.maxC)} mm at the limits`, GREY)
        const span = (v: number) => Math.max(-0.4, Math.min(1, v))
        gapG.setWindow(lo, hi)
        wcG.setWindow(lo, hi)
        const tint = verdictTint(r.verdict.pass, r.verdict.near)
        gapG.set(span(r.mean), `${pm(r.mean)} ± ${fixedText(r.rss, 2)}`, tint, [span(r.rssRange[0]), span(r.rssRange[1])])
        wcG.set(span(r.mean), `± ${fixedText(r.wc, 2)}${r.wcInside ? ' fits' : ' spills'}`, r.wcInside ? POWER : RING, [span(r.wcRange[0]), span(r.wcRange[1])])
        yieldG.set(r.good, pct(r.good), verdictTint(r.good >= TOL_BATCH.yieldGoal, r.good >= 0.9))
        header.set(TOL_JOBS[c.job].name.toLowerCase().replace(/^m3/, 'M3').replace(/^(\d)/, '$1'), r.verdict, tolWhy(r), 'Hint: centre the gap first (CAD), fix the mouth, then tighten the spread', { lead: 'Fit' })
      },
      readouts: (p) => {
        const r = tolSolve(tolCfg(p))
        const [lo, hi] = r.J.want
        return [
          { label: 'Gap', value: `${pm(r.mean)} mm`, tone: toneOf(r.mean >= lo && r.mean <= hi, true) },
          { label: 'RSS / WC', value: `±${fixedText(r.rss, 2)} / ±${fixedText(r.wc, 2)}`, tone: toneOf(r.wcInside, r.good >= TOL_BATCH.yieldGoal) },
          { label: 'Batch fits', value: pct(r.good), tone: toneOf(r.good >= TOL_BATCH.yieldGoal, r.good >= 0.9) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
