import * as THREE from 'three/webgpu'
import {
  LEDS,
  LED_PAIRS,
  LED_PUZZLE,
  LED_TARGETS,
  LED_WIRINGS,
  LedColour,
  LedPair,
  LedTarget,
  LedWiring,
  brightnessTarget,
  pairParts,
  safeLed,
  twoLeds,
  windowMiss,
} from '../../core/physics'
import { E12, E24 } from '../../core/resistorColors'
import { fixedText, ohms, pct, si, tiny, volts } from '../../core/units'
import { V3 } from '../../models/kit'
import {
  FACE_VIEW,
  GREY,
  HIGH_V,
  LABEL,
  emptyGroup,
  ease,
  ledLamp,
  liveLabel,
  memoBy,
  puzzleStage,
  puzzleTint,
  railBench,
  verdictLegend,
  verdictTint,
  windowGauge,
} from '../fx'
import { Lesson, Params, Stage, namesOf, opts, pick, seriesOhms, seriesSlider, toneOf, verdictReadout } from '../types'

// --- Shared bench: cell, rails, rows, ammeter in the right rail; gauges on the right. ---

const BENCH = { x0: -15.5, xa: -12, xb: -1.5, top: 3.2, bottom: -9.2, ledScale: 1.15 }
const ROW_Y = -3.6
const ROWS_Y = [-1.6, -6.2]
const ROWS_AT = { own: [[0.25, 0.55], [0.25, 0.85]], shared: [[0.45], [0.8]] }
const GX: V3 = [8, 0.6, 0]
const GX2: V3 = [8, -5, 0]
const GW = 7.6
const P = LED_PUZZLE
const mA = (a: number) => si(tiny(a, 1e-7), 'A', 3)
const meterText = (a: number) => fixedText(a * 1000, a < 0.01 ? 2 : 1)
const COLOUR_NAMES = Object.fromEntries((Object.keys(LEDS) as LedColour[]).map((c) => [c, c[0].toUpperCase() + c.slice(1)])) as Record<LedColour, string>
const supplyOf = (p: Params, list: string[], d: string) => Number(list.includes(String(p.vs)) ? p.vs : d)
const supplyChoice = (list: string[], initial: string) => ({ kind: 'choice' as const, key: 'vs', options: list.map((v) => ({ value: v, label: `${v} V` })), initial })

const currentGauge = (scene: THREE.Object3D, at: V3, caption: string, window: [number, number]) =>
  windowGauge(scene, at, GW, {
    min: 0.001,
    max: 0.05,
    log: true,
    window,
    caption,
    marks: [[P.maxA, 'max', HIGH_V]],
    ticks: [[0.001, '1'], [0.002, '2'], [0.005, '5'], [0.01, '10'], [0.02, '20'], [0.05, '50 mA']],
  })
const heatGauge = (scene: THREE.Object3D, at: V3) =>
  windowGauge(scene, at, GW, {
    min: 0,
    max: 0.5,
    window: [0, P.ratingW * P.derate],
    caption: 'R heat (≤ half of ¼ W)',
    marks: [[P.ratingW, '¼ W', HIGH_V]],
    ticks: [[0, '0'], [0.125, '0.125'], [0.25, '0.25'], [0.5, '0.5 W']],
  })
const heatTint = (w: number) => verdictTint(w <= P.ratingW * P.derate, w <= P.ratingW)
const ampTint = (a: number) => verdictTint(a >= P.loA * 0.999999 && a <= P.hiA * 1.000001, a <= P.maxA)
const VERDICTS = verdictLegend('Fail / absolute limit')

// --- Safe LED current: one LED, one resistor, keep the current in 5–20 mA and the resistor cool. ---

const SUPPLIES1 = ['3.3', '5', '9', '12']
const slParams = (p: Params) => ({
  c: pick(COLOUR_NAMES, p.color, 'red') as LedColour,
  vs: supplyOf(p, SUPPLIES1, '5'),
  r: seriesOhms(p, 'r', E12),
})
const slSolve = memoBy((q: ReturnType<typeof slParams>) => `${q.c}|${q.vs}|${q.r}`, (q: ReturnType<typeof slParams>) => safeLed(q.c, q.vs, q.r))

