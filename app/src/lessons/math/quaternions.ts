import * as THREE from 'three/webgpu'
import { DEG, Quat, eulerOf, eulerQuat, gimbalView, quatAxis, quatComposeView, quatRotate, quatRotateView, slerpView, sphereDir, sub3, toDeg } from '../../core/physics'
import { Vec3, cross } from '../../core/fields'
import { fixedText, radText, tupleText } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  dirSphere,
  frameTriad,
  gimbalRings,
  glowMat,
  memoBy,
  pointCloud,
  quadcopter,
  statusHeader,
  titledScope,
  vecArrow,
  zUp,
  textRows,
  WIDE_VIEW,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, opts, pick, toneOf } from '../types'

const PLOT = { x: 8.2, w: 11, y: 1.6, h: 6 }
const at = (v: readonly number[], k = 1): V3 => [v[0] * k, v[1] * k, v[2] * k]
const turnTo = (o: THREE.Object3D, q: Quat) => o.quaternion.set(q[1], q[2], q[3], q[0])
const ball = (g: THREE.Object3D, r: number, c: string) => add(g, mesh(new THREE.SphereGeometry(r, 16, 10), glowMat(c, 1)))
const drone = (g: THREE.Object3D, size: number) => {
  const holder = add(g, new THREE.Group())
  const quad = quadcopter(holder, { arcs: false })
  quad.group.scale.setScalar(size)
  quad.set([0, 0.8, 1.6, 2.4], [0.5, 0.5, 0.5, 0.5])
  return holder
}

// --- Gimbal lock: a drone in a yaw/pitch/roll gimbal. At 90° pitch the roll ring's axis lines up with the yaw ring's and one way of turning is gone. ---

const GL = { at: [-8.2, -2.9, 0] as V3, k: 5.1, sweep: 150 }
const glRun = memoBy(
  (p: Params) => `${p.yaw} ${p.pitch} ${p.roll}`,
  (p: Params) => {
    const q = { yaw: n(p, 'yaw') * DEG, pitch: n(p, 'pitch') * DEG, roll: n(p, 'roll') * DEG }
    const G = gimbalView(q.yaw, q.pitch, q.roll)
    const sweep = Array.from({ length: 151 }, (_, i) => eulerOf(eulerQuat(q.yaw, (i / 150) * GL.sweep * DEG, q.roll)))
    return { ...q, G, sweep, jumped: Math.abs(G.euler.pitch - q.pitch) > 1e-6 }
  },
)

