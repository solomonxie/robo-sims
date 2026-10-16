// Control block diagram: setpoint → Σ → controller → plant → output, sensor feedback into Σ; signals ride the wires as beads.
// PID: the gearmotor arm rig and P/I/D/u term bars.
import * as THREE from 'three/webgpu'
import { DEG } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, STEEL } from '../../models/kit'
import { Helix } from '../../models/power'
import { B_FIELD, DATA_COLOR, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { moduleBlock } from './diagrams'
import { addRod, stretchRod } from './layout'
import { pointCloud } from './rooms'
import { lightRay } from './sensing'
import { flatBox, stretchArrow } from './shapes'
import { addLabel, liveLabel } from './text'
import { glide } from './util'

/** r setpoint, e error, u command, y output, m measured, d disturbance (into the plant), n sensor noise. */
export type LoopSignal = 'r' | 'e' | 'u' | 'y' | 'm' | 'd' | 'n'
export const LOOP_COLORS: Record<LoopSignal, string> = { r: B_FIELD, e: HEAT, u: POWER, y: RING, m: RING, d: GREY, n: HIGH_V }

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
      for (const k of Object.keys(LOOP_COLORS) as LoopSignal[]) {
        const v = Math.min(1, Math.abs(levels[k] ?? 0))
        phase.set(k, (phase.get(k) ?? 0) + dt * (0.15 + 1.2 * v) / 2)
        tags[k].set(texts[k] ?? '', LOOP_COLORS[k])
      }
      for (const { k, pts, ray } of rays) ray(pts, (phase.get(k) ?? 0) / pathLen(pts) * 2, 0.15 + 1.1 * Math.min(1, Math.abs(levels[k] ?? 0)), LOOP_COLORS[k])
      const lvl = (k: LoopSignal) => Math.min(1, Math.abs(levels[k] ?? 0))
      blocks.ctrl(dt, LOOP_COLORS.u, lvl('u'), titles.ctrl ?? ctrl)
      blocks.plant(dt, LOOP_COLORS.y, lvl('y'), titles.plant ?? plant)
      blocks.sensor(dt, LOOP_COLORS.m, feedback ? lvl('m') : 0, titles.sensor ?? sensor)
      if (feedback) setGlow(ringM, LOOP_COLORS.e, 0.3 + lvl('e'))
    },
  }
}

const pathLen = (pts: V3[]) => pts.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1], b[2] - pts[i][2]), 0)

export const PID_COLORS = { p: HEAT, i: DATA_COLOR, d: FORCE, u: POWER }

/** Gearmotor arm on a post, pivot at `at`: 0° hangs down, angles turn it counter-clockwise (toward +x); return spring,
 *  pot on the hub, setpoint ghost and an error arc. `set(dt, deg, spDeg, u, grams)`; `peg(dt, deg | null)` shows a block holding it. */
