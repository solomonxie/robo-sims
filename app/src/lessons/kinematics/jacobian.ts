import * as THREE from 'three/webgpu'
import { DEG, Mat, SERVO_ARM, armJacobian, handVelocity, jointTorques, manipulability, planarArm, planarJacobian, resolvedRateRun, toDeg, toolOf, twoLinkIk, weightN, wrapPi } from '../../core/physics'
import { degText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HIGH_V, JOINT_COLORS, LABEL, RING, SIDE_SCOPE, addLabel, dotPen, flatBox, floorMat, glide, glowMat, liveLabel, matrixGrid, memoBy, scopeLabels, serialArm, setGlow, sideScope, statusHeader, stretchArrow, zUp } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f2 = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−'))
const f3 = (v: number) => (Math.abs(v) < 0.0005 ? '0.000' : v.toFixed(3).replace('-', '−'))
const fw = (w: number) => (w < 5e-5 ? '0' : w.toPrecision(2))
const deg = (a: number) => degText(Math.abs(a) < 0.5 * DEG ? 0 : toDeg(a), 0)
const dps = (w: number) => `${Math.round(toDeg(w)).toString().replace('-', '−')}°/s`
const angleSlider = (key: string, label: string, min: number, max: number, initial: number) => ({ kind: 'slider' as const, key, label, min, max, step: 5, initial, format: (v: number) => `${v}°` })
const plate = (g: THREE.Object3D) => box(g, [0.11, 0.16, 0.012], mat('#3a3d45', { rough: 0.6 }), [0, 0, -0.03])
const toward = (a: V3, d: readonly number[], k: number, cap: number): V3 => {
  const len = Math.hypot(...d) * k
  const s = len > cap ? cap / len : 1
  return [a[0] + d[0] * k * s, a[1] + d[1] * k * s, a[2] + (d[2] ?? 0) * k * s]
}

/** Signed horizontal bars, ±`max` = full half-width, value text on the right. */
function signedBars(parent: THREE.Object3D, at: V3, labels: readonly string[], colors: readonly string[], w = 6) {
  const rows = labels.map((label, j) => {
    const y = at[1] - j * 0.62
    const g = add(parent, new THREE.Group())
    flatBox(g, [w, 0.34, 0.05], new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), [at[0], y, 0])
    addLabel(g, label, [at[0] - w / 2 - 0.3, y, 0.2], colors[j], 0.3, 'right')
    const m = glowMat(colors[j], 0.9)
    const fill = flatBox(g, [1, 0.26, 0.08], m, [at[0], y, 0.06])
    const value = liveLabel(g, [at[0] + w / 2 + 0.3, y, 0.2], { size: 0.28, align: 'left' })
    return { g, m, fill, value, color: colors[j] }
  })
  const axis = flatBox(parent, [0.06, (labels.length - 1) * 0.62 + 0.74, 0.06], glowMat(GREY, 0.4), [at[0], at[1] - (labels.length - 1) * 0.31, 0.12])
  return {
    show(on: boolean, count = labels.length) {
      rows.forEach((r, j) => (r.g.visible = on && j < count))
      axis.visible = on
      axis.scale.y = ((count - 1) * 0.62 + 0.74) / ((labels.length - 1) * 0.62 + 0.74)
      axis.position.y = at[1] - (count - 1) * 0.31
    },
    set(values: readonly number[], max: number, text: (v: number) => string, hot?: (v: number) => boolean) {
      rows.forEach((r, j) => {
        const v = values[j] ?? 0
        const len = Math.max(1e-3, (Math.min(1, Math.abs(v) / max) * w) / 2)
        r.fill.scale.x = len
        r.fill.position.x = at[0] + (Math.sign(v) * len) / 2
        const c = hot?.(v) ? HIGH_V : r.color
        setGlow(r.m, c, 0.9)
        r.value.set(text(v), c)
      })
    },
  }
}

// --- Singularities: drive the hand in a straight line with q̇ = J⁻¹ẋ and watch the joint speeds explode. ---

