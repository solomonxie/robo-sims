import * as THREE from 'three/webgpu'
import { DEG, IkStep, P3, SERVO_ARM, SERVO_ARM_DIMS, armFk, ikIterate, originOf, planarArm, poseGroups, planarFk, planarJacobian, servoArmIk, toDeg, toolOf, twoLinkIk, twoLinkTip, wrapPi } from '../../core/physics'
import { degText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HIGH_V, JOINT_COLORS, LABEL, RING, addLabel, dotPen, floorMat, frameTriad, ghostRig, glide, liveLabel, matrixGrid, memoBy, pointCloud, scopeLabels, serialArm, sideScope, SIDE_SCOPE, statusHeader, stretchArrow, zUp } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f2 = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−'))
const xy = (p: readonly number[]) => `(${p.map(f2).join(', ')})`
const deg = (a: number) => degText(Math.abs(a) < 0.5 * DEG ? 0 : toDeg(a), 0)
const glideAngle = (dt: number, from: number, to: number, k = 5) => from + glide(dt, 0, wrapPi(to - from), k)
const mSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 0.01, initial, format: (v: number) => `${v.toFixed(2)} m` })
const angleSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 5, initial, format: (v: number) => `${v}°` })
const PSI = JOINT_COLORS[2]

const tagAt = (t: { group: THREE.Object3D }, o: V3, r: number, a: number) => t.group.position.set(o[0] + r * Math.cos(a), o[1] + r * Math.sin(a), o[2])

// --- Analytic IK: law of cosines for θ2, two atan2s for θ1. ---

const AN = { at: [-8.6, -3.8, 0] as V3, k: 13.5, l1: 0.3, l2: 0.22, path: { c: [0.16, 0.12], r: 0.36, w: 0.5 } }
const TARGET_MODES = { hold: 'Hold target', circle: 'Target circles' }
const ELBOWS = { up: 'Elbow up', down: 'Elbow down' }
const anParams = (p: Params) => ({ x: n(p, 'x'), y: n(p, 'y'), elbow: pick(ELBOWS, p.elbow, 'up'), mode: pick(TARGET_MODES, p.mode, 'hold') })

