// Control diagrams: block loop with signals as beads, signed term bars, s-plane screen.
import * as THREE from 'three/webgpu'
import { V3, add, cylinder } from '../../models/kit'
import { B_FIELD, DATA_COLOR, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { moduleBlock } from './diagrams'
import { addRod, stretchRod } from './layout'
import { pointCloud } from './rooms'
import { scope } from './screens'
import { lightRay } from './sensing'
import { flatBox, glowBox, stretchArrow } from './shapes'
import { addLabel, liveLabel } from './text'

/** r setpoint, e error, u command, y output, m measured, d disturbance (into the plant), n sensor noise. */
type LoopSignal = 'r' | 'e' | 'u' | 'y' | 'm' | 'd' | 'n'
const LOOP_COLORS: Record<LoopSignal, string> = { r: B_FIELD, e: HEAT, u: POWER, y: RING, m: RING, d: GREY, n: HIGH_V }

/** `w` × `h` diagram centred on `at`. Without `feedback` the sensor path is drawn cut (open loop) and Σ is skipped.
 *  `set(dt, levels, texts, titles?)`: level 0…1 per signal sets bead speed and glow (blocks light with their output); texts sit by each wire. */
export function controlLoop(
  parent: THREE.Object3D,
  at: V3,
  { ctrl = 'controller', plant = 'plant', sensor = 'sensor', feedback = true, disturb = false, noise = false, w = 11, h = 4 } = {},
) {
  const g = add(parent, new THREE.Group(), at)
  const z = 0.3
  const [yT, yB] = [h / 2 - 0.6, -h / 2 + 0.6]
  const x0 = -w / 2
  const jx = x0 + 1.5
  const lead = feedback ? 1.9 : 0.85
  const bw = (w - 4.9 - lead) / 2
  const half = bw / 2
  const cx = jx + lead + half
  const px = cx + bw + 1.8
  const sx = (cx + px) / 2
  const tx = w / 2 - 0.6
  const blocks = {
    ctrl: moduleBlock(g, [cx, yT, 0], [bw, 1.0, 0.4], ctrl),
    plant: moduleBlock(g, [px, yT, 0], [bw, 1.0, 0.4], plant),
    sensor: moduleBlock(g, [sx, yB, 0], [bw, 1.0, 0.4], sensor),
  }
  const wireM = glowMat(GREY, 0.35)
  const cutM = glowMat(GREY, 0.12)
  const rod = (a: V3, b: V3, m = wireM) => stretchRod(addRod(g, m), a, b, 0.04)
  const head = (a: V3, b: V3, m = GREY) => stretchArrow(g, m, 0.05)(a, b)
  const p = (x: number, y: number): V3 => [x, y, z]
  const jr = 0.38
  const ringM = glowMat(GREY, 0.5)
  const inX = feedback ? jx - jr : cx - half
  const paths: Record<LoopSignal, V3[][]> = {
    r: [[p(x0 + 0.5, yT), p(inX, yT)]],
    e: feedback ? [[p(jx + jr, yT), p(cx - half, yT)]] : [],
    u: [[p(cx + half, yT), p(px - half, yT)]],
    y: [[p(px + half, yT), p(w / 2, yT)], ...(feedback ? [[p(tx, yT), p(tx, yB), p(sx + half, yB)]] : [])],
    m: feedback ? [[p(sx - half, yB), p(jx, yB), p(jx, yT - jr)]] : [],
    d: disturb ? [[p(px, yT + 1.5), p(px, yT + 0.55)]] : [],
    n: noise ? [[p(sx, yB - 1.4), p(sx, yB - 0.5)]] : [],
  }
  for (const segs of Object.values(paths))
    for (const pts of segs) {
      pts.slice(1).forEach((b, i) => (i < pts.length - 2 ? rod(pts[i], b) : head(pts[i], b)))
    }
  if (feedback) {
    cylinder(g, jr, 0.12, ringM, [jx, yT, 0.1], 'z', 24).castShadow = false
    addLabel(g, 'Σ', [jx, yT, 0.25], LABEL, 0.34)
    addLabel(g, '+', [jx - jr - 0.15, yT + 0.32, z], LABEL, 0.3)
    addLabel(g, '−', [jx - 0.3, yT - jr - 0.2, z], LABEL, 0.3)
  } else {
    for (const pts of [[p(tx, yT), p(tx, yB), p(sx + half, yB)], [p(sx - half, yB), p(jx, yB), p(jx, yT - 0.6)]])
      pts.slice(1).forEach((b, i) => rod(pts[i], b, cutM))
    addLabel(g, 'no feedback', [jx + 0.2, yB + 0.45, z], GREY, 0.26, 'left')
  }
  const tagAt: Record<LoopSignal, V3> = {
    r: [x0 + 0.3, yT, z],
    e: [(jx + jr + cx - half) / 2, yT + 0.78, z],
    u: [(cx + px) / 2, yT + 0.78, z],
    y: [(px + half + w / 2) / 2, yT + 0.78, z],
    m: [(jx + sx - half) / 2, yB - 0.4, z],
    d: [px, yT + 1.75, z],
    n: [sx, yB - 1.7, z],
  }
  const tags = Object.fromEntries(
    (Object.keys(tagAt) as LoopSignal[]).map((k) => [k, liveLabel(g, tagAt[k], { size: 0.24, color: LOOP_COLORS[k], align: k === 'r' ? 'right' : 'center' })]),
  ) as Record<LoopSignal, ReturnType<typeof liveLabel>>
  const rays = (Object.keys(paths) as LoopSignal[]).flatMap((k) => paths[k].map((pts) => ({ k, pts, ray: lightRay(g, Math.max(3, Math.round(pathLen(pts) * 2.2)), 0.09, 1) })))
  const phase = new Map<LoopSignal, number>()
  return {
    group: g,
    blocks,
    set(dt: number, levels: Partial<Record<LoopSignal, number>>, texts: Partial<Record<LoopSignal, string>> = {}, titles: { ctrl?: string; plant?: string; sensor?: string } = {}) {
      const lvl = (k: LoopSignal) => Math.min(1, Math.abs(levels[k] ?? 0))
      for (const k of Object.keys(LOOP_COLORS) as LoopSignal[]) {
        phase.set(k, (phase.get(k) ?? 0) + dt * (0.15 + 1.2 * lvl(k)) / 2)
        tags[k].set(texts[k] ?? '', LOOP_COLORS[k])
      }
      for (const { k, pts, ray } of rays) ray(pts, (phase.get(k) ?? 0) / pathLen(pts) * 2, 0.15 + 1.1 * lvl(k), LOOP_COLORS[k])
      blocks.ctrl(dt, LOOP_COLORS.u, lvl('u'), titles.ctrl ?? ctrl)
      blocks.plant(dt, LOOP_COLORS.y, lvl('y'), titles.plant ?? plant)
      blocks.sensor(dt, LOOP_COLORS.m, feedback ? lvl('m') : 0, titles.sensor ?? sensor)
      if (feedback) setGlow(ringM, LOOP_COLORS.e, 0.3 + lvl('e'))
    },
  }
}

const pathLen = (pts: V3[]) => pts.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1], b[2] - pts[i][2]), 0)

