// LED puzzles: pick the resistor for one LED, two LEDs on one supply, a brightness target.
import { LEDS, LED_LEAK_OHMS, LED_MAX_A, LED_RATED_A, Led, diodeAmps, diodeNode, diodeVolts, fitDiode } from '../semiconductors'
import { puzzleVerdict, targetWindow, windowMiss } from './verdict'

export const LED_PUZZLE = {
  /** Visibly lit … rated. */
  loA: 0.005,
  hiA: LED_RATED_A,
  maxA: LED_MAX_A,
  /** ¼ W resistor, run at ≤ half its rating. */
  ratingW: 0.25,
  derate: 0.5,
  /** Below this across R, Vf drift swamps the current. */
  minHeadroomV: 0.3,
  /** Two LEDs look equal within this current ratio. */
  match: 1.25,
  /** Same-colour LEDs from one bag differ by ~50 mV. */
  batchV: 0.05,
  /** Worst case: Vf ±0.1 V, R ±5 %. */
  spreadV: 0.1,
  rTol: 0.05,
  /** The eye barely sees ±20 % current. */
  brightTol: 0.2,
}
const P = LED_PUZZLE
const EPS = 1e-6

export type LedColour = keyof typeof LEDS

/** A colour's LED with its Vf shifted by `dv` (same ideality). */
export function ledPart(c: LedColour, dv = 0): Led {
  const d = LEDS[c]
  return dv === 0 ? d : { ...d, ...fitDiode(d.vf + dv, d.ideality), vf: d.vf + dv }
}

/** One LED through `ohms` from `vs`: current, LED voltage, resistor heat. */
export function ledLoopAt(vs: number, ohms: number, d: Led) {
  const s = diodeNode(vs, ohms, d, { load: LED_LEAK_OHMS })
  return { amps: s.sourceA, vf: s.v, rW: s.sourceA * s.sourceA * ohms }
}

const heatOk = (w: number) => ({ ok: w <= P.ratingW * P.derate, near: w <= P.ratingW })
const overOk = (a: number) => ({ ok: a <= P.hiA * (1 + EPS), near: a <= P.maxA })
const dimOk = (a: number) => ({ ok: a >= P.loA * (1 - EPS), near: windowMiss(a, P.loA, P.hiA).miss < 0.3 })

// --- Safe LED current ---

export type SafeLedFail = 'headroom' | 'over' | 'dim' | 'heat'

export function safeLed(c: LedColour, vs: number, ohms: number) {
  const d = LEDS[c]
  const r = ledLoopAt(vs, ohms, d)
  const headroomV = vs - d.vf
  const verdict = puzzleVerdict<SafeLedFail>([
    { id: 'headroom', ok: headroomV >= P.minHeadroomV },
    { id: 'over', ...overOk(r.amps) },
    { id: 'dim', ...dimOk(r.amps) },
    { id: 'heat', ...heatOk(r.rW) },
  ])
  return { ...r, headroomV, rMin: headroomV / P.hiA, burnt: r.amps > P.maxA, verdict }
}

// --- Two LEDs, one supply ---

export const LED_WIRINGS = {
  series: { name: 'Series, one R' },
  shared: { name: 'Parallel, one R' },
  own: { name: 'Parallel, R each' },
}
export type LedWiring = keyof typeof LED_WIRINGS

export const LED_PAIRS = {
  reds: { name: 'Two reds', colours: ['red', 'red'] as [LedColour, LedColour] },
  mixed: { name: 'Red + green', colours: ['red', 'green'] as [LedColour, LedColour] },
  whites: { name: 'Two whites', colours: ['white', 'white'] as [LedColour, LedColour] },
}
export type LedPair = keyof typeof LED_PAIRS

/** The pair's two parts; a same-colour pair's second LED has a `batchV` higher Vf. */
export function pairParts(pair: LedPair): [Led, Led] {
  const [a, b] = LED_PAIRS[pair].colours
  return [ledPart(a), ledPart(b, a === b ? P.batchV : 0)]
}

const bisect = (f: (x: number) => number, lo: number, hi: number) => {
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2
    if (f(m) > 0) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}
const branchA = (v: number, d: Led) => diodeAmps(v, d) + v / LED_LEAK_OHMS

