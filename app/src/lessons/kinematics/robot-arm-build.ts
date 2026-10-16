import * as THREE from 'three/webgpu'
import {
  ARM_BUILD, ARM_CAL, ARM_SERVOS, ARM_SUPPLIES, ArmServo, ArmSupply, DEG, HORN_TEETH, Mat4, P3, SERVO_ARM, TOOTH_DEG, actualJoints, armBudget, armFk, armMasses, clamp, driveAt, handGap,
  holdTorques, hornShift, logicMinVolts, originOf, pcaTicks, pulseUs, reversed, sagJoints, servoArmIk, syncScale, toDeg, toolOf, wrapPi,
} from '../../core/physics'
import { degText, mmTenths, pct } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD, GREY, HEAT, HIGH_V, JOINT_COLORS, LABEL, POWER, RING, addLabel, cableRun, dotPen, floorMat, ghostRig, glide, liveLabel, meterBar, pca9685Board, serialArm, servoArmBuild, statusHeader, toneColor, zUp,
} from '../fx'
import { buildEsp32 } from '../../models/modules'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const deg = (a: number) => degText(Math.abs(a) < 0.05 * DEG ? 0 : toDeg(a), 1)
const nm = (v: number) => `${Math.abs(v).toFixed(2)} N·m`
const amps = (a: number) => `${a.toFixed(a < 10 ? 2 : 1)} A`
const volts = (v: number) => `${v.toFixed(2)} V`
const gSlider = { kind: 'slider' as const, key: 'payload', label: 'Payload in the gripper', min: 0, max: 250, step: 10, initial: 100, format: (v: number) => `${v} g` }
const JOINT_NAMES = ['base', 'shoulder', 'elbow', 'wrist']
const LEAD = '#d9822b'
const short = (k: ArmServo) => ARM_SERVOS[k].name.split(' ')[0]
const BASE_H = 0.05
const toneOf = (share: number) => (share <= 0.5 ? 'ok' : share <= 1 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad'
const clampLimits = (q: readonly number[]) => q.map((v, i) => clamp(v, SERVO_ARM.limits[i][0], SERVO_ARM.limits[i][1]))

/** Desk scene shared by both lessons: arm build on a stand, PCA9685 + ESP32 on the desk, leads from every servo to its channel. */
function deskBuild(scene: THREE.Scene, at: V3, k: number, kinds: readonly ArmServo[]) {
  const g = zUp(scene, at, k, 0.55, -0.5)
  floorMat(g, [-0.22, 0.34], [-0.22, 0.12])
  const lifted = add(g, new THREE.Group(), [0, 0, BASE_H])
  const arm = servoArmBuild(lifted, kinds, BASE_H)
  const B: V3 = [-0.03, -0.12, 0]
  const board = pca9685Board(g, B, 0.001)
  board.group.rotation.z = Math.PI
  const turned = (p: V3): V3 => [2 * B[0] - p[0], 2 * B[1] - p[1], p[2]]
  const esp = add(g, buildEsp32(), [0.065, -0.135, 0])
  esp.rotation.x = Math.PI / 2
  esp.scale.setScalar(0.00254)
  const exit: V3 = [-0.01, -0.038, 0.012]
  ;[0, 1, 2, 3, 4].forEach((i) => {
    const c = turned(board.ch(i))
    const y = exit[1] - 0.004 * i
    cableRun(g, [[exit[0] - 0.003 * i, exit[1], exit[2]], [exit[0] - 0.003 * i, y - 0.01, 0.004], [c[0], y - 0.03, 0.004], [c[0], c[1] + 0.008, 0.006], c], LEAD, 0.0013)
  })
  const i2cAt = turned(board.i2c)
  ;['#d8322c', '#1a1a1a', '#f2c230', '#4d7dff'].forEach((c, j) => {
    const y = i2cAt[1] + (j - 1.5) * 0.0025
    cableRun(g, [[i2cAt[0], y, i2cAt[2]], [i2cAt[0] + 0.01, y, 0.01], [0.044 + j * 0.0025, -0.122, 0.012]], c, 0.001)
  })
  const vplus = turned(board.vplus)
  const pack = add(g, new THREE.Group())
  box(pack, [0.077, 0.042, 0.02], mat('#1a1a1a', { rough: 0.6 }), [-0.13, -0.17, 0.01])
  for (const y of [-0.18, -0.16]) add(pack, new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.065, 16), mat('#2f6fd8', { rough: 0.4 })), [-0.13, y, 0.021]).rotation.z = Math.PI / 2
  cableRun(pack, [[-0.09, -0.165, 0.012], [-0.07, -0.16, 0.012], [vplus[0] - 0.002, vplus[1] - 0.006, 0.012], vplus], '#d8322c', 0.0015)
  cableRun(pack, [[-0.09, -0.175, 0.012], [-0.065, -0.17, 0.012], [vplus[0] + 0.004, vplus[1] - 0.008, 0.012], [vplus[0] + 0.005, vplus[1], vplus[2]]], '#1a1a1a', 0.0015)
  const usb = add(g, new THREE.Group())
  cableRun(usb, [[0.044, -0.148, 0.012], [0.03, -0.16, 0.012], [vplus[0] + 0.006, vplus[1] - 0.012, 0.012], vplus], '#d8322c', 0.0013)
  const pen = dotPen(lifted, 900, 0.0018)
  const leads = (f: Mat4[]) => {
    const o = f.map(originOf) as V3[]
    const ports = arm.ports(f)
    ports.forEach((p, i) => {
      const route: V3[] = [p, ...o.slice(0, Math.max(1, i)).reverse(), [exit[0], exit[1], exit[2] - BASE_H]]
      route.slice(1).forEach((b, j) => pen.line(route[j], b, 0.006, LEAD, 0.8))
    })
  }
  return { g, lifted, arm, board, pen, leads, pack, usb }
}

