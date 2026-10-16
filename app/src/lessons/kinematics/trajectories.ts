import * as THREE from 'three/webgpu'
import { DEG, SERVO_ARM, ScaleKind, V2, ViaKind, armFk, cartesianLine, chordTimes, jointLine, jointScale, lerpJoints, lineDeviation, planarArm, quinticCoeffs, polyAt, syncScale, toDeg, toolOf, twoLinkIk, unwrapPath, viaAt, viaPath } from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HIGH_V, JOINT_COLORS, LABEL, POWER, RING, SIDE_SCOPE, addLabel, dotPen, floorMat, ghostRig, liveLabel, memoBy, scopeLabels, serialArm, sideScope, statusHeader, zUp } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const cm = (m: number) => `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`
const dps = (w: number) => `${Math.round(toDeg(w))}°/s`
const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`
const plate = (g: THREE.Object3D, w = 0.11, h = 0.16) => box(g, [w, h, 0.012], mat('#3a3d45', { rough: 0.6 }), [0, 0, -0.03])
const L2: [number, number] = [0.26, 0.18]
const HOLE = L2[0] - L2[1]
/** Index-interpolated sample of a path stored on a uniform grid over [0, 1]. */
const along = (rows: readonly number[][], u: number): number[] => {
  const x = Math.max(0, Math.min(1, u)) * (rows.length - 1)
  const i = Math.min(rows.length - 2, Math.floor(x))
  return lerpJoints(rows[i], rows[i + 1], x - i)
}
const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2

// --- Linear interpolation: the same A → B, straight in joint space vs straight at the hand. ---

const LI = { at: [-8.8, -2.2, 0] as V3, k: 15, hold: 1.5, n: 240, scope: { y: -4.7, h: 3.6 } }
const LI_PATHS = { front: 'Across the front', near: 'Close past the base', hole: 'Through the base hole' }
const LI_ENDS: Record<keyof typeof LI_PATHS, [V2, V2]> = {
  front: [[0.36, 0.06], [-0.06, 0.34]],
  near: [[0.34, -0.02], [-0.12, 0.16]],
  hole: [[0.34, 0.02], [-0.16, 0.06]],
}
const LEADS = { cart: 'Straight hand', joint: 'Straight joints' }
const liParams = (p: Params) => ({ path: pick(LI_PATHS, p.path, 'front'), lead: pick(LEADS, p.lead, 'cart'), T: n(p, 'time') })
type LiP = ReturnType<typeof liParams>
const liRun = memoBy(
  (q: LiP) => `${q.path}|${q.T}`,
  (q: LiP) => {
    const [a, b] = LI_ENDS[q.path]
    const cart = cartesianLine(L2, a, b, LI.n)
    const cq = unwrapPath(cart.map((s) => s.q))
    const joint = jointLine(L2, cq[0], cq[LI.n], LI.n)
    const jq = joint.map((s) => s.q)
    const c = quinticCoeffs(0, 1, 0, 0, 0, 0, q.T)
    const M = 240
    const ts = Array.from({ length: M + 1 }, (_, k) => (k / M) * q.T)
    const us = ts.map((t) => polyAt(c, t).p)
    const series = (qs: number[][]) => us.map((u) => along(qs, u))
    const [qC, qJ] = [series(cq), series(jq)]
    const rate = (qs: number[][]) => qs[0].map((_, i) => Math.max(...qs.slice(1).map((r, k) => Math.abs(r[i] - qs[k][i]) / (q.T / M))))
    const offLine = cart.filter((s) => !s.onLine).length / cart.length
    const all = [...qC, ...qJ].flat()
    const [lo, hi] = [Math.min(...all), Math.max(...all)]
    return { a, b, cart, cq, joint, jq, ts, us, qC, qJ, mid: (lo + hi) / 2, half: Math.max(10 * DEG, (hi - lo) / 2) * 1.1, rateC: rate(qC), rateJ: rate(qJ), dev: lineDeviation(joint.map((s) => s.tip), a, b), offLine, M }
  },
)
const minDist = (a: V2, b: V2) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const u = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy)))
  return Math.hypot(a[0] + dx * u, a[1] + dy * u)
}

export const trajectoriesLinear: Lesson = {
  id: 'trajectories-linear-interpolation',
  title: 'Linear interpolation',
  tagline: 'Straight in which space?',
  formula: (p) => {
    const q = liParams(p)
    const r = liRun(q)
    return `joint space: q(s) = qA + s·(qB − qA) · Cartesian: x(s) = xA + s·(xB − xA), q = IK(x) · s(t) quintic over ${q.T} s · joint line bows the hand ${cm(r.dev)} off the straight line`
  },
  legend: [
    { color: RING, label: 'Hand trail, straight-line (Cartesian) move', shape: 'dot' },
    { color: B_FIELD, label: 'Hand trail, straight-joint move', shape: 'dot' },
    { color: HIGH_V, label: 'Line point out of reach (base hole)', shape: 'dot' },
    { color: GREY, label: 'q1, q2 of the other move (scope)', shape: 'dot' },
  ],
  points: [
    'A trajectory says where the arm is at every instant between two poses. The simplest plan is a straight line, but there are two very different lines: one in joint space (every joint turns steadily from its start angle to its end angle) and one in Cartesian space (the hand slides along the straight segment A → B).',
    'Joint interpolation needs only the two end poses (one IK call each, see Inverse kinematics). Joint speeds are smooth and modest, but the hand swings along a curve. Fine for moving through free air; risky near a table or a part.',
    'Cartesian interpolation runs IK at every point on the segment. The hand stays on the line, which welding, gluing and inserting need. The price: joint angles are no longer smooth in time. Close past the base the elbow folds nearly shut, a singularity (see Jacobian: Singularities), and the shoulder has to whip round fast.',
    'Through the base hole the line leaves the workspace: no IK solution exists in the middle (red), the hand is dragged round the hole edge and the shoulder spins half a turn in a blink. Planners check the whole Cartesian path before running it, and fall back to a joint move or extra via points.',
  ],
  controls: [
    { kind: 'choice', key: 'path', options: opts(LI_PATHS), initial: 'front' },
    { kind: 'choice', key: 'lead', options: opts(LEADS), initial: 'cart' },
    { kind: 'slider', key: 'time', label: 'Move time', min: 1, max: 6, step: 0.5, initial: 3, format: (v: number) => `${v} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), LI.at)
    g.scale.setScalar(LI.k)
    plate(g)
    const ghost = serialArm(g, planarArm(L2), { w: 0.04, t: 0.028, axes: false })
    const ghostMat = ghostRig(ghost.group, B_FIELD, 0.22)
    const rig = serialArm(g, planarArm(L2), { w: 0.04, t: 0.028 })
    const pen = dotPen(g, 2600, 0.0032)
    const tags = [liveLabel(g, [0, 0, 0.05], { size: 0.03 }), liveLabel(g, [0, 0, 0.05], { size: 0.03 })]

    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [X0, 2.7 - i * 0.75, 0.2], { size: 0.32, align: 'left' }))
    const { y: sy, h: sh } = LI.scope
    const plot = sideScope(scene, sy, sh, { divs: [8, 4], zeroAt: 0.5 })
    const other = [0, 1].map(() => plot.trace(GREY, { samples: 241, radius: 0.07 }))
    const lead = [0, 1].map((i) => plot.trace(JOINT_COLORS[i], { samples: 241, radius: 0.1 }))
    scopeLabels(scene, sy, sh, null, 'joint angles q1, q2 over time', '')
    addLabel(scene, '0 s', [X0, sy - sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const clock = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = liParams(p)
        const r = liRun(q)
        const key = `${q.path}|${q.T}|${q.lead}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (st.t > q.T + LI.hold) st.t = 0
        const t = Math.min(st.t, q.T)
        const k = Math.round((t / q.T) * r.M)
        const u = r.us[k]
        const isCart = q.lead === 'cart'
        const [mine, theirs] = isCart ? [r.qC, r.qJ] : [r.qJ, r.qC]
        rig.set(mine[k])
        ghost.set(theirs[k])
        ghostMat.color.set(isCart ? B_FIELD : RING)
        const cs = r.cart[Math.round(u * LI.n)]
        rig.glow(0, isCart && !cs.onLine ? 1 : 0)

        pen.begin()
        pen.arc([0, 0, -0.02], L2[0] + L2[1], 0, 2 * Math.PI, GREY, 0.6)
        pen.arc([0, 0, -0.02], HOLE, 0, 2 * Math.PI, q.path === 'hole' ? HIGH_V : GREY, 0.6)
        pen.line([r.a[0], r.a[1], 0.02], [r.b[0], r.b[1], 0.02], 0.01, GREY, 0.6)
        const iu = Math.round(u * LI.n)
        for (let i = 0; i <= LI.n; i += 3) {
          const done = i <= iu
          const c = r.cart[i]
          const want: V3 = [r.a[0] + (r.b[0] - r.a[0]) * c.u, r.a[1] + (r.b[1] - r.a[1]) * c.u, 0.03]
          if (!c.onLine) pen.dot(want, HIGH_V, done ? 1 : 0.6)
          pen.dot([c.tip[0], c.tip[1], 0.04], c.onLine ? RING : HIGH_V, done ? 1 : 0.45)
          pen.dot([r.joint[i].tip[0], r.joint[i].tip[1], 0.04], B_FIELD, done ? 1 : 0.45)
        }
        for (const e of [r.a, r.b]) pen.arc([e[0], e[1], 0.05], 0.012, 0, 2 * Math.PI, LABEL, 1)
        pen.end()
        tags[0].set('A', LABEL)
        tags[0].group.position.set(r.a[0] + 0.03, r.a[1] - 0.025, 0.05)
        tags[1].set('B', LABEL)
        tags[1].group.position.set(r.b[0] - 0.03, r.b[1] + 0.025, 0.05)

        const N = k + 1
        const xs = Array.from({ length: N }, (_, i) => i / r.M)
        const y = (a: number) => ((a - r.mid) / r.half) * (sh / 2)
        ;[0, 1].forEach((j) => {
          lead[j].points(xs, mine.slice(0, N).map((qq) => y(qq[j])))
          other[j].points(xs, theirs.slice(0, N).map((qq) => y(qq[j])))
        })
        clock.set(`${t.toFixed(1)} of ${q.T} s · real time`, GREY)

        const near = minDist(r.a, r.b)
        lines[0].set(`straight hand: peak joint speed ${dps(Math.max(...r.rateC))}`, isCart ? RING : GREY)
        lines[1].set(`straight joints: peak joint speed ${dps(Math.max(...r.rateJ))}`, isCart ? GREY : B_FIELD)
        lines[2].set(`joint move: hand up to ${cm(r.dev)} off the line`, B_FIELD)
        lines[3].set(near < HOLE ? `line dips to ${cm(near)} from the base: hole is ${cm(HOLE)}` : `line clears the base by ${cm(near)} (hole ${cm(HOLE)})`, near < HOLE ? HIGH_V : near < HOLE * 1.5 ? FORCE : LABEL)

        const fold = Math.abs(Math.abs(mine[k][1]) - Math.PI) < 25 * DEG
        status.set(`${LEADS[q.lead].toLowerCase()} · ${Math.round(u * 100)} % of the way · ghost: ${isCart ? 'straight joints' : 'straight hand'}`, LABEL)
        sub.set(`side view · L1 ${cm(L2[0])}, L2 ${cm(L2[1])} · both moves share one quintic s(t)`, GREY)
        event.set(
          isCart && !cs.onLine ? 'line point out of reach: IK has no answer, the hand slides round the hole edge' : isCart && fold ? 'elbow nearly folded: near a singularity, the shoulder must swing fast' : isCart ? 'hand on the line: IK at every step' : 'joints turn steadily; the hand bows off the line',
          isCart && !cs.onLine ? HIGH_V : isCart && fold ? FORCE : isCart ? RING : B_FIELD,
        )
      },
      readouts: (p) => {
        const q = liParams(p)
        const r = liRun(q)
        const pc = Math.max(...r.rateC)
        return [
          { label: 'Joint move: hand off line', value: cm(r.dev), tone: r.dev > 0.02 ? 'warn' : 'ok' },
          { label: 'Peak joint speed, straight hand', value: dps(pc), tone: pc > 3 * Math.max(...r.rateJ) ? 'bad' : 'ok' },
          { label: 'Peak joint speed, straight joints', value: dps(Math.max(...r.rateJ)) },
          { label: 'Line inside workspace', value: `${Math.round((1 - r.offLine) * 100)} %`, tone: r.offLine > 0 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Splines: hand through via points over a wall: corners, stops, or one smooth spline. ---

const SP = { at: [-12.4, -3.6, 0] as V3, k: 21, hold: 1.5, M: 300, table: -0.03, wall: { x0: 0.19, x1: 0.24, top: 0.15 }, scope: { y: -4.7, h: 3.6 } }
const SP_KINDS = { linear: 'Straight segments', stop: 'Stop at each via', spline: 'Cubic spline' }
const SP_COLORS: Record<ViaKind, string> = { linear: FORCE, stop: B_FIELD, spline: RING }
const spParams = (p: Params) => ({ kind: pick(SP_KINDS, p.kind, 'spline'), h: n(p, 'height') / 100, T: n(p, 'time') })
type SpP = ReturnType<typeof spParams>
const spPoints = (h: number) => [[0.38, 0], [0.32, h], [0.13, h + 0.03], [0.12, 0]]
const inWall = (x: number, y: number, m = 0.008) => x > SP.wall.x0 - m && x < SP.wall.x1 + m && y < SP.wall.top + m
const spRun = memoBy(
  (q: SpP) => `${q.h}|${q.T}`,
  (q: SpP) => {
    const pts = spPoints(q.h)
    const times = chordTimes(pts, q.T)
    const kinds = Object.keys(SP_KINDS) as ViaKind[]
    const dtk = q.T / SP.M
    const runs = Object.fromEntries(
      kinds.map((kind) => {
        const path = viaPath(kind, times, pts)
        const s = Array.from({ length: SP.M + 1 }, (_, k) => viaAt(path, k * dtk))
        const speed = s.map((x) => Math.hypot(x.v[0], x.v[1]))
        const acc = s.map((x, k) => (k ? Math.hypot(x.v[0] - s[k - 1].v[0], x.v[1] - s[k - 1].v[1]) / dtk : 0))
        const hit = s.findIndex((x) => inWall(x.p[0], x.p[1]))
        const smoothA = Math.max(...s.map((x) => Math.hypot(x.a[0], x.a[1])))
        const bulge = Math.max(...s.map((x) => Math.min(...pts.slice(1).map((b, i) => segDist(x.p, pts[i], b)))))
        return [kind, { s, speed, acc, hit, bulge, peakV: Math.max(...speed), peakA: kind === 'linear' ? Infinity : smoothA }]
      }),
    ) as Record<ViaKind, { s: ReturnType<typeof viaAt>[]; speed: number[]; acc: number[]; hit: number; bulge: number; peakV: number; peakA: number }>
    const vRef = Math.max(...kinds.map((k) => runs[k].peakV)) * 1.1
    const aRef = runs.stop.peakA * 1.15
    return { pts, times, runs, vRef, aRef }
  },
)
const segDist = (p: readonly number[], a: readonly number[], b: readonly number[]) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dy * u)
}
const ikUp = (x: number, y: number) => [...twoLinkIk(L2[0], L2[1], x, y).up]

export const trajectoriesSplines: Lesson = {
  id: 'trajectories-splines',
  title: 'Splines',
  tagline: 'Smooth through via points',
  formula: (p) => {
    const q = spParams(p)
    return `segment k: x(τ) = c0 + c1·τ + c2·τ² + c3·τ³ · ${q.kind === 'linear' ? 'straight: ẋ jumps at every via, ẍ = ∞' : q.kind === 'stop' ? 'stop: ẋ = 0 at every via' : 'spline: x, ẋ, ẍ continuous at every via, one tridiagonal solve for the via speeds'}`
  },
  legend: [
    { color: SP_COLORS.spline, label: 'Cubic spline: smooth through every via', shape: 'dot' },
    { color: SP_COLORS.stop, label: 'Rest-to-rest cubic per segment', shape: 'dot' },
    { color: SP_COLORS.linear, label: 'Straight segments, sharp corners', shape: 'dot' },
    { color: HIGH_V, label: 'Path clips the wall', shape: 'dot' },
  ],
  points: [
    'A pick-and-place move has to clear an obstacle, so the planner adds via points: lift, cross over, lower. Each via is a hand position (here solved to joint angles by IK at every step); the question is how to get from one to the next in time.',
    'Straight segments at constant speed are the obvious answer, but at each via the velocity changes direction instantly. That needs infinite acceleration: real joints lag, overshoot and shake, and the hand cuts the corner.',
    'Stopping at each via fixes that: a cubic per segment with zero speed at both ends (one cubic is 4 numbers: position and speed at each end). Smooth, but the arm halts at every via, which wastes time and still jerks.',
    'A cubic spline passes through every via without stopping. The speed at each via is chosen so position, velocity and acceleration all match across it; that is one small tridiagonal solve. The trade-off: the curve bulges outside the straight segments (the stray readout), so leave clearance round obstacles. Lower the vias until the path clips the wall, then raise them again.',
  ],
  controls: [
    { kind: 'choice', key: 'kind', options: opts(SP_KINDS), initial: 'spline' },
    { kind: 'slider', key: 'height', label: 'Via height', min: 10, max: 28, step: 1, initial: 22, format: (v: number) => `${v} cm` },
    { kind: 'slider', key: 'time', label: 'Move time', min: 2, max: 8, step: 0.5, initial: 4, format: (v: number) => `${v} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = add(scene, new THREE.Group(), SP.at)
    g.scale.setScalar(SP.k)
    plate(g)
    box(g, [0.5, 0.012, 0.08], mat('#4a3b2c', { rough: 0.8 }), [0.17, SP.table - 0.006, 0])
    const w = SP.wall
    box(g, [w.x1 - w.x0, w.top - SP.table, 0.06], mat('#6a4e3a', { rough: 0.7 }), [(w.x0 + w.x1) / 2, (w.top + SP.table) / 2, 0])
    for (const [x, c] of [[0.38, '#3d6bff'], [0.12, '#5ce1a0']] as const) box(g, [0.03, 0.03, 0.03], mat(c, { rough: 0.5 }), [x, SP.table + 0.015, 0.03])
    const rig = serialArm(g, planarArm(L2), { w: 0.04, t: 0.028 })
    const pen = dotPen(g, 2400, 0.0032)
    const viaTags = [0, 1, 2, 3].map(() => liveLabel(g, [0, 0, 0.05], { size: 0.026 }))

    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [X0, 2.7 - i * 0.75, 0.2], { size: 0.32, align: 'left' }))
    const { y: sy, h: sh } = SP.scope
    const plot = sideScope(scene, sy, sh, { divs: [8, 4], zeroAt: 0 })
    const accT = plot.trace(FORCE, { samples: 301, radius: 0.07 })
    const spdT = plot.trace(RING, { samples: 301, radius: 0.1 })
    const knots = [0, 1].map(() => plot.trace(GREY, { samples: 2, radius: 0.04 }))
    scopeLabels(scene, sy, sh, null, 'hand speed (yellow) · acceleration (pink)', '')
    addLabel(scene, '0 s', [X0, sy - sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const clock = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = spParams(p)
        const r = spRun(q)
        const key = `${q.kind}|${q.h}|${q.T}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (st.t > q.T + SP.hold) st.t = 0
        const t = Math.min(st.t, q.T)
        const k = Math.round((t / q.T) * SP.M)
        const run = r.runs[q.kind]
        const now = run.s[k]
        rig.set(ikUp(now.p[0], now.p[1]))
        const hitNow = run.hit >= 0 && k >= run.hit

        pen.begin()
        ;(Object.keys(SP_KINDS) as ViaKind[]).forEach((kind) => {
          const sel = kind === q.kind
          const rr = r.runs[kind]
          for (let i = 0; i <= SP.M; i += sel ? 2 : 4) {
            const x = rr.s[i].p
            const bad = inWall(x[0], x[1])
            pen.dot([x[0], x[1], sel ? 0.045 : 0.035], bad && sel ? HIGH_V : sel ? SP_COLORS[kind] : GREY, sel ? (i <= k ? 1.1 : 0.5) : 0.4)
          }
        })
        r.pts.forEach((pt) => pen.arc([pt[0], pt[1], 0.05], 0.01, 0, 2 * Math.PI, LABEL, 1))
        pen.end()
        r.pts.forEach((pt, i) => {
          viaTags[i].set(i === 0 ? 'pick' : i === 3 ? 'place' : `via ${i}`, GREY)
          viaTags[i].group.position.set(pt[0] + (i === 3 ? -0.045 : i === 0 ? 0.03 : 0), pt[1] + (i === 0 || i === 3 ? 0.03 : 0.028), 0.05)
        })

        const N = k + 1
        const xs = Array.from({ length: N }, (_, i) => i / SP.M)
        spdT.points(xs, run.speed.slice(0, N).map((v) => Math.min(1, v / r.vRef) * sh - sh / 2))
        accT.points(xs, run.acc.slice(0, N).map((a) => Math.min(1, a / r.aRef) * sh - sh / 2))
        knots.forEach((kt, i) => {
          const u = r.times[i + 1] / q.T
          kt.points([u, u], [-sh / 2, sh / 2])
        })
        clock.set(`${t.toFixed(1)} of ${q.T} s · real time`, GREY)

        const stops = q.kind === 'stop' ? 2 : 0
        lines[0].set(`peak hand speed ${cm(run.peakV)}/s`, RING)
        lines[1].set(`peak acceleration ${run.peakA === Infinity ? '∞ at the corners' : `${(run.peakA * 100).toFixed(0)} cm/s²`}`, run.peakA === Infinity ? HIGH_V : FORCE)
        lines[2].set(`${stops ? `stops at ${stops} vias` : 'never stops'} · strays ${cm(run.bulge)} off the segments`, stops ? B_FIELD : LABEL)
        lines[3].set(run.hit >= 0 ? `clips the wall at ${secs((run.hit / SP.M) * q.T)}: raise the vias` : 'clears the wall', run.hit >= 0 ? HIGH_V : POWER)

        const corner = q.kind === 'linear' && r.times.slice(1, -1).some((tk) => Math.abs(tk - t) < q.T / 60)
        status.set(`${SP_KINDS[q.kind].toLowerCase()} · segment ${now.seg + 1} of 3 · hand ${cm(run.speed[k])}/s`, LABEL)
        sub.set(`side view · vias at ${cm(q.h)} and ${cm(q.h + 0.03)} · knot times split by segment length`, GREY)
        event.set(
          hitNow ? 'the path ran through the wall: raise the vias' : corner ? 'corner: velocity flips instantly, acceleration spikes' : q.kind === 'stop' && run.speed[k] < run.peakV * 0.05 && t > 0.05 && t < q.T - 0.05 ? 'stopped at a via' : q.kind === 'spline' ? 'smooth: speed and acceleration continuous through the vias' : 'moving',
          hitNow || corner ? HIGH_V : q.kind === 'spline' ? RING : LABEL,
        )
      },
      readouts: (p) => {
        const q = spParams(p)
        const run = spRun(q).runs[q.kind]
        return [
          { label: 'Move time', value: `${q.T} s` },
          { label: 'Peak hand speed', value: `${cm(run.peakV)}/s` },
          { label: 'Peak acceleration', value: run.peakA === Infinity ? '∞ (corners)' : `${(run.peakA * 100).toFixed(0)} cm/s²`, tone: run.peakA === Infinity ? 'bad' : 'ok' },
          { label: 'Wall', value: run.hit >= 0 ? 'clipped' : 'clear', tone: run.hit >= 0 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Time scaling: one path, different s(t); all joints finish together. ---

const TS = { at: [-9.4, -6.2, 0] as V3, k: 24, plinth: 0.014, hold: 1.2, M: 360, scope: { y: -4.7, h: 3.6 } }
const QA = [-70, 30, -20, -40].map((d) => d * DEG)
const QB = [60, 110, -120, 20].map((d) => d * DEG)
const DQ = QB.map((b, i) => b - QA[i])
const V_MAX = [90, 60, 90, 180].map((d) => d * DEG)
const A_MAX = [180, 120, 240, 360].map((d) => d * DEG)
const J_MAX = A_MAX.map((a) => a * 5)
const PROFILES: Record<ScaleKind, string> = { linear: 'Linear', cubic: 'Cubic', quintic: 'Quintic', trapezoid: 'Trapezoid', scurve: 'S-curve' }
const SYNC = { sync: 'Synchronised', free: 'Each joint flat out' }
const PLOTS = { q: 'q (share done)', qd: 'q̇ / limit', qdd: 'q̈ / limit' }
const JOINT_NAMES = ['base', 'shoulder', 'elbow', 'wrist']
const tsParams = (p: Params) => ({ kind: pick(PROFILES, p.kind, 'trapezoid'), sync: pick(SYNC, p.sync, 'sync'), plot: pick(PLOTS, p.plot, 'qd'), k: n(p, 'speed') / 100 })
type TsP = ReturnType<typeof tsParams>
const tsRun = memoBy(
  (q: TsP) => `${q.kind}|${q.k}`,
  (q: TsP) => {
    const vm = V_MAX.map((v) => v * q.k)
    const am = A_MAX.map((a) => a * q.k)
    const sync = syncScale(q.kind, DQ, vm, am, J_MAX)
    const own = DQ.map((d, i) => jointScale(q.kind, d, vm[i], am[i], J_MAX[i]))
    const span = Math.max(sync.scale.T, ...own.map((s) => s.T))
    const dt = span / TS.M
    const mode = (sOf: (i: number, t: number) => { s: number; sd: number }) => {
      const qs = Array.from({ length: TS.M + 1 }, (_, k) => DQ.map((d, i) => QA[i] + d * sOf(i, k * dt).s))
      const qd = Array.from({ length: TS.M + 1 }, (_, k) => DQ.map((d, i) => d * sOf(i, k * dt).sd))
      const qdd = qd.map((r, k) => r.map((v, i) => (k ? (v - qd[k - 1][i]) / dt : 0)))
      const tips = qs.map((x) => toolOf(armFk(SERVO_ARM, x)))
      return { qs, qd, qdd, tips }
    }
    return {
      sync,
      own,
      span,
      dt,
      runs: { sync: mode((_, t) => sync.scale.at(t)), free: mode((i, t) => own[i].at(t)) },
    }
  },
)

export const trajectoriesTimeScaling: Lesson = {
  id: 'trajectories-time-scaling',
  title: 'Time scaling',
  tagline: 'Same path, different timing',
  formula: (p) => {
    const q = tsParams(p)
    const r = tsRun(q)
    return `q(t) = qA + s(t)·(qB − qA), s: 0 → 1 · ${PROFILES[q.kind].toLowerCase()} s(t) · sync: ṡmax = min_i q̇max,i / |Δq_i| (same for s̈) → T = ${secs(r.sync.scale.T)}`
  },
  legend: [
    { color: RING, label: 'Hand trail of this move', shape: 'dot' },
    { color: B_FIELD, label: 'Ghost: the other sync mode', shape: 'dot' },
    { color: JOINT_COLORS[0], label: 'Base, shoulder, elbow, wrist (scope)', shape: 'dot' },
    { color: HIGH_V, label: 'Joint at its limit (scope edge)', shape: 'dot' },
  ],
  points: [
    'A path says where; time scaling says when. Write the move as q = qA + s·(qB − qA) and pick a scalar s(t) that goes from 0 to 1. The path never changes, only how fast the arm runs along it: the same split as Position control, applied to a whole arm.',
    'Linear s jumps to full speed at once: infinite acceleration at both ends (spikes on q̈). A cubic starts and stops at rest but its acceleration still jumps at the ends. A quintic also starts and ends at zero acceleration, at the cost of a higher peak speed. Trapezoid and S-curve (see Position control) cruise at the speed limit, so they are the fastest for given limits.',
    'Every joint has its own speed and acceleration limits. Run each joint flat out and they finish at different times: the short moves arrive first, and the hand wanders off the straight joint line (compare the ghost trail). Synchronised: divide each limit by that joint\'s travel and take the tightest; one s(t) drives all joints, which start and finish together.',
    'Switch the scope to q (share done): synchronised, all four curves lie on top of each other. On q̇ / limit only the slowest joint touches the edge; the others coast below their limits. The same s(t) trick works for Cartesian paths (Linear interpolation, Splines): scale the path parameter, not each axis.',
  ],
  controls: [
    { kind: 'choice', key: 'kind', options: opts(PROFILES), initial: 'trapezoid' },
    { kind: 'choice', key: 'sync', options: opts(SYNC), initial: 'sync' },
    { kind: 'choice', key: 'plot', options: opts(PLOTS), initial: 'qd' },
    { kind: 'slider', key: 'speed', label: 'Speed limits', min: 25, max: 100, step: 5, initial: 100, format: (v: number) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, TS.at, TS.k, 0.32, -0.6)
    floorMat(g, [-0.28, 0.3], [-0.3, 0.3])
    const lifted = add(g, new THREE.Group(), [0, 0, TS.plinth])
    const look = { w: 0.022, t: 0.017 }
    const ghost = serialArm(lifted, SERVO_ARM, { ...look, axes: false })
    ghostRig(ghost.group, B_FIELD, 0.2)
    const rig = serialArm(lifted, SERVO_ARM, { ...look, pedestal: TS.plinth })
    const pen = dotPen(lifted, 900, 0.0026)

    const X = 1.4
    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [X, 2.9 - i * 0.75, 0.2], { size: 0.3, align: 'left' }))
    const { y: sy, h: sh } = TS.scope
    const plot = sideScope(scene, sy, sh, { divs: [8, 4], zeroAt: 0.5 })
    const traces = JOINT_COLORS.slice(0, 4).map((c) => plot.trace(c, { samples: 361, radius: 0.08 }))
    const plotTitle = liveLabel(scene, [X0, sy + sh / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })
    addLabel(scene, '0 s', [X0, sy - sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const clock = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, sy - sh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-0.5, -0.8, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = tsParams(p)
        const r = tsRun(q)
        const key = `${q.kind}|${q.k}|${q.sync}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (st.t > r.span + TS.hold) st.t = 0
        const t = Math.min(st.t, r.span)
        const k = Math.round(t / r.dt)
        const other = q.sync === 'sync' ? 'free' : 'sync'
        const run = r.runs[q.sync]
        rig.set(run.qs[k])
        ghost.set(r.runs[other].qs[k])
        const vm = V_MAX.map((v) => v * q.k)
        const am = A_MAX.map((a) => a * q.k)
        run.qd[k].forEach((w, i) => rig.glow(i, Math.abs(w) >= vm[i] * 0.995 ? 1 : 0))

        pen.begin()
        for (let i = 0; i <= TS.M; i += 4) {
          const a = run.tips[i]
          const b = r.runs[other].tips[i]
          pen.dot(a, RING, i <= k ? 1 : 0.45)
          pen.dot(b, B_FIELD, i <= k ? 0.8 : 0.35)
        }
        pen.end()

        const N = k + 1
        const xs = Array.from({ length: N }, (_, i) => i / TS.M)
        const val = (i: number, j: number) => (q.plot === 'q' ? ((run.qs[i][j] - QA[j]) / DQ[j]) * sh - sh / 2 : q.plot === 'qd' ? (run.qd[i][j] / vm[j]) * (sh / 2) : (run.qdd[i][j] / am[j]) * (sh / 2))
        traces.forEach((tr, j) => tr.points(xs, xs.map((_, i) => Math.max(-sh / 2, Math.min(sh / 2, val(i, j))))))
        plotTitle.set(q.plot === 'q' ? 'share of each joint\'s move done (0 … 1)' : q.plot === 'qd' ? 'joint speed q̇ / own limit (edge = limit)' : 'joint acceleration / own limit (edge = limit)', LABEL)
        clock.set(`${t.toFixed(2)} of ${secs(r.span)} · real time`, GREY)

        const own = r.own.map((s) => s.T)
        const slow = r.sync.slowest.v
        lines[0].set(`synchronised: all joints ${secs(r.sync.scale.T)}`, q.sync === 'sync' ? RING : GREY)
        lines[1].set(`flat out: ${own.map(secs).join(', ')}`, q.sync === 'free' ? RING : GREY)
        lines[2].set(`speed limit set by the ${JOINT_NAMES[slow]} (moves ${Math.round(Math.abs(toDeg(DQ[slow])))}° at ${Math.round(toDeg(vm[slow]))}°/s)`, JOINT_COLORS[slow])
        const done = DQ.map((_, j) => (q.sync === 'sync' ? r.sync.scale.T : own[j]) <= t + 1e-9)
        lines[3].set(`arrived: ${done.map((d, j) => (d ? JOINT_NAMES[j] : null)).filter(Boolean).join(', ') || 'none yet'}`, done.every(Boolean) ? POWER : LABEL)

        const partial = done.some(Boolean) && !done.every(Boolean)
        status.set(`${PROFILES[q.kind]} · ${SYNC[q.sync].toLowerCase()} · ${Math.round(Math.min(1, t / Math.max(1e-9, q.sync === 'sync' ? r.sync.scale.T : Math.max(...own))) * 100)} % of the move`, LABEL)
        sub.set(`servo arm, same two poses · limits ${V_MAX.map((v) => Math.round(toDeg(v * q.k))).join('/')}°/s · ghost: ${SYNC[other].toLowerCase()}`, GREY)
        event.set(
          partial ? 'some joints already arrived: the hand leaves the joint-space line' : q.kind === 'linear' && (k <= 1 || Math.abs(t - r.sync.scale.T) < r.dt * 2) ? 'linear: speed jumps, acceleration is a spike' : done.every(Boolean) ? 'all joints at the goal' : q.sync === 'sync' ? 'one s(t) for every joint: they move as one' : 'each joint at its own fastest profile',
          partial ? HIGH_V : q.kind === 'linear' ? FORCE : done.every(Boolean) ? POWER : RING,
        )
      },
      readouts: (p) => {
        const q = tsParams(p)
        const r = tsRun(q)
        const own = r.own.map((s) => s.T)
        return [
          { label: 'Synchronised time', value: secs(r.sync.scale.T) },
          { label: 'Slowest joint alone', value: `${secs(Math.max(...own))} (${JOINT_NAMES[own.indexOf(Math.max(...own))]})` },
          { label: 'Fastest joint alone', value: `${secs(Math.min(...own))} (${JOINT_NAMES[own.indexOf(Math.min(...own))]})`, tone: q.sync === 'free' ? 'warn' : 'ok' },
          { label: 'End acceleration', value: q.kind === 'linear' ? '∞ (jump)' : q.kind === 'cubic' || q.kind === 'trapezoid' ? 'steps' : 'smooth', tone: q.kind === 'linear' ? 'bad' : q.kind === 'quintic' || q.kind === 'scurve' ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
