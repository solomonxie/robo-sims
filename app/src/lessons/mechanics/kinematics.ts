import { BALLS, DEG, G, driveProfile, flightAt, flightRun, profileAt, projectileIdeal, strobeRun, uniformAt } from '../../core/physics'
import { accelText, mpsText, secsText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, dotPen, flatBox, forceArrow, glowMat, lapseClock, liveLabel, memoBy, plotPanel, rodPool, sideCar, sideView, statusHeader } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import * as THREE from 'three/webgpu'

const VIEW = sideView(-2.6, -0.6)
const SLOW = 0.5
const metres = (s: number) => `${s.toFixed(2)} m`

/** Floor strip from `x0` with a tick every 0.5 m and a label every metre, `k` units per metre. */
function track(scene: THREE.Object3D, x0: number, y0: number, metresLong: number, k: number) {
  box(scene, [metresLong * k + 3, 0.3, 3], mat('#3a3f4a', { rough: 0.8 }), [x0 + (metresLong * k) / 2, y0 - 0.15, 0])
  const tick = glowMat(GREY, 0.4)
  for (let i = 0; i <= metresLong * 2; i++) {
    flatBox(scene, [0.06, 0.04, i % 2 ? 1.2 : 2.6], tick, [x0 + i * 0.5 * k, y0 + 0.01, 0.6])
    if (i % 2 === 0) addLabel(scene, `${i / 2} m`, [x0 + i * 0.5 * k, y0 - 0.75, 1.6], GREY, 0.26)
  }
}

// --- Constant acceleration: strobe flashes every τ show the gaps growing by a τ² each time. ---

const CA = { seconds: 2.5, tau: 0.5, x0: -16, y0: -6.6, k: 6.5, len: 4, carK: 13, sMax: 4, vMax: 2.5, plot: [4.5, -0.3, 0] as V3, w: 12, h: 5.6 }
const caParams = (p: Params) => ({ u: n(p, 'u'), a: n(p, 'a') })
type CaQ = ReturnType<typeof caParams>
const caKey = (q: CaQ) => `${q.u}|${q.a}`
const caRun = memoBy(caKey, (q: CaQ) => ({ flashes: strobeRun(q.u, q.a, CA.tau, CA.seconds), end: uniformAt(q.u, q.a, CA.seconds) }))