// --- Assemble the arm: servo per joint vs the gravity torque it must hold, and the current they all draw. ---

const POSES = { sweep: 'Sweep through poses', reach: 'Reach out', ready: 'Ready', up: 'Straight up' }
const POSE_Q: Record<Exclude<keyof typeof POSES, 'sweep'>, number[]> = {
  reach: [0, 15 * DEG, -15 * DEG, 0],
  ready: [25 * DEG, 70 * DEG, -95 * DEG, -40 * DEG],
  up: [-20 * DEG, 90 * DEG, 0, 0],
}
const SWEEP: (keyof typeof POSE_Q)[] = ['reach', 'ready', 'up', 'ready']
const SHOULDERS: Record<ArmServo, string> = { mg996r: 'MG996R shoulder', mg90s: 'MG90S shoulder', sg90: 'SG90 shoulder' }
const SUPPLIES: Record<ArmSupply, string> = { pack: ARM_SUPPLIES.pack.name, usb: ARM_SUPPLIES.usb.name }
const asParams = (p: Params) => ({ pose: pick(POSES, p.pose, 'sweep'), shoulder: pick(SHOULDERS, p.shoulder, 'mg996r'), supply: pick(SUPPLIES, p.supply, 'pack'), payload: n(p, 'payload') / 1000 })
const buildOf = (shoulder: ArmServo) => ({ ...ARM_BUILD, servos: ARM_BUILD.servos.map((s, i) => (i === 1 ? shoulder : s)) })
const SWEEP_LEGS = SWEEP.map((a, i) => {
  const [qa, qb] = [POSE_Q[a], POSE_Q[SWEEP[(i + 1) % SWEEP.length]]]
  return { qa, qb, scale: syncScale('quintic', qb.map((v, j) => v - qa[j]), [1.2, 1.2, 1.2, 1.2], [3, 3, 3, 3]).scale }
})
const DWELL = 0.8
const sweepAt = (t: number) => {
  const total = SWEEP_LEGS.reduce((s, l) => s + l.scale.T + DWELL, 0)
  let u = ((t % total) + total) % total
  for (const l of SWEEP_LEGS) {
    if (u < DWELL) return l.qa
    u -= DWELL
    if (u < l.scale.T) {
      const s = l.scale.at(u).s
      return l.qa.map((v, j) => v + (l.qb[j] - v) * s)
    }
    u -= l.scale.T
  }
  return SWEEP_LEGS[0].qa
}