export const quaternionsGimbalLock: Lesson = {
  id: 'quaternions-gimbal-lock',
  title: 'Gimbal lock',
  tagline: 'Three angles, and at 90° pitch two of them do the same thing',
  formula: (p) => {
    const { yaw, pitch, roll, G } = glRun(p)
    const e = G.euler
    return `R = Rz(ψ)·Ry(θ)·Rx(φ) · rings ψ ${radText(yaw)} θ ${radText(pitch)} φ ${radText(roll)} · yaw axis to roll axis ${G.yawRollDeg.toFixed(0)}° · |det[z, y', x'']| = |cos θ| = ${fixedText(G.freedom)} · read back as Euler: ψ ${radText(e.yaw)} θ ${radText(e.pitch)} φ ${radText(e.roll)} · q = ${tupleText(G.q)}`
  },
  legend: [
    { color: AXIS_RGB[2], label: 'Yaw ring: turns about world z', shape: 'dot' },
    { color: AXIS_RGB[1], label: 'Pitch ring: nose up and down', shape: 'dot' },
    { color: AXIS_RGB[0], label: 'Roll ring: turns about the nose', shape: 'dot' },
    { color: HIGH_V, label: 'The turn no ring can make', shape: 'dot' },
  ],
  points: [
    'Euler angles describe an orientation as three turns in a row: yaw ψ about the vertical, then pitch θ nose up, then roll φ about the nose (robot frame: x forward, y left, z up). A gimbal is that sequence built in metal: each ring is carried by the one outside it, so each turn happens about an axis already moved by the turns before.',
    'At level pitch the three ring axes are at right angles and any small turn of the drone is some mix of the three. Raise the pitch: the roll axis (the nose) tips toward the vertical yaw axis. How much of 3D turning the rings still cover is |det| of the three axes, which works out to |cos θ| (the plot\'s grey line).',
    'At θ = 90° the nose points straight up, along the yaw axis. Turning the yaw ring and turning the roll ring now spin the drone the same way; only ψ + φ matters. The red arrow is the turn left over: no ring can make it, so to follow it the rings would have to whip round at huge speed. That is gimbal lock. Nothing is broken; three angles simply cannot cover every orientation smoothly.',
    'It shows up in software too. Keep pitching past 90° (a loop) and the Euler angles an IMU or a ROS rpy conversion reads back jump: pitch turns round and comes down again while yaw and roll leap by 180° (plot). The quaternion q (last row) changes smoothly through the same motion. That is why IMU fusion chips (BNO055, the MPU-6050 DMP) output quaternions and flight controllers keep attitude as one (Sensors › IMU › Gyroscope, Mobility › Drones & flight › Attitude control).',
    'Euler angles stay fine for showing and typing in angles, and for robots that never pitch near 90° (a ground rover). Store and integrate rotations as quaternions or matrices (Maths › Matrices › Rotation matrix), and convert to angles only for display. Next: Quaternion rotate.',
  ],
  controls: [angleSlider('pitch', 'Pitch ring θ (nose up)', 0, GL.sweep, 70), angleSlider('yaw', 'Yaw ring ψ', -90, 90, 30), angleSlider('roll', 'Roll ring φ', -90, 90, 20)],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = zUp(scene, GL.at, GL.k, 0.32, -0.55)
    const gim = gimbalRings(g, 1)
    drone(gim.inner, 3)
    const body = frameTriad(gim.inner, 0.45, '', LABEL, 0.012)
    const axisArrows = [AXIS_RGB[2], AXIS_RGB[1], AXIS_RGB[0]].map((c) => vecArrow(g, c, 0.014, 0.13))
    const hard = vecArrow(g, HIGH_V, 0.02, 0.13)

    const plot = titledScope(scene, PLOT.y, PLOT.h, 'Euler read back vs pitch', LABEL, 0.5, PLOT.x, PLOT.w)
    const tr = [AXIS_RGB[2], AXIS_RGB[1], AXIS_RGB[0]].map((c) => plot.s.trace(c, { samples: 151, radius: 0.06 }))
    const free = plot.s.trace(GREY, { samples: 151, radius: 0.035 })
    const yOf = (rad: number) => (rad / Math.PI) * (PLOT.h / 2)
    const names = ['ψ', 'θ', 'φ']
    names.forEach((t, i) => addLabel(scene, t, [PLOT.x - PLOT.w / 2 - 0.5, PLOT.y + 2.2 - i * 0.7, 0.3], [AXIS_RGB[2], AXIS_RGB[1], AXIS_RGB[0]][i], 0.32, 'right'))
    addLabel(scene, '+180°', [PLOT.x + PLOT.w / 2 + 0.2, PLOT.y + PLOT.h / 2 - 0.15, 0.3], GREY, 0.24, 'left')
    addLabel(scene, '−180°', [PLOT.x + PLOT.w / 2 + 0.2, PLOT.y - PLOT.h / 2 + 0.15, 0.3], GREY, 0.24, 'left')
    const rows = textRows(scene, 4)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { yaw, pitch, roll, G, sweep, jumped } = glRun(p)
        gim.set(yaw, pitch, roll)
        body.face()
        const locked = G.freedom < 0.1
        axisArrows[0]([0, 0, 0], [0, 0, 1.22], 'yaw', [0.14, 0, -0.05])
        axisArrows[1]([0, 0, 0], at(G.pitchAxis, 1.45), 'pitch', [0.2, 0, 0.2])
        axisArrows[2]([0, 0, 0], at(G.rollAxis, 1.12), 'roll', G.freedom < 0.3 ? [-0.42, 0, -0.12] : [0, 0, 0])
        const hl = 1.3 * (1 - G.freedom)
        hard(at(G.hardAxis, 0.1), at(G.hardAxis, 0.1 + hl), G.freedom < 0.5 ? 'stuck' : '')
        const u = pitch / (GL.sweep * DEG)
        tr[0].draw((s) => yOf(sweep[Math.round(s * 150)].yaw), u)
        tr[1].draw((s) => yOf(sweep[Math.round(s * 150)].pitch), u)
        tr[2].draw((s) => yOf(sweep[Math.round(s * 150)].roll), u)
        free.draw((s) => Math.abs(Math.cos(s * GL.sweep * DEG)) * (PLOT.h / 2), u)
        plot.lo.set('pitch ring 0°')
        plot.hi.set(`${GL.sweep}°`)
        plot.right.set(`grey |cos θ| ${fixedText(G.freedom)}`, locked ? HIGH_V : GREY)
        const e = G.euler
        rows[0].set(`rings: ψ ${radText(yaw)} · θ ${radText(pitch)} · φ ${radText(roll)}`, LABEL)
        rows[1].set(`read back: ψ ${radText(e.yaw)} · θ ${radText(e.pitch)} · φ ${radText(e.roll)}`, jumped ? HIGH_V : LABEL)
        rows[2].set(`yaw axis to roll axis ${G.yawRollDeg.toFixed(0)}° · freedom ${fixedText(G.freedom)}`, locked ? HIGH_V : G.freedom < 0.5 ? HEAT : POWER)
        rows[3].set(`q = ${tupleText(G.q)} (smooth)`, B_FIELD)
        head.status.set(`Gimbal lock · pitch ${radText(pitch)}`)
        head.sub.set('drone in a 3-ring gimbal · x forward, y left, z up', GREY)
        head.event.set(
          locked ? 'locked: yaw and roll spin the drone the same way' : jumped ? 'past 90°: the Euler angles jumped, q did not' : G.freedom < 0.5 ? 'nearing the lock: the red turn gets hard' : 'three independent turns',
          locked ? HIGH_V : jumped || G.freedom < 0.5 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { G, jumped } = glRun(p)
        return [
          { label: 'Yaw axis to roll axis', value: `${G.yawRollDeg.toFixed(0)}°`, tone: toneOf(G.yawRollDeg > 30, G.yawRollDeg > 5) },
          { label: 'Freedom |cos θ|', value: fixedText(G.freedom), tone: toneOf(G.freedom > 0.5, G.freedom > 0.1) },
          { label: 'Euler read back', value: `${radText(G.euler.yaw)}, ${radText(G.euler.pitch)}, ${radText(G.euler.roll)}`, tone: jumped ? 'bad' : 'ok' },
          { label: 'Quaternion w', value: fixedText(G.q[0]) },
        ]
      },
    }
  },
}

