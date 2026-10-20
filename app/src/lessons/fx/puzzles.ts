// Circuit challenges: goal + verdict header, target-window gauge, rail-and-rows and divider schematic benches, battery pack bench.
import * as THREE from 'three/webgpu'
import { ChemistryId, PuzzleVerdict } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { fixedText, ohms as ohmsText, pct } from '../../core/units'
import { cellPackModel } from './cells'
import { ceramicAlong, cell, junction, ledLamp, resistorSlot, swapResistor } from './circuit'
import { GREY, HIGH_V, INK, LABEL, POWER, RING, glowMat, setGlow, verdictTint } from './colors'
import { multimeter } from './displays'
import { plusFlow } from './flows'
import { CELL_H, LANE, RS, cableRun, wire } from './layout'
import { flatBox } from './shapes'
import { liveLabel } from './text'
import { clamp01, emptyGroup } from './util'

/** Verdict → tint: pass green, close miss yellow, fail red. */
export const puzzleTint = (v: PuzzleVerdict) => verdictTint(v.pass, v.near)
const BADGE = (v: PuzzleVerdict) => (v.pass ? 'PASS' : v.near ? 'CLOSE' : 'FAIL')

/** Top-left: goal line, a tinted PASS / CLOSE / FAIL badge and the reason beside it. */
function puzzleHeader(scene: THREE.Object3D, at: V3 = [-17, 6.6, 0.3]) {
  const goal = liveLabel(scene, at, { size: 0.42, align: 'left' })
  const plate = glowMat(POWER, 0.8)
  flatBox(scene, [2.9, 0.9, 0.08], plate, [at[0] + 1.45, at[1] - 1.15, 0.1])
  const badge = liveLabel(scene, [at[0] + 1.45, at[1] - 1.15, 0.3], { size: 0.44, glow: 0.2 })
  const reason = liveLabel(scene, [at[0] + 3.3, at[1] - 1.15, 0.3], { size: 0.3, align: 'left' })
  const hint = liveLabel(scene, [at[0], at[1] - 2.1, 0.3], { size: 0.28, align: 'left', color: GREY })
  return {
    set(goalText: string, v: PuzzleVerdict, why: string, hintText = '') {
      const c = puzzleTint(v)
      goal.set(`Goal: ${goalText}`, LABEL)
      setGlow(plate, c, 0.8)
      badge.set(BADGE(v), INK)
      reason.set(why, c)
      hint.set(hintText, GREY)
    },
  }
}

/** Span-40 stage with a `puzzleHeader`. */
export function puzzleStage() {
  const scene = createStage({ span: 40 })
  return { scene, header: puzzleHeader(scene) }
}

/** Legend: pass / close miss / fail dots (`fail` wording per lesson). */
export const verdictLegend = (fail: string, pass = 'Target window / pass', close = 'Close miss') => [
  { color: POWER, label: pass, shape: 'dot' as const },
  { color: RING, label: close, shape: 'dot' as const },
  { color: HIGH_V, label: fail, shape: 'dot' as const },
]

const CAPTION_Y = 2.05
const trackMat = () => new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 })
const RED_LEAD = '#d23b3b'
const BLACK_LEAD = '#202226'

/** A `multimeter` scaled by `k` at (mx, my), pushed back 0.4; `jack(j)` = a jack in `g` coordinates. */
function benchMeter(g: THREE.Object3D, mx: number, my: number, k: number) {
  const meter = multimeter()
  add(g, meter.group, [mx, my, -0.4]).scale.setScalar(k)
  const jack = (j: V3): V3 => [mx + j[0] * k, my + j[1] * k, -0.4 + j[2] * k]
  return { meter, jack }
}

interface GaugeOpts {
  min: number
  max: number
  log?: boolean
  /** Target window [lo, hi], green band. */
  window: [number, number]
  /** Extra marks [value, text, colour]. */
  marks?: [number, string, string][]
  /** Fixed caption; or set `caption` on the returned gauge. */
  caption?: string
  ticks: [number, string][]
}

