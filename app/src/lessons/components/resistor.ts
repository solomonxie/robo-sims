import * as THREE from 'three/webgpu'
import {
  PIN_LEAK_A,
  Pull,
  RATINGS_W,
  RESISTOR_BURN_C,
  RESISTOR_MAX_C,
  VIH,
  VIL,
  deratedPower,
  floatingPickup,
  hotSpotC,
  logicLevel,
  pickRating,
  powerV2R,
  pulledPin,
  rcStep,
} from '../../core/physics'
import { GRADES, Grade, batchPart, nearestIn, seriesStep, toleranceRange } from '../../core/resistorColors'
import { amps, fitDigits, ohms, si, volts, watts } from '../../core/units'
import { TIN, V3, add, box, lead, mat, mesh, rod } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { RESISTOR_MM, resistorBody, resistorBodyFor } from '../../models/passives'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  GREY,
  HIGH_V,
  LANE,
  LOW_V,
  POWER,
  RING,
  R_SCALE,
  cell,
  cellFraction,
  clamp01,
  dropAlong,
  ease,
  emptyGroup,
  glowMat,
  groundSymbol,
  heatGlow,
  multimeter,
  plusFlow,
  presence,
  probe,
  pulseLabel,
  pushButton,
  scope,
  segmentDisplay,
  smoke,
  swapResistor,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n, resistorSlider } from '../types'

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`
const SCORCHED = new THREE.Color('#4a3428')

// --- Value and tolerance: a batch measured one by one piles into a bell inside the ±tolerance window. ---

const GRADE_KEYS = ['1', '5', '10']
const gradeOf = (p: Params) => GRADES[(GRADE_KEYS.includes(String(p.tol)) ? Number(p.tol) : 5) as Grade]

const solveValue = (p: Params) => {
  const g = gradeOf(p)
  const value = nearestIn(g.series, n(p, 'ohms'))
  const [lo, hi] = toleranceRange(value, g.percent)
  return { g, value, lo, hi, lower: seriesStep(g.series, value, -1), upper: seriesStep(g.series, value, 1) }
}

const JIG: V3 = [-5.6, 2.8, 0]
const JIG_SCALE = 2.6
const LEAD_END = 1.2 * JIG_SCALE + 1.9
const METER: V3 = [-14, -1.2, 0]
const METER_SCALE = 0.56
const P1: V3 = [7.2, 0.6, 0]
const P1_W = 10.5
const P1_H = 8
const SPAN = 2.5
const BINS = 25
const BATCH = 60
const DOT_R = 0.2
const SLOW_PARTS = 5
const SLOW_S = 1.3
const FAST_S = 0.26
const REST_S = 3
const unitOf = (v: number) => (v >= 1e6 ? 1e6 : v >= 1e3 ? 1e3 : 1)
const devU = (dev: number) => 0.5 + dev / (2 * SPAN)

export const valueAndTolerance: Lesson = {
  id: 'resistor-value-and-tolerance',
  title: 'Value and tolerance',
  tagline: 'No two are quite the same',
  formula: (p) => {
    const s = solveValue(p)
    const step = (10 ** (1 / s.g.series.length) - 1) * 100
    return `${si(s.value, 'Ω', 3)} ± ${s.g.percent} % = ${si(s.lo, 'Ω', 3)} … ${si(s.hi, 'Ω', 3)} · ${s.g.seriesName}: ${s.g.series.length} values per decade, ${step.toFixed(1)} % apart`
  },
  legend: [
    { color: '#e8e8e8', label: 'Measured parts, % off the value', shape: 'dot' },
    { color: RING, label: 'Its ± tolerance window', shape: 'dot' },
    { color: GREY, label: 'Next values in the series', shape: 'dot' },
  ],
  points: [
    'No resistor is exactly its value. The tolerance is the promise: a 5 % 4.7 kΩ part measures somewhere from 4.47 to 4.94 kΩ.',
    'Here a batch is measured one by one. Most land near the middle and none outside the window, so the pile grows into a bell.',
    'The last band is the tolerance: brown 1 %, gold 5 %, silver 10 %. Precision 1 % parts are usually blue metal film with five bands: three digits, then the multiplier.',
    'Standard values are spaced to match: E12 (10 %) has 12 per decade, E24 (5 %) 24, E96 (1 %) 96. Each step is about twice the tolerance, so neighbouring windows just meet and every value is covered.',
    'A divider or an LED current is only as exact as its resistors. Use 1 % where the number matters (references, sensors), 5 % for pull-ups and LEDs.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'tol',
      options: [
        { value: '1', label: '1 % brown' },
        { value: '5', label: '5 % gold' },
        { value: '10', label: '10 % silver' },
      ],
      initial: '5',
    },
    { kind: 'slider', key: 'ohms', label: 'Value', min: 100, max: 1e6, initial: 4700, log: true, format: (v) => si(v, 'Ω', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const part = add(scene, new THREE.Group(), JIG)
    const leads = TIN()
    for (const s of [-1, 1]) rod(part, [s * 1.1 * JIG_SCALE, 0, 0], [s * LEAD_END, 0, 0], 0.11 * JIG_SCALE, leads, 16)
    const body = add(part, new THREE.Group())

    const meter = multimeter({ ohms: true })
    meter.group.scale.setScalar(METER_SCALE)
    meter.group.position.set(...METER)
    scene.add(meter.group)
    const jack = (j: V3): V3 => [METER[0] + j[0] * METER_SCALE, METER[1] + j[1] * METER_SCALE, j[2] * METER_SCALE]
    ;([[meter.red, '#d23b3b', 1], [meter.black, '#202226', -1]] as const).forEach(([j, color, s]) => {
      const tip: V3 = [JIG[0] + s * (LEAD_END - 0.6), JIG[1] - 0.3, 0.2]
      const end = probe(scene, tip, [s * 0.25, -1, 0.35], color)
      const to = jack(j)
      lead(scene, [end, [end[0], to[1] - 1.6, end[2]], [to[0], to[1] - 1.6, to[2]], to], 0.12, mat(color, { rough: 0.6 }))
    })

    const plot = scope(scene, P1_W, P1_H, { divs: [10, 4], zeroAt: 0 })
    plot.group.position.set(...P1)
    for (const u of [0.5 - 1 / (2 * SPAN), 0.5 + 1 / (2 * SPAN)]) {
      rod(plot.group, [plot.xAt(u), -P1_H / 2, 0.3], [plot.xAt(u), P1_H / 2, 0.3], 0.06, glowMat(RING, 0.5)).castShadow = false
    }
    const marks = add(plot.group, new THREE.Group())
    const pct = [-2, -1, 0, 1, 2].map((k) => {
      const d = segmentDisplay(3, 0.8, GREY, true)
      add(plot.group, d.group, [plot.xAt(devU(k)), -P1_H / 2 - 1.1, 0])
      return d
    })
    const dotMat = glowMat('#e8e8e8', 0.8)
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(DOT_R, 12, 8), dotMat, BATCH)
    dots.frustumCulled = false
    dots.castShadow = false
    dots.count = 0
    plot.group.add(dots)
    const flyer = add(scene, mesh(new THREE.SphereGeometry(DOT_R * 1.5, 16, 12), glowMat('#ffffff', 1.4)))
    flyer.castShadow = false

    const st = { key: '', k: 0, t: 0, seed: 0, landed: 0, rest: 0, measured: NaN, min: Infinity, max: -Infinity, value: 0, percent: 5 }
    const bins = new Array<number>(BINS).fill(0)
    const slot = new THREE.Vector3()
    const from = new THREE.Vector3(JIG[0], JIG[1] + 1.4, 0.5)
    const to = new THREE.Vector3()
    const m4 = new THREE.Matrix4()

    const resetBatch = () => {
      st.seed += BATCH
      st.k = 0
      st.t = 0
      st.landed = 0
      st.rest = 0
      st.min = Infinity
      st.max = -Infinity
      bins.fill(0)
      dots.count = 0
    }
    const startPart = () => {
      st.measured = batchPart(st.value, st.percent, st.seed + st.k)
      const dev = (st.measured / st.value - 1) * (100 / st.percent)
      const bin = Math.min(BINS - 1, Math.max(0, Math.floor(devU(dev) * BINS)))
      slot.set(plot.xAt((bin + 0.5) / BINS), -P1_H / 2 + 0.85 + bins[bin]++ * (2 * DOT_R + 0.04), 0.35)
      dots.setMatrixAt(st.k, m4.makeTranslation(slot))
      dots.instanceMatrix.needsUpdate = true
      to.copy(slot).add(plot.group.position)
    }
    const rebuild = (s: ReturnType<typeof solveValue>) => {
      st.value = s.value
      st.percent = s.g.percent
      emptyGroup(body)
      add(body, resistorBody(s.value, s.g.body, s.g.percent as Grade)).scale.setScalar(JIG_SCALE)
      emptyGroup(marks)
      const windows: [number, string, number][] = [[s.lower, GREY, 0.3], [s.upper, GREY, 0.3], [s.value, RING, 0.6]]
      windows.forEach(([v, color, y]) => {
        const c = (v / s.value - 1) * (100 / s.g.percent)
        const u0 = clamp01(devU(c - v / s.value))
        const u1 = clamp01(devU(c + v / s.value))
        if (u1 - u0 > 0.01) {
          const bar = add(marks, mesh(new THREE.BoxGeometry((u1 - u0) * P1_W, 0.26, 0.2), glowMat(color, 0.6)))
          bar.position.set(plot.xAt((u0 + u1) / 2), -P1_H / 2 + y, 0.3)
          bar.castShadow = false
        }
        const label = segmentDisplay(4, 0.9, color, true)
        label.set(String(+(v / unitOf(s.value)).toPrecision(3)))
        add(marks, label.group, [plot.xAt(clamp01(devU(c))), P1_H / 2 + 1, 0])
      })
      pct.forEach((d, i) => d.set(String((i - 2) * s.g.percent)))
      st.seed = 0
      resetBatch()
      startPart()
    }

    return {
      scene,
      view: { center: [-1.6, 0.8, 0], radius: 50, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveValue(p)
        const key = `${s.value}|${s.g.percent}`
        if (key !== st.key) {
          st.key = key
          rebuild(s)
        }
        if (st.k >= BATCH) {
          flyer.visible = false
          presence(body, 1)
          st.rest += dt
          if (st.rest >= REST_S) {
            resetBatch()
            startPart()
          }
          return
        }
        const slow = st.k < SLOW_PARTS
        const period = slow ? SLOW_S : FAST_S
        st.t += dt
        const f = Math.min(1, st.t / period)
        presence(body, slow ? clamp01(Math.min(f / 0.18, (1 - f) / 0.12)) : 1)
        const shown = !slow || f > 0.3
        meter.display.set(shown ? fitDigits(st.measured / unitOf(st.value), 4) : '----')
        const fly = clamp01((f - 0.5) / 0.4)
        flyer.visible = fly > 0 && fly < 1
        flyer.position.lerpVectors(from, to, fly * fly * (3 - 2 * fly))
        flyer.position.y += 3 * Math.sin(Math.PI * fly)
        if (st.t >= period) {
          const dev = (st.measured / st.value - 1) * 100
          st.min = Math.min(st.min, dev)
          st.max = Math.max(st.max, dev)
          st.landed++
          dots.count = st.landed
          st.k++
          st.t = 0
          if (st.k < BATCH) startPart()
        }
      },
      readouts: () => {
        const [lo, hi] = toleranceRange(st.value, st.percent)
        return [
          { label: 'Value', value: `${si(st.value, 'Ω', 3)} ± ${st.percent} %` },
          { label: 'Window', value: `${si(lo, 'Ω', 3)} – ${si(hi, 'Ω', 3)}`, tone: 'ok' },
          { label: 'This part', value: Number.isFinite(st.measured) ? si(st.measured, 'Ω', 4) : '—' },
          { label: `Batch ${st.landed} / ${BATCH}`, value: st.landed ? `${signed(st.min)} … ${signed(st.max)} %` : '—' },
        ]
      },
    }
  },
}

// --- Power rating: the same heat in five sizes; pick the smallest with 2× headroom, less when it's hot around it. ---

const RATING_LABEL: Record<number, string> = { 0.125: '⅛ W', 0.25: '¼ W', 0.5: '½ W', 1: '1 W', 2: '2 W' }
const AMBIENTS = ['25', '70', '100']
const P2_MAX_V = 12

const solvePower = (p: Params) => {
  const v = n(p, 'volts')
  const r = e12(p, 'r')
  const amb = AMBIENTS.includes(String(p.amb)) ? Number(p.amb) : 25
  const w = powerV2R(v, r)
  return { v, r, amb, w, pick: pickRating(w, amb) }
}

const L2 = -16.5
const X2 = -8.5
const H2 = 4
const R2_AT = (L2 + X2) / 2
const LOOP_S = 1
const ROW_X = -0.6
const ROW_Y = [5, 2.5, 0, -2.5, -5]
const ROW_S = 1
const LABEL_X = -6.6
const BAR_X = 4.6
const BAR_W = 6.6
const halfLen = (rating: number, s: number) => 1.2 * s * (RESISTOR_MM[rating][0] / RESISTOR_MM[0.25][0])
const radius = (rating: number, s: number) => 0.47 * s * (RESISTOR_MM[rating][1] / RESISTOR_MM[0.25][1])
const loadTone = (load: number) => (load > 1 ? HIGH_V : load > 0.5 ? RING : POWER)

/** A sized resistor with its own body material, so it can glow. */
function hotResistor(parent: THREE.Object3D, r: number, rating: number, scale: number) {
  const outer = add(parent, new THREE.Group())
  outer.scale.setScalar(scale)
  const part = add(outer, resistorBodyFor(r, rating))
  const material = mat('#d9c08c', { rough: 0.55 }, true)
  ;(part.children[0] as THREE.Mesh).material = material
  return material
}

const tempLook = (material: THREE.MeshStandardMaterial | null, c: number) => {
  if (!material) return
  material.color.set('#d9c08c').lerp(SCORCHED, clamp01((c - 220) / (RESISTOR_BURN_C - 220)))
  heatGlow(material, (c - 120) / (RESISTOR_BURN_C + 100 - 120))
}

export const powerRating: Lesson = {
  id: 'resistor-power-rating',
  title: 'Power rating',
  tagline: 'Big enough to shed the heat',
  formula: (p) => {
    const s = solvePower(p)
    const pick = s.pick ? RATING_LABEL[s.pick] : 'nothing ≤ 2 W'
    return `P = V² / R = (${volts(s.v)})² / ${ohms(s.r)} = ${watts(s.w)} · ×2 margin = ${watts(2 * s.w)} · at ${s.amb} °C: ${pick}`
  },
  legend: [
    { color: POWER, label: 'Load under 50 %: safe', shape: 'dot' },
    { color: RING, label: '50–100 %: runs hot', shape: 'dot' },
    { color: HIGH_V, label: 'Over its rating', shape: 'dot' },
    { color: '#ffffff', label: 'Smallest with 2× margin', shape: 'dot' },
    { color: '#e8e8e8', label: 'Power P, W', shape: 'dot' },
  ],
  points: [
    'A resistor turns P = V² / R into heat and has to shed it through its body. The power rating is how much it can shed before the inside passes ~155 °C.',
    'Rating follows size: a ⅛ W part is 3.5 mm long, ¼ W 6 mm, 2 W 15 mm. More surface sheds more heat. The bars show each one’s load.',
    'Rule of thumb: pick at least twice the power. At 100 % a part is within spec but runs ~110 °C hot, ages fast and browns the board.',
    'Ratings hold up to 70 °C around the part. Hotter, the limit falls in a straight line to zero at 155 °C: in a 100 °C motor bay a ¼ W part may take only 0.16 W.',
    'Over 2 W? Use a larger R, share the power across several resistors, or fit a ceramic power resistor (5–10 W).',
  ],
  controls: [
    { kind: 'slider', key: 'volts', label: 'Voltage', min: 0, max: P2_MAX_V, initial: 5, step: 0.5, format: volts },
    { ...resistorSlider('r', 'Resistor', 100), min: 10 },
    {
      kind: 'choice',
      key: 'amb',
      options: [
        { value: '25', label: 'Room 25 °C' },
        { value: '70', label: 'Box 70 °C' },
        { value: '100', label: 'Motor 100 °C' },
      ],
      initial: '25',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[L2, -H2, 0], [L2, H2, 0], [X2, H2, 0], [X2, -H2, 0], [L2, -H2, 0]])
    add(scene, cell(CELL_H, 1.3), [L2, 0, 0])
    const loopHolder = add(scene, new THREE.Group(), [R2_AT, H2, 0])
    const live = { f: 0, rs: 1 }
    const flow = plusFlow(
      scene,
      [[L2, -H2, LANE], [L2, H2, LANE], [X2, H2, LANE], [X2, -H2, LANE]],
      (at) => {
        if (at.x <= L2 + 0.01) return live.f * cellFraction(at.y)
        if (at.y >= H2 - 0.01) return dropAlong(at, [L2, H2, 0], [X2, H2, 0], live.f, 0, live.rs)
        return 0
      },
      true,
    )
    const pLabel = pulseLabel(scene, 4, '#e8e8e8', [R2_AT, H2 + 2.4, 0], 1.3)
    const loopFumes = smoke(scene, 3, { count: 14, rise: 6 })

    for (const [k, color] of [[0.25, POWER], [0.5, HIGH_V]] as const) {
      const x = BAR_X + k * BAR_W
      rod(scene, [x, ROW_Y[4] - 1, -0.1], [x, ROW_Y[0] + 1, -0.1], 0.07, glowMat(color, 0.5)).castShadow = false
    }
    const rows = RATINGS_W.map((rating, i) => {
      const y = ROW_Y[i]
      const holder = add(scene, new THREE.Group(), [ROW_X, y, 0])
      const label = segmentDisplay(4, 0.9, GREY, true)
      label.set(String(rating))
      add(scene, label.group, [LABEL_X, y, 0])
      box(scene, [BAR_W, 0.62, 0.3], mat('#24262c', { rough: 0.6 }), [BAR_X + BAR_W / 2, y, -0.2])
      const fillMat = glowMat(POWER, 0.8)
      const fill = add(scene, mesh(new THREE.BoxGeometry(1, 0.5, 0.42), fillMat), [BAR_X, y, 0])
      fill.castShadow = false
      const fumes = smoke(scene, 2 * halfLen(rating, ROW_S), { count: 10, rise: 4 })
      fumes.group.position.set(ROW_X, y + radius(rating, ROW_S), 0)
      return { rating, holder, fill, fillMat, fumes, body: null as THREE.MeshStandardMaterial | null, temp: 25, load: 0 }
    })
    const ring = add(scene, mesh(new THREE.TorusGeometry(1, 0.07, 8, 72), glowMat('#ffffff', 1.3)), [ROW_X, ROW_Y[1], 0.2])
    ring.castShadow = false

    const st = { r: NaN, shown: NaN as number, loopBody: null as THREE.MeshStandardMaterial | null, grow: 1, ringY: ROW_Y[1], ringA: 1, ringB: 1 }
    return {
      scene,
      view: { center: [-2.8, 1.4, 0], radius: 50, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solvePower(p)
        if (s.r !== st.r) {
          st.r = s.r
          st.shown = NaN
          for (const row of rows) {
            emptyGroup(row.holder)
            row.body = hotResistor(row.holder, s.r, row.rating, ROW_S)
            const h = halfLen(row.rating, ROW_S)
            for (const k of [-1, 1]) rod(row.holder, [k * (h - 0.1), 0, 0], [k * (h + 0.9), 0, 0], 0.12, TIN())
          }
        }
        const shown = s.pick ?? 2
        if (shown !== st.shown) {
          st.shown = shown
          emptyGroup(loopHolder)
          st.loopBody = hotResistor(loopHolder, s.r, shown, LOOP_S)
          st.grow = 0
          live.rs = halfLen(shown, LOOP_S)
        }
        st.grow += (1 - st.grow) * ease(dt, 6)
        presence(loopHolder, st.grow)

        for (const row of rows) {
          row.load = s.w / Math.max(1e-9, deratedPower(row.rating, s.amb))
          row.temp = rcStep(row.temp, hotSpotC(s.w, row.rating, s.amb), 0.8 + row.rating, dt)
          tempLook(row.body, row.temp)
          row.fumes.step(dt, clamp01((row.temp - RESISTOR_MAX_C) / 150))
          const w = Math.max(0.001, (Math.min(row.load, 2) / 2) * BAR_W)
          row.fill.scale.x = w
          row.fill.position.x = BAR_X + w / 2
          const tone = loadTone(row.load)
          row.fillMat.color.set(tone)
          row.fillMat.emissive.set(tone)
        }
        const hot = rows.find((r) => r.rating === shown)!
        tempLook(st.loopBody, hot.temp)
        loopFumes.group.position.set(R2_AT, H2 + radius(shown, LOOP_S), 0)
        loopFumes.step(dt, clamp01((hot.temp - RESISTOR_MAX_C) / 150))

        const i = RATINGS_W.indexOf(shown)
        st.ringY += (ROW_Y[i] - st.ringY) * ease(dt, 8)
        st.ringA += (halfLen(shown, ROW_S) + 1.3 - st.ringA) * ease(dt, 8)
        st.ringB += (radius(shown, ROW_S) + 0.55 - st.ringB) * ease(dt, 8)
        ring.visible = s.pick !== null
        ring.position.y = st.ringY
        ring.scale.set(st.ringA, st.ringB, 1)

        live.f = s.v / P2_MAX_V
        flow.step(dt * 8 * Math.min(s.v / s.r, 1.2))
        pLabel.show(fitDigits(s.w, 4))
        pLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solvePower(p)
        const shown = s.pick ?? 2
        const c = hotSpotC(s.w, shown, s.amb)
        return [
          { label: 'Power P = V² / R', value: watts(s.w) },
          { label: 'Pick (2× margin)', value: s.pick ? RATING_LABEL[s.pick] : 'None ≤ 2 W', tone: s.pick ? 'ok' : 'bad' },
          { label: `${RATING_LABEL[shown]} at ${s.amb} °C`, value: `max ${watts(deratedPower(shown, s.amb))}` },
          { label: 'Hot spot', value: `${Math.round(c)} °C`, tone: c > RESISTOR_MAX_C ? 'bad' : c > 110 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Pull-up and pull-down: a resistor gives a released button's pin a definite level instead of noise. ---

const VDD = 3.3
const SLOW3 = 50
const PULLS: Pull[] = ['none', 'up', 'down']
const pullOf = (p: Params): Pull => (PULLS.includes(p.pull as Pull) ? (p.pull as Pull) : 'none')

const solvePin = (p: Params) => {
  const pull = pullOf(p)
  const pressed = p.button === 'pressed'
  const r = e12(p, 'r')
  return { pull, pressed, r, ...pulledPin(pull, pressed, r, VDD) }
}

const TOP = 5.5
const BOT = -5.5
const BTN_X = -9.8
const PULL_X = -4.4
const BX = 3.2
const BS = 0.4
const BY = -5 * BS
const PIN_Z = 3.6 * BS
const SIG_X = BX - 4 * BS
const V3_X = BX + 7 * BS
const GND_X = BX + 6 * BS
const BTN_GAP = 2.6
const S3: V3 = [11.8, 0.4, 0]
const S3_W = 6.5
const S3_H = 6
const S3_TOP = 3.6
const WINDOW = 3
const SAMPLES = 240
const vy = (v: number) => (v / S3_TOP) * S3_H - S3_H / 2

export const pullUpAndPullDown: Lesson = {
  id: 'resistor-pull-up-and-pull-down',
  title: 'Pull-up and pull-down',
  tagline: 'Never leave an input floating',
  formula: (p) => {
    const s = solvePin(p)
    if (s.pull === 'none') return 'Released: nothing drives the pin, so it floats and reads noise · Pressed: 0 V, LOW'
    const rest = s.pull === 'up' ? VDD - PIN_LEAK_A * s.r : PIN_LEAK_A * s.r
    return `Released: V = ${s.pull === 'up' ? '3.3 V − ' : ''}50 nA × ${ohms(s.r)} = ${volts(rest)} · Pressed: I = 3.3 V / ${ohms(s.r)} = ${amps(VDD / s.r)}`
  },
  legend: [
    { color: '#ffffff', label: 'Pin voltage, slowed 50×', shape: 'dot' },
    { color: HIGH_V, label: 'Reads HIGH above 2.48 V', shape: 'dot' },
    { color: LOW_V, label: 'Reads LOW below 0.83 V', shape: 'dot' },
    { color: GREY, label: 'Undefined in between', shape: 'dot' },
    { color: RING, label: 'What the pin reads: 1, 0 or –', shape: 'dot' },
  ],
  points: [
    'An input pin draws almost no current (~50 nA). Connected to nothing, its voltage is whatever it picks up: mains hum, a finger, the next wire. It floats and reads random 1s and 0s.',
    'A button only connects the pin while pressed. Released, it connects nothing, so the pin still floats. The scope is slowed 50×: that wobble is 50 Hz hum.',
    'Pull-up: a resistor from the pin to 3.3 V holds it HIGH. Press the button to ground and it wins (0 Ω beats 10 kΩ): the pin reads LOW. Pressed reads 0, so code checks for LOW.',
    'Pull-down is the mirror: resistor to ground, button to 3.3 V. Released reads LOW, pressed HIGH.',
    'Choosing R: while pressed it wastes V / R (10 kΩ: 0.33 mA). Too small wastes power; much over 100 kΩ is weak against noise. The ESP32 has ~45 kΩ pulls built in: pinMode(pin, INPUT_PULLUP).',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pull',
      options: [
        { value: 'none', label: 'None' },
        { value: 'up', label: 'Pull-up' },
        { value: 'down', label: 'Pull-down' },
      ],
      initial: 'none',
    },
    {
      kind: 'choice',
      key: 'button',
      options: [
        { value: 'released', label: 'Released' },
        { value: 'pressed', label: 'Pressed' },
      ],
      initial: 'released',
    },
    { ...resistorSlider('r', 'Resistor', 10000), min: 1000, max: 1e6 },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const board = buildEsp32()
    board.scale.setScalar(BS)
    board.rotation.x = Math.PI / 2
    board.position.set(BX, BY, 0)
    scene.add(board)
    wire(scene, [[BTN_X, 0, 0], [SIG_X, 0, 0], [SIG_X, 0, PIN_Z]], 0.22)
    wire(scene, [[V3_X, 0, PIN_Z], [V3_X, 0, 0], [V3_X, TOP, 0]], 0.22)
    wire(scene, [[GND_X, 2 * BY, PIN_Z], [GND_X, 2 * BY, 0], [GND_X, BOT, 0]], 0.22)
    add(scene, groundSymbol(), [GND_X + 2.2, BOT, 0])
    wire(scene, [[GND_X, BOT, 0], [GND_X + 2.2, BOT, 0]], 0.22)
    const v3Tag = segmentDisplay(3, 0.9, HIGH_V, true)
    v3Tag.set('3.3')
    add(scene, v3Tag.group, [V3_X + 1.8, TOP, 0])

    const parts = add(scene, new THREE.Group())
    const flows = add(scene, new THREE.Group())
    const pullCol = add(scene, new THREE.Group())
    let button: ReturnType<typeof pushButton> | null = null

    const live = { f: 0, pull: 'none' as Pull, press: 0 }
    const rs = 1.2 * R_SCALE
    const paint = (at: THREE.Vector3) => {
      if (Math.abs(at.y - TOP) < 0.01 || (Math.abs(at.x - V3_X) < 0.01 && at.y > 0.01)) return 1
      if (Math.abs(at.y - BOT) < 0.01 || (Math.abs(at.x - GND_X) < 0.01 && at.y < -0.01)) return 0
      if (Math.abs(at.x - PULL_X) < 0.01 && live.pull !== 'none') {
        const rail = live.pull === 'up' ? TOP : BOT
        return dropAlong(at, [PULL_X, rail, 0], [PULL_X, 0, 0], live.pull === 'up' ? 1 : 0, live.f, rs)
      }
      if (Math.abs(at.x - BTN_X) < 0.01 && Math.abs(at.y) > 0.01) {
        const toTop = live.pull === 'down'
        const rail = toTop ? 1 : 0
        const far = toTop ? at.y > BTN_GAP / 2 + 1.6 : at.y < -(BTN_GAP / 2 + 1.6)
        return far && live.press < 0.9 ? rail : live.f
      }
      return live.f
    }
    let current: ReturnType<typeof plusFlow> | null = null
    let still: ReturnType<typeof plusFlow> | null = null
    const rHolder = new THREE.Group()

    const rebuild = (pull: Pull) => {
      live.pull = pull
      for (const g of [parts, flows, pullCol]) emptyGroup(g)
      const toTop = pull === 'down'
      const railY = toTop ? TOP : BOT
      const s = toTop ? 1 : -1
      const near = s * 1.6
      const far = s * (1.6 + BTN_GAP)
      wire(parts, [[BTN_X, 0, 0], [BTN_X, near, 0]])
      wire(parts, [[BTN_X, far, 0], [BTN_X, railY, 0], [toTop ? V3_X : GND_X, railY, 0]])
      button = pushButton(parts, [BTN_X, Math.min(near, far), 0], [BTN_X, Math.max(near, far), 0])
      if (pull === 'up') wire(parts, [[PULL_X, TOP, 0], [V3_X, TOP, 0]])
      if (pull === 'down') wire(parts, [[PULL_X, BOT, 0], [GND_X, BOT, 0]])
      if (pull === 'none') wire(parts, [[PULL_X, TOP, 0], [V3_X, TOP, 0]])
      if (pull !== 'none') {
        const rail = pull === 'up' ? TOP : BOT
        pullCol.position.set(PULL_X, rail / 2, 0)
        wire(pullCol, [[0, rail / 2, 0], [0, -rail / 2, 0]])
        pullCol.add(rHolder)
        presence(pullCol, 0.001)
      }
      const z = LANE
      const path: V3[] =
        pull === 'up'
          ? [[V3_X, 0, z], [V3_X, TOP, z], [PULL_X, TOP, z], [PULL_X, 0, z], [BTN_X, 0, z], [BTN_X, BOT, z], [GND_X, BOT, z], [GND_X, 2 * BY, z]]
          : pull === 'down'
            ? [[V3_X, 0, z], [V3_X, TOP, z], [BTN_X, TOP, z], [BTN_X, 0, z], [PULL_X, 0, z], [PULL_X, BOT, z], [GND_X, BOT, z], [GND_X, 2 * BY, z]]
            : [[V3_X, 0, z], [V3_X, TOP, z], [PULL_X, TOP, z]]
      current = plusFlow(flows, path, paint)
      still = plusFlow(flows, pull === 'none' ? [[SIG_X, 0, z], [BTN_X, 0, z], [BTN_X, BOT, z], [GND_X, BOT, z], [GND_X, 2 * BY, z]] : [[PULL_X, 0, z], [SIG_X, 0, z]], paint)
    }

    const plot = scope(scene, S3_W, S3_H, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(...S3)
    ticks(plot, [], [[0, '0'], [VDD / S3_TOP, '3.3']])
    plot.level(HIGH_V).set(vy(VIH * VDD))
    plot.level(LOW_V).set(vy(VIL * VDD))
    const bandH = vy(VIH * VDD) - vy(VIL * VDD)
    const band = add(plot.group, mesh(new THREE.BoxGeometry(S3_W, bandH, 0.05), new THREE.MeshBasicMaterial({ color: GREY, transparent: true, opacity: 0.16, depthWrite: false })))
    band.position.set(0, (vy(VIH * VDD) + vy(VIL * VDD)) / 2, 0.15)
    band.castShadow = false
    const trace = plot.trace('#ffffff', { samples: SAMPLES, radius: 0.08 })
    const history = new Float32Array(SAMPLES).fill(0)
    const readLabel = pulseLabel(scene, 1, RING, [SIG_X + 1.6, 2.6, 0], 2)

    const st = { pull: '' as Pull | '', r: NaN, simT: 0, acc: 0, v: 0, level: null as 0 | 1 | null, grow: 1 }
    const pinAt = (t: number, s: ReturnType<typeof solvePin>) => s.volts ?? floatingPickup(t / SLOW3, VDD)
    return {
      scene,
      view: { center: [1.5, 1.4, 0], radius: 53, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solvePin(p)
        if (s.pull !== st.pull) {
          st.pull = s.pull
          rebuild(s.pull)
          st.grow = 0
          st.r = NaN
        }
        if (s.r !== st.r && s.pull !== 'none') {
          st.r = s.r
          const rail = s.pull === 'up' ? TOP : BOT
          swapResistor(rHolder, s.r, [0, rail / 2, 0], [0, -rail / 2, 0])
        }
        st.grow += (1 - st.grow) * ease(dt, 6)
        if (s.pull !== 'none') presence(pullCol, st.grow)
        live.press += ((s.pressed ? 1 : 0) - live.press) * ease(dt, 14)
        button?.set(live.press)

        const step = WINDOW / SAMPLES
        st.acc += dt
        while (st.acc >= step) {
          st.acc -= step
          st.simT += step
          history.copyWithin(0, 1)
          history[SAMPLES - 1] = pinAt(st.simT, s)
        }
        st.v = pinAt(st.simT, s)
        st.level = logicLevel(st.v, VDD)
        trace.draw((u) => vy(history[Math.min(SAMPLES - 1, Math.round(u * (SAMPLES - 1)))]), 1)
        live.f = st.v / VDD
        current?.step(dt * 4000 * s.amps)
        still?.step(0)
        readLabel.show(st.level === null ? '-' : String(st.level))
        readLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solvePin(p)
        const tone = st.level === null ? 'bad' : s.volts === null ? 'warn' : 'ok'
        return [
          { label: 'Pin', value: volts(Math.round(st.v * 100) / 100), tone: s.volts === null ? 'warn' : undefined },
          { label: 'Reads', value: st.level === null ? 'Undefined' : st.level ? 'HIGH' : 'LOW', tone },
          { label: 'Through R', value: s.pull === 'none' ? '—' : amps(s.amps) },
          { label: 'Pull', value: s.pull === 'none' ? 'None' : `${ohms(s.r)} to ${s.pull === 'up' ? '3.3 V' : 'GND'}` },
        ]
      },
    }
  },
}
