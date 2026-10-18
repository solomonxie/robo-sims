import * as THREE from 'three/webgpu'
import {
  ARM_BUILD,
  ARM_CAL,
  ARM_JOB,
  CAL_SPAN_US,
  CAL_SWEEP,
  CalMethod,
  DEG,
  DESK_SPOTS,
  DESK_Z,
  JobFrame,
  JobInterp,
  MOUNT_CENTRES,
  Mat4,
  SERVO_ARM,
  SpotResult,
  TOOTH_DEG,
  axisOf,
  calPulses,
  calErrors,
  calibrateArm,
  jobRun,
  jointFromPulse,
  mountCheck,
  originOf,
  pcaTicks,
  pulseUs,
  readAt,
  servoTruths,
  spotErrors,
  ticksUs,
  wrapPi,
} from '../../core/physics'
import { fixedText, mmTenths, radText } from '../../core/units'
import { V3, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ARM_LEAD,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  JOINT_COLORS,
  LABEL,
  POWER,
  RING,
  SERVO_ARM_LOOK,
  SERVO_JOINT_NAMES,
  addLabel,
  armDesk,
  dotPen,
  ghostRig,
  glide,
  memoBy,
  plotY,
  serialArm,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-1.2, -0.9, 0] as V3, radius: 58, polar: 1.45, azimuth: 0 }
const DESK_AT: V3 = [-11, -7.6, 0]
const K = 28
const X = 1.6
const KINDS = [...ARM_BUILD.servos, ARM_BUILD.gripper]
const deg = (a: number, digits = 0) => radText(a, digits)
const signedDeg = (a: number, digits = 0) => `${a < 0 ? '−' : '+'}${radText(Math.abs(a), digits)}`
const range = ([lo, hi]: readonly number[]) => `${deg(lo).replace('-', '−')} … ${deg(hi).replace('-', '−')}`

/** Moves every joint toward `goal` (shortest way round). */
const glideJoints = (q: number[], goal: readonly number[], dt: number, k = 6) => q.map((v, i) => v + glide(dt, 0, wrapPi(goal[i] - v), k))
/** Arc of a joint's angle range around its axis, in the plane of its frame. */
function jointArc(pen: ReturnType<typeof dotPen>, f: readonly Mat4[], i: number, r: number, lo: number, hi: number, color: string, s = 1) {
  pen.arc(originOf(f[i]) as V3, r, lo, hi - lo, color, s, axisOf(f[i], 0) as V3, axisOf(f[i], 1) as V3)
}

// --- Assemble: centre each servo before the horn goes on, so its 180° covers the poses the job needs. ---

const CENTRING = { centred: 'Centre each servo at 1500 µs, then fit the horn', loose: 'Fit the horns unpowered' }
const asParams = (p: Params) => ({ centred: pick(CENTRING, p.centre, 'centred') === 'centred', sh: n(p, 'shoulder'), el: n(p, 'elbow') })
type AsQ = ReturnType<typeof asParams>
const asKey = (q: AsQ) => `${q.centred}|${q.sh}|${q.el}`
const asCheck = memoBy(asKey, (q: AsQ) => mountCheck({ centred: q.centred, teeth: [0, q.sh, q.el, 0] }))
const SPOT_S = 2.4
const teethText = (v: number) => (v === 0 ? 'as designed' : `${v > 0 ? '+' : '−'}${Math.abs(v)} tooth${Math.abs(v) > 1 ? 's' : ''} (${v > 0 ? '+' : '−'}${fixedText(Math.abs(v) * TOOTH_DEG, 1)}°)`).replace('tooths', 'teeth')
/** Joints sitting at an end of their usable range in a missed spot's pose. */
const stuckJoints = (s: SpotResult, usable: readonly (readonly number[])[]) => s.q.map((v, i) => i).filter((i) => Math.min(Math.abs(s.q[i] - usable[i][0]), Math.abs(s.q[i] - usable[i][1])) < 1e-6)
function spotText(s: SpotResult, usable: readonly (readonly number[])[]) {
  if (s.why === 'ok') return 'reached'
  if (s.why === 'desk') return 'only with the elbow in the desk'
  if (s.why === 'reach') return 'out of reach'
  const stuck = stuckJoints(s, usable).map((i) => SERVO_JOINT_NAMES[i])
  return `${stuck.join(' + ') || 'a servo'} at its stop, ${mmTenths(s.miss)} short`
}

