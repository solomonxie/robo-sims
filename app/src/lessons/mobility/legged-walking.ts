import * as THREE from 'three/webgpu'
import {
  BIPED,
  G,
  GAITS,
  HEXAPOD,
  Pose,
  ZmpFrame,
  footPath,
  gaitFeet,
  gaitMargin,
  gaitSpeed,
  hullMargin,
  leanPath,
  legAngles,
  legFK,
  legIK,
  legPhase,
  pulseForDeg,
  servoDegOf,
  supportHull,
  swayAt,
  swayPath,
  tipLean,
  toDeg,
  walkerOf,
  zmpRun,
} from '../../core/physics'
import { mmText } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  emptyGroup,
  flatBox,
  floorMat,
  floorView,
  frac,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  servoBiped,
  servoWalker,
  stretchArrow,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const deg = (a: number) => `${Math.round(toDeg(a))}°`
type GaitKey = keyof typeof GAITS
const GAIT_NAMES = Object.fromEntries(Object.entries(GAITS).map(([k, g]) => [k, `${g.name} (${g.body === 'hexapod' ? '6' : '4'})`])) as Record<GaitKey, string>

/** Translucent filled polygon on the floor (fan from the first vertex), up to `max` corners. */
function floorPolygon(parent: THREE.Object3D, max: number, color: string) {
  const pos = new Float32Array((max - 2) * 9)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = glowMat(color, 0.5)
  m.transparent = true
  m.opacity = 0.32
  m.depthWrite = false
  m.side = THREE.DoubleSide
  const o = add(parent, new THREE.Mesh(geo, m))
  o.castShadow = o.receiveShadow = false
  o.frustumCulled = false
  return (pts: [number, number][], z: number, c?: string) => {
    const k = Math.max(0, pts.length - 2)
    for (let i = 0; i < k; i++)
      [pts[0], pts[i + 1], pts[i + 2]].forEach((p, j) => pos.set([p[0], p[1], z], (i * 3 + j) * 3))
    geo.setDrawRange(0, k * 3)
    geo.attributes.position.needsUpdate = true
    if (c) {
      m.color.set(c)
      m.emissive.set(c)
    }
  }
}

// --- Gait cycle: legs alternate stance and swing; duty factor, gait patterns, footfall diagram, support polygon. ---

const GC = { at: [-2.2, 0.6, 0] as V3, k: 25, tilt: 0.8, run: [-0.42, 0.42] as [number, number], lift: 0.025, x0: -14.2, x1: 12, y0: -4.8, rowH: 0.6, gap: 0.16 }
const gcParams = (p: Params) => {
  const key = pick(GAIT_NAMES, p.gait, 'tripod')
  return { key, g: GAITS[key], stride: n(p, 'stride') / 1000, T: n(p, 'period') }
}

