import * as THREE from 'three/webgpu'
import { DEG, DhRow, Mat4, SERVO_ARM, armFk, chain4, originOf, planarArm, rotAbout4, toDeg, toolOf, trans4, twoLinkTip, wrapPi } from '../../core/physics'
import { degText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { AXIS_RGB, GREY, HEAT, JOINT_COLORS, LABEL, RING, addLabel, floorMat, frameTriad, glide, liveLabel, matrixGrid, pointCloud, serialArm, setTf, statusHeader, zUp } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f2 = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−'))
const fp = (v: number) => (v < -0.005 ? `(${f2(v)})` : f2(v))
const xy = (p: readonly number[]) => `(${p.map(f2).join(', ')})`
const deg = (a: number) => degText(toDeg(a), 0)
const glideAngle = (dt: number, from: number, to: number, k = 5) => from + glide(dt, 0, wrapPi(to - from), k)
const angleSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 5, initial, format: (v: number) => `${v}°` })

// --- Two-link arm: θ1 and θ2 in, hand (x, y) out, by adding the two link vectors. ---

const TL = { at: [-8, -2.9, 0] as V3, k: 12, trail: 200, ext: 0.12 }
const SWEEP = { hold: 'Hold angles', shoulder: 'Sweep shoulder θ1', elbow: 'Sweep elbow θ2' }
const tlParams = (p: Params) => ({ q1: n(p, 'q1') * DEG, q2: n(p, 'q2') * DEG, l1: n(p, 'l1'), l2: n(p, 'l2'), mode: pick(SWEEP, p.mode, 'hold') })
const sweepAt = (mode: string, q1: number, q2: number, t: number): [number, number] => {
  const s = Math.sin(t * 0.9)
  return mode === 'shoulder' ? [q1 + 60 * DEG * s, q2] : mode === 'elbow' ? [q1, q2 + 80 * DEG * s] : [q1, q2]
}