const SG = { at: [-8.8, -3.4, 0] as V3, k: 13, L: [0.3, 0.22] as [number, number], arrow: 1.8, hold: 2, scope: { y: -4.7, h: 4 } }
const SG_PATHS = { out: 'Reach straight out', fold: 'Fold in to the base' }
const sgParams = (p: Params) => ({ path: pick(SG_PATHS, p.path, 'out'), v: n(p, 'speed') / 100, qdMax: n(p, 'limit') * DEG })
const SG_DET = SG.L[0] * SG.L[1]
const sgPath = (path: keyof typeof SG_PATHS) => {
  if (path === 'out') {
    const a = 30 * DEG
    return { from: [0.2 * Math.cos(a), 0.2 * Math.sin(a)], dir: [Math.cos(a), Math.sin(a)], len: 0.32, elbow: 'up' as const }
  }
  const a = 140 * DEG
  return { from: [0.32 * Math.cos(a), 0.32 * Math.sin(a)], dir: [-Math.cos(a), -Math.sin(a)], len: 0.24, elbow: 'up' as const }
}
const sgRun = memoBy(
  (q: ReturnType<typeof sgParams>) => `${q.path}|${q.v}|${q.qdMax}`,
  (q: ReturnType<typeof sgParams>) => {
    const P = sgPath(q.path)
    const q0 = twoLinkIk(SG.L[0], SG.L[1], P.from[0], P.from[1])[P.elbow]
    const seconds = Math.min(20, (P.len / q.v) * 1.5)
    const dt = 0.004
    return { P, dt, seconds, run: resolvedRateRun(SG.L, q0, P.dir.map((d) => d * q.v), seconds, q.qdMax, dt) }
  },
)
const sgAt = (r: ReturnType<typeof sgRun>, t: number) => r.run[Math.min(r.run.length - 1, Math.max(0, Math.round(t / r.dt)))]
const nearSingular = (det: number) => Math.abs(det) / SG_DET < 0.12