export function pidArm(parent: THREE.Object3D, at: V3, len = 5) {
  const g = add(parent, new THREE.Group(), at)
  const dir = (deg: number, r: number, z = 0): V3 => [r * Math.sin(deg * DEG), -r * Math.cos(deg * DEG), z]
  const postH = len + 1.6
  box(g, [0.9, postH, 0.7], mat('#5b616c', { metal: 0.3, rough: 0.5 }), [0, -postH / 2 + 0.4, -0.9])
  box(g, [8, 0.5, 3.2], mat('#3a3f4a', { rough: 0.8 }), [0.8, -postH + 0.15, -0.6])
  box(g, [1.9, 2.3, 1.1], mat('#e2b93b', { rough: 0.55 }), [0, -0.45, -0.25])
  const canM = new THREE.MeshStandardMaterial({ color: '#a7adb6', metalness: 0.35, roughness: 0.4, emissive: '#000000' })
  cylinder(g, 0.75, 2.2, canM, [-2.05, -0.75, -0.25], 'x', 28)
  cylinder(g, 0.4, 1.4, STEEL(), [0, 0, 0.3], 'z', 20)
  box(g, [0.9, 0.9, 0.35], mat('#2f5fb3', { rough: 0.5 }), [0, 0, 1.05])
  addLabel(g, 'pot', [0, 0.85, 1.1], LABEL, 0.26)
  const uTag = liveLabel(g, [-2.05, -1.95, 0.6], { size: 0.28 })
  const loadTag = liveLabel(g, [0, 0, 0.8], { size: 0.26, color: GREY, align: 'right' })

  const tickM = glowMat(GREY, 0.4)
  for (let a = 0; a <= 90; a += 10) {
    const big = a % 30 === 0
    flatBox(g, [0.07, big ? 0.55 : 0.3, 0.05], tickM, dir(a, len + 0.75 + (big ? 0.12 : 0), 0.2)).rotation.z = a * DEG
    if (big) addLabel(g, `${a}°`, dir(a, len + 1.55, 0.2), GREY, 0.3)
  }

  const springM = STEEL()
  const anchor: V3 = [-1.4, -3.1, 0.25]
  box(g, [0.5, 0.5, 0.6], mat('#5b616c', { metal: 0.3, rough: 0.5 }), [anchor[0] + 0.5, anchor[1], -0.3])
  const spring = add(g, new THREE.Group(), anchor)
  add(spring, mesh(new THREE.TubeGeometry(new Helix(0.17, 1, 11), 200, 0.04, 6), springM)).castShadow = false

  const arm = add(g, new THREE.Group(), [0, 0, 0.55])
  box(arm, [0.55, len + 0.5, 0.22], mat('#c8ccd2', { metal: 0.3, rough: 0.35 }), [0, -len / 2 + 0.25, 0])
  const load = add(arm, new THREE.Group(), [0, -len, 0.05])
  cylinder(load, 0.55, 0.6, mat('#b8923a', { metal: 0.4, rough: 0.4 }), [0, 0, 0], 'z', 24)
  const ghost = add(g, new THREE.Group(), [0, 0, 0.85])
  const ghostM = glowMat(B_FIELD, 0.8)
  ghostM.transparent = true
  ghostM.opacity = 0.55
  add(ghost, mesh(new THREE.BoxGeometry(0.12, len + 0.3, 0.05), ghostM), [0, -(len + 0.3) / 2, 0]).castShadow = false
  const arc = pointCloud(g, 30, 0.09)

  const pegM = glowMat(HIGH_V, 0.5)
  pegM.transparent = true
  const peg = cylinder(g, 0.38, 1.2, pegM, [0, 0, 0.55], 'z', 20)
  peg.visible = false
  const pegTag = liveLabel(g, [0, 0, 1.2], { size: 0.28, color: HIGH_V })
  const st = { peg: 0, pegDeg: 0 }
  const dim = new THREE.Color('#000000')

  return {
    group: g,
    set(dt: number, deg: number, spDeg: number, u: number, grams = 0) {
      arm.rotation.z = deg * DEG
      ghost.rotation.z = spDeg * DEG
      const b = dir(deg, 1.9, 0.45)
      const dx = b[0] - anchor[0]
      const dy = b[1] - anchor[1]
      spring.rotation.z = Math.atan2(dy, dx)
      spring.scale.x = Math.hypot(dx, dy)
      const n = Math.min(30, Math.round(Math.abs(spDeg - deg) / 1.5))
      for (let k = 0; k < n; k++) arc.set(k, dir(deg + ((spDeg - deg) * (k + 0.5)) / n, len * 0.7, 0.85), HEAT)
      arc.show(n)
      const k = Math.min(1, Math.abs(u))
      canM.emissive.set(u >= 0 ? POWER : HEAT).lerp(dim, 1 - k * 0.6)
      uTag.set(`motor ${u >= 0 ? '+' : '−'}${Math.round(Math.abs(u) * 100)} %`, Math.abs(u) >= 0.999 ? HIGH_V : POWER)
      load.visible = grams > 0
      load.scale.setScalar(0.6 + grams / 400)
      const tip = dir(deg, len, 0.8)
      loadTag.group.position.set(tip[0] - 0.8, tip[1] - 0.5, 0.8)
      loadTag.set(grams > 0 ? `${grams} g` : '', GREY)
    },
    peg(dt: number, deg: number | null) {
      if (deg !== null) st.pegDeg = deg
      st.peg = glide(dt, st.peg, deg === null ? 0 : 1, 10)
      const r = len * 0.62
      const off = Math.atan2(0.28 + 0.38, r) / DEG
      peg.position.set(...dir(st.pegDeg + off, r, 0.55 + (1 - st.peg) * 2.5))
      pegM.opacity = st.peg
      peg.visible = st.peg > 0.02
      pegTag.group.position.set(...dir(st.pegDeg + off + 14, r + 1, 1.2))
      pegTag.set(st.peg > 0.5 ? 'held' : '', HIGH_V)
    },
  }
}

/** P, I, D and u = P + I + D as bars from a centre zero, ±100 % across `w`; u turns red when clipped. */
export function termBars(parent: THREE.Object3D, at: V3, w = 7) {
  const rows = (['p', 'i', 'd', 'u'] as const).map((k, j) => {
    const y = at[1] - j * 0.62
    flatBox(parent, [w, 0.34, 0.05], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [at[0], y, 0])
    addLabel(parent, k === 'u' ? 'u' : k.toUpperCase(), [at[0] - w / 2 - 0.3, y, 0.2], PID_COLORS[k], 0.3, 'right')
    const m = glowMat(PID_COLORS[k], 0.9)
    const fill = flatBox(parent, [1, 0.26, 0.08], m, [at[0], y, 0.06])
    const value = liveLabel(parent, [at[0] + w / 2 + 0.3, y, 0.2], { size: 0.26, align: 'left' })
    return { k, y, m, fill, value }
  })
  flatBox(parent, [0.06, 2.6, 0.06], glowMat(GREY, 0.4), [at[0], at[1] - 0.93, 0.12])
  return {
    set(t: { p: number; i: number; d: number; u: number }, sat = false) {
      for (const r of rows) {
        const v = t[r.k]
        const len = Math.max(1e-3, (Math.min(1, Math.abs(v)) * w) / 2)
        r.fill.scale.x = len
        r.fill.position.x = at[0] + (Math.sign(v) * len) / 2
        const hot = r.k === 'u' ? sat : Math.abs(v) > 1
        setGlow(r.m, hot && r.k === 'u' ? HIGH_V : PID_COLORS[r.k], 0.9)
        r.value.set(`${Math.round(v * 100) < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %${hot && r.k === 'u' ? ' clipped' : ''}`, hot ? HIGH_V : PID_COLORS[r.k])
      }
    },
  }
}