export const kinematicsConstantAcceleration: Lesson = {
  id: 'kinematics-constant-acceleration',
  title: 'Constant acceleration',
  tagline: 'Equal times, growing gaps',
  formula: (p) => {
    const q = caParams(p)
    const { end } = caRun(q)
    return `s = u t + ½ a t² = ${q.u.toFixed(2)}×${CA.seconds} + ½×${q.a.toFixed(2)}×${CA.seconds}² = ${metres(end.s)} · v = u + a t = ${mpsText(end.v)} · v² = u² + 2 a s`
  },
  legend: [
    { color: RING, label: `Strobe flash every ${CA.tau} s`, shape: 'dot' },
    { color: HEAT, label: 'Gap Δs between flashes', shape: 'dot' },
    { color: POWER, label: `Position s (plot 0…${CA.sMax} m)`, shape: 'dot' },
    { color: B_FIELD, label: `Speed v (plot 0…${CA.vMax} m/s)`, shape: 'dot' },
  ],
  points: [
    'Kinematics describes motion without asking what causes it: position s, velocity v and acceleration a. When a is constant (a steady motor force, Newton’s laws › F = m a) three short formulas cover everything: v = u + a t, s = u t + ½ a t², v² = u² + 2 a s, with u the starting speed.',
    `The yellow posts are strobe flashes every ${CA.tau} s, like a long-exposure photo. With a = 0 the gaps are equal: steady speed. Speed up and every gap is longer than the last by exactly a τ², so the table’s Δs column climbs in equal steps.`,
    'Speed grows linearly (a straight line on the plot) but position grows with t²: a parabola. Starting from rest the gaps go 1 : 3 : 5 : 7, the pattern Galileo timed with balls rolling down a ramp.',
    'Make a negative and the car brakes: the gaps shrink, and once v reaches zero it stops rather than reversing. Real drives never hold a perfectly constant; Velocity vs time plots builds a full accelerate–cruise–brake move from these pieces.',
  ],
  controls: [
    { kind: 'slider', key: 'u', label: 'Start speed u', min: 0, max: 0.5, step: 0.05, initial: 0.2, format: (v) => mpsText(v) },
    { kind: 'slider', key: 'a', label: 'Acceleration a', min: -0.5, max: 0.8, step: 0.05, initial: 0.6, format: (v) => accelText(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(CA.seconds, SLOW, 1)
    track(scene, CA.x0, CA.y0, CA.len, CA.k)
    const car = sideCar(scene, [CA.x0, CA.y0, 0], CA.carK)
    const nF = Math.round(CA.seconds / CA.tau) + 1
    const postM = glowMat(RING, 0.8)
    const posts = Array.from({ length: nF }, () => {
      const g = add(scene, new THREE.Group(), [0, CA.y0, 0.8])
      box(g, [0.1, 2.8, 0.1], postM, [0, 1.4, 0]).castShadow = false
      return { g, t: liveLabel(g, [0, 3.2, 0], { size: 0.26, color: RING }), gap: liveLabel(scene, [0, CA.y0 + 3.9, 0.8], { size: 0.26, color: HEAT }) }
    })
    const cols = [-17, -14, -10.5, -7]
    addLabel(scene, 'strobe table', [cols[0], 3.4, 0.3], LABEL, 0.32, 'left')
    ;['t', 's', 'Δs', 'v'].forEach((h, i) => addLabel(scene, h, [cols[i], 2.6, 0.3], GREY, 0.28, 'left'))
    const rows = Array.from({ length: nF }, (_, r) => cols.map((x) => liveLabel(scene, [x, 1.8 - r * 0.72, 0.3], { size: 0.28, align: 'left' })))
    const plot = plotPanel(scene, CA.plot, CA.w, CA.h, CA.seconds, `position 0…${CA.sMax} m`, `speed 0…${CA.vMax} m/s`)
    const sTr = plot.trace(POWER, { samples: 120, radius: 0.07 })
    const vTr = plot.trace(B_FIELD, { samples: 120, radius: 0.05 })
    const flashDots = dotPen(plot.group, nF, 0.16)
    const yOf = (f: number) => (Math.min(1.02, f) - 0.5) * CA.h
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = caParams(p)
        const { flashes } = caRun(q)
        const t = clock(dtF, caKey(q))
        const now = uniformAt(q.u, q.a, t)
        car.group.position.x = CA.x0 + now.s * CA.k
        car.set(now.s, 0)
        flashDots.begin()
        flashes.forEach((f, i) => {
          const seen = t >= f.t - 1e-9
          const post = posts[i]
          post.g.visible = seen
          post.g.position.x = CA.x0 + f.s * CA.k
          post.t.set(`${f.t} s`)
          const roomy = i === 0 || f.ds * CA.k > 1.3
          post.t.group.visible = roomy
          post.gap.group.visible = seen && i > 0 && roomy
          post.gap.group.position.x = CA.x0 + (f.s - f.ds / 2) * CA.k
          post.gap.set(`${(f.ds * 100).toFixed(0)} cm`)
          const texts = [`${f.t.toFixed(1)} s`, metres(f.s), i ? `${(f.ds * 100).toFixed(1)} cm` : '—', mpsText(f.v)]
          rows[i].forEach((l, c) => l.set(seen ? texts[c] : '', c === 2 ? HEAT : LABEL))
          if (seen) flashDots.dot([plot.xAt(f.t / CA.seconds), yOf(f.s / CA.sMax), 0.35], RING)
        })
        flashDots.end()
        const samples = 120
        const k = Math.max(2, Math.round((t / CA.seconds) * (samples - 1)) + 1)
        const us = Array.from({ length: k }, (_, i) => i / (samples - 1))
        const st = us.map((u) => uniformAt(q.u, q.a, u * CA.seconds))
        sTr.points(us, st.map((f) => yOf(f.s / CA.sMax)))
        vTr.points(us, st.map((f) => yOf(f.v / CA.vMax)))
        head.status.set(`Constant acceleration · u ${mpsText(q.u)} · a ${accelText(q.a)}`, LABEL)
        const step = q.a * CA.tau * CA.tau
        head.event.set(now.stopped ? `stopped: v = 0 after ${metres(now.s)}` : `s ${metres(now.s)} · v ${mpsText(now.v)} · each gap ${step >= 0 ? '+' : '−'}${Math.abs(step * 100).toFixed(1)} cm`, now.stopped ? GREY : q.a >= 0 ? POWER : HIGH_V)
        head.sub.set(`${secsText(t)} / ${CA.seconds} s · slowed ${1 / SLOW}×`)
      },
      readouts: (p) => {
        const q = caParams(p)
        const { end, flashes } = caRun(q)
        return [
          { label: `Distance after ${CA.seconds} s`, value: metres(end.s) },
          { label: `Speed after ${CA.seconds} s`, value: mpsText(end.v), tone: end.stopped ? 'warn' : 'ok' },
          { label: 'Average speed s / t', value: mpsText(end.s / CA.seconds) },
          { label: 'Gap grows each flash by a τ²', value: `${((flashes[2].ds - flashes[1].ds) * 100).toFixed(1)} cm` },
        ]
      },
    }
  },
}

