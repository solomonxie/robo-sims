import * as THREE from 'three/webgpu'
import {
  ARM_TASK,
  CAR_TASK,
  DRIVES,
  Drive,
  DriveKind,
  INDEXER,
  Task,
  ampsAt,
  armGravityNm,
  armInertia,
  armStallRad,
  availableNm,
  checkDrive,
  continuousAmps,
  feasibleMoveS,
  firstAbove,
  heatRun,
  indexAt,
  indexMove,
  outputKt,
  peakTorque,
  ratedNm,
  rmsTorque,
  stallA,
  steadyTempC,
  torqueBudget,
} from '../../core/physics'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  addLabel,
  arrow,
  brushedMotor,
  cursorBar,
  glowMat,
  heatGlow,
  heatWaves,
  ivScreen,
  liveLabel,
  memoBy,
  meterBar,
  scope,
  setGlow,
  smoke,
  thermometer,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const nm = (x: number) => `${x.toFixed(x < 0.1 ? 3 : 2)} N·m`
const toRpm = (radS: number) => (radS * 60) / (2 * Math.PI)
const DRIVE_NAMES = Object.fromEntries((Object.keys(DRIVES) as DriveKind[]).map((k) => [k, DRIVES[k].name])) as Record<DriveKind, string>

/** Drive as a real-proportioned part (1 unit = 10 mm before `k`), output shaft at the origin along +z; `set(angle, heat)`. */
function driveModel(parent: THREE.Object3D, kind: DriveKind, at: V3, k: number) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(k)
  const body = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.4, roughness: 0.4 })
  const dark = new THREE.MeshStandardMaterial({ color: '#25272d', roughness: 0.55 })
  if (kind === 'tt') {
    box(group, [3.7, 2.2, 1.9], mat('#f2c230', { rough: 0.5 }), [-1.2, 0, -1])
    cylinder(group, 1, 2.6, body, [-4.3, 0, -1], 'x', 24)
  } else if (kind === 'n20') {
    box(group, [1.2, 1, 0.9], mat('#d9b24a', { metal: 0.45, rough: 0.35 }), [0, 0, -0.45])
    cylinder(group, 0.6, 1.5, body, [0, 0, -1.65], 'z', 20)
  } else if (kind === 'g37') {
    cylinder(group, 1.85, 2.2, mat('#d4d7dc', { metal: 0.45, rough: 0.35 }), [0, 0, -1.1], 'z', 36)
    cylinder(group, 1.75, 3.5, body, [0, 0, -3.95], 'z', 36)
    cylinder(group, 1.6, 0.3, mat('#1c1c1f', { rough: 0.7 }), [0, 0, -5.85], 'z', 36)
  } else if (kind === 'nema17') {
    box(group, [4.2, 4.2, 3.4], dark, [0, 0, -2])
    for (const z of [-0.15, -3.85]) box(group, [4.2, 4.2, 0.3], mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, 0, z])
  } else {
    box(group, [4, 2, 3.7], dark, [-1, 0, -1.95])
    box(group, [5.4, 2, 0.25], dark, [-1, 0, -0.9])
  }
  const shaft = add(group, new THREE.Group())
  cylinder(shaft, kind === 'n20' ? 0.15 : 0.3, 1, mat('#d4d7dc', { metal: 0.45, rough: 0.35 }), [0, 0, 0.5], 'z', 16)
  if (kind === 'servo') cylinder(shaft, 1, 0.25, mat('#f2f2f2'), [0, 0, 0.9], 'z', 24)
  box(shaft, [0.12, kind === 'servo' ? 1.8 : 0.8, 0.12], glowMat('#ffffff', 0.4), [0, kind === 'servo' ? 0.5 : 0.2, 1.05])
  const glow = kind === 'nema17' || kind === 'servo' ? dark : body
  return {
    group,
    set(angle: number, heat: number) {
      shaft.rotation.z = -angle
      heatGlow(glow, heat)
    },
  }
}

// --- Torque budget: sum the torques one motor must give, add margin, check it under each drive's T–ω curve. ---

const TASKS = { car0: 'Car, flat floor', car15: 'Car, 15° ramp', car30: 'Car, 30° ramp', arm100: 'Arm, 100 g', arm500: 'Arm, 500 g' }
const TASK_OF: Record<keyof typeof TASKS, Task> = {
  car0: { kind: 'car', ...CAR_TASK, slopeDeg: 0 },
  car15: { kind: 'car', ...CAR_TASK, slopeDeg: 15 },
  car30: { kind: 'car', ...CAR_TASK, slopeDeg: 30 },
  arm100: { kind: 'arm', ...ARM_TASK, payloadKg: 0.1 },
  arm500: { kind: 'arm', ...ARM_TASK, payloadKg: 0.5 },
}
const PLOT = { car: { rpm: 360, nm: 0.25 }, arm: { rpm: 80, nm: 1.6 } }
const TB = { rampLen: 14, wheelR: 0.9, carSlow: 3, unitsPerM: 0.9 / CAR_TASK.wheelM, barX: -18, barW: 14, barY: -7.6, lowDeg: -45, highDeg: 35, holdS: 0.8 }
const budgetParams = (p: Params) => {
  const tk = pick(TASKS, p.task, 'car15')
  const dk = pick(DRIVES, p.drive, 'tt') as DriveKind
  const margin = n(p, 'margin')
  const task = TASK_OF[tk]
  const d: Drive = DRIVES[dk]
  const b = torqueBudget(task)
  return { tk, dk, d, task, margin, b, c: checkDrive(d, b, margin), stallRad: task.kind === 'arm' ? armStallRad(d, task) : null }
}
type BudgetQ = ReturnType<typeof budgetParams>
const VERDICT_TONE = { ok: 'ok', thin: 'warn', slow: 'bad', weak: 'bad', stall: 'bad' } as const
const toneOf = { ok: POWER, warn: HEAT, bad: HIGH_V }

