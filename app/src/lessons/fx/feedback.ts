// Control block diagram: setpoint → Σ → controller → plant → output, sensor feedback into Σ; signals ride the wires as beads.
// PID: the gearmotor arm rig and P/I/D/u term bars. Speed: a wheel rig with a speed gauge. Position: a car driving to a mark.
// Stability: an s-plane screen with pole crosses and root-locus dots.
import * as THREE from 'three/webgpu'
import { DEG, TT_CAR } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, STEEL } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import { Helix } from '../../models/power'
import { B_FIELD, DATA_COLOR, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { moduleBlock } from './diagrams'
import { addRod, stretchRod } from './layout'
import { pointCloud } from './rooms'
import { scope } from './screens'
import { lightRay } from './sensing'
import { flatBox, glowBox, stretchArrow } from './shapes'
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

/** Signed terms and their sum (last row) as bars from a centre zero, ±100 % across `w`; the sum turns red when clipped. */
export function sumBars(parent: THREE.Object3D, at: V3, rows: readonly { label: string; color: string }[], w = 7) {
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
    set(values: readonly number[], sat = false) {
      bars.forEach((r, j) => {
        const v = values[j] ?? 0
        const len = Math.max(1e-3, (Math.min(1, Math.abs(v)) * w) / 2)
        r.fill.scale.x = len
        r.fill.position.x = at[0] + (Math.sign(v) * len) / 2
        const sum = j === last
        const hot = sum ? sat : Math.abs(v) > 1
        setGlow(r.m, hot && sum ? HIGH_V : r.color, 0.9)
        r.value.set(`${Math.round(v * 100) < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %${hot && sum ? ' clipped' : ''}`, hot ? HIGH_V : r.color)
      })
    },
  }
}

/** P, I, D and u = P + I + D as `sumBars`. */
export function termBars(parent: THREE.Object3D, at: V3, w = 7) {
  const bars = sumBars(parent, at, (['p', 'i', 'd', 'u'] as const).map((k) => ({ label: k === 'u' ? 'u' : k.toUpperCase(), color: PID_COLORS[k] })), w)
  return { set: (t: { p: number; i: number; d: number; u: number }, sat = false) => bars.set([t.p, t.i, t.d, t.u], sat) }
}

export const MEAS_COLOR = LABEL

/** TT-driven wheel face-on, axle at `at`, radius `r`, on a floor strip that tilts to the ramp; speed gauge (0…`max` rpm) to the
 *  right: setpoint mark, true needle, encoder reading needle. `set(dt, rev, rpm, sp, meas, u, slopeDeg, counts?)`. */