/** Horizontal gauge centred at `at`, `w` long: green target window, needle + value label, optional spread bar, caption above.
 *  `set(v, text, colour, spread?)`; `setWindow(lo, hi)` moves the band; `caption` is a live label. */
export function windowGauge(parent: THREE.Object3D, at: V3, w: number, o: GaugeOpts) {
  const g = add(parent, new THREE.Group(), at)
  const u = (v: number) => {
    const f = o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min)
    return (clamp01(Number.isFinite(f) ? f : 0) - 0.5) * w
  }
  flatBox(g, [w + 0.3, 0.7, 0.06], trackMat(), [0, 0, 0])
  const band = flatBox(g, [1, 0.7, 0.08], glowMat(POWER, 0.35), [0, 0, 0.04])
  const spread = flatBox(g, [1, 0.24, 0.1], glowMat(LABEL, 0.6), [0, 0, 0.1])
  spread.visible = false
  const needleMat = glowMat(POWER, 1.1)
  const needle = flatBox(g, [0.16, 1.4, 0.14], needleMat, [0, 0, 0.14])
  for (const [v, text] of o.ticks) {
    flatBox(g, [0.05, 0.25, 0.08], glowMat(GREY, 0.3), [u(v), -0.5, 0.04])
    liveLabel(g, [u(v), -0.95, 0.2], { size: 0.26 }).set(text, GREY)
  }
  for (const [v, text, c] of o.marks ?? []) {
    flatBox(g, [0.1, 1.0, 0.1], glowMat(c, 0.6), [u(v), 0, 0.08])
    liveLabel(g, [u(v), 0.72, 0.2], { size: 0.22 }).set(text, c)
  }
  const caption = liveLabel(g, [-w / 2, CAPTION_Y, 0.2], { size: 0.3, align: 'left' })
  if (o.caption) caption.set(o.caption, LABEL)
  const value = liveLabel(g, [0, 1.25, 0.2], { size: 0.34 })
  const setWindow = (lo: number, hi: number) => {
    const [a, b] = [u(lo), u(hi)]
    band.scale.x = Math.max(0.01, b - a)
    band.position.x = (a + b) / 2
  }
  setWindow(...o.window)
  return {
    group: g,
    caption,
    setWindow,
    set(v: number, text: string, color: string, sp?: [number, number]) {
      needle.position.x = u(v)
      setGlow(needleMat, color, 1.1)
      value.group.position.x = Math.max(-w / 2 + 1, Math.min(w / 2 - 1, u(v)))
      value.set(text, color)
      spread.visible = !!sp
      if (sp) {
        const [a, b] = [u(sp[0]), u(sp[1])]
        spread.scale.x = Math.max(0.05, b - a)
        spread.position.x = (a + b) / 2
      }
    },
  }
}

/** The right-hand gauge column: x, width, row centres top to bottom. */
const COLUMN = { x: 8, w: 7.6, y: [1.4, -3, -7.4] }

/** `windowGauge` in row `row` of the right-hand column. */
export const columnGauge = (scene: THREE.Object3D, row: number, o: GaugeOpts) => windowGauge(scene, [COLUMN.x, COLUMN.y[row], 0], COLUMN.w, o)

type BenchPart = { kind: 'R' } | { kind: 'LED'; color: string }

interface BenchOpts {
  /** Cell x; left and right rails. */
  x0: number
  xa: number
  xb: number
  top: number
  bottom: number
  /** Row y and its parts, left (+) to right; `at` = part centres as fractions of the row (default even). */
  rows: { y: number; parts: BenchPart[]; at?: number[] }[]
  /** Resistor down the left rail, shared by every row. */
  feed?: boolean
  /** Inline ammeter in the right rail, below the last row. */
  meter?: boolean
  vmax: number
  ledScale?: number
}