export const armBuildAssemble: Lesson = {
  id: 'robot-arm-build-assemble-the-arm',
  title: 'Assemble the arm',
  tagline: 'Four servos, brackets and a driver board',
  formula: (p) => {
    const q = asParams(p)
    const b = armBudget(POSE_Q.reach, q.payload, q.supply, buildOf(q.shoulder))
    return `τi = Jiᵀ·(0, 0, m·g) summed over every bracket, servo and the payload beyond joint i · keep τ ≤ ½ stall · reach-out shoulder ${nm(b.joints[1].tau)} = ${pct(b.joints[1].share)} of a ${short(q.shoulder)}`
  },
  legend: [
    { color: POWER, label: 'Hold torque ≤ ½ stall: holds cool', shape: 'dot' },
    { color: HEAT, label: '½ … 1 × stall: holds, heats, droops', shape: 'dot' },
    { color: HIGH_V, label: 'Past stall: cannot hold', shape: 'dot' },
    { color: LEAD, label: 'Servo leads to the PCA9685 (I²C from the ESP32)', shape: 'dot' },
  ],
  points: [
    'The arm from Forward kinematics, built for real: an MG996R metal-gear servo turns the base, shoulder and elbow, an SG90 the wrist and another SG90 the gripper. Aluminium brackets join them; each servo body rides on the link before its joint, so every servo also carries the servos beyond it.',
    'Each joint must hold the weight of everything beyond it. For one mass m at point p, the torque is τ = Jᵀ·(0, 0, m·g), the same rule as in Manipulability; add up the brackets at mid-link, the servos at their joints, the gripper and the payload. The shoulder sees the longest levers, so it gets the strongest servo. With the arm straight up the torque is zero; reaching out flat is the worst case.',
    'Size like Motor selection: holding at more than about half the stall torque works, but the servo runs hot and its P-loop droops (see Inside a hobby servo). Swap the shoulder for an SG90 and it cannot hold even an empty gripper out flat. Stall torque grows with volts, so the same servo is about 17 % stronger on 6 V than on 5 V.',
    'Power and wiring: holding current grows with torque, and four servos starting together draw close to their stall current. On the ESP32\'s USB 5 V that surge drags the rail under the regulator\'s dropout and the board resets (see Brownouts and Jitter and power). Feed the servos from their own 6 V pack into the PCA9685\'s V+ terminal, share only ground, and let the ESP32 talk to the board over I²C, one channel per servo.',
  ],
  controls: [
    { kind: 'choice', key: 'pose', options: opts(POSES), initial: 'sweep' },
    { kind: 'choice', key: 'shoulder', options: opts(SHOULDERS), initial: 'mg996r' },
    { kind: 'choice', key: 'supply', options: opts(SUPPLIES), initial: 'pack' },
    gSlider,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const d = deskBuild(scene, [-11, -7.6, 0], 28, buildOf('mg996r').servos.concat(ARM_BUILD.gripper))
    const X = 1.6
    const bars = add(scene, new THREE.Group(), [X + 2.6, 2.6, 0.2])
    bars.scale.setScalar(0.42)
    const meters = JOINT_NAMES.map((name, i) =>
      meterBar(bars, [0, -i * 3.1, 0], 11, 1.5, i === 0 ? [[0.5, '½', GREY], [1, 'stall', HIGH_V]] : [[0.5, '', GREY], [1, '', HIGH_V]], `${i + 1} ${name}`),
    )
    addLabel(scene, 'hold torque / stall torque', [X, 3.75, 0.2], GREY, 0.28, 'left')
    const lines = Array.from({ length: 4 }, (_, i) => liveLabel(scene, [X, -2.9 - i * 0.78, 0.2], { size: 0.3, align: 'left' }))

    const st = { t: 0, q: [...POSE_Q.reach], key: '', shoulder: 'mg996r' as ArmServo }
    const poseAt = (q: ReturnType<typeof asParams>) => (q.pose === 'sweep' ? sweepAt(st.t) : POSE_Q[q.pose])
    return {
      scene,
      view: { center: [-1.2, -0.9, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = asParams(p)
        const key = `${q.pose}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (q.shoulder !== st.shoulder) {
          d.arm.fit(1, q.shoulder)
          st.shoulder = q.shoulder
        }
        const build = buildOf(q.shoulder)
        const goal = poseAt(q)
        const b = armBudget(goal, q.payload, q.supply, build)
        const droop = sagJoints(b.joints.map((j) => j.tau), b.drives, 0)
        const shown = clampLimits(goal.map((v, i) => v + Math.max(-30 * DEG, droop[i])))
        st.q = st.q.map((v, i) => v + glide(dt, 0, wrapPi(shown[i] - v), q.pose === 'sweep' ? 12 : 5))
        const f = d.arm.set(st.q)
        d.pen.begin()
        d.leads(f)
        d.pen.end()
        d.pack.visible = q.supply === 'pack'
        d.usb.visible = q.supply === 'usb'
        b.joints.forEach((j, i) => {
          const c = toneColor[toneOf(j.share)]
          meters[i](j.share, `${nm(j.tau)} · ${pct(j.share)}`, i === 0 ? GREY : c)
          d.arm.heat(i, j.share > 1 ? 1 : j.share > 0.5 ? (j.share - 0.5) : 0)
          d.board.lit(i, j.share)
        })
        const worst = b.joints.reduce((a, j, i) => (j.share > b.joints[a].share ? i : a), 1)
        const sup = ARM_SUPPLIES[q.supply]
        lines[0].set(`holding: ${amps(b.amps)} from ${sup.volts} V  →  rail ${volts(b.restVolts)}`, LABEL)
        lines[1].set(`all start at once: ${amps(b.kick.amps)}  →  rail ${volts(b.kick.volts)}`, b.resets ? HIGH_V : b.kick.volts < 0.9 * sup.volts ? HEAT : POWER)
        lines[2].set(sup.sharedLogic ? `ESP32 shares it, needs ≥ ${volts(logicMinVolts)}: ${b.restVolts < logicMinVolts ? 'browns out even holding' : b.resets ? 'resets on every start' : 'ok'}` : 'ESP32 on its own USB: servo surges cannot reset it', b.resets ? HIGH_V : GREY)
        lines[3].set(`masses: ${Math.round(armMasses(goal, q.payload, build).reduce((s, m) => s + m.kg, 0) * 1000)} g moving, ${Math.round(q.payload * 1000)} g of it payload`, GREY)
        if (b.joints[worst].share < 0.01) status.set('straight up: every weight sits on a joint axis, no joint holds any torque', LABEL)
        else status.set(`${JOINT_NAMES[worst]} works hardest: ${nm(b.joints[worst].tau)} of ${nm(b.drives[worst].stallNm)} stall (${short(build.servos[worst])} at ${sup.volts} V)`, LABEL)
        sub.set(`MG996R base + elbow · ${short(q.shoulder)} shoulder · SG90 wrist + gripper · PCA9685 on I²C`, GREY)
        const weak = b.joints.findIndex((j) => j.verdict === 'weak')
        event.set(
          weak >= 0 ? `${JOINT_NAMES[weak]} past stall: the arm sags until the stop, pick a stronger servo` : b.resets ? 'holds, but a start-up surge resets the ESP32: give the servos their own supply' : b.joints.some((j) => j.verdict === 'thin') ? 'holds, but above ½ stall: hot servo and visible droop' : 'every joint under ½ stall: cool and steady',
          weak >= 0 || b.resets ? HIGH_V : b.joints.some((j) => j.verdict === 'thin') ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const q = asParams(p)
        const b = armBudget(poseAt(q), q.payload, q.supply, buildOf(q.shoulder))
        const sh = b.joints[1]
        const worst = Math.max(...b.joints.map((j) => j.share))
        return [
          { label: 'Shoulder hold', value: `${nm(sh.tau)} · ${pct(sh.share)} of stall`, tone: toneOf(sh.share) },
          { label: 'Worst joint', value: pct(worst), tone: toneOf(worst) },
          { label: 'Holding current', value: `${amps(b.amps)}, rail ${volts(b.restVolts)}` },
          { label: 'Start surge', value: `${amps(b.kick.amps)}, rail ${volts(b.kick.volts)}`, tone: b.resets ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

const flatPaper = (g: THREE.Object3D) => box(g, [0.15, 0.13, 0.001], mat('#e9e6dc', { rough: 0.9 }), [0.17, 0, 0.0005])

// --- Drive it with IK: target → servoArmIk → pulses → PCA9685 ticks; horn offsets, gear play and droop move the real hand. ---

const CALS = { raw: 'Horns by eye', trimmed: 'Trimmed in code', flipped: 'Elbow sign wrong' }
/** How far each horn actually sits from where the code assumes (a horn goes on in 14.4° teeth, so by eye ≤ half a tooth). */
const HORNS_DEG = [5, -6, 4, -3]
const TRUTH = ARM_CAL.map((c, i) => hornShift(c, HORNS_DEG[i]))
const CODE = { raw: ARM_CAL, trimmed: TRUTH, flipped: TRUTH.map((c, i) => (i === 2 ? reversed(c) : c)) }
const DRAW = { z: 0.04 - BASE_H, r: 0.04, periodS: 8, pitch: -90 * DEG, samples: 96 }
const DRIVES_PACK = [...ARM_BUILD.servos].map((s) => driveAt(ARM_SERVOS[s], ARM_SUPPLIES.pack.volts))
const ikParams = (p: Params) => ({ cal: pick(CALS, p.cal, 'raw'), play: n(p, 'play') * DEG, payload: n(p, 'payload') / 1000, reach: n(p, 'reach') })

/** Commanded joints for a hand point (pen straight down), nearest in-limit IK branch. */
function commandFor(target: P3) {
  const s = servoArmIk(target, DRAW.pitch)
  const sol = s.solutions.find((x) => x.inLimits) ?? s.solutions[0]
  return { q: sol.q, reachable: s.reachable && sol.inLimits }
}
function realFor(q: readonly number[], cal: keyof typeof CALS, play: number, payload: number) {
  const servo = actualJoints(q, CODE[cal], TRUTH)
  const tau = holdTorques(armMasses(servo, payload), servo)
  const sag = sagJoints(tau, DRIVES_PACK, play)
  return { servo, tau, sag, q: servo.map((v, i) => v + sag[i]) }
}
const targetAt = (reach: number, a: number): P3 => [reach + DRAW.r * Math.cos(a), DRAW.r * Math.sin(a), DRAW.z]
const loopOf = (x: ReturnType<typeof ikParams>) =>
  Array.from({ length: DRAW.samples + 1 }, (_, k) => {
    const tgt = targetAt(x.reach, (2 * Math.PI * k) / DRAW.samples)
    const cmd = commandFor(tgt)
    const real = realFor(cmd.q, x.cal, x.play, x.payload)
    return { tgt, cmd, real, hand: toolOf(armFk(SERVO_ARM, real.q)), err: handGap(cmd.q, real.q) }
  })

export const armBuildDriveIk: Lesson = {
  id: 'robot-arm-build-drive-it-with-ik',
  title: 'Drive it with IK',
  tagline: 'From a point in space to four pulse widths',
  formula: `q = IK(x, y, z, φ = −90°) · pulse = zero + k·q, k = ±${(100 / 9).toFixed(1)} µs/° · PCA9685 ticks = pulse·50 Hz·4096 · real q = (pulse − true zero)/k − (play/2 + τ/k_servo)`,
  legend: [
    { color: RING, label: 'Target circle (grey: its shadow)', shape: 'dot' },
    { color: HIGH_V, label: 'Real hand path', shape: 'dot' },
    { color: B_FIELD, label: 'Ghost: arm the IK commanded', shape: 'dot' },
    { color: LABEL, label: 'Pulses: µs and 12-bit ticks', shape: 'dot' },
  ],
  points: [
    'Driving the arm is a chain of the earlier pieces: a hand target goes through the closed-form servoArmIk from Multiple solutions (the pen points straight down, so φ = −90°), the controller keeps the branch that fits the joint limits, and each joint angle becomes a pulse width, 500…2500 µs for 0…180°, about 11 µs per degree. The ESP32 sends that over I²C to the PCA9685, which counts 4096 ticks per 20 ms frame: one tick is 4.9 µs, about 0.44°.',
    'Calibration maps code angles to real ones. A servo spline has 25 teeth, so a horn only goes on in 14.4° steps and by eye each joint ends up a few degrees off. Those offsets tilt the drawn circle and push it off target by centimetres. Measure each servo\'s true zero pulse and direction once, store them, and the error drops to the tick size. One servo mounted mirror-image but driven with the wrong sign is the classic first-build bug: the elbow bends up when it should bend down.',
    'What calibration cannot fix: gear play (see Backlash) and the servo\'s own P-loop. Gravity pushes each joint to one side of its play, and the loop only pushes back once it has drifted by τ/k, where k is the stall torque spread over the servo\'s proportional band. Both come from the holding torques of Assemble the arm, so a heavier payload sags the whole circle. At the hand each joint\'s error is multiplied by its distance from the hand, as in the Jacobian.',
    'For smooth moves, interpolate the target over time with a time-scaled path (see Time scaling) and run IK on every step, at 50 Hz or faster. Keep the solution branch fixed along the path so the arm never flips, and slow down near the reach edge where the Jacobian goes singular.',
  ],
  controls: [
    { kind: 'choice', key: 'cal', options: opts(CALS), initial: 'raw' },
    { kind: 'slider', key: 'play', label: 'Gear play per joint', min: 0, max: 6, step: 0.5, initial: 2, format: (v: number) => `${v}°` },
    gSlider,
    { kind: 'slider', key: 'reach', label: 'Circle centre out', min: 0.1, max: 0.24, step: 0.01, initial: 0.17, format: (v: number) => `${v.toFixed(2)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const d = deskBuild(scene, [-11, -7.6, 0], 28, [...ARM_BUILD.servos, ARM_BUILD.gripper])
    const ghost = serialArm(d.lifted, SERVO_ARM, { w: 0.022, t: 0.017, axes: false })
    ghostRig(ghost.group, B_FIELD, 0.18)
    const paper = flatPaper(d.g)
    const trail = dotPen(d.g, 600, 0.0022)
    const X = 1.6
    addLabel(scene, 'PCA9685 channel ← joint angle', [X, 3.75, 0.2], GREY, 0.28, 'left')
    const chans = JOINT_NAMES.map((_, i) => liveLabel(scene, [X, 2.95 - i * 0.78, 0.2], { size: 0.3, align: 'left' }))
    addLabel(scene, 'hand error, one cause at a time:', [X, -0.6, 0.2], GREY, 0.28, 'left')
    const parts = Array.from({ length: 4 }, (_, i) => liveLabel(scene, [X, -1.4 - i * 0.78, 0.2], { size: 0.3, align: 'left' }))

    const st = { t: 0, key: '', loop: [] as ReturnType<typeof loopOf>, q: [NaN, 0, 0, 0] }
    const nowOf = (x: ReturnType<typeof ikParams>) => {
      const a = (2 * Math.PI * st.t) / DRAW.periodS
      const tgt = targetAt(x.reach, a)
      const cmd = commandFor(tgt)
      const real = realFor(cmd.q, x.cal, x.play, x.payload)
      return { tgt, cmd, real }
    }
    return {
      scene,
      view: { center: [-1.2, -0.9, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const x = ikParams(p)
        const key = `${x.cal}|${x.play}|${x.payload}|${x.reach}`
        if (key !== st.key) Object.assign(st, { key, loop: loopOf(x) })
        paper.position.x = x.reach
        st.t += dt
        const { tgt, cmd, real } = nowOf(x)
        if (Number.isNaN(st.q[0])) st.q = [...real.q]
        st.q = st.q.map((v, i) => v + glide(dt, 0, wrapPi(real.q[i] - v), 18))
        const f = d.arm.set(st.q)
        ghost.set(cmd.q)
        d.pen.begin()
        d.leads(f)
        d.pen.end()
        d.pack.visible = true
        d.usb.visible = false
        const lift = (v: P3): V3 => [v[0], v[1], v[2] + BASE_H]
        trail.begin()
        st.loop.forEach((s, k) => {
          if (k === 0) return
          const prev = st.loop[k - 1]
          trail.line([prev.tgt[0], prev.tgt[1], 0.002], [s.tgt[0], s.tgt[1], 0.002], 0.008, GREY, 0.6)
          trail.line(lift(prev.tgt), lift(s.tgt), 0.006, RING, 0.8)
          trail.line(lift(prev.hand), lift(s.hand), 0.005, s.cmd.reachable ? HIGH_V : GREY, 0.9)
        })
        const hand = toolOf(f)
        trail.line([tgt[0], tgt[1], tgt[2] + BASE_H], [hand[0], hand[1], hand[2] + BASE_H], 0.004, LABEL, 0.7)
        trail.dot([tgt[0], tgt[1], tgt[2] + BASE_H], RING, 2.2)
        trail.end()

        cmd.q.forEach((q, i) => {
          const us = pulseUs(q, CODE[x.cal][i])
          const ticks = pcaTicks(us)
          d.board.lit(i, (us - 500) / 2000)
          chans[i].set(`CH${i} ${JOINT_NAMES[i].padEnd(8)} ${deg(q).padStart(7)} → ${Math.round(us)} µs = ${ticks} ticks`, JOINT_COLORS[i])
        })
        const err = handGap(cmd.q, real.q)
        const worst = Math.max(...st.loop.map((s) => s.err))
        const only = (dq: readonly number[]) => handGap(cmd.q, cmd.q.map((v, i) => v + dq[i]))
        const calOnly = only(real.servo.map((v, i) => v - cmd.q[i]))
        const tau = real.tau
        const playOnly = only(sagJoints(tau, DRIVES_PACK, x.play).map((v, i) => v - sagJoints(tau, DRIVES_PACK, 0)[i]))
        const droopOnly = only(sagJoints(tau, DRIVES_PACK, 0))
        parts[0].set(`calibration (${CALS[x.cal].toLowerCase()}): ${mmTenths(calOnly)}`, calOnly > 0.005 ? HIGH_V : POWER)
        parts[1].set(`gear play ±${(toDeg(x.play) / 2).toFixed(1)}° per joint: ${mmTenths(playOnly)}`, playOnly > 0.005 ? HEAT : LABEL)
        parts[2].set(`P-loop droop, arm + ${Math.round(x.payload * 1000)} g: ${mmTenths(droopOnly)}`, droopOnly > 0.005 ? HEAT : LABEL)
        parts[3].set(`together now ${mmTenths(err)} · worst on the circle ${mmTenths(worst)}`, err > 0.01 ? HIGH_V : POWER)
        const out = st.loop.some((s) => !s.cmd.reachable)
        status.set(`target (${tgt.map((v) => v.toFixed(3)).join(', ')}) m  →  q = (${cmd.q.map(deg).join(', ')})`, LABEL)
        sub.set(`circle r ${DRAW.r * 100} cm, ${Math.round((DRAW.z + BASE_H) * 100)} cm above the paper · ${HORN_TEETH}-tooth spline = ${TOOTH_DEG}° per tooth · horns off ${HORNS_DEG.map((h) => `${h > 0 ? '+' : '−'}${Math.abs(h)}°`).join(' ')}`, GREY)
        event.set(
          out ? 'part of the circle is out of reach or past a servo limit (grey): the IK clamps there' : x.cal === 'flipped' ? 'elbow driven with the wrong sign: it bends the other way and the hand misses by a mile' : x.cal === 'raw' ? 'horn offsets tilt and shift the drawing: measure each servo\'s zero and trim it in code' : 'trimmed: what is left is gear play and droop, which grow with the payload',
          out || x.cal === 'flipped' ? HIGH_V : x.cal === 'raw' ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const x = ikParams(p)
        const { cmd, real } = nowOf(x)
        const err = handGap(cmd.q, real.q)
        const worst = Math.max(...(st.loop.length ? st.loop : loopOf(x)).map((s) => s.err))
        const us = pulseUs(cmd.q[1], CODE[x.cal][1])
        return [
          { label: 'Hand error now', value: mmTenths(err), tone: err < 0.005 ? 'ok' : err < 0.015 ? 'warn' : 'bad' },
          { label: 'Worst on the circle', value: mmTenths(worst), tone: worst < 0.005 ? 'ok' : worst < 0.015 ? 'warn' : 'bad' },
          { label: 'Shoulder pulse', value: `${Math.round(us)} µs = ${pcaTicks(us)} ticks` },
          { label: 'Circle', value: (st.loop.length ? st.loop : loopOf(x)).every((s) => s.cmd.reachable) ? 'all reachable' : 'partly out of reach', tone: (st.loop.length ? st.loop : loopOf(x)).every((s) => s.cmd.reachable) ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