export const gaitCycle: Lesson = {
  id: 'legged-walking-gait-cycle',
  title: 'Gait cycle',
  tagline: 'Every leg pushes, then lifts and swings forward',
  formula: (p) => {
    const q = gcParams(p)
    return `duty factor β = stance / cycle = ${q.g.duty.toFixed(2)} · v = stride / (β·T) = ${mmText(q.stride)} / (${q.g.duty.toFixed(2)} × ${q.T.toFixed(1)} s) = ${mmText(gaitSpeed(q.stride, q.T, q.g.duty))}/s`
  },
  legend: [
    { color: POWER, label: 'Foot on the ground: stance (diagram bars)', shape: 'dot' },
    { color: GREY, label: 'Foot in the air: swing', shape: 'dot' },
    { color: RING, label: 'Centre of mass, projected on the floor', shape: 'dot' },
    { color: B_FIELD, label: 'Support polygon (red: CoM outside)', shape: 'dot' },
  ],
  points: [
    'A walking leg repeats a cycle: in stance its foot stays planted while the body moves over it; in swing it lifts, moves forward and touches down ahead. The duty factor β is the stance share of the cycle. Each foot pushes the body one stride during its stance time β·T, so v = stride / (β·T).',
    'The gait is the timing between legs, drawn as a footfall diagram: one row per leg, a bar while the foot is down. A hexapod in tripod gait (β = ½) swaps two triangles, L1-R2-L3 and R1-L2-R3: fast, always three feet down. Ripple (β = ⅔) lifts one leg per side at a time; wave (β = ⅚) lifts one leg at a time, slow but with five feet down.',
    'The feet on the ground form the support polygon. If the centre of mass projects inside it, the robot can freeze mid-step and not fall: static stability. The margin to the nearest edge says how hard a push it survives. A quadruped creep (β > ¾) lifts one leg at a time and sways the body away from it first, toward the other three feet.',
    'A quadruped trot lifts diagonal pairs (β = ½): only two feet down, so the support polygon is a line and the CoM is never strictly inside. It still walks because the switch is quick: dynamic stability, which needs the zero-moment point (next lesson). SG90 kits are slow; tripod and creep keep them standing.',
  ],
  controls: [
    { kind: 'choice', key: 'gait', options: opts(GAIT_NAMES), initial: 'tripod' },
    { kind: 'slider', key: 'stride', label: 'Stride', min: 20, max: 80, step: 5, initial: 50, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'period', label: 'Cycle time T', min: 0.6, max: 2.4, step: 0.1, initial: 1.4, format: (v) => `${v.toFixed(1)} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const fv = floorView(scene, GC.at, GC.k, -GC.tilt)
    floorMat(fv, [GC.run[0] - 0.12, GC.run[1] + 0.12], [-0.19, 0.19])
    const prints = pointCloud(fv, 160, 0.01)
    const poly = floorPolygon(fv, 6, B_FIELD)
    const edgeM = glowMat(B_FIELD, 0.9)
    const edges = Array.from({ length: 6 }, () => addRod(fv, edgeM))
    const com = pointCloud(fv, 2, 0.011)
    const plumb = addRod(fv, glowMat(RING, 0.8))
    let bot = servoWalker(fv, HEXAPOD)

    const { x0, x1, y0, rowH, gap } = GC
    const rowY = (i: number) => y0 - i * (rowH + gap)
    const tx = (u: number) => x0 + (u / 2) * (x1 - x0)
    addLabel(scene, 'footfall diagram: bar = foot down', [x0, y0 + 0.68, 0.3], LABEL, 0.3, 'left')
    const diag = add(scene, new THREE.Group())
    const names = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [x0 - 0.3, rowY(i), 0.3], { size: 0.28, align: 'right' }))
    const cursor = addRod(scene, glowMat(LABEL, 1))
    const tTags = [0, 1, 2].map((k) => liveLabel(scene, [tx(k), 0, 0.3], { size: 0.24, color: GREY }))

    const st = { key: '', t: 0, x: GC.run[0], prev: [] as boolean[], n: 0, body: '' }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = gcParams(p)
        const w = walkerOf(q.g)
        const legs = w.mounts.length
        const v = gaitSpeed(q.stride, q.T, q.g.duty)
        const key = `${q.key}|${q.stride}|${q.T}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, x: GC.run[0], prev: [], n: 0 })
          prints.show(0)
          if (q.g.body !== st.body) {
            st.body = q.g.body
            emptyGroup(bot.group)
            bot.group.removeFromParent()
            bot = servoWalker(fv, w)
          }
          emptyGroup(diag)
          const barM = glowMat(POWER, 0.7)
          const trayM = glowMat(IDLE, 0.15)
          for (let i = 0; i < legs; i++) {
            flatBox(diag, [x1 - x0, rowH, 0.05], trayM, [(x0 + x1) / 2, rowY(i), 0])
            for (let c = 0; c < 2; c++) {
              const a = frac(q.g.lift[i] + 1 - q.g.duty)
              for (const [s0, s1] of a + q.g.duty <= 1 ? [[a, a + q.g.duty]] : [[a, 1], [0, a + q.g.duty - 1]])
                flatBox(diag, [((s1 - s0) / 2) * (x1 - x0) - 0.04, rowH * 0.8, 0.08], barM, [tx(c + (s0 + s1) / 2), rowY(i), 0.06])
            }
          }
          const bottom = rowY(legs - 1) - rowH / 2 - 0.35
          ;['0', 'T', '2T'].forEach((s, k) => {
            tTags[k].group.position.set(tx(k), bottom, 0.3)
            tTags[k].set(s)
          })
          names.forEach((l, i) => (l.group.visible = i < legs))
        }
        st.t += dt
        const s = st.t / q.T
        const feet = gaitFeet(q.g, frac(s), q.stride, GC.lift)
        st.x += v * dt
        if (st.x > GC.run[1]) {
          st.x = GC.run[0]
          st.prev = []
          prints.show(0)
          st.n = 0
        }
        const [cx, cy] = swayAt(q.g, frac(s))
        const pose: Pose = { x: st.x + cx, y: cy, th: 0 }
        bot.set(
          pose,
          feet.map((f, i) => legAngles(w, i, f.at)),
          feet.map((f) => f.down),
        )
        feet.forEach((f, i) => {
          if (f.down && st.prev[i] === false) {
            prints.set(st.n % 160, [pose.x + f.at[0], pose.y + f.at[1], 0.003], POWER, 0.8)
            st.n++
            prints.show(Math.min(160, st.n))
          }
          st.prev[i] = f.down
        })
        const down = feet.filter((f) => f.down).map((f) => [pose.x + f.at[0], pose.y + f.at[1]] as [number, number])
        const hull = supportHull(down)
        const margin = hullMargin([pose.x, pose.y], hull)
        const col = margin > 0.002 ? B_FIELD : HIGH_V
        poly(hull, 0.004, col)
        edgeM.color.set(col)
        edgeM.emissive.set(col)
        edges.forEach((e, i) => {
          e.visible = i < hull.length && hull.length >= 2 && !(hull.length === 2 && i > 0)
          if (!e.visible) return
          const a = hull[i]
          const b = hull[(i + 1) % hull.length]
          stretchRod(e, [a[0], a[1], 0.005], [b[0], b[1], 0.005], 0.0025)
        })
        const comC = margin > 0.002 ? RING : HIGH_V
        com.set(0, [pose.x, pose.y, 0.006], comC, 1)
        com.set(1, [pose.x, pose.y, w.height + 0.03], comC, 1.2)
        com.show(2)
        stretchRod(plumb, [pose.x, pose.y, w.height + 0.03], [pose.x, pose.y, 0.006], 0.0018)

        const u = s % 2
        stretchRod(cursor, [tx(u), y0 + rowH / 2 + 0.15, 0.4], [tx(u), rowY(legs - 1) - rowH / 2 - 0.1, 0.4], 0.05)
        feet.forEach((f, i) => names[i].set(w.names[i], f.down ? POWER : GREY))

        const up = feet.filter((f) => !f.down).length
        status.set(`${q.g.name} gait · β ${q.g.duty.toFixed(2)} · ${legs - up} of ${legs} feet down`, LABEL)
        event.set(
          margin > 0.002 ? `CoM ${mmText(margin)} inside the support polygon: statically stable` : hull.length < 3 ? 'two feet down: the support is a line, balance is dynamic' : `CoM ${mmText(-margin)} outside: would tip if frozen now`,
          margin > 0.002 ? POWER : HEAT,
        )
        sub.set(`${(st.t % q.T).toFixed(1)} / ${q.T.toFixed(1)} s cycle · ${mmText(v)}/s · real time · 0.5 m tape`)
      },
      readouts: (p) => {
        const q = gcParams(p)
        const m = gaitMargin(q.g, q.stride)
        return [
          { label: 'Duty factor β', value: q.g.duty.toFixed(2) },
          { label: 'Speed', value: `${mmText(gaitSpeed(q.stride, q.T, q.g.duty))}/s` },
          { label: 'Fewest feet down', value: `${m.minDown}`, tone: m.minDown >= 3 ? 'ok' : 'warn' },
          { label: 'Worst static margin', value: m.margin > 0.002 ? mmText(m.margin) : 'none: dynamic', tone: m.margin > 0.002 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Zero-moment point: CoM projection vs ZMP on a biped's foot; static lean vs fast sway; tipping about the toe/heel. ---

const ZMP_MODES = { lean: 'Static lean', sway: 'Fast sway' }
const SWAY_AMP = 0.025
const ZM = { at: [-10.5, -7.6, 0] as V3, k: 34, tilt: 0.22, seconds: 8, px: -3, pw: 15, py: -2.6, ph: 7.4, lo: -0.06, hi: 0.1 }
const zmParams = (p: Params) => ({ lean: pick(ZMP_MODES, p.mode, 'lean') === 'lean', leanA: (n(p, 'lean') * Math.PI) / 180, T: n(p, 'period'), h: n(p, 'height') / 1000 })
type ZmQ = ReturnType<typeof zmParams>
const zmpFrames = memoBy(
  (q: ZmQ) => `${q.lean}|${q.leanA}|${q.T}|${q.h}`,
  (q: ZmQ) => zmpRun(q.lean ? leanPath(q.leanA, q.h) : swayPath(SWAY_AMP, q.T), q.h, ZM.seconds),
)
const zmpAt = (run: ZmpFrame[], t: number) => run[Math.min(run.length - 1, Math.round(t / (run[1].t - run[0].t)))]
function zmpSummary(run: ZmpFrame[]) {
  const fell = run.find((f) => f.state === 'fallen')
  const rocked = run.some((f) => f.state !== 'ok')
  return { fell, rocked, peak: Math.max(...run.map((f) => Math.abs(f.free))), comPeak: Math.max(...run.map((f) => Math.abs(f.x))) }
}

export const zeroMomentPoint: Lesson = {
  id: 'legged-walking-zero-moment-point',
  title: 'Zero-moment point',
  tagline: 'Where the ground has to push so the foot stays flat',
  formula: (p) => {
    const q = zmParams(p)
    return q.lean
      ? `static: ZMP = CoM projection x · tips when lean > atan(toe / h) = atan(${mmText(BIPED.toe)} / ${mmText(q.h)}) = ${deg(tipLean(q.h, BIPED.toe))}`
      : `x_zmp = x − (h/g)·ẍ · sway ±${mmText(SWAY_AMP)} at ω = 2π/T → ZMP ±${mmText(SWAY_AMP)}·(1 + h·ω²/g) = ±${mmText(SWAY_AMP * (1 + (q.h * (2 * Math.PI / q.T) ** 2) / G))} · foot −${mmText(BIPED.heel)}…+${mmText(BIPED.toe)}`
  },
  legend: [
    { color: RING, label: 'Centre of mass and its floor projection', shape: 'dot' },
    { color: HIGH_V, label: 'Zero-moment point (ZMP) the motion needs', shape: 'dot' },
    { color: B_FIELD, label: 'Support: the foot, heel to toe', shape: 'dot' },
    { color: HEAT, label: 'Inertial push −m·a', shape: 'dot' },
  ],
  points: [
    'Standing still, the ground pushes up through the point under the centre of mass. While the CoM projection stays inside the support polygon (here the foot, heel to toe) the robot is statically stable. Lean past it and nothing can save the pose: at lean atan(toe/h) the CoM passes over the toe and the foot rolls onto its edge.',
    'Moving changes that. Accelerating the CoM needs a horizontal force from the ground, and the point where the total ground force has no tipping moment moves the other way: x_zmp = x − (h/g)·ẍ (cart-table model). This zero-moment point is where the ground has to push so the foot stays flat.',
    'The ZMP must stay inside the support polygon. A fast sway keeps the CoM well inside the foot yet throws the ZMP out past the heel or toe, since ẍ grows with ω²: the foot lifts on one edge and the robot rocks or falls, although its CoM never left the foot. A taller robot (bigger h) amplifies the same acceleration.',
    'Static walkers keep the CoM inside (wave, creep: slow). Dynamic walkers, biped robots like ASIMO and trotting quadrupeds, plan the CoM motion so the ZMP stays inside the feet: dynamic stability. Bigger feet, a lower CoM and gentler accelerations give more room.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(ZMP_MODES), initial: 'lean' },
    { kind: 'slider', key: 'lean', label: 'Lean (static)', min: 0, max: 25, step: 1, initial: 12, format: (v) => `${v}°` },
    { kind: 'slider', key: 'period', label: 'Sway period T (dynamic)', min: 0.8, max: 4, step: 0.1, initial: 2.6, format: (v) => `${v.toFixed(1)} s` },
    { kind: 'slider', key: 'height', label: 'CoM height h', min: 150, max: 350, step: 10, initial: 250, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const side = add(scene, new THREE.Group(), ZM.at)
    side.scale.setScalar(ZM.k)
    side.rotation.x = -Math.PI / 2 + ZM.tilt
    flatBox(side, [0.36, 0.16, 0.01], glowMat(IDLE, 0.12), [0.025, 0, -0.005])
    flatBox(side, [BIPED.heel + BIPED.toe, 0.012, 0.002], glowMat(B_FIELD, 0.9), [(BIPED.toe - BIPED.heel) / 2, -0.07, 0.001])
    addLabel(scene, 'heel', [ZM.at[0] - ZM.k * BIPED.heel - 0.2, ZM.at[1] - 1.1, 3], GREY, 0.3, 'right')
    addLabel(scene, 'toe', [ZM.at[0] + ZM.k * BIPED.toe + 0.2, ZM.at[1] - 1.1, 3], GREY, 0.3, 'left')
    const marks = pointCloud(side, 3, 0.006)
    const plumb = addRod(side, glowMat(RING, 0.8))
    const push = stretchArrow(side, HEAT, 0.003)
    const zLine = addRod(side, glowMat(HIGH_V, 0.9))
    let bot = servoBiped(side)

    const { px, pw, py, ph, lo, hi } = ZM
    const Y = (x: number) => py - ph / 2 + ((x - lo) / (hi - lo)) * ph
    const X = (t: number) => px + (t / ZM.seconds) * pw
    const axM = glowMat(GREY, 0.35)
    stretchRod(addRod(scene, axM), [px, Y(0), 0.1], [px + pw, Y(0), 0.1], 0.02)
    stretchRod(addRod(scene, axM), [px, py - ph / 2, 0.1], [px, py + ph / 2, 0.1], 0.02)
    flatBox(scene, [pw, Y(BIPED.toe) - Y(-BIPED.heel), 0.05], glowMat(IDLE, 0.2), [px + pw / 2, (Y(BIPED.toe) + Y(-BIPED.heel)) / 2, 0])
    const edgeM = glowMat(B_FIELD, 0.8)
    for (const e of [BIPED.toe, -BIPED.heel]) stretchRod(addRod(scene, edgeM), [px, Y(e), 0.08], [px + pw, Y(e), 0.08], 0.03)
    addLabel(scene, 'toe', [px - 0.2, Y(BIPED.toe), 0.3], GREY, 0.24, 'right')
    addLabel(scene, 'heel', [px - 0.2, Y(-BIPED.heel), 0.3], GREY, 0.24, 'right')
    addLabel(scene, `${ZM.seconds} s`, [px + pw, py - ph / 2 - 0.4, 0.3], GREY, 0.24, 'right')
    addLabel(scene, 'position along the foot', [px, py + ph / 2 + 0.5, 0.3], LABEL, 0.3, 'left')
    const NC = 320
    const curve = pointCloud(scene, 2 * NC, 0.05)
    const now = pointCloud(scene, 2, 0.15)

    const st = { key: '', t: 0, h: BIPED.h }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = zmParams(p)
        const run = zmpFrames(q)
        const key = `${q.lean}|${q.leanA}|${q.T}|${q.h}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          if (q.h !== st.h) {
            st.h = q.h
            emptyGroup(bot.group)
            bot.group.removeFromParent()
            bot = servoBiped(side, { h: q.h })
          }
          for (let i = 0; i < NC; i++) {
            const f = zmpAt(run, (i / (NC - 1)) * ZM.seconds)
            const cl = (v: number) => Math.max(lo, Math.min(hi, v))
            curve.set(i, [X(f.t), Y(cl(f.x)), 0.1], RING, 1.3)
            curve.set(NC + i, [X(f.t), Y(cl(f.free)), 0.15], f.free > BIPED.toe || f.free < -BIPED.heel ? HIGH_V : HEAT, 0.7)
          }
          curve.show(2 * NC)
        }
        st.t = (st.t + dt) % (ZM.seconds + 1)
        const f = zmpAt(run, Math.min(st.t, ZM.seconds))
        const lean = Math.asin(Math.max(-1, Math.min(1, f.x / q.h)))
        bot.set(lean, f.tip)
        const e = f.tip > 0 ? BIPED.toe : f.tip < 0 ? -BIPED.heel : 0
        const rot = (x: number, z: number): V3 => [e + (x - e) * Math.cos(f.tip) + z * Math.sin(f.tip), 0, -(x - e) * Math.sin(f.tip) + z * Math.cos(f.tip)]
        const c0 = rot(f.x, Math.sqrt(q.h * q.h - f.x * f.x) + 0.012)
        const c: V3 = [c0[0], -0.06, c0[2]]
        const outside = f.free > BIPED.toe || f.free < -BIPED.heel
        marks.set(0, c, RING, 1.6)
        marks.set(1, [c[0], -0.07, 0.004], RING, 1)
        marks.set(2, [f.zmp, -0.07, 0.006], HIGH_V, 1.2)
        marks.show(3)
        stretchRod(plumb, c, [c[0], -0.06, 0.002], 0.0015)
        stretchRod(zLine, [f.free, -0.07, 0.003], [f.zmp, -0.07, 0.003], 0.002)
        zLine.visible = outside
        push(c, [c[0] - 4 * (q.h / G) * f.a, -0.06, c[2]])

        now.set(0, [X(f.t), Y(Math.max(lo, Math.min(hi, f.x))), 0.2], RING)
        now.set(1, [X(f.t), Y(Math.max(lo, Math.min(hi, f.free))), 0.2], HIGH_V)
        now.show(2)

        status.set(`${q.lean ? `Static lean ${deg(q.leanA)}` : `Sway ±${mmText(SWAY_AMP)}, T ${q.T.toFixed(1)} s`} · CoM ${mmText(q.h)} high`, LABEL)
        if (f.state === 'fallen') event.set(q.lean ? 'CoM past the toe: the foot rolls over its edge, fallen' : 'ZMP left the foot, the robot rolled over the edge: fallen', HIGH_V)
        else if (f.state === 'rocking') event.set(`needs the ZMP at ${mmText(f.free)}, foot ends at ${f.free > 0 ? `+${mmText(BIPED.toe)}` : `−${mmText(BIPED.heel)}`}: foot lifts`, HEAT)
        else event.set(`ZMP ${mmText(f.free)} inside the foot (CoM ${mmText(f.x)}): foot flat`, POWER)
        sub.set(`${Math.min(st.t, ZM.seconds).toFixed(1)} / ${ZM.seconds} s · real time · side view, toe to the right`)
      },
      readouts: (p) => {
        const q = zmParams(p)
        const s = zmpSummary(zmpFrames(q))
        return [
          { label: 'Static tip lean', value: deg(tipLean(q.h, BIPED.toe)) },
          { label: 'CoM swing · ZMP swing', value: `${mmText(s.comPeak)} · ${mmText(s.peak)}` },
          { label: 'Foot heel · toe', value: `−${mmText(BIPED.heel)} · +${mmText(BIPED.toe)}` },
          { label: 'Outcome', value: s.fell ? `falls at ${s.fell.t.toFixed(1)} s` : s.rocked ? 'rocks on an edge' : 'stays flat', tone: s.fell ? 'bad' : s.rocked ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Leg IK: 2-link femur/tibia, law of cosines, knee up/down, reach limits, swing trajectory. ---

const IK_MODES = { target: 'Reach a target', swing: 'Walk cycle' }
const KNEES = { up: 'Knee up', down: 'Knee down' }
const IK = { hip: [-10, -0.5, 0] as V3, k: 60, T: 1.6, lift: 0.025, duty: 0.6, px: 0, pw: 11.5, py: -4.4, ph: 5.6 }
const ikParams = (p: Params) => ({
  swing: pick(IK_MODES, p.mode, 'target') === 'swing',
  up: pick(KNEES, p.knee, 'up') === 'up',
  x: n(p, 'x') / 1000,
  z: n(p, 'z') / 1000,
  stride: n(p, 'stride') / 1000,
})
type IkQ = ReturnType<typeof ikParams>
const IK_GAIT = { name: '', body: 'hexapod' as const, duty: IK.duty, lift: [0] }
const footAt = (q: IkQ, s: number) => {
  if (!q.swing) return { x: q.x, z: q.z, swing: false }
  const ph = legPhase(IK_GAIT, 0, s)
  const [dx, dz] = footPath(ph.swing, ph.u, q.stride, IK.lift)
  return { x: q.x + dx, z: q.z + dz, swing: ph.swing }
}
const servos = (s: { hip: number; knee: number }, up: boolean) => {
  const hipDeg = servoDegOf(s.hip)
  const kneeDeg = servoDegOf(s.knee, up ? 180 : 0)
  return { hipDeg, kneeDeg, ok: [hipDeg, kneeDeg].every((d) => d >= 0 && d <= 180) }
}

export const legIk: Lesson = {
  id: 'legged-walking-leg-ik',
  title: 'Leg IK',
  tagline: 'From a foot target to two servo angles',
  formula: (p) => {
    const q = ikParams(p)
    const s = legIK(q.x, q.z, HEXAPOD.femur, HEXAPOD.tibia, q.up)
    return `d = √(x² + z²) = ${mmText(s.d)} · cos(π − knee) = (L1² + L2² − d²) / (2·L1·L2) → knee ${deg(s.knee)} · hip = atan2(z, x) − atan2(L2 sin knee, L1 + L2 cos knee) = ${deg(s.hip)} · L1 ${mmText(HEXAPOD.femur)}, L2 ${mmText(HEXAPOD.tibia)}`
  },
  legend: [
    { color: POWER, label: 'Foot on the target (red: out of reach)', shape: 'dot' },
    { color: B_FIELD, label: 'Reach: |L1 − L2| ≤ d ≤ L1 + L2', shape: 'dot' },
    { color: GREY, label: 'The other knee solution', shape: 'dot' },
    { color: RING, label: 'Hip and knee angles', shape: 'dot' },
  ],
  points: [
    'Forward kinematics turns joint angles into a foot position. A walking controller needs the reverse: it plans where each foot goes, then needs the servo angles that put it there. For a two-link leg (femur L1, tibia L2) in its vertical plane this inverse kinematics has a closed form.',
    'The hip, knee and foot make a triangle with sides L1, L2 and the reach d = √(x² + z²). The law of cosines gives the knee: cos(π − knee) = (L1² + L2² − d²) / (2·L1·L2). Then the hip angle is the direction to the foot, atan2(z, x), minus the angle the bent leg adds.',
    'Every reachable target has two answers, knee up or knee down: the same triangle flipped about the hip-foot line. Spiders and hexapods keep the knee up, which keeps the tibia clear of the ground. Outside the ring |L1 − L2| ≤ d ≤ L1 + L2 there is no answer: the leg can only stretch toward it, and a servo end stop can cut the reach further.',
    'Walking is IK run 50 times a second: the stance foot slides back in a straight line and the swing foot follows a lifted arc to its next touchdown, and every point becomes a hip and a knee pulse. A hexapod adds a coxa servo for yaw first. General arms with more joints come later, in the Kinematics section (FK, IK).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(IK_MODES), initial: 'target' },
    { kind: 'choice', key: 'knee', options: opts(KNEES), initial: 'up' },
    { kind: 'slider', key: 'x', label: 'Foot x (out)', min: 10, max: 160, step: 5, initial: 85, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'z', label: 'Foot z (up)', min: -140, max: 60, step: 5, initial: -60, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'stride', label: 'Stride (walk cycle)', min: 20, max: 80, step: 5, initial: 50, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const leg = add(scene, new THREE.Group(), IK.hip)
    leg.scale.setScalar(IK.k)
    const { femur: L1, tibia: L2 } = HEXAPOD
    const ring = pointCloud(leg, 240, 0.0012)
    for (let i = 0; i < 120; i++) {
      const a = -Math.PI * 0.75 + (i / 119) * Math.PI * 0.92
      ring.set(i, [(L1 + L2) * Math.cos(a), (L1 + L2) * Math.sin(a), 0], B_FIELD)
      ring.set(120 + i, [(L2 - L1) * Math.cos(a), (L2 - L1) * Math.sin(a), 0], B_FIELD, 0.8)
    }
    ring.show(240)
    flatBox(leg, [0.05, 0.03, 0.02], glowMat(IDLE, 0.3), [-0.03, 0, -0.012])
    const servoM = glowMat('#2a5bd7', 0.35)
    const hipServo = flatBox(leg, [0.016, 0.016, 0.012], servoM, [0, 0, 0.004])
    const kneeServo = flatBox(leg, [0.014, 0.014, 0.012], servoM, [0, 0, 0.004])
    hipServo.castShadow = kneeServo.castShadow = false
    const boneM = glowMat('#d9dce2', 0.35)
    const femurRod = addRod(leg, boneM)
    const tibiaRod = addRod(leg, boneM)
    const ghostM = glowMat(GREY, 0.3)
    const ghost = [addRod(leg, ghostM), addRod(leg, ghostM)]
    const ground = addRod(leg, glowMat(IDLE, 0.5))
    const reachLine = addRod(leg, glowMat(HIGH_V, 0.8))
    const dLine = addRod(leg, glowMat(RING, 0.4))
    const pts = pointCloud(leg, 3, 0.0035)
    const path = pointCloud(leg, 90, 0.0011)
    const hipTag = liveLabel(leg, [0, 0, 0.01], { size: 0.0055, color: RING, align: 'left' })
    const kneeTag = liveLabel(leg, [0, 0, 0.01], { size: 0.0055, color: RING, align: 'left' })

    const { px, pw, py, ph } = IK
    const AY = (a: number) => py - ph / 2 + ((a + (5 * Math.PI) / 6) / ((4 * Math.PI) / 3)) * ph
    const plot = add(scene, new THREE.Group())
    const axM = glowMat(GREY, 0.35)
    stretchRod(addRod(plot, axM), [px, AY(0), 0.1], [px + pw, AY(0), 0.1], 0.02)
    stretchRod(addRod(plot, axM), [px, py - ph / 2, 0.1], [px, py + ph / 2, 0.1], 0.02)
    addLabel(plot, 'joint angles over one step', [px, py + ph / 2 + 0.5, 0.3], LABEL, 0.3, 'left')
    addLabel(plot, '+90°', [px - 0.2, AY(Math.PI / 2), 0.3], GREY, 0.22, 'right')
    addLabel(plot, '−90°', [px - 0.2, AY(-Math.PI / 2), 0.3], GREY, 0.22, 'right')
    addLabel(plot, '0°', [px - 0.2, AY(0), 0.3], GREY, 0.22, 'right')
    addLabel(plot, 'swing', [px + (pw * (1 - IK.duty)) / 2, py - ph / 2 - 0.4, 0.3], B_FIELD, 0.22)
    addLabel(plot, 'stance', [px + pw * (1 - IK.duty / 2), py - ph / 2 - 0.4, 0.3], POWER, 0.22)
    const NC = 160
    const curves = pointCloud(plot, 2 * NC, 0.05)
    const now = pointCloud(plot, 2, 0.14)
    const curveTags = [RING, HEAT].map((c) => liveLabel(plot, [0, 0, 0.3], { size: 0.26, color: c, align: 'left' }))
    const servoTxt = [0, 1].map((i) => liveLabel(scene, [px + 1.2, 3.3 - i * 0.7, 0.3], { size: 0.32, align: 'left' }))

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = ikParams(p)
        const key = `${q.swing}|${q.up}|${q.x}|${q.z}|${q.stride}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          plot.visible = q.swing
          path.show(0)
          stretchRod(ground, [q.x - 0.06, q.z, -0.002], [q.x + 0.06, q.z, -0.002], 0.0008)
          ground.visible = q.swing
          if (q.swing) {
            for (let i = 0; i < 90; i++) {
              const f = footAt(q, i / 90)
              path.set(i, [f.x, f.z, 0], f.swing ? B_FIELD : POWER)
            }
            path.show(90)
            for (let i = 0; i < NC; i++) {
              const f = footAt(q, i / NC)
              const s = legIK(f.x, f.z, L1, L2, q.up)
              curves.set(i, [px + (i / NC) * pw, AY(s.hip), 0.1], RING)
              curves.set(NC + i, [px + (i / NC) * pw, AY(s.knee), 0.1], HEAT, 0.8)
            }
            curves.show(2 * NC)
            const fe = footAt(q, 0.999)
            const end = legIK(fe.x, fe.z, L1, L2, q.up)
            ;[end.hip, end.knee].forEach((a, i) => {
              curveTags[i].group.position.set(px + pw + 0.25, AY(a), 0.3)
              curveTags[i].set(i ? 'knee' : 'hip')
            })
          }
        }
        st.t += dt
        const u = q.swing ? frac(st.t / IK.T) : 0
        const f = footAt(q, u)
        const s = legIK(f.x, f.z, L1, L2, q.up)
        const k = legFK(s.hip, s.knee, L1, L2)
        const o = legIK(f.x, f.z, L1, L2, !q.up)
        const ko = legFK(o.hip, o.knee, L1, L2)
        stretchRod(femurRod, [0, 0, 0], [k.knee[0], k.knee[1], 0], 0.0032)
        stretchRod(tibiaRod, [k.knee[0], k.knee[1], 0], [k.foot[0], k.foot[1], 0], 0.0026)
        kneeServo.position.set(k.knee[0], k.knee[1], 0.004)
        stretchRod(ghost[0], [0, 0, -0.004], [ko.knee[0], ko.knee[1], -0.004], 0.0015)
        stretchRod(ghost[1], [ko.knee[0], ko.knee[1], -0.004], [ko.foot[0], ko.foot[1], -0.004], 0.0013)
        stretchRod(dLine, [0, 0, -0.002], [k.foot[0], k.foot[1], -0.002], 0.0006)
        stretchRod(reachLine, [k.foot[0], k.foot[1], 0], [f.x, f.z, 0], 0.0012)
        reachLine.visible = !s.ok
        pts.set(0, [f.x, f.z, 0.002], s.ok ? POWER : HIGH_V, 1)
        pts.set(1, [k.foot[0], k.foot[1], 0.004], s.ok ? POWER : HEAT, 1.3)
        pts.set(2, [k.knee[0], k.knee[1], 0.008], RING, 0.7)
        pts.show(3)
        hipTag.group.position.set(0.006, q.up ? -0.016 : 0.01, 0.01)
        hipTag.set(`hip ${deg(s.hip)}`, RING)
        kneeTag.group.position.set(k.knee[0] + 0.01, k.knee[1] + (q.up ? 0.006 : -0.012), 0.01)
        kneeTag.set(`knee ${deg(s.knee)}`, RING)

        const sv = servos(s, q.up)
        servoTxt[0].set(`hip servo ${Math.round(sv.hipDeg)}° → ${Math.round(pulseForDeg(sv.hipDeg, [500, 2500]))} µs`, sv.hipDeg >= 0 && sv.hipDeg <= 180 ? LABEL : HIGH_V)
        servoTxt[1].set(`knee servo ${Math.round(sv.kneeDeg)}° → ${Math.round(pulseForDeg(sv.kneeDeg, [500, 2500]))} µs`, sv.kneeDeg >= 0 && sv.kneeDeg <= 180 ? LABEL : HIGH_V)
        if (q.swing) {
          now.set(0, [px + u * pw, AY(s.hip), 0.2], RING)
          now.set(1, [px + u * pw, AY(s.knee), 0.2], HEAT)
          now.show(2)
        }

        status.set(`${q.swing ? `Walk cycle · ${f.swing ? 'swing: lift and reach forward' : 'stance: foot slides back'}` : 'Reach a target'} · ${KNEES[q.up ? 'up' : 'down']}`, LABEL)
        const [lo, hi] = s.reach
        event.set(
          s.ok ? (sv.ok ? `d ${mmText(s.d)} within ${mmText(lo)}…${mmText(hi)}: solved` : 'solved, but a servo would pass its 0…180° end stop') : `d ${mmText(s.d)} ${s.d > hi ? `> L1 + L2 = ${mmText(hi)}` : `< |L1 − L2| = ${mmText(lo)}`}: out of reach, leg stretches toward it`,
          s.ok && sv.ok ? POWER : HIGH_V,
        )
        sub.set(q.swing ? `${(st.t % IK.T).toFixed(1)} / ${IK.T} s step · β ${IK.duty} · lift ${mmText(IK.lift)} · real time` : 'side view of one leg, hip at the left · servo pulses for 500…2500 µs = 0…180°')
      },
      readouts: (p) => {
        const q = ikParams(p)
        const s = legIK(q.x, q.z, L1, L2, q.up)
        const sv = servos(s, q.up)
        return [
          { label: 'Reach d · max', value: `${mmText(s.d)} · ${mmText(s.reach[1])}`, tone: s.ok ? 'ok' : 'bad' },
          { label: 'Hip · knee', value: `${deg(s.hip)} · ${deg(s.knee)}` },
          { label: 'Servo hip · knee', value: `${Math.round(sv.hipDeg)}° · ${Math.round(sv.kneeDeg)}°`, tone: sv.ok ? 'ok' : 'warn' },
          { label: 'Links L1 · L2', value: `${mmText(L1)} · ${mmText(L2)}` },
        ]
      },
    }
  },
}