export function speedWheel(parent: THREE.Object3D, at: V3, r = 2.6, max = 300) {
  const g = add(parent, new THREE.Group(), at)
  const box3 = add(g, new THREE.Group(), [0, 0, -1.6])
  const canM = new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.55, emissive: '#000000' })
  box(box3, [r * 1.1, r * 0.55, 1.6], canM, [-r * 0.7, r * 0.1, 0])
  cylinder(box3, r * 0.2, r * 0.9, mat('#a7adb6', { metal: 0.35, rough: 0.4 }), [-r * 1.4, r * 0.1, 0], 'x', 20)
  const wheel = add(g, buildWheel(), [0, 0, 0])
  wheel.scale.setScalar(r / 12.8)
  const spokeM = mat('#2a2c32', { rough: 0.6 })
  for (let k = 0; k < 3; k++) box(wheel, [8, 1.1, 0.4], spokeM, [6.2 * Math.cos((k * 2 * Math.PI) / 3), 6.2 * Math.sin((k * 2 * Math.PI) / 3), 4.6]).rotation.z = (k * 2 * Math.PI) / 3
  box(wheel, [2.4, 1.4, 0.5], glowMat(HEAT, 0.9), [11.4, 0, 4.7]).castShadow = false
  const floor = add(g, new THREE.Group())
  box(floor, [r * 3.6, 0.35, 3.2], mat('#3a3f4a', { rough: 0.8 }), [0, -0.175, -0.4])
  const uTag = liveLabel(g, [0, -r - 1.3, 0.6], { size: 0.28 })
  const cTag = liveLabel(g, [0, -r - 1.9, 0.6], { size: 0.26, color: GREY })
  const rampTag = liveLabel(g, [0, r + 0.7, 0.6], { size: 0.28, color: GREY })

  const gc: V3 = [r + 3.6, 0.6, 0]
  const R = 2.2
  const sweep = 240 * DEG
  const ang = (rpm: number) => 210 * DEG - (Math.max(0, Math.min(max * 1.05, rpm)) / max) * sweep
  const pos = (a: number, rr: number, z = 0.2): V3 => [gc[0] + rr * Math.cos(a), gc[1] + rr * Math.sin(a), z]
  cylinder(g, R + 0.35, 0.2, mat('#23262d', { rough: 0.8 }), [gc[0], gc[1], -0.1], 'z', 40).castShadow = false
  const tickM = glowMat(GREY, 0.4)
  for (let v = 0; v <= max; v += 25) {
    const big = v % 100 === 0
    flatBox(g, [big ? 0.4 : 0.22, 0.06, 0.05], tickM, pos(ang(v), R - (big ? 0.2 : 0.11))).rotation.z = ang(v)
    if (big) addLabel(g, `${v}`, pos(ang(v), R - 0.75), GREY, 0.24)
  }
  addLabel(g, 'rpm', [gc[0], gc[1] - 1.1, 0.2], GREY, 0.24)
  const needle = (color: string, len: number, w: number, z: number) => {
    const p = add(g, new THREE.Group(), [gc[0], gc[1], z])
    flatBox(p, [len, w, 0.05], glowMat(color, 0.9), [len / 2, 0, 0])
    return p
  }
  const spMark = needle(B_FIELD, 0.5, 0.16, 0.25)
  spMark.children[0].position.x = R + 0.1
  const measN = needle(MEAS_COLOR, R * 0.95, 0.06, 0.3)
  const trueN = needle(RING, R * 0.8, 0.13, 0.35)
  cylinder(g, 0.16, 0.2, glowMat(GREY, 0.6), [gc[0], gc[1], 0.4], 'z', 16)
  const readTag = liveLabel(g, [gc[0], gc[1] - R - 0.6, 0.3], { size: 0.3, color: RING })
  const dim = new THREE.Color('#000000')
  const st = { slope: 0 }
  return {
    group: g,
    set(dt: number, rev: number, rpm: number, sp: number, meas: number, u: number, slopeDeg: number, counts?: number) {
      wheel.rotation.z = -rev * 2 * Math.PI
      st.slope = glide(dt, st.slope, slopeDeg, 6)
      const a = st.slope * DEG
      floor.rotation.z = a
      floor.position.set(r * Math.sin(a), -r * Math.cos(a), 0)
      rampTag.set(slopeDeg ? `ramp ${slopeDeg}°` : 'flat floor', slopeDeg ? HEAT : GREY)
      spMark.rotation.z = ang(sp)
      measN.rotation.z = ang(meas)
      trueN.rotation.z = ang(rpm)
      readTag.set(`${Math.round(rpm)} rpm`, RING)
      const k = Math.min(1, Math.abs(u))
      canM.emissive.set(u >= 0 ? POWER : HEAT).lerp(dim, 1 - k * 0.6)
      uTag.set(`motor ${u >= 0 ? '+' : '−'}${Math.round(Math.abs(u) * 100)} %`, Math.abs(u) >= 0.999 ? HIGH_V : POWER)
      cTag.set(counts === undefined ? 'no encoder' : `${counts} counts / tick`, counts === undefined ? GREY : MEAS_COLOR)
    },
  }
}

/** Side-view TT car on a floor strip, `k` scene units per metre, mark 0 at `at`, target flag at `dist`; springy camera mast
 *  (tip drawn `exag`× its bend), setpoint ghost on the floor. `set(x, ref, rev, sway, u)` in metres. */
