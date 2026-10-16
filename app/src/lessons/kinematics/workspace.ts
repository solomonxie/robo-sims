import * as THREE from 'three/webgpu'
import { DEG, Mat4, ReachSample, SERVO_ARM, SERVO_ARM_DIMS, SerialArm, armJacobian, cellMeasure, dexterity, dexterityGrid, dexterousBand, headingReach, headingSet, manipulability, planarArm, reachCloud, toDeg, twoLinkIk, twoLinkRadii, wrapPi, lerpJoints } from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, HIGH_V, LABEL, LOW_V, POWER, RING, SIDE_SCOPE, addLabel, dotPen, floorMat, liveLabel, memoBy, pointCloud, scopeLabels, serialArm, sideScope, statusHeader, stretchArrow, zUp, armPlate, SERVO_ARM_LOOK } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const cm = (m: number) => `${Math.round(m * 100)} cm`
const cm2 = (a: number) => `${Math.round(a * 1e4)} cm²`
const deg0 = (a: number) => `${Math.round(toDeg(a)).toString().replace('-', '−')}°`
const cmSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 1, initial, format: (v: number) => `${v} cm` })
const degSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 5, initial, format: (v: number) => `±${v}°` })
const ramp = (f: number, out: THREE.Color) => {
  const u = Math.max(0, Math.min(1, f))
  return out.setHSL((0.63 + u * 0.51) % 1, 0.9, 0.55 + u * 0.08)
}

/** Colour bar dots low → high with end labels. */
function colorBar(scene: THREE.Object3D, at: V3, w: number, lo: string, hi: string) {
  const bar = pointCloud(scene, 40, 0.13)
  const c = new THREE.Color()
  for (let i = 0; i < 40; i++) bar.set(i, [at[0] + (w * i) / 39, at[1], at[2]], ramp(i / 39, c))
  bar.show(40)
  addLabel(scene, lo, [at[0], at[1] - 0.5, 0.2], GREY, 0.24, 'left')
  addLabel(scene, hi, [at[0] + w, at[1] - 0.5, 0.2], GREY, 0.24, 'right')
}

// --- Reach envelope: sweep the joints through their limits and keep every tool point. ---

const RE = { planar: { at: [-8.4, -2.4, 0] as V3, k: 13 }, servo: { at: [-8.4, -4.4, 0] as V3, k: 16 }, sweep: 12, hold: 2.5, dot: 0.0042, scope: { y: -4.9, h: 2.6 } }
const RE_ARMS = { planar: '2-link, side view', servo: '4-DOF servo arm' }
const TABLE = { open: 'Open air', table: 'Table cuts it' }
const reParams = (p: Params) => ({ arm: pick(RE_ARMS, p.arm, 'planar'), l1: n(p, 'upper') / 100, l2: n(p, 'fore') / 100, lim: n(p, 'elbow') * DEG, table: pick(TABLE, p.table, 'open') === 'table' })
type ReP = ReturnType<typeof reParams>
const reKey = (q: ReP) => `${q.arm}|${q.l1}|${q.l2}|${q.lim}|${q.table}`

const reArm = (q: ReP): SerialArm => {
  if (q.arm === 'planar') return { ...planarArm([q.l1, q.l2]), limits: [q.table ? [0, Math.PI] : [-Math.PI, Math.PI], [-q.lim, q.lim]] }
  const rows = SERVO_ARM.rows.map((r) => ({ ...r }))
  rows[1].a = q.l1
  rows[2].a = q.l2
  return { ...SERVO_ARM, rows, limits: [SERVO_ARM.limits[0], SERVO_ARM.limits[1], [-q.lim, q.lim], [0, 0]] }
}
const aboveTable = (planar: boolean) => (f: Mat4[]) => f.slice(planar ? 1 : 2).every((m) => m[planar ? 7 : 11] >= -1e-9)
/** Second link of the equivalent two-link arm: the servo hand is held straight, in line with the forearm. */
const outerLink = (q: ReP) => q.l2 + (q.arm === 'servo' ? SERVO_ARM_DIMS.hand : 0)