// --- Quaternion rotate: q = (cos θ/2, sin θ/2·n) turns v by θ about n via q·v·q*; −q is the same turn; two turns compose by multiplying. ---

const QR = { at: [-8.4, -2.8, 0] as V3, k: 5.8, nose: [1, 0, 0] as Vec3 }
const QR_MODES = { one: 'One rotation', compose: 'Then yaw 90° (compose)' }
const YAW90 = quatAxis([0, 0, 1], Math.PI / 2)
const qrRun = memoBy(
  (p: Params) => `${p.theta} ${p.az} ${p.el} ${p.mode}`,
  (p: Params) => {
    const theta = n(p, 'theta') * DEG
    const R = quatRotateView(sphereDir(n(p, 'az') * DEG, n(p, 'el') * DEG), theta, QR.nose)
    const sweep = Array.from({ length: 181 }, (_, i) => {
      const r = quatRotateView(R.axis, (i / 90 - 1) * 2 * Math.PI, QR.nose)
      return { w: r.q[0], x: r.v2[0] }
    })
    return { theta, R, C: quatComposeView(R.q, YAW90, QR.nose), sweep, mode: pick(QR_MODES, p.mode, 'one') }
  },
)

export const quaternionsQuaternionRotate: Lesson = {
  id: 'quaternions-quaternion-rotate',
  title: 'Quaternion rotate',
  tagline: 'Four numbers: an axis and half the angle',
  formula: (p) => {
    const { theta, R, C, mode } = qrRun(p)
    const base = `q = (cos θ/2, sin θ/2·n) = ${tupleText(R.q)}, |q| = 1 · v' = q·v·q* = ${tupleText(R.v2)} · (−q)·v·(−q)* = ${tupleText(R.v2neg)} · θ = ${radText(theta)}`
    return mode === 'compose' ? `${base} · q2·q1 = ${tupleText(C.q21)} = turn ${radText(C.r21.angle)} about ${tupleText(C.r21.axis)} · q1·q2 is ${radText(C.gap)} away` : base
  },
  legend: (p) =>
    qrRun(p).mode === 'compose'
      ? [
          { color: RING, label: 'Axis n of q1', shape: 'dot' },
          { color: B_FIELD, label: 'Nose v before', shape: 'dot' },
          { color: HEAT, label: 'After q1', shape: 'dot' },
          { color: POWER, label: 'After q1 then yaw: q2·q1', shape: 'dot' },
          { color: GREY, label: 'Other order: q1·q2', shape: 'dot' },
        ]
      : [
          { color: RING, label: 'Axis n (unit)', shape: 'dot' },
          { color: B_FIELD, label: 'Nose v before', shape: 'dot' },
          { color: HEAT, label: 'Nose after: q·v·q*', shape: 'dot' },
        ],
  points: [
    'Any change of orientation is one turn by some angle θ about some axis n (Euler\'s rotation theorem). A unit quaternion packs exactly that into four numbers: q = (w, x, y, z) = (cos θ/2, sin θ/2·nx, sin θ/2·ny, sin θ/2·nz). Its length is always 1. No angle sequence, so no order of axes and no gimbal lock.',
    'To turn a vector v, write it as a quaternion with w = 0 and sandwich it: v\' = q·v·q*, where q* = (w, −x, −y, −z) is the conjugate and · is the quaternion product (the i·j = k rules). The half angles in q meet twice in the sandwich and add up to the full θ. Here v is the drone\'s nose; it sweeps a circle round n (the orange arc).',
    'Double cover: q and −q turn every vector the same way (−1 appears twice in the sandwich and cancels). On the plot w = cos θ/2 needs 720° to come back, while the rotated nose repeats every 360°. At θ = 360° q = (−1, 0, 0, 0): a full turn, the same orientation, the opposite sign. Code that compares or blends quaternions has to allow for both signs (SLERP does).',
    'Two rotations compose by multiplying: q1 first, then q2 about the world axes, is q2·q1, one more unit quaternion, 16 multiplies against 27 for 3×3 matrices, and easy to renormalise when rounding builds up. Order matters, as with matrices (Maths › Matrices › Matrix multiply): pick "Then yaw 90°" and compare q2·q1 with the grey q1·q2.',
    'Converting is cheap both ways: q to a rotation matrix is a few products (Kinematics › Coordinate frames › Homogeneous transforms stores the turn as one), and the BNO055 or an MPU-6050 DMP sends q straight out. ROS geometry_msgs/Quaternion is (x, y, z, w): w last, a classic source of bugs.',
  ],
  controls: [
    angleSlider('theta', 'Turn angle θ', -360, 360, 120),
    angleSlider('az', 'Axis direction (from x toward y)', -180, 180, 40),
    angleSlider('el', 'Axis elevation', -90, 90, 50),
    { kind: 'choice', key: 'mode', options: opts(QR_MODES), initial: 'one' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = zUp(scene, QR.at, QR.k, 0.3, -0.5)
    const sph = dirSphere(g, 1)
    const triad = frameTriad(g, 0.35, '', GREY, 0.008, { letters: 'xyz', size: 0.1 })
    const body = drone(g, 2.2)
    const axisA = vecArrow(g, RING, 0.016, 0.13)
    const axisB = vecArrow(g, RING, 0.008, 0.13)
    const vA = vecArrow(g, B_FIELD, 0.016, 0.12)
    const vB = vecArrow(g, HEAT, 0.016, 0.12)
    const vC = vecArrow(g, POWER, 0.016, 0.12)
    const vD = vecArrow(g, GREY, 0.012, 0.12)
    const ring = sph.trail(96, 0.008)
    const swept = pointCloud(g, 120, 0.016)
    const yawDots = sph.trail(40, 0.016)
    const tip = ball(g, 0.035, HEAT)

    const plot = titledScope(scene, PLOT.y, PLOT.h, 'w = cos θ/2 · nose x, vs θ', POWER, 0.5, PLOT.x, PLOT.w)
    const wTr = plot.s.trace(POWER, { samples: 181, radius: 0.06 })
    const xTr = plot.s.trace(HEAT, { samples: 181, radius: 0.045 })
    const rows = textRows(scene, 4)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { theta, R, C, sweep, mode } = qrRun(p)
        const compose = mode === 'compose'
        turnTo(body, compose ? C.q21 : R.q)
        axisA([0, 0, 0], at(R.axis, 1.3), 'n')
        axisB([0, 0, 0], at(R.axis, -1.1), '')
        vA([0, 0, 0], at(QR.nose), 'v', [0, -0.08, 0])
        vB([0, 0, 0], at(R.v2), compose ? 'q1' : 'q·v·q*')
        const e1 = sub3(QR.nose, R.centre)
        const e2 = cross(R.axis, e1)
        const circ = Array.from({ length: 96 }, (_, i) => {
          const a = (i / 95) * 2 * Math.PI
          return R.centre.map((c, k) => c + e1[k] * Math.cos(a) + e2[k] * Math.sin(a))
        })
        ring(circ, GREY)
        const k = Math.min(120, Math.max(2, Math.round((Math.abs(theta) / (2 * Math.PI)) * 60)))
        for (let i = 0; i < k; i++) {
          const a = (i / (k - 1)) * theta
          swept.set(i, at(R.centre.map((c, j) => c + e1[j] * Math.cos(a) + e2[j] * Math.sin(a))), HEAT)
        }
        swept.show(R.radius < 0.02 ? 0 : k)
        tip.position.set(...at(compose ? C.v21 : R.v2))
        vC([0, 0, 0], compose ? at(C.v21) : [0, 0, 0], compose ? 'q2·q1' : '')
        vD([0, 0, 0], compose ? at(C.v12) : [0, 0, 0], compose ? 'q1·q2' : '', [0, 0, -0.12])
        const v1 = R.v2
        yawDots(compose ? Array.from({ length: 40 }, (_, i) => quatRotate(quatAxis([0, 0, 1], (i / 39) * (Math.PI / 2)), v1)) : [], POWER)
        triad.face()

        const u = (theta / (4 * Math.PI)) + 0.5
        const yOf = (v: number) => v * (PLOT.h / 2)
        wTr.draw((s) => yOf(sweep[Math.round(s * 180)].w), u)
        xTr.draw((s) => yOf(sweep[Math.round(s * 180)].x), u)
        plot.lo.set('−360°')
        plot.hi.set('+360°')
        plot.right.set(`${fixedText(R.q[0])} · ${fixedText(R.v2[0])}`, LABEL)
        rows[0].set(`n = ${tupleText(R.axis)} · θ = ${radText(theta)} · θ/2 = ${radText(theta / 2)}`, RING)
        rows[1].set(`q = (cos θ/2, sin θ/2·n) = ${tupleText(R.q)}`, POWER)
        if (compose) {
          rows[2].set(`q2·q1: turn ${radText(C.r21.angle)} about ${tupleText(C.r21.axis)}`, POWER)
          rows[3].set(C.gap < 1e-6 ? 'q1·q2 is the same here: shared axis' : `q1·q2 ends ${radText(C.gap)} away from q2·q1`, GREY)
        } else {
          rows[2].set(`q·v·q* = ${tupleText(R.v2)} · v = (1.00, 0, 0)`, HEAT)
          rows[3].set(`−q = ${tupleText(R.neg)} gives the same`, LABEL)
        }
        head.status.set(`Quaternion rotate · ${radText(theta)} about n`)
        head.sub.set('nose v = x axis · sphere of directions, radius 1', GREY)
        const full = Math.abs(Math.abs(theta) - 2 * Math.PI) < 1e-6
        head.event.set(full ? 'a full turn: q = (−1, 0, 0, 0), same orientation as q = 1' : compose ? 'order matters: q2·q1 is not q1·q2' : 'one axis, one angle, no gimbal', full ? HEAT : POWER)
      },
      readouts: (p) => {
        const { R, C, mode } = qrRun(p)
        return [
          { label: 'q (w, x, y, z)', value: tupleText(R.q) },
          { label: '|q|', value: fixedText(R.norm), tone: 'ok' },
          { label: mode === 'compose' ? 'q2·q1 turn' : 'Nose after', value: mode === 'compose' ? `${radText(C.r21.angle)}` : tupleText(R.v2) },
          { label: mode === 'compose' ? 'q1·q2 differs by' : 'Same from −q', value: mode === 'compose' ? radText(C.gap) : 'yes', tone: mode === 'compose' ? toneOf(C.gap < 1e-6, false) : 'ok' },
        ]
      },
    }
  },
}

