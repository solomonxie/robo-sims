// Circuit challenges: goal + verdict header, target-window gauge, rail-and-rows schematic bench.
import * as THREE from 'three/webgpu'
import { PuzzleVerdict } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { cell, ledLamp, swapResistor } from './circuit'
import { GREY, INK, LABEL, POWER, glowMat, setGlow, verdictTint } from './colors'
import { multimeter } from './displays'
import { plusFlow } from './flows'
import { CELL_H, LANE, RS, cableRun, wire } from './layout'
import { flatBox } from './shapes'
import { liveLabel } from './text'
import { clamp01 } from './util'

/** Verdict → tint: pass green, close miss yellow, fail red. */
export const puzzleTint = (v: PuzzleVerdict) => verdictTint(v.pass, v.near)
const BADGE = (v: PuzzleVerdict) => (v.pass ? 'PASS' : v.near ? 'CLOSE' : 'FAIL')

/** Top-left: goal line, a tinted PASS / CLOSE / FAIL badge and the reason beside it. */
export function puzzleHeader(scene: THREE.Object3D, at: V3 = [-17, 6.6, 0.3]) {
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

/** Caption height above a `windowGauge` centre. */
export const GAUGE_CAPTION_Y = 2.05

export interface GaugeOpts {
  min: number
  max: number
  log?: boolean
  /** Target window [lo, hi], green band. */
  window: [number, number]
  /** Extra marks [value, text, colour]. */
  marks?: [number, string, string][]
  caption: string
  ticks: [number, string][]
}

/** Horizontal gauge centred at `at`, `w` long: green target window, needle + value label, optional spread bar.
 *  `set(v, text, colour, spread?)`; `setWindow(lo, hi)` moves the band. */
export function windowGauge(parent: THREE.Object3D, at: V3, w: number, o: GaugeOpts) {
  const g = add(parent, new THREE.Group(), at)
  const u = (v: number) => {
    const f = o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min)
    return (clamp01(Number.isFinite(f) ? f : 0) - 0.5) * w
  }
  flatBox(g, [w + 0.3, 0.7, 0.06], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [0, 0, 0])
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
  if (o.caption) liveLabel(g, [-w / 2, GAUGE_CAPTION_Y, 0.2], { size: 0.3, align: 'left' }).set(o.caption, LABEL)
  const value = liveLabel(g, [0, 1.25, 0.2], { size: 0.34 })
  const setWindow = (lo: number, hi: number) => {
    const [a, b] = [u(lo), u(hi)]
    band.scale.x = Math.max(0.01, b - a)
    band.position.x = (a + b) / 2
  }
  setWindow(...o.window)
  return {
    group: g,
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

export type BenchPart = { kind: 'R' } | { kind: 'LED'; color: string }

export interface BenchOpts {
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
  const resistors = o.rows.map((r, i) =>
    r.parts.map((p, k) => (p.kind === 'R' ? { holder: add(g, new THREE.Group()), at: slots[i][k], shown: NaN } : null)),
  )
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
  const feedHolder = o.feed ? add(g, new THREE.Group()) : null
  let feedShown = NaN

  const meter = o.meter ? multimeter() : null
  if (meter) {
    const k = 0.42
    const mx = o.xb + 2.6
    add(g, meter.group, [mx, meterY + 1.2, -0.4]).scale.setScalar(k)
    const jack = (j: V3): V3 => [mx + j[0] * k, meterY + 1.2 + j[1] * k, -0.4 + j[2] * k]
    cableRun(g, [[o.xb, mTop, 0], [o.xb + 0.9, mTop, 0.3], jack(meter.red)], '#d23b3b', 0.12)
    cableRun(g, [jack(meter.black), [o.xb + 0.9, mBot, 0.3], [o.xb, mBot, 0]], '#202226', 0.12)
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
    setOhms(i: number, k: number, ohms: number) {
      const r = resistors[i][k]
      if (!r || r.shown === ohms) return
      r.shown = ohms
      swapResistor(r.holder, ohms, [r.at - 1, o.rows[i].y, 0], [r.at + 1, o.rows[i].y, 0])
    },
    setFeed(ohms: number) {
      if (!feedHolder || feedShown === ohms) return
      feedShown = ohms
      swapResistor(feedHolder, ohms, [o.xa, fy + 1, 0], [o.xa, fy - 1, 0])
    },
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