const reCloud = memoBy(reKey, (q: ReP) => {
  const arm = reArm(q)
  const isP = q.arm === 'planar'
  const keep = q.table ? aboveTable(isP) : undefined
  const cloud = reachCloud(arm, isP ? [121, 61] : [19, 19, 19, 1], { keep })
  const ws = cloud.map((s) => (isP ? Math.abs(Math.sin(s.q[1])) : manipulability(armJacobian(arm, s.q)).w))
  const wMax = Math.max(1e-12, ...ws)
  const tour = reachCloud(arm, isP ? [25, 21] : [13, 7, 9, 1], { keep, snake: true })
  const radii = twoLinkRadii(q.l1, outerLink(q), q.lim)
  const shoulderZ = isP ? 0 : SERVO_ARM_DIMS.base
  const rs = cloud.map((s) => Math.hypot(s.p[0], s.p[1], s.p[2] - shoulderZ))
  const rMin = rs.reduce((a, b) => Math.min(a, b), Infinity)
  const rMax = rs.reduce((a, b) => Math.max(a, b), 0)
  const zs = cloud.map((s) => s.p[2])
  let area = 0
  let full = 0
  if (isP) {
    area = cellMeasure(reachCloud(arm, [300, 180], { keep }).map((s) => [s.p[0], s.p[1]]), 0.005)
    full = Math.PI * ((q.l1 + q.l2) ** 2 - (q.l1 - q.l2) ** 2)
  }
  return { arm, cloud, w: ws.map((w) => w / wMax), tour, radii, rMin, rMax, zMin: Math.min(...zs), zMax: Math.max(...zs), area, full }
})
const reTour = (c: ReturnType<typeof reCloud>, t: number) => {
  const u = Math.min(1, t / RE.sweep) * (c.tour.length - 1)
  const i = Math.min(c.tour.length - 2, Math.floor(u))
  return c.tour.length < 2 ? (c.tour[0]?.q ?? [0, 0, 0, 0]) : lerpJoints(c.tour[i].q, c.tour[i + 1].q, u - i)
}

