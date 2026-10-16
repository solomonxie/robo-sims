import * as THREE from 'three/webgpu'
import {
  AttitudeFrame,
  DEG,
  MIX,
  QUAD,
  QUAD_MOTORS,
  attitudeLoop,
  fixedStepAt,
  hoverThrottle,
  mix,
  propRpm,
  quadWrench,
  rollWobble,
  levelTime,
  speedShare,
  thrustOf,
  thrustToWeight,
  toDeg,
  weightN,
} from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SPIN_COLORS,
  addLabel,
  flatBox,
  glowMat,
  liveLabel,
  memoBy,
  moduleBlock,
  quadcopter,
  scope,
  spinArc,
  stretchArrow,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const deg = (a: number, digits = 0) => `${toDeg(a).toFixed(digits)}°`
const kRpm = (share: number) => `${(propRpm(share) / 1000).toFixed(1)}k`
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '0')
const sInt = (v: number) => `${Math.round(v) < 0 ? '−' : ''}${Math.abs(Math.round(v))}`
const sPct = (v: number) => `${sgn(Math.round(v * 100)).replace('0', '')}${Math.abs(Math.round(v * 100))} %`
const VIEW = { center: [-2.2, -0.4, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 }
/** Visual prop speed at full throttle (rad/s), real is QUAD.wMax. */
const PROP_VIS = 26
const SHORT = ['M1 RR', 'M2 FR', 'M3 RL', 'M4 FL']

function header(scene: THREE.Object3D) {
  return {
    status: liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' }),
    sub: liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' }),
    event: liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' }),
  }
}

/** Metres group (z up), viewed `tilt` rad from the side; the quad's nose points into the screen. */
function rig(parent: THREE.Object3D, origin: V3, k: number, tilt: number) {
  const g = add(parent, new THREE.Group(), origin)
  g.scale.setScalar(k)
  g.rotation.x = -Math.PI / 2 + tilt
  const holder = add(g, new THREE.Group())
  holder.rotation.z = Math.PI / 2
  return { g, holder }
}

function spinProps(angles: number[], shares: readonly number[], dt: number) {
  shares.forEach((s, i) => (angles[i] += dt * PROP_VIS * speedShare(s)))
}

// --- Quadcopter mixing: throttle/roll/pitch/yaw → four motors; thrust ∝ ω², yaw from prop drag torque, hover = weight. ---

const QM = { quad: [-8.6, -3.4, 0] as V3, k: 40, tilt: 0.85, cols: [4.2, 5.5, 6.8, 8.1], share: 10.4, rpm: 13.2, rows: [2.5, 1.4, 0.3, -0.8], bar: { x: 0, y: -3.6, w: 13 } }
const qmParams = (p: Params) => ({ throttle: n(p, 'throttle') / 100, roll: n(p, 'roll') / 100, pitch: n(p, 'pitch') / 100, yaw: n(p, 'yaw') / 100 })
const D_ARM = QUAD.arm / Math.SQRT2
const TAU_TOP = 4 * 0.3 * QUAD.tMax * D_ARM
const mixRow = (i: number) => {
  const [, r, p, y] = MIX[i]
  return `T ${sgn(r)} R ${sgn(p)} P ${sgn(y)} Y`
}

export const quadcopterMixing: Lesson = {
  id: 'drones-flight-quadcopter-mixing',
  title: 'Quadcopter mixing',
  tagline: 'Four motors, four commands: throttle, roll, pitch and yaw',
  formula: () => `${SHORT.map((s, i) => `${s.slice(0, 2)} = ${mixRow(i)}`).join(' · ')} · T = Tmax·(ω/ωmax)² · hover: 4·T = m·g → throttle ${pct(hoverThrottle(QUAD.mass))} of thrust, ${pct(speedShare(hoverThrottle(QUAD.mass)))} of rpm`,
  legend: [
    { color: POWER, label: 'Thrust per motor (red: clipped at 0 or 100 %)', shape: 'dot' },
    { color: SPIN_COLORS.cw, label: 'Clockwise props (M1, M4)', shape: 'dot' },
    { color: SPIN_COLORS.ccw, label: 'Counter-clockwise props (M2, M3)', shape: 'dot' },
    { color: FORCE, label: 'Net torque: roll, pitch, yaw', shape: 'dot' },
  ],
  points: [
    'A quad has no control surfaces, only four fixed-pitch props. The flight controller turns four demands (throttle, roll, pitch, yaw) into four motor commands with a mixer matrix: every motor gets the throttle, plus or minus each axis depending on where it sits and which way it spins. Each column sums to zero, so an axis command tilts or turns without changing total thrust.',
    'Roll: speed up the left pair and slow the right, the left side rises and it banks right. Pitch: front pair up, nose up. The torque is thrust difference times the lever arm, here 88 mm per axis on a 250 mm frame, against a tiny inertia: a few percent of split already means thousands of °/s².',
    'Yaw has no lever: it comes from drag torque. A spinning prop pushes the frame the other way, so the diagonal pairs spin opposite (M1/M4 clockwise, M2/M3 counter-clockwise) and cancel. Speed up the counter-clockwise pair and slow the clockwise pair: thrust stays the same, but their drag torques no longer cancel and it turns clockwise. Yaw is the weakest axis, kM is only ~16 mm.',
    'Thrust grows with prop speed squared: T = Tmax·(ω/ωmax)². This 600 g quad has 4 × 7 N, a thrust-to-weight ratio near 4.8:1, so it hovers at 21 % of thrust but 46 % of rpm. That spare thrust is the control authority; a motor clipped at 0 or 100 % cannot follow the mixer, and the part it drops leaks into the other axes (full throttle plus pitch and yaw: roll appears). The ESC turns each command into motor speed (see ESC basics).',
  ],
  controls: [
    { kind: 'slider', key: 'throttle', label: 'Throttle T', min: 0, max: 100, step: 1, initial: 25, format: (v) => `${v} %` },
    { kind: 'slider', key: 'roll', label: 'Roll R', min: -30, max: 30, step: 1, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    { kind: 'slider', key: 'pitch', label: 'Pitch P', min: -30, max: 30, step: 1, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    { kind: 'slider', key: 'yaw', label: 'Yaw Y', min: -30, max: 30, step: 1, initial: 10, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = header(scene)
    const { g, holder } = rig(scene, QM.quad, QM.k, QM.tilt)
    const quad = quadcopter(holder, { arrowLen: 0.15, arrowR: 0.0026 })
    const stand = glowMat('#3a3f48', 0.05)
    flatBox(g, [0.08, 0.08, 0.005], stand, [0, 0, -0.16])
    flatBox(g, [0.006, 0.006, 0.16], stand, [0, 0, -0.08])
    const hover = hoverThrottle(QUAD.mass)
    const tickM = glowMat(GREY, 0.6)
    QUAD_MOTORS.forEach((_, i) => {
      const [x, y] = quad.motorAt(i)
      flatBox(quad.body, [0.03, 0.003, 0.003], tickM, [x, y, 0.034 + 0.15 * hover])
    })
    const arcs = ([[0.17, 0, 0.02, 'x'], [0, 0.17, 0.02, 'y'], [0, 0, 0.1, 'z']] as const).map(([x, y, z, axis]) =>
      [false, true].map((cw) => {
        const a = add(quad.body, new THREE.Group(), [x, y, z])
        if (axis === 'x') a.rotation.y = Math.PI / 2
        if (axis === 'y') a.rotation.x = -Math.PI / 2
        spinArc(a, axis === 'z' ? 0.05 : 0.04, FORCE, { cw, thick: 0.003 })
        return a
      }),
    )
    g.updateMatrixWorld(true)
    QUAD_MOTORS.forEach((m, i) => {
      const w = quad.body.localToWorld(new THREE.Vector3(...quad.motorAt(i)).multiplyScalar(1.35))
      addLabel(scene, `${i + 1}`, [w.x, w.y - 0.6, w.z + 1], m.spin > 0 ? SPIN_COLORS.cw : SPIN_COLORS.ccw, 0.5)
    })

    addLabel(scene, 'motor', [QM.bar.x, QM.rows[0] + 1.1, 0.3], LABEL, 0.3, 'left')
    ;['T', 'R', 'P', 'Y'].forEach((h, j) => addLabel(scene, h, [QM.cols[j], QM.rows[0] + 1.1, 0.3], LABEL, 0.3))
    addLabel(scene, 'thrust', [QM.share, QM.rows[0] + 1.1, 0.3], LABEL, 0.3)
    addLabel(scene, 'rpm', [QM.rpm, QM.rows[0] + 1.1, 0.3], LABEL, 0.3, 'right')
    const cells = QUAD_MOTORS.map((m, i) => {
      const y = QM.rows[i]
      addLabel(scene, SHORT[i], [QM.bar.x, y, 0.3], m.spin > 0 ? SPIN_COLORS.cw : SPIN_COLORS.ccw, 0.32, 'left')
      MIX[i].forEach((v, j) => addLabel(scene, j === 0 ? '1' : sgn(v), [QM.cols[j], y, 0.3], v > 0 ? POWER : HIGH_V, 0.36))
      return [liveLabel(scene, [QM.share, y, 0.3], { size: 0.32 }), liveLabel(scene, [QM.rpm, y, 0.3], { size: 0.32, align: 'right' })]
    })
    const { x: bx, y: by, w: bw } = QM.bar
    const max = 4 * QUAD.tMax
    flatBox(scene, [bw + 0.3, 0.9, 0.2], glowMat('#1c1e24', 0.1), [bx + bw / 2, by, -0.15])
    const fillM = glowMat(POWER, 0.8)
    const fill = flatBox(scene, [1, 0.6, 0.25], fillM, [bx, by, 0])
    const wx = bx + (weightN(QUAD.mass) / max) * bw
    flatBox(scene, [0.1, 1.4, 0.4], glowMat(GREY, 0.9), [wx, by, 0])
    addLabel(scene, `weight ${weightN(QUAD.mass).toFixed(1)} N`, [wx, by - 1.1, 0.3], GREY, 0.28)
    addLabel(scene, `${max} N`, [bx + bw, by - 1.1, 0.3], GREY, 0.26, 'right')
    const barText = liveLabel(scene, [bx, by + 1, 0.3], { size: 0.32, align: 'left' })
    const torqueText = [0, 1, 2].map((k) => liveLabel(scene, [bx, by - 2.5 - k * 0.85, 0.3], { size: 0.3, align: 'left' }))

    const spin = [0, 0, 0, 0]
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = qmParams(p)
        const m = mix(q)
        const T = m.out.map((s) => thrustOf(s))
        const w = quadWrench(T)
        spinProps(spin, m.out, dt)
        quad.set(spin, m.out, m.clipped)
        const torques = [w.roll, w.pitch, w.yaw]
        arcs.forEach(([ccw, cw], k) => {
          const v = k === 0 ? torques[0] : -torques[k]
          const s = Math.min(1.3, 0.5 + Math.abs(torques[k]) / (k === 2 ? (TAU_TOP * QUAD.kM) / D_ARM : TAU_TOP))
          ccw.visible = v > 1e-6
          cw.visible = v < -1e-6
          ccw.scale.setScalar(s)
          cw.scale.setScalar(s)
        })
        cells.forEach(([share, rpm], i) => {
          const c = m.clipped[i] ? HIGH_V : LABEL
          share.set(pct(m.out[i]), c)
          rpm.set(kRpm(m.out[i]), c)
        })
        const k = Math.max(0.002, w.thrust / max)
        fill.scale.x = k * bw
        fill.position.x = bx + (k * bw) / 2
        const W = weightN(QUAD.mass)
        const climb = (w.thrust - W) / QUAD.mass
        const tone = Math.abs(climb) < 0.3 ? POWER : climb > 0 ? RING : HEAT
        fillM.color.set(tone)
        fillM.emissive.set(tone)
        barText.set(`total thrust ${w.thrust.toFixed(1)} N · ${Math.abs(climb) < 0.05 ? 'hovers' : `${climb > 0 ? 'climbs' : 'sinks'} ${Math.abs(climb).toFixed(1)} m/s²`}`, tone)
        ;(['roll', 'pitch', 'yaw'] as const).forEach((name, j) => {
          const I = [QUAD.ixx, QUAD.iyy, QUAD.izz][j]
          const dirs = [['banks right', 'banks left'], ['nose up', 'nose down'], ['turns clockwise', 'turns anticlockwise']][j]
          const tq = torques[j]
          torqueText[j].set(Math.abs(tq) < 1e-6 ? `${name}: no torque` : `${name} ${(tq * 1000).toFixed(0)} mN·m → ${Math.round(Math.abs(toDeg(tq / I)))} °/s², ${dirs[tq > 0 ? 0 : 1]}`, Math.abs(tq) < 1e-6 ? GREY : FORCE)
        })

        status.set(`T ${pct(q.throttle)} · R ${sPct(q.roll)} · P ${sPct(q.pitch)} · Y ${sPct(q.yaw)} → motors ${m.out.map((s) => pct(s)).join(' ')}`, LABEL)
        if (m.clipped.some(Boolean)) event.set(`${m.clipped.filter(Boolean).length} motor${m.clipped.filter(Boolean).length > 1 ? 's' : ''} clipped: the mixer asked for more than 0…100 %`, HIGH_V)
        else if (Math.abs(q.yaw) > 0 && !q.roll && !q.pitch) event.set(`yaw: ${q.yaw > 0 ? 'counter-clockwise' : 'clockwise'} pair faster, thrust unchanged, drag torque turns it`, B_FIELD)
        else if (Math.abs(climb) < 0.3 && !q.roll && !q.pitch && !q.yaw) event.set('hover: thrust equals weight, no torque', POWER)
        else event.set(`thrust ∝ ω²: ${pct(m.out[1])} thrust needs ${pct(speedShare(m.out[1]))} of full rpm (M2)`, LABEL)
        sub.set(`held level on a test stand · props slowed ~${Math.round(QUAD.wMax / PROP_VIS)}× · grey ticks: hover thrust`)
      },
      readouts: (p) => {
        const q = qmParams(p)
        const m = mix(q)
        const w = quadWrench(m.out.map((s) => thrustOf(s)))
        return [
          { label: 'Total thrust · weight', value: `${w.thrust.toFixed(1)} · ${weightN(QUAD.mass).toFixed(1)} N`, tone: w.thrust >= weightN(QUAD.mass) ? 'ok' : 'warn' },
          { label: 'Hover throttle · rpm', value: `${pct(hoverThrottle(QUAD.mass))} · ${kRpm(hoverThrottle(QUAD.mass))}` },
          { label: 'Thrust-to-weight', value: `${thrustToWeight(QUAD.mass).toFixed(1)} : 1` },
          { label: 'Clipped motors', value: `${m.clipped.filter(Boolean).length} of 4`, tone: m.clipped.some(Boolean) ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Attitude control: angle P → rate PID (gyro) → mixer; a gust, too-high P, motor saturation, angle vs acro. ---

const MODES = { angle: 'Angle (self-level)', air: 'Angle + airmode', acro: 'Acro (rate only)' }
const AC = { quad: [-9.5, -2, 0] as V3, k: 40, tilt: 0.28, seconds: 4, gust: { at: 1, dur: 0.18, torque: 0.5 }, slow: 0.2, sy: [-0.9, -7.2], sh: 4.2, by: 3.5, rollMax: 30, rateMax: 400 }
const SCOPE = { x: 6.4, w: 10.5 }
const acMode = (p: Params) => pick(MODES, p.mode, 'angle')
const acParams = (p: Params) => ({ mode: (acMode(p) === 'acro' ? 'acro' : 'angle') as 'angle' | 'acro', airmode: acMode(p) === 'air', angleP: n(p, 'angleP'), kp: n(p, 'rateP') / 100, mass: QUAD.mass + n(p, 'payload') / 1000 })
type AcQ = ReturnType<typeof acParams>
const acKey = (q: AcQ) => `${q.mode}|${q.airmode}|${q.angleP}|${q.kp}|${q.mass}`
const acRun = memoBy(acKey, (q: AcQ) => attitudeLoop({ mode: q.mode, angleP: q.angleP, rate: { kp: q.kp, ki: 0, kd: 0 }, seconds: AC.seconds, gust: AC.gust, mass: q.mass, rateMax: AC.rateMax, airmode: q.airmode }))
const at = (run: AttitudeFrame[], t: number) => fixedStepAt(run, t, QUAD.dt)
const isClipped = (s: number) => s >= 0.999 || s <= 0.001
function acOutcome(q: AcQ, run: AttitudeFrame[]): { value: string; tone: 'ok' | 'warn' | 'bad' } {
  if (rollWobble(run) > 1 * DEG) return { value: `oscillates ±${(toDeg(rollWobble(run)) / 2).toFixed(1)}°`, tone: 'bad' }
  const end = run[run.length - 1]
  if (q.mode === 'acro') return { value: `holds ${deg(end.roll, 1)}, drifting`, tone: 'warn' }
  const s = levelTime(run, AC.gust.at)
  return s === null ? { value: 'still off level', tone: 'warn' } : { value: `level in ${s.toFixed(2)} s`, tone: 'ok' }
}
function plotLabels(scene: THREE.Object3D, y: number, h: number, seconds: number | null, left: string, right?: string) {
  addLabel(scene, left, [SCOPE.x - SCOPE.w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
  if (right) addLabel(scene, right, [SCOPE.x + SCOPE.w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'right')
  if (seconds === null) return
  addLabel(scene, '0', [SCOPE.x - SCOPE.w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
  addLabel(scene, `${seconds} s`, [SCOPE.x + SCOPE.w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'right')
}
function plotRun(tr: ReturnType<ReturnType<typeof scope>['trace']>, run: AttitudeFrame[], now: number, value: (f: AttitudeFrame) => number, samples = 240) {
  const k = Math.max(2, Math.round((Math.min(now, AC.seconds) / AC.seconds) * (samples - 1)) + 1)
  const us: number[] = []
  const ys: number[] = []
  for (let i = 0; i < k; i++) {
    const u = i / (samples - 1)
    us.push(u)
    ys.push(value(at(run, u * AC.seconds)))
  }
  tr.points(us, ys)
}

export const attitudeControl: Lesson = {
  id: 'drones-flight-attitude-control',
  title: 'Attitude control',
  tagline: 'Angle loop → rate loop → mixer, hundreds of times a second',
  formula: (p) => {
    const q = acParams(p)
    const outer = q.mode === 'angle' ? `ω_set = ${q.angleP}/s·(0° − θ)` : 'ω_set = stick × 600 °/s (no angle loop)'
    return `${outer} · R = ${(q.kp * 100).toFixed(2)} %/(°/s)·(ω_set − ω_gyro) · motors = hover ${pct(hoverThrottle(q.mass))}${q.airmode ? ' + shift' : ''} ± R · thrust-to-weight ${thrustToWeight(q.mass).toFixed(1)}:1`
  },
  legend: [
    { color: B_FIELD, label: 'Set points: level, rate ω_set', shape: 'dot' },
    { color: RING, label: 'Measured: roll θ, gyro rate ω', shape: 'dot' },
    { color: POWER, label: 'Motor thrust (red: clipped)', shape: 'dot' },
    { color: HEAT, label: 'Gust at 1 s', shape: 'dot' },
  ],
  points: [
    'A flight controller runs two loops per axis. The inner rate loop reads the gyro (see IMU) and drives the mixer\'s roll/pitch/yaw demand until the body turns at the asked rate; it runs fast (here 500 Hz, real ones 2–8 kHz) because the airframe has almost no inertia. The outer angle loop compares the fused tilt with level and asks for a rate back toward it.',
    'A gust rolls the quad right. The gyro sees the rotation at once and the rate loop splits thrust left/right to stop it; then the angle loop asks for a rate back to level and the drone rights itself. While tilted, part of its thrust points sideways, so it slides a little before it is level again.',
    'Too much P oscillates: the motors need ~30 ms to change speed and the gyro is filtered, so a big correction arrives late and overshoots. Raise rate P past ~0.4 %/(°/s), or the angle P past ~20/s, and the roll rings or keeps buzzing (real tuning adds D to damp it and I for steady wind).',
    'Authority is the spare thrust. A heavy payload pushes hover throttle toward 100 %: the motors that should speed up are already flat out, the mixer is clipped (red) and the gust wins for longer, and the drone sags. Clipping at 0 % hurts too: a light quad near idle cannot slow a motor below zero, so it loses torque and gains thrust. Airmode shifts all four up instead of clipping: full torque and a smaller tilt, but even more extra thrust, so it climbs (no altitude hold here). Acro (rate) mode drops the angle loop: centred sticks hold zero rotation, not level, so after the gust it keeps the tilt and flies off sideways. Racers fly acro; angle mode suits beginners and camera work.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'angle' },
    { kind: 'slider', key: 'angleP', label: 'Angle P', min: 2, max: 30, step: 1, initial: 8, format: (v) => `${v} /s` },
    { kind: 'slider', key: 'rateP', label: 'Rate P', min: 0.05, max: 0.6, step: 0.05, initial: 0.2, format: (v) => `${v.toFixed(2)} %/(°/s)` },
    { kind: 'slider', key: 'payload', label: 'Payload', min: 0, max: 2000, step: 100, initial: 0, format: (v) => `${v} g` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = header(scene)
    const { g, holder } = rig(scene, AC.quad, AC.k, AC.tilt)
    const quad = quadcopter(holder, { arrowLen: 0.16 })
    const gust = stretchArrow(quad.body, HEAT, 0.006)
    const load = box(quad.body, [1, 1, 1], mat('#7a6548', { rough: 0.7 }), [0, 0, -0.03])
    const floorZ = -0.22
    flatBox(g, [0.4, 0.25, 0.004], glowMat('#20232a', 0.1), [0, 0.12, floorZ])
    const tapeM = glowMat(GREY, 0.25)
    const tape = Array.from({ length: 4 }, () => flatBox(g, [0.004, 0.25, 0.004], tapeM, [0, 0.12, floorZ + 0.003]))

    const blocks = [-1, 0, 1].map((i) => moduleBlock(scene, [SCOPE.x + i * 3.65, AC.by, 0], [3.2, 1.1, 0.4], ''))
    for (const x of [SCOPE.x - 1.82, SCOPE.x + 1.82]) stretchArrow(scene, GREY, 0.05)([x - 0.2, AC.by, 0.3], [x + 0.25, AC.by, 0.3])
    const plots = AC.sy.map((y) => {
      const s = scope(scene, SCOPE.w, AC.sh, { divs: [8, 4] })
      s.group.position.set(SCOPE.x, y, 0)
      return s
    })
    const angSet = plots[0].trace(B_FIELD, { samples: 240, radius: 0.08 })
    const angTr = plots[0].trace(RING, { samples: 240 })
    const rateSet = plots[1].trace(B_FIELD, { samples: 240, radius: 0.08 })
    const rateTr = plots[1].trace(RING, { samples: 240 })
    plotLabels(scene, AC.sy[0], AC.sh, null, `roll θ ±${AC.rollMax}°`)
    plotLabels(scene, AC.sy[1], AC.sh, AC.seconds, `roll rate ±${AC.rateMax} °/s`)
    const yAng = (a: number) => (toDeg(a) / AC.rollMax) * (AC.sh / 2)
    const yRate = (r: number) => (toDeg(r) / AC.rateMax) * (AC.sh / 2)

    const spin = [0, 0, 0, 0]
    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = acParams(p)
        const run = acRun(q)
        if (acKey(q) !== st.key) {
          st.key = acKey(q)
          st.t = 0
        }
        st.t += dt * AC.slow
        if (st.t > AC.seconds + 0.4) st.t = 0
        const t = Math.min(st.t, AC.seconds)
        const f = at(run, t)
        quad.pose(f.roll, 0)
        const side = 0.05 * Math.cbrt((q.mass - QUAD.mass) / 2)
        load.visible = side > 0
        load.scale.set(side * 1.4, side, side)
        load.position.z = -0.006 - side / 2
        quad.group.position.z = Math.max(-0.2, Math.min(0.2, f.z))
        const clipped = f.cmds.map((c) => f.clipped && isClipped(c))
        spinProps(spin, f.motors, dt)
        quad.set(spin, f.motors, clipped)
        const showGust = t >= AC.gust.at && t < AC.gust.at + 0.3
        gust(showGust ? [0, -0.135, 0.2] : [0, -0.135, 0.07], [0, -0.135, 0.07])
        tape.forEach((b, i) => (b.position.x = ((((i * 0.1 - f.y) % 0.4) + 0.4) % 0.4) - 0.2))

        plotRun(angSet, run, t, (r) => yAng(r.angleSet))
        plotRun(angTr, run, t, (r) => yAng(r.roll))
        plotRun(rateSet, run, t, (r) => yRate(r.rateSet))
        plotRun(rateTr, run, t, (r) => yRate(r.rate))
        const angleOn = q.mode === 'angle'
        blocks[0](dt, B_FIELD, angleOn ? 1 : 0.15, angleOn ? `${sInt(toDeg(f.rateSet))} °/s` : 'angle off')
        blocks[1](dt, RING, 1, `R ${sPct(f.cmd)}`)
        const lo = Math.min(...f.motors)
        const hi = Math.max(...f.motors)
        blocks[2](dt, f.clipped ? HIGH_V : POWER, 1, `${Math.round(lo * 100)}–${Math.round(hi * 100)} %`)

        const vy = (at(run, t + 0.05).y - f.y) / 0.05
        status.set(`roll ${deg(f.roll, 1)} · gyro ${sInt(toDeg(f.rate))} °/s · set ${sInt(toDeg(f.rateSet))} °/s · motors ${Math.round(lo * 100)}–${Math.round(hi * 100)} %`, LABEL)
        if (f.gust) event.set('gust: a roll torque tips the right side down', HEAT)
        else if (f.clipped) event.set(`mixer clipped at ${Math.max(...f.cmds) >= 0.999 ? '100' : '0'} %: less torque than the loop asks`, HIGH_V)
        else if (f.shift > 0.005) event.set(`airmode: all four shifted up ${pct(f.shift)}, full split kept, extra thrust climbs`, POWER)
        else if (t > AC.gust.at && Math.abs(f.rate) > 15 * DEG) event.set(`rate loop: gyro ${sInt(toDeg(f.rate))} °/s, wants ${sInt(toDeg(f.rateSet))} °/s → thrust split ${pct(Math.abs(f.cmd))}`, RING)
        else if (!angleOn && Math.abs(f.roll) > 2 * DEG) event.set(`acro: rotation stopped, tilt ${deg(f.roll, 1)} kept · sliding ${Math.abs(vy).toFixed(1)} m/s ${vy > 0 ? 'right' : 'left'}`, HEAT)
        else if (Math.abs(f.roll) > 1 * DEG) event.set(`angle loop: ${deg(f.roll, 1)} off level → asks ${sInt(toDeg(f.rateSet))} °/s back`, B_FIELD)
        else event.set(`level · all four near hover ${pct(hoverThrottle(q.mass))}`, POWER)
        sub.set(`${t.toFixed(2)} / ${AC.seconds} s · slowed ${1 / AC.slow}× · seen from behind, camera follows · tape every 100 mm`)
      },
      readouts: (p) => {
        const q = acParams(p)
        const run = acRun(q)
        const after = run.filter((f) => f.t >= AC.gust.at)
        const hover = hoverThrottle(q.mass)
        return [
          { label: 'Outcome', ...acOutcome(q, run) },
          { label: 'Peak roll after the gust', value: deg(Math.max(...after.map((f) => Math.abs(f.roll))), 1) },
          { label: 'Hover throttle · headroom', value: `${pct(hover)} · ${pct(1 - hover)}`, tone: hover < 0.6 ? 'ok' : hover < 0.85 ? 'warn' : 'bad' },
          { label: 'Time clipped after gust', value: `${Math.round((after.filter((f) => f.clipped).length * QUAD.dt) * 1000)} ms`, tone: after.some((f) => f.clipped) ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