function verdictText(q: BudgetQ) {
  const { d, c, b, task } = q
  const goes = task.kind === 'car' ? 'climbs' : 'lifts'
  if (c.verdict === 'stall') {
    if (d.kind === 'stepper') return `${d.name}: slips out of step${q.stallRad !== null ? ` at ${Math.round((q.stallRad * 180) / Math.PI)}°` : ''}, load drops`
    return `${d.name}: stalls${q.stallRad !== null ? ` at ${Math.round((q.stallRad * 180) / Math.PI)}°` : ''}, drawing ${stallA(d).toFixed(1)} A`
  }
  if (c.verdict === 'slow') return `${d.name}: tops out at ${Math.round(c.rpm)} of ${Math.round(b.targetRpm)} rpm`
  if (c.verdict === 'weak') return `${d.name}: ${task.kind === 'car' ? 'crawls' : 'lifts slowly'} at ${Math.round(c.rpm)} of ${Math.round(b.targetRpm)} rpm`
  if (c.verdict === 'thin') return `${d.name}: ${goes}, but only ${c.ratio.toFixed(1)}× (wanted ${q.margin.toFixed(1)}×)`
  return `${d.name}: ${goes} with ${c.ratio.toFixed(1)}× margin${c.ratio > 6 ? ', oversized' : ''}`
}