export const analyticIk: Lesson = {
  id: 'inverse-kinematics-analytic-ik',
  title: 'Analytic IK',
  tagline: 'Triangle in, angles out',
  formula: (p) => {
    const q = anParams(p)
    const s = twoLinkIk(AN.l1, AN.l2, q.x, q.y)
    const [t1, t2] = s[q.elbow]
    return `cos θ2 = (x² + y² − L1² − L2²)/(2·L1·L2) = ${f2(s.cos2)} · θ1 = atan2(y, x) − atan2(L2·sin θ2, L1 + L2·cos θ2) · θ1 ${deg(t1)}, θ2 ${deg(t2)}${s.reachable ? '' : ' (out of reach: nearest point)'}`
  },
  legend: [
    { color: JOINT_COLORS[0], label: 'θ1 = β − ψ', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'θ2 from the law of cosines', shape: 'dot' },
    { color: RING, label: 'Target (red when out of reach)', shape: 'dot' },
    { color: GREY, label: 'Reach ring |L1 − L2| … L1 + L2', shape: 'dot' },
  ],
  points: [
    'Inverse kinematics runs Forward kinematics backwards: the hand position is given, the joint angles are wanted. For a two-link arm a little triangle geometry gives them exactly, in a handful of operations, so it runs every servo tick.',
    'Base, elbow and target make a triangle with sides L1, L2 and r = √(x² + y²). The law of cosines fixes the angle at the elbow: cos θ2 = (r² − L1² − L2²)/(2·L1·L2). acos gives its size; the sign picks elbow up or elbow down.',
    'The shoulder angle is two atan2s: β = atan2(y, x) points at the target, ψ = atan2(L2·sin θ2, L1 + L2·cos θ2) is how far link 1 swings off that line, so θ1 = β − ψ. atan2, not atan, keeps every quadrant right.',
    'If |cos θ2| > 1 the triangle cannot close: the target lies outside L1 + L2 or inside |L1 − L2|. A safe solver clamps r into the ring and points the arm at the nearest reachable point instead of returning NaN. Let the target circle to watch both edges.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(TARGET_MODES), initial: 'hold' },
    { kind: 'choice', key: 'elbow', options: opts(ELBOWS), initial: 'up' },
    mSlider('x', 'Target x', -0.55, 0.55, 0.32),
    mSlider('y', 'Target y', -0.3, 0.55, 0.2),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), AN.at)
    g.scale.setScalar(AN.k)
    box(g, [0.11, 0.16, 0.012], mat('#3a3d45', { rough: 0.6 }), [0, 0, -0.03])
    const base = frameTriad(g, 0.1, '', LABEL, 0.003, { letters: 'xy', size: 0.03, planar: true })
    base.group.position.z = -0.02
    const rig = serialArm(g, planarArm([AN.l1, AN.l2]), { w: 0.05, t: 0.034 })
    const pen = dotPen(g, 1400, 0.0035)
    const tgt = pointCloud(g, 1, 0.014)
    const tags = ['θ1', 'θ2', 'β', 'ψ'].map((t, i) => {
      const l = liveLabel(g, [0, 0, 0.03], { size: 0.03, color: [JOINT_COLORS[0], JOINT_COLORS[1], LABEL, PSI][i] })
      l.set(t)
      return l
    })
    const rTag = liveLabel(g, [0, 0, 0.03], { size: 0.028, color: GREY })
    const lines = Array.from({ length: 7 }, (_, i) => liveLabel(scene, [2.2, 2.9 - i * 0.95, 0.2], { size: 0.38, align: 'left' }))

    const st = { q: [NaN, 0], t: 0, key: '' }
    const targetAt = (q: ReturnType<typeof anParams>, t: number): [number, number] => {
      const { c, r, w } = AN.path
      return q.mode === 'hold' ? [q.x, q.y] : [c[0] + r * Math.cos(w * t), c[1] + r * Math.sin(w * t)]
    }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = anParams(p)
        const key = `${q.mode}|${q.x}|${q.y}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        const [tx, ty] = targetAt(q, st.t)
        const s = twoLinkIk(AN.l1, AN.l2, tx, ty)
        const goal = s[q.elbow]
        if (Number.isNaN(st.q[0])) st.q = [...goal]
        const k = q.mode === 'hold' ? 5 : 14
        st.q = st.q.map((v, i) => glideAngle(dt, v, goal[i], k))
        const f = rig.set(st.q)
        const elbow = originOf(f[1])
        const tip = twoLinkTip(AN.l1, AN.l2, st.q[0], st.q[1])
        const bad = !s.reachable
        const [lo, hi] = s.reach

        pen.begin()
        pen.arc([0, 0, -0.02], hi, 0, 2 * Math.PI, GREY, 0.8)
        pen.arc([0, 0, -0.02], lo, 0, 2 * Math.PI, GREY, 0.6)
        if (q.mode === 'circle') pen.arc([AN.path.c[0], AN.path.c[1], -0.015], AN.path.r, 0, 2 * Math.PI, RING, 0.45)
        pen.line([0, 0, 0.035], [tx, ty, 0.035], 0.014, bad ? HIGH_V : LABEL, 0.7)
        const beta = Math.atan2(tip[1], tip[0])
        const psi = wrapPi(beta - st.q[0])
        pen.arc([0, 0, 0.035], 0.08, 0, wrapPi(st.q[0]), JOINT_COLORS[0])
        pen.arc([0, 0, 0.035], 0.14, 0, beta, LABEL, 0.8)
        pen.arc([0, 0, 0.035], 0.2, st.q[0], psi, PSI)
        pen.arc([elbow[0], elbow[1], 0.035], 0.07, st.q[0], wrapPi(st.q[1]), JOINT_COLORS[1])
        pen.line([elbow[0] + 0.03 * Math.cos(st.q[0]), elbow[1] + 0.03 * Math.sin(st.q[0]), 0.03], [elbow[0] + 0.12 * Math.cos(st.q[0]), elbow[1] + 0.12 * Math.sin(st.q[0]), 0.03], 0.012, GREY, 0.7)
        pen.arc([tx, ty, 0.04], 0.028, 0, 2 * Math.PI, bad ? HIGH_V : RING, 0.9)
        pen.end()
        tgt.set(0, [tx, ty, 0.04], bad ? HIGH_V : RING)
        tgt.show(1)
        tagAt(tags[0], [0, 0, 0.04], 0.105, wrapPi(st.q[0]) / 2)
        tagAt(tags[1], [elbow[0], elbow[1], 0.04], 0.1, st.q[0] + wrapPi(st.q[1]) / 2)
        tagAt(tags[2], [0, 0, 0.04], 0.165, beta / 2)
        tagAt(tags[3], [0, 0, 0.04], 0.225, st.q[0] + psi / 2)
        tags.forEach((t, i) => (t.group.visible = Math.abs(i === 0 ? st.q[0] : i === 1 ? st.q[1] : i === 2 ? beta : psi) > 0.12))
        rTag.set(`r ${f2(s.r)}`, bad ? HIGH_V : GREY)
        rTag.group.visible = s.r > 0.14
        tagAt(rTag, [tx * 0.75, ty * 0.75, 0.04], 0.05, Math.atan2(ty, tx) + Math.PI / 2)
        base.face()

        const [t1, t2] = goal
        const sinT2 = Math.sin(t2)
        lines[0].set(`r² = x² + y² = ${f2(tx)}² + ${f2(ty)}²  →  r = ${f2(s.r)} m`, LABEL)
        lines[1].set(`cos θ2 = (r² − L1² − L2²) / (2·L1·L2) = ${f2(s.cos2)}`, bad ? HIGH_V : JOINT_COLORS[1])
        lines[2].set(bad ? `|cos θ2| > 1: no triangle, clamp r to ${f2(Math.min(Math.max(s.r, lo), hi))} m` : `θ2 = ${q.elbow === 'up' ? '−' : '+'}acos(${f2(s.cos2)}) = ${deg(t2)}  (${ELBOWS[q.elbow].toLowerCase()})`, bad ? HIGH_V : JOINT_COLORS[1])
        lines[3].set(`β = atan2(y, x) = ${deg(Math.atan2(s.aim[1], s.aim[0]))}`, LABEL)
        lines[4].set(`ψ = atan2(L2·sin θ2, L1 + L2·cos θ2) = ${deg(Math.atan2(AN.l2 * sinT2, AN.l1 + AN.l2 * Math.cos(t2)))}`, PSI)
        lines[5].set(`θ1 = β − ψ = ${deg(t1)}`, JOINT_COLORS[0])
        const back = twoLinkTip(AN.l1, AN.l2, t1, t2)
        lines[6].set(bad ? `FK(θ1, θ2) = ${xy(back)}: nearest reachable point` : `check: FK(θ1, θ2) = ${xy(back)} = target`, bad ? HIGH_V : RING)
        status.set(`target (${f2(tx)}, ${f2(ty)}) m  →  θ1 ${deg(t1)} · θ2 ${deg(t2)}`, LABEL)
        sub.set(`side view · L1 ${f2(AN.l1)} m, L2 ${f2(AN.l2)} m · reach ring ${f2(lo)}…${f2(hi)} m`, GREY)
        event.set(
          s.r > hi ? 'out of reach: the arm straightens and points at the target' : s.r < lo ? 'too close: inside the inner ring, the arm folds as far as it can' : Math.abs(s.cos2) > 0.995 ? 'on the reach edge: both elbows meet in one pose' : 'two answers reach it: elbow up and elbow down (see Multiple solutions)',
          bad ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const q = anParams(p)
        const [tx, ty] = targetAt(q, st.t)
        const s = twoLinkIk(AN.l1, AN.l2, tx, ty)
        const [t1, t2] = s[q.elbow]
        return [
          { label: 'Target (x, y)', value: `${xy([tx, ty])} m` },
          { label: 'Distance r', value: `${f2(s.r)} m in ${f2(s.reach[0])}…${f2(s.reach[1])}`, tone: s.reachable ? 'ok' : 'bad' },
          { label: 'cos θ2', value: f2(s.cos2), tone: Math.abs(s.cos2) <= 1 ? 'ok' : 'bad' },
          { label: 'Joint angles', value: `${deg(t1)}, ${deg(t2)}` },
        ]
      },
    }
  },
}

// --- Multiple solutions: the servo arm's four IK branches, pruned by joint limits. ---

const MS = { at: [-8.6, -6.2, 0] as V3, k: 24, plinth: 0.014 }
const BRANCHES = { up: 'Elbow up', down: 'Elbow down', 'flip-up': 'Flip, elbow up', 'flip-down': 'Flip, elbow down' }
const BRANCH_KEYS = Object.keys(BRANCHES) as (keyof typeof BRANCHES)[]
const msParams = (p: Params) => {
  const yaw = n(p, 'yaw') * DEG
  const rho = n(p, 'rho')
  return { target: [rho * Math.cos(yaw), rho * Math.sin(yaw), n(p, 'z')] as P3, pitch: n(p, 'pitch') * DEG, pick: BRANCH_KEYS.indexOf(pick(BRANCHES, p.pick, 'up')) }
}
const limitIssue = (q: readonly number[]) => {
  const i = q.findIndex((v, k) => v < SERVO_ARM.limits[k][0] - 1e-6 || v > SERVO_ARM.limits[k][1] + 1e-6)
  if (i < 0) return ''
  const [a, b] = SERVO_ARM.limits[i]
  return q[i] < a ? `q${i + 1} < ${deg(a)}` : `q${i + 1} > ${deg(b)}`
}

export const multipleSolutions: Lesson = {
  id: 'inverse-kinematics-multiple-solutions',
  title: 'Multiple solutions',
  tagline: 'One hand pose, several joint answers',
  formula: (p) => {
    const q = msParams(p)
    const s = servoArmIk(q.target, q.pitch)
    const fit = s.solutions.filter((x) => x.inLimits).length
    return `q1 = atan2(y, x) or q1 + 180° · wrist = target − hand·(cos φ, sin φ) · q2, q3 = two-link IK, elbow up or down · q4 = φ − q2 − q3 · ${s.reachable ? `4 solutions, ${fit} within the servo limits` : 'out of reach'}`
  },
  legend: [
    { color: RING, label: 'Target, hand pitched φ (red: out of reach)', shape: 'dot' },
    { color: PSI, label: 'Wrist point and its reach circle', shape: 'dot' },
    { color: B_FIELD, label: 'Ghost: other shape, servos can do it', shape: 'dot' },
    { color: HIGH_V, label: 'Ghost: past a joint limit', shape: 'dot' },
  ],
  points: [
    'Inverse kinematics usually has more than one answer. The two-link arm already has two, elbow up and elbow down, mirror images across the line from shoulder to target (see Analytic IK).',
    'For this 4-DOF servo arm, split the problem. The base yaw q1 = atan2(y, x) turns the arm plane toward the target. Step back from the target along the hand, held at pitch φ, to get the wrist point. Shoulder q2 and elbow q3 are the two-link solve for that point, and the wrist takes the rest: q4 = φ − q2 − q3.',
    'The base can also turn 180°: the shoulder then tips back past vertical and the elbow and wrist bend the other way. Two bases times two elbows gives four joint vectors. Here the shoulder sits right on the base axis, so a flipped solution draws the very same arm as an unflipped one; pick it and watch the arm swing over the top to land where it was. Arms with a shoulder offset get a truly different left- or right-shoulder pose instead.',
    'The real servos prune that list. The base only turns ±90° and the shoulder 0…180°, so a flipped pose fits only for a target right at the side, and elbow down often drives the shoulder or wrist past its stop. Among what remains a controller picks the one nearest the current pose, and sticks with it along a path so the arm never flips mid-move.',
  ],
  controls: [
    { kind: 'choice', key: 'pick', options: opts(BRANCHES), initial: 'up' },
    mSlider('rho', 'Target distance out', 0.06, 0.36, 0.2),
    mSlider('z', 'Target height', 0, 0.34, 0.12),
    angleSlider('yaw', 'Target bearing', -90, 90, 30),
    angleSlider('pitch', 'Hand pitch φ', -90, 90, -30),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, MS.at, MS.k, 0.32, -0.6)
    floorMat(g, [-0.3, 0.4], [-0.32, 0.36])
    const lifted = add(g, new THREE.Group(), [0, 0, MS.plinth])
    const look = { w: 0.022, t: 0.017 }
    const ghosts = [0, 1, 2].map(() => {
      const r = serialArm(lifted, SERVO_ARM, { ...look, axes: false })
      return { r, m: ghostRig(r.group, B_FIELD, 0.2) }
    })
    const rig = serialArm(lifted, SERVO_ARM, { ...look, pedestal: MS.plinth })
    const pen = dotPen(lifted, 900, 0.0024)
    const tgt = pointCloud(lifted, 2, 0.008)
    const ghostTags = [0, 1, 2].map(() => liveLabel(lifted, [0, 0, 0], { size: 0.035 }))

    const X = 1.4
    const lines = Array.from({ length: 4 }, (_, i) => liveLabel(scene, [X, 2.9 - i * 0.85, 0.2], { size: 0.32, align: 'left' }))
    addLabel(scene, 'all four solutions (q1, q2, q3, q4):', [X, -0.9, 0.2], GREY, 0.3, 'left')
    const rows = BRANCH_KEYS.map((_, i) => liveLabel(scene, [X, -1.75 - i * 0.75, 0.2], { size: 0.3, align: 'left' }))

    const st = { q: [NaN, 0, 0, 0] }
    return {
      scene,
      view: { center: [-0.5, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = msParams(p)
        const s = servoArmIk(q.target, q.pitch)
        const sol = s.solutions[q.pick]
        if (Number.isNaN(st.q[0])) st.q = [...sol.q]
        st.q = st.q.map((v, i) => glideAngle(dt, v, sol.q[i], 4))
        rig.set(st.q)
        const issue = limitIssue(sol.q)
        SERVO_ARM.limits.forEach(([a, b], i) => rig.glow(i, sol.q[i] < a - 1e-6 || sol.q[i] > b + 1e-6 ? 1 : 0))
        const groups = poseGroups(SERVO_ARM, s.solutions.map((x) => x.q)).filter((gr) => !gr.includes(q.pick))
        ghosts.forEach((gh, k) => {
          const gr = groups[k]
          gh.r.group.visible = ghostTags[k].group.visible = !!gr
          if (!gr) return
          const f = gh.r.set(s.solutions[gr[0]].q)
          const c = gr.some((i) => s.solutions[i].inLimits) ? B_FIELD : HIGH_V
          gh.m.color.set(c)
          const e = originOf(f[2])
          ghostTags[k].set(gr.map((i) => i + 1).join(' · '), c)
          ghostTags[k].group.position.set(e[0], e[1], e[2] + 0.035)
        })
        const twins = s.solutions.map((_, i) => i).filter((i) => i !== q.pick && !groups.some((gr) => gr.includes(i)))

        const [cy, sy] = [Math.cos(s.yaw), Math.sin(s.yaw)]
        const shoulder: V3 = [0, 0, SERVO_ARM_DIMS.base]
        const w = s.wrist
        const wrist: V3 = [w[0] * cy, w[0] * sy, w[1] + SERVO_ARM_DIMS.base]
        const tip = toolOf(armFk(SERVO_ARM, sol.q))
        const bad = !s.reachable
        pen.begin()
        pen.arc(shoulder, SERVO_ARM_DIMS.upper + SERVO_ARM_DIMS.fore, 0, 2 * Math.PI, PSI, 0.7, [cy, sy, 0], [0, 0, 1])
        pen.line(wrist, q.target, 0.008, bad ? HIGH_V : RING, 0.8)
        pen.line([q.target[0], q.target[1], 0], q.target, 0.012, GREY, 0.6)
        pen.arc([0, 0, 0.002], Math.hypot(q.target[0], q.target[1]), 0, s.yaw, GREY, 0.7)
        pen.end()
        tgt.set(0, q.target, bad ? HIGH_V : RING, 1)
        tgt.set(1, wrist, PSI, 0.7)
        tgt.show(2)

        lines[0].set(`q1 = atan2(y, x) = ${deg(s.yaw)}   (or ${deg(wrapPi(s.yaw + Math.PI))} flipped)`, JOINT_COLORS[0])
        lines[1].set(`wrist = target − ${f2(SERVO_ARM_DIMS.hand)}·(cos φ, sin φ) = ${f2(w[0])} out, ${f2(w[1])} up`, PSI)
        lines[2].set(bad ? `wrist ${f2(Math.hypot(w[0], w[1]))} m from the shoulder > ${f2(SERVO_ARM_DIMS.upper + SERVO_ARM_DIMS.fore)} m: no solution` : `cos q3 = ${f2(s.ik.cos2)}  →  q3 = ±${deg(Math.abs(s.ik.down[1]))}, q2 from atan2`, bad ? HIGH_V : JOINT_COLORS[1])
        lines[3].set(`q4 = φ − q2 − q3 = ${deg(sol.q[3])}  →  hand ${xy(tip)} m`, JOINT_COLORS[3])
        s.solutions.forEach((x, i) => {
          const why = limitIssue(x.q)
          rows[i].set(`${i + 1}. ${BRANCHES[BRANCH_KEYS[i]].padEnd(16)} (${x.q.map(deg).join(', ')})  ${why || 'fits the servos'}`, i === q.pick ? (why ? HIGH_V : RING) : why ? GREY : B_FIELD)
        })
        const fit = s.solutions.filter((x) => x.inLimits).length
        status.set(`${BRANCHES[BRANCH_KEYS[q.pick]]}: q = (${sol.q.map(deg).join(', ')})`, LABEL)
        sub.set(`4-DOF servo arm · target ${xy(q.target)} m, hand pitch ${deg(q.pitch)} · floor tape 0.5 m`, GREY)
        event.set(
          bad ? 'out of reach: all four branches collapse to the arm stretched toward it' : `${issue ? `needs ${issue}: the servos cannot do this` : `fits the servos (${fit} of 4 do)`}${twins.length ? ` · same shape as ${twins.map((i) => i + 1).join(', ')}` : ''}`,
          bad || issue ? HIGH_V : RING,
        )
      },
      readouts: (p) => {
        const q = msParams(p)
        const s = servoArmIk(q.target, q.pitch)
        const sol = s.solutions[q.pick]
        const fit = s.solutions.filter((x) => x.inLimits).length
        return [
          { label: 'Reachable', value: s.reachable ? 'yes' : 'no', tone: s.reachable ? 'ok' : 'bad' },
          { label: 'Within limits', value: `${fit} of 4 solutions`, tone: fit ? 'ok' : 'warn' },
          { label: 'Chosen pose', value: sol.q.map(deg).join(', '), tone: sol.inLimits ? 'ok' : 'bad' },
          { label: 'Hand error', value: `${f2(Math.hypot(...toolOf(armFk(SERVO_ARM, sol.q)).map((v, i) => v - q.target[i])) * 1000)} mm` },
        ]
      },
    }
  },
}

// --- Jacobian method: nudge the joints along J until the hand sits on the target. ---

const JM = { at: [-9.6, -3.0, 0] as V3, k: 12.5, L: [0.25, 0.2, 0.15], iters: 60, tol: 0.001, rate: 2, hold: 2.5, scope: { y: -4.6, h: 4.2, lo: -3.5, hi: 0 } }
const METHODS = { dls: 'Damped least squares', transpose: 'Jacobian transpose' }
const STARTS = { bent: 'Bent start', straight: 'Straight start' }
const START_Q = { bent: [110 * DEG, -70 * DEG, -60 * DEG], straight: [0, 0, 0] }
const jmParams = (p: Params) => ({ x: n(p, 'x'), y: n(p, 'y'), lambda: n(p, 'lambda'), method: pick(METHODS, p.method, 'dls'), start: pick(STARTS, p.start, 'bent') })
const jmFk = (q: readonly number[]) => planarFk(JM.L, q).points[JM.L.length]
const jmJac = (q: readonly number[]) => planarJacobian(JM.L, q)
const jmRun = memoBy(
  (q: ReturnType<typeof jmParams>) => `${q.x}|${q.y}|${q.lambda}|${q.method}|${q.start}`,
  (q: ReturnType<typeof jmParams>) => ikIterate(jmFk, jmJac, [q.x, q.y], START_Q[q.start], { method: q.method, lambda: q.lambda, iters: JM.iters, tol: JM.tol }),
)
const mm = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`
const verdict = (run: IkStep[], reach: number, x: number, y: number) => {
  const last = run[run.length - 1]
  if (last.err <= JM.tol) return { text: `converged in ${run.length - 1} steps`, ok: true }
  if (run.length > 2 && run.every((s) => s.q.every((v, i) => v === run[0].q[i]))) return { text: 'stuck: straight arm, J·Jᵀ singular, no step', ok: false, stuck: true }
  if (Math.hypot(x, y) > reach) return { text: `out of reach: settles ${mm(last.err)} short, arm straight`, ok: false }
  return { text: `still ${mm(last.err)} off after ${JM.iters} steps`, ok: false }
}

