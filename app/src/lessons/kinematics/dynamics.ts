import * as THREE from 'three/webgpu'
import {
  DEG, FeedForward, PointMass, SERVO_ARM_DIMS, SERVO_DRIVES, SERVO_GEAR, TrackFrame, V2n, couplingTorque, fastestMove, gravity, inverseDynamics, massMatrix, maxPayload, moveDemand, planarArm, restMove, servoTwoLink,
  toDeg, trackRun, twoLinkTip,
} from '../../core/physics'
import { degText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  DATA_COLOR, FORCE, GREY, HIGH_V, JOINT_COLORS, LABEL, PID_COLORS, POWER, RING, SIDE_SCOPE, addLabel, ghostRig, lapseClock, liveLabel, memoBy, scopeLabels, serialArm, sideScope, statusHeader, stretchArrow,
  sumBars, traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const L: V2n = [SERVO_ARM_DIMS.upper, SERVO_ARM_DIMS.fore + SERVO_ARM_DIMS.hand]
const AT: V3 = [-9, -2.2, 0]
const K = 20
const DT = 0.002
const STALL = SERVO_DRIVES[0].stallNm
const FREE = (SERVO_DRIVES[0].freeRpm * 2 * Math.PI) / 60
const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
const BX = X0 + 4.4
const nm = (v: number) => `${Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−')} N·m`
const deg = (a: number) => degText(Math.abs(a) < 0.05 * DEG ? 0 : toDeg(a), 1)
const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`
const gSlider = (max: number, initial: number) => ({ kind: 'slider' as const, key: 'payload', label: 'Payload in the gripper', min: 0, max, step: 10, initial, format: (v: number) => `${v} g` })
const TERM = { inertial: DATA_COLOR, coriolis: RING, gravity: FORCE }
const handGap = (a: readonly number[], b: readonly number[]) => {
  const [p, r] = [twoLinkTip(L[0], L[1], a[0], a[1]), twoLinkTip(L[0], L[1], b[0], b[1])]
  return Math.hypot(p[0] - r[0], p[1] - r[1])
}
const frameAt = (run: readonly TrackFrame[], t: number) => run[Math.min(run.length - 1, Math.max(0, Math.floor(t / DT)))]
const peak = (run: readonly TrackFrame[], f: (fr: TrackFrame) => number) => run.reduce((m, fr) => Math.max(m, Math.abs(f(fr))), 0)

/** Looping sim clock whose run length can change: restarts on a new key, holds `rest` s at the end. */
function runClock(slow: number, rest: number) {
  const st = { key: '', t: 0 }
  return (dt: number, key: string, seconds: number) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t += dt * slow
    if (st.t > seconds + rest) st.t = 0
    return Math.min(st.t, seconds)
  }
}

/** Side-view shoulder + elbow of the servo arm on a pedestal: reference ghost, weight arrows per point mass, payload block. */
function dynRig(scene: THREE.Object3D) {
  const g = add(scene, new THREE.Group(), AT)
  g.scale.setScalar(K)
  box(g, [0.04, 0.15, 0.04], mat('#3a3d45', { rough: 0.6 }), [0, -0.085, -0.02])
  box(g, [0.22, 0.012, 0.1], mat('#2a2c32', { rough: 0.7 }), [0.02, -0.166, -0.02])
  const look = { w: 0.026, t: 0.02 }
  const ghost = serialArm(g, planarArm(L), look)
  ghostRig(ghost.group, GREY, 0.3)
  const arm = serialArm(g, planarArm(L), look)
  const weights = Array.from({ length: 9 }, () => stretchArrow(g, FORCE, 0.0016))
  const load = box(g, [1, 1, 1], mat('#9a6a3a', { rough: 0.6 }))
  return {
    set(q: readonly number[], ref: readonly number[], pts: readonly PointMass[][], payloadKg: number) {
      ghost.set(ref)
      arm.set(q)
      const elbow: V3 = [L[0] * Math.cos(q[0]), L[0] * Math.sin(q[0]), 0]
      const at = (link: number, r: number): V3 => {
        const a = link === 0 ? q[0] : q[0] + q[1]
        const o = link === 0 ? [0, 0] : elbow
        return [o[0] + r * Math.cos(a), o[1] + r * Math.sin(a), 0.03]
      }
      const all = pts.flatMap((ps, link) => ps.map((p) => ({ p: at(link, p.r), kg: p.kg })))
      const side = 0.022 + 0.025 * Math.cbrt(payloadKg / 0.3)
      load.visible = payloadKg > 0
      const tip = at(1, L[1])
      load.scale.setScalar(side)
      load.position.set(tip[0], tip[1] - side / 2 - 0.012, 0)
      weights.forEach((w, i) => {
        const m = all[i]
        if (!m) return w([0, 0, 0], [0, 0, 0])
        const from: V3 = payloadKg > 0 && i === all.length - 1 ? [tip[0], tip[1] - side / 2 - 0.012, 0.03] : m.p
        w(from, [from[0], from[1] - 0.012 - m.kg * 0.35, from[2]])
      })
    },
    glow: arm.glow,
  }
}

/** Shoulder/elbow torque groups as `sumBars`, 100 % = servo stall. */
function torqueGroups(scene: THREE.Object3D, y0: number, rows: readonly { label: string; color: string }[], gap: number) {
  return [0, 1].map((j) => {
    const y = y0 - j * gap
    addLabel(scene, j === 0 ? 'Shoulder (joint 1)' : 'Elbow (joint 2)', [BX - 3.3, y + 0.62, 0.2], JOINT_COLORS[j], 0.3, 'left')
    return sumBars(scene, [BX, y, 0], rows, 6)
  })
}

// --- Gravity torque: hold the arm up, PD alone sags, g(q) feed-forward carries the weight. ---

const GT = { qa: [-30 * DEG, 100 * DEG], qb: [20 * DEG, -20 * DEG], t0: 0.4, T: 1.2, seconds: 3.6, kp: [4, 2] as V2n, kd: [0.3, 0.15] as V2n, range: 15 * DEG, scope: { y: -5.4, h: 3 } }
const GT_FF = { none: 'PD only', gravity: 'PD + g(q) feed-forward' }
const gtParams = (p: Params) => ({ ff: pick(GT_FF, p.ff, 'none') as FeedForward, kg: n(p, 'payload') / 1000 })
const gtKey = (q: ReturnType<typeof gtParams>) => `${q.ff}|${q.kg}`
const gtRun = memoBy(gtKey, (q: ReturnType<typeof gtParams>) => {
  const { arm, points } = servoTwoLink(q.kg)
  const run = trackRun(arm, restMove(GT.qa, GT.qb, GT.T, GT.t0), { kp: GT.kp, kd: GT.kd, ff: q.ff, drives: SERVO_DRIVES }, GT.seconds, DT)
  return { arm, points, run, end: run[run.length - 1] }
})

export const dynamicsGravityTorque: Lesson = {
  id: 'dynamics-gravity-torque',
  title: 'Gravity torque',
  tagline: 'What it costs just to hold the arm up',
  formula: (p) => {
    const r = gtRun(gtParams(p))
    const g = gravity(r.arm, GT.qb)
    return `g1 = (m1·lc1 + m2·l1)·g·cos θ1 + m2·lc2·g·cos(θ1+θ2) · g2 = m2·lc2·g·cos(θ1+θ2) · reached out: g = (${nm(g[0])}, ${nm(g[1])}) · PD alone sags until kp·e = g(q)`
  },
  legend: [
    { color: FORCE, label: 'Weights m·g (servos, brackets, gripper, load)', shape: 'dot' },
    { color: PID_COLORS.p, label: 'PD torque from the error', shape: 'dot' },
    { color: POWER, label: 'Motor torque τ (100 % = MG996R stall)', shape: 'dot' },
    { color: GREY, label: 'Ghost: where the arm should be', shape: 'dot' },
  ],
  points: [
    'Hold the arm still and the motors still work: every mass hangs on the joints below it. The torque that cancels gravity is g(q), the static part of the arm’s equation of motion M(q)q̈ + C(q,q̇)q̇ + g(q) = τ. For each mass it is Jᵀ·m·g (Robot arm build: holding torque), summed over the servos, brackets, gripper and load.',
    'g(q) depends only on the pose. Each term is weight × horizontal lever, so it peaks with the links flat and vanishes with them vertical: g1 carries everything past the shoulder, g2 only the forearm, hand and load. Here the shoulder and elbow of the servo arm move from tucked low to reaching out, wrist locked.',
    'A PD loop (PID: Proportional only) makes torque only from an error, so to hold g(q) it must keep an error e = g(q)/kp: the arm sags below the ghost, more with a heavier load. An integral term would wind it out slowly. Feed-forward does it at once: add g(q) of the target pose to the motor command and PD only fixes what is left.',
    'Past about 250 g the shoulder needs more than the servo’s stall torque reached out: no controller can hold it there (the τ bar turns red). Payload limits adds the torque it takes to move fast.',
  ],
  controls: [{ kind: 'choice', key: 'ff', options: opts(GT_FF), initial: 'none' }, gSlider(250, 100)],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = dynRig(scene)
    const groups = torqueGroups(scene, 2.9, [{ label: 'PD', color: PID_COLORS.p }, { label: 'g(q) ff', color: FORCE }, { label: 'τ', color: POWER }], 2.5)
    const gLine = liveLabel(scene, [X0, -1.75, 0.2], { size: 0.3, align: 'left' })
    const { y: sy, h: sh } = GT.scope
    const plot = sideScope(scene, sy, sh, { divs: [9, 4], zeroAt: 0.5 })
    const traces = [0, 1].map((j) => plot.trace(JOINT_COLORS[j], { samples: 200 }))
    scopeLabels(scene, sy, sh, GT.seconds, 'Joint error θref − θ (edge = ±15°)', 'real time')
    const clock = lapseClock(GT.seconds, 1, 1)
    let t = 0
    return {
      scene,
      view: { center: [-1.5, -0.6, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = gtParams(p)
        const r = gtRun(q)
        t = clock(dt, gtKey(q))
        const f = frameAt(r.run, t)
        rig.set(f.q, f.ref.q, r.points, q.kg)
        f.clipped.forEach((c, i) => rig.glow(i, c ? 1 : 0))
        groups.forEach((b, i) => b.set([f.pd[i] / STALL, f.ff[i] / STALL, f.tau[i] / STALL], f.clipped[i]))
        const gq = gravity(r.arm, f.q)
        gLine.set(`g(q) now = (${nm(gq[0])}, ${nm(gq[1])})`, FORCE)
        traces.forEach((tr, j) => traceRun(tr, r.run, DT, GT.seconds, t, (fr) => ((fr.ref.q[j] - fr.q[j]) / GT.range) * (sh / 2)))
        const sag = handGap(f.q, f.ref.q)
        const moving = t > GT.t0 && t < GT.t0 + GT.T
        status.set(`g(q) = (${nm(gq[0])}, ${nm(gq[1])}) · hand ${mm(sag)} off target`, LABEL)
        sub.set(`side view · shoulder + elbow of the servo arm, wrist locked · payload ${Math.round(q.kg * 1000)} g · kp ${GT.kp.join(' / ')} N·m/rad`, GREY)
        event.set(
          f.clipped[0] || f.clipped[1]
            ? 'a servo is at stall torque: it cannot hold this load here'
            : moving
              ? 'moving: the needed torque changes with the pose'
              : q.ff === 'none'
                ? `PD only: sagging until kp·e = g(q), shoulder error ${deg(f.ref.q[0] - f.q[0])}`
                : 'g(q) feed-forward carries the weight: on target with no error',
          f.clipped[0] || f.clipped[1] ? HIGH_V : q.ff === 'none' && !moving ? FORCE : POWER,
        )
      },
      readouts: (p) => {
        const r = gtRun(gtParams(p))
        const f = frameAt(r.run, t)
        const gq = gravity(r.arm, f.q)
        const share = Math.abs(f.tau[0]) / STALL
        return [
          { label: 'Gravity torque g(q)', value: `${nm(gq[0])}, ${nm(gq[1])}` },
          { label: 'Hand off target', value: mm(handGap(f.q, f.ref.q)), tone: handGap(f.q, f.ref.q) > 0.005 ? 'warn' : 'ok' },
          { label: 'Shoulder torque', value: `${Math.round(share * 100)} % of stall`, tone: share >= 0.999 ? 'bad' : share > 0.5 ? 'warn' : 'ok' },
          { label: 'Settled sag (end)', value: mm(handGap(r.end.q, r.end.ref.q)), tone: handGap(r.end.q, r.end.ref.q) > 0.005 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Inertia: a fast shoulder swing; M(q), coupling into the elbow, reflected rotor inertia, computed-torque feed-forward. ---

const IN = { qa: [-20 * DEG, 70 * DEG], qb: [80 * DEG, 70 * DEG], t0: 0.2, after: 0.8, kg: 0.1, wn: 12, zeta: 0.8, slow: 0.25, range: 20 * DEG, scope: { y: -5.6, h: 2.6 } }
const IN_FF = { gravity: 'PD + g(q)', full: 'PD + inverse dynamics' }
const GEARS = { servo: `Servo gearbox 1:${SERVO_GEAR.ratio}`, direct: 'Direct drive' }
const inParams = (p: Params) => ({ ff: pick(IN_FF, p.ff, 'gravity') as FeedForward, gear: pick(GEARS, p.gear, 'servo'), T: n(p, 'time') })
const inKey = (q: ReturnType<typeof inParams>) => `${q.ff}|${q.gear}|${q.T}`
const inRun = memoBy(inKey, (q: ReturnType<typeof inParams>) => {
  const { arm, points } = servoTwoLink(IN.kg, { ratio: q.gear === 'servo' ? SERVO_GEAR.ratio : 1 })
  const seconds = IN.t0 + q.T + IN.after
  const M = massMatrix(arm, IN.qa)
  const kp: V2n = [IN.wn ** 2 * M[0][0], IN.wn ** 2 * M[1][1]]
  const kd: V2n = [2 * IN.zeta * IN.wn * M[0][0], 2 * IN.zeta * IN.wn * M[1][1]]
  const run = trackRun(arm, restMove(IN.qa, IN.qb, q.T, IN.t0), { kp, kd, ff: q.ff }, seconds, DT)
  return { arm, points, run, seconds, elbowErr: peak(run, (f) => f.ref.q[1] - f.q[1]), shoulderErr: peak(run, (f) => f.ref.q[0] - f.q[0]), coupling: peak(run, (f) => couplingTorque(arm, f.q, f.qd, f.qdd)) }
})

export const dynamicsInertia: Lesson = {
  id: 'dynamics-inertia',
  title: 'Inertia',
  tagline: 'Mass in motion pushes back',
  formula: (p) => {
    const r = inRun(inParams(p))
    const M = massMatrix(r.arm, IN.qa)
    return `M(q)q̈ + C(q,q̇)q̇ + g(q) = τ · M = [${M[0][0].toFixed(4)} ${M[0][1].toFixed(4)}; ${M[1][0].toFixed(4)} ${M[1][1].toFixed(4)}] kg·m² · elbow feels M21·q̈1 + h·q̇1² · rotor J·N² = ${r.arm.rotor[0].toFixed(4)} kg·m²`
  },
  legend: [
    { color: TERM.inertial, label: 'Inertial M(q)·q̈', shape: 'dot' },
    { color: TERM.coriolis, label: 'Coriolis + centrifugal C(q,q̇)·q̇', shape: 'dot' },
    { color: TERM.gravity, label: 'Gravity g(q)', shape: 'dot' },
    { color: POWER, label: 'Motor torque τ (100 % = MG996R stall)', shape: 'dot' },
  ],
  points: [
    'Lagrange’s equation for the two-link arm: M(q)q̈ + C(q,q̇)q̇ + g(q) = τ. M is the inertia matrix: M11 = m1·lc1² + I1 + m2(l1² + lc2² + 2·l1·lc2·cos θ2) + I2 grows as the elbow opens, because the forearm’s mass swings on a longer radius. The off-diagonal M12 couples the joints.',
    'Swing only the shoulder fast and the elbow still gets a torque: M21·q̈1 while the shoulder speeds up and slows down, plus the centrifugal h·q̇1² (h = m2·l1·lc2·sin θ2) flinging the forearm out. C also holds the Coriolis term −h·q̇2(2q̇1 + q̇2) when both joints turn. The elbow, told to hold, is shoved off (watch its error), more the shorter the move.',
    'Inverse dynamics fixes it: compute τ = M(q)q̈ + C·q̇ + g for the planned move (Trajectories: the quintic gives q̈) and send it as feed-forward; PD only cleans up model error. That is computed-torque control, the dynamic big brother of gravity feed-forward.',
    'Gears change the picture. A rotor of inertia J behind an N:1 gearbox feels like J·N² at the joint: 1:250 turns a tiny 2.5·10⁻⁷ kg·m² rotor into 0.016 kg·m², more than the whole arm. That constant mass on each diagonal swamps the coupling, which is why hobby servos get away with plain PD; direct-drive arms cannot. Both loops here are tuned to the same speed (ωn = 12 rad/s on their own M_ii). Ideal motors here, no torque limit: the τ bar turns red (“clipped”) past 100 %, where a real MG996R would give up.',
  ],
  controls: [
    { kind: 'choice', key: 'ff', options: opts(IN_FF), initial: 'gravity' },
    { kind: 'choice', key: 'gear', options: opts(GEARS), initial: 'servo' },
    { kind: 'slider', key: 'time', label: 'Shoulder move time', min: 0.3, max: 2, step: 0.1, initial: 0.5, format: (v: number) => `${v.toFixed(1)} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = dynRig(scene)
    const rows = [
      { label: 'M·q̈', color: TERM.inertial },
      { label: 'C·q̇', color: TERM.coriolis },
      { label: 'g(q)', color: TERM.gravity },
      { label: 'τ', color: POWER },
    ]
    const groups = torqueGroups(scene, 3.1, rows, 3.2)
    const { y: sy, h: sh } = IN.scope
    const plot = sideScope(scene, sy, sh, { divs: [8, 4], zeroAt: 0.5 })
    const traces = [plot.trace(JOINT_COLORS[0], { samples: 200 }), plot.trace(JOINT_COLORS[1], { samples: 200 }), plot.trace(GREY, { samples: 200, radius: 0.08 })]
    scopeLabels(scene, sy, sh, null, 'Joint error (±20°) · grey: shoulder → elbow torque', '')
    const clockText = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })
    addLabel(scene, '0 s', [X0, sy - sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const clock = runClock(IN.slow, 0.6)
    const st = { t: 0 }
    return {
      scene,
      view: { center: [-1.5, -0.6, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = inParams(p)
        const r = inRun(q)
        const t = (st.t = clock(dt, inKey(q), r.seconds))
        const f = frameAt(r.run, t)
        rig.set(f.q, f.ref.q, r.points, IN.kg)
        groups.forEach((b, i) => b.set([f.split.inertial[i] / STALL, f.split.coriolis[i] / STALL, f.split.gravity[i] / STALL, f.tau[i] / STALL], Math.abs(f.tau[i]) > STALL))
        traces.forEach((tr, j) => traceRun(tr, r.run, DT, r.seconds, t, (fr) => ((fr.ref.q[j] - fr.q[j]) / IN.range) * (sh / 2)))
        traceRun(traces[2], r.run, DT, r.seconds, t, (fr) => (couplingTorque(r.arm, fr.q, fr.qd, fr.qdd) / STALL) * (sh / 2))
        clockText.set(`${t.toFixed(2)} of ${r.seconds.toFixed(1)} s · ¼× slow motion`, GREY)
        const M = massMatrix(r.arm, f.q)
        const c = couplingTorque(r.arm, f.q, f.qd, f.qdd)
        status.set(`M11 ${M[0][0].toFixed(4)} · M12 ${M[0][1].toFixed(4)} kg·m² · elbow pushed ${nm(c)} by the shoulder`, LABEL)
        sub.set(`side view · ${GEARS[q.gear].toLowerCase()} · ${Math.round(IN.kg * 1000)} g load · shoulder −20° → 80° in ${q.T.toFixed(1)} s, elbow told to hold 70°`, GREY)
        const e2 = Math.abs(f.ref.q[1] - f.q[1])
        const shoved = r.elbowErr > 2 * DEG
        event.set(
          e2 > 2 * DEG
            ? `coupling: the shoulder’s swing shoves the elbow ${deg(e2)} off`
            : q.ff === 'full'
              ? 'inverse dynamics feeds M·q̈ + C·q̇ + g ahead: both joints on the ghost'
              : shoved
                ? `PD + g(q): the swing shoves the elbow up to ${deg(r.elbowErr)} off`
                : q.gear === 'servo'
                  ? 'the rotor’s J·N² dwarfs the coupling: the elbow barely notices'
                  : 'slow move: little coupling',
          e2 > 2 * DEG || shoved ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const r = inRun(inParams(p))
        const f = frameAt(r.run, st.t)
        const M = massMatrix(r.arm, f.q)
        return [
          { label: 'Peak elbow error', value: deg(r.elbowErr), tone: r.elbowErr > 3 * DEG ? 'bad' : r.elbowErr > 1 * DEG ? 'warn' : 'ok' },
          { label: 'Peak shoulder error', value: deg(r.shoulderErr), tone: r.shoulderErr > 3 * DEG ? 'bad' : r.shoulderErr > 1 * DEG ? 'warn' : 'ok' },
          { label: 'Peak coupling on elbow', value: nm(r.coupling) },
          { label: 'Rotor share of M11', value: `${Math.round((r.arm.rotor[0] / M[0][0]) * 100)} %` },
        ]
      },
    }
  },
}

// --- Payload limits: torque demand of a lift vs the servo's torque–speed line; heavier means slower. ---

const PL = { qa: [-30 * DEG, 60 * DEG], qb: [70 * DEG, -20 * DEG], t0: 0.3, after: 1, kp: [4, 2] as V2n, kd: [0.3, 0.15] as V2n, span: 1.5, scope: { y: -3.6, h: 4.2 } }
const plParams = (p: Params) => ({ kg: n(p, 'payload') / 1000, T: n(p, 'time') })
const plKey = (q: ReturnType<typeof plParams>) => `${q.kg}|${q.T}`
const plBuild = (kg: number) => servoTwoLink(kg).arm
const plLimits = memoBy(plKey, (q: ReturnType<typeof plParams>) => ({
  fastest: fastestMove(plBuild(q.kg), PL.qa, PL.qb),
  heaviest: maxPayload(PL.qa, PL.qb, q.T, plBuild),
  demand: moveDemand(plBuild(q.kg), PL.qa, PL.qb, q.T),
}))
const plRun = memoBy(plKey, (q: ReturnType<typeof plParams>) => {
  const { arm, points } = servoTwoLink(q.kg)
  const seconds = PL.t0 + q.T + PL.after
  const ref = restMove(PL.qa, PL.qb, q.T, PL.t0)
  const run = trackRun(arm, ref, { kp: PL.kp, kd: PL.kd, ff: 'full', drives: SERVO_DRIVES }, seconds, DT)
  const plan = run.map((f) => ({ w: f.ref.qd, tau: inverseDynamics(arm, f.ref.q, f.ref.qd, f.ref.qdd).tau }))
  return { arm, points, run, plan, seconds, lag: peak(run, (f) => handGap(f.q, f.ref.q)) }
})
const pctOr = (w: number) => (w > 9.99 ? '> 999 %' : `${Math.round(w * 100)} %`)
const secsOr = (s: number) => (Number.isFinite(s) ? `${s.toFixed(2)} s` : 'cannot hold')

export const dynamicsPayloadLimits: Lesson = {
  id: 'dynamics-payload-limits',
  title: 'Payload limits',
  tagline: 'Heavier means slower',
  formula: (p) => {
    const q = plParams(p)
    const l = plLimits(q)
    return `τ(t) = M(q)q̈ + C·q̇ + g(q) along the move · servo gives τ ≤ τstall·(1 − ω/ωfree) · ${Math.round(q.kg * 1000)} g: fastest ${secsOr(l.fastest)} · ${q.T.toFixed(1)} s move: up to ${Math.round(l.heaviest * 1000)} g`
  },
  legend: [
    { color: JOINT_COLORS[0], label: 'Shoulder: torque vs speed along the move', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'Elbow: torque vs speed', shape: 'dot' },
    { color: GREY, label: 'MG996R line: τstall → ωfree', shape: 'dot' },
    { color: HIGH_V, label: 'Demand past the line: falls behind', shape: 'dot' },
  ],
  points: [
    'A servo’s output follows a straight torque–speed line: full stall torque at rest, none at free speed (DC motor: Torque and speed curve; Motor selection: Torque budget). Every instant of a move asks for a point (speed, torque) per joint; the move is possible only if every point stays under the line.',
    'The torque asked for is the whole inverse dynamics: g(q) to hold the load up (Gravity torque), plus M(q)q̈ to speed it up and slow it down, plus C·q̇ (Inertia). A faster move raises both the speed and the M·q̈ part; a heavier load raises g and M. So the plot bulges up and right as you shorten the move or add grams.',
    'Past the line the servo saturates: the arm, still run with computed-torque feed-forward, falls behind the ghost and catches up late. The cure is a slower time scaling (Trajectories: Time scaling) or a lighter load. The readouts give both trade-offs: the fastest safe move for this payload, and the heaviest payload for this move time.',
    'Static holding is the floor: once g(q) alone passes stall at some pose on the path, no move time works (just over 250 g here, reached out). Datasheet payloads are quoted at a pose and a speed for that reason.',
  ],
  controls: [gSlider(300, 100), { kind: 'slider', key: 'time', label: 'Move time', min: 0.4, max: 3, step: 0.1, initial: 1.5, format: (v: number) => `${v.toFixed(1)} s` }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = dynRig(scene)
    addLabel(scene, 'Shoulder torque split', [BX - 3.3, 3.6, 0.2], JOINT_COLORS[0], 0.3, 'left')
    const bars = sumBars(scene, [BX, 3, 0], [{ label: 'M·q̈', color: TERM.inertial }, { label: 'C·q̇', color: TERM.coriolis }, { label: 'g(q)', color: TERM.gravity }, { label: 'τ', color: POWER }], 6)
    const { y: sy, h: sh } = PL.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 6], zeroAt: 0.5 })
    const u = (w: number) => Math.min(1, Math.abs(w) / FREE / PL.span)
    const y = (tau: number, w = 0) => Math.max(-1, Math.min(1, ((w === 0 ? Math.sign(tau) : Math.sign(w)) * Math.abs(tau)) / STALL / PL.span)) * (sh / 2)
    plot.trace(GREY, { samples: 2, radius: 0.08 }).points([0, 1 / PL.span], [y(STALL), y(0)])
    plot.trace(GREY, { samples: 2, radius: 0.08 }).points([0, 1], [y(-STALL), y(-STALL)])
    const traces = [0, 1].map((j) => plot.trace(JOINT_COLORS[j], { samples: 240, radius: 0.09 }))
    scopeLabels(scene, sy, sh, null, 'τ / stall vs |ω| / free speed (up: driving, down: braking)', '')
    addLabel(scene, '0', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, 'ωfree', [X0 + SIDE_SCOPE.w / PL.span, sy - sh / 2 - 0.9, 0.3], GREY, 0.26)
    addLabel(scene, 'τstall', [X0 - 0.3, sy + y(STALL), 0.3], GREY, 0.26, 'right')
    addLabel(scene, '−τstall', [X0 - 0.3, sy + y(-STALL), 0.3], GREY, 0.26, 'right')
    const clock = runClock(1, 1)
    const st = { t: 0 }
    return {
      scene,
      view: { center: [-1.5, -0.6, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = plParams(p)
        const r = plRun(q)
        const l = plLimits(q)
        st.t = clock(dt, plKey(q), r.seconds)
        const f = frameAt(r.run, st.t)
        rig.set(f.q, f.ref.q, r.points, q.kg)
        f.clipped.forEach((c, i) => rig.glow(i, c ? 1 : 0))
        bars.set([f.split.inertial[0] / STALL, f.split.coriolis[0] / STALL, f.split.gravity[0] / STALL, f.tau[0] / STALL], f.clipped[0])
        const k = Math.min(r.plan.length, Math.floor(st.t / DT) + 1)
        const step = Math.max(1, Math.ceil(r.plan.length / 239))
        traces.forEach((tr, j) => {
          const pts = r.plan.slice(0, k).filter((_, i) => i % step === 0 || i === k - 1)
          tr.points(pts.map((s) => u(s.w[j])), pts.map((s) => y(s.tau[j], s.w[j])))
        })
        const over = l.demand.worst > 1
        const lag = handGap(f.q, f.ref.q)
        status.set(`peak demand ${pctOr(l.demand.worst)} of what the servo gives · hand ${mm(lag)} behind`, over ? HIGH_V : LABEL)
        sub.set(`side view · MG996R shoulder + elbow · ${Math.round(q.kg * 1000)} g lifted in ${q.T.toFixed(1)} s · computed-torque feed-forward · real time`, GREY)
        event.set(
          !Number.isFinite(l.fastest)
            ? 'too heavy: gravity alone passes stall on this path, no speed works'
            : over
              ? `past the line at the ${l.demand.joint === 0 ? 'shoulder' : 'elbow'}: slow to ${l.fastest.toFixed(2)} s${l.heaviest > 0 ? ` or drop to ${Math.round(l.heaviest * 1000)} g` : ', too fast even empty'}`
              : `within the line: ${Math.round((1 - l.demand.worst) * 100)} % margin`,
          over ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const q = plParams(p)
        const l = plLimits(q)
        const r = plRun(q)
        return [
          { label: 'Peak demand', value: `${pctOr(l.demand.worst)}, ${l.demand.joint === 0 ? 'shoulder' : 'elbow'}`, tone: l.demand.worst > 1 ? 'bad' : l.demand.worst > 0.8 ? 'warn' : 'ok' },
          { label: `Fastest at ${Math.round(q.kg * 1000)} g`, value: secsOr(l.fastest), tone: Number.isFinite(l.fastest) ? 'ok' : 'bad' },
          { label: `Heaviest in ${q.T.toFixed(1)} s`, value: `${Math.round(l.heaviest * 1000)} g` },
          { label: 'Worst hand lag', value: mm(r.lag), tone: r.lag > 0.01 ? 'bad' : r.lag > 0.003 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