/** Blocks on the desk at every spot (+ the shelf), recoloured per result. */
function spotBlocks(g: THREE.Object3D) {
  return DESK_SPOTS.map((s) => {
    const m = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.5, emissive: GREY, emissiveIntensity: 0.25 })
    const b = box(g, [0.026, 0.026, 0.03], m, s.at as V3)
    if (s.at[2] > 0) {
      box(g, [0.08, 0.06, 0.006], mat('#7a5a3a', { rough: 0.8 }), [s.at[0], s.at[1], s.at[2] - 0.018])
      box(g, [0.008, 0.008, s.at[2] - 0.021 - DESK_Z], mat('#7a5a3a', { rough: 0.8 }), [s.at[0] - 0.036, s.at[1] + 0.026, (s.at[2] - 0.021 + DESK_Z) / 2])
    }
    return (c: string) => {
      m.color.set(c)
      m.emissive.set(c)
      b.scale.setScalar(1)
    }
  })
}

export const robotArmAssemble: Lesson = {
  id: 'robot-arm-assemble',
  title: 'Assemble',
  tagline: 'A servo turns 180°: which 180° the joint gets is fixed the moment the horn goes on',
  formula: (p) => {
    const R = asCheck(asParams(p))
    return `travel = 500 … 2500 µs ÷ 11.1 µs/° = 180° · horn on a 25-tooth spline = ${TOOTH_DEG}° per tooth · shoulder ${range(R.usable[1])} · elbow ${range(R.usable[2])} (∩ the arm's own limits) · ${R.reached}/${DESK_SPOTS.length} spots`
  },
  legend: [
    { color: POWER, label: 'Spot reached', shape: 'dot' },
    { color: HIGH_V, label: 'Spot missed: a servo runs out of travel', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'Arcs: each joint’s usable travel', shape: 'dot' },
    { color: ARM_LEAD, label: 'Servo leads to the PCA9685', shape: 'dot' },
  ],
  points: [
    'Build order: base box with the MG996R base servo under the turntable, shoulder bracket and MG996R, upper arm, elbow MG996R, forearm, SG90 wrist, SG90 gripper; each lead to PCA9685 channels 0–4, the servos on their own 6 V pack. Why these servos and that supply is Kinematics › Robot arm build › Assemble the arm.',
    'A hobby servo turns only 180° (500…2500 µs), and which 180° of the joint that is gets fixed when the horn is pressed on. So before fitting each horn, drive the servo to 1500 µs from the PCA9685, hold the joint in the middle of the range it needs (base straight ahead, upper arm straight up, elbow and wrist straight), then press the horn on and screw it down.',
    'The output spline has 25 teeth, so the horn only goes on in 14.4° steps and lands up to half a tooth (7.2°) off. That is fine: Calibrate servos trims it in code. Horns fitted unpowered are a different story: each shaft sits wherever the last test left it, tens of degrees from centre, and the spots near the edge of the reach fall outside the travel.',
    'Each tooth shifts a joint’s travel by 14.4°. The shoulder centred upright covers flat forward to flat back; a few teeth back it still reaches the desk but loses the shelf, a few forward it loses everything far away. A trim in code moves the zero, not the range: only taking the horn off fixes it. Drive to every spot the job needs (Kinematics › Workspace) before you tighten the horn screws.',
  ],
  controls: [
    { kind: 'choice', key: 'centre', options: opts(CENTRING), initial: 'centred' },
    { kind: 'slider', key: 'shoulder', label: 'Shoulder horn', min: -6, max: 6, step: 1, initial: 0, format: teethText },
    { kind: 'slider', key: 'elbow', label: 'Elbow horn', min: -6, max: 6, step: 1, initial: 0, format: teethText },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const d = armDesk(scene, DESK_AT, K, KINDS)
    const blocks = spotBlocks(d.lifted)
    const arcs = dotPen(d.lifted, 600, 0.0016)
    addLabel(scene, 'Servo travel as mounted (500 … 2500 µs)', [X, 3.75, 0.2], GREY, 0.28, 'left')
    const jointRows = textRows(scene, 4, X, 2.95, 0.3, 0.7)
    addLabel(scene, 'Every spot the job needs', [X, -0.15, 0.2], GREY, 0.28, 'left')
    const spotRows = textRows(scene, DESK_SPOTS.length, X, -0.95, 0.3, 0.62)
    const st = { t: 0, key: '', q: [...MOUNT_CENTRES] }

    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = asParams(p)
        const R = asCheck(q)
        const key = asKey(q)
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        const k = Math.floor(st.t / SPOT_S) % DESK_SPOTS.length
        const spot = R.spots[k]
        st.q = glideJoints(st.q, spot.q, dt, 5)
        const f = d.arm.set(st.q)
        d.pen.begin()
        d.leads(f)
        d.pen.end()
        d.pack.visible = true
        d.usb.visible = false
        arcs.begin()
        ;[0, 1, 2].forEach((i) => {
          const [lo, hi] = R.usable[i]
          jointArc(arcs, f, i, i === 0 ? 0.05 : 0.034, lo, hi, JOINT_COLORS[i], 1)
          jointArc(arcs, f, i, i === 0 ? 0.05 : 0.034, MOUNT_CENTRES[i] - 0.02, MOUNT_CENTRES[i] + 0.02, LABEL, 2)
        })
        arcs.dot(spot.at as V3, spot.why === 'ok' ? POWER : HIGH_V, 3)
        arcs.end()
        R.spots.forEach((s, j) => {
          blocks[j](s.why === 'ok' ? POWER : HIGH_V)
          spotRows[j].set(`${s.name.padEnd(12)} ${spotText(s, R.usable)}`, j === k ? (s.why === 'ok' ? POWER : HIGH_V) : s.why === 'ok' ? LABEL : HEAT)
        })
        R.usable.forEach((u, i) => {
          const trim = R.trims[i]
          jointRows[i].set(`${i + 1} ${SERVO_JOINT_NAMES[i].padEnd(9)} ${range(u).padEnd(14)} trim ${signedDeg(trim)}`, JOINT_COLORS[i])
        })
        status.set(`${spot.name}: ${spotText(spot, R.usable)}`, spot.why === 'ok' ? LABEL : HIGH_V)
        sub.set(`${q.centred ? 'servos centred at 1500 µs before each horn' : 'horns fitted unpowered'} · shoulder ${teethText(q.sh)} · elbow ${teethText(q.el)}`, GREY)
        const worstTrim = Math.max(...R.trims.map(Math.abs))
        event.set(
          R.reached === DESK_SPOTS.length
            ? worstTrim <= (TOOTH_DEG / 2) * DEG + 1e-9 ? 'every spot inside the travel; the few degrees left get trimmed in Calibrate servos' : 'every spot reached, but the zero is far off: trim it in Calibrate servos'
            : 'a trim in code cannot add travel: take the horn off and refit it',
          R.reached === DESK_SPOTS.length ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const R = asCheck(asParams(p))
        const worstTrim = Math.max(...R.trims.map(Math.abs))
        return [
          { label: 'Spots reached', value: `${R.reached} / ${DESK_SPOTS.length}`, tone: toneOf(R.reached === DESK_SPOTS.length, R.reached >= DESK_SPOTS.length - 1) },
          { label: 'Shoulder travel', value: range(R.usable[1]) },
          { label: 'Elbow travel', value: range(R.usable[2]) },
          { label: 'Biggest zero offset to trim', value: deg(worstTrim, 1), tone: toneOf(worstTrim <= (TOOTH_DEG / 2) * DEG + 1e-9, worstTrim < 20 * DEG) },
        ]
      },
    }
  },
}