/** Rail-and-rows schematic: cell (+ up) at x0, top wire to the left rail, optional feed R down it, rows to the right rail,
 *  right rail down (through an ammeter) and home along the bottom; + charges by potential.
 *  `setOhms(row, k, Ω)` / `setFeed(Ω)` swap resistors; `set(vs, vFeed, rowNodes)` = node potentials (V) after each part;
 *  `step(dt, rowAmps, supplyA)` moves charges; `leds[row][k]` are `ledLamp`s. */
export function railBench(parent: THREE.Object3D, o: BenchOpts) {
  const g = add(parent, new THREE.Group())
  const ls = o.ledScale ?? 1.4
  const leg = ls / 2
  const cy = (o.top + o.bottom) / 2
  const low = Math.min(...o.rows.map((r) => r.y))
  const high = Math.max(...o.rows.map((r) => r.y))
  const fy = (o.top + high) / 2
  const live = { vs: 0, feed: 0, nodes: o.rows.map((r) => r.parts.map(() => 0)) }
  const f = (v: number) => clamp01(v / o.vmax)

  add(g, cell(CELL_H, 1.5), [o.x0, cy, 0])
  wire(g, [[o.x0, o.bottom, 0], [o.x0, o.top, 0], [o.xa, o.top, 0], [o.xa, low, 0]])
  const meterY = (low + o.bottom) / 2
  const mTop = meterY + 1.3
  const mBot = meterY - 1.3
  if (o.meter) {
    wire(g, [[o.xb, high, 0], [o.xb, mTop, 0]])
    wire(g, [[o.xb, mBot, 0], [o.xb, o.bottom, 0], [o.x0, o.bottom, 0]])
  } else wire(g, [[o.xb, high, 0], [o.xb, o.bottom, 0], [o.x0, o.bottom, 0]])

  const span = (p: BenchPart) => (p.kind === 'R' ? RS : leg)
  const slots = o.rows.map((r) => r.parts.map((_, k) => o.xa + (r.at?.[k] ?? (k + 0.5) / r.parts.length) * (o.xb - o.xa)))
  const resistors = o.rows.map((r, i) => r.parts.map((p, k) => (p.kind === 'R' ? resistorSlot(g, [slots[i][k] - 1, r.y, 0], [slots[i][k] + 1, r.y, 0]) : null)))
  const leds = o.rows.map((r, i) =>
    r.parts.flatMap((p, k) => (p.kind === 'LED' ? [ledLamp(g, p.color, [slots[i][k], r.y, 0], { scale: ls, anodeRight: false })] : [])),
  )
  o.rows.forEach((r, i) => {
    let x = o.xa
    r.parts.forEach((p, k) => {
      if (p.kind !== 'LED') return
      wire(g, [[x, r.y, 0], [slots[i][k] - leg, r.y, 0]])
      x = slots[i][k] + leg
    })
    wire(g, [[x, r.y, 0], [o.xb, r.y, 0]])
  })
  const feed = o.feed ? resistorSlot(g, [o.xa, fy + 1, 0], [o.xa, fy - 1, 0]) : null

  let meter: ReturnType<typeof multimeter> | null = null
  if (o.meter) {
    const m = benchMeter(g, o.xb + 2.6, meterY + 1.2, 0.42)
    meter = m.meter
    cableRun(g, [[o.xb, mTop, 0], [o.xb + 0.9, mTop, 0.3], m.jack(meter.red)], RED_LEAD, 0.12)
    cableRun(g, [m.jack(meter.black), [o.xb + 0.9, mBot, 0.3], [o.xb, mBot, 0]], BLACK_LEAD, 0.12)
  }

  // Potential along a row: rail level, then a linear drop across each part.
  const rowPaint = (i: number) => (at: THREE.Vector3) => {
    let v = o.feed ? live.feed : live.vs
    const r = o.rows[i]
    for (let k = 0; k < r.parts.length; k++) {
      const h = span(r.parts[k])
      const a = slots[i][k] - h
      if (at.x < a) return f(v)
      const next = live.nodes[i][k]
      if (at.x < a + 2 * h) return f(v + ((next - v) * (at.x - a)) / (2 * h))
      v = next
    }
    return f(v)
  }
  const feedFlow = plusFlow(g, [[o.x0, o.bottom, LANE], [o.x0, o.top, LANE], [o.xa, o.top, LANE], [o.xa, low, LANE]], (at) => {
    if (at.x < o.x0 + 0.01) return f(live.vs) * clamp01((at.y - cy + CELL_H / 2) / CELL_H)
    if (!o.feed || at.y > fy + RS) return f(live.vs)
    if (at.y < fy - RS) return f(live.feed)
    return f(live.feed + ((live.vs - live.feed) * (at.y - fy + RS)) / (2 * RS))
  })
  const rowFlows = o.rows.map((r, i) => plusFlow(g, [[o.xa, r.y, LANE], [o.xb, r.y, LANE]], rowPaint(i)))
  const back = plusFlow(g, [[o.xb, high, LANE], [o.xb, o.bottom, LANE], [o.x0, o.bottom, LANE]], () => 0)

  return {
    group: g,
    leds,
    meter,
    setOhms: (i: number, k: number, ohms: number) => resistors[i][k]?.(ohms),
    setFeed: (ohms: number) => feed?.(ohms),
    set(vs: number, vFeed: number, rowNodes: number[][]) {
      live.vs = vs
      live.feed = vFeed
      live.nodes = rowNodes
    },
    step(dt: number, rowAmps: number[], supplyA: number) {
      const k = (a: number) => dt * 120 * Math.min(a, 0.06)
      feedFlow.step(k(supplyA))
      back.step(k(supplyA))
      rowFlows.forEach((fl, i) => fl.step(k(rowAmps[i])))
      leds.forEach((row) => row.forEach((l) => l.step(dt)))
    },
  }
}