// --- Velocity vs time: an accelerate–cruise–brake move; slope = acceleration, area = distance. ---

const VT = { seconds: 6, cruise: 1, x0: -16, y0: -6.6, k: 6.5, len: 4, carK: 10, vMax: 1.2, aMax: 2, plot: [3.2, 0.2, 0] as V3, w: 16, h: 7.2, bars: 160 }
const PHASE_COLORS = [POWER, RING, HEAT]
const vtParams = (p: Params) => ({ accel: n(p, 'accel'), speed: n(p, 'speed'), brake: n(p, 'brake') })
type VtQ = ReturnType<typeof vtParams>
const vtKey = (q: VtQ) => `${q.accel}|${q.speed}|${q.brake}`
const vtRun = memoBy(vtKey, (q: VtQ) => driveProfile({ ...q, cruise: VT.cruise }))

export const kinematicsVelocityTime: Lesson = {
  id: 'kinematics-velocity-vs-time-plots',
  title: 'Velocity vs time plots',
  tagline: 'Slope is acceleration, area is distance',
  formula: (p) => {
    const pr = vtRun(vtParams(p))
    const [a, c, b] = pr.areas
    return `distance = area under v–t = ½ v t_a + v t_c + ½ v t_b = ${a.toFixed(2)} + ${c.toFixed(2)} + ${b.toFixed(2)} = ${metres(pr.distance)} · slope Δv/Δt = a`
  },
  legend: [
    { color: POWER, label: 'Accelerate: slope +a, triangle area', shape: 'dot' },
    { color: RING, label: 'Cruise: flat, rectangle area', shape: 'dot' },
    { color: HEAT, label: 'Brake: slope −a, triangle area', shape: 'dot' },
    { color: B_FIELD, label: `Speed v (top 0…${VT.vMax} m/s)`, shape: 'dot' },
    { color: FORCE, label: `Acceleration a (bottom ±${VT.aMax} m/s²)`, shape: 'dot' },
  ],
  points: [
    'A velocity–time plot carries the whole motion. Its slope at any instant is the acceleration: steep line, hard acceleration; flat line, steady speed; downhill, braking. The pink trace below is that slope plotted on its own.',
    'The area under the line is the distance travelled, because each thin strip is v × Δt. The shaded strips grow as the car rolls; add the two triangles and the rectangle and you get exactly the distance on the floor ruler.',
    'This accelerate–cruise–brake shape is the trapezoid profile robots use for every planned move: gentle enough for the wheels to grip, fast in the middle. Control › Position control › Trapezoid profile closes a loop around it and Kinematics › Trajectories › Time scaling does the same for arm joints.',
    `Try a harder brake: the right triangle gets thinner, so the car stops sooner and in less distance. Here the cruise always lasts ${VT.cruise} s; a planner moving a fixed distance shortens the cruise instead, or drops it for a triangle when the move is short.`,
  ],
  controls: [
    { kind: 'slider', key: 'accel', label: 'Acceleration', min: 0.4, max: 1.5, step: 0.1, initial: 0.4, format: (v) => accelText(v) },
    { kind: 'slider', key: 'speed', label: 'Cruise speed', min: 0.3, max: 1, step: 0.05, initial: 0.9, format: (v) => mpsText(v) },
    { kind: 'slider', key: 'brake', label: 'Braking', min: 0.4, max: 2, step: 0.1, initial: 0.6, format: (v) => accelText(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(VT.seconds, SLOW, 1)
    track(scene, VT.x0, VT.y0, VT.len, VT.k)
    const car = sideCar(scene, [VT.x0, VT.y0, 0], VT.carK)
    const odo = liveLabel(scene, [0, VT.y0 - 1.6, 1.6], { size: 0.3 })
    const plot = plotPanel(scene, VT.plot, VT.w, VT.h, VT.seconds, `speed 0…${VT.vMax} m/s`, `accel ±${VT.aMax} m/s²`, 0.25)
    const zeroY = -VT.h / 4
    const yV = (v: number) => zeroY + (Math.min(1.05, v / VT.vMax) * VT.h * 3) / 4 * 0.95
    const aZero = (-3 * VT.h) / 8
    const yA = (a: number) => aZero + (a / VT.aMax) * (VT.h / 8) * 0.9
    plot.level(GREY).set(aZero)
    const bars = rodPool(plot.group, VT.bars, { opacity: 0.45 })
    const vTr = plot.trace(B_FIELD, { samples: 200, radius: 0.07 })
    const aTr = plot.trace(FORCE, { samples: 200, radius: 0.05 })
    const slope = rodPool(plot.group, 2)
    const slopeTag = liveLabel(plot.group, [0, 0, 0.4], { size: 0.28 })
    const rowsAt = (i: number): V3 => [-17, 2.4 - i * 1.5, 0.3]
    addLabel(scene, 'phase · slope · area', [-17, 3.4, 0.3], LABEL, 0.32, 'left')
    const rows = [0, 1, 2].map((i) => [liveLabel(scene, rowsAt(i), { size: 0.3, align: 'left' }), liveLabel(scene, [-17, rowsAt(i)[1] - 0.6, 0.3], { size: 0.26, align: 'left' })])
    const total = liveLabel(scene, [-17, rowsAt(3)[1], 0.3], { size: 0.32, align: 'left' })
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = vtParams(p)
        const pr = vtRun(q)
        const t = clock(dtF, vtKey(q))
        const now = profileAt(pr, t)
        car.group.position.x = VT.x0 + now.s * VT.k
        car.set(now.s, 0)
        odo.group.position.x = car.group.position.x
        odo.set(metres(now.s), LABEL)
        const w = VT.w / VT.bars
        for (let i = 0; i < VT.bars; i++) {
          const tm = ((i + 0.5) / VT.bars) * VT.seconds
          const st = profileAt(pr, tm)
          if (tm > t || st.phase < 0) {
            bars.set(i, [0, 0, 0], [0, 0, 0], 0, GREY)
            continue
          }
          const x = plot.xAt(tm / VT.seconds)
          bars.set(i, [x, zeroY, 0.15], [x, yV(st.v), 0.15], w * 0.45, PHASE_COLORS[st.phase])
        }
        bars.commit()
        const samples = 200
        const k = Math.max(2, Math.round((t / VT.seconds) * (samples - 1)) + 1)
        const us = Array.from({ length: k }, (_, i) => i / (samples - 1))
        const st = us.map((u) => profileAt(pr, u * VT.seconds))
        vTr.points(us, st.map((f) => yV(f.v)))
        aTr.points(us, st.map((f) => yA(f.a)))
        const ph = now.phase >= 0 ? pr.phases[now.phase] : null
        const ramp = ph && ph.a !== 0 && t - ph.t0 > 0.3
        if (ramp) {
          const t0 = Math.max(ph.t0, t - 1)
          const v0 = profileAt(pr, t0).v
          const xa = plot.xAt(t0 / VT.seconds)
          const xb = plot.xAt(t / VT.seconds)
          const c = PHASE_COLORS[now.phase]
          slope.set(0, [xa, yV(v0), 0.4], [xb, yV(v0), 0.4], 0.04, c)
          slope.set(1, [xb, yV(v0), 0.4], [xb, yV(now.v), 0.4], 0.04, c)
          slopeTag.group.position.set(xb + 0.3, (yV(v0) + yV(now.v)) / 2, 0.4)
          slopeTag.set(`Δv/Δt = ${accelText(ph.a)}`, c)
        } else slope.hideFrom(0)
        slope.commit()
        slopeTag.group.visible = !!ramp
        pr.phases.forEach((f, i) => {
          const dur = f.t1 - f.t0
          const done = t >= f.t1
          const area = done ? pr.areas[i] : t > f.t0 ? profileAt(pr, t).s - f.s0 : 0
          rows[i][0].set(`${f.name} ${secsText(dur)} · slope ${accelText(f.a)}`, PHASE_COLORS[i])
          rows[i][1].set(`area ${i === 1 ? 'v·t' : '½·v·t'} = ${metres(area)}${done ? '' : ' …'}`, done ? LABEL : GREY)
        })
        total.set(`total ${metres(now.s)} of ${metres(pr.distance)} in ${secsText(pr.T)}`, B_FIELD)
        head.status.set(`Velocity vs time · cruise ${mpsText(q.speed)}`, LABEL)
        head.event.set(ph ? `${ph.name}: v ${mpsText(now.v)} · a ${accelText(now.a)}` : `stopped after ${metres(pr.distance)}`, ph ? PHASE_COLORS[now.phase] : GREY)
        head.sub.set(`${secsText(t)} / ${VT.seconds} s · slowed ${1 / SLOW}× · shaded strips = v × Δt`)
      },
      readouts: (p) => {
        const pr = vtRun(vtParams(p))
        return [
          { label: 'Accelerate time v / a', value: secsText(pr.phases[0].t1) },
          { label: 'Brake time v / a', value: secsText(pr.phases[2].t1 - pr.phases[2].t0) },
          { label: 'Distance = area', value: metres(pr.distance) },
          { label: 'Move time', value: secsText(pr.T), tone: pr.T > VT.seconds ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Projectile motion: a chip-kicker robot lofts a ball; vx stays, vy falls by g each second; air drag optional. ---

const PM = { seconds: 1.4, x0: -15, y0: -6.6, k: 5.2, len: 5, vMax: 7, plot: [6, 2.9, 0] as V3, w: 9, h: 4.5, carK: 10, ballR: 0.3, strobe: 0.1, slow: 0.4 }
const BALL_NAMES = Object.fromEntries(Object.entries(BALLS).map(([k, v]) => [k, v.name])) as Record<keyof typeof BALLS, string>
const pmParams = (p: Params) => ({ u: n(p, 'speed'), deg: n(p, 'angle'), ball: pick(BALL_NAMES, p.ball, 'vacuum') })
type PmQ = ReturnType<typeof pmParams>
const pmKey = (q: PmQ) => `${q.u}|${q.deg}|${q.ball}`
const pmRun = memoBy(pmKey, (q: PmQ) => {
  const th = q.deg * DEG
  return { ideal: projectileIdeal(q.u, th), vac: flightRun(q.u, th, 0), real: flightRun(q.u, th, BALLS[q.ball].k) }
})

export const kinematicsProjectileMotion: Lesson = {
  id: 'kinematics-projectile-motion',
  title: 'Projectile motion',
  tagline: 'Steady sideways, falling down',
  formula: (p) => {
    const q = pmParams(p)
    const { ideal, real } = pmRun(q)
    const drag = q.ball === 'vacuum' ? '' : ` · with air: ${metres(real.range)} (${((real.range / ideal.range - 1) * 100).toFixed(0)} %)`
    return `R = u² sin 2θ / g = ${q.u}² × sin ${2 * q.deg}° / ${G} = ${metres(ideal.range)} · H = u² sin²θ / 2g = ${metres(ideal.peak)} · T = 2u sin θ / g = ${secsText(ideal.T)}${drag}`
  },
  legend: [
    { color: B_FIELD, label: 'Horizontal speed vx (constant without air)', shape: 'arrow-right' },
    { color: POWER, label: 'Vertical speed vy (drops by g each second)', shape: 'dot' },
    { color: RING, label: `Ball every ${PM.strobe} s`, shape: 'dot' },
    { color: GREY, label: 'No-air path (for comparison)', shape: 'dot' },
  ],
  points: [
    'Once the ball leaves the kicker only gravity (and air) acts on it. Split the launch velocity into vx = u cos θ and vy = u sin θ and treat each on its own: sideways nothing pushes, so vx stays constant; vertically it is the constant-acceleration case with a = −g.',
    'So the strobe dots are evenly spaced left to right but bunch up near the top, where vy passes through zero. Time up equals time down, the path is a parabola, and the range is R = u² sin 2θ / g: 45° goes furthest, and 30° lands where 60° does.',
    'Double the speed and the range goes up four times (u²). That is why a soccer robot’s kicker is rated by launch speed, and why small timing errors in a fast throw miss by a lot.',
    'Switch on air: drag k v² pulls against the motion, strongest when fast. The ball climbs less, falls more steeply and lands short of the grey vacuum path; a light ping-pong ball loses most and its best angle drops below 45°. Robot drawn larger than scale.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Launch speed u', min: 2, max: 7, step: 0.5, initial: 6, format: (v) => mpsText(v) },
    { kind: 'slider', key: 'angle', label: 'Launch angle θ', min: 15, max: 70, step: 5, initial: 50, format: (v) => `${v}°` },
    { kind: 'choice', key: 'ball', options: opts(BALL_NAMES), initial: 'vacuum' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(PM.seconds, PM.slow, 0.8)
    track(scene, PM.x0, PM.y0, PM.len, PM.k)
    const robot = sideCar(scene, [PM.x0 - 1.6, PM.y0, 0], PM.carK)
    robot.set(0, 0)
    const kicker = add(scene, new THREE.Group(), [PM.x0 - 0.4, PM.y0 + 0.05, 0])
    box(kicker, [1.4, 0.12, 1.2], mat('#c9ced8', { metal: 0.5, rough: 0.35 }), [0.7, 0, 0])
    cylinder(scene, 0.12, 1.3, mat('#5a5f6a'), [PM.x0 - 0.4, PM.y0 + 0.1, 0], 'z', 12)
    const ball = add(scene, mesh(new THREE.SphereGeometry(PM.ballR, 20, 14), mat('#d8e84a', { rough: 0.6 })))
    ball.castShadow = true
    const pen = dotPen(scene, 900, 0.07)
    const vx = forceArrow(scene, B_FIELD, { r: 0.08, size: 0.28 })
    const vy = forceArrow(scene, POWER, { r: 0.08, size: 0.28 })
    const peakTag = liveLabel(scene, [0, 0, 0.6], { size: 0.3, color: RING })
    const landTag = liveLabel(scene, [0, PM.y0 - 1.5, 1.6], { size: 0.3, color: RING })
    const peakLine = rodPool(scene, 1)
    const ghost = mesh(new THREE.SphereGeometry(PM.ballR * 0.9, 12, 8), glowMat(GREY, 0.5))
    scene.add(ghost)
    const plot = plotPanel(scene, PM.plot, PM.w, PM.h, PM.seconds, `vx, vy ±${PM.vMax} m/s`, 'vy slope = −g', 0.5, 7)
    const vxTr = plot.trace(B_FIELD, { samples: 140, radius: 0.05 })
    const vyTr = plot.trace(POWER, { samples: 140, radius: 0.05 })
    const yV = (v: number) => (v / PM.vMax) * (PM.h / 2) * 0.95
    const P = (x: number, y: number, z = 0.4): V3 => [PM.x0 + x * PM.k, PM.y0 + PM.ballR + y * PM.k, z]
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = pmParams(p)
        const r = pmRun(q)
        const t = clock(dtF, pmKey(q))
        kicker.rotation.z = t < 0.02 ? q.deg * DEG : 0.15
        const f = flightAt(r.real.run, t)
        ball.position.set(...P(f.x, f.y, 0))
        const drag = q.ball !== 'vacuum'
        const g = flightAt(r.vac.run, t)
        ghost.visible = drag
        ghost.position.set(...P(g.x, g.y, -0.2))
        pen.begin()
        if (drag) for (const fr of r.vac.run.filter((_, i) => i % 6 === 0)) pen.dot(P(fr.x, fr.y, -0.3), GREY, 0.7)
        for (const fr of r.real.run) {
          if (fr.t > t) break
          const i = Math.round(fr.t / 0.005)
          if (i % 3 === 0) pen.dot(P(fr.x, fr.y), LABEL, 0.8)
          if (i % Math.round(PM.strobe / 0.005) === 0) pen.dot(P(fr.x, fr.y, 0.5), RING, 3)
        }
        pen.end()
        const samples = 140
        const tEnd = Math.min(t, r.real.T)
        const k = Math.max(2, Math.round((tEnd / PM.seconds) * (samples - 1)) + 1)
        const us = Array.from({ length: k }, (_, i) => i / (samples - 1))
        const fs = us.map((u) => flightAt(r.real.run, Math.min(u * PM.seconds, tEnd)))
        vxTr.points(us, fs.map((h) => yV(h.vx)))
        vyTr.points(us, fs.map((h) => yV(h.vy)))
        const K = 0.55
        const o = P(f.x, f.y, 1)
        const flying = t < r.real.T
        vx(o, flying ? [o[0] + f.vx * K, o[1], 1] : o, `vx ${mpsText(f.vx)}`, [0.9, 0, 0])
        vy(o, flying ? [o[0], o[1] + f.vy * K, 1] : o, `vy ${mpsText(f.vy)}`, [0, f.vy >= 0 ? 0.1 : -0.1, 0])
        const pk = r.real.peak
        const showPeak = t >= pk.t
        peakLine.set(0, P(pk.x, 0, 0.2), showPeak ? P(pk.x, pk.y, 0.2) : P(pk.x, 0, 0.2), 0.03, RING)
        peakLine.commit()
        peakTag.group.visible = showPeak
        peakTag.group.position.set(...P(pk.x, pk.y + 0.25, 0.6))
        peakTag.set(`peak ${metres(pk.y)}`)
        landTag.group.visible = !flying
        landTag.group.position.x = P(r.real.range, 0)[0]
        landTag.set(`range ${metres(r.real.range)}`)
        head.status.set(`Projectile · u ${mpsText(q.u)} at ${q.deg}° · ${BALL_NAMES[q.ball]}`, LABEL)
        head.event.set(flying ? `x ${metres(f.x)} · y ${metres(f.y)} · vy ${f.vy >= 0 ? 'rising' : 'falling'}` : `landed ${metres(r.real.range)} away after ${secsText(r.real.T)}`, flying ? POWER : RING)
        head.sub.set(`${secsText(t)} / ${PM.seconds} s · slowed ${(1 / PM.slow).toFixed(1)}× · ruler 1 m ticks`)
      },
      readouts: (p) => {
        const q = pmParams(p)
        const { ideal, real } = pmRun(q)
        const drag = q.ball !== 'vacuum'
        return [
          { label: 'Range', value: metres(real.range), tone: real.range > PM.len ? 'warn' : 'ok' },
          { label: 'Peak height', value: metres(real.peak.y) },
          { label: 'Flight time', value: secsText(real.T) },
          drag ? { label: 'Range lost to drag', value: metres(ideal.range - real.range), tone: 'warn' } : { label: 'Landing speed', value: mpsText(real.landSpeed) },
        ]
      },
    }
  },
}