export const jacobianSingularities: Lesson = {
  id: 'jacobian-singularities',
  title: 'Singularities',
  tagline: 'Where the hand cannot go faster',
  formula: (p) => {
    const q = sgParams(p)
    const r = sgRun(q)
    const worst = Math.min(...r.run.map((f) => f.scale))
    return `ẋ = J·q̇ → q̇ = J⁻¹·ẋ · det J = L1·L2·sin θ2 · det J → 0 makes q̇ → ∞ · this run: ${worst < 1 ? `joint limit cuts the hand to ${Math.round(worst * 100)} % speed` : 'on time all the way'}`
  },
  legend: [
    { color: RING, label: 'Hand velocity ẋ (commanded, achieved)', shape: 'dot' },
    { color: JOINT_COLORS[0], label: 'J1·q̇1: share from the shoulder', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'J2·q̇2: share from the elbow', shape: 'dot' },
    { color: HIGH_V, label: 'Near singular: det J ≈ 0', shape: 'dot' },
  ],
  points: [
    'The Jacobian maps joint speeds to hand speed: ẋ = J·q̇. Column i is how the hand moves when joint i turns at 1 rad/s (built in Forward kinematics, used for stepping in IK: Jacobian method). Here the controller runs it backwards every tick, q̇ = J⁻¹·ẋ, to slide the hand along a straight line at constant speed.',
    'For the two-link arm det J = L1·L2·sin θ2. It is zero with the arm straight (θ2 = 0) or folded back (θ2 = 180°). There both columns point the same way, J has no inverse, and the hand cannot move along the arm at all, however fast the joints spin. That pose is a singularity.',
    'Near one, J⁻¹ is huge: tiny hand moves need big, opposing joint speeds (the coloured shares grow and cancel). Real servos have a top speed, so the controller scales every joint down together; the hand stays on its line but falls behind. Reach straight out: the hand crawls, then the arm locks straight and stops. Fold in to the base: the elbow closes to 180° and locks the same way.',
    'Fixes: plan paths that keep clear of singular poses, slow down near them, or use damped least squares (IK: Jacobian method), which trades a small path error for bounded joint speeds. Manipulability measures how far a pose is from trouble.',
  ],
  controls: [
    { kind: 'choice', key: 'path', options: opts(SG_PATHS), initial: 'out' },
    { kind: 'slider', key: 'speed', label: 'Hand speed', min: 2, max: 15, step: 1, initial: 8, format: (v: number) => `${v} cm/s` },
    { kind: 'slider', key: 'limit', label: 'Joint speed limit', min: 30, max: 360, step: 10, initial: 120, format: (v: number) => `${v}°/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), SG.at)
    g.scale.setScalar(SG.k)
    plate(g)
    const rig = serialArm(g, planarArm(SG.L), { w: 0.046, t: 0.032 })
    const pen = dotPen(g, 1600, 0.0035)
    const cmd = stretchArrow(g, RING, 0.0028)
    const got = stretchArrow(g, RING, 0.0045)
    const shares = [0, 1].map((i) => stretchArrow(g, JOINT_COLORS[i], 0.0035))
    const elbowTag = liveLabel(g, [0, 0, 0.05], { size: 0.03 })

    const MX = { x: SIDE_SCOPE.x - 1.2, y: 2.7, cell: 2.4, size: 0.42 }
    const grid = matrixGrid(scene, [MX.x, MX.y, 0], 2, 2, { cell: MX.cell, size: MX.size })
    addLabel(scene, 'J =', [MX.x - grid.w / 2 - 0.4, MX.y, 0.2], LABEL, 0.48, 'right')
    ;['q1', 'q2'].forEach((c, i) => addLabel(scene, c, [MX.x + (i - 0.5) * MX.cell, MX.y + grid.h / 2 + 0.55, 0.2], JOINT_COLORS[i], 0.36))
    const detTag = liveLabel(scene, [MX.x + grid.w / 2 + 0.6, MX.y, 0.2], { size: 0.36, align: 'left' })
    const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
    const lines = [0, 1].map((i) => liveLabel(scene, [X0, 0.75 - i * 0.8, 0.2], { size: 0.34, align: 'left' }))
    const { y: sy, h: sh } = SG.scope
    const plot = sideScope(scene, sy, sh, { divs: [8, 4], zeroAt: 0.5 })
    const traces = [plot.trace(JOINT_COLORS[0], { samples: 240 }), plot.trace(JOINT_COLORS[1], { samples: 240 }), plot.trace(GREY, { samples: 240, radius: 0.09 })]
    const clock = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })
    scopeLabels(scene, sy, sh, null, 'q̇1, q̇2 (edge = limit) · det J', '')
    addLabel(scene, '0 s', [X0, sy - sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = sgParams(p)
        const r = sgRun(q)
        const key = `${q.path}|${q.v}|${q.qdMax}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (st.t > r.seconds + SG.hold) st.t = 0
        const t = Math.min(st.t, r.seconds)
        const f = sgAt(r, t)
        const fr = rig.set(f.q)
        const tip: V3 = [f.tip[0], f.tip[1], 0.05]
        const J = planarJacobian(SG.L, f.q)
        const bad = nearSingular(f.det)
        const sat = f.scale < 0.999
        f.qd.forEach((w, i) => rig.glow(i, Math.abs(w) >= q.qdMax * 0.999 ? 1 : 0))

        const { P } = r
        pen.begin()
        const reach = SG.L[0] + SG.L[1]
        pen.arc([0, 0, -0.02], reach, 0, 2 * Math.PI, GREY, 0.7)
        pen.arc([0, 0, -0.02], SG.L[0] - SG.L[1], 0, 2 * Math.PI, GREY, 0.5)
        const end = [P.from[0] + P.dir[0] * P.len, P.from[1] + P.dir[1] * P.len]
        pen.line([P.from[0], P.from[1], 0.03], [end[0], end[1], 0.03], 0.012, GREY, 0.7)
        const k0 = Math.round(t / r.dt)
        for (let i = 0; i <= k0; i += Math.max(1, Math.round(0.08 / r.dt))) pen.dot([r.run[i].tip[0], r.run[i].tip[1], 0.04], RING, 0.8)
        const ex = fr[1]
        if (bad) pen.arc([ex[3], ex[7], 0.05], 0.045, 0, 2 * Math.PI, HIGH_V, 1.1)
        pen.end()

        const v = P.dir.map((d) => d * q.v)
        const xd = handVelocity(J, f.qd)
        cmd([tip[0], tip[1], 0.06], toward([tip[0], tip[1], 0.06], v, SG.arrow, 0.3), sat ? GREY : RING)
        got(tip, toward(tip, xd, SG.arrow, 0.3), f.stuck ? HIGH_V : RING)
        const s1 = J.map((row) => row[0] * f.qd[0])
        const mid = toward(tip, s1, SG.arrow, 0.45)
        shares[0](tip, mid)
        shares[1](mid, toward(mid, J.map((row) => row[1] * f.qd[1]), SG.arrow, 0.45))
        elbowTag.set(`θ2 ${deg(f.q[1])}`, bad ? HIGH_V : JOINT_COLORS[1])
        elbowTag.group.position.set(ex[3], ex[7] + 0.07, 0.05)

        grid.set(J.flat().map(f2), [JOINT_COLORS[0], JOINT_COLORS[1]])
        detTag.set(`det ${f3(f.det)}`, bad ? HIGH_V : LABEL)
        lines[0].set(`q̇ = J⁻¹·x\u0307 = (${f.qd.map(dps).join(', ')})  limit ±${dps(q.qdMax)}`, sat ? HIGH_V : LABEL)
        lines[1].set(`hand ${f2(Math.hypot(...xd) * 100)} of ${f2(q.v * 100)} cm/s (${Math.round(f.scale * 100)} %)`, f.stuck ? HIGH_V : sat ? FORCE : RING)
        const N = Math.min(r.run.length, k0 + 1)
        const samples = 240
        const idx = Array.from({ length: Math.max(2, Math.round((t / r.seconds) * (samples - 1)) + 1) }, (_, i) => Math.min(N - 1, Math.round((i / (samples - 1)) * (r.seconds / r.dt))))
        const us = idx.map((_, i) => i / (samples - 1))
        traces[0].points(us, idx.map((i) => (r.run[i].qd[0] / q.qdMax) * (sh / 2)))
        traces[1].points(us, idx.map((i) => (r.run[i].qd[1] / q.qdMax) * (sh / 2)))
        traces[2].points(us, idx.map((i) => (Math.abs(r.run[i].det) / SG_DET) * (sh / 2)))
        clock.set(`${t.toFixed(1)} of ${r.seconds.toFixed(1)} s · real time`, GREY)

        status.set(`det J = ${f3(f.det)} m² · θ2 ${deg(f.q[1])} · hand ${Math.round(f.scale * 100)} % of commanded speed`, LABEL)
        sub.set(`side view · L1 ${f2(SG.L[0])} m, L2 ${f2(SG.L[1])} m · ${SG_PATHS[q.path].toLowerCase()} at ${f2(q.v * 100)} cm/s`, GREY)
        event.set(
          f.stuck ? `stuck at the singularity: arm ${Math.abs(f.q[1]) > 1 ? 'folded' : 'straight'}, J has no inverse, the hand cannot move ${Math.abs(f.q[1]) > 1 ? 'inward' : 'outward'}` : sat ? (bad ? 'near a singularity: joints at their limit, the hand slows down' : 'a joint hit its speed limit: all joints scaled, the hand slows') : 'on time: J⁻¹ gives modest joint speeds',
          f.stuck || bad ? HIGH_V : sat ? FORCE : RING,
        )
      },
      readouts: (p) => {
        const q = sgParams(p)
        const r = sgRun(q)
        const f = sgAt(r, Math.min(st.t, r.seconds))
        return [
          { label: 'det J', value: `${f3(f.det)} m²`, tone: nearSingular(f.det) ? 'bad' : 'ok' },
          { label: 'Joint speeds', value: f.qd.map(dps).join(', '), tone: f.scale < 0.999 ? 'warn' : 'ok' },
          { label: 'Hand speed', value: `${Math.round(f.scale * 100)} % of ${f2(q.v * 100)} cm/s`, tone: f.stuck ? 'bad' : f.scale < 0.999 ? 'warn' : 'ok' },
          { label: 'Elbow θ2', value: deg(f.q[1]) },
        ]
      },
    }
  },
}