interface DividerBenchOpts {
  /** Cell x, divider column x, load column x. */
  x0: number
  xd: number
  xt: number
  top: number
  tap: number
  bottom: number
  vmax: number
  /** Cell height (default CELL_H). */
  cellH?: number
  /** Current that moves the charges at full speed. */
  fullA: number
}

/** Divider schematic: cell (+ up) at x0, R1 / R2 down the column at xd, the tap out to a load column at xt (R, C or open)
 *  and a voltmeter across the load; + charges by potential, R1 / R2 tagged with their values.
 *  `setR1`/`setR2(Ω)`, `setLoad({ kind: 'R', ohms } | { kind: 'C' } | null)`, `set(vs, vTap)`, `step(dt, a1, a2, aLoad)`. */
export function dividerBench(parent: THREE.Object3D, o: DividerBenchOpts) {
  const g = add(parent, new THREE.Group())
  const ch = o.cellH ?? CELL_H
  const cy = (o.top + o.bottom) / 2
  const y1 = (o.top + o.tap) / 2
  const y2 = (o.tap + o.bottom) / 2
  const live = { vs: 0, tap: 0, load: false }
  const f = (v: number) => clamp01(v / o.vmax)
  const drop = (y: number, yc: number, hi: number, lo: number) =>
    y > yc + RS ? hi : y < yc - RS ? lo : lo + ((hi - lo) * (y - yc + RS)) / (2 * RS)

  add(g, cell(ch, 1.5), [o.x0, cy, 0])
  wire(g, [[o.x0, o.bottom, 0], [o.x0, o.top, 0], [o.xd, o.top, 0], [o.xd, o.bottom, 0], [o.x0, o.bottom, 0]])
  wire(g, [[o.xd, o.tap, 0], [o.xt, o.tap, 0]])
  wire(g, [[o.xd, o.bottom, 0], [o.xt, o.bottom, 0]])
  const tapDot = junction(g, [o.xd, o.tap, 0], 0.45)
  junction(g, [o.xd, o.bottom, 0], 0.35).set(0)
  const rs = [y1, y2].map((y) => resistorSlot(g, [o.xd, y + 1, 0], [o.xd, y - 1, 0]))
  const loadHolder = add(g, new THREE.Group())
  const tags = [y1, y2].map((y) => liveLabel(g, [o.xd - 1.4, y, 0.3], { size: 0.34, align: 'right' }))
  let loadKey = ''

  const mx = o.xt + 2.8
  const { meter, jack } = benchMeter(g, mx, o.tap - 3.4, 0.42)
  const [red, black] = [jack(meter.red), jack(meter.black)]
  const side = mx + 2.4
  cableRun(g, [[o.xt, o.tap, 0], [side, o.tap, 0.3], [side, red[1] - 0.9, 0.3], [red[0], red[1] - 0.9, 0.3], red], RED_LEAD, 0.12)
  cableRun(g, [black, [black[0], o.bottom + 0.6, 0.3], [o.xt + 0.6, o.bottom, 0.2], [o.xt, o.bottom, 0]], BLACK_LEAD, 0.12)

  const columnV = (y: number) => (y > o.tap ? drop(y, y1, live.vs, live.tap) : drop(y, y2, live.tap, 0))
  const feed = plusFlow(g, [[o.x0, o.bottom, LANE], [o.x0, o.top, LANE], [o.xd, o.top, LANE], [o.xd, o.tap, LANE]], (at) =>
    at.x < o.x0 + 0.01 ? f(live.vs) * clamp01((at.y - cy + ch / 2) / ch) : at.y > o.top - 0.01 ? f(live.vs) : f(columnV(at.y)),
  )
  const down = plusFlow(g, [[o.xd, o.tap, LANE], [o.xd, o.bottom, LANE], [o.x0, o.bottom, LANE]], (at) => (at.y > o.bottom + 0.01 ? f(columnV(at.y)) : 0))
  const loadFlow = plusFlow(g, [[o.xd, o.tap, LANE], [o.xt, o.tap, LANE], [o.xt, o.bottom, LANE], [o.xd, o.bottom, LANE]], (at) =>
    at.y > o.tap - 0.01 ? f(live.tap) : at.y < o.bottom + 0.01 ? 0 : live.load ? f(drop(at.y, y2, live.tap, 0)) : f(live.tap),
  )

  const setR = (i: number, r: number) => {
    if (rs[i](r)) tags[i].set(`R${i + 1} ${ohmsText(r)}`, LABEL)
  }
  return {
    group: g,
    meter,
    setR1: (r: number) => setR(0, r),
    setR2: (r: number) => setR(1, r),
    setLoad(load: { kind: 'R'; ohms: number } | { kind: 'C' } | null) {
      const key = load ? (load.kind === 'R' ? `R${load.ohms}` : 'C') : ''
      if (key === loadKey) return
      loadKey = key
      emptyGroup(loadHolder)
      live.load = !!load
      if (load?.kind === 'R') swapResistor(loadHolder, load.ohms, [o.xt, y2 + 1, 0], [o.xt, y2 - 1, 0])
      if (load?.kind === 'C') ceramicAlong(loadHolder, [o.xt, y2 + 1.2, 0], [o.xt, y2 - 1.2, 0], 1.3)
      if (load) {
        wire(loadHolder, [[o.xt, o.tap, 0], [o.xt, y2 + (load.kind === 'R' ? RS : 1.2), 0]])
        wire(loadHolder, [[o.xt, y2 - (load.kind === 'R' ? RS : 1.2), 0], [o.xt, o.bottom, 0]])
      }
    },
    set(vs: number, vTap: number) {
      live.vs = vs
      live.tap = vTap
      tapDot.set(f(vTap))
    },
    step(dt: number, a1: number, a2: number, aLoad: number) {
      const s = (a: number) => dt * 2.4 * Math.min(a / o.fullA, 2.5)
      feed.step(s(a1))
      down.step(s(a2))
      loadFlow.step(s(aLoad))
    },
  }
}