/** Both LEDs from `vs`: series string through `r1`, parallel sharing `r1`, or parallel with `r1`, `r2` each. */
export function ledPairAt(wiring: LedWiring, [a, b]: [Led, Led], vs: number, r1: number, r2: number) {
  if (wiring === 'series') {
    const i = bisect((x) => vs - x * r1 - diodeVolts(x, a) - diodeVolts(x, b), 0, vs / r1)
    return { amps: [i, i], vf: [diodeVolts(i, a), diodeVolts(i, b)], supplyA: i, rW: [i * i * r1] }
  }
  if (wiring === 'shared') {
    const v = bisect((x) => (vs - x) / r1 - branchA(x, a) - branchA(x, b), 0, vs)
    const i = (vs - v) / r1
    return { amps: [branchA(v, a), branchA(v, b)], vf: [v, v], supplyA: i, rW: [i * i * r1] }
  }
  const [s1, s2] = [ledLoopAt(vs, r1, a), ledLoopAt(vs, r2, b)]
  return { amps: [s1.amps, s2.amps], vf: [s1.vf, s2.vf], supplyA: s1.amps + s2.amps, rW: [s1.rW, s2.rW] }
}

export type TwoLedFail = 'headroom' | 'over' | 'dim' | 'match' | 'heat'

export function twoLeds(wiring: LedWiring, pair: LedPair, vs: number, r1: number, r2: number) {
  const parts = pairParts(pair)
  const r = ledPairAt(wiring, parts, vs, r1, r2)
  const needV = wiring === 'series' ? parts[0].vf + parts[1].vf : Math.max(parts[0].vf, parts[1].vf)
  const hiA = Math.max(...r.amps)
  const loA = Math.min(...r.amps)
  const ratio = hiA / Math.max(loA, 1e-12)
  const verdict = puzzleVerdict<TwoLedFail>([
    { id: 'headroom', ok: vs - needV >= P.minHeadroomV },
    { id: 'over', ...overOk(hiA) },
    { id: 'dim', ...dimOk(loA) },
    { id: 'match', ok: ratio <= P.match, near: ratio <= 1.5 },
    { id: 'heat', ...heatOk(Math.max(...r.rW)) },
  ])
  return { ...r, needV, ratio, dimmer: r.amps[0] < r.amps[1] ? 0 : 1, share: hiA / (r.amps[0] + r.amps[1]), verdict }
}

// --- Brightness target ---

export const LED_TARGETS = {
  indicator: { name: 'Red, 5 mA', colour: 'red' as LedColour, amps: 0.005 },
  panel: { name: 'Green, 10 mA', colour: 'green' as LedColour, amps: 0.01 },
  torch: { name: 'White, 18 mA', colour: 'white' as LedColour, amps: 0.018 },
}
export type LedTarget = keyof typeof LED_TARGETS

export type BrightFail = 'low' | 'high' | 'spread' | 'heat'

/** Hit the target current within ±`brightTol`; `worst` also needs every R ±5 %, Vf ±0.1 V corner inside. */
export function brightnessTarget(target: LedTarget, vs: number, ohms: number, worst: boolean) {
  const t = LED_TARGETS[target]
  const r = ledLoopAt(vs, ohms, LEDS[t.colour])
  const lo = ledLoopAt(vs, ohms * (1 + P.rTol), ledPart(t.colour, P.spreadV)).amps
  const hi = ledLoopAt(vs, ohms * (1 - P.rTol), ledPart(t.colour, -P.spreadV)).amps
  const window = targetWindow(t.amps, P.brightTol)
  const now = windowMiss(r.amps, ...window)
  const spreadMiss = Math.max(windowMiss(lo, ...window).miss, windowMiss(hi, ...window).miss)
  const verdict = puzzleVerdict<BrightFail>([
    { id: 'low', ok: now.side >= 0, near: now.miss < 0.15 },
    { id: 'high', ok: now.side <= 0, near: now.miss < 0.15 },
    { id: 'spread', ok: !worst || spreadMiss < EPS, near: spreadMiss < 0.15 },
    { id: 'heat', ...heatOk(r.rW) },
  ])
  const vfAt = diodeVolts(t.amps, LEDS[t.colour])
  return { ...r, lo, hi, window, ratio: r.amps / t.amps, rIdeal: (vs - vfAt) / t.amps, headroomV: vs - vfAt, verdict }
}