export const twoLinkArm: Lesson = {
  id: 'forward-kinematics-two-link-arm',
  title: 'Two-link arm',
  tagline: 'Add up the links, get the hand',
  formula: (p) => {
    const q = tlParams(p)
    const [x, y] = twoLinkTip(q.l1, q.l2, q.q1, q.q2)
    return `x = L1·cos θ1 + L2·cos(θ1+θ2) = ${f2(x)} m · y = L1·sin θ1 + L2·sin(θ1+θ2) = ${f2(y)} m · T(0←2) = Rot(θ1)·Trans(L1)·Rot(θ2)·Trans(L2) · hand heading θ1+θ2 = ${deg(q.q1 + q.q2)}`
  },
  legend: [
    { color: JOINT_COLORS[0], label: 'Shoulder θ1, from the x axis', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'Elbow θ2, from link 1\'s line', shape: 'dot' },
    { color: RING, label: 'Hand (x, y) and its path', shape: 'dot' },
    { color: GREY, label: 'Reach: |L1 − L2| … L1 + L2', shape: 'dot' },
  ],
  points: [
    'Forward kinematics answers one question: given the joint angles, where is the hand? For an arm of rigid links joined by hinges there is always exactly one answer, found by walking out from the base link by link.',
    'Link 1 points at θ1 from the x axis, so the elbow sits at L1·(cos θ1, sin θ1). The elbow angle θ2 is measured from link 1, not from the floor, so link 2 points at θ1 + θ2 and adds L2·(cos(θ1+θ2), sin(θ1+θ2)). The hand is the sum of the two vectors.',
    'The same answer comes from chaining planar transforms (see Coordinate frames): T = Rot(θ1)·Trans(L1)·Rot(θ2)·Trans(L2). Its last column is the hand position, its rotation block the hand heading θ1 + θ2. More links just mean more factors.',
    'Sweep one joint and the hand moves on a circle: round the base for θ1, round the elbow for θ2. All reachable points lie in a ring between |L1 − L2| and L1 + L2; going the other way, from a hand position back to the angles, is Inverse kinematics.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(SWEEP), initial: 'hold' },
    angleSlider('q1', 'Shoulder θ1', -180, 180, 40),
    angleSlider('q2', 'Elbow θ2', -180, 180, 60),
    { kind: 'slider', key: 'l1', label: 'Link 1 length L1', min: 0.15, max: 0.35, step: 0.01, initial: 0.3, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'l2', label: 'Link 2 length L2', min: 0.1, max: 0.28, step: 0.01, initial: 0.22, format: (v) => `${v.toFixed(2)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), TL.at)
    g.scale.setScalar(TL.k)
    const plate = mat('#3a3d45', { rough: 0.6 })
    box(g, [0.11, 0.16, 0.012], plate, [0, 0, -0.03])
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(g, [0.012, 0.012, 0.012], mat('#b8bec8', { metal: 0.7, rough: 0.3 }), [sx * 0.04, sy * 0.06, -0.022])
    const base = frameTriad(g, 0.1, '', LABEL, 0.003, { letters: 'xy', size: 0.03, planar: true })
    base.group.position.z = -0.02
    const reach = pointCloud(g, 260, 0.0035)
    const arcs = [pointCloud(g, 40, 0.004), pointCloud(g, 40, 0.004)]
    const ext = pointCloud(g, 12, 0.0025)
    const trail = pointCloud(g, TL.trail, 0.005)
    const tags = [0, 1].map((i) => liveLabel(g, [0, 0, 0.03], { size: 0.032, color: JOINT_COLORS[i] }))
    const tipTag = liveLabel(g, [0, 0, 0.03], { size: 0.03, color: RING, align: 'left' })
    const rigs: Record<string, ReturnType<typeof serialArm>> = {}

    const MX = { x: 10.4, y: 0.8, cell: 2.1, size: 0.5 }
    const grid = matrixGrid(scene, [MX.x, MX.y, 0], 3, 3, { cell: MX.cell, size: MX.size })
    addLabel(scene, 'T(0←2) =', [MX.x - grid.w / 2 - 0.4, MX.y, 0.2], LABEL, 0.5, 'right')
    ;['x₂', 'y₂', 'hand'].forEach((c, i) => addLabel(scene, c, [MX.x + (i - 1) * MX.cell, MX.y + grid.h / 2 + 0.6, 0.2], i < 2 ? AXIS_RGB[i] : RING, 0.4))
    const lines = [0, 1, 2].map((i) => liveLabel(scene, [3.2, MX.y - grid.h / 2 - 1.3 - i * 0.85, 0.2], { size: 0.4, align: 'left' }))

    const st = { q1: NaN, q2: 0, t: 0, key: '', trail: 0, last: 0 }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = tlParams(p)
        const lk = `${q.l1}|${q.l2}`
        let rig = rigs[lk]
        if (!rig) {
          Object.values(rigs).forEach((r) => (r.group.visible = false))
          rig = rigs[lk] = serialArm(g, planarArm([q.l1, q.l2]), { w: 0.05, t: 0.034 })
        }
        Object.entries(rigs).forEach(([k, r]) => (r.group.visible = k === lk))
        const key = `${q.mode}|${q.q1}|${q.q2}|${lk}`
        if (key !== st.key) Object.assign(st, { key, t: 0, trail: 0 })
        st.t += dt
        const [t1, t2] = sweepAt(q.mode, q.q1, q.q2, st.t)
        if (Number.isNaN(st.q1)) Object.assign(st, { q1: t1, q2: t2 })
        if (q.mode === 'hold') {
          st.q1 = glideAngle(dt, st.q1, t1)
          st.q2 = glideAngle(dt, st.q2, t2)
        } else {
          st.q1 = glideAngle(dt, st.q1, t1, 12)
          st.q2 = glideAngle(dt, st.q2, t2, 12)
        }
        const f = rig.set([st.q1, st.q2])
        const elbow = originOf(f[1])
        const [x, y] = twoLinkTip(q.l1, q.l2, st.q1, st.q2)

        const outer = q.l1 + q.l2
        const inner = Math.abs(q.l1 - q.l2)
        for (let i = 0; i < 130; i++) {
          const a = (i / 130) * 2 * Math.PI
          reach.set(i, [outer * Math.cos(a), outer * Math.sin(a), -0.02], GREY, 0.8)
          reach.set(130 + i, [inner * Math.cos(a), inner * Math.sin(a), -0.02], GREY, 0.6)
        }
        reach.show(260)
        const arcAt = (k: number, c: V3, from: number, sweep: number, r: number) => {
          for (let i = 0; i < 40; i++) {
            const u = from + (i / 39) * sweep
            arcs[k].set(i, [c[0] + r * Math.cos(u), c[1] + r * Math.sin(u), 0.03], JOINT_COLORS[k])
          }
          arcs[k].show(Math.abs(sweep) > 0.03 ? 40 : 0)
          tags[k].group.position.set(c[0] + (r + 0.035) * Math.cos(from + sweep / 2), c[1] + (r + 0.035) * Math.sin(from + sweep / 2), 0.03)
        }
        arcAt(0, [0, 0, 0], 0, wrapPi(st.q1), 0.09)
        arcAt(1, elbow, st.q1, wrapPi(st.q2), 0.07)
        tags[0].set('θ1')
        tags[1].set('θ2')
        for (let i = 0; i < 12; i++) {
          const r = 0.03 + (i / 11) * TL.ext
          ext.set(i, [elbow[0] + r * Math.cos(st.q1), elbow[1] + r * Math.sin(st.q1), 0.03], GREY)
        }
        ext.show(12)
        base.face()
        const phi = st.q1 + st.q2
        tipTag.set(`(${f2(x)}, ${f2(y)})`, RING)
        tipTag.group.position.set(x + 0.1 * Math.cos(phi) - (Math.cos(phi) < 0 ? 0.2 : 0), y + 0.08 * Math.sin(phi), 0.03)
        if (q.mode !== 'hold' && st.t - st.last > 0.03 && st.t > 0.4) {
          st.last = st.t
          trail.set(st.trail++ % TL.trail, [x, y, 0.02], RING, 0.9)
        }
        trail.show(q.mode === 'hold' ? 0 : Math.min(st.trail, TL.trail))

        const m = f[2]
        const c = m[0]
        const s = m[4]
        grid.set([f2(c), f2(-s), f2(x), f2(s), f2(c), f2(y), '0', '0', '1'], [AXIS_RGB[0], AXIS_RGB[1], RING])
        const [c1, s1] = [Math.cos(st.q1), Math.sin(st.q1)]
        const [c12, s12] = [Math.cos(st.q1 + st.q2), Math.sin(st.q1 + st.q2)]
        lines[0].set(`x = ${f2(q.l1)}·${fp(c1)} + ${f2(q.l2)}·${fp(c12)} = ${f2(x)} m`, AXIS_RGB[0])
        lines[1].set(`y = ${f2(q.l1)}·${fp(s1)} + ${f2(q.l2)}·${fp(s12)} = ${f2(y)} m`, AXIS_RGB[1])
        lines[2].set(`elbow at ${xy(elbow.slice(0, 2))} · hand heading ${deg(wrapPi(st.q1 + st.q2))}`, GREY)
        const r = Math.hypot(x, y)
        status.set(`θ1 ${deg(wrapPi(st.q1))} · θ2 ${deg(wrapPi(st.q2))}  →  hand (${f2(x)}, ${f2(y)}) m`, LABEL)
        sub.set(`side view · L1 ${f2(q.l1)} m, L2 ${f2(q.l2)} m · reach ring ${f2(inner)}…${f2(outer)} m`, GREY)
        event.set(
          q.mode === 'shoulder' ? 'θ1 sweeps: the whole arm swings, the hand circles the base' : q.mode === 'elbow' ? 'θ2 sweeps: link 1 holds, the hand circles the elbow' : Math.abs(wrapPi(st.q2)) < 0.03 ? 'θ2 = 0: arm straight, hand at full reach' : r < inner + 0.005 ? 'folded back: hand as close to the base as it gets' : 'hand = link 1 vector + link 2 vector',
          q.mode === 'hold' ? LABEL : RING,
        )
      },
      readouts: (p) => {
        const q = tlParams(p)
        const [q1, q2] = q.mode === 'hold' || Number.isNaN(st.q1) ? [q.q1, q.q2] : [wrapPi(st.q1), wrapPi(st.q2)]
        const [x, y] = twoLinkTip(q.l1, q.l2, q1, q2)
        return [
          { label: 'Joint angles', value: `${deg(q1)}, ${deg(q2)}` },
          { label: 'Hand (x, y)', value: `${xy([x, y])} m` },
          { label: 'Hand heading', value: deg(wrapPi(q1 + q2)) },
          { label: 'Distance from base', value: `${f2(Math.hypot(x, y))} m of ${f2(q.l1 + q.l2)}`, tone: 'ok' },
        ]
      },
    }
  },
}

// --- Denavit–Hartenberg: four numbers per joint, four elementary moves from frame i−1 to frame i. ---

const DH = { at: [-8.6, -6.2, 0] as V3, k: 24, step: 1.0, hold: 1.6, plinth: 0.014 }
const ROWS = { '1': 'Row 1: base', '2': 'Row 2: shoulder', '3': 'Row 3: elbow', '4': 'Row 4: wrist' }
const MOVES = ['Rot z(θ)', 'Trans z(d)', 'Trans x(a)', 'Rot x(α)']
const dhParams = (p: Params) => ({ q: ['q1', 'q2', 'q3', 'q4'].map((k) => n(p, k) * DEG), row: Number(pick(ROWS, p.row, '2')) - 1 })
const rowAt = (r: DhRow, q: number) => ({ ...r, theta: r.theta + q })
const len = (v: number) => (Math.abs(v) < 1e-9 ? '0' : f2(v))
const ang = (v: number) => (Math.abs(v) < 1e-9 ? '0°' : deg(v))

/** Frame i−1 carried part-way (`u` in 0…4) through its row's four moves. */
function dhPartial(prev: Mat4, r: DhRow, u: number): Mat4 {
  const k = (i: number) => Math.max(0, Math.min(1, u - i))
  return chain4(prev, rotAbout4(2, r.theta * k(0)), trans4([0, 0, r.d * k(1)]), trans4([r.a * k(2), 0, 0]), rotAbout4(0, r.alpha * k(3)))
}

export const denavitHartenberg: Lesson = {
  id: 'forward-kinematics-denavit-hartenberg',
  title: 'Denavit–Hartenberg',
  tagline: 'Four numbers per joint',
  formula: (p) => {
    const { q, row } = dhParams(p)
    const r = rowAt(SERVO_ARM.rows[row], q[row])
    const tip = toolOf(armFk(SERVO_ARM, q))
    return `A${row + 1} = Rot z(θ)·Trans z(d)·Trans x(a)·Rot x(α), θ = ${ang(r.theta)}, d = ${len(r.d)} m, a = ${len(r.a)} m, α = ${ang(r.alpha)} · T(0←4) = A1·A2·A3·A4 · hand at ${xy(tip)} m`
  },
  legend: [
    { color: AXIS_RGB[2], label: 'Frame axes: x red, y green, z = joint axis blue', shape: 'dot' },
    { color: HEAT, label: 'Frame i−1 walking to frame i', shape: 'dot' },
    { color: RING, label: 'Selected DH row, hand position', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'Joint rings (1 orange … 4 pink)', shape: 'dot' },
  ],
  points: [
    'Writing every link as a general 4×4 needs six numbers. The Denavit–Hartenberg convention gets away with four by choosing frames cleverly: frame i−1\'s z axis lies along joint i\'s axis, and frame i\'s x axis lies along the common perpendicular from that axis to the next one.',
    'Then one link is always the same four moves (standard DH): turn θ about z, slide d along z, slide a along the new x, twist α about that x. A_i = Rot z(θ)·Trans z(d)·Trans x(a)·Rot x(α). Watch the orange frame walk from frame i−1 to frame i in exactly those steps.',
    'Each joint changes one entry of its row: θ for a hinge, d for a slider. The rest is fixed by the metal. For this 4-DOF servo arm the base row twists α = 90° to turn the vertical yaw axis into the horizontal shoulder axis; the other three rows are planar links of length a.',
    'Forward kinematics is then one product, T(0←4) = A1·A2·A3·A4 (see Coordinate frames for chaining). Robot datasheets and libraries list arms as such a table; beware that the modified (Craig) convention orders the moves differently.',
  ],
  controls: [
    { kind: 'choice', key: 'row', options: opts(ROWS), initial: '2' },
    angleSlider('q1', 'Base yaw q1', -90, 90, 30),
    angleSlider('q2', 'Shoulder q2', 0, 180, 60),
    angleSlider('q3', 'Elbow q3', -135, 135, -70),
    angleSlider('q4', 'Wrist q4', -90, 90, -30),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, DH.at, DH.k, 0.32, -0.6)
    floorMat(g, [-0.12, 0.3], [-0.15, 0.3])
    const arm = serialArm(add(g, new THREE.Group(), [0, 0, DH.plinth]), SERVO_ARM, { w: 0.022, t: 0.017, triads: 0.075, pedestal: DH.plinth })
    const walker = frameTriad(g, 0.1, '', HEAT, 0.0035, { size: 0.026 })
    const tipDot = pointCloud(g, 1, 0.009)

    const T = { x: 9.4, y: 2.2, cell: 1.6, size: 0.36 }
    const table = matrixGrid(scene, [T.x, T.y, 0], 4, 4, { cell: T.cell, size: T.size })
    ;['θ', 'd', 'a', 'α'].forEach((c, i) => addLabel(scene, c, [T.x + (i - 1.5) * T.cell, T.y + table.h / 2 + 0.5, 0.2], LABEL, 0.36))
    ;[0, 1, 2, 3].forEach((i) => addLabel(scene, `${i + 1}`, [T.x - table.w / 2 - 0.35, T.y + table.h / 2 - T.size * 0.95 - i * T.size * 1.9, 0.2], JOINT_COLORS[i], 0.34, 'right'))
    addLabel(scene, 'DH table', [T.x - table.w / 2 - 1.3, T.y, 0.2], GREY, 0.34, 'right')
    const A = { y: -3.6 }
    const amat = matrixGrid(scene, [T.x, A.y, 0], 4, 4, { cell: T.cell, size: T.size })
    const aTag = liveLabel(scene, [T.x - amat.w / 2 - 0.4, A.y, 0.2], { size: 0.4, align: 'right' })
    const steps = MOVES.map((_, i) => liveLabel(scene, [T.x - 3.4 + (i % 2) * 4.2, A.y + amat.h / 2 + 1.35 - Math.floor(i / 2) * 0.55, 0.2], { size: 0.32, align: 'left' }))
    const tipLine = liveLabel(scene, [T.x, A.y - amat.h / 2 - 0.8, 0.2], { size: 0.32 })

    const st = { q: [NaN, 0, 0, 0], t: 0, row: -1 }
    return {
      scene,
      view: { center: [-0.5, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const { q, row } = dhParams(p)
        if (Number.isNaN(st.q[0])) st.q = [...q]
        st.q = st.q.map((v, i) => glide(dt, v, q[i], 4))
        if (row !== st.row) Object.assign(st, { row, t: 0 })
        const total = 4 * DH.step + DH.hold
        st.t = (st.t + dt) % total
        const u = Math.min(4, st.t / DH.step)
        const f = arm.set(st.q)
        const rows = SERVO_ARM.rows.map((r, i) => rowAt(r, st.q[i]))
        const r = rows[row]
        setTf(walker.group, dhPartial(f[row], r, u))
        walker.group.visible = st.t > 0.15
        arm.triads.forEach((tr, i) => {
          tr.group.visible = i === row || i === row + 1
          tr.label.set(i === row ? `${i}  (i−1)` : `${i}  (i)`, i === row ? LABEL : RING)
        })
        arm.face()
        walker.face()
        for (let i = 0; i < 4; i++) arm.glow(i, i === row ? 1 : 0)
        const tip = toolOf(f)
        tipDot.set(0, tip, RING, 1)
        tipDot.show(1)

        table.set(
          rows.flatMap((x) => [ang(x.theta), len(x.d), len(x.a), ang(x.alpha)]),
          rows.flatMap((_, i) => (i === row ? [RING, RING, RING, RING] : [GREY, GREY, GREY, GREY])),
        )
        const m = f[row + 1]
        const local = chain4(rotAbout4(2, r.theta), trans4([0, 0, r.d]), trans4([r.a, 0, 0]), rotAbout4(0, r.alpha))
        amat.set(
          local.map((v, i) => (i >= 12 ? String(v) : f2(v))),
          local.map((_, i) => (i >= 12 ? GREY : [AXIS_RGB[0], AXIS_RGB[1], AXIS_RGB[2], RING][i % 4])),
        )
        aTag.set(`A${row + 1} =`, LABEL)
        const k = Math.floor(Math.min(3.999, u))
        steps.forEach((s, i) => s.set(`${i + 1}. ${MOVES[i]}`, u >= 4 ? RING : i === k ? HEAT : i < k ? LABEL : GREY))
        tipLine.set(`T(0←4) = A1·A2·A3·A4  →  hand ${xy(tip)} m`, RING)
        const vals = [ang(r.theta), `${len(r.d)} m`, `${len(r.a)} m`, ang(r.alpha)]
        status.set(`row ${row + 1}: θ ${vals[0]} · d ${vals[1]} · a ${vals[2]} · α ${vals[3]}`, LABEL)
        sub.set(`frame ${row + 1} origin ${xy(originOf(m))} m in the base frame · 4-DOF servo arm, floor tape 0.5 m`, GREY)
        event.set(u >= 4 ? `frame ${row} → frame ${row + 1} done: that is A${row + 1}` : `step ${k + 1} of 4 · ${MOVES[k]} = ${vals[k]}${(k === 0 || k === 3 ? Math.abs(k === 0 ? r.theta : r.alpha) : Math.abs(k === 1 ? r.d : r.a)) < 1e-9 ? ' (nothing to do)' : ''}`, u >= 4 ? RING : HEAT)
      },
      readouts: (p) => {
        const { q, row } = dhParams(p)
        const f = armFk(SERVO_ARM, q)
        const tip = toolOf(f)
        return [
          { label: 'Hand position', value: `${xy(tip)} m` },
          { label: `Frame ${row + 1} origin`, value: `${xy(originOf(f[row + 1]))} m` },
          { label: 'Reach from base axis', value: `${f2(Math.hypot(tip[0], tip[1]))} m` },
          { label: 'Hand height', value: `${f2(tip[2])} m`, tone: tip[2] > 0 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