/** Cell wrap per chemistry: Li-ion blue, LiFePO4 purple, NiMH green, alkaline black. */
const CELL_WRAP: Record<ChemistryId, string> = { liion: '#2856c8', lfp: '#7a4bc4', nimh: '#2f8f5a', alkaline: '#34302c' }

interface PackBenchOpts {
  /** Centre of the pack box, its width and height. */
  at: V3
  w: number
  h: number
}

/** Battery bench: an S×P pack (`CELL_WRAP` tint) fitted into w × h at `at`, tilted to show parallel rows; title above,
 *  charge bar below, a multimeter (DC volts) on the right wired to + / −. `setPack(chem, series, parallel, title)` rebuilds
 *  on change; `set(volts, soc, colour)` updates the meter and the bar. */
export function packBench(parent: THREE.Object3D, o: PackBenchOpts) {
  const g = add(parent, new THREE.Group(), o.at)
  const holder = add(g, new THREE.Group())
  const title = liveLabel(g, [0, o.h / 2 + 1, 0.3], { size: 0.36 })
  const barY = -o.h / 2 - 0.9
  flatBox(g, [o.w, 0.5, 0.06], trackMat(), [0, barY, 0])
  const fillMat = glowMat(POWER, 0.8)
  const fill = flatBox(g, [1, 0.36, 0.08], fillMat, [0, barY, 0.05])
  const socTag = liveLabel(g, [o.w / 2 + 0.3, barY, 0.2], { size: 0.28, align: 'left' })
  const { meter, jack } = benchMeter(g, o.w / 2 + 2.6, 0.9, 0.36)
  let key = ''
  return {
    group: g,
    meter,
    setPack(chem: ChemistryId, series: number, parallel: number, text: string) {
      title.set(text, LABEL)
      const next = `${chem}|${series}|${parallel}`
      if (next === key) return
      key = next
      emptyGroup(holder)
      const [dx, dz] = [2.3, 2.6]
      const pk = cellPackModel(holder, series, parallel, { r: 1, dx, dz, wrap: CELL_WRAP[chem] })
      const [rx, ry] = [0.28, parallel > 1 ? 0.5 : 0.12]
      const wide = (series - 1) * dx + 2
      const deep = (parallel - 1) * dz + 2
      const s = Math.min(o.w / (wide * Math.cos(ry) + deep * Math.sin(ry)), o.h / (pk.h * Math.cos(rx) + deep * Math.sin(rx)))
      pk.group.rotation.set(rx, ry, 0)
      pk.group.scale.setScalar(s)
      const front = (deep / 2) * s + 0.4
      const end = (v: V3, edge: number, side: number, color: string, to: V3) => {
        const p = new THREE.Vector3(...v).applyEuler(pk.group.rotation).multiplyScalar(s)
        const y = Math.sign(p.y || 1) * (o.h / 2 + 0.25 + 0.3 * edge)
        const x = o.w / 2 + 0.5 + 0.35 * edge
        cableRun(holder, [[p.x, p.y, p.z], [p.x, y, front], [x, y, front], [x, to[1] - 0.7 - 0.3 * side, front], [to[0], to[1] - 0.7 - 0.3 * side, to[2]], to], color, 0.1)
      }
      end(pk.plus, 0, 0, RED_LEAD, jack(meter.red))
      end(pk.minus, 1, 1, BLACK_LEAD, jack(meter.black))
    },
    set(volts: number, soc: number, color: string) {
      meter.display.set(fixedText(volts, volts < 9.995 ? 2 : 1))
      const f = clamp01(soc)
      fill.scale.x = Math.max(0.01, f * o.w)
      fill.position.x = -o.w / 2 + (f * o.w) / 2
      setGlow(fillMat, color, 0.8)
      socTag.set(pct(f), color)
    },
  }
}