// --- Manipulability: the velocity (and force) ellipse at the hand, live as the elbow sweeps. ---

const MP = { planar: { at: [-8.8, -3.6, 0] as V3, k: 13, L: [0.3, 0.22] }, servo: { at: [-9.4, -5.6, 0] as V3, k: 26, yaw: 30 * DEG }, vel: 0.32, force: 0.035, cap: 0.3, load: 1, period: 10, scope: { y: -6.4, h: 2.4 } }
const ARMS = { planar: '2-link, side view', servo: '4-DOF servo arm' }
const MP_MODES = { sweep: 'Elbow sweeps', hold: 'Hold pose' }
const SHOWS = { velocity: 'Velocity ellipse', force: 'Force ellipse + load' }
const mpParams = (p: Params) => ({ arm: pick(ARMS, p.arm, 'planar'), mode: pick(MP_MODES, p.mode, 'sweep'), show: pick(SHOWS, p.show, 'velocity'), q1: n(p, 'shoulder') * DEG, q2: n(p, 'elbow') * DEG })
const sweepElbow = (t: number) => 150 * DEG * Math.sin((2 * Math.PI * t) / MP.period)
const mpPose = (q: ReturnType<typeof mpParams>, t: number) => {
  const e = q.mode === 'sweep' ? sweepElbow(t) : q.q2
  return q.arm === 'planar' ? [q.q1, e] : [MP.servo.yaw, q.q1, e, 0]
}
const mpJac = (arm: keyof typeof ARMS, qs: readonly number[]): Mat => (arm === 'planar' ? planarJacobian(MP.planar.L, qs) : armJacobian(SERVO_ARM, qs))
const ratio = (arm: keyof typeof ARMS, s: number[]) => s[s.length - 1] / (arm === 'planar' ? 0.3 * 0.22 : 0.06)