export const workspaceReach: Lesson = {
  id: 'workspace-reach-envelope',
  title: 'Reach envelope',
  tagline: 'Every point the hand can touch',
  formula: (p) => {
    const q = reParams(p)
    const r = twoLinkRadii(q.l1, outerLink(q), q.lim)
    return `sample q over the joint limits, x = FK(q), keep every x · outer R = L1 + L2 = ${cm(r.outer)} · hole r = √(L1² + L2² + 2·L1·L2·cos θ2max) = ${cm(r.inner)}${q.table ? ' · table: drop poses with a joint below it' : ''}`
  },
  legend: [
    { color: RING, label: 'Reachable tool point, high manipulability w', shape: 'dot' },
    { color: LOW_V, label: 'Reachable, low w: near the edge (singular)', shape: 'dot' },
    { color: GREY, label: 'Outer reach and inner hole rings', shape: 'dot' },
    { color: HIGH_V, label: 'Elbow at its limit', shape: 'dot' },
  ],
  points: [
    'The workspace is every point the tool can reach. The plain way to find it: step each joint through its range, run forward kinematics (see Forward kinematics) for every combination and keep the tool points. Watch the arm sweep shoulder by shoulder while the cloud fills in.',
    'A two-link arm with free joints reaches a ring: out to R = L1 + L2 (arm straight) and in to |L1 − L2| (arm folded back). Equal links close the hole and the arm can touch its own shoulder. Shrink the forearm and the hole grows.',
    'Joint limits cut the shape. An elbow that only bends ±θ2max cannot fold all the way, so the hole grows to r = √(L1² + L2² + 2·L1·L2·cos θ2max). A table under the base removes every pose that puts the elbow or hand below it, leaving roughly a half ring. Real cells also cut out pillars, fixtures and the robot itself.',
    'The colour is manipulability w (see Jacobian: Manipulability). It drops to 0 at the outer edge and at the hole, where the arm is straight or folded and loses a direction of motion. Being inside the workspace is not enough: place the work where w is high, well away from the edges. The servo arm shows the 3D version, a thick shell around its base.',
  ],
  controls: [
    { kind: 'choice', key: 'arm', options: opts(RE_ARMS), initial: 'planar' },
    { kind: 'choice', key: 'table', options: opts(TABLE), initial: 'open' },
    cmSlider('upper', 'Upper arm L1', 10, 30, 24),
    cmSlider('fore', 'Forearm L2', 4, 22, 16),
    degSlider('elbow', 'Elbow limit θ2max', 0, 180, 150),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const pg = add(scene, new THREE.Group(), RE.planar.at)
    pg.scale.setScalar(RE.planar.k)
    armPlate(pg, 0.1, 0.14)
    const table = box(pg, [1.1, 0.01, 0.1], mat('#4a3b2c', { rough: 0.8 }), [0, -0.012, 0])
    const sg = zUp(scene, RE.servo.at, RE.servo.k, 0.32, -0.6)
    floorMat(sg, [-0.55, 0.55], [-0.55, 0.55])
    const lifted = add(sg, new THREE.Group(), [0, 0, 0.002])
    let rigs: { key: string; planar: ReturnType<typeof serialArm>; servo: ReturnType<typeof serialArm> } | null = null
    const pCloud = pointCloud(pg, 7400, RE.dot)
    const sCloud = pointCloud(lifted, 6900, RE.dot * 1.4)
    const pPen = dotPen(pg, 2400, 0.0035)
    const sPen = dotPen(lifted, 600, 0.004)
    const color = new THREE.Color()

    const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [X0, 2.6 - i * 0.7, 0.2], { size: 0.32, align: 'left' }))
    colorBar(scene, [X0, -0.6, 0.2], 6, 'w = 0 (edge)', 'w high')
    const { y: sy, h: sh } = RE.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 4], zeroAt: 0 })
    const curve = plot.trace(GREY, { samples: 91, radius: 0.08 })
    const mark = plot.trace(RING, { samples: 2, radius: 0.16 })
    scopeLabels(scene, sy, sh, null, 'hole radius r vs elbow limit θ2max (0 … R)', '')
    addLabel(scene, '0°', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, '180°', [X0 + SIDE_SCOPE.w, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'right')

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = reParams(p)
        const key = reKey(q)
        const c = reCloud(q)
        const isP = q.arm === 'planar'
        if (!rigs || rigs.key !== `${q.l1}|${q.l2}`) {
          if (rigs) [rigs.planar, rigs.servo].forEach((r) => r.group.removeFromParent())
          rigs = { key: `${q.l1}|${q.l2}`, planar: serialArm(pg, reArm({ ...q, arm: 'planar' }), { w: 0.04, t: 0.028 }), servo: serialArm(lifted, reArm({ ...q, arm: 'servo' }), SERVO_ARM_LOOK) }
        }
        const cloud = isP ? pCloud : sCloud
        if (key !== st.key) {
          Object.assign(st, { key, t: 0 })
          c.cloud.forEach((s: ReachSample, i: number) => cloud.set(i, isP ? [s.p[0], s.p[1], 0.01] : s.p, ramp(c.w[i], color)))
        }
        st.t += dt
        if (st.t > RE.sweep + RE.hold) st.t = 0
        pg.visible = isP
        sg.parent!.visible = !isP
        table.visible = q.table

        const qs = reTour(c, st.t)
        const rig = isP ? rigs.planar : rigs.servo
        rig.set(qs)
        const elbowAt = Math.abs(qs[1 + (isP ? 0 : 1)]) >= q.lim - 1e-3
        rig.glow(isP ? 1 : 2, elbowAt ? 1 : 0)
        const lead = qs[0]
        const done = st.t >= RE.sweep
        const ahead = c.cloud.findIndex((s) => s.q[0] > lead + 1e-9)
        cloud.show(done || ahead < 0 ? c.cloud.length : ahead)
        ;(isP ? sCloud : pCloud).show(0)

        const pen = isP ? pPen : sPen
        pen.begin()
        if (isP) {
          pen.arc([0, 0, 0.02], c.radii.outer, 0, 2 * Math.PI, GREY, 0.8)
          if (c.radii.inner > 0.004) pen.arc([0, 0, 0.02], c.radii.inner, 0, 2 * Math.PI, elbowAt ? HIGH_V : GREY, 0.8)
        } else {
          const z = SERVO_ARM_DIMS.base
          pen.arc([0, 0, z], c.radii.outer, -Math.PI / 2, Math.PI, GREY, 0.8, [1, 0, 0], [0, 0, 1])
          if (c.radii.inner > 0.004) pen.arc([0, 0, z], c.radii.inner, -Math.PI / 2, Math.PI, elbowAt ? HIGH_V : GREY, 0.8, [1, 0, 0], [0, 0, 1])
        }
        pen.end()
        sCloud.mesh.visible = !isP

        lines[0].set(`R = L1 + L2${isP ? '' : ' + hand'} = ${cm(c.radii.outer)}   (sampled ${cm(c.rMax)})`, LABEL)
        lines[1].set(`hole r = ${cm(c.radii.inner)}   (sampled ${cm(c.rMin)})`, q.lim < Math.PI - 1e-6 ? HIGH_V : LABEL)
        lines[2].set(isP ? `area ${cm2(c.area)} = ${Math.round((c.area / c.full) * 100)} % of the free ring` : `tool height ${cm(c.zMin)} … ${cm(c.zMax)}`, isP ? RING : LABEL)
        lines[3].set(`${c.cloud.length} sampled poses${q.table ? ' kept above the table' : ''}`, GREY)

        const l2 = outerLink(q)
        const ths = Array.from({ length: 91 }, (_, i) => i * 2 * DEG)
        curve.points(ths.map((_, i) => i / 90), ths.map((th) => (twoLinkRadii(q.l1, l2, th).inner / (q.l1 + l2)) * sh - sh / 2))
        const u = q.lim / Math.PI
        const yv = (c.radii.inner / (q.l1 + l2)) * sh - sh / 2
        mark.points([u, u], [yv, yv])

        status.set(`reach ${cm(c.radii.inner)} … ${cm(c.radii.outer)} · ${c.cloud.length} poses${isP ? ` · area ${cm2(c.area)}` : ''}`, LABEL)
        sub.set(isP ? `side view · L1 ${cm(q.l1)}, L2 ${cm(q.l2)}, elbow ±${deg0(q.lim)} · shoulder ${q.table ? '0…180°' : 'free'}` : `servo arm: base ±90°, shoulder 0…180°, elbow ±${deg0(q.lim)}, wrist straight · floor tape 0.5 m`, GREY)
        event.set(done ? 'sweep done: the whole cloud is the workspace' : elbowAt ? 'elbow at its limit: it cannot fold further, so the hole stays' : `sweeping: ${isP ? 'shoulder' : 'base'} at ${deg0(lead)}, cloud fills behind it`, done ? RING : elbowAt ? HIGH_V : LABEL)
      },
      readouts: (p) => {
        const q = reParams(p)
        const c = reCloud(q)
        return [
          { label: 'Outer reach R', value: cm(c.radii.outer) },
          { label: 'Inner hole r', value: cm(c.radii.inner), tone: c.radii.inner > 0.05 ? 'warn' : 'ok' },
          q.arm === 'planar' ? { label: 'Area', value: `${cm2(c.area)} (${Math.round((c.area / c.full) * 100)} %)` } : { label: 'Height span', value: `${cm(c.zMin)} … ${cm(c.zMax)}` },
          { label: 'Sampled poses', value: `${c.cloud.length}` },
        ]
      },
    }
  },
}