export const ledPuzzlesSafeLedCurrent: Lesson = {
  id: 'led-puzzles-safe-led-current',
  title: 'Safe LED current',
  tagline: 'Pick the E12 resistor that lights the LED between 5 and 20 mA without cooking the resistor',
  formula: (p) => {
    const q = slParams(p)
    const s = slSolve(q)
    return `I = (Vs − Vf) / R = (${volts(q.vs)} − ${volts(s.vf)}) / ${ohms(q.r)} = ${mA(s.amps)} · P_R = I²R = ${si(tiny(s.rW, 1e-6), 'W', 2)} · goal 5–20 mA, P_R ≤ 0.125 W`
  },
  legend: [...VERDICTS, { color: LABEL, label: 'Ammeter in series: mA', shape: 'dot' }],
  points: [
    'The puzzle: light the LED at 5–20 mA (visible … rated) from the supply you’re given, with a standard E12 resistor, and keep the ¼ W resistor under half its rating so it stays cool.',
    'Work it out first: R = (Vs − Vf) / I (Components › LED › Current-limiting resistor). Vf comes from the colour: red 2.0 V, yellow 2.2 V, green 3.0 V, blue 3.1 V, white 3.2 V (Components › LED › Forward voltage and colour).',
    'Then round to a real part. E12 has 12 values per decade (10, 12, 15 … 82); round up for safety, down for brightness, and check the result still lands in the window.',
    'Higher supplies push more of the power into the resistor: P = I²R = I·(Vs − Vf). Red at 12 V and 18 mA is safe for the LED but heats a ¼ W resistor to 0.18 W, hot to touch (Components › Resistor › Power rating).',
    'Some puzzles have no answer: blue or white on 3.3 V leaves under 0.3 V across the resistor, so a 0.1 V shift in Vf swings the current by a third. Use a higher supply (or a constant-current driver).',
  ],
  controls: [
    { kind: 'choice', key: 'color', options: opts(COLOUR_NAMES), initial: 'red' },
    supplyChoice(SUPPLIES1, '5'),
    seriesSlider('r', 'Resistor (E12)', E12, 10, 2200, 100),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const holder = new THREE.Group()
    scene.add(holder)
    let bench: ReturnType<typeof railBench> | null = null
    const iG = currentGauge(scene, GX, 'LED current', [P.loA, P.hiA])
    const wG = heatGauge(scene, GX2)
    const st = { c: '', vs: 5, burnt: false }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = slParams(p)
        if (q.c !== st.c) {
          st.c = q.c
          st.burnt = false
          emptyGroup(holder)
          bench = railBench(holder, { ...BENCH, rows: [{ y: ROW_Y, parts: [{ kind: 'R' }, { kind: 'LED', color: LEDS[q.c].color }] }], meter: true, vmax: 12 })
        }
        const s = slSolve(q)
        st.vs += (q.vs - st.vs) * ease(dt, 6)
        const lamp = bench!.leds[0][0]
        if (s.burnt !== st.burnt) {
          st.burnt = s.burnt
          lamp.burn(s.burnt)
        }
        const amps = s.burnt ? 0 : s.amps
        bench!.setOhms(0, 0, q.r)
        bench!.set(st.vs, st.vs, [[st.vs - amps * q.r, 0]])
        lamp.set(amps / P.hiA)
        bench!.step(dt, [amps], amps)
        bench!.meter?.display.set(meterText(amps))
        iG.set(Math.max(s.amps, 0.001), mA(s.amps), ampTint(s.amps))
        wG.set(s.rW, si(tiny(s.rW, 1e-6), 'W', 2), heatTint(s.rW))
        const v = s.verdict
        const why = {
          headroom: `${volts(q.vs)} is only ${volts(Math.max(0, s.headroomV))} above its ${volts(LEDS[q.c].vf)} Vf: Vf drift swamps any R. Pick a higher supply`,
          over: `${mA(s.amps)} is over the 20 mA rating${s.burnt ? ', past 30 mA it burns' : ''}. Use a bigger R`,
          dim: `${mA(s.amps)} is too dim (under 5 mA). Use a smaller R`,
          heat: `R heats ${si(s.rW, 'W', 2)}, over half its ¼ W rating. Use a bigger R`,
        }
        header.set(
          `light the ${COLOUR_NAMES[q.c].toLowerCase()} LED at 5–20 mA from ${volts(q.vs)}`,
          v,
          v.fail ? why[v.fail] : `${mA(s.amps)} is in 5–20 mA, R warms ${si(tiny(s.rW, 1e-6), 'W', 2)}: wire it`,
          'Hint: R = (Vs − Vf) / I, then pick a real E12 value',
        )
      },
      readouts: (p) => {
        const q = slParams(p)
        const s = slSolve(q)
        return [
          { label: 'LED current', value: s.burnt ? 'Burnt out' : mA(s.amps), tone: toneOf(s.amps >= P.loA * 0.999999 && s.amps <= P.hiA * 1.000001, !s.burnt) },
          { label: 'Across R', value: volts(q.vs - s.vf) },
          { label: 'Resistor heat', value: si(tiny(s.rW, 1e-6), 'W', 2), tone: toneOf(s.rW <= P.ratingW * P.derate, s.rW <= P.ratingW) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- Two LEDs, one supply: series, parallel on one resistor, or a resistor each. ---

const SUPPLIES2 = ['3.3', '5', '9']
const WIRING_NAMES = namesOf(LED_WIRINGS)
const PAIR_NAMES = namesOf(LED_PAIRS)
const tlParams = (p: Params) => ({
  wiring: pick(WIRING_NAMES, p.wiring, 'shared') as LedWiring,
  pair: pick(PAIR_NAMES, p.pair, 'reds') as LedPair,
  vs: supplyOf(p, SUPPLIES2, '5'),
  r1: seriesOhms(p, 'r1', E12),
  r2: seriesOhms(p, 'r2', E12),
})
type TlQ = ReturnType<typeof tlParams>
const tlSolve = memoBy((q: TlQ) => `${q.wiring}|${q.pair}|${q.vs}|${q.r1}|${q.r2}`, (q: TlQ) => twoLeds(q.wiring, q.pair, q.vs, q.r1, q.r2))
const ledName = (pair: LedPair, k: number) => `LED ${k + 1} (${LED_PAIRS[pair].colours[k]})`

export const ledPuzzlesTwoLedsOneSupply: Lesson = {
  id: 'led-puzzles-two-leds-one-supply',
  title: 'Two LEDs, one supply',
  tagline: 'Light two LEDs equally from one supply: series, parallel on one resistor, or a resistor each',
  formula: (p) => {
    const q = tlParams(p)
    const s = tlSolve(q)
    const [a, b] = pairParts(q.pair)
    if (q.wiring === 'series') return `I = (Vs − Vf1 − Vf2) / R1 = (${volts(q.vs)} − ${volts(s.vf[0])} − ${volts(s.vf[1])}) / ${ohms(q.r1)} = ${mA(s.amps[0])} through both`
    if (q.wiring === 'shared') return `node = ${volts(s.vf[0])}: I = (${volts(q.vs)} − ${volts(s.vf[0])}) / ${ohms(q.r1)} = ${mA(s.supplyA)} splits ${mA(s.amps[0])} + ${mA(s.amps[1])} (Vf ${fixedText(a.vf, 2)} vs ${fixedText(b.vf, 2)} V at 20 mA)`
    return `I1 = (${volts(q.vs)} − ${volts(s.vf[0])}) / ${ohms(q.r1)} = ${mA(s.amps[0])} · I2 = (${volts(q.vs)} − ${volts(s.vf[1])}) / ${ohms(q.r2)} = ${mA(s.amps[1])} · ratio ${fixedText(s.ratio, 2)} (≤ 1.25)`
  },
  legend: [...VERDICTS, { color: LABEL, label: 'Ammeter: total supply mA', shape: 'dot' }],
  points: [
    'The puzzle: both LEDs at 5–20 mA and within 25 % of each other, so they look equally bright, from one supply. R2 only counts when each LED has its own resistor.',
    'Series: one current flows through both, so they match by construction. But the supply must cover both drops plus some for the resistor: two reds need over 4.3 V, two whites over 6.7 V (Electricity › Series & parallel).',
    'Parallel on one resistor is the classic mistake. Two reds from the same bag differ by ~50 mV, and an LED’s current grows ×e every n·Vt ≈ 52 mV, so one takes ~2.6× the other’s current (Components › Diode › Forward drop).',
    'Mix colours on one resistor and it’s worse: red clamps the shared node near 2 V, so green (3 V) never lights.',
    'A resistor each fixes both: each LED sets its own current, R = (Vs − Vf) / I. With different colours pick different values so the currents match.',
  ],
  controls: [
    { kind: 'choice', key: 'wiring', options: opts(WIRING_NAMES), initial: 'shared' },
    { kind: 'choice', key: 'pair', options: opts(PAIR_NAMES), initial: 'reds' },
    supplyChoice(SUPPLIES2, '5'),
    seriesSlider('r1', 'R1 (E12)', E12, 10, 2200, 150),
    seriesSlider('r2', 'R2, own wiring (E12)', E12, 10, 2200, 150),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const holder = new THREE.Group()
    scene.add(holder)
    let bench: ReturnType<typeof railBench> | null = null
    const gauges = [GX, GX2].map((at) => currentGauge(scene, at, '', [P.loA, P.hiA]))
    const st = { key: '', vs: 5 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = tlParams(p)
        const [ca, cb] = LED_PAIRS[q.pair].colours.map((c) => LEDS[c].color)
        const key = `${q.wiring}|${q.pair}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(holder)
          const rows =
            q.wiring === 'series'
              ? [{ y: ROW_Y, parts: [{ kind: 'R' as const }, { kind: 'LED' as const, color: ca }, { kind: 'LED' as const, color: cb }] }]
              : [ca, cb].map((color, k) => ({
                  y: ROWS_Y[k],
                  at: ROWS_AT[q.wiring as 'own' | 'shared'][k],
                  parts: q.wiring === 'own' ? [{ kind: 'R' as const }, { kind: 'LED' as const, color }] : [{ kind: 'LED' as const, color }],
                }))
          bench = railBench(holder, { ...BENCH, rows, feed: q.wiring === 'shared', meter: true, vmax: 9, ledScale: q.wiring === 'series' ? 1.15 : 0.95 })
          gauges.forEach((g, k) => g.caption.set(ledName(q.pair, k), LABEL))
        }
        const s = tlSolve(q)
        st.vs += (q.vs - st.vs) * ease(dt, 6)
        const b = bench!
        const lamps = b.leds.flat()
        if (q.wiring === 'series') {
          const v1 = st.vs - s.amps[0] * q.r1
          b.setOhms(0, 0, q.r1)
          b.set(st.vs, st.vs, [[v1, v1 - s.vf[0], 0]])
          b.step(dt, [s.amps[0]], s.supplyA)
        } else if (q.wiring === 'shared') {
          b.setFeed(q.r1)
          b.set(st.vs, Math.min(st.vs, s.vf[0]), [[0], [0]])
          b.step(dt, s.amps, s.supplyA)
        } else {
          b.setOhms(0, 0, q.r1)
          b.setOhms(1, 0, q.r2)
          b.set(st.vs, st.vs, [[st.vs - s.amps[0] * q.r1, 0], [st.vs - s.amps[1] * q.r2, 0]])
          b.step(dt, s.amps, s.supplyA)
        }
        lamps.forEach((l, k) => l.set(s.amps[k] / P.hiA))
        b.meter?.display.set(meterText(s.supplyA))
        gauges.forEach((g, k) => g.set(Math.max(s.amps[k], 0.001), mA(s.amps[k]), ampTint(s.amps[k])))
        const v = s.verdict
        const hot = s.amps[0] >= s.amps[1] ? 0 : 1
        const dim = s.dimmer
        const why = {
          headroom:
            q.wiring === 'series'
              ? `In series they need ${volts(s.needV)} + 0.3 V for R: ${volts(q.vs)} can’t light them. More volts, or parallel`
              : `${volts(q.vs)} leaves under 0.3 V across R above ${volts(s.needV)}: Vf drift swamps it. More volts`,
          over: `${ledName(q.pair, hot)} takes ${mA(s.amps[hot])}, over 20 mA. Bigger R`,
          dim:
            q.wiring === 'shared' && s.amps[dim] < 1e-4
              ? `${ledName(q.pair, dim)} stays dark: the other clamps the shared node at ${volts(s.vf[0])}`
              : `${ledName(q.pair, dim)} gets only ${mA(s.amps[dim])}: too dim. Smaller R`,
          match:
            q.wiring === 'shared'
              ? `${ledName(q.pair, hot)} hogs ${pct(s.share)} of the current: ${Math.round(P.batchV * 1000)} mV less Vf. Give each LED its own R`
              : `${fixedText(s.ratio, 2)}× apart, they won’t look equal. Tune R1 and R2 to match within 25 %`,
          heat: `A resistor heats ${si(Math.max(...s.rW), 'W', 2)}, over half its ¼ W rating. Bigger R`,
        }
        header.set(
          `light both LEDs at 5–20 mA, within 25 % of each other, from ${volts(q.vs)}`,
          v,
          v.fail ? why[v.fail] : q.wiring === 'series' ? `${mA(s.amps[0])} through both: one current, matched by design` : `${mA(s.amps[0])} and ${mA(s.amps[1])}: matched within 25 %`,
          q.wiring === 'own' ? 'R1 feeds LED 1, R2 feeds LED 2' : 'R2 is unused in this wiring',
        )
      },
      readouts: (p) => {
        const q = tlParams(p)
        const s = tlSolve(q)
        const ok = (a: number) => toneOf(a >= P.loA * 0.999999 && a <= P.hiA * 1.000001, a <= P.maxA && a >= 1e-4)
        return [
          { label: 'LED 1', value: mA(s.amps[0]), tone: ok(s.amps[0]) },
          { label: 'LED 2', value: mA(s.amps[1]), tone: ok(s.amps[1]) },
          { label: 'Ratio', value: s.amps[0] < 1e-6 || s.amps[1] < 1e-6 ? 'one is dark' : `${fixedText(s.ratio, 2)}×`, tone: toneOf(s.ratio <= P.match, s.ratio <= 1.5) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- Brightness target: hit a current within ±20 %, then make it hold for every part in the bag. ---

const SUPPLIES3 = ['3.3', '5', '9']
const TARGET_NAMES = namesOf(LED_TARGETS)
const CHECKS = { typical: 'Typical part', worst: 'Worst case: R ±5 %, Vf ±0.1 V' }
const btParams = (p: Params) => ({
  t: pick(TARGET_NAMES, p.target, 'panel') as LedTarget,
  vs: supplyOf(p, SUPPLIES3, '3.3'),
  r: seriesOhms(p, 'r', E24),
  worst: pick(CHECKS, p.check, 'typical') === 'worst',
})
type BtQ = ReturnType<typeof btParams>
const btSolve = memoBy((q: BtQ) => `${q.t}|${q.vs}|${q.r}|${q.worst}`, (q: BtQ) => brightnessTarget(q.t, q.vs, q.r, q.worst))
const REF_AT: V3 = [6, -8.6, 0]
const YOURS_AT: V3 = [10, -8.6, 0]

export const ledPuzzlesBrightnessTarget: Lesson = {
  id: 'led-puzzles-brightness-target',
  title: 'Brightness target',
  tagline: 'Hit a target LED current within ±20 % with an E24 resistor, then make it hold for every part in the bag',
  formula: (p) => {
    const q = btParams(p)
    const b = btSolve(q)
    const t = LED_TARGETS[q.t]
    const spread = q.worst ? ` · worst case ${mA(b.lo)} … ${mA(b.hi)}` : ''
    return `I = (${volts(q.vs)} − ${volts(b.vf)}) / ${ohms(q.r)} = ${mA(b.amps)} vs target ${mA(t.amps)} ± 20 % (${mA(b.window[0])} … ${mA(b.window[1])})${spread}`
  },
  legend: [...verdictLegend('Fail', 'Target ±20 % / pass'), { color: LABEL, label: 'Worst-case spread (bar)', shape: 'dot' }],
  points: [
    'The puzzle: make the LED glow like the target beside it, within ±20 % of its current. Light output follows current, and the eye barely notices 20 % (it judges brightness on a log scale).',
    'R = (Vs − Vf) / I_target, then pick the nearest E24 value: 24 per decade, steps of ~10 %, so one always lands within ±5 % (Components › Resistor › Value and tolerance).',
    'Now switch to worst case. Real parts drift: a 5 % resistor can be 5 % off, and LEDs from one bag differ by ~0.1 V. The design passes only if every corner still lands in the window.',
    'Headroom is what makes a design robust. The current error from Vf is ΔVf / (Vs − Vf): 0.1 V of 2 V across R is 5 %, but 0.1 V of 0.3 V is 33 %. Green or white on 3.3 V can hit the target on paper and still fail on the bench.',
    'Fix it with more supply volts (a bigger R takes up the rest) or a constant-current driver. LEDs are current devices; the resistor turns a voltage into a current (Electricity › Ohm’s law).',
  ],
  controls: [
    { kind: 'choice', key: 'target', options: opts(TARGET_NAMES), initial: 'panel' },
    supplyChoice(SUPPLIES3, '3.3'),
    seriesSlider('r', 'Resistor (E24)', E24, 4.7, 2200, 22),
    { kind: 'choice', key: 'check', options: opts(CHECKS), initial: 'typical' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const holder = new THREE.Group()
    scene.add(holder)
    let bench: ReturnType<typeof railBench> | null = null
    let ref: ReturnType<typeof ledLamp> | null = null
    let yours: ReturnType<typeof ledLamp> | null = null
    const iG = windowGauge(scene, GX, GW, {
      min: 0.5,
      max: 2,
      log: true,
      window: [1 - P.brightTol, 1 + P.brightTol],
      caption: 'LED current ÷ target (±20 %)',
      ticks: [[0.5, '½×'], [0.8, '0.8'], [1, '1'], [1.2, '1.2'], [2, '2×']],
    })
    const refTag = liveLabel(scene, [REF_AT[0], REF_AT[1] - 0.7, 0.2], { size: 0.28 })
    const yoursTag = liveLabel(scene, [YOURS_AT[0], YOURS_AT[1] - 0.7, 0.2], { size: 0.28 })
    const compare = liveLabel(scene, [GX[0] - GW / 2, -1.3, 0.2], { size: 0.3, align: 'left' })
    const st = { t: '', vs: 3.3 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = btParams(p)
        const t = LED_TARGETS[q.t]
        const color = LEDS[t.colour].color
        const b = btSolve(q)
        if (q.t !== st.t) {
          st.t = q.t
          emptyGroup(holder)
          bench = railBench(holder, { ...BENCH, rows: [{ y: ROW_Y, parts: [{ kind: 'R' }, { kind: 'LED', color }] }], meter: true, vmax: 9 })
          ref = ledLamp(holder, color, REF_AT, { scale: 0.75 })
          yours = ledLamp(holder, color, YOURS_AT, { scale: 0.75 })
          refTag.set(`target ${mA(t.amps)}`, GREY)
        }
        st.vs += (q.vs - st.vs) * ease(dt, 6)
        bench!.setOhms(0, 0, q.r)
        bench!.set(st.vs, st.vs, [[st.vs - b.amps * q.r, 0]])
        bench!.leds[0][0].set(b.amps / P.hiA)
        bench!.step(dt, [b.amps], b.amps)
        bench!.meter?.display.set(meterText(b.amps))
        ref!.set(t.amps / P.hiA)
        yours!.set(b.amps / P.hiA)
        ref!.step(dt)
        yours!.step(dt)
        const v = b.verdict
        const miss = windowMiss(b.amps, ...b.window)
        const nowTint = verdictTint(miss.side === 0, miss.miss < 0.15)
        iG.set(b.ratio, mA(b.amps), nowTint, q.worst ? [b.lo / t.amps, b.hi / t.amps] : undefined)
        yoursTag.set(`yours ${mA(b.amps)}`, nowTint)
        compare.set(q.worst ? `every part: ${mA(b.lo)} … ${mA(b.hi)}` : `${b.ratio >= 1 ? '+' : '−'}${pct(Math.abs(b.ratio - 1))} vs target`, puzzleTint(v))
        const why = {
          low: `${mA(b.amps)} is ${pct(1 - b.ratio)} under the target: too dim. Use a smaller R`,
          high: `${mA(b.amps)} is ${pct(b.ratio - 1)} over the target: too bright. Use a bigger R`,
          spread: `Parts swing it ${mA(b.lo)} … ${mA(b.hi)}: only ${volts(Math.max(0, b.headroomV))} across R. More supply volts`,
          heat: `R heats ${si(b.rW, 'W', 2)}, over half its ¼ W rating. Bigger R`,
        }
        header.set(
          `make the ${t.colour} LED glow at ${mA(t.amps)} ± 20 % from ${volts(q.vs)}${q.worst ? ', for every part' : ''}`,
          v,
          v.fail ? why[v.fail] : q.worst ? `every corner lands in ${mA(b.window[0])} … ${mA(b.window[1])}: robust` : `${mA(b.amps)}: the eye can’t tell it from the target. Now try worst case`,
          'Hint: R = (Vs − Vf) / I_target, nearest E24',
        )
      },
      readouts: (p) => {
        const q = btParams(p)
        const b = btSolve(q)
        return [
          { label: 'LED current', value: mA(b.amps), tone: toneOf(b.amps >= b.window[0] && b.amps <= b.window[1], Math.abs(b.ratio - 1) < 0.35) },
          { label: 'Across R', value: volts(q.vs - b.vf), tone: toneOf(b.headroomV >= 1, b.headroomV >= 0.3) },
          { label: 'Worst case', value: `${mA(b.lo)} … ${mA(b.hi)}`, tone: q.worst ? toneOf(b.lo >= b.window[0] * 0.999999 && b.hi <= b.window[1] * 1.000001, true) : undefined },
          verdictReadout(b.verdict),
        ]
      },
    }
  },
}