// --- SLERP: from orientation A to B. Lerping the Euler angles wobbles and can go the long way; slerp turns about one axis at a constant rate. ---

const MOVES = {
  over: { name: 'Over the top', a: [0, 60, 0], b: [180, 60, 180] },
  wrap: { name: 'Across ±180° yaw', a: [170, 0, 0], b: [-170, 0, 0] },
  mixed: { name: 'Tilt, turn and roll', a: [0, 0, 0], b: [150, 60, 90] },
} as const
const eul = (v: readonly number[]) => ({ yaw: v[0] * DEG, pitch: v[1] * DEG, roll: v[2] * DEG })
const SL = { k: 3.8, xs: [-13.6, -5.2], y: -4.6, size: 2.4 }
const slRun = memoBy(
  (p: Params) => `${p.u} ${p.move}`,
  (p: Params) => {
    const move = pick(MOVES, p.move, 'over')
    const M = MOVES[move]
    const u = n(p, 'u')
    return { move, M, u, S: slerpView(eul(M.a), eul(M.b), u) }
  },
)
const triple = (v: readonly number[]) => v.map((d) => `${d}°`).join(', ')

export const quaternionsSlerp: Lesson = {
  id: 'quaternions-slerp',
  title: 'SLERP',
  tagline: 'Blend two orientations: one axis, constant speed, the short way',
  formula: (p) => {
    const { u, S } = slRun(p)
    return `slerp(qA, qB, u) = [sin((1 − u)Ω)·qA + sin(uΩ)·qB] / sin Ω, cos Ω = |qA·qB|, Ω = ${radText(S.direct / 2)} · u = ${fixedText(u)} → q = ${tupleText(S.qs)} · turns ${radText(S.totalS)} in all vs Euler lerp ${radText(S.totalE)}`
  },
  legend: [
    { color: HEAT, label: 'Euler angles lerped: nose path', shape: 'dot' },
    { color: B_FIELD, label: 'SLERP: nose path', shape: 'dot' },
    { color: GREY, label: 'Start A', shape: 'dot' },
    { color: RING, label: 'End B', shape: 'dot' },
  ],
  points: [
    'A drone turning to a new attitude, a camera gimbal panning, a robot hand reorienting between two grasps: all need the orientations in between, from A at u = 0 to B at u = 1. The obvious way, interpolating the yaw, pitch and roll numbers linearly, gives a valid orientation at every u, but a poor path.',
    'Euler lerp (left) wobbles: the three angles change at fixed rates, but they are turns about axes that move, so the real turn rate swings (orange on the plot) and the nose wanders along a curve. Across ±180° yaw it goes the long way round, 340° instead of 20°. Over the top, pitch 60° to 120°, is written (180°, 60°, 180°) in Euler angles (Gimbal lock), and lerping those numbers swings the nose half way round the sky while rolling the drone over: 348° of turning for a 60° move.',
    'SLERP (spherical linear interpolation) works on the quaternions. Unit quaternions live on a 4D sphere; slerp walks the great circle between qA and qB at a constant rate: q(u) = [sin((1 − u)Ω)·qA + sin(uΩ)·qB] / sin Ω, with cos Ω = qA·qB. In 3D that is one fixed axis and a steady turn rate (flat blue line), the shortest turn from A to B.',
    'The double cover matters here: qB and −qB are the same orientation, but one is the long way round. Slerp takes the sign that gives qA·qB ≥ 0 so it always turns less than 180°. When Ω is tiny, sin Ω is near zero, so code falls back to a normalised plain lerp.',
    'Slerp sets the path, not the timing: feed u through a smooth profile to start and stop gently (Kinematics › Trajectories › Time scaling). For many orientations in a row, chained slerps (or squad) keep the motion smooth. Kinematics › Coordinate frames › Homogeneous transforms uses slerp to animate its turns.',
  ],
  controls: [
    { kind: 'slider', key: 'u', label: 'Progress u', min: 0, max: 1, step: 0.01, initial: 0.4, format: (v) => fixedText(v) },
    { kind: 'choice', key: 'move', options: opts(Object.fromEntries(Object.entries(MOVES).map(([k, v]) => [k, v.name]))), initial: 'over' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const sides = SL.xs.map((x, i) => {
      const g = zUp(scene, [x, SL.y, 0], SL.k, 0.3, -0.55)
      const sph = dirSphere(g, 1)
      const color = i === 0 ? HEAT : B_FIELD
      const body = drone(g, SL.size)
      addLabel(scene, i === 0 ? 'Euler lerp' : 'SLERP', [x, SL.y + 4.4, 0.3], color, 0.42, 'center')
      return { body, path: sph.trail(61, 0.02), nose: vecArrow(g, color, 0.016, 0.12), a: ball(g, 0.05, GREY), b: ball(g, 0.05, RING), color }
    })
    const plot = titledScope(scene, PLOT.y, PLOT.h, 'turn rate, 1 s move', LABEL, 0, PLOT.x, PLOT.w)
    const eTr = plot.s.trace(HEAT, { samples: 60, radius: 0.06 })
    const sTr = plot.s.trace(B_FIELD, { samples: 60, radius: 0.06 })
    const rows = textRows(scene, 4)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { u, S, M } = slRun(p)
        const pick2 = [
          { q: S.qe, nose: S.noseE, path: S.pathE },
          { q: S.qs, nose: S.noseS, path: S.pathS },
        ]
        sides.forEach((s, i) => {
          turnTo(s.body, pick2[i].q)
          s.path(pick2[i].path, s.color)
          s.nose([0, 0, 0], at(pick2[i].nose, 1.18), '')
          s.a.position.set(...at(S.pathS[0]))
          s.b.position.set(...at(S.pathS[S.pathS.length - 1]))
        })
        const top = Math.max(...S.rateE, ...S.rateS) * 1.15
        const yOf = (r: number) => (r / top - 0.5) * PLOT.h
        const idx = (s: number) => Math.min(S.rateE.length - 1, Math.floor(s * S.rateE.length))
        eTr.draw((s) => yOf(S.rateE[idx(s)]), u)
        sTr.draw((s) => yOf(S.rateS[idx(s)]), u)
        const k = idx(u)
        plot.lo.set('u = 0')
        plot.hi.set('u = 1')
        plot.right.set(`${toDeg(S.rateE[k]).toFixed(0)} vs ${toDeg(S.rateS[k]).toFixed(0)}°/s`, LABEL)
        const e = S.euler
        rows[0].set(`A (${triple(M.a)}) to B (${triple(M.b)}) · u = ${fixedText(u)}`, LABEL)
        rows[1].set(`Euler lerp: (${radText(e.yaw)}, ${radText(e.pitch)}, ${radText(e.roll)}) · turns ${radText(S.totalE)}`, HEAT)
        rows[2].set(`slerp: ${tupleText(S.qs)} · turns ${radText(S.totalS)}`, B_FIELD)
        rows[3].set(`cos Ω = qA·qB · Ω = ${radText(S.direct / 2)}, half the turn`, LABEL)
        head.status.set(`SLERP · ${MOVES[slRun(p).move].name.toLowerCase()}`)
        head.sub.set('(yaw, pitch, roll) · nose paths on the sphere of directions', GREY)
        const extra = S.totalE / S.totalS
        head.event.set(extra > 1.2 ? `Euler lerp turns ${extra.toFixed(1)}× as far as it needs to` : 'similar paths here', extra > 1.2 ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { S } = slRun(p)
        const swing = Math.max(...S.rateE) / Math.min(...S.rateE)
        return [
          { label: 'Shortest turn A to B', value: radText(S.direct) },
          { label: 'Slerp turns', value: radText(S.totalS), tone: 'ok' },
          { label: 'Euler lerp turns', value: radText(S.totalE), tone: toneOf(S.totalE < S.totalS * 1.05, S.totalE < S.totalS * 1.5) },
          { label: 'Euler rate max/min', value: `${swing.toFixed(2)}×`, tone: toneOf(swing < 1.05, swing < 1.3) },
        ]
      },
    }
  },
}
