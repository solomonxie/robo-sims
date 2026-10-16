import * as THREE from 'three/webgpu'
import {
  DEG,
  DESK,
  Mat4,
  P3,
  Quat,
  V2,
  apply4,
  axisOf,
  chain4,
  deskTree,
  frameLookup,
  framePath,
  frameWorld,
  invert4,
  originOf,
  quatOf,
  quatTf,
  rot2,
  rotAbout4,
  rotate2,
  slerp,
  toDeg,
  trans4,
  wrapPi,
} from '../../core/physics'
import { degText, fixedText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { AXIS_RGB, B_FIELD, GREY, HEAT, LABEL, RING, addLabel, addRod, diffBot, faceFront, floorMat, floorView, frameTriad, glide, glowMat, liveLabel, matrixGrid, moduleBlock, pointCloud, rodBetween, setTf, statusHeader, stretchArrow, stretchRod, zUp, glideAngle } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const WORLD_C = '#e8e8e8'
const AXES_LEGEND = { color: AXIS_RGB[0], label: 'Axes: x red, y green, z blue', shape: 'dot' } as const
const f2 = (v: number) => fixedText(v)
/** In brackets when negative, for products like 0.87·(−0.50). */
const fp = (v: number) => (v < -0.005 ? `(${f2(v)})` : f2(v))
const xyz = (p: readonly number[]) => `(${p.map(f2).join(', ')})`
const deg = (a: number) => degText(toDeg(a), 0)
/** Shortest-way glide of an angle. */

// --- 2D rotation: the robot turns by θ; R(θ) carries a lidar hit from robot coordinates to world coordinates. ---

const R2 = { at: [-8.6, -3.6, 0] as V3, k: 10, half: 0.72, bot: 2.4, z: 0.2, spin: 0.5, trail: 160 }
const SPIN = { hold: 'Hold heading', spin: 'Spin in place' }
const r2Params = (p: Params) => ({ th: n(p, 'th') * DEG, p: [n(p, 'px'), n(p, 'py')] as V2, spin: pick(SPIN, p.mode, 'hold') === 'spin' })

export const rotation2d: Lesson = {
  id: 'coordinate-frames-2d-rotation',
  title: '2D rotation',
  tagline: 'Same point, two sets of axes',
  formula: (p) => {
    const q = r2Params(p)
    const [c, s] = [Math.cos(q.th), Math.sin(q.th)]
    const w = rotate2(q.th, q.p)
    return `p_world = R(θ) · p_robot · R(θ) = [cos θ  −sin θ; sin θ  cos θ] = [${f2(c)}  ${f2(-s)}; ${f2(s)}  ${f2(c)}] · (${f2(q.p[0])}, ${f2(q.p[1])}) → (${f2(w[0])}, ${f2(w[1])}) m · back: p_robot = Rᵀ · p_world`
  },
  legend: [
    AXES_LEGEND,
    { color: RING, label: 'Point p: a lidar hit, and its vector', shape: 'dot' },
    { color: B_FIELD, label: 'Walk along the robot axes x, y', shape: 'dot' },
    { color: WORLD_C, label: 'Walk along the world axes X, Y', shape: 'dot' },
  ],
  points: [
    'A coordinate frame is an origin plus axes. Robots use many: the world (fixed to the floor) and the robot (x forward, y left, z up, turning with it). A lidar reports a hit in robot coordinates: "0.4 m ahead, 0.2 m to my left". The planner needs it in world coordinates.',
    'Here the two frames share an origin and differ only by the heading θ. Rotating the robot coordinates by θ gives the world ones: X = cos θ·x − sin θ·y, Y = sin θ·x + cos θ·y. Written as a matrix, p_world = R(θ)·p_robot.',
    'Read R by columns: the first column (cos θ, sin θ) is the robot\'s x axis written in world coordinates, the second (−sin θ, cos θ) its y axis. Walking x along the robot\'s x axis, then y along its y axis (cyan) lands on the same point as walking X then Y along the world axes (white).',
    'A rotation never changes lengths: the hit is just as far away in both frames, and spinning the robot swings it round a circle. Going back is the transpose, p_robot = Rᵀ·p_world, which is the same as turning by −θ. Rotations add: R(a)·R(b) = R(a + b).',
  ],
  controls: [
    { kind: 'slider', key: 'th', label: 'Heading θ', min: -180, max: 180, step: 5, initial: 30, format: (v) => `${v}°` },
    { kind: 'slider', key: 'px', label: 'Hit ahead (robot x)', min: -0.5, max: 0.5, step: 0.05, initial: 0.4, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'py', label: 'Hit to the left (robot y)', min: -0.5, max: 0.5, step: 0.05, initial: 0.2, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'choice', key: 'mode', options: opts(SPIN), initial: 'hold' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, R2.at, R2.k, -0.6)
    floorMat(g, [-R2.half, R2.half], [-R2.half, R2.half])
    const holder = add(g, new THREE.Group())
    holder.scale.setScalar(R2.bot)
    const bot = diffBot(holder)
    const plane = add(g, new THREE.Group(), [0, 0, R2.z])
    const world = frameTriad(plane, 0.5, 'world', WORLD_C, 0.008, { letters: 'XYZ', size: 0.07, planar: true })
    const body = add(plane, new THREE.Group())
    const robotTri = frameTriad(body, 0.36, 'robot', B_FIELD, 0.013, { letters: 'xyz', size: 0.06, planar: true })
    robotTri.label.group.position.set(-0.24, -0.12, 0.05)
    world.label.group.position.set(0.3, -0.09, 0)
    const post = cylinder(g, 0.012, R2.z, mat('#8a8f99', { rough: 0.6 }), [0, 0, R2.z / 2], 'z', 12)
    const hit = add(g, mesh(new THREE.SphereGeometry(0.028, 16, 12), glowMat(RING, 1.2)))
    hit.castShadow = false
    const vec = stretchArrow(plane, RING, 0.007)
    const walk = [B_FIELD, B_FIELD, WORLD_C, WORLD_C].map((c) => addRod(plane, glowMat(c, 0.9)))
    const arc = pointCloud(plane, 40, 0.007)
    const thTag = liveLabel(plane, [0, 0, 0], { size: 0.07, color: HEAT })
    thTag.set('θ')
    const trail = pointCloud(g, R2.trail, 0.008)

    const MX = { y: 1.4, vx: 2.4, rx: 7.7, px: 13, cell: 2, size: 0.46 }
    const wv = matrixGrid(scene, [MX.vx, MX.y, 0], 2, 1, { cell: 1.8, size: MX.size })
    addLabel(scene, '=', [MX.vx + 1.9, MX.y, 0.2], LABEL, 0.55)
    const rm = matrixGrid(scene, [MX.rx, MX.y, 0], 2, 2, { cell: MX.cell, size: MX.size })
    addLabel(scene, '·', [MX.rx + 2.85, MX.y, 0.2], LABEL, 0.55)
    const pv = matrixGrid(scene, [MX.px, MX.y, 0], 2, 1, { cell: 1.8, size: MX.size })
    addLabel(scene, 'p_world', [MX.vx, MX.y + 1.7, 0.2], WORLD_C, 0.38)
    addLabel(scene, 'R(θ)', [MX.rx, MX.y + 1.7, 0.2], LABEL, 0.38)
    addLabel(scene, 'p_robot', [MX.px, MX.y + 1.7, 0.2], B_FIELD, 0.38)
    addLabel(scene, 'columns: robot x, robot y', [MX.rx, MX.y - 1.55, 0.2], GREY, 0.3)
    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [0.8, -2.2 - i * 0.8, 0.2], { size: 0.38, align: 'left' }))

    const st = { th: NaN, spin: 0, wheel: 0, trail: 0, acc: 0 }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = r2Params(p)
        if (Number.isNaN(st.th)) st.th = q.th
        const prev = st.th
        if (q.spin) st.th = wrapPi(st.th + R2.spin * dt)
        else st.th = glideAngle(dt, st.th, q.th)
        st.wheel += wrapPi(st.th - prev) * 0.065
        const th = st.th
        bot.set({ x: 0, y: 0, th }, -st.wheel, st.wheel)
        body.rotation.z = th
        const w = rotate2(th, q.p)
        post.position.set(w[0], w[1], R2.z / 2)
        hit.position.set(w[0], w[1], R2.z)
        vec([0, 0, 0.004], [w[0], w[1], 0.004])
        const ex = rotate2(th, [q.p[0], 0])
        stretchRod(walk[0], [0, 0, 0.01], [ex[0], ex[1], 0.01], 0.006)
        stretchRod(walk[1], [ex[0], ex[1], 0.01], [w[0], w[1], 0.01], 0.006)
        stretchRod(walk[2], [0, 0, -0.01], [w[0], 0, -0.01], 0.005)
        stretchRod(walk[3], [w[0], 0, -0.01], [w[0], w[1], -0.01], 0.005)
        const a = wrapPi(th)
        for (let i = 0; i < 40; i++) {
          const u = (i / 39) * a
          arc.set(i, [0.2 * Math.cos(u), 0.2 * Math.sin(u), 0], HEAT)
        }
        arc.show(Math.abs(a) > 0.02 ? 40 : 0)
        thTag.group.position.set(0.27 * Math.cos(a / 2), 0.27 * Math.sin(a / 2), 0)
        if (q.spin) {
          st.acc += Math.abs(wrapPi(th - prev))
          if (st.acc > 0.04) {
            st.acc = 0
            trail.set(st.trail++ % R2.trail, [w[0], w[1], 0.004], RING, 0.8)
            trail.show(Math.min(st.trail, R2.trail))
          }
        } else if (st.trail) {
          st.trail = 0
          trail.show(0)
        }
        world.face()
        robotTri.face()
        faceFront(thTag.group)

        const [c, , s, d] = rot2(th)
        const r = Math.hypot(...q.p)
        wv.set([f2(w[0]), f2(w[1])], [AXIS_RGB[0], AXIS_RGB[1]])
        rm.set([f2(c), f2(-s), f2(s), f2(d)], [AXIS_RGB[0], AXIS_RGB[1]])
        pv.set([f2(q.p[0]), f2(q.p[1])], [AXIS_RGB[0], AXIS_RGB[1]])
        lines[0].set(`X = ${f2(c)}·${fp(q.p[0])} − ${fp(s)}·${fp(q.p[1])} = ${f2(w[0])} m`, AXIS_RGB[0])
        lines[1].set(`Y = ${f2(s)}·${fp(q.p[0])} + ${fp(c)}·${fp(q.p[1])} = ${f2(w[1])} m`, AXIS_RGB[1])
        lines[2].set(`back: Rᵀ · p_world = (${f2(q.p[0])}, ${f2(q.p[1])})`, GREY)
        lines[3].set(`|p| = ${f2(r)} m in both frames`, RING)
        status.set(`heading θ ${deg(th)} · hit ${f2(r)} m away at ${deg(Math.atan2(q.p[1], q.p[0]))} robot, ${deg(Math.atan2(w[1], w[0]))} world`, LABEL)
        sub.set('top view · floor tape every 0.5 m · robot drawn 2.4× size', GREY)
        event.set(
          q.spin ? 'spinning: robot coordinates stay put, world coordinates swing round a circle' : Math.abs(wrapPi(th)) < 0.01 ? 'θ = 0: the frames line up, R is the identity' : 'cyan and white walks end on the same point',
          q.spin ? RING : LABEL,
        )
      },
      readouts: (p) => {
        const q = r2Params(p)
        const th = q.spin ? st.th : q.th
        const w = rotate2(th, q.p)
        return [
          { label: 'Heading θ', value: deg(th) },
          { label: 'Hit, robot frame', value: xyz(q.p) },
          { label: 'Hit, world frame', value: xyz(w) },
          { label: 'Distance (both)', value: `${f2(Math.hypot(...w))} m`, tone: 'ok' },
        ]
      },
    }
  },
}