// --- Dexterity: at each point, how many tool headings can the arm reach? ---

const DX = { at: [-8.4, -2.4, 0] as V3, k: 13, L: [0.22, 0.16] as [number, number], elbow: 160 * DEG, cell: 0.014, dot: 0.0052, probe: 30 * DEG, period: 14, spoke: 0.05, scope: { y: -4.9, h: 2.6 } }
const TASKS = { any: 'Any heading', down: 'Grip from above', side: 'Push forward' }
const TASK_RANGE: Record<keyof typeof TASKS, [number, number, number]> = { any: [-Math.PI, 2 * Math.PI, 36], down: [-120 * DEG, 60 * DEG, 13], side: [-30 * DEG, 60 * DEG, 13] }
const dxParams = (p: Params) => ({ task: pick(TASKS, p.task, 'any'), l3: n(p, 'hand') / 100, wrist: n(p, 'wrist') * DEG })
type DxP = ReturnType<typeof dxParams>
const dxKey = (q: DxP) => `${q.task}|${q.l3}|${q.wrist}`
const dxLinks = (q: DxP): [number, number, number] => [DX.L[0], DX.L[1], q.l3]
const dxLimits = (q: DxP): [number, number][] => [[-Math.PI, Math.PI], [-DX.elbow, DX.elbow], [-q.wrist, q.wrist]]
const dxHeadings = (q: DxP) => headingSet(TASK_RANGE[q.task][2], TASK_RANGE[q.task][0], TASK_RANGE[q.task][1])
const dxGrid = memoBy(dxKey, (q: DxP) => {
  const l = dxLinks(q)
  const R = l[0] + l[1] + l[2]
  const cells = dexterityGrid(l, dxLimits(q), R, DX.cell, dxHeadings(q))
  const a = DX.cell * DX.cell
  const best = cells.filter((c) => c.d >= Math.max(...cells.map((x) => x.d)) - 1e-9)
  const [cx, cy] = best.reduce(([x, y], c) => [x + c.x / best.length, y + c.y / best.length], [0, 0])
  const dir = Math.hypot(cx, cy) > 0.05 ? Math.atan2(cy, cx) : DX.probe
  const radial = Array.from({ length: 81 }, (_, i) => (i / 80) * R).map((r) => dexterity(headingReach(l, dxLimits(q), r * Math.cos(dir), r * Math.sin(dir), dxHeadings(q))))
  return { R, cells, reach: cells.length * a, dex: cells.filter((c) => c.d >= 1).length * a, radial, dir }
})
const probeR = (R: number, t: number) => R * 1.04 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / DX.period))