export function positionCar(parent: THREE.Object3D, at: V3, k: number, dist: number, exag = 5) {
  const g = add(parent, new THREE.Group(), at)
  const len = (dist + 0.45) * k
  box(g, [len, 0.35, 3], mat('#3a3f4a', { rough: 0.8 }), [len / 2 - 0.25 * k, -0.175, -0.4])
  const tickM = glowMat(GREY, 0.4)
  for (let j = 0; j * 0.1 <= dist + 0.1001; j++) {
    const x = j * 0.1 * k
    flatBox(g, [0.05, j % 2 ? 0.18 : 0.3, 0.05], tickM, [x, -0.2, 1.12])
    if (j % 2 === 0) addLabel(g, j ? `${(j / 10).toFixed(1)} m` : '0', [x, -0.75, 1.1], GREY, 0.24)
  }
  const flag = add(g, new THREE.Group(), [dist * k, 0, -1.3])
  cylinder(flag, 0.05, 4.4, mat('#c9ccd3', { rough: 0.5 }), [0, 2.2, 0], 'y', 8)
  flatBox(flag, [1, 0.6, 0.04], glowMat(B_FIELD, 0.7), [0.5, 4.05, 0])
  addLabel(flag, 'target', [0.15, 4.75, 0.1], B_FIELD, 0.26)
  const ghost = add(g, new THREE.Group(), [0, 0, 1.25])
  flatBox(ghost, [0.12, 0.7, 0.05], glowMat(B_FIELD, 0.9), [0, -0.1, 0])

  const car = add(g, new THREE.Group())
  const wr = TT_CAR.wheelM * k
  const body: V3 = [0.2 * k, 0.05 * k, 0.13 * k]
  box(car, body, mat('#d8dbe2', { rough: 0.5 }), [0, wr + 0.35, 0])
  const motorM = new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.55, emissive: '#000000' })
  box(car, [0.07 * k, 0.022 * k, 0.04 * k], motorM, [-0.035 * k, wr, body[2] / 2 - 0.4])
  const wheel = add(car, new THREE.Group(), [-0.065 * k, wr, body[2] / 2 + 0.2])
  cylinder(wheel, wr, 0.5, mat('#1c1c1f', { rough: 0.8 }), [0, 0, 0], 'z', 24)
  box(wheel, [wr * 1.6, 0.16, 0.1], glowMat(HEAT, 0.9), [0, 0, 0.3]).castShadow = false
  cylinder(car, 0.22, 0.3, mat('#a7adb6', { metal: 0.4, rough: 0.4 }), [0.07 * k, 0.22, body[2] / 2], 'z', 12)
  const mastH = 0.18 * k
  const base: V3 = [-0.06 * k, wr + 0.35 + body[1] / 2, 0]
  const N = 6
  const rodM = mat('#9aa0aa', { metal: 0.5, rough: 0.35 })
  const rods = Array.from({ length: N }, () => addRod(car, rodM))
  const cam = add(car, new THREE.Group())
  box(cam, [0.5, 0.45, 0.6], mat('#2a2c32', { rough: 0.5 }), [0.05, 0.22, 0])
  cylinder(cam, 0.16, 0.2, glowMat(DATA_COLOR, 0.8), [0.35, 0.25, 0], 'x', 12)
  const vTag = liveLabel(car, [0, base[1] + mastH + 1.1, 0.3], { size: 0.28, color: RING })
  const dim = new THREE.Color('#000000')
  const shape = (s: number) => (s * s * (3 - s)) / 2
  return {
    group: g,
    set(x: number, ref: number, rev: number, sway: number, u: number) {
      car.position.x = x * k
      ghost.position.x = ref * k
      wheel.rotation.z = -rev * 2 * Math.PI
      const tip = Math.max(-0.7, Math.min(0.7, -sway * k * exag / mastH)) * mastH
      const pt = (s: number): V3 => [base[0] + tip * shape(s), base[1] + s * mastH, base[2]]
      rods.forEach((r, j) => stretchRod(r, pt(j / N), pt((j + 1) / N), 0.07))
      const top = pt(1)
      cam.position.set(top[0], top[1], top[2])
      cam.rotation.z = -Math.atan((1.5 * tip) / mastH)
      const a = Math.min(1, Math.abs(u))
      motorM.emissive.set(u >= 0 ? POWER : HEAT).lerp(dim, 1 - a * 0.6)
      const left = Math.round((dist - x) * 1000)
      vTag.set(left === 0 ? 'on the mark' : left > 0 ? `${left} mm to go` : `${-left} mm past`, Math.abs(left) <= 2 ? RING : left < 0 ? HIGH_V : GREY)
    },
  }
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