// --- Homogeneous transforms: rotation and translation in one 4×4; the order of the two moves matters. ---

const HT = { at: [-9, -4, 0] as V3, k: 9.5, x: [-0.6, 0.8] as [number, number], y: [-0.4, 0.8] as [number, number], cam: 0.3, cycle: [0.8, 1.8, 0.4, 1.8, 2.4] }
const ORDER = { tr: 'T·R: turn, then move', rt: 'R·T: move, then turn' }
const htParams = (p: Params) => ({ yaw: n(p, 'yaw') * DEG, pitch: n(p, 'pitch') * DEG, t: [n(p, 'tx'), 0.25, 0.3] as P3, tr: pick(ORDER, p.order, 'tr') === 'tr' })
type HtQ = ReturnType<typeof htParams>
const htRot = (q: HtQ) => quatOf(chain4(rotAbout4(2, q.yaw), rotAbout4(1, q.pitch)))
const htFinal = (q: HtQ, tr = q.tr): Mat4 => (tr ? chain4(trans4(q.t), quatTf(htRot(q))) : chain4(quatTf(htRot(q)), trans4(q.t)))
const ID_Q: Quat = [1, 0, 0, 0]
const T_CAM: P3 = [HT.cam, 0, 0]

/** Pose `t` s into the loop: rest, first move, pause, second move, hold. Fixed-axes reading: right-hand factor first. */
function htAt(q: HtQ, t: number): { m: Mat4; step: number; u: number } {
  const c = HT.cycle
  let k = 0
  let s = t
  while (k < c.length - 1 && s >= c[k]) s -= c[k++]
  const u = Math.min(1, s / c[k])
  const first = k < 1 ? 0 : k > 1 ? 1 : u
  const second = k < 3 ? 0 : k > 3 ? 1 : u
  const R = quatTf(slerp(ID_Q, htRot(q), q.tr ? first : second))
  const T = trans4(q.t.map((v) => v * (q.tr ? second : first)) as P3)
  return { m: q.tr ? chain4(T, R) : chain4(R, T), step: k, u }
}

