// Control block diagram: setpoint → Σ → controller → plant → output, sensor feedback into Σ; signals ride the wires as beads.
import * as THREE from 'three/webgpu'
import { V3, add, cylinder } from '../../models/kit'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { moduleBlock } from './diagrams'
import { addRod, stretchRod } from './layout'
import { lightRay } from './sensing'
import { stretchArrow } from './shapes'
import { addLabel, liveLabel } from './text'

/** r setpoint, e error, u command, y output, m measured, d disturbance (into the plant), n sensor noise. */
export type LoopSignal = 'r' | 'e' | 'u' | 'y' | 'm' | 'd' | 'n'
export const LOOP_COLORS: Record<LoopSignal, string> = { r: B_FIELD, e: HEAT, u: POWER, y: RING, m: RING, d: GREY, n: HIGH_V }

/** `w` × `h` diagram centred on `at`. Without `feedback` the sensor path is drawn cut (open loop) and Σ is skipped.
 *  `set(dt, levels, texts)`: level 0…1 per signal sets bead speed and glow (blocks light with their output); texts sit by each wire. */
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
    set(dt: number, levels: Partial<Record<LoopSignal, number>>, texts: Partial<Record<LoopSignal, string>> = {}) {
      for (const k of Object.keys(LOOP_COLORS) as LoopSignal[]) {
        const v = Math.min(1, Math.abs(levels[k] ?? 0))
        phase.set(k, (phase.get(k) ?? 0) + dt * (0.15 + 1.2 * v) / 2)
        tags[k].set(texts[k] ?? '', LOOP_COLORS[k])
      }
      for (const { k, pts, ray } of rays) ray(pts, (phase.get(k) ?? 0) / pathLen(pts) * 2, 0.15 + 1.1 * Math.min(1, Math.abs(levels[k] ?? 0)), LOOP_COLORS[k])
      const lvl = (k: LoopSignal) => Math.min(1, Math.abs(levels[k] ?? 0))
      blocks.ctrl(dt, LOOP_COLORS.u, lvl('u'))
      blocks.plant(dt, LOOP_COLORS.y, lvl('y'))
      blocks.sensor(dt, LOOP_COLORS.m, feedback ? lvl('m') : 0)
      if (feedback) setGlow(ringM, LOOP_COLORS.e, 0.3 + lvl('e'))
    },
  }
}

const pathLen = (pts: V3[]) => pts.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1], b[2] - pts[i][2]), 0)