export const jacobianMethod: Lesson = {
  id: 'inverse-kinematics-jacobian-method',
  title: 'Jacobian method',
  tagline: 'Small steps downhill to the target',
  formula: (p) => {
    const q = jmParams(p)
    const run = jmRun(q)
    return `e = target − FK(q) · ${q.method === 'dls' ? `Δq = Jᵀ(J·Jᵀ + λ²I)⁻¹·e, λ = ${q.lambda.toFixed(2)}` : 'Δq = α·Jᵀ·e, α = (e·JJᵀe)/|JJᵀe|²'} · q ← q + Δq, repeat · ${verdict(run, 0.6, q.x, q.y).text}`
  },
  legend: [
    { color: FORCE, label: 'Error e: hand to target', shape: 'dot' },
    { color: RING, label: 'Hand after each step, error plot', shape: 'dot' },
    { color: B_FIELD, label: 'Ghost: pose one step earlier', shape: 'dot' },
    { color: JOINT_COLORS[0], label: 'J columns: hand velocity per joint', shape: 'dot' },
  ],
  points: [
    'Closed-form IK only exists for simple arms. The general fix is numeric: start from a guess, measure the error e = target − FK(q), change the joints a little to shrink it, and repeat. Each step needs to know which way the hand moves when each joint turns.',
    'That is the Jacobian J: column i is the hand velocity for joint i turning at 1 rad/s, here (−(y_hand − y_i), x_hand − x_i) for joint i at (x_i, y_i). Near the current pose, Δhand ≈ J·Δq, so solving J·Δq = e gives the step. This three-link arm has more joints than the two numbers it must hit, so J is 2×3 and there are infinitely many answers; the solvers pick small ones.',
    'Jacobian transpose uses Δq = α·Jᵀe: cheap and always downhill, but it crawls once the error is small. Damped least squares solves Δq = Jᵀ(J·Jᵀ + λ²I)⁻¹e and lands in a few steps. With λ = 0 it is the plain pseudo-inverse, which blows up near a straight-arm singularity; λ trades a little speed for calm steps there.',
    'Try the straight start with λ = 0: J·Jᵀ is singular and the pseudo-inverse cannot even take a first step. Put the target out of reach: every method ends with the arm pointing straight at it, the closest it can get. The Jacobian topic looks at J itself.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHODS), initial: 'dls' },
    { kind: 'choice', key: 'start', options: opts(STARTS), initial: 'bent' },
    mSlider('x', 'Target x', -0.65, 0.65, 0.38),
    mSlider('y', 'Target y', -0.3, 0.6, 0.22),
    { kind: 'slider', key: 'lambda', label: 'Damping λ (least squares)', min: 0, max: 0.2, step: 0.01, initial: 0.05, format: (v: number) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), JM.at)
    g.scale.setScalar(JM.k)
    box(g, [0.11, 0.16, 0.012], mat('#3a3d45', { rough: 0.6 }), [0, 0, -0.03])
    const arm = planarArm(JM.L)
    const ghost = serialArm(g, arm, { w: 0.044, t: 0.03, gripper: false, axes: false })
    ghostRig(ghost.group, B_FIELD, 0.22)
    ghost.group.position.z = -0.012
    const rig = serialArm(g, arm, { w: 0.044, t: 0.03 })
    const pen = dotPen(g, 900, 0.0035)
    const errArrow = stretchArrow(g, FORCE, 0.0035)
    const tgt = pointCloud(g, 1, 0.013)

    const { y: sy, h: sh, lo, hi } = JM.scope
    const MX = { x: SIDE_SCOPE.x + 0.6, y: 2.6, cell: 2.2, size: 0.42 }
    const grid = matrixGrid(scene, [MX.x, MX.y, 0], 2, 3, { cell: MX.cell, size: MX.size })
    addLabel(scene, 'J =', [MX.x - grid.w / 2 - 0.4, MX.y, 0.2], LABEL, 0.48, 'right')
    ;['q1', 'q2', 'q3'].forEach((c, i) => addLabel(scene, c, [MX.x + (i - 1) * MX.cell, MX.y + grid.h / 2 + 0.55, 0.2], JOINT_COLORS[i], 0.36))
    const lines = [0, 1].map((i) => liveLabel(scene, [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, 0.5 - i * 0.8, 0.2], { size: 0.34, align: 'left' }))
    const plot = sideScope(scene, sy, sh, { divs: [6, 7], zeroAt: (Math.log10(JM.tol) - lo) / (hi - lo) })
    const errTrace = plot.trace(RING, { samples: JM.iters + 1 })
    scopeLabels(scene, sy, sh, null, 'log |e| per step', 'axis = 1 mm goal')
    addLabel(scene, '0', [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, sy - sh / 2 - 1.0, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${JM.iters} steps`, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.0, 0.3], GREY, 0.26, 'right')
    const yOf = (err: number) => -sh / 2 + ((Math.log10(Math.max(err, 1e-6)) - lo) / (hi - lo)) * sh

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = jmParams(p)
        const run = jmRun(q)
        const key = `${q.x}|${q.y}|${q.lambda}|${q.method}|${q.start}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        const N = run.length - 1
        if (st.t > N / JM.rate + JM.hold) st.t = 0
        const u = Math.min(N, st.t * JM.rate)
        const k = Math.min(N, Math.floor(u))
        const a = run[k]
        const b = run[Math.min(N, k + 1)]
        const s = Math.min(1, (u - k) * 1.6)
        const qNow = a.q.map((v, i) => v + wrapPi(b.q[i] - v) * s)
        rig.set(qNow)
        ghost.set(run[Math.max(0, k - (s >= 1 ? 0 : 1))].q)
        ghost.group.visible = k > 0 || s > 0.05
        const tip = jmFk(qNow)
        const done = k >= N

        pen.begin()
        const reach = JM.L.reduce((x, y) => x + y, 0)
        pen.arc([0, 0, -0.02], reach, 0, 2 * Math.PI, GREY, 0.7)
        for (let i = 0; i <= k; i++) pen.dot([run[i].tip[0], run[i].tip[1], 0.04], RING, i === k ? 1.4 : 0.9)
        for (let i = 1; i <= k; i++) pen.line([run[i - 1].tip[0], run[i - 1].tip[1], 0.035], [run[i].tip[0], run[i].tip[1], 0.035], 0.01, RING, 0.5)
        pen.arc([q.x, q.y, 0.04], 0.025, 0, 2 * Math.PI, Math.hypot(q.x, q.y) > reach ? HIGH_V : RING, 0.9)
        pen.end()
        errArrow([tip[0], tip[1], 0.05], [q.x, q.y, 0.05])
        tgt.set(0, [q.x, q.y, 0.04], Math.hypot(q.x, q.y) > reach ? HIGH_V : RING)
        tgt.show(1)

        const J = jmJac(a.q)
        grid.set(J.flat().map(f2), JOINT_COLORS.slice(0, 3))
        const e = [q.x - a.tip[0], q.y - a.tip[1]]
        const dq = b.q.map((v, i) => wrapPi(v - a.q[i]))
        lines[0].set(`step ${k}: e = ${xy(e)} m, |e| = ${mm(a.err)}`, FORCE)
        lines[1].set(done ? `final q = (${a.q.map(deg).join(', ')})` : `Δq = (${dq.map(deg).join(', ')})`, done ? RING : LABEL)
        const us = run.slice(0, k + 1).map((_, i) => i / JM.iters)
        errTrace.points(us, run.slice(0, k + 1).map((r) => yOf(r.err)))
        const v = verdict(run, reach, q.x, q.y)
        status.set(`step ${k} of ${N} · |e| = ${mm(a.err)}`, LABEL)
        sub.set(`${METHODS[q.method]}${q.method === 'dls' ? `, λ ${q.lambda.toFixed(2)}` : ''} · 3-link arm ${JM.L.map(f2).join(' + ')} m · ${JM.rate} steps/s`, GREY)
        event.set(done || v.stuck ? v.text : 'step: e from FK, Δq from J, q ← q + Δq', done || v.stuck ? (v.ok ? RING : HIGH_V) : LABEL)
      },
      readouts: (p) => {
        const q = jmParams(p)
        const run = jmRun(q)
        const last = run[run.length - 1]
        const ok = last.err <= JM.tol
        return [
          { label: 'Steps', value: ok ? `${run.length - 1} to 1 mm` : `${JM.iters}, not within 1 mm`, tone: ok ? 'ok' : 'warn' },
          { label: 'Final error', value: mm(last.err), tone: ok ? 'ok' : 'bad' },
          { label: 'Final angles', value: last.q.map(deg).join(', ') },
          { label: 'Start error', value: mm(run[0].err) },
        ]
      },
    }
  },
}