// --- Calibrate servos: known pulses in, protractor readings out, a zero and a slope per servo. ---

const METHODS: Record<CalMethod, string> = { none: 'No calibration (nominal table)', centre: 'Centre only: read 1500 µs', twoPoint: `Two-point: read 1500 ± ${CAL_SPAN_US} µs` }
const ELBOWS = { mirror: 'Elbow servo mirrored, as designed', flipped: 'Elbow servo flipped by mistake' }
const WATCH = { j0: 'Calibrate the base', j1: 'Calibrate the shoulder', j2: 'Calibrate the elbow', j3: 'Calibrate the wrist' }
const caParams = (p: Params) => ({ method: pick(METHODS, p.method, 'twoPoint') as CalMethod, res: n(p, 'res'), flip: pick(ELBOWS, p.elbow, 'mirror') === 'flipped', joint: Number(pick(WATCH, p.joint, 'j1').slice(1)) })
type CaQ = ReturnType<typeof caParams>
const caKey = (q: CaQ) => `${q.method}|${q.res}|${q.flip}`
const caCalc = memoBy(caKey, (q: CaQ) => {
  const truths = servoTruths(q.flip)
  const code = calibrateArm(q.method, truths, q.res)
  return { truths, code, errs: calErrors(code, truths), spots: spotErrors(code, truths) }
})
const CA = { stepS: 1.8, sweepS: 5, restS: 0.8, sy: 1.1, sh: 3.8, errMax: 15 }
const usPerDeg = (k: number) => `${fixedText((k * DEG), 1)} µs/°`
/** The angle each servo really sits at for pulse `us`, after PCA9685 tick rounding. */
const trueAt = (us: number, truth: (typeof ARM_CAL)[number]) => jointFromPulse(ticksUs(pcaTicks(us)), truth)