export const PID_COLORS = { p: HEAT, i: DATA_COLOR, d: FORCE, u: POWER }
export const MEAS_COLOR = LABEL

/** Signed terms and their sum (last row) as bars from a centre zero, ±100 % across `w`; the sum turns red when clipped; `texts` replace the % labels. */
export function sumBars(parent: THREE.Object3D, at: V3, rows: readonly { label: string; color: string }[], w = 7, satText = ' clipped') {
  const last = rows.length - 1
  const bars = rows.map(({ label, color }, j) => {
    const y = at[1] - j * 0.62
    flatBox(parent, [w, 0.34, 0.05], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [at[0], y, 0])
    addLabel(parent, label, [at[0] - w / 2 - 0.3, y, 0.2], color, 0.3, 'right')
    const m = glowMat(color, 0.9)
    const fill = flatBox(parent, [1, 0.26, 0.08], m, [at[0], y, 0.06])
    const value = liveLabel(parent, [at[0] + w / 2 + 0.3, y, 0.2], { size: 0.26, align: 'left' })
    return { color, m, fill, value }
  })
  flatBox(parent, [0.06, last * 0.62 + 0.74, 0.06], glowMat(GREY, 0.4), [at[0], at[1] - last * 0.31, 0.12])
  return {
    set(values: readonly number[], sat = false, texts?: readonly string[]) {
      bars.forEach((r, j) => {
        const v = values[j] ?? 0
        const len = Math.max(1e-3, (Math.min(1, Math.abs(v)) * w) / 2)
        r.fill.scale.x = len
        r.fill.position.x = at[0] + (Math.sign(v) * len) / 2
        const sum = j === last
        const hot = sum ? sat : Math.abs(v) > 1
        setGlow(r.m, hot && sum ? HIGH_V : r.color, 0.9)
        r.value.set(texts?.[j] ?? `${Math.round(v * 100) < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %${hot && sum ? satText : ''}`, hot ? HIGH_V : r.color)
      })
    },
  }
}