export const workspaceDexterity: Lesson = {
  id: 'workspace-dexterity',
  title: 'Dexterity',
  tagline: 'Reaching a point from every side',
  formula: (p) => {
    const q = dxParams(p)
    const b = dexterousBand(DX.L[0], DX.L[1], q.l3)
    return `dexterity(x) = share of tool headings φ with an IK solution inside the limits · free joints, every φ: |L1 − L2| + L3 ≤ r ≤ L1 + L2 − L3 = ${b.empty ? 'none' : `${cm(b.inner)} … ${cm(b.outer)}`}`
  },
  legend: [
    { color: RING, label: 'Dexterous: every heading of the task reaches', shape: 'dot' },
    { color: LOW_V, label: 'Reachable from only a few headings', shape: 'dot' },
    { color: POWER, label: 'Heading that works at the probe', shape: 'dot' },
    { color: HIGH_V, label: 'Heading that does not', shape: 'dot' },
  ],
  points: [
    'Reaching a point is one thing; reaching it with the gripper pointing the way the task needs is another. Add a wrist and a hand of length L3: for a tool heading φ, the wrist must sit at the target minus L3 along φ, and the shoulder and elbow solve the rest (see Inverse kinematics: Analytic IK). Each point gets a score: the share of headings that work.',
    'The reachable workspace is every point with at least one heading. The dexterous workspace is where every heading works, shown bright. With free joints it is the ring |L1 − L2| + L3 ≤ r ≤ L1 + L2 − L3: the hand length is lost at both edges, because the wrist circle around the target must fit inside the two-link ring.',
    'Watch the probe slide out from the base. Near the base and near the outer edge only a fan of headings works (green spokes); in the middle the fan closes into a full circle. A longer hand reaches further but shrinks the dexterous ring; a limited wrist can empty it altogether.',
    'Tasks rarely need every heading. Grip from above only needs the gripper pointing down within ±30°, so its dexterous region is much larger. Designers size the links so the task region (a tray, a conveyor) sits inside the dexterous region for the headings the task uses, with high manipulability (see Jacobian).',
  ],
  controls: [
    { kind: 'choice', key: 'task', options: opts(TASKS), initial: 'any' },
    cmSlider('hand', 'Hand L3', 2, 20, 8),
    degSlider('wrist', 'Wrist limit', 15, 180, 180),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), DX.at)
    g.scale.setScalar(DX.k)
    armPlate(g, 0.1, 0.14)
    const cloud = pointCloud(g, 8000, DX.dot)
    const pen = dotPen(g, 1600, 0.004)
    const heading = stretchArrow(g, RING, 0.005)
    const probeTag = liveLabel(g, [0, 0, 0.05], { size: 0.026 })
    let rig: { l3: number; r: ReturnType<typeof serialArm> } | null = null
    const color = new THREE.Color()

    const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [X0, 2.6 - i * 0.7, 0.2], { size: 0.32, align: 'left' }))
    colorBar(scene, [X0, -0.6, 0.2], 6, 'one heading', 'every heading')
    const { y: sy, h: sh } = DX.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 4], zeroAt: 0 })
    const curve = plot.trace(GREY, { samples: 81, radius: 0.08 })
    const mark = plot.trace(RING, { samples: 2, radius: 0.16 })
    scopeLabels(scene, sy, sh, null, 'dexterity along the probe line (0 … 100 %)', '')
    addLabel(scene, 'base', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, 'full reach', [X0 + SIDE_SCOPE.w, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'right')

    const st = { key: '', t: 0, q: [0, 0, 0] as number[] }
    return {
      scene,
      view: { center: [-1, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = dxParams(p)
        const key = dxKey(q)
        const d = dxGrid(q)
        const l = dxLinks(q)
        if (!rig || rig.l3 !== q.l3) {
          rig?.r.group.removeFromParent()
          rig = { l3: q.l3, r: serialArm(g, planarArm(l), { w: 0.036, t: 0.026 }) }
        }
        if (key !== st.key) {
          Object.assign(st, { key, t: 0 })
          d.cells.forEach((c, i) => cloud.set(i, [c.x, c.y, 0.005], c.d >= 1 ? color.set(RING) : ramp(c.d * 0.75, color), c.d >= 1 ? 1 : 0.8))
          cloud.show(d.cells.length)
        }
        st.t += dt

        const r = probeR(d.R, st.t)
        const [px, py] = [r * Math.cos(d.dir), r * Math.sin(d.dir)]
        const hs = dxHeadings(q)
        const sols = headingReach(l, dxLimits(q), px, py, hs)
        const dex = dexterity(sols)
        const ok = hs.map((_, i) => i).filter((i) => sols[i])
        const spin = (st.t * 0.6) % 1
        const want = ok.length ? ok[Math.floor(spin * ok.length) % ok.length] : -1
        const goal = want >= 0 ? sols[want]! : (() => {
          const s = twoLinkIk(l[0], l[1] + l[2], px, py)
          return [s.up[0], s.up[1], 0]
        })()
        st.q = st.q.map((v, i) => v + wrapPi(goal[i] - v) * Math.min(1, dt * 8))
        const fr = rig.r.set(st.q)
        rig.r.glow(2, want < 0 ? 1 : 0)

        pen.begin()
        pen.line([0, 0, 0.02], [(d.R + 0.03) * Math.cos(d.dir), (d.R + 0.03) * Math.sin(d.dir), 0.02], 0.012, GREY, 0.6)
        hs.forEach((phi, i) => {
          const c = sols[i] ? POWER : HIGH_V
          pen.line([px, py, 0.04], [px + DX.spoke * Math.cos(phi), py + DX.spoke * Math.sin(phi), 0.04], 0.006, c, sols[i] ? 1 : 0.7)
        })
        pen.arc([px, py, 0.04], 0.012, 0, 2 * Math.PI, dex >= 1 ? RING : LABEL, 1)
        pen.end()
        const tool = fr[fr.length - 1]
        const phiNow = st.q.reduce((a, b) => a + b, 0)
        heading([tool[3], tool[7], 0.05], [tool[3] + 0.06 * Math.cos(phiNow), tool[7] + 0.06 * Math.sin(phiNow), 0.05], want >= 0 ? RING : HIGH_V)
        probeTag.set(`${ok.length} of ${hs.length}`, dex >= 1 ? RING : ok.length ? LABEL : HIGH_V)
        probeTag.group.position.set(px, py + DX.spoke + 0.035, 0.05)

        const b = dexterousBand(DX.L[0], DX.L[1], q.l3)
        lines[0].set(`L1 ${cm(DX.L[0])}, L2 ${cm(DX.L[1])}, L3 ${cm(q.l3)} · elbow ±${deg0(DX.elbow)}, wrist ±${deg0(q.wrist)}`, LABEL)
        lines[1].set(`free joints, every φ: ${b.empty ? 'no dexterous ring' : `${cm(b.inner)} ≤ r ≤ ${cm(b.outer)}`}`, b.empty ? HIGH_V : LABEL)
        lines[2].set(`reachable ${cm2(d.reach)} · dexterous ${cm2(d.dex)} (${Math.round((d.dex / Math.max(1e-9, d.reach)) * 100)} %)`, RING)
        lines[3].set(`probe r = ${cm(r)}: ${ok.length} of ${hs.length} headings`, dex >= 1 ? RING : ok.length ? LABEL : HIGH_V)

        curve.points(d.radial.map((_, i) => i / 80), d.radial.map((v) => v * sh - sh / 2))
        const u = Math.min(1, r / d.R)
        mark.points([u, u], [dex * sh - sh / 2, dex * sh - sh / 2])

        status.set(`dexterous ${cm2(d.dex)} of ${cm2(d.reach)} reachable · probe ${Math.round(dex * 100)} %`, LABEL)
        sub.set(`side view · ${TASKS[q.task].toLowerCase()}${q.task === 'any' ? '' : ' (±30°)'} · ${hs.length} headings tested per point`, GREY)
        event.set(!ok.length ? 'probe out of reach: no heading works' : dex >= 1 ? 'dexterous: the hand can come in from every heading the task needs' : 'reachable, but only from some headings', !ok.length ? HIGH_V : dex >= 1 ? RING : LABEL)
      },
      readouts: (p) => {
        const q = dxParams(p)
        const d = dxGrid(q)
        const b = dexterousBand(DX.L[0], DX.L[1], q.l3)
        return [
          { label: 'Reachable area', value: cm2(d.reach) },
          { label: 'Dexterous area', value: `${cm2(d.dex)} (${Math.round((d.dex / Math.max(1e-9, d.reach)) * 100)} %)`, tone: d.dex > 0 ? 'ok' : 'bad' },
          { label: 'Free-joint ring', value: b.empty ? 'none' : `${cm(b.inner)} … ${cm(b.outer)}` },
          { label: 'Task headings', value: `${TASK_RANGE[q.task][2]} tested` },
        ]
      },
    }
  },
}