export const homogeneousTransforms: Lesson = {
  id: 'coordinate-frames-homogeneous-transforms',
  title: 'Homogeneous transforms',
  tagline: 'Turn and move in one 4×4 matrix',
  formula: (p) => {
    const q = htParams(p)
    const m = htFinal(q)
    return `T = [R t; 0 0 0 1] · p_world = T · (p_B, 1) · ${q.tr ? 'T = Trans(t)·R: B turns about its own origin, then moves by t' : 'T = R·Trans(t): B moves by t, then the whole move turns about the world origin'} · B at ${xyz(originOf(m))} m · T⁻¹ = [Rᵀ −Rᵀt; 0 0 0 1]`
  },
  legend: [
    AXES_LEGEND,
    { color: RING, label: 'Origin column t · camera target p', shape: 'dot' },
    { color: HEAT, label: 'Path of B\'s origin', shape: 'dot' },
    { color: GREY, label: 'Where the other order ends', shape: 'dot' },
  ],
  points: [
    'A frame in 3D is a rotation R (3×3) plus a translation t. Stack them into one 4×4, T = [R t; 0 0 0 1], and write points as (x, y, z, 1): then T·p = R·p + t, rotation and shift in one multiply. That is a homogeneous transform.',
    'Read T by columns: the first three are B\'s x, y, z axes written in world coordinates (red, green, blue in the matrix), the fourth is where B\'s origin sits. The bottom row is always 0 0 0 1.',
    'Chaining is multiplying: T(world←C) = T(world←B)·T(B←C). Order matters. T·R turns the camera in place and then moves it; R·T moves it first and then swings the whole move about the world origin, landing somewhere else (grey). Read right to left in world axes, or left to right in the moving frame.',
    'Undoing a rigid move needs no general matrix inverse: T⁻¹ = [Rᵀ −Rᵀt; 0 0 0 1]. Here the yaw and pitch become a quaternion and are interpolated by slerp, so the turn plays at a constant rate whatever the angles.',
  ],
  controls: [
    { kind: 'choice', key: 'order', options: opts(ORDER), initial: 'tr' },
    { kind: 'slider', key: 'yaw', label: 'Yaw (about z)', min: -180, max: 180, step: 5, initial: 90, format: (v) => `${v}°` },
    { kind: 'slider', key: 'pitch', label: 'Pitch (about y, + tips x down)', min: -60, max: 60, step: 5, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'tx', label: 'Move t along X', min: 0, max: 0.6, step: 0.05, initial: 0.45, format: (v) => `${v.toFixed(2)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, HT.at, HT.k, 0.42, -0.55)
    floorMat(g, HT.x, HT.y)
    const world = frameTriad(g, 0.32, 'world', WORLD_C, 0.008, { letters: 'XYZ', size: 0.05 })
    const ghost = frameTriad(g, 0.16, '', GREY, 0.006)
    const ghostMat = new THREE.MeshStandardMaterial({ color: GREY, emissive: GREY, emissiveIntensity: 0.4, transparent: true, opacity: 0.45, depthWrite: false })
    ghost.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = ghostMat
    })
    const ghostTag = liveLabel(ghost.group, [0.06, 0, 0.22], { size: 0.06, color: GREY })
    const B = add(g, new THREE.Group())
    box(B, [0.05, 0.07, 0.045], mat('#2a2c32', { rough: 0.4 }), [-0.01, 0, 0])
    cylinder(B, 0.018, 0.03, mat('#14161b', { rough: 0.2 }), [0.025, 0, 0], 'x', 20)
    const bTri = frameTriad(B, 0.2, 'B', B_FIELD, 0.007, { letters: 'xyz', size: 0.05 })
    const ray = addRod(B, glowMat(RING, 0.6))
    stretchRod(ray, [0.04, 0, 0], T_CAM, 0.003)
    add(B, mesh(new THREE.SphereGeometry(0.014, 14, 10), glowMat(RING, 1.2)), T_CAM).castShadow = false
    const tVec = stretchArrow(g, RING, 0.005)
    const path = pointCloud(g, 160, 0.007)

    const MX = { x: 9.4, y: 0.9, cell: 1.75, size: 0.42 }
    const grid = matrixGrid(scene, [MX.x, MX.y, 0], 4, 4, { cell: MX.cell, size: MX.size })
    const COL = ['x_B', 'y_B', 'z_B', 't']
    COL.forEach((c, i) => addLabel(scene, c, [MX.x + (i - 1.5) * MX.cell, MX.y + grid.h / 2 + 0.6, 0.2], i < 3 ? AXIS_RGB[i] : RING, 0.36))
    addLabel(scene, 'T  =', [MX.x - grid.w / 2 - 0.9, MX.y, 0.2], LABEL, 0.5, 'right')
    const pLine = liveLabel(scene, [1.2, MX.y - grid.h / 2 - 1.2, 0.2], { size: 0.34, align: 'left' })
    const invLine = liveLabel(scene, [1.2, MX.y - grid.h / 2 - 1.95, 0.2], { size: 0.34, align: 'left' })

    const st = { t: 0, key: '', shown: 0, last: 0 }
    return {
      scene,
      view: { center: [-0.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = htParams(p)
        const key = `${q.yaw}|${q.pitch}|${q.t[0]}|${q.tr}`
        const total = HT.cycle.reduce((a, b) => a + b)
        if (key !== st.key) Object.assign(st, { key, t: 0, shown: 0 })
        st.t += dt
        if (st.t >= total) Object.assign(st, { t: 0, shown: 0 })
        const { m, step, u } = htAt(q, st.t)
        setTf(B, m)
        const o = originOf(m)
        tVec([0, 0, 0], o)
        if (step >= 1 && st.shown < 160 && st.t - st.last > 0.03) {
          st.last = st.t
          path.set(st.shown++, o, HEAT, 0.8)
          path.show(st.shown)
        }
        if (step === 0) path.show(0)
        setTf(ghost.group, htFinal(q, !q.tr))
        ghostTag.set(q.tr ? 'R·T' : 'T·R', GREY)
        world.face()
        bTri.face()
        ghost.face()
        faceFront(ghostTag.group)

        const cols = [AXIS_RGB[0], AXIS_RGB[1], AXIS_RGB[2], RING]
        grid.set(
          m.map((v, i) => (i >= 12 ? String(v) : f2(v))),
          m.map((_, i) => (i >= 12 ? GREY : cols[i % 4])),
        )
        const pw = apply4(m, T_CAM)
        pLine.set(`p_B = (0.30, 0, 0)  →  T · p_B = ${xyz(pw)}`, RING)
        invLine.set(`back: T⁻¹ · p_world = ${xyz(apply4(invert4(m), pw))}`, GREY)
        const words = q.tr ? ['at the world origin, no rotation: T = I', 'R: turning B about its own origin (slerp)', 'pause', 'Trans(t): moving B along world axes', 'T = Trans(t)·R'] : ['at the world origin, no rotation: T = I', 'Trans(t): moving B along world axes', 'pause', 'R: swinging the moved B about the world origin', 'T = R·Trans(t)']
        status.set(`${q.tr ? 'T·R' : 'R·T'} · yaw ${deg(q.yaw)} · pitch ${deg(q.pitch)} · t = ${xyz(q.t)} m`, LABEL)
        event.set(`step ${Math.min(2, Math.ceil(step / 2))} of 2 · ${words[step]}${step === 1 || step === 3 ? ` ${Math.round(u * 100)} %` : ''}`, step === 4 ? RING : step === 0 ? GREY : HEAT)
        sub.set(`B's origin ends at ${xyz(originOf(htFinal(q)))} · the other order at ${xyz(originOf(htFinal(q, !q.tr)))} · floor tape 0.5 m`, GREY)
      },
      readouts: (p) => {
        const q = htParams(p)
        const a = originOf(htFinal(q))
        const b = originOf(htFinal(q, !q.tr))
        const gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        return [
          { label: 'B origin (column t)', value: xyz(a) },
          { label: 'B x axis (column 1)', value: xyz(axisOf(htFinal(q), 0)) },
          { label: 'Target in world', value: xyz(apply4(htFinal(q), T_CAM)) },
          { label: 'Other order lands', value: `${f2(gap)} m away`, tone: gap > 0.01 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Frame tree: where is the cup in the wrist camera? Up the tree to the common ancestor, then down with inverses. ---

const FT = { at: [-8.6, -3.4, 0] as V3, k: 11.5, hop: 0.9, hold: 2.2 }
const TARGETS = { camera: 'In camera', boom: 'In boom', base: 'In base', world: 'In world', table: 'In table' }
const ftParams = (p: Params) => ({ yaw: n(p, 'yaw') * DEG, lift: n(p, 'lift') * DEG, target: pick(TARGETS, p.target, 'camera') })
const NODE: V3 = [2.9, 1.05, 0.5]
const TREE_AT: Record<string, V3> = {
  world: [9.5, 4.4, 0],
  table: [5.6, 2.1, 0],
  cup: [5.6, -0.2, 0],
  base: [13.4, 2.1, 0],
  turret: [13.4, -0.2, 0],
  boom: [13.4, -2.5, 0],
  camera: [13.4, -4.8, 0],
}
const hopText = (tree: ReturnType<typeof deskTree>, from: string, to: string) => (tree[from].parent === to ? `T(${to}←${from})` : `T(${from}←${to})⁻¹`)

export const coordFrameTree: Lesson = {
  id: 'coordinate-frames-frame-tree',
  title: 'Frame tree',
  tagline: 'Up to a shared parent, then back down',
  formula: (p) => {
    const q = ftParams(p)
    const tree = deskTree(q.yaw, q.lift)
    const { up, down } = framePath(tree, 'cup', q.target)
    const hops = [...up, ...down]
    const factors = hops.slice(1).map((f, i) => hopText(tree, hops[i], f)).reverse()
    return `T(${q.target}←cup) = ${factors.join(' · ') || 'I'} · cup in ${q.target} = ${xyz(originOf(frameLookup(tree, q.target, 'cup')))} m`
  },
  legend: [
    AXES_LEGEND,
    { color: HEAT, label: 'Up an edge: × the stored T(parent←child)', shape: 'dot' },
    { color: B_FIELD, label: 'Down an edge: × its inverse', shape: 'dot' },
    { color: RING, label: 'Cup seen from the chosen frame', shape: 'dot' },
  ],
  points: [
    'Every part of a robot cell gets its own frame, and each frame stores only its pose in its parent: the table in the world, the cup on the table, the turret on the base, the camera at the tip of the boom. Joints change just their own edge (yaw turns turret, lift tilts boom); everything below follows.',
    'Because each frame has exactly one parent, the frames form a tree, and between any two there is exactly one path: up to the first shared ancestor, then down. Here the cup and the wrist camera meet only at the world.',
    'Walking up an edge multiplies by the stored transform T(parent←child). Walking down needs the inverse, T⁻¹ = [Rᵀ −Rᵀt; 0 1]. Multiply the hops together and you get one 4×4 that takes cup coordinates straight into camera coordinates: the arm needs exactly that to reach for what the camera sees.',
    'The answer depends on the frame you ask in, but the geometry does not: the distance from the camera to the cup is the same in every frame. Move the arm and only the arm\'s edges change; the cup\'s pose in the world never does. ROS keeps such a tree in tf2 (see TF & URDF).',
  ],
  controls: [
    { kind: 'choice', key: 'target', options: opts(TARGETS), initial: 'camera' },
    { kind: 'slider', key: 'yaw', label: 'Turret yaw', min: -90, max: 90, step: 5, initial: 10, format: (v) => `${v}°` },
    { kind: 'slider', key: 'lift', label: 'Boom lift', min: -20, max: 60, step: 5, initial: 25, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, FT.at, FT.k, 0.4, -0.7)
    floorMat(g, [-0.3, 1], [-0.5, 0.5])
    const { table: tb, cup } = DESK
    const grey = mat('#8a8f99', { metal: 0.3, rough: 0.45 })
    cylinder(g, 0.05, DESK.pedestal, mat('#3a3d45', { rough: 0.5 }), [0, 0, DESK.pedestal / 2], 'z', 24)
    const frames: Record<string, THREE.Group> = Object.fromEntries(Object.keys(TREE_AT).map((k) => [k, add(g, new THREE.Group())]))
    cylinder(frames.turret, 0.045, DESK.turret, grey, [0, 0, -DESK.turret / 2], 'z', 24)
    box(frames.turret, [0.05, 0.06, DESK.shoulder], mat('#f2c230', { rough: 0.5 }), [0, 0, DESK.shoulder / 2])
    box(frames.boom, [DESK.boom, 0.03, 0.03], mat('#f2c230', { rough: 0.5 }), [DESK.boom / 2, 0, 0])
    box(frames.camera, [0.04, 0.05, 0.035], mat('#2a2c32', { rough: 0.4 }), [0, 0, 0])
    cylinder(frames.camera, 0.013, 0.02, mat('#14161b', { rough: 0.2 }), [0.028, 0, 0], 'x', 16)
    box(frames.table, [tb.w, tb.d, 0.02], mat('#b98a5a', { rough: 0.7 }), [0, 0, -0.01])
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(frames.table, [0.025, 0.025, tb.z - 0.02], mat('#6b4e33', { rough: 0.7 }), [sx * (tb.w / 2 - 0.03), sy * (tb.d / 2 - 0.03), -(tb.z + 0.02) / 2])
    cylinder(frames.cup, cup.r, cup.h, mat('#e8524a', { rough: 0.5 }), [0, 0, cup.h / 2], 'z', 24)
    const tris = Object.fromEntries(
      Object.keys(TREE_AT).map((k) => [k, frameTriad(frames[k], k === 'world' ? 0.2 : 0.09, k, LABEL, k === 'world' ? 0.005 : 0.0035, { size: 0.035 })]),
    )
    tris.cup.label.group.position.set(0.05, 0, cup.h + 0.04)
    tris.world.label.group.position.set(0.02, -0.26, 0.03)
    const toCup = stretchArrow(g, RING, 0.005)
    const legs = AXIS_RGB.map((c) => addRod(g, glowMat(c, 1)))

    const nodes = Object.fromEntries(Object.entries(TREE_AT).map(([k, at]) => [k, moduleBlock(scene, at, NODE, k)]))
    const edgeMats: Record<string, THREE.MeshStandardMaterial> = {}
    const tree0 = deskTree(0, 0)
    for (const [k, at] of Object.entries(TREE_AT)) {
      const par = tree0[k].parent
      if (!par) continue
      const pa = TREE_AT[par]
      const m = (edgeMats[k] = glowMat(GREY, 0.3))
      const mid = (pa[1] + at[1]) / 2 + 0.05
      if (pa[0] === at[0]) rodBetween(scene, [at[0], pa[1] - NODE[1] / 2, -0.1], [at[0], at[1] + NODE[1] / 2, -0.1], m, 0.08)
      else {
        rodBetween(scene, [pa[0], pa[1] - NODE[1] / 2, -0.1], [pa[0], mid, -0.1], m, 0.08)
        rodBetween(scene, [pa[0], mid, -0.1], [at[0], mid, -0.1], m, 0.08)
        rodBetween(scene, [at[0], mid, -0.1], [at[0], at[1] + NODE[1] / 2, -0.1], m, 0.08)
      }
    }
    const token = add(scene, mesh(new THREE.SphereGeometry(0.24, 16, 12), glowMat(RING, 1.3)))
    token.castShadow = false

    const st = { yaw: NaN, lift: 0, t: 0, key: '' }
    return {
      scene,
      view: { center: [0, 0, 0], radius: 60, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = ftParams(p)
        if (Number.isNaN(st.yaw)) Object.assign(st, { yaw: q.yaw, lift: q.lift })
        st.yaw = glide(dt, st.yaw, q.yaw, 4)
        st.lift = glide(dt, st.lift, q.lift, 4)
        const tree = deskTree(st.yaw, st.lift)
        for (const k of Object.keys(TREE_AT)) setTf(frames[k], frameWorld(tree, k))
        Object.values(tris).forEach((t) => t.face())

        const c = originOf(frameLookup(tree, q.target, 'cup'))
        const tw = frameWorld(tree, q.target)
        const o = originOf(tw)
        const cw = originOf(frameWorld(tree, 'cup'))
        toCup(o, cw)
        let at = o
        AXIS_RGB.forEach((_, i) => {
          const ax = axisOf(tw, i as 0 | 1 | 2)
          const next = at.map((v, j) => v + ax[j] * c[i]) as P3
          stretchRod(legs[i], at, next, 0.004)
          at = next
        })
        for (const [k, t] of Object.entries(tris)) t.label.set(k === q.target || k === 'cup' || k === 'world' ? k : '', k === q.target || k === 'cup' ? RING : LABEL)

        const { up, down } = framePath(tree, 'cup', q.target)
        const hops = [...up, ...down]
        const key = q.target
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        const nHop = hops.length - 1
        const total = nHop * FT.hop + FT.hold
        st.t = (st.t + dt) % total
        const h = Math.min(nHop, st.t / FT.hop)
        const k = Math.min(nHop - 1, Math.floor(h))
        const u = h - k
        const a = TREE_AT[hops[k]]
        const b = TREE_AT[hops[k + 1]]
        token.position.set(a[0] + (b[0] - a[0]) * u - NODE[0] / 2 - 0.35, a[1] + (b[1] - a[1]) * u, 0.4)
        const upSet = new Set(up.slice(0, -1))
        for (const [name, m] of Object.entries(edgeMats)) {
          const onUp = upSet.has(name)
          const onDown = down.includes(name)
          const lit = (onUp && up.indexOf(name) < h) || (onDown && up.length - 1 + down.indexOf(name) < h)
          const col = onUp ? HEAT : onDown ? B_FIELD : GREY
          m.color.set(col)
          m.emissive.set(col)
          m.emissiveIntensity = onUp || onDown ? (lit ? 1.1 : 0.35) : 0.15
        }
        for (const [name, node] of Object.entries(nodes)) {
          const i = hops.indexOf(name)
          node(dt, name === 'cup' || name === q.target ? RING : i < 0 ? GREY : i < up.length ? HEAT : B_FIELD, i < 0 ? 0.1 : i <= h + 0.5 ? 1 : 0.3)
        }
        const r = Math.hypot(...c)
        status.set(`cup in ${q.target}: ${xyz(c)} m · ${f2(r)} m from its origin`, RING)
        sub.set(`${hops.join(' → ')} · ${nHop} hop${nHop === 1 ? '' : 's'}, meeting at ${up.at(-1)}`, GREY)
        const done = st.t >= nHop * FT.hop
        const from = hops[k]
        const to = hops[k + 1]
        event.set(
          done ? `one 4×4 T(${q.target}←cup): the cup in ${q.target} coordinates` : tree[from].parent === to ? `up ${from} → ${to}: × ${hopText(tree, from, to)}` : `down ${from} → ${to}: × ${hopText(tree, from, to)}`,
          done ? RING : tree[from].parent === to ? HEAT : B_FIELD,
        )
      },
      readouts: (p) => {
        const q = ftParams(p)
        const tree = deskTree(q.yaw, q.lift)
        const c = originOf(frameLookup(tree, q.target, 'cup'))
        const cam = originOf(frameLookup(tree, 'camera', 'cup'))
        const { up, down } = framePath(tree, 'cup', q.target)
        return [
          { label: `Cup in ${q.target}`, value: `${xyz(c)} m` },
          { label: 'Hops', value: `${up.length - 1} up, ${down.length} down` },
          { label: 'Camera to cup', value: `${f2(Math.hypot(...cam))} m (any frame)` },
          { label: 'In front of camera', value: cam[0] > 0 ? `yes, ${f2(cam[0])} m ahead` : 'no, behind it', tone: cam[0] > 0 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