export const robotArmCalibrateServos: Lesson = {
  id: 'robot-arm-calibrate-servos',
  title: 'Calibrate servos',
  tagline: 'Send known pulses, read the joint on a protractor, store a zero and a slope per servo',
  formula: (p) => {
    const q = caParams(p)
    const R = caCalc(q)
    const c = R.code[q.joint]
    return `angle = (pulse − zero) / k · two readings: k = (u₂ − u₁)/(θ₂ − θ₁), zero = u₁ − k·θ₁ · ${SERVO_JOINT_NAMES[q.joint]}: zero ${Math.round(c.zeroUs)} µs, k ${usPerDeg(c.usPerRad)} (nominal ${ARM_CAL[q.joint].zeroUs} µs, ${usPerDeg(ARM_CAL[q.joint].usPerRad)}) · worst joint error ${deg(R.errs.worst, 1)}`
  },
  legend: [
    { color: B_FIELD, label: 'Ghost: where the code thinks the arm is', shape: 'dot' },
    { color: RING, label: 'Protractor: 10° marks around the joint', shape: 'dot' },
    { color: JOINT_COLORS[1], label: 'Scope: real − commanded per joint (±15°)', shape: 'dot' },
    { color: HIGH_V, label: 'More than 2° off', shape: 'dot' },
  ],
  points: [
    'Calibration finds, for each servo, the pulse that puts its joint at 0 (the zero) and how many µs move it one degree (the slope k, its sign set by which way the servo is mounted). Clamp a protractor (or a printed angle gauge) at the joint, send a pulse from the PCA9685, read the angle, write it down. How the pulse ↔ angle map works is Actuators › Servos.',
    'Centre only: send 1500 µs and read the angle. That fixes the horn offset from Assemble, but keeps the nominal 11.1 µs/°. Real servos differ by ±5 % (here 0.94…1.06 ×), so 54° out the error is back to 3–4°, and a centre reading cannot tell that a servo turns the wrong way.',
    'Two-point: read the angle at 1500 − 600 µs and 1500 + 600 µs. Two readings give zero and slope, sign included, so a servo mounted the wrong way round is caught. The error left is about the protractor’s resolution; the PCA9685’s 4.9 µs ticks add under 0.5°.',
    'Store the table in the firmware ({zero µs, µs per degree} per channel) and convert every commanded angle with it. Then verify: sweep each joint and compare. At the hand every joint error is multiplied by its distance from the hand, so 2° at the shoulder is about 1 cm (Kinematics › Robot arm build › Drive it with IK).',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHODS), initial: 'twoPoint' },
    { kind: 'choice', key: 'joint', options: opts(WATCH), initial: 'j1' },
    { kind: 'slider', key: 'res', label: 'Protractor reads to', min: 0.5, max: 5, step: 0.5, initial: 1, format: (v) => `${v}°` },
    { kind: 'choice', key: 'elbow', options: opts(ELBOWS), initial: 'mirror' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const d = armDesk(scene, DESK_AT, K, KINDS)
    const ghost = serialArm(d.lifted, SERVO_ARM, { ...SERVO_ARM_LOOK, axes: false })
    ghostRig(ghost.group, B_FIELD, 0.18)
    const gauge = dotPen(d.lifted, 400, 0.0016)
    const sc = titledScope(scene, CA.sy, CA.sh, "real − commanded (±15°)", LABEL, 0.5, X + 5.25, 10.5)
    const traces = [0, 1, 2, 3].map((i) => sc.s.trace(JOINT_COLORS[i], { samples: CAL_SWEEP.n, radius: 0.07 }))
    sc.lo.set(`−${CAL_SWEEP.halfDeg}°`, GREY)
    sc.hi.set(`+${CAL_SWEEP.halfDeg}°`, GREY)
    const yErr = plotY(-CA.errMax * DEG, CA.errMax * DEG, CA.sh)
    addLabel(scene, 'Stored table (firmware)', [X, -2.35, 0.2], GREY, 0.28, 'left')
    const rows = textRows(scene, 4, X, -3.05, 0.3, 0.66)
    const st = { t: 0, key: '', q: [...MOUNT_CENTRES], g: [...MOUNT_CENTRES] }

    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = caParams(p)
        const R = caCalc(q)
        const i = q.joint
        const pulses = calPulses(q.method)
        const total = pulses.length * CA.stepS + CA.sweepS + CA.restS
        const key = `${caKey(q)}|${i}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t = (st.t + dt) % total
        const others = R.truths.map((c) => trueAt(1500, c))
        const step = Math.floor(st.t / CA.stepS)
        let real: number[]
        let seen: number[]
        let line: string
        let tone = LABEL
        if (step < pulses.length) {
          const u = pulses[step]
          real = others.map((v, j) => (j === i ? trueAt(u, R.truths[i]) : v))
          seen = MOUNT_CENTRES.map((v, j) => (j === i ? jointFromPulse(u, ARM_CAL[i]) : v))
          line = `reading ${step + 1}/${pulses.length}: send ${u} µs (${pcaTicks(u)} ticks) → protractor reads ${fixedText(readAt(u, R.truths[i], q.res), 1)}°`
        } else {
          const s = (st.t - pulses.length * CA.stepS) / CA.sweepS
          const cmd = MOUNT_CENTRES[i] + CAL_SWEEP.halfDeg * DEG * Math.sin(2 * Math.PI * Math.min(1, s))
          seen = MOUNT_CENTRES.map((v, j) => (j === i ? cmd : v))
          real = seen.map((v, j) => trueAt(pulseUs(v, R.code[j]), R.truths[j]))
          const err = real[i] - cmd
          line = `verify: command ${deg(cmd)} → ${Math.round(pulseUs(cmd, R.code[i]))} µs → really ${deg(real[i], 1)} (off ${signedDeg(err, 1)})`
          tone = Math.abs(err) > 2 * DEG ? HIGH_V : POWER
        }
        st.q = glideJoints(st.q, real, dt, 8)
        st.g = glideJoints(st.g, seen, dt, 8)
        const f = d.arm.set(st.q)
        ghost.set(st.g)
        d.pen.begin()
        d.leads(f)
        d.pen.end()
        d.pack.visible = true
        d.usb.visible = false
        gauge.begin()
        const c0 = MOUNT_CENTRES[i]
        const r = i === 0 ? 0.06 : 0.05
        jointArc(gauge, f, i, r, c0 - Math.PI / 2, c0 + Math.PI / 2, RING, 0.7)
        for (let a = -90; a <= 90; a += 10) jointArc(gauge, f, i, r + 0.004, c0 + a * DEG, c0 + a * DEG, a % 30 === 0 ? LABEL : RING, a % 30 === 0 ? 2.4 : 1.4)
        jointArc(gauge, f, i, r - 0.006, st.q[i], st.q[i], JOINT_COLORS[i], 3)
        gauge.end()

        R.errs.joints.forEach((jt, j) => {
          const us = jt.q.map((_, k) => k / (jt.q.length - 1))
          traces[j].points(us, jt.err.map(yErr), j === i && step >= pulses.length ? Math.round((jt.q.length - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * Math.min(1, (st.t - pulses.length * CA.stepS) / CA.sweepS)))) : null)
          const c = R.code[j]
          rows[j].set(`CH${j} ${SERVO_JOINT_NAMES[j].padEnd(9)} zero ${String(Math.round(c.zeroUs)).padStart(4)} µs · ${usPerDeg(c.usPerRad).padStart(10)} · worst ${deg(jt.worst, 1)}`, jt.worst > 2 * DEG ? HIGH_V : JOINT_COLORS[j])
        })
        sc.right.set(`worst ${deg(R.errs.worst, 1)}`, R.errs.worst > 2 * DEG ? HIGH_V : POWER)
        status.set(`${SERVO_JOINT_NAMES[i]}: ${line}`, tone)
        sub.set(`${METHODS[q.method]} · protractor to ${q.res}° · ${q.flip ? 'elbow servo turned round' : 'elbow mirrored as designed'} · PCA9685 tick = ${fixedText(ticksUs(1), 1)} µs`, GREY)
        const elbowWrong = Math.sign(R.code[2].usPerRad) !== Math.sign(R.truths[2].usPerRad)
        event.set(
          elbowWrong ? 'elbow turns against the code: a centre reading cannot see it' : R.errs.worst > 2 * DEG ? (q.method === 'none' ? 'horn offsets and slope spread, straight from the box' : 'zero fixed, slope nominal: error grows away from centre') : 'every joint within 2° across its working range',
          elbowWrong || R.errs.worst > 2 * DEG ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const q = caParams(p)
        const R = caCalc(q)
        const miss = Math.max(...R.spots)
        const elbowWrong = Math.sign(R.code[2].usPerRad) !== Math.sign(R.truths[2].usPerRad)
        return [
          { label: 'Worst joint error', value: deg(R.errs.worst, 1), tone: toneOf(R.errs.worst <= 1 * DEG, R.errs.worst <= 3 * DEG) },
          { label: 'Hand miss at the desk spots', value: mmTenths(miss), tone: toneOf(miss < 0.005, miss < 0.015) },
          { label: 'Readings taken', value: `${calPulses(q.method).length * 4}` },
          { label: 'Elbow direction in code', value: elbowWrong ? 'reversed' : 'matches', tone: elbowWrong ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- IK control: pick and place; every 20 ms the target goes through IK to four pulses, the servos follow at their own pace. ---

const INTERPS: Record<JobInterp, string> = { cartesian: 'Straight lines (IK every tick)', joint: 'Joint interpolation (IK at the ends)' }
const ikParams = (p: Params) => ({ interp: pick(INTERPS, p.interp, 'cartesian') as JobInterp, speed: n(p, 'speed'), squeeze: n(p, 'squeeze') })
type IkQ = ReturnType<typeof ikParams>
const ikKey = (q: IkQ) => `${q.interp}|${q.speed}|${q.squeeze}`
const ikRun = memoBy(ikKey, (q: IkQ) => jobRun(q.interp, q.speed, q.squeeze))
const IK = { sy: 1.2, sh: 3.6, rest: 1.2, samples: 240 }
const resultTone = (r: string) => (r === 'placed' ? 'ok' : r === 'off target' ? 'warn' : 'bad')
const v3 = (p: readonly number[]): V3 => [p[0], p[1], p[2]]

export const robotArmIkControl: Lesson = {
  id: 'robot-arm-ik-control',
  title: 'IK control',
  tagline: 'Pick and place: a target every 20 ms through IK to four pulses, and a gripper that has to hold on',
  formula: (p) => {
    const q = ikParams(p)
    const R = ikRun(q)
    return `every ${ARM_JOB.dt * 1000} ms: p(t) = a + s(t)·(b − a), trapezoid ${fixedText(q.speed, 2)} m/s, ${fixedText(q.speed / ARM_JOB.rampS, 1)} m/s² → q = IK(p, φ = −90°) → pulse = zero + k·q · servo: q̇ = (q_cmd − q)/${ARM_JOB.lagS} s, ≤ ω_free(1 − τ/τ_stall) · grip 2μN = ${fixedText(R.grip.holdN, 2)} N vs m·|a − g| (${fixedText(R.grip.weightN, 2)} N at rest)`
  },
  legend: [
    { color: RING, label: 'Planned straight lines', shape: 'dot' },
    { color: POWER, label: 'Real hand path (red: > 1 cm off the plan)', shape: 'dot' },
    { color: HEAT, label: 'Grip needed m·|a − g|', shape: 'dot' },
    { color: B_FIELD, label: 'Friction hold of the jaws', shape: 'dot' },
  ],
  points: [
    'The job: from home, over the block, down, close the gripper, lift, carry across, down, open, up, home. The firmware runs a fixed 50 Hz loop: work out where the hand should be now, solve the closed-form IK (Kinematics › Inverse kinematics › Multiple solutions) keeping the branch nearest the last tick, convert each angle with the calibration table (Calibrate servos) and write four pulses to the PCA9685.',
    'Straight lines: interpolate the hand position and solve IK every tick, so the hand stays on the line within a few millimetres. Joint interpolation: solve IK only at the ends and blend the joint angles; it is cheaper, but the carry swings in an arc several centimetres off the line, which matters next to obstacles (Kinematics › Trajectories › Linear interpolation).',
    'Every move is a trapezoid in time (Kinematics › Trajectories › Time scaling). A servo does not jump to its pulse: its P-loop lags about 60 ms and its speed drops with load, so the real hand trails the plan by roughly speed × lag. Go slower near the block or add a short pause at each end so it settles before the gripper acts.',
    'The rack gripper squeezes only as hard as the SG90 is pushed past contact (Kinematics › Grippers › Parallel jaw): 2μN of friction has to carry m·|a − g|, the weight plus every acceleration of the hand. A light squeeze holds the block at rest but lets go on a brisk lift; squeeze harder (hotter servo) or move gentler.',
  ],
  controls: [
    { kind: 'choice', key: 'interp', options: opts(INTERPS), initial: 'cartesian' },
    { kind: 'slider', key: 'speed', label: 'Hand speed', min: 0.05, max: 0.6, step: 0.05, initial: 0.25, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'squeeze', label: 'Gripper past contact', min: 1, max: 10, step: 1, initial: 6, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const d = armDesk(scene, DESK_AT, K, KINDS)
    box(d.lifted, [0.05, 0.05, 0.002], mat(RING, { rough: 0.7 }), [ARM_JOB.pick[0], ARM_JOB.pick[1], DESK_Z + 0.001])
    box(d.lifted, [0.05, 0.05, 0.002], mat(POWER, { rough: 0.7 }), [ARM_JOB.place[0], ARM_JOB.place[1], DESK_Z + 0.001])
    const blockMat = new THREE.MeshStandardMaterial({ color: '#e0564a', roughness: 0.5 })
    const block = box(d.lifted, [ARM_JOB.blockMm / 1000, ARM_JOB.blockMm / 1000, ARM_JOB.blockMm / 1000], blockMat)
    const trail = dotPen(d.lifted, 1600, 0.0016)
    const sc = titledScope(scene, IK.sy, IK.sh, 'grip needed vs friction hold', HEAT, 0, X + 5.25, 10.5)
    const needTr = sc.s.trace(HEAT, { samples: IK.samples, radius: 0.06 })
    const holdLvl = sc.s.level(B_FIELD)
    sc.lo.set('0 s', GREY)
    const rows = textRows(scene, 5, X, -2.25, 0.3, 0.66)
    const st = { key: '', t: 0 }

    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ikParams(p)
        const R = ikRun(q)
        const key = ikKey(q)
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t = (st.t + dt) % (R.T + IK.rest)
        const t = Math.min(st.t, R.T)
        const k = Math.min(R.frames.length - 1, Math.max(0, Math.floor(t / ARM_JOB.dt) - 1))
        const fr: JobFrame = R.frames[k]
        const f = d.arm.set(fr.q)
        d.arm.rig.jaw(1 - 0.75 * fr.jaw)
        block.position.set(...v3(fr.block))
        d.pen.begin()
        d.leads(f)
        d.pen.end()
        d.pack.visible = true
        d.usb.visible = false

        trail.begin()
        R.segs.forEach((s) => s.kind === 'move' && trail.line(v3(s.a), v3(s.b), 0.006, RING, 0.7))
        for (let j = 0; j <= k; j += 2) {
          const g = R.frames[j]
          const off = Math.hypot(g.plan[0] - g.hand[0], g.plan[1] - g.hand[1], g.plan[2] - g.hand[2])
          trail.dot(v3(g.hand), off > 0.01 ? HIGH_V : POWER, 1.1)
        }
        trail.dot(v3(fr.plan), RING, 2.6)
        trail.end()

        const hold = R.grip.holdN
        const yN = plotY(0, 2 * hold, IK.sh)
        const stride = Math.max(1, Math.ceil(R.frames.length / IK.samples))
        const idx = R.frames.map((_, j) => j).filter((j) => j % stride === 0)
        const shown = idx.filter((j) => j <= k)
        needTr.points(shown.map((j) => R.frames[j].t / R.T), shown.map((j) => yN(R.frames[j].needN)))
        holdLvl.set(yN(hold))
        sc.hi.set(`${fixedText(R.T, 1)} s`, GREY)
        sc.right.set(fr.held ? `${fixedText(fr.needN, 2)} N of ${fixedText(hold, 2)} N` : `hold ${fixedText(hold, 2)} N`, fr.held && fr.needN > 0.8 * hold ? HIGH_V : LABEL)

        const seg = R.segs[fr.seg]
        const lag = Math.hypot(fr.plan[0] - fr.hand[0], fr.plan[1] - fr.hand[1], fr.plan[2] - fr.hand[2])
        rows[0].set(`every 20 ms: target (${fr.plan.map((v) => fixedText(v * 100, 1)).join(', ')}) cm → IK`, LABEL)
        fr.cmd.forEach((c, j) => {
          const us = pulseUs(c, ARM_CAL[j])
          rows[j + 1].set(`CH${j} ${SERVO_JOINT_NAMES[j].padEnd(9)} ${deg(c, 1).padStart(7)} → ${Math.round(us)} µs · servo ${signedDeg(fr.q[j] - c, 1)} behind`, JOINT_COLORS[j])
        })
        status.set(`${fixedText(t, 1)} / ${fixedText(R.T, 1)} s · ${seg.label}${fr.held ? ' · holding the block' : ''}`, LABEL)
        sub.set(`${INTERPS[q.interp]} · ${fixedText(q.speed, 2)} m/s · gripper ${q.squeeze}° past contact · hand ${mmTenths(lag)} behind the plan`, GREY)
        if (R.result === 'not gripped') event.set(`squeeze ${fixedText(R.grip.holdN, 2)} N of friction < ${fixedText(R.grip.weightN, 2)} N weight: the block stays on the desk`, HIGH_V)
        else if (R.slipAt !== null && t >= R.slipAt) event.set(`dropped at ${fixedText(R.slipAt, 2)} s: the lift asked more than the jaws' friction`, HIGH_V)
        else event.set(R.result === 'placed' ? `placed ${mmTenths(R.placeErr)} from the mark · lowest grip margin ${fixedText(R.minMargin, 2)}×` : `placed ${mmTenths(R.placeErr)} off the mark`, R.result === 'placed' ? (R.minMargin < 1.2 ? HEAT : POWER) : HEAT)
      },
      readouts: (p) => {
        const R = ikRun(ikParams(p))
        return [
          { label: 'Cycle time', value: `${fixedText(R.T, 1)} s` },
          { label: 'Off the straight line', value: mmTenths(R.devMax), tone: toneOf(R.devMax < 0.005, R.devMax < 0.02) },
          { label: 'Servo lag behind the plan', value: mmTenths(R.lagMax), tone: toneOf(R.lagMax < 0.01, R.lagMax < 0.02) },
          { label: 'Block', value: R.result === 'dropped' ? `dropped at ${fixedText(R.slipAt ?? 0, 1)} s` : R.result === 'placed' ? `placed, grip ×${fixedText(R.minMargin, 2)}` : R.result, tone: resultTone(R.result) },
        ]
      },
    }
  },
}