export const jacobianManipulability: Lesson = {
  id: 'jacobian-manipulability',
  title: 'Manipulability',
  tagline: 'How freely the hand can move',
  formula: (p) => {
    const q = mpParams(p)
    const m = manipulability(mpJac(q.arm, mpPose(q, 0)))
    return `ẋ = J·q̇, |q̇| = 1 → ellipse, semi-axes σi = √eig(J·Jᵀ) · w = √det(J·Jᵀ) = σ1·σ2${q.arm === 'servo' ? '·σ3' : ''} · force ellipse: semi-axes 1/σi · τ = Jᵀ·F · held pose: w = ${fw(m.w)}`
  },
  legend: [
    { color: RING, label: 'Hand velocities for |q̇| = 1 rad/s', shape: 'dot' },
    { color: FORCE, label: 'Hand forces for |τ| = 1 N·m, load', shape: 'dot' },
    { color: B_FIELD, label: 'Principal axes σ1 u1, σ2 u2', shape: 'dot' },
    { color: HIGH_V, label: 'Singular: ellipse flat, w ≈ 0', shape: 'dot' },
  ],
  points: [
    'Spin the joints at a total of 1 rad/s in every possible mix, q̇ = (cos φ, sin φ), and the hand velocity ẋ = J·q̇ traces an ellipse: the manipulability ellipse. Its semi-axes are the singular values σi of J, the square roots of the eigenvalues of J·Jᵀ, pointing along its eigenvectors. Long axis: the hand moves easily that way. Short axis: it barely moves.',
    'One number sums it up: w = √det(J·Jᵀ) = σ1·σ2…, proportional to the ellipse area. For the two-link arm w = L1·L2·|sin θ2|: it depends only on the elbow, peaks at a right angle and drops to 0 with the arm straight or folded, where the ellipse collapses to a line (see Singularities). σmax/σmin, the condition number, says how lopsided it is.',
    'Forces go the other way. Holding a hand force F costs joint torques τ = Jᵀ·F (virtual work: F·ẋ = τ·q̇), so the force ellipse has the same axes with semi-axes 1/σ. Where the hand is fast it is weak, and where it is slow it is strong: a straight arm holds a push along itself with no torque at all, the bones take it. Switch to the force view to see the joint torques that hold 1 kg.',
    'The 4-DOF servo arm gets an ellipsoid from its 3×4 position Jacobian. Sweep it: the ellipsoid flattens to a disc when the upper arm, forearm and hand line up. Designers place the usual work spots where w is high and the ellipsoid round, away from the reach edge.',
  ],
  controls: [
    { kind: 'choice', key: 'arm', options: opts(ARMS), initial: 'planar' },
    { kind: 'choice', key: 'mode', options: opts(MP_MODES), initial: 'sweep' },
    { kind: 'choice', key: 'show', options: opts(SHOWS), initial: 'velocity' },
    angleSlider('shoulder', 'Shoulder θ1', 0, 150, 40),
    angleSlider('elbow', 'Elbow θ2 (held pose)', -150, 150, -80),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const pg = add(scene, new THREE.Group(), MP.planar.at)
    pg.scale.setScalar(MP.planar.k)
    plate(pg)
    const planar = serialArm(pg, planarArm(MP.planar.L), { w: 0.046, t: 0.032 })
    const sg = zUp(scene, MP.servo.at, MP.servo.k, 0.32, -0.6)
    floorMat(sg, [-0.15, 0.3], [-0.2, 0.25])
    const lifted = add(sg, new THREE.Group(), [0, 0, 0.014])
    const servo = serialArm(lifted, SERVO_ARM, { w: 0.022, t: 0.017, pedestal: 0.014 })

    const parts = (parent: THREE.Object3D, r: number) => {
      const m = new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
      const blob = add(parent, new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), m))
      blob.matrixAutoUpdate = false
      return { m, blob, pen: dotPen(parent, 900, r), axes: [0, 1, 2].map(() => stretchArrow(parent, B_FIELD, r * 0.8)), probe: stretchArrow(parent, RING, r), load: stretchArrow(parent, FORCE, r * 1.2) }
    }
    const P = parts(pg, 0.0035)
    const S = parts(lifted, 0.0018)
    const probeTag = liveLabel(pg, [0, 0, 0.06], { size: 0.026 })

    const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
    const MX = { y: 2.8, cell: 1.9, size: 0.36 }
    const grid2 = matrixGrid(scene, [X0 + 3.2, MX.y, 0], 2, 2, { cell: MX.cell, size: MX.size })
    const grid3 = matrixGrid(scene, [X0 + 4.6, MX.y, 0], 3, 4, { cell: MX.cell, size: MX.size })
    const jLabel = liveLabel(scene, [0, MX.y, 0.2], { size: 0.44, align: 'right' })
    jLabel.set('J =', LABEL)
    const lines = [0, 1, 2].map((i) => liveLabel(scene, [X0, 0.5 - i * 0.6, 0.2], { size: 0.3, align: 'left' }))
    const bars = signedBars(scene, [X0 + 4.2, -1.5, 0], ['τ1', 'τ2', 'τ3', 'τ4'], JOINT_COLORS.slice(0, 4))
    const { y: sy, h: sh } = MP.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 4], zeroAt: 0 })
    const curve = plot.trace(GREY, { samples: 121, radius: 0.08 })
    const now = plot.trace(RING, { samples: 121 })
    scopeLabels(scene, sy, sh, null, 'w vs elbow θ2 (held shoulder), scaled to its peak', '')
    addLabel(scene, '−150°', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, '+150°', [X0 + SIDE_SCOPE.w, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    addLabel(scene, '0°', [SIDE_SCOPE.x, sy - sh / 2 - 0.9, 0.3], GREY, 0.26)

    const st = { t: 0, q: [] as number[], key: '' }
    return {
      scene,
      view: { center: [-1, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = mpParams(p)
        const key = `${q.arm}|${q.mode}`
        if (key !== st.key) Object.assign(st, { key, t: 0, q: [] })
        st.t += dt
        const goal = mpPose(q, st.t)
        st.q = st.q.length === goal.length && q.mode === 'hold' ? st.q.map((v, i) => v + glide(dt, 0, wrapPi(goal[i] - v), 6)) : goal
        const qs = st.q
        const isP = q.arm === 'planar'
        pg.visible = isP
        sg.parent!.visible = !isP
        const J = mpJac(q.arm, qs)
        const m = manipulability(J)
        const bad = ratio(q.arm, m.sigma) < 0.08
        const force = q.show === 'force'
        const D = isP ? P : S
        const fr = (isP ? planar : servo).set(qs)
        const t3 = toolOf(fr)
        const tip: V3 = isP ? [t3[0], t3[1], 0.06] : [t3[0], t3[1], t3[2]]
        const axes3 = m.axes.map((a) => [a[0], a[1], a[2] ?? 0])
        const zoom = isP ? 1 : force ? 0.4 : 0.7
        const semi = m.sigma.map((s) => zoom * (force ? Math.min(MP.cap, MP.force / Math.max(s, 1e-6)) : s * MP.vel))
        const third = isP ? [0, 0, 1] : axes3[2]
        const s3 = isP ? 0.002 : Math.max(semi[2], 0.0015)
        const b = (i: number, s: number) => new THREE.Vector3(...(axes3[i] ?? third).slice(0, 3)).multiplyScalar(Math.max(s, 0.0015))
        D.blob.matrix.makeBasis(b(0, semi[0]), b(1, semi[1]), new THREE.Vector3(...third).multiplyScalar(s3)).setPosition(...tip)
        const c = bad ? HIGH_V : force ? FORCE : RING
        D.m.color.set(c)
        D.axes.forEach((ar, i) => {
          if (i >= m.sigma.length) return ar(tip, tip)
          ar(tip, [tip[0] + axes3[i][0] * semi[i], tip[1] + axes3[i][1] * semi[i], tip[2] + axes3[i][2] * semi[i]], bad && i === m.sigma.length - 1 ? HIGH_V : B_FIELD)
        })
        D.pen.begin()
        if (isP) {
          const steps = 96
          for (let k = 0; k < steps; k++) {
            const a = (2 * Math.PI * k) / steps
            const [ca, sa] = [Math.cos(a) * semi[0], Math.sin(a) * semi[1]]
            D.pen.dot([tip[0] + ca * axes3[0][0] + sa * axes3[1][0], tip[1] + ca * axes3[0][1] + sa * axes3[1][1], tip[2]], c, 0.9)
          }
          P.pen.arc([0, 0, -0.02], MP.planar.L[0] + MP.planar.L[1], 0, 2 * Math.PI, GREY, 0.6)
        }
        D.pen.end()

        const phi = st.t * 1.3
        const qd = isP ? [Math.cos(phi), Math.sin(phi)] : [0, 0, 0, 0]
        const xd = handVelocity(J, qd)
        P.probe(tip, isP && !force ? [tip[0] + xd[0] * MP.vel, tip[1] + xd[1] * MP.vel, tip[2] + 0.004] : tip)
        probeTag.group.visible = isP && !force
        probeTag.set(`q̇ = (${f2(qd[0])}, ${f2(qd[1])}) rad/s`, RING)
        probeTag.group.position.set(tip[0], tip[1] + Math.max(semi[0], semi[1]) + 0.05, 0.06)
        const F = isP ? [0, weightN(MP.load)] : [0, 0, weightN(MP.load)]
        const tau = jointTorques(J, F)
        const loadTop: V3 = isP ? [tip[0], tip[1] - 0.03, tip[2]] : [tip[0], tip[1], tip[2] - 0.015]
        D.load(loadTop, force ? (isP ? [tip[0], tip[1] - 0.16, tip[2]] : [tip[0], tip[1], tip[2] - 0.09]) : loadTop)
        ;(isP ? S : P).load(tip, tip)
        S.probe(tip, tip)

        grid2.group.visible = isP
        grid3.group.visible = !isP
        const grid = isP ? grid2 : grid3
        jLabel.group.position.x = grid.group.position.x - grid.w / 2 - 0.35
        grid.set(J.flat().map(f2), JOINT_COLORS.slice(0, J[0].length))
        lines[0].set(`σ = ${m.sigma.map(f3).join(', ')}  (m/s per rad/s)`, bad ? HIGH_V : RING)
        lines[1].set(`w = ${m.sigma.map(f3).join('·')} = ${fw(m.w)}   σmax/σmin = ${Number.isFinite(m.cond) && m.cond < 999 ? m.cond.toFixed(1) : '∞'}`, bad ? HIGH_V : LABEL)
        lines[2].set(force ? `hold ${MP.load} kg: F = ${f2(weightN(MP.load))} N up → τ = Jᵀ·F` : `force ellipse semi-axes 1/σ = ${m.sigma.map((s) => (s > 1e-3 ? (1 / s).toFixed(1) : '∞')).join(', ')} N per N·m`, force ? FORCE : GREY)
        bars.show(force, tau.length)
        bars.set(tau, 2.5, (v) => `${f2(v)} N·m`)

        const wOf = (e: number) => manipulability(mpJac(q.arm, isP ? [qs[0], e] : [qs[0], qs[1], e, 0])).w
        const es = Array.from({ length: 121 }, (_, i) => (-150 + 2.5 * i) * DEG)
        const ws = es.map(wOf)
        const wMax = Math.max(...ws, 1e-9)
        curve.points(es.map((_, i) => i / 120), ws.map((w) => (w / wMax) * sh - sh / 2))
        const e = isP ? qs[1] : qs[2]
        const upto = es.filter((x) => x <= e)
        now.points([...upto.map((x) => (x / DEG + 150) / 300), (e / DEG + 150) / 300], [...upto.map((x) => (wOf(x) / wMax) * sh - sh / 2), (wOf(e) / wMax) * sh - sh / 2])

        status.set(`w = ${fw(m.w)} · σ ${m.sigma.map(f3).join(' / ')} · elbow ${deg(e)}`, LABEL)
        sub.set(isP ? `side view · L1 ${f2(MP.planar.L[0])} m, L2 ${f2(MP.planar.L[1])} m · ellipse ${MP.vel} m per m/s` : `4-DOF servo arm, base ${deg(MP.servo.yaw)}, wrist 0° · floor tape 0.5 m`, GREY)
        event.set(
          bad ? 'near singular: the ellipse is flat, the hand cannot move across it (but can hold any force that way)' : force ? 'force ellipse: long where the velocity ellipse is short' : m.cond < 1.6 ? 'nearly round: the hand moves equally well every way' : 'lopsided: easy along the long axis, hard along the short one',
          bad ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const q = mpParams(p)
        const qs = st.q.length ? st.q : mpPose(q, 0)
        const J = mpJac(q.arm, qs)
        const m = manipulability(J)
        const tau = jointTorques(J, q.arm === 'planar' ? [0, weightN(MP.load)] : [0, 0, weightN(MP.load)])
        const top = tau.reduce((b, v, i) => (Math.abs(v) > Math.abs(tau[b]) ? i : b), 0)
        return [
          { label: 'Manipulability w', value: fw(m.w), tone: ratio(q.arm, m.sigma) < 0.08 ? 'bad' : 'ok' },
          { label: 'Singular values', value: m.sigma.map(f2).join(', ') },
          { label: 'Condition σmax/σmin', value: Number.isFinite(m.cond) && m.cond < 999 ? m.cond.toFixed(1) : '∞', tone: m.cond > 10 ? 'warn' : 'ok' },
          { label: `Peak torque, ${MP.load} kg`, value: `${f2(Math.abs(tau[top]))} N·m, joint ${top + 1}` },
        ]
      },
    }
  },
}