/** P, I, D and u = P + I + D as `sumBars`. */
export function termBars(parent: THREE.Object3D, at: V3, w = 7) {
  const bars = sumBars(parent, at, (['p', 'i', 'd', 'u'] as const).map((k) => ({ label: k === 'u' ? 'u' : k.toUpperCase(), color: PID_COLORS[k] })), w)
  return { set: (t: { p: number; i: number; d: number; u: number }, sat = false) => bars.set([t.p, t.i, t.d, t.u], sat) }
}

/** s-plane screen centred at `at`, equal axes at `per` 1/s per scene unit, grid every 5/s (keep the span a multiple of 10 on Im, odd
 *  multiple of 5 on Re). Right half tinted red; `poles(list)` places up to 6 crosses, returns how many fell off-screen; `locus(pts)` dots. */
export function sPlane(parent: THREE.Object3D, at: V3, per: number, reMin: number, reMax: number, imMax: number) {
  const [w, h] = [(reMax - reMin) / per, (2 * imMax) / per]
  const plot = scope(parent, w, h, { divs: [Math.round((reMax - reMin) / 5), Math.round((2 * imMax) / 5)], zeroAt: 0.5 })
  plot.group.position.set(...at)
  const re0 = -reMin
  const g = plot.group
  const x0 = -w / 2 + re0 / per
  const xy = (re: number, im: number): [number, number, boolean] => {
    const [x, y] = [x0 + re / per, im / per]
    const cx = Math.min(w / 2, Math.max(-w / 2, x))
    const cy = Math.min(h / 2, Math.max(-h / 2, y))
    return [cx, cy, cx === x && cy === y]
  }
  glowBox(g, [w / 2 - x0, h, 0.02], [(x0 + w / 2) / 2, 0, 0.05], HIGH_V, 0.16)
  flatBox(g, [0.07, h, 0.05], glowMat(HIGH_V, 0.7), [x0, 0, 0.2])
  addLabel(g, 'jω', [x0 - 0.3, h / 2 - 0.35, 0.3], GREY, 0.28, 'right')
  addLabel(g, 'σ', [w / 2 - 0.3, 0.3, 0.3], GREY, 0.28, 'right')
  addLabel(g, 'unstable', [(x0 + w / 2) / 2, -h / 2 + 0.35, 0.3], HIGH_V, 0.24)
  const crosses = Array.from({ length: 6 }, () => {
    const m = glowMat(RING, 1.1)
    const c = add(g, new THREE.Group())
    for (const r of [1, -1]) flatBox(c, [0.62, 0.13, 0.1], m, [0, 0, 0.3]).rotation.z = (r * Math.PI) / 4
    return { c, m }
  })
  const dots = pointCloud(g, 400, 0.05)
  return {
    group: g,
    w,
    h,
    xy,
    poles(list: readonly { re: number; im: number }[], color: (k: number) => string = () => RING) {
      let off = 0
      crosses.forEach(({ c, m }, k) => {
        const p = list[k]
        const [x, y, inside] = p ? xy(p.re, p.im) : [0, 0, false]
        c.visible = inside
        if (p && !inside) off++
        if (!inside) return
        c.position.set(x, y, 0)
        setGlow(m, color(k), 1.1)
      })
      return off
    },
    locus(pts: readonly { re: number; im: number }[], color: string) {
      let n = 0
      for (const p of pts) {
        const [x, y, inside] = xy(p.re, p.im)
        if (inside && n < 400) dots.set(n++, [x, y, 0.22], color)
      }
      dots.show(n)
    },
  }
}