export const torqueBudgetLesson: Lesson = {
  id: 'motor-selection-torque-budget',
  title: 'Torque budget',
  tagline: 'Add up what the load needs, then pick a motor',
  formula: (p) => {
    const { b, margin, c } = budgetParams(p)
    return `T = T_grav + T_roll + T_acc + T_fric = ${b.gravity.toFixed(3)} + ${b.rolling.toFixed(3)} + ${b.accel.toFixed(3)} + ${b.friction.toFixed(3)} = ${nm(b.peak)} · ×${margin.toFixed(1)} = ${nm(c.need)} vs motor ${nm(c.available)} at ${Math.round(b.targetRpm)} rpm`
  },
  legend: [
    { color: POWER, label: 'Motor curve: torque it can give', shape: 'dot' },
    { color: LOW_V, label: 'Gravity', shape: 'dot' },
    { color: DATA_COLOR, label: 'Rolling + bearings', shape: 'dot' },
    { color: FORCE, label: 'Acceleration (peak)', shape: 'dot' },
    { color: RING, label: 'Safety margin', shape: 'dot' },
  ],
  points: [
    'Choosing a motor starts at the load, not the catalogue. Work out the torque one motor must give at its output shaft, then find a drive whose torque–speed curve covers that point at the speed you need.',
    'Gravity: a car on a slope needs m·g·sin θ of pull, an arm m·g·L·cos θ at the shoulder (worst when horizontal). Rolling resistance adds Crr·m·g·cos θ, bearings and gear friction a little more. Pull × wheel radius ÷ driven wheels = torque per motor.',
    'Acceleration needs extra: m·a·r for the car, J·α for the arm (J = m·L² for a tip payload). It only lasts while speeding up, but the motor must give it at speed, so check the peak at the top speed.',
    'Multiply by a safety margin (1.5–2×) for battery sag, a warm motor, dirt and payloads that grow. Then the margin point must sit under the curve: a DC gearmotor\'s straight line, a stepper\'s pull-out curve or a servo\'s line.',
    'Failures look different: a DC motor slows down its line and crawls, or stalls drawing V/R; a stepper keeps speed until the load passes pull-out, then slips and drops it; a servo is strong but slow. And the biggest motor isn\'t free: weight, current and cost.',
  ],
  controls: [
    { kind: 'choice', key: 'task', options: opts(TASKS), initial: 'car15' },
    { kind: 'choice', key: 'drive', options: opts(DRIVE_NAMES), initial: 'tt' },
    { kind: 'slider', key: 'margin', label: 'Safety margin', min: 1, max: 2.5, step: 0.1, initial: 1.5, format: (v) => `${v.toFixed(1)}×` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const kinds = Object.keys(DRIVES) as DriveKind[]
    const status = liveLabel(scene, [-19, 6.4, 0.4], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-19, 5.5, 0.4], { size: 0.3, color: GREY, align: 'left' })

    // Car on a ramp; the drive sits on the rear axle.
    const carSide = add(scene, new THREE.Group())
    const ramp = add(carSide, new THREE.Group(), [-18.5, -4, 0])
    box(ramp, [TB.rampLen + 1, 0.4, 3], mat('#6b5a45', { rough: 0.9 }), [TB.rampLen / 2, -0.2, 0])
    const car = add(ramp, new THREE.Group())
    box(car, [4.2, 0.2, 2.4], mat('#d8dbe2', { rough: 0.55 }), [0, 1.9, 0])
    box(car, [1.6, 0.7, 1.2], mat('#2f6fb0', { rough: 0.5 }), [0.4, 2.35, 0])
    const wheels = [-1.4, 1.4].map((x) => {
      const w = add(car, buildWheel(), [x, TB.wheelR, 1.45])
      w.scale.setScalar(TB.wheelR / 12.8)
      return w
    })
    const carDrives = kinds.map((k) => {
      const m = driveModel(car, k, [-1.4, TB.wheelR, 2.15], 0.28)
      m.group.rotation.y = Math.PI
      return m
    })
    const carHeat = heatWaves(car, 1, { count: 3, rise: 2.5 })
    carHeat.group.position.set(-1.4, 1.6, 1.4)
    carHeat.group.scale.setScalar(0.6)

    // Arm on a stand; the drive is the shoulder.
    const armSide = add(scene, new THREE.Group())
    const shoulder: V3 = [-12, 2.4, 0]
    box(armSide, [7, 0.5, 2.4], mat('#3a3d45', { rough: 0.7 }), [shoulder[0], -5.3, -1.8])
    box(armSide, [1.4, 7.7, 1.4], mat('#9aa0a8', { metal: 0.3, rough: 0.5 }), [shoulder[0], -1.3, -1.6])
    const armDrives = kinds.map((k) => driveModel(armSide, k, [shoulder[0], shoulder[1], 0], 0.5))
    const arm = add(armSide, new THREE.Group(), [shoulder[0], shoulder[1], 0.9])
    box(arm, [6.2, 0.6, 0.35], mat('#d8dbe2', { metal: 0.25, rough: 0.45 }), [2.6, 0, 0])
    const payload = box(arm, [1, 1, 1], mat('#5a5f69', { metal: 0.3, rough: 0.5 }), [5.4, -0.9, 0])
    const payloadTag = liveLabel(scene, [0, 0, 1.4], { size: 0.36 })
    const armHeat = heatWaves(armSide, 1.4, { count: 3, rise: 1.8 })
    armHeat.group.position.set(shoulder[0], shoulder[1] + 0.9, 0.8)
    armHeat.group.scale.setScalar(0.6)

    // Torque budget bar, same scale as the plot's torque axis.
    const segs = [LOW_V, DATA_COLOR, FORCE, RING].map((c, i) => box(scene, [1, 0.9, 0.5], glowMat(c, i === 3 ? 0.35 : 0.6), [0, TB.barY, 0]))
    box(scene, [TB.barW + 0.4, 1.3, 0.4], mat('#1c1e24', { rough: 0.6 }), [TB.barX + TB.barW / 2, TB.barY, -0.5])
    const availMark = box(scene, [0.16, 1.9, 0.7], glowMat(POWER, 0.8), [0, TB.barY, 0])
    const availTag = liveLabel(scene, [0, TB.barY + 1.4, 0.4], { size: 0.32, color: POWER })
    const needTag = liveLabel(scene, [0, TB.barY - 1.25, 0.4], { size: 0.32, color: RING })

    const { plot, dot, y } = ivScreen(scene, [6.6, 1.4, 0], 10.5, 7, [6, 4])
    dot.scale.setScalar(0.7)
    const curve = plot.trace(POWER, { samples: 120, radius: 0.09 })
    const target = cursorBar(plot, GREY, 0.05)
    const peakDot = add(plot.group, new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), glowMat(FORCE, 1)))
    const needDot = add(plot.group, new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), glowMat(RING, 1)))
    const needLbl = liveLabel(plot.group, [0, 0, 0.4], { size: 0.32, color: RING, align: 'left' })
    const axisTag = liveLabel(scene, [6.6, -2.9, 0.3], { size: 0.3, color: GREY })
    const curveTag = liveLabel(plot.group, [0, 0, 0.4], { size: 0.34, color: POWER, align: 'left' })

    const st = { key: '', t: 0, x: 0, v: 0, th: (TB.lowDeg * Math.PI) / 180, w: 0, phase: 0, hold: 0, heat: 0, angle: 0 }
    return {
      scene,
      view: { center: [-3, -0.2, 0], radius: 56, polar: 1.45, azimuth: 0.1 },
      frame(dt, p) {
        const q = budgetParams(p)
        const { b, c, d, task } = q
        const R = PLOT[task.kind]
        const xU = (rpm: number) => Math.min(1, rpm / R.rpm)
        const yT = (t: number) => y(Math.min(1.02, t / R.nm))
        const key = `${q.tk}|${q.dk}|${q.margin}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, x: 0, v: 0, th: (TB.lowDeg * Math.PI) / 180, w: 0, phase: 0, hold: 0 })
          curve.draw((u) => yT(availableNm(d, u * R.rpm)), null)
          target(xU(b.targetRpm))
          peakDot.position.set(plot.xAt(xU(b.targetRpm)), yT(b.peak), 0.35)
          needDot.position.set(plot.xAt(xU(b.targetRpm)), yT(c.need), 0.35)
          needLbl.group.position.set(plot.xAt(xU(b.targetRpm)) + 0.5, yT(c.need) + 0.15, 0.4)
          needLbl.set(`need ×${q.margin.toFixed(1)}`)
          curveTag.group.position.set(plot.xAt(0.03), Math.min(plot.height / 2 - 0.5, yT(availableNm(d, 0)) + 0.5), 0.4)
          curveTag.set(d.kind === 'stepper' ? 'pull-out' : d.name)
          axisTag.set(`rpm 0…${R.rpm} · 0…${R.nm} N·m · grey: target ${Math.round(b.targetRpm)} rpm`)
          const parts = [b.gravity, b.rolling + b.friction, b.accel, c.need - b.peak]
          let x0 = TB.barX
          segs.forEach((s, i) => {
            const w = (Math.max(0.001, parts[i]) / R.nm) * TB.barW
            s.scale.x = Math.min(w, TB.barX + TB.barW - x0 + 0.001)
            s.position.x = x0 + s.scale.x / 2
            x0 += s.scale.x
          })
          needTag.group.position.x = Math.min(TB.barX + TB.barW - 1, x0)
          needTag.set(`need ×${q.margin.toFixed(1)}: ${nm(c.need)}`)
          availMark.position.x = TB.barX + Math.min(1.02, c.available / R.nm) * TB.barW
          availTag.group.position.x = Math.max(TB.barX + 2.4, availMark.position.x)
          availTag.set(`motor gives ${nm(c.available)}`)
        }
        const isCar = task.kind === 'car'
        carSide.visible = isCar
        armSide.visible = !isCar
        kinds.forEach((k, i) => {
          carDrives[i].group.visible = isCar && k === q.dk
          armDrives[i].group.visible = !isCar && k === q.dk
        })
        const stalled = c.verdict === 'stall'
        st.heat = Math.min(1, Math.max(0, st.heat + dt * (stalled ? 0.5 : -1)))
        let rpmNow = 0
        let tNow = b.steady
        if (task.kind === 'car') {
          ramp.rotation.z = (task.slopeDeg * Math.PI) / 180
          const vTop = (c.rpm / 60) * 2 * Math.PI * task.wheelM
          const accelling = st.v < vTop - 1e-6
          st.v = Math.min(vTop, st.v + task.accel * dt)
          st.x += (st.v * dt * TB.unitsPerM) / TB.carSlow
          if (st.x > TB.rampLen - 4) Object.assign(st, { x: 0, v: 0 })
          const jitter = stalled ? 0.04 * Math.sin(st.t * 60) : 0
          car.position.x = 2 + st.x + jitter
          const wheelAng = st.x / TB.wheelR + jitter * 3
          for (const w of wheels) w.rotation.z = -wheelAng
          carDrives[kinds.indexOf(q.dk)].set(wheelAng, st.heat)
          carHeat.step(dt, stalled ? st.heat : 0)
          rpmNow = (st.v / task.wheelM) * (60 / (2 * Math.PI))
          tNow = stalled ? b.steady : accelling ? b.peak : b.steady
          sub.set(`${task.massKg} kg car, 2 driven 65 mm wheels, ${task.speed} m/s · ${TB.carSlow}× slower`)
        } else {
          const lo = (TB.lowDeg * Math.PI) / 180
          const sr = q.stallRad
          const up = sr === null ? (TB.highDeg * Math.PI) / 180 : sr
          const hangs = sr !== null && sr <= lo
          const wTop = c.rpm > 0 ? (c.rpm / 60) * 2 * Math.PI : 0.6
          let alpha = 0
          let stuck = false
          if (hangs) {
            st.th = sr
            st.w = 0
            stuck = true
          } else if (st.hold > 0) {
            st.hold -= dt
            st.w = 0
            stuck = sr !== null && st.phase === 0
            if (st.hold <= 0) st.phase = 1 - st.phase
          } else if (st.w < -3) {
            st.th += st.w * dt
            if (st.th <= lo) Object.assign(st, { th: lo, w: 0, hold: TB.holdS })
          } else {
            const goal = st.phase === 0 ? up : lo
            const left = Math.abs(goal - st.th)
            if (left < 1e-3) {
              st.th = goal
              st.w = 0
              const slips = sr !== null && st.phase === 0 && d.kind === 'stepper'
              if (slips) Object.assign(st, { phase: 1, w: -6 })
              else st.hold = sr !== null && st.phase === 0 ? 2.2 : TB.holdS
            } else {
              const dir = Math.sign(goal - st.th)
              const wWant = dir * Math.min(wTop, Math.sqrt(2 * task.alpha * left))
              const dw = Math.max(-task.alpha * dt, Math.min(task.alpha * dt, wWant - st.w))
              alpha = dw / dt
              st.w += dw
              st.th += st.w * dt
              if ((dir > 0 && st.th > goal) || (dir < 0 && st.th < goal)) st.th = goal
            }
          }
          const jitter = stuck ? 0.012 * Math.sin(st.t * 70) : 0
          arm.rotation.z = st.th + jitter
          armDrives[kinds.indexOf(q.dk)].set(-st.th - jitter, st.heat)
          armHeat.step(dt, stalled ? st.heat : 0)
          const s = 0.7 + 1.4 * Math.cbrt(task.payloadKg)
          payload.scale.setScalar(s)
          payload.position.y = -0.3 - s / 2
          const tip = new THREE.Vector3(5.4, -0.3 - s - 0.5, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), arm.rotation.z)
          payloadTag.group.position.set(shoulder[0] + tip.x, shoulder[1] + tip.y, 1.4)
          payloadTag.set(`${Math.round(task.payloadKg * 1000)} g`, LABEL)
          rpmNow = Math.abs(toRpm(st.w))
          tNow = armGravityNm(task, st.th) + task.bearingNm + (stuck ? 0 : armInertia(task) * alpha)
          sub.set(`15 cm arm, lifts at ${Math.round(toRpm(task.speedRadS) * 6)}°/s, α ${task.alpha} rad/s² · real time`)
        }
        st.t += dt
        dot.position.set(plot.xAt(xU(rpmNow)), yT(Math.max(0, tNow)), 0.4)
        setGlow(dot.material as THREE.MeshStandardMaterial, stalled ? HIGH_V : '#ffffff', 1.4)
        status.set(verdictText(q), toneOf[VERDICT_TONE[c.verdict]])
      },
      readouts: (p) => {
        const { b, c, d, margin } = budgetParams(p)
        const tone = VERDICT_TONE[c.verdict]
        return [
          { label: `Need (peak × ${margin.toFixed(1)})`, value: nm(c.need) },
          { label: `Motor at ${Math.round(b.targetRpm)} rpm`, value: nm(c.available), tone },
          { label: 'Speed', value: `${Math.round(c.rpm)} / ${Math.round(b.targetRpm)} rpm`, tone: c.rpm >= b.targetRpm - 0.5 ? 'ok' : 'bad' },
          { label: d.kind === 'stepper' ? 'Mass · phase current' : 'Mass · stall current', value: `${d.massG} g · ${(d.kind === 'stepper' ? d.noLoadA : stallA(d)).toFixed(1)} A` },
        ]
      },
    }
  },
}

// --- Duty cycle: an indexing table's accel / cruise / brake / dwell; peak vs the curve, RMS vs the continuous rating. ---

const DUTY_DRIVES = { n20: DRIVES.n20.name, g37: DRIVES.g37.name }
const DC = { x: -11, y: 0.4, r: 4, plotX: 6.2, plotY: 2.8, plotW: 10, plotH: 5.6 }
const SEG_COLORS = [FORCE, GREY, B_FIELD, LABEL]
const dutyParams = (p: Params) => {
  const dk = pick(DUTY_DRIVES, p.drive, 'g37') as DriveKind
  const d: Drive = DRIVES[dk]
  const asked = n(p, 'move')
  const dwell = n(p, 'dwell')
  const moveS = feasibleMoveS(d, asked)
  const m = indexMove(moveS, dwell)
  const askedPeak = peakTorque(indexMove(asked, dwell).segs)
  const peak = peakTorque(m.segs)
  const limit = availableNm(d, toRpm(m.vmax))
  return { dk, d, asked, dwell, moveS, m, run: m, askedPeak, peak, limit, rms: rmsTorque(m.segs), rated: ratedNm(d), slowed: moveS > asked + 1e-6 }
}

export const dutyCycleLesson: Lesson = {
  id: 'motor-selection-duty-cycle',
  title: 'Duty cycle',
  tagline: 'Peak torque is brief; RMS torque is what heats',
  formula: (p) => {
    const { m, rms, rated, peak, limit } = dutyParams(p)
    const [a, c, b, w] = m.segs
    return `T_rms = √(Σ T²·t / T_cycle) = √((${a.torque.toFixed(2)}²·${a.dur.toFixed(2)} + ${c.torque.toFixed(2)}²·${c.dur.toFixed(2)} + ${b.torque.toFixed(2)}²·${b.dur.toFixed(2)} + 0²·${w.dur.toFixed(1)}) / ${m.cycle.toFixed(2)}) = ${nm(rms)} vs rated ${nm(rated)} · peak J·α + T_f = ${nm(peak)} vs ${nm(limit)}`
  },
  legend: [
    { color: FORCE, label: 'Torque (arrow: speeding up)', shape: 'dot' },
    { color: B_FIELD, label: 'Braking torque (arrow)', shape: 'dot' },
    { color: RING, label: 'RMS torque', shape: 'dot' },
    { color: POWER, label: 'Continuous rating', shape: 'dot' },
    { color: HIGH_V, label: 'Peak the curve allows', shape: 'dot' },
  ],
  points: [
    'Few robot motors run at one steady load. A pick-and-place axis or an indexing table accelerates, cruises, brakes and then waits, over and over. Each part of the move needs a different torque: J·α + friction to speed up, friction to cruise, −J·α + friction to brake, nothing to wait.',
    'Two ratings matter. The peak (intermittent) limit is the T–ω curve at the move\'s top speed: ask for more and the motor simply can\'t follow, so the move stretches. The continuous (S1) rating is the torque it can give forever without overheating.',
    'Heat comes from I²R and current follows torque, so what warms the winding over the minutes-long thermal time constant is the RMS torque: √(Σ T²·t / cycle). Short spikes far above the rating are fine if the RMS stays under it.',
    'Faster moves raise α with 1/t², so peak torque quadruples when you halve the move time, and the RMS climbs with it. Dwell time doesn\'t touch the peak but dilutes the RMS: ×√(move / cycle).',
    'Size a motor so the peak sits under its curve and the RMS under its continuous rating, with margin on both. Datasheets often quote the intermittent number in big print.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DUTY_DRIVES), initial: 'g37' },
    { kind: 'slider', key: 'move', label: 'Move time (90°)', min: 0.2, max: 1.5, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} s` },
    { kind: 'slider', key: 'dwell', label: 'Dwell', min: 0, max: 2, step: 0.1, initial: 0, format: (v) => `${v.toFixed(1)} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-19, 8.6, 0.4], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-19, 7.5, 0.4], { size: 0.34, color: GREY, align: 'left' })
    box(scene, [3, 5, 2.2], mat('#3a3d45', { rough: 0.7 }), [DC.x, DC.y - 4.5, -2])
    box(scene, [8, 0.5, 4], mat('#3a3d45', { rough: 0.7 }), [DC.x, DC.y - 7.2, -1])
    const drives = (Object.keys(DUTY_DRIVES) as DriveKind[]).map((k) => {
      const m = driveModel(scene, k, [DC.x, DC.y, 0.7], 0.45)
      m.group.rotation.y = Math.PI
      return { k, m }
    })
    const table = add(scene, new THREE.Group(), [DC.x, DC.y, 0])
    cylinder(table, DC.r, 0.5, mat('#9aa0a8', { metal: 0.35, rough: 0.45 }), [0, 0, 0], 'z', 64)
    cylinder(table, 0.8, 0.7, mat('#3a3d45', { rough: 0.6 }), [0, 0, 0.2], 'z', 24)
    ;['#e0533d', '#f2c230', '#3fa34d', '#2f6fb0'].forEach((c, i) => {
      const a = (i * Math.PI) / 2
      box(table, [1.3, 1.3, 1.1], mat(c, { rough: 0.5 }), [2.8 * Math.cos(a), 2.8 * Math.sin(a), 0.7])
    })
    addLabel(scene, `${INDEXER.inertia} kg·m² table, 90° per index`, [DC.x, DC.y - 8.3, 0.4], GREY, 0.32)
    const fwd = arrow(scene, [DC.x, DC.y + DC.r + 0.9, 0.6], [1, 0, 0], FORCE, 1)
    const back = arrow(scene, [DC.x, DC.y + DC.r + 0.9, 0.6], [-1, 0, 0], B_FIELD, 1)
    const segTag = liveLabel(scene, [DC.x, DC.y + DC.r + 2.4, 0.6], { size: 0.4 })

    const plot = scope(scene, DC.plotW, DC.plotH, { divs: [7, 4], zeroAt: 0.5 })
    plot.group.position.set(DC.plotX, DC.plotY, 0)
    const tr = plot.trace(FORCE, { samples: 240, radius: 0.07 })
    const rmsLine = plot.level(RING)
    const ratedLine = plot.level(POWER)
    const limitLine = plot.level(HIGH_V)
    const cursor = cursorBar(plot, LABEL, 0.05)
    const plotCap = liveLabel(scene, [DC.plotX, DC.plotY - DC.plotH / 2 - 1.2, 0.3], { size: 0.3, color: GREY })
    addLabel(scene, 'torque over one cycle', [DC.plotX, DC.plotY + DC.plotH / 2 + 0.9, 0.3], LABEL, 0.32)
    const peakBar = meterBar(scene, [3.4, -3.9, 0], 5.6, 2, [[1, 'limit', HIGH_V]], 'Peak')
    const rmsBar = meterBar(scene, [3.4, -7, 0], 5.6, 2, [[1, 'rated', POWER]], 'RMS')

    const st = { key: '', t: 0, idx: 0, heat: 0 }
    return {
      scene,
      view: { center: [-2.6, -0.4, 0], radius: 56, polar: 1.45, azimuth: 0.18 },
      frame(dt, p) {
        const q = dutyParams(p)
        const key = `${q.dk}|${q.asked}|${q.dwell}`
        const yMax = 1.25 * q.d.stallNm
        const yOf = (t: number) => (t / yMax) * (DC.plotH / 2)
        if (key !== st.key) {
          st.key = key
          st.t = 0
          drives.forEach(({ k, m }) => (m.group.visible = k === q.dk))
          rmsLine.set(yOf(q.rms))
          ratedLine.set(yOf(q.rated))
          limitLine.set(yOf(q.limit))
          plotCap.set(`0…${q.run.cycle.toFixed(2)} s · ±${yMax.toFixed(2)} N·m`)
        }
        const cyc = q.run.cycle
        const prev = indexAt(st.t, q.moveS, q.dwell)
        st.t += dt
        const now = indexAt(st.t, q.moveS, q.dwell)
        if (now.tc < prev.tc) st.idx++
        table.rotation.z = -((st.idx + now.pos) * Math.PI) / 2
        const seg = q.run.segs[now.seg]
        const segAt = (t: number) => q.run.segs[indexAt(t, q.moveS, q.dwell).seg].torque
        tr.draw((u) => yOf(segAt(Math.min(u, 0.9999) * cyc)), now.tc / cyc)
        cursor(now.tc / cyc)
        const T = seg.torque
        const k = Math.min(1.6, 0.35 + (1.2 * Math.abs(T)) / q.d.stallNm)
        fwd.visible = T > 1e-6 && now.seg < 3
        back.visible = T < -1e-6
        fwd.scale.setScalar(k)
        back.scale.setScalar(k)
        segTag.set(seg.name, SEG_COLORS[now.seg])
        const hot = q.rms > q.rated
        st.heat = Math.min(hot ? Math.min(1, q.rms / q.rated - 0.6) : 0, st.heat + dt * 0.3)
        if (!hot) st.heat = Math.max(0, st.heat - dt)
        drives.find((x) => x.k === q.dk)!.m.set(table.rotation.z, st.heat)
        peakBar(q.peak / q.limit, `${Math.round((100 * q.peak) / q.limit)} %`, q.slowed ? HIGH_V : q.peak > 0.8 * q.limit ? HEAT : POWER)
        rmsBar(q.rms / q.rated, `${Math.round((100 * q.rms) / q.rated)} %`, hot ? HIGH_V : q.rms > 0.8 * q.rated ? HEAT : POWER)
        status.set(
          q.slowed
            ? `Asked ${nm(q.askedPeak)}: move stretches to ${q.moveS.toFixed(2)} s`
            : hot
              ? 'Keeps up, but RMS > rated: overheats'
              : `Peak and RMS both fit: ${Math.round((100 * q.rms) / q.rated)} % of rating`,
          q.slowed || hot ? HIGH_V : POWER,
        )
        sub.set(`${q.d.name} geared, ${(q.m.alpha).toFixed(0)} rad/s², top ${Math.round(toRpm(q.m.vmax))} rpm · real time`)
      },
      readouts: (p) => {
        const q = dutyParams(p)
        return [
          { label: 'Peak / limit', value: `${nm(q.peak)} / ${nm(q.limit)}`, tone: q.slowed ? 'bad' : q.peak > 0.8 * q.limit ? 'warn' : 'ok' },
          { label: 'RMS / rated', value: `${nm(q.rms)} / ${nm(q.rated)}`, tone: q.rms > q.rated ? 'bad' : q.rms > 0.8 * q.rated ? 'warn' : 'ok' },
          { label: 'Moving', value: `${Math.round((100 * q.moveS) / q.m.cycle)} % of ${q.m.cycle.toFixed(2)} s`, tone: q.slowed ? 'bad' : 'ok' },
          { label: 'Top speed', value: `${Math.round(toRpm(q.m.vmax))} rpm` },
        ]
      },
    }
  },
}

// --- Thermal limits: the winding heats with I²R under a duty cycle toward a steady temperature, τ = Rth·C; hot air derates it. ---

const AMBIENTS = { a25: '25 °C room', a40: '40 °C enclosure', a60: '60 °C in the sun' }
const AMB_C = { a25: 25, a40: 40, a60: 60 }
const TH = { seconds: 900, dt: 1, playS: 30, holdS: 3, periodS: 20, plotW: 11, plotH: 7, lo: 20, hi: 200 }
const TD = DRIVES.g37
const heatMemo = memoBy(
  (q: { load: number; duty: number; amb: number }) => `${q.load}|${q.duty}|${q.amb}`,
  (q) => heatRun(TD, q.load, q.duty, TH.periodS, q.amb, TH.seconds, TH.dt),
)
const thermParams = (p: Params) => {
  const f = n(p, 'load') / 100
  const duty = n(p, 'duty') / 100
  const ak = pick(AMBIENTS, p.amb, 'a25')
  const amb = AMB_C[ak]
  const load = f * ratedNm(TD)
  const run = heatMemo({ load, duty, amb })
  return { f, duty, ak, amb, load, run, amps: ampsAt(TD, load), ss: steadyTempC(TD, load, duty, amb), cookAt: firstAbove(run, TD.maxC), rated: ratedNm(TD, amb) }
}
const minText = (s: number) => `${(s / 60).toFixed(1)} min`

export const thermalLimitsLesson: Lesson = {
  id: 'motor-selection-thermal-limits',
  title: 'Thermal limits',
  tagline: 'Copper heats with I²R until something gives',
  formula: (p) => {
    const q = thermParams(p)
    return `ΔT = D·I²·R·Rth·(1 − e^(−t/τ)) · I = I₀ + T/kt = ${TD.noLoadA} + ${q.load.toFixed(2)}/${outputKt(TD).toFixed(2)} = ${q.amps.toFixed(2)} A · steady ${q.amb} + ${(q.duty * 100).toFixed(0)} %·${q.amps.toFixed(2)}²·${TD.ohms}·${TD.kPerW} K/W ≈ ${Number.isFinite(q.ss) ? q.ss.toFixed(0) : '∞'} °C vs ${TD.maxC} °C · τ = Rth·C = ${TD.tauS} s`
  },
  legend: [
    { color: HEAT, label: 'Winding temperature', shape: 'dot' },
    { color: RING, label: 'Steady temperature', shape: 'dot' },
    { color: HIGH_V, label: 'Insulation limit', shape: 'dot' },
    { color: LOW_V, label: 'Ambient air', shape: 'dot' },
    { color: GREY, label: 'One time constant τ', shape: 'dot' },
  ],
  points: [
    'Every amp through the winding turns I²R into heat. The copper and iron soak it up (heat capacity C) and pass it to the air through a thermal resistance Rth (K/W), so the temperature rises along 1 − e^(−t/τ) toward ambient + P·Rth, with time constant τ = Rth·C.',
    `For this 37 mm gearmotor τ ≈ ${TD.tauS / 60} min: after one τ it has made 63 % of its rise, after 3τ 95 %. That is why a motor survives a brief overload but cooks under the same load held for minutes.`,
    'Under a duty cycle the average power is what counts: run half the time and the steady rise halves, with a small ripple on top as long as the period is much shorter than τ. Copper\'s resistance also rises 0.39 % per K, so a hot motor heats even faster, and past a point it runs away.',
    'The continuous rating is the current that brings the winding to its limit from 25 °C. In a 60 °C enclosure or in the sun there is less headroom, so the allowed current falls as √(T_max − T_air): derate the torque.',
    'Past the limit the enamel on the magnet wire softens and burns, turns short, magnets weaken and plastic gears melt: a cooked motor smells first, then draws more current and dies. Current limits, temperature sensors and duty limits in firmware prevent it.',
  ],
  controls: [
    { kind: 'slider', key: 'load', label: 'Load', min: 25, max: 250, step: 25, initial: 150, format: (v) => `${v} % of rated` },
    { kind: 'slider', key: 'duty', label: 'Duty', min: 10, max: 100, step: 10, initial: 30, format: (v) => `${v} % on` },
    { kind: 'choice', key: 'amb', options: opts(AMBIENTS), initial: 'a25' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-19, 8.8, 0.4], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-19, 7.9, 0.4], { size: 0.3, color: GREY, align: 'left' })
    const motor = brushedMotor(scene, [-12, 0.6, 0], 2.2)
    motor.group.rotation.y = 0.35
    const waves = heatWaves(scene, 4, { count: 5, rise: 2 })
    waves.group.position.set(-12, 3.5, 0.5)
    waves.group.scale.setScalar(0.7)
    const fumes = smoke(scene, 3, { count: 24, rise: 6 })
    fumes.group.position.set(-12, 3.4, 0.5)
    const lampMat = glowMat(POWER, 0.2)
    add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), lampMat), [-17.4, -3.4, 0.4])
    const lampTag = liveLabel(scene, [-16.7, -3.4, 0.4], { size: 0.34, align: 'left' })
    const temp = thermometer(9)
    add(scene, temp.group, [-5.6, -5.4, 0])
    const tempTag = liveLabel(scene, [-4.6, 2.8, 0.4], { size: 0.42, align: 'left' })
    const clockTag = liveLabel(scene, [-12, -5.6, 0.4], { size: 0.38 })

    const plot = scope(scene, TH.plotW, TH.plotH, { divs: [6, 9], zeroAt: 0 })
    plot.group.position.set(6.2, 1.4, 0)
    const yOf = (c: number) => ((Math.min(TH.hi, c) - TH.lo) / (TH.hi - TH.lo)) * TH.plotH - TH.plotH / 2
    const tr = plot.trace(HEAT, { samples: 300, radius: 0.07 })
    const ssLine = plot.level(RING)
    const maxLine = plot.level(HIGH_V)
    const ambLine = plot.level(LOW_V, 0.3)
    const tauBar = cursorBar(plot, GREY, 0.05)
    addLabel(scene, 'τ', [6.2 + plot.xAt(TD.tauS / TH.seconds), 1.4 + TH.plotH / 2 + 0.6, 0.3], GREY, 0.4)
    addLabel(scene, `0…${TH.seconds / 60} min · ${TH.lo}…${TH.hi} °C`, [6.2, 1.4 - TH.plotH / 2 - 1.2, 0.3], GREY, 0.3)
    addLabel(scene, 'winding temperature', [6.2, 1.4 + TH.plotH / 2 + 1.4, 0.3], LABEL, 0.32)
    const cookTag = liveLabel(scene, [6.2, -4.6, 0.3], { size: 0.38 })

    const st = { key: '', t: 0, angle: 0 }
    return {
      scene,
      view: { center: [-2.6, -0.2, 0], radius: 56, polar: 1.45, azimuth: 0.1 },
      frame(dt, p) {
        const q = thermParams(p)
        const key = `${q.f}|${q.duty}|${q.ak}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          ssLine.set(Number.isFinite(q.ss) ? yOf(q.ss) : 99)
          maxLine.set(yOf(TD.maxC))
          ambLine.set(yOf(q.amb))
          tauBar(TD.tauS / TH.seconds)
        }
        st.t += dt
        if (st.t > TH.playS + TH.holdS) st.t = 0
        const simT = Math.min(TH.seconds, (st.t / TH.playS) * TH.seconds)
        const i = Math.min(q.run.length - 1, Math.round(simT / TH.dt))
        const f = q.run[i]
        const shown = q.run.filter((_, k) => k <= i && k % 3 === 0)
        tr.points(shown.map((x) => x.t / TH.seconds), shown.map((x) => yOf(x.tempC)))
        const cooked = q.cookAt !== null && simT >= q.cookAt
        const burntAt = q.run.find((x) => x.dead)?.t ?? null
        st.angle += f.on ? dt * 6 : 0
        const heat = Math.max(0, Math.min(1, (f.tempC - 60) / (TD.maxC - 60)))
        motor.set(st.angle, f.on ? Math.min(1, f.amps / stallA(TD) * 2.5) : 0, cooked ? 1 : heat)
        waves.step(dt, heat)
        fumes.step(dt, cooked ? (f.dead ? 0.35 : 1) : 0)
        setGlow(lampMat, f.on ? POWER : '#2a2d33', f.on ? 1 : 0.1)
        lampTag.set(f.dead ? 'open circuit: 0 A' : f.on ? `on: ${f.amps.toFixed(1)} A, ${f.watts.toFixed(0)} W` : 'off: cooling', f.dead ? HIGH_V : f.on ? POWER : GREY)
        temp.set((f.tempC - TH.lo) / (TH.hi - TH.lo))
        tempTag.set(`${f.tempC.toFixed(0)} °C`, f.tempC >= TD.maxC ? HIGH_V : f.tempC > TD.maxC - 15 ? HEAT : LABEL)
        clockTag.set(`t = ${minText(simT)} · ${TH.seconds / TH.playS}× real time`, GREY)
        cookTag.set(burntAt !== null ? `passes ${TD.maxC} °C at ${minText(q.cookAt!)}, burns open at ${minText(burntAt)}` : q.cookAt !== null ? `passes ${TD.maxC} °C at ${minText(q.cookAt)}` : `stays under ${TD.maxC} °C`, q.cookAt !== null ? HIGH_V : POWER)
        status.set(
          f.dead ? 'Burnt open: this motor is dead' : cooked ? 'Cooked: the enamel burns, turns short' : q.cookAt !== null ? 'Heading past the limit' : f.tempC > TD.maxC - 15 ? 'Hot, but settles under the limit' : 'Settles well under the limit',
          cooked ? HIGH_V : q.cookAt !== null ? HEAT : POWER,
        )
        sub.set(`${TD.name}, ${q.load.toFixed(2)} N·m when on, ${(q.duty * 100).toFixed(0)} % of every ${TH.periodS} s · ${AMBIENTS[q.ak]}`)
      },
      readouts: (p) => {
        const q = thermParams(p)
        return [
          { label: 'Current when on', value: `${q.amps.toFixed(2)} A / ${continuousAmps(TD, q.amb).toFixed(2)} A cont.`, tone: q.amps * Math.sqrt(q.duty) > continuousAmps(TD, q.amb) ? 'bad' : 'ok' },
          { label: 'Steady', value: Number.isFinite(q.ss) ? `${q.ss.toFixed(0)} °C` : 'runaway', tone: q.ss >= TD.maxC ? 'bad' : q.ss > TD.maxC - 15 ? 'warn' : 'ok' },
          { label: `Reaches ${TD.maxC} °C`, value: q.cookAt !== null ? `after ${minText(q.cookAt)}` : 'never', tone: q.cookAt !== null ? 'bad' : 'ok' },
          { label: `Rated at ${q.amb} °C`, value: `${nm(q.rated)} (${Math.round((100 * q.rated) / ratedNm(TD))} %)`, tone: q.amb > 25 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
